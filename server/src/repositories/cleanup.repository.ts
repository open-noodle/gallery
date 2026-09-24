import { Injectable } from '@nestjs/common';
import { AliasableExpression, Expression, ExpressionBuilder, Kysely, SelectQueryBuilder, SqlBool, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { DummyValue, GenerateSql } from 'src/decorators.js';
import { CleanupAssetDto } from 'src/dtos/cleanup.dto.js';
import { AssetFileType, AssetStatus, AssetType, AssetVisibility, CleanupDecisionType, CleanupQueue } from 'src/enum.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { MONTH_DAY_SQL } from 'src/schema/cleanup-sql.js';
import { DB } from 'src/schema/index.js';
import {
  BurstRow,
  CLEANUP_BLURRY_DEFAULTS,
  CLEANUP_BLUR_THRESHOLDS,
  CLEANUP_BRIGHT,
  CLEANUP_DARK,
  CLEANUP_QUALITY_VERSION,
  CLEANUP_SPACE_HOG_DEFAULT_MIN_SIZE,
  CleanupCursor,
  CleanupStrictnessValue,
} from 'src/utils/cleanup.js';
import { anyUuid, withFilePath } from 'src/utils/database.js';

/**
 * `afterLocalDateTime` is the previous window's last `cursorT` (full precision). A `Date` is accepted
 * for convenience but only carries milliseconds.
 */
export type BurstWindowOptions = { afterLocalDateTime?: string | Date; afterId?: string; limit: number };

export type CleanupAssetTypeFilter = 'all' | 'image' | 'video';
export type CleanupBlurReason = 'all' | 'blurry' | 'dark' | 'bright';

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

/**
 * Live-photo-inclusive file size: the still's own `fileSizeInByte` plus its motion part's, when one
 * exists. Shared between `cleanupAssetColumns`' `fileSize` row column and every `countQueue` bytes
 * sum, so a hub card's total always matches the sum of what the corresponding list page shows.
 * Space hogs' own filter/sort stay on the asset's plain `fileSizeInByte` (index use) — only the
 * reported byte totals include the motion part.
 */
const cleanupFileSizeExpr = sql<number>`coalesce("asset_exif"."fileSizeInByte", 0) + coalesce((select e2."fileSizeInByte" from asset_exif e2 where e2."assetId" = asset."livePhotoVideoId"), 0)`;

/**
 * The `CleanupAssetDto` column list, shared by every query that returns `CleanupAssetRow`s
 * (rewind and the queue lists). `kept` differs per caller: rewind checks its own decision, while
 * queue list endpoints already exclude any keep for that queue at the WHERE level, so they pass a
 * `false` literal.
 */
const cleanupAssetColumns = <E extends readonly unknown[]>(
  eb: ExpressionBuilder<DB, 'asset' | 'asset_exif'>,
  kept: AliasableExpression<SqlBool>,
  ...extra: E
) =>
  [
    'asset.id' as const,
    'asset.type' as const,
    'asset.originalFileName' as const,
    'asset.localDateTime' as const,
    sql<string | null>`encode("asset"."thumbhash", 'base64')`.as('thumbhash'),
    eb.fn.coalesce('asset.width', 'asset_exif.exifImageWidth').as('width'),
    eb.fn.coalesce('asset.height', 'asset_exif.exifImageHeight').as('height'),
    'asset.duration' as const,
    cleanupFileSizeExpr.as('fileSize'),
    'asset.isFavorite' as const,
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
    'asset_exif.city' as const,
    kept.as('kept'),
    ...extra,
  ] as const;

/** `exists` subquery for `cleanup_decision` — a keep row for `queue` on this asset. */
const keptForQueue = (eb: ExpressionBuilder<DB, 'asset'>, userId: string, queue: CleanupQueue) =>
  eb.exists(
    eb
      .selectFrom('cleanup_decision')
      .select(sql.lit(1).as('one'))
      .whereRef('cleanup_decision.assetId', '=', 'asset.id')
      .where('cleanup_decision.userId', '=', userId)
      .where('cleanup_decision.queue', '=', sql.lit(queue)),
  );

/** `true` when the asset has no `cleanup_decision` keep row for `queue`. Every queue query applies this. */
const notKeptForQueue = (eb: ExpressionBuilder<DB, 'asset'>, userId: string, queue: CleanupQueue) =>
  eb.not(keptForQueue(eb, userId, queue));

/**
 * The `(localDateTime, id)` keyset cursor timestamp at full (microsecond) precision. A JS `Date` only
 * holds milliseconds, so a cursor built from one would re-admit (ascending) or skip (descending) rows
 * whose `localDateTime` has sub-millisecond digits. Every `(t, id)` cursor is built from this column.
 */
const cursorTExpr = sql<string>`to_char("asset"."localDateTime" at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/**
 * `("localDateTime", "id") <op> (cursorT::timestamptz, id)` — a row comparison, so PostgreSQL turns it
 * into an index condition on `asset_cleanup_localDateTime_idx ("ownerId", "localDateTime", "id")` and
 * a page deep in a 500k-asset library starts at the cursor instead of scanning from the top.
 */
const localDateTimeKeyset = (eb: ExpressionBuilder<DB, 'asset'>, op: '<' | '>', cursorT: string, id: string) =>
  eb(eb.refTuple('asset.localDateTime', 'asset.id'), op, eb.tuple(sql<Date>`${cursorT}::timestamptz`, id));

/** Keyset predicate for the `(localDateTime DESC, id DESC)` queues (screenshots, blurry). */
const applyLocalDateTimeCursor = <O>(qb: SelectQueryBuilder<DB, 'asset', O>, cursor: CleanupCursor | undefined) => {
  if (!cursor) {
    return qb;
  }
  return qb.where((eb) => localDateTimeKeyset(eb, '<', String(cursor.v[0]), String(cursor.v[1])));
};

/** Fetches `limit + 1` rows; when the extra row is present, drops it and builds `next` from the last kept row. */
const paginate = <T extends { id: string }>(
  rows: T[],
  limit: number,
  cursorOf: (row: T) => Array<string | number>,
): { items: T[]; next: CleanupCursor | null } => {
  if (rows.length > limit) {
    const items = rows.slice(0, limit);
    return { items, next: { v: cursorOf(items.at(-1)!) } };
  }
  return { items: rows, next: null };
};

const mapCleanupAssetRow = <T extends { fileSize: unknown; inAlbum: unknown; kept: unknown }>(row: T) => ({
  ...row,
  fileSize: Number(row.fileSize),
  inAlbum: Boolean(row.inAlbum),
  kept: Boolean(row.kept),
});

/** The three Blurry predicates, driven by the strictness/threshold constants from Task 1. */
const blurryExpressions = (strictness: CleanupStrictnessValue) => {
  const threshold = CLEANUP_BLUR_THRESHOLDS[strictness];
  return {
    isBlurry: sql<boolean>`asset_quality.sharpness < ${threshold}`,
    isDark: sql<boolean>`(asset_quality.brightness < ${CLEANUP_DARK.maxBrightness} and asset_quality."clippedDark" > ${CLEANUP_DARK.minClippedDark})`,
    isBright: sql<boolean>`asset_quality."clippedBright" > ${CLEANUP_BRIGHT.minClippedBright}`,
  };
};

const resolveReasonFilter = (
  reason: CleanupBlurReason,
  exprs: ReturnType<typeof blurryExpressions>,
): Expression<SqlBool> => {
  switch (reason) {
    case 'blurry': {
      return exprs.isBlurry;
    }
    case 'dark': {
      return exprs.isDark;
    }
    case 'bright': {
      return exprs.isBright;
    }
    default: {
      return sql<boolean>`(${exprs.isBlurry} or ${exprs.isDark} or ${exprs.isBright})`;
    }
  }
};

/** `hideFaces`: excludes assets with any visible, non-deleted face. */
const applyHideFaces = <O>(qb: SelectQueryBuilder<DB, 'asset', O>, hideFaces: boolean) =>
  qb.$if(hideFaces, (qb) =>
    qb.where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('asset_face')
            .select(sql.lit(1).as('one'))
            .whereRef('asset_face.assetId', '=', 'asset.id')
            .where('asset_face.deletedAt', 'is', null)
            .where('asset_face.isVisible', 'is', true),
        ),
      ),
    ),
  );

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
      .select((eb) => cleanupAssetColumns(eb, keptForQueue(eb, userId, CleanupQueue.Rewind)))
      .where((eb) => eb(monthDayExpr, '=', sql.lit(monthDay)))
      .where(sql<boolean>`extract(year from ("asset"."localDateTime" at time zone 'UTC')) = ${year}`)
      .orderBy('asset.localDateTime')
      .orderBy('asset.id');

    const rows = await withCleanupScope(qb, userId).execute();
    return rows.map((row) => mapCleanupAssetRow(row));
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

  /**
   * `commit`'s steps 3-5 (favourite, keep, complete-the-day) share one database transaction — the
   * trash update and its `AssetTrashAll` event, which the caller runs first, are deliberately kept
   * out of this transaction: they use `assetRepository`/`eventRepository`, and a trashed asset should
   * land even if the day-review write fails for an unrelated reason.
   */
  @GenerateSql({
    params: [
      DummyValue.UUID,
      CleanupQueue.Rewind,
      { favoriteIds: [DummyValue.UUID], keepIds: [DummyValue.UUID], completeMonthDay: DummyValue.NUMBER },
    ],
  })
  async applyCommitDecisions(
    userId: string,
    queue: CleanupQueue,
    options: { favoriteIds: string[]; keepIds: string[]; completeMonthDay?: number },
  ): Promise<void> {
    const { favoriteIds, keepIds, completeMonthDay } = options;
    const keepAll = [...new Set([...favoriteIds, ...keepIds])];

    if (favoriteIds.length === 0 && keepAll.length === 0 && completeMonthDay === undefined) {
      return;
    }

    const reviewedAt = new Date();

    await this.db.transaction().execute(async (trx) => {
      if (favoriteIds.length > 0) {
        await trx.updateTable('asset').set({ isFavorite: true }).where('id', 'in', favoriteIds).execute();
      }

      if (keepAll.length > 0) {
        await trx
          .insertInto('cleanup_decision')
          .values(keepAll.map((assetId) => ({ userId, queue, assetId, decision: CleanupDecisionType.Keep })))
          .onConflict((oc) => oc.columns(['userId', 'queue', 'assetId']).doNothing())
          .execute();
      }

      if (completeMonthDay !== undefined) {
        await trx
          .insertInto('cleanup_day_review')
          .values({ userId, monthDay: completeMonthDay, reviewedAt })
          .onConflict((oc) => oc.columns(['userId', 'monthDay']).doUpdateSet({ reviewedAt }))
          .execute();
      }
    });
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

  @GenerateSql({
    params: [DummyValue.UUID, { limit: DummyValue.NUMBER, type: 'all', minSize: DummyValue.NUMBER }],
  })
  async getSpaceHogs(
    userId: string,
    options: { cursor?: CleanupCursor; limit: number; type: CleanupAssetTypeFilter; minSize: number },
  ): Promise<{ items: CleanupAssetRow[]; next: CleanupCursor | null }> {
    const { cursor, limit, type, minSize } = options;

    let qb = this.db
      .selectFrom('asset')
      .leftJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .select((eb) => cleanupAssetColumns(eb, sql.lit(false), 'asset_exif.fileSizeInByte as sortKey'))
      .where('asset_exif.fileSizeInByte', 'is not', null)
      .where('asset_exif.fileSizeInByte', '>=', minSize);

    qb = withCleanupScope(qb, userId, { queue: true });
    qb = qb.where((eb) => notKeptForQueue(eb, userId, CleanupQueue.SpaceHogs));

    if (type !== 'all') {
      qb = qb.where('asset.type', '=', sql.lit(type === 'image' ? AssetType.Image : AssetType.Video));
    }

    qb = qb
      .$if(!!cursor, (qb) =>
        qb.where((eb) =>
          eb.or([
            eb('asset_exif.fileSizeInByte', '<', Number(cursor!.v[0])),
            eb.and([
              eb('asset_exif.fileSizeInByte', '=', Number(cursor!.v[0])),
              eb('asset.id', '<', String(cursor!.v[1])),
            ]),
          ]),
        ),
      )
      .orderBy('asset_exif.fileSizeInByte', 'desc')
      .orderBy('asset.id', 'desc')
      .limit(limit + 1);

    const rows = await qb.execute();
    const page = paginate(rows, limit, (row) => [Number(row.sortKey), row.id]);
    return {
      // `sortKey` is an internal keyset column (the asset's own `fileSizeInByte`, distinct from the
      // live-photo-inclusive `fileSize`) — strip it so returned rows match `CleanupAssetRow` exactly.
      items: page.items.map(({ sortKey: _sortKey, ...row }) => mapCleanupAssetRow(row)),
      next: page.next,
    };
  }

  @GenerateSql({ params: [DummyValue.UUID, { limit: DummyValue.NUMBER }] })
  async getScreenshots(
    userId: string,
    options: { cursor?: CleanupCursor; limit: number },
  ): Promise<{ items: CleanupAssetRow[]; next: CleanupCursor | null }> {
    const { cursor, limit } = options;

    let qb = this.db
      .selectFrom('asset')
      .innerJoin('asset_quality', 'asset_quality.assetId', 'asset.id')
      .leftJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .select((eb) => cleanupAssetColumns(eb, sql.lit(false), cursorTExpr.as('cursorT')))
      .where('asset_quality.isScreenshot', '=', sql.lit(true));

    qb = withCleanupScope(qb, userId, { queue: true });
    qb = qb.where((eb) => notKeptForQueue(eb, userId, CleanupQueue.Screenshots));
    qb = applyLocalDateTimeCursor(qb, cursor)
      .orderBy('asset.localDateTime', 'desc')
      .orderBy('asset.id', 'desc')
      .limit(limit + 1);

    const rows = await qb.execute();
    const page = paginate(rows, limit, (row) => [row.cursorT, row.id]);
    return { items: page.items.map(({ cursorT: _cursorT, ...row }) => mapCleanupAssetRow(row)), next: page.next };
  }

  @GenerateSql({
    params: [DummyValue.UUID, { limit: DummyValue.NUMBER, strictness: 'balanced', reason: 'all', hideFaces: true }],
  })
  async getBlurry(
    userId: string,
    options: {
      cursor?: CleanupCursor;
      limit: number;
      strictness: CleanupStrictnessValue;
      reason: CleanupBlurReason;
      hideFaces: boolean;
    },
  ): Promise<{ items: CleanupAssetRow[]; next: CleanupCursor | null }> {
    const { cursor, limit, strictness, reason, hideFaces } = options;
    const exprs = blurryExpressions(strictness);
    const { isBlurry, isDark, isBright } = exprs;

    let qb = this.db
      .selectFrom('asset')
      .innerJoin('asset_quality', 'asset_quality.assetId', 'asset.id')
      .leftJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .select((eb) =>
        cleanupAssetColumns(
          eb,
          sql.lit(false),
          'asset_quality.sharpness' as const,
          cursorTExpr.as('cursorT'),
          sql<'blurry' | 'dark' | 'bright' | null>`case
          when ${isBlurry} then 'blurry'
          when ${isDark} then 'dark'
          when ${isBright} then 'bright'
          else null
        end`.as('reason'),
        ),
      )
      .where('asset.type', '=', sql.lit(AssetType.Image))
      .where(resolveReasonFilter(reason, exprs));

    qb = withCleanupScope(qb, userId, { queue: true });
    qb = qb.where((eb) => notKeptForQueue(eb, userId, CleanupQueue.Blurry));
    qb = applyHideFaces(qb, hideFaces);
    qb = applyLocalDateTimeCursor(qb, cursor)
      .orderBy('asset.localDateTime', 'desc')
      .orderBy('asset.id', 'desc')
      .limit(limit + 1);

    const rows = await qb.execute();
    const page = paginate(rows, limit, (row) => [row.cursorT, row.id]);
    return {
      items: page.items.map(({ cursorT: _cursorT, ...row }) => {
        const mapped = mapCleanupAssetRow(row);
        return { ...mapped, reason: mapped.reason ?? undefined };
      }),
      next: page.next,
    };
  }

  private async countSpaceHogs(
    userId: string,
    options: { minSize?: number; type?: CleanupAssetTypeFilter },
  ): Promise<{ count: number; bytes: number }> {
    const minSize = options.minSize ?? CLEANUP_SPACE_HOG_DEFAULT_MIN_SIZE;

    let qb = this.db
      .selectFrom('asset')
      .leftJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .select((eb) => [
        eb.fn.countAll<number>().as('count'),
        eb.fn.coalesce(eb.fn.sum<number>(cleanupFileSizeExpr), sql.lit(0)).as('bytes'),
      ])
      .where('asset_exif.fileSizeInByte', 'is not', null)
      .where('asset_exif.fileSizeInByte', '>=', minSize);

    qb = withCleanupScope(qb, userId, { queue: true });
    qb = qb.where((eb) => notKeptForQueue(eb, userId, CleanupQueue.SpaceHogs));

    if (options.type && options.type !== 'all') {
      qb = qb.where('asset.type', '=', sql.lit(options.type === 'image' ? AssetType.Image : AssetType.Video));
    }

    const row = await qb.executeTakeFirstOrThrow();
    return { count: Number(row.count), bytes: Number(row.bytes) };
  }

  private async countScreenshots(userId: string): Promise<{ count: number; bytes: number }> {
    let qb = this.db
      .selectFrom('asset')
      .innerJoin('asset_quality', 'asset_quality.assetId', 'asset.id')
      .leftJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .select((eb) => [
        eb.fn.countAll<number>().as('count'),
        eb.fn.coalesce(eb.fn.sum<number>(cleanupFileSizeExpr), sql.lit(0)).as('bytes'),
      ])
      .where('asset_quality.isScreenshot', '=', sql.lit(true));

    qb = withCleanupScope(qb, userId, { queue: true });
    qb = qb.where((eb) => notKeptForQueue(eb, userId, CleanupQueue.Screenshots));

    const row = await qb.executeTakeFirstOrThrow();
    return { count: Number(row.count), bytes: Number(row.bytes) };
  }

  private async countBlurry(
    userId: string,
    options: { strictness?: CleanupStrictnessValue; reason?: CleanupBlurReason; hideFaces?: boolean },
  ): Promise<{ count: number; bytes: number }> {
    const strictness = options.strictness ?? CLEANUP_BLURRY_DEFAULTS.strictness;
    const reason = options.reason ?? CLEANUP_BLURRY_DEFAULTS.reason;
    const hideFaces = options.hideFaces ?? CLEANUP_BLURRY_DEFAULTS.hideFaces;
    const exprs = blurryExpressions(strictness);

    let qb = this.db
      .selectFrom('asset')
      .innerJoin('asset_quality', 'asset_quality.assetId', 'asset.id')
      .leftJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .select((eb) => [
        eb.fn.countAll<number>().as('count'),
        eb.fn.coalesce(eb.fn.sum<number>(cleanupFileSizeExpr), sql.lit(0)).as('bytes'),
      ])
      .where('asset.type', '=', sql.lit(AssetType.Image))
      .where(resolveReasonFilter(reason, exprs));

    qb = withCleanupScope(qb, userId, { queue: true });
    qb = qb.where((eb) => notKeptForQueue(eb, userId, CleanupQueue.Blurry));
    qb = applyHideFaces(qb, hideFaces);

    const row = await qb.executeTakeFirstOrThrow();
    return { count: Number(row.count), bytes: Number(row.bytes) };
  }

  @GenerateSql({ params: [DummyValue.UUID, 'space_hogs', {}] })
  async countQueue(
    userId: string,
    queue: 'space_hogs' | 'screenshots' | 'blurry',
    options: {
      strictness?: CleanupStrictnessValue;
      reason?: CleanupBlurReason;
      hideFaces?: boolean;
      minSize?: number;
      type?: CleanupAssetTypeFilter;
    } = {},
  ): Promise<{ count: number; bytes: number }> {
    switch (queue) {
      case 'space_hogs': {
        return this.countSpaceHogs(userId, options);
      }
      case 'screenshots': {
        return this.countScreenshots(userId);
      }
      case 'blurry': {
        return this.countBlurry(userId, options);
      }
    }
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async countDuplicates(userId: string): Promise<{ count: number; bytes: number }> {
    const row = await this.db
      .with('g', (qb) =>
        qb
          .selectFrom('asset')
          .leftJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
          .select([
            'asset.duplicateId',
            sql<number>`sum(coalesce("asset_exif"."fileSizeInByte", 0)) - max(coalesce("asset_exif"."fileSizeInByte", 0))`.as(
              'reclaim',
            ),
          ])
          .where('asset.ownerId', '=', userId)
          .where('asset.duplicateId', 'is not', null)
          .where('asset.deletedAt', 'is', null)
          .where('asset.visibility', 'in', [sql.lit(AssetVisibility.Archive), sql.lit(AssetVisibility.Timeline)])
          .where('asset.stackId', 'is', null)
          .groupBy('asset.duplicateId')
          .having((eb) => eb.fn.count('asset.id'), '>', 1),
      )
      .selectFrom('g')
      .select((eb) => [
        eb.fn.countAll<number>().as('count'),
        eb.fn.coalesce(eb.fn.sum<number>('reclaim'), sql.lit(0)).as('bytes'),
      ])
      .executeTakeFirstOrThrow();

    return { count: Number(row.count), bytes: Number(row.bytes) };
  }

  /** Public, undecorated builder — used by `getBurstWindow` and by the index-usage medium test. */
  burstWindowQuery(userId: string, options: BurstWindowOptions) {
    const { afterLocalDateTime, afterId, limit } = options;

    let qb = this.db
      .selectFrom('asset')
      .leftJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .leftJoin('asset_quality', 'asset_quality.assetId', 'asset.id')
      .select((eb) => [
        'asset.id',
        'asset.localDateTime',
        cursorTExpr.as('cursorT'),
        'asset_exif.autoStackId',
        'asset_quality.sharpness',
        eb.fn.coalesce('asset_exif.fileSizeInByte', sql.lit(0)).as('fileSize'),
      ])
      .where('asset.type', '=', sql.lit(AssetType.Image))
      // Bursts excludes every stacked asset outright (including a stack's own primary) — unlike the
      // other queues' unstacked-or-primary rule, so `withCleanupScope`'s `queue: true` stack-primary
      // branch would be dead here; use the plain scope and this explicit predicate instead.
      .where('asset.stackId', 'is', null);

    qb = withCleanupScope(qb, userId);
    qb = qb.where((eb) => notKeptForQueue(eb, userId, CleanupQueue.Bursts));

    if (afterLocalDateTime && afterId) {
      // A `Date` (tests, legacy callers) only has millisecond precision; the service passes `cursorT`.
      const cursorT = typeof afterLocalDateTime === 'string' ? afterLocalDateTime : afterLocalDateTime.toISOString();
      qb = qb.where((eb) => localDateTimeKeyset(eb, '>', cursorT, afterId));
    }

    return qb.orderBy('asset.localDateTime', 'asc').orderBy('asset.id', 'asc').limit(limit);
  }

  @GenerateSql({ params: [DummyValue.UUID, { limit: DummyValue.NUMBER }] })
  async getBurstWindow(userId: string, options: BurstWindowOptions): Promise<BurstRow[]> {
    const rows = await this.burstWindowQuery(userId, options).execute();
    return rows.map((row) => ({
      id: row.id,
      localDateTime: row.localDateTime,
      cursorT: row.cursorT,
      autoStackId: row.autoStackId,
      sharpness: row.sharpness,
      fileSize: Number(row.fileSize),
    }));
  }

  @GenerateSql({ params: [[[DummyValue.UUID, DummyValue.UUID]]] })
  async getBurstClipDistances(groups: string[][]): Promise<Map<string, number>> {
    const ids: string[] = [];
    const firsts: string[] = [];
    for (const group of groups) {
      if (group.length === 0) {
        continue;
      }
      const [first] = group;
      for (const id of group) {
        ids.push(id);
        firsts.push(first);
      }
    }

    if (ids.length === 0) {
      return new Map();
    }

    const { rows } = await sql<{ id: string; d: number }>`
      select p.id, (a.embedding <=> b.embedding) as d
      from unnest(${`{${ids}}`}::uuid[], ${`{${firsts}}`}::uuid[]) as p(id, first)
      join smart_search a on a."assetId" = p.id
      join smart_search b on b."assetId" = p.first
    `.execute(this.db);

    return new Map(rows.map((row) => [row.id, Number(row.d)]));
  }

  /**
   * One ordered pass over the user's images (the spec's `lag()` count), shaped for 500k-asset
   * libraries: `lead()` marks the last row of each group, so singletons — almost every row — are
   * dropped before the second window and the `group by`, which then only see burst members. The
   * earlier shape grouped every row and spilled a ~450k-group hash aggregate to disk (p95 377 ms at
   * 500k assets vs 239 ms for this one; see the spec's "Scale" section).
   */
  @GenerateSql({ params: [DummyValue.UUID] })
  async countBursts(userId: string): Promise<{ count: number; bytes: number }> {
    const orderClause = sql`order by "asset"."localDateTime", "asset"."id"`;

    const row = await this.db
      .with('ordered', (qb) => {
        const inner = qb
          .selectFrom('asset')
          .leftJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
          .select((eb) => [
            'asset.id as id',
            'asset.localDateTime as t',
            'asset_exif.autoStackId as s',
            eb.fn.coalesce('asset_exif.fileSizeInByte', sql.lit(0)).as('size'),
            sql<Date | null>`lag("asset"."localDateTime") over (${orderClause})`.as('prevT'),
            sql<string | null>`lag("asset_exif"."autoStackId") over (${orderClause})`.as('prevS'),
            sql<Date | null>`lead("asset"."localDateTime") over (${orderClause})`.as('nextT'),
            sql<string | null>`lead("asset_exif"."autoStackId") over (${orderClause})`.as('nextS'),
          ])
          .where('asset.type', '=', sql.lit(AssetType.Image))
          // See getBurstWindow: bursts excludes every stacked asset outright (primary included), so
          // the plain scope is used here rather than `queue: true`'s unstacked-or-primary rule.
          .where('asset.stackId', 'is', null)
          .where((eb) => notKeptForQueue(eb, userId, CleanupQueue.Bursts));
        return withCleanupScope(inner, userId);
      })
      .with('flagged', (qb) =>
        qb.selectFrom('ordered').select([
          'ordered.id',
          'ordered.t',
          'ordered.size',
          sql<number>`case
              when "prevT" is null or "t" - "prevT" > interval '2 seconds' or "prevS" is distinct from "s" then 1
              else 0
            end`.as('brk'),
          sql<number>`case
              when "nextT" is null or "nextT" - "t" > interval '2 seconds' or "nextS" is distinct from "s" then 1
              else 0
            end`.as('lastInGroup'),
        ]),
      )
      // A row that both starts and ends its group is a singleton. Every remaining group still
      // starts with a `brk = 1` row, so the running sum below keeps groups distinct.
      .with('grouped', (qb) =>
        qb
          .selectFrom('flagged')
          .select(['flagged.id', 'flagged.size', sql<number>`sum("brk") over (order by "t", "id")`.as('grp')])
          .where(sql<boolean>`not ("brk" = 1 and "lastInGroup" = 1)`),
      )
      .with('sized', (qb) =>
        qb
          .selectFrom('grouped')
          .select((eb) => [
            'grouped.grp',
            eb.fn.count<number>('grouped.id').as('n'),
            eb.fn.sum<number>('grouped.size').as('total'),
            eb.fn.max<number>('grouped.size').as('mx'),
          ])
          .groupBy('grouped.grp')
          .having((eb) => eb.fn.count('grouped.id'), '>=', 2),
      )
      .selectFrom('sized')
      .select([sql<number>`count(*)`.as('count'), sql<number>`coalesce(sum("total" - "mx"), 0)`.as('bytes')])
      .executeTakeFirstOrThrow();

    return { count: Number(row.count), bytes: Number(row.bytes) };
  }

  @GenerateSql({ params: [DummyValue.UUID, [DummyValue.UUID]] })
  async getCleanupAssets(userId: string, ids: string[]): Promise<CleanupAssetRow[]> {
    if (ids.length === 0) {
      return [];
    }

    let qb = this.db
      .selectFrom('asset')
      .leftJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .select((eb) => cleanupAssetColumns(eb, keptForQueue(eb, userId, CleanupQueue.Bursts)))
      .where('asset.id', 'in', ids);

    qb = withCleanupScope(qb, userId, { queue: true });

    const rows = await qb.execute();
    return rows.map((row) => mapCleanupAssetRow(row));
  }
}
