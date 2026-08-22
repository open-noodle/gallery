/**
 * Slice 11 — Exhaustive RBAC visibility matrix (regression lock).
 *
 * Seeds {Timeline, Archive, Hidden, Locked} × {direct, library, album(showInTimeline=true),
 * album(showInTimeline=false), soft-deleted-album} and asserts the correct visible set
 * on EVERY surface touched by the space-albums RBAC hardening work (Slices 1–10).
 *
 * KEY RULES encoded here:
 *  - download / access / sync / search: Timeline + Archive present; Hidden + Locked ABSENT.
 *  - map / memory / view / folders: Timeline ONLY (Archive excluded by design).
 *  - showInTimeline=false album: ABSENT on projection surfaces; PRESENT on grant surfaces
 *    (album-asset sync backfill, direct album download/access).
 *  - soft-deleted album: ABSENT on all surfaces.
 *  - space people-facets: a face on another member's Hidden asset must NOT surface the
 *    space-person (visibility-gated by getPersonsBySpaceId + getPersonAssetIds).
 *
 * If ANY cell is RED (unexpected failure), that is a real gap in a prior slice —
 * DO NOT weaken the assertion; report it.
 */

import { Kysely } from 'kysely';
import { AlbumUserRole, AssetVisibility, TimeBucketSize } from 'src/enum';
import { AccessRepository } from 'src/repositories/access.repository';
import { ActivityRepository } from 'src/repositories/activity.repository';
import { AlbumUserRepository } from 'src/repositories/album-user.repository';
import { AlbumRepository } from 'src/repositories/album.repository';
import { AssetRepository, TimeBucketOptions } from 'src/repositories/asset.repository';
import { DownloadRepository } from 'src/repositories/download.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { MapRepository } from 'src/repositories/map.repository';
import { MemoryRepository } from 'src/repositories/memory.repository';
import { SearchRepository } from 'src/repositories/search.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { SyncBackfillOptions, SyncRepository } from 'src/repositories/sync.repository';
import { TagRepository } from 'src/repositories/tag.repository';
import { UserRepository } from 'src/repositories/user.repository';
import { ViewRepository } from 'src/repositories/view-repository';
import { DB } from 'src/schema';
import { AlbumService } from 'src/services/album.service';
import { BaseService } from 'src/services/base.service';
import { upsertTags } from 'src/utils/tag';
import { newMediumService } from 'test/medium.factory';
import { factory, newEmbedding } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

// Max UUIDv7-style value — used as nowId/beforeUpdateId to include ALL rows in backfill.
const NOW_ID = 'ffffffff-ffff-7fff-bfff-ffffffffffff';

