import { Kysely } from 'kysely';
import { SharedSpaceRole, SyncEntityType, SyncRequestType } from 'src/enum';
import { DB } from 'src/schema';
import { SyncTestContext } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = async (db?: Kysely<DB>) => {
  const ctx = new SyncTestContext(db || defaultDatabase);
  const { auth, user, session } = await ctx.newSyncAuthUser();
  return { auth, user, session, ctx };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

const isExifEvent = (r: { type: string }) =>
  r.type === SyncEntityType.LibraryAssetExifCreateV1 ||
  r.type === SyncEntityType.LibraryAssetExifUpdateV1 ||
  r.type === SyncEntityType.LibraryAssetExifBackfillV1;

describe(SyncRequestType.LibraryAssetExifsV1, () => {
  it('emits exif rows for assets in accessible libraries (ownership path)', async () => {
    const { auth, ctx } = await setup();
    const { library } = await ctx.newLibrary({ ownerId: auth.user.id });
    const { asset } = await ctx.newAsset({ ownerId: auth.user.id, libraryId: library.id });
    await ctx.newExif({ assetId: asset.id, make: 'TestMake', model: 'TestModel' });

    const response = await ctx.syncStream(auth, [SyncRequestType.LibraryAssetExifsV1]);
    const exifEvents = response.filter(isExifEvent);
    expect(exifEvents).toHaveLength(1);
    expect((exifEvents[0] as { data: { assetId: string; make: string } }).data).toMatchObject({
      assetId: asset.id,
      make: 'TestMake',
    });
  });

  it('emits exif rows for assets in libraries reachable via a member-of space', async () => {
    const { auth, ctx } = await setup();
    const { user: owner } = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: owner.id });
    const { asset } = await ctx.newAsset({ ownerId: owner.id, libraryId: library.id });
    await ctx.newExif({ assetId: asset.id, make: 'PeerMake' });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: auth.user.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: owner.id });

    const response = await ctx.syncStream(auth, [SyncRequestType.LibraryAssetExifsV1]);
    const exifEvents = response.filter(isExifEvent);
    expect(exifEvents).toHaveLength(1);
    expect((exifEvents[0] as { data: { assetId: string } }).data.assetId).toBe(asset.id);
  });

  it('does not emit exif for assets in libraries the user cannot access', async () => {
    const { auth, ctx } = await setup();
    const { user: stranger } = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: stranger.id });
    const { asset } = await ctx.newAsset({ ownerId: stranger.id, libraryId: library.id });
    await ctx.newExif({ assetId: asset.id, make: 'StrangerMake' });

    const response = await ctx.syncStream(auth, [SyncRequestType.LibraryAssetExifsV1]);
    const exifEvents = response.filter(isExifEvent);
    expect(exifEvents).toHaveLength(0);
  });

  it('re-emits an exif row when properties change', async () => {
    // LibraryAssetExifSync uses a single getUpserts stream (same pattern as
    // PartnerAssetExifsSync) — updates flow through as LibraryAssetExifCreateV1
    // and the client upserts idempotently.
    const { auth, ctx } = await setup();
    const { library } = await ctx.newLibrary({ ownerId: auth.user.id });
    const { asset } = await ctx.newAsset({ ownerId: auth.user.id, libraryId: library.id });
    await ctx.newExif({ assetId: asset.id, make: 'OldMake' });

    const initial = await ctx.syncStream(auth, [SyncRequestType.LibraryAssetExifsV1]);
    await ctx.syncAckAll(auth, initial);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.LibraryAssetExifsV1]);

    await ctx.newExif({ assetId: asset.id, make: 'NewMake' });

    const next = await ctx.syncStream(auth, [SyncRequestType.LibraryAssetExifsV1]);
    const exifEvents = next.filter(isExifEvent);
    expect(exifEvents).toHaveLength(1);
    expect((exifEvents[0] as { data: { assetId: string; make: string } }).data).toMatchObject({
      assetId: asset.id,
      make: 'NewMake',
    });
  });
});
