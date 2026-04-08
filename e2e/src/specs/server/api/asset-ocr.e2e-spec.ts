import { type LoginResponseDto } from '@immich/sdk';
import { Socket } from 'socket.io-client';
import { type Actor, authHeaders } from 'src/actors';
import { createUserDto } from 'src/fixtures';
import { app, asBearerAuth, utils } from 'src/utils';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Coverage for the asset OCR endpoint — fork extension on /assets:
//
//   GET /assets/:id/ocr
//
// Returns AssetOcrResponseDto[]. Service routes through requireAccess(AssetRead)
// which is the bulk-access pattern → 400 for non-owner. The default fixture
// asset has no OCR data (the OCR job isn't run for generated test PNGs), so the
// happy-path response is an empty array.
//
// IMPORTANT: `asset.service.ts:461-477` calls `assetRepository.getForOcr(id)`
// which inner-joins `asset_exif`. The exif row is populated asynchronously by
// the metadata extraction job. Without a websocket wait on `assetUpload`, the
// happy-path test races: the GET fires before exif extraction completes, the
// inner-join returns null, and the service throws BadRequestException
// ('Asset not found') → 400 instead of the expected 200. The wait below
// closes the race.

describe('GET /assets/:id/ocr', () => {
  let admin: LoginResponseDto;
  let owner: LoginResponseDto;
  let other: LoginResponseDto;
  let websocket: Socket;
  let assetId: string;
  const anonActor: Actor = { id: 'anon' };

  beforeAll(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup();
    [owner, other] = await Promise.all([
      utils.userSetup(admin.accessToken, createUserDto.create('t24-owner')),
      utils.userSetup(admin.accessToken, createUserDto.create('t24-other')),
    ]);
    websocket = await utils.connectWebsocket(owner.accessToken);
    const asset = await utils.createAsset(owner.accessToken);
    assetId = asset.id;
    // Wait for the upload pipeline (metadata extraction → thumbnail generation
    // → on_upload_success). After this fires, asset_exif is populated and
    // getForOcr's inner-join will succeed.
    await utils.waitForWebsocketEvent({ event: 'assetUpload', id: assetId });
  });

  afterAll(() => {
    utils.disconnectWebsocket(websocket);
  });

  it('requires authentication', async () => {
    const { status } = await request(app).get(`/assets/${assetId}/ocr`).set(authHeaders(anonActor));
    expect(status).toBe(401);
  });

  it('owner can fetch OCR — empty array for unprocessed asset', async () => {
    // The asset row exists, the ocr-rows table is empty for it. asset.service.ts:461-477
    // calls ocrRepository.getByAssetId(id) which returns []; the happy-path is [], not 404.
    // (A missing asset row would surface as a 400 from getForOcr(id) — see the next test.)
    const { status, body } = await request(app).get(`/assets/${assetId}/ocr`).set(asBearerAuth(owner.accessToken));
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body).toEqual([]);
  });

  it('non-owner returns 400 (bulk-access pattern)', async () => {
    const { status } = await request(app).get(`/assets/${assetId}/ocr`).set(asBearerAuth(other.accessToken));
    expect(status).toBe(400);
  });

  it("admin reading another user's asset OCR returns 400 (no admin override)", async () => {
    // The bulk-access pattern for Permission.AssetRead is owner-only — admins do NOT
    // get blanket asset read via checkOwnerAccess. Pin it explicitly here so a future
    // refactor that adds an admin escape hatch fails this test deliberately. Same
    // taxonomy as T03/T07/T22 — 400, not 403.
    const { status } = await request(app).get(`/assets/${assetId}/ocr`).set(asBearerAuth(admin.accessToken));
    expect(status).toBe(400);
  });

  it('non-existent asset returns 400 (not 404)', async () => {
    // requireAccess routes "not found OR no access" through BadRequestException.
    // Same taxonomy as T03 timeline, T07 face, T22 workflow.
    const { status } = await request(app)
      .get('/assets/00000000-0000-4000-a000-000000000099/ocr')
      .set(asBearerAuth(owner.accessToken));
    expect(status).toBe(400);
  });

  it('malformed asset id returns 400', async () => {
    // UUIDParamDto validation rejects non-UUID at the controller layer.
    const { status } = await request(app).get('/assets/not-a-uuid/ocr').set(asBearerAuth(owner.accessToken));
    expect(status).toBe(400);
  });
});
