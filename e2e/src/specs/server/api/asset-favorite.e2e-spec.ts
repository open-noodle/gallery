import { AlbumUserRole, AssetMediaResponseDto, LoginResponseDto, SharedLinkType, SharedSpaceRole } from '@immich/sdk';
import { randomUUID } from 'node:crypto';
import { addPartner } from 'src/actors';
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

// Shared across every describe in this file so the access-lifecycle suite below (#763 slice 4)
// can reuse the same admin session without re-running resetDatabase (which would wipe the
// order-dependent alice/bob/carol state above).
let admin: LoginResponseDto;

describe('PUT /assets/favorites (#763 per-user favorites)', () => {
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

    const bobInfo = await utils.getAssetInfo(bob.accessToken, assetX.id);
    expect(bobInfo.isFavorite).toBe(true);
    const aliceInfo = await utils.getAssetInfo(alice.accessToken, assetX.id);
    expect(aliceInfo.isFavorite).toBe(false);
  });

  it("the owner favoriting/unfavoriting their own asset never touches a member's independent favorite row (E2)", async () => {
    // Alice (the owner) favorites the same asset Bob favorited above — an independent fact.
    let res = await putFavorites(alice.accessToken, { ids: [assetX.id], isFavorite: true });
    expect(res.status).toBe(204);
    let aliceInfo = await utils.getAssetInfo(alice.accessToken, assetX.id);
    expect(aliceInfo.isFavorite).toBe(true);
    let bobInfo = await utils.getAssetInfo(bob.accessToken, assetX.id);
    expect(bobInfo.isFavorite).toBe(true);

    // Alice unfavorites — Bob's row must survive untouched.
    res = await putFavorites(alice.accessToken, { ids: [assetX.id], isFavorite: false });
    expect(res.status).toBe(204);
    aliceInfo = await utils.getAssetInfo(alice.accessToken, assetX.id);
    expect(aliceInfo.isFavorite).toBe(false);
    bobInfo = await utils.getAssetInfo(bob.accessToken, assetX.id);
    expect(bobInfo.isFavorite).toBe(true);
  });

  it('a non-member cannot favorite an asset they cannot read; no row is created (E5)', async () => {
    const { status, body } = await putFavorites(carol.accessToken, { ids: [assetX.id], isFavorite: true });
    // requireAccess(AssetRead) denial → BadRequestException, the same convention as every other
    // asset-access guard in this codebase (e.g. asset.e2e-spec.ts:541 "Not found or no asset.delete
    // access") — not a literal 403.
    expect(status).toBe(400);
    expect(body.message).toMatch(/asset\.read access/);

    // Carol never had read access, so assert via the owner that nothing changed.
    const aliceInfo = await utils.getAssetInfo(alice.accessToken, assetX.id);
    expect(aliceInfo.isFavorite).toBe(false);
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

    const aliceInfo = await utils.getAssetInfo(alice.accessToken, assetX.id);
    expect(aliceInfo.isFavorite).toBe(false);
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

    const adminInfo = await utils.getAssetInfo(admin.accessToken, assetX.id);
    expect(adminInfo.isFavorite).toBe(true);
    // The asset owner's row is untouched by the elevated-session caller's write.
    const aliceInfo = await utils.getAssetInfo(alice.accessToken, assetX.id);
    expect(aliceInfo.isFavorite).toBe(false);
  });

  it('favoriting an already-favorited asset is a no-op, not a 500 (E8)', async () => {
    const first = await putFavorites(bob.accessToken, { ids: [assetX.id], isFavorite: true });
    expect(first.status).toBe(204);

    const second = await putFavorites(bob.accessToken, { ids: [assetX.id], isFavorite: true });
    expect(second.status).toBe(204);

    const bobInfo = await utils.getAssetInfo(bob.accessToken, assetX.id);
    expect(bobInfo.isFavorite).toBe(true);
  });

  it('unfavoriting an asset the caller never favorited is a no-op, not a 404 (E9)', async () => {
    const assetY = await utils.createAsset(alice.accessToken);
    await utils.addSpaceAssets(alice.accessToken, spaceId, [assetY.id]);

    const { status } = await putFavorites(bob.accessToken, { ids: [assetY.id], isFavorite: false });
    expect(status).toBe(204);
    const bobInfo = await utils.getAssetInfo(bob.accessToken, assetY.id);
    expect(bobInfo.isFavorite).toBe(false);
  });

  it('the deprecated PUT /assets/:id isFavorite alias produces the identical result as the canonical endpoint, for the owner (E17)', async () => {
    const assetZ = await utils.createAsset(alice.accessToken);

    const { status, body } = await singleUpdateAsset(alice.accessToken, assetZ.id, { isFavorite: true });
    expect(status).toBe(200);
    expect(body.isFavorite).toBe(true);

    const aliceInfo = await utils.getAssetInfo(alice.accessToken, assetZ.id);
    expect(aliceInfo.isFavorite).toBe(true);
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

    const bobInfo = await utils.getAssetInfo(bob.accessToken, assetW.id);
    expect(bobInfo.isFavorite).toBe(true);
    const aliceInfo = await utils.getAssetInfo(alice.accessToken, assetW.id);
    expect(aliceInfo.isFavorite).toBe(false);
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

    const bobInfo = await utils.getAssetInfo(bob.accessToken, assetV.id);
    expect(bobInfo.isFavorite).toBe(true);
    const aliceInfo = await utils.getAssetInfo(alice.accessToken, assetV.id);
    expect(aliceInfo.isFavorite).toBe(false);
  });
});

