import { Injectable } from '@nestjs/common';
import { Kysely, SelectQueryBuilder, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { DummyValue, GenerateSql } from 'src/decorators.js';
import { CleanupAssetDto } from 'src/dtos/cleanup.dto.js';
import { AssetFileType, AssetStatus, AssetType, AssetVisibility, CleanupDecisionType, CleanupQueue } from 'src/enum.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { MONTH_DAY_SQL } from 'src/schema/cleanup-sql.js';
import { DB } from 'src/schema/index.js';
import { CLEANUP_QUALITY_VERSION } from 'src/utils/cleanup.js';
import { anyUuid, withFilePath } from 'src/utils/database.js';

/** Same shape as `CleanupAssetDto`, but `localDateTime` is a real `Date` (not yet serialised for the API). */
export type CleanupAssetRow = Omit<CleanupAssetDto, 'localDateTime'> & { localDateTime: Date };

/**
 * The Include/exclude scope rules shared by every Cleanup query (calendar, rewind, queues):
 * owned, not deleted, timeline/archive visibility, not offline, not in an external library.
 *
 * `queue: true` additionally applies the stack rule (queues only, not rewind or the calendar):
 * an asset is in scope only if it is not in a stack, or is its stack's primary.
 */
export const withCleanupScope = <O>(
  qb: SelectQueryBuilder<DB, 'asset', O>,
  userId: string | undefined,
  options: { queue?: boolean } = {},
) => {
  let q = qb
    .where('asset.deletedAt', 'is', null)
    .where('asset.visibility', 'in', [sql.lit(AssetVisibility.Timeline), sql.lit(AssetVisibility.Archive)])
    .where('asset.isOffline', '=', sql.lit(false))
    .where('asset.libraryId', 'is', null);
  if (userId) {
    q = q.where('asset.ownerId', '=', userId);
  }
  if (options.queue) {
    q = q.where((eb) =>
      eb.or([
        eb('asset.stackId', 'is', null),
        eb.exists(
          eb
            .selectFrom('stack')
            .select(sql.lit(1).as('one'))
            .whereRef('stack.id', '=', 'asset.stackId')
            .whereRef('stack.primaryAssetId', '=', 'asset.id'),
        ),
      ]),
    );
  }
  return q;
};

// PostgreSQL only uses the asset_localMonthDay_idx expression index when the query repeats
// MONTH_DAY_SQL's expression exactly (structurally, table-qualification included).
const monthDayExpr = sql<number>`${sql.raw(MONTH_DAY_SQL.replaceAll('"localDateTime"', '"asset"."localDateTime"'))}`;

@Injectable()
export class CleanupRepository {
  constructor(
    @InjectKysely() private db: Kysely<DB>,
    private logger: LoggingRepository,
  ) {
    this.logger.setContext(CleanupRepository.name);
  }

  @GenerateSql({
    params: [
      {
        assetId: DummyValue.UUID,
        ownerId: DummyValue.UUID,
        sharpness: DummyValue.NUMBER,
        brightness: DummyValue.NUMBER,
        clippedDark: DummyValue.NUMBER,
        clippedBright: DummyValue.NUMBER,
        isScreenshot: DummyValue.BOOLEAN,
        version: DummyValue.NUMBER,
      },
    ],
  })
  async upsertQuality(row: {
    assetId: string;
    ownerId: string;
    sharpness: number | null;
    brightness: number | null;
    clippedDark: number | null;
    clippedBright: number | null;
    isScreenshot: boolean;
    version: number;
  }): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      await trx
        .insertInto('asset_quality')
        .values(row)
        .onConflict((oc) =>
          oc.column('assetId').doUpdateSet({
            sharpness: row.sharpness,
            brightness: row.brightness,
            clippedDark: row.clippedDark,
            clippedBright: row.clippedBright,
            isScreenshot: row.isScreenshot,
            version: row.version,
          }),
        )
        .execute();

      await trx
        .updateTable('asset_job_status')
        .set({ qualityAnalyzedAt: sql`now()` })
        .where('assetId', '=', row.assetId)
        .execute();
    });
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getForQualityAnalysis(assetId: string) {
    return this.db
      .selectFrom('asset')
      .leftJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .select((eb) => [
        'asset.id',
        'asset.ownerId',
        'asset.type',
        'asset.originalFileName',
        'asset.libraryId',
        'asset.visibility',
        'asset.deletedAt',
        withFilePath(eb, AssetFileType.Preview).as('previewPath'),
        'asset_exif.make',
        'asset_exif.model',
        'asset.width',
        'asset.height',
      ])
      .where('asset.id', '=', assetId)
      .executeTakeFirst();
  }

  streamAssetsForQualityAnalysis(force: boolean) {
    let qb = this.db
      .selectFrom('asset')
      .innerJoin('asset_job_status', 'asset_job_status.assetId', 'asset.id')
      .leftJoin('asset_quality', 'asset_quality.assetId', 'asset.id')
      .select('asset.id');
    qb = withCleanupScope(qb, undefined);
    if (!force) {
      qb = qb.where((eb) =>
        eb.or([
          eb('asset_job_status.qualityAnalyzedAt', 'is', null),
          eb('asset_quality.version', '<', CLEANUP_QUALITY_VERSION),
        ]),
      );
    }
    return qb.stream();
  }

  @GenerateSql({ params: [] })
  async resetQualityAnalyzedAt(): Promise<void> {
    await this.db
      .updateTable('asset_job_status')
      .set({ qualityAnalyzedAt: null })
      .where('qualityAnalyzedAt', 'is not', null)
      .execute();
  }

  /** Public, undecorated builder — used by `getCalendarCounts` and by the index-usage medium test. */
  calendarCountsQuery(userId: string) {
    const qb = this.db
      .selectFrom('asset')
      .select([monthDayExpr.as('monthDay'), (eb) => eb.fn.countAll<number>().as('assetCount')]);
    return withCleanupScope(qb, userId).groupBy(sql.raw('1'));
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async getCalendarCounts(userId: string): Promise<Array<{ monthDay: number; assetCount: number }>> {
    const rows = await this.calendarCountsQuery(userId).execute();
    return rows.map((row) => ({ monthDay: row.monthDay, assetCount: Number(row.assetCount) }));
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async getDayReviews(userId: string): Promise<Array<{ monthDay: number; reviewedAt: Date }>> {
    return this.db
      .selectFrom('cleanup_day_review')
      .select(['monthDay', 'reviewedAt'])
      .where('userId', '=', userId)
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.NUMBER, DummyValue.DATE] })
  async upsertDayReview(userId: string, monthDay: number, reviewedAt: Date): Promise<void> {
    await this.db
      .insertInto('cleanup_day_review')
      .values({ userId, monthDay, reviewedAt })
      .onConflict((oc) => oc.columns(['userId', 'monthDay']).doUpdateSet({ reviewedAt }))
      .execute();
  }

  /** Public, undecorated builder — used by `getRewindYears` and by the index-usage medium test. */
  rewindYearsQuery(userId: string, monthDay: number) {
    const qb = this.db
      .selectFrom('asset')
      .select([
        sql<number>`extract(year from ("asset"."localDateTime" at time zone 'UTC'))::int`.as('year'),
        (eb) => eb.fn.countAll<number>().as('count'),
      ])
      .where((eb) => eb(monthDayExpr, '=', sql.lit(monthDay)));
    return withCleanupScope(qb, userId).groupBy(sql.raw('1')).orderBy(sql.raw('1'), 'desc');
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.NUMBER] })
  async getRewindYears(userId: string, monthDay: number): Promise<Array<{ year: number; count: number }>> {
    const rows = await this.rewindYearsQuery(userId, monthDay).execute();
    return rows.map((row) => ({ year: Number(row.year), count: Number(row.count) }));
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.NUMBER, DummyValue.NUMBER] })
  async getRewindAssets(userId: string, monthDay: number, year: number): Promise<CleanupAssetRow[]> {
    const qb = this.db
      .selectFrom('asset')
      .leftJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .select((eb) => [
        'asset.id',
        'asset.type',
        'asset.originalFileName',
        'asset.localDateTime',
        sql<string | null>`encode("asset"."thumbhash", 'base64')`.as('thumbhash'),
        eb.fn.coalesce('asset.width', 'asset_exif.exifImageWidth').as('width'),
        eb.fn.coalesce('asset.height', 'asset_exif.exifImageHeight').as('height'),
        'asset.duration',
        sql<number>`coalesce("asset_exif"."fileSizeInByte", 0) + coalesce((select e2."fileSizeInByte" from asset_exif e2 where e2."assetId" = asset."livePhotoVideoId"), 0)`.as(
          'fileSize',
        ),
        'asset.isFavorite',
        eb
          .exists(
            eb
              .selectFrom('album_asset')
              .innerJoin('album', 'album.id', 'album_asset.albumId')
              .whereRef('album_asset.assetId', '=', 'asset.id')
              .where('album.deletedAt', 'is', null)
              .select(sql.lit(1).as('one')),
          )
          .as('inAlbum'),
        'asset_exif.city',
        eb
          .exists(
            eb
              .selectFrom('cleanup_decision')
              .whereRef('cleanup_decision.assetId', '=', 'asset.id')
              .where('cleanup_decision.userId', '=', userId)
              .where('cleanup_decision.queue', '=', sql.lit(CleanupQueue.Rewind))
              .select(sql.lit(1).as('one')),
          )
          .as('kept'),
      ])
      .where((eb) => eb(monthDayExpr, '=', sql.lit(monthDay)))
      .where(sql<boolean>`extract(year from ("asset"."localDateTime" at time zone 'UTC')) = ${year}`)
      .orderBy('asset.localDateTime')
      .orderBy('asset.id');

    const rows = await withCleanupScope(qb, userId).execute();
    return rows.map((row) => ({
      ...row,
      fileSize: Number(row.fileSize),
      inAlbum: Boolean(row.inAlbum),
      kept: Boolean(row.kept),
    }));
  }

  @GenerateSql({ params: [DummyValue.UUID, CleanupQueue.Rewind, [DummyValue.UUID]] })
  async upsertDecisions(userId: string, queue: CleanupQueue, assetIds: string[]): Promise<void> {
    if (assetIds.length === 0) {
      return;
    }

    await this.db
      .insertInto('cleanup_decision')
      .values(assetIds.map((assetId) => ({ userId, queue, assetId, decision: CleanupDecisionType.Keep })))
      .onConflict((oc) => oc.columns(['userId', 'queue', 'assetId']).doNothing())
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, CleanupQueue.Rewind, [DummyValue.UUID]] })
  async deleteDecisions(userId: string, queue: CleanupQueue, assetIds: string[]): Promise<void> {
    if (assetIds.length === 0) {
      return;
    }

    await this.db
      .deleteFrom('cleanup_decision')
      .where('userId', '=', userId)
      .where('queue', '=', queue)
      .where('assetId', 'in', assetIds)
      .execute();
  }

  @GenerateSql({ params: [[DummyValue.UUID]] })
  async getCommitCandidates(ids: string[]): Promise<
    Array<{
      id: string;
      ownerId: string;
      deletedAt: Date | null;
      visibility: AssetVisibility;
      isOffline: boolean;
      libraryId: string | null;
    }>
  > {
    if (ids.length === 0) {
      return [];
    }

    return this.db
      .selectFrom('asset')
      .select([
        'asset.id',
        'asset.ownerId',
        'asset.deletedAt',
        'asset.visibility',
        'asset.isOffline',
        'asset.libraryId',
      ])
      .where('asset.id', 'in', ids)
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async getTrashTotals(userId: string): Promise<{ count: number; bytes: number }> {
    const row = await this.db
      .selectFrom('asset')
      .leftJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .select((eb) => [
        eb.fn.countAll<number>().as('count'),
        eb.fn.coalesce(eb.fn.sum<number>('asset_exif.fileSizeInByte'), sql.lit(0)).as('bytes'),
      ])
      .where('asset.ownerId', '=', userId)
      .where('asset.deletedAt', 'is not', null)
      .where('asset.status', '=', AssetStatus.Trashed)
      .where('asset.libraryId', 'is', null)
      .executeTakeFirstOrThrow();

    return { count: Number(row.count), bytes: Number(row.bytes) };
  }

  // Returns asset ids only (Library Cleanup Space-warning); the caller (POST /cleanup/in-spaces)
  // already scopes ids to the requesting user's own assets before this query runs.
  @GenerateSql({ params: [DummyValue.UUID, [DummyValue.UUID]] })
  async getAssetIdsInSpaces(userId: string, ids: string[]): Promise<string[]> {
    if (ids.length === 0) {
      return [];
    }

    const rows = await this.db
      .selectFrom('asset')
      .select('asset.id')
      .where('asset.id', '=', anyUuid(ids))
      .where('asset.ownerId', '=', userId)
      .where((eb) =>
        eb.or([
          eb.exists(
            eb
              .selectFrom('shared_space_asset')
              .whereRef('shared_space_asset.assetId', '=', 'asset.id')
              .select(sql.lit(1).as('one')),
          ),
          eb.exists(
            eb
              .selectFrom('shared_space_album')
              .innerJoin('album_asset', 'album_asset.albumId', 'shared_space_album.albumId')
              .innerJoin('album', 'album.id', 'shared_space_album.albumId')
              .whereRef('album_asset.assetId', '=', 'asset.id')
              .where('album.deletedAt', 'is', null)
              .select(sql.lit(1).as('one')),
          ),
        ]),
      )
      .execute();

    return rows.map((row) => row.id);
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.STRING] })
  async getAnalysedPercent(userId: string, type: 'image' | 'all'): Promise<number> {
    let qb = this.db
      .selectFrom('asset')
      .leftJoin('asset_job_status', 'asset_job_status.assetId', 'asset.id')
      .leftJoin('asset_quality', 'asset_quality.assetId', 'asset.id')
      .select((eb) => [
        eb.fn.countAll<number>().as('total'),
        eb.fn
          .count<number>('asset.id')
          .filterWhere((eb) =>
            eb.and([
              eb('asset_job_status.qualityAnalyzedAt', 'is not', null),
              eb('asset_quality.version', '>=', CLEANUP_QUALITY_VERSION),
            ]),
          )
          .as('analysed'),
      ]);

    qb = withCleanupScope(qb, userId);
    if (type === 'image') {
      qb = qb.where('asset.type', '=', sql.lit(AssetType.Image));
    }

    const row = await qb.executeTakeFirstOrThrow();
    const total = Number(row.total);
    if (total === 0) {
      return 100;
    }

    return (Number(row.analysed) / total) * 100;
  }
}
