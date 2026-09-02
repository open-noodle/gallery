<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  import FilterPanel from '$lib/components/filter-panel/filter-panel.svelte';
  import ActiveFiltersBar from '$lib/components/filter-panel/active-filters-bar.svelte';
  import FilterToolbar from '$lib/components/filter-panel/filter-toolbar.svelte';
  import {
    ALL_FILTER_SECTIONS,
    buildFilterContext,
    createFilterState,
    clearFilters,
    getActiveFilterCount,
    loadFilterCollapsed,
    type FilterPanelConfig,
    type FilterState,
  } from '$lib/components/filter-panel/filter-panel';
  import OnEvents from '$lib/components/OnEvents.svelte';
  import SmartSearchResults from '$lib/components/search/smart-search-results.svelte';
  import ControlAppBar from '$lib/components/shared-components/ControlAppBar.svelte';
  import SpaceNewAssetsDivider from '$lib/components/spaces/space-new-assets-divider.svelte';
  import SpaceOnboardingBanner from '$lib/components/spaces/space-onboarding-banner.svelte';
  import SpaceAssetLimitWarning from '$lib/components/spaces/space-asset-limit-warning.svelte';
  import SelectionToolbar from '$lib/components/timeline/SelectionToolbar.svelte';
  import Timeline from '$lib/components/timeline/Timeline.svelte';
  import { TimelineManager } from '$lib/managers/timeline-manager/timeline-manager.svelte';
  import type { TimelineAsset, TimelineGrouping, TimelineTemporalAnchor } from '$lib/managers/timeline-manager/types';
  import { removeSearchResults, selectAllSearchResults, updateSearchResults } from '$lib/utils/search-result-selection';
  import { registerSelectionContext, registerSpaceContext } from '$lib/managers/command-context-manager.svelte';
  import { eventManager } from '$lib/managers/event-manager.svelte';
  import { globalSearchManager } from '$lib/managers/global-search-manager.svelte';
  import { spaceUiManager } from '$lib/managers/space-ui-manager.svelte';
  import { Route } from '$lib/route';
  import { MAX_SPACE_ASSETS_PER_REQUEST } from '$lib/constants';
  import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { lang } from '$lib/stores/preferences.store';
  import { createUrl } from '$lib/utils';
  import { handleError } from '$lib/utils/handle-error';
  import {
    buildSearchablePageUrl,
    getSearchablePageFilterState,
    getSearchablePageState,
  } from '$lib/utils/searchable-page-search';
  import { consumeTypedSearchNamesInto } from '$lib/utils/typed-search/typed-search-name-cache';
  import {
    buildSmartSearchFacetKey,
    buildSmartSearchFacetsParams,
    mapSmartSearchFacetsToFilterSuggestions,
  } from '$lib/utils/space-search';
  import { buildSpaceTimelineOptions, handleSpaceRemoveFilter } from '$lib/utils/space-filter-options';
  import SearchAddAllToCollectionModal from '$lib/modals/SearchAddAllToCollectionModal.svelte';
  import type { SearchTerms } from '$lib/services/search.service';
  import { resolveFilterNames } from '$lib/utils/filter-name-resolution';
  import { filterStateToSearchTerms } from '$lib/utils/filter-search-terms';
  import {
    type ActivatableTimelineBucket,
    getTimelineBucketZoomTarget,
    getTimelineManagerTimeBuckets,
  } from '$lib/utils/timeline-zoom-navigation';
  import { getTimelineTopVisibleAnchor } from '$lib/managers/timeline-manager/timeline-anchor';
  import {
    addAssets,
    type AssetResponseDto,
    AssetTypeEnum,
    AssetVisibility,
    getFilterSuggestions,
    getSearchSuggestions,
    getSpace,
    markSpaceViewed,
    searchSmartFacets,
    SharedSpaceRole,
    SearchSuggestionType,
    updateSpace,
    UserAvatarColor,
    type SharedSpaceMemberResponseDto,
    type SharedSpaceResponseDto,
    type SmartSearchFacetsResponseDto,
  } from '@immich/sdk';
  import { IconButton, modalManager, toastManager } from '@immich/ui';
  import { mdiImageOutline, mdiPlus } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import { untrack } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import type { PageData } from './$types';

  type ViewMode = 'view' | 'select-assets' | 'select-cover';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();
  let space: SharedSpaceResponseDto = $state(data.space);
  let members: SharedSpaceMemberResponseDto[] = $state(data.members);

  const initialSearchState = getSearchablePageState(page.url);

  // Sync when navigating between spaces (component persists, data updates)
  $effect(() => {
    if (data.space.id === space.id) {
      return;
    }

    const nextSearchState = getSearchablePageState(page.url);
    const nextFilterState = getSearchablePageFilterState(page.url);
    space = data.space;
    members = data.members;
    filters = {
      ...createFilterState(),
      ...nextFilterState,
      sortOrder: nextSearchState.sortOrder,
    };
    personNames.clear();
    tagNames.clear();
    albumNames.clear();
    ownerNames.clear();
    consumeTypedSearchNamesInto(page.url.pathname + page.url.search, personNames, tagNames);
    isLoading = false;
    smartFacetInFlight?.controller.abort();
    smartFacets = undefined;
    smartFacetKey = '';
    smartFacetInFlight = undefined;
    committedSearchQuery = nextSearchState.query;
    lastHandledSearchState = `${nextSearchState.query}:${nextSearchState.sortOrder}:${page.url.search}`;
    timelineGrouping = 'day';
    temporalAnchor = undefined;
    viewMode = 'view';
    assetMultiSelectManager.clear();
  });

  let viewMode = $state<ViewMode>('view');

  let initializedSpaceId = $state('');

  let timelineManager = $state<TimelineManager>() as TimelineManager;

  // Filter state
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
  let personNames = new SvelteMap<string, string>();
  let tagNames = new SvelteMap<string, string>();
  let albumNames = new SvelteMap<string, string>();
  let ownerNames = new SvelteMap<string, string>();
  consumeTypedSearchNamesInto(page.url.pathname + page.url.search, personNames, tagNames);
  // An owner chip inside a Space is always a member, and the members are already in scope — seed
  // the map from them so resolveFilterNames never issues a request for it. Only an `albumId` chip
  // (no local source) falls through to a by-id fetch.
  $effect(() => {
    for (const member of members) {
      ownerNames.set(member.userId, member.name);
    }
    void resolveFilterNames(filters, { albumNames, ownerNames });
  });
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

  const loadSpaceFilterSuggestions = async (nextFilters: FilterState) => {
    const context = buildFilterContext(nextFilters);
    const response = await getFilterSuggestions({
      personIds: nextFilters.personIds.length > 0 ? nextFilters.personIds : undefined,
      country: nextFilters.country,
      state: nextFilters.state,
      city: nextFilters.city,
      make: nextFilters.make,
      model: nextFilters.model,
      lensModel: nextFilters.lensModel,
      ownerId: nextFilters.ownerId,
      tagIds: nextFilters.tagIds.length > 0 ? nextFilters.tagIds : undefined,
      rating: nextFilters.rating,
      mediaType:
        nextFilters.mediaType === 'all'
          ? undefined
          : nextFilters.mediaType === 'image'
            ? AssetTypeEnum.Image
            : AssetTypeEnum.Video,
      isFavorite: nextFilters.isFavorite,
      isInAlbum: nextFilters.isInAlbum === true ? true : undefined,
      isNotInAlbum: nextFilters.isNotInAlbum === true ? true : undefined,
      takenAfter: context?.takenAfter,
      takenBefore: context?.takenBefore,
      spaceId: space.id,
    });
    const mappedPeople = response.people.map((p) => ({
      id: p.id,
      name: p.name,
      thumbnailUrl: createUrl(`/shared-spaces/${space.id}/people/${p.id}/thumbnail`),
    }));
    for (const p of response.people) {
      personNames.set(p.id, p.name);
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
      hasFavorites: response.hasFavorites,
      hasAssetsInAlbum: response.hasAssetsInAlbum,
      hasAssetsNotInAlbum: response.hasAssetsNotInAlbum,
    };
  };

  async function loadSpaceSmartFacets(nextFilters: FilterState): Promise<SmartSearchFacetsResponseDto | undefined> {
    const query = committedSearchQuery.trim();
    if (!query) {
      return undefined;
    }

    const key = buildSmartSearchFacetKey({ query, filters: nextFilters, spaceId: space.id, language: $lang });
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
          spaceId: space.id,
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
        spaceId: space.id,
        ...context,
      }),
    cameraModels: (make, context) =>
      getSearchSuggestions({
        $type: SearchSuggestionType.CameraModel,
        make,
        spaceId: space.id,
        ...context,
      }),
  };

  const filterConfig: FilterPanelConfig = {
    sections: [...ALL_FILTER_SECTIONS],
    suggestionsProvider: async (nextFilters: FilterState) => {
      if (!showSearchResults) {
        return loadSpaceFilterSuggestions(nextFilters);
      }

      const facets = await loadSpaceSmartFacets(nextFilters);
      if (!facets) {
        // #910: never resolve with a fabricated empty response — the panel cannot tell it apart from a
        // genuinely empty library and would hide every section. Rejecting lets the panel keep the last
        // good facets.
        throw new Error('smart-search facets unavailable');
      }

      for (const p of facets.people) {
        personNames.set(p.id, p.name);
      }
      for (const t of facets.tags) {
        tagNames.set(t.id, t.value);
      }
      return mapSmartSearchFacetsToFilterSuggestions(facets, { spaceId: space.id });
    },
    // #910: no baseline in query mode. A second concurrent facet request would abort the in-flight
    // one (single `smartFacetInFlight` slot) and then clobber `smartFacets`, which feeds the
    // timeline and the result count. `undefined` means "don't hide anything here" — see spec §4.5.
    baselineProvider: async () => (showSearchResults ? undefined : loadSpaceFilterSuggestions(createFilterState())),
    providers: {
      ...normalProviders,
      cities: async (country, context) => {
        if (!showSearchResults) {
          return normalProviders.cities?.(country, context) ?? [];
        }
        const query = committedSearchQuery.trim();
        if (!query) {
          return [];
        }
        const facets = await searchSmartFacets({
          smartSearchFacetsDto: buildSmartSearchFacetsParams({
            query,
            filters: { ...filters, country },
            spaceId: space.id,
            language: $lang,
          }),
        });
        return facets.cities;
      },
      cameraModels: async (make, context) => {
        if (!showSearchResults) {
          return normalProviders.cameraModels?.(make, context) ?? [];
        }
        const query = committedSearchQuery.trim();
        if (!query) {
          return [];
        }
        const facets = await searchSmartFacets({
          smartSearchFacetsDto: buildSmartSearchFacetsParams({
            query,
            filters: { ...filters, make },
            spaceId: space.id,
            language: $lang,
          }),
        });
        return facets.cameraModels;
      },
    },
  };

  function handleRemoveFilter(type: string, id?: string) {
    const nextFilters = handleSpaceRemoveFilter(filters, type, id);
    if (type === 'timeline') {
      temporalAnchor = undefined;
    }
    filters = nextFilters;
    syncFilterUrl(nextFilters);
  }

  const currentMember = $derived(members.find((m) => m.userId === authManager.user.id));
  const isOwner = $derived(currentMember?.role === SharedSpaceRole.Owner);
  const isEditor = $derived(
    currentMember?.role === SharedSpaceRole.Owner || currentMember?.role === SharedSpaceRole.Editor,
  );

  registerSpaceContext(
    () => space,
    () => members,
    {
      getAddPhotosToCurrentSpace: () =>
        viewMode === 'view' && isEditor && !assetMultiSelectManager.selectionActive
          ? () => {
              viewMode = 'select-assets';
            }
          : undefined,
    },
  );

  const totalAssetCount = $derived(timelineManager?.assetCount ?? 0);

  const handleAddAllToCollection = () => {
    const query = committedSearchQuery.trim();
    const terms: SearchTerms = { ...filterStateToSearchTerms(filters), spaceId: space.id };
    // Space timelines scope people via spacePersonIds, not personIds (see buildSpaceTimelineOptions).
    if (terms.personIds) {
      terms.spacePersonIds = terms.personIds;
      delete terms.personIds;
    }
    if (query) {
      terms.query = query;
    }
    void modalManager.show(SearchAddAllToCollectionModal, {
      terms,
      total: showSearchResults ? (smartFacetTotal ?? 0) : totalAssetCount,
      smartSearchEnabled: !!query,
      language: $lang,
    });
  };

  const options = $derived.by(() => {
    if (viewMode === 'select-assets') {
      return { visibility: AssetVisibility.Timeline, timelineSpaceId: space.id };
    }
    return {
      ...buildSpaceTimelineOptions(space.id, filters),
      grouping: timelineGrouping,
    };
  });
  $effect(() => {
    filtersBeforePanelChange = filters;
  });

  const isSelectionMode = $derived(viewMode === 'select-assets' || viewMode === 'select-cover');

  const refreshSpace = async () => {
    space = await getSpace({ id: space.id });
  };

  const handleEscape = () => {
    if (showSearchResults) {
      clearSearch();
      return;
    }
    if (viewMode === 'select-assets') {
      handleCloseSelectAssets();
      return;
    }
    if (viewMode === 'select-cover') {
      handleCloseSelectCover();
      return;
    }
    if (assetMultiSelectManager.selectionActive) {
      assetMultiSelectManager.clear();
      return;
    }
    void goto(Route.spaces());
  };

  const handleCloseSelectAssets = () => {
    assetMultiSelectManager.clear();
    viewMode = 'view';
  };

  const openSelectCover = () => {
    timelineGrouping = 'day';
    temporalAnchor = undefined;
    viewMode = 'select-cover';
  };

  const handleCloseSelectCover = () => {
    assetMultiSelectManager.clear();
    viewMode = 'view';
  };

  const handleSetCoverFromSelection = async () => {
    const assets = assetMultiSelectManager.assets;
    if (assets.length !== 1) {
      return;
    }
    try {
      await updateSpace({ id: space.id, sharedSpaceUpdateDto: { thumbnailAssetId: assets[0].id } });
      await invalidateAll();
      toastManager.success($t('space_cover_updated'));
      assetMultiSelectManager.clear();
      viewMode = 'view';
    } catch (error) {
      handleError(error, $t('errors.unable_to_update_space_cover'));
    }
  };

  let skipNextLocalSpaceAddEventForSpaceId: string | null = null;

  const applySpaceAddSuccess = async () => {
    await refreshSpace();
    // Also revalidate layout data so the shell's Photos tab count badge updates.
    await invalidateAll();
    assetMultiSelectManager.clear();
    viewMode = 'view';
  };

  const addSelectedAssetsToCurrentSpace = async () => {
    const assetIds = assetMultiSelectManager.assets.map((a) => a.id);
    if (assetIds.length === 0 || assetIds.length > MAX_SPACE_ASSETS_PER_REQUEST) {
      return false;
    }
    try {
      await addAssets({ id: space.id, sharedSpaceAssetAddDto: { assetIds } });
      skipNextLocalSpaceAddEventForSpaceId = space.id;
      eventManager.emit('SpaceAddAssets', { assetIds, spaceId: space.id });
      toastManager.success($t('added_to_space_count', { values: { count: assetIds.length } }));
      await applySpaceAddSuccess();
      return true;
    } catch (error) {
      handleError(error, $t('errors.error_adding_assets_to_space'));
      return false;
    } finally {
      skipNextLocalSpaceAddEventForSpaceId = null;
    }
  };

  const handleAddAssets = async () => {
    await addSelectedAssetsToCurrentSpace();
  };

  registerSelectionContext({
    getAssets: () => assetMultiSelectManager.assets,
    clearSelection: () => assetMultiSelectManager.clear(),
    canAddToAlbum: () => true,
    getOnFavorite: () => (viewMode === 'view' && (showSearchResults || timelineManager) ? handleFavorite : undefined),
    getOnArchive: () => (viewMode === 'view' && (showSearchResults || timelineManager) ? handleArchive : undefined),
    getAddSelectedToCurrentSpace: () =>
      viewMode === 'select-assets' && isEditor ? addSelectedAssetsToCurrentSpace : undefined,
  });

  const handleRemoveAssets = async (assetIds: string[]) => {
    if (showSearchResults) {
      removeSearchResults(searchResults, assetIds);
    } else {
      timelineManager.removeAssets(assetIds);
    }
    await refreshSpace();
    // Also revalidate layout data so the shell's Photos tab count badge updates.
    await invalidateAll();
  };

  // Mirrors the album page's `handleSetVisibility`: moving assets to/from the locked folder
  // takes them out of this (non-locked) timeline view. Unlike remove-from-space, this isn't a
  // space-membership change, so it doesn't touch the space's asset count.
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

  // DeleteAssets already performed the server-side trash before calling this — it's a
  // VIEW-UPDATE-only handler, mirroring the album page's `handleRemoveAssets` used for
  // `onAssetDelete`. Deletion is not a remove-from-space, so `handleRemoveAssets` above
  // (which also refreshes the space + revalidates layout data) is NOT reused here: the
  // websocket-driven `on_asset_trash` → `AssetsDelete` event already triggers `refreshSpace`
  // via the page's `<OnEvents onAssetsDelete={refreshSpace} />` (see below), so refreshing
  // again here would be redundant.
  const handleAssetDelete = (assetIds: string[]) => {
    if (showSearchResults) {
      removeSearchResults(searchResults, assetIds);
      return;
    }
    timelineManager.removeAssets(assetIds);
  };

  // Mirrors the album page's `handleUndoRemoveAssets`. There's no websocket event for restore,
  // so re-add the assets to the local view directly; no space-count refresh is needed since
  // undoing a delete doesn't change space membership either.
  const handleUndoAssetDelete = (assets: TimelineAsset[]) => {
    if (showSearchResults) {
      // Undo hands back TimelineAssets; the results list holds full AssetResponseDtos, so
      // re-running the search is how they come back.
      searchReloadToken++;
      return;
    }
    timelineManager.upsertAssets(assets);
  };

  const handleSetAsCover = async () => {
    const assets = assetMultiSelectManager.assets;
    if (assets.length !== 1) {
      return;
    }
    try {
      await updateSpace({ id: space.id, sharedSpaceUpdateDto: { thumbnailAssetId: assets[0].id } });
      await invalidateAll();
      toastManager.success($t('space_cover_updated'));
      assetMultiSelectManager.clear();
    } catch (error) {
      handleError(error, $t('errors.unable_to_update_space_cover'));
    }
  };

  const onSpaceAddAssets = async ({ spaceId }: { assetIds: string[]; spaceId: string }) => {
    if (spaceId !== space.id) {
      return;
    }
    if (skipNextLocalSpaceAddEventForSpaceId === spaceId) {
      return;
    }
    await applySpaceAddSuccess();
  };

  const onSpaceRemoveAssets = async ({ assetIds }: { assetIds: string[]; spaceId: string }) => {
    if (showSearchResults) {
      removeSearchResults(searchResults, assetIds);
    } else {
      timelineManager.removeAssets(assetIds);
    }
    await refreshSpace();
    // Also revalidate layout data so the shell's Photos tab count badge updates.
    await invalidateAll();
  };

  let committedSearchQuery = $state(initialSearchState.query);
  let lastHandledSearchState = $state(`${initialSearchState.query}:${initialSearchState.sortOrder}:${page.url.search}`);
  let isLoading = $state(false);
  const showSearchResults = $derived(committedSearchQuery.trim().length > 0);
  // Loaded smart search results. The timeline (and its TimelineManager) is unmounted while
  // these are showing, so the multi-select toolbar acts on this array instead (#908).
  let searchResults = $state<AssetResponseDto[]>([]);
  // Bumped to force a re-run of the search (undo-delete restores the removed assets).
  let searchReloadToken = $state(0);
  // `isEmptyForOptions` (not a bare `totalAssetCount === 0`) so clearing a filter that had 0
  // results can't flip this true for a tick while the timeline reloads — that transient would
  // unmount the filter panel and drop focus from a text input mid-typing.
  const isTimelineEmpty = $derived(
    !!timelineManager?.isEmptyForOptions(options) && getActiveFilterCount(filters) === 0 && !showSearchResults,
  );

  // Filter-panel collapse is driven here so a header filter button can reclaim the panel's space.
  let filterCollapsed = $state(loadFilterCollapsed());
  const isFilteredTimelineEmpty = $derived(
    timelineManager?.isInitialized && totalAssetCount === 0 && getActiveFilterCount(filters) > 0 && !showSearchResults,
  );
  const timelineBuckets = $derived(getTimelineManagerTimeBuckets(timelineManager));
  const smartFacetBuckets = $derived(showSearchResults ? (smartFacets?.timeBuckets ?? []) : timelineBuckets);
  const smartFacetTotal = $derived(showSearchResults ? smartFacets?.total : undefined);

  // Collapse the shell's cover once the reader scrolls past it. Both surfaces this tab can show —
  // the browse timeline and the search results grid — scroll independently, so both report here;
  // wiring only the timeline left the cover pinned open over search results, which on a phone is
  // most of the screen (#1028).
  const COVER_COLLAPSE_SCROLL_THRESHOLD = 64;
  const handleSurfaceScroll = (scrollTop: number) =>
    spaceUiManager.setCoverCollapsed(scrollTop > COVER_COLLAPSE_SCROLL_THRESHOLD);

  const clearSearch = () => {
    isLoading = false;
    const nextUrl = buildSearchablePageUrl(page.url, '', filters.sortOrder, filters);
    if (!nextUrl) {
      return;
    }
    void goto(nextUrl, {
      replaceState: true,
      keepFocus: true,
      noScroll: true,
    });
  };

  function syncFilterUrl(nextFilters: FilterState) {
    const currentSearchState = getSearchablePageState(page.url);
    const sortOrder =
      !committedSearchQuery.trim() && nextFilters.sortOrder === 'desc' && !currentSearchState.hasExplicitSort
        ? 'relevance'
        : nextFilters.sortOrder;
    const nextUrl = buildSearchablePageUrl(page.url, committedSearchQuery, sortOrder, nextFilters);
    if (!nextUrl || nextUrl === page.url.pathname + page.url.search) {
      return;
    }
    void goto(nextUrl, {
      replaceState: true,
      keepFocus: true,
      noScroll: true,
    });
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
    if (viewMode !== 'view' || assetMultiSelectManager.selectionActive) {
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

  function handleClearAllFilters() {
    const nextFilters = clearFilters(filters);
    temporalAnchor = undefined;
    filters = nextFilters;
    if (!committedSearchQuery.trim()) {
      syncFilterUrl(nextFilters);
    }
  }

  $effect(() => {
    const nextSearchState = getSearchablePageState(page.url);
    const nextToken = `${nextSearchState.query}:${nextSearchState.sortOrder}:${page.url.search}`;
    if (nextToken === lastHandledSearchState) {
      return;
    }

    const queryChanged = nextSearchState.query !== committedSearchQuery;
    untrack(() => {
      // Every filter — including the temporal picker's year/month — round-trips through the URL, so
      // rebuilding FilterState from the URL alone is lossless. Any URL change (back/forward, a
      // shared link, or the `?at=` write from closing the asset viewer) re-hydrates the same state.
      const filterState = getSearchablePageFilterState(page.url);
      committedSearchQuery = nextSearchState.query;
      isLoading = false;
      filters = {
        ...createFilterState(),
        ...filterState,
        sortOrder: nextSearchState.sortOrder,
      };
      consumeTypedSearchNamesInto(page.url.pathname + page.url.search, personNames, tagNames);
      if (queryChanged) {
        smartFacetInFlight?.controller.abort();
        smartFacets = undefined;
        smartFacetKey = '';
        smartFacetInFlight = undefined;
        // Committing or clearing the query swaps the timeline for the results grid and back, and
        // the incoming surface mounts at the top — so a collapse inherited from the outgoing one
        // would hide the cover with nothing scrolled under it.
        spaceUiManager.setCoverCollapsed(false);
      }
      lastHandledSearchState = nextToken;
    });
  });

  const gradientClasses: Record<string, string> = {
    [UserAvatarColor.Primary]: 'from-immich-primary/60 to-immich-primary',
    [UserAvatarColor.Pink]: 'from-pink-300 to-pink-500',
    [UserAvatarColor.Red]: 'from-red-400 to-red-600',
    [UserAvatarColor.Yellow]: 'from-yellow-300 to-yellow-500',
    [UserAvatarColor.Blue]: 'from-blue-400 to-blue-600',
    [UserAvatarColor.Green]: 'from-green-400 to-green-700',
    [UserAvatarColor.Purple]: 'from-purple-400 to-purple-700',
    [UserAvatarColor.Orange]: 'from-orange-400 to-orange-600',
    [UserAvatarColor.Gray]: 'from-gray-400 to-gray-600',
    [UserAvatarColor.Amber]: 'from-amber-400 to-amber-600',
  };

  const spaceGradient = $derived(gradientClasses[space.color ?? 'primary'] ?? gradientClasses[UserAvatarColor.Primary]);

  $effect(() => {
    if (!space?.id || space.id === initializedSpaceId) {
      return;
    }

    initializedSpaceId = space.id;
    void markSpaceViewed({ id: space.id });
  });

  // Consume add-photos / change-cover intents triggered from the shell app bar.
  $effect(() => {
    const intent = spaceUiManager.intent;
    if (!intent) {
      return;
    }
    spaceUiManager.consumeIntent();
    if (intent === 'add-assets') {
      viewMode = 'select-assets';
    } else if (intent === 'set-cover') {
      openSelectCover();
    }
  });

  $effect(() => {
    spaceUiManager.setChromeHidden(
      assetMultiSelectManager.selectionActive || viewMode === 'select-assets' || viewMode === 'select-cover',
    );
  });

  // Reset shell state when leaving the Photos page.
  $effect(() => () => spaceUiManager.reset());
</script>

<OnEvents {onSpaceAddAssets} {onSpaceRemoveAssets} onAssetsDelete={refreshSpace} />

<div class="flex h-full" data-testid="discovery-timeline">
  <!-- Filter Panel (left sidebar) -->
  {#if viewMode === 'view'}
    {#key `${space.id}:${showSearchResults ? `spaces-search-${committedSearchQuery.trim()}:${$lang}` : 'spaces-browse'}`}
      <FilterPanel
        config={filterConfig}
        bind:filters
        bind:collapsed={filterCollapsed}
        externalToggle
        timeBuckets={smartFacetBuckets}
        hidden={isTimelineEmpty}
        {personNames}
        {tagNames}
        onFiltersChange={handleFiltersChange}
      />
    {/key}
  {/if}

  <!-- Main Content — pl-2 adds breathing room between filter panel and content. The same gutter
       is repeated on every page pairing a filter panel with a timeline (photos, recently-added,
       albums, space albums); they are meant to match. -->
  <div class="flex flex-1 flex-col overflow-hidden pl-2">
    {#snippet spaceFiltersBar()}
      <ActiveFiltersBar
        embedded
        {filters}
        resultCount={showSearchResults ? smartFacetTotal : totalAssetCount}
        {personNames}
        {tagNames}
        {albumNames}
        {ownerNames}
        onRemoveFilter={handleRemoveFilter}
        onClearAll={handleClearAllFilters}
        searchQuery={committedSearchQuery}
        onClearSearch={clearSearch}
        onAddAllToCollection={handleAddAllToCollection}
      />
    {/snippet}
    {#if viewMode === 'view'}
      <FilterToolbar
        class="mb-2"
        grouping={timelineGrouping}
        onGroupingChange={handleTimelineGroupingChange}
        showGrouping={!showSearchResults && !assetMultiSelectManager.selectionActive}
        showFilters={getActiveFilterCount(filters) > 0 || committedSearchQuery.trim().length > 0}
        filters={spaceFiltersBar}
        showFilterButton={filterCollapsed && !isTimelineEmpty && !assetMultiSelectManager.selectionActive}
        filterActive={getActiveFilterCount(filters) > 0}
        onExpandFilters={() => (filterCollapsed = false)}
      />
    {/if}

    {#if showSearchResults}
      <SmartSearchResults
        searchQuery={committedSearchQuery}
        bind:isLoading
        bind:results={searchResults}
        reloadToken={searchReloadToken}
        {filters}
        language={$lang}
        spaceId={space.id}
        space={{ id: space.id, canWrite: isEditor }}
        isShared={true}
        total={smartFacetTotal}
        onScroll={handleSurfaceScroll}
      />
    {/if}

    {#if !showSearchResults}
      {#if isFilteredTimelineEmpty}
        <div class="flex flex-1 flex-col items-center justify-center gap-2" data-testid="empty-state-message">
          <p class="text-sm text-(--fg-muted)">{$t('spaces_no_filtered_assets')}</p>
          <button type="button" class="text-sm text-(--primary)" onclick={handleClearAllFilters}>
            {$t('spaces_clear_all_filters')}
          </button>
        </div>
      {:else}
        <Timeline
          enableRouting={false}
          bind:timelineManager
          {options}
          withStacked
          assetInteraction={assetMultiSelectManager}
          {isSelectionMode}
          onEscape={handleEscape}
          spaceId={space.id}
          space={{ id: space.id, canWrite: isEditor }}
          onTimelineBucketActivate={handleTimelineBucketActivate}
          {temporalAnchor}
          onTemporalAnchorResolved={() => (temporalAnchor = undefined)}
          grouping={timelineGrouping}
          onGroupingChange={handleTimelineGroupingChange}
          onScroll={handleSurfaceScroll}
        >
          {#if viewMode === 'view'}
            {#if isOwner}
              <SpaceOnboardingBanner
                {space}
                gradientClass={spaceGradient}
                onAddPhotos={() => (viewMode = 'select-assets')}
                onInviteMembers={() => void goto(`/spaces/${space.id}/members`)}
                onSetCover={openSelectCover}
              />
            {/if}

            {#if (space.newAssetCount ?? 0) > 0 && space.lastViewedAt}
              <SpaceNewAssetsDivider
                newAssetCount={space.newAssetCount ?? 0}
                lastViewedAt={space.lastViewedAt}
                spaceColor={space.color ?? 'primary'}
              />
            {/if}
          {/if}

          {#snippet empty()}
            {#if viewMode === 'view'}
              <div class="mx-auto max-w-md py-16 text-center">
                <p class="text-gray-500 dark:text-gray-400">{$t('spaces_no_assets')}</p>
              </div>
            {/if}
          {/snippet}
        </Timeline>
      {/if}
    {/if}
  </div>
</div>

{#if assetMultiSelectManager.selectionActive && viewMode === 'view'}
  <div class="fixed inset-s-0 top-0 z-2 w-full">
    <SelectionToolbar
      timelineManager={showSearchResults ? undefined : timelineManager}
      assetInteraction={assetMultiSelectManager}
      onSelectAll={showSearchResults ? () => selectAllSearchResults(searchResults, assetMultiSelectManager) : undefined}
      space={{ id: space.id, canWrite: isEditor }}
      onRemove={handleRemoveAssets}
      onSetCover={handleSetAsCover}
      onFavorite={handleFavorite}
      onArchive={handleArchive}
      onVisibilitySet={handleSetVisibility}
      onAssetDelete={handleAssetDelete}
      onUndoDelete={handleUndoAssetDelete}
    />
  </div>
{/if}

{#if viewMode === 'select-assets'}
  <div class="fixed inset-s-0 top-0 z-2 w-full">
    <ControlAppBar onClose={handleCloseSelectAssets}>
      {#snippet leading()}
        <p class="text-lg dark:text-immich-dark-fg">
          {#if !assetMultiSelectManager.selectionActive}
            {$t('add_to_space')}
          {:else}
            {$t('selected_count', { values: { count: assetMultiSelectManager.assets.length } })}
          {/if}
        </p>
      {/snippet}

      {#snippet trailing()}
        <IconButton
          variant="ghost"
          shape="round"
          color="secondary"
          aria-label={$t('add_to_space')}
          onclick={handleAddAssets}
          icon={mdiPlus}
          disabled={!assetMultiSelectManager.selectionActive ||
            assetMultiSelectManager.assets.length > MAX_SPACE_ASSETS_PER_REQUEST}
        />
      {/snippet}
    </ControlAppBar>
    <SpaceAssetLimitWarning selectedCount={assetMultiSelectManager.assets.length} />
  </div>
{/if}

{#if viewMode === 'select-cover'}
  <div class="fixed inset-s-0 top-0 z-2 w-full">
    <ControlAppBar onClose={handleCloseSelectCover}>
      {#snippet leading()}
        <p class="text-lg dark:text-immich-dark-fg">
          {#if !assetMultiSelectManager.selectionActive}
            {$t('set_cover_photo')}
          {:else}
            {$t('selected_count', { values: { count: assetMultiSelectManager.assets.length } })}
          {/if}
        </p>
      {/snippet}

      {#snippet trailing()}
        <IconButton
          variant="ghost"
          shape="round"
          color="secondary"
          aria-label={$t('set_cover_photo')}
          onclick={handleSetCoverFromSelection}
          icon={mdiImageOutline}
          disabled={assetMultiSelectManager.assets.length !== 1}
        />
      {/snippet}
    </ControlAppBar>
  </div>
{/if}
