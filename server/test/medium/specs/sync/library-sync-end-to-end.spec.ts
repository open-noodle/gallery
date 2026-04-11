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

const ALL_LIBRARY_TYPES = [
  SyncRequestType.LibrariesV1,
  SyncRequestType.LibraryAssetsV1,
  SyncRequestType.LibraryAssetExifsV1,
  SyncRequestType.SharedSpaceLibrariesV1,
];

describe('library sync end-to-end access control', () => {
  it('streams libraries, assets, exifs, and join rows when user joins a space, and revokes them when removed', async () => {
    // Scenario from design doc "server medium test — end-to-end access control":
    // User A owns L1 and L2, creates space S, links both libraries.
    // User B joins S as a member. Run sync for B.
    const { auth: authB, ctx } = await setup();
    const { user: userA } = await ctx.newUser();

    const { library: l1 } = await ctx.newLibrary({ ownerId: userA.id, name: 'Library 1' });
    const { library: l2 } = await ctx.newLibrary({ ownerId: userA.id, name: 'Library 2' });

    const { asset: a1 } = await ctx.newAsset({ ownerId: userA.id, libraryId: l1.id });
    const { asset: a2 } = await ctx.newAsset({ ownerId: userA.id, libraryId: l1.id });
    const { asset: a3 } = await ctx.newAsset({ ownerId: userA.id, libraryId: l2.id });
    await ctx.newExif({ assetId: a1.id, make: 'TestMake' });
    await ctx.newExif({ assetId: a2.id, make: 'TestMake' });
    await ctx.newExif({ assetId: a3.id, make: 'TestMake' });

    // Library outside the space — B should never see this.
    const { library: outside } = await ctx.newLibrary({ ownerId: userA.id, name: 'Outside' });
    const { asset: outsideAsset } = await ctx.newAsset({ ownerId: userA.id, libraryId: outside.id });

    const { space } = await ctx.newSharedSpace({ createdById: userA.id, name: 'Shared S' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: userA.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: authB.user.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: l1.id, addedById: userA.id });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: l2.id, addedById: userA.id });

    // Run sync for B across all four library streams.
    const initial = await ctx.syncStream(authB, ALL_LIBRARY_TYPES);

    // Assertion 1: B receives both libraries.
    const libraryEvents = initial.filter((r: { type: string }) => r.type === SyncEntityType.LibraryV1);
    const libraryIds = libraryEvents.map((e: { data: { id: string } }) => e.data.id);
    expect(libraryIds).toEqual(expect.arrayContaining([l1.id, l2.id]));
    expect(libraryIds).toHaveLength(2);
    expect(libraryIds).not.toContain(outside.id);

    // Assertion 2: B receives every asset in L1 and L2 exactly once. Library assets
    // flow as LibraryAssetCreateV1 (no per-pairing join row → no backfill events
    // until a checkpoint exists; first sync emits via the upsert stream).
    const assetEvents = initial.filter(
      (r: { type: string }) =>
        r.type === SyncEntityType.LibraryAssetCreateV1 || r.type === SyncEntityType.LibraryAssetBackfillV1,
    );
    const assetIds = assetEvents.map((e: { data: { id: string } }) => e.data.id).toSorted();
    expect(assetIds).toEqual([a1.id, a2.id, a3.id].toSorted());

    // Assertion 3: B does not receive library assets from libraries outside S.
    expect(assetIds).not.toContain(outsideAsset.id);

    // Assertion 4: B receives both shared_space_library join rows.
    const linkEvents = initial.filter(
      (r: { type: string }) =>
        r.type === SyncEntityType.SharedSpaceLibraryV1 || r.type === SyncEntityType.SharedSpaceLibraryBackfillV1,
    );
    const linkLibraryIds = linkEvents.map((e: { data: { libraryId: string } }) => e.data.libraryId).toSorted();
    expect(linkLibraryIds).toEqual([l1.id, l2.id].toSorted());

    // Assertion 5: B receives exif rows for all 3 library assets.
    const exifEvents = initial.filter(
      (r: { type: string }) =>
        r.type === SyncEntityType.LibraryAssetExifCreateV1 || r.type === SyncEntityType.LibraryAssetExifBackfillV1,
    );
    const exifAssetIds = exifEvents.map((e: { data: { assetId: string } }) => e.data.assetId).toSorted();
    expect(exifAssetIds).toEqual([a1.id, a2.id, a3.id].toSorted());

    await ctx.syncAckAll(authB, initial);
    await ctx.assertSyncIsComplete(authB, ALL_LIBRARY_TYPES);

    // Step 2: Remove B from S → re-run sync → B receives LibraryDeleteV1 for L1 and L2.
    await defaultDatabase
      .deleteFrom('shared_space_member')
      .where('spaceId', '=', space.id)
      .where('userId', '=', authB.user.id)
      .execute();

    const afterRemoval = await ctx.syncStream(authB, ALL_LIBRARY_TYPES);
    const libraryDeletes = afterRemoval.filter(
      (r: { type: string; data: { libraryId?: string } }) => r.type === SyncEntityType.LibraryDeleteV1,
    );
    const deletedLibraryIds = libraryDeletes.map((e: { data: { libraryId: string } }) => e.data.libraryId).toSorted();
    expect(deletedLibraryIds).toEqual([l1.id, l2.id].toSorted());

    await ctx.syncAckAll(authB, afterRemoval);

    // Step 3: Re-add B to S. After the library_user fix, re-membership
    // fires the create-side triggers which:
    //   1. INSERT (B, L) rows for each linked library with fresh createIds,
    //      so LibrarySync.getCreatedAfter returns them and the per-library
    //      asset backfill loop re-iterates.
    //   2. Bump library.updateId so LibrarySync.getUpserts re-emits the
    //      library metadata row on B's next sync.
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: authB.user.id, role: SharedSpaceRole.Editor });

    const afterReadd = await ctx.syncStream(authB, ALL_LIBRARY_TYPES);

    // Library metadata rows re-emit via the updateId bump.
    const reAddedLibraryEvents = afterReadd.filter((r: { type: string }) => r.type === SyncEntityType.LibraryV1);
    const reAddedLibraryIds = reAddedLibraryEvents.map((e: { data: { id: string } }) => e.data.id).toSorted();
    expect(reAddedLibraryIds).toEqual([l1.id, l2.id].toSorted());

    // Join rows re-emit via SharedSpaceLibraryBackfillV1 — the membership
    // createId is fresh, so the backfill loop re-iterates the space.
    const reAddedLinkEvents = afterReadd.filter(
      (r: { type: string }) =>
        r.type === SyncEntityType.SharedSpaceLibraryV1 || r.type === SyncEntityType.SharedSpaceLibraryBackfillV1,
    );
    const reAddedLinkLibraryIds = reAddedLinkEvents
      .map((e: { data: { libraryId: string } }) => e.data.libraryId)
      .toSorted();
    expect(reAddedLinkLibraryIds).toEqual([l1.id, l2.id].toSorted());

    // Asset content re-emits via the per-library backfill loop driven by
    // fresh library_user.createIds.
    const reAddedAssetEvents = afterReadd.filter(
      (r: { type: string }) =>
        r.type === SyncEntityType.LibraryAssetCreateV1 || r.type === SyncEntityType.LibraryAssetBackfillV1,
    );
    expect(reAddedAssetEvents.length).toBeGreaterThan(0);

    // Exif content re-emits too.
    const reAddedExifEvents = afterReadd.filter(
      (r: { type: string }) =>
        r.type === SyncEntityType.LibraryAssetExifCreateV1 || r.type === SyncEntityType.LibraryAssetExifBackfillV1,
    );
    expect(reAddedExifEvents.length).toBeGreaterThan(0);
  });
});
