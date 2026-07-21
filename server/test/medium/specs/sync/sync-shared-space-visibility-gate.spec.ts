// Slice 4.A: shared-space sync streams must exclude Hidden and Locked assets.
//
// HIGH-severity RBAC fix: before this slice, the shared-space delta sync
// streams (SharedSpaceAssetSync, SharedSpaceAssetExifSync,
// SharedSpaceAlbumAssetSync, SharedSpaceAlbumAssetExifSync) emitted
// Hidden/Locked assets + their EXIF/GPS to any space member, leaking
// another member's private assets.
//
// Rule: only AssetVisibility.Archive and AssetVisibility.Timeline are
// space-shareable. Hidden and Locked must never appear on any sync stream.
// Archive is intentionally included — it is already shared on the personal
// timeline and there is no expectation of suppression when shared into a space.
//
// Critical invariant (do NOT regress): showInTimeline=false album assets MUST
// still sync on the album-asset grant stream (SharedSpaceAlbumAssetsV1). The
// album-asset surface is a browse/GRANT path, not a personal-timeline
// projection. Only the visibility gate applies here — NOT requireShowInTimeline.

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

// ── Helper predicates ────────────────────────────────────────────────────────

const isSharedSpaceAssetEvent = (r: { type: string }) =>
  [
    SyncEntityType.SharedSpaceAssetCreateV1,
    SyncEntityType.SharedSpaceAssetUpdateV1,
    SyncEntityType.SharedSpaceAssetBackfillV1,
  ].includes(r.type as SyncEntityType);

const isSharedSpaceAssetExifEvent = (r: { type: string }) =>
  [
    SyncEntityType.SharedSpaceAssetExifCreateV1,
    SyncEntityType.SharedSpaceAssetExifUpdateV1,
    SyncEntityType.SharedSpaceAssetExifBackfillV1,
  ].includes(r.type as SyncEntityType);

const isAlbumAssetEvent = (r: { type: string }) =>
  [
    SyncEntityType.SharedSpaceAlbumAssetCreateV1,
    SyncEntityType.SharedSpaceAlbumAssetUpdateV1,
    SyncEntityType.SharedSpaceAlbumAssetBackfillV1,
  ].includes(r.type as SyncEntityType);

const isAlbumAssetExifEvent = (r: { type: string }) =>
  [
    SyncEntityType.SharedSpaceAlbumAssetExifCreateV1,
    SyncEntityType.SharedSpaceAlbumAssetExifUpdateV1,
    SyncEntityType.SharedSpaceAlbumAssetExifBackfillV1,
  ].includes(r.type as SyncEntityType);

// ── SharedSpaceAssetSync visibility gate ─────────────────────────────────────

describe('SharedSpaceAssetSync — visibility gate', () => {
  it('emits Timeline and Archive assets but not Hidden or Locked (direct space add)', async () => {
    const { auth, ctx } = await setup();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: auth.user.id, role: SharedSpaceRole.Editor });

    const { asset: timelineAsset } = await ctx.newAsset({
      ownerId: owner.id,
      visibility: AssetVisibility.Timeline,
    });
    const { asset: archiveAsset } = await ctx.newAsset({
      ownerId: owner.id,
      visibility: AssetVisibility.Archive,
    });
    const { asset: hiddenAsset } = await ctx.newAsset({
      ownerId: owner.id,
      visibility: AssetVisibility.Hidden,
    });
    const { asset: lockedAsset } = await ctx.newAsset({
      ownerId: owner.id,
      visibility: AssetVisibility.Locked,
    });

    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: timelineAsset.id });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: archiveAsset.id });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: hiddenAsset.id });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: lockedAsset.id });

    const response = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAssetsV1]);
    const assetEvents = response.filter((r) => isSharedSpaceAssetEvent(r));
    const emittedIds = assetEvents.map((e) => (e as { data: { id: string } }).data.id);

    expect(emittedIds).toContain(timelineAsset.id);
    expect(emittedIds).toContain(archiveAsset.id);
    expect(emittedIds).not.toContain(hiddenAsset.id);
    expect(emittedIds).not.toContain(lockedAsset.id);
  });

  it('does not emit a Hidden asset on the update path after it was already acked', async () => {
    const { auth, ctx } = await setup();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: auth.user.id, role: SharedSpaceRole.Editor });

    // Asset starts as Timeline — gets acked.
    const { asset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });

    const initial = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAssetsV1]);
    await ctx.syncAckAll(auth, initial);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.SharedSpaceAssetsV1]);

    // Flip to Hidden — must NOT appear on the update path.
    await defaultDatabase
      .updateTable('asset')
      .set({ visibility: AssetVisibility.Hidden })
      .where('id', '=', asset.id)
      .execute();

    const next = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAssetsV1]);
    const updateEvents = next.filter((r) => isSharedSpaceAssetEvent(r));
    const emittedIds = updateEvents.map((e) => (e as { data: { id: string } }).data.id);
    expect(emittedIds).not.toContain(asset.id);
  });

  it('masks isFavorite for a Hidden-to-Timeline asset with a foreign owner (unchanged behaviour)', async () => {
    // Regression guard: isFavorite masking must be unaffected by the visibility gate.
    const { auth, ctx } = await setup();
    const { user: peer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: peer.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: peer.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: auth.user.id, role: SharedSpaceRole.Editor });

    const { asset } = await ctx.newAsset({
      ownerId: peer.id,
      visibility: AssetVisibility.Timeline,
      isFavorite: true,
    });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });

    const response = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAssetsV1]);
    const assetEvents = response.filter((r) => isSharedSpaceAssetEvent(r));
    expect(assetEvents).toHaveLength(1);
    expect((assetEvents[0] as { data: { isFavorite: boolean } }).data.isFavorite).toBe(false);
  });
});