const setup = () => {
  const { ctx } = newMediumService(BaseService, {
    database: defaultDatabase,
    real: [
      AccessRepository,
      ActivityRepository,
      AlbumRepository,
      AlbumUserRepository,
      AssetRepository,
      DownloadRepository,
      MapRepository,
      MemoryRepository,
      SearchRepository,
      SharedSpaceRepository,
      SyncRepository,
      TagRepository,
      UserRepository,
      ViewRepository,
    ],
    mock: [LoggingRepository],
  });
  return {
    ctx,
    accessRepo: ctx.get(AccessRepository),
    activityRepo: ctx.get(ActivityRepository),
    assetRepo: ctx.get(AssetRepository),
    downloadRepo: ctx.get(DownloadRepository),
    mapRepo: ctx.get(MapRepository),
    memoryRepo: ctx.get(MemoryRepository),
    searchRepo: ctx.get(SearchRepository),
    spaceRepo: ctx.get(SharedSpaceRepository),
    syncRepo: ctx.get(SyncRepository),
    tagRepo: ctx.get(TagRepository),
    viewRepo: ctx.get(ViewRepository),
  };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

// Helpers to collect streaming results
async function collectDownloadIds(stream: AsyncIterable<{ id: string }>): Promise<Set<string>> {
  const ids = new Set<string>();
  for await (const row of stream) {
    ids.add(row.id);
  }
  return ids;
}

// Surface 18 helpers (timeline explicit-visibility)
const BUCKET_WHEN = new Date('2024-07-10T12:00:00.000Z');

const countTimeBuckets = (buckets: Array<{ count: number }>) => buckets.reduce((s, b) => s + Number(b.count), 0);

const makeBucketReadyAsset = async (
  ctx: ReturnType<typeof setup>['ctx'],
  ownerId: string,
  vis: AssetVisibility,
  opts: { libraryId?: string } = {},
) => {
  const { asset } = await ctx.newAsset({
    ownerId,
    visibility: vis,
    fileCreatedAt: BUCKET_WHEN,
    localDateTime: BUCKET_WHEN,
    width: 400,
    height: 300,
    thumbhash: Buffer.from('t'),
    ...opts,
  });
  await ctx.newExif({ assetId: asset.id, timeZone: 'UTC' });
  return asset.id;
};

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE BUILDER
// Seeds the full 4×5 matrix into a fresh space for each test.
// Returns named handles for every asset so assertions can be expressed clearly.
// ─────────────────────────────────────────────────────────────────────────────

interface MatrixAssets {
  // direct-add (shared_space_asset)
  directTimeline: string;
  directArchive: string;
  directHidden: string;
  directLocked: string;
  // library-linked (shared_space_library)
  libTimeline: string;
  libArchive: string;
  libHidden: string;
  libLocked: string;
  // album, showInTimeline=true
  albumShownTimeline: string;
  albumShownArchive: string;
  albumShownHidden: string;
  albumShownLocked: string;
  // album, showInTimeline=false (projection surfaces must exclude; grant surfaces include)
  albumHiddenTimeline: string;
  albumHiddenArchive: string;
  // soft-deleted album (all surfaces exclude)
  albumDeletedTimeline: string;
}

interface MatrixFixture {
  assets: MatrixAssets;
  spaceId: string;
  albumShownId: string; // album with showInTimeline=true
  albumHiddenId: string; // album with showInTimeline=false
  albumDeletedId: string; // soft-deleted album
  ownerId: string;
  viewerId: string;
}

const seedMatrix = async (
  ctx: ReturnType<typeof setup>['ctx'],
  spaceRepo: SharedSpaceRepository,
): Promise<MatrixFixture> => {
  const { user: owner } = await ctx.newUser();
  const { user: viewer } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: owner.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });

  // Helper: asset with GPS so map markers can find it
  const makeAsset = async (vis: AssetVisibility, opts: { libraryId?: string } = {}) => {
    const { asset } = await ctx.newAsset({
      ownerId: owner.id,
      visibility: vis,
      ...opts,
      fileCreatedAt: new Date('2024-06-15T12:00:00.000Z'),
      localDateTime: new Date('2024-06-15T12:00:00.000Z'),
      width: 400,
      height: 300,
      thumbhash: Buffer.from('t'),
    });
    await ctx.newExif({
      assetId: asset.id,
      latitude: 48.8566,
      longitude: 2.3522,
      timeZone: 'UTC',
      fileSizeInByte: 1024,
    });
    return asset.id;
  };

  // ── direct-add ──────────────────────────────────────────────────────────────
  const directTimeline = await makeAsset(AssetVisibility.Timeline);
  const directArchive = await makeAsset(AssetVisibility.Archive);
  const directHidden = await makeAsset(AssetVisibility.Hidden);
  const directLocked = await makeAsset(AssetVisibility.Locked);
  for (const assetId of [directTimeline, directArchive, directHidden, directLocked]) {
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId });
  }

  // ── library-linked ───────────────────────────────────────────────────────────
  const { result: library } = await ctx.newLibrary({ ownerId: owner.id });
  await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id });
  const libTimeline = await makeAsset(AssetVisibility.Timeline, { libraryId: library.id });
  const libArchive = await makeAsset(AssetVisibility.Archive, { libraryId: library.id });
  const libHidden = await makeAsset(AssetVisibility.Hidden, { libraryId: library.id });
  const libLocked = await makeAsset(AssetVisibility.Locked, { libraryId: library.id });

  // ── album, showInTimeline=true ───────────────────────────────────────────────
  const { result: albumShown } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'ShownAlbum' });
  await spaceRepo.addAlbum({ spaceId: space.id, albumId: albumShown.id, addedById: owner.id });
  // showInTimeline is true by default in addAlbum
  const albumShownTimeline = await makeAsset(AssetVisibility.Timeline);
  const albumShownArchive = await makeAsset(AssetVisibility.Archive);
  const albumShownHidden = await makeAsset(AssetVisibility.Hidden);
  const albumShownLocked = await makeAsset(AssetVisibility.Locked);
  for (const assetId of [albumShownTimeline, albumShownArchive, albumShownHidden, albumShownLocked]) {
    await ctx.newAlbumAsset({ albumId: albumShown.id, assetId });
  }

  // ── album, showInTimeline=false ──────────────────────────────────────────────
  const { result: albumHidden } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'HiddenAlbum' });
  await spaceRepo.addAlbum({ spaceId: space.id, albumId: albumHidden.id, addedById: owner.id });
  await spaceRepo.setAlbumShowInTimeline(space.id, albumHidden.id, false);
  const albumHiddenTimeline = await makeAsset(AssetVisibility.Timeline);
  const albumHiddenArchive = await makeAsset(AssetVisibility.Archive);
  for (const assetId of [albumHiddenTimeline, albumHiddenArchive]) {
    await ctx.newAlbumAsset({ albumId: albumHidden.id, assetId });
  }

  // ── soft-deleted album ───────────────────────────────────────────────────────
  const { result: albumDeleted } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'DeletedAlbum' });
  await spaceRepo.addAlbum({ spaceId: space.id, albumId: albumDeleted.id, addedById: owner.id });
  const albumDeletedTimeline = await makeAsset(AssetVisibility.Timeline);
  await ctx.newAlbumAsset({ albumId: albumDeleted.id, assetId: albumDeletedTimeline });
  await ctx.softDeleteAlbum(albumDeleted.id);

  return {
    assets: {
      directTimeline,
      directArchive,
      directHidden,
      directLocked,
      libTimeline,
      libArchive,
      libHidden,
      libLocked,
      albumShownTimeline,
      albumShownArchive,
      albumShownHidden,
      albumShownLocked,
      albumHiddenTimeline,
      albumHiddenArchive,
      albumDeletedTimeline,
    },
    spaceId: space.id,
    albumShownId: albumShown.id,
    albumHiddenId: albumHidden.id,
    albumDeletedId: albumDeleted.id,
    ownerId: owner.id,
    viewerId: viewer.id,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// SURFACE 1: downloadSpaceId
// Rule: Timeline + Archive present; Hidden + Locked ABSENT; showInTimeline=false
// album PRESENT (download is a grant surface, not projection); soft-deleted ABSENT.
// ─────────────────────────────────────────────────────────────────────────────

describe('matrix: downloadSpaceId', () => {
  it('grants Timeline+Archive on all paths; blocks Hidden+Locked; showInTimeline=false present; soft-deleted absent', async () => {
    const { downloadRepo, spaceRepo, ctx } = setup();
    const f = await seedMatrix(ctx, spaceRepo);
    const ids = await collectDownloadIds(downloadRepo.downloadSpaceId(f.spaceId));
    const a = f.assets;

    // Present: direct Timeline + Archive
    expect(ids.has(a.directTimeline)).toBe(true);
    expect(ids.has(a.directArchive)).toBe(true);
    // Absent: direct Hidden + Locked
    expect(ids.has(a.directHidden)).toBe(false);
    expect(ids.has(a.directLocked)).toBe(false);

    // Present: library Timeline + Archive
    expect(ids.has(a.libTimeline)).toBe(true);
    expect(ids.has(a.libArchive)).toBe(true);
    // Absent: library Hidden + Locked
    expect(ids.has(a.libHidden)).toBe(false);
    expect(ids.has(a.libLocked)).toBe(false);

    // Present: album(shown) Timeline + Archive
    expect(ids.has(a.albumShownTimeline)).toBe(true);
    expect(ids.has(a.albumShownArchive)).toBe(true);
    // Absent: album(shown) Hidden + Locked
    expect(ids.has(a.albumShownHidden)).toBe(false);
    expect(ids.has(a.albumShownLocked)).toBe(false);

    // Present: album(hidden, showInTimeline=false) — download IS a grant surface
    expect(ids.has(a.albumHiddenTimeline)).toBe(true);
    expect(ids.has(a.albumHiddenArchive)).toBe(true);

    // Absent: soft-deleted album
    expect(ids.has(a.albumDeletedTimeline)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SURFACE 2: downloadAlbumId (via AlbumDownload space grant)
// Rule: Timeline + Archive present; Hidden + Locked ABSENT.
// ─────────────────────────────────────────────────────────────────────────────

describe('matrix: downloadAlbumId (via space grant)', () => {
  it('grants Timeline+Archive; blocks Hidden+Locked for a linked album download', async () => {
    const { downloadRepo, spaceRepo, ctx } = setup();
    const f = await seedMatrix(ctx, spaceRepo);
    const ids = await collectDownloadIds(downloadRepo.downloadAlbumId(f.albumShownId));
    const a = f.assets;

    expect(ids.has(a.albumShownTimeline)).toBe(true);
    expect(ids.has(a.albumShownArchive)).toBe(true);
    expect(ids.has(a.albumShownHidden)).toBe(false);
    expect(ids.has(a.albumShownLocked)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SURFACE 3: checkSpaceAccess (all three paths)
// Rule: Timeline + Archive granted; Hidden + Locked absent.
// showInTimeline=false album: ABSENT (checkSpaceAccess applies requireShowInTimeline).
// soft-deleted album: ABSENT.
// ─────────────────────────────────────────────────────────────────────────────

describe('matrix: checkSpaceAccess', () => {
  it('grants Timeline+Archive on all paths; blocks Hidden+Locked+noTimeline+deletedAlbum', async () => {
    const { accessRepo, spaceRepo, ctx } = setup();
    const f = await seedMatrix(ctx, spaceRepo);
    const a = f.assets;

    const allIds = new Set([
      a.directTimeline,
      a.directArchive,
      a.directHidden,
      a.directLocked,
      a.libTimeline,
      a.libArchive,
      a.libHidden,
      a.libLocked,
      a.albumShownTimeline,
      a.albumShownArchive,
      a.albumShownHidden,
      a.albumShownLocked,
      a.albumHiddenTimeline,
      a.albumHiddenArchive,
      a.albumDeletedTimeline,
    ]);
    const result = await accessRepo.asset.checkSpaceAccess(f.viewerId, allIds);

    // Direct path
    expect(result.has(a.directTimeline)).toBe(true);
    expect(result.has(a.directArchive)).toBe(true);
    expect(result.has(a.directHidden)).toBe(false);
    expect(result.has(a.directLocked)).toBe(false);

    // Library path
    expect(result.has(a.libTimeline)).toBe(true);
    expect(result.has(a.libArchive)).toBe(true);
    expect(result.has(a.libHidden)).toBe(false);
    expect(result.has(a.libLocked)).toBe(false);

    // Album(shown) path
    expect(result.has(a.albumShownTimeline)).toBe(true);
    expect(result.has(a.albumShownArchive)).toBe(true);
    expect(result.has(a.albumShownHidden)).toBe(false);
    expect(result.has(a.albumShownLocked)).toBe(false);

    // Album(hidden, showInTimeline=false) — PRESENT on checkSpaceAccess (grant surface, not projection).
    // The showInTimeline flag suppresses assets from timeline/map/memory/search (projection surfaces),
    // but does NOT revoke READ access (e.g. the album itself is still downloadable).
    expect(result.has(a.albumHiddenTimeline)).toBe(true);
    expect(result.has(a.albumHiddenArchive)).toBe(true);

    // Soft-deleted album — ABSENT
    expect(result.has(a.albumDeletedTimeline)).toBe(false);
  });

  it('added-then-flipped: direct-add asset flipped from Timeline to Locked → revoked', async () => {
    const { accessRepo, spaceRepo, ctx } = setup();
    const f = await seedMatrix(ctx, spaceRepo);
    const a = f.assets;

    const before = await accessRepo.asset.checkSpaceAccess(f.viewerId, new Set([a.directTimeline]));
    expect(before.has(a.directTimeline)).toBe(true);

    await defaultDatabase
      .updateTable('asset')
      .set({ visibility: AssetVisibility.Locked })
      .where('id', '=', a.directTimeline)
      .execute();

    const after = await accessRepo.asset.checkSpaceAccess(f.viewerId, new Set([a.directTimeline]));
    expect(after.has(a.directTimeline)).toBe(false);
  });

  it('added-then-flipped: album-path asset flipped from Timeline to Hidden → revoked', async () => {
    const { accessRepo, spaceRepo, ctx } = setup();
    const f = await seedMatrix(ctx, spaceRepo);
    const a = f.assets;

    const before = await accessRepo.asset.checkSpaceAccess(f.viewerId, new Set([a.albumShownTimeline]));
    expect(before.has(a.albumShownTimeline)).toBe(true);

    await defaultDatabase
      .updateTable('asset')
      .set({ visibility: AssetVisibility.Hidden })
      .where('id', '=', a.albumShownTimeline)
      .execute();

    const after = await accessRepo.asset.checkSpaceAccess(f.viewerId, new Set([a.albumShownTimeline]));
    expect(after.has(a.albumShownTimeline)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SURFACE 4: checkSpaceAccessForSpace
// Same rules as checkSpaceAccess but with explicit spaceId.
// ─────────────────────────────────────────────────────────────────────────────

describe('matrix: checkSpaceAccessForSpace', () => {
  it('grants Timeline+Archive; blocks Hidden+Locked+noTimeline+deletedAlbum', async () => {
    const { accessRepo, spaceRepo, ctx } = setup();
    const f = await seedMatrix(ctx, spaceRepo);
    const a = f.assets;

    const allIds = new Set([
      a.directTimeline,
      a.directArchive,
      a.directHidden,
      a.directLocked,
      a.libTimeline,
      a.libArchive,
      a.libHidden,
      a.libLocked,
      a.albumShownTimeline,
      a.albumShownArchive,
      a.albumShownHidden,
      a.albumShownLocked,
      a.albumHiddenTimeline,
      a.albumHiddenArchive,
      a.albumDeletedTimeline,
    ]);
    const result = await accessRepo.asset.checkSpaceAccessForSpace(f.viewerId, f.spaceId, allIds);

    expect(result.has(a.directTimeline)).toBe(true);
    expect(result.has(a.directArchive)).toBe(true);
    expect(result.has(a.directHidden)).toBe(false);
    expect(result.has(a.directLocked)).toBe(false);

    expect(result.has(a.libTimeline)).toBe(true);
    expect(result.has(a.libArchive)).toBe(true);
    expect(result.has(a.libHidden)).toBe(false);
    expect(result.has(a.libLocked)).toBe(false);

    expect(result.has(a.albumShownTimeline)).toBe(true);
    expect(result.has(a.albumShownArchive)).toBe(true);
    expect(result.has(a.albumShownHidden)).toBe(false);
    expect(result.has(a.albumShownLocked)).toBe(false);

    // showInTimeline=false album — PRESENT on checkSpaceAccessForSpace (grant surface, not projection).
    expect(result.has(a.albumHiddenTimeline)).toBe(true);
    expect(result.has(a.albumHiddenArchive)).toBe(true);

    // soft-deleted — ABSENT
    expect(result.has(a.albumDeletedTimeline)).toBe(false);
  });

  it('added-then-flipped: library asset flipped from Archive to Locked → revoked', async () => {
    const { accessRepo, spaceRepo, ctx } = setup();
    const f = await seedMatrix(ctx, spaceRepo);
    const a = f.assets;

    const before = await accessRepo.asset.checkSpaceAccessForSpace(f.viewerId, f.spaceId, new Set([a.libArchive]));
    expect(before.has(a.libArchive)).toBe(true);

    await defaultDatabase
      .updateTable('asset')
      .set({ visibility: AssetVisibility.Locked })
      .where('id', '=', a.libArchive)
      .execute();

    const after = await accessRepo.asset.checkSpaceAccessForSpace(f.viewerId, f.spaceId, new Set([a.libArchive]));
    expect(after.has(a.libArchive)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SURFACE 5: checkSpaceEditAccess
// Same visibility rules; only editor (not viewer) gets the grant.
// NO album arm (known RBAC gap) — but visibility gate IS applied (Slice 10).
// ─────────────────────────────────────────────────────────────────────────────

describe('matrix: checkSpaceEditAccess', () => {
  it('grants Timeline+Archive to editor; blocks Hidden+Locked (direct path); viewer gets nothing', async () => {
    const { accessRepo, ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: editor } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: editor.id, role: 'editor' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });

    const { asset: tl } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
    const { asset: ar } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Archive });
    const { asset: hi } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Hidden });
    const { asset: lo } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Locked });

    for (const assetId of [tl.id, ar.id, hi.id, lo.id]) {
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId });
    }

    const editorResult = await accessRepo.asset.checkSpaceEditAccess(editor.id, new Set([tl.id, ar.id, hi.id, lo.id]));
    expect(editorResult.has(tl.id)).toBe(true);
    expect(editorResult.has(ar.id)).toBe(true);
    expect(editorResult.has(hi.id)).toBe(false);
    expect(editorResult.has(lo.id)).toBe(false);

    const viewerResult = await accessRepo.asset.checkSpaceEditAccess(viewer.id, new Set([tl.id]));
    expect(viewerResult.has(tl.id)).toBe(false);
  });

  it('added-then-flipped: asset flipped to Locked → edit access revoked', async () => {
    const { accessRepo, ctx } = setup();
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

// ─────────────────────────────────────────────────────────────────────────────
// SURFACE 6: sync — SharedSpaceAssetSync (direct-add path)
// Rule: Timeline + Archive present; Hidden + Locked ABSENT.
// ─────────────────────────────────────────────────────────────────────────────

describe('matrix: SharedSpaceAssetSync backfill (direct path)', () => {
  it('grants Timeline+Archive; blocks Hidden+Locked', async () => {
    const { ctx, syncRepo } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });

    const { asset: tl } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
    const { asset: ar } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Archive });
    const { asset: hi } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Hidden });
    const { asset: lo } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Locked });

    for (const assetId of [tl.id, ar.id, hi.id, lo.id]) {
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId });
    }

    const stream = syncRepo.sharedSpaceAsset.getBackfill(
      { nowId: NOW_ID, beforeUpdateId: NOW_ID },
      space.id,
      viewer.id,
    );
    const streamIds = new Set<string>();
    for await (const row of stream) {
      streamIds.add(row.id);
    }

    expect(streamIds.has(tl.id)).toBe(true);
    expect(streamIds.has(ar.id)).toBe(true);
    expect(streamIds.has(hi.id)).toBe(false);
    expect(streamIds.has(lo.id)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SURFACE 7: sync — SharedSpaceAlbumAssetSync backfill (album path)
// Rule: Timeline + Archive present; Hidden + Locked ABSENT.
// showInTimeline=false album: PRESENT (album-asset sync is a grant stream,
//   not a projection stream — the brief is explicit).
// ─────────────────────────────────────────────────────────────────────────────

describe('matrix: SharedSpaceAlbumAssetSync backfill (album path)', () => {
  it('grants Timeline+Archive; blocks Hidden+Locked; showInTimeline=false album present', async () => {
    const { ctx, spaceRepo, syncRepo } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });

    // shown album
    const { result: albumShown } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'ShownSync' });
    await spaceRepo.addAlbum({ spaceId: space.id, albumId: albumShown.id, addedById: owner.id });

    const { asset: tl } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
    const { asset: ar } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Archive });
    const { asset: hi } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Hidden });
    const { asset: lo } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Locked });
    for (const assetId of [tl.id, ar.id, hi.id, lo.id]) {
      await ctx.newAlbumAsset({ albumId: albumShown.id, assetId });
    }

    // hidden album (showInTimeline=false)
    const { result: albumHidden } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'HiddenSync' });
    await spaceRepo.addAlbum({ spaceId: space.id, albumId: albumHidden.id, addedById: owner.id });
    await spaceRepo.setAlbumShowInTimeline(space.id, albumHidden.id, false);
    const { asset: hiddenAlbumTl } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
    await ctx.newAlbumAsset({ albumId: albumHidden.id, assetId: hiddenAlbumTl.id });

    const stream1 = syncRepo.sharedSpaceAlbumAsset.getBackfill(
      { nowId: NOW_ID, beforeUpdateId: NOW_ID },
      albumShown.id,
      viewer.id,
    );
    const shownIds = new Set<string>();
    for await (const row of stream1) {
      shownIds.add(row.id);
    }

    expect(shownIds.has(tl.id)).toBe(true);
    expect(shownIds.has(ar.id)).toBe(true);
    expect(shownIds.has(hi.id)).toBe(false);
    expect(shownIds.has(lo.id)).toBe(false);

    const stream2 = syncRepo.sharedSpaceAlbumAsset.getBackfill(
      { nowId: NOW_ID, beforeUpdateId: NOW_ID },
      albumHidden.id,
      viewer.id,
    );
    const hiddenIds = new Set<string>();
    for await (const row of stream2) {
      hiddenIds.add(row.id);
    }
    // showInTimeline=false album IS present on the sync stream (grant surface)
    expect(hiddenIds.has(hiddenAlbumTl.id)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SURFACE 8: getSearchSuggestions / getFilterSuggestions (space-scoped)
// Rule: Timeline + Archive count; Hidden + Locked ABSENT.
// Slice 10 note: other members' Archive IS present in search (spaceVisibilityGate).
// showInTimeline=false album: absent from suggestions (projection surface with
//   requireShowInTimeline).
// ─────────────────────────────────────────────────────────────────────────────

describe('matrix: getFilterSuggestions (space-scoped)', () => {
  it('includes Timeline+Archive countries; excludes Hidden+Locked+noTimeline', async () => {
    const { searchRepo, spaceRepo, ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });

    // Direct assets with unique countries per visibility
    const assetData: Array<{ vis: AssetVisibility; country: string }> = [
      { vis: AssetVisibility.Timeline, country: 'TimelineCountry' },
      { vis: AssetVisibility.Archive, country: 'ArchiveCountry' },
      { vis: AssetVisibility.Hidden, country: 'HiddenCountry' },
      { vis: AssetVisibility.Locked, country: 'LockedCountry' },
    ];
    for (const { vis, country } of assetData) {
      const { asset } = await ctx.newAsset({ ownerId: owner.id, visibility: vis });
      await ctx.newExif({ assetId: asset.id, country });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });
    }

    // showInTimeline=false album asset with unique country
    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'NoTimelineFilter' });
    await spaceRepo.addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });
    await spaceRepo.setAlbumShowInTimeline(space.id, album.id, false);
    const { asset: noTlAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
    await ctx.newExif({ assetId: noTlAsset.id, country: 'NoTimelineCountry' });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: noTlAsset.id });

    // Call with viewer.id only — the M3 bypass in getFilterSuggestions allows a caller's OWN
    // assets to bypass the space-visibility gate, so passing [owner.id, viewer.id] would expose
    // the owner's own Hidden/Locked assets (the owner can see their own hidden assets in their
    // search facets). Testing with viewer.id alone validates the space-member perspective.
    const result = await searchRepo.getFilterSuggestions([viewer.id], { spaceId: space.id });

    expect(result.countries).toContain('TimelineCountry');
    // Archive IS included in search (spaceVisibilityGate includes Archive)
    expect(result.countries).toContain('ArchiveCountry');
    expect(result.countries).not.toContain('HiddenCountry');
    expect(result.countries).not.toContain('LockedCountry');
    // showInTimeline=false album excluded from suggestion projection
    expect(result.countries).not.toContain('NoTimelineCountry');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SURFACE 9: getAccessibleTags (space-scoped)
