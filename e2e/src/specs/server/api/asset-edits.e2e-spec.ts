import { type LoginResponseDto } from '@immich/sdk';
import { Socket } from 'socket.io-client';
import { type Actor, authHeaders } from 'src/actors';
import { createUserDto } from 'src/fixtures';
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
// guarantees the metadata extraction job has populated exifImageWidth/Height.

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

    // Shared, never-mutated asset for read-only GET tests.
    sharedAssetId = await uploadFreshImage();
  }, 30_000);

  afterAll(() => {
    utils.disconnectWebsocket(websocket);
  });

  describe('GET /assets/:id/edits', () => {
    it('requires authentication', async () => {
      const { status } = await request(app).get(`/assets/${sharedAssetId}/edits`).set(authHeaders(anonActor));
      expect(status).toBe(401);
    });

    it('owner gets an empty edits list for a fresh asset', async () => {
      const { status, body } = await request(app)
        .get(`/assets/${sharedAssetId}/edits`)
        .set(asBearerAuth(owner.accessToken));
      expect(status).toBe(200);
      expect(body).toEqual({ assetId: sharedAssetId, edits: [] });
    });

    it('non-owner returns 400 (bulk-access pattern)', async () => {
      const { status } = await request(app)
        .get(`/assets/${sharedAssetId}/edits`)
        .set(asBearerAuth(other.accessToken));
      expect(status).toBe(400);
    });

    it('non-existent asset returns 400', async () => {
      // requireAccess routes "not found OR no access" through BadRequestException.
      const { status } = await request(app)
        .get('/assets/00000000-0000-4000-a000-000000000099/edits')
        .set(asBearerAuth(owner.accessToken));
      expect(status).toBe(400);
    });

    it('malformed asset id returns 400', async () => {
      const { status } = await request(app)
        .get('/assets/not-a-uuid/edits')
        .set(asBearerAuth(owner.accessToken));
      expect(status).toBe(400);
    });
  });

  describe('PUT /assets/:id/edits — non-trim mutations', () => {
    it('non-owner returns 400', async () => {
      const { status } = await request(app)
        .put(`/assets/${sharedAssetId}/edits`)
        .set(asBearerAuth(other.accessToken))
        .send({ edits: [{ action: 'rotate', parameters: { angle: 90 } }] });
      expect(status).toBe(400);
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
      // asset.service.ts:714 — 'Crop action must be the first edit action'.
      const assetId = await uploadFreshImage();
      const { status } = await request(app)
        .put(`/assets/${assetId}/edits`)
        .set(asBearerAuth(owner.accessToken))
        .send({
          edits: [
            { action: 'rotate', parameters: { angle: 90 } },
            { action: 'crop', parameters: { x: 0, y: 0, width: 1, height: 1 } },
          ],
        });
      expect(status).toBe(400);
    });

    it('crop out of bounds returns 400', async () => {
      // 1x1 image; width=2 trips the `x + width > assetWidth` check at asset.service.ts:719.
      const assetId = await uploadFreshImage();
      const { status } = await request(app)
        .put(`/assets/${assetId}/edits`)
        .set(asBearerAuth(owner.accessToken))
        .send({ edits: [{ action: 'crop', parameters: { x: 0, y: 0, width: 2, height: 2 } }] });
      expect(status).toBe(400);
    });

    it('non-axis-aligned rotation returns 400 (DTO validation)', async () => {
      // IsAxisAlignedRotation only accepts 0/90/180/270; 45 fails the validator.
      const { status } = await request(app)
        .put(`/assets/${sharedAssetId}/edits`)
        .set(asBearerAuth(owner.accessToken))
        .send({ edits: [{ action: 'rotate', parameters: { angle: 45 } }] });
      expect(status).toBe(400);
    });

    it('empty edits array returns 400 (ArrayMinSize)', async () => {
      // AssetEditsCreateDto.edits has @ArrayMinSize(1).
      const { status } = await request(app)
        .put(`/assets/${sharedAssetId}/edits`)
        .set(asBearerAuth(owner.accessToken))
        .send({ edits: [] });
      expect(status).toBe(400);
    });

    it('duplicate actions return 400 (UniqueEditActions)', async () => {
      // IsUniqueEditActions rejects two `rotate` actions in a single edits array.
      // (Mirror is the one exception — two mirrors with different axes ARE allowed,
      // because the dedup key includes the parameters for mirror.)
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
    it('non-owner returns 400', async () => {
      const { status } = await request(app)
        .delete(`/assets/${sharedAssetId}/edits`)
        .set(asBearerAuth(other.accessToken));
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
