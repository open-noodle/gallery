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

describe(SyncRequestType.SharedSpaceAssetExifsV1, () => {
  it('emits an exif row for an asset in an accessible space', async () => {
    const { auth, ctx } = await setup();
    const { space } = await ctx.newSharedSpace({ createdById: auth.user.id });
    await ctx.newSharedSpaceMember({
      spaceId: space.id,
      userId: auth.user.id,
      role: SharedSpaceRole.Owner,
    });
    const { asset } = await ctx.newAsset({ ownerId: auth.user.id });
    await ctx.newExif({ assetId: asset.id, make: 'TestMake', model: 'TestModel' });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });

    const response = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAssetExifsV1]);
    const exifEvents = response.filter(
      (r: { type: string }) =>
        r.type === SyncEntityType.SharedSpaceAssetExifCreateV1 ||
        r.type === SyncEntityType.SharedSpaceAssetExifUpdateV1,
    );
    expect(exifEvents).toHaveLength(1);
    expect((exifEvents[0] as { data: { assetId: string; make: string | null } }).data).toMatchObject({
      assetId: asset.id,
      make: 'TestMake',
    });
  });

  it('does not emit exif rows for assets in spaces the user has no access to', async () => {
    const { auth, ctx } = await setup();
    const { user: stranger } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: stranger.id });
    await ctx.newSharedSpaceMember({
      spaceId: space.id,
      userId: stranger.id,
      role: SharedSpaceRole.Owner,
    });
    const { asset } = await ctx.newAsset({ ownerId: stranger.id });
    await ctx.newExif({ assetId: asset.id, make: 'StrangerCam' });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });

    const response = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAssetExifsV1]);
    const exifEvents = response.filter(
      (r: { type: string }) =>
        r.type === SyncEntityType.SharedSpaceAssetExifCreateV1 ||
        r.type === SyncEntityType.SharedSpaceAssetExifUpdateV1,
    );
    expect(exifEvents).toHaveLength(0);
  });

  it("emits a foreign-owned asset's exif to a peer member of the space", async () => {
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
    await ctx.newExif({ assetId: asset.id, make: 'PeerCam' });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });

    const response = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAssetExifsV1]);
    const exifEvents = response.filter(
      (r: { type: string }) =>
        r.type === SyncEntityType.SharedSpaceAssetExifCreateV1 ||
        r.type === SyncEntityType.SharedSpaceAssetExifUpdateV1,
    );
    expect(exifEvents).toHaveLength(1);
    expect((exifEvents[0] as { data: { assetId: string; make: string | null } }).data).toMatchObject({
      assetId: asset.id,
      make: 'PeerCam',
    });
  });

  it('backfills historical exif rows when the user is added to a pre-existing space', async () => {
    const { auth, ctx } = await setup();
    const { user: stranger } = await ctx.newUser();
    const { space: oldSpace } = await ctx.newSharedSpace({ createdById: stranger.id });
    await ctx.newSharedSpaceMember({
      spaceId: oldSpace.id,
      userId: stranger.id,
      role: SharedSpaceRole.Owner,
    });
    const { asset: oldAsset } = await ctx.newAsset({ ownerId: stranger.id });
    await ctx.newExif({ assetId: oldAsset.id, make: 'BackfillCam' });
    await ctx.newSharedSpaceAsset({ spaceId: oldSpace.id, assetId: oldAsset.id });
    await wait(2);
    const { space: currentSpace } = await ctx.newSharedSpace({ createdById: auth.user.id });
    await ctx.newSharedSpaceMember({
      spaceId: currentSpace.id,
      userId: auth.user.id,
      role: SharedSpaceRole.Owner,
    });
    const { asset: currentAsset } = await ctx.newAsset({ ownerId: auth.user.id });
    await ctx.newExif({ assetId: currentAsset.id, make: 'CurrentCam' });
    await ctx.newSharedSpaceAsset({ spaceId: currentSpace.id, assetId: currentAsset.id });

    const initial = await ctx.syncStream(auth, [
      SyncRequestType.SharedSpacesV1,
      SyncRequestType.SharedSpaceAssetExifsV1,
    ]);
    await ctx.syncAckAll(auth, initial);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.SharedSpacesV1, SyncRequestType.SharedSpaceAssetExifsV1]);

    await ctx.newSharedSpaceMember({
      spaceId: oldSpace.id,
      userId: auth.user.id,
      role: SharedSpaceRole.Editor,
    });

    const next = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAssetExifsV1]);
    const backfillEvents = next.filter(
      (r: { type: string }) => r.type === SyncEntityType.SharedSpaceAssetExifBackfillV1,
    );
    expect(backfillEvents.length).toBeGreaterThanOrEqual(1);
    expect(
      backfillEvents.some(
        (r: { data: { assetId: string; make: string | null } }) =>
          r.data.assetId === oldAsset.id && r.data.make === 'BackfillCam',
      ),
    ).toBe(true);
  });

  it('re-emits an exif row on the update path when exif metadata changes after the initial ack', async () => {
    const { auth, ctx } = await setup();
    const { space } = await ctx.newSharedSpace({ createdById: auth.user.id });
    await ctx.newSharedSpaceMember({
      spaceId: space.id,
      userId: auth.user.id,
      role: SharedSpaceRole.Owner,
    });
    const { asset } = await ctx.newAsset({ ownerId: auth.user.id });
    await ctx.newExif({ assetId: asset.id, make: 'OldMake' });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });

    const initial = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAssetExifsV1]);
    await ctx.syncAckAll(auth, initial);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.SharedSpaceAssetExifsV1]);

    await ctx.newExif({ assetId: asset.id, make: 'NewMake' });

    const next = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAssetExifsV1]);
    const updateEvents = next.filter((r: { type: string }) => r.type === SyncEntityType.SharedSpaceAssetExifUpdateV1);
    expect(updateEvents).toHaveLength(1);
    expect((updateEvents[0] as { data: { assetId: string; make: string | null } }).data).toMatchObject({
      assetId: asset.id,
      make: 'NewMake',
    });
  });
});
