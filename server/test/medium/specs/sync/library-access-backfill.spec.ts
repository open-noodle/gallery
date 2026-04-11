import { Kysely } from 'kysely';
import { SharedSpaceRole, SyncEntityType, SyncRequestType } from 'src/enum';
import { DB } from 'src/schema';
import { SyncTestContext } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

// Integration tests for the three library-access backfill scenarios the
// library_user denormalization fixes:
//
//   1. A user re-added to a space after leaving (covered in
//      library-sync-end-to-end.spec.ts — asset+exif re-emit).
//   2. A new user added to a pre-existing space that already has libraries
//      linked (covered below).
//   3. A library newly linked to a space the user is already in (covered
//      below).
//
// These exercise the full server stack: triggers + rewritten getCreatedAfter
// + existing syncLibrariesV1 / syncLibraryAssetsV1 / syncLibraryAssetExifsV1.

let defaultDatabase: Kysely<DB>;

const setup = () => {
  const ctx = new SyncTestContext(defaultDatabase);
  return { ctx, db: defaultDatabase };
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

describe('library access backfill — sync stream integration', () => {
  it('delivers library metadata + assets on first sync of a user added to an existing space with linked libraries', async () => {
    const { ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: owner.id, name: 'Pre-existing library' });
    const { asset } = await ctx.newAsset({ ownerId: owner.id, libraryId: library.id });
    await ctx.newExif({ assetId: asset.id, make: 'TestMake' });

    // Space with the library already linked, BEFORE the new user exists.
    const { space } = await ctx.newSharedSpace({ createdById: owner.id, name: 'Existing S' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: owner.id });

    // Now create the new user and add them to the pre-existing space.
    const { auth: authNew } = await ctx.newSyncAuthUser();
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: authNew.user.id, role: SharedSpaceRole.Editor });

    // First sync — trigger-populated library_user with a fresh createId
    // drives the per-library asset backfill, and the updateId bump drives
    // the library metadata upsert stream.
    const response = await ctx.syncStream(authNew, ALL_LIBRARY_TYPES);

    const libraryEvents = response.filter((r: { type: string }) => r.type === SyncEntityType.LibraryV1);
    expect(libraryEvents.map((e: { data: { id: string } }) => e.data.id)).toContain(library.id);

    const assetEvents = response.filter(
      (r: { type: string }) =>
        r.type === SyncEntityType.LibraryAssetCreateV1 || r.type === SyncEntityType.LibraryAssetBackfillV1,
    );
    expect(assetEvents.map((e: { data: { id: string } }) => e.data.id)).toContain(asset.id);

    const exifEvents = response.filter(
      (r: { type: string }) =>
        r.type === SyncEntityType.LibraryAssetExifCreateV1 || r.type === SyncEntityType.LibraryAssetExifBackfillV1,
    );
    expect(exifEvents.map((e: { data: { assetId: string } }) => e.data.assetId)).toContain(asset.id);
  });

  it('delivers library metadata + assets when a library is newly linked to a space the user is already in', async () => {
    const { ctx } = setup();
    const { auth: authB } = await ctx.newSyncAuthUser();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id, name: 'Initially empty S' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: authB.user.id, role: SharedSpaceRole.Editor });

    // Initial sync — nothing library-related for B.
    const initial = await ctx.syncStream(authB, ALL_LIBRARY_TYPES);
    const initialLibraryEvents = initial.filter((r: { type: string }) => r.type === SyncEntityType.LibraryV1);
    expect(initialLibraryEvents).toHaveLength(0);
    await ctx.syncAckAll(authB, initial);

    // Now link a new library + asset + exif to the space.
    const { library } = await ctx.newLibrary({ ownerId: owner.id, name: 'Late-linked library' });
    const { asset } = await ctx.newAsset({ ownerId: owner.id, libraryId: library.id });
    await ctx.newExif({ assetId: asset.id, make: 'TestMake' });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: owner.id });

    // Second sync — library + asset + exif must all flow to B.
    const response = await ctx.syncStream(authB, ALL_LIBRARY_TYPES);

    const libraryEvents = response.filter((r: { type: string }) => r.type === SyncEntityType.LibraryV1);
    expect(libraryEvents.map((e: { data: { id: string } }) => e.data.id)).toContain(library.id);

    const assetEvents = response.filter(
      (r: { type: string }) =>
        r.type === SyncEntityType.LibraryAssetCreateV1 || r.type === SyncEntityType.LibraryAssetBackfillV1,
    );
    expect(assetEvents.map((e: { data: { id: string } }) => e.data.id)).toContain(asset.id);

    const exifEvents = response.filter(
      (r: { type: string }) =>
        r.type === SyncEntityType.LibraryAssetExifCreateV1 || r.type === SyncEntityType.LibraryAssetExifBackfillV1,
    );
    expect(exifEvents.map((e: { data: { assetId: string } }) => e.data.assetId)).toContain(asset.id);
  });
});
