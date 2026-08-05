<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import ActionMenuItem from '$lib/components/ActionMenuItem.svelte';
  import ActiveFiltersBar from '$lib/components/filter-panel/active-filters-bar.svelte';
  import FilterPanel from '$lib/components/filter-panel/filter-panel.svelte';
  import FilterToolbar from '$lib/components/filter-panel/filter-toolbar.svelte';
  import SmartSearchResults from '$lib/components/search/smart-search-results.svelte';
  import {
    ALL_FILTER_SECTIONS,
    buildFilterContext,
    clearFilters,
    createFilterState,
    getActiveFilterCount,
    loadFilterCollapsed,
    type FilterPanelConfig,
    type FilterState,
  } from '$lib/components/filter-panel/filter-panel';
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import ButtonContextMenu from '$lib/components/shared-components/context-menu/ButtonContextMenu.svelte';
  import EmptyPlaceholder from '$lib/components/shared-components/EmptyPlaceholder.svelte';
  import ArchiveAction from '$lib/components/timeline/actions/ArchiveAction.svelte';
  import ChangeDate from '$lib/components/timeline/actions/ChangeDateAction.svelte';
  import ChangeDescription from '$lib/components/timeline/actions/ChangeDescriptionAction.svelte';
  import ChangeLocation from '$lib/components/timeline/actions/ChangeLocationAction.svelte';
  import CreateSharedLink from '$lib/components/timeline/actions/CreateSharedLinkAction.svelte';
  import DeleteAssets from '$lib/components/timeline/actions/DeleteAssetsAction.svelte';
  import DownloadAction from '$lib/components/timeline/actions/DownloadAction.svelte';
  import FavoriteAction from '$lib/components/timeline/actions/FavoriteAction.svelte';
  import LinkLivePhotoAction from '$lib/components/timeline/actions/LinkLivePhotoAction.svelte';
  import RotateAction from '$lib/components/timeline/actions/RotateAction.svelte';
  import SelectAllAssets from '$lib/components/timeline/actions/SelectAllAction.svelte';
  import SetVisibilityAction from '$lib/components/timeline/actions/SetVisibilityAction.svelte';
  import StackAction from '$lib/components/timeline/actions/StackAction.svelte';
  import TagAction from '$lib/components/timeline/actions/TagAction.svelte';
  import AssetSelectControlBar from '$lib/components/timeline/AssetSelectControlBar.svelte';
  import Timeline from '$lib/components/timeline/Timeline.svelte';
  import { AssetAction } from '$lib/constants';
  import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
  import { assetViewerManager } from '$lib/managers/asset-viewer-manager.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { registerSelectionContext } from '$lib/managers/command-context-manager.svelte';
  import { globalSearchManager } from '$lib/managers/global-search-manager.svelte';
  import { memoryManager } from '$lib/managers/memory-manager.svelte';
  import { TimelineManager } from '$lib/managers/timeline-manager/timeline-manager.svelte';
  import type { TimelineAsset, TimelineGrouping, TimelineTemporalAnchor } from '$lib/managers/timeline-manager/types';
  import { removeSearchResults, selectAllSearchResults, updateSearchResults } from '$lib/utils/search-result-selection';
  import { Route } from '$lib/route';
  import { getAssetBulkActions } from '$lib/services/asset.service';
  import { lang } from '$lib/stores/preferences.store';
  import { getAssetMediaUrl, memoryLaneTitle } from '$lib/utils';
  import {
    buildSearchablePageUrl,
    getSearchablePageFilterState,
    getSearchablePageState,
    preserveTransientTemporalFilters,
    type SearchablePageTransientTemporalState,
  } from '$lib/utils/searchable-page-search';
  import { consumeTypedSearchNamesInto } from '$lib/utils/typed-search/typed-search-name-cache';
  import {
    updateStackedAssetInTimeline,
    updateUnstackedAssetInTimeline,
    type OnLink,
    type OnUnlink,
  } from '$lib/utils/actions';
  import { openFileUploadDialog } from '$lib/utils/file-uploader';
  import {
    buildPhotosTimelineOptions,
    getPhotosPersonFilterThumbnailUrl,
    getPhotosPersonFilterId,
    handlePhotosRemoveFilter,
  } from '$lib/utils/photos-filter-options';
  import {
    buildSmartSearchFacetKey,
    buildSmartSearchFacetsParams,
    mapSmartSearchFacetsToFilterSuggestions,
  } from '$lib/utils/space-search';
  import { getAltText } from '$lib/utils/thumbnail-util';
  import {
    getTimelineBucketZoomTarget,
    type ActivatableTimelineBucket,
    getTimelineManagerTimeBuckets,
  } from '$lib/utils/timeline-zoom-navigation';
  import { getTimelineTopVisibleAnchor } from '$lib/managers/timeline-manager/timeline-anchor';
  import { toTimelineAsset } from '$lib/utils/timeline-util';
  import {
    type AssetResponseDto,
    AssetTypeEnum,
    AssetVisibility,
    getFilterSuggestions,
    getSearchSuggestions,
    searchSmartFacets,
    SearchSuggestionType,
    type SmartSearchFacetsResponseDto,
  } from '@immich/sdk';
  import { ActionButton, CommandPaletteDefaultProvider, ImageCarousel, modalManager } from '@immich/ui';
  import SearchAddAllToCollectionModal from '$lib/modals/SearchAddAllToCollectionModal.svelte';
  import { filterStateToSearchTerms } from '$lib/utils/filter-search-terms';
  import type { SearchTerms } from '$lib/services/search.service';
  import { mdiDotsVertical } from '@mdi/js';
  import { DateTime } from 'luxon';
  import { untrack } from 'svelte';
  import { t } from 'svelte-i18n';
  import { SvelteMap } from 'svelte/reactivity';

  let timelineManager = $state<TimelineManager>() as TimelineManager;

  // Filter state
  const initialSearchState = getSearchablePageState(page.url);
  const initialFilterState = getSearchablePageFilterState(page.url);
  let filters = $state<FilterState>({
    ...createFilterState(),
    dateAfter: undefined,
    dateBefore: undefined,
    selectedYear: undefined,
    selectedMonth: undefined,
    ...initialFilterState,
    sortOrder: initialSearchState.sortOrder,
  });
  let filtersBeforePanelChange: FilterState = {
    ...createFilterState(),
    dateAfter: undefined,
    dateBefore: undefined,
    selectedYear: undefined,
    selectedMonth: undefined,
    ...initialFilterState,
    sortOrder: initialSearchState.sortOrder,
  };
  let timelineGrouping = $state<TimelineGrouping>('day');
  let temporalAnchor = $state<TimelineTemporalAnchor | undefined>();
  let committedQuery = $state(initialSearchState.query);
  let lastHandledSearchState = $state(`${initialSearchState.query}:${initialSearchState.sortOrder}:${page.url.search}`);
  let pendingFilterUrlSync = $state<
    { url: string; transientTemporal?: SearchablePageTransientTemporalState } | undefined
  >();
  let isLoading = $state(false);
  const showSearchResults = $derived(committedQuery.trim().length > 0);
  // Loaded smart search results. The timeline (and its TimelineManager) is unmounted while
  // these are showing, so the multi-select toolbar acts on this array instead (#908).
  let searchResults = $state<AssetResponseDto[]>([]);
  // Bumped to force a re-run of the search (undo-delete restores the removed assets).
  let searchReloadToken = $state(0);
  const options = $derived({
    ...buildPhotosTimelineOptions(filters),
    grouping: timelineGrouping,
  });
  $effect(() => {
    filtersBeforePanelChange = filters;
  });
  let personNames = new SvelteMap<string, string>();
  let tagNames = new SvelteMap<string, string>();
  consumeTypedSearchNamesInto(page.url.pathname + page.url.search, personNames, tagNames);
  $effect(() => globalSearchManager.registerSearchablePageFilters(() => filters));
  let smartFacets = $state<SmartSearchFacetsResponseDto>();
  let smartFacetKey = $state('');
  let smartFacetInFlight:
    | {
        key: string;
        controller: AbortController;
        promise: Promise<SmartSearchFacetsResponseDto | undefined>;
      }
    | undefined;

  const timelineBuckets = $derived(getTimelineManagerTimeBuckets(timelineManager));
  const smartFacetBuckets = $derived(showSearchResults ? (smartFacets?.timeBuckets ?? []) : timelineBuckets);
  const smartFacetTotal = $derived(showSearchResults ? smartFacets?.total : undefined);

  const emptyFilterSuggestions = () => ({
    countries: [],
    cities: [],
    cameraMakes: [],
    cameraModels: [],
    tags: [],
    people: [],
    ratings: [],
    mediaTypes: [],
    hasUnnamedPeople: false,
  });

  const loadPhotoFilterSuggestions = async (nextFilters: FilterState) => {
    const context = buildFilterContext(nextFilters);
    const response = await getFilterSuggestions({
      personIds: nextFilters.personIds.length > 0 ? nextFilters.personIds : undefined,
      country: nextFilters.country,
      city: nextFilters.city,
      make: nextFilters.make,
      model: nextFilters.model,
      tagIds: nextFilters.tagIds.length > 0 ? nextFilters.tagIds : undefined,
      rating: nextFilters.rating,
      mediaType:
        nextFilters.mediaType === 'all'
          ? undefined
          : nextFilters.mediaType === 'image'
            ? AssetTypeEnum.Image
            : AssetTypeEnum.Video,
      isFavorite: nextFilters.isFavorite,
      isNotInAlbum: nextFilters.isNotInAlbum === true ? true : undefined,
      isInAlbum: nextFilters.isInAlbum === true ? true : undefined,
      takenAfter: context?.takenAfter,
      takenBefore: context?.takenBefore,
      ...(nextFilters.isFavorite === undefined && { withSharedSpaces: true }),
    });
    const mappedPeople = response.people.map((p) => ({
      id: getPhotosPersonFilterId(p),
      name: p.name,
      thumbnailUrl: getPhotosPersonFilterThumbnailUrl(p),
    }));
    for (const p of response.people) {
      personNames.set(getPhotosPersonFilterId(p), p.name);
    }
    for (const t of response.tags) {
      tagNames.set(t.id, t.value);
    }
    return {
      countries: response.countries,
      cameraMakes: response.cameraMakes,
      tags: response.tags.map((t) => ({ id: t.id, name: t.value })),
      people: mappedPeople,
      ratings: response.ratings,
      mediaTypes: response.mediaTypes,
      hasUnnamedPeople: response.hasUnnamedPeople,
    };
  };

  async function loadPhotoSmartFacets(nextFilters: FilterState): Promise<SmartSearchFacetsResponseDto | undefined> {
    const query = committedQuery.trim();
    if (!query) {
      return undefined;
    }

    const withSharedSpaces = nextFilters.isFavorite === undefined;
    const key = buildSmartSearchFacetKey({ query, filters: nextFilters, withSharedSpaces, language: $lang });
    if (smartFacets && smartFacetKey === key) {
      return smartFacets;
    }
    if (smartFacetInFlight?.key === key) {
      return smartFacetInFlight.promise;
    }

    smartFacetInFlight?.controller.abort();
    const controller = new AbortController();

    const promise = searchSmartFacets(
      {
        smartSearchFacetsDto: buildSmartSearchFacetsParams({
          query,
          filters: nextFilters,
          withSharedSpaces,
          language: $lang,
        }),
      },
      { signal: controller.signal },
    )
      .then((result) => {
        if (smartFacetInFlight?.key === key && !controller.signal.aborted) {
          smartFacets = result;
          smartFacetKey = key;
        }
        return result;
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          console.error('Failed to fetch smart search facets:', error);
        }
        return smartFacets;
      })
      .finally(() => {
        if (smartFacetInFlight?.key === key) {
          smartFacetInFlight = undefined;
        }
      });

    smartFacetInFlight = { key, controller, promise };
    return promise;
  }

  const normalProviders: NonNullable<FilterPanelConfig['providers']> = {
    cities: (country, context) =>
      getSearchSuggestions({
        $type: SearchSuggestionType.City,
        country,
        ...context,
        ...(context?.isFavorite === undefined && { withSharedSpaces: true }),
      }),
    cameraModels: (make, context) =>
      getSearchSuggestions({
        $type: SearchSuggestionType.CameraModel,
        make,
        ...context,
        ...(context?.isFavorite === undefined && { withSharedSpaces: true }),
      }),
  };

  const filterConfig: FilterPanelConfig = {
    sections: [...ALL_FILTER_SECTIONS],
    suggestionsProvider: async (nextFilters: FilterState) => {
      if (!showSearchResults) {
        return loadPhotoFilterSuggestions(nextFilters);
      }

      const facets = await loadPhotoSmartFacets(nextFilters);
      if (!facets) {
        return emptyFilterSuggestions();
      }

      for (const p of facets.people) {
        personNames.set(getPhotosPersonFilterId(p), p.name);
      }
      for (const t of facets.tags) {
        tagNames.set(t.id, t.value);
      }
      return mapSmartSearchFacetsToFilterSuggestions(facets);
    },
    providers: {
      ...normalProviders,
      cities: async (country, context) => {
        if (!showSearchResults) {
          return normalProviders.cities?.(country, context) ?? [];
        }
        const query = committedQuery.trim();
        if (!query) {
          return [];
        }
        const facets = await searchSmartFacets({
          smartSearchFacetsDto: buildSmartSearchFacetsParams({
            query,
            filters: { ...filters, country },
            withSharedSpaces: filters.isFavorite === undefined,
            language: $lang,
          }),
        });
        return facets.cities;
      },
      cameraModels: async (make, context) => {
        if (!showSearchResults) {
          return normalProviders.cameraModels?.(make, context) ?? [];
        }
        const query = committedQuery.trim();
        if (!query) {
          return [];
        }
        const facets = await searchSmartFacets({
          smartSearchFacetsDto: buildSmartSearchFacetsParams({
            query,
            filters: { ...filters, make },
            withSharedSpaces: filters.isFavorite === undefined,
            language: $lang,
          }),
        });
        return facets.cameraModels;
      },
    },
  };

  const hasActiveFilters = $derived(getActiveFilterCount(filters) > 0 || showSearchResults);

  // Filter-panel collapse is driven here so a header filter button can reclaim the panel's space.
  let filterCollapsed = $state(loadFilterCollapsed());
  const totalAssetCount = $derived(timelineManager?.assetCount ?? 0);

  const handleAddAllToCollection = () => {
    const query = committedQuery.trim();
    // Replay the active filters (and free-text query, if any) against search so the collector can
    // page every matching id. Non-query mode mirrors buildPhotosTimelineOptions' partner/shared-space
    // scoping so the collected set matches the timeline.
    const terms: SearchTerms = { ...filterStateToSearchTerms(filters), visibility: AssetVisibility.Timeline };
    if (query) {
      terms.query = query;
    } else if (filters.isFavorite === undefined) {
      terms.withSharedSpaces = true;
    }
    void modalManager.show(SearchAddAllToCollectionModal, {
      terms,
      total: showSearchResults ? (smartFacetTotal ?? 0) : totalAssetCount,
      smartSearchEnabled: !!query,
      language: $lang,
    });
  };
  // Use the timeline's *loaded* result (for the current options) rather than a bare
  // `assetCount === 0`: clearing a filter that had 0 results would otherwise flip this true
  // for a tick (stale count, reload pending), unmounting the filter panel and dropping focus.
  const isTimelineEmpty = $derived(!!timelineManager?.isEmptyForOptions(options) && !hasActiveFilters);

  let selectedAssets = $derived(assetMultiSelectManager.assets);
  let isAssetStackSelected = $derived(selectedAssets.length === 1 && !!selectedAssets[0].stack);
  let isLinkActionAvailable = $derived.by(() => {
    const isLivePhoto = selectedAssets.length === 1 && !!selectedAssets[0].livePhotoVideoId;
    const isLivePhotoCandidate =
      selectedAssets.length === 2 &&
      selectedAssets.some((asset) => asset.isImage) &&
      selectedAssets.some((asset) => asset.isVideo);

    return assetMultiSelectManager.isAllUserOwned && (isLivePhoto || isLivePhotoCandidate);
  });

  const handleEscape = () => {
    if (assetViewerManager.isViewing) {
      return;
    }
    if (assetMultiSelectManager.selectionActive) {
      assetMultiSelectManager.clear();
      return;
    }
  };

  const handleLink: OnLink = ({ still, motion }) => {
    timelineManager.removeAssets([motion.id]);
    timelineManager.upsertAssets([still]);
  };

  const handleUnlink: OnUnlink = ({ still, motion }) => {
    timelineManager.upsertAssets([motion]);
    timelineManager.upsertAssets([still]);
  };

  const handleSetVisibility = (assetIds: string[]) => {
    if (showSearchResults) {
      removeSearchResults(searchResults, assetIds);
    } else {
      timelineManager.removeAssets(assetIds);
    }
    assetMultiSelectManager.clear();
  };

  // While search results are showing, the timeline is unmounted — bulk actions have to mutate
  // the result list instead of the TimelineManager (#908).
  const handleFavorite = (ids: string[], isFavorite: boolean) => {
    if (showSearchResults) {
      updateSearchResults(searchResults, ids, (asset) => (asset.isFavorite = isFavorite));
      return;
    }
    timelineManager.update(ids, (asset) => (asset.isFavorite = isFavorite));
  };

  const handleArchive = (ids: string[], visibility: AssetVisibility) => {
    if (showSearchResults) {
      updateSearchResults(searchResults, ids, (asset) => (asset.visibility = visibility));
      return;
    }
    timelineManager.update(ids, (asset) => (asset.visibility = visibility));
  };

  const handleAssetDelete = (assetIds: string[]) => {
    if (showSearchResults) {
      removeSearchResults(searchResults, assetIds);
      return;
    }
    timelineManager.removeAssets(assetIds);
  };

  const handleUndoDelete = (assets: TimelineAsset[]) => {
    if (showSearchResults) {
      // Undo hands back TimelineAssets; the results list holds full AssetResponseDtos, so
      // re-running the search is how they come back.
      searchReloadToken++;
      return;
    }
    timelineManager.upsertAssets(assets);
  };

  registerSelectionContext({
    getAssets: () => assetMultiSelectManager.assets,
    clearSelection: () => assetMultiSelectManager.clear(),
    canAddToAlbum: () => true,
    canAddToSpace: () => true,
    getOnFavorite: () => (showSearchResults || timelineManager ? handleFavorite : undefined),
    getOnArchive: () => (showSearchResults || timelineManager ? handleArchive : undefined),
    getOnDelete: () => (showSearchResults || timelineManager ? handleAssetDelete : undefined),
    getOnUndoDelete: () => (showSearchResults || timelineManager ? handleUndoDelete : undefined),
  });

  function clearSearch() {
    isLoading = false;
    const nextUrl = buildSearchablePageUrl(page.url, '', filters.sortOrder, filters);
    if (!nextUrl) {
      return;
    }
    void goto(nextUrl, { replaceState: true, keepFocus: true, noScroll: true });
  }

  function syncFilterUrl(nextFilters: FilterState) {
    const currentSearchState = getSearchablePageState(page.url);
    const sortOrder =
      !committedQuery.trim() && nextFilters.sortOrder === 'desc' && !currentSearchState.hasExplicitSort
        ? 'relevance'
        : nextFilters.sortOrder;
    const nextUrl = buildSearchablePageUrl(page.url, committedQuery, sortOrder, nextFilters);
    if (!nextUrl || nextUrl === page.url.pathname + page.url.search) {
      return;
    }
    pendingFilterUrlSync = {
      url: nextUrl,
      transientTemporal: {
        selectedYear: nextFilters.selectedYear,
        selectedMonth: nextFilters.selectedMonth,
      },
    };
    void goto(nextUrl, { replaceState: true, keepFocus: true, noScroll: true });
  }

  function handleFiltersChange(nextFilters: FilterState) {
    const temporalChanged =
      nextFilters.dateAfter !== filtersBeforePanelChange.dateAfter ||
      nextFilters.dateBefore !== filtersBeforePanelChange.dateBefore ||
      nextFilters.selectedYear !== filtersBeforePanelChange.selectedYear ||
      nextFilters.selectedMonth !== filtersBeforePanelChange.selectedMonth;

    if (temporalChanged) {
      temporalAnchor = undefined;
    }

    syncFilterUrl(nextFilters);
  }

  function handleTimelineBucketActivate(bucket: ActivatableTimelineBucket) {
    if (assetMultiSelectManager.selectionActive) {
      return;
    }

    const result = getTimelineBucketZoomTarget(bucket);
    if (!result) {
      return;
    }

    timelineGrouping = result.grouping;
    temporalAnchor = result.anchor;
  }

  function handleTimelineGroupingChange(grouping: TimelineGrouping) {
    const anchor = getTimelineTopVisibleAnchor(timelineManager);
    timelineGrouping = grouping;
    temporalAnchor = anchor;
  }

  function handleRemoveActiveFilter(type: string, id?: string) {
    const nextFilters = handlePhotosRemoveFilter(filters, type, id);
    if (type === 'timeline') {
      temporalAnchor = undefined;
    }
    filters = nextFilters;
    syncFilterUrl(nextFilters);
  }

  function handleClearAllFilters() {
    const nextFilters = clearFilters(filters);
    temporalAnchor = undefined;
    filters = nextFilters;
    if (!committedQuery.trim()) {
      syncFilterUrl(nextFilters);
    }
  }

  $effect(() => {
    const nextSearchState = getSearchablePageState(page.url);
    const nextToken = `${nextSearchState.query}:${nextSearchState.sortOrder}:${page.url.search}`;
    const currentUrl = page.url.pathname + page.url.search;

    if (nextToken === lastHandledSearchState) {
      return;
    }

    const queryChanged = nextSearchState.query !== committedQuery;
    untrack(() => {
      const filterState = getSearchablePageFilterState(page.url);
      const transientTemporal =
        pendingFilterUrlSync?.url === currentUrl ? pendingFilterUrlSync.transientTemporal : undefined;
      committedQuery = nextSearchState.query;
      isLoading = false;
      filters = {
        ...createFilterState(),
        ...preserveTransientTemporalFilters(filterState, transientTemporal),
        sortOrder: nextSearchState.sortOrder,
      };
      if (pendingFilterUrlSync?.url === currentUrl) {
        pendingFilterUrlSync = undefined;
      }
      consumeTypedSearchNamesInto(page.url.pathname + page.url.search, personNames, tagNames);
      if (queryChanged) {
        smartFacetInFlight?.controller.abort();
        smartFacets = undefined;
        smartFacetKey = '';
        smartFacetInFlight = undefined;
      }
      lastHandledSearchState = nextToken;
    });
  });

  const items = $derived(
    memoryManager.memories.map((memory) => ({
      id: memory.id,
      title: $memoryLaneTitle(memory),
      href: Route.viewMemory({ id: memory.id, assetId: memory.assets[0].id }),
      alt: $t('memory_lane_title', { values: { title: $getAltText(toTimelineAsset(memory.assets[0])) } }),
      src: getAssetMediaUrl({ id: memory.assets[0].id }),
    })),
  );

  memoryManager.setFilters({ $for: DateTime.now().toISODate() });