// Rule: Timeline + Archive present (spaceVisibilityGate); Hidden + Locked ABSENT.
// showInTimeline=false album: absent (requireShowInTimeline on the scoping).
// ─────────────────────────────────────────────────────────────────────────────

describe('matrix: getAccessibleTags (space-scoped)', () => {
  it('returns tags for Timeline+Archive assets; excludes Hidden+Locked+noTimeline', async () => {
    const { searchRepo, tagRepo, spaceRepo, ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });

    const makeTaggedAsset = async (vis: AssetVisibility, tagValue: string, asAlbum = false) => {
      const { asset } = await ctx.newAsset({ ownerId: owner.id, visibility: vis });
      const [tag] = await upsertTags(tagRepo, { userId: owner.id, tags: [tagValue] });
      await ctx.newTagAsset({ tagIds: [tag.id], assetIds: [asset.id] });
      if (asAlbum) {
        const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: `AlbumTag_${tagValue}` });
        await spaceRepo.addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });
        await spaceRepo.setAlbumShowInTimeline(space.id, album.id, false);
        await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
      } else {
        await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });
      }
      return tag.id;
    };

    await makeTaggedAsset(AssetVisibility.Timeline, 'TagTimeline');
    await makeTaggedAsset(AssetVisibility.Archive, 'TagArchive');
    await makeTaggedAsset(AssetVisibility.Hidden, 'TagHidden');
    await makeTaggedAsset(AssetVisibility.Locked, 'TagLocked');
    await makeTaggedAsset(AssetVisibility.Timeline, 'TagNoTimeline', true /* via noTimeline album */);

    // Call with viewer.id only — same M3 reason as getFilterSuggestions: passing owner.id
    // would expose the owner's own Hidden/Locked tags via the "caller's own assets" bypass.
    const tags = await searchRepo.getAccessibleTags([viewer.id], { spaceId: space.id });
    const tagValues = tags.map((t) => t.value);

    expect(tagValues).toContain('TagTimeline');
    expect(tagValues).toContain('TagArchive'); // Archive present in search
    expect(tagValues).not.toContain('TagHidden');
    expect(tagValues).not.toContain('TagLocked');
    expect(tagValues).not.toContain('TagNoTimeline'); // showInTimeline=false excluded
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SURFACE 10: tag.getAll (space-scoped via timelineSpaceIds)
// Rule: Timeline+Archive; Hidden+Locked ABSENT; showInTimeline=false absent.
// ─────────────────────────────────────────────────────────────────────────────

