import { type LoginResponseDto } from '@immich/sdk';
import { type Actor, authHeaders } from 'src/actors';
import { createUserDto } from 'src/fixtures';
import { app, asBearerAuth, utils } from 'src/utils';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

// Coverage for the asset OCR endpoint — fork extension on /assets:
//
//   GET /assets/:id/ocr
//
// Returns AssetOcrResponseDto[]. Service routes through requireAccess(AssetRead)
// which is the bulk-access pattern → 400 for non-owner. The default fixture
// asset has no OCR data (the OCR job isn't run for generated test PNGs), so the
// happy-path response is an empty array.

describe('GET /assets/:id/ocr', () => {
  let admin: LoginResponseDto;
  let owner: LoginResponseDto;
  let other: LoginResponseDto;
  let assetId: string;
  const anonActor: Actor = { id: 'anon' };

  beforeAll(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup();
    [owner, other] = await Promise.all([
      utils.userSetup(admin.accessToken, createUserDto.create('t24-owner')),
      utils.userSetup(admin.accessToken, createUserDto.create('t24-other')),
    ]);
    const asset = await utils.createAsset(owner.accessToken);
    assetId = asset.id;
  });

  it('requires authentication', async () => {
    const { status } = await request(app).get(`/assets/${assetId}/ocr`).set(authHeaders(anonActor));
    expect(status).toBe(401);
  });

  it('owner can fetch OCR — empty array for unprocessed asset', async () => {
    // Generated PNGs from the test stack don't have OCR data extracted; the
    // happy-path response is an empty array, not 404.
    const { status, body } = await request(app)
      .get(`/assets/${assetId}/ocr`)
      .set(asBearerAuth(owner.accessToken));
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body).toEqual([]);
  });

  it('non-owner returns 400 (bulk-access pattern)', async () => {
    const { status } = await request(app)
      .get(`/assets/${assetId}/ocr`)
      .set(asBearerAuth(other.accessToken));
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
    const { status } = await request(app)
      .get('/assets/not-a-uuid/ocr')
      .set(asBearerAuth(owner.accessToken));
    expect(status).toBe(400);
  });
});
