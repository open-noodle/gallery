import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { LRUMap, LRUMapWithDelete } from 'mnemonist';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { AssetVisibility, Permission } from 'src/enum.js';
import {
  SearchOptionsDimension,
  SearchOptionsRequestDto,
  SearchOptionsResponseDto,
} from 'src/gallery/dtos/search.dto.js';
import { SearchOptionsQuery, SearchOptionsResult } from 'src/gallery/repositories/smart-facet.repository.js';
import { isFavoritesAcrossScope } from 'src/gallery/utils/favorites-scope.js';
import { TimeBucketOptions } from 'src/repositories/asset.repository.js';
import { BaseService } from 'src/services/base.service.js';
import { requireElevatedPermission } from 'src/utils/access.js';
import { getAlbumSpaceIds } from 'src/utils/album-space-ids.js';
import { getMyPartnerIds } from 'src/utils/asset.util.js';
import { without } from 'src/utils/filter-suggestions.js';
import { isSmartSearchEnabled } from 'src/utils/misc.js';

type SearchOptionsFilters = Omit<SearchOptionsRequestDto, 'query' | 'queryAssetId' | 'language' | 'dimensions'>;

/** A resolved request, before choosing what to compute. */
type ResolvedRequest = SearchOptionsQuery extends infer T ? (T extends unknown ? Omit<T, 'dimensions'> : never) : never;

/**
 * `POST /search/options`: the narrowed filter options with per-option counts that the mobile search mode shows beside
 * its results (specs/2026-10-23-mobile-search-redesign-design.md, Slice 1). Each mode resolves the request exactly as
 * its results call does, so the counts are counts of that call's own query:
 * - browse (no `query` / `queryAssetId`): `GET /timeline/buckets` — `TimelineService.timeBucketChecks` and
 *   `buildTimeBucketOptions`, step for step, with the same helpers (`getMyPartnerIds`, `getAlbumSpaceIds`,
 *   `resolveViewerScope('timeline')`). The medium tests compare every scope against the real `TimelineService`.
 * - query: `POST /search/smart` — `SearchService.resolveSmartSearch`: `resolveViewerScope('search')`, the caller plus
 *   timeline partners (none under an album scope, where album access is the boundary).
 */
@Injectable()
export class GallerySearchService extends BaseService {
  private embeddingCache = new LRUMap<string, string>(100);
  private optionsCache = new LRUMapWithDelete<string, CacheEntry>(2000);

  async getSearchOptions(auth: AuthDto, dto: SearchOptionsRequestDto): Promise<SearchOptionsResponseDto> {
    // The route is not `sharedLink: true`, so the guard already refuses a shared link; refused here too so the service
    // never answers one with its owner's scope.
    if (auth.sharedLink) {
      throw new ForbiddenException('Forbidden');
    }

    const { query, queryAssetId, language, dimensions: requested, ...filters } = dto;
    const dimensions: SearchOptionsDimension[] = requested?.length ? [...new Set(requested)] : ['availability'];
    const albumIds = filters.albumIds?.length ? filters.albumIds : undefined;

    if (albumIds && filters.spaceId) {
      throw new BadRequestException('Cannot use albumId with spaceId');
    }
    if (albumIds && filters.withSharedSpaces) {
      throw new BadRequestException('Cannot use albumId with withSharedSpaces');
    }
    if (filters.spaceId && filters.withSharedSpaces) {
      throw new BadRequestException('Cannot use both spaceId and withSharedSpaces');
    }
    if (filters.spacePersonIds?.length && !filters.spaceId) {
      throw new BadRequestException('spacePersonIds requires spaceId');
    }
    if (filters.visibility === AssetVisibility.Locked) {
      requireElevatedPermission(auth);
    }
    const browseMode = !query && !queryAssetId;
    if (browseMode) {
      checkBrowseRequest(filters, albumIds);
    }
    if (filters.spaceId) {
      await this.requireAccess({ auth, permission: Permission.SharedSpaceRead, ids: [filters.spaceId] });
    }
    if (albumIds) {
      await this.requireAccess({ auth, permission: Permission.AlbumRead, ids: albumIds });
    }

    const compute = async (wanted: SearchOptionsDimension[], request: SearchOptionsFilters = filters) => {
      const resolved = browseMode
        ? await this.resolveBrowse(auth, { ...request, albumIds })
        : await this.resolveQuery(auth, { ...request, albumIds }, { query, queryAssetId, language });
      return this.smartFacetRepository.getSearchOptions({
        ...resolved,
        dimensions: wanted,
        filtered: !isUnfiltered(request),
      } as SearchOptionsQuery);
    };
    if (!browseMode) {
      return compute(dimensions);
    }
    if (isUnfiltered(filters)) {
      return this.fromCache(auth, filters, dimensions, compute);
    }

    // A list ignores its own filter, so when that filter is the only one, the list IS the unfiltered list: served from
    // the cache (a date-only request's months, a tags-only request's tags, ...). Only the selection marks differ.
    const cached = dimensions.filter((dimension) => {
      const own = ownFilterKeys[dimension];
      return own !== undefined && isUnfiltered(without(filters, ...own));
    });
    const computed = dimensions.filter((dimension) => !cached.includes(dimension));
    // the cached part is computed from the request without those lists' own filters, so nothing request-specific
    // (selection marks) is ever stored
    const unfiltered = without(filters, ...cached.flatMap((dimension) => ownFilterKeys[dimension]!));
    const none: SearchOptionsResult = {};
    const [fromCache, fresh] = await Promise.all([
      cached.length > 0 ? this.fromCache(auth, unfiltered, cached, (wanted) => compute(wanted, unfiltered)) : none,
      computed.length > 0 ? compute(computed) : none,
    ]);
    const selected = new Set(filters.tagIds);
    return {
      ...fromCache,
      ...(fromCache.tags && { tags: fromCache.tags.map((tag) => ({ ...tag, isSelected: selected.has(tag.id) })) }),
      ...fresh,
    };
  }