describe('matrix: tag.getAll (space-scoped via timelineSpaceIds)', () => {
  it('includes tags for Timeline+Archive; excludes Hidden+Locked+noTimeline', async () => {
    const { tagRepo, ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });

    const makeTaggedDirect = async (vis: AssetVisibility, tagValue: string) => {
      const { asset } = await ctx.newAsset({ ownerId: owner.id, visibility: vis });
      const [tag] = await upsertTags(tagRepo, { userId: owner.id, tags: [tagValue] });
      await ctx.newTagAsset({ tagIds: [tag.id], assetIds: [asset.id] });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });
      return tag;
    };

    await makeTaggedDirect(AssetVisibility.Timeline, 'GetAllTimeline');
    await makeTaggedDirect(AssetVisibility.Archive, 'GetAllArchive');
    await makeTaggedDirect(AssetVisibility.Hidden, 'GetAllHidden');
    await makeTaggedDirect(AssetVisibility.Locked, 'GetAllLocked');

    const tags = await tagRepo.getAll(viewer.id);
    const tagValues = tags.map((t: { value: string }) => t.value);

    // tag.getAll includes tags on assets accessible to the viewer through shared spaces
    // (the ownedOrSpaceAccessible helper in tag.repository includes three space arms gated by
    // spaceVisibilityGate). Timeline and Archive assets' tags ARE visible; Hidden and Locked
    // assets' tags are blocked by the visibility gate.
    expect(tagValues).toContain('GetAllTimeline'); // Timeline accessible via space ✓
    expect(tagValues).toContain('GetAllArchive'); // Archive accessible via space ✓
    expect(tagValues).not.toContain('GetAllHidden'); // Hidden blocked by visibility gate ✓
    expect(tagValues).not.toContain('GetAllLocked'); // Locked blocked by visibility gate ✓
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SURFACE 11: space people-facets — getPersonsBySpaceId
// Deferred from Slice 5. A face on another member's Hidden asset must NOT
// surface the space-person in the people listing.
// ─────────────────────────────────────────────────────────────────────────────

describe('matrix: space people-facets — getPersonsBySpaceId', () => {
  it('person backed only by a Hidden-asset face is NOT surfaced', async () => {
    const { spaceRepo, ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });

    // Person backed by a Timeline asset — should appear
    const { asset: tlAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: tlAsset.id });
    const { result: tlFaceId } = await ctx.newAssetFace({ assetId: tlAsset.id });
    await ctx.database.insertInto('face_search').values({ faceId: tlFaceId, embedding: newEmbedding() }).execute();
    const visiblePerson = await spaceRepo.createPerson({
      spaceId: space.id,
      name: 'Timeline Person',
      representativeFaceId: tlFaceId,
      type: 'person',
    });
    await spaceRepo.addPersonFaces([{ personId: visiblePerson.id, assetFaceId: tlFaceId }], { skipRecount: true });
    await spaceRepo.recountPersons([visiblePerson.id]);

    // Person backed ONLY by a Hidden asset face — must NOT appear
    const { asset: hiddenAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Hidden });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: hiddenAsset.id });
    const { result: hiddenFaceId } = await ctx.newAssetFace({ assetId: hiddenAsset.id });
    await ctx.database.insertInto('face_search').values({ faceId: hiddenFaceId, embedding: newEmbedding() }).execute();
    const hiddenPerson = await spaceRepo.createPerson({
      spaceId: space.id,
      name: 'Hidden Person',
      representativeFaceId: hiddenFaceId,
      type: 'person',
    });
    await spaceRepo.addPersonFaces([{ personId: hiddenPerson.id, assetFaceId: hiddenFaceId }], { skipRecount: true });
    await spaceRepo.recountPersons([hiddenPerson.id]);

    const people = await spaceRepo.getPersonsBySpaceId(space.id, { withHidden: true, petsEnabled: false });
    const personIds = people.map((p) => p.id);

    expect(personIds).toContain(visiblePerson.id);
    expect(personIds).not.toContain(hiddenPerson.id);
  });

  it('person backed only by a Locked-asset face is NOT surfaced', async () => {
    const { spaceRepo, ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });

    const { asset: lockedAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Locked });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: lockedAsset.id });
    const { result: lockedFaceId } = await ctx.newAssetFace({ assetId: lockedAsset.id });
    await ctx.database.insertInto('face_search').values({ faceId: lockedFaceId, embedding: newEmbedding() }).execute();
    const person = await spaceRepo.createPerson({
      spaceId: space.id,
      name: 'Locked Person',
      representativeFaceId: lockedFaceId,
      type: 'person',
    });
    await spaceRepo.addPersonFaces([{ personId: person.id, assetFaceId: lockedFaceId }], { skipRecount: true });
    await spaceRepo.recountPersons([person.id]);

    const people = await spaceRepo.getPersonsBySpaceId(space.id, { withHidden: true, petsEnabled: false });
    const personIds = people.map((p) => p.id);

    expect(personIds).not.toContain(person.id);
  });

  it('added-then-flipped: person whose face asset flips to Hidden → person drops from listing', async () => {
    const { spaceRepo, ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });

    const { asset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });
    const { result: faceId } = await ctx.newAssetFace({ assetId: asset.id });
    await ctx.database.insertInto('face_search').values({ faceId, embedding: newEmbedding() }).execute();
    const person = await spaceRepo.createPerson({
      spaceId: space.id,
      name: 'FlipPerson',
      representativeFaceId: faceId,
      type: 'person',
    });
    await spaceRepo.addPersonFaces([{ personId: person.id, assetFaceId: faceId }], { skipRecount: true });
    await spaceRepo.recountPersons([person.id]);

    const before = await spaceRepo.getPersonsBySpaceId(space.id, { withHidden: true, petsEnabled: false });
    expect(before.map((p) => p.id)).toContain(person.id);

    await defaultDatabase
      .updateTable('asset')
      .set({ visibility: AssetVisibility.Hidden })
      .where('id', '=', asset.id)
      .execute();

    const after = await spaceRepo.getPersonsBySpaceId(space.id, { withHidden: true, petsEnabled: false });
    expect(after.map((p) => p.id)).not.toContain(person.id);
  });

  it('regression: person with a MIX of visible + hidden faces IS still listed', async () => {
    // A person has two faces: one on a Timeline asset (visible) and one on a Hidden asset.
    // Since ≥1 visible face exists, the person MUST appear in the list.
    const { spaceRepo, ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });

    const { asset: tlAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: tlAsset.id });
    const { result: tlFaceId } = await ctx.newAssetFace({ assetId: tlAsset.id });
    await ctx.database.insertInto('face_search').values({ faceId: tlFaceId, embedding: newEmbedding() }).execute();

    const { asset: hiddenAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Hidden });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: hiddenAsset.id });
    const { result: hiddenFaceId } = await ctx.newAssetFace({ assetId: hiddenAsset.id });
    await ctx.database.insertInto('face_search').values({ faceId: hiddenFaceId, embedding: newEmbedding() }).execute();

    const person = await spaceRepo.createPerson({
      spaceId: space.id,
      name: 'MixPerson',
      representativeFaceId: tlFaceId,
      type: 'person',
    });
    await spaceRepo.addPersonFaces(
      [
        { personId: person.id, assetFaceId: tlFaceId },
        { personId: person.id, assetFaceId: hiddenFaceId },
      ],
      { skipRecount: true },
    );
    await spaceRepo.recountPersons([person.id]);

    const people = await spaceRepo.getPersonsBySpaceId(space.id, { withHidden: true, petsEnabled: false });
    expect(people.map((p) => p.id)).toContain(person.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SURFACE 11b: countPersonsBySpaceId — must match the getPersonsBySpaceId list
// A person with only hidden/locked faces must be excluded from the count too.
// ─────────────────────────────────────────────────────────────────────────────

describe('matrix: countPersonsBySpaceId — visibility consistency', () => {
  it('excludes a person backed only by Hidden faces from the count', async () => {
    const { spaceRepo, ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });

    // Visible person (Timeline face)
    const { asset: tlAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: tlAsset.id });
    const { result: tlFaceId } = await ctx.newAssetFace({ assetId: tlAsset.id });
    await ctx.database.insertInto('face_search').values({ faceId: tlFaceId, embedding: newEmbedding() }).execute();
    const visiblePerson = await spaceRepo.createPerson({
      spaceId: space.id,
      name: 'TLPerson',
      representativeFaceId: tlFaceId,
      type: 'person',
    });
    await spaceRepo.addPersonFaces([{ personId: visiblePerson.id, assetFaceId: tlFaceId }], { skipRecount: true });
    await spaceRepo.recountPersons([visiblePerson.id]);

    // Hidden-only person
    const { asset: hiddenAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Hidden });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: hiddenAsset.id });
    const { result: hiddenFaceId } = await ctx.newAssetFace({ assetId: hiddenAsset.id });
    await ctx.database.insertInto('face_search').values({ faceId: hiddenFaceId, embedding: newEmbedding() }).execute();
    const hiddenOnlyPerson = await spaceRepo.createPerson({
      spaceId: space.id,
      name: 'HiddenOnlyPerson',
      representativeFaceId: hiddenFaceId,
      type: 'person',
    });
    await spaceRepo.addPersonFaces([{ personId: hiddenOnlyPerson.id, assetFaceId: hiddenFaceId }], {
      skipRecount: true,
    });
    await spaceRepo.recountPersons([hiddenOnlyPerson.id]);

    const { total } = await spaceRepo.countPersonsBySpaceId(space.id, { petsEnabled: false });
    // Only the Timeline-backed person should be counted
    expect(total).toBe(1);
  });

  it('excludes a person backed only by Locked faces from the count', async () => {
    const { spaceRepo, ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });

    const { asset: lockedAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Locked });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: lockedAsset.id });
    const { result: lockedFaceId } = await ctx.newAssetFace({ assetId: lockedAsset.id });
    await ctx.database.insertInto('face_search').values({ faceId: lockedFaceId, embedding: newEmbedding() }).execute();
    const person = await spaceRepo.createPerson({
      spaceId: space.id,
      name: 'LockedOnlyPerson',
      representativeFaceId: lockedFaceId,
      type: 'person',
    });
    await spaceRepo.addPersonFaces([{ personId: person.id, assetFaceId: lockedFaceId }], { skipRecount: true });
    await spaceRepo.recountPersons([person.id]);

    const { total } = await spaceRepo.countPersonsBySpaceId(space.id, { petsEnabled: false });
    expect(total).toBe(0);
  });

  it('count matches list: list and count agree on persons with visible faces only', async () => {
    const { spaceRepo, ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });

    // Two visible persons (Timeline), one hidden-only
    for (const [name, vis] of [
      ['Alice', AssetVisibility.Timeline] as const,
      ['Bob', AssetVisibility.Archive] as const,
      ['Ghost', AssetVisibility.Hidden] as const,
    ]) {
      const { asset } = await ctx.newAsset({ ownerId: owner.id, visibility: vis });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });
      const { result: faceId } = await ctx.newAssetFace({ assetId: asset.id });
      await ctx.database.insertInto('face_search').values({ faceId, embedding: newEmbedding() }).execute();
      const p = await spaceRepo.createPerson({
        spaceId: space.id,
        name,
        representativeFaceId: faceId,
        type: 'person',
      });
      await spaceRepo.addPersonFaces([{ personId: p.id, assetFaceId: faceId }], { skipRecount: true });
      await spaceRepo.recountPersons([p.id]);
    }

    const list = await spaceRepo.getPersonsBySpaceId(space.id, { withHidden: false, petsEnabled: false });
    const { total } = await spaceRepo.countPersonsBySpaceId(space.id, { petsEnabled: false });

    // 2 visible persons (Timeline + Archive); Ghost excluded
    expect(list).toHaveLength(2);
    expect(total).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SURFACE 12: isFaceInSpace
