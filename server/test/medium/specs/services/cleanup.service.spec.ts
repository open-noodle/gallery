import { Kysely } from 'kysely';
import { AssetStatus, CleanupQueue, JobName, JobStatus } from 'src/enum.js';
import { CleanupRepository } from 'src/gallery/repositories/cleanup.repository.js';
import { CleanupService } from 'src/gallery/services/cleanup.service.js';
import { CLEANUP_QUALITY_VERSION, CLEANUP_SCREENSHOT_VERSION } from 'src/gallery/utils/cleanup.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { ConfigRepository } from 'src/repositories/config.repository.js';
import { DatabaseRepository } from 'src/repositories/database.repository.js';
import { EventRepository } from 'src/repositories/event.repository.js';
import { JobRepository } from 'src/repositories/job.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository.js';
import { DB } from 'src/schema/index.js';
import { clearConfigCache } from 'src/utils/config.js';
import { MediumTestContext, newMediumService } from 'test/medium.factory.js';
import { factory } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  const { sut, ctx } = newMediumService(CleanupService, {
    database: db || defaultDatabase,
    // Config + system metadata: commit reads `trash.enabled` to choose soft- or force-delete.
    real: [AssetRepository, CleanupRepository, ConfigRepository, SystemMetadataRepository],
    mock: [EventRepository, JobRepository, LoggingRepository],
  });

  ctx.getMock(EventRepository).emit.mockResolvedValue();
  ctx.getMock(JobRepository).queueAll.mockResolvedValue();

  return { sut, ctx };
};

const getAssetRow = (ctx: MediumTestContext, id: string) =>
  ctx.database
    .selectFrom('asset')
    // asset.isFavorite is the owner's projection of the per-user favorites overlay (#763).
    .select(['id', 'status', 'deletedAt', 'isFavorite'])
    .where('id', '=', id)
    .executeTakeFirst();

/** For the quality-version cases: the real repository and database locks, mocked jobs. */
const setupVersions = (db: Kysely<DB>) => {
  const { sut, ctx } = newMediumService(CleanupService, {
    database: db,
    real: [CleanupRepository, DatabaseRepository],
    mock: [JobRepository, LoggingRepository],
  });
  ctx.getMock(JobRepository).queue.mockResolvedValue();
  ctx.getMock(JobRepository).searchJobs.mockResolvedValue([]);
  return { sut, ctx, repo: ctx.get(CleanupRepository) };
};

