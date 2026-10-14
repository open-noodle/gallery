import { Injectable } from '@nestjs/common';
import {
  type ExpressionBuilder,
  type Kysely,
  type OrderByDirection,
  type Selectable,
  type ShallowDehydrateObject,
  type SqlBool,
  expressionBuilder,
  sql,
} from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import z from 'zod';
import { columns } from 'src/database.js';
import { DummyValue, GenerateSql } from 'src/decorators.js';
import { MapAsset } from 'src/dtos/asset-response.dto.js';
import { SearchFilter, SearchOrder } from 'src/dtos/search.dto.js';
import { AssetStatus, AssetType, AssetVisibility, VectorIndex } from 'src/enum.js';
import { probes } from 'src/repositories/database.repository.js';
import { DB } from 'src/schema/index.js';
import { AssetExifTable } from 'src/schema/tables/asset-exif.table.js';
import { searchAssetBuilderWithLocalTaken } from 'src/utils/asset-filter.js';
import {
  anyUuid,
  asUuid,
  searchAssetBuilder,
  searchMetadataV3Examples,
  searchRandomV3Examples,
  searchSmartV3Examples,
  searchStatisticsV3Examples,
  withExifInner,
  withSearchOrder,
} from 'src/utils/database.js';
import { favoriteExistsFor } from 'src/utils/favorite.js';
import { without } from 'src/utils/filter-suggestions.js';
import { type PaginationOptions, paginationHelper } from 'src/utils/pagination.js';
import { spaceAssetPathBranches } from 'src/utils/shared-space-album-scope.js';

export interface SearchAssetIdOptions {
  checksum?: Buffer;
  id?: string;
}

export interface SearchUserIdOptions {
  libraryId?: string | null;
  userIds?: string[];
  /**
   * Contributor filter: a plain AND on asset.ownerId. Deliberately separate from `userIds`, which
   * is the owner SCOPING predicate (database.ts:677/687/770). Merging a contributor filter into
   * userIds would widen the result set instead of narrowing it.
   */
  ownerId?: string;
  /**
   * #763: the caller making the request — NOT `userIds` (the timeline/search *target*, which
   * differs from the caller on space/album scoped paths — e.g. `getFilteredMapMarkers`'s
   * `userIds: dto.spaceId ? undefined : [auth.user.id]` leaves `userIds` unset entirely when
   * browsing a specific space). Required by `searchAssetBuilder` and the smart-facet pipeline
   * whenever `isFavorite` is set, so they resolve the `asset_favorite` overlay for the right user.
   */
  authUserId?: string;
}

export type SearchIdOptions = SearchAssetIdOptions & SearchUserIdOptions;

export interface SearchStatusOptions {
  isEncoded?: boolean;
  isFavorite?: boolean;
  isMotion?: boolean;
  isOffline?: boolean;
  isNotInAlbum?: boolean;
  isInAlbum?: boolean;
  type?: AssetType;
  status?: AssetStatus;
  withArchived?: boolean;
  withDeleted?: boolean;
  visibility?: AssetVisibility;
}

export interface SearchOneToOneRelationOptions {
  withExif?: boolean;
  withStacked?: boolean;
}

export interface SearchRelationOptions extends SearchOneToOneRelationOptions {
  withFaces?: boolean;
  withPeople?: boolean;
  /** whose version of the people to select, required when selecting faces or people */
  viewingUserId?: string;
}

export interface SearchDateOptions {
  createdBefore?: Date;
  createdAfter?: Date;
  takenBefore?: Date;
  takenAfter?: Date;
  trashedBefore?: Date;
  trashedAfter?: Date;
  updatedBefore?: Date;
  updatedAfter?: Date;
}

export interface SearchPathOptions {
  encodedVideoPath?: string;
  originalFileName?: string;
  originalPath?: string;
  previewPath?: string;
  thumbnailPath?: string;
}

export interface SearchExifOptions {
  city?: string | null;
  country?: string | null;
  lensModel?: string | null;
  make?: string | null;
  model?: string | null;
  state?: string | null;
  description?: string | null;
  rating?: number | null;
  ratingIsMinimum?: boolean;
}

export interface SearchEmbeddingOptions {
  embedding: string;
  /**
   * Owner scoping. Optional — and left unset on purpose under an `albumIds` scope, where the
   * caller's AlbumRead check is the access boundary and `albumSharedSpaceScope` re-gates the rows
   * (the same shape `searchMetadata` has always used). Matches `SearchUserIdOptions.userIds`.
   */
  userIds?: string[];
  /**
   * The searching user. Deliberately SEPARATE from `userIds`, which is an owner-scoping predicate
   * and is absent under an album scope: the facets' people list still has to resolve identity
   * people for the viewer, so it needs the caller even when nothing is owner-scoped.
   */
  callerId?: string;
  maxDistance?: number;
}

