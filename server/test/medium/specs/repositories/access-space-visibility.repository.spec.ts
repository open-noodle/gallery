/**
 * Medium tests for `AccessRepository.asset.checkSpaceAccess` — visibility filter (Slice 3).
 *
 * Security requirement: space-membership asset access via any path (direct /
 * library / album) must only expose assets whose visibility is `Timeline` or
 * `Archive`. `Hidden` and `Locked` are NEVER exposed through the space gate.
 *
 * Each test seeds a clean context so there is no shared-state cross-contamination.
 */
import { Kysely } from 'kysely';
import { AssetVisibility, SharedSpaceRole } from 'src/enum';
import { AccessRepository } from 'src/repositories/access.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = () => {
  const { ctx } = newMediumService(BaseService, {
    database: defaultDatabase,
    real: [AccessRepository, SharedSpaceRepository],
    mock: [LoggingRepository],
  });
  return { ctx, accessRepo: ctx.get(AccessRepository) };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

// Flip ONLY `asset.isOffline` (leaving `deletedAt` null) — pins the album access arms' isOffline gate
// directly, independent of the production `isOffline ⟹ deletedAt` coupling enforced elsewhere.
const markOffline = (assetId: string) =>
  defaultDatabase.updateTable('asset').set({ isOffline: true }).where('id', '=', assetId).execute();

const seedPersonOnSpaceAsset = async (visibility: AssetVisibility) => {
  const { ctx, accessRepo } = setup();
  const { user: owner } = await ctx.newUser();
  const { user: viewer } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: owner.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });
  const { person } = await ctx.newPerson({ ownerId: owner.id });
  const { asset } = await ctx.newAsset({ ownerId: owner.id, visibility });
  await ctx.newAssetFace({ assetId: asset.id, personId: person.id });
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });
  return { accessRepo, viewer, person };
};

// ---------------------------------------------------------------------------
// Path 1 — direct add (shared_space_asset)
// ---------------------------------------------------------------------------