const analyse = async (
  ctx: MediumTestContext,
  repo: CleanupRepository,
  userId: string,
  versions: { version?: number; screenshotVersion?: number; isScreenshot?: boolean } = {},
) => {
  const { asset } = await ctx.newAsset({
    ownerId: userId,
    originalFileName: 'Screenshot 2024.png',
    // Thumbnailed: getAnalysedPercent counts an image without a thumbhash as done whatever its row says.
    thumbhash: Buffer.from('thumbhash'),
  });
  await ctx.newJobStatus({ assetId: asset.id });
  await repo.upsertQuality({
    assetId: asset.id,
    ownerId: userId,
    sharpness: 42,
    brightness: 100,
    clippedDark: 0.1,
    clippedBright: 0.2,
    isScreenshot: false,
    version: CLEANUP_QUALITY_VERSION,
    screenshotVersion: CLEANUP_SCREENSHOT_VERSION,
    ...versions,
  });
  return asset;
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

beforeEach(() => {
  clearConfigCache();
});

describe(CleanupService.name, () => {
  describe('commit', () => {
    it('trashes an owned asset in the database', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const auth = factory.auth({ user: { id: user.id } });

      const res = await sut.commit(auth, {
        queue: CleanupQueue.Rewind,
        trashIds: [asset.id],
        favoriteIds: [],
        keepIds: [],
      });

      expect(res.trashed).toEqual([asset.id]);
      expect(res.skipped).toEqual([]);
      expect(ctx.getMock(EventRepository).emit).toHaveBeenCalledWith('AssetTrashAll', {
        assetIds: [asset.id],
        userId: user.id,
      });

      const row = await getAssetRow(ctx, asset.id);
      expect(row!.status).toBe(AssetStatus.Trashed);
      expect(row!.deletedAt).not.toBeNull();
    });

    it('deletes permanently when the trash is disabled', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const auth = factory.auth({ user: { id: user.id } });

      const config = await ctx.getConfig();
      await ctx.updateConfig({ ...config, trash: { ...config.trash, enabled: false } });
      clearConfigCache();
      try {
        const res = await sut.commit(auth, {
          queue: CleanupQueue.Rewind,
          trashIds: [asset.id],
          favoriteIds: [],
          keepIds: [],
        });

        expect(res.trashed).toEqual([asset.id]);
        expect(ctx.getMock(EventRepository).emit).toHaveBeenCalledWith('AssetDeleteAll', {
          assetIds: [asset.id],
          userId: user.id,
        });
        const row = await getAssetRow(ctx, asset.id);
        expect(row!.status).toBe(AssetStatus.Deleted);
        expect(row!.deletedAt).not.toBeNull();
      } finally {
        await ctx.updateConfig(config);
        clearConfigCache();
      }
    });

    it('skips an already-trashed asset without changing its deletedAt', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const deletedAt = new Date('2024-01-01T00:00:00Z');
      const { asset } = await ctx.newAsset({ ownerId: user.id, deletedAt, status: AssetStatus.Trashed });
      const auth = factory.auth({ user: { id: user.id } });

      const res = await sut.commit(auth, {
        queue: CleanupQueue.Rewind,
        trashIds: [asset.id],
        favoriteIds: [],
        keepIds: [],
      });

      expect(res.trashed).toEqual([]);
      expect(res.skipped).toEqual([{ id: asset.id, reason: 'already_trashed' }]);
      expect(ctx.getMock(EventRepository).emit).not.toHaveBeenCalled();

      const row = await getAssetRow(ctx, asset.id);
      expect(row!.deletedAt?.toISOString()).toBe(deletedAt.toISOString());
    });

    it("reports another user's asset id as not_found, without touching it", async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { user: other } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: other.id });
      const auth = factory.auth({ user: { id: user.id } });

      const res = await sut.commit(auth, {
        queue: CleanupQueue.Rewind,
        trashIds: [asset.id],
        favoriteIds: [],
        keepIds: [],
      });

      expect(res.trashed).toEqual([]);
      expect(res.skipped).toEqual([{ id: asset.id, reason: 'not_found' }]);

      const row = await getAssetRow(ctx, asset.id);
      expect(row!.status).toBe(AssetStatus.Active);
      expect(row!.deletedAt).toBeNull();
    });

    it('writes a cleanup_day_review row when completeMonthDay is given', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const auth = factory.auth({ user: { id: user.id } });

      await sut.commit(auth, {
        queue: CleanupQueue.Rewind,
        trashIds: [],
        favoriteIds: [],
        keepIds: [],
        completeMonthDay: 923,
      });

      const reviews = await ctx.get(CleanupRepository).getDayReviews(user.id);
      expect(reviews).toHaveLength(1);
      expect(reviews[0].monthDay).toBe(923);
    });

    it('applies the favourite update, the keep decisions, and the day review together', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { asset: favAsset } = await ctx.newAsset({ ownerId: user.id });
      const { asset: keepAsset } = await ctx.newAsset({ ownerId: user.id });
      const auth = factory.auth({ user: { id: user.id } });

      const res = await sut.commit(auth, {
        queue: CleanupQueue.Rewind,
        trashIds: [],
        favoriteIds: [favAsset.id],
        keepIds: [keepAsset.id],
        completeMonthDay: 923,
      });

      expect(res).toMatchObject({ favorited: 1, kept: 2 });

      const favRow = await getAssetRow(ctx, favAsset.id);
      expect(favRow!.isFavorite).toBe(true);

      const decisions = await ctx.database
        .selectFrom('cleanup_decision')
        .select(['assetId'])
        .where('userId', '=', user.id)
        .execute();
      expect(decisions.map((d) => d.assetId).sort()).toEqual([favAsset.id, keepAsset.id].sort());

      const reviews = await ctx.get(CleanupRepository).getDayReviews(user.id);
      expect(reviews).toHaveLength(1);
      expect(reviews[0].monthDay).toBe(923);
    });

    it('rolls back all three writes together when one of them fails', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { asset: favAsset } = await ctx.newAsset({ ownerId: user.id });
      const { asset: keepAsset } = await ctx.newAsset({ ownerId: user.id });
      const auth = factory.auth({ user: { id: user.id } });

      // completeMonthDay is a `smallint` column; a value outside its range makes the day-review
      // insert fail at the database — proving the favourite update and the keep insert, which
      // already succeeded earlier in the same transaction, are rolled back rather than left applied.
      await expect(
        sut.commit(auth, {
          queue: CleanupQueue.Rewind,
          trashIds: [],
          favoriteIds: [favAsset.id],
          keepIds: [keepAsset.id],
          completeMonthDay: 999_999,
        }),
      ).rejects.toThrow();

      const favRow = await getAssetRow(ctx, favAsset.id);
      expect(favRow!.isFavorite).toBe(false);

      const decisions = await ctx.database
        .selectFrom('cleanup_decision')
        .select(['assetId'])
        .where('userId', '=', user.id)
        .execute();
      expect(decisions).toEqual([]);
    });
  });

  describe('getCalendar', () => {
    it('returns 366 days', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const auth = factory.auth({ user: { id: user.id } });

      const res = await sut.getCalendar(auth, 'UTC');
      expect(res.days).toHaveLength(366);
    });
  });

  // The automatic re-run after a CLEANUP_*_VERSION bump, and the cheap screenshot-only path it relies on.
  describe('quality analysis versions', () => {
    it('queues nothing at start when every row is current', async () => {
      const { sut, ctx, repo } = setupVersions(await getKyselyDB());
      const { user } = await ctx.newUser();
      await analyse(ctx, repo, user.id);

      await sut.onBootstrap();

      expect(ctx.getMock(JobRepository).queue).not.toHaveBeenCalled();
    });

    it('queues the stale-only re-run once at start when a row is stale', async () => {
      const { sut, ctx, repo } = setupVersions(await getKyselyDB());
      const { user } = await ctx.newUser();
      await analyse(ctx, repo, user.id, { screenshotVersion: CLEANUP_SCREENSHOT_VERSION - 1 });

      await sut.onBootstrap();

      expect(ctx.getMock(JobRepository).queue).toHaveBeenCalledTimes(1);
      expect(ctx.getMock(JobRepository).queue).toHaveBeenCalledWith({
        name: JobName.AssetAnalyzeQualityQueueAll,
        data: { force: false },
      });
    });

    it('re-stamps a screenshot-stale row without touching its pixel scores, and is then done', async () => {
      const { sut, ctx, repo } = setupVersions(await getKyselyDB());
      const { user } = await ctx.newUser();
      const asset = await analyse(ctx, repo, user.id, { screenshotVersion: CLEANUP_SCREENSHOT_VERSION - 1 });
      await expect(repo.getAnalysedPercent(user.id, 'all')).resolves.toBe(0);

      await expect(sut.handleQualityAnalysis({ id: asset.id, staleOnly: true })).resolves.toBe(JobStatus.Success);

      const row = await ctx.database
        .selectFrom('asset_quality')
        .selectAll()
        .where('assetId', '=', asset.id)
        .executeTakeFirstOrThrow();
      expect(row).toMatchObject({
        sharpness: 42,
        brightness: 100,
        isScreenshot: true,
        version: CLEANUP_QUALITY_VERSION,
        screenshotVersion: CLEANUP_SCREENSHOT_VERSION,
      });
      await expect(repo.getAnalysedPercent(user.id, 'all')).resolves.toBe(100);
      await expect(repo.hasStaleQualityAnalysis()).resolves.toBe(false);
    });
  });
});
