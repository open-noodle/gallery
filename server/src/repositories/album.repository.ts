import { Injectable } from '@nestjs/common';
import {
  ExpressionBuilder,
  Insertable,
  Kysely,
  NotNull,
  Selectable,
  ShallowDehydrateObject,
  sql,
  Updateable,
} from 'kysely';
import { jsonArrayFrom, jsonObjectFrom } from 'kysely/helpers/postgres';
import { InjectKysely } from 'nestjs-kysely';
import { columns } from 'src/database';
import { Chunked, ChunkedArray, ChunkedSet, DummyValue, GenerateSql } from 'src/decorators';
import { AlbumUserCreateDto, MapAlbumDto } from 'src/dtos/album.dto';
import { AlbumUserRole } from 'src/enum';
import { DB } from 'src/schema';
import { AlbumTable } from 'src/schema/tables/album.table';
import { AssetExifTable } from 'src/schema/tables/asset-exif.table';
import { asUuid, dummy, withDefaultVisibility } from 'src/utils/database';
import { accessibleSpaceAlbums, spaceVisibilityGate } from 'src/utils/shared-space-album-scope';

export interface AlbumAssetCount {
  albumId: string;
  assetCount: number;
  startDate: Date | null;
  endDate: Date | null;
  lastModifiedAssetTimestamp: Date | null;
}

export interface AlbumInfoOptions {
  withAssets: boolean;
}

const withAlbumUsers = (authUserId?: string) => (eb: ExpressionBuilder<DB, 'album'>) =>
  jsonArrayFrom(
    eb
      .selectFrom('album_user')
      .innerJoin('user', 'user.id', 'album_user.userId')
      .whereRef('album_user.albumId', '=', 'album.id')
      .select('album_user.role')
      .select((eb) => jsonObjectFrom(eb.selectFrom(dummy).select(columns.user)).$notNull().as('user'))
      .orderBy('album_user.role')
      .$if(!!authUserId, (qb) => qb.orderBy((eb) => eb('album_user.userId', '=', authUserId!), 'desc'))
      .orderBy('user.name', 'asc'),
  )
    .$notNull()
    .as('albumUsers');

const withSharedLink = (eb: ExpressionBuilder<DB, 'album'>) =>
  jsonArrayFrom(
    eb.selectFrom('shared_link').selectAll('shared_link').whereRef('shared_link.albumId', '=', 'album.id'),
  ).as('sharedLinks');

const withAssets = (eb: ExpressionBuilder<DB, 'album'>) => {
  return eb
    .selectFrom((eb) =>
      eb
        .selectFrom('asset')
        .selectAll('asset')
        .leftJoin('asset_exif', 'asset.id', 'asset_exif.assetId')
        .select((eb) =>
          eb.table('asset_exif').$castTo<ShallowDehydrateObject<Selectable<AssetExifTable>>>().as('exifInfo'),
        )
        .innerJoin('album_asset', 'album_asset.assetId', 'asset.id')
        .whereRef('album_asset.albumId', '=', 'album.id')
        .where('asset.deletedAt', 'is', null)
        .$call(withDefaultVisibility)
        .orderBy('asset.fileCreatedAt', 'desc')
        .as('asset'),
    )
    .select((eb) => eb.fn.jsonAgg('asset').as('assets'))
    .as('assets');
};

const isAlbumOwned = (ownerId: string) => (eb: ExpressionBuilder<DB, 'album'>) =>
  eb.exists(
    eb
      .selectFrom('album_user')
      .whereRef('album_user.albumId', '=', 'album.id')
      .where('album_user.role', '=', AlbumUserRole.Owner)
      .where('album_user.userId', '=', ownerId),
  );