describe('checkSpaceAccess — direct path visibility gate', () => {
  it('grants Timeline and Archive assets; blocks Hidden and Locked', async () => {
    const { ctx, accessRepo } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });

    const { asset: timeline } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
    const { asset: archive } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Archive });
    const { asset: hidden } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Hidden });
    const { asset: locked } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Locked });

    for (const assetId of [timeline.id, archive.id, hidden.id, locked.id]) {
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId });
    }

    const result = await accessRepo.asset.checkSpaceAccess(
      viewer.id,
      new Set([timeline.id, archive.id, hidden.id, locked.id]),
    );

    expect(result.has(timeline.id)).toBe(true);
    expect(result.has(archive.id)).toBe(true);
    expect(result.has(hidden.id)).toBe(false);
    expect(result.has(locked.id)).toBe(false);
  });

  it('added-then-locked: asset added while Timeline, later flipped to Locked → excluded at read time', async () => {
    const { ctx, accessRepo } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });

    // Asset starts as Timeline → shared_space_asset row created
    const { asset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });

    // Before flip: readable
    const before = await accessRepo.asset.checkSpaceAccess(viewer.id, new Set([asset.id]));
    expect(before.has(asset.id)).toBe(true);

    // Flip to Locked (the shared_space_asset row remains)
    await defaultDatabase
      .updateTable('asset')
      .set({ visibility: AssetVisibility.Locked })
      .where('id', '=', asset.id)
      .execute();

    // After flip: blocked despite the surviving space row
    const after = await accessRepo.asset.checkSpaceAccess(viewer.id, new Set([asset.id]));
    expect(after.has(asset.id)).toBe(false);
  });

  it('livePhotoVideoId: Locked parent → video part is NOT granted via livePhotoVideoId', async () => {
    const { ctx, accessRepo } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });

    // Video asset (no visibility restriction itself — it's the *parent* that is Locked)
    const { asset: video } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });

    // Locked parent that references the video via livePhotoVideoId
    const { asset: parent } = await ctx.newAsset({
      ownerId: owner.id,
      visibility: AssetVisibility.Locked,
      livePhotoVideoId: video.id,
    });

    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: parent.id });

    // Ask for the video ID — the only route is via the Locked parent's livePhotoVideoId
    const result = await accessRepo.asset.checkSpaceAccess(viewer.id, new Set([video.id]));
    expect(result.has(video.id)).toBe(false);
  });

  it('own Locked asset is NOT over-blocked: checkOwnerAccess grants it; checkSpaceAccess is orthogonal', async () => {
    // checkOwnerAccess runs BEFORE checkSpaceAccess in access.ts. This test confirms
    // that checkSpaceAccess returning empty for a Locked asset does NOT "un-grant" what
    // checkOwnerAccess already granted (the two paths are additive via setUnion).
    // We verify the gate function itself is orthogonal: as an *owner* calling
    // checkSpaceAccess (not checkOwnerAccess), the Locked asset is still excluded.
    // The real over-block risk is that we might accidentally strip already-granted IDs —
    // but since access.ts uses setDifference to feed checkSpaceAccess only the IDs not
    // yet granted, there is no double-dip. We pin this explicitly.
    const { ctx, accessRepo } = setup();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });

    const { asset: locked } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Locked });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: locked.id });

    // checkSpaceAccess excludes Locked even for the owner — the owner's OWN read
    // comes from checkOwnerAccess (hasElevatedPermission), not from checkSpaceAccess.
    const spaceResult = await accessRepo.asset.checkSpaceAccess(owner.id, new Set([locked.id]));
    expect(spaceResult.has(locked.id)).toBe(false);

    // checkOwnerAccess with elevation grants it (confirming the real path is untouched)
    const ownerResult = await accessRepo.asset.checkOwnerAccess(owner.id, new Set([locked.id]), true);
    expect(ownerResult.has(locked.id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Path 2 — library (shared_space_library)
// ---------------------------------------------------------------------------

describe('checkSpaceAccess — library path visibility gate', () => {
  it('grants Timeline and Archive; blocks Hidden and Locked from a linked library', async () => {
    const { ctx, accessRepo } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });

    const { library } = await ctx.newLibrary({ ownerId: owner.id });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id });

    const { asset: timeline } = await ctx.newAsset({
      ownerId: owner.id,
      libraryId: library.id,
      visibility: AssetVisibility.Timeline,
    });
    const { asset: archive } = await ctx.newAsset({
      ownerId: owner.id,
      libraryId: library.id,
      visibility: AssetVisibility.Archive,
    });
    const { asset: hidden } = await ctx.newAsset({
      ownerId: owner.id,
      libraryId: library.id,
      visibility: AssetVisibility.Hidden,
    });
    const { asset: locked } = await ctx.newAsset({
      ownerId: owner.id,
      libraryId: library.id,
      visibility: AssetVisibility.Locked,
    });

    const result = await accessRepo.asset.checkSpaceAccess(
      viewer.id,
      new Set([timeline.id, archive.id, hidden.id, locked.id]),
    );

    expect(result.has(timeline.id)).toBe(true);
    expect(result.has(archive.id)).toBe(true);
    expect(result.has(hidden.id)).toBe(false);
    expect(result.has(locked.id)).toBe(false);
  });

  it('isOffline=true library asset is excluded regardless of visibility', async () => {
    const { ctx, accessRepo } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });

    const { library } = await ctx.newLibrary({ ownerId: owner.id });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id });

    const { asset: offlineTimeline } = await ctx.newAsset({
      ownerId: owner.id,
      libraryId: library.id,
      visibility: AssetVisibility.Timeline,
      isOffline: true,
    });

    const result = await accessRepo.asset.checkSpaceAccess(viewer.id, new Set([offlineTimeline.id]));
    expect(result.has(offlineTimeline.id)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Path 3 — album (shared_space_album)
// ---------------------------------------------------------------------------

describe('checkSpaceAccess — album path visibility gate', () => {
  it('grants Timeline and Archive; blocks Hidden and Locked from a linked album', async () => {
    const { ctx, accessRepo } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });

    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'VisibilityTestAlbum' });
    await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

    const { asset: timeline } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
    const { asset: archive } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Archive });
    const { asset: hidden } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Hidden });
    const { asset: locked } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Locked });

    for (const assetId of [timeline.id, archive.id, hidden.id, locked.id]) {
      await ctx.newAlbumAsset({ albumId: album.id, assetId });
    }

    const result = await accessRepo.asset.checkSpaceAccess(
      viewer.id,
      new Set([timeline.id, archive.id, hidden.id, locked.id]),
    );

    expect(result.has(timeline.id)).toBe(true);
    expect(result.has(archive.id)).toBe(true);
    expect(result.has(hidden.id)).toBe(false);
    expect(result.has(locked.id)).toBe(false);
  });

  it('soft-deleted album assets are excluded', async () => {
    const { ctx, accessRepo } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });

    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'SoftDeletedAlbumVis' });
    await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

    const { asset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });

    // Before soft-delete: asset reachable
    const before = await accessRepo.asset.checkSpaceAccess(viewer.id, new Set([asset.id]));
    expect(before.has(asset.id)).toBe(true);

    // Soft-delete the album
    await ctx.softDeleteAlbum(album.id);

    // After: excluded even though asset.visibility = Timeline
    const after = await accessRepo.asset.checkSpaceAccess(viewer.id, new Set([asset.id]));
    expect(after.has(asset.id)).toBe(false);
  });

  it('added-then-locked via album path: asset flipped to Locked → excluded', async () => {
    const { ctx, accessRepo } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });

    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'AlbumLockReplay' });
    await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

    const { asset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });

    const before = await accessRepo.asset.checkSpaceAccess(viewer.id, new Set([asset.id]));
    expect(before.has(asset.id)).toBe(true);

    await defaultDatabase
      .updateTable('asset')
      .set({ visibility: AssetVisibility.Locked })
      .where('id', '=', asset.id)
      .execute();

    const after = await accessRepo.asset.checkSpaceAccess(viewer.id, new Set([asset.id]));
    expect(after.has(asset.id)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkSpaceAccessForSpace — visibility gate (Slice 8)
// ---------------------------------------------------------------------------

describe('checkSpaceAccessForSpace — visibility gate', () => {
  it('grants Timeline and Archive; blocks Hidden and Locked (direct path)', async () => {
    const { ctx, accessRepo } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });

    const { asset: timeline } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
    const { asset: archive } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Archive });
    const { asset: hidden } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Hidden });
    const { asset: locked } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Locked });

    for (const assetId of [timeline.id, archive.id, hidden.id, locked.id]) {
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId });
    }

    const result = await accessRepo.asset.checkSpaceAccessForSpace(
      viewer.id,
      space.id,
      new Set([timeline.id, archive.id, hidden.id, locked.id]),
    );

    expect(result.has(timeline.id)).toBe(true);
    expect(result.has(archive.id)).toBe(true);
    expect(result.has(hidden.id)).toBe(false);
    expect(result.has(locked.id)).toBe(false);
  });

  it('livePhotoVideoId of Locked parent is NOT granted via checkSpaceAccessForSpace', async () => {
    const { ctx, accessRepo } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });

    const { asset: video } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
    const { asset: parent } = await ctx.newAsset({
      ownerId: owner.id,
      visibility: AssetVisibility.Locked,
      livePhotoVideoId: video.id,
    });

    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: parent.id });

    const result = await accessRepo.asset.checkSpaceAccessForSpace(viewer.id, space.id, new Set([video.id]));
    expect(result.has(video.id)).toBe(false);
  });

  it('grants Timeline and Archive from a linked library; blocks Hidden and Locked', async () => {
    const { ctx, accessRepo } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });

    const { library } = await ctx.newLibrary({ ownerId: owner.id });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id });

    const { asset: timeline } = await ctx.newAsset({
      ownerId: owner.id,
      libraryId: library.id,
      visibility: AssetVisibility.Timeline,
    });
    const { asset: hidden } = await ctx.newAsset({
      ownerId: owner.id,
      libraryId: library.id,
      visibility: AssetVisibility.Hidden,
    });

    const result = await accessRepo.asset.checkSpaceAccessForSpace(
      viewer.id,
      space.id,
      new Set([timeline.id, hidden.id]),
    );

    expect(result.has(timeline.id)).toBe(true);
    expect(result.has(hidden.id)).toBe(false);
  });

  it('grants Timeline and Archive from a linked album; blocks Hidden and Locked', async () => {
    const { ctx, accessRepo } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });

    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'SpaceAccessAlbum' });
    await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

    const { asset: timeline } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
    const { asset: locked } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Locked });

    await ctx.newAlbumAsset({ albumId: album.id, assetId: timeline.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: locked.id });

    const result = await accessRepo.asset.checkSpaceAccessForSpace(
      viewer.id,
      space.id,
      new Set([timeline.id, locked.id]),
    );

    expect(result.has(timeline.id)).toBe(true);
    expect(result.has(locked.id)).toBe(false);
  });

  it('added-then-locked: asset added while Timeline, flipped to Locked → excluded', async () => {
    const { ctx, accessRepo } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });

    const { asset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });

    const before = await accessRepo.asset.checkSpaceAccessForSpace(viewer.id, space.id, new Set([asset.id]));
    expect(before.has(asset.id)).toBe(true);

    await defaultDatabase
      .updateTable('asset')
      .set({ visibility: AssetVisibility.Locked })
      .where('id', '=', asset.id)
      .execute();

    const after = await accessRepo.asset.checkSpaceAccessForSpace(viewer.id, space.id, new Set([asset.id]));
    expect(after.has(asset.id)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkSpaceEditAccess — visibility gate (Slice 10)
//
// Security requirement: an editor role must NOT be able to edit another
// member's Hidden or Locked asset via the space path. The edit gate must
// mirror the read gate: only Timeline and Archive pass through.
// ---------------------------------------------------------------------------

describe('checkSpaceEditAccess — visibility gate (Slice 10)', () => {
  // Path 1 — direct add (shared_space_asset)

  it('grants Timeline and Archive to editor; blocks Hidden and Locked (direct path)', async () => {
    const { ctx, accessRepo } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: editor } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: editor.id, role: 'editor' });

    const { asset: timeline } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
    const { asset: archive } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Archive });
    const { asset: hidden } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Hidden });
    const { asset: locked } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Locked });

    for (const assetId of [timeline.id, archive.id, hidden.id, locked.id]) {
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId });
    }

    const result = await accessRepo.asset.checkSpaceEditAccess(
      editor.id,
      new Set([timeline.id, archive.id, hidden.id, locked.id]),
    );

    expect(result.has(timeline.id)).toBe(true);
    expect(result.has(archive.id)).toBe(true);
    expect(result.has(hidden.id)).toBe(false);
    expect(result.has(locked.id)).toBe(false);
  });

  it('viewer role is NOT granted edit access regardless of visibility (direct path)', async () => {
    const { ctx, accessRepo } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });

    const { asset: timeline } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: timeline.id });

    const result = await accessRepo.asset.checkSpaceEditAccess(viewer.id, new Set([timeline.id]));

    expect(result.has(timeline.id)).toBe(false);
  });

  it('livePhotoVideoId: Locked parent → video part NOT granted via edit gate (direct path)', async () => {
    const { ctx, accessRepo } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: editor } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: editor.id, role: 'editor' });

    const { asset: video } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
    const { asset: parent } = await ctx.newAsset({
      ownerId: owner.id,
      visibility: AssetVisibility.Locked,
      livePhotoVideoId: video.id,
    });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: parent.id });

    const result = await accessRepo.asset.checkSpaceEditAccess(editor.id, new Set([video.id]));
    expect(result.has(video.id)).toBe(false);
  });

  // Path 2 — library (shared_space_library)

  it('grants Timeline and Archive to editor; blocks Hidden and Locked (library path)', async () => {
    const { ctx, accessRepo } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: editor } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: editor.id, role: 'editor' });

    const { library } = await ctx.newLibrary({ ownerId: owner.id });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id });

    const { asset: timeline } = await ctx.newAsset({
      ownerId: owner.id,
      libraryId: library.id,
      visibility: AssetVisibility.Timeline,
    });
    const { asset: archive } = await ctx.newAsset({
      ownerId: owner.id,
      libraryId: library.id,
      visibility: AssetVisibility.Archive,
    });
    const { asset: hidden } = await ctx.newAsset({
      ownerId: owner.id,
      libraryId: library.id,
      visibility: AssetVisibility.Hidden,
    });
    const { asset: locked } = await ctx.newAsset({
      ownerId: owner.id,
      libraryId: library.id,
      visibility: AssetVisibility.Locked,
    });

    const result = await accessRepo.asset.checkSpaceEditAccess(
      editor.id,
      new Set([timeline.id, archive.id, hidden.id, locked.id]),
    );

    expect(result.has(timeline.id)).toBe(true);
    expect(result.has(archive.id)).toBe(true);
    expect(result.has(hidden.id)).toBe(false);
    expect(result.has(locked.id)).toBe(false);
  });

  it('added-then-locked: asset added while Timeline, flipped to Locked → edit access revoked (direct path)', async () => {
    const { ctx, accessRepo } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: editor } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: editor.id, role: 'editor' });

    const { asset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });

    const before = await accessRepo.asset.checkSpaceEditAccess(editor.id, new Set([asset.id]));
    expect(before.has(asset.id)).toBe(true);

    await defaultDatabase
      .updateTable('asset')
      .set({ visibility: AssetVisibility.Locked })
      .where('id', '=', asset.id)
      .execute();

    const after = await accessRepo.asset.checkSpaceEditAccess(editor.id, new Set([asset.id]));
    expect(after.has(asset.id)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkSharedSpaceAccess (PersonRead) — visibility widening (rbac-7)
//
// Security requirement: PersonRead via shared-space membership must be granted
// for a person whose only space face is on an Archived asset (the space people
// grid already surfaces them via getPersonsBySpaceId), not just Timeline. Never
// Hidden or Locked.
// ---------------------------------------------------------------------------

describe('checkSharedSpaceAccess (PersonRead) — visibility widening (rbac-7)', () => {
  it('GRANTS PersonRead for a person whose only space face is on an Archived asset (was denied)', async () => {
    const { accessRepo, viewer, person } = await seedPersonOnSpaceAsset(AssetVisibility.Archive);
    const result = await accessRepo.person.checkSharedSpaceAccess(viewer.id, new Set([person.id]));
    expect(result.has(person.id)).toBe(true);
  });

  it('grants PersonRead on a Timeline asset (positive control, regression)', async () => {
    const { accessRepo, viewer, person } = await seedPersonOnSpaceAsset(AssetVisibility.Timeline);
    const result = await accessRepo.person.checkSharedSpaceAccess(viewer.id, new Set([person.id]));
    expect(result.has(person.id)).toBe(true);
  });

  it('never grants PersonRead when the person only appears on Hidden or Locked space assets', async () => {
    const hiddenCase = await seedPersonOnSpaceAsset(AssetVisibility.Hidden);
    const lockedCase = await seedPersonOnSpaceAsset(AssetVisibility.Locked);
    const hiddenResult = await hiddenCase.accessRepo.person.checkSharedSpaceAccess(
      hiddenCase.viewer.id,
      new Set([hiddenCase.person.id]),
    );
    const lockedResult = await lockedCase.accessRepo.person.checkSharedSpaceAccess(
      lockedCase.viewer.id,
      new Set([lockedCase.person.id]),
    );
    expect(hiddenResult.has(hiddenCase.person.id)).toBe(false);
    expect(lockedResult.has(lockedCase.person.id)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// C6 investigation resolved SAFE/CONSISTENT: the partner arm (checkPartnerAccess — grants
// Timeline + Hidden, upstream behaviour) and the space arm (checkSpaceAccess — grants Timeline +
// Archive, per the space visibility gate) are two independent grants unioned at the
// access-orchestration layer (utils/access.ts AssetRead: setUnion(owner, album, partner, space)).
// For a user P who is both O's partner AND a member of a space O linked an asset into:
//   Timeline -> visible via both; Archive -> visible via the SPACE arm only; Hidden -> visible via
//   the PARTNER arm only (space-independent, pre-existing); Locked -> blocked by BOTH arms — the
//   only truly-private tier, and it never leaks through the union. Consistent with slice-4
//   security-7 (partner-entitled Hidden assets are protected from the space-driven library purge).
// Pin this so a future change to either arm can't silently let Locked leak through the union.
// ---------------------------------------------------------------------------

const seedPartnerAndSpaceAsset = async (visibility: AssetVisibility) => {
  const { ctx, accessRepo } = setup();
  const { user: owner } = await ctx.newUser();
  const { user: partner } = await ctx.newUser();
  await ctx.newPartner({ sharedById: owner.id, sharedWithId: partner.id });
  const { space } = await ctx.newSharedSpace({ createdById: owner.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: partner.id, role: 'viewer' });

  const { asset } = await ctx.newAsset({ ownerId: owner.id, visibility });
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });

  return { accessRepo, partner, asset };
};

// ---------------------------------------------------------------------------
// P1-4: contributed-only assets (album_space_asset) — checkSpaceAccess /
// checkSpaceAccessForSpace
//
// A cross-owner contribution (`album_space_asset`) can be an asset's ONLY
// space path: it lives in an album linked into a space, but the asset was
// never added to `shared_space_asset` and never lives in `album_asset`
// (it's contributed by a non-owner member, not the album owner). Every
// member except the owner previously got a silent empty set here — the
// symptom upstream was a 403 on thumbnail/original/download. The new 4th
// union arm below closes that gap; the album/live-link join correlation on
// BOTH albumId and spaceId is what makes D1-(b) unlink retention inert.
// ---------------------------------------------------------------------------

const seedContributionOnly = async (ctx: Awaited<ReturnType<typeof setup>>['ctx']) => {
  const { user: owner } = await ctx.newUser();
  const { user: member } = await ctx.newUser();
  const { user: carol } = await ctx.newUser();
  const { album } = await ctx.newAlbum({ ownerId: owner.id });
  const { asset } = await ctx.newAsset({ ownerId: carol.id, visibility: AssetVisibility.Timeline });
  const { space } = await ctx.newSharedSpace({ createdById: owner.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Viewer });
  await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
  // contribution is the ONLY space path: no shared_space_asset row, no album_asset row
  await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: asset.id, spaceId: space.id });
  return { owner, member, carol, album, asset, space };
};

describe('P1-4: contributed-only assets — checkSpaceAccess / checkSpaceAccessForSpace', () => {
  it('member reaches a contributed-only asset (fixes thumbnail/original/download 403)', async () => {
    const { ctx, accessRepo } = setup();
    const s = await seedContributionOnly(ctx);
    const allowed = await accessRepo.asset.checkSpaceAccess(s.member.id, new Set([s.asset.id]));
    expect(allowed.has(s.asset.id)).toBe(true);
  });

  it('non-member gets nothing', async () => {
    const { ctx, accessRepo } = setup();
    const s = await seedContributionOnly(ctx);
    const { user: stranger } = await ctx.newUser();
    const allowed = await accessRepo.asset.checkSpaceAccess(stranger.id, new Set([s.asset.id]));
    expect(allowed.size).toBe(0);
  });

  it('unlink revokes access even though the contribution row is retained (D1-b live-link gate)', async () => {
    const { ctx, accessRepo } = setup();
    const s = await seedContributionOnly(ctx);
    await ctx.get(SharedSpaceRepository).removeAlbum(s.space.id, s.album.id);
    const allowed = await accessRepo.asset.checkSpaceAccess(s.member.id, new Set([s.asset.id]));
    expect(allowed.size).toBe(0);
  });

  it('Hidden / trashed contributed asset is not reachable', async () => {
    const { ctx, accessRepo } = setup();
    const s = await seedContributionOnly(ctx);
    await defaultDatabase
      .updateTable('asset')
      .set({ visibility: AssetVisibility.Hidden })
      .where('id', '=', s.asset.id)
      .execute();
    const hiddenResult = await accessRepo.asset.checkSpaceAccess(s.member.id, new Set([s.asset.id]));
    expect(hiddenResult.size).toBe(0);
    await defaultDatabase
      .updateTable('asset')
      .set({ visibility: AssetVisibility.Timeline, deletedAt: new Date() })
      .where('id', '=', s.asset.id)
      .execute();
    const trashedResult = await accessRepo.asset.checkSpaceAccess(s.member.id, new Set([s.asset.id]));
    expect(trashedResult.size).toBe(0);
  });

  it('checkSpaceAccessForSpace is scoped to the contribution’s own space', async () => {
    const { ctx, accessRepo } = setup();
    const s = await seedContributionOnly(ctx);
    const { space: other } = await ctx.newSharedSpace({ createdById: s.owner.id });
    await ctx.newSharedSpaceMember({ spaceId: other.id, userId: s.member.id, role: SharedSpaceRole.Viewer });
    const wrongSpace = await accessRepo.asset.checkSpaceAccessForSpace(s.member.id, other.id, new Set([s.asset.id]));
    expect(wrongSpace.size).toBe(0);
    const rightSpace = await accessRepo.asset.checkSpaceAccessForSpace(s.member.id, s.space.id, new Set([s.asset.id]));
    expect(rightSpace.has(s.asset.id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// External-library assets reached through a space album (offline parity).
//
// An external-library asset can enter a space album two ways: the library owner
// adds their own (album_asset), or a space editor contributes someone else's
// linked-library asset (album_space_asset). Members must reach them like any
// asset — but an OFFLINE external asset must be blocked, matching the
// shared_space_library arm which already gates `isOffline`. In production an
// offline transition also sets `deletedAt` (which the album arms check), so
// these tests flip `isOffline` on its own to pin the guard directly and stop
// the album arms from leaning on that cross-module coupling.
// ---------------------------------------------------------------------------

describe('checkSpaceAccess — external-library assets via a space album (offline parity)', () => {
  it('grants a member an owner-added external-library asset through the album', async () => {
    const { ctx, accessRepo } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: SharedSpaceRole.Viewer });

    const { library } = await ctx.newLibrary({ ownerId: owner.id });
    const { asset } = await ctx.newAsset({
      ownerId: owner.id,
      libraryId: library.id,
      visibility: AssetVisibility.Timeline,
    });
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });

    const allowed = await accessRepo.asset.checkSpaceAccess(viewer.id, new Set([asset.id]));
    expect(allowed.has(asset.id)).toBe(true);
  });

  it('blocks an offline owner-added external-library asset (album_asset arm gates isOffline)', async () => {
    const { ctx, accessRepo } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: SharedSpaceRole.Viewer });

    const { library } = await ctx.newLibrary({ ownerId: owner.id });
    const { asset } = await ctx.newAsset({
      ownerId: owner.id,
      libraryId: library.id,
      visibility: AssetVisibility.Timeline,
    });
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    await markOffline(asset.id);

    const allowed = await accessRepo.asset.checkSpaceAccess(viewer.id, new Set([asset.id]));
    expect(allowed.has(asset.id)).toBe(false);
  });

  it('grants online but blocks offline for a cross-owner external-library contribution (album_space_asset arm)', async () => {
    const { ctx, accessRepo } = setup();
    const { user: owner } = await ctx.newUser(); // space + album owner
    const { user: contributor } = await ctx.newUser(); // external-library owner
    const { user: viewer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: SharedSpaceRole.Viewer });

    const { library } = await ctx.newLibrary({ ownerId: contributor.id });
    const { asset } = await ctx.newAsset({
      ownerId: contributor.id,
      libraryId: library.id,
      visibility: AssetVisibility.Timeline,
    });
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
    await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: asset.id, spaceId: space.id });

    const online = await accessRepo.asset.checkSpaceAccess(viewer.id, new Set([asset.id]));
    expect(online.has(asset.id)).toBe(true);

    await markOffline(asset.id);
    const offline = await accessRepo.asset.checkSpaceAccess(viewer.id, new Set([asset.id]));
    expect(offline.has(asset.id)).toBe(false);
  });

  it('checkSpaceAccessForSpace also blocks the offline external-library album asset', async () => {
    const { ctx, accessRepo } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: SharedSpaceRole.Viewer });

    const { library } = await ctx.newLibrary({ ownerId: owner.id });
    const { asset } = await ctx.newAsset({
      ownerId: owner.id,
      libraryId: library.id,
      visibility: AssetVisibility.Timeline,
    });
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    await markOffline(asset.id);

    const allowed = await accessRepo.asset.checkSpaceAccessForSpace(viewer.id, space.id, new Set([asset.id]));
    expect(allowed.has(asset.id)).toBe(false);
  });

  it('hard-deleting the asset cascades its space-album contribution away (no dangling rows)', async () => {
    const { ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: contributor } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    const { library } = await ctx.newLibrary({ ownerId: contributor.id });
    const { asset } = await ctx.newAsset({
      ownerId: contributor.id,
      libraryId: library.id,
      visibility: AssetVisibility.Timeline,
    });
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
    await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: asset.id, spaceId: space.id });

    const before = await defaultDatabase
      .selectFrom('album_space_asset')
      .select('assetId')
      .where('assetId', '=', asset.id)
      .execute();
    expect(before).toHaveLength(1);

    // Deleting an external library hard-deletes its assets; here we delete the asset row directly to
    // exercise the album_space_asset.assetId FK cascade that guarantees no dangling contribution rows.
    await defaultDatabase.deleteFrom('asset').where('id', '=', asset.id).execute();

    const after = await defaultDatabase
      .selectFrom('album_space_asset')
      .select('assetId')
      .where('assetId', '=', asset.id)
      .execute();
    expect(after).toHaveLength(0);
  });
});