</script>

<UserPageLayout hideNavbar={assetMultiSelectManager.selectionActive} scrollbar={false}>
  <div class="flex h-full">
    {#key showSearchResults ? `photos-search-${committedQuery.trim()}:${$lang}` : 'photos-browse'}
      <FilterPanel
        bind:filters
        bind:collapsed={filterCollapsed}
        externalToggle
        config={filterConfig}
        timeBuckets={smartFacetBuckets}
        storageKey="gallery-filter-visible-sections-photos"
        hidden={isTimelineEmpty}
        {personNames}
        {tagNames}
        onFiltersChange={handleFiltersChange}
      />
    {/key}
    <div class="flex flex-1 flex-col overflow-hidden pl-2">
      {#snippet photoFiltersBar()}
        <ActiveFiltersBar
          embedded
          {filters}
          searchQuery={committedQuery}
          onClearSearch={clearSearch}
          resultCount={showSearchResults ? smartFacetTotal : totalAssetCount}
          {personNames}
          {tagNames}
          onRemoveFilter={handleRemoveActiveFilter}
          onClearAll={handleClearAllFilters}
          onAddAllToCollection={handleAddAllToCollection}
        />
      {/snippet}
      <FilterToolbar
        class="mb-2"
        grouping={timelineGrouping}
        onGroupingChange={handleTimelineGroupingChange}
        showGrouping={!showSearchResults && !assetMultiSelectManager.selectionActive}
        showFilters={hasActiveFilters}
        filters={photoFiltersBar}
        showFilterButton={filterCollapsed && !isTimelineEmpty && !assetMultiSelectManager.selectionActive}
        filterActive={getActiveFilterCount(filters) > 0}
        onExpandFilters={() => (filterCollapsed = false)}
      />
      {#if showSearchResults}
        <SmartSearchResults
          bind:isLoading
          bind:results={searchResults}
          reloadToken={searchReloadToken}
          searchQuery={committedQuery}
          {filters}
          language={$lang}
          isShared={false}
          withSharedSpaces={filters.isFavorite === undefined}
          total={smartFacetTotal}
        />
      {:else}
        <Timeline
          enableRouting={true}
          bind:timelineManager
          {options}
          assetInteraction={assetMultiSelectManager}
          removeAction={AssetAction.ARCHIVE}
          onEscape={handleEscape}
          onTimelineBucketActivate={handleTimelineBucketActivate}
          {temporalAnchor}
          onTemporalAnchorResolved={() => (temporalAnchor = undefined)}
          grouping={timelineGrouping}
          onGroupingChange={handleTimelineGroupingChange}
          withStacked
        >
          {#if authManager.preferences.memories.enabled && !hasActiveFilters}
            <!-- In month/year grouping the timeline renders large representative cards; add breathing
                 room below the memories strip so those cards don't hug it. The wrapper's height feeds
                 the timeline's measured topSectionHeight, so this shifts the cards down cleanly. -->
            <div class={{ 'pb-8': timelineGrouping !== 'day' }}>
              <!-- ImageCarousel carries its own mt-3, from when the strip was the first thing in the
                   timeline and needed to stand off the top. The route grouping bar sits above it now
                   and already ends in 8px of padding and an 8px margin, so the strip's own margin was
                   a third helping - 28px between the Years/Months/All pill and the strip, against the
                   16px the timeline gets when memories are off. `class` reaches the section through
                   twMerge, so mt-0 replaces it rather than fighting it. -->
              <ImageCarousel {items} class="mt-0" />
            </div>
          {/if}
          {#snippet empty()}
            <EmptyPlaceholder
              text={$t('no_assets_message')}
              onClick={() => openFileUploadDialog()}
              class="mx-auto mt-10"
            />
          {/snippet}
        </Timeline>
      {/if}
    </div>
  </div>
</UserPageLayout>

{#if assetMultiSelectManager.selectionActive}
  <AssetSelectControlBar>
    {@const Actions = getAssetBulkActions($t)}
    <CommandPaletteDefaultProvider name={$t('assets')} actions={Object.values(Actions)} />

    <CreateSharedLink />
    {#if showSearchResults}
      <SelectAllAssets
        assetInteraction={assetMultiSelectManager}
        onSelectAll={() => selectAllSearchResults(searchResults, assetMultiSelectManager)}
      />
    {:else}
      <SelectAllAssets {timelineManager} assetInteraction={assetMultiSelectManager} />
    {/if}
    <ActionButton action={Actions.AddToAlbum} />

    {#if assetMultiSelectManager.isAllUserOwned}
      <FavoriteAction removeFavorite={assetMultiSelectManager.isAllFavorite} onFavorite={handleFavorite} />

      <ButtonContextMenu icon={mdiDotsVertical} title={$t('menu')}>
        <DownloadAction menuItem />
        {#if !showSearchResults && (assetMultiSelectManager.assets.length > 1 || isAssetStackSelected)}
          <StackAction
            unstack={isAssetStackSelected}
            onStack={(result) => updateStackedAssetInTimeline(timelineManager, result)}
            onUnstack={(assets) => updateUnstackedAssetInTimeline(timelineManager, assets)}
          />
        {/if}
        {#if !showSearchResults && isLinkActionAvailable}
          <LinkLivePhotoAction
            menuItem
            unlink={assetMultiSelectManager.assets.length === 1}
            onLink={handleLink}
            onUnlink={handleUnlink}
          />
        {/if}
        <RotateAction />
        <ChangeDate menuItem />
        <ChangeDescription menuItem />
        <ChangeLocation menuItem />
        <ArchiveAction menuItem onArchive={handleArchive} />
        {#if authManager.preferences.tags.enabled}
          <TagAction menuItem />
        {/if}
        <DeleteAssets menuItem onAssetDelete={handleAssetDelete} onUndoDelete={handleUndoDelete} />
        <SetVisibilityAction menuItem onVisibilitySet={handleSetVisibility} />
        <hr />
        <ActionMenuItem action={Actions.RegenerateThumbnailJob} />
        <ActionMenuItem action={Actions.RefreshMetadataJob} />
        <ActionMenuItem action={Actions.TranscodeVideoJob} />
      </ButtonContextMenu>
    {:else}
      <DownloadAction />
    {/if}
  </AssetSelectControlBar>
{/if}