// #763 slice 4 — favorite rows are per (user, asset) and independent of the access-granting
// relationship (space membership, album share, partner share). Losing access must hide the
// favorite from listings and from the individual asset read (§8.1's 400-not-403 convention),
// but must NEVER delete the row: regaining access re-derives the same isFavorite=true with no
// new write. See docs/superpowers/specs/2026-07-20-per-user-favorites-design.md §5.2.
//
// Uses only its own fresh users (dave/erin/frank/grace) — the describe above is order-dependent
// on alice/bob/carol and must not be touched.
describe('favorite rows survive access loss and re-derive on read (#763 slice 4)', () => {
  let dave: LoginResponseDto; // owns space2 + all assets here
  let erin: LoginResponseDto; // space viewer / album recipient
  let space2Id: string;
  let assetY: AssetMediaResponseDto; // in space2
  let assetZ: AssetMediaResponseDto; // album-shared only
  let albumId: string;

  const erinFavoriteBucketTotal = async () => {
    const { body } = await request(app)
      .get('/timeline/buckets?visibility=timeline&withSharedSpaces=true&isFavorite=true')
      .set(asBearerAuth(erin.accessToken));
    return (body as Array<{ count: number }>).reduce((acc, b) => acc + b.count, 0);
  };

  beforeAll(async () => {
    [dave, erin] = await Promise.all([
      utils.userSetup(admin.accessToken, createUserDto.create('fav-dave')),
      utils.userSetup(admin.accessToken, createUserDto.create('fav-erin')),
    ]);
    const space = await utils.createSpace(dave.accessToken, { name: 'fav-lifecycle-space' });
    space2Id = space.id;
    await utils.addSpaceMember(dave.accessToken, space2Id, { userId: erin.userId, role: SharedSpaceRole.Viewer });
    [assetY, assetZ] = await Promise.all([utils.createAsset(dave.accessToken), utils.createAsset(dave.accessToken)]);
    await utils.addSpaceAssets(dave.accessToken, space2Id, [assetY.id]);
    await request(app)
      .put('/assets/favorites')
      .set(asBearerAuth(erin.accessToken))
      .send({ ids: [assetY.id], isFavorite: true });
  });

  it('member leaves the space → favorite drops out of listings; rejoining restores it without re-favoriting (E10, E11)', async () => {
    expect(await erinFavoriteBucketTotal()).toBe(1);

    // Remove erin from the space — same endpoint as shared-space.e2e-spec.ts's
    // "DELETE /shared-spaces/:id/members/:userId" ('should remove a member from a space').
    const removal = await request(app)
      .delete(`/shared-spaces/${space2Id}/members/${erin.userId}`)
      .set(asBearerAuth(dave.accessToken));
    expect(removal.status).toBe(204);

    expect(await erinFavoriteBucketTotal()).toBe(0);
    // Row persisted but unreadable — the asset itself is also gone for erin:
    const getAfterRemoval = await request(app).get(`/assets/${assetY.id}`).set(asBearerAuth(erin.accessToken));
    expect(getAfterRemoval.status).toBe(400);

    // Re-add erin — the favorite reappears with NO new favorite write.
    await utils.addSpaceMember(dave.accessToken, space2Id, { userId: erin.userId, role: SharedSpaceRole.Viewer });
    expect(await erinFavoriteBucketTotal()).toBe(1);
    const erinInfo = await utils.getAssetInfo(erin.accessToken, assetY.id);
    expect(erinInfo.isFavorite).toBe(true);
  });

  it('a trashed favorited asset leaves the favorites timeline and returns on restore', async () => {
    await utils.deleteAssets(dave.accessToken, [assetY.id]); // trash, not permanent
    expect(await erinFavoriteBucketTotal()).toBe(0);

    // Restore from trash — same endpoint as trash.e2e-spec.ts's "POST /trash/restore/assets".
    const restore = await request(app)
      .post('/trash/restore/assets')
      .set(asBearerAuth(dave.accessToken))
      .send({ ids: [assetY.id] });
    expect(restore.status).toBe(200);

    expect(await erinFavoriteBucketTotal()).toBe(1);
    const erinInfo = await utils.getAssetInfo(erin.accessToken, assetY.id);
    expect(erinInfo.isFavorite).toBe(true);
  });

  it('album unshare hides the favorite; re-share restores it (E29)', async () => {
    // Share an album containing assetZ with erin, erin favorites it (AssetRead via album — the
    // slice-2 access widening), then unshare and re-share.
    // NOTE the pinned semantics: album-shared favorites do NOT appear in the withSharedSpaces
    // favorites timeline (albums are not a timeline scope) — visibility of the favorite is
    // asserted via getAssetInfo, and absence stays absent throughout.
    const album = await utils.createAlbum(dave.accessToken, {
      albumName: 'fav-lifecycle-album',
      assetIds: [assetZ.id],
      albumUsers: [{ userId: erin.userId, role: AlbumUserRole.Viewer }],
    });
    albumId = album.id;

    await request(app)
      .put('/assets/favorites')
      .set(asBearerAuth(erin.accessToken))
      .send({ ids: [assetZ.id], isFavorite: true });
    const erinInfoBeforeRemoval = await utils.getAssetInfo(erin.accessToken, assetZ.id);
    expect(erinInfoBeforeRemoval.isFavorite).toBe(true);

    // Remove erin from the album — same endpoint as album.e2e-spec.ts's "DELETE :id/user/:userId".
    const removal = await request(app)
      .delete(`/albums/${albumId}/user/${erin.userId}`)
      .set(asBearerAuth(dave.accessToken));
    expect(removal.status).toBe(204);

    const getAfterRemoval = await request(app).get(`/assets/${assetZ.id}`).set(asBearerAuth(erin.accessToken));
    expect(getAfterRemoval.status).toBe(400);

    // Re-add erin to the album — same endpoint as album.e2e-spec.ts's "PUT :id/users".
    const readd = await request(app)
      .put(`/albums/${albumId}/users`)
      .set(asBearerAuth(dave.accessToken))
      .send({ albumUsers: [{ userId: erin.userId, role: AlbumUserRole.Viewer }] });
    expect(readd.status).toBe(200);

    const erinInfoAfterReadd = await utils.getAssetInfo(erin.accessToken, assetZ.id);
    expect(erinInfoAfterReadd.isFavorite).toBe(true); // row survived
  });

  it('partner revoke hides partner favorites; re-adding restores them (E30)', async () => {
    const [frank, grace] = await Promise.all([
      utils.userSetup(admin.accessToken, createUserDto.create('fav-frank')),
      utils.userSetup(admin.accessToken, createUserDto.create('fav-grace')),
    ]);
    const frankAsset = await utils.createAsset(frank.accessToken);

    const graceFavoriteBucketTotal = async () => {
      const { body } = await request(app)
        .get('/timeline/buckets?visibility=timeline&withPartners=true&isFavorite=true')
        .set(asBearerAuth(grace.accessToken));
      return (body as Array<{ count: number }>).reduce((acc, b) => acc + b.count, 0);
    };

    // frank shares with grace (grace = recipient, inTimeline enabled — actors.ts:111-118's
    // addPartner helper).
    await addPartner(
      { token: frank.accessToken, userId: frank.userId },
      { token: grace.accessToken, userId: grace.userId },
    );

    await request(app)
      .put('/assets/favorites')
      .set(asBearerAuth(grace.accessToken))
      .send({ ids: [frankAsset.id], isFavorite: true });
    expect(await graceFavoriteBucketTotal()).toBe(1);

    // Revoke: the sharer (frank) removes the partnership addressed to the recipient (grace) —
    // same endpoint as partner.e2e-spec.ts's "DELETE /partners/:id".
    const revoke = await request(app).delete(`/partners/${grace.userId}`).set(asBearerAuth(frank.accessToken));
    expect(revoke.status).toBe(204);

    expect(await graceFavoriteBucketTotal()).toBe(0);
    const getAfterRevoke = await request(app).get(`/assets/${frankAsset.id}`).set(asBearerAuth(grace.accessToken));
    expect(getAfterRevoke.status).toBe(400);

    // Re-add + re-enable inTimeline — no new favorite write.
    await addPartner(
      { token: frank.accessToken, userId: frank.userId },
      { token: grace.accessToken, userId: grace.userId },
    );

    expect(await graceFavoriteBucketTotal()).toBe(1);
    const graceInfo = await utils.getAssetInfo(grace.accessToken, frankAsset.id);
    expect(graceInfo.isFavorite).toBe(true);
  });
});
