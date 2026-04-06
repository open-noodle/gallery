import { type LoginResponseDto } from '@immich/sdk';
import { Socket } from 'socket.io-client';
import { type Actor, authHeaders } from 'src/actors';
import { createUserDto } from 'src/fixtures';
import { errorDto } from 'src/responses';
import { app, asBearerAuth, utils } from 'src/utils';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Coverage for the non-trim half of /assets/:id/edits — `video-trim.e2e-spec.ts`
// already covers the trim path. T25 pins crop / rotate / mirror behavior plus
// the shared GET / DELETE / validation surface.
//
// Service shape (asset.service.ts:603-755):
//   GET    → requireAccess(AssetRead)        → 400 for non-owner
//   PUT    → requireAccess(AssetEditCreate)  → 400 for non-owner
//   DELETE → requireAccess(AssetEditDelete)  → 400 for non-owner
//
// Image-path validation (no trim):
//   - asset.type must be Image (not Video)
//   - rejects live-photo, panorama, .gif, .svg
//     (NOT pinned here — would need format-specific fixtures, deferred to a follow-up)
//   - crop bounds must fit asset width/height
//   - if crop is present, it MUST be the first action in the edits array
// DTO validation:
//   - ArrayMinSize(1)            — empty edits → 400
//   - IsUniqueEditActions        — two crops or two rotates → 400
//   - IsAxisAlignedRotation      — rotate angle ∈ {0, 90, 180, 270}
//
// Generated PNGs from `makeRandomImage()` are 1x1, so the only valid crop is
// x=0,y=0,w=1,h=1 (the whole pixel). That's enough to exercise both the success
// path and the bounds-error path. Waiting on the `assetUpload` websocket event
// guarantees the metadata extraction job has populated exifImageWidth/Height —
// `job.service.ts:157` emits `on_upload_success` from the thumbnail-generation
// handler AFTER `asset.exifInfo` is read on the very next line, so the order is
// closed in steady state. The bounds-error tests below pin the SPECIFIC error
// message to defend against a future job-ordering regression silently flipping
// the failure to "Asset dimensions are not available for editing".

