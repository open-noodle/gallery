import { AssetMediaResponseDto, LoginResponseDto, SharedLinkType, SharedSpaceRole } from '@immich/sdk';
import { randomUUID } from 'node:crypto';
import { createUserDto } from 'src/fixtures';
import { app, asBearerAuth, utils } from 'src/utils';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

// #763 slice 2 — canonical PUT /assets/favorites + the deprecated PUT /assets/:id / PUT /assets
// `isFavorite` alias.
//
// See docs/superpowers/specs/2026-07-20-per-user-favorites-design.md §5.1, §8.1 and
// docs/superpowers/plans/2026-07-20-per-user-favorites-slice-2.md Task 2.
//
// Favorites are per (user, asset): the canonical endpoint gates on Permission.AssetRead, which
// resolves own assets, shared-space assets at ANY role including viewer, shared-album assets, and
// partner-shared assets — a deliberate widening vs. the deprecated alias's Permission.AssetUpdate
// gate (owner or space EDITOR only, utils/access.ts:155-159), which stays viewer-closed on purpose:
// §8.1 requires the alias never be MORE permissive than the canonical endpoint.

const putFavorites = (token: string, body: Record<string, unknown>) =>
  request(app).put('/assets/favorites').set('Authorization', `Bearer ${token}`).send(body);

const singleUpdateAsset = (token: string, id: string, body: Record<string, unknown>) =>
  request(app).put(`/assets/${id}`).set('Authorization', `Bearer ${token}`).send(body);

