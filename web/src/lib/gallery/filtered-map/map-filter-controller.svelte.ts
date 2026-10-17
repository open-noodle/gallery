import {
  AssetVisibility,
  getFilteredMapMarkers,
  getTimeBuckets,
  type MapMarkerResponseDto,
  searchSmart,
} from '@immich/sdk';
import { modalManager } from '@immich/ui';
import { untrack } from 'svelte';
import { SvelteMap, SvelteSet, SvelteURL } from 'svelte/reactivity';
import { get } from 'svelte/store';
import { goto } from '$app/navigation';
import { page } from '$app/state';
import {
  clearFilters,
  createFilterState,
  getActiveFilterCount,
  loadFilterCollapsed,
  type FilterState,
} from '$lib/components/filter-panel/filter-panel';
import { QueryParameter } from '$lib/constants';
import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
import SearchAddAllToCollectionModal from '$lib/modals/SearchAddAllToCollectionModal.svelte';
import type { SearchTerms } from '$lib/services/search.service';
import { lang } from '$lib/stores/preferences.store';
import { resolveFilterNames } from '$lib/utils/filter-name-resolution';
import { filterStateToSearchTerms } from '$lib/utils/filter-search-terms';
import { buildFilterStateUrl, isFilterStateUrlUnchanged, withoutAtParam } from '$lib/utils/filter-target';
import { decodeFilterParams } from '$lib/utils/filter-url';
import { buildMapFilterConfig } from '$lib/utils/map-filter-config';
import { buildMapMarkerOptions, buildMapTimeBucketOptions } from '$lib/utils/map-filter-options';
import { handlePhotosRemoveFilter } from '$lib/utils/photos-filter-options';
import { buildSmartSearchParams, SEARCH_FILTER_DEBOUNCE_MS } from '$lib/utils/space-search';

// #767(b): this used to be an always-empty createFilterState(), so every filter active on the
// surface you came from was dropped the moment you reached the map. The URL is the source of
// truth now.
//
// Unlike the album page, the map KEEPS an albumId filter — /map?albumId=X is a legitimate scope
// (that is what the server-side album-access fix in this slice exists for) — EXCEPT when the map is
// already scoped to a space. Space ∩ album is unsatisfiable (the space scope demands the asset be
// in the space; albumConfinedToViewer, run with no timelineSpaceIds under a spaceId query, demands
// it be in no space at all) and the server 400s it. Dropping it here means a hand-typed
// /map?spaceId=S&albumId=A degrades to the space map instead of erroring.
const hydrateMapFilters = (url: URL): FilterState => {
  const decoded = decodeFilterParams(url);
  const urlSpaceId = url.searchParams.get(QueryParameter.SPACE_ID) || undefined;
  return { ...createFilterState(), ...decoded, albumId: urlSpaceId ? undefined : decoded.albumId };
};

/**
 * The `/map` page's filter state: URL-backed filters, the debounced marker fetch (intersected with
 * a committed smart-search query), the temporal picker's buckets and the chip names. Construct it
 * during component init: it registers its effects there.
 */
export class MapFilterController {
  readonly spaceId = $derived(page.url.searchParams.get(QueryParameter.SPACE_ID) || undefined);
  readonly committedQuery = $derived(page.url.searchParams.get('q') ?? '');

  filters = $state<FilterState>(hydrateMapFilters(page.url));
  // Token guard for the URL $effect below, at-stripped like the album page — see withoutAtParam's
  // docs: replaceScrollTarget writes `?at=<assetId>` onto /map when the timeline panel's asset
  // viewer closes, and that is not a filter change. Re-hydrating on it is pure churn — the
  // FilterState it would rebuild is identical, since every filter is URL-backed — and it would
  // needlessly re-create `filters`, re-running the debounced marker/bucket fetch below.
  #lastHandledFilterSearch = $state(withoutAtParam(page.url.search));
  mapMarkers = $state<MapMarkerResponseDto[]>([]);
  timeBuckets = $state<Array<{ timeBucket: string; count: number }>>([]);
  readonly personNames = new SvelteMap<string, string>();
  readonly tagNames = new SvelteMap<string, string>();
  // /map?albumId=… and ?ownerId=… survive a reload and travel in a shared link, and nothing on this
  // page knows their names — resolve them by id, once, so the chip is a name and not a UUID.
  readonly albumNames = new SvelteMap<string, string>();
  readonly ownerNames = new SvelteMap<string, string>();

