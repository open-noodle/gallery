// Characterization tests for the space-album scoping consolidation (spec:
// data/sa-abstraction-spec-t8/report.md, Slice 1). These pin behaviors that the
// consolidation (Slices 2-14) MUST preserve byte-for-byte, focusing on gaps the
// existing suite leaves thin:
//   A. the timeline album leg + showInTimeline gate (asset.repository, the
//      highest-risk migration — the existing timeline spec only covers
//      direct + library paths, never the album leg).
//   B. the CURRENT (pre-fix) A1 soft-delete-hole behavior at the four sites that
//      omit `album.deletedAt IS NULL` (isFaceInSpace, getSpaceAssetAdder,
//      getAlbumAssetIdsWithoutOtherSpacePath, getAssetIdsWithoutOtherSpacePath).
//      Slices 1-14 keep these EXACTLY as they are today; Slice 15 flips them and
//      updates these assertions. The `PRE-FIX` markers below are the ones Slice 15
//      rewrites.
import { Kysely } from 'kysely';
import { AssetVisibility, TimeBucketSize } from 'src/enum';
import { AssetRepository } from 'src/repositories/asset.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';
import { factory } from 'test/small.factory';

let defaultDatabase: Kysely<DB>;

const setup = () => {
  const { ctx } = newMediumService(BaseService, {
    database: defaultDatabase,
    real: [],
    mock: [LoggingRepository],
  });
  return { ctx, shared: ctx.get(SharedSpaceRepository), asset: ctx.get(AssetRepository) };
};

type Ctx = ReturnType<typeof setup>['ctx'];

const timelineAsset = async (ctx: Ctx, ownerId: string, when: Date, options: Record<string, unknown> = {}) => {
  const { asset } = await ctx.newAsset({
    ownerId,
    visibility: AssetVisibility.Timeline,
    fileCreatedAt: when,
    localDateTime: when,
    width: 400,
    height: 200,
    thumbhash: Buffer.from('thumbhash'),
    ...options,
  });
  await ctx.newExif({ assetId: asset.id, timeZone: 'UTC' });
  return asset;
};

const yearBucketCount = async (asset: AssetRepository, spaceId: string): Promise<number> => {
  const buckets = await asset.getTimeBuckets({
    spaceId,
    visibility: AssetVisibility.Timeline,
    bucketSize: TimeBucketSize.Year,
  }, factory.auth());
  return buckets.reduce((sum, b) => sum + Number(b.count), 0);
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe('A. timeline album leg + showInTimeline gate (asset.repository.getTimeBuckets)', () => {
  it('counts assets from a linked album with showInTimeline = true', async () => {
    const { ctx, asset } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'ShownAlbum' });

    const a1 = await timelineAsset(ctx, user.id, new Date('2024-01-01T12:00:00.000Z'));
    const a2 = await timelineAsset(ctx, user.id, new Date('2024-01-02T12:00:00.000Z'));
    await ctx.newAlbumAsset({ albumId: album.id, assetId: a1.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: a2.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, showInTimeline: true });

    expect(await yearBucketCount(asset, space.id)).toBe(2);
  });

  it('does NOT count assets from a linked album with showInTimeline = false', async () => {
    const { ctx, asset } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'HiddenAlbum' });

    const a1 = await timelineAsset(ctx, user.id, new Date('2024-02-01T12:00:00.000Z'));
    await ctx.newAlbumAsset({ albumId: album.id, assetId: a1.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, showInTimeline: false });

    expect(await yearBucketCount(asset, space.id)).toBe(0);
  });

  it('does NOT count assets from a soft-deleted linked album (A1 present in timeline)', async () => {
    const { ctx, asset } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'SoftDeletedTimelineAlbum' });

    const a1 = await timelineAsset(ctx, user.id, new Date('2024-03-01T12:00:00.000Z'));
    await ctx.newAlbumAsset({ albumId: album.id, assetId: a1.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, showInTimeline: true });

    expect(await yearBucketCount(asset, space.id)).toBe(1);
    await ctx.softDeleteAlbum(album.id);
    expect(await yearBucketCount(asset, space.id)).toBe(0);
  });

  it('counts an asset reachable via BOTH a linked album and a direct add exactly once', async () => {
    const { ctx, asset } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'DedupAlbum' });

    const a1 = await timelineAsset(ctx, user.id, new Date('2024-04-01T12:00:00.000Z'));
    await ctx.newAlbumAsset({ albumId: album.id, assetId: a1.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, showInTimeline: true });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: a1.id, addedById: user.id });

    expect(await yearBucketCount(asset, space.id)).toBe(1);
  });
});

describe('B. A1 soft-delete-hole FIX (Slice 15) — a soft-deleted album is no longer a live path', () => {
  it('isFaceInSpace returns false for a face whose only path is a SOFT-DELETED album', async () => {
    const { ctx, shared } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'FaceHoleAlbum' });
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
    const { result: faceId } = await ctx.newAssetFace({ assetId: asset.id });

    await ctx.softDeleteAlbum(album.id);

    // FIXED: album leg now guards album.deletedAt, so a soft-deleted album is not a path.
    expect(await shared.isFaceInSpace(space.id, faceId)).toBe(false);
  });

  it('getSpaceAssetAdder does not attribute via a SOFT-DELETED album', async () => {
    const { ctx, shared } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'AdderHoleAlbum' });
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, addedById: user.id });

    await ctx.softDeleteAlbum(album.id);

    // FIXED: album leg now guards album.deletedAt, so no adder is resolved via the trashed album.
    const adder = await shared.getSpaceAssetAdder(space.id, asset.id);
    expect(adder).toBeUndefined();
  });

  it('getAlbumAssetIdsWithoutOtherSpacePath treats a SOFT-DELETED other album as no path (cleans up)', async () => {
    const { ctx, shared } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    const { result: albumA } = await ctx.newAlbum({ ownerId: user.id, albumName: 'HoleAlbumA' });
    const { result: albumB } = await ctx.newAlbum({ ownerId: user.id, albumName: 'HoleAlbumB' });
    const { asset: x } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newAlbumAsset({ albumId: albumA.id, assetId: x.id });
    await ctx.newAlbumAsset({ albumId: albumB.id, assetId: x.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: albumA.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: albumB.id });

    await ctx.softDeleteAlbum(albumB.id);

    // FIXED: branch 2 now guards album.deletedAt, so soft-deleted albumB is not a path and
    // X (reachable only via trashed albums) is returned for face cleanup.
    const result = await shared.getAlbumAssetIdsWithoutOtherSpacePath(space.id, albumA.id);
    expect(result).toContain(x.id);
  });

  it('getAssetIdsWithoutOtherSpacePath treats a SOFT-DELETED album as no path (cleans up)', async () => {
    const { ctx, shared } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'HoleAssetAlbum' });
    const { asset: x } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: x.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });

    await ctx.softDeleteAlbum(album.id);

    // FIXED: branch 2 now guards album.deletedAt, so the soft-deleted album is not a path and
    // X is returned for face cleanup.
    const result = await shared.getAssetIdsWithoutOtherSpacePath(space.id, [x.id]);
    expect(result).toContain(x.id);
  });
});
