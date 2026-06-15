import { LoginResponseDto } from '@immich/sdk';
import { createUserDto, uuidDto } from 'src/fixtures';
import { app, asBearerAuth, utils } from 'src/utils';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

describe('/admin/users/:id/library-manifest', () => {
  let admin: LoginResponseDto;
  let nonAdmin: LoginResponseDto;

  beforeAll(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup({ onboarding: false });
    nonAdmin = await utils.userSetup(admin.accessToken, createUserDto.user1);
    await utils.createAsset(admin.accessToken);
  });

  it('requires authentication (401)', async () => {
    const { status } = await request(app).get(`/admin/users/${admin.userId}/library-manifest`);
    expect(status).toBe(401);
  });

  it('requires admin (403)', async () => {
    const { status } = await request(app)
      .get(`/admin/users/${admin.userId}/library-manifest`)
      .set(asBearerAuth(nonAdmin.accessToken));
    expect(status).toBe(403);
  });

  it('returns 404 for a non-existent user', async () => {
    const { status } = await request(app)
      .get(`/admin/users/${uuidDto.notFound}/library-manifest`)
      .set(asBearerAuth(admin.accessToken));
    expect(status).toBe(404);
  });

  it('returns the manifest for the admin (200)', async () => {
    const { status, body } = await request(app)
      .get(`/admin/users/${admin.userId}/library-manifest`)
      .set(asBearerAuth(admin.accessToken));
    expect(status).toBe(200);
    expect(body.manifestSchemaVersion).toBe(1);
    expect(body.owner.id).toBe(admin.userId);
    expect(body.assets.length).toBeGreaterThanOrEqual(1);
    expect(body.assets[0].objectKey).toEqual(expect.any(String));
    expect(body.assets[0].albumIds).toEqual([]);
    expect(body.nextCursor).toBeNull();
  });

  it('rejects an invalid cursor (400)', async () => {
    const { status } = await request(app)
      .get(`/admin/users/${admin.userId}/library-manifest?cursor=not-a-uuid`)
      .set(asBearerAuth(admin.accessToken));
    expect(status).toBe(400);
  });

  it('includes owned album membership', async () => {
    const asset = await utils.createAsset(admin.accessToken);
    const album = await utils.createAlbum(admin.accessToken, { albumName: 'E2E', assetIds: [asset.id] });
    const { status, body } = await request(app)
      .get(`/admin/users/${admin.userId}/library-manifest`)
      .set(asBearerAuth(admin.accessToken));
    expect(status).toBe(200);
    expect(body.albums.map((a: { id: string }) => a.id)).toContain(album.id);
    const entry = body.assets.find((a: { assetId: string }) => a.assetId === asset.id);
    expect(entry.albumIds).toContain(album.id);
  });
});
