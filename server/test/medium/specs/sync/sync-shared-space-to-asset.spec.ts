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

describe(SyncRequestType.SharedSpaceToAssetsV1, () => {
  it('emits a join row when an asset is added to an accessible space', async () => {
    const { auth, ctx } = await setup();
    const { space } = await ctx.newSharedSpace({ createdById: auth.user.id });
    await ctx.newSharedSpaceMember({
      spaceId: space.id,
      userId: auth.user.id,
      role: SharedSpaceRole.Owner,
    });
    const { asset } = await ctx.newAsset({ ownerId: auth.user.id });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });

    const response = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceToAssetsV1]);
    const joinEvents = response.filter((r: { type: string }) => r.type === SyncEntityType.SharedSpaceToAssetV1);
    expect(joinEvents).toHaveLength(1);
    expect((joinEvents[0] as { data: { spaceId: string; assetId: string } }).data).toMatchObject({
      spaceId: space.id,
      assetId: asset.id,
    });
  });

  it('emits a delete event when an asset is removed from an accessible space', async () => {
    const { auth, ctx } = await setup();
    const { space } = await ctx.newSharedSpace({ createdById: auth.user.id });
    await ctx.newSharedSpaceMember({
      spaceId: space.id,
      userId: auth.user.id,
      role: SharedSpaceRole.Owner,
    });
    const { asset } = await ctx.newAsset({ ownerId: auth.user.id });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });

    const initial = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceToAssetsV1]);
    await ctx.syncAckAll(auth, initial);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.SharedSpaceToAssetsV1]);

    await defaultDatabase
      .deleteFrom('shared_space_asset')
      .where('spaceId', '=', space.id)
      .where('assetId', '=', asset.id)
      .execute();

    const next = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceToAssetsV1]);
    const deleteEvents = next.filter((r: { type: string }) => r.type === SyncEntityType.SharedSpaceToAssetDeleteV1);
    expect(deleteEvents).toHaveLength(1);
    expect((deleteEvents[0] as { data: { spaceId: string; assetId: string } }).data).toMatchObject({
      spaceId: space.id,
      assetId: asset.id,
    });
  });

  it('does not emit join rows from spaces the user has no access to', async () => {
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

    const response = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceToAssetsV1]);
    const joinEvents = response.filter(
      (r: { type: string }) =>
        r.type === SyncEntityType.SharedSpaceToAssetV1 || r.type === SyncEntityType.SharedSpaceToAssetBackfillV1,
    );
    expect(joinEvents).toHaveLength(0);
  });

  it('backfills historical join rows when the user is added to a pre-existing space', async () => {
    const { auth, ctx } = await setup();
    const { user: stranger } = await ctx.newUser();
    const { space: oldSpace } = await ctx.newSharedSpace({ createdById: stranger.id });
    await ctx.newSharedSpaceMember({
      spaceId: oldSpace.id,
      userId: stranger.id,
      role: SharedSpaceRole.Owner,
    });
    const { asset: oldAsset } = await ctx.newAsset({ ownerId: stranger.id });
    await ctx.newSharedSpaceAsset({ spaceId: oldSpace.id, assetId: oldAsset.id });
    await wait(2);
    const { space: currentSpace } = await ctx.newSharedSpace({ createdById: auth.user.id });
    await ctx.newSharedSpaceMember({
      spaceId: currentSpace.id,
      userId: auth.user.id,
      role: SharedSpaceRole.Owner,
    });
    const { asset: currentAsset } = await ctx.newAsset({ ownerId: auth.user.id });
    await ctx.newSharedSpaceAsset({ spaceId: currentSpace.id, assetId: currentAsset.id });

    const initial = await ctx.syncStream(auth, [SyncRequestType.SharedSpacesV1, SyncRequestType.SharedSpaceToAssetsV1]);
    await ctx.syncAckAll(auth, initial);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.SharedSpacesV1, SyncRequestType.SharedSpaceToAssetsV1]);

    await ctx.newSharedSpaceMember({
      spaceId: oldSpace.id,
      userId: auth.user.id,
      role: SharedSpaceRole.Editor,
    });

    const next = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceToAssetsV1]);
    const backfillEvents = next.filter((r: { type: string }) => r.type === SyncEntityType.SharedSpaceToAssetBackfillV1);
    expect(backfillEvents.length).toBeGreaterThanOrEqual(1);
    expect(
      backfillEvents.some(
        (r: { data: { spaceId: string; assetId: string } }) =>
          r.data.spaceId === oldSpace.id && r.data.assetId === oldAsset.id,
      ),
    ).toBe(true);
  });

  it('does not emit a delete row to a stranger when an asset is removed from a foreign space', async () => {
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

    await defaultDatabase
      .deleteFrom('shared_space_asset')
      .where('spaceId', '=', space.id)
      .where('assetId', '=', asset.id)
      .execute();

    const response = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceToAssetsV1]);
    const deleteEvents = response.filter((r: { type: string }) => r.type === SyncEntityType.SharedSpaceToAssetDeleteV1);
    expect(deleteEvents).toHaveLength(0);
  });
});