// ── SharedSpaceAssetExifSync visibility gate ──────────────────────────────────

describe('SharedSpaceAssetExifSync — visibility gate', () => {
  it('emits exif only for Timeline and Archive assets, not Hidden or Locked', async () => {
    const { auth, ctx } = await setup();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: auth.user.id, role: SharedSpaceRole.Editor });

    const { asset: timelineAsset } = await ctx.newAsset({
      ownerId: owner.id,
      visibility: AssetVisibility.Timeline,
    });
    const { asset: archiveAsset } = await ctx.newAsset({
      ownerId: owner.id,
      visibility: AssetVisibility.Archive,
    });
    const { asset: hiddenAsset } = await ctx.newAsset({
      ownerId: owner.id,
      visibility: AssetVisibility.Hidden,
    });
    const { asset: lockedAsset } = await ctx.newAsset({
      ownerId: owner.id,
      visibility: AssetVisibility.Locked,
    });

    await ctx.newExif({ assetId: timelineAsset.id, make: 'TimelineCam' });
    await ctx.newExif({ assetId: archiveAsset.id, make: 'ArchiveCam' });
    await ctx.newExif({ assetId: hiddenAsset.id, make: 'HiddenCam' });
    await ctx.newExif({ assetId: lockedAsset.id, make: 'LockedCam' });

    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: timelineAsset.id });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: archiveAsset.id });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: hiddenAsset.id });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: lockedAsset.id });

    const response = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAssetExifsV1]);
    const exifEvents = response.filter((r) => isSharedSpaceAssetExifEvent(r));
    const emittedAssetIds = exifEvents.map((e) => (e as { data: { assetId: string } }).data.assetId);

    expect(emittedAssetIds).toContain(timelineAsset.id);
    expect(emittedAssetIds).toContain(archiveAsset.id);
    expect(emittedAssetIds).not.toContain(hiddenAsset.id);
    expect(emittedAssetIds).not.toContain(lockedAsset.id);
  });

  it('does not emit exif for a Hidden asset on the exif-update path', async () => {
    const { auth, ctx } = await setup();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: auth.user.id, role: SharedSpaceRole.Editor });

    const { asset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
    await ctx.newExif({ assetId: asset.id, make: 'OldMake' });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });

    const initial = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAssetExifsV1]);
    await ctx.syncAckAll(auth, initial);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.SharedSpaceAssetExifsV1]);

    // Flip asset to Hidden, then update exif — must NOT re-emit.
    await defaultDatabase
      .updateTable('asset')
      .set({ visibility: AssetVisibility.Hidden })
      .where('id', '=', asset.id)
      .execute();
    await ctx.newExif({ assetId: asset.id, make: 'NewMake' });

    const next = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAssetExifsV1]);
    const exifEvents = next.filter((r) => isSharedSpaceAssetExifEvent(r));
    const emittedAssetIds = exifEvents.map((e) => (e as { data: { assetId: string } }).data.assetId);
    expect(emittedAssetIds).not.toContain(asset.id);
  });
});

// ── SharedSpaceAlbumAssetSync visibility gate ─────────────────────────────────