describe('PUT /assets/favorites (#763 per-user favorites)', () => {
  let admin: LoginResponseDto;
  let alice: LoginResponseDto; // space owner; owns every asset in this suite
  let bob: LoginResponseDto; // space VIEWER — never owns anything
  let carol: LoginResponseDto; // non-member — no relationship to the space at all

  let spaceId: string;
  let assetX: AssetMediaResponseDto;

  beforeAll(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup();
    [alice, bob, carol] = await Promise.all([
      utils.userSetup(admin.accessToken, createUserDto.create('fav-alice')),
      utils.userSetup(admin.accessToken, createUserDto.create('fav-bob')),
      utils.userSetup(admin.accessToken, createUserDto.create('fav-carol')),
    ]);

    const space = await utils.createSpace(alice.accessToken, { name: 'fav-space' });
    spaceId = space.id;
    await utils.addSpaceMember(alice.accessToken, spaceId, { userId: bob.userId, role: SharedSpaceRole.Viewer });

    assetX = await utils.createAsset(alice.accessToken);
    await utils.addSpaceAssets(alice.accessToken, spaceId, [assetX.id]);
  });

  it("a space VIEWER can favorite an asset they only have read access to; the owner's view is unaffected (E3)", async () => {
    const { status } = await putFavorites(bob.accessToken, { ids: [assetX.id], isFavorite: true });
    expect(status).toBe(204);

    expect((await utils.getAssetInfo(bob.accessToken, assetX.id)).isFavorite).toBe(true);
    expect((await utils.getAssetInfo(alice.accessToken, assetX.id)).isFavorite).toBe(false);
  });

  it("the owner favoriting/unfavoriting their own asset never touches a member's independent favorite row (E2)", async () => {
    // Alice (the owner) favorites the same asset Bob favorited above — an independent fact.
    let res = await putFavorites(alice.accessToken, { ids: [assetX.id], isFavorite: true });
    expect(res.status).toBe(204);
    expect((await utils.getAssetInfo(alice.accessToken, assetX.id)).isFavorite).toBe(true);
    expect((await utils.getAssetInfo(bob.accessToken, assetX.id)).isFavorite).toBe(true);

    // Alice unfavorites — Bob's row must survive untouched.
    res = await putFavorites(alice.accessToken, { ids: [assetX.id], isFavorite: false });
    expect(res.status).toBe(204);
    expect((await utils.getAssetInfo(alice.accessToken, assetX.id)).isFavorite).toBe(false);
    expect((await utils.getAssetInfo(bob.accessToken, assetX.id)).isFavorite).toBe(true);
  });

  it('a non-member cannot favorite an asset they cannot read; no row is created (E5)', async () => {
    const { status, body } = await putFavorites(carol.accessToken, { ids: [assetX.id], isFavorite: true });
    // requireAccess(AssetRead) denial → BadRequestException, the same convention as every other
    // asset-access guard in this codebase (e.g. asset.e2e-spec.ts:541 "Not found or no asset.delete
    // access") — not a literal 403.
    expect(status).toBe(400);
    expect(body.message).toMatch(/asset\.read access/);

    // Carol never had read access, so assert via the owner that nothing changed.
    expect((await utils.getAssetInfo(alice.accessToken, assetX.id)).isFavorite).toBe(false);
  });

  it('a shared-link session is rejected outright; no row is created for the link owner (E6)', async () => {
    const sharedLink = await utils.createSharedLink(alice.accessToken, {
      type: SharedLinkType.Individual,
      assetIds: [assetX.id],
    });

    // No Authorization header — only the share key, exactly like the read-side shared-link tests.
    const { status } = await request(app)
      .put(`/assets/favorites?key=${sharedLink.key}`)
      .send({ ids: [assetX.id], isFavorite: true });
    // This route never declares `sharedLink: true`, so AuthGuard rejects a share-key-only request
    // before the service is reached. The explicit `auth.sharedLink` guard inside updateFavorites
    // (§5.1) is defense-in-depth for if that route metadata is ever loosened to match the read-side
    // GET /assets/:id (which does declare `sharedLink: true`).
    expect(status).toBe(403);

    expect((await utils.getAssetInfo(alice.accessToken, assetX.id)).isFavorite).toBe(false);
  });

  it("elevated session permission does not widen the favorite subject — only the caller's own row is created (E7)", async () => {
    await utils.addSpaceMember(alice.accessToken, spaceId, { userId: admin.userId, role: SharedSpaceRole.Viewer });

    await request(app).post('/auth/pin-code').set(asBearerAuth(admin.accessToken)).send({ pinCode: '445566' });
    const unlock = await request(app)
      .post('/auth/session/unlock')
      .set(asBearerAuth(admin.accessToken))
      .send({ pinCode: '445566' });
    expect(unlock.status).toBe(204);

    const { status } = await putFavorites(admin.accessToken, { ids: [assetX.id], isFavorite: true });
    expect(status).toBe(204);

    expect((await utils.getAssetInfo(admin.accessToken, assetX.id)).isFavorite).toBe(true);
    // The asset owner's row is untouched by the elevated-session caller's write.
    expect((await utils.getAssetInfo(alice.accessToken, assetX.id)).isFavorite).toBe(false);
  });

  it('favoriting an already-favorited asset is a no-op, not a 500 (E8)', async () => {
    const first = await putFavorites(bob.accessToken, { ids: [assetX.id], isFavorite: true });
    expect(first.status).toBe(204);

    const second = await putFavorites(bob.accessToken, { ids: [assetX.id], isFavorite: true });
    expect(second.status).toBe(204);

    expect((await utils.getAssetInfo(bob.accessToken, assetX.id)).isFavorite).toBe(true);
  });

  it('unfavoriting an asset the caller never favorited is a no-op, not a 404 (E9)', async () => {
    const assetY = await utils.createAsset(alice.accessToken);
    await utils.addSpaceAssets(alice.accessToken, spaceId, [assetY.id]);

    const { status } = await putFavorites(bob.accessToken, { ids: [assetY.id], isFavorite: false });
    expect(status).toBe(204);
    expect((await utils.getAssetInfo(bob.accessToken, assetY.id)).isFavorite).toBe(false);
  });

  it('the deprecated PUT /assets/:id isFavorite alias produces the identical result as the canonical endpoint, for the owner (E17)', async () => {
    const assetZ = await utils.createAsset(alice.accessToken);

    const { status, body } = await singleUpdateAsset(alice.accessToken, assetZ.id, { isFavorite: true });
    expect(status).toBe(200);
    expect(body.isFavorite).toBe(true);

    expect((await utils.getAssetInfo(alice.accessToken, assetZ.id)).isFavorite).toBe(true);
  });

  it('the deprecated alias STILL rejects a space VIEWER while the canonical endpoint succeeds — the alias never widens access (E18 vs E3)', async () => {
    const assetW = await utils.createAsset(alice.accessToken);
    await utils.addSpaceAssets(alice.accessToken, spaceId, [assetW.id]);

    const aliasAttempt = await singleUpdateAsset(bob.accessToken, assetW.id, { isFavorite: true });
    // Bob has AssetRead via the space (Viewer) but the alias requires Permission.AssetUpdate
    // (owner or space EDITOR only) — Bob is neither, so requireAccess(AssetUpdate) denies him.
    expect(aliasAttempt.status).toBe(400);
    expect(aliasAttempt.body.message).toMatch(/asset\.update access/);

    const canonicalAttempt = await putFavorites(bob.accessToken, { ids: [assetW.id], isFavorite: true });
    expect(canonicalAttempt.status).toBe(204);

    expect((await utils.getAssetInfo(bob.accessToken, assetW.id)).isFavorite).toBe(true);
    expect((await utils.getAssetInfo(alice.accessToken, assetW.id)).isFavorite).toBe(false);
  });

  it('an empty ids array is rejected by schema validation (min(1)), not treated as a silent no-op', async () => {
    const { status } = await putFavorites(alice.accessToken, { ids: [], isFavorite: true });
    expect(status).toBe(400);
  });

  it('an oversized ids array is rejected with a bounded 400, not accepted unbounded (E28)', async () => {
    const ids = Array.from({ length: 1001 }, () => randomUUID());
    const { status } = await putFavorites(alice.accessToken, { ids, isFavorite: true });
    expect(status).toBe(400);
  });

  it('a nonexistent asset id is rejected, never a 500', async () => {
    const { status } = await putFavorites(alice.accessToken, { ids: [randomUUID()], isFavorite: true });
    expect(status).toBe(400);
  });

  it('no request field can name another user as the favorite subject — the subject is always the caller (E4)', async () => {
    const assetV = await utils.createAsset(alice.accessToken);
    await utils.addSpaceAssets(alice.accessToken, spaceId, [assetV.id]);

    // Bob attempts to smuggle Alice's id in as an extra field. Whether the schema silently drops
    // the unknown key or not, the write must be attributed to Bob (the caller) — never Alice.
    const { status } = await putFavorites(bob.accessToken, {
      ids: [assetV.id],
      isFavorite: true,
      userId: alice.userId,
    });
    expect(status).toBe(204);

    expect((await utils.getAssetInfo(bob.accessToken, assetV.id)).isFavorite).toBe(true);
    expect((await utils.getAssetInfo(alice.accessToken, assetV.id)).isFavorite).toBe(false);
  });
});
