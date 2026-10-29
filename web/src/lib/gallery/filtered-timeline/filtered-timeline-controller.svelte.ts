import {
  searchSmartFacets,
  type AssetResponseDto,
  type AssetVisibility,
  type SmartSearchFacetsResponseDto,
} from '@immich/sdk';
import { modalManager } from '@immich/ui';
import { untrack } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { get } from 'svelte/store';
import { goto } from '$app/navigation';
import { page } from '$app/state';
import {
  clearFilters,
  createFilterState,
  getActiveFilterCount,
  loadFilterCollapsed,
  type FilterPanelConfig,
  type FilterState,
  type FilterSuggestionsResponse,
} from '$lib/components/filter-panel/filter-panel';
import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
import {
  registerSelectionContext,
  type RegisterSelectionContextOptions,
} from '$lib/managers/command-context-manager.svelte';
import { globalSearchManager } from '$lib/managers/global-search-manager.svelte';
import { getTimelineTopVisibleAnchor } from '$lib/managers/timeline-manager/timeline-anchor';
import type { TimelineManager } from '$lib/managers/timeline-manager/timeline-manager.svelte';
import type {
  TimelineAsset,
  TimelineGrouping,
  TimelineManagerOptions,
  TimelineTemporalAnchor,
} from '$lib/managers/timeline-manager/types';
import SearchAddAllToCollectionModal from '$lib/modals/SearchAddAllToCollectionModal.svelte';
import type { SearchTerms } from '$lib/services/search.service';
import { lang } from '$lib/stores/preferences.store';
import { withNameCapture } from '$lib/utils/filter-name-capture';
import { resolveFilterNames } from '$lib/utils/filter-name-resolution';
import { buildFilterStateUrl, isFilterStateUrlUnchanged, withoutAtParam } from '$lib/utils/filter-target';
import { handlePhotosRemoveFilter } from '$lib/utils/photos-filter-options';
import { removeSearchResults, selectAllSearchResults, updateSearchResults } from '$lib/utils/search-result-selection';
import {
  buildSearchablePageUrl,
  getSearchablePageFilterState,
  getSearchablePageState,
} from '$lib/utils/searchable-page-search';
import {
  buildSmartSearchFacetKey,
  buildSmartSearchFacetsParams,
  mapSmartSearchFacetsToFilterSuggestions,
} from '$lib/utils/space-search';
import { clearTimelineTemporalFilter } from '$lib/utils/timeline-temporal-filters';
import {
  getTimelineBucketZoomTarget,
  getTimelineManagerTimeBuckets,
  type ActivatableTimelineBucket,
} from '$lib/utils/timeline-zoom-navigation';
import { consumeTypedSearchNamesInto } from '$lib/utils/typed-search/typed-search-name-cache';

/** The route's smart-search scope; the keys match `SmartSearchResults`' props. */
export type SmartSearchScope = { withSharedSpaces?: boolean; spaceId?: string; albumIds?: string[] };

type TimeBucket = { timeBucket: string; count: number };

export type FilteredTimelineConfig = {
  /** Panel key prefix and the `gallery-filter-visible-sections-<name>` storage key. */
  name: string;
  /** Overrides the panel's section-visibility storage key. */
  storageKey?: string;
  /** Id of the entity a persistent route component shows (space, album); remounts the panel. */
  entityKey?: () => string;
  getTimelineManager: () => TimelineManager | undefined;
  /** Live smart-search scope, also part of the facet cache key. */
  scope: () => SmartSearchScope;
  /** Browse-mode timeline query for the current filters; the controller adds `grouping`. */
  timelineOptions: (filters: FilterState) => TimelineManagerOptions;
  /**
   * Browse-mode panel config. In query mode the controller answers suggestions, baseline and the
   * city/camera-model providers from the smart-search facets instead.
   */
  browseConfig: () => FilterPanelConfig;
  /**
   * `searchable` (photos style) writes `q`/`sort` with the filters and re-hydrates on any URL
   * change. `filter-state` (album style) writes only filter params and ignores `?at=` churn.
   */
  urlMode?: 'searchable' | 'filter-state';
  /** `filter-state` only: URL to FilterState (e.g. dropping a route-implied `albumId`). */
  hydrate?: (url: URL) => FilterState;
  /** Query mode with no facets: `throw` keeps the panel's last good facets (#910), `empty` does not. */
  facetFailure?: 'throw' | 'empty';
  /** Query-mode city/camera-model providers and baseline come from the facets (photos style). */
  queryModeProviders?: boolean;
  removeFilter?: (filters: FilterState, type: string, id?: string) => FilterState;
  /** Owner chip names already in scope (album users, space members), so no lookup is needed. */
  ownerNameSeed?: () => Iterable<{ id: string; name: string }>;
  /** Resolve album/owner chip names by id. */
  resolveNames?: boolean;
  /** Whether the library view control (#1038) applies; its view must reach the query through `timelineOptions`. */
  showLibraryView?: () => boolean;
  /** Search terms replayed by "add all to collection"; omit to hide the action. */
  collectTerms?: (filters: FilterState, query: string) => SearchTerms;
  /** Panel temporal-picker buckets in browse mode; defaults to the timeline's own buckets. */
  browseTimeBuckets?: () => TimeBucket[];
  /** False while the route shows something other than its browse timeline: grouping goes inert. */
  isBrowse?: () => boolean;
  /** Whether a bucket click may zoom; defaults to `isBrowse`. */
  canZoom?: () => boolean;
  /** Overrides the default "timeline loaded empty and nothing filters it" test. */
  isTimelineEmpty?: (controller: FilteredTimelineController) => boolean;
  onQueryChange?: () => void;
};

