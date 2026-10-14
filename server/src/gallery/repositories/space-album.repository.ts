import { Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { Chunked, ChunkedSet, DummyValue, GenerateSql } from 'src/decorators.js';
import { AlbumUserRole } from 'src/enum.js';
import { DB } from 'src/schema/index.js';

@Injectable()
export class SpaceAlbumRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  /**
   * Lightweight projection for the command palette: returns only the fields
   * needed to render an album entry (name, thumbnail, asset count, date range)
   * without the full MapAlbumDto shape or the updateThumbnails write side-effect.
   *
   * Uses a single grouped LEFT JOIN (mirroring `getMetadataForIds`) so one
   * subquery produces count + date range in a single plan, rather than three
   * correlated subqueries per row. Empty albums still appear with
   * `assetCount = 0` and null date range via COALESCE on the count.
   */
  @GenerateSql({ params: [DummyValue.UUID] })
  async getOwnedNames(ownerId: string) {
    return this.db
      .selectFrom('album')
      .leftJoin(
        (eb) =>
          eb
            .selectFrom('album_asset')
            .innerJoin('asset', 'asset.id', 'album_asset.assetId')
            .where('asset.deletedAt', 'is', null)
            .select('album_asset.albumId as albumId')
            .select((eb) => sql<number>`${eb.fn.count('album_asset.assetId')}::int`.as('assetCount'))
            .select((eb) =>
              eb.fn.min(sql<Date>`("asset"."localDateTime" AT TIME ZONE 'UTC'::text)::date`).as('startDate'),
            )
            .select((eb) =>
              eb.fn.max(sql<Date>`("asset"."localDateTime" AT TIME ZONE 'UTC'::text)::date`).as('endDate'),
            )
            .groupBy('album_asset.albumId')
            .as('metadata'),
        (join) => join.onRef('metadata.albumId', '=', 'album.id'),
      )
      .select(['album.id', 'album.albumName', 'album.albumThumbnailAssetId'])
      .select((eb) => sql<number>`coalesce(${eb.ref('metadata.assetCount')}, 0)::int`.as('assetCount'))
      .select('metadata.startDate as startDate')
      .select('metadata.endDate as endDate')
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('album_user')
            .whereRef('album_user.albumId', '=', 'album.id')
            .where('album_user.userId', '=', ownerId)
            .where('album_user.role', '=', AlbumUserRole.Owner),
        ),
      )
      .where('album.deletedAt', 'is', null)
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, [DummyValue.UUID]] })
  async getOwnedAlbumIdsForAssets(ownerId: string, assetIds: string[]) {
    if (assetIds.length === 0) {
      return [];
    }

    return this.db
      .selectFrom('album_asset')
      .innerJoin('album', 'album.id', 'album_asset.albumId')
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('album_user')
            .whereRef('album_user.albumId', '=', 'album.id')
            .where('album_user.role', '=', AlbumUserRole.Owner)
            .where('album_user.userId', '=', ownerId),
        ),
      )
      .where('album.deletedAt', 'is', null)
      .where('album_asset.assetId', 'in', assetIds)
      .select('album_asset.assetId as assetId')
      .select((eb) => eb.fn<string[]>('array_agg', ['album_asset.albumId']).as('albumIds'))
      .groupBy('album_asset.assetId')
      .execute();
  }

  /**
   * Lightweight projection for the command palette: returns only the fields
   * needed to render an album entry (name, thumbnail, asset count, date range)
   * for albums shared with or shared by the user. Mirrors `getOwnedNames`
   * (single grouped LEFT JOIN, date-only cast, coalesce'd count, no ORDER BY).
   *
   * Includes albums owned-and-shared-out by the user; dedup against
   * `getOwnedNames` is a downstream responsibility.
   */
  @GenerateSql({ params: [DummyValue.UUID] })
  async getSharedNames(userId: string) {
    return this.db
      .selectFrom('album')
      .leftJoin(
        (eb) =>
          eb
            .selectFrom('album_asset')
            .innerJoin('asset', 'asset.id', 'album_asset.assetId')
            .where('asset.deletedAt', 'is', null)
            .select('album_asset.albumId as albumId')
            .select((eb) => sql<number>`${eb.fn.count('album_asset.assetId')}::int`.as('assetCount'))
            .select((eb) =>
              eb.fn.min(sql<Date>`("asset"."localDateTime" AT TIME ZONE 'UTC'::text)::date`).as('startDate'),
            )
            .select((eb) =>
              eb.fn.max(sql<Date>`("asset"."localDateTime" AT TIME ZONE 'UTC'::text)::date`).as('endDate'),
            )
            .groupBy('album_asset.albumId')
            .as('metadata'),
        (join) => join.onRef('metadata.albumId', '=', 'album.id'),
      )
      .select(['album.id', 'album.albumName', 'album.albumThumbnailAssetId'])
      .select((eb) => sql<number>`coalesce(${eb.ref('metadata.assetCount')}, 0)::int`.as('assetCount'))
      .select('metadata.startDate as startDate')
      .select('metadata.endDate as endDate')
      .where((eb) =>
        eb.or([
          eb.exists(
            eb
              .selectFrom('album_user')
              .whereRef('album_user.albumId', '=', 'album.id')
              .where('album_user.userId', '=', userId),
          ),
          eb.exists(
            eb
              .selectFrom('shared_link')
              .whereRef('shared_link.albumId', '=', 'album.id')
              .where('shared_link.userId', '=', userId),
          ),
        ]),
      )
      .where('album.deletedAt', 'is', null)
      .execute();
  }

  // --- Cross-owner contributions (album_space_asset) — #764 ---------------------------------------
  // A contribution is a bookmark of a space photo the contributor does not own; it lives OUTSIDE
  // `album_asset` so it can never become a permanent `checkAlbumAccess` grant for the album owner.

  /** Which of `assetIds` already exist as contributions in the album (for DUPLICATE detection). */
  @GenerateSql({ params: [DummyValue.UUID, [DummyValue.UUID]] })
  @ChunkedSet({ paramIndex: 1 })
  async getContributedAssetIds(albumId: string, assetIds: string[]): Promise<Set<string>> {
    if (assetIds.length === 0) {
      return new Set();
    }

    return this.db
      .selectFrom('album_space_asset')
      .select('album_space_asset.assetId')
      .where('album_space_asset.albumId', '=', albumId)
      .where('album_space_asset.assetId', 'in', assetIds)
      .execute()
      .then((results) => new Set(results.map(({ assetId }) => assetId)));
  }

  @GenerateSql({
    params: [
      [{ albumId: DummyValue.UUID, assetId: DummyValue.UUID, spaceId: DummyValue.UUID, addedById: DummyValue.UUID }],
    ],
  })
  async addContributedAssets(
    values: { albumId: string; assetId: string; spaceId: string; addedById: string }[],
  ): Promise<void> {
    if (values.length === 0) {
      return;
    }

    await this.db
      .insertInto('album_space_asset')
      .values(values)
      .onConflict((oc) => oc.doNothing())
      .execute();
  }

  @Chunked({ paramIndex: 1 })
  async removeContributedAssetIds(albumId: string, assetIds: string[]): Promise<void> {
    if (assetIds.length === 0) {
      return;
    }

    await this.db
      .deleteFrom('album_space_asset')
      .where('album_space_asset.albumId', '=', albumId)
      .where('album_space_asset.assetId', 'in', assetIds)
      .execute();
  }
}