  readonly filterConfig = $derived.by(() => {
    const base = buildMapFilterConfig(this.spaceId);
    const originalProvider = base.suggestionsProvider!;
    return {
      ...base,
      suggestionsProvider: async (f: FilterState) => {
        const result = await originalProvider(f);
        for (const p of result.people) {
          this.personNames.set(p.id, p.name);
        }
        for (const t of result.tags) {
          this.tagNames.set(t.id, t.name);
        }
        return result;
      },
    };
  });
  readonly hasActiveFilters = $derived(getActiveFilterCount(this.filters) > 0 || this.committedQuery.trim().length > 0);

  // Desktop filter-panel collapse — driven from a header filter button so the collapsed panel doesn't
  // float over the map's own controls (mobile keeps its separate drawer toggle).
  filterCollapsed = $state(loadFilterCollapsed());
  readonly noResults = $derived(this.mapMarkers.length === 0 && this.hasActiveFilters);
  readonly hasUnappliedSmartSearch = $derived(
    this.committedQuery.trim().length > 0 && !featureFlagsManager.value.smartSearchHasCutoff,
  );

  readonly #timeBucketOptions = $derived.by(() => buildMapTimeBucketOptions(this.filters, this.spaceId));
  readonly #mapMarkerOptions = $derived.by(() => buildMapMarkerOptions(this.filters, this.spaceId));

  #fetchTimeout: ReturnType<typeof setTimeout> | undefined;
  #queryAbortController: AbortController | undefined;

  constructor() {
    $effect(() => {
      void resolveFilterNames(this.filters, { albumNames: this.albumNames, ownerNames: this.ownerNames });
    });

    // Fetch time buckets for the temporal picker
    $effect(() => {
      void getTimeBuckets(this.#timeBucketOptions).then((buckets) => {
        this.timeBuckets = buckets.map((b) => ({ timeBucket: b.timeBucket, count: b.count }));
      });
    });

    // Debounced marker fetch when filters change
    $effect(() => this.#fetchMarkers());

    $effect(() => {
      const nextFilterSearch = withoutAtParam(page.url.search);
      if (nextFilterSearch === this.#lastHandledFilterSearch) {
        return;
      }

      untrack(() => {
        // Every filter — including the temporal picker's year/month — round-trips through the URL, so
        // rebuilding FilterState from the URL alone is lossless.
        this.filters = {
          ...createFilterState(),
          ...hydrateMapFilters(page.url),
        };
        this.#lastHandledFilterSearch = nextFilterSearch;
      });
    });
  }

  /** Props the map component needs: the scope, the filtered markers, and no settings button. */
  get mapProps() {
    return { spaceId: this.spaceId, showSettings: false, mapMarkers: this.mapMarkers };
  }

  #fetchMarkers() {
    // Read the derived options before the debounce callback so filter changes
    // are tracked as dependencies of this effect.
    const options = this.#mapMarkerOptions;
    const currentSpaceId = this.spaceId;
    const query = this.committedQuery.trim();
    // Admin-only config: only the server can tell us whether machineLearning.clip.maxDistance is
    // configured in (0, 2), which is what makes searchSmart return a cutoff-limited result set.
    // Only then can the intersection loop below actually narrow anything — with no cutoff the
    // ranked result set isn't narrowed, and the loop would otherwise page it to exhaustion.
    const canApplySmartSearch = featureFlagsManager.value.smartSearchHasCutoff;

