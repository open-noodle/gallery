import { type LoginResponseDto } from '@immich/sdk';
import { type Actor, authHeaders } from 'src/actors';
import { createUserDto } from 'src/fixtures';
import { errorDto } from 'src/responses';
import { app, asBearerAuth, utils } from 'src/utils';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

// Coverage for the fork's `PUT /assets/copy` endpoint — copies association
// metadata (favorite, albums, sidecar, sharedLinks, stack) FROM a source asset
// TO a target asset. Despite the "copy" name, this is NOT an asset duplication —
// no new asset row is created. The two assets must already exist and the caller
// must have AssetCopy permission for both via the bulk-access pattern.
//
// Service shape (asset.service.ts:255-298):
//   - requireAccess(AssetCopy, [sourceId, targetId])  → 400 if caller doesn't own BOTH
//   - 'Both assets must exist'                        → if either getForCopy returns null
//                                                       (effectively unreachable via HTTP:
//                                                        a non-existent UUID trips
//                                                        requireAccess first; this branch
//                                                        is intentionally NOT pinned here)
//   - 'Source and target id must be distinct'         → if sourceId === targetId
//   - Each opt-in flag (albums/sharedLinks/stack/favorite/sidecar) defaults to true
//
// T26 pins the access matrix, the two BadRequest branches, and two side-effect
// happy paths (favorite + album). Stack and shared-link copy are deferred — they
// would need a stack fixture and a shared-link fixture respectively, which is
// more setup than the T26 scope justifies.

