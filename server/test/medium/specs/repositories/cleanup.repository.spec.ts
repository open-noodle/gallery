import { CompiledQuery, Kysely, sql } from 'kysely';
import { AssetFileType, AssetStatus, AssetType, AssetVisibility, CleanupQueue } from 'src/enum.js';
import { CleanupRepository } from 'src/repositories/cleanup.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { DB } from 'src/schema/index.js';
import { BaseService } from 'src/services/base.service.js';
import { newMediumService } from 'test/medium.factory.js';
import { getKyselyDB } from 'test/utils.js';

let defaultDatabase: Kysely<DB>;
const setup = (db?: Kysely<DB>) => {
  const { ctx } = newMediumService(BaseService, {
    database: db || defaultDatabase,
    real: [],
    mock: [LoggingRepository],
  });
  return { ctx, sut: ctx.get(CleanupRepository) };
};
beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(CleanupRepository.name, () => {
  describe('getCalendarCounts / scope rules', () => {
    it('counts in-scope assets per month/day and excludes every out-of-scope kind', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { user: other } = await ctx.newUser();
      const d = new Date('2020-09-23T12:00:00Z');
      const keepA = await ctx.newAsset({ ownerId: user.id, localDateTime: d });
      const keepArchived = await ctx.newAsset({
        ownerId: user.id,
        localDateTime: d,
        visibility: AssetVisibility.Archive,
      });
      await ctx.newAsset({ ownerId: user.id, localDateTime: d, deletedAt: new Date() });
      await ctx.newAsset({ ownerId: user.id, localDateTime: d, visibility: AssetVisibility.Hidden });
      await ctx.newAsset({ ownerId: user.id, localDateTime: d, visibility: AssetVisibility.Locked });
      await ctx.newAsset({ ownerId: user.id, localDateTime: d, isOffline: true });
      await ctx.newAsset({ ownerId: other.id, localDateTime: d });
      // external library asset
      const { library } = await ctx.newLibrary({ ownerId: user.id });
      await ctx.newAsset({ ownerId: user.id, localDateTime: d, libraryId: library.id });
      const leap = await ctx.newAsset({ ownerId: user.id, localDateTime: new Date('2020-02-29T08:00:00Z') });

      const rows = await sut.getCalendarCounts(user.id);
      expect(rows).toEqual(
        expect.arrayContaining([
          { monthDay: 923, assetCount: 2 },
          { monthDay: 229, assetCount: 1 },
        ]),
      );
      expect(rows.find((r) => r.monthDay === 923)!.assetCount).toBe(2);
      expect([keepA, keepArchived, leap]).toHaveLength(3);
    });

    it('counts stack members towards the calendar even though queues would exclude them', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const d = new Date('2021-05-10T12:00:00Z');
      const { asset: primary } = await ctx.newAsset({ ownerId: user.id, localDateTime: d });
      const { asset: secondary } = await ctx.newAsset({ ownerId: user.id, localDateTime: d });
      await ctx.newStack({ ownerId: user.id }, [primary.id, secondary.id]);

      const rows = await sut.getCalendarCounts(user.id);
      expect(rows.find((r) => r.monthDay === 510)!.assetCount).toBe(2);
    });

    it('uses asset_localMonthDay_idx for calendar counts and rewind years', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const explain = (compiled: CompiledQuery) =>
        ctx.database.transaction().execute(async (trx) => {
          await sql`SET LOCAL enable_seqscan = off`.execute(trx);
          const { rows } = await trx.executeQuery<{ 'QUERY PLAN': string }>(
            CompiledQuery.raw(`EXPLAIN ${compiled.sql}`, [...compiled.parameters]),
          );
          return rows.map((r) => r['QUERY PLAN']).join('\n');
        });
      await expect(explain(sut.calendarCountsQuery(user.id).compile())).resolves.toContain('asset_localMonthDay_idx');
      await expect(explain(sut.rewindYearsQuery(user.id, 923).compile())).resolves.toContain('asset_localMonthDay_idx');
    });
  });

  describe('getDayReviews / upsertDayReview', () => {
    it('an upsert overwrites reviewedAt', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const first = new Date('2024-01-01T10:00:00Z');
      const second = new Date('2024-01-02T10:00:00Z');

      await sut.upsertDayReview(user.id, 923, first);
      await sut.upsertDayReview(user.id, 923, second);

      const rows = await sut.getDayReviews(user.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].monthDay).toBe(923);
      expect(rows[0].reviewedAt.toISOString()).toBe(second.toISOString());
    });
  });

  describe('getRewindYears', () => {
    it('groups by year, newest first, and includes stack members', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset: a2019 } = await ctx.newAsset({
        ownerId: user.id,
        localDateTime: new Date('2019-09-23T10:00:00Z'),
      });
      const { asset: a2020 } = await ctx.newAsset({
        ownerId: user.id,
        localDateTime: new Date('2020-09-23T10:00:00Z'),
      });
      const { asset: a2021primary } = await ctx.newAsset({
        ownerId: user.id,
        localDateTime: new Date('2021-09-23T10:00:00Z'),
      });
      const { asset: a2021secondary } = await ctx.newAsset({
        ownerId: user.id,
        localDateTime: new Date('2021-09-23T10:00:00Z'),
      });
      await ctx.newStack({ ownerId: user.id }, [a2021primary.id, a2021secondary.id]);
      expect([a2019, a2020]).toHaveLength(2);

      const years = await sut.getRewindYears(user.id, 923);
      expect(years).toEqual([
        { year: 2021, count: 2 },
        { year: 2020, count: 1 },
        { year: 2019, count: 1 },
      ]);
    });
  });

  describe('getRewindAssets', () => {
    it('returns the CleanupAssetRow fields, ordered by localDateTime then id', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const d1 = new Date('2020-09-23T09:00:00Z');
      const d2 = new Date('2020-09-23T10:00:00Z');
      const { asset: assetA } = await ctx.newAsset({
        ownerId: user.id,
        localDateTime: d2,
        originalFileName: 'a.jpg',
        isFavorite: true,
      });
      await ctx.newExif({ assetId: assetA.id, fileSizeInByte: 1000, city: 'Berlin' });
      const { asset: assetB } = await ctx.newAsset({
        ownerId: user.id,
        localDateTime: d1,
        originalFileName: 'b.jpg',
      });
      await ctx.newExif({ assetId: assetB.id, fileSizeInByte: 2000 });
      await ctx.newAlbum({ ownerId: user.id }, [assetB.id]);

      const rows = await sut.getRewindAssets(user.id, 923, 2020);
      expect(rows.map((r) => r.id)).toEqual([assetB.id, assetA.id]);

      const rowA = rows.find((r) => r.id === assetA.id)!;
      expect(rowA.originalFileName).toBe('a.jpg');
      expect(rowA.fileSize).toBe(1000);
      expect(rowA.isFavorite).toBe(true);
      expect(rowA.city).toBe('Berlin');
      expect(rowA.inAlbum).toBe(false);
      expect(rowA.kept).toBe(false);

      const rowB = rows.find((r) => r.id === assetB.id)!;
      expect(rowB.inAlbum).toBe(true);
      expect(rowB.fileSize).toBe(2000);
    });

    it('kept is true only for a rewind keep', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const d = new Date('2020-09-23T09:00:00Z');
      const { asset: keptAsset } = await ctx.newAsset({ ownerId: user.id, localDateTime: d });
      await ctx.newExif({ assetId: keptAsset.id, fileSizeInByte: 100 });
      const { asset: otherQueueAsset } = await ctx.newAsset({ ownerId: user.id, localDateTime: d });
      await ctx.newExif({ assetId: otherQueueAsset.id, fileSizeInByte: 100 });

      await sut.upsertDecisions(user.id, CleanupQueue.Rewind, [keptAsset.id]);
      await sut.upsertDecisions(user.id, CleanupQueue.Bursts, [otherQueueAsset.id]);

      const rows = await sut.getRewindAssets(user.id, 923, 2020);
      expect(rows.find((r) => r.id === keptAsset.id)!.kept).toBe(true);
      expect(rows.find((r) => r.id === otherQueueAsset.id)!.kept).toBe(false);
    });

    it('fileSize adds the live-photo motion part size', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const d = new Date('2020-09-23T09:00:00Z');
      const { asset: motion } = await ctx.newAsset({
        ownerId: user.id,
        localDateTime: d,
        visibility: AssetVisibility.Hidden,
      });
      await ctx.newExif({ assetId: motion.id, fileSizeInByte: 500 });
      const { asset: still } = await ctx.newAsset({ ownerId: user.id, localDateTime: d, livePhotoVideoId: motion.id });
      await ctx.newExif({ assetId: still.id, fileSizeInByte: 1500 });

      const rows = await sut.getRewindAssets(user.id, 923, 2020);
      expect(rows.find((r) => r.id === still.id)!.fileSize).toBe(2000);
    });
  });

  describe('upsertDecisions / deleteDecisions', () => {
    it('upsertDecisions is idempotent', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });

      await sut.upsertDecisions(user.id, CleanupQueue.Rewind, [asset.id]);
      await expect(sut.upsertDecisions(user.id, CleanupQueue.Rewind, [asset.id])).resolves.not.toThrow();

      const rows = await ctx.database
        .selectFrom('cleanup_decision')
        .selectAll()
        .where('assetId', '=', asset.id)
        .execute();
      expect(rows).toHaveLength(1);
    });

    it('deleteDecisions removes only the given queue rows', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });

      await sut.upsertDecisions(user.id, CleanupQueue.Rewind, [asset.id]);
      await sut.upsertDecisions(user.id, CleanupQueue.Bursts, [asset.id]);

      await sut.deleteDecisions(user.id, CleanupQueue.Rewind, [asset.id]);

      const rows = await ctx.database
        .selectFrom('cleanup_decision')
        .selectAll()
        .where('assetId', '=', asset.id)
        .execute();
      expect(rows).toHaveLength(1);
      expect(rows[0].queue).toBe(CleanupQueue.Bursts);
    });
  });

  describe('getCommitCandidates', () => {
    it('returns rows for mixed ids and omits unknown ids', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const unknownId = '00000000-0000-4000-a000-000000000123';

      const rows = await sut.getCommitCandidates([asset.id, unknownId]);
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(asset.id);
      expect(rows[0].ownerId).toBe(user.id);
    });
  });

  describe('getTrashTotals', () => {
    it('counts only trashed, owned, non-external assets and sums exif size', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { user: other } = await ctx.newUser();

      const { asset: trashed1 } = await ctx.newAsset({
        ownerId: user.id,
        deletedAt: new Date(),
        status: AssetStatus.Trashed,
      });
      await ctx.newExif({ assetId: trashed1.id, fileSizeInByte: 100 });
      const { asset: trashed2 } = await ctx.newAsset({
        ownerId: user.id,
        deletedAt: new Date(),
        status: AssetStatus.Trashed,
      });
      await ctx.newExif({ assetId: trashed2.id, fileSizeInByte: 200 });

      // not trashed
      await ctx.newAsset({ ownerId: user.id });
      // another user's trashed asset
      await ctx.newAsset({ ownerId: other.id, deletedAt: new Date(), status: AssetStatus.Trashed });
      // external library trashed asset
      const { library } = await ctx.newLibrary({ ownerId: user.id });
      await ctx.newAsset({
        ownerId: user.id,
        deletedAt: new Date(),
        status: AssetStatus.Trashed,
        libraryId: library.id,
      });

      const totals = await sut.getTrashTotals(user.id);
      expect(totals).toEqual({ count: 2, bytes: 300 });
    });
  });

  describe('getAssetIdsInSpaces', () => {
    it('returns the direct route via shared_space_asset', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { space } = await ctx.newSharedSpace({ createdById: user.id });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });

      const ids = await sut.getAssetIdsInSpaces(user.id, [asset.id]);
      expect(ids).toEqual([asset.id]);
    });

    it('returns the album route via shared_space_album + album_asset', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { album } = await ctx.newAlbum({ ownerId: user.id }, [asset.id]);
      const { space } = await ctx.newSharedSpace({ createdById: user.id });
      await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });

      const ids = await sut.getAssetIdsInSpaces(user.id, [asset.id]);
      expect(ids).toEqual([asset.id]);
    });

    it('excludes a deleted album', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { album } = await ctx.newAlbum({ ownerId: user.id }, [asset.id]);
      const { space } = await ctx.newSharedSpace({ createdById: user.id });
      await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
      await ctx.softDeleteAlbum(album.id);

      const ids = await sut.getAssetIdsInSpaces(user.id, [asset.id]);
      expect(ids).toEqual([]);
    });

    it('never returns another user asset id, even if it is in a space', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { user: other } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: other.id });
      const { space } = await ctx.newSharedSpace({ createdById: other.id });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });

      const ids = await sut.getAssetIdsInSpaces(user.id, [asset.id]);
      expect(ids).toEqual([]);
    });
  });

  describe('streamAssetsForQualityAnalysis', () => {
    it('force: false returns null-analysed and stale-version assets, skips analysed and external-library assets', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      const { asset: neverAnalyzed } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newJobStatus({ assetId: neverAnalyzed.id });

      const { asset: analyzed } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newJobStatus({ assetId: analyzed.id });
      await sut.upsertQuality({
        assetId: analyzed.id,
        ownerId: user.id,
        sharpness: 1,
        brightness: 1,
        clippedDark: 0,
        clippedBright: 0,
        isScreenshot: false,
        version: 1,
      });

      const { asset: staleVersion } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newJobStatus({ assetId: staleVersion.id });
      await sut.upsertQuality({
        assetId: staleVersion.id,
        ownerId: user.id,
        sharpness: 1,
        brightness: 1,
        clippedDark: 0,
        clippedBright: 0,
        isScreenshot: false,
        version: 0,
      });

      const { library } = await ctx.newLibrary({ ownerId: user.id });
      const { asset: external } = await ctx.newAsset({ ownerId: user.id, libraryId: library.id });
      await ctx.newJobStatus({ assetId: external.id });

      const ids = await Array.fromAsync(sut.streamAssetsForQualityAnalysis(false), (r) => r.id);
      expect(ids).toEqual(expect.arrayContaining([neverAnalyzed.id, staleVersion.id]));
      expect(ids).not.toContain(analyzed.id);
      expect(ids).not.toContain(external.id);
    });

    it('force: true returns all in-scope assets', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset: analyzed } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newJobStatus({ assetId: analyzed.id });
      await sut.upsertQuality({
        assetId: analyzed.id,
        ownerId: user.id,
        sharpness: 1,
        brightness: 1,
        clippedDark: 0,
        clippedBright: 0,
        isScreenshot: false,
        version: 1,
      });

      const { library } = await ctx.newLibrary({ ownerId: user.id });
      const { asset: external } = await ctx.newAsset({ ownerId: user.id, libraryId: library.id });
      await ctx.newJobStatus({ assetId: external.id });

      const ids = await Array.fromAsync(sut.streamAssetsForQualityAnalysis(true), (r) => r.id);
      expect(ids).toContain(analyzed.id);
      expect(ids).not.toContain(external.id);
    });
  });

  describe('upsertQuality', () => {
    it('writes the row and sets qualityAnalyzedAt', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newJobStatus({ assetId: asset.id });

      await sut.upsertQuality({
        assetId: asset.id,
        ownerId: user.id,
        sharpness: 12.5,
        brightness: 100,
        clippedDark: 0.1,
        clippedBright: 0.2,
        isScreenshot: true,
        version: 1,
      });

      const quality = await ctx.database
        .selectFrom('asset_quality')
        .selectAll()
        .where('assetId', '=', asset.id)
        .executeTakeFirstOrThrow();
      expect(quality.sharpness).toBe(12.5);
      expect(quality.isScreenshot).toBe(true);

      const status = await ctx.database
        .selectFrom('asset_job_status')
        .select('qualityAnalyzedAt')
        .where('assetId', '=', asset.id)
        .executeTakeFirstOrThrow();
      expect(status.qualityAnalyzedAt).not.toBeNull();
    });
  });

  describe('resetQualityAnalyzedAt', () => {
    it('clears qualityAnalyzedAt for all assets', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newJobStatus({ assetId: asset.id });
      await sut.upsertQuality({
        assetId: asset.id,
        ownerId: user.id,
        sharpness: 1,
        brightness: 1,
        clippedDark: 0,
        clippedBright: 0,
        isScreenshot: false,
        version: 1,
      });

      await sut.resetQualityAnalyzedAt();

      const status = await ctx.database
        .selectFrom('asset_job_status')
        .select('qualityAnalyzedAt')
        .where('assetId', '=', asset.id)
        .executeTakeFirstOrThrow();
      expect(status.qualityAnalyzedAt).toBeNull();
    });
  });

  describe('getForQualityAnalysis', () => {
    it('returns the asset with its unedited preview path', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id, originalFileName: 'photo.jpg' });
      await ctx.newExif({ assetId: asset.id, make: 'Canon', model: 'R5' });
      await ctx.newAssetFile({
        assetId: asset.id,
        type: AssetFileType.Preview,
        path: '/preview/unedited.jpg',
        isEdited: false,
      });
      await ctx.newAssetFile({
        assetId: asset.id,
        type: AssetFileType.Preview,
        path: '/preview/edited.jpg',
        isEdited: true,
      });

      const row = await sut.getForQualityAnalysis(asset.id);
      expect(row).toMatchObject({
        id: asset.id,
        ownerId: user.id,
        type: AssetType.Image,
        originalFileName: 'photo.jpg',
        previewPath: '/preview/unedited.jpg',
        make: 'Canon',
        model: 'R5',
      });
    });
  });

  describe('getAnalysedPercent', () => {
    it('returns 100 when there are no assets', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      await expect(sut.getAnalysedPercent(user.id, 'all')).resolves.toBe(100);
    });

    it('returns 50 with one of two analysed', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset: assetA } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newJobStatus({ assetId: assetA.id });
      await sut.upsertQuality({
        assetId: assetA.id,
        ownerId: user.id,
        sharpness: 1,
        brightness: 1,
        clippedDark: 0,
        clippedBright: 0,
        isScreenshot: false,
        version: 1,
      });
      const { asset: assetB } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newJobStatus({ assetId: assetB.id });

      await expect(sut.getAnalysedPercent(user.id, 'all')).resolves.toBe(50);
    });
  });
});