type FacetRequest = {
  key: string;
  controller: AbortController;
  promise: Promise<SmartSearchFacetsResponseDto | undefined>;
};

const emptyFilterSuggestions = (): FilterSuggestionsResponse => ({
  countries: [],
  cities: [],
  cameraMakes: [],
  cameraModels: [],
  tags: [],
  people: [],
  ratings: [],
  mediaTypes: [],
  hasUnnamedPeople: false,
  hasFavorites: false,
  hasAssetsInAlbum: false,
  hasAssetsNotInAlbum: false,
});

const replaceUrl = (url: string) => void goto(url, { replaceState: true, keepFocus: true, noScroll: true });

/**
 * Fork-only state behind every filtered timeline route: filter state and its URL round trip, the
 * committed smart-search query and its facets, grouping/zoom, chip names and the bulk-action
 * handlers that must act on search results while the timeline is unmounted (#908).
 *
 * Construct it during component init (it registers effects). Render it with `FilteredTimeline`.
 */
export class FilteredTimelineController {
  readonly config: FilteredTimelineConfig;

  filters = $state<FilterState>(createFilterState());
  query = $state('');
  isLoading = $state(false);
  /** Loaded smart-search results; the multi-select toolbar acts on these in query mode (#908). */
  searchResults = $state<AssetResponseDto[]>([]);
  /** Bumped to re-run the search (undo-delete restores the removed assets). */
  searchReloadToken = $state(0);
  /** Bumped to remount the timeline with a fresh manager (#1041). */
  timelineReloadToken = $state(0);
  grouping = $state<TimelineGrouping>('day');
  temporalAnchor = $state<TimelineTemporalAnchor | undefined>();
  filterCollapsed = $state(loadFilterCollapsed());
  smartFacets = $state<SmartSearchFacetsResponseDto>();

  readonly personNames = new SvelteMap<string, string>();
  readonly tagNames = new SvelteMap<string, string>();
  readonly albumNames = new SvelteMap<string, string>();
  readonly ownerNames = new SvelteMap<string, string>();

  #smartFacetKey = '';
  #facetRequest: FacetRequest | undefined;
  #filtersBeforePanelChange: FilterState;
  #lastHandledUrl = $state('');

