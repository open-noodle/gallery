import { Kysely } from 'kysely';
import { AssetVisibility } from 'src/enum';
import { ActivityRepository } from 'src/repositories/activity.repository';
import { AlbumUserRepository } from 'src/repositories/album-user.repository';
import { AlbumRepository } from 'src/repositories/album.repository';
import { AssetRepository } from 'src/repositories/asset.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { UserRepository } from 'src/repositories/user.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = () => {
  const { ctx } = newMediumService(BaseService, {
    database: defaultDatabase,
    real: [ActivityRepository, AlbumRepository, AlbumUserRepository, AssetRepository, UserRepository],
    mock: [LoggingRepository],
  });
  return {
    ctx,
    activityRepo: ctx.get(ActivityRepository),
  };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe('ActivityRepository — visibility gate', () => {
  /**
   * TDD: Verifies that Hidden and Locked asset activity rows are filtered
   * out from search() and getStatistics() so that album members cannot
   * enumerate existence/content of non-visible assets.
   *
   * The check constraint on the activity table requires:
   *   - comment IS NOT NULL  when isLiked = false (a comment row)
   *   - comment IS NULL      when isLiked = true  (a like row)
   */

  it('search() excludes activity on Hidden assets', async () => {
    const { ctx, activityRepo } = setup();
    const { result: owner } = await ctx.newUser();
    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'Visibility Test' });

    const { asset: timelineAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
    const { asset: hiddenAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Hidden });

    await ctx.newAlbumAsset({ albumId: album.id, assetId: timelineAsset.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: hiddenAsset.id });

    // Create a like on each (likes: isLiked=true, comment=null)
    await activityRepo.create({ albumId: album.id, assetId: timelineAsset.id, userId: owner.id, isLiked: true });
    await activityRepo.create({ albumId: album.id, assetId: hiddenAsset.id, userId: owner.id, isLiked: true });

    const results = await activityRepo.search({ albumId: album.id });

    const assetIds = results.map((r) => r.assetId);
    expect(assetIds).toContain(timelineAsset.id);
    expect(assetIds).not.toContain(hiddenAsset.id);
  });

  it('search() excludes activity on Locked assets', async () => {
    const { ctx, activityRepo } = setup();
    const { result: owner } = await ctx.newUser();
    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'Locked Test' });

    const { asset: timelineAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
    const { asset: lockedAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Locked });

    await ctx.newAlbumAsset({ albumId: album.id, assetId: timelineAsset.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: lockedAsset.id });

    await activityRepo.create({ albumId: album.id, assetId: timelineAsset.id, userId: owner.id, isLiked: true });
    await activityRepo.create({ albumId: album.id, assetId: lockedAsset.id, userId: owner.id, isLiked: true });

    const results = await activityRepo.search({ albumId: album.id });

    const assetIds = results.map((r) => r.assetId);
    expect(assetIds).toContain(timelineAsset.id);
    expect(assetIds).not.toContain(lockedAsset.id);
  });

  it('search() includes activity on Archive assets', async () => {
    const { ctx, activityRepo } = setup();
    const { result: owner } = await ctx.newUser();
    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'Archive Test' });

    const { asset: archiveAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Archive });

    await ctx.newAlbumAsset({ albumId: album.id, assetId: archiveAsset.id });
    await activityRepo.create({ albumId: album.id, assetId: archiveAsset.id, userId: owner.id, isLiked: true });

    const results = await activityRepo.search({ albumId: album.id });

    const assetIds = results.map((r) => r.assetId);
    expect(assetIds).toContain(archiveAsset.id);
  });

  it('search() still returns album-level activity (assetId is null)', async () => {
    const { ctx, activityRepo } = setup();
    const { result: owner } = await ctx.newUser();
    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'Album Like Test' });

    // Album-level like (assetId = null) — no FK to album_asset, isLiked=true, comment=null
    await activityRepo.create({ albumId: album.id, assetId: null, userId: owner.id, isLiked: true });

    const results = await activityRepo.search({ albumId: album.id });

    expect(results).toHaveLength(1);
    expect(results[0].assetId).toBeNull();
  });

  it('getStatistics() excludes Hidden asset activity from counts', async () => {
    const { ctx, activityRepo } = setup();
    const { result: owner } = await ctx.newUser();
    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'Stats Hidden Test' });

    const { asset: timelineAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
    const { asset: hiddenAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Hidden });

    await ctx.newAlbumAsset({ albumId: album.id, assetId: timelineAsset.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: hiddenAsset.id });

    // 1 comment on visible, 1 comment on hidden (isLiked=false requires comment IS NOT NULL)
    await activityRepo.create({
      albumId: album.id,
      assetId: timelineAsset.id,
      userId: owner.id,
      isLiked: false,
      comment: 'visible comment',
    });
    await activityRepo.create({
      albumId: album.id,
      assetId: hiddenAsset.id,
      userId: owner.id,
      isLiked: false,
      comment: 'hidden comment',
    });

    const stats = await activityRepo.getStatistics({ albumId: album.id });

    // Only the visible asset comment should count
    expect(Number(stats.comments)).toBe(1);
    expect(Number(stats.likes)).toBe(0);
  });

  it('getStatistics() excludes Locked asset activity from counts', async () => {
    const { ctx, activityRepo } = setup();
    const { result: owner } = await ctx.newUser();
    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'Stats Locked Test' });

    const { asset: timelineAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
    const { asset: lockedAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Locked });

    await ctx.newAlbumAsset({ albumId: album.id, assetId: timelineAsset.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: lockedAsset.id });

    // 1 like on visible, 1 like on locked (isLiked=true, comment=null)
    await activityRepo.create({ albumId: album.id, assetId: timelineAsset.id, userId: owner.id, isLiked: true });
    await activityRepo.create({ albumId: album.id, assetId: lockedAsset.id, userId: owner.id, isLiked: true });

    const stats = await activityRepo.getStatistics({ albumId: album.id });

    // Only the visible asset like should count
    expect(Number(stats.likes)).toBe(1);
    expect(Number(stats.comments)).toBe(0);
  });

  // I2: excludeAlbumLevel drops assetId-IS-NULL (album-level) rows from the counts — used for
  // space-only readers, who must not learn album-level comment/like totals.
  it('getStatistics({ excludeAlbumLevel: true }) drops album-level counts, keeps asset-level (I2)', async () => {
    const { ctx, activityRepo } = setup();
    const { result: owner } = await ctx.newUser();
    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'Stats ExcludeAlbumLevel Test' });

    const { asset: timelineAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: timelineAsset.id });

    // Asset-level comment — should always count.
    await activityRepo.create({
      albumId: album.id,
      assetId: timelineAsset.id,
      userId: owner.id,
      isLiked: false,
      comment: 'asset comment',
    });
    // Album-level like (assetId = null) — should be dropped when excludeAlbumLevel is set.
    await activityRepo.create({ albumId: album.id, assetId: null, userId: owner.id, isLiked: true });

    const fullStats = await activityRepo.getStatistics({ albumId: album.id });
    expect(Number(fullStats.comments)).toBe(1);
    expect(Number(fullStats.likes)).toBe(1); // positive control: album-level like counted by default

    const scopedStats = await activityRepo.getStatistics({ albumId: album.id, excludeAlbumLevel: true });
    expect(Number(scopedStats.comments)).toBe(1); // asset-level comment still counted
    expect(Number(scopedStats.likes)).toBe(0); // album-level like excluded
  });
});
