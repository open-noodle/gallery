import { Kysely } from 'kysely';
import { SharedSpaceRole, SyncEntityType, SyncRequestType } from 'src/enum';
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
    const { asset } = await ctx.newAsset({ ownerId: auth.user.id, isFavorite: false });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });

    const initial = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAssetsV1]);
    await ctx.syncAckAll(auth, initial);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.SharedSpaceAssetsV1]);

    await defaultDatabase.updateTable('asset').set({ isFavorite: true }).where('id', '=', asset.id).execute();

    const next = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAssetsV1]);
    const updateEvents = next.filter((r: { type: string }) => r.type === SyncEntityType.SharedSpaceAssetUpdateV1);
    expect(updateEvents).toHaveLength(1);
    expect((updateEvents[0] as { data: { id: string; isFavorite: boolean } }).data).toMatchObject({
      id: asset.id,
      isFavorite: true,
    });
  });
});
