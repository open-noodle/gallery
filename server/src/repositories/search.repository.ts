import { Injectable } from '@nestjs/common';
import {
  expressionBuilder,
  Kysely,
  OrderByDirection,
  Selectable,
  SelectQueryBuilder,
  ShallowDehydrateObject,
  sql,
  SqlBool,
} from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { columns } from 'src/database';
import { DummyValue, GenerateSql } from 'src/decorators';
import { MapAsset } from 'src/dtos/asset-response.dto';
import { SearchFilter, SearchOrder } from 'src/dtos/search.dto';
import { AssetStatus, AssetType, AssetVisibility, VectorIndex } from 'src/enum';
import { probes } from 'src/repositories/database.repository';
import { DB } from 'src/schema';
import { AssetExifTable } from 'src/schema/tables/asset-exif.table';
import {
  anyUuid,
  asUuid,
  hasPeople,
  hasSpacePeople,
  hasTags,
  searchAssetBuilder,
  searchAssetBuilderLegacy,
  searchMetadataV3Examples,
  searchRandomV3Examples,
  searchSmartV3Examples,
  searchStatisticsV3Examples,
  truncatedDate,
  withExifInner,
  withSearchOrder,
} from 'src/utils/database';
import { without } from 'src/utils/filter-suggestions';
import { paginationHelper, PaginationOptions } from 'src/utils/pagination';
import { spaceAssetPathBranches, spaceVisibilityGate } from 'src/utils/shared-space-album-scope';
import z from 'zod';

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

export type SmartSearchFacetsOptions = Omit<SmartSearchOptions, 'orderDirection'>;

type SmartFacetExclude =
  | 'time'
  | 'people'
  | 'location'
  | 'city'
  | 'camera'
  | 'cameraModel'
  | 'tags'
  | 'rating'
  | 'media'
  | 'favorites'
  | 'albums';

export interface SmartSearchFacetsResult {
  total: number;
  timeBuckets: Array<{ timeBucket: string; count: number }>;
  countries: string[];
  cities: string[];
  cameraMakes: string[];
  cameraModels: string[];
  tags: FilterSuggestionsResult['tags'];
  people: FilterSuggestionsResult['people'];
  ratings: number[];
  mediaTypes: AssetType[];
  hasUnnamedPeople: boolean;
  hasFavorites: boolean;
  hasAssetsInAlbum: boolean;
  hasAssetsNotInAlbum: boolean;
}

export type LargeAssetSearchOptions = AssetSearchOptions & { minFileSize?: number };

export interface FaceEmbeddingSearch extends Omit<SearchEmbeddingOptions, 'userIds' | 'maxDistance'> {
  userIds?: string[];
  spaceId?: string;
  hasPerson?: boolean;
  numResults: number;
  maxDistance: number;
  minBirthDate?: Date | null;
  /**
   * Restricts candidate faces to assets whose visibility is in this set (Slice 1, F1/F2). Defaults to
   * undefined — no predicate — so the two recognition callers (person.service.ts:1436, :1485) and the
   * space-face-match caller (shared-space.service.ts:2063) emit byte-identical SQL to before this option
   * existed. Only the suggestion scans and the cleanup scan's KNN pass pass this.
   */
  visibility?: AssetVisibility[];
}

export interface FaceSearchResult {
  distance: number;
  id: string;
  personGroupId: string | null;
}

export interface AssetDuplicateResult {
  assetId: string;
  duplicateId: string | null;
  distance: number;
}

export interface SuggestionScopeOptions {
  albumId?: string;
  spaceId?: string;
  timelineSpaceIds?: string[];
  takenAfter?: Date;
  takenBefore?: Date;
  /**
   * Mirrors `AssetSearchBuilderOptions.visibility` (see `searchAssetBuilder` in `src/utils/database.ts`):
   * a concrete value filters to exactly that visibility, `'not-locked'` excludes only Locked, and
   * `undefined` applies no filter. The caller (SearchService) resolves this the same way it resolves
   * search's own visibility — `dto.visibility ?? (auth.session?.hasElevatedPermission ? undefined :
   * 'not-locked')` — so suggestions cover the same asset set search would return (LOW #7).
   */
  visibility?: AssetVisibility | 'not-locked';
}

interface ExifSuggestionScopeOptions extends SuggestionScopeOptions {
  isNotInAlbum?: boolean;
  isInAlbum?: boolean;
}

interface FilterSuggestionFilterOptions {
  personIds?: string[];
  identityIds?: string[];
  forceEmptyResult?: boolean;
  country?: string;
  /**
   * State/province. A first-class facet key (not just an outer `getCities` predicate) so that an
   * active state narrows *every* suggestion list — people, tags, camera makes, ratings, media types
   * — the way `country` / `city` already do. The location group members that a list must NOT be
   * narrowed by are excluded per call site via `without(...)`, never here.
   */
  state?: string;
  city?: string;
  make?: string;
  model?: string;
  /** Lens model. Same reasoning as `state`, for the camera group. */
  lensModel?: string;
  /**
   * Contributor filter: a plain `AND asset.ownerId = X` applied *inside* whatever scope
   * `applySuggestionScope` resolved, so it can only ever shrink the suggestion set. It is NOT an
   * ownership scope — see `SearchUserIdOptions.ownerId` for the same distinction on the search path.
   */
  ownerId?: string;
  tagIds?: string[];
  rating?: number;
  mediaType?: AssetType;
  isFavorite?: boolean;
  isNotInAlbum?: boolean;
  isInAlbum?: boolean;
}

export interface GetStatesOptions extends SuggestionScopeOptions, FilterSuggestionFilterOptions {}

export interface GetCitiesOptions extends SuggestionScopeOptions, FilterSuggestionFilterOptions {}

export interface GetCameraModelsOptions extends SuggestionScopeOptions, FilterSuggestionFilterOptions {}

export interface GetCameraMakesOptions extends SuggestionScopeOptions, FilterSuggestionFilterOptions {}

export interface GetCameraLensModelsOptions extends SuggestionScopeOptions, FilterSuggestionFilterOptions {}

export interface FilterSuggestionsOptions extends SuggestionScopeOptions, FilterSuggestionFilterOptions {}

type FilterSuggestionPerson = {
  id: string;
  name: string;
  primaryProfile?: { type: 'user-person' | 'space-person'; id: string; spaceId?: string };
};

type AccessibleTagScopeOptions = Pick<
  SuggestionScopeOptions,
  'spaceId' | 'timelineSpaceIds' | 'takenAfter' | 'takenBefore' | 'visibility'
>;