  /**
   * The unfiltered state (a screen's scope with no filter: what every search opens on) is cached per user, scope and
   * dimension. An entry is valid while the watermark of every table the options read is unchanged (a few index-only
   * lookups; see `SmartFacetRepository.getSearchOptionsWatermark`), and an entry is the computation's promise, so the
   * parallel per-dimension requests a client fires share one computation each.
   *
   * Stale while revalidate: an active library (uploads, face jobs) moves the watermark constantly, so after a change the
   * last result is still served at once, flagged `stale: true`, while one background computation per key refreshes it.
   * Bounds: a key recomputes at most once per `SEARCH_OPTIONS_REFRESH_INTERVAL_MS` (30 s), and a result computed more
   * than `SEARCH_OPTIONS_MAX_STALE_MS` (10 min) ago is never served stale: the request computes it instead.
   * In-process: each API worker keeps its own cache.
   */
  private async fromCache(
    auth: AuthDto,
    filters: SearchOptionsFilters,
    dimensions: SearchOptionsDimension[],
    compute: (wanted: SearchOptionsDimension[]) => Promise<SearchOptionsResult>,
  ): Promise<SearchOptionsResult> {
    const watermark = await this.smartFacetRepository.getSearchOptionsWatermark();
    const scope = Object.fromEntries(
      unfilteredKeys.filter((key) => filters[key] !== undefined).map((key) => [key, filters[key]]),
    );
    const key = (dimension: SearchOptionsDimension) => `${auth.user.id}|${JSON.stringify(scope)}|${dimension}`;
    const now = Date.now();

    const parts = new Map<SearchOptionsDimension, Promise<SearchOptionsResult>>();
    const missing: SearchOptionsDimension[] = [];
    const refresh: SearchOptionsDimension[] = [];
    let stale = false;
    for (const dimension of dimensions) {
      const entry = this.optionsCache.get(key(dimension));
      if (entry?.watermark === watermark) {
        parts.set(dimension, entry.value);
      } else if (entry?.settled && now - entry.computedAt <= SEARCH_OPTIONS_MAX_STALE_MS) {
        parts.set(dimension, Promise.resolve(entry.settled));
        stale = true;
        if (!entry.refreshing && now - entry.refreshedAt >= SEARCH_OPTIONS_REFRESH_INTERVAL_MS) {
          refresh.push(dimension);
        }
      } else {
        missing.push(dimension);
      }
    }

    const store = (wanted: SearchOptionsDimension[], previous?: Map<SearchOptionsDimension, CacheEntry>) => {
      const computed = compute(wanted);
      for (const dimension of wanted) {
        const value = computed.then((result) => pickDimension(result, dimension));
        // the refresh interval counts background refreshes only: a first computation leaves the key free to refresh
        const entry: CacheEntry = {
          watermark,
          value,
          computedAt: now,
          refreshedAt: previous ? now : 0,
          refreshing: false,
        };
        value
          .then((settled) => {
            entry.settled = settled;
            entry.computedAt = Date.now();
            this.optionsCache.set(key(dimension), entry);
          })
          .catch(() => {
            // a failure is not cached; a failed refresh keeps the previous result and its bounds
            const kept = previous?.get(dimension);
            if (kept) {
              kept.refreshing = false;
            } else if (this.optionsCache.peek(key(dimension)) === entry) {
              this.optionsCache.delete(key(dimension));
            }
          });
        if (previous) {
          continue;
        }
        this.optionsCache.set(key(dimension), entry);
        parts.set(dimension, value);
      }
    };

    if (missing.length > 0) {
      store(missing);
    }
    if (refresh.length > 0) {
      // single flight: the stale entries stay in place, marked, until the refresh replaces them
      const previous = new Map<SearchOptionsDimension, CacheEntry>();
      for (const dimension of refresh) {
        const entry = this.optionsCache.peek(key(dimension))!;
        entry.refreshing = true;
        entry.refreshedAt = now;
        previous.set(dimension, entry);
      }
      store(refresh, previous);
    }

    const results = await Promise.all(dimensions.map((dimension) => parts.get(dimension)!));
    return Object.assign({}, ...results, stale ? { stale: true } : {}) as SearchOptionsResult;
  }