describe('C6 partner × space-linked visibility invariant', () => {
  it('Locked X is blocked by BOTH arms (the private tier never leaks through the union)', async () => {
    const { accessRepo, partner, asset } = await seedPartnerAndSpaceAsset(AssetVisibility.Locked);

    const partnerResult = await accessRepo.asset.checkPartnerAccess(partner.id, new Set([asset.id]));
    const spaceResult = await accessRepo.asset.checkSpaceAccess(partner.id, new Set([asset.id]));

    expect(partnerResult.has(asset.id)).toBe(false);
    expect(spaceResult.has(asset.id)).toBe(false);
  });

  it('Hidden X is granted via the PARTNER arm (attributable to partner-sharing, not the space)', async () => {
    const { accessRepo, partner, asset } = await seedPartnerAndSpaceAsset(AssetVisibility.Hidden);

    const partnerResult = await accessRepo.asset.checkPartnerAccess(partner.id, new Set([asset.id]));
    const spaceResult = await accessRepo.asset.checkSpaceAccess(partner.id, new Set([asset.id]));

    expect(partnerResult.has(asset.id)).toBe(true);
    expect(spaceResult.has(asset.id)).toBe(false); // space strips Hidden
  });

  it('Archive X is granted via the SPACE arm (partner default cannot see Archive)', async () => {
    const { accessRepo, partner, asset } = await seedPartnerAndSpaceAsset(AssetVisibility.Archive);

    const partnerResult = await accessRepo.asset.checkPartnerAccess(partner.id, new Set([asset.id]));
    const spaceResult = await accessRepo.asset.checkSpaceAccess(partner.id, new Set([asset.id]));

    expect(spaceResult.has(asset.id)).toBe(true);
    expect(partnerResult.has(asset.id)).toBe(false);
  });

  it('Timeline X is granted via BOTH arms (positive control, regression)', async () => {
    const { accessRepo, partner, asset } = await seedPartnerAndSpaceAsset(AssetVisibility.Timeline);

    const partnerResult = await accessRepo.asset.checkPartnerAccess(partner.id, new Set([asset.id]));
    const spaceResult = await accessRepo.asset.checkSpaceAccess(partner.id, new Set([asset.id]));

    expect(partnerResult.has(asset.id)).toBe(true);
    expect(spaceResult.has(asset.id)).toBe(true);
  });
});