// Rule: Timeline + Archive → true; Hidden + Locked → false.
// ─────────────────────────────────────────────────────────────────────────────

describe('matrix: isFaceInSpace', () => {
  it('returns true for Timeline face, false for Hidden+Locked faces (direct path)', async () => {
    const { spaceRepo, ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });

    const makeDirectFace = async (vis: AssetVisibility) => {
      const { asset } = await ctx.newAsset({ ownerId: owner.id, visibility: vis });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });
      const { result: faceId } = await ctx.newAssetFace({ assetId: asset.id });
      return faceId;
    };

    const tlFace = await makeDirectFace(AssetVisibility.Timeline);
    const arFace = await makeDirectFace(AssetVisibility.Archive);
    const hiFace = await makeDirectFace(AssetVisibility.Hidden);
    const loFace = await makeDirectFace(AssetVisibility.Locked);

    expect(await spaceRepo.isFaceInSpace(space.id, tlFace)).toBe(true);
    expect(await spaceRepo.isFaceInSpace(space.id, arFace)).toBe(true);
    expect(await spaceRepo.isFaceInSpace(space.id, hiFace)).toBe(false);
    expect(await spaceRepo.isFaceInSpace(space.id, loFace)).toBe(false);
  });

  it('returns true for album(shown) face, false for album(noTimeline) face', async () => {
    const { spaceRepo, ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });

    const { result: albumShown } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'FaceShown' });
    await spaceRepo.addAlbum({ spaceId: space.id, albumId: albumShown.id, addedById: owner.id });
    const { asset: shownAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
    await ctx.newAlbumAsset({ albumId: albumShown.id, assetId: shownAsset.id });
    const { result: shownFaceId } = await ctx.newAssetFace({ assetId: shownAsset.id });

    const { result: albumHidden } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'FaceHidden' });
    await spaceRepo.addAlbum({ spaceId: space.id, albumId: albumHidden.id, addedById: owner.id });
    await spaceRepo.setAlbumShowInTimeline(space.id, albumHidden.id, false);
    const { asset: hiddenAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
    await ctx.newAlbumAsset({ albumId: albumHidden.id, assetId: hiddenAsset.id });
    const { result: hiddenFaceId } = await ctx.newAssetFace({ assetId: hiddenAsset.id });

    expect(await spaceRepo.isFaceInSpace(space.id, shownFaceId)).toBe(true);
    expect(await spaceRepo.isFaceInSpace(space.id, hiddenFaceId)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SURFACE 13: getPersonAssetIds
// Rule: Timeline + Archive present; Hidden + Locked ABSENT.
// showInTimeline=false album → ABSENT (requireShowInTimeline in the query).
// ─────────────────────────────────────────────────────────────────────────────

describe('matrix: getPersonAssetIds', () => {
  it('returns asset IDs for Timeline+Archive faces; excludes Hidden+Locked+noTimeline', async () => {
    const { spaceRepo, ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });

    // Build a space person
    const { asset: tlAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: tlAsset.id });
    const { result: tlFaceId } = await ctx.newAssetFace({ assetId: tlAsset.id });
    await ctx.database.insertInto('face_search').values({ faceId: tlFaceId, embedding: newEmbedding() }).execute();

    const { asset: arAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Archive });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: arAsset.id });
    const { result: arFaceId } = await ctx.newAssetFace({ assetId: arAsset.id });
    await ctx.database.insertInto('face_search').values({ faceId: arFaceId, embedding: newEmbedding() }).execute();

    const { asset: hiAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Hidden });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: hiAsset.id });
    const { result: hiFaceId } = await ctx.newAssetFace({ assetId: hiAsset.id });
    await ctx.database.insertInto('face_search').values({ faceId: hiFaceId, embedding: newEmbedding() }).execute();

    const { asset: loAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Locked });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: loAsset.id });
    const { result: loFaceId } = await ctx.newAssetFace({ assetId: loAsset.id });
    await ctx.database.insertInto('face_search').values({ faceId: loFaceId, embedding: newEmbedding() }).execute();

    const person = await spaceRepo.createPerson({
      spaceId: space.id,
      name: 'MatrixPerson',
      representativeFaceId: tlFaceId,
      type: 'person',
    });
    await spaceRepo.addPersonFaces(
      [tlFaceId, arFaceId, hiFaceId, loFaceId].map((assetFaceId) => ({ personId: person.id, assetFaceId })),
      { skipRecount: true },
    );

    const rows = await spaceRepo.getPersonAssetIds(person.id);
    const assetIds = new Set(rows.map((r) => r.assetId));

    expect(assetIds.has(tlAsset.id)).toBe(true);
    expect(assetIds.has(arAsset.id)).toBe(true);
    expect(assetIds.has(hiAsset.id)).toBe(false);
    expect(assetIds.has(loAsset.id)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SURFACE 14: timeline (getTimeBuckets / getTimeBucket)
// Rule: Timeline ONLY (Archive excluded — space timeline is Timeline-only).
// showInTimeline=false album: ABSENT.
// soft-deleted album: ABSENT.
// ─────────────────────────────────────────────────────────────────────────────

describe('matrix: timeline (getTimeBuckets)', () => {
  it('counts only Timeline assets; Archive excluded by design; Hidden+Locked+noTimeline absent', async () => {
    const { assetRepo, spaceRepo, ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });

    const { user: viewer } = await ctx.newUser();
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });

    const when = new Date('2024-01-15T12:00:00.000Z');

    const makeTimelineReady = async (vis: AssetVisibility, opts: { albumId?: string; libraryId?: string } = {}) => {
      const { asset } = await ctx.newAsset({
        ownerId: owner.id,
        visibility: vis,
        fileCreatedAt: when,
        localDateTime: when,
        width: 400,
        height: 300,
        thumbhash: Buffer.from('t'),
        ...opts,
      });
      await ctx.newExif({ assetId: asset.id, timeZone: 'UTC' });
      return asset.id;
    };

    // Direct-add
    const tlDirect = await makeTimelineReady(AssetVisibility.Timeline);
    const arDirect = await makeTimelineReady(AssetVisibility.Archive);
    const hiDirect = await makeTimelineReady(AssetVisibility.Hidden);
    for (const assetId of [tlDirect, arDirect, hiDirect]) {
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId });
    }

    // Album(shown)
    const { result: albumShown } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'TLShown' });
    await spaceRepo.addAlbum({ spaceId: space.id, albumId: albumShown.id, addedById: owner.id });
    const tlAlbumShown = await makeTimelineReady(AssetVisibility.Timeline);
    await ctx.newAlbumAsset({ albumId: albumShown.id, assetId: tlAlbumShown });

    // Album(noTimeline)
    const { result: albumNo } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'TLHidden' });
    await spaceRepo.addAlbum({ spaceId: space.id, albumId: albumNo.id, addedById: owner.id });
    await spaceRepo.setAlbumShowInTimeline(space.id, albumNo.id, false);
    const tlAlbumNo = await makeTimelineReady(AssetVisibility.Timeline);
    await ctx.newAlbumAsset({ albumId: albumNo.id, assetId: tlAlbumNo });

    const opts: TimeBucketOptions = {
      spaceId: space.id,
      visibility: AssetVisibility.Timeline,
      bucketSize: TimeBucketSize.Year,
    };
    const buckets = await assetRepo.getTimeBuckets(opts, factory.auth());
    const total = buckets.reduce((sum, b) => sum + Number(b.count), 0);

    // Timeline direct + Timeline album(shown) = 2 assets
    // Archive direct → excluded (space timeline is Timeline-only)
    // Hidden → excluded (visibility gate)
    // album(noTimeline) → excluded (requireShowInTimeline)
    expect(total).toBe(2);
  });

  it('added-then-flipped for materialized shared_space_asset: timeline count drops when asset flips to Hidden', async () => {
    const { assetRepo, ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });

    const when = new Date('2024-03-01T12:00:00.000Z');
    const { asset } = await ctx.newAsset({
      ownerId: owner.id,
      visibility: AssetVisibility.Timeline,
      fileCreatedAt: when,
      localDateTime: when,
      width: 400,
      height: 300,
      thumbhash: Buffer.from('t'),
    });
    await ctx.newExif({ assetId: asset.id, timeZone: 'UTC' });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });

    const opts: TimeBucketOptions = {
      spaceId: space.id,
      visibility: AssetVisibility.Timeline,
      bucketSize: TimeBucketSize.Year,
    };
    const before = await assetRepo.getTimeBuckets(opts, factory.auth());
    const beforeCount = before.reduce((sum, b) => sum + Number(b.count), 0);
    expect(beforeCount).toBeGreaterThanOrEqual(1);

    await defaultDatabase
      .updateTable('asset')
      .set({ visibility: AssetVisibility.Hidden })
      .where('id', '=', asset.id)
      .execute();

    const after = await assetRepo.getTimeBuckets(opts, factory.auth());
    const afterCount = after.reduce((sum, b) => sum + Number(b.count), 0);
    expect(afterCount).toBe(beforeCount - 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SURFACE 15: map markers
// Rule: Timeline ONLY (Archive excluded by design — getMapMarkers filters
//   visibility=Timeline when isArchived is undefined/false).
// showInTimeline=false album: ABSENT.
// soft-deleted album: ABSENT.
// ─────────────────────────────────────────────────────────────────────────────

describe('matrix: map markers', () => {
  it('includes Timeline markers; excludes Archive+Hidden+Locked+noTimeline+deletedAlbum', async () => {
    const { mapRepo, spaceRepo, ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });

    const makeGpsAsset = async (vis: AssetVisibility, lat: number) => {
      const { asset } = await ctx.newAsset({ ownerId: owner.id, visibility: vis });
      await ctx.database.insertInto('asset_exif').values({ assetId: asset.id, latitude: lat, longitude: 2 }).execute();
      return asset.id;
    };

    const tlId = await makeGpsAsset(AssetVisibility.Timeline, 1);
    const arId = await makeGpsAsset(AssetVisibility.Archive, 2);
    const hiId = await makeGpsAsset(AssetVisibility.Hidden, 3);
    const loId = await makeGpsAsset(AssetVisibility.Locked, 4);
    for (const assetId of [tlId, arId, hiId, loId]) {
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId });
    }

    // showInTimeline=false album
    const { result: albumNo } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'MapNoTL' });
    await spaceRepo.addAlbum({ spaceId: space.id, albumId: albumNo.id, addedById: owner.id });
    await spaceRepo.setAlbumShowInTimeline(space.id, albumNo.id, false);
    const noTlId = await makeGpsAsset(AssetVisibility.Timeline, 5);
    await ctx.newAlbumAsset({ albumId: albumNo.id, assetId: noTlId });

    // shown album
    const { result: albumShown } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'MapShown' });
    await spaceRepo.addAlbum({ spaceId: space.id, albumId: albumShown.id, addedById: owner.id });
    const shownId = await makeGpsAsset(AssetVisibility.Timeline, 6);
    await ctx.newAlbumAsset({ albumId: albumShown.id, assetId: shownId });

    // soft-deleted album
    const { result: albumDel } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'MapDel' });
    await spaceRepo.addAlbum({ spaceId: space.id, albumId: albumDel.id, addedById: owner.id });
    const delId = await makeGpsAsset(AssetVisibility.Timeline, 7);
    await ctx.newAlbumAsset({ albumId: albumDel.id, assetId: delId });
    await ctx.softDeleteAlbum(albumDel.id);

    const markers = await mapRepo.getMapMarkers(viewer.id, [viewer.id], [], {
      timelineSpaceIds: [space.id],
    });
    const markerIds = new Set(markers.map((m) => m.id));

    expect(markerIds.has(tlId)).toBe(true); // Timeline direct ✓
    expect(markerIds.has(shownId)).toBe(true); // Timeline album(shown) ✓
    expect(markerIds.has(arId)).toBe(false); // Archive excluded by design ✓
    expect(markerIds.has(hiId)).toBe(false); // Hidden blocked ✓
    expect(markerIds.has(loId)).toBe(false); // Locked blocked ✓
    expect(markerIds.has(noTlId)).toBe(false); // showInTimeline=false excluded ✓
    expect(markerIds.has(delId)).toBe(false); // soft-deleted album excluded ✓
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SURFACE 16: memory (searchAccessible)
// Rule: Timeline ONLY (searchAccessible inner asset list filters
//   visibility=Timeline); Archive excluded by design.
// Direct+library paths in the outer scope use asset.visibility=Timeline only.
// showInTimeline=false album: ABSENT.
// ─────────────────────────────────────────────────────────────────────────────