  readonly showSearchResults = $derived(this.query.trim().length > 0);
  readonly activeFilterCount = $derived(getActiveFilterCount(this.filters));
  readonly hasActiveFilters = $derived(this.activeFilterCount > 0 || this.showSearchResults);
  readonly isBrowse = $derived(this.#isBrowse());
  /** The route's timeline query without grouping. */
  readonly timelineQuery = $derived(this.#timelineOptions());
  /** The browse timeline's options: the grouping must live here, it is what re-buckets. */
  readonly options = $derived(this.isBrowse ? { ...this.timelineQuery, grouping: this.grouping } : this.timelineQuery);
  readonly smartFacetTotal = $derived(this.showSearchResults ? this.smartFacets?.total : undefined);
  readonly totalAssetCount = $derived(this.#timeline()?.assetCount ?? 0);
  readonly resultCount = $derived(this.showSearchResults ? this.smartFacetTotal : this.totalAssetCount);
  readonly panelTimeBuckets = $derived(
    this.showSearchResults ? (this.smartFacets?.timeBuckets ?? []) : this.#browseTimeBuckets(),
  );
  // The timeline's *loaded* result for the current options rather than a bare `assetCount === 0`:
  // clearing a filter that had 0 results would otherwise flip this true for a tick, unmounting the
  // filter panel and dropping focus.
  readonly isTimelineEmpty = $derived(this.#isTimelineEmpty());
  /** Rebuilt when the route's browse config changes (another album), since the panel keys on it. */
  readonly panelConfig = $derived.by(() => this.#buildPanelConfig());

  constructor(config: FilteredTimelineConfig) {
    this.config = config;
    this.#hydrateFromUrl();
    this.#filtersBeforePanelChange = this.filters;

    $effect(() => {
      this.#filtersBeforePanelChange = this.filters;
    });
    $effect(() => globalSearchManager.registerSearchablePageFilters(() => this.filters));
    if (config.resolveNames !== false) {
      $effect(() => {
        for (const { id, name } of config.ownerNameSeed?.() ?? []) {
          this.ownerNames.set(id, name);
        }
        void resolveFilterNames(this.filters, { albumNames: this.albumNames, ownerNames: this.ownerNames });
      });
    }
    $effect(() => this.#onUrlChange());
  }

  /** Remount key for the panel: a mode or query switch swaps its whole suggestions provider. */
  get panelKey() {
    const entity = this.config.entityKey?.() ?? '';
    return this.showSearchResults
      ? `${entity}:${this.config.name}-search-${this.query.trim()}`
      : `${entity}:${this.config.name}-browse`;
  }

  get storageKey() {
    return this.config.storageKey ?? `gallery-filter-visible-sections-${this.config.name}`;
  }

  /** The timeline finished loading and holds nothing (album-style emptiness test). */
  get isLoadedEmpty() {
    const timeline = this.#timeline();
    return !!timeline?.isInitialized && !((timeline.months?.length ?? 0) > 0) && this.totalAssetCount === 0;
  }

  /** Grouping/zoom props for `<Timeline>`; inert outside the browse timeline. */
  get timelineProps() {
    const browse = this.isBrowse;
    return {
      onTimelineBucketActivate: browse ? this.onTimelineBucketActivate : undefined,
      temporalAnchor: browse ? this.temporalAnchor : undefined,
      onTemporalAnchorResolved: browse ? this.onTemporalAnchorResolved : undefined,
      grouping: browse ? this.grouping : ('day' as TimelineGrouping),
      onGroupingChange: browse ? this.onGroupingChange : undefined,
    };
  }

  /** Select-all over the loaded results in query mode; undefined lets the timeline select. */
  get onSelectAll() {
    return this.showSearchResults
      ? () => selectAllSearchResults(this.searchResults, assetMultiSelectManager)
      : undefined;
  }

  /** Filters, a search or a library view (#1038) narrow the timeline: empty then means no results, not an empty library. */
  get isNarrowed() {
    return this.hasActiveFilters || !!this.timelineQuery.libraryView;
  }

  /** A text search spans every photo, so the library view (#1038) is hidden while one runs. */
  get showLibraryView() {
    return !!this.config.showLibraryView?.() && this.isBrowse && !this.showSearchResults;
  }

  get onAddAllToCollection() {
    return this.config.collectTerms ? this.#addAllToCollection : undefined;
  }

  // --- filter panel, chips and URL -------------------------------------------------------------

  onFiltersChange = (nextFilters: FilterState) => {
    if (this.config.urlMode === 'filter-state') {
      this.#syncUrl(nextFilters);
      return;
    }
    const before = this.#filtersBeforePanelChange;
    if (
      nextFilters.dateAfter !== before.dateAfter ||
      nextFilters.dateBefore !== before.dateBefore ||
      nextFilters.selectedYear !== before.selectedYear ||
      nextFilters.selectedMonth !== before.selectedMonth
    ) {
      this.temporalAnchor = undefined;
    }
    this.#syncUrl(nextFilters);
  };

  onRemoveFilter = (type: string, id?: string) => {
    if (type === 'timeline') {
      this.temporalAnchor = undefined;
    }
    if (this.config.urlMode === 'filter-state' && type === 'timeline') {
      this.filters = clearTimelineTemporalFilter(this.filters);
    } else {
      this.filters = (this.config.removeFilter ?? handlePhotosRemoveFilter)(this.filters, type, id);
    }
    this.#syncUrl(this.filters);
  };

  onClearAll = () => {
    this.filters = clearFilters(this.filters);
    this.temporalAnchor = undefined;
    if (this.config.urlMode === 'filter-state' || !this.query.trim()) {
      this.#syncUrl(this.filters);
    }
  };

  clearSearch = () => {
    this.isLoading = false;
    const nextUrl = buildSearchablePageUrl(page.url, '', this.filters.sortOrder, this.filters);
    if (nextUrl) {
      replaceUrl(nextUrl);
    }
  };

  /** Re-seeds everything from the URL, for a route whose component persists across entities. */
  reset() {
    this.#abortFacets();
    // Person/tag names are kept: they are keyed by id, and the typed-search names for the new URL
    // may already have been consumed (destructively) by the URL effect.
    this.albumNames.clear();
    this.ownerNames.clear();
    this.#hydrateFromUrl();
    this.isLoading = false;
    this.grouping = 'day';
    this.temporalAnchor = undefined;
  }

  // --- grouping and zoom -----------------------------------------------------------------------

  onTimelineBucketActivate = (bucket: ActivatableTimelineBucket) => {
    if (!(this.config.canZoom?.() ?? this.isBrowse) || assetMultiSelectManager.selectionActive) {
      return;
    }
    const result = getTimelineBucketZoomTarget(bucket);
    if (!result) {
      return;
    }
    this.grouping = result.grouping;
    this.temporalAnchor = result.anchor;
  };

  onGroupingChange = (grouping: TimelineGrouping) => {
    const anchor = getTimelineTopVisibleAnchor(this.#timeline() as TimelineManager);
    this.grouping = grouping;
    this.temporalAnchor = anchor;
  };

  onTemporalAnchorResolved = () => {
    this.temporalAnchor = undefined;
  };

  // --- bulk actions: the timeline is unmounted while results show (#908) ------------------------

  onFavorite = (ids: string[], isFavorite: boolean) => {
    if (this.showSearchResults) {
      updateSearchResults(this.searchResults, ids, (asset) => (asset.isFavorite = isFavorite));
      return;
    }
    this.#timeline()?.update(ids, (asset) => (asset.isFavorite = isFavorite));
  };

  onArchive = (ids: string[], visibility: AssetVisibility) => {
    if (this.showSearchResults) {
      updateSearchResults(this.searchResults, ids, (asset) => (asset.visibility = visibility));
      return;
    }
    this.#timeline()?.update(ids, (asset) => (asset.visibility = visibility));
  };

  /** View-only removal (delete, remove-from-collection, visibility moves). */
  onAssetDelete = (assetIds: string[]) => {
    if (this.showSearchResults) {
      removeSearchResults(this.searchResults, assetIds);
      return;
    }
    this.#timeline()?.removeAssets(assetIds);
  };

  onUndoDelete = (assets: TimelineAsset[]) => {
    if (this.showSearchResults) {
      // Undo hands back TimelineAssets; the results hold AssetResponseDtos, so re-run the search.
      this.searchReloadToken++;
      return;
    }
    this.#timeline()?.upsertAssets(assets);
  };

  onSetVisibility = (assetIds: string[]) => {
    this.onAssetDelete(assetIds);
    assetMultiSelectManager.clear();
  };

  /**
   * #1041: adding photos to a space the caller hides from their own timeline changes what the
   * server returns, but the mounted manager has cached its buckets. Remount rather than
   * `removeAssets`: an asset that also reaches a still-visible space must stay, and deciding that
   * client-side is the simulation the hide-from-timeline design abandoned.
   */
  onSpaceAddAssets = ({ hiddenFromMyTimeline }: { hiddenFromMyTimeline?: boolean }) => {
    if ((hiddenFromMyTimeline || this.timelineQuery.libraryView) && !this.showSearchResults) {
      this.timelineReloadToken++;
    }
  };

  /** Registers the cmdk selection context with this route's bulk handlers. */
  registerSelectionContext(options: Partial<RegisterSelectionContextOptions> & { canAct?: () => boolean } = {}) {
    const { canAct = () => true, ...overrides } = options;
    const available = () => canAct() && (this.showSearchResults || !!this.#timeline());
    registerSelectionContext({
      getAssets: () => assetMultiSelectManager.assets,
      clearSelection: () => assetMultiSelectManager.clear(),
      getOnFavorite: () => (available() ? this.onFavorite : undefined),
      getOnArchive: () => (available() ? this.onArchive : undefined),
      getOnDelete: () => (available() ? this.onAssetDelete : undefined),
      getOnUndoDelete: () => (available() ? this.onUndoDelete : undefined),
      ...overrides,
    });
  }

  // --- internals -------------------------------------------------------------------------------

  #timeline() {
    return this.config.getTimelineManager();
  }

  #isTimelineEmpty() {
    const custom = this.config.isTimelineEmpty;
    return custom ? custom(this) : !!this.#timeline()?.isEmptyForOptions(this.options) && !this.isNarrowed;
  }

  #isBrowse() {
    return this.config.isBrowse?.() ?? true;
  }

  #timelineOptions() {
    return this.config.timelineOptions(this.filters);
  }

  #browseTimeBuckets() {
    return this.config.browseTimeBuckets?.() ?? getTimelineManagerTimeBuckets(this.#timeline());
  }

  #urlToken() {
    if (this.config.urlMode === 'filter-state') {
      return withoutAtParam(page.url.search);
    }
    const { query, sortOrder } = getSearchablePageState(page.url);
    return `${query}:${sortOrder}:${page.url.search}`;
  }

  #readFilters(): FilterState {
    if (this.config.urlMode === 'filter-state') {
      return { ...createFilterState(), ...this.config.hydrate?.(page.url) };
    }
    const { sortOrder } = getSearchablePageState(page.url);
    return { ...createFilterState(), ...getSearchablePageFilterState(page.url), sortOrder };
  }

  #hydrateFromUrl() {
    // The explicit temporal keys are part of the searchable pages' initial shape.
    const temporal = { dateAfter: undefined, dateBefore: undefined, selectedYear: undefined, selectedMonth: undefined };
    const filters = this.#readFilters();
    this.filters = this.config.urlMode === 'filter-state' ? filters : { ...temporal, ...filters };
    this.query = getSearchablePageState(page.url).query;
    this.#lastHandledUrl = this.#urlToken();
    consumeTypedSearchNamesInto(page.url.pathname + page.url.search, this.personNames, this.tagNames);
  }

  // Every filter, the temporal picker's year/month included, round-trips through the URL, so
  // rebuilding FilterState from the URL alone is lossless: back/forward, a shared link and the
  // `?at=` write from closing the asset viewer all re-hydrate the same state.
  #onUrlChange() {
    const token = this.#urlToken();
    if (token === this.#lastHandledUrl) {
      return;
    }
    const nextQuery = getSearchablePageState(page.url).query;
    untrack(() => {
      const queryChanged = nextQuery !== this.query;
      if (queryChanged) {
        // A new query invalidates the facets outright; a failed fetch would otherwise keep
        // annotating the new results with the previous query's total and buckets.
        this.#abortFacets();
        if (this.config.urlMode === 'filter-state') {
          this.searchResults = [];
        }
      }
      this.filters = this.#readFilters();
      this.query = nextQuery;
      this.isLoading = false;
      this.#lastHandledUrl = token;
      consumeTypedSearchNamesInto(page.url.pathname + page.url.search, this.personNames, this.tagNames);
      if (queryChanged) {
        this.config.onQueryChange?.();
      }
    });
  }