    clearTimeout(this.#fetchTimeout);
    this.#queryAbortController?.abort();
    const controller = new AbortController();
    this.#queryAbortController = controller;

    this.#fetchTimeout = setTimeout(() => {
      void (async () => {
        try {
          const markers = await getFilteredMapMarkers(options);

          if (controller.signal.aborted) {
            return;
          }

          if (!query || !canApplySmartSearch) {
            this.mapMarkers = markers;
            return;
          }

          if (markers.length === 0) {
            this.mapMarkers = [];
            return;
          }

          const matchingIds = new SvelteSet<string>();
          const unmatchedMarkerIds = new SvelteSet(markers.map((marker) => marker.id));
          let nextPage: number | null = 1;

          while (nextPage !== null && !controller.signal.aborted) {
            const { assets } = await searchSmart({
              smartSearchDto: {
                ...buildSmartSearchParams({
                  query,
                  filters: this.filters,
                  spaceId: currentSpaceId,
                  withSharedSpaces: !currentSpaceId,
                }),
                page: nextPage,
                size: 100,
              },
            });

            if (controller.signal.aborted) {
              return;
            }

            for (const asset of assets.items) {
              matchingIds.add(asset.id);
              unmatchedMarkerIds.delete(asset.id);
            }

            if (unmatchedMarkerIds.size === 0) {
              break;
            }

            nextPage = assets.nextPage === null ? null : Number(assets.nextPage);
          }

          if (controller.signal.aborted) {
            return;
          }

          this.mapMarkers = markers.filter((marker) => matchingIds.has(marker.id));
        } catch (error: unknown) {
          if (controller.signal.aborted) {
            return;
          }
          console.error('Failed to fetch filtered map markers:', error);
          this.mapMarkers = [];
        }
      })();
    }, SEARCH_FILTER_DEBOUNCE_MS);

    return () => {
      clearTimeout(this.#fetchTimeout);
      controller.abort();
    };
  }

  syncUrl = (nextFilters: FilterState) => {
    const nextUrl = buildFilterStateUrl(page.url, nextFilters);
    // NOT a string compare — buildFilterStateUrl re-appends the filter params last, so a URL like
    // /map?make=Apple&spaceId=s1 rebuilds re-ordered. See filter-target.ts.
    if (isFilterStateUrlUnchanged(page.url, nextUrl)) {
      return;
    }
    void goto(nextUrl, { replaceState: true, keepFocus: true, noScroll: true });
  };

  clearCommittedQuery = () => {
    const url = new SvelteURL(page.url);
    url.searchParams.delete('q');
    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    // Only `q` is dropped. The re-hydrate effect above then rebuilds `filters` from the remaining
    // URL, which still carries every active filter — including the picked year/month.
    void goto(nextUrl, {
      replaceState: true,
      keepFocus: true,
      noScroll: true,
    });
  };

  removeFilter = (type: string, id?: string) => {
    this.filters = handlePhotosRemoveFilter(this.filters, type, id);
    this.syncUrl(this.filters);
  };

  clearAll = () => {
    this.filters = clearFilters(this.filters);
    this.syncUrl(this.filters);
  };

  /** A deleted asset may have been a marker: refetch with the same filters. */
  refresh = () => {
    this.filters = { ...this.filters };
  };

  addAllToCollection = () => {
    const query = this.committedQuery.trim();
    const spaceId = this.spaceId;
    const terms: SearchTerms = {
      ...filterStateToSearchTerms(this.filters),
      ...(spaceId ? { spaceId } : { withSharedSpaces: true }),
      visibility: AssetVisibility.Timeline,
    };
    // Space-scoped map searches people via spacePersonIds (mirrors buildMapTimeBucketOptions).
    if (spaceId && terms.personIds) {
      terms.spacePersonIds = terms.personIds;
      delete terms.personIds;
    }
    if (query) {
      terms.query = query;
    }
    // Note: map markers are geotagged-only; metadata search has no has-GPS predicate, so the collected
    // set can exceed the marker count. Acceptable — the picker previews the count before adding.
    void modalManager.show(SearchAddAllToCollectionModal, {
      terms,
      total: this.mapMarkers.length,
      smartSearchEnabled: !!query,
      language: get(lang),
    });
  };
}