export interface SearchOcrOptions {
  ocr?: string;
}

export interface SearchPeopleOptions {
  personIds?: string[];
  personMatchAny?: boolean;
  identityIds?: string[];
  forceEmptyResult?: boolean;
}

export interface SearchTagOptions {
  tagIds?: string[] | null;
  tagMatchAny?: boolean;
}

export interface SearchAlbumOptions {
  albumIds?: string[];
  /**
   * Opts an `albumIds` query OUT of `albumSharedSpaceScope` (database.ts:608), for a caller whose
   * album ACCESS check (e.g. Permission.AlbumRead) is already the access boundary — matching the
   * album grid and the pre-fork `GET /albums/{id}/map-markers` endpoint (issue #656). Defaults to
   * false/absent, which preserves the existing shared-space re-gate for album-scoped
   * SearchService queries (database.ts:600-607) — do not flip this default.
   */
  albumAccessIsBoundary?: boolean;
}

export interface SearchSpaceOptions {
  spaceId?: string;
  spacePersonIds?: string[];
  timelineSpaceIds?: string[];
  /**
   * #763: the space scope the FAVOURITES probe alone runs under — every space the caller belongs
   * to, not just the ones they show in their timeline. A favourite is an explicit per-asset act and
   * stays reachable when its space is hidden (see SharedSpaceRepository.getAllMemberSpaceIds), so
   * the "is the Favourites section worth offering" answer has to span the same set the favourites
   * filter itself will. Deliberately separate from `timelineSpaceIds`, which still scopes every
   * OTHER facet — widening those would leak a hidden space's cities/tags/people back into the panel.
   */
  favoriteSpaceIds?: string[];
}

export interface SearchOrderOptions {
  orderDirection?: 'asc' | 'desc';
}

export interface SearchPaginationOptions {
  page: number;
  size: number;
}

type BaseAssetSearchOptions = SearchDateOptions &
  SearchIdOptions &
  SearchExifOptions &
  SearchOrderOptions &
  SearchPathOptions &
  SearchStatusOptions &
  SearchUserIdOptions &
  SearchPeopleOptions &
  SearchTagOptions &
  SearchAlbumOptions &
  SearchOcrOptions &
  SearchSpaceOptions;

/**
 * Visibility modes `searchAssetBuilder` (src/utils/database.ts) understands:
 * - a concrete `AssetVisibility` — exactly that state
 * - `'not-locked'` — everything except Locked; note this STILL admits Hidden
 * - `'timeline-or-archive'` — Archive | Timeline, what the timeline and the album grid show
 *   (`withDefaultVisibility`). Used only by the album-boundary map query (shared-space.service.ts),
 *   which must match the grid it is reached from.
 * - `undefined` — no visibility clause at all (admits Hidden and Locked)
 */
export type AssetSearchVisibility = AssetVisibility | 'not-locked' | 'timeline-or-archive';

export type AssetSearchOptions = Omit<BaseAssetSearchOptions, 'visibility'> &
  SearchRelationOptions & { visibility?: AssetSearchVisibility };

export type AssetSearchBuilderOptions = Omit<AssetSearchOptions, 'orderDirection'>;

export interface AssetSearchScope {
  userIds: string[];
  lockedOwnerId: string;
  /** whose version of the people to select, required when selecting faces or people */
  viewingUserId?: string;
}

export interface AssetSearchBuilderV3Options {
  filter?: SearchFilter;
  /**
   * #763: the CALLER's id, used to resolve `filter.isFavorite` against the per-user
   * `asset_favorite` overlay (the raw `asset.isFavorite` column is gone). Mirrors
   * `AssetSearchBuilderOptions.authUserId` on the legacy path. Never client-controlled.
   */
  authUserId?: string;
  withExif?: boolean;
  withFaces?: boolean;
  withPeople?: boolean;
  withStacked?: boolean;
  order?: SearchOrder;
}

export type SmartSearchOptions = SearchDateOptions &
  SearchEmbeddingOptions &
  SearchExifOptions &
  SearchOneToOneRelationOptions &
  Omit<SearchStatusOptions, 'visibility'> &
  SearchUserIdOptions &
  SearchPeopleOptions &
  SearchTagOptions &
  SearchAlbumOptions &
  SearchOcrOptions &
  SearchSpaceOptions &
  SearchOrderOptions & { visibility?: AssetVisibility | 'not-locked'; viewingUserId?: string };

