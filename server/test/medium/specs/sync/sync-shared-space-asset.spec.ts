import { Kysely } from 'kysely';
import { SharedSpaceRole, SyncEntityType, SyncRequestType } from 'src/enum';
import { AssetFavoriteRepository } from 'src/repositories/asset-favorite.repository';
import { DB } from 'src/schema';
import { SyncTestContext } from 'test/medium.factory';
import { getKyselyDB, wait } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = async (db?: Kysely<DB>) => {
  const ctx = new SyncTestContext(db || defaultDatabase);
  const { auth, user, session } = await ctx.newSyncAuthUser();
  return { auth, user, session, ctx };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(SyncRequestType.SharedSpaceAssetsV1, () => {
  it("emits an asset added to the current user's own space", async () => {
    const { auth, ctx } = await setup();
    const { space } = await ctx.newSharedSpace({ createdById: auth.user.id });
    await ctx.newSharedSpaceMember({
      spaceId: space.id,
      userId: auth.user.id,
      role: SharedSpaceRole.Owner,
    });
    const { asset } = await ctx.newAsset({ ownerId: auth.user.id });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });

    const response = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAssetsV1]);
    const assetEvents = response.filter(
      (r: { type: string }) =>
        r.type === SyncEntityType.SharedSpaceAssetCreateV1 || r.type === SyncEntityType.SharedSpaceAssetUpdateV1,
    );
    expect(assetEvents).toHaveLength(1);
    expect((assetEvents[0] as { data: { id: string } }).data.id).toBe(asset.id);
  });

  it('emits a foreign-owned asset to a member who is not the asset owner', async () => {
    const { auth, ctx } = await setup();
    const { user: peer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: peer.id });
    await ctx.newSharedSpaceMember({
      spaceId: space.id,
      userId: peer.id,
      role: SharedSpaceRole.Owner,
    });
    await ctx.newSharedSpaceMember({
      spaceId: space.id,
      userId: auth.user.id,
      role: SharedSpaceRole.Editor,
    });
    const { asset } = await ctx.newAsset({ ownerId: peer.id });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });

    const response = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAssetsV1]);
    const assetEvents = response.filter(
      (r: { type: string }) =>
        r.type === SyncEntityType.SharedSpaceAssetCreateV1 || r.type === SyncEntityType.SharedSpaceAssetUpdateV1,
    );
    expect(assetEvents).toHaveLength(1);
    expect((assetEvents[0] as { data: { id: string; ownerId: string } }).data).toMatchObject({
      id: asset.id,
      ownerId: peer.id,
    });
  });

  it('does not emit assets from spaces the user has no access to', async () => {
    const { auth, ctx } = await setup();
    const { user: stranger } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: stranger.id });
    await ctx.newSharedSpaceMember({
      spaceId: space.id,
      userId: stranger.id,
      role: SharedSpaceRole.Owner,
    });
    const { asset } = await ctx.newAsset({ ownerId: stranger.id });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });

    const response = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAssetsV1]);
    const assetEvents = response.filter(
      (r: { type: string }) =>
        r.type === SyncEntityType.SharedSpaceAssetCreateV1 || r.type === SyncEntityType.SharedSpaceAssetUpdateV1,
    );
    expect(assetEvents).toHaveLength(0);
  });

  it('emits an asset row once per (space, asset) pair when an asset is in multiple accessible spaces', async () => {
    const { auth, ctx } = await setup();
    const { space: spaceA } = await ctx.newSharedSpace({ createdById: auth.user.id });
    const { space: spaceB } = await ctx.newSharedSpace({ createdById: auth.user.id });
    await ctx.newSharedSpaceMember({
      spaceId: spaceA.id,
      userId: auth.user.id,
      role: SharedSpaceRole.Owner,
    });
    await ctx.newSharedSpaceMember({
      spaceId: spaceB.id,
      userId: auth.user.id,
      role: SharedSpaceRole.Owner,
    });
    const { asset } = await ctx.newAsset({ ownerId: auth.user.id });
    await ctx.newSharedSpaceAsset({ spaceId: spaceA.id, assetId: asset.id });
    await ctx.newSharedSpaceAsset({ spaceId: spaceB.id, assetId: asset.id });

    const response = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAssetsV1]);
    const assetEvents = response.filter(
      (r: { type: string }) =>
        r.type === SyncEntityType.SharedSpaceAssetCreateV1 || r.type === SyncEntityType.SharedSpaceAssetUpdateV1,
    );
    // Per the design doc: write amplification accepted — one event per join row.
    // Mobile dedups by asset id at insert time.
    expect(assetEvents).toHaveLength(2);
    expect(assetEvents.every((e: { data: { id: string } }) => e.data.id === asset.id)).toBe(true);
  });

  it('backfills historical assets when the user is added to a pre-existing space', async () => {
    const { auth, ctx } = await setup();
    const { user: stranger } = await ctx.newUser();
    const { space: oldSpace } = await ctx.newSharedSpace({ createdById: stranger.id });
    await ctx.newSharedSpaceMember({
      spaceId: oldSpace.id,
      userId: stranger.id,
      role: SharedSpaceRole.Owner,
    });
    // Old asset added to oldSpace BEFORE auth.user has any sync activity.
    const { asset: oldAsset } = await ctx.newAsset({ ownerId: stranger.id });
    await ctx.newSharedSpaceAsset({ spaceId: oldSpace.id, assetId: oldAsset.id });
    await wait(2);
    // Auth.user gets a separate "current" space so the first sync produces a
    // non-empty upsertCheckpoint past the old asset's join-row updateId.
    const { space: currentSpace } = await ctx.newSharedSpace({ createdById: auth.user.id });
    await ctx.newSharedSpaceMember({
      spaceId: currentSpace.id,
      userId: auth.user.id,
      role: SharedSpaceRole.Owner,
    });
    const { asset: currentAsset } = await ctx.newAsset({ ownerId: auth.user.id });
    await ctx.newSharedSpaceAsset({ spaceId: currentSpace.id, assetId: currentAsset.id });

    const initial = await ctx.syncStream(auth, [SyncRequestType.SharedSpacesV1, SyncRequestType.SharedSpaceAssetsV1]);
    await ctx.syncAckAll(auth, initial);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.SharedSpacesV1, SyncRequestType.SharedSpaceAssetsV1]);

    // Auth.user joins the OLD space — gains access to historical asset.
    await ctx.newSharedSpaceMember({
      spaceId: oldSpace.id,
      userId: auth.user.id,
      role: SharedSpaceRole.Editor,
    });

    const next = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAssetsV1]);
    const backfillEvents = next.filter((r: { type: string }) => r.type === SyncEntityType.SharedSpaceAssetBackfillV1);
    expect(backfillEvents.length).toBeGreaterThanOrEqual(1);
    expect(backfillEvents.some((r: { data: { id: string } }) => r.data.id === oldAsset.id)).toBe(true);
  });

  it('re-emits an asset on the update path when its metadata changes after the initial ack', async () => {
    const { auth, ctx } = await setup();
    const { space } = await ctx.newSharedSpace({ createdById: auth.user.id });
    await ctx.newSharedSpaceMember({
      spaceId: space.id,
      userId: auth.user.id,
      role: SharedSpaceRole.Owner,
    });
    const { asset } = await ctx.newAsset({ ownerId: auth.user.id });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });

    const initial = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAssetsV1]);
    await ctx.syncAckAll(auth, initial);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.SharedSpaceAssetsV1]);

    // #763: favoriting alone does not bump asset.updateId (asset_favorite is a separate overlay
    // table — see design doc §4.3), so the raw column update below stands in for "some metadata
    // changed" to trigger the re-emit; the actual isFavorite value comes from the overlay insert.
    await defaultDatabase.updateTable('asset').set({ isFavorite: true }).where('id', '=', asset.id).execute();
    await ctx.get(AssetFavoriteRepository).addAll(auth.user.id, [asset.id]);

    const next = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAssetsV1]);
    const updateEvents = next.filter((r: { type: string }) => r.type === SyncEntityType.SharedSpaceAssetUpdateV1);
    expect(updateEvents).toHaveLength(1);
    expect((updateEvents[0] as { data: { id: string; isFavorite: boolean } }).data).toMatchObject({
      id: asset.id,
      isFavorite: true,
    });
  });

  it("does not leak the peer's favorite for a foreign-owned asset shared into the space (#763)", async () => {
    const { auth, ctx } = await setup();
    const { user: peer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: peer.id });
    await ctx.newSharedSpaceMember({
      spaceId: space.id,
      userId: peer.id,
      role: SharedSpaceRole.Owner,
    });
    await ctx.newSharedSpaceMember({
      spaceId: space.id,
      userId: auth.user.id,
      role: SharedSpaceRole.Editor,
    });
    const { asset } = await ctx.newAsset({ ownerId: peer.id });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });
    // The peer (owner) favorites their own asset — must never leak to auth's stream.
    await ctx.get(AssetFavoriteRepository).addAll(peer.id, [asset.id]);

    const response = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAssetsV1]);
    const assetEvents = response.filter(
      (r: { type: string }) =>
        r.type === SyncEntityType.SharedSpaceAssetCreateV1 || r.type === SyncEntityType.SharedSpaceAssetUpdateV1,
    );
    expect(assetEvents).toHaveLength(1);
    expect((assetEvents[0] as { data: { id: string; isFavorite: boolean } }).data).toMatchObject({
      id: asset.id,
      isFavorite: false,
    });
  });

  it("syncs the recipient's own favorite for a foreign-owned asset shared into the space (#763, E25)", async () => {
    const { auth, ctx } = await setup();
    const { user: peer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: peer.id });
    await ctx.newSharedSpaceMember({
      spaceId: space.id,
      userId: peer.id,
      role: SharedSpaceRole.Owner,
    });
    await ctx.newSharedSpaceMember({
      spaceId: space.id,
      userId: auth.user.id,
      role: SharedSpaceRole.Editor,
    });
    const { asset } = await ctx.newAsset({ ownerId: peer.id });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });
    // auth (not the owner) favorites the asset — their own stream must reflect it as true.
    await ctx.get(AssetFavoriteRepository).addAll(auth.user.id, [asset.id]);

    const response = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAssetsV1]);
    const assetEvents = response.filter(
      (r: { type: string }) =>
        r.type === SyncEntityType.SharedSpaceAssetCreateV1 || r.type === SyncEntityType.SharedSpaceAssetUpdateV1,
    );
    expect(assetEvents).toHaveLength(1);
    expect((assetEvents[0] as { data: { id: string; isFavorite: boolean } }).data).toMatchObject({
      id: asset.id,
      isFavorite: true,
    });
  });

  it('syncs true isFavorite for an asset owned by the requesting user', async () => {
    const { auth, ctx } = await setup();
    const { space } = await ctx.newSharedSpace({ createdById: auth.user.id });
    await ctx.newSharedSpaceMember({
      spaceId: space.id,
      userId: auth.user.id,
      role: SharedSpaceRole.Owner,
    });
    const { asset } = await ctx.newAsset({ ownerId: auth.user.id });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });
    await ctx.get(AssetFavoriteRepository).addAll(auth.user.id, [asset.id]);

    const response = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAssetsV1]);
    const assetEvents = response.filter(
      (r: { type: string }) =>
        r.type === SyncEntityType.SharedSpaceAssetCreateV1 || r.type === SyncEntityType.SharedSpaceAssetUpdateV1,
    );
    expect(assetEvents).toHaveLength(1);
    expect((assetEvents[0] as { data: { id: string; isFavorite: boolean } }).data).toMatchObject({
      id: asset.id,
      isFavorite: true,
    });
  });

  it("does not leak the peer's favorite on the update path for a foreign-owned asset (#763)", async () => {
    const { auth, ctx } = await setup();
    const { user: peer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: peer.id });
    await ctx.newSharedSpaceMember({
      spaceId: space.id,
      userId: peer.id,
      role: SharedSpaceRole.Owner,
    });
    await ctx.newSharedSpaceMember({
      spaceId: space.id,
      userId: auth.user.id,
      role: SharedSpaceRole.Editor,
    });
    const { asset } = await ctx.newAsset({ ownerId: peer.id });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });

    const initial = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAssetsV1]);
    await ctx.syncAckAll(auth, initial);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.SharedSpaceAssetsV1]);

    // The peer favorites the asset (via the overlay) AND a genuine metadata change bumps
    // asset.updateId so the row re-flows through the update path — even so, auth's stream must
    // never see the peer's favorite.
    await ctx.get(AssetFavoriteRepository).addAll(peer.id, [asset.id]);
    await defaultDatabase.updateTable('asset').set({ isFavorite: true }).where('id', '=', asset.id).execute();

    const next = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAssetsV1]);
    const updateEvents = next.filter((r: { type: string }) => r.type === SyncEntityType.SharedSpaceAssetUpdateV1);
    expect(updateEvents).toHaveLength(1);
    expect((updateEvents[0] as { data: { id: string; isFavorite: boolean } }).data).toMatchObject({
      id: asset.id,
      isFavorite: false,
    });
  });

  it("syncs the recipient's own favorite on the update path for a foreign-owned asset (#763, E25)", async () => {
    const { auth, ctx } = await setup();
    const { user: peer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: peer.id });
    await ctx.newSharedSpaceMember({
      spaceId: space.id,
      userId: peer.id,
      role: SharedSpaceRole.Owner,
    });
    await ctx.newSharedSpaceMember({
      spaceId: space.id,
      userId: auth.user.id,
      role: SharedSpaceRole.Editor,
    });
    const { asset } = await ctx.newAsset({ ownerId: peer.id });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });

    const initial = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAssetsV1]);
    await ctx.syncAckAll(auth, initial);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.SharedSpaceAssetsV1]);

    // auth favorites the foreign-owned asset AND a genuine metadata change bumps asset.updateId
    // so the row re-flows through the update path with auth's own favorite state.
    await ctx.get(AssetFavoriteRepository).addAll(auth.user.id, [asset.id]);
    await defaultDatabase
      .updateTable('asset')
      .set({ originalFileName: 'renamed-for-update-path' })
      .where('id', '=', asset.id)
      .execute();

    const next = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAssetsV1]);
    const updateEvents = next.filter((r: { type: string }) => r.type === SyncEntityType.SharedSpaceAssetUpdateV1);
    expect(updateEvents).toHaveLength(1);
    expect((updateEvents[0] as { data: { id: string; isFavorite: boolean } }).data).toMatchObject({
      id: asset.id,
      isFavorite: true,
    });
  });
});
