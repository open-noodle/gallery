<script lang="ts">
  import { goto, invalidate, onNavigate } from '$app/navigation';
  import { navigating, page } from '$app/state';
  import { scrollMemoryClearer } from '$lib/actions/scroll-memory';
  import AlbumMap from '$lib/components/album-page/AlbumMap.svelte';
  import AlbumSharedSpaceLinks from '$lib/components/album-page/AlbumSharedSpaceLinks.svelte';
  import AlbumSummary from '$lib/components/album-page/AlbumSummary.svelte';
  import ActivityStatus from '$lib/components/asset-viewer/ActivityStatus.svelte';
  import ActivityViewer from '$lib/components/asset-viewer/ActivityViewer.svelte';
  import ActiveFiltersBar from '$lib/components/filter-panel/active-filters-bar.svelte';
  import FilterPanel from '$lib/components/filter-panel/filter-panel.svelte';
  import FilterToolbar from '$lib/components/filter-panel/filter-toolbar.svelte';
  import { clearTimelineTemporalFilter } from '$lib/utils/timeline-temporal-filters';
  import {
    clearFilters,
    createFilterState,
    getActiveFilterCount,
    loadFilterCollapsed,
    type FilterState,
  } from '$lib/components/filter-panel/filter-panel';
  import HeaderActionButton from '$lib/components/HeaderActionButton.svelte';
  import OnEvents from '$lib/components/OnEvents.svelte';
  import ButtonContextMenu from '$lib/components/shared-components/context-menu/ButtonContextMenu.svelte';
  import MenuOption from '$lib/components/shared-components/context-menu/MenuOption.svelte';
  import ControlAppBar from '$lib/components/shared-components/ControlAppBar.svelte';
  import UserAvatar from '$lib/components/shared-components/UserAvatar.svelte';
  import ArchiveAction from '$lib/components/timeline/actions/ArchiveAction.svelte';
  import ChangeDate from '$lib/components/timeline/actions/ChangeDateAction.svelte';
  import ChangeDescription from '$lib/components/timeline/actions/ChangeDescriptionAction.svelte';
  import ChangeLocation from '$lib/components/timeline/actions/ChangeLocationAction.svelte';
  import CreateSharedLink from '$lib/components/timeline/actions/CreateSharedLinkAction.svelte';
  import DeleteAssets from '$lib/components/timeline/actions/DeleteAssetsAction.svelte';
  import DownloadAction from '$lib/components/timeline/actions/DownloadAction.svelte';
  import FavoriteAction from '$lib/components/timeline/actions/FavoriteAction.svelte';
  import RemoveFromAlbum from '$lib/components/timeline/actions/RemoveFromAlbumAction.svelte';
  import RotateAction from '$lib/components/timeline/actions/RotateAction.svelte';
  import SelectAllAssets from '$lib/components/timeline/actions/SelectAllAction.svelte';
  import SetVisibilityAction from '$lib/components/timeline/actions/SetVisibilityAction.svelte';
  import TagAction from '$lib/components/timeline/actions/TagAction.svelte';
  import AssetSelectControlBar from '$lib/components/timeline/AssetSelectControlBar.svelte';
  import Timeline from '$lib/components/timeline/Timeline.svelte';
  import { AlbumPageViewMode } from '$lib/constants';
  import { activityManager } from '$lib/managers/activity-manager.svelte';
  import { assetMultiSelectManager, AssetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
  import { assetViewerManager } from '$lib/managers/asset-viewer-manager.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { registerAlbumContext, registerSelectionContext } from '$lib/managers/command-context-manager.svelte';
  import { eventManager } from '$lib/managers/event-manager.svelte';
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import { TimelineManager } from '$lib/managers/timeline-manager/timeline-manager.svelte';
  import type { TimelineAsset, TimelineGrouping, TimelineTemporalAnchor } from '$lib/managers/timeline-manager/types';
  import AlbumOptionsModal from '$lib/modals/AlbumOptionsModal.svelte';
  import { Route } from '$lib/route';
  import {
    getAlbumActions,
    getAlbumAssetsActions,
    handleDeleteAlbum,
    handleDownloadAlbum,
    handleLinkAlbumToSpace,
  } from '$lib/services/album.service';
  import { getGlobalActions } from '$lib/services/app.service';
  import { getAssetBulkActions } from '$lib/services/asset.service';
  import { SlideshowNavigation, SlideshowState, slideshowStore } from '$lib/stores/slideshow.store';
  import { handlePromiseError } from '$lib/utils';
  import { buildAlbumAssetPickerFilterConfig, buildAlbumDetailFilterConfig } from '$lib/utils/album-filter-config';
  import { buildAlbumAssetPickerOptions, buildAlbumTimelineOptions } from '$lib/utils/album-filter-options';
  import SearchAddAllToCollectionModal from '$lib/modals/SearchAddAllToCollectionModal.svelte';
  import { resolveFilterNames } from '$lib/utils/filter-name-resolution';
  import { filterStateToSearchTerms } from '$lib/utils/filter-search-terms';
  import type { SearchTerms } from '$lib/services/search.service';
  import { buildFilterStateUrl, isFilterStateUrlUnchanged, withoutAtParam } from '$lib/utils/filter-target';
  import { decodeFilterParams } from '$lib/utils/filter-url';
  import { lang } from '$lib/stores/preferences.store';
  import { handleError } from '$lib/utils/handle-error';
  import { isAlbumsRoute, navigate, type AssetGridRouteSearchParams } from '$lib/utils/navigation';
  import { handlePhotosRemoveFilter } from '$lib/utils/photos-filter-options';
  import {
    type ActivatableTimelineBucket,
    getTimelineBucketZoomTarget,
    getTimelineManagerTimeBuckets,
  } from '$lib/utils/timeline-zoom-navigation';
  import { getTimelineTopVisibleAnchor } from '$lib/managers/timeline-manager/timeline-anchor';
  import SmartSearchResults from '$lib/components/search/smart-search-results.svelte';
  import { globalSearchManager } from '$lib/managers/global-search-manager.svelte';
  import { buildSearchablePageUrl, getSearchablePageState } from '$lib/utils/searchable-page-search';
  import {
    buildSmartSearchFacetKey,
    buildSmartSearchFacetsParams,
    mapSmartSearchFacetsToFilterSuggestions,
  } from '$lib/utils/space-search';
  import { consumeTypedSearchNamesInto } from '$lib/utils/typed-search/typed-search-name-cache';
  import { removeSearchResults, selectAllSearchResults, updateSearchResults } from '$lib/utils/search-result-selection';
  import {
    AlbumUserRole,
    AssetOrder,
    type AssetVisibility,
    getAlbumInfo,
    searchSmartFacets,
    updateAlbumInfo,
    type AlbumResponseDto,
    type AssetResponseDto,
    type SmartSearchFacetsResponseDto,
  } from '@immich/sdk';
  import {
    ActionButton,
    CommandPaletteDefaultProvider,
    Icon,
    IconButton,
    modalManager,
    toastManager,
  } from '@immich/ui';
  import {
    mdiAccountEye,
    mdiAccountEyeOutline,
    mdiArrowLeft,
    mdiCogOutline,
    mdiDeleteOutline,
    mdiDotsHorizontal,
    mdiDotsVertical,
    mdiDownload,
    mdiImageOutline,
    mdiImagePlusOutline,
    mdiLink,
    mdiLinkVariantPlus,
    mdiPlus,
    mdiPresentationPlay,
  } from '@mdi/js';
  import { onDestroy, untrack } from 'svelte';
  import { t } from 'svelte-i18n';
  import { fly } from 'svelte/transition';
  import { SvelteMap } from 'svelte/reactivity';
  import type { PageData } from './$types';
  import AlbumDescription from '$lib/components/album-page/AlbumDescription.svelte';
  import AlbumTitle from '$lib/components/album-page/AlbumTitle.svelte';

  interface Props {
    data: PageData;
  }

  let { data = $bindable() }: Props = $props();
  let { slideshowState, slideshowNavigation } = slideshowStore;
  let oldAt: AssetGridRouteSearchParams | null | undefined = $state();
  let album = $state(data.album);
  /**
   * E9 — the route already scopes the timeline to this album, and the server's `albumId` is a
   * SCALAR driving one inner join, so album ∩ album is impossible. A stray `?albumId=` must be
   * IGNORED: dropping it here keeps it out of the active-filter count, out of the chip bar, and
   * out of the next URL write. buildAlbumTimelineOptions already refuses to forward it.
   */
  const hydrateAlbumFilters = (url: URL): FilterState => ({
    ...createFilterState(),
    ...decodeFilterParams(url),
    albumId: undefined,
    sortOrder: getSearchablePageState(url).sortOrder,
  });

  let albumFilters = $state<FilterState>(hydrateAlbumFilters(page.url));
  let committedSearchQuery = $state(getSearchablePageState(page.url).query);
  const showSearchResults = $derived(committedSearchQuery.trim().length > 0);
  // Loaded smart-search results. The browse Timeline (and its TimelineManager) is unmounted while
  // these show, so the selection toolbar acts on this array instead — mirrors the space timeline.
  let searchResults = $state<AssetResponseDto[]>([]);
  let searchIsLoading = $state(false);
  // Bumped to force a re-run of the current search (undo-delete restores the removed assets).
  let searchReloadToken = $state(0);
  // Token guard for the URL $effect below. Copied in spirit from photos/…/+page.svelte: without it,
  // our own goto() re-runs the effect, which re-runs goto(), forever. It is at-stripped because
  // closing the asset viewer writes `?at=<assetId>` (replaceScrollTarget), which is not a filter
  // change: re-hydrating on it is pure churn — the FilterState it would rebuild is identical, since
  // every filter is URL-backed. Rebuilding it anyway would needlessly re-create `filters` and, with
  // it, the timeline options object.
  let lastHandledFilterSearch = $state(withoutAtParam(page.url.search));
  let pickerFilters = $state(createFilterState());
  let timelineGrouping = $state<TimelineGrouping>('day');
  let temporalAnchor = $state<TimelineTemporalAnchor | undefined>();
  let albumPersonNames = new SvelteMap<string, string>();
  let albumTagNames = new SvelteMap<string, string>();
  let albumOwnerNames = new SvelteMap<string, string>();
  // Never populated: E9 drops `?albumId=` at hydrate, so an album chip can never appear on this
  // page. It exists only to satisfy resolveFilterNames' map pair.
  let albumAlbumNames = new SvelteMap<string, string>();
  let pickerPersonNames = new SvelteMap<string, string>();
  let pickerTagNames = new SvelteMap<string, string>();
  // An `?ownerId=` chip on an album is (all but always) one of the album's users, and they are
  // already in scope — seed from them so no request is made. resolveFilterNames only falls through
  // to a by-id fetch for an owner who is not an album user (a space contributor, say).
  $effect(() => {
    for (const { user } of album.albumUsers) {
      albumOwnerNames.set(user.id, user.name);
    }
    void resolveFilterNames(albumFilters, { albumNames: albumAlbumNames, ownerNames: albumOwnerNames });
  });
  let viewMode: AlbumPageViewMode = $state(AlbumPageViewMode.VIEW);
  let timelineManager = $state<TimelineManager>() as TimelineManager;
  let showAlbumUsers = $derived(timelineManager?.showAssetOwners ?? false);

  const timelineMultiSelectManager = new AssetMultiSelectManager();

  const handleFavorite = async () => {
    try {
      await activityManager.toggleLike();
    } catch (error) {
      handleError(error, $t('errors.cant_change_asset_favorite'));
    }
  };

  const handleStartSlideshow = async () => {
    const asset =
      $slideshowNavigation === SlideshowNavigation.Shuffle
        ? await timelineManager.getRandomAsset()
        : timelineManager.months[0]?.timelineDays[0]?.viewerAssets[0]?.asset;
    if (asset) {
      handlePromiseError(
        assetViewerManager.setAssetId(asset.id).then(() => ($slideshowState = SlideshowState.PlaySlideshow)),
      );
    }
  };

  const handleEscape = async () => {
    // Search mode unmounts <Timeline>, so `timelineManager` is undefined here on a directly-loaded
    // `?q=` URL — dereferencing it below would throw before anything else ran. Escape clears the
    // search instead, matching the space timeline's handler.
    if (showSearchResults) {
      clearAlbumSearch();
      return;
    }
    timelineManager.suspendTransitions = true;
    if (viewMode === AlbumPageViewMode.SELECT_THUMBNAIL) {
      viewMode = AlbumPageViewMode.VIEW;
      return;
    }
    if (viewMode === AlbumPageViewMode.SELECT_ASSETS) {
      await handleCloseSelectAssets();
      return;
    }
    if (assetViewerManager.isViewing) {
      return;
    }
    if (assetMultiSelectManager.selectionActive) {
      assetMultiSelectManager.clear();
      return;
    }
    await goto(Route.albums());
  };

  const refreshAlbum = async () => {
    album = await getAlbumInfo({ id: album.id });
  };

  const setModeToView = async () => {
    timelineManager.suspendTransitions = true;
    viewMode = AlbumPageViewMode.VIEW;
    await navigate(
      { targetRoute: 'current', assetId: null, assetGridRouteSearchParams: { at: oldAt?.at } },
      { replaceState: true, forceNavigate: true },
    );
    oldAt = null;
  };

  const handleCloseSelectAssets = async () => {
    timelineMultiSelectManager.clear();
    await setModeToView();
  };

  // While search results are showing, <Timeline> is unmounted and its manager destroyed — every
  // bulk action has to mutate the results array instead, or it silently no-ops and the asset stays
  // on screen (#908, the same split the space timeline makes).
  const handleSetVisibility = (assetIds: string[]) => {
    if (showSearchResults) {
      removeSearchResults(searchResults, assetIds);
    } else {
      timelineManager?.removeAssets(assetIds);
    }
    assetMultiSelectManager.clear();
  };

  const handleRemoveAssets = async (assetIds: string[]) => {
    if (showSearchResults) {
      removeSearchResults(searchResults, assetIds);
    } else {
      timelineManager?.removeAssets(assetIds);
    }
    await refreshAlbum();
  };

  const handleUndoRemoveAssets = async (assets: TimelineAsset[]) => {
    if (showSearchResults) {
      // Undo hands back TimelineAssets; the results list holds full AssetResponseDtos, so
      // re-running the search is how they come back.
      searchReloadToken++;
    } else {
      timelineManager?.upsertAssets(assets);
    }
    await refreshAlbum();
  };

  const handleBulkFavorite = (ids: string[], isFavorite: boolean) => {
    if (showSearchResults) {
      updateSearchResults(searchResults, ids, (asset) => (asset.isFavorite = isFavorite));
      return;
    }
    timelineManager?.update(ids, (asset) => (asset.isFavorite = isFavorite));
  };

  const handleBulkArchive = (ids: string[], visibility: AssetVisibility) => {
    if (showSearchResults) {
      updateSearchResults(searchResults, ids, (asset) => (asset.visibility = visibility));
      return;
    }
    timelineManager?.update(ids, (asset) => (asset.visibility = visibility));
  };

  const handleUpdateThumbnail = async (assetId: string) => {
    if (viewMode !== AlbumPageViewMode.SELECT_THUMBNAIL) {
      return;
    }

    await updateThumbnail(assetId);

    viewMode = AlbumPageViewMode.VIEW;
    assetMultiSelectManager.clear();
  };

  const updateThumbnailUsingCurrentSelection = async () => {
    if (assetMultiSelectManager.assets.length !== 1) {
      return;
    }

    const [firstAsset] = assetMultiSelectManager.assets;
    assetMultiSelectManager.clear();
    await updateThumbnail(firstAsset.id);
  };

  const updateThumbnail = async (assetId: string) => {
    try {
      const response = await updateAlbumInfo({
        id: album.id,
        updateAlbumDto: {
          albumThumbnailAssetId: assetId,
        },
      });
      eventManager.emit('AlbumUpdate', response);
      toastManager.primary($t('album_cover_updated'));
    } catch (error) {
      handleError(error, $t('errors.unable_to_update_album_cover'));
    }
  };

  onNavigate(async ({ to }) => {
    if (!isAlbumsRoute(to?.route.id) && album.assetCount === 0 && !album.albumName) {
      await handleDeleteAlbum(album, { notify: false, prompt: false });
    }
  });

  registerAlbumContext(() => album);
  registerSelectionContext({
    getAssets: () => (viewMode === AlbumPageViewMode.VIEW ? assetMultiSelectManager.assets : []),
    clearSelection: () => assetMultiSelectManager.clear(),
    canAddToAlbum: () => viewMode === AlbumPageViewMode.VIEW,
    // `showSearchResults` joins `timelineManager` as an availability condition: in search mode the
    // manager is gone but the handlers below are still meaningful — they act on the results array.
    getOnFavorite: () =>
      viewMode === AlbumPageViewMode.VIEW && (timelineManager || showSearchResults) ? handleBulkFavorite : undefined,
    getOnArchive: () =>
      viewMode === AlbumPageViewMode.VIEW && (timelineManager || showSearchResults) ? handleBulkArchive : undefined,
    getOnDelete: () =>
      viewMode === AlbumPageViewMode.VIEW && (timelineManager || showSearchResults) ? handleRemoveAssets : undefined,
    getOnUndoDelete: () =>
      viewMode === AlbumPageViewMode.VIEW && (timelineManager || showSearchResults)
        ? handleUndoRemoveAssets
        : undefined,
  });

  $effect(() => {
    if (data.album.id === album.id) {
      return;
    }

    album = data.album;
    albumFilters = hydrateAlbumFilters(page.url);
    committedSearchQuery = getSearchablePageState(page.url).query;
    searchIsLoading = false;
    smartFacetInFlight?.controller.abort();
    smartFacets = undefined;
    smartFacetKey = '';
    smartFacetInFlight = undefined;
    lastHandledFilterSearch = withoutAtParam(page.url.search);
    pickerFilters = createFilterState();
    albumPersonNames.clear();
    albumTagNames.clear();
    pickerPersonNames.clear();
    pickerTagNames.clear();
    timelineMultiSelectManager.clear();
    assetMultiSelectManager.clear();
    viewMode = AlbumPageViewMode.VIEW;
    timelineGrouping = 'day';
    temporalAnchor = undefined;
    oldAt = null;
  });

  $effect(() => {
    const nextFilterSearch = withoutAtParam(page.url.search);
    if (nextFilterSearch === lastHandledFilterSearch) {
      return;
    }

    untrack(() => {
      // Every filter — including the temporal picker's year/month — round-trips through the URL, so
      // rebuilding FilterState from the URL alone is lossless.
      const nextQuery = getSearchablePageState(page.url).query;
      // A NEW query invalidates the facets outright. Leaving them would let the previous query's
      // total and time buckets annotate the new results until the fresh ones land — and a failed
      // fetch returns the stale value, so they would never be corrected.
      if (nextQuery !== committedSearchQuery) {
        smartFacetInFlight?.controller.abort();
        smartFacetInFlight = undefined;
        smartFacets = undefined;
        smartFacetKey = '';
        searchResults = [];
      }
      albumFilters = {
        ...createFilterState(),
        ...hydrateAlbumFilters(page.url),
      };
      committedSearchQuery = nextQuery;
      searchIsLoading = false;
      lastHandledFilterSearch = nextFilterSearch;
      consumeTypedSearchNamesInto(page.url.pathname + page.url.search, albumPersonNames, albumTagNames);
    });
  });

  const containsEditors = $derived(album?.shared && album.albumUsers.some(({ role }) => role === AlbumUserRole.Editor));
  const albumUsers = $derived(showAlbumUsers && containsEditors ? album.albumUsers.map(({ user }) => user) : []);

  $effect(() => {
    if (!album.isActivityEnabled && activityManager.commentCount === 0) {
      assetViewerManager.closeActivityPanel();
    }
  });

  let smartFacets = $state<SmartSearchFacetsResponseDto>();
  let smartFacetKey = $state('');
  let smartFacetInFlight:
    | { key: string; controller: AbortController; promise: Promise<SmartSearchFacetsResponseDto | undefined> }
    | undefined;

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
    hasFavorites: false,
    hasAssetsInAlbum: false,
    hasAssetsNotInAlbum: false,
  });

  /**
   * Facets for the ACTIVE search, scoped to this album — the source of the result count and of the
   * temporal picker's buckets while a query is running. Memoised on the request shape so a filter
   * change that cannot alter the facets (sortOrder) does not refetch.
   */
  async function loadAlbumSmartFacets(nextFilters: FilterState): Promise<SmartSearchFacetsResponseDto | undefined> {
    const query = committedSearchQuery.trim();
    if (!query) {
      return undefined;
    }

    const args = { query, filters: nextFilters, albumIds: searchAlbumIds, language: $lang };
    const key = buildSmartSearchFacetKey(args);
    if (smartFacets && smartFacetKey === key) {
      return smartFacets;
    }
    if (smartFacetInFlight?.key === key) {
      return smartFacetInFlight.promise;
    }

    smartFacetInFlight?.controller.abort();
    const controller = new AbortController();

    const promise = searchSmartFacets(
      { smartSearchFacetsDto: buildSmartSearchFacetsParams(args) },
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

  const searchTotal = $derived(showSearchResults ? smartFacets?.total : undefined);

  const albumFilterConfig = $derived.by(() => {
    const base = buildAlbumDetailFilterConfig(album.id);
    const provider = base.suggestionsProvider!;
    return {
      ...base,
      // Browse mode asks the album's own suggestion endpoint; query mode has to ask the SEARCH, or
      // the panel would offer facets the visible results do not contain. BOTH branches feed the
      // name maps — a chip picked from the facets has no other source for its label, and
      // ActiveFiltersBar falls back to rendering the raw `person:<uuid>` token without it.
      suggestionsProvider: async (filters: FilterState) => {
        const result = showSearchResults
          ? await loadAlbumSmartFacets(filters).then((facets) =>
              facets ? mapSmartSearchFacetsToFilterSuggestions(facets) : emptyFilterSuggestions(),
            )
          : await provider(filters);
        for (const person of result.people) {
          albumPersonNames.set(person.id, person.name);
        }
        for (const tag of result.tags) {
          albumTagNames.set(tag.id, tag.name);
        }
        return result;
      },
    };
  });

  const pickerFilterConfig = $derived.by(() => {
    const base = buildAlbumAssetPickerFilterConfig();
    const provider = base.suggestionsProvider!;
    return {
      ...base,
      suggestionsProvider: async (filters: FilterState) => {
        const result = await provider(filters);
        for (const person of result.people) {
          pickerPersonNames.set(person.id, person.name);
        }
        for (const tag of result.tags) {
          pickerTagNames.set(tag.id, tag.name);
        }
        return result;
      },
    };
  });

  const totalAssetCount = $derived(timelineManager?.assetCount ?? 0);

  // The bar prints the SEARCH total in its label, so the collect call has to run the same search.
  // Omitting the query sends `collectSearchResultAssetIds` down the metadata branch, which then
  // collects every asset in the album — "Add all 3" quietly adding 800.
  const handleAddAllToCollection = () => {
    const query = committedSearchQuery.trim();
    const terms: SearchTerms = { ...filterStateToSearchTerms(albumFilters), albumIds: [album.id] };
    if (query) {
      terms.query = query;
    }
    void modalManager.show(SearchAddAllToCollectionModal, {
      terms,
      total: showSearchResults ? (searchTotal ?? 0) : totalAssetCount,
      smartSearchEnabled: !!query,
      language: $lang,
    });
  };
  const hasTimelineMonths = $derived((timelineManager?.months?.length ?? 0) > 0);
  const activeFilterCount = $derived(
    getActiveFilterCount(viewMode === AlbumPageViewMode.SELECT_ASSETS ? pickerFilters : albumFilters),
  );
  const isTimelineEmpty = $derived(
    timelineManager?.isInitialized && !hasTimelineMonths && totalAssetCount === 0 && activeFilterCount === 0,
  );

  // Filter-panel collapse is driven here so a header filter button can reclaim the panel's space.
  let filterCollapsed = $state(loadFilterCollapsed());
  const showFilteredEmptyState = $derived(
    timelineManager?.isInitialized && !hasTimelineMonths && totalAssetCount === 0 && activeFilterCount > 0,
  );
  const timeBuckets = $derived(getTimelineManagerTimeBuckets(timelineManager));
  // While a query is running the panel's temporal picker must bucket the MATCHES, not the album.
  const filterTimeBuckets = $derived(showSearchResults ? (smartFacets?.timeBuckets ?? []) : timeBuckets);
  const isBrowseTimeline = $derived(viewMode === AlbumPageViewMode.VIEW);

  /**
   * The album scope handed to smart search — this album alone, matching the browse timeline's own
   * `albumId` scope and the personal person tokens its filter panel speaks.
   */
  const searchAlbumIds = $derived([album.id]);

  /**
   * Browse order. An album carries its own `order`, but the navbar sort dropdown renders on every
   * searchable page — browse mode included — so an EXPLICIT `?sort=` has to win, or the control
   * would visibly do nothing here. Absent that param the album's own order stands.
   */
  const browseOrder = $derived.by(() => {
    if (!getSearchablePageState(page.url).hasExplicitSort) {
      return album.order ?? authManager.preferences.albums.defaultAssetOrder;
    }
    return albumFilters.sortOrder === 'asc' ? AssetOrder.Asc : AssetOrder.Desc;
  });

  const options = $derived.by(() => {
    if (viewMode === AlbumPageViewMode.SELECT_ASSETS) {
      return buildAlbumAssetPickerOptions(album.id, pickerFilters);
    }
    const albumOptions = buildAlbumTimelineOptions(album.id, browseOrder, albumFilters);
    return isBrowseTimeline ? { ...albumOptions, grouping: timelineGrouping } : albumOptions;
  });

  const isShared = $derived(viewMode === AlbumPageViewMode.SELECT_ASSETS ? false : album.albumUsers.length > 1);

  $effect(() => {
    if (assetViewerManager.isViewing || !isShared) {
      return;
    }

    handlePromiseError(activityManager.init(album.id));
  });

  onDestroy(() => activityManager.reset());

  const isOwned = $derived(album.albumUsers[0].user.id === authManager.user.id);

  let showActivityStatus = $derived(
    album.albumUsers.length > 1 &&
      !assetViewerManager.isViewing &&
      (album.isActivityEnabled || activityManager.commentCount > 0),
  );
  const isEditor = $derived(
    album.albumUsers.find(({ user: { id } }) => id === authManager.user.id)?.role === AlbumUserRole.Editor || isOwned,
  );

  let albumHasViewers = $derived(album.albumUsers.some(({ role }) => role === AlbumUserRole.Viewer));
  const isSelectionMode = $derived(
    viewMode === AlbumPageViewMode.SELECT_ASSETS ? true : viewMode === AlbumPageViewMode.SELECT_THUMBNAIL,
  );
  const singleSelect = $derived(
    viewMode === AlbumPageViewMode.SELECT_ASSETS ? false : viewMode === AlbumPageViewMode.SELECT_THUMBNAIL,
  );
  const showArchiveIcon = $derived(viewMode !== AlbumPageViewMode.SELECT_ASSETS);
  const onSelect = ({ id }: { id: string }) => {
    if (viewMode !== AlbumPageViewMode.SELECT_ASSETS) {
      void handleUpdateThumbnail(id);
    }
  };
  const currentAssetIntersection = $derived(
    viewMode === AlbumPageViewMode.SELECT_ASSETS ? timelineMultiSelectManager : assetMultiSelectManager,
  );

  function handleTimelineGroupingChange(grouping: TimelineGrouping) {
    const anchor = getTimelineTopVisibleAnchor(timelineManager);
    timelineGrouping = grouping;
    temporalAnchor = anchor;
  }

  function handleTimelineBucketActivate(bucket: ActivatableTimelineBucket) {
    if (!isBrowseTimeline || assetMultiSelectManager.selectionActive) {
      return;
    }

    const result = getTimelineBucketZoomTarget(bucket);
    if (!result) {
      return;
    }

    timelineGrouping = result.grouping;
    temporalAnchor = result.anchor;
  }

  function syncAlbumFilterUrl(nextFilters: FilterState) {
    const nextUrl = buildFilterStateUrl(page.url, nextFilters);
    // NOT a string compare: buildFilterStateUrl re-appends the filter params last, so an unchanged
    // state on `?make=Apple&at=…`-style URLs can come back re-ordered. See filter-target.ts.
    if (isFilterStateUrlUnchanged(page.url, nextUrl)) {
      return;
    }
    void goto(nextUrl, { replaceState: true, keepFocus: true, noScroll: true });
  }

  $effect(() => globalSearchManager.registerSearchablePageFilters(() => albumFilters));

  const clearAlbumSearch = () => {
    searchIsLoading = false;
    const nextUrl = buildSearchablePageUrl(page.url, '', albumFilters.sortOrder, albumFilters);
    if (!nextUrl) {
      return;
    }
    void goto(nextUrl, { replaceState: true, keepFocus: true, noScroll: true });
  };

  function clearAlbumTemporalFilter() {
    albumFilters = clearTimelineTemporalFilter(albumFilters);
    temporalAnchor = undefined;
    syncAlbumFilterUrl(albumFilters);
  }

  const onSharedLinkCreate = async () => {
    await refreshAlbum();
  };

  const onAlbumDelete = async ({ id }: AlbumResponseDto) => {
    if (id !== album.id) {
      return;
    }

    await goto(Route.albums());
    viewMode = AlbumPageViewMode.VIEW;
  };

  const onAlbumAddAssets = async ({ albumIds }: { albumIds: string[] }) => {
    if (!albumIds.includes(album.id)) {
      return;
    }

    await refreshAlbum();
    timelineMultiSelectManager.clear();
    await setModeToView();
  };

  const onAlbumShare = async () => {
    await refreshAlbum();
    await setModeToView();
  };

  const onAlbumUserUpdate = ({ albumId, userId, role }: { albumId: string; userId: string; role: AlbumUserRole }) => {
    if (albumId !== album.id) {
      return;
    }

    const albumUsers = album.albumUsers.map((albumUser) =>
      albumUser.user.id === userId ? { ...albumUser, role } : albumUser,
    );
    album = { ...album, albumUsers };
  };

  const onAlbumUpdate = async (newAlbum: AlbumResponseDto) => {
    album = newAlbum;

    // invalidating during navigation causes an infinite page load
    await navigating.complete;

    await invalidate('album:data');
  };

  const { Cast } = $derived(getGlobalActions($t));
  const { Share } = $derived(getAlbumActions($t, album));
  const { AddAssets, Upload } = $derived(getAlbumAssetsActions($t, album, timelineMultiSelectManager.assets));

  const Close = $derived({
    title: $t('go_back'),
    icon: mdiArrowLeft,
    onAction: handleEscape,
    $if: () => !assetViewerManager.isViewing,
    shortcuts: { key: 'Escape' },
  });
</script>

<OnEvents
  {onSharedLinkCreate}
  onSharedLinkDelete={refreshAlbum}
  {onAlbumDelete}
  {onAlbumAddAssets}
  {onAlbumShare}
  {onAlbumUserUpdate}
  onAlbumUserDelete={refreshAlbum}
  {onAlbumUpdate}
/>
<CommandPaletteDefaultProvider name={$t('album')} actions={[AddAssets, Upload, Close]} />

<div class="flex overflow-hidden" use:scrollMemoryClearer={{ routeStartsWith: Route.albums() }}>
  <div class="relative w-full shrink">
    <main
      class="relative h-dvh overflow-hidden px-2 pt-(--control-bar-height) max-md:pt-(--control-bar-height-md) md:px-6"
    >
      <div class="flex h-full" data-testid="discovery-timeline">
        <!-- This route doesn't use UserPageLayout, so there's no page-level card for the panel to
             blend into — its bg-light surface would otherwise read as a flush black slab running to
             the foot of the window. Give it the app's own surface radius (rounded-lg is 16px in this
             theme, matching UserPageLayout's <main>) and inset it equally from the app bar above and
             the window edge below, so it reads as a deliberate floating panel. -->
        <div class="h-full shrink-0 py-4">
          <div class="h-full overflow-hidden rounded-lg" data-testid="album-filter-panel-surface">
            {#if viewMode === AlbumPageViewMode.SELECT_ASSETS}
              {#key `picker-${album.id}`}
                <FilterPanel
                  config={pickerFilterConfig}
                  bind:filters={pickerFilters}
                  {timeBuckets}
                  storageKey="gallery-filter-visible-sections-album-detail"
                  hidden={isTimelineEmpty}
                />
              {/key}
            {:else}
              <!-- Keyed on the search too: switching between browse and query mode swaps the whole
                   suggestions provider, so the panel has to re-run it rather than keep browse facets. -->
              {#key `album-${album.id}:${showSearchResults ? `search-${committedSearchQuery.trim()}:${$lang}` : 'browse'}`}
                <FilterPanel
                  config={albumFilterConfig}
                  bind:filters={albumFilters}
                  bind:collapsed={filterCollapsed}
                  externalToggle
                  timeBuckets={filterTimeBuckets}
                  storageKey="gallery-filter-visible-sections-album-detail"
                  hidden={isTimelineEmpty && !showSearchResults}
                  personNames={albumPersonNames}
                  tagNames={albumTagNames}
                  onFiltersChange={syncAlbumFilterUrl}
                />
              {/key}
            {/if}
          </div>
        </div>

        <div class="flex flex-1 flex-col overflow-hidden pl-2">
          {#if viewMode === AlbumPageViewMode.SELECT_ASSETS && getActiveFilterCount(pickerFilters) > 0}
            <ActiveFiltersBar
              filters={pickerFilters}
              resultCount={totalAssetCount}
              personNames={pickerPersonNames}
              tagNames={pickerTagNames}
              onRemoveFilter={(type, id) => {
                pickerFilters = handlePhotosRemoveFilter(pickerFilters, type, id);
              }}
              onClearAll={() => {
                pickerFilters = clearFilters(pickerFilters);
              }}
            />
          {:else if viewMode !== AlbumPageViewMode.SELECT_ASSETS}
            {#snippet albumFiltersBar()}
              <ActiveFiltersBar
                embedded
                filters={albumFilters}
                resultCount={showSearchResults ? searchTotal : totalAssetCount}
                personNames={albumPersonNames}
                tagNames={albumTagNames}
                ownerNames={albumOwnerNames}
                onRemoveFilter={(type, id) => {
                  if (type === 'timeline') {
                    clearAlbumTemporalFilter();
                  } else {
                    albumFilters = handlePhotosRemoveFilter(albumFilters, type, id);
                    syncAlbumFilterUrl(albumFilters);
                  }
                }}
                onClearAll={() => {
                  albumFilters = clearFilters(albumFilters);
                  temporalAnchor = undefined;
                  syncAlbumFilterUrl(albumFilters);
                }}
                searchQuery={committedSearchQuery}
                onClearSearch={clearAlbumSearch}
                onAddAllToCollection={handleAddAllToCollection}
              />
            {/snippet}
            <FilterToolbar
              class="mb-2"
              grouping={timelineGrouping}
              onGroupingChange={handleTimelineGroupingChange}
              showGrouping={isBrowseTimeline && !showSearchResults && !assetMultiSelectManager.selectionActive}
              showFilters={getActiveFilterCount(albumFilters) > 0 || showSearchResults}
              filters={albumFiltersBar}
              showFilterButton={filterCollapsed &&
                isBrowseTimeline &&
                !assetMultiSelectManager.selectionActive &&
                (!isTimelineEmpty || showSearchResults)}
              filterActive={getActiveFilterCount(albumFilters) > 0}
              onExpandFilters={() => (filterCollapsed = false)}
            />
          {/if}

          {#if showSearchResults && viewMode !== AlbumPageViewMode.SELECT_ASSETS}
            <SmartSearchResults
              searchQuery={committedSearchQuery}
              bind:isLoading={searchIsLoading}
              bind:results={searchResults}
              reloadToken={searchReloadToken}
              filters={albumFilters}
              albumIds={searchAlbumIds}
              language={$lang}
              {isShared}
              total={searchTotal}
            />
          {:else if showFilteredEmptyState}
            <div class="flex flex-1 flex-col items-center justify-center gap-2" data-testid="empty-state-message">
              <p class="text-sm text-(--fg-muted)">
                {viewMode === AlbumPageViewMode.SELECT_ASSETS
                  ? 'No photos available to add match your filters'
                  : 'No photos match your filters'}
              </p>
              <button
                type="button"
                class="text-sm text-(--primary)"
                onclick={() => {
                  if (viewMode === AlbumPageViewMode.SELECT_ASSETS) {
                    pickerFilters = clearFilters(pickerFilters);
                  } else {
                    albumFilters = clearFilters(albumFilters);
                    temporalAnchor = undefined;
                    syncAlbumFilterUrl(albumFilters);
                  }
                }}
              >
                Clear all filters
              </button>
            </div>
          {:else}
            <Timeline
              enableRouting={viewMode === AlbumPageViewMode.SELECT_ASSETS ? false : true}
              {album}
              {albumUsers}
              bind:timelineManager
              {options}
              assetInteraction={currentAssetIntersection}
              {isShared}
              {isSelectionMode}
              {singleSelect}
              {showArchiveIcon}
              {onSelect}
              onEscape={handleEscape}
              withStacked={true}
              onTimelineBucketActivate={isBrowseTimeline ? handleTimelineBucketActivate : undefined}
              temporalAnchor={isBrowseTimeline ? temporalAnchor : undefined}
              onTemporalAnchorResolved={isBrowseTimeline ? () => (temporalAnchor = undefined) : undefined}
              grouping={isBrowseTimeline ? timelineGrouping : 'day'}
              onGroupingChange={isBrowseTimeline ? handleTimelineGroupingChange : undefined}
            >
              {#if viewMode !== AlbumPageViewMode.SELECT_ASSETS}
                {#if viewMode !== AlbumPageViewMode.SELECT_THUMBNAIL}
                  <!-- ALBUM TITLE -->
                  <section class="pt-8 md:pt-24">
                    <AlbumTitle
                      id={album.id}
                      albumName={album.albumName}
                      {isOwned}
                      onUpdate={(albumName) => (album = { ...album, albumName })}
                    />

                    {#if album.assetCount > 0}
                      <AlbumSummary {album} />
                    {/if}

                    <!-- rbac-6: owner-only — the server populates album.sharedSpaceLinks only for
                         the album owner, so this self-hides for every other caller. -->
                    <AlbumSharedSpaceLinks {album} />

                    <!-- ALBUM SHARING -->
                    {#if album.albumUsers.length > 1 || (album.hasSharedLink && isOwned)}
                      <div class="my-3 flex gap-x-1">
                        <button
                          class="flex gap-x-1"
                          type="button"
                          onclick={() => modalManager.show(AlbumOptionsModal, { album, readOnly: !isOwned })}
                        >
                          <!-- owner & users with write access (collaborators) -->
                          {#each album.albumUsers.filter(({ role }) => role === AlbumUserRole.Editor || role === AlbumUserRole.Owner) as { user } (user.id)}
                            <UserAvatar {user} size="md" />
                          {/each}

                          <!-- display ellipsis if there are readonly users too -->
                          {#if albumHasViewers}
                            <IconButton
                              shape="round"
                              aria-label={$t('view_all_users')}
                              color="secondary"
                              size="medium"
                              icon={mdiDotsHorizontal}
                            />
                          {/if}

                          {#if album.hasSharedLink && isOwned}
                            <IconButton
                              aria-label={$t('shared_link_manage_links')}
                              color="secondary"
                              size="medium"
                              shape="round"
                              icon={mdiLink}
                            />
                          {/if}
                        </button>

                        {#if isOwned}
                          <ActionButton action={Share} />
                        {/if}
                      </div>
                    {/if}
                    <AlbumDescription
                      id={album.id}
                      {isOwned}
                      bind:description={() => album.description, (description) => (album = { ...album, description })}
                    />
                  </section>
                {/if}

                {#if album.assetCount === 0}
                  <section id="empty-album" class="mt-50 flex place-content-center place-items-center">
                    <div class="w-75">
                      <p class="text-xs uppercase dark:text-immich-dark-fg">{$t('add_photos')}</p>
                      <button
                        type="button"
                        onclick={() => (viewMode = AlbumPageViewMode.SELECT_ASSETS)}
                        class="mt-5 flex w-full place-items-center gap-6 rounded-2xl border bg-subtle p-8 text-immich-fg transition-all hover:bg-gray-100 hover:text-immich-primary dark:border-none dark:text-immich-dark-fg dark:hover:bg-gray-500/20 dark:hover:text-immich-dark-primary"
                      >
                        <span class="text-primary">
                          <Icon icon={mdiPlus} size="24" />
                        </span>
                        <span class="text-lg">{$t('select_photos')}</span>
                      </button>
                    </div>
                  </section>
                {/if}
              {/if}
            </Timeline>
          {/if}
        </div>
      </div>

      {#if showActivityStatus}
        <div class="absolute inset-e-0 bottom-0 z-2 me-12 mb-6">
          <ActivityStatus
            disabled={!album.isActivityEnabled}
            isLiked={activityManager.isLiked}
            numberOfComments={activityManager.commentCount}
            numberOfLikes={undefined}
            onFavorite={handleFavorite}
          />
        </div>
      {/if}
    </main>

    {#if assetMultiSelectManager.selectionActive}
      <AssetSelectControlBar>
        {@const Actions = getAssetBulkActions($t)}
        <CommandPaletteDefaultProvider name={$t('assets')} actions={Object.values(Actions)} />
        <CreateSharedLink />
        <SelectAllAssets
          timelineManager={showSearchResults ? undefined : timelineManager}
          assetInteraction={assetMultiSelectManager}
          onSelectAll={showSearchResults
            ? () => selectAllSearchResults(searchResults, assetMultiSelectManager)
            : undefined}
        />
        <ActionButton action={Actions.AddToAlbum} />
        {#if assetMultiSelectManager.isAllUserOwned}
          <FavoriteAction removeFavorite={assetMultiSelectManager.isAllFavorite} onFavorite={handleBulkFavorite}
          ></FavoriteAction>
        {/if}
        <ButtonContextMenu icon={mdiDotsVertical} title={$t('menu')} offset={{ x: 175, y: 25 }}>
          <DownloadAction menuItem filename={album.albumName} />
          {#if assetMultiSelectManager.isAllUserOwned}
            <RotateAction />
            <ChangeDate menuItem />
            <ChangeDescription menuItem />
            <ChangeLocation menuItem />
            <ArchiveAction menuItem unarchive={assetMultiSelectManager.isAllArchived} onArchive={handleBulkArchive} />
            <SetVisibilityAction menuItem onVisibilitySet={handleSetVisibility} />
          {/if}
          {#if isEditor && assetMultiSelectManager.assets.length === 1}
            <MenuOption
              text={$t('set_as_album_cover')}
              icon={mdiImageOutline}
              onClick={() => updateThumbnailUsingCurrentSelection()}
            />
          {/if}

          {#if authManager.preferences.tags.enabled && assetMultiSelectManager.isAllUserOwned}
            <TagAction menuItem />
          {/if}

          {#if isOwned || assetMultiSelectManager.isAllUserOwned}
            <RemoveFromAlbum menuItem bind:album onRemove={handleRemoveAssets} />
          {/if}
          {#if assetMultiSelectManager.isAllUserOwned}
            <DeleteAssets menuItem onAssetDelete={handleRemoveAssets} onUndoDelete={handleUndoRemoveAssets} />
          {/if}
        </ButtonContextMenu>
      </AssetSelectControlBar>
    {:else}
      {#if viewMode === AlbumPageViewMode.VIEW}
        <ControlAppBar backIcon={mdiArrowLeft} onClose={() => goto(Route.albums())}>
          {#snippet trailing()}
            <ActionButton action={Cast} />

            {#if isEditor}
              <IconButton
                variant="ghost"
                shape="round"
                color="secondary"
                aria-label={$t('add_photos')}
                onclick={async () => {
                  timelineManager.suspendTransitions = true;
                  viewMode = AlbumPageViewMode.SELECT_ASSETS;
                  oldAt = { at: assetViewerManager.gridScrollTarget?.at };
                  await navigate(
                    { targetRoute: 'current', assetId: null, assetGridRouteSearchParams: { at: null } },
                    { replaceState: true },
                  );
                }}
                icon={mdiImagePlusOutline}
              />
            {/if}

            <ActionButton action={Share} />

            {#if featureFlagsManager.value.map}
              <AlbumMap {album} filters={albumFilters} />
            {/if}

            {#if album.assetCount > 0}
              <IconButton
                shape="round"
                variant="ghost"
                color="secondary"
                aria-label={$t('slideshow')}
                onclick={handleStartSlideshow}
                icon={mdiPresentationPlay}
              />
              <IconButton
                shape="round"
                variant="ghost"
                color="secondary"
                aria-label={$t('download')}
                onclick={() => handleDownloadAlbum(album)}
                icon={mdiDownload}
              />
            {/if}

            {#if isOwned || containsEditors}
              <ButtonContextMenu
                icon={mdiDotsVertical}
                title={$t('album_options')}
                color="secondary"
                offset={{ x: 175, y: 25 }}
              >
                {#if containsEditors}
                  <MenuOption
                    icon={showAlbumUsers ? mdiAccountEye : mdiAccountEyeOutline}
                    text={$t('view_asset_owners')}
                    onClick={() => timelineManager.toggleShowAssetOwners()}
                  />
                {/if}
                {#if isOwned && album.assetCount > 0}
                  <MenuOption
                    icon={mdiImageOutline}
                    text={$t('select_album_cover')}
                    onClick={() => (viewMode = AlbumPageViewMode.SELECT_THUMBNAIL)}
                  />
                  <MenuOption
                    icon={mdiCogOutline}
                    text={$t('options')}
                    onClick={() => modalManager.show(AlbumOptionsModal, { album })}
                  />
                {/if}

                {#if isOwned}
                  <MenuOption
                    icon={mdiLinkVariantPlus}
                    text={$t('link_album_to_space')}
                    onClick={async () => {
                      if (await handleLinkAlbumToSpace(album)) {
                        await refreshAlbum();
                      }
                    }}
                  />
                  <MenuOption
                    icon={mdiDeleteOutline}
                    text={$t('delete_album')}
                    onClick={() => handleDeleteAlbum(album)}
                  />
                {/if}
              </ButtonContextMenu>
            {/if}
          {/snippet}
        </ControlAppBar>
      {/if}

      {#if viewMode === AlbumPageViewMode.SELECT_ASSETS}
        <ControlAppBar onClose={handleCloseSelectAssets}>
          {#snippet leading()}
            <p class="text-lg dark:text-immich-dark-fg">
              {#if !timelineMultiSelectManager.selectionActive}
                {$t('add_to_album')}
              {:else}
                {$t('selected_count', { values: { count: timelineMultiSelectManager.assets.length } })}
              {/if}
            </p>
          {/snippet}

          {#snippet trailing()}
            <HeaderActionButton action={Upload} />
            <HeaderActionButton action={AddAssets} />
          {/snippet}
        </ControlAppBar>
      {/if}

      {#if viewMode === AlbumPageViewMode.SELECT_THUMBNAIL}
        <ControlAppBar onClose={() => (viewMode = AlbumPageViewMode.VIEW)}>
          {#snippet leading()}
            {$t('select_album_cover')}
          {/snippet}
        </ControlAppBar>
      {/if}
    {/if}
  </div>
  {#if album.albumUsers.length > 1 && album && assetViewerManager.isShowActivityPanel && authManager.authenticated && !assetViewerManager.isViewing}
    <div class="flex">
      <div
        transition:fly={{ duration: 150 }}
        id="activity-panel"
        class="z-2 w-90 overflow-y-auto transition-all md:w-115 dark:border-l dark:border-s-immich-dark-gray"
        translate="yes"
      >
        <ActivityViewer disabled={!album.isActivityEnabled} albumUsers={album.albumUsers} albumId={album.id} />
      </div>
    </div>
  {/if}
</div>

<style>
  ::placeholder {
    color: rgb(60, 60, 60);
    opacity: 0.6;
  }

  ::-ms-input-placeholder {
    /* Edge 12 -18 */
    color: white;
  }
</style>