describe('SharedSpaceAlbumAssetSync — visibility gate', () => {
  it('emits Timeline and Archive album assets but not Hidden or Locked', async () => {
    const { auth, ctx } = await setup();
    const { user: owner } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: auth.user.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });

    const { asset: timelineAsset } = await ctx.newAsset({
      ownerId: owner.id,
      visibility: AssetVisibility.Timeline,
    });
    const { asset: archiveAsset } = await ctx.newAsset({
      ownerId: owner.id,
      visibility: AssetVisibility.Archive,
    });
    const { asset: hiddenAsset } = await ctx.newAsset({
      ownerId: owner.id,
      visibility: AssetVisibility.Hidden,
    });
    const { asset: lockedAsset } = await ctx.newAsset({
      ownerId: owner.id,
      visibility: AssetVisibility.Locked,
    });

    await ctx.newAlbumAsset({ albumId: album.id, assetId: timelineAsset.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: archiveAsset.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: hiddenAsset.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: lockedAsset.id });

    // Ack membership first so creates stream fires.
    const membershipResponse = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
    await ctx.syncAckAll(auth, membershipResponse);

    const response = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAlbumAssetsV1]);
    const assetEvents = response.filter((r) => isAlbumAssetEvent(r));
    const emittedIds = assetEvents.map((e) => (e as { data: { id: string } }).data.id);

    expect(emittedIds).toContain(timelineAsset.id);
    expect(emittedIds).toContain(archiveAsset.id);
    expect(emittedIds).not.toContain(hiddenAsset.id);
    expect(emittedIds).not.toContain(lockedAsset.id);
  });

  it('syncs a showInTimeline=false album Timeline asset (only visibility-gated, not timeline-gated)', async () => {
    // CRITICAL: the album-asset grant stream is NOT a personal-timeline projection.
    // requireShowInTimeline must NOT be applied here. A Timeline asset in a
    // showInTimeline=false album MUST still sync to a grant-holder.
    const { auth, ctx } = await setup();
    const { user: owner } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: auth.user.id, role: SharedSpaceRole.Editor });

    // showInTimeline=false — album does NOT appear on timeline but assets must
    // still sync to grant-holders on the album-asset stream.
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, showInTimeline: false });

    const { asset: timelineAsset } = await ctx.newAsset({
      ownerId: owner.id,
      visibility: AssetVisibility.Timeline,
    });
    const { asset: hiddenAsset } = await ctx.newAsset({
      ownerId: owner.id,
      visibility: AssetVisibility.Hidden,
    });

    await ctx.newAlbumAsset({ albumId: album.id, assetId: timelineAsset.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: hiddenAsset.id });

    const membershipResponse = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
    await ctx.syncAckAll(auth, membershipResponse);

    const response = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAlbumAssetsV1]);
    const assetEvents = response.filter((r) => isAlbumAssetEvent(r));
    const emittedIds = assetEvents.map((e) => (e as { data: { id: string } }).data.id);

    // Timeline asset in a showInTimeline=false album must sync.
    expect(emittedIds).toContain(timelineAsset.id);
    // Hidden asset must not sync regardless of showInTimeline.
    expect(emittedIds).not.toContain(hiddenAsset.id);
  });
});

// ── SharedSpaceAlbumAssetExifSync visibility gate ─────────────────────────────

describe('SharedSpaceAlbumAssetExifSync — visibility gate', () => {
  it('emits exif only for Timeline and Archive album assets, not Hidden or Locked', async () => {
    const { auth, ctx } = await setup();
    const { user: owner } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: auth.user.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });

    const { asset: timelineAsset } = await ctx.newAsset({
      ownerId: owner.id,
      visibility: AssetVisibility.Timeline,
    });
    const { asset: archiveAsset } = await ctx.newAsset({
      ownerId: owner.id,
      visibility: AssetVisibility.Archive,
    });
    const { asset: hiddenAsset } = await ctx.newAsset({
      ownerId: owner.id,
      visibility: AssetVisibility.Hidden,
    });
    const { asset: lockedAsset } = await ctx.newAsset({
      ownerId: owner.id,
      visibility: AssetVisibility.Locked,
    });

    await ctx.newAlbumAsset({ albumId: album.id, assetId: timelineAsset.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: archiveAsset.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: hiddenAsset.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: lockedAsset.id });

    await ctx.newExif({ assetId: timelineAsset.id, make: 'TimelineCam' });
    await ctx.newExif({ assetId: archiveAsset.id, make: 'ArchiveCam' });
    await ctx.newExif({ assetId: hiddenAsset.id, make: 'HiddenCam' });
    await ctx.newExif({ assetId: lockedAsset.id, make: 'LockedCam' });

    const membershipResponse = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
    await ctx.syncAckAll(auth, membershipResponse);

    const response = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAlbumAssetExifsV1]);
    const exifEvents = response.filter((r) => isAlbumAssetExifEvent(r));
    const emittedAssetIds = exifEvents.map((e) => (e as { data: { assetId: string } }).data.assetId);

    expect(emittedAssetIds).toContain(timelineAsset.id);
    expect(emittedAssetIds).toContain(archiveAsset.id);
    expect(emittedAssetIds).not.toContain(hiddenAsset.id);
    expect(emittedAssetIds).not.toContain(lockedAsset.id);
  });

  it('does not emit exif for a Hidden album asset on the exif-update path', async () => {
    const { auth, ctx } = await setup();
    const { user: owner } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: auth.user.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });

    const { asset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    await ctx.newExif({ assetId: asset.id, make: 'OldMake' });

    const membershipResponse = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
    await ctx.syncAckAll(auth, membershipResponse);

    const initial = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAlbumAssetExifsV1]);
    await ctx.syncAckAll(auth, initial);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.SharedSpaceAlbumAssetExifsV1]);

    // Flip asset to Hidden, then update exif — must NOT re-emit.
    await defaultDatabase
      .updateTable('asset')
      .set({ visibility: AssetVisibility.Hidden })
      .where('id', '=', asset.id)
      .execute();
    await ctx.newExif({ assetId: asset.id, make: 'NewMake' });

    const next = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAlbumAssetExifsV1]);
    const exifEvents = next.filter((r) => isAlbumAssetExifEvent(r));
    const emittedAssetIds = exifEvents.map((e) => (e as { data: { assetId: string } }).data.assetId);
    expect(emittedAssetIds).not.toContain(asset.id);
  });
});