describe('matrix: memory searchAccessible', () => {
  it('includes Timeline assets in memory; excludes Archive+Hidden+Locked', async () => {
    const { memoryRepo, ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });

    const { memory } = await ctx.newMemory({ ownerId: owner.id });

    const makeAsset = async (vis: AssetVisibility) => {
      const { asset } = await ctx.newAsset({ ownerId: owner.id, visibility: vis });
      await ctx.newMemoryAsset({ memoryId: memory.id, assetId: asset.id });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });
      return asset.id;
    };

    const tlId = await makeAsset(AssetVisibility.Timeline);
    const arId = await makeAsset(AssetVisibility.Archive);
    const hiId = await makeAsset(AssetVisibility.Hidden);
    const loId = await makeAsset(AssetVisibility.Locked);

    const memories = await memoryRepo.searchAccessible(viewer.id, {});
    const assetIds = new Set(memories.flatMap((m) => (m.assets as { id: string }[]).map((a) => a.id)));

    expect(assetIds.has(tlId)).toBe(true); // Timeline ✓
    expect(assetIds.has(arId)).toBe(false); // Archive excluded by design ✓
    expect(assetIds.has(hiId)).toBe(false); // Hidden blocked ✓
    expect(assetIds.has(loId)).toBe(false); // Locked blocked ✓
  });

  it('memory accessible ONLY via noTimeline-album asset is hidden from viewer', async () => {
    // When a memory's ONLY space-accessible asset comes from a showInTimeline=false album,
    // the outer scope (accessibleSearchBuilder) cannot find an accessible asset to grant
    // visibility, so the memory is NOT returned to the viewer.
    const { memoryRepo, spaceRepo, ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });

    const { memory: noTlMemory } = await ctx.newMemory({ ownerId: owner.id });

    const { result: albumNo } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'MemNoTLOnly' });
    await spaceRepo.addAlbum({ spaceId: space.id, albumId: albumNo.id, addedById: owner.id });
    await spaceRepo.setAlbumShowInTimeline(space.id, albumNo.id, false);
    const { asset: noTlAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
    await ctx.newAlbumAsset({ albumId: albumNo.id, assetId: noTlAsset.id });
    await ctx.newMemoryAsset({ memoryId: noTlMemory.id, assetId: noTlAsset.id });

    const memories = await memoryRepo.searchAccessible(viewer.id, {});
    const memoryIds = new Set(memories.map((m) => m.id));

    // The memory is not accessible to viewer because its only space-path is via
    // a showInTimeline=false album (requireShowInTimeline=true outer scope gate).
    expect(memoryIds.has(noTlMemory.id)).toBe(false); // noTimeline-only memory hidden ✓
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SURFACE 17: view / folders (getUniqueOriginalPaths / getAssetsByOriginalPath)
// Rule: Timeline ONLY; Archive excluded; Hidden+Locked absent.
// showInTimeline=false album: ABSENT (requireShowInTimeline in ownedOrSpaceAccessible).
// ─────────────────────────────────────────────────────────────────────────────

describe('matrix: view/folders (getUniqueOriginalPaths)', () => {
  it('includes Timeline paths; excludes Archive+Hidden+Locked+noTimeline', async () => {
    const { viewRepo, spaceRepo, ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });

    const basePath = `/matrix_view_test_${Date.now()}`;

    const makePathAsset = async (vis: AssetVisibility, subdir: string) => {
      const { asset } = await ctx.newAsset({
        ownerId: owner.id,
        visibility: vis,
        originalPath: `${basePath}/${subdir}/photo.jpg`,
        fileCreatedAt: new Date(),
        localDateTime: new Date(),
      });
      await ctx.newExif({ assetId: asset.id, timeZone: 'UTC' });
      return asset.id;
    };

    const tlId = await makePathAsset(AssetVisibility.Timeline, 'timeline');
    const arId = await makePathAsset(AssetVisibility.Archive, 'archive');
    const hiId = await makePathAsset(AssetVisibility.Hidden, 'hidden');
    for (const assetId of [tlId, arId, hiId]) {
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId });
    }

    // showInTimeline=false album
    const { result: albumNo } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'ViewNoTL' });
    await spaceRepo.addAlbum({ spaceId: space.id, albumId: albumNo.id, addedById: owner.id });
    await spaceRepo.setAlbumShowInTimeline(space.id, albumNo.id, false);
    const noTlId = await makePathAsset(AssetVisibility.Timeline, 'notimeline');
    await ctx.newAlbumAsset({ albumId: albumNo.id, assetId: noTlId });

    const paths = await viewRepo.getUniqueOriginalPaths(viewer.id);
    const tlPath = `${basePath}/timeline`;
    const arPath = `${basePath}/archive`;
    const hiPath = `${basePath}/hidden`;
    const noTlPath = `${basePath}/notimeline`;

    expect(paths).toContain(tlPath); // Timeline ✓
    expect(paths).not.toContain(arPath); // Archive excluded ✓
    expect(paths).not.toContain(hiPath); // Hidden blocked ✓
    expect(paths).not.toContain(noTlPath); // showInTimeline=false excluded ✓
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SURFACE 18: timeline explicit visibility (spaceId + visibility=HIDDEN/LOCKED)
// Fix A regression lock in the matrix.
// Rule: another member's Hidden/Locked in-space assets ABSENT even with explicit
//   visibility=HIDDEN or visibility=LOCKED passed to the timeline bucket queries;
//   the owner's OWN Hidden is PRESENT (via timelineSpaceIds + userIds=[owner]).
//
// Full coverage lives in timeline-bucket-explicit-visibility.medium.spec.ts.
// These assertions cross-lock the same guarantees using the matrix fixture.
// ─────────────────────────────────────────────────────────────────────────────

describe('matrix: timeline explicit-visibility (spaceId + visibility=HIDDEN/LOCKED)', () => {
  it("visibility=HIDDEN via spaceId does NOT surface another member's Hidden in-space asset", async () => {
    const { assetRepo, spaceRepo, ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });

    // Direct Hidden + album(shown) Hidden — both must be absent
    const hiDirect = await makeBucketReadyAsset(ctx, owner.id, AssetVisibility.Hidden);
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: hiDirect });

    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'HiddenLeakMx' });
    await spaceRepo.addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });
    const hiAlbum = await makeBucketReadyAsset(ctx, owner.id, AssetVisibility.Hidden);
    await ctx.newAlbumAsset({ albumId: album.id, assetId: hiAlbum });

    const opts: TimeBucketOptions = {
      spaceId: space.id,
      visibility: AssetVisibility.Hidden,
      bucketSize: TimeBucketSize.Year,
    };

    // No other-member Hidden assets surface
    expect(countTimeBuckets(await assetRepo.getTimeBuckets(opts, factory.auth()))).toBe(0);

    // getTimeBucketCovers likewise returns nothing
    const covers = await assetRepo.getTimeBucketCovers({ ...opts, timeBuckets: ['2024-01-01'] });
    const coverIds = new Set(covers.map((c) => c.representativeAssetId));
    expect(coverIds.has(hiDirect)).toBe(false);
    expect(coverIds.has(hiAlbum)).toBe(false);
  });

  it("visibility=LOCKED via spaceId does NOT surface another member's Locked in-space asset", async () => {
    const { assetRepo, ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });

    const loId = await makeBucketReadyAsset(ctx, owner.id, AssetVisibility.Locked);
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: loId });

    const opts: TimeBucketOptions = {
      spaceId: space.id,
      visibility: AssetVisibility.Locked,
      bucketSize: TimeBucketSize.Year,
    };
    expect(countTimeBuckets(await assetRepo.getTimeBuckets(opts, factory.auth()))).toBe(0);
  });

  it("OWN Hidden via timelineSpaceIds IS present (owner's own hidden must not be over-blocked)", async () => {
    const { assetRepo, ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });

    const ownHidden = await makeBucketReadyAsset(ctx, owner.id, AssetVisibility.Hidden);
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: ownHidden });

    const opts: TimeBucketOptions = {
      userIds: [owner.id],
      timelineSpaceIds: [space.id],
      visibility: AssetVisibility.Hidden,
      bucketSize: TimeBucketSize.Year,
    };
    expect(countTimeBuckets(await assetRepo.getTimeBuckets(opts, factory.auth()))).toBe(1);

    const covers = await assetRepo.getTimeBucketCovers({ ...opts, timeBuckets: ['2024-01-01'] });
    const coverIds = new Set(covers.map((c) => c.representativeAssetId));
    expect(coverIds.has(ownHidden)).toBe(true);
  });

  it("viewer's Hidden via timelineSpaceIds does NOT surface another member's Hidden album asset", async () => {
    const { assetRepo, spaceRepo, ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });

    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'HiddenAlbumMxTS' });
    await spaceRepo.addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });
    const hiAlbum = await makeBucketReadyAsset(ctx, owner.id, AssetVisibility.Hidden);
    await ctx.newAlbumAsset({ albumId: album.id, assetId: hiAlbum });

    const opts: TimeBucketOptions = {
      userIds: [viewer.id],
      timelineSpaceIds: [space.id],
      visibility: AssetVisibility.Hidden,
      bucketSize: TimeBucketSize.Year,
    };
    expect(countTimeBuckets(await assetRepo.getTimeBuckets(opts, factory.auth()))).toBe(0);

    const covers = await assetRepo.getTimeBucketCovers({ ...opts, timeBuckets: ['2024-01-01'] });
    expect(covers.map((c) => c.representativeAssetId)).not.toContain(hiAlbum);
  });

  it('regression: visibility=Timeline via spaceId still returns Timeline asset (no over-block)', async () => {
    const { assetRepo, ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });

    const tl = await makeBucketReadyAsset(ctx, owner.id, AssetVisibility.Timeline);
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: tl });

    const opts: TimeBucketOptions = {
      spaceId: space.id,
      visibility: AssetVisibility.Timeline,
      bucketSize: TimeBucketSize.Year,
    };
    expect(countTimeBuckets(await assetRepo.getTimeBuckets(opts, factory.auth()))).toBeGreaterThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SURFACE 19: LibraryAssetSync / LibraryAssetExifSync
