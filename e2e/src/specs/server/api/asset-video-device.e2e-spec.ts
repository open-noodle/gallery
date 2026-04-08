import { type LoginResponseDto } from '@immich/sdk';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Socket } from 'socket.io-client';
import { type Actor, authHeaders } from 'src/actors';
import { createUserDto } from 'src/fixtures';
import { errorDto } from 'src/responses';
import { app, asBearerAuth, utils } from 'src/utils';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// T28 — covers two small uncovered surfaces:
//
//   GET /assets/:id/video/playback     (asset-media.controller.ts:192)
//   GET /assets/device/:deviceId       (asset.controller.ts:46, deprecated v2)
//
// Both are too small to merit their own files but together pin a useful corner
// of the asset surface area. The video playback path is the only public route
// that streams video bytes; the device endpoint is the legacy mobile sync hook
// (deprecated, but still wired and used by older clients).
//
// Service shapes:
//   - playbackVideo (asset-media.service.ts:268-280) — requireAccess(AssetView)
//     so 400 for non-owner. Then getForVideo (asset.repository.ts:1355-1372)
//     filters `asset.type = Video`; if the asset isn't a video, the result is
//     null → NotFoundException → 404.
//   - getUserAssetsByDeviceId (asset.service.ts:81-83) — NO requireAccess.
//     Just `assetRepository.getAllByDeviceId(auth.user.id, deviceId)`. Cross-
//     user isolation is automatic via the userId scope.

const videoFixtureDir = resolve(import.meta.dirname, '../../../../../server/test/fixtures/videos');

describe('asset video playback + device queries', () => {
  let admin: LoginResponseDto;
  let owner: LoginResponseDto;
  let other: LoginResponseDto;
  let websocket: Socket;
  let videoAssetId: string;
  let imageAssetId: string;
  // Used to assert deviceAssetIds appear in /assets/device/:deviceId.
  // Both deviceId values are simple strings — no validation beyond non-empty.
  const ownerDeviceId = 't28-device';
  const ownerDeviceAssetId1 = 't28-device-asset-1';
  const ownerDeviceAssetId2 = 't28-device-asset-2';
  const anonActor: Actor = { id: 'anon' };

  beforeAll(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup({ onboarding: false });
    [owner, other] = await Promise.all([
      utils.userSetup(admin.accessToken, createUserDto.create('t28-owner')),
      utils.userSetup(admin.accessToken, createUserDto.create('t28-other')),
    ]);
    websocket = await utils.connectWebsocket(owner.accessToken);

    // Upload a real video so playback has actual bytes to stream. The fixture
    // is shared with video-trim.e2e-spec.ts.
    const videoBytes = await readFile(`${videoFixtureDir}/normal.mp4`);
    const videoAsset = await utils.createAsset(owner.accessToken, {
      assetData: { filename: 'normal.mp4', bytes: videoBytes },
    });
    videoAssetId = videoAsset.id;
    await utils.waitForWebsocketEvent({ event: 'assetUpload', id: videoAssetId });

    // Image asset for the "404 because not a video" test, also used to seed
    // the device endpoint with a known deviceAssetId.
    const imageAsset = await utils.createAsset(owner.accessToken, {
      deviceId: ownerDeviceId,
      deviceAssetId: ownerDeviceAssetId1,
    });
    imageAssetId = imageAsset.id;

    // A second asset on the SAME deviceId so the device endpoint can return >1.
    await utils.createAsset(owner.accessToken, {
      deviceId: ownerDeviceId,
      deviceAssetId: ownerDeviceAssetId2,
    });
  }, 30_000);

  afterAll(() => {
    utils.disconnectWebsocket(websocket);
  });

  describe('GET /assets/:id/video/playback', () => {
    it('requires authentication', async () => {
      const { status } = await request(app).get(`/assets/${videoAssetId}/video/playback`).set(authHeaders(anonActor));
      expect(status).toBe(401);
    });

    it('owner can stream their own video (200 with video/* content-type)', async () => {
      // Hit the playback endpoint as the owner. supertest buffers the full
      // response body into a Buffer for non-JSON responses, which is fine for
      // our small `normal.mp4` fixture. We confirm status, content-type, and
      // that a non-zero number of bytes is delivered. The shared fixture is
      // used by video-trim too, so the file size is bounded.
      const { status, headers, body } = await request(app)
        .get(`/assets/${videoAssetId}/video/playback`)
        .set(asBearerAuth(owner.accessToken));
      expect(status).toBe(200);
      expect(headers['content-type']).toMatch(/^video\//);
      expect((body as Buffer).length).toBeGreaterThan(0);
    });

    it('non-owner returns 400 (bulk-access pattern)', async () => {
      const { status, body } = await request(app)
        .get(`/assets/${videoAssetId}/video/playback`)
        .set(asBearerAuth(other.accessToken));
      expect(status).toBe(400);
      expect(body).toEqual(errorDto.noPermission);
    });

    it('image asset (not a video) returns 404', async () => {
      // playbackVideo passes the access check for the owner, then getForVideo
      // returns null because the asset.type is Image, then NotFoundException is
      // thrown — see asset-media.service.ts:273-274.
      const { status } = await request(app)
        .get(`/assets/${imageAssetId}/video/playback`)
        .set(asBearerAuth(owner.accessToken));
      expect(status).toBe(404);
    });

    it('non-existent asset returns 400 (bulk-access fires before the asset lookup)', async () => {
      const { status, body } = await request(app)
        .get('/assets/00000000-0000-4000-a000-000000000099/video/playback')
        .set(asBearerAuth(owner.accessToken));
      expect(status).toBe(400);
      expect(body).toEqual(errorDto.noPermission);
    });

    it('malformed asset id returns 400', async () => {
      const { status } = await request(app)
        .get('/assets/not-a-uuid/video/playback')
        .set(asBearerAuth(owner.accessToken));
      expect(status).toBe(400);
    });
  });

  describe('GET /assets/device/:deviceId', () => {
    it('requires authentication', async () => {
      const { status } = await request(app).get(`/assets/device/${ownerDeviceId}`).set(authHeaders(anonActor));
      expect(status).toBe(401);
    });

    it('owner gets the deviceAssetIds for their own deviceId', async () => {
      // The endpoint returns string[] of deviceAssetIds (the CLIENT identifiers,
      // NOT server UUIDs). Both seeded assets should appear.
      const { status, body } = await request(app)
        .get(`/assets/device/${ownerDeviceId}`)
        .set(asBearerAuth(owner.accessToken));
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
      const ids = body as string[];
      expect(ids).toContain(ownerDeviceAssetId1);
      expect(ids).toContain(ownerDeviceAssetId2);
    });

    it('unknown deviceId returns an empty array', async () => {
      const { status, body } = await request(app)
        .get('/assets/device/some-other-device-that-does-not-exist')
        .set(asBearerAuth(owner.accessToken));
      expect(status).toBe(200);
      expect(body).toEqual([]);
    });

    it('cross-user isolation: another user querying the SAME deviceId sees nothing', async () => {
      // Two users could legitimately have the same deviceId (it's a client
      // string, not a UUID). The service scopes by auth.user.id so the other
      // user MUST NOT see this user's deviceAssetIds. The other user has zero
      // assets on this deviceId, so the response should be EXACTLY empty —
      // not "doesn't include the leaked ids", which would also pass if some
      // unrelated leak slipped through.
      const { status, body } = await request(app)
        .get(`/assets/device/${ownerDeviceId}`)
        .set(asBearerAuth(other.accessToken));
      expect(status).toBe(200);
      expect(body).toEqual([]);
    });
  });
});