@Injectable()
export class AlbumRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  @GenerateSql({ params: [DummyValue.UUID, { withAssets: true }, DummyValue.UUID] })
  getById(id: string, options: AlbumInfoOptions, authUserId?: string) {
    return this.db
      .with('album_user', (qb) => qb.selectFrom('album_user').selectAll().where('album_user.albumId', '=', id))
      .selectFrom('album')
      .selectAll('album')
      .where('album.id', '=', id)
      .where('album.deletedAt', 'is', null)
      .select(withAlbumUsers(authUserId))
      .select(withSharedLink)
      .$if(options.withAssets, (eb) => eb.select(withAssets))
      .$narrowType<{ assets: NotNull }>()
      .executeTakeFirst();
  }

  /**
   * Albums containing `assetId` that the caller can actually open — the asset-viewer info panel
   * reads this to render "Contained in" (#796). Two access paths are unioned: shared directly into
   * the album (`album_user`), or the album is linked into a shared space the caller can access.
   *
   * Deliberately NOT every album containing the asset: album names are user-authored and a space
   * member must not learn the owner's private album titles. Callers do not separately authorize
   * `assetId` (see AlbumService.getAll) — this scoping IS the access check.
   */
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  getByAssetId(ownerId: string, assetId: string) {
    return this.db
      .selectFrom('album')
      .selectAll('album')
      .innerJoin('album_asset', 'album_asset.albumId', 'album.id')
      .where((eb) =>
        eb.or([
          eb.exists(
            eb
              .selectFrom('album_user')
              .whereRef('album_user.albumId', '=', 'album.id')
              .where('album_user.userId', '=', ownerId),
          ),
          eb.and([
            eb('album.id', 'in', (e) => accessibleSpaceAlbums(e, ownerId)),
            // A space member must never learn that another member's Hidden/Locked asset sits in a
            // linked album, so the space arm carries the space-shareable visibility gate
            // (Archive/Timeline). The album_user arm above is deliberately NOT gated: an album
            // member — including the owner, who always has an album_user row — keeps seeing
            // "Contained in" for their own Hidden/Locked assets.
            eb.exists(
              eb
                .selectFrom('asset')
                .select(eb.lit(1).as('exists'))
                .whereRef('asset.id', '=', 'album_asset.assetId')
                .where((e) => spaceVisibilityGate(e)),
            ),
          ]),
        ]),
      )
      .where('album_asset.assetId', '=', assetId)
      .where('album.deletedAt', 'is', null)
      .select(withAlbumUsers(ownerId))
      .orderBy('album.createdAt', 'desc')
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, [DummyValue.UUID]] })
  @ChunkedSet({ paramIndex: 1 })
  async getByAssetIds(ownerId: string, assetIds: string[]): Promise<Map<string, string[]>> {
    if (assetIds.length === 0) {
      return new Map();
    }

    const results = await this.db
      .selectFrom('album')
      .select('album.id')
      .innerJoin('album_asset', 'album_asset.albumId', 'album.id')
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('album_user')
            .whereRef('album_user.albumId', '=', 'album.id')
            .where('album_user.userId', '=', ownerId),
        ),
      )
      .where('album_asset.assetId', 'in', assetIds)
      .where('album.deletedAt', 'is', null)
      .select('album_asset.assetId')
      .execute();

    // Group by assetId
    const map = new Map<string, string[]>();
    for (const row of results) {
      const existing = map.get(row.assetId) ?? [];
      existing.push(row.id);
      map.set(row.assetId, existing);
    }

    return map;
  }

  @GenerateSql({ params: [[DummyValue.UUID]] }, { params: [[DummyValue.UUID], { forUserId: DummyValue.UUID }] })
  @ChunkedArray()
  async getMetadataForIds(
    ids: string[],
    // #1018: `spaceId` narrows the contributed arm to a single space instead of every space
    // `forUserId` belongs to. Set for shared-link reads, where widening would count another
    // space's contributions into a public link's total.
    { forUserId, spaceId }: { forUserId?: string; spaceId?: string } = {},
  ): Promise<AlbumAssetCount[]> {
    // Guard against running invalid query when ids list is empty.
    if (ids.length === 0) {
      return [];
    }

    return (
      this.db
        .selectFrom('asset')
        .$call(withDefaultVisibility)
        .innerJoin(
          (eb) => {
            // #752 P1-5: album metadata = owner rows ∪ member-gated contributions, so card counts
            // and date ranges agree with the grid (P0-2) for the SAME viewer. The contributed arm
            // requires a LIVE album↔space link (D1-b: retained rows of an unlinked album are inert)
            // and live membership of `forUserId`. UNION dedupes a P1-6 coexistence-window pair.
            const ownerRows = eb
              .selectFrom('album_asset')
              .select(['album_asset.albumId as albumId', 'album_asset.assetId as assetId'])
              .where('album_asset.albumId', 'in', ids);
            return (
              forUserId
                ? ownerRows.union(
                    eb
                      .selectFrom('album_space_asset')
                      .innerJoin('shared_space_album', (join) =>
                        join
                          .onRef('shared_space_album.albumId', '=', 'album_space_asset.albumId')
                          .onRef('shared_space_album.spaceId', '=', 'album_space_asset.spaceId'),
                      )
                      .innerJoin('album', (join) =>
                        join.onRef('album.id', '=', 'album_space_asset.albumId').on('album.deletedAt', 'is', null),
                      )
                      .innerJoin('shared_space_member', (join) =>
                        join
                          .onRef('shared_space_member.spaceId', '=', 'shared_space_album.spaceId')
                          .on('shared_space_member.userId', '=', asUuid(forUserId)),
                      )
                      .select(['album_space_asset.albumId as albumId', 'album_space_asset.assetId as assetId'])
                      .where('album_space_asset.albumId', 'in', ids)
                      .$if(!!spaceId, (qb) => qb.where('shared_space_album.spaceId', '=', asUuid(spaceId!))),
                  )
                : ownerRows
            ).as('album_members');
          },
          (join) => join.onRef('album_members.assetId', '=', 'asset.id'),
        )
        .select('album_members.albumId as albumId')
        .select((eb) => eb.fn.min(sql<Date>`("asset"."localDateTime" AT TIME ZONE 'UTC'::text)::date`).as('startDate'))
        .select((eb) => eb.fn.max(sql<Date>`("asset"."localDateTime" AT TIME ZONE 'UTC'::text)::date`).as('endDate'))
        // lastModifiedAssetTimestamp is only used in mobile app, please remove if not need
        .select((eb) => eb.fn.max('asset.updatedAt').as('lastModifiedAssetTimestamp'))
        .select((eb) => sql<number>`${eb.fn.count('asset.id')}::int`.as('assetCount'))
        .where('asset.deletedAt', 'is', null)
        .groupBy('album_members.albumId')
        .execute()
    );
  }

  private buildAlbumBaseQuery(ownerId: string, { isOwned, isShared }: { isOwned?: boolean; isShared?: boolean }) {
    return this.db
      .selectFrom('album')
      .innerJoin('album_user', (join) =>
        join.onRef('album_user.albumId', '=', 'album.id').on('album_user.userId', '=', ownerId),
      )
      .where('album.deletedAt', 'is', null)
      .$if(isOwned === true, (qb) => qb.where('album_user.role', '=', sql.lit(AlbumUserRole.Owner)))
      .$if(isOwned === false, (qb) => qb.where('album_user.role', '!=', sql.lit(AlbumUserRole.Owner)))
      .$if(isShared !== undefined, (qb) =>
        qb.where((eb) => {
          const isSharedAlbum = eb.or([
            eb.exists(
              eb
                .selectFrom('album_user as au')
                .whereRef('au.albumId', '=', 'album.id')
                .where('au.role', '!=', sql.lit(AlbumUserRole.Owner)),
            ),
            eb.exists(eb.selectFrom('shared_link').whereRef('shared_link.albumId', '=', 'album.id')),
          ]);
          return isShared ? isSharedAlbum : eb.not(isSharedAlbum);
        }),
      );
  }

  @GenerateSql({ params: [DummyValue.UUID, { isOwned: true, isShared: true }] })
  getAll(
    ownerId: string,
    options: { id?: string; isOwned?: boolean; isShared?: boolean; name?: string } = {},
  ): Promise<MapAlbumDto[]> {
    return this.buildAlbumBaseQuery(ownerId, options)
      .selectAll('album')
      .select(withAlbumUsers(ownerId))
      .select(withSharedLink)
      .$if(!!options.id, (qb) => qb.where('album.id', '=', options.id!))
      .$if(!!options.name, (qb) => qb.where('album.albumName', '=', options.name!))
      .orderBy('album.createdAt', 'desc')
      .execute();
  }

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

  @GenerateSql({ params: [DummyValue.UUID, { isOwned: true, isShared: true }] })
  async getAllIds(ownerId: string, options: { isOwned?: boolean; isShared?: boolean } = {}): Promise<string[]> {
    const rows = await this.buildAlbumBaseQuery(ownerId, options)
      .select('album.id')
      .orderBy('album.createdAt', 'desc')
      .execute();
    return rows.map((r) => r.id);
  }

  async restoreAll(userId: string): Promise<void> {
    await this.db.updateTable('album').set({ deletedAt: null }).where(isAlbumOwned(userId)).execute();
  }

  async softDeleteAll(userId: string): Promise<void> {
    await this.db.updateTable('album').set({ deletedAt: new Date() }).where(isAlbumOwned(userId)).execute();
  }

  async deleteAll(userId: string): Promise<void> {
    await this.db.deleteFrom('album').where(isAlbumOwned(userId)).execute();
  }

  @GenerateSql({ params: [[DummyValue.UUID]] })
  @Chunked()
  async removeAssetsFromAll(assetIds: string[]): Promise<void> {
    await this.db.deleteFrom('album_asset').where('album_asset.assetId', 'in', assetIds).execute();
    // #764: also drop cross-owner contributions — "remove from all albums" must clear both membership
    // tables, else a Locked contribution never leaves a member's device (the album_asset-only delete
    // above never fires the album_space_asset delete trigger). Un-lock won't restore (row deleted),
    // matching owned-asset Locked semantics.
    await this.db.deleteFrom('album_space_asset').where('album_space_asset.assetId', 'in', assetIds).execute();
  }

  @Chunked({ paramIndex: 1 })
  async removeAssetIds(albumId: string, assetIds: string[]): Promise<void> {
    if (assetIds.length === 0) {
      return;
    }

    await this.db
      .deleteFrom('album_asset')
      .where('album_asset.albumId', '=', albumId)
      .where('album_asset.assetId', 'in', assetIds)
      .execute();
  }

  /**
   * Get asset IDs for the given album ID.
   *
   * @param albumId Album ID to get asset IDs for.
   * @param assetIds Optional list of asset IDs to filter on.
   * @returns Set of Asset IDs for the given album ID.
   */
  @GenerateSql({ params: [DummyValue.UUID, [DummyValue.UUID]] })
  @ChunkedSet({ paramIndex: 1 })
  async getAssetIds(albumId: string, assetIds: string[]): Promise<Set<string>> {
    if (assetIds.length === 0) {
      return new Set();
    }

    return this.db
      .selectFrom('album_asset')
      .selectAll()
      .where('album_asset.albumId', '=', albumId)
      .where('album_asset.assetId', 'in', assetIds)
      .execute()
      .then((results) => new Set(results.map(({ assetId }) => assetId)));
  }

  @GenerateSql({ params: [DummyValue.UUID, [DummyValue.UUID]] })
  async addAssetIds(albumId: string, assetIds: string[]): Promise<void> {
    if (assetIds.length === 0) {
      return;
    }

    // #752 P1-6 coexistence invariant: an (albumId, assetId) pair lives in EXACTLY ONE of
    // album_asset / album_space_asset. An owner-add of a previously-contributed asset converts the
    // contribution atomically: the delete fires the audit trigger (device tombstone) while the
    // fresh album_asset row upserts — mobile converges to the owner edge in one sync window.
    await this.db.transaction().execute(async (trx) => {
      await trx
        .insertInto('album_asset')
        .expression((eb) =>
          eb.selectFrom(dummy).select([asUuid(albumId).as('albumId'), sql`unnest(${assetIds}::uuid[])`.as('assetId')]),
        )
        .onConflict((oc) => oc.doNothing())
        .execute();
      await trx
        .deleteFrom('album_space_asset')
        .where('album_space_asset.albumId', '=', albumId)
        .where('album_space_asset.assetId', 'in', assetIds)
        .execute();
    });
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

  @GenerateSql({
    params: [
      { albumName: DummyValue.STRING },
      [],
      [{ userId: DummyValue.UUID, role: AlbumUserRole.Owner }, DummyValue.UUID],
    ],
  })
  async create(
    album: Insertable<AlbumTable>,
    assetIds: string[],
    albumUsers: AlbumUserCreateDto[],
    authUserId: string,
  ) {
    if (albumUsers.every((u) => u.role !== AlbumUserRole.Owner)) {
      throw new Error('Album must have an owner');
    }

    const userIds = albumUsers.map((u) => u.userId);
    const roles = albumUsers.map((u) => u.role);

    const result = await this.db
      .with('album', (db) => db.insertInto('album').values(album).returningAll())
      .with('album_user', (db) =>
        db
          .insertInto('album_user')
          .expression((eb) =>
            eb
              .selectFrom('album')
              .select(({ ref }) => [
                ref('album.id').as('albumId'),
                sql`unnest(${userIds}::uuid[])`.as('userId'),
                sql`unnest(${roles}::album_user_role_enum[])`.as('role'),
              ]),
          )
          .returning(['album_user.albumId', 'album_user.userId', 'album_user.role']),
      )
      .with('album_asset', (db) =>
        db
          .insertInto('album_asset')
          .expression((eb) =>
            eb
              .selectFrom('album')
              .select(({ ref }) => [ref('album.id').as('albumId'), sql`unnest(${assetIds}::uuid[])`.as('assetId')]),
          )
          .onConflict((oc) => oc.doNothing())
          .returning(['album_asset.albumId', 'album_asset.assetId']),
      )
      .selectFrom('album')
      .selectAll('album')
      .select(withAlbumUsers(authUserId))
      .select(withAssets)
      .$narrowType<{ assets: NotNull }>()
      .executeTakeFirstOrThrow();

    return result;
  }

  update(id: string, album: Updateable<AlbumTable>, authUserId: string) {
    return this.db
      .updateTable('album')
      .set(album)
      .where('album.id', '=', id)
      .returningAll('album')
      .returning(withSharedLink)
      .returning(withAlbumUsers(authUserId))
      .executeTakeFirstOrThrow();
  }

  async delete(id: string): Promise<void> {
    await this.db.deleteFrom('album').where('id', '=', id).execute();
  }

  @Chunked({ chunkSize: 30_000 })
  async addAssetIdsToAlbums(values: { albumId: string; assetId: string }[]): Promise<void> {
    if (values.length === 0) {
      return;
    }
    // #752 P1-6: same conversion as addAssetIds, per album in the batch (see comment there).
    const byAlbum = new Map<string, string[]>();
    for (const { albumId, assetId } of values) {
      const ids = byAlbum.get(albumId);
      if (ids) {
        ids.push(assetId);
      } else {
        byAlbum.set(albumId, [assetId]);
      }
    }
    await this.db.transaction().execute(async (trx) => {
      await trx
        .insertInto('album_asset')
        .values(values)
        // Allow idempotent album sync without failing on existing album memberships.
        .onConflict((oc) => oc.columns(['albumId', 'assetId']).doNothing())
        .execute();
      for (const [albumId, assetIds] of byAlbum) {
        await trx
          .deleteFrom('album_space_asset')
          .where('album_space_asset.albumId', '=', albumId)
          .where('album_space_asset.assetId', 'in', assetIds)
          .execute();
      }
    });
  }

  /**
   * Makes sure all thumbnails for albums are updated by:
   * - Removing thumbnails from albums without assets
   * - Removing references of thumbnails to assets outside the album
   * - Setting a thumbnail when none is set and the album contains assets
   *
   * @returns Amount of updated album thumbnails or undefined when unknown
   */
  async updateThumbnails(): Promise<number | undefined> {
    // Subquery for getting a new thumbnail.

    const result = await this.db
      .updateTable('album')
      .set((eb) => ({
        albumThumbnailAssetId: this.updateThumbnailBuilder(eb)
          .select('album_asset.assetId')
          .orderBy('asset.fileCreatedAt', 'desc')
          .limit(sql.lit(1)),
      }))
      .where((eb) =>
        eb.or([
          eb.and([
            eb('albumThumbnailAssetId', 'is', null),
            eb.exists(this.updateThumbnailBuilder(eb).select(sql`1`.as('1'))), // Has assets
          ]),
          eb.and([
            eb('albumThumbnailAssetId', 'is not', null),
            eb.not(
              eb.exists(
                this.updateThumbnailBuilder(eb)
                  .select(sql`1`.as('1'))
                  .whereRef('album.albumThumbnailAssetId', '=', 'album_asset.assetId'), // Has invalid assets
              ),
            ),
          ]),
        ]),
      )
      .execute();

    return Number(result[0].numUpdatedRows);
  }

  private updateThumbnailBuilder(eb: ExpressionBuilder<DB, 'album'>) {
    return eb
      .selectFrom('album_asset')
      .innerJoin('asset', (join) =>
        join.onRef('album_asset.assetId', '=', 'asset.id').on('asset.deletedAt', 'is', null),
      )
      .whereRef('album_asset.albumId', '=', 'album.id');
  }

  /**
   * Get per-user asset contribution counts for a single album.
   * Excludes deleted assets, orders by count desc.
   * L1: also excludes Hidden/Locked assets (withDefaultVisibility) — the per-user totals are
   * PII-adjacent (album.service.get gates the whole field to direct readers), and without this
   * gate a contributor's Hidden/Locked asset count could still be inferred from the total.
   */
  @GenerateSql({ params: [DummyValue.UUID] })
  getContributorCounts(id: string) {
    return withDefaultVisibility(
      this.db
        .selectFrom('album_asset')
        .innerJoin('asset', 'asset.id', 'assetId')
        .where('asset.deletedAt', 'is', sql.lit(null))
        .where('album_asset.albumId', '=', id),
    )
      .select('asset.ownerId as userId')
      .select((eb) => eb.fn.countAll<number>().as('assetCount'))
      .groupBy('asset.ownerId')
      .orderBy('assetCount', 'desc')
      .execute();
  }

  @GenerateSql({ params: [{ sourceAssetId: DummyValue.UUID, targetAssetId: DummyValue.UUID }] })
  async copyAlbums({ sourceAssetId, targetAssetId }: { sourceAssetId: string; targetAssetId: string }) {
    return this.db
      .insertInto('album_asset')
      .expression((eb) =>
        eb
          .selectFrom('album_asset')
          .select((eb) => ['album_asset.albumId', eb.val(targetAssetId).as('assetId')])
          .where('album_asset.assetId', '=', sourceAssetId),
      )
      .onConflict((oc) => oc.doNothing())
      .execute();
  }
}