describe('PUT /assets/copy', () => {
  let admin: LoginResponseDto;
  let owner: LoginResponseDto;
  let other: LoginResponseDto;
  const anonActor: Actor = { id: 'anon' };

  beforeAll(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup({ onboarding: false });
    [owner, other] = await Promise.all([
      utils.userSetup(admin.accessToken, createUserDto.create('t26-owner')),
      utils.userSetup(admin.accessToken, createUserDto.create('t26-other')),
    ]);
  });

  // Per-test asset creation — each happy-path mutation needs fresh assets so
  // state from one test never leaks into another.
  const createOwnerPair = async () => {
    const [a, b] = await Promise.all([utils.createAsset(owner.accessToken), utils.createAsset(owner.accessToken)]);
    return [a.id, b.id] as const;
  };

  it('requires authentication', async () => {
    const [sourceId, targetId] = await createOwnerPair();
    const { status, body } = await request(app)
      .put('/assets/copy')
      .set(authHeaders(anonActor))
      .send({ sourceId, targetId });
    expect(status).toBe(401);
    expect(body).toEqual(errorDto.unauthorized);
  });

  it('rejects sourceId === targetId with 400', async () => {
    const [sourceId] = await createOwnerPair();
    const { status, body } = await request(app)
      .put('/assets/copy')
      .set(asBearerAuth(owner.accessToken))
      .send({ sourceId, targetId: sourceId });
    expect(status).toBe(400);
    expect(body).toEqual(errorDto.badRequest('Source and target id must be distinct'));
  });

  it('rejects a non-existent source with 400', async () => {
    const [, targetId] = await createOwnerPair();
    // requireAccess fails first because the bogus UUID isn't in the caller's
    // accessible set — the response is the bulk-access "no permission" 400, not
    // 'Both assets must exist'. Pin that taxonomy explicitly.
    const { status, body } = await request(app)
      .put('/assets/copy')
      .set(asBearerAuth(owner.accessToken))
      .send({ sourceId: '00000000-0000-4000-a000-000000000099', targetId });
    expect(status).toBe(400);
    expect(body).toEqual(errorDto.noPermission);
  });

  it('rejects a non-existent target with 400', async () => {
    const [sourceId] = await createOwnerPair();
    const { status, body } = await request(app)
      .put('/assets/copy')
      .set(asBearerAuth(owner.accessToken))
      .send({ sourceId, targetId: '00000000-0000-4000-a000-000000000099' });
    expect(status).toBe(400);
    expect(body).toEqual(errorDto.noPermission);
  });

  it('rejects a malformed sourceId with 400 (DTO validation)', async () => {
    const [, targetId] = await createOwnerPair();
    const { status } = await request(app)
      .put('/assets/copy')
      .set(asBearerAuth(owner.accessToken))
      .send({ sourceId: 'not-a-uuid', targetId });
    expect(status).toBe(400);
  });

  it('non-owner of source returns 400 (bulk-access pattern)', async () => {
    // `other` owns the target but not the source. The bulk-access check requires
    // ownership of BOTH ids — this fails on the source.
    const [sourceId] = await createOwnerPair();
    const otherAsset = await utils.createAsset(other.accessToken);
    const { status, body } = await request(app)
      .put('/assets/copy')
      .set(asBearerAuth(other.accessToken))
      .send({ sourceId, targetId: otherAsset.id });
    expect(status).toBe(400);
    expect(body).toEqual(errorDto.noPermission);
  });

  it('non-owner of target returns 400 (bulk-access pattern)', async () => {
    // `other` owns the source but not the target — same access check, opposite side.
    const otherAsset = await utils.createAsset(other.accessToken);
    const [, targetId] = await createOwnerPair();
    const { status, body } = await request(app)
      .put('/assets/copy')
      .set(asBearerAuth(other.accessToken))
      .send({ sourceId: otherAsset.id, targetId });
    expect(status).toBe(400);
    expect(body).toEqual(errorDto.noPermission);
  });

  it("admin copying between two of another user's assets returns 400 (no admin override)", async () => {
    // Permission.AssetCopy goes through the same bulk-access pattern as
    // AssetRead — admins do NOT get a blanket override. Pinned to defend
    // against a future "admin can do anything" refactor.
    //
    // This test also doubles as the "caller owns NEITHER source nor target" case —
    // admin owns neither asset since both belong to `owner`. No need for a
    // separate "case D" test.
    const [sourceId, targetId] = await createOwnerPair();
    const { status, body } = await request(app)
      .put('/assets/copy')
      .set(asBearerAuth(admin.accessToken))
      .send({ sourceId, targetId });
    expect(status).toBe(400);
    expect(body).toEqual(errorDto.noPermission);
  });

  it('owner can copy: favorite is propagated source → target', async () => {
    const [sourceId, targetId] = await createOwnerPair();

    // Set source favorite=true; target stays default false.
    const fav = await request(app)
      .put(`/assets/${sourceId}`)
      .set(asBearerAuth(owner.accessToken))
      .send({ isFavorite: true });
    expect(fav.status).toBe(200);

    // Sanity: target is NOT favorite before the copy.
    const before = await request(app).get(`/assets/${targetId}`).set(asBearerAuth(owner.accessToken));
    expect((before.body as { isFavorite: boolean }).isFavorite).toBe(false);

    const copy = await request(app)
      .put('/assets/copy')
      .set(asBearerAuth(owner.accessToken))
      .send({ sourceId, targetId });
    expect(copy.status).toBe(204);

    // Target is now favorite (default favorite flag is true).
    const after = await request(app).get(`/assets/${targetId}`).set(asBearerAuth(owner.accessToken));
    expect((after.body as { isFavorite: boolean }).isFavorite).toBe(true);

    // Source is unchanged — copy is not a move.
    const sourceAfter = await request(app).get(`/assets/${sourceId}`).set(asBearerAuth(owner.accessToken));
    expect((sourceAfter.body as { isFavorite: boolean }).isFavorite).toBe(true);
  });

  it('favorite=false opt-out skips the favorite copy', async () => {
    const [sourceId, targetId] = await createOwnerPair();

    await request(app).put(`/assets/${sourceId}`).set(asBearerAuth(owner.accessToken)).send({ isFavorite: true });

    // Sanity-read: target starts as not-favorite, so a working copy WOULD flip it
    // to true. The opt-out below is the only thing that should prevent that.
    const before = await request(app).get(`/assets/${targetId}`).set(asBearerAuth(owner.accessToken));
    expect((before.body as { isFavorite: boolean }).isFavorite).toBe(false);

    const copy = await request(app)
      .put('/assets/copy')
      .set(asBearerAuth(owner.accessToken))
      .send({ sourceId, targetId, favorite: false });
    expect(copy.status).toBe(204);

    const after = await request(app).get(`/assets/${targetId}`).set(asBearerAuth(owner.accessToken));
    expect((after.body as { isFavorite: boolean }).isFavorite).toBe(false);
  });

  it('owner can copy: album associations are propagated source → target', async () => {
    const [sourceId, targetId] = await createOwnerPair();

    const album = await utils.createAlbum(owner.accessToken, {
      albumName: 't26-album',
      assetIds: [sourceId],
    });

    // Sanity: target is NOT in the album before the copy.
    const before = await request(app)
      .get(`/albums/${album.id}?withoutAssets=false`)
      .set(asBearerAuth(owner.accessToken));
    const beforeIds = (before.body as { assets: Array<{ id: string }> }).assets.map((a) => a.id);
    expect(beforeIds).toContain(sourceId);
    expect(beforeIds).not.toContain(targetId);

    const copy = await request(app)
      .put('/assets/copy')
      .set(asBearerAuth(owner.accessToken))
      .send({ sourceId, targetId });
    expect(copy.status).toBe(204);

    const after = await request(app)
      .get(`/albums/${album.id}?withoutAssets=false`)
      .set(asBearerAuth(owner.accessToken));
    const afterIds = (after.body as { assets: Array<{ id: string }> }).assets.map((a) => a.id);
    expect(afterIds).toContain(sourceId);
    expect(afterIds).toContain(targetId);
  });

  it('albums=false opt-out skips the album copy', async () => {
    const [sourceId, targetId] = await createOwnerPair();

    const album = await utils.createAlbum(owner.accessToken, {
      albumName: 't26-album-optout',
      assetIds: [sourceId],
    });

    // Sanity-read: target is NOT in the album, so a working copy WOULD add it.
    // The opt-out below is the only thing that should prevent that.
    const before = await request(app)
      .get(`/albums/${album.id}?withoutAssets=false`)
      .set(asBearerAuth(owner.accessToken));
    const beforeIds = (before.body as { assets: Array<{ id: string }> }).assets.map((a) => a.id);
    expect(beforeIds).toContain(sourceId);
    expect(beforeIds).not.toContain(targetId);

    const copy = await request(app)
      .put('/assets/copy')
      .set(asBearerAuth(owner.accessToken))
      .send({ sourceId, targetId, albums: false });
    expect(copy.status).toBe(204);

    const after = await request(app)
      .get(`/albums/${album.id}?withoutAssets=false`)
      .set(asBearerAuth(owner.accessToken));
    const afterIds = (after.body as { assets: Array<{ id: string }> }).assets.map((a) => a.id);
    expect(afterIds).not.toContain(targetId);
  });
});