  #syncUrl(nextFilters: FilterState) {
    if (this.config.urlMode === 'filter-state') {
      const nextUrl = buildFilterStateUrl(page.url, nextFilters);
      // Not a string compare: buildFilterStateUrl re-appends the filter params last.
      if (!isFilterStateUrlUnchanged(page.url, nextUrl)) {
        replaceUrl(nextUrl);
      }
      return;
    }
    // `createFilterState()` defaults sortOrder to 'desc'; passing that through would stamp
    // `sort=desc` on every filter URL. With a query committed, 'desc' is a deliberate choice.
    const sortOrder =
      !this.query.trim() && nextFilters.sortOrder === 'desc' && !getSearchablePageState(page.url).hasExplicitSort
        ? 'relevance'
        : nextFilters.sortOrder;
    const nextUrl = buildSearchablePageUrl(page.url, this.query, sortOrder, nextFilters);
    if (nextUrl && nextUrl !== page.url.pathname + page.url.search) {
      replaceUrl(nextUrl);
    }
  }

  #abortFacets() {
    this.#facetRequest?.controller.abort();
    this.#facetRequest = undefined;
    this.smartFacets = undefined;
    this.#smartFacetKey = '';
  }

  #facetArgs(filters: FilterState) {
    return { query: this.query.trim(), filters, ...this.config.scope(), language: get(lang) };
  }

  /** Facets for the committed query, memoised on the request shape (sortOrder does not refetch). */
  loadSmartFacets(filters: FilterState): Promise<SmartSearchFacetsResponseDto | undefined> {
    const args = this.#facetArgs(filters);
    if (!args.query) {
      return Promise.resolve(undefined);
    }
    const key = buildSmartSearchFacetKey(args);
    if (this.smartFacets && this.#smartFacetKey === key) {
      return Promise.resolve(this.smartFacets);
    }
    if (this.#facetRequest?.key === key) {
      return this.#facetRequest.promise;
    }

    this.#facetRequest?.controller.abort();
    const controller = new AbortController();
    const promise = searchSmartFacets(
      { smartSearchFacetsDto: buildSmartSearchFacetsParams(args) },
      { signal: controller.signal },
    )
      .then((result) => {
        if (this.#facetRequest?.key === key && !controller.signal.aborted) {
          this.smartFacets = result;
          this.#smartFacetKey = key;
        }
        return result;
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          console.error('Failed to fetch smart search facets:', error);
        }
        return this.smartFacets;
      })
      .finally(() => {
        if (this.#facetRequest?.key === key) {
          this.#facetRequest = undefined;
        }
      });

    this.#facetRequest = { key, controller, promise };
    return promise;
  }

  #buildPanelConfig(): FilterPanelConfig {
    const config = this.config;
    // Read once per rebuild: an in-flight provider keeps the entity it was built for.
    const browse = config.browseConfig();
    const facetSuggestions = async (filters: FilterState) => {
      const facets = await this.loadSmartFacets(filters);
      if (!facets) {
        if (config.facetFailure === 'empty') {
          return emptyFilterSuggestions();
        }
        // #910: never resolve with a fabricated empty response; the panel cannot tell it from an
        // empty library and would hide every section. Rejecting keeps the last good facets.
        throw new Error('smart-search facets unavailable');
      }
      return mapSmartSearchFacetsToFilterSuggestions(facets, { spaceId: config.scope().spaceId });
    };
    // Uncached on purpose: a second facet request would abort the page's in-flight one.
    const facetList = async (patch: Partial<FilterState>, list: 'cities' | 'cameraModels') => {
      const args = this.#facetArgs({ ...this.filters, ...patch });
      if (!args.query) {
        return [];
      }
      const facets = await searchSmartFacets({ smartSearchFacetsDto: buildSmartSearchFacetsParams(args) });
      return facets[list];
    };
    const browseList = async (list: Promise<string[]> | undefined) => (await list) ?? [];

    const panelConfig: FilterPanelConfig = {
      ...browse,
      suggestionsProvider: (filters) =>
        this.showSearchResults ? facetSuggestions(filters) : browse.suggestionsProvider!(filters),
    };
    if (config.queryModeProviders !== false) {
      // #910: no baseline in query mode; `undefined` means "don't hide anything".
      panelConfig.baselineProvider = async () => (this.showSearchResults ? undefined : browse.baselineProvider?.());
      panelConfig.providers = {
        ...browse.providers,
        cities: (country, context) =>
          this.showSearchResults
            ? facetList({ country }, 'cities')
            : browseList(browse.providers?.cities?.(country, context)),
        cameraModels: (make, context) =>
          this.showSearchResults
            ? facetList({ make }, 'cameraModels')
            : browseList(browse.providers?.cameraModels?.(make, context)),
      };
    }
    const captured = withNameCapture(panelConfig, this.personNames, this.tagNames);
    const baseline = captured.baselineProvider;
    if (baseline) {
      captured.baselineProvider = async () => {
        const result = await baseline();
        for (const person of result?.people ?? []) {
          this.personNames.set(person.id, person.name);
        }
        for (const tag of result?.tags ?? []) {
          this.tagNames.set(tag.id, tag.name);
        }
        return result;
      };
    }
    return captured;
  }

  #addAllToCollection = () => {
    const query = this.query.trim();
    void modalManager.show(SearchAddAllToCollectionModal, {
      terms: this.config.collectTerms!(this.filters, query),
      total: this.showSearchResults ? (this.smartFacetTotal ?? 0) : this.totalAssetCount,
      smartSearchEnabled: !!query,
      language: get(lang),
    });
  };
}