export interface FilterSuggestionsResult {
  countries: string[];
  cameraMakes: string[];
  tags: Array<{ id: string; value: string }>;
  people: FilterSuggestionPerson[];
  ratings: number[];
  mediaTypes: string[];
  hasUnnamedPeople: boolean;
  hasFavorites: boolean;
  hasAssetsInAlbum: boolean;
  hasAssetsNotInAlbum: boolean;
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
    const items = await searchAssetBuilderLegacy(this.db, options)
      .select(columns.searchAsset)
      .orderBy('asset.fileCreatedAt', orderDirection)
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
      },
    ],
  })
  searchStatistics(options: AssetSearchOptions) {
    return searchAssetBuilderLegacy(this.db, options)
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
      },
    ],
  })
  async searchRandom(size: number, options: AssetSearchOptions) {
    return searchAssetBuilderLegacy(this.db, options)
      .select(columns.searchAsset)
      .orderBy(sql`random()`)
      .limit(size)
      .execute();
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
      },
    ],
  })
  searchLargeAssets(size: number, options: LargeAssetSearchOptions) {
    const orderDirection = (options.orderDirection?.toLowerCase() || 'desc') as OrderByDirection;
    return searchAssetBuilderLegacy(this.db, options)
      .select(columns.searchAsset)
      .$call(withExifInner)
      .where('asset_exif.fileSizeInByte', '>', options.minFileSize || 0)
      .orderBy('asset_exif.fileSizeInByte', orderDirection)
      .limit(size)
      .execute();
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

    let baseQuery = searchAssetBuilderLegacy(kysely, {
      ...without(options, 'personIds', 'personMatchAny', 'identityIds', 'forceEmptyResult'),
      ratingIsMinimum: true,
    })
      .selectAll('asset')
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
        embedding: DummyValue.VECTOR,
        userIds: [DummyValue.UUID],
        timelineSpaceIds: [DummyValue.UUID, DummyValue.UUID],
        maxDistance: 0.75,
        country: DummyValue.STRING,
        make: DummyValue.STRING,
        tagIds: [DummyValue.UUID],
        rating: 4,
        type: AssetType.Image,
        takenAfter: DummyValue.DATE,
        takenBefore: DummyValue.DATE,
      },
    ],
  })
  async getSmartSearchFacets(options: SmartSearchFacetsOptions): Promise<SmartSearchFacetsResult> {
    return this.db.transaction().execute(async (trx) => {
      await sql`set local vchordrq.probes = ${sql.lit(probes[VectorIndex.Clip])}`.execute(trx);
      await this.createSmartFacetCandidates(trx, options);

      const total = await this.getSmartFacetTotal(trx, options);
      const timeBuckets = await this.getSmartFacetTimeBuckets(trx, options);
      const countries = await this.getSmartFacetCountries(trx, options);
      const cities = await this.getSmartFacetCities(trx, options);
      const cameraMakes = await this.getSmartFacetCameraMakes(trx, options);
      const cameraModels = await this.getSmartFacetCameraModels(trx, options);
      const tags = await this.getSmartFacetTags(trx, options);
      const peopleResult = await this.getSmartFacetPeople(trx, options);
      const ratings = await this.getSmartFacetRatings(trx, options);
      const mediaTypes = await this.getSmartFacetMediaTypes(trx, options);
      const hasFavorites = await this.getSmartFacetHasFavorites(trx, options);
      const albumMembership = await this.getSmartFacetAlbumMembership(trx, options);

      return {
        total,
        timeBuckets,
        countries,
        cities,
        cameraMakes,
        cameraModels,
        tags,
        people: peopleResult.people,
        ratings,
        mediaTypes,
        hasUnnamedPeople: peopleResult.hasUnnamedPeople,
        hasFavorites,
        ...albumMembership,
      };
    });
  }

  private buildSmartFacetCandidateQuery(kysely: Kysely<DB>, options: SmartSearchFacetsOptions) {
    const hasDistanceThreshold = isActiveDistanceThreshold(options.maxDistance);

    return searchAssetBuilderLegacy(kysely, {
      ...without(
        options,
        'city',
        'country',
        'make',
        'model',
        'rating',
        'type',
        'isFavorite',
        'isInAlbum',
        'isNotInAlbum',
        'takenAfter',
        'takenBefore',
        'personIds',
        'personMatchAny',
        'identityIds',
        'forceEmptyResult',
        'spacePersonIds',
        'tagIds',
        'tagMatchAny',
      ),
      ratingIsMinimum: true,
    })
      .select('asset.id')
      .innerJoin('smart_search', 'asset.id', 'smart_search.assetId')
      .$if(!!options.forceEmptyResult, (qb) => qb.where(sql<SqlBool>`false`))
      .$if(hasDistanceThreshold, (qb) =>
        qb.where(sql<SqlBool>`(smart_search.embedding <=> ${options.embedding}) <= ${options.maxDistance!}`),
      )
      .where('smart_search.embedding', 'is not', null);
  }

  private async createSmartFacetCandidates(trx: Kysely<DB>, options: SmartSearchFacetsOptions) {
    await sql`drop table if exists smart_search_facet_candidates`.execute(trx);
    await sql`
      create temporary table smart_search_facet_candidates on commit drop as
      ${this.buildSmartFacetCandidateQuery(trx, options)}
    `.execute(trx);
    await sql`create index smart_search_facet_candidates_asset_id_idx on smart_search_facet_candidates ("id")`.execute(
      trx,
    );
  }

  private buildSmartFacetFilteredAssetIds(
    kysely: Kysely<DB>,
    options: SmartSearchFacetsOptions,
    exclude?: SmartFacetExclude,
  ) {
    const appliesCountry = exclude !== 'location' && options.country !== undefined;
    const appliesCity = exclude !== 'location' && exclude !== 'city' && options.city !== undefined;
    const appliesMake = exclude !== 'camera' && options.make !== undefined;
    const appliesModel = exclude !== 'camera' && exclude !== 'cameraModel' && options.model !== undefined;
    const appliesRating = exclude !== 'rating' && options.rating !== undefined;
    const needsExifJoin = !!(appliesCountry || appliesCity || appliesMake || appliesModel || appliesRating);

    return kysely
      .selectFrom('asset')
      .select('asset.id')
      .where(
        'asset.id',
        'in',
        kysely.selectFrom(sql<{ id: string }>`smart_search_facet_candidates`.as('candidates')).select('candidates.id'),
      )
      .$if(exclude !== 'time' && !!options.takenAfter, (qb) =>
        qb.where('asset.fileCreatedAt', '>=', options.takenAfter!),
      )
      .$if(exclude !== 'time' && !!options.takenBefore, (qb) =>
        qb.where('asset.fileCreatedAt', '<=', options.takenBefore!),
      )
      .$if(exclude !== 'media' && !!options.type, (qb) => qb.where('asset.type', '=', options.type!))
      .$if(exclude !== 'favorites' && options.isFavorite !== undefined, (qb) =>
        qb.where('asset.isFavorite', '=', options.isFavorite!),
      )
      .$if(exclude !== 'albums' && !!options.isNotInAlbum && !options.albumIds?.length, (qb) =>
        qb.where((eb) =>
          eb.not(eb.exists(eb.selectFrom('album_asset').whereRef('album_asset.assetId', '=', 'asset.id'))),
        ),
      )
      .$if(exclude !== 'albums' && !!options.isInAlbum && !options.albumIds?.length, (qb) =>
        qb.where((eb) => eb.exists(eb.selectFrom('album_asset').whereRef('album_asset.assetId', '=', 'asset.id'))),
      )
      .$if(needsExifJoin, (qb) =>
        qb
          .innerJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
          .$if(appliesCountry, (qb) =>
            qb.where('asset_exif.country', options.country === null ? 'is' : '=', options.country!),
          )
          .$if(appliesCity, (qb) => qb.where('asset_exif.city', options.city === null ? 'is' : '=', options.city!))
          .$if(appliesMake, (qb) => qb.where('asset_exif.make', options.make === null ? 'is' : '=', options.make!))
          .$if(appliesModel, (qb) => qb.where('asset_exif.model', options.model === null ? 'is' : '=', options.model!))
          .$if(appliesRating, (qb) =>
            options.rating === null
              ? qb.where('asset_exif.rating', 'is', null)
              : qb.where('asset_exif.rating', '>=', options.rating!),
          ),
      )
      .$if(exclude !== 'people' && !!options.personIds?.length, (qb) => hasPeople(qb, options.personIds!))
      .$if(exclude !== 'people' && !!options.identityIds?.length, (qb) =>
        qb.where((eb) =>
          eb.and(
            options.identityIds!.map((identityId) =>
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
        ),
      )
      .$if(exclude !== 'people' && !!options.spacePersonIds?.length, (qb) =>
        hasSpacePeople(qb, options.spacePersonIds!),
      )
      .$if(exclude !== 'tags' && !!options.tagIds?.length, (qb) => hasTags(qb, options.tagIds!))
      .$if(exclude !== 'tags' && options.tagIds === null, (qb) =>
        qb.where((eb) => eb.not(eb.exists((eb) => eb.selectFrom('tag_asset').whereRef('assetId', '=', 'asset.id')))),
      )
      .$if(!!options.forceEmptyResult, (qb) => qb.where(sql<SqlBool>`false`));
  }

  private async getSmartFacetTotal(trx: Kysely<DB>, options: SmartSearchFacetsOptions): Promise<number> {
    const row = await trx
      .selectFrom(this.buildSmartFacetFilteredAssetIds(trx, options).as('filtered'))
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow();
    return Number(row.count);
  }

  private async getSmartFacetTimeBuckets(
    trx: Kysely<DB>,
    options: SmartSearchFacetsOptions,
  ): Promise<Array<{ timeBucket: string; count: number }>> {
    return trx
      .with('asset', (qb) =>
        qb
          .selectFrom('asset')
          .select(truncatedDate<Date>().as('timeBucket'))
          .where('asset.id', 'in', this.buildSmartFacetFilteredAssetIds(trx, options, 'time')),
      )
      .selectFrom('asset')
      .select(sql<string>`("timeBucket" AT TIME ZONE 'UTC')::date::text`.as('timeBucket'))
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .groupBy('timeBucket')
      .orderBy('timeBucket', 'desc')
      .execute() as Promise<Array<{ timeBucket: string; count: number }>>;
  }

  private async getSmartFacetCountries(trx: Kysely<DB>, options: SmartSearchFacetsOptions): Promise<string[]> {
    const rows = await trx
      .selectFrom('asset_exif')
      .select('country')
      .distinct()
      .where('assetId', 'in', this.buildSmartFacetFilteredAssetIds(trx, options, 'location'))
      .where('country', 'is not', null)
      .where('country', '!=', '')
      .orderBy('country')
      .execute();
    return rows.map((row) => row.country!);
  }

  private async getSmartFacetCities(trx: Kysely<DB>, options: SmartSearchFacetsOptions): Promise<string[]> {
    const rows = await trx
      .selectFrom('asset_exif')
      .select('city')
      .distinct()
      .where('assetId', 'in', this.buildSmartFacetFilteredAssetIds(trx, options, 'city'))
      .where('city', 'is not', null)
      .where('city', '!=', '')
      .orderBy('city')
      .execute();
    return rows.map((row) => row.city!);
  }

  private async getSmartFacetCameraMakes(trx: Kysely<DB>, options: SmartSearchFacetsOptions): Promise<string[]> {
    const rows = await trx
      .selectFrom('asset_exif')
      .select('make')
      .distinct()
      .where('assetId', 'in', this.buildSmartFacetFilteredAssetIds(trx, options, 'camera'))
      .where('make', 'is not', null)
      .where('make', '!=', '')
      .orderBy('make')
      .execute();
    return rows.map((row) => row.make!);
  }

  private async getSmartFacetCameraModels(trx: Kysely<DB>, options: SmartSearchFacetsOptions): Promise<string[]> {
    const rows = await trx
      .selectFrom('asset_exif')
      .select('model')
      .distinct()
      .where('assetId', 'in', this.buildSmartFacetFilteredAssetIds(trx, options, 'cameraModel'))
      .where('model', 'is not', null)
      .where('model', '!=', '')
      .orderBy('model')
      .execute();
    return rows.map((row) => row.model!);
  }

  private async getSmartFacetTags(
    trx: Kysely<DB>,
    options: SmartSearchFacetsOptions,
  ): Promise<Array<{ id: string; value: string }>> {
    return trx
      .selectFrom('tag')
      .select(['tag.id', 'tag.value'])
      .distinct()
      .innerJoin('tag_asset', 'tag.id', 'tag_asset.tagId')
      .where('tag_asset.assetId', 'in', this.buildSmartFacetFilteredAssetIds(trx, options, 'tags'))
      .orderBy('tag.value')
      .execute();
  }

  private async getSmartFacetPeople(
    trx: Kysely<DB>,
    options: SmartSearchFacetsOptions,
  ): Promise<{ people: FilterSuggestionPerson[]; hasUnnamedPeople: boolean }> {
    const filteredIds = this.buildSmartFacetFilteredAssetIds(trx, options, 'people');

    if (options.spaceId) {
      const spacePeople = await trx
        .selectFrom('shared_space_person')
        .select(['shared_space_person.id', 'shared_space_person.name'])
        .where('shared_space_person.spaceId', '=', asUuid(options.spaceId))
        .where('shared_space_person.isHidden', '=', false)
        .where((eb) =>
          eb.exists(
            eb
              .selectFrom('shared_space_person_face')
              .innerJoin('asset_face as af', 'af.id', 'shared_space_person_face.assetFaceId')
              .whereRef('shared_space_person_face.personId', '=', 'shared_space_person.id')
              .where('af.deletedAt', 'is', null)
              .where('af.isVisible', 'is', true)
              .where('af.assetId', 'in', filteredIds),
          ),
        )
        .orderBy(sql`nullif("shared_space_person"."name", '')`)
        .orderBy('shared_space_person.id')
        .execute();

      const people = spacePeople
        .map((person) => ({
          id: person.id,
          name: person.name || '',
          primaryProfile: { type: 'space-person' as const, id: person.id, spaceId: options.spaceId },
        }))
        .filter((person) => person.name !== '')
        .toSorted((a, b) => a.name.localeCompare(b.name));

      const hasUnnamedPeople = spacePeople.some((person) => !person.name);

      return { people, hasUnnamedPeople };
    }

    if (options.timelineSpaceIds?.length) {
      // `callerId`, not `userIds[0]`: an album-scoped search has no owner scoping at all.
      return this.getFilteredIdentityPeople(
        filteredIds,
        options.callerId ?? options.userIds?.[0] ?? '',
        options.timelineSpaceIds,
        trx,
      );
    }

    const peopleRows = await trx
      .selectFrom('person')
      .select(['person.personGroupId as id', 'person.name'])
      .where('person.name', '!=', '')
      .where('person.isHidden', '=', false)
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('asset_face')
            .whereRef('asset_face.personGroupId', '=', 'person.personGroupId')
            .where('asset_face.deletedAt', 'is', null)
            .where('asset_face.isVisible', 'is', true)
            .where('asset_face.assetId', 'in', filteredIds),
        ),
      )
      .orderBy('person.name')
      .execute();
    const people = peopleRows.map((person) => ({
      ...person,
      primaryProfile: { type: 'user-person' as const, id: person.id },
    }));

    const unnamed = await trx
      .selectFrom('person')
      .select(sql`1`.as('exists'))
      .where((eb) => eb.or([eb('person.name', '=', ''), eb('person.name', 'is', null)]))
      .where('person.isHidden', '=', false)
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('asset_face')
            .whereRef('asset_face.personGroupId', '=', 'person.personGroupId')
            .where('asset_face.deletedAt', 'is', null)
            .where('asset_face.isVisible', 'is', true)
            .where('asset_face.assetId', 'in', filteredIds),
        ),
      )
      .limit(1)
      .executeTakeFirst();

    return { people, hasUnnamedPeople: !!unnamed };
  }

  private async getSmartFacetRatings(trx: Kysely<DB>, options: SmartSearchFacetsOptions): Promise<number[]> {
    const rows = await trx
      .selectFrom('asset_exif')
      .select('rating')
      .distinct()
      .where('assetId', 'in', this.buildSmartFacetFilteredAssetIds(trx, options, 'rating'))
      .where('rating', 'is not', null)
      .where('rating', '>', 0)
      .orderBy('rating')
      .execute();
    return rows.map((row) => row.rating!);
  }

  private async getSmartFacetMediaTypes(trx: Kysely<DB>, options: SmartSearchFacetsOptions): Promise<AssetType[]> {
    const rows = await trx
      .selectFrom('asset')
      .select('type')
      .distinct()
      .where('id', 'in', this.buildSmartFacetFilteredAssetIds(trx, options, 'media'))
      .orderBy('type')
      .execute();
    return rows.map((row) => row.type);
  }

  private async getSmartFacetHasFavorites(trx: Kysely<DB>, options: SmartSearchFacetsOptions): Promise<boolean> {
    const row = await trx
      .selectFrom('asset')
      .select('asset.id')
      .where('asset.id', 'in', this.buildSmartFacetFilteredAssetIds(trx, options, 'favorites'))
      .where('asset.isFavorite', '=', true)
      .limit(1)
      .executeTakeFirst();
    return !!row;
  }

  private async getSmartFacetAlbumMembership(
    trx: Kysely<DB>,
    options: SmartSearchFacetsOptions,
  ): Promise<{ hasAssetsInAlbum: boolean; hasAssetsNotInAlbum: boolean }> {
    const probe = (filed: boolean) =>
      trx
        .selectFrom('asset')
        .select('asset.id')
        .where('asset.id', 'in', this.buildSmartFacetFilteredAssetIds(trx, options, 'albums'))
        .where((eb) => {
          const inAlbum = eb.exists(eb.selectFrom('album_asset').whereRef('album_asset.assetId', '=', 'asset.id'));
          return filed ? inAlbum : eb.not(inAlbum);
        })
        .limit(1)
        .executeTakeFirst();

    const [filed, unfiled] = await Promise.all([probe(true), probe(false)]);
    return { hasAssetsInAlbum: !!filed, hasAssetsNotInAlbum: !!unfiled };
  }

  @GenerateSql(
    {
      name: 'owner',
      params: [
        {
          userIds: [DummyValue.UUID],
          embedding: DummyValue.VECTOR,
          numResults: 10,
          maxDistance: 0.6,
        },
      ],
    },
    {
      name: 'space',
      params: [
        {
          spaceId: DummyValue.UUID,
          embedding: DummyValue.VECTOR,
          numResults: 10,
          maxDistance: 0.6,
          hasPerson: false,
        },
      ],
    },
    {
      name: 'owner-visibility',
      params: [
        {
          userIds: [DummyValue.UUID],
          embedding: DummyValue.VECTOR,
          numResults: 10,
          maxDistance: 0.6,
          visibility: [AssetVisibility.Archive, AssetVisibility.Timeline],
        },
      ],
    },
  )
  async searchFaces({
    userIds,
    spaceId,
    embedding,
    numResults,
    maxDistance,
    hasPerson,
    minBirthDate,
    visibility,
  }: FaceEmbeddingSearch) {
    if (!z.int().min(1).max(1000).safeParse(numResults).success) {
      throw new Error(`Invalid value for 'numResults': ${numResults}`);
    }

    if (spaceId && userIds?.length) {
      throw new Error('Cannot mix spaceId and userIds');
    }

    if (!spaceId && !userIds?.length) {
      throw new Error('searchFaces requires userIds for owner-scoped scans');
    }

    return await this.db.transaction().execute(async (trx) => {
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
            .leftJoin('person', 'person.personGroupId', 'asset_face.personGroupId')
            .$if(!spaceId, (qb) => qb.where('asset.ownerId', '=', anyUuid(userIds!)))
            // Space scope: all THREE access paths (direct / linked library / linked album +
            // cross-owner contributions) via the canonical helper, plus the visibility gate so
            // another member's Hidden/Locked assets never surface as face candidates.
            .$if(!!spaceId, (qb) =>
              qb
                .where((eb) =>
                  eb.or(
                    spaceAssetPathBranches(eb, {
                      correlateAssetId: 'asset.id',
                      correlateLibraryId: 'asset.libraryId',
                      scope: { spaceId: spaceId! },
                    }),
                  ),
                )
                .where((eb) => spaceVisibilityGate(eb)),
            )
            .where('asset.deletedAt', 'is', null)
            // Slice 1 (F2): opt-in visibility gate for the owner-scoped branch. Defaults to undefined (no
            // predicate) so recognition (person.service.ts:1436, :1485) and space-face-match
            // (shared-space.service.ts:2063) keep emitting byte-identical SQL — only the suggestion scans
            // and the cleanup scan's KNN pass pass this.
            .$if(!!visibility?.length, (qb) => qb.where('asset.visibility', 'in', visibility!))
            // Exclude soft-deleted faces. The Face Cleanup "not a face" action tombstones a face by setting
            // asset_face.deletedAt (personId is also nulled), and every recognition/suggestion candidate must
            // honour that — otherwise the suggestion scan keeps proposing a crop an admin already declared not
            // a face, and recognition can re-home it. Previously only asset.deletedAt was filtered here.
            .where('asset_face.deletedAt', 'is', null)
            .$if(hasPerson === true, (qb) => qb.where('asset_face.personGroupId', 'is not', null))
            .$if(hasPerson === false, (qb) => qb.where('asset_face.personGroupId', 'is', null))
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

  @GenerateSql({ params: [[DummyValue.UUID], [DummyValue.UUID]] })
  getAssetsByCity(userIds: string[], timelineSpaceIds?: string[]) {
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
              requireShowInTimeline: true,
            })
          : []),
      ]);
    };

    return this.db
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
      .orderBy('asset_exif.city')
      .execute();
  }

  async upsert(assetId: string, embedding: string): Promise<void> {
    await this.db
      .insertInto('smart_search')
      .values({ assetId, embedding })
      .onConflict((oc) => oc.column('assetId').doUpdateSet((eb) => ({ embedding: eb.ref('excluded.embedding') })))
      .execute();
  }

  async getCountries(userIds: string[], options: FilterSuggestionsOptions = {}): Promise<string[]> {
    // #858: mirror getFilterSuggestions' own getFilteredCountries — `city` is excluded alongside
    // `country`, because a selected city implies its country and would collapse this list to one row.
    // `state` is excluded for exactly that reason too (a state implies its country), and because the
    // whole location group is replaced by one click in the panel: country / state / city are ONE
    // filter (`handleLocationChange`), so the top level of it must never be narrowed by its children.
    const filteredIds = this.buildFilteredAssetIds(userIds, without(options, 'country', 'state', 'city'));
    const res = await this.db
      .selectFrom('asset_exif')
      .select('country')
      .distinct()
      .where('assetId', 'in', filteredIds)
      .where('country', 'is not', null)
      .where('country', '!=', '')
      .orderBy('country')
      .execute();

    return res.map((row) => row.country!);
  }

  @GenerateSql({ params: [[DummyValue.UUID], DummyValue.STRING] })
  async getStates(userIds: string[], options: GetStatesOptions): Promise<string[]> {
    // `country` stays applied (it is the drill-down parent); `city` is excluded for the same reason
    // as in getCountries. `state` is now a FilterSuggestionFilterOptions key, so it has to be
    // excluded explicitly or a selected state would collapse this list to that one row.
    const filteredIds = this.buildFilteredAssetIds(userIds, without(options, 'state', 'city'));
    const res = await this.db
      .selectFrom('asset_exif')
      .select('state')
      .distinct()
      .where('assetId', 'in', filteredIds)
      .where('state', 'is not', null)
      .where('state', '!=', '')
      .orderBy('state')
      .execute();

    return res.map((row) => row.state!);
  }

  @GenerateSql({ params: [[DummyValue.UUID], DummyValue.STRING, DummyValue.STRING] })
  async getCities(userIds: string[], options: GetCitiesOptions): Promise<string[]> {
    // `state` stays applied (it is the drill-down parent, like `country`) — but now from inside
    // buildFilteredAssetIds, which replaces the old outer $if clause. Same shape, same behaviour.
    const filteredIds = this.buildFilteredAssetIds(userIds, without(options, 'city'));
    const res = await this.db
      .selectFrom('asset_exif')
      .select('city')
      .distinct()
      .where('assetId', 'in', filteredIds)
      .where('city', 'is not', null)
      .where('city', '!=', '')
      .orderBy('city')
      .execute();

    return res.map((row) => row.city!);
  }

  @GenerateSql({ params: [[DummyValue.UUID], DummyValue.STRING, DummyValue.STRING] })
  async getCameraMakes(userIds: string[], options: GetCameraMakesOptions): Promise<string[]> {
    // `lensModel` stays applied — moved inside buildFilteredAssetIds, replacing the outer $if.
    // A lens is an independent filter here: unlike the location group, `handleCameraChange` does
    // not clear it when a make or model is clicked, so narrowing by it is honest.
    const filteredIds = this.buildFilteredAssetIds(userIds, without(options, 'make'));
    const res = await this.db
      .selectFrom('asset_exif')
      .select('make')
      .distinct()
      .where('assetId', 'in', filteredIds)
      .where('make', 'is not', null)
      .where('make', '!=', '')
      .orderBy('make')
      .execute();

    return res.map((row) => row.make!);
  }

  @GenerateSql({ params: [[DummyValue.UUID], DummyValue.STRING, DummyValue.STRING] })
  async getCameraModels(userIds: string[], options: GetCameraModelsOptions): Promise<string[]> {
    // #858: every other active filter must narrow the model list, exactly like getCities. Only the
    // model itself is excluded — a selected model must not collapse its own list to one row.
    // `lensModel` stays applied, moved inside buildFilteredAssetIds (see getCameraMakes).
    const filteredIds = this.buildFilteredAssetIds(userIds, without(options, 'model'));
    const res = await this.db
      .selectFrom('asset_exif')
      .select('model')
      .distinct()
      .where('assetId', 'in', filteredIds)
      .where('model', 'is not', null)
      .where('model', '!=', '')
      .orderBy('model')
      .execute();

    return res.map((row) => row.model!);
  }

  @GenerateSql({ params: [[DummyValue.UUID], DummyValue.STRING] })
  async getCameraLensModels(userIds: string[], options: GetCameraLensModelsOptions): Promise<string[]> {
    // `lensModel` is now a member of `FilterSuggestionFilterOptions`, so it has to be excluded here
    // or a selected lens would collapse its own list to one row. `make` and `model` stay applied,
    // inside buildFilteredAssetIds, replacing the old outer $if clauses.
    const filteredIds = this.buildFilteredAssetIds(userIds, without(options, 'lensModel'));
    const res = await this.db
      .selectFrom('asset_exif')
      .select('lensModel')
      .distinct()
      .where('assetId', 'in', filteredIds)
      .where('lensModel', 'is not', null)
      .where('lensModel', '!=', '')
      .orderBy('lensModel')
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

  @GenerateSql({ params: [[DummyValue.UUID]] })
  async getAccessibleTags(
    userIds: string[],
    options?: AccessibleTagScopeOptions,
  ): Promise<Array<{ id: string; value: string }>> {
    const visibility = options?.visibility;
    return this.db
      .selectFrom('tag')
      .select(['tag.id', 'tag.value'])
      .distinct()
      .innerJoin('tag_asset', 'tag.id', 'tag_asset.tagId')
      .innerJoin('asset', 'tag_asset.assetId', 'asset.id')
      .$if(!!visibility, (qb) =>
        visibility === 'not-locked'
          ? qb.where('asset.visibility', '!=', AssetVisibility.Locked)
          : qb.where('asset.visibility', '=', visibility!),
      )
      .where('asset.deletedAt', 'is', null)
      .$if(!options?.spaceId && !options?.timelineSpaceIds, (qb) => qb.where('asset.ownerId', '=', anyUuid(userIds)))
      .$if(!!options?.spaceId && !options?.timelineSpaceIds, (qb) =>
        qb.where((eb) =>
          eb.and([
            eb.or(
              spaceAssetPathBranches(eb, {
                correlateAssetId: 'asset.id',
                correlateLibraryId: 'asset.libraryId',
                scope: { spaceId: options!.spaceId! },
                requireShowInTimeline: true,
              }),
            ),
            // M3: caller's own assets bypass space-visibility gate; others must be Archive/Timeline.
            eb.or([eb('asset.ownerId', '=', anyUuid(userIds)), spaceVisibilityGate(eb)]),
          ]),
        ),
      )
      .$if(!!options?.timelineSpaceIds, (qb) =>
        qb.where((eb) =>
          eb.or([
            eb('asset.ownerId', '=', anyUuid(userIds)),
            eb.and([
              eb('asset.visibility', '=', AssetVisibility.Timeline),
              eb.or(
                spaceAssetPathBranches(eb, {
                  correlateAssetId: 'asset.id',
                  correlateLibraryId: 'asset.libraryId',
                  scope: { spaceIds: options!.timelineSpaceIds! },
                  requireShowInTimeline: true,
                }),
              ),
            ]),
          ]),
        ),
      )
      .$if(!!options?.takenAfter, (qb) => qb.where('asset.fileCreatedAt', '>=', options!.takenAfter!))
      .$if(!!options?.takenBefore, (qb) => qb.where('asset.fileCreatedAt', '<', options!.takenBefore!))
      .orderBy('tag.value')
      .execute();
  }

  @GenerateSql({
    name: 'identity-filter-suggestions',
    params: [
      [DummyValue.UUID],
      {
        timelineSpaceIds: [DummyValue.UUID],
        identityIds: [DummyValue.UUID],
        takenAfter: DummyValue.DATE,
      },
    ],
    sortQueries: [
      'select distinct\n  "country"',
      'select distinct\n  "make"',
      'select distinct\n  "tag"."id"',
      'WITH\n  filtered_assets',
      'select distinct\n  "rating"',
      'select distinct\n  "type"',
      'and "asset"."isFavorite" = $',
      '  and exists (\n    select\n    from\n      "album_asset"',
      '  and not exists (\n    select\n    from\n      "album_asset"',
    ],
  })
  async getFilterSuggestions(userIds: string[], options: FilterSuggestionsOptions): Promise<FilterSuggestionsResult> {
    const [countries, cameraMakes, tags, peopleResult, ratings, mediaTypes, hasFavorites, albumMembership] =
      await Promise.all([
        // `state` joins `country` / `city` in the location group's self-exclusion: it implies its
        // country, so leaving it applied would collapse the country selector to a single row —
        // exactly the reason `city` is excluded here. Every other list keeps `state` applied.
        this.getFilteredCountries(userIds, without(options, 'country', 'state', 'city')),
        // `lensModel` deliberately stays applied, matching the standalone getCameraMakes endpoint:
        // clicking a make does not clear the lens chip, so the make list may honestly narrow by it.
        this.getFilteredCameraMakes(userIds, without(options, 'make', 'model')),
        this.getFilteredTags(userIds, without(options, 'tagIds')),
        this.getFilteredPeople(userIds, without(options, 'personIds', 'identityIds')),
        this.getFilteredRatings(userIds, without(options, 'rating')),
        this.getFilteredMediaTypes(userIds, without(options, 'mediaType')),
        this.getFilteredHasFavorites(userIds, without(options, 'isFavorite')),
        this.getFilteredAlbumMembership(userIds, without(options, 'isInAlbum', 'isNotInAlbum')),
      ]);

    return {
      countries,
      cameraMakes,
      tags,
      people: peopleResult.people,
      ratings,
      mediaTypes,
      hasUnnamedPeople: peopleResult.hasUnnamedPeople,
      hasFavorites,
      ...albumMembership,
    };
  }

  private applySuggestionScope<T extends SelectQueryBuilder<DB, any, any>>(
    qb: T,
    userIds: string[],
    options?: ExifSuggestionScopeOptions,
  ) {
    return (
      qb
        // Album scope. An asset feeds the album's filter facets only when it (a) belongs
        // to the album and (b) is one the user may legitimately see there. (b) holds when
        // the asset was contributed by an album participant (the album owner or a shared
        // user), is owned by the user or their partners, or is reachable through a shared
        // space they currently show in their timeline. Dropping the participant cases would
        // give viewers empty People/Location/Camera/Tag facets for assets owned by the
        // album owner (issue #655); dropping the access check entirely would leak a
        // shared-space asset that merely landed in an album to non-space-members.
        // Note: on this upstream base album ownership lives in `album_user` (the creator is
        // an `album_user` row with role=owner), so the album_user participant check below
        // covers both the album owner and shared users in one branch.
        .$if(!!options?.albumId, (qb) =>
          qb.where((eb) =>
            eb.and([
              eb.exists(
                eb
                  .selectFrom('album_asset')
                  .whereRef('album_asset.assetId', '=', 'asset.id')
                  .where('album_asset.albumId', '=', asUuid(options!.albumId!)),
              ),
              eb.or([
                // I1: unlike the plain-asset search path, getFilterSuggestions calls into
                // applySuggestionScope with no upstream visibility resolution — so "caller's own
                // assets follow the resolved visibility applied upstream" does NOT hold here. Gate
                // the owner's own assets too (Archive + Timeline), matching the album grid's
                // withDefaultVisibility, so the caller's own Hidden/Locked album asset can't feed a
                // facet value either. albumId arm ONLY — the sibling spaceId/timelineSpaceIds arms
                // below keep their deliberate M3 own-asset exception.
                eb.and([spaceVisibilityGate(eb), eb('asset.ownerId', '=', anyUuid(userIds))]),
                // Other album participants' assets: Archive + Timeline only (mirrors the
                // album view's withDefaultVisibility — Hidden/Locked never surface for
                // other members, matching the sibling spaceId/timelineSpaceIds branches).
                eb.and([
                  spaceVisibilityGate(eb),
                  eb.exists(
                    eb
                      .selectFrom('album_user')
                      .whereRef('album_user.userId', '=', 'asset.ownerId')
                      .where('album_user.albumId', '=', asUuid(options!.albumId!)),
                  ),
                ]),
                // Space-linked assets via timeline opt-in: also gate on Archive + Timeline.
                ...(options?.timelineSpaceIds?.length
                  ? [
                      eb.and([
                        spaceVisibilityGate(eb),
                        eb.or(
                          spaceAssetPathBranches(eb, {
                            correlateAssetId: 'asset.id',
                            correlateLibraryId: 'asset.libraryId',
                            scope: { spaceIds: options.timelineSpaceIds },
                          }),
                        ),
                      ]),
                    ]
                  : []),
              ]),
            ]),
          ),
        )
        .$if(!options?.albumId && !options?.spaceId && !options?.timelineSpaceIds, (qb) =>
          qb.where('asset.ownerId', '=', anyUuid(userIds)),
        )
        .$if(!!options?.spaceId && !options?.timelineSpaceIds && !options?.albumId, (qb) =>
          qb.where((eb) =>
            eb.and([
              eb.or(
                spaceAssetPathBranches(eb, {
                  correlateAssetId: 'asset.id',
                  correlateLibraryId: 'asset.libraryId',
                  scope: { spaceId: options!.spaceId! },
                  requireShowInTimeline: true,
                }),
              ),
              // M3: the caller's own assets bypass the space-visibility gate (own-M3);
              // every other member's asset must be Archive or Timeline.
              eb.or([eb('asset.ownerId', '=', anyUuid(userIds)), spaceVisibilityGate(eb)]),
            ]),
          ),
        )
        .$if(!!options?.timelineSpaceIds && !options?.albumId, (qb) =>
          qb.where((eb) =>
            eb.or([
              // Caller's own assets follow the resolved visibility applied above.
              eb('asset.ownerId', '=', anyUuid(userIds)),
              // Other members' assets: Timeline only + showInTimeline=true album path.
              eb.and([
                eb('asset.visibility', '=', AssetVisibility.Timeline),
                eb.or(
                  spaceAssetPathBranches(eb, {
                    correlateAssetId: 'asset.id',
                    correlateLibraryId: 'asset.libraryId',
                    scope: { spaceIds: options!.timelineSpaceIds! },
                    requireShowInTimeline: true,
                  }),
                ),
              ]),
            ]),
          ),
        )
    );
  }

  private buildFilteredAssetIds(userIds: string[], options: FilterSuggestionsOptions) {
    const needsExifJoin = !!(
      options.country ||
      options.state ||
      options.city ||
      options.make ||
      options.model ||
      options.lensModel ||
      options.rating
    );
    const visibility = options.visibility;

    return this.applySuggestionScope(
      this.db
        .selectFrom('asset')
        .select('asset.id')
        .$if(!!visibility, (qb) =>
          visibility === 'not-locked'
            ? qb.where('asset.visibility', '!=', AssetVisibility.Locked)
            : qb.where('asset.visibility', '=', visibility!),
        )
        .where('asset.deletedAt', 'is', null),
      userIds,
      options,
    )
      .$if(!!options.forceEmptyResult, (qb) => qb.where(sql<SqlBool>`false`))
      .$if(!!options.isNotInAlbum && !options.albumId, (qb) =>
        qb.where((eb) =>
          eb.not(eb.exists((eb) => eb.selectFrom('album_asset').whereRef('album_asset.assetId', '=', 'asset.id'))),
        ),
      )
      .$if(!!options.isInAlbum && !options.albumId, (qb) =>
        qb.where((eb) =>
          eb.exists((eb) => eb.selectFrom('album_asset').whereRef('album_asset.assetId', '=', 'asset.id')),
        ),
      )
      .$if(!!options.takenAfter, (qb) => qb.where('asset.fileCreatedAt', '>=', options.takenAfter!))
      .$if(!!options.takenBefore, (qb) => qb.where('asset.fileCreatedAt', '<', options.takenBefore!))
      .$if(needsExifJoin, (qb) =>
        qb
          .innerJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
          .$if(!!options.country, (qb) => qb.where('asset_exif.country', '=', options.country!))
          .$if(!!options.state, (qb) => qb.where('asset_exif.state', '=', options.state!))
          .$if(!!options.city, (qb) => qb.where('asset_exif.city', '=', options.city!))
          .$if(!!options.make, (qb) => qb.where('asset_exif.make', '=', options.make!))
          .$if(!!options.model, (qb) => qb.where('asset_exif.model', '=', options.model!))
          .$if(!!options.lensModel, (qb) => qb.where('asset_exif.lensModel', '=', options.lensModel!))
          .$if(!!options.rating, (qb) => qb.where('asset_exif.rating', '>=', options.rating!)),
      )
      .$if(options.ownerId !== undefined, (qb) => qb.where('asset.ownerId', '=', asUuid(options.ownerId!)))
      .$if(!!options.personIds?.length && !!options.spaceId, (qb) => hasSpacePeople(qb, options.personIds!))
      .$if(!!options.personIds?.length && !options.spaceId, (qb) => hasPeople(qb, options.personIds!))
      .$if(!!options.identityIds?.length, (qb) =>
        qb.where((eb) =>
          eb.and(
            options.identityIds!.map((identityId) =>
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
        ),
      )
      .$if(!!options.tagIds?.length, (qb) =>
        qb.where((eb) =>
          eb.exists(
            eb
              .selectFrom('tag_asset')
              .whereRef('tag_asset.assetId', '=', 'asset.id')
              .where('tag_asset.tagId', '=', anyUuid(options.tagIds!)),
          ),
        ),
      )
      .$if(!!options.mediaType, (qb) => qb.where('asset.type', '=', options.mediaType!))
      .$if(options.isFavorite !== undefined && options.isFavorite !== null, (qb) =>
        qb.where('asset.isFavorite', '=', options.isFavorite!),
      );
  }

  private async getFilteredCountries(userIds: string[], options: FilterSuggestionsOptions): Promise<string[]> {
    const filteredIds = this.buildFilteredAssetIds(userIds, options);
    const res = await this.db
      .selectFrom('asset_exif')
      .select('country')
      .distinct()
      .where('assetId', 'in', filteredIds)
      .where('country', 'is not', null)
      .where('country', '!=', '')
      .orderBy('country')
      .execute();
    return res.map((row) => row.country!);
  }

  private async getFilteredCameraMakes(userIds: string[], options: FilterSuggestionsOptions): Promise<string[]> {
    const filteredIds = this.buildFilteredAssetIds(userIds, options);
    const res = await this.db
      .selectFrom('asset_exif')
      .select('make')
      .distinct()
      .where('assetId', 'in', filteredIds)
      .where('make', 'is not', null)
      .where('make', '!=', '')
      .orderBy('make')
      .execute();
    return res.map((row) => row.make!);
  }

  private async getFilteredTags(
    userIds: string[],
    options: FilterSuggestionsOptions,
  ): Promise<Array<{ id: string; value: string }>> {
    const filteredIds = this.buildFilteredAssetIds(userIds, options);
    return this.db
      .selectFrom('tag')
      .select(['tag.id', 'tag.value'])
      .distinct()
      .innerJoin('tag_asset', 'tag.id', 'tag_asset.tagId')
      .where('tag_asset.assetId', 'in', filteredIds)
      .orderBy('tag.value')
      .execute();
  }

  private async getFilteredPeople(
    userIds: string[],
    options: FilterSuggestionsOptions,
  ): Promise<{ people: FilterSuggestionPerson[]; hasUnnamedPeople: boolean }> {
    const filteredIds = this.buildFilteredAssetIds(userIds, options);

    // When spaceId is set, return shared_space_person records (space-specific IDs and names)
    if (options.spaceId) {
      const spacePeople = await this.buildFilteredSpacePeopleQuery(filteredIds, options.spaceId).execute();

      const people = spacePeople
        .map((p) => ({
          id: p.id,
          name: p.name || '',
          primaryProfile: { type: 'space-person' as const, id: p.id, spaceId: options.spaceId },
        }))
        .filter((p) => p.name !== '');

      const hasUnnamedPeople = spacePeople.some((p) => !p.name);

      return { people, hasUnnamedPeople };
    }

    if (options.timelineSpaceIds?.length) {
      return this.getFilteredIdentityPeople(filteredIds, userIds[0], options.timelineSpaceIds);
    }

    // Global: return person records
    const peopleRows = await this.buildFilteredGlobalPeopleQuery(filteredIds).execute();
    const people = peopleRows.map((person) => ({
      ...person,
      primaryProfile: { type: 'user-person' as const, id: person.id },
    }));

    const unnamed = await this.db
      .selectFrom('person')
      .select(sql`1`.as('exists'))
      .where((eb) => eb.or([eb('person.name', '=', ''), eb('person.name', 'is', null)]))
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('asset_face')
            .whereRef('asset_face.personGroupId', '=', 'person.personGroupId')
            .where('asset_face.assetId', 'in', filteredIds),
        ),
      )
      .limit(1)
      .executeTakeFirst();

    return { people, hasUnnamedPeople: !!unnamed };
  }

  private buildFilteredSpacePeopleQuery(filteredIds: SelectQueryBuilder<DB, 'asset', { id: string }>, spaceId: string) {
    return this.db
      .selectFrom('shared_space_person')
      .select(['shared_space_person.id', 'shared_space_person.name'])
      .where('shared_space_person.spaceId', '=', asUuid(spaceId))
      .where('shared_space_person.isHidden', '=', false)
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('shared_space_person_face')
            .innerJoin('asset_face as af', 'af.id', 'shared_space_person_face.assetFaceId')
            .whereRef('shared_space_person_face.personId', '=', 'shared_space_person.id')
            .where('af.deletedAt', 'is', null)
            .where('af.isVisible', 'is', true)
            .where('af.assetId', 'in', filteredIds),
        ),
      )
      .orderBy(sql`nullif("shared_space_person"."name", '')`)
      .orderBy('shared_space_person.id');
  }

  private buildFilteredGlobalPeopleQuery(filteredIds: SelectQueryBuilder<DB, 'asset', { id: string }>) {
    return this.db
      .selectFrom('person')
      .select(['person.personGroupId as id', 'person.name'])
      .where('person.name', '!=', '')
      .where('person.isHidden', '=', false)
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('asset_face')
            .whereRef('asset_face.personGroupId', '=', 'person.personGroupId')
            .where('asset_face.assetId', 'in', filteredIds),
        ),
      )
      .orderBy('person.isFavorite', 'desc')
      .orderBy('person.name');
  }

  private async getFilteredIdentityPeople(
    filteredIds: SelectQueryBuilder<DB, 'asset', { id: string }>,
    userId: string,
    timelineSpaceIds: string[],
    db: Kysely<DB> = this.db,
  ): Promise<{ people: FilterSuggestionPerson[]; hasUnnamedPeople: boolean }> {
    const result = await sql<{
      id: string;
      name: string | null;
      profileType: 'user-person' | 'space-person';
      profileId: string;
      spaceId: string | null;
    }>`
      WITH filtered_assets AS (
        ${filteredIds}
      ),
      identity_faces AS (
        SELECT DISTINCT
          face_identity_face."identityId"
        FROM face_identity_face
        INNER JOIN asset_face ON asset_face.id = face_identity_face."assetFaceId"
        INNER JOIN filtered_assets ON filtered_assets.id = asset_face."assetId"
        WHERE asset_face."deletedAt" IS NULL
          AND asset_face."isVisible" = true
      ),
      profiles AS (
        SELECT
          'user-person'::text AS "profileType",
          person."personGroupId" AS "profileId",
          NULL::uuid AS "spaceId",
          person."identityId",
          person.name,
          person."isHidden",
          person."updatedAt",
          0 AS "profileRank"
        FROM person
        WHERE person."ownerId" = ${userId}
          AND person."identityId" IS NOT NULL
          AND EXISTS (SELECT 1 FROM identity_faces WHERE identity_faces."identityId" = person."identityId")
        UNION ALL
        SELECT
          'space-person'::text AS "profileType",
          shared_space_person.id AS "profileId",
          shared_space_person."spaceId",
          shared_space_person."identityId",
          COALESCE(NULLIF(shared_space_person_alias.alias, ''), shared_space_person.name, '') AS name,
          shared_space_person."isHidden",
          shared_space_person."updatedAt",
          CASE WHEN NULLIF(shared_space_person_alias.alias, '') IS NULL THEN 2 ELSE 1 END AS "profileRank"
        FROM shared_space_person
        LEFT JOIN shared_space_person_alias
          ON shared_space_person_alias."personId" = shared_space_person.id
          AND shared_space_person_alias."userId" = ${userId}
        WHERE shared_space_person."spaceId" = ${anyUuid(timelineSpaceIds)}
          AND shared_space_person."identityId" IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM shared_space_person_face
            INNER JOIN asset_face AS profile_face
              ON profile_face.id = shared_space_person_face."assetFaceId"
            WHERE shared_space_person_face."personId" = shared_space_person.id
              AND profile_face."deletedAt" IS NULL
              AND profile_face."isVisible" = true
          )
          AND EXISTS (
            SELECT 1 FROM identity_faces WHERE identity_faces."identityId" = shared_space_person."identityId"
          )
      ),
      ranked_profiles AS (
        SELECT
          profiles.*,
          row_number() OVER (
            PARTITION BY profiles."identityId"
            ORDER BY
              NULLIF(profiles.name, '') IS NULL,
              profiles."profileRank",
              lower(profiles.name),
              profiles."updatedAt" DESC,
              profiles."profileId"
          ) AS display_rn,
          row_number() OVER (
            PARTITION BY profiles."identityId"
            ORDER BY
              CASE
                WHEN profiles."profileType" = 'user-person' THEN 0
                ELSE profiles."profileRank"
              END,
              NULLIF(profiles.name, '') IS NULL,
              lower(profiles.name),
              profiles."updatedAt" DESC,
              profiles."profileId"
          ) AS primary_rn
        FROM profiles
        WHERE profiles."isHidden" = false
      )
      SELECT
        CASE
          WHEN primary_profiles."profileType" = 'space-person' THEN 'space-person:' || primary_profiles."profileId"::text
          ELSE 'person:' || primary_profiles."profileId"::text
        END AS id,
        COALESCE(NULLIF(display_profiles.name, ''), primary_profiles.name, '') AS name,
        primary_profiles."profileType",
        primary_profiles."profileId",
        primary_profiles."spaceId"
      FROM ranked_profiles AS primary_profiles
      INNER JOIN ranked_profiles AS display_profiles
        ON display_profiles."identityId" = primary_profiles."identityId"
        AND display_profiles.display_rn = 1
      WHERE primary_profiles.primary_rn = 1
      ORDER BY
        NULLIF(COALESCE(NULLIF(display_profiles.name, ''), primary_profiles.name, ''), '') IS NULL,
        lower(COALESCE(NULLIF(display_profiles.name, ''), primary_profiles.name, '')),
        primary_profiles."profileId"
    `.execute(db);

    return {
      people: result.rows
        .map((row) => ({
          id: row.id,
          name: row.name ?? '',
          primaryProfile:
            row.profileType === 'space-person'
              ? { type: row.profileType, id: row.profileId, spaceId: row.spaceId ?? undefined }
              : { type: row.profileType, id: row.profileId },
        }))
        .filter((person) => person.name !== ''),
      hasUnnamedPeople: result.rows.some((row) => !row.name),
    };
  }

  private async getFilteredRatings(userIds: string[], options: FilterSuggestionsOptions): Promise<number[]> {
    const filteredIds = this.buildFilteredAssetIds(userIds, options);
    const res = await this.db
      .selectFrom('asset_exif')
      .select('rating')
      .distinct()
      .where('assetId', 'in', filteredIds)
      .where('rating', 'is not', null)
      .where('rating', '>', 0)
      .orderBy('rating')
      .execute();
    return res.map((row) => row.rating!);
  }

  private async getFilteredMediaTypes(userIds: string[], options: FilterSuggestionsOptions): Promise<string[]> {
    const filteredIds = this.buildFilteredAssetIds(userIds, options);
    const res = await this.db
      .selectFrom('asset')
      .select('type')
      .distinct()
      .where('id', 'in', filteredIds)
      .orderBy('type')
      .execute();
    return res.map((row) => row.type);
  }

  /**
   * #910: presence probes for the Favourites / Albums sections. `limit 1` rather than an aggregate so
   * Postgres stops at the first matching row — the answer is "does one exist", not "how many".
   */
  private async getFilteredHasFavorites(userIds: string[], options: FilterSuggestionsOptions): Promise<boolean> {
    const row = await this.db
      .selectFrom('asset')
      .select('asset.id')
      .where('asset.id', 'in', this.buildFilteredAssetIds(userIds, options))
      .where('asset.isFavorite', '=', true)
      .limit(1)
      .executeTakeFirst();
    return !!row;
  }

  private async getFilteredAlbumMembership(
    userIds: string[],
    options: FilterSuggestionsOptions,
  ): Promise<{ hasAssetsInAlbum: boolean; hasAssetsNotInAlbum: boolean }> {
    const probe = (filed: boolean) =>
      this.db
        .selectFrom('asset')
        .select('asset.id')
        .where('asset.id', 'in', this.buildFilteredAssetIds(userIds, options))
        .where((eb) => {
          const inAlbum = eb.exists(eb.selectFrom('album_asset').whereRef('album_asset.assetId', '=', 'asset.id'));
          return filed ? inAlbum : eb.not(inAlbum);
        })
        .limit(1)
        .executeTakeFirst();

    const [filed, unfiled] = await Promise.all([probe(true), probe(false)]);
    return { hasAssetsInAlbum: !!filed, hasAssetsNotInAlbum: !!unfiled };
  }
}