  /** Browse mode: `TimelineService.timeBucketChecks` + `buildTimeBucketOptions` for the same request. */
  private async resolveBrowse(auth: AuthDto, filters: SearchOptionsFilters): Promise<ResolvedRequest> {
    const { albumIds, withPartners, spaceId, tagIds, type, takenAfter, takenBefore } = filters;
    const albumId = albumIds?.[0];
    // Only the un-scoped timeline defaults to "my assets"; an album or space browse states its own scope.
    const userId = spaceId || albumId ? undefined : auth.user.id;

    const {
      albumIds: _albumIds,
      tagIds: _tagIds,
      type: _type,
      takenAfter: _takenAfter,
      takenBefore: _takenBefore,
      ...rest
    } = filters;
    // The `/timeline/buckets` request this stands for: the same filters, typed as TimeBucketDto types them.
    const request = {
      ...rest,
      albumId,
      tagIds: tagIds ?? undefined,
      assetType: type,
      takenAfter: takenAfter?.toISOString(),
      takenBefore: takenBefore?.toISOString(),
    } as TimeBucketOptions;

    const userIds = userId
      ? [
          userId,
          ...(withPartners
            ? await getMyPartnerIds({ userId, repository: this.partnerRepository, timelineEnabled: true })
            : []),
        ]
      : undefined;
    const albumSpaceIds = albumId
      ? await getAlbumSpaceIds({ auth, albumId, repository: this.sharedSpaceRepository })
      : undefined;
    const build = async (isFavorite: boolean | undefined): Promise<TimeBucketOptions> => ({
      ...request,
      isFavorite,
      ...(await this.resolveViewerScope(auth, 'timeline', { ...request, isFavorite, userId })),
      userIds,
      albumSpaceIds,
      callerId: userId ? auth.user.id : undefined,
      authUserId: auth.user.id,
    });

    return {
      mode: 'browse',
      callerId: auth.user.id,
      timeline: await build(request.isFavorite),
      // #763: the favourites filter resolves its own scope (every member space), so the probe asks that request.
      favorites: await build(true),
      untagged: tagIds === null,
    };
  }

  /** Query mode: `SearchService.resolveSmartSearch` for the same request. */
  private async resolveQuery(
    auth: AuthDto,
    filters: SearchOptionsFilters,
    dto: Pick<SearchOptionsRequestDto, 'query' | 'queryAssetId' | 'language'>,
  ): Promise<ResolvedRequest> {
    const { withPartners: _withPartners, withStacked: _withStacked, ...search } = filters;
    const embedding = await this.resolveEmbedding(auth, dto);
    // #763: `favoriteScoped` as on the results call; `withFavoriteSpaces` adds the hasFavorites probe's own space list.
    const scope = await this.resolveViewerScope(auth, 'search', {
      ...search,
      favoriteScoped: search.isFavorite === true,
      withFavoriteSpaces: true,
    });
    const userIds = search.albumIds ? undefined : await this.getUserIdsToSearch(auth, search.visibility);
    return {
      mode: 'query',
      callerId: auth.user.id,
      search: {
        ...search,
        ...scope,
        userIds,
        viewingUserId: auth.user.id,
        authUserId: auth.user.id,
        ...embedding,
      },
    };
  }

  /** Query mode: the embedding `/search/smart` would rank by, with the same checks and messages. */
  private async resolveEmbedding(
    auth: AuthDto,
    dto: Pick<SearchOptionsRequestDto, 'query' | 'queryAssetId' | 'language'>,
  ): Promise<{ embedding: string; maxDistance: number }> {
    const { machineLearning } = await this.getConfig({ withCache: true });
    if (!isSmartSearchEnabled(machineLearning)) {
      throw new BadRequestException('Smart search is not enabled');
    }
    const maxDistance = machineLearning.clip.maxDistance;

    if (dto.query) {
      const key = machineLearning.clip.modelName + dto.query + dto.language;
      let embedding = this.embeddingCache.get(key);
      if (!embedding) {
        embedding = await this.machineLearningRepository.encodeText(dto.query, {
          modelName: machineLearning.clip.modelName,
          language: dto.language,
        });
        this.embeddingCache.set(key, embedding);
      }
      return { embedding, maxDistance };
    }

    await this.requireAccess({ auth, permission: Permission.AssetRead, ids: [dto.queryAssetId!] });
    const embedding = await this.searchRepository.getEmbedding(dto.queryAssetId!);
    if (!embedding) {
      throw new BadRequestException(`Asset ${dto.queryAssetId} has no embedding`);
    }
    return { embedding, maxDistance };
  }