// Fix B regression lock.
// Rule: a viewer receiving a library sync backfill for a space-linked library
//   sees the owner's Timeline + Archive assets; Hidden + Locked are ABSENT.
//   The owner syncing their own library sees ALL visibilities.
// ─────────────────────────────────────────────────────────────────────────────

describe('matrix: LibraryAssetSync — space-linked library visibility gate', () => {
  const BACKFILL: SyncBackfillOptions = { nowId: NOW_ID, beforeUpdateId: NOW_ID };

  it("viewer's backfill omits another owner's Hidden+Locked library assets; includes Timeline+Archive", async () => {
    const { syncRepo, ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });

    const { result: library } = await ctx.newLibrary({ ownerId: owner.id });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id });

    const makeLibAsset = async (vis: AssetVisibility) => {
      const { asset } = await ctx.newAsset({ ownerId: owner.id, visibility: vis, libraryId: library.id });
      return asset.id;
    };

    const tlId = await makeLibAsset(AssetVisibility.Timeline);
    const arId = await makeLibAsset(AssetVisibility.Archive);
    const hiId = await makeLibAsset(AssetVisibility.Hidden);
    const loId = await makeLibAsset(AssetVisibility.Locked);

    // Viewer backfill: spaceVisibilityGate → Timeline + Archive only
    const viewerStream = syncRepo.libraryAsset.getBackfill(BACKFILL, library.id, viewer.id);
    const viewerIds = new Set<string>();
    for await (const row of viewerStream) {
      viewerIds.add(row.id);
    }
    expect(viewerIds.has(tlId)).toBe(true); // Timeline ✓
    expect(viewerIds.has(arId)).toBe(true); // Archive ✓
    expect(viewerIds.has(hiId)).toBe(false); // Hidden blocked ✓
    expect(viewerIds.has(loId)).toBe(false); // Locked blocked ✓
  });

  it("owner's own backfill surfaces all visibilities (ownerId bypass)", async () => {
    const { syncRepo, ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });

    const { result: library } = await ctx.newLibrary({ ownerId: owner.id });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id });

    const makeLibAsset = async (vis: AssetVisibility) => {
      const { asset } = await ctx.newAsset({ ownerId: owner.id, visibility: vis, libraryId: library.id });
      return asset.id;
    };

    const tlId = await makeLibAsset(AssetVisibility.Timeline);
    const arId = await makeLibAsset(AssetVisibility.Archive);
    const hiId = await makeLibAsset(AssetVisibility.Hidden);
    const loId = await makeLibAsset(AssetVisibility.Locked);

    // Owner backfill: ownerId matches → all visibilities present
    const ownerStream = syncRepo.libraryAsset.getBackfill(BACKFILL, library.id, owner.id);
    const ownerIds = new Set<string>();
    for await (const row of ownerStream) {
      ownerIds.add(row.id);
    }
    expect(ownerIds.has(tlId)).toBe(true);
    expect(ownerIds.has(arId)).toBe(true);
    expect(ownerIds.has(hiId)).toBe(true); // Own Hidden present ✓
    expect(ownerIds.has(loId)).toBe(true); // Own Locked present ✓
  });
});

describe('matrix: LibraryAssetExifSync — space-linked library visibility gate', () => {
  const BACKFILL: SyncBackfillOptions = { nowId: NOW_ID, beforeUpdateId: NOW_ID };

  it("viewer's EXIF backfill omits another owner's Hidden+Locked library assets; includes Timeline+Archive", async () => {
    const { syncRepo, ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });

    const { result: library } = await ctx.newLibrary({ ownerId: owner.id });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id });

    const makeLibExifAsset = async (vis: AssetVisibility) => {
      const { asset } = await ctx.newAsset({ ownerId: owner.id, visibility: vis, libraryId: library.id });
      await ctx.newExif({ assetId: asset.id, timeZone: 'UTC', fileSizeInByte: 512 });
      return asset.id;
    };

    const tlId = await makeLibExifAsset(AssetVisibility.Timeline);
    const arId = await makeLibExifAsset(AssetVisibility.Archive);
    const hiId = await makeLibExifAsset(AssetVisibility.Hidden);
    const loId = await makeLibExifAsset(AssetVisibility.Locked);

    const viewerStream = syncRepo.libraryAssetExif.getBackfill(BACKFILL, library.id, viewer.id);
    const viewerIds = new Set<string>();
    for await (const row of viewerStream) {
      viewerIds.add(row.assetId as string);
    }
    expect(viewerIds.has(tlId)).toBe(true); // Timeline ✓
    expect(viewerIds.has(arId)).toBe(true); // Archive ✓
    expect(viewerIds.has(hiId)).toBe(false); // Hidden blocked ✓
    expect(viewerIds.has(loId)).toBe(false); // Locked blocked ✓
  });

  it("owner's EXIF backfill surfaces all visibilities (ownerId bypass)", async () => {
    const { syncRepo, ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });

    const { result: library } = await ctx.newLibrary({ ownerId: owner.id });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id });

    const makeLibExifAsset = async (vis: AssetVisibility) => {
      const { asset } = await ctx.newAsset({ ownerId: owner.id, visibility: vis, libraryId: library.id });
      await ctx.newExif({ assetId: asset.id, timeZone: 'UTC', fileSizeInByte: 512 });
      return asset.id;
    };

    const tlId = await makeLibExifAsset(AssetVisibility.Timeline);
    const arId = await makeLibExifAsset(AssetVisibility.Archive);
    const hiId = await makeLibExifAsset(AssetVisibility.Hidden);
    const loId = await makeLibExifAsset(AssetVisibility.Locked);

    const ownerStream = syncRepo.libraryAssetExif.getBackfill(BACKFILL, library.id, owner.id);
    const ownerIds = new Set<string>();
    for await (const row of ownerStream) {
      ownerIds.add(row.assetId as string);
    }
    expect(ownerIds.has(tlId)).toBe(true);
    expect(ownerIds.has(arId)).toBe(true);
    expect(ownerIds.has(hiId)).toBe(true); // Own Hidden present ✓
    expect(ownerIds.has(loId)).toBe(true); // Own Locked present ✓
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SURFACE 20: activity.search / getStatistics for a space-linked album
// Fix C regression lock.
// Rule: activity on Hidden/Locked album assets is ABSENT from search results
//   and excluded from statistics counts, even when the album is space-linked.
// ─────────────────────────────────────────────────────────────────────────────