export type LargeAssetSearchOptions = AssetSearchOptions & { minFileSize?: number };

export interface FaceEmbeddingSearch extends Omit<SearchEmbeddingOptions, 'userIds'> {
  clusterGroupId: string;
  hasPerson?: boolean;
  numResults: number;
  maxDistance: number;
  minBirthDate?: Date | null;
}

export interface FaceSearchResult {
  distance: number;
  id: string;
  personGroupId: string | null;
}

// Pet equivalent of FaceEmbeddingSearch, scoped to pet_search instead of face_search. Deliberately
// drops `minBirthDate` — a person's birthdate has no pet analogue, so the filter is meaningless here.
export interface PetEmbeddingSearch extends SearchEmbeddingOptions {
  hasPerson?: boolean;
  numResults: number;
  maxDistance: number;
  /**
   * Required here, unlike the optional base: pet recognition has no album- or space-scoped caller,
   * so every `searchPets` scan is owner-scoped and the `asset.ownerId` predicate below is
   * unconditional. (`FaceSearchRepository.searchFaces` can drop it because a space scope replaces it.)
   */
  userIds: string[];
}

export interface PetSearchResult {
  distance: number;
  id: string;
  personId: string | null;
}

export interface AssetDuplicateResult {
  assetId: string;
  duplicateId: string | null;
  distance: number;
}

export interface GetStatesOptions {
  country?: string;
}

export interface GetCitiesOptions extends GetStatesOptions {
  state?: string;
}

export interface GetCameraModelsOptions {
  make?: string;
  lensModel?: string;
}

export interface GetCameraMakesOptions {
  model?: string;
  lensModel?: string;
}

export interface GetCameraLensModelsOptions {
  make?: string;
  model?: string;
}

/** Skip threshold when disabled (0), undefined, or at max cosine distance (>= 2) since it would filter nothing */
export function isActiveDistanceThreshold(maxDistance: number | undefined): boolean {
  return (maxDistance ?? 0) > 0 && (maxDistance ?? 0) < 2;
}

