import { CompiledQuery, Kysely, sql } from 'kysely';
import { AssetFileType, AssetStatus, AssetType, AssetVisibility, CleanupQueue } from 'src/enum.js';
import { CleanupRepository } from 'src/repositories/cleanup.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { DB } from 'src/schema/index.js';
import { BaseService } from 'src/services/base.service.js';
import { CleanupCursor } from 'src/utils/cleanup.js';
import { newMediumService } from 'test/medium.factory.js';
import { factory } from 'test/small.factory.js';
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

  describe('getSpaceHogs', () => {
    it('sorts by fileSizeInByte descending', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset: small } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: small.id, fileSizeInByte: 1000 });
      const { asset: big } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: big.id, fileSizeInByte: 3000 });
      const { asset: medium } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: medium.id, fileSizeInByte: 2000 });

      const { items, next } = await sut.getSpaceHogs(user.id, { limit: 10, type: 'all', minSize: 0 });
      expect(items.map((i) => i.id)).toEqual([big.id, medium.id, small.id]);
      expect(next).toBeNull();
    });

    it('minSize filters out smaller assets', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset: small } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: small.id, fileSizeInByte: 1000 });
      const { asset: big } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: big.id, fileSizeInByte: 5000 });

      const { items } = await sut.getSpaceHogs(user.id, { limit: 10, type: 'all', minSize: 2000 });
      expect(items.map((i) => i.id)).toEqual([big.id]);
    });

    it('type filters to image or video', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset: image } = await ctx.newAsset({ ownerId: user.id, type: AssetType.Image });
      await ctx.newExif({ assetId: image.id, fileSizeInByte: 1000 });
      const { asset: video } = await ctx.newAsset({ ownerId: user.id, type: AssetType.Video });
      await ctx.newExif({ assetId: video.id, fileSizeInByte: 1000 });

      const images = await sut.getSpaceHogs(user.id, { limit: 10, type: 'image', minSize: 0 });
      expect(images.items.map((i) => i.id)).toEqual([image.id]);

      const videos = await sut.getSpaceHogs(user.id, { limit: 10, type: 'video', minSize: 0 });
      expect(videos.items.map((i) => i.id)).toEqual([video.id]);
    });

    it('excludes an asset with a null fileSizeInByte', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset: noExif } = await ctx.newAsset({ ownerId: user.id });
      const { asset: withSize } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: withSize.id, fileSizeInByte: 1000 });

      const { items } = await sut.getSpaceHogs(user.id, { limit: 10, type: 'all', minSize: 0 });
      expect(items.map((i) => i.id)).toEqual([withSize.id]);
      expect([noExif]).toHaveLength(1);
    });

    it('excludes a space_hogs keep but not a blurry keep', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset: kept } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: kept.id, fileSizeInByte: 1000 });
      const { asset: otherKeep } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: otherKeep.id, fileSizeInByte: 1000 });

      await sut.upsertDecisions(user.id, CleanupQueue.SpaceHogs, [kept.id]);
      await sut.upsertDecisions(user.id, CleanupQueue.Blurry, [otherKeep.id]);

      const { items } = await sut.getSpaceHogs(user.id, { limit: 10, type: 'all', minSize: 0 });
      expect(items.map((i) => i.id)).toEqual([otherKeep.id]);
    });

    it('excludes a non-primary stack member and includes the primary', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset: primary } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: primary.id, fileSizeInByte: 1000 });
      const { asset: secondary } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: secondary.id, fileSizeInByte: 1000 });
      await ctx.newStack({ ownerId: user.id }, [primary.id, secondary.id]);

      const { items } = await sut.getSpaceHogs(user.id, { limit: 10, type: 'all', minSize: 0 });
      expect(items.map((i) => i.id)).toEqual([primary.id]);
    });

    it('drops the whole stack when the primary is trashed', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset: primary } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: primary.id, fileSizeInByte: 1000 });
      const { asset: secondary } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: secondary.id, fileSizeInByte: 1000 });
      await ctx.newStack({ ownerId: user.id }, [primary.id, secondary.id]);
      await ctx.softDeleteAsset(primary.id);

      const { items } = await sut.getSpaceHogs(user.id, { limit: 10, type: 'all', minSize: 0 });
      expect(items).toEqual([]);
    });

    it('paginates with no duplicates or loss across 3 pages', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const assets: string[] = [];
      for (let i = 0; i < 5; i++) {
        const { asset } = await ctx.newAsset({ ownerId: user.id });
        await ctx.newExif({ assetId: asset.id, fileSizeInByte: 1000 + i * 100 });
        assets.push(asset.id);
      }

      const seen: string[] = [];
      let cursor: CleanupCursor | undefined;
      let pages = 0;
      for (;;) {
        const { items, next }: { items: { id: string }[]; next: CleanupCursor | null } = await sut.getSpaceHogs(
          user.id,
          { limit: 2, type: 'all', minSize: 0, cursor },
        );
        seen.push(...items.map((i) => i.id));
        pages++;
        if (!next) {
          break;
        }
        cursor = next;
        if (pages > 10) {
          throw new Error('pagination did not terminate');
        }
      }

      expect(pages).toBe(3);
      expect(seen).toHaveLength(5);
      expect(new Set(seen)).toEqual(new Set(assets));
    });

    it('breaks ties on id for equal file sizes', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset: a } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: a.id, fileSizeInByte: 1000 });
      const { asset: b } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: b.id, fileSizeInByte: 1000 });

      const [expectedFirst, expectedSecond] = [a.id, b.id].sort().toReversed();

      const page1 = await sut.getSpaceHogs(user.id, { limit: 1, type: 'all', minSize: 0 });
      expect(page1.items.map((i) => i.id)).toEqual([expectedFirst]);
      expect(page1.next).not.toBeNull();

      const page2 = await sut.getSpaceHogs(user.id, { limit: 1, type: 'all', minSize: 0, cursor: page1.next! });
      expect(page2.items.map((i) => i.id)).toEqual([expectedSecond]);
      expect(page2.next).toBeNull();
    });
  });

  describe('getScreenshots', () => {
    it('returns only assets where isScreenshot is true', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset: screenshot } = await ctx.newAsset({ ownerId: user.id });
      await sut.upsertQuality({
        assetId: screenshot.id,
        ownerId: user.id,
        sharpness: 100,
        brightness: 100,
        clippedDark: 0,
        clippedBright: 0,
        isScreenshot: true,
        version: 1,
      });
      const { asset: notScreenshot } = await ctx.newAsset({ ownerId: user.id });
      await sut.upsertQuality({
        assetId: notScreenshot.id,
        ownerId: user.id,
        sharpness: 100,
        brightness: 100,
        clippedDark: 0,
        clippedBright: 0,
        isScreenshot: false,
        version: 1,
      });

      const { items } = await sut.getScreenshots(user.id, { limit: 10 });
      expect(items.map((i) => i.id)).toEqual([screenshot.id]);
    });

    it('excludes unanalysed assets', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset: unanalysed } = await ctx.newAsset({ ownerId: user.id });

      const { items } = await sut.getScreenshots(user.id, { limit: 10 });
      expect(items).toEqual([]);
      expect([unanalysed]).toHaveLength(1);
    });

    it('paginates', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const base = new Date('2024-01-01T00:00:00Z');
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        const { asset } = await ctx.newAsset({ ownerId: user.id, localDateTime: new Date(base.getTime() + i * 1000) });
        await sut.upsertQuality({
          assetId: asset.id,
          ownerId: user.id,
          sharpness: 100,
          brightness: 100,
          clippedDark: 0,
          clippedBright: 0,
          isScreenshot: true,
          version: 1,
        });
        ids.push(asset.id);
      }

      const page1 = await sut.getScreenshots(user.id, { limit: 2 });
      expect(page1.items).toHaveLength(2);
      expect(page1.next).not.toBeNull();
      const page2 = await sut.getScreenshots(user.id, { limit: 2, cursor: page1.next! });
      expect(page2.items).toHaveLength(1);
      expect(page2.next).toBeNull();
      expect([...page1.items, ...page2.items].map((i) => i.id).sort()).toEqual([...ids].sort());
    });
  });

  describe('getBlurry', () => {
    it('filters by strictness threshold', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const idBySharpness = new Map<number, string>();
      for (const sharpness of [10, 50, 100, 500]) {
        const { asset } = await ctx.newAsset({ ownerId: user.id });
        await sut.upsertQuality({
          assetId: asset.id,
          ownerId: user.id,
          sharpness,
          brightness: 200,
          clippedDark: 0,
          clippedBright: 0,
          isScreenshot: false,
          version: 1,
        });
        idBySharpness.set(sharpness, asset.id);
      }

      const lenient = await sut.getBlurry(user.id, {
        limit: 10,
        strictness: 'lenient',
        reason: 'blurry',
        hideFaces: false,
      });
      expect(lenient.items.map((i) => i.id).toSorted()).toEqual([idBySharpness.get(10)!].toSorted());

      const balanced = await sut.getBlurry(user.id, {
        limit: 10,
        strictness: 'balanced',
        reason: 'blurry',
        hideFaces: false,
      });
      expect(balanced.items.map((i) => i.id).toSorted()).toEqual(
        [idBySharpness.get(10)!, idBySharpness.get(50)!].toSorted(),
      );

      const strict = await sut.getBlurry(user.id, {
        limit: 10,
        strictness: 'strict',
        reason: 'blurry',
        hideFaces: false,
      });
      expect(strict.items.map((i) => i.id).toSorted()).toEqual(
        [idBySharpness.get(10)!, idBySharpness.get(50)!, idBySharpness.get(100)!].toSorted(),
      );
    });

    it('reason dark requires both brightness and clippedDark thresholds', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset: bothDark } = await ctx.newAsset({ ownerId: user.id });
      await sut.upsertQuality({
        assetId: bothDark.id,
        ownerId: user.id,
        sharpness: 1000,
        brightness: 10,
        clippedDark: 0.9,
        clippedBright: 0,
        isScreenshot: false,
        version: 1,
      });
      const { asset: onlyBrightness } = await ctx.newAsset({ ownerId: user.id });
      await sut.upsertQuality({
        assetId: onlyBrightness.id,
        ownerId: user.id,
        sharpness: 1000,
        brightness: 10,
        clippedDark: 0.1,
        clippedBright: 0,
        isScreenshot: false,
        version: 1,
      });
      const { asset: onlyClipped } = await ctx.newAsset({ ownerId: user.id });
      await sut.upsertQuality({
        assetId: onlyClipped.id,
        ownerId: user.id,
        sharpness: 1000,
        brightness: 100,
        clippedDark: 0.9,
        clippedBright: 0,
        isScreenshot: false,
        version: 1,
      });

      const { items } = await sut.getBlurry(user.id, {
        limit: 10,
        strictness: 'balanced',
        reason: 'dark',
        hideFaces: false,
      });
      expect(items.map((i) => i.id)).toEqual([bothDark.id]);
    });

    it('reason bright', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset: bright } = await ctx.newAsset({ ownerId: user.id });
      await sut.upsertQuality({
        assetId: bright.id,
        ownerId: user.id,
        sharpness: 1000,
        brightness: 200,
        clippedDark: 0,
        clippedBright: 0.5,
        isScreenshot: false,
        version: 1,
      });
      const { asset: notBright } = await ctx.newAsset({ ownerId: user.id });
      await sut.upsertQuality({
        assetId: notBright.id,
        ownerId: user.id,
        sharpness: 1000,
        brightness: 200,
        clippedDark: 0,
        clippedBright: 0.1,
        isScreenshot: false,
        version: 1,
      });

      const { items } = await sut.getBlurry(user.id, {
        limit: 10,
        strictness: 'balanced',
        reason: 'bright',
        hideFaces: false,
      });
      expect(items.map((i) => i.id)).toEqual([bright.id]);
    });

    it('hideFaces excludes only an asset with a visible, non-deleted face', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset: withVisibleFace } = await ctx.newAsset({ ownerId: user.id });
      await sut.upsertQuality({
        assetId: withVisibleFace.id,
        ownerId: user.id,
        sharpness: 1,
        brightness: 200,
        clippedDark: 0,
        clippedBright: 0,
        isScreenshot: false,
        version: 1,
      });
      await ctx.newAssetFace({ assetId: withVisibleFace.id, isVisible: true, deletedAt: null });

      const { asset: withDeletedFace } = await ctx.newAsset({ ownerId: user.id });
      await sut.upsertQuality({
        assetId: withDeletedFace.id,
        ownerId: user.id,
        sharpness: 1,
        brightness: 200,
        clippedDark: 0,
        clippedBright: 0,
        isScreenshot: false,
        version: 1,
      });
      await ctx.newAssetFace({ assetId: withDeletedFace.id, isVisible: true, deletedAt: new Date() });

      const { asset: withInvisibleFace } = await ctx.newAsset({ ownerId: user.id });
      await sut.upsertQuality({
        assetId: withInvisibleFace.id,
        ownerId: user.id,
        sharpness: 1,
        brightness: 200,
        clippedDark: 0,
        clippedBright: 0,
        isScreenshot: false,
        version: 1,
      });
      await ctx.newAssetFace({ assetId: withInvisibleFace.id, isVisible: false, deletedAt: null });

      const hidden = await sut.getBlurry(user.id, {
        limit: 10,
        strictness: 'balanced',
        reason: 'blurry',
        hideFaces: true,
      });
      expect(new Set(hidden.items.map((i) => i.id))).toEqual(new Set([withDeletedFace.id, withInvisibleFace.id]));

      const shown = await sut.getBlurry(user.id, {
        limit: 10,
        strictness: 'balanced',
        reason: 'blurry',
        hideFaces: false,
      });
      expect(new Set(shown.items.map((i) => i.id))).toEqual(
        new Set([withVisibleFace.id, withDeletedFace.id, withInvisibleFace.id]),
      );
    });

    it('excludes videos', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset: video } = await ctx.newAsset({ ownerId: user.id, type: AssetType.Video });
      await sut.upsertQuality({
        assetId: video.id,
        ownerId: user.id,
        sharpness: 1,
        brightness: 200,
        clippedDark: 0,
        clippedBright: 0,
        isScreenshot: false,
        version: 1,
      });

      const { items } = await sut.getBlurry(user.id, {
        limit: 10,
        strictness: 'balanced',
        reason: 'blurry',
        hideFaces: false,
      });
      expect(items).toEqual([]);
    });
  });

  describe('countQueue', () => {
    it('matches the list length for screenshots', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      for (let i = 0; i < 3; i++) {
        const { asset } = await ctx.newAsset({ ownerId: user.id });
        await sut.upsertQuality({
          assetId: asset.id,
          ownerId: user.id,
          sharpness: 100,
          brightness: 100,
          clippedDark: 0,
          clippedBright: 0,
          isScreenshot: true,
          version: 1,
        });
      }

      const { items } = await sut.getScreenshots(user.id, { limit: 100 });
      const { count } = await sut.countQueue(user.id, 'screenshots');
      expect(count).toBe(items.length);
      expect(count).toBe(3);
    });

    it('matches the list length for blurry', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      for (const sharpness of [10, 50]) {
        const { asset } = await ctx.newAsset({ ownerId: user.id });
        await sut.upsertQuality({
          assetId: asset.id,
          ownerId: user.id,
          sharpness,
          brightness: 200,
          clippedDark: 0,
          clippedBright: 0,
          isScreenshot: false,
          version: 1,
        });
      }

      const { items } = await sut.getBlurry(user.id, {
        limit: 100,
        strictness: 'balanced',
        reason: 'all',
        hideFaces: true,
      });
      const { count } = await sut.countQueue(user.id, 'blurry');
      expect(count).toBe(items.length);
      expect(count).toBe(2);
    });
  });

  describe('countQueue bytes include the live-photo motion part', () => {
    it('space_hogs', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset: motion } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Hidden });
      await ctx.newExif({ assetId: motion.id, fileSizeInByte: 500 });
      const { asset: still } = await ctx.newAsset({ ownerId: user.id, livePhotoVideoId: motion.id });
      await ctx.newExif({ assetId: still.id, fileSizeInByte: 1500 });

      const { items } = await sut.getSpaceHogs(user.id, { limit: 10, type: 'all', minSize: 0 });
      const listTotal = items.reduce((sum, item) => sum + item.fileSize, 0);
      expect(listTotal).toBe(2000);

      const { bytes } = await sut.countQueue(user.id, 'space_hogs', { minSize: 0 });
      expect(bytes).toBe(listTotal);
    });

    it('screenshots', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset: motion } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Hidden });
      await ctx.newExif({ assetId: motion.id, fileSizeInByte: 500 });
      const { asset: still } = await ctx.newAsset({ ownerId: user.id, livePhotoVideoId: motion.id });
      await ctx.newExif({ assetId: still.id, fileSizeInByte: 1500 });
      await sut.upsertQuality({
        assetId: still.id,
        ownerId: user.id,
        sharpness: 100,
        brightness: 100,
        clippedDark: 0,
        clippedBright: 0,
        isScreenshot: true,
        version: 1,
      });

      const { items } = await sut.getScreenshots(user.id, { limit: 10 });
      const listTotal = items.reduce((sum, item) => sum + item.fileSize, 0);
      expect(listTotal).toBe(2000);

      const { bytes } = await sut.countQueue(user.id, 'screenshots');
      expect(bytes).toBe(listTotal);
    });

    it('blurry', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset: motion } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Hidden });
      await ctx.newExif({ assetId: motion.id, fileSizeInByte: 500 });
      const { asset: still } = await ctx.newAsset({ ownerId: user.id, livePhotoVideoId: motion.id });
      await ctx.newExif({ assetId: still.id, fileSizeInByte: 1500 });
      await sut.upsertQuality({
        assetId: still.id,
        ownerId: user.id,
        sharpness: 1,
        brightness: 200,
        clippedDark: 0,
        clippedBright: 0,
        isScreenshot: false,
        version: 1,
      });

      const { items } = await sut.getBlurry(user.id, {
        limit: 10,
        strictness: 'balanced',
        reason: 'all',
        hideFaces: true,
      });
      const listTotal = items.reduce((sum, item) => sum + item.fileSize, 0);
      expect(listTotal).toBe(2000);

      const { bytes } = await sut.countQueue(user.id, 'blurry');
      expect(bytes).toBe(listTotal);
    });
  });

  describe('countDuplicates', () => {
    it('counts groups of more than one, sums reclaimable bytes, and skips a singleton', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      const groupA = factory.uuid();
      const { asset: a1 } = await ctx.newAsset({ ownerId: user.id, duplicateId: groupA });
      await ctx.newExif({ assetId: a1.id, fileSizeInByte: 10 });
      const { asset: a2 } = await ctx.newAsset({ ownerId: user.id, duplicateId: groupA });
      await ctx.newExif({ assetId: a2.id, fileSizeInByte: 30 });

      const groupB = factory.uuid();
      const { asset: b1 } = await ctx.newAsset({ ownerId: user.id, duplicateId: groupB });
      await ctx.newExif({ assetId: b1.id, fileSizeInByte: 5 });
      const { asset: b2 } = await ctx.newAsset({ ownerId: user.id, duplicateId: groupB });
      await ctx.newExif({ assetId: b2.id, fileSizeInByte: 5 });
      const { asset: b3 } = await ctx.newAsset({ ownerId: user.id, duplicateId: groupB });
      await ctx.newExif({ assetId: b3.id, fileSizeInByte: 5 });

      const singleton = factory.uuid();
      const { asset: s1 } = await ctx.newAsset({ ownerId: user.id, duplicateId: singleton });
      await ctx.newExif({ assetId: s1.id, fileSizeInByte: 999 });

      const { count, bytes } = await sut.countDuplicates(user.id);
      expect(count).toBe(2);
      expect(bytes).toBe(10 + 10);
    });

    it('excludes a trashed member from its group', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const groupId = factory.uuid();
      const { asset: a1 } = await ctx.newAsset({ ownerId: user.id, duplicateId: groupId });
      await ctx.newExif({ assetId: a1.id, fileSizeInByte: 100 });
      const { asset: a2 } = await ctx.newAsset({ ownerId: user.id, duplicateId: groupId });
      await ctx.newExif({ assetId: a2.id, fileSizeInByte: 200 });
      await ctx.softDeleteAsset(a2.id);

      const { count, bytes } = await sut.countDuplicates(user.id);
      expect(count).toBe(0);
      expect(bytes).toBe(0);
    });
  });

  describe('getBurstWindow', () => {
    it('returns ascending order by localDateTime then id', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const base = new Date('2024-01-01T00:00:00Z');
      const { asset: a } = await ctx.newAsset({ ownerId: user.id, localDateTime: new Date(base.getTime() + 2000) });
      const { asset: b } = await ctx.newAsset({ ownerId: user.id, localDateTime: base });

      const rows = await sut.getBurstWindow(user.id, { limit: 10 });
      expect(rows.map((r) => r.id)).toEqual([b.id, a.id]);
    });

    it('applies the after keyset', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const base = new Date('2024-01-01T00:00:00Z');
      const { asset: a } = await ctx.newAsset({ ownerId: user.id, localDateTime: base });
      const { asset: b } = await ctx.newAsset({ ownerId: user.id, localDateTime: new Date(base.getTime() + 1000) });

      const rows = await sut.getBurstWindow(user.id, { limit: 10, afterLocalDateTime: base, afterId: a.id });
      expect(rows.map((r) => r.id)).toEqual([b.id]);
    });

    it('excludes stacked (including the primary) and kept assets', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset: primary } = await ctx.newAsset({ ownerId: user.id });
      const { asset: secondary } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newStack({ ownerId: user.id }, [primary.id, secondary.id]);
      const { asset: kept } = await ctx.newAsset({ ownerId: user.id });
      await sut.upsertDecisions(user.id, CleanupQueue.Bursts, [kept.id]);
      const { asset: normal } = await ctx.newAsset({ ownerId: user.id });

      const rows = await sut.getBurstWindow(user.id, { limit: 10 });
      const ids = rows.map((r) => r.id);
      // Bursts uses a plain `stackId IS NULL` (brief), unlike the other queues' unstacked-or-primary
      // rule: a stacked primary is still excluded, since it is already resolved into a stack.
      expect(ids).not.toContain(secondary.id);
      expect(ids).not.toContain(primary.id);
      expect(ids).not.toContain(kept.id);
      expect(ids).toContain(normal.id);
    });

    it('excludes videos', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      await ctx.newAsset({ ownerId: user.id, type: AssetType.Video });
      const { asset: image } = await ctx.newAsset({ ownerId: user.id, type: AssetType.Image });

      const rows = await sut.getBurstWindow(user.id, { limit: 10 });
      expect(rows.map((r) => r.id)).toEqual([image.id]);
    });
  });

  describe('getBurstClipDistances', () => {
    it('computes distances from the group first member and omits ids without an embedding', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset: first } = await ctx.newAsset({ ownerId: user.id });
      const { asset: close } = await ctx.newAsset({ ownerId: user.id });
      const { asset: far } = await ctx.newAsset({ ownerId: user.id });
      const { asset: missing } = await ctx.newAsset({ ownerId: user.id });

      const dims = 512;
      const firstEmbedding = `[${['1', ...Array.from({ length: dims - 1 }, () => '0')].join(',')}]`;
      const closeEmbedding = `[${['0.99', '0.01', ...Array.from({ length: dims - 2 }, () => '0')].join(',')}]`;
      const farEmbedding = `[${['0', '1', ...Array.from({ length: dims - 2 }, () => '0')].join(',')}]`;

      await ctx.database.insertInto('smart_search').values({ assetId: first.id, embedding: firstEmbedding }).execute();
      await ctx.database.insertInto('smart_search').values({ assetId: close.id, embedding: closeEmbedding }).execute();
      await ctx.database.insertInto('smart_search').values({ assetId: far.id, embedding: farEmbedding }).execute();

      const distances = await sut.getBurstClipDistances([[first.id, close.id, far.id, missing.id]]);

      expect(distances.get(close.id)).toBeLessThan(0.1);
      expect(distances.get(far.id)).toBeGreaterThan(0.1);
      expect(distances.has(missing.id)).toBe(false);
    });
  });

  describe('countBursts', () => {
    it('groups by 2-second gaps and sums reclaimable bytes per group', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const base = new Date('2024-01-01T00:00:00Z');

      for (let i = 0; i < 3; i++) {
        const { asset } = await ctx.newAsset({ ownerId: user.id, localDateTime: new Date(base.getTime() + i * 500) });
        await ctx.newExif({ assetId: asset.id, fileSizeInByte: 100 + i * 10 });
      }

      const later = new Date(base.getTime() + 3_600_000);
      for (let i = 0; i < 2; i++) {
        const { asset } = await ctx.newAsset({
          ownerId: user.id,
          localDateTime: new Date(later.getTime() + i * 500),
        });
        await ctx.newExif({ assetId: asset.id, fileSizeInByte: 200 + i * 10 });
      }

      const { asset: singleton } = await ctx.newAsset({
        ownerId: user.id,
        localDateTime: new Date(later.getTime() + 7_200_000),
      });
      await ctx.newExif({ assetId: singleton.id, fileSizeInByte: 999 });

      const { count, bytes } = await sut.countBursts(user.id);
      expect(count).toBe(2);
      expect(bytes).toBe(210 + 200);
    });
  });

  describe('getCleanupAssets', () => {
    it('hydrates the given ids, scoped to the caller, with the bursts-queue kept flag', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { user: other } = await ctx.newUser();
      const { asset: plain } = await ctx.newAsset({ ownerId: user.id });
      const { asset: kept } = await ctx.newAsset({ ownerId: user.id });
      await sut.upsertDecisions(user.id, CleanupQueue.Bursts, [kept.id]);
      const { asset: foreign } = await ctx.newAsset({ ownerId: other.id });

      const rows = await sut.getCleanupAssets(user.id, [plain.id, kept.id, foreign.id]);
      expect(new Set(rows.map((r) => r.id))).toEqual(new Set([plain.id, kept.id]));
      expect(rows.find((r) => r.id === kept.id)!.kept).toBe(true);
      expect(rows.find((r) => r.id === plain.id)!.kept).toBe(false);
    });
  });
});
