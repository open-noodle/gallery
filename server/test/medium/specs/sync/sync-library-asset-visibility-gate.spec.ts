// Fix B: LibraryAssetSync and LibraryAssetExifSync must apply an M3 visibility
// gate when streaming OTHER members' library assets through the space-link path.
//
// Bug: `accessibleLibraries(userId)` includes libraries linked to a space the
// user belongs to. Before this fix, LibraryAssetSync/LibraryAssetExifSync had
// NO visibility gate, so a space member received Hidden/Locked library asset
// bytes + EXIF of other members in full.
//
// M3 nuance (own vs other): the user must still receive ALL visibilities of
// their OWN library assets (Hidden/Locked are valid personal photos). Only
// OTHER members' assets (reached via the space-link branch) are clamped to
// [Archive, Timeline]. Gate formula:
//
//   asset.ownerId = userId  OR  asset.visibility IN ('archive','timeline')
//
// Test matrix (4 x 2 = 8 combinations — all four are exercised below):
//   LibraryAssetSync     × member B sees only Timeline/Archive of owner A
//   LibraryAssetSync     × owner A sees all own visibilities (not over-blocked)
//   LibraryAssetExifSync × member B sees only Timeline/Archive EXIF of owner A
//   LibraryAssetExifSync × owner A sees all own EXIF (not over-blocked)

import { Kysely } from 'kysely';
import { AssetVisibility, SharedSpaceRole, SyncEntityType, SyncRequestType } from 'src/enum';
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

const isAssetEvent = (r: { type: string }) =>
  r.type === SyncEntityType.LibraryAssetCreateV1 || r.type === SyncEntityType.LibraryAssetBackfillV1;

const isExifEvent = (r: { type: string }) =>
  r.type === SyncEntityType.LibraryAssetExifCreateV1 || r.type === SyncEntityType.LibraryAssetExifBackfillV1;

// ── LibraryAssetSync — M3 visibility gate ────────────────────────────────────