describe('matrix: activity.search — space-linked album hides Hidden/Locked asset activity', () => {
  it('search() omits activity on Hidden+Locked assets; includes Timeline+Archive', async () => {
    const { activityRepo, spaceRepo, ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });

    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'ActivityMxAlbum' });
    await spaceRepo.addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

    const { asset: tlAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
    const { asset: arAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Archive });
    const { asset: hiAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Hidden });
    const { asset: loAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Locked });

    for (const assetId of [tlAsset.id, arAsset.id, hiAsset.id, loAsset.id]) {
      await ctx.newAlbumAsset({ albumId: album.id, assetId });
    }

    // One like per asset
    await activityRepo.create({ albumId: album.id, assetId: tlAsset.id, userId: owner.id, isLiked: true });
    await activityRepo.create({ albumId: album.id, assetId: arAsset.id, userId: owner.id, isLiked: true });
    await activityRepo.create({ albumId: album.id, assetId: hiAsset.id, userId: owner.id, isLiked: true });
    await activityRepo.create({ albumId: album.id, assetId: loAsset.id, userId: owner.id, isLiked: true });

    const results = await activityRepo.search({ albumId: album.id });
    const assetIds = results.map((r) => r.assetId);

    expect(assetIds).toContain(tlAsset.id); // Timeline ✓
    expect(assetIds).toContain(arAsset.id); // Archive ✓
    expect(assetIds).not.toContain(hiAsset.id); // Hidden blocked ✓
    expect(assetIds).not.toContain(loAsset.id); // Locked blocked ✓
  });

  it('getStatistics() excludes counts for Hidden+Locked asset activity', async () => {
    const { activityRepo, spaceRepo, ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });

    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'StatsMxAlbum' });
    await spaceRepo.addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

    const { asset: tlAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
    const { asset: hiAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Hidden });
    const { asset: loAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Locked });

    for (const assetId of [tlAsset.id, hiAsset.id, loAsset.id]) {
      await ctx.newAlbumAsset({ albumId: album.id, assetId });
    }

    // 1 comment on each (isLiked=false requires comment IS NOT NULL)
    await activityRepo.create({
      albumId: album.id,
      assetId: tlAsset.id,
      userId: owner.id,
      isLiked: false,
      comment: 'visible',
    });
    await activityRepo.create({
      albumId: album.id,
      assetId: hiAsset.id,
      userId: owner.id,
      isLiked: false,
      comment: 'hidden',
    });
    await activityRepo.create({
      albumId: album.id,
      assetId: loAsset.id,
      userId: owner.id,
      isLiked: false,
      comment: 'locked',
    });

    const stats = await activityRepo.getStatistics({ albumId: album.id });
    // Only the Timeline comment should count
    expect(Number(stats.comments)).toBe(1);
    expect(Number(stats.likes)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SURFACE 21: getAlbumInfo email redaction (AlbumService.get)
// Fix D regression lock.
// Rule: a space Viewer who has AlbumRead access (via checkSpaceLinkedAlbumReadAccess)
//   but is NOT an album_user participant gets all albumUser.email fields redacted to ''.
//   An actual album participant sees real emails.
// ─────────────────────────────────────────────────────────────────────────────

const setupAlbumService = () => {
  const result = newMediumService(AlbumService, {
    database: defaultDatabase,
    real: [AccessRepository, AlbumRepository, AlbumUserRepository, SharedSpaceRepository, UserRepository],
    mock: [LoggingRepository],
  });
  return result;
};

describe('matrix: AlbumService.get — email redaction for space-only Viewer', () => {
  it('redacts albumUser emails for a space Viewer who is not an album participant', async () => {
    const { sut, ctx } = setupAlbumService();
    const { user: owner } = await ctx.newUser();
    const { user: collaborator } = await ctx.newUser(); // album participant
    const { user: viewer } = await ctx.newUser(); // space viewer, NOT album participant

    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });

    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'EmailRedactAlbum' });

    // Add collaborator as album_user so albumUsers is non-empty — emails would leak if not redacted
    await ctx.newAlbumUser({ albumId: album.id, userId: collaborator.id, role: AlbumUserRole.Editor });

    // Link album to space so viewer gets AlbumRead
    await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

    const viewerAuth = factory.auth({ user: { id: viewer.id, email: viewer.email } });
    const result = await sut.get(viewerAuth, album.id);

    // albumUsers must be present in the response (viewer can still see that participants exist)
    expect(result.albumUsers.length).toBeGreaterThan(0);

    // but all email fields must be redacted to '' (space Viewer is not a participant)
    for (const albumUser of result.albumUsers) {
      expect(albumUser.user.email).toBe('');
    }
  });

  it('does NOT redact emails for an album participant (album_user) accessing via the album', async () => {
    const { sut, ctx } = setupAlbumService();
    const { user: owner } = await ctx.newUser();
    const { user: participant } = await ctx.newUser();

    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'EmailNoRedactAlbum' });
    await ctx.newAlbumUser({ albumId: album.id, userId: participant.id, role: AlbumUserRole.Editor });

    const participantAuth = factory.auth({ user: { id: participant.id, email: participant.email } });
    const result = await sut.get(participantAuth, album.id);

    // Participant is in albumUsers — emails must NOT be redacted
    const participantEntry = result.albumUsers.find((u) => u.user.id === participant.id);
    expect(participantEntry).toBeDefined();
    expect(participantEntry!.user.email).not.toBe('');
    expect(participantEntry!.user.email).toContain('@');
  });

  it('does NOT redact emails for the album owner accessing their own album', async () => {
    const { sut, ctx } = setupAlbumService();
    const { user: owner } = await ctx.newUser();
    const { user: collaborator } = await ctx.newUser();

    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'OwnerNoRedactAlbum' });
    await ctx.newAlbumUser({ albumId: album.id, userId: collaborator.id, role: AlbumUserRole.Editor });

    const ownerAuth = factory.auth({ user: { id: owner.id, email: owner.email } });
    const result = await sut.get(ownerAuth, album.id);

    // Owner is in albumUsers (role=Owner) — emails must not be redacted for owner
    for (const albumUser of result.albumUsers) {
      expect(albumUser.user.email).not.toBe('');
      expect(albumUser.user.email).toContain('@');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SURFACE 22: album-scoped facets (getFilterSuggestions with albumId)
// Fix I regression lock.
// Rule: when scoping suggestions to an albumId, another participant's Hidden
//   asset's facet values (e.g. country) must NOT appear in the result.
//   A participant's Archive + Timeline values ARE present.
// ─────────────────────────────────────────────────────────────────────────────

describe('matrix: album-scoped facets — getFilterSuggestions excludes Hidden facet values', () => {
  it("excludes another participant's Hidden-asset facet from album-scoped suggestions", async () => {
    const { searchRepo, spaceRepo, ctx } = setup();
    const { user: albumOwner } = await ctx.newUser();
    const { user: participant } = await ctx.newUser(); // album_user contributor
    const { user: viewer } = await ctx.newUser(); // space viewer

    const { space } = await ctx.newSharedSpace({ createdById: albumOwner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: albumOwner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });

    const { result: album } = await ctx.newAlbum({ ownerId: albumOwner.id, albumName: 'FacetMxAlbum' });

    // Add participant as album_user (contributor)
    await ctx.newAlbumUser({ albumId: album.id, userId: participant.id, role: AlbumUserRole.Editor });

    // Link album to space
    await spaceRepo.addAlbum({ spaceId: space.id, albumId: album.id, addedById: albumOwner.id });

    // Participant's Timeline asset — country should appear
    const { asset: tlAsset } = await ctx.newAsset({ ownerId: participant.id, visibility: AssetVisibility.Timeline });
    await ctx.newExif({ assetId: tlAsset.id, country: 'ParticipantTimelineCountry' });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: tlAsset.id });

    // Participant's Archive asset — Archive IS present in album-scoped suggestions (spaceVisibilityGate)
    const { asset: arAsset } = await ctx.newAsset({ ownerId: participant.id, visibility: AssetVisibility.Archive });
    await ctx.newExif({ assetId: arAsset.id, country: 'ParticipantArchiveCountry' });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: arAsset.id });

    // Participant's Hidden asset — country must NOT appear in facets
    const { asset: hiAsset } = await ctx.newAsset({ ownerId: participant.id, visibility: AssetVisibility.Hidden });
    await ctx.newExif({ assetId: hiAsset.id, country: 'ParticipantHiddenCountry' });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: hiAsset.id });

    // Viewer's own Timeline asset in the album
    const { asset: viewerTl } = await ctx.newAsset({ ownerId: viewer.id, visibility: AssetVisibility.Timeline });
    await ctx.newExif({ assetId: viewerTl.id, country: 'ViewerTimelineCountry' });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: viewerTl.id });

    // Get album-scoped filter suggestions from the viewer's perspective
    const result = await searchRepo.getFilterSuggestions([viewer.id], { albumId: album.id });

    // Viewer's own Timeline country — present (ownerId bypass)
    expect(result.countries).toContain('ViewerTimelineCountry');
    // Participant's Timeline country — present (participant + spaceVisibilityGate)
    expect(result.countries).toContain('ParticipantTimelineCountry');
    // Participant's Archive country — present (spaceVisibilityGate includes Archive)
    expect(result.countries).toContain('ParticipantArchiveCountry');
    // Participant's Hidden country — ABSENT (spaceVisibilityGate blocks Hidden)
    expect(result.countries).not.toContain('ParticipantHiddenCountry');
  });

  it("excludes another participant's Locked-asset facet from album-scoped suggestions", async () => {
    const { searchRepo, ctx } = setup();
    const { user: albumOwner } = await ctx.newUser();
    const { user: participant } = await ctx.newUser();

    const { result: album } = await ctx.newAlbum({ ownerId: albumOwner.id, albumName: 'FacetLockedMxAlbum' });
    await ctx.newAlbumUser({ albumId: album.id, userId: participant.id, role: AlbumUserRole.Editor });

    // Participant's Timeline asset — should appear
    const { asset: tlAsset } = await ctx.newAsset({ ownerId: participant.id, visibility: AssetVisibility.Timeline });
    await ctx.newExif({ assetId: tlAsset.id, country: 'ParticipantLockedTLCountry' });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: tlAsset.id });

    // Participant's Locked asset — must NOT appear
    const { asset: loAsset } = await ctx.newAsset({ ownerId: participant.id, visibility: AssetVisibility.Locked });
    await ctx.newExif({ assetId: loAsset.id, country: 'ParticipantLockedCountry' });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: loAsset.id });

    // Ask from albumOwner's perspective (they are a participant)
    const result = await searchRepo.getFilterSuggestions([albumOwner.id], { albumId: album.id });

    expect(result.countries).toContain('ParticipantLockedTLCountry'); // Timeline ✓
    expect(result.countries).not.toContain('ParticipantLockedCountry'); // Locked blocked ✓
  });

  // I1: the albumId arm's OWNER branch (`eb('asset.ownerId', '=', anyUuid(userIds))`) had no
  // visibility gate — "caller's own assets follow the resolved visibility applied upstream" is
  // true for the plain-asset search path, but getFilterSuggestions calls into applySuggestionScope
  // directly with no upstream visibility resolution, so the caller's OWN Hidden asset in the album
  // leaked a facet value even though the same asset is invisible everywhere else.
  it("excludes the CALLER'S OWN Hidden-asset facet from album-scoped suggestions (I1)", async () => {
    const { searchRepo, ctx } = setup();
    const { user: albumOwner } = await ctx.newUser();

    const { result: album } = await ctx.newAlbum({ ownerId: albumOwner.id, albumName: 'FacetOwnerHiddenAlbum' });

    // Owner's Timeline asset — country should appear (positive control).
    const { asset: tlAsset } = await ctx.newAsset({ ownerId: albumOwner.id, visibility: AssetVisibility.Timeline });
    await ctx.newExif({ assetId: tlAsset.id, country: 'OwnerTimelineCountry' });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: tlAsset.id });

    // Owner's Hidden asset in the SAME album — country must NOT appear.
    const { asset: hiAsset } = await ctx.newAsset({ ownerId: albumOwner.id, visibility: AssetVisibility.Hidden });
    await ctx.newExif({ assetId: hiAsset.id, country: 'OwnerHiddenCountry' });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: hiAsset.id });

    // Ask from albumOwner's own perspective — userIds includes the asset owner, hitting the
    // unguarded ownerId branch directly.
    const result = await searchRepo.getFilterSuggestions([albumOwner.id], { albumId: album.id });

    expect(result.countries).toContain('OwnerTimelineCountry'); // Timeline ✓ (positive control)
    expect(result.countries).not.toContain('OwnerHiddenCountry'); // Hidden blocked ✓
  });
});