  /** `SearchService.getUserIdsToSearch`: the caller plus the partners shown in their timeline; locked is personal. */
  private async getUserIdsToSearch(auth: AuthDto, visibility?: AssetVisibility): Promise<string[]> {
    if (visibility === AssetVisibility.Locked) {
      return [auth.user.id];
    }
    const partnerIds = await getMyPartnerIds({
      userId: auth.user.id,
      repository: this.partnerRepository,
      timelineEnabled: true,
    });
    return [auth.user.id, ...partnerIds];
  }
}

/** Browse mode: the request checks `TimelineService.timeBucketChecks` makes before any access check, same messages. */
const checkBrowseRequest = (filters: SearchOptionsFilters, albumIds: string[] | undefined) => {
  const { withPartners, withSharedSpaces, spaceId, visibility } = filters;
  if (albumIds && albumIds.length > 1) {
    throw new BadRequestException('Browse mode takes at most one album');
  }
  if ((spaceId || albumIds) && (visibility === AssetVisibility.Hidden || visibility === AssetVisibility.Locked)) {
    throw new BadRequestException('Hidden and locked assets are not available when browsing a shared space or album');
  }
  // the Favorites screen may leave visibility unset (see isFavoritesAcrossScope)
  const archiveOrUnset =
    visibility === AssetVisibility.Archive || (visibility === undefined && !isFavoritesAcrossScope(filters));
  if (withPartners && (archiveOrUnset || visibility === AssetVisibility.Locked)) {
    throw new BadRequestException('withPartners is only supported for non-archived, non-trashed, non-locked assets');
  }
  if (withSharedSpaces && archiveOrUnset) {
    throw new BadRequestException('withSharedSpaces is only supported for non-archived, non-trashed assets');
  }
};

/** Scope fields: a request carrying nothing else is the unfiltered state of a screen, which is cached. */
const unfilteredKeys = [
  'withSharedSpaces',
  'withPartners',
  'withStacked',
  'libraryView',
  'visibility',
  'spaceId',
  'albumIds',
  'ownerId',
] as const satisfies (keyof SearchOptionsFilters)[];

const isUnfiltered = (filters: SearchOptionsFilters) =>
  Object.entries(filters).every(
    ([key, value]) =>
      (unfilteredKeys as readonly string[]).includes(key) ||
      value === undefined ||
      (Array.isArray(value) && value.length === 0),
  );

/** The part of a result one dimension owns. */
const pickDimension = (result: SearchOptionsResult, dimension: SearchOptionsDimension): SearchOptionsResult => {
  switch (dimension) {
    case 'availability': {
      return { availability: result.availability };
    }
    case 'total': {
      return { total: result.total };
    }
    case 'time': {
      return { timeBuckets: result.timeBuckets };
    }
    case 'people': {
      return { people: result.people, hasUnnamedPeople: result.hasUnnamedPeople };
    }
    case 'tags': {
      return { tags: result.tags };
    }
    case 'places': {
      return { countries: result.countries };
    }
    case 'cameras': {
      return { cameraMakes: result.cameraMakes };
    }
    case 'ratings': {
      return { ratings: result.ratings };
    }
    case 'mediaTypes': {
      return { mediaTypes: result.mediaTypes };
    }
  }
};

/** Browse: the request keys each list ignores (see the repository's `browseExcludes`). */
const ownFilterKeys: Partial<Record<SearchOptionsDimension, (keyof SearchOptionsFilters)[]>> = {
  time: ['takenAfter', 'takenBefore'],
  places: ['country', 'state', 'city'],
  cameras: ['make', 'model'],
  ratings: ['rating'],
  mediaTypes: ['type'],
  tags: ['tagIds'],
};

/** A key recomputes at most this often while its watermark keeps moving. */
export const SEARCH_OPTIONS_REFRESH_INTERVAL_MS = 30_000;
/** A result computed longer ago than this is never served stale. */
export const SEARCH_OPTIONS_MAX_STALE_MS = 10 * 60_000;

type CacheEntry = {
  watermark: string;
  value: Promise<SearchOptionsResult>;
  /** The result, once computed: what is served stale. */
  settled?: SearchOptionsResult;
  computedAt: number;
  refreshedAt: number;
  refreshing: boolean;
};