describe('LibraryAssetSync — M3 visibility gate (space-link path)', () => {
  it('member B receives only Timeline and Archive assets from owner A library (not Hidden/Locked)', async () => {
    // RED: without the M3 gate, member B receives ALL 4 assets from owner A.
    // GREEN: only Timeline and Archive should appear.
    const { auth: memberBAuth, ctx } = await setup();
    const { user: ownerA } = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: ownerA.id, name: 'OwnerA-Library' });

    const { asset: timelineAsset } = await ctx.newAsset({
      ownerId: ownerA.id,
      libraryId: library.id,
      visibility: AssetVisibility.Timeline,
    });
    const { asset: archiveAsset } = await ctx.newAsset({
      ownerId: ownerA.id,
      libraryId: library.id,
      visibility: AssetVisibility.Archive,
    });
    const { asset: hiddenAsset } = await ctx.newAsset({
      ownerId: ownerA.id,
      libraryId: library.id,
      visibility: AssetVisibility.Hidden,
    });
    const { asset: lockedAsset } = await ctx.newAsset({
      ownerId: ownerA.id,
      libraryId: library.id,
      visibility: AssetVisibility.Locked,
    });

    // Link library L into space S; member B is in the space.
    const { space } = await ctx.newSharedSpace({ createdById: ownerA.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: ownerA.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: memberBAuth.user.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: ownerA.id });

    const response = await ctx.syncStream(memberBAuth, [SyncRequestType.LibraryAssetsV1]);
    const assetEvents = response.filter((r) => isAssetEvent(r));
    const emittedIds = assetEvents.map((e) => (e as { data: { id: string } }).data.id);

    // Must include shareable visibilities.
    expect(emittedIds).toContain(timelineAsset.id);
    expect(emittedIds).toContain(archiveAsset.id);
    // Must NOT include private visibilities of another user.
    expect(emittedIds).not.toContain(hiddenAsset.id);
    expect(emittedIds).not.toContain(lockedAsset.id);
  });

  it('owner A still receives ALL visibilities of their own library assets (not over-blocked)', async () => {
    // M3 correctness: the gate must not block the owner's own Hidden/Locked.
    const { auth: ownerAAuth, ctx } = await setup();
    const { library } = await ctx.newLibrary({ ownerId: ownerAAuth.user.id, name: 'OwnLib' });

    const { asset: timelineAsset } = await ctx.newAsset({
      ownerId: ownerAAuth.user.id,
      libraryId: library.id,
      visibility: AssetVisibility.Timeline,
    });
    const { asset: archiveAsset } = await ctx.newAsset({
      ownerId: ownerAAuth.user.id,
      libraryId: library.id,
      visibility: AssetVisibility.Archive,
    });
    const { asset: hiddenAsset } = await ctx.newAsset({
      ownerId: ownerAAuth.user.id,
      libraryId: library.id,
      visibility: AssetVisibility.Hidden,
    });
    const { asset: lockedAsset } = await ctx.newAsset({
      ownerId: ownerAAuth.user.id,
      libraryId: library.id,
      visibility: AssetVisibility.Locked,
    });

    const response = await ctx.syncStream(ownerAAuth, [SyncRequestType.LibraryAssetsV1]);
    const assetEvents = response.filter((r) => isAssetEvent(r));
    const emittedIds = assetEvents.map((e) => (e as { data: { id: string } }).data.id);

    // Owner must see ALL four of their own assets regardless of visibility.
    expect(emittedIds).toContain(timelineAsset.id);
    expect(emittedIds).toContain(archiveAsset.id);
    expect(emittedIds).toContain(hiddenAsset.id);
    expect(emittedIds).toContain(lockedAsset.id);
  });

  it('member B does not receive Hidden asset on the upsert path (delta after ack)', async () => {
    // Verify the gate applies to getUpserts, not just getBackfill.
    const { auth: memberBAuth, ctx } = await setup();
    const { user: ownerA } = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: ownerA.id });

    // Create a Timeline asset — member B sees it.
    const { asset } = await ctx.newAsset({
      ownerId: ownerA.id,
      libraryId: library.id,
      visibility: AssetVisibility.Timeline,
    });

    const { space } = await ctx.newSharedSpace({ createdById: ownerA.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: ownerA.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: memberBAuth.user.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: ownerA.id });

    const initial = await ctx.syncStream(memberBAuth, [SyncRequestType.LibraryAssetsV1]);
    await ctx.syncAckAll(memberBAuth, initial);
    await ctx.assertSyncIsComplete(memberBAuth, [SyncRequestType.LibraryAssetsV1]);

    // Owner A flips asset to Hidden — must NOT appear on member B's upsert path.
    await defaultDatabase
      .updateTable('asset')
      .set({ visibility: AssetVisibility.Hidden })
      .where('id', '=', asset.id)
      .execute();

    const next = await ctx.syncStream(memberBAuth, [SyncRequestType.LibraryAssetsV1]);
    const updateEvents = next.filter((r) => isAssetEvent(r));
    const emittedIds = updateEvents.map((e) => (e as { data: { id: string } }).data.id);
    expect(emittedIds).not.toContain(asset.id);
  });
});

// ── LibraryAssetExifSync — M3 visibility gate ─────────────────────────────────