@Injectable()
export class SearchRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  // TODO(v4): remove with the deprecated flat-field search API
  @GenerateSql({ params: [DummyValue.UUID] })
  getEmbedding(assetId: string) {
    return this.db
      .selectFrom('smart_search')
      .select('embedding')
      .where('assetId', '=', assetId)
      .executeTakeFirst()
      .then((row) => row?.embedding ?? null);
  }

  @GenerateSql(
    {
      params: [
        { page: 1, size: 100 },
        {
          takenAfter: DummyValue.DATE,
          lensModel: DummyValue.STRING,
          withStacked: true,
          isFavorite: true,
          userIds: [DummyValue.UUID],
          authUserId: DummyValue.UUID,
        },
      ],
    },
    {
      name: 'identity-filter',
      params: [
        { page: 1, size: 100 },
        {
          userIds: [DummyValue.UUID],
          timelineSpaceIds: [DummyValue.UUID],
          identityIds: [DummyValue.UUID],
          withStacked: true,
        },
      ],
    },
  )
  async searchMetadata(pagination: SearchPaginationOptions, options: AssetSearchOptions) {
    const orderDirection = (options.orderDirection?.toLowerCase() || 'desc') as OrderByDirection;
    const items = await searchAssetBuilderWithLocalTaken(this.db, options)
      .select(columns.searchAsset)
      // #763: project the per-user overlay onto the rows feeding mapAsset. Not folded into
      // searchAssetBuilderLegacy itself — searchStatistics also builds on it with an aggregate
      // countAll() and no GROUP BY, so an unconditional row-level SELECT there would break it.
      .$if(!!options.authUserId, (qb) =>
        qb.select((eb) => favoriteExistsFor(eb, options.authUserId!).as('isFavoriteForUser')),
      )
      // Fork: sorted by local taken time (wall clock), the timeline's order and the column the taken
      // range filters on (src/utils/asset-filter.ts). Deliberate: a date-filtered page then walks
      // asset_localDateTime_range_idx; sorting by fileCreatedAt instead scans every newer asset.
      .orderBy('asset.localDateTime', orderDirection)
      .orderBy('asset.id', orderDirection)
      .limit(pagination.size + 1)
      .offset((pagination.page - 1) * pagination.size)
      .execute();

    return paginationHelper(items, pagination.size);
  }

  // TODO(v4): remove with the deprecated flat-field search API
  @GenerateSql({
    params: [
      {
        takenAfter: DummyValue.DATE,
        lensModel: DummyValue.STRING,
        isFavorite: true,
        userIds: [DummyValue.UUID],
        authUserId: DummyValue.UUID,
      },
    ],
  })
  searchStatistics(options: AssetSearchOptions) {
    return searchAssetBuilderWithLocalTaken(this.db, options)
      .select((qb) => qb.fn.countAll<number>().as('total'))
      .executeTakeFirstOrThrow();
  }

  // TODO(v4): remove with the deprecated flat-field search API
  @GenerateSql({
    params: [
      100,
      {
        takenAfter: DummyValue.DATE,
        lensModel: DummyValue.STRING,
        withStacked: true,
        isFavorite: true,
        userIds: [DummyValue.UUID],
        authUserId: DummyValue.UUID,
      },
    ],
  })
  async searchRandom(size: number, options: AssetSearchOptions) {
    return (
      searchAssetBuilderWithLocalTaken(this.db, options)
        .select(columns.searchAsset)
        // #763: see searchMetadata above for why this lives per-caller rather than in searchAssetBuilderLegacy.
        .$if(!!options.authUserId, (qb) =>
          qb.select((eb) => favoriteExistsFor(eb, options.authUserId!).as('isFavoriteForUser')),
        )
        .orderBy(sql`random()`)
        .limit(size)
        .execute()
    );
  }

  // TODO(v4): remove with the deprecated flat-field search API
  @GenerateSql({
    params: [
      100,
      {
        takenAfter: DummyValue.DATE,
        lensModel: DummyValue.STRING,
        withStacked: true,
        isFavorite: true,
        userIds: [DummyValue.UUID],
        authUserId: DummyValue.UUID,
      },
    ],
  })
  searchLargeAssets(size: number, options: LargeAssetSearchOptions) {
    const orderDirection = (options.orderDirection?.toLowerCase() || 'desc') as OrderByDirection;
    return (
      searchAssetBuilderWithLocalTaken(this.db, options)
        .select(columns.searchAsset)
        // #763: see searchMetadata above for why this lives per-caller rather than in searchAssetBuilderLegacy.
        .$if(!!options.authUserId, (qb) =>
          qb.select((eb) => favoriteExistsFor(eb, options.authUserId!).as('isFavoriteForUser')),
        )
        .$call(withExifInner)
        .$if(options.visibility !== AssetVisibility.Hidden, (qb) =>
          qb.where('asset.visibility', '!=', sql.lit(AssetVisibility.Hidden)),
        )
        .where('asset_exif.fileSizeInByte', '>', options.minFileSize || 0)
        .orderBy('asset_exif.fileSizeInByte', orderDirection)
        .limit(size)
        .execute()
    );
  }

  // TODO(v4): remove with the deprecated flat-field search API
  private buildSearchSmartQueries(
    kysely: Kysely<DB>,
    pagination: SearchPaginationOptions,
    options: SmartSearchOptions,
  ) {
    const hasDistanceThreshold = isActiveDistanceThreshold(options.maxDistance);
    const personIds = options.personIds?.filter(Boolean) ?? [];
    const identityIds = options.identityIds?.filter(Boolean) ?? [];

    let baseQuery = searchAssetBuilderWithLocalTaken(kysely, {
      ...without(options, 'personIds', 'personMatchAny', 'identityIds', 'forceEmptyResult'),
      ratingIsMinimum: true,
    })
      .selectAll('asset')
      // #763: project the per-user overlay onto the rows feeding mapAsset via searchSmart's
      // mapResponse. Flows through both the 'cte' (candidates.selectAll()) and 'simple' outer
      // query paths below since both select every column baseQuery projects.
      .$if(!!options.authUserId, (qb) =>
        qb.select((eb) => favoriteExistsFor(eb, options.authUserId!).as('isFavoriteForUser')),
      )
      .innerJoin('smart_search', 'asset.id', 'smart_search.assetId')
      .$if(!!options.forceEmptyResult, (qb) => qb.where(sql<SqlBool>`false`))
      .$if(hasDistanceThreshold, (qb) =>
        qb.where(sql<SqlBool>`(smart_search.embedding <=> ${options.embedding}) <= ${options.maxDistance!}`),
      )
      // DO NOT add a secondary ORDER BY key on any column here.
      // vchord's ordered index scan can only satisfy a single-key ORDER BY on
      // `smart_search.embedding <=>`. Any additional sort key forces the planner
      // to Parallel Seq Scan + in-memory sort (~15s on 200k rows vs ~200ms via
      // vchord). Cross-page duplicates from identical embeddings are caught by
      // the frontend dedup in web/src/lib/utils/search-dedup.ts.
      .orderBy(sql`smart_search.embedding <=> ${options.embedding}`);

    if (personIds.length > 0) {
      // Keep the smart_search ordered scan as the driving path. Materializing the
      // full matching asset_face set first pushes the planner back to tens of
      // thousands of smart_search PK lookups on person-filtered queries.
      baseQuery = baseQuery.where((eb) => {
        const hasVisiblePersonFace = (personId: string | string[]) =>
          eb.exists(
            eb
              .selectFrom('asset_face')
              .whereRef('asset_face.assetId', '=', 'asset.id')
              .where('asset_face.deletedAt', 'is', null)
              .where('asset_face.isVisible', 'is', true)
              .where('asset_face.personGroupId', '=', Array.isArray(personId) ? anyUuid(personId) : asUuid(personId)),
          );

        return options.personMatchAny
          ? hasVisiblePersonFace(personIds)
          : eb.and(personIds.map((personId) => hasVisiblePersonFace(personId)));
      });
    }

    if (identityIds.length > 0) {
      baseQuery = baseQuery.where((eb) =>
        eb.and(
          identityIds.map((identityId) =>
            eb.exists(
              eb
                .selectFrom('asset_face')
                .innerJoin('face_identity_face', 'face_identity_face.assetFaceId', 'asset_face.id')
                .whereRef('asset_face.assetId', '=', 'asset.id')
                .where('asset_face.deletedAt', 'is', null)
                .where('asset_face.isVisible', 'is', true)
                .where('face_identity_face.identityId', '=', asUuid(identityId)),
            ),
          ),
        ),
      );
    }

    if (options.orderDirection) {
      const orderDirection = options.orderDirection.toLowerCase() as OrderByDirection;
      const candidates = baseQuery.limit(500).as('candidates');
      const outerQuery = kysely
        .selectFrom(candidates)
        .selectAll()
        // sql.raw is safe here — orderDirection is validated to 'asc'|'desc' by the AssetOrder enum
        .orderBy(sql`"candidates"."fileCreatedAt" ${sql.raw(orderDirection)} nulls last`)
        // Stable tiebreaker (same rationale as the base query)
        .orderBy('candidates.id')
        .limit(pagination.size + 1)
        .offset((pagination.page - 1) * pagination.size);
      return { kind: 'cte' as const, base: baseQuery, outer: outerQuery };
    }

    const outerQuery = baseQuery.limit(pagination.size + 1).offset((pagination.page - 1) * pagination.size);

    return { kind: 'simple' as const, base: baseQuery, outer: outerQuery };
  }

  @GenerateSql({
    params: [
      { page: 1, size: 200 },
      {
        takenAfter: DummyValue.DATE,
        embedding: DummyValue.VECTOR,
        lensModel: DummyValue.STRING,
        withStacked: true,
        isFavorite: true,
        userIds: [DummyValue.UUID],
        authUserId: DummyValue.UUID,
        spacePersonIds: [DummyValue.UUID],
        timelineSpaceIds: [DummyValue.UUID, DummyValue.UUID],
        orderDirection: 'desc',
        maxDistance: 0.75,
      },
    ],
  })
  searchSmart(pagination: SearchPaginationOptions, options: SmartSearchOptions) {
    if (!z.int().min(1).max(1000).safeParse(pagination.size).success) {
      throw new Error(`Invalid value for 'size': ${pagination.size}`);
    }

    return this.db.transaction().execute(async (trx) => {
      await sql`set local vchordrq.probes = ${sql.lit(probes[VectorIndex.Clip])}`.execute(trx);

      const { kind, outer } = this.buildSearchSmartQueries(trx, pagination, options);
      if (kind === 'cte') {
        const items = (await outer.execute()) as MapAsset[];
        return paginationHelper(items, pagination.size);
      }
      const items = await outer.execute();
      return paginationHelper(items, pagination.size);
    });
  }

  @GenerateSql({
    params: [
      {
        userIds: [DummyValue.UUID],
        embedding: DummyValue.VECTOR,
        numResults: 10,
        maxDistance: 0.6,
      },
    ],
  })
  searchFaces({ clusterGroupId, embedding, numResults, maxDistance, hasPerson, minBirthDate }: FaceEmbeddingSearch) {
    if (!z.int().min(1).max(1000).safeParse(numResults).success) {
      throw new Error(`Invalid value for 'numResults': ${numResults}`);
    }

    return this.db.transaction().execute(async (trx) => {
      await sql`set local vchordrq.probes = ${sql.lit(probes[VectorIndex.Face])}`.execute(trx);
      return await trx
        .with('cte', (qb) =>
          qb
            .selectFrom('asset_face')
            .innerJoin('asset', 'asset.id', 'asset_face.assetId')
            .innerJoin('face_search', 'face_search.faceId', 'asset_face.id')
            .select([
              'asset_face.id',
              'asset_face.personGroupId',
              sql<number>`face_search.embedding <=> ${embedding}`.as('distance'),
            ])
            .where('asset.ownerId', 'in', (eb) =>
              eb.selectFrom('user').select('user.id').where('user.clusterGroupId', '=', clusterGroupId),
            )
            .where('asset.deletedAt', 'is', null)
            .$if(!!hasPerson, (qb) => qb.where('asset_face.personGroupId', 'is not', null))
            .$if(!!minBirthDate, (qb) =>
              qb.where((eb) =>
                eb.not(
                  eb.exists(
                    eb
                      .selectFrom('person')
                      .select('person.personGroupId')
                      .whereRef('person.personGroupId', '=', 'asset_face.personGroupId')
                      .where('person.birthDate', '>', minBirthDate!),
                  ),
                ),
              ),
            )
            .orderBy('distance')
            .limit(numResults),
        )
        .selectFrom('cte')
        .selectAll()
        .where('cte.distance', '<=', maxDistance)
        .execute();
    });
  }

  // Copy of FaceSearchRepository.searchFaces scoped to pet_search instead of face_search — see the isolation
  // decision in PetEmbeddingSearch's comment. No `person` join / `minBirthDate` filter: pets have
  // no birthdate concept, and hasPerson only needs asset_face.personId, already on the base table.
  @GenerateSql({
    params: [
      {
        userIds: [DummyValue.UUID],
        embedding: DummyValue.VECTOR,
        numResults: 10,
        maxDistance: 0.6,
      },
    ],
  })
  searchPets({ userIds, embedding, numResults, maxDistance, hasPerson }: PetEmbeddingSearch) {
    if (!z.int().min(1).max(1000).safeParse(numResults).success) {
      throw new Error(`Invalid value for 'numResults': ${numResults}`);
    }

    return this.db.transaction().execute(async (trx) => {
      await sql`set local vchordrq.probes = ${sql.lit(probes[VectorIndex.Pet])}`.execute(trx);
      return await trx
        .with('cte', (qb) =>
          qb
            .selectFrom('asset_face')
            .select([
              'asset_face.id',
              'asset_face.personGroupId',
              sql<number>`pet_search.embedding <=> ${embedding}`.as('distance'),
            ])
            .innerJoin('asset', 'asset.id', 'asset_face.assetId')
            .innerJoin('pet_search', 'pet_search.faceId', 'asset_face.id')
            .where('asset.ownerId', '=', anyUuid(userIds))
            .where('asset.deletedAt', 'is', null)
            .$if(!!hasPerson, (qb) => qb.where('asset_face.personGroupId', 'is not', null))
            .orderBy('distance')
            .limit(numResults),
        )
        .selectFrom('cte')
        .selectAll()
        .where('cte.distance', '<=', maxDistance)
        .execute();
    });
  }

  @GenerateSql({ params: [DummyValue.STRING] })
  searchPlaces(placeName: string) {
    return this.db
      .selectFrom('geodata_places')
      .selectAll()
      .where(
        () =>
          // kysely doesn't support trigram %>> or <->>> operators
          sql`
            f_unaccent(name) %>> f_unaccent(${placeName}) or
            f_unaccent("admin2Name") %>> f_unaccent(${placeName}) or
            f_unaccent("admin1Name") %>> f_unaccent(${placeName}) or
            f_unaccent("alternateNames") %>> f_unaccent(${placeName})
          `,
      )
      .orderBy(
        sql`
          coalesce(f_unaccent(name) <->>> f_unaccent(${placeName}), 0.1) +
          coalesce(f_unaccent("admin2Name") <->>> f_unaccent(${placeName}), 0.1) +
          coalesce(f_unaccent("admin1Name") <->>> f_unaccent(${placeName}), 0.1) +
          coalesce(f_unaccent("alternateNames") <->>> f_unaccent(${placeName}), 0.1)
        `,
      )
      .limit(20)
      .execute();
  }

  @GenerateSql(
    { params: [[DummyValue.UUID], [DummyValue.UUID]] },
    { name: 'with authUserId', params: [[DummyValue.UUID], [DummyValue.UUID], DummyValue.UUID] },
  )
  getAssetsByCity(userIds: string[], timelineSpaceIds?: string[], authUserId?: string) {
    // #867: the places page is the "view all" of the Explore strip, so it carries the same scope —
    // own (and partner) assets, plus anything reachable through a space the viewer kept on their
    // timeline. Built from a detached expression builder because the recursive `cte` widens the
    // schema of the builders below past the shared helpers' `ExpressionBuilder<DB, keyof DB>`; the
    // predicate only ever references `asset.*`, so the emitted SQL is unaffected.
    const viewerScope = () => {
      const eb = expressionBuilder<DB, 'asset'>();
      return eb.or([
        eb('asset.ownerId', '=', anyUuid(userIds)),
        ...(timelineSpaceIds?.length
          ? spaceAssetPathBranches(eb, {
              correlateAssetId: 'asset.id',
              correlateLibraryId: 'asset.libraryId',
              scope: { spaceIds: timelineSpaceIds },
              albumTimelineGate: 'space-tab',
            })
          : []),
      ]);
    };

    return (
      this.db
        .withRecursive('cte', (qb) => {
          const base = qb
            .selectFrom('asset_exif')
            .select(['city', 'assetId'])
            .innerJoin('asset', 'asset.id', 'asset_exif.assetId')
            .where(viewerScope())
            .where('asset.visibility', '=', AssetVisibility.Timeline)
            .where('asset.type', '=', AssetType.Image)
            .where('asset.deletedAt', 'is', null)
            .orderBy('city')
            .limit(1);

          const recursive = qb
            .selectFrom('cte')
            .select(['l.city', 'l.assetId'])
            .innerJoinLateral(
              (qb) =>
                qb
                  .selectFrom('asset_exif')
                  .select(['city', 'assetId'])
                  .innerJoin('asset', 'asset.id', 'asset_exif.assetId')
                  .where(viewerScope())
                  .where('asset.visibility', '=', AssetVisibility.Timeline)
                  .where('asset.type', '=', AssetType.Image)
                  .where('asset.deletedAt', 'is', null)
                  .whereRef('asset_exif.city', '>', 'cte.city')
                  .orderBy('city')
                  .limit(1)
                  .as('l'),
              (join) => join.onTrue(),
            );

          return sql<{ city: string; assetId: string }>`(${base} union all ${recursive})`;
        })
        .selectFrom('asset')
        .innerJoin('asset_exif', 'asset.id', 'asset_exif.assetId')
        .innerJoin('cte', 'asset.id', 'cte.assetId')
        .select(columns.searchAsset)
        .select((eb) =>
          eb
            .fn('to_jsonb', [eb.table('asset_exif')])
            .$castTo<ShallowDehydrateObject<Selectable<AssetExifTable>>>()
            .as('exifInfo'),
        )
        // #763: project the per-user overlay for the CALLER onto the rows feeding
        // search.service.ts's getAssetsByCity -> mapAsset. The `eb` here is scoped to
        // `DB & { cte: ... }` (the `withRecursive('cte', ...)` above), which Kysely's
        // ExpressionBuilder generics don't consider assignable to the plain
        // `ExpressionBuilder<DB, keyof DB>` favoriteExistsFor expects, even though the
        // 'asset_favorite' table it queries is unaffected by the extra CTE in scope. Safe cast
        // (same mechanism as asset.repository.ts's getTimeBucket).
        .$if(!!authUserId, (qb) =>
          qb.select((eb) =>
            favoriteExistsFor(eb as unknown as ExpressionBuilder<DB, keyof DB>, authUserId!).as('isFavoriteForUser'),
          ),
        )
        .orderBy('asset_exif.city')
        .execute()
    );
  }

  async upsert(assetId: string, embedding: string): Promise<void> {
    await this.db
      .insertInto('smart_search')
      .values({ assetId, embedding })
      .onConflict((oc) => oc.column('assetId').doUpdateSet((eb) => ({ embedding: eb.ref('excluded.embedding') })))
      .execute();
  }

  async getCountries(userIds: string[]): Promise<string[]> {
    const res = await this.getExifField('country', userIds).execute();
    return res.map((row) => row.country!);
  }

  @GenerateSql({ params: [[DummyValue.UUID], DummyValue.STRING] })
  async getStates(userIds: string[], { country }: GetStatesOptions): Promise<string[]> {
    const res = await this.getExifField('state', userIds)
      .$if(!!country, (qb) => qb.where('country', '=', country!))
      .execute();

    return res.map((row) => row.state!);
  }

  @GenerateSql({ params: [[DummyValue.UUID], DummyValue.STRING, DummyValue.STRING] })
  async getCities(userIds: string[], { country, state }: GetCitiesOptions): Promise<string[]> {
    const res = await this.getExifField('city', userIds)
      .$if(!!country, (qb) => qb.where('country', '=', country!))
      .$if(!!state, (qb) => qb.where('state', '=', state!))
      .execute();

    return res.map((row) => row.city!);
  }

  @GenerateSql({ params: [[DummyValue.UUID], DummyValue.STRING, DummyValue.STRING] })
  async getCameraMakes(userIds: string[], { model, lensModel }: GetCameraMakesOptions): Promise<string[]> {
    const res = await this.getExifField('make', userIds)
      .$if(!!model, (qb) => qb.where('model', '=', model!))
      .$if(!!lensModel, (qb) => qb.where('lensModel', '=', lensModel!))
      .execute();

    return res.map((row) => row.make!);
  }

  @GenerateSql({ params: [[DummyValue.UUID], DummyValue.STRING, DummyValue.STRING] })
  async getCameraModels(userIds: string[], { make, lensModel }: GetCameraModelsOptions): Promise<string[]> {
    const res = await this.getExifField('model', userIds)
      .$if(!!make, (qb) => qb.where('make', '=', make!))
      .$if(!!lensModel, (qb) => qb.where('lensModel', '=', lensModel!))
      .execute();

    return res.map((row) => row.model!);
  }

  @GenerateSql({ params: [[DummyValue.UUID], DummyValue.STRING] })
  async getCameraLensModels(userIds: string[], { make, model }: GetCameraLensModelsOptions): Promise<string[]> {
    const res = await this.getExifField('lensModel', userIds)
      .$if(!!make, (qb) => qb.where('make', '=', make!))
      .$if(!!model, (qb) => qb.where('model', '=', model!))
      .execute();

    return res.map((row) => row.lensModel!);
  }

  // TODO(v4): drop the V3 suffix once the legacy methods are removed
  // ─── UPSTREAM SEARCH V3 — DORMANT ───────────────────────────────
  // Not wired to any controller/service. The fork's live search runs on the legacy path
  // (searchAssetBuilderLegacy). Do not call these V3 methods from fork code.
  // Switch-over plan: specs/2026-07-23-search-v3-coexistence-design.md
  @GenerateSql(...searchMetadataV3Examples)
  async searchMetadataV3(pagination: PaginationOptions, options: AssetSearchBuilderV3Options, scope: AssetSearchScope) {
    const items = await withSearchOrder(searchAssetBuilder(this.db, options, scope), options.order)
      .select(columns.searchAsset)
      .limit(pagination.take + 1)
      .offset(pagination.skip ?? 0)
      .execute();
    return paginationHelper(items, pagination.take);
  }

  // TODO(v4): drop the V3 suffix once the legacy methods are removed
  @GenerateSql(...searchRandomV3Examples)
  searchRandomV3(
    size: number,
    options: Omit<AssetSearchBuilderV3Options, 'order'>,
    scope: AssetSearchScope,
  ): Promise<MapAsset[]> {
    return searchAssetBuilder(this.db, options, scope)
      .select(columns.searchAsset)
      .orderBy(sql`random()`)
      .limit(size)
      .execute();
  }

  // TODO(v4): drop the V3 suffix once the legacy methods are removed
  @GenerateSql(...searchSmartV3Examples)
  searchSmartV3(
    pagination: PaginationOptions,
    options: Omit<AssetSearchBuilderV3Options, 'order'> & { embedding: string },
    scope: AssetSearchScope,
  ) {
    return this.db.transaction().execute(async (trx) => {
      await sql`set local vchordrq.probes = ${sql.lit(probes[VectorIndex.Clip])}`.execute(trx);
      const items = await searchAssetBuilder(trx, options, scope)
        .select(columns.searchAsset)
        .innerJoin('smart_search', 'asset.id', 'smart_search.assetId')
        .orderBy(sql`smart_search.embedding <=> ${options.embedding}`)
        .orderBy('asset.id', 'asc')
        .limit(pagination.take + 1)
        .offset(pagination.skip ?? 0)
        .execute();
      return paginationHelper(items, pagination.take);
    });
  }

  // TODO(v4): drop the V3 suffix once the legacy methods are removed
  @GenerateSql(...searchStatisticsV3Examples)
  searchStatisticsV3(options: AssetSearchBuilderV3Options, scope: AssetSearchScope) {
    return searchAssetBuilder(this.db, options, scope)
      .select((qb) => qb.fn.countAll<number>().as('total'))
      .executeTakeFirstOrThrow();
  }

  private getExifField(field: 'city' | 'state' | 'country' | 'make' | 'model' | 'lensModel', userIds: string[]) {
    return this.db
      .selectFrom('asset_exif')
      .select(field)
      .distinctOn(field)
      .innerJoin('asset', 'asset.id', 'asset_exif.assetId')
      .where('ownerId', '=', anyUuid(userIds))
      .where('visibility', '=', AssetVisibility.Timeline)
      .where('deletedAt', 'is', null)
      .where(field, 'is not', null)
      .where(field, '!=', '');
  }
}
