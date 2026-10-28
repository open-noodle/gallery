import { Injectable } from '@nestjs/common';
import { Kysely, type Transaction, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import type { TimeBucketOptions } from 'src/repositories/asset.repository.js';
import { DummyValue, GenerateSql } from 'src/decorators.js';
import { AssetFileType, AssetOrder, AssetOrderBy, AssetStatus, TimeBucketSize } from 'src/enum.js';
import { addBucketInterval, withTimeBucketAssetFilters } from 'src/gallery/utils/time-bucket-filter.js';
import { DB } from 'src/schema/index.js';
import { asUuid, truncatedDate } from 'src/utils/database.js';
import { albumMembership } from 'src/utils/shared-space-album-scope.js';

export interface TimeBucketCoverItem {
  timeBucket: string;
  representativeAssetId: string;
  representativeThumbhash: string | null;
  representativeRatio: number;
}

// Asset queries only Gallery features use, moved out of AssetRepository unchanged.
@Injectable()
export class GalleryAssetRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  @GenerateSql({ params: [DummyValue.UUID, 1000, DummyValue.UUID] })
  getOwnedManifestAssets(ownerId: string, limit: number, cursor?: string) {
    return this.db
      .selectFrom('asset')
      .leftJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .select([
        'asset.id',
        'asset.originalPath',
        'asset.originalFileName',
        'asset.checksum',
        'asset.checksumAlgorithm',
        'asset.type',
        'asset.fileCreatedAt',
        'asset.fileModifiedAt',
      ])
      .select('asset_exif.fileSizeInByte as size')
      .where('asset.ownerId', '=', asUuid(ownerId))
      .where('asset.deletedAt', 'is', null)
      .where('asset.status', '=', AssetStatus.Active)
      .where('asset.libraryId', 'is', null)
      .where('asset.isExternal', '=', false)
      .$if(!!cursor, (qb) => qb.where('asset.id', '>', asUuid(cursor!)))
      .orderBy('asset.id')
      .limit(limit)
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getByLibraryIdWithFaces(libraryId: string, limit = 1000, offset = 0) {
    return this.db
      .selectFrom('asset')
      .innerJoin('asset_face', 'asset_face.assetId', 'asset.id')
      .select('asset.id')
      .where('asset.libraryId', '=', libraryId)
      .where('asset.deletedAt', 'is', null)
      .where('asset.isOffline', '=', false)
      .groupBy('asset.id')
      .orderBy('asset.id')
      .limit(limit)
      .offset(offset)
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID, 1000, 0] })
  getByAlbumIdWithFaces(albumId: string, spaceId: string, limit = 1000, offset = 0) {
    // #752 P1-7 / D1-b: link-time face sync must also page retained contributions on re-link, and
    // only those made through the syncing space, so an S2 link-sync never pages an S1 contribution.
    return this.db
      .selectFrom('asset')
      .innerJoin(
        (eb) => albumMembership(eb, [albumId], { spaceId }).as('album_members'),
        (join) => join.onRef('album_members.assetId', '=', 'asset.id'),
      )
      .innerJoin('asset_face', 'asset_face.assetId', 'asset.id')
      .select('asset.id')
      .where('asset.deletedAt', 'is', null)
      .where('asset.isOffline', '=', false)
      .groupBy('asset.id')
      .orderBy('asset.id')
      .limit(limit)
      .offset(offset)
      .execute();
  }

  @GenerateSql({ params: [[DummyValue.UUID]] })
  async getChecksumsByIds(ids: string[]): Promise<{ id: string; checksum: Buffer }[]> {
    if (ids.length === 0) {
      return [];
    }

    return this.db
      .selectFrom('asset')
      .select(['id', 'checksum'])
      .where(
        'id',
        'in',
        ids.map((id) => asUuid(id)),
      )
      .execute();
  }

  // #1041 slice 12: a plain COUNT variant of getTimeBuckets, reusing the exact same
  // `withTimeBucketAssetFilters` predicate (no separate counting logic to drift out of sync with the
  // real timeline). Used by the hide-preview endpoints, which run this twice — once with the caller's
  // current `hiddenScope`, once with a hypothetical scope that adds the switch being considered — and
  // diff the two totals. Cheaper than bucketing since there is no GROUP BY.
  // Optional trx handle so the #1041 slice 12 preview endpoints can re-run this INSIDE a
  // rolled-back transaction that has just performed the hypothetical hide — see
  // SharedSpaceRepository.previewInRolledBackTransaction. Every other caller omits it.
  @GenerateSql({ params: [{}] })
  async getTimelineAssetCount(options: TimeBucketOptions, db: Kysely<DB> | Transaction<DB> = this.db): Promise<number> {
    const result = await db
      .selectFrom('asset')
      .$call((qb) => withTimeBucketAssetFilters(qb, options))
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow();
    return Number(result.count);
  }

  async getTimeBucketCovers(options: TimeBucketOptions): Promise<TimeBucketCoverItem[]> {
    const requestedBuckets = options.timeBuckets ?? [];
    if (requestedBuckets.length === 0) {
      return [];
    }

    const bucketSize = options.bucketSize ?? TimeBucketSize.Month;
    const order = options.order === AssetOrder.Asc ? AssetOrder.Asc : AssetOrder.Desc;

    // Narrow the scan to the requested bucket range so this is an index-friendly
    // scan rather than a full-library sort.
    const sorted = requestedBuckets.toSorted();
    const minStart = sorted[0];
    const maxStart = sorted.at(-1)!;
    const maxEnd = addBucketInterval(maxStart, bucketSize);

    // The CTE `timeBucket` is the truncated timestamptz at UTC midnight; the requested YYYY-MM-DD
    // strings correspond to those exact values. Bound as text and cast in SQL, never as a `Date`: a bucket
    // past year 9999 is unparseable by `Date` in Postgres's unsigned spelling, and the signed
    // spelling `Date` does emit is rejected by Postgres as a timezone displacement — so the
    // round-trip is lossy in both directions. The explicit `Z` keeps the comparison pinned to UTC.
    const requestedBucketStarts = requestedBuckets.map((tb) => sql<Date>`${`${tb}T00:00:00Z`}::timestamptz`);

    // Narrow on the same column the buckets are derived from (createdAt for the
    // "date added" timeline, localDateTime otherwise) so createdAt-grouped covers
    // are not dropped by a localDateTime range filter.
    const bucketDateColumn =
      options.orderBy === AssetOrderBy.CreatedAt ? sql.ref('asset.createdAt') : sql.ref('localDateTime');

    return this.db
      .with('asset', (qb) =>
        withTimeBucketAssetFilters(
          qb
            .selectFrom('asset')
            .select((eb) => [
              truncatedDate<Date>(options.orderBy, bucketSize).as('timeBucket'),
              'asset.id',
              'asset.localDateTime', // projected for ORDER BY only
              'asset.fileCreatedAt', // projected for ORDER BY only
              sql<string | null>`encode("thumbhash", 'base64')`.as('representativeThumbhash'),
              eb.fn
                .coalesce(
                  eb
                    .case()
                    .when(
                      sql`asset."height" = 0 or asset."width" = 0 or asset."height" is null or asset."width" is null`,
                    )
                    .then(eb.lit(1))
                    .else(sql`round(asset."width"::numeric / asset."height"::numeric, 3)::float`)
                    .end(),
                  eb.lit(1),
                )
                .as('ratio'),
            ])
            .where(sql`(${bucketDateColumn} AT TIME ZONE 'UTC')::date`, '>=', minStart)
            .where(sql`(${bucketDateColumn} AT TIME ZONE 'UTC')::date`, '<', maxEnd),
          options,
        ),
      )
      .selectFrom('asset')
      .distinctOn('timeBucket')
      .where('timeBucket', 'in', requestedBucketStarts)
      .select([
        sql<string>`("timeBucket" AT TIME ZONE 'UTC')::date::text`.as('timeBucket'),
        'id as representativeAssetId',
        'representativeThumbhash',
        'ratio as representativeRatio',
      ])
      .orderBy('timeBucket', order)
      .orderBy(sql`("localDateTime" AT TIME ZONE 'UTC')::date`, order)
      .orderBy('fileCreatedAt', order)
      .execute() as any as Promise<TimeBucketCoverItem[]>;
  }

  // No @GenerateSql: undecorated repository methods are not documented; several already are.
  async getEditedEncodedVideo(assetId: string) {
    return this.db
      .selectFrom('asset_file')
      .select(['asset_file.id', 'asset_file.path'])
      .where('asset_file.assetId', '=', assetId)
      .where('asset_file.type', '=', AssetFileType.EncodedVideo)
      .where('asset_file.isEdited', '=', true)
      .executeTakeFirst();
  }

  // Gallery-fork: derivative files are stored by ownerId with no library dimension, so the
  // physical-usage walk needs the owner's external asset ids to exclude their thumbnails and
  // transcodes — upstream excludes external assets from quota entirely.
  @GenerateSql({ params: [DummyValue.UUID] })
  async getExternalAssetIds(ownerId: string): Promise<Set<string>> {
    const rows = await this.db
      .selectFrom('asset')
      .select('asset.id')
      .where('asset.ownerId', '=', asUuid(ownerId))
      .where('asset.libraryId', 'is not', null)
      .execute();

    return new Set(rows.map((row) => row.id));
  }
}