describe('LibraryAssetExifSync — M3 visibility gate (space-link path)', () => {
  it('member B receives EXIF only for Timeline and Archive assets from owner A library (not Hidden/Locked)', async () => {
    // RED: without the M3 gate, member B receives all 4 EXIF rows from owner A.
    // GREEN: only Timeline and Archive EXIF should appear.
    const { auth: memberBAuth, ctx } = await setup();
    const { user: ownerA } = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: ownerA.id, name: 'OwnerA-Library' });

    const { asset: timelineAsset } = await ctx.newAsset({
      ownerId: ownerA.id,
      libraryId: library.id,
      visibility: AssetVisibility.Timeline,
    });
    const { asset: archiveAsset } = await ctx.newAsset({
      ownerId: ownerA.id,
      libraryId: library.id,
      visibility: AssetVisibility.Archive,
    });
    const { asset: hiddenAsset } = await ctx.newAsset({
      ownerId: ownerA.id,
      libraryId: library.id,
      visibility: AssetVisibility.Hidden,
    });
    const { asset: lockedAsset } = await ctx.newAsset({
      ownerId: ownerA.id,
      libraryId: library.id,
      visibility: AssetVisibility.Locked,
    });

    await ctx.newExif({ assetId: timelineAsset.id, make: 'TimelineCam' });
    await ctx.newExif({ assetId: archiveAsset.id, make: 'ArchiveCam' });
    await ctx.newExif({ assetId: hiddenAsset.id, make: 'HiddenCam' });
    await ctx.newExif({ assetId: lockedAsset.id, make: 'LockedCam' });

    // Link library L into space S; member B is in the space.
    const { space } = await ctx.newSharedSpace({ createdById: ownerA.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: ownerA.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: memberBAuth.user.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: ownerA.id });

    const response = await ctx.syncStream(memberBAuth, [SyncRequestType.LibraryAssetExifsV1]);
    const exifEvents = response.filter((r) => isExifEvent(r));
    const emittedAssetIds = exifEvents.map((e) => (e as { data: { assetId: string } }).data.assetId);

    // Must include shareable visibilities.
    expect(emittedAssetIds).toContain(timelineAsset.id);
    expect(emittedAssetIds).toContain(archiveAsset.id);
    // Must NOT include private visibilities of another user.
    expect(emittedAssetIds).not.toContain(hiddenAsset.id);
    expect(emittedAssetIds).not.toContain(lockedAsset.id);
  });

  it('owner A still receives EXIF for ALL visibilities of their own library assets (not over-blocked)', async () => {
    // M3 correctness: the gate must not block the owner's own Hidden/Locked EXIF.
    const { auth: ownerAAuth, ctx } = await setup();
    const { library } = await ctx.newLibrary({ ownerId: ownerAAuth.user.id, name: 'OwnLib' });

    const { asset: timelineAsset } = await ctx.newAsset({
      ownerId: ownerAAuth.user.id,
      libraryId: library.id,
      visibility: AssetVisibility.Timeline,
    });
    const { asset: archiveAsset } = await ctx.newAsset({
      ownerId: ownerAAuth.user.id,
      libraryId: library.id,
      visibility: AssetVisibility.Archive,
    });
    const { asset: hiddenAsset } = await ctx.newAsset({
      ownerId: ownerAAuth.user.id,
      libraryId: library.id,
      visibility: AssetVisibility.Hidden,
    });
    const { asset: lockedAsset } = await ctx.newAsset({
      ownerId: ownerAAuth.user.id,
      libraryId: library.id,
      visibility: AssetVisibility.Locked,
    });

    await ctx.newExif({ assetId: timelineAsset.id, make: 'TimelineCam' });
    await ctx.newExif({ assetId: archiveAsset.id, make: 'ArchiveCam' });
    await ctx.newExif({ assetId: hiddenAsset.id, make: 'HiddenCam' });
    await ctx.newExif({ assetId: lockedAsset.id, make: 'LockedCam' });

    const response = await ctx.syncStream(ownerAAuth, [SyncRequestType.LibraryAssetExifsV1]);
    const exifEvents = response.filter((r) => isExifEvent(r));
    const emittedAssetIds = exifEvents.map((e) => (e as { data: { assetId: string } }).data.assetId);

    // Owner must see EXIF for ALL four of their own assets.
    expect(emittedAssetIds).toContain(timelineAsset.id);
    expect(emittedAssetIds).toContain(archiveAsset.id);
    expect(emittedAssetIds).toContain(hiddenAsset.id);
    expect(emittedAssetIds).toContain(lockedAsset.id);
  });

  it('member B does not receive EXIF for a Hidden asset on the upsert path (delta after ack)', async () => {
    // Verify the gate applies to getUpserts, not just getBackfill.
    const { auth: memberBAuth, ctx } = await setup();
    const { user: ownerA } = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: ownerA.id });

    const { asset } = await ctx.newAsset({
      ownerId: ownerA.id,
      libraryId: library.id,
      visibility: AssetVisibility.Timeline,
    });
    await ctx.newExif({ assetId: asset.id, make: 'OldMake' });

    const { space } = await ctx.newSharedSpace({ createdById: ownerA.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: ownerA.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: memberBAuth.user.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: ownerA.id });

    const initial = await ctx.syncStream(memberBAuth, [SyncRequestType.LibraryAssetExifsV1]);
    await ctx.syncAckAll(memberBAuth, initial);
    await ctx.assertSyncIsComplete(memberBAuth, [SyncRequestType.LibraryAssetExifsV1]);

    // Flip to Hidden, update EXIF — must NOT re-emit to member B.
    await defaultDatabase
      .updateTable('asset')
      .set({ visibility: AssetVisibility.Hidden })
      .where('id', '=', asset.id)
      .execute();
    await ctx.newExif({ assetId: asset.id, make: 'NewMake' });

    const next = await ctx.syncStream(memberBAuth, [SyncRequestType.LibraryAssetExifsV1]);
    const exifEvents = next.filter((r) => isExifEvent(r));
    const emittedAssetIds = exifEvents.map((e) => (e as { data: { assetId: string } }).data.assetId);
    expect(emittedAssetIds).not.toContain(asset.id);
  });
});