describe('/assets/:id/edits (non-trim)', () => {
  let admin: LoginResponseDto;
  let owner: LoginResponseDto;
  let other: LoginResponseDto;
  let websocket: Socket;
  let sharedAssetId: string;
  const anonActor: Actor = { id: 'anon' };

  // Each mutation test gets a fresh asset to avoid state bleed.
  const uploadFreshImage = async () => {
    const asset = await utils.createAsset(owner.accessToken);
    await utils.waitForWebsocketEvent({ event: 'assetUpload', id: asset.id });
    return asset.id;
  };

  beforeAll(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup({ onboarding: false });
    [owner, other] = await Promise.all([
      utils.userSetup(admin.accessToken, createUserDto.create('t25-owner')),
      utils.userSetup(admin.accessToken, createUserDto.create('t25-other')),
    ]);
    websocket = await utils.connectWebsocket(owner.accessToken);

    // Shared, READ-ONLY asset for the GET tests, validation-only PUT tests, and
    // access-only PUT/DELETE tests. The owner-side mutating tests (rotate, crop,
    // mirror, delete-roundtrip) all use `uploadFreshImage()` per-test so the
    // shared asset is never mutated. If you add a successful PUT against
    // `sharedAssetId`, the GET-empty test below will start failing in mysterious
    // file-order-dependent ways — use `uploadFreshImage()` instead.
    sharedAssetId = await uploadFreshImage();
  }, 30_000);

  afterAll(() => {
    utils.disconnectWebsocket(websocket);
  });

  describe('GET /assets/:id/edits', () => {
    it('requires authentication', async () => {
      const { status, body } = await request(app).get(`/assets/${sharedAssetId}/edits`).set(authHeaders(anonActor));
      expect(status).toBe(401);
      expect(body).toEqual(errorDto.unauthorized);
    });

    it('owner gets an empty edits list for a fresh asset', async () => {
      // Pre-condition: `sharedAssetId` is never mutated by any test in this file.
      // See the `beforeAll` comment.
      const { status, body } = await request(app)
        .get(`/assets/${sharedAssetId}/edits`)
        .set(asBearerAuth(owner.accessToken));
      expect(status).toBe(200);
      expect(body).toEqual({ assetId: sharedAssetId, edits: [] });
    });

    it('non-owner returns 400 (bulk-access pattern)', async () => {
      const { status, body } = await request(app)
        .get(`/assets/${sharedAssetId}/edits`)
        .set(asBearerAuth(other.accessToken));
      expect(status).toBe(400);
      expect(body).toEqual(errorDto.noPermission);
    });

    it("admin reading another user's asset edits returns 400 (no admin override)", async () => {
      // The bulk-access pattern for Permission.AssetEditGet is owner-only —
      // admins do NOT get a blanket asset-read escape hatch. Same taxonomy as T24.
      const { status, body } = await request(app)
        .get(`/assets/${sharedAssetId}/edits`)
        .set(asBearerAuth(admin.accessToken));
      expect(status).toBe(400);
      expect(body).toEqual(errorDto.noPermission);
    });

    it('non-existent asset returns 400', async () => {
      // requireAccess routes "not found OR no access" through BadRequestException.
      const { status, body } = await request(app)
        .get('/assets/00000000-0000-4000-a000-000000000099/edits')
        .set(asBearerAuth(owner.accessToken));
      expect(status).toBe(400);
      expect(body).toEqual(errorDto.noPermission);
    });

    it('malformed asset id returns 400', async () => {
      const { status } = await request(app).get('/assets/not-a-uuid/edits').set(asBearerAuth(owner.accessToken));
      expect(status).toBe(400);
    });
  });

  describe('PUT /assets/:id/edits — non-trim mutations', () => {
    it('requires authentication', async () => {
      const { status, body } = await request(app)
        .put(`/assets/${sharedAssetId}/edits`)
        .set(authHeaders(anonActor))
        .send({ edits: [{ action: 'rotate', parameters: { angle: 90 } }] });
      expect(status).toBe(401);
      expect(body).toEqual(errorDto.unauthorized);
    });

    it('non-owner returns 400 (bulk-access pattern)', async () => {
      const { status, body } = await request(app)
        .put(`/assets/${sharedAssetId}/edits`)
        .set(asBearerAuth(other.accessToken))
        .send({ edits: [{ action: 'rotate', parameters: { angle: 90 } }] });
      expect(status).toBe(400);
      expect(body).toEqual(errorDto.noPermission);
    });

    it("admin PUTting another user's asset edits returns 400 (no admin override)", async () => {
      const { status, body } = await request(app)
        .put(`/assets/${sharedAssetId}/edits`)
        .set(asBearerAuth(admin.accessToken))
        .send({ edits: [{ action: 'rotate', parameters: { angle: 90 } }] });
      expect(status).toBe(400);
      expect(body).toEqual(errorDto.noPermission);
    });

    it('owner can rotate (axis-aligned)', async () => {
      const assetId = await uploadFreshImage();
      const { status, body } = await request(app)
        .put(`/assets/${assetId}/edits`)
        .set(asBearerAuth(owner.accessToken))
        .send({ edits: [{ action: 'rotate', parameters: { angle: 90 } }] });
      expect(status).toBe(200);
      expect(body.assetId).toBe(assetId);
      expect(body.edits).toHaveLength(1);
      expect(body.edits[0]).toEqual(
        expect.objectContaining({
          action: 'rotate',
          parameters: expect.objectContaining({ angle: 90 }),
        }),
      );
    });

    it('owner can mirror (horizontal)', async () => {
      const assetId = await uploadFreshImage();
      const { status, body } = await request(app)
        .put(`/assets/${assetId}/edits`)
        .set(asBearerAuth(owner.accessToken))
        .send({ edits: [{ action: 'mirror', parameters: { axis: 'horizontal' } }] });
      expect(status).toBe(200);
      expect(body.edits).toHaveLength(1);
      expect(body.edits[0]).toEqual(
        expect.objectContaining({
          action: 'mirror',
          parameters: expect.objectContaining({ axis: 'horizontal' }),
        }),
      );
    });

    it('two mirrors with DIFFERENT axes are allowed (UniqueEditActions special case)', async () => {
      // validation.ts:112 — the UniqueEditActions dedup key for `mirror` is
      // `mirror-${JSON.stringify(parameters)}`, so horizontal + vertical pass.
      // Every other action uses just the action name as the key. This is the
      // ONLY non-obvious thing about IsUniqueEditActions; pinning the positive
      // case keeps the rule legible.
      const assetId = await uploadFreshImage();
      const { status, body } = await request(app)
        .put(`/assets/${assetId}/edits`)
        .set(asBearerAuth(owner.accessToken))
        .send({
          edits: [
            { action: 'mirror', parameters: { axis: 'horizontal' } },
            { action: 'mirror', parameters: { axis: 'vertical' } },
          ],
        });
      expect(status).toBe(200);
      expect(body.edits).toHaveLength(2);
    });

    it('owner can crop within bounds (1x1 fixture allows only the whole pixel)', async () => {
      // The makeRandomImage() PNG is 1x1, so the only valid crop is the entire image.
      // The CropParameters DTO has @Min(1) on width/height, so smaller is rejected.
      const assetId = await uploadFreshImage();
      const { status, body } = await request(app)
        .put(`/assets/${assetId}/edits`)
        .set(asBearerAuth(owner.accessToken))
        .send({ edits: [{ action: 'crop', parameters: { x: 0, y: 0, width: 1, height: 1 } }] });
      expect(status).toBe(200);
      expect(body.edits).toHaveLength(1);
      expect(body.edits[0]).toEqual(
        expect.objectContaining({
          action: 'crop',
          parameters: expect.objectContaining({ x: 0, y: 0, width: 1, height: 1 }),
        }),
      );
    });

    it('crop + rotate is allowed when crop is first', async () => {
      const assetId = await uploadFreshImage();
      const { status, body } = await request(app)
        .put(`/assets/${assetId}/edits`)
        .set(asBearerAuth(owner.accessToken))
        .send({
          edits: [
            { action: 'crop', parameters: { x: 0, y: 0, width: 1, height: 1 } },
            { action: 'rotate', parameters: { angle: 180 } },
          ],
        });
      expect(status).toBe(200);
      expect(body.edits).toHaveLength(2);
      // Order is preserved: crop is index 0, rotate is index 1.
      expect(body.edits[0].action).toBe('crop');
      expect(body.edits[1].action).toBe('rotate');
    });

    it('crop + rotate is rejected when crop is NOT first', async () => {
      // asset.service.ts:714 — pinning the exact message so a future refactor
      // that flips this 400 to a different cause (e.g. dimensions-unavailable)
      // fails this test deliberately.
      const assetId = await uploadFreshImage();
      const { status, body } = await request(app)
        .put(`/assets/${assetId}/edits`)
        .set(asBearerAuth(owner.accessToken))
        .send({
          edits: [
            { action: 'rotate', parameters: { angle: 90 } },
            { action: 'crop', parameters: { x: 0, y: 0, width: 1, height: 1 } },
          ],
        });
      expect(status).toBe(400);
      expect(body).toEqual(errorDto.badRequest('Crop action must be the first edit action'));
    });

    it('crop out of bounds returns 400 with the bounds-specific message', async () => {
      // 1x1 image; width=2 trips the `x + width > assetWidth` check at
      // asset.service.ts:719. The error message must be exactly
      // "Crop parameters are out of bounds" — if the metadata-extraction job
      // ever stops populating exifImageWidth/Height before the websocket fires,
      // this would silently flip to "Asset dimensions are not available for
      // editing" (also a 400, also matches `errorDto.badRequest()` with no
      // arg), which would mask the real failure mode.
      const assetId = await uploadFreshImage();
      const { status, body } = await request(app)
        .put(`/assets/${assetId}/edits`)
        .set(asBearerAuth(owner.accessToken))
        .send({ edits: [{ action: 'crop', parameters: { x: 0, y: 0, width: 2, height: 2 } }] });
      expect(status).toBe(400);
      expect(body).toEqual(errorDto.badRequest('Crop parameters are out of bounds'));
    });

    it('non-axis-aligned rotation returns 400 (DTO validation)', async () => {
      // IsAxisAlignedRotation only accepts 0/90/180/270; 45 fails the validator.
      // This is DTO-level — the global ValidationPipe rejects before editAsset()
      // is even invoked, so it can't mutate state on `sharedAssetId`.
      const { status } = await request(app)
        .put(`/assets/${sharedAssetId}/edits`)
        .set(asBearerAuth(owner.accessToken))
        .send({ edits: [{ action: 'rotate', parameters: { angle: 45 } }] });
      expect(status).toBe(400);
    });

    it('empty edits array returns 400 (ArrayMinSize)', async () => {
      // AssetEditsCreateDto.edits has @ArrayMinSize(1). Same DTO-level pre-empt;
      // service is never called. Safe to use sharedAssetId.
      const { status } = await request(app)
        .put(`/assets/${sharedAssetId}/edits`)
        .set(asBearerAuth(owner.accessToken))
        .send({ edits: [] });
      expect(status).toBe(400);
    });

    it('two rotates with different angles return 400 (UniqueEditActions)', async () => {
      // IsUniqueEditActions rejects two `rotate` actions even with different
      // params — the dedup key for non-mirror actions is just `edit.action`.
      // (The complementary positive case for mirror is pinned in the
      // dual-axis-mirror test above.) DTO-level rejection.
      const { status } = await request(app)
        .put(`/assets/${sharedAssetId}/edits`)
        .set(asBearerAuth(owner.accessToken))
        .send({
          edits: [
            { action: 'rotate', parameters: { angle: 90 } },
            { action: 'rotate', parameters: { angle: 180 } },
          ],
        });
      expect(status).toBe(400);
    });
  });

  describe('DELETE /assets/:id/edits', () => {
    it('requires authentication', async () => {
      const { status, body } = await request(app).delete(`/assets/${sharedAssetId}/edits`).set(authHeaders(anonActor));
      expect(status).toBe(401);
      expect(body).toEqual(errorDto.unauthorized);
    });

    it('non-owner returns 400 (bulk-access pattern)', async () => {
      const { status, body } = await request(app)
        .delete(`/assets/${sharedAssetId}/edits`)
        .set(asBearerAuth(other.accessToken));
      expect(status).toBe(400);
      expect(body).toEqual(errorDto.noPermission);
    });

    it("admin DELETEing another user's asset edits returns 400 (no admin override)", async () => {
      const { status, body } = await request(app)
        .delete(`/assets/${sharedAssetId}/edits`)
        .set(asBearerAuth(admin.accessToken));
      expect(status).toBe(400);
      expect(body).toEqual(errorDto.noPermission);
    });

    it('non-existent asset returns 400', async () => {
      const { status, body } = await request(app)
        .delete('/assets/00000000-0000-4000-a000-000000000099/edits')
        .set(asBearerAuth(owner.accessToken));
      expect(status).toBe(400);
      expect(body).toEqual(errorDto.noPermission);
    });

    it('malformed asset id returns 400', async () => {
      const { status } = await request(app).delete('/assets/not-a-uuid/edits').set(asBearerAuth(owner.accessToken));
      expect(status).toBe(400);
    });

    it('owner can delete edits and the listing returns to empty', async () => {
      // Apply a rotate, confirm it's there, delete, confirm GET returns empty.
      const assetId = await uploadFreshImage();
      const apply = await request(app)
        .put(`/assets/${assetId}/edits`)
        .set(asBearerAuth(owner.accessToken))
        .send({ edits: [{ action: 'rotate', parameters: { angle: 90 } }] });
      expect(apply.status).toBe(200);
      expect(apply.body.edits).toHaveLength(1);

      const del = await request(app).delete(`/assets/${assetId}/edits`).set(asBearerAuth(owner.accessToken));
      expect(del.status).toBe(204);

      const list = await request(app).get(`/assets/${assetId}/edits`).set(asBearerAuth(owner.accessToken));
      expect(list.status).toBe(200);
      expect(list.body.edits).toEqual([]);
    });
  });
});
