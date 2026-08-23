<script lang="ts">
  import { goto, invalidateAll, onNavigate } from '$app/navigation';
  import { page } from '$app/state';
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import AlbumTitle from '$lib/components/album-page/AlbumTitle.svelte';
  import AlbumDescription from '$lib/components/album-page/AlbumDescription.svelte';
  import AlbumSummary from '$lib/components/album-page/AlbumSummary.svelte';
  import { isSpaceAlbumRoute } from '$lib/utils/navigation';
  import {
    clearFilters,
    createFilterState,
    getActiveFilterCount,
    loadFilterCollapsed,
    type FilterPanelConfig,
    type FilterState,
  } from '$lib/components/filter-panel/filter-panel';
  import FilterPanel from '$lib/components/filter-panel/filter-panel.svelte';
  import FilterToggleButton from '$lib/components/filter-panel/filter-toggle-button.svelte';
  import ActiveFiltersBar from '$lib/components/filter-panel/active-filters-bar.svelte';
  import ControlAppBar from '$lib/components/shared-components/ControlAppBar.svelte';
  import SelectionToolbar from '$lib/components/timeline/SelectionToolbar.svelte';
  import Timeline from '$lib/components/timeline/Timeline.svelte';
  import TimelineGroupingControl from '$lib/components/timeline/TimelineGroupingControl.svelte';
  import { assetMultiSelectManager, AssetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { getTimelineTopVisibleAnchor } from '$lib/managers/timeline-manager/timeline-anchor';
  import { TimelineManager } from '$lib/managers/timeline-manager/timeline-manager.svelte';
  import type { TimelineAsset, TimelineGrouping, TimelineTemporalAnchor } from '$lib/managers/timeline-manager/types';
  import { addAssetsToAlbumWithOutcome, getAlbumAssetsActions, handleDeleteAlbum } from '$lib/services/album.service';
  import {
    buildAlbumAssetPickerOptions,
    buildAlbumTimelineOptions,
    buildSpaceAlbumAssetPickerOptions,
  } from '$lib/utils/album-filter-options';
  import { buildAlbumAssetPickerFilterConfig, buildAlbumDetailFilterConfig } from '$lib/utils/album-filter-config';
  import { handlePhotosRemoveFilter } from '$lib/utils/photos-filter-options';
  import { clearTimelineTemporalFilter } from '$lib/utils/timeline-temporal-filters';
  import { withNameCapture } from '$lib/utils/filter-name-capture';
  import { filterStateToSearchTerms } from '$lib/utils/filter-search-terms';
  import type { SearchTerms } from '$lib/services/search.service';
  import SmartSearchResults from '$lib/components/search/smart-search-results.svelte';
  import { globalSearchManager } from '$lib/managers/global-search-manager.svelte';
  import { buildFilterStateUrl, isFilterStateUrlUnchanged, withoutAtParam } from '$lib/utils/filter-target';
  import { decodeFilterParams } from '$lib/utils/filter-url';
  import { buildSearchablePageUrl, getSearchablePageState } from '$lib/utils/searchable-page-search';
  import {
    buildSmartSearchFacetKey,
    buildSmartSearchFacetsParams,
    mapSmartSearchFacetsToFilterSuggestions,
  } from '$lib/utils/space-search';
  import { consumeTypedSearchNamesInto } from '$lib/utils/typed-search/typed-search-name-cache';
  import { removeSearchResults, selectAllSearchResults, updateSearchResults } from '$lib/utils/search-result-selection';
  import { untrack } from 'svelte';
  import SearchAddAllToCollectionModal from '$lib/modals/SearchAddAllToCollectionModal.svelte';
  import { lang } from '$lib/stores/preferences.store';
  import { SvelteMap } from 'svelte/reactivity';
  import {
    type ActivatableTimelineBucket,
    getTimelineBucketZoomTarget,
    getTimelineManagerTimeBuckets,
  } from '$lib/utils/timeline-zoom-navigation';
  import {
    AlbumUserRole,
    AssetOrder,
    type AssetVisibility,
    getAlbumInfo,
    searchSmartFacets,
    SharedSpaceRole,
    updateAlbumInfo,
    type AlbumResponseDto,
    type AssetResponseDto,
    type SharedSpaceMemberResponseDto,
    type SharedSpaceResponseDto,
    type SmartSearchFacetsResponseDto,
  } from '@immich/sdk';
  import HeaderActionButton from '$lib/components/HeaderActionButton.svelte';
  import { Icon, IconButton, modalManager, toastManager } from '@immich/ui';
  import { handleError } from '$lib/utils/handle-error';
  import { mdiArrowLeft, mdiImageOutline, mdiImagePlusOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();

  const space: SharedSpaceResponseDto = $derived(data.space);
  const members: SharedSpaceMemberResponseDto[] = $derived(data.members);
  let album = $state<AlbumResponseDto>(data.album);

  // Mode: 'browse' shows the album timeline; 'add' shows the asset picker
  let mode = $state<'browse' | 'add'>('browse');

  // Timeline grouping state — default 'day' gives the flat "All" grid (fixes stuck-cover bug)
  let timelineGrouping = $state<TimelineGrouping>('day');
  let temporalAnchor = $state<TimelineTemporalAnchor | undefined>();
  let timelineManager = $state<TimelineManager>() as TimelineManager;
  let pickerTimelineManager = $state<TimelineManager>() as TimelineManager;

  // Picker multi-select manager (mirrors global album page's timelineMultiSelectManager)
  const pickerMultiSelectManager = new AssetMultiSelectManager();

  /**
   * The route already scopes the timeline to this album, and the server's `albumId` is a SCALAR
   * driving one inner join, so album ∩ album is impossible. A stray `?album=` must be IGNORED:
   * dropping it here keeps it out of the active-filter count, out of the chip bar, and out of the
   * next URL write. Mirrors the global album page's `hydrateAlbumFilters`.
   */
  const hydrateAlbumFilters = (url: URL): FilterState => ({
    ...createFilterState(),
    ...decodeFilterParams(url),
    albumId: undefined,
    sortOrder: getSearchablePageState(url).sortOrder,
  });

  // Independent filter state per mode (mirrors the global album page). Browse filters are
  // URL-backed — the album is a searchable page, so ⌘K writes its filters here.
  let browseFilters = $state(hydrateAlbumFilters(page.url));
  let committedSearchQuery = $state(getSearchablePageState(page.url).query);
  /**
   * Token guard for the re-hydrate $effect below, so our own goto() cannot loop it. Stripped of
   * `at` because closing the asset viewer writes `?at=<assetId>`, which is not a filter change —
   * re-hydrating on it would rebuild an identical FilterState and needlessly re-create the timeline
   * options object. Mirrors the global album page.
   */
  let lastHandledSearch = $state(withoutAtParam(page.url.search));
  const showSearchResults = $derived(committedSearchQuery.trim().length > 0);
  // Loaded smart-search results. The browse Timeline (and its TimelineManager) is unmounted while
  // these show, so the selection toolbar acts on this array instead — mirrors the space timeline.
  let searchResults = $state<AssetResponseDto[]>([]);
  let searchIsLoading = $state(false);
  // Bumped to force a re-run of the current search (undo-delete restores the removed assets).
  let searchReloadToken = $state(0);
  let pickerFilters = $state(createFilterState());
  const browsePersonNames = new SvelteMap<string, string>();
  const browseTagNames = new SvelteMap<string, string>();
  consumeTypedSearchNamesInto(page.url.pathname + page.url.search, browsePersonNames, browseTagNames);
  const pickerPersonNames = new SvelteMap<string, string>();
  const pickerTagNames = new SvelteMap<string, string>();
  const currentMember = $derived(members.find((m) => m.userId === authManager.user.id));
  const isSpaceEditor = $derived(
    currentMember?.role === SharedSpaceRole.Owner || currentMember?.role === SharedSpaceRole.Editor,
  );
  const isAlbumEditor = $derived(
    album.albumUsers.some(
      (au) =>
        au.user.id === authManager.user.id && (au.role === AlbumUserRole.Owner || au.role === AlbumUserRole.Editor),
    ),
  );
  const canManage = $derived(isSpaceEditor || isAlbumEditor);
  // Album title/description editing is owner-gated, mirroring the regular album page's `isOwned`.
  const isOwned = $derived(album.albumUsers[0]?.user.id === authManager.user.id);

  // Match the regular album flow: an abandoned empty + unnamed album (created here and left without a
  // title or any photos) is cleaned up on navigate-away. Deleting it also drops the shared_space_album
  // link (FK cascade), so it won't linger as a nameless, empty card in the space.
  onNavigate(async ({ to }) => {
    if (!isSpaceAlbumRoute(to?.route.id) && album.assetCount === 0 && !album.albumName) {
      await handleDeleteAlbum(album, { notify: false, prompt: false });
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
   * temporal picker's buckets while a query is running. Album-scoped, never space-scoped: see
   * `searchAlbumIds`. Memoised on the request shape so a filter change that cannot alter the facets
   * (sortOrder) does not refetch.
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

  const browseFilterConfig = $derived.by<FilterPanelConfig>(() => {
    const base = buildAlbumDetailFilterConfig(album.id);
    const browseProvider = base.suggestionsProvider!;
    return withNameCapture(
      {
        ...base,
        // Browse mode asks the album's own suggestion endpoint; query mode has to ask the SEARCH,
        // or the panel would offer facets that the visible results do not contain.
        suggestionsProvider: async (nextFilters: FilterState) => {
          if (!showSearchResults) {
            return browseProvider(nextFilters);
          }
          const facets = await loadAlbumSmartFacets(nextFilters);
          return facets ? mapSmartSearchFacetsToFilterSuggestions(facets) : emptyFilterSuggestions();
        },
      },
      browsePersonNames,
      browseTagNames,
    );
  });
  const browseTotal = $derived(timelineManager?.assetCount ?? 0);
  const browseHasMonths = $derived((timelineManager?.months?.length ?? 0) > 0);
  const browseActive = $derived(getActiveFilterCount(browseFilters));
  const isBrowseEmpty = $derived(
    timelineManager?.isInitialized && !browseHasMonths && browseTotal === 0 && browseActive === 0,
  );

  // Filter-panel collapse is driven here so the header filter button can reclaim the panel's space.
  let filterCollapsed = $state(loadFilterCollapsed());
  const showBrowseFilteredEmpty = $derived(
    timelineManager?.isInitialized && !browseHasMonths && browseTotal === 0 && browseActive > 0,
  );
  const browseTimeBuckets = $derived(getTimelineManagerTimeBuckets(timelineManager));
  // While a query is running the panel's temporal picker must bucket the MATCHES, not the album.
  const filterTimeBuckets = $derived(showSearchResults ? (smartFacets?.timeBuckets ?? []) : browseTimeBuckets);
  const searchTotal = $derived(showSearchResults ? smartFacets?.total : undefined);

  /**
   * The album scope handed to smart search. Deliberately the album alone, with no `spaceId`: this
   * page's browse timeline is album-scoped too (`buildAlbumTimelineOptions`), and its filter panel
   * speaks the personal person tokens that go with that. Sending `spaceId` as well would also be
   * actively wrong server-side — `albumIds` makes the service resolve `timelineSpaceIds`, and the
   * `spaceId` predicate is skipped whenever those are set (`database.ts`), so the space scope would
   * silently widen to every space the caller is in rather than narrowing anything.
   */
  const searchAlbumIds = $derived([album.id]);

  /**
   * Browse order. An album carries its own `order`, but the navbar sort dropdown is rendered on
   * every searchable page — browse mode included — so an EXPLICIT `?sort=` has to win, or the
   * control would visibly do nothing here. Absent that param the album's own order stands.
   */
  const browseOrder = $derived.by(() => {
    if (!getSearchablePageState(page.url).hasExplicitSort) {
      return album.order ?? authManager.preferences.albums.defaultAssetOrder;
    }
    return browseFilters.sortOrder === 'asc' ? AssetOrder.Asc : AssetOrder.Desc;
  });

  const browseOptions = $derived({
    ...buildAlbumTimelineOptions(album.id, browseOrder, browseFilters),
    // The grouping MUST live in the options object — that is what the TimelineManager reads to
    // build buckets. The top-level <Timeline grouping={...}> prop alone does not re-group.
    grouping: timelineGrouping,
  });

  $effect(() => globalSearchManager.registerSearchablePageFilters(() => browseFilters));

  /** Write a filter change back to the URL — the album page's half of the hydrate → write → react
   *  loop. `buildFilterStateUrl` (not `buildSearchablePageUrl`) because it keeps the CURRENT
   *  pathname: the panel can be used with the asset viewer open, and targeting the base path would
   *  close it on every filter tweak. It preserves `q` and `sort` as ordinary non-filter params. */
  function syncFilterUrl(nextFilters: FilterState) {
    const nextUrl = buildFilterStateUrl(page.url, nextFilters);
    // NOT a string compare: buildFilterStateUrl re-appends the filter params last, so an unchanged
    // state can come back re-ordered. See filter-target.ts.
    if (isFilterStateUrlUnchanged(page.url, nextUrl)) {
      return;
    }
    void goto(nextUrl, { replaceState: true, keepFocus: true, noScroll: true });
  }

  const clearSearch = () => {
    searchIsLoading = false;
    const nextUrl = buildSearchablePageUrl(page.url, '', browseFilters.sortOrder, browseFilters);
    if (!nextUrl) {
      return;
    }
    void goto(nextUrl, { replaceState: true, keepFocus: true, noScroll: true });
  };

  // Re-hydrate from the URL on every change we did not just make: back/forward, a shared link, a
  // ⌘K search, and the `?at=` write from closing the asset viewer (stripped, see lastHandledSearch).
  $effect(() => {
    const nextSearch = withoutAtParam(page.url.search);
    if (nextSearch === lastHandledSearch) {
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
      browseFilters = hydrateAlbumFilters(page.url);
      committedSearchQuery = nextQuery;
      searchIsLoading = false;
      lastHandledSearch = nextSearch;
      consumeTypedSearchNamesInto(page.url.pathname + page.url.search, browsePersonNames, browseTagNames);
    });
  });

  // Mirror the global album page: collect every asset matching the active browse filters
  // (scoped to this album) into another album/space. ActiveFiltersBar self-gates the button
  // on there being active filters + results.
  const handleAddAllToCollection = () => {
    const query = committedSearchQuery.trim();
    const terms: SearchTerms = { ...filterStateToSearchTerms(browseFilters), albumIds: [album.id] };
    if (query) {
      terms.query = query;
    }
    void modalManager.show(SearchAddAllToCollectionModal, {
      terms,
      total: showSearchResults ? (searchTotal ?? 0) : browseTotal,
      smartSearchEnabled: !!query,
      language: $lang,
    });
  };

  const pickerFilterConfig = $derived(
    withNameCapture(buildAlbumAssetPickerFilterConfig(), pickerPersonNames, pickerTagNames),
  );
  const pickerTotal = $derived(pickerTimelineManager?.assetCount ?? 0);
  const pickerHasMonths = $derived((pickerTimelineManager?.months?.length ?? 0) > 0);
  const pickerActive = $derived(getActiveFilterCount(pickerFilters));
  const isPickerEmpty = $derived(
    pickerTimelineManager?.isInitialized && !pickerHasMonths && pickerTotal === 0 && pickerActive === 0,
  );
  const showPickerFilteredEmpty = $derived(
    pickerTimelineManager?.isInitialized && !pickerHasMonths && pickerTotal === 0 && pickerActive > 0,
  );
  const pickerTimeBuckets = $derived(getTimelineManagerTimeBuckets(pickerTimelineManager));

  // 'mine' = the caller's own timeline (the long-standing behaviour). 'space' = the space pool,
  // which also surfaces other members' photos; adding those goes through the #764 contribution
  // path, exactly like the space timeline's "+". Space Owner/Editor only — see pickerCanUseSpace.
  let pickerSource = $state<'mine' | 'space'>('mine');
  const pickerCanUseSpace = $derived(isSpaceEditor);
  const pickerOptions = $derived(
    pickerSource === 'space' && pickerCanUseSpace
      ? buildSpaceAlbumAssetPickerOptions(space.id, album.id, pickerFilters)
      : buildAlbumAssetPickerOptions(album.id, pickerFilters),
  );

  const setPickerSource = (source: 'mine' | 'space') => {
    if (source === pickerSource) {
      return;
    }
    // A selection must never span both pools: the two sources are different queries and the
    // add call is built from whatever is selected when it fires.
    pickerMultiSelectManager.clear();
    pickerSource = source;
  };

  const refreshAlbum = async () => {
    album = await getAlbumInfo({ id: album.id });
  };

  // While search results are showing, <Timeline> is unmounted and its manager destroyed — every
  // bulk action has to mutate the results array instead, or it silently no-ops and the asset stays
  // on screen (#908, same split the space timeline makes).
  const handleRemoveAssets = (assetIds: string[]) => {
    // Prune the browse timeline immediately so removed photos don't linger.
    // RemoveFromAlbumAction already re-fetches the album via bind:album and clears the
    // selection internally before firing onRemove, so we only need to defensively clear here.
    if (showSearchResults) {
      removeSearchResults(searchResults, assetIds);
    } else {
      timelineManager?.removeAssets(assetIds);
    }
    assetMultiSelectManager.clear();
  };

  // Mirrors the space timeline page's `handleSetVisibility`: moving assets to/from the locked
  // folder takes them out of this (non-locked) timeline view. It isn't an album-membership
  // change (RemoveFromAlbum is the only membership mutation this route offers), so it doesn't
  // touch album.assetCount either.
  const handleFavorite = (ids: string[], isFavorite: boolean) => {
    if (showSearchResults) {
      updateSearchResults(searchResults, ids, (asset) => (asset.isFavorite = isFavorite));
      return;
    }
    timelineManager?.update(ids, (asset) => (asset.isFavorite = isFavorite));
  };

  const handleArchive = (ids: string[], visibility: AssetVisibility) => {
    if (showSearchResults) {
      updateSearchResults(searchResults, ids, (asset) => (asset.visibility = visibility));
      return;
    }
    timelineManager?.update(ids, (asset) => (asset.visibility = visibility));
  };

  const handleSetVisibility = (assetIds: string[]) => {
    if (showSearchResults) {
      removeSearchResults(searchResults, assetIds);
    } else {
      timelineManager?.removeAssets(assetIds);
    }
    assetMultiSelectManager.clear();
  };

  // DeleteAssets already performed the server-side trash before calling this. Unlike the space
  // timeline page (which has `<OnEvents onAssetsDelete={refreshSpace} />` to pick up
  // server-truth counts after a trash), this page has no such websocket wiring — mirroring the
  // space-person page's identical reasoning — so force a data reload here to keep
  // album.assetCount in sync with the server.
  const handleAssetDelete = (assetIds: string[]) => {
    if (showSearchResults) {
      removeSearchResults(searchResults, assetIds);
    } else {
      timelineManager?.removeAssets(assetIds);
    }
    void invalidateAll();
  };

  // Mirrors the space timeline page's `handleUndoAssetDelete`. There's no websocket event for
  // restore, so re-add the assets to the local view directly; no count refresh is needed since
  // undoing a delete doesn't change album membership either.
  const handleUndoAssetDelete = (assets: TimelineAsset[]) => {
    if (showSearchResults) {
      // Undo hands back TimelineAssets; the results list holds full AssetResponseDtos, so
      // re-running the search is how they come back.
      searchReloadToken++;
      return;
    }
    timelineManager?.upsertAssets(assets);
  };

  // Cover setter for the full toolbar's "set_as_album_cover" menu item (canManage-gated, single
  // asset only — see getSelectionCapabilities' canSetCover). Mirrors the regular album page's
  // `updateThumbnailUsingCurrentSelection`; this route has no dedicated SELECT_THUMBNAIL mode, so
  // it always operates on the current bulk selection.
  const handleSetAlbumCover = async () => {
    const assets = assetMultiSelectManager.assets;
    if (assets.length !== 1) {
      return;
    }
    try {
      await updateAlbumInfo({ id: album.id, updateAlbumDto: { albumThumbnailAssetId: assets[0].id } });
      await refreshAlbum();
      toastManager.primary($t('album_cover_updated'));
      assetMultiSelectManager.clear();
    } catch (error) {
      handleError(error, $t('errors.unable_to_update_album_cover'));
    }
  };

  function resetPicker() {
    pickerFilters = createFilterState();
    pickerPersonNames.clear();
    pickerTagNames.clear();
    pickerMultiSelectManager.clear();
    timelineGrouping = 'day';
    temporalAnchor = undefined;
  }

  function enterAddMode() {
    resetPicker();
    mode = 'add';
  }

  const handleExitAddMode = () => {
    resetPicker();
    mode = 'browse';
  };

  const handleAddAssetsSuccess = async (added: TimelineAsset[] = []) => {
    timelineManager?.upsertAssets(added);
    resetPicker();
    mode = 'browse';
    await refreshAlbum();
  };

  // Navigating straight from one album to a sibling (the sidebar drill-down) keeps this component
  // instance alive — SvelteKit only swaps `data`. Local album-scoped state therefore has to be
  // re-seeded by hand, or the URL changes while the page keeps rendering the album we came from.
  // Mirrors the identical effect on the global album route.
  $effect(() => {
    if (data.album.id === album.id) {
      return;
    }

    album = data.album;
    mode = 'browse';
    // Re-seed from the URL, not from a blank slate: the sibling album's own URL carries its query
    // and filters, and a bare reset would drop a ⌘K search the moment it navigated.
    browseFilters = hydrateAlbumFilters(page.url);
    committedSearchQuery = getSearchablePageState(page.url).query;
    lastHandledSearch = withoutAtParam(page.url.search);
    searchIsLoading = false;
    smartFacetInFlight?.controller.abort();
    smartFacets = undefined;
    smartFacetKey = '';
    smartFacetInFlight = undefined;
    browsePersonNames.clear();
    browseTagNames.clear();
    consumeTypedSearchNamesInto(page.url.pathname + page.url.search, browsePersonNames, browseTagNames);
    assetMultiSelectManager.clear();
    resetPicker();
  });

  function handleTimelineGroupingChange(grouping: TimelineGrouping) {
    const anchor = getTimelineTopVisibleAnchor(timelineManager);
    timelineGrouping = grouping;
    temporalAnchor = anchor;
  }

  function handleTimelineBucketActivate(bucket: ActivatableTimelineBucket) {
    if (mode !== 'browse' || assetMultiSelectManager.selectionActive) {
      return;
    }
    const result = getTimelineBucketZoomTarget(bucket);
    if (!result) {
      return;
    }
    timelineGrouping = result.grouping;
    temporalAnchor = result.anchor;
  }

  const { AddAssets, Upload } = $derived(getAlbumAssetsActions($t, album, pickerMultiSelectManager.assets));
</script>

<!-- Header shows the space (context/breadcrumb); the album name lives in the editable AlbumTitle in the
     timeline below, mirroring the regular album page (which has no page-header title). -->
<UserPageLayout hideNavbar={assetMultiSelectManager.selectionActive} title={space.name}>
  {#snippet leading()}
    <IconButton
      variant="ghost"
      shape="round"
      color="secondary"
      aria-label={$t('back')}
      onclick={() => void goto(`/spaces/${space.id}/albums`)}
      icon={mdiArrowLeft}
    />
  {/snippet}

  {#snippet buttons()}
    {#if canManage && mode === 'browse'}
      <IconButton
        variant="ghost"
        shape="round"
        color="secondary"
        aria-label={$t('space_album_add_photos')}
        data-testid="add-photos-button"
        onclick={enterAddMode}
        icon={mdiImagePlusOutline}
      />
    {/if}
  {/snippet}

  {#if mode === 'browse'}
    <div class="flex h-full">
      {#if !assetMultiSelectManager.selectionActive}
        <!-- Keyed on the search too: switching between browse and query mode swaps the whole
             suggestions provider, so the panel has to re-run it rather than keep browse facets. -->
        {#key `space-album-${album.id}:${showSearchResults ? `search-${committedSearchQuery.trim()}:${$lang}` : 'browse'}`}
          <FilterPanel
            config={browseFilterConfig}
            bind:filters={browseFilters}
            bind:collapsed={filterCollapsed}
            externalToggle
            timeBuckets={filterTimeBuckets}
            storageKey="gallery-filter-visible-sections-space-album"
            hidden={isBrowseEmpty && !showSearchResults}
            personNames={browsePersonNames}
            tagNames={browseTagNames}
            onFiltersChange={syncFilterUrl}
          />
        {/key}
      {/if}

      <div class="flex flex-1 flex-col overflow-hidden pl-2">
        {#if !assetMultiSelectManager.selectionActive}
          <div
            class="mb-2 shrink-0 items-center gap-2 bg-transparent py-2 pe-4 dark:bg-transparent {filterCollapsed &&
            !isBrowseEmpty
              ? 'flex ps-2'
              : 'hidden ps-4 md:flex'}"
          >
            {#if filterCollapsed && !isBrowseEmpty}
              <!-- Visible at EVERY viewport: the panel's own collapse control has no breakpoint gate,
                   so the reopen affordance can't be desktop-only either (#752 launch review F3). -->
              <FilterToggleButton active={browseActive > 0} onExpand={() => (filterCollapsed = false)} />
            {/if}
            <div class="hidden md:flex md:items-center" data-testid="timeline-desktop-grouping-control">
              <TimelineGroupingControl grouping={timelineGrouping} onGroupingChange={handleTimelineGroupingChange} />
            </div>
          </div>
        {/if}

        {#if browseActive > 0 || showSearchResults}
          <div class="mb-4 shrink-0">
            <ActiveFiltersBar
              filters={browseFilters}
              resultCount={showSearchResults ? searchTotal : browseTotal}
              personNames={browsePersonNames}
              tagNames={browseTagNames}
              onRemoveFilter={(type, id) => {
                if (type === 'timeline') {
                  browseFilters = clearTimelineTemporalFilter(browseFilters);
                  temporalAnchor = undefined;
                } else {
                  browseFilters = handlePhotosRemoveFilter(browseFilters, type, id);
                }
                syncFilterUrl(browseFilters);
              }}
              onClearAll={() => {
                browseFilters = clearFilters(browseFilters);
                temporalAnchor = undefined;
                syncFilterUrl(browseFilters);
              }}
              searchQuery={committedSearchQuery}
              onClearSearch={clearSearch}
              onAddAllToCollection={handleAddAllToCollection}
            />
          </div>
        {/if}

        {#if showSearchResults}
          <SmartSearchResults
            searchQuery={committedSearchQuery}
            bind:isLoading={searchIsLoading}
            bind:results={searchResults}
            reloadToken={searchReloadToken}
            filters={browseFilters}
            albumIds={searchAlbumIds}
            language={$lang}
            space={{ id: space.id, canWrite: isSpaceEditor }}
            isShared={album.shared}
            total={searchTotal}
          />
        {:else if showBrowseFilteredEmpty}
          <div class="flex flex-1 flex-col items-center justify-center gap-2" data-testid="browse-filtered-empty">
            <p class="text-sm text-gray-500 dark:text-gray-400">{$t('space_album_no_photos_match_filters')}</p>
            <button
              type="button"
              data-testid="browse-clear-filters"
              class="text-sm text-(--primary)"
              onclick={() => {
                browseFilters = clearFilters(browseFilters);
                temporalAnchor = undefined;
                // The filters are URL-backed now: without this the params survive the "clear",
                // so a refresh or back/forward restores what the user just cleared.
                syncFilterUrl(browseFilters);
              }}
            >
              {$t('space_album_clear_all_filters')}
            </button>
          </div>
        {:else}
          <Timeline
            enableRouting={true}
            options={browseOptions}
            bind:timelineManager
            assetInteraction={assetMultiSelectManager}
            isSelectionMode={false}
            singleSelect={false}
            space={{ id: space.id, canWrite: isSpaceEditor }}
            grouping={timelineGrouping}
            onGroupingChange={handleTimelineGroupingChange}
            onTimelineBucketActivate={handleTimelineBucketActivate}
            {temporalAnchor}
            onTemporalAnchorResolved={() => (temporalAnchor = undefined)}
          >
            <!-- Editable album header (Timeline leading content — always rendered, incl. for an empty
                 album so it can be named). Owner-gated, mirroring the regular album page. Unlike that
                 page, the header + period control already sit above, so it needs almost no top padding. -->
            <section class="pt-2">
              <AlbumTitle
                id={album.id}
                albumName={album.albumName}
                {isOwned}
                onUpdate={(albumName) => (album = { ...album, albumName })}
              />
              {#if album.assetCount > 0}
                <AlbumSummary {album} />
              {/if}
              <AlbumDescription
                id={album.id}
                {isOwned}
                bind:description={() => album.description, (description) => (album = { ...album, description })}
              />
            </section>

            {#snippet empty()}
              <section class="mt-50 flex place-content-center place-items-center">
                <div class="flex flex-col items-center gap-4 text-center">
                  <Icon icon={mdiImageOutline} size="3.5em" class="text-gray-400" />
                  <p class="text-lg text-gray-500 dark:text-gray-400">{$t('no_assets_to_show')}</p>
                  {#if canManage}
                    <button
                      type="button"
                      data-testid="empty-add-photos-button"
                      class="text-sm text-(--primary)"
                      onclick={enterAddMode}
                    >
                      {$t('add_photos')}
                    </button>
                  {/if}
                </div>
              </section>
            {/snippet}
          </Timeline>
        {/if}
      </div>
    </div>
  {/if}
</UserPageLayout>

<!-- Browse selection toolbar (shows when assets are selected in browse mode). Rendered OUTSIDE
     UserPageLayout: its wrapper is `relative z-0`, which is a stacking context, so a toolbar nested
     inside it (and before the Timeline) paints UNDER the asset grid and the z-1 scrubber. Matching the
     other timeline pages (recently-added/favorites/space timeline/…), the bar sits after the layout so
     it paints on top.

     rbac-5/albums-8 REVERSED (Slice 6): this route now renders the full album-equivalent
     <SelectionToolbar> — the same component the regular album page and the direct-space/space-person
     timelines use — instead of the stripped Download+Remove-only bar it originally shipped with. Two
     RBAC facts make the reversal safe:
       - Owner-gated mutations (Share/Add-to-album/Favorite/Rotate/ChangeDate/ChangeDescription/
         ChangeLocation/Archive/SetVisibility/Tag/Delete) are gated by `sel.isAllUserOwned` in
         getSelectionCapabilities, and the server's AssetUpdate access check (access.ts:155-159) checks
         asset OWNERSHIP first, before any album/space role: `isOwner = checkOwnerAccess(...)` is unioned
         with the space-editor arm, so an owner editing their own asset is NEVER blocked by the album
         path. Exposing these actions here for an all-owned selection is exactly as safe as on the
         regular album page.
       - `canRemoveFromAlbum` stays `canManage`-only (space.canWrite || album.isEditor) — ownership alone
         never grants it — because the server's `AlbumAssetDelete` is role-gated
         (shared-space-album-scope.guard.spec.ts pins this): a non-manager can't remove even their own
         asset from the album (decision C).
     Space-editor cross-owner metadata edits are still never offered on a mixed/not-owned selection:
     `isAllUserOwned` gates the whole metadata-edit block, matching the merged direct-space timeline. -->
{#if mode === 'browse' && assetMultiSelectManager.selectionActive}
  <SelectionToolbar
    timelineManager={showSearchResults ? undefined : timelineManager}
    assetInteraction={assetMultiSelectManager}
    {album}
    space={{ id: space.id, canWrite: isSpaceEditor }}
    downloadFilename={`${album.albumName}.zip`}
    onSelectAll={showSearchResults ? () => selectAllSearchResults(searchResults, assetMultiSelectManager) : undefined}
    onRemove={handleRemoveAssets}
    onSetCover={handleSetAlbumCover}
    onFavorite={handleFavorite}
    onArchive={handleArchive}
    onVisibilitySet={handleSetVisibility}
    onAssetDelete={handleAssetDelete}
    onUndoDelete={handleUndoAssetDelete}
  />
{/if}

{#if mode === 'add'}
  <section class="fixed inset-0 z-40 bg-immich-bg dark:bg-immich-dark-bg" data-testid="add-photos-overlay">
    <!--
      The sidebar + picker Timeline live inside <main>; the ControlAppBar is rendered AFTER it. The
      bar is `position: absolute` with auto z-index, so it would be painted under the full-height
      <main> (swallowing clicks on the trailing Upload/Add buttons) if it came first. Keeping it last
      — as the global album page does — lets it paint on top while staying pinned to the top.
    -->
    <main class="relative h-dvh overflow-hidden pt-(--control-bar-height)" data-testid="add-photos-timeline-main">
      <div class="flex h-full">
        {#key `space-album-picker-${album.id}`}
          <FilterPanel
            config={pickerFilterConfig}
            bind:filters={pickerFilters}
            timeBuckets={pickerTimeBuckets}
            storageKey="gallery-filter-visible-sections-space-album-picker"
            hidden={isPickerEmpty}
          />
        {/key}
        <div class="flex flex-1 flex-col overflow-hidden px-2 md:px-6">
          {#if pickerCanUseSpace}
            <!-- Source switch: the picker has always browsed the caller's own photos, which meant
                 a space album could not pull in another member's photo even though the space
                 timeline's "+" can push that same photo into that same album. -->
            <!-- Wraps and truncates rather than clipping: the filter panel is a fixed w-64 that does
                 not shrink, so on a narrow viewport this column can be ~120px wide, and the parent
                 is overflow-hidden — a fixed-width segmented control would simply be cut in half. -->
            <div
              class="mb-3 flex max-w-full shrink-0 flex-wrap items-center gap-1 self-start rounded-lg bg-gray-100 p-1 dark:bg-gray-800"
              role="group"
              aria-label={$t('space_album_picker_source')}
              data-testid="picker-source-toggle"
            >
              <button
                type="button"
                data-testid="picker-source-mine"
                aria-pressed={pickerSource === 'mine'}
                class="min-w-0 truncate rounded-md px-3 py-1 text-sm transition-colors"
                class:bg-white={pickerSource === 'mine'}
                class:dark:bg-gray-900={pickerSource === 'mine'}
                class:font-semibold={pickerSource === 'mine'}
                onclick={() => setPickerSource('mine')}
              >
                {$t('space_album_picker_source_mine')}
              </button>
              <button
                type="button"
                data-testid="picker-source-space"
                aria-pressed={pickerSource === 'space'}
                class="min-w-0 truncate rounded-md px-3 py-1 text-sm transition-colors"
                class:bg-white={pickerSource === 'space'}
                class:dark:bg-gray-900={pickerSource === 'space'}
                class:font-semibold={pickerSource === 'space'}
                onclick={() => setPickerSource('space')}
              >
                {$t('space_album_picker_source_space')}
              </button>
            </div>
          {/if}

          {#if pickerActive > 0}
            <div class="mb-4 shrink-0">
              <ActiveFiltersBar
                filters={pickerFilters}
                resultCount={pickerTotal}
                personNames={pickerPersonNames}
                tagNames={pickerTagNames}
                onRemoveFilter={(type, id) => (pickerFilters = handlePhotosRemoveFilter(pickerFilters, type, id))}
                onClearAll={() => (pickerFilters = clearFilters(pickerFilters))}
              />
            </div>
          {/if}

          {#if showPickerFilteredEmpty}
            <div class="flex flex-1 flex-col items-center justify-center gap-2" data-testid="picker-filtered-empty">
              <p class="text-sm text-gray-500 dark:text-gray-400">{$t('space_album_no_photos_to_add_match_filters')}</p>
              <button
                type="button"
                data-testid="picker-clear-filters"
                class="text-sm text-(--primary)"
                onclick={() => (pickerFilters = clearFilters(pickerFilters))}
              >
                {$t('space_album_clear_all_filters')}
              </button>
            </div>
          {:else}
            <Timeline
              enableRouting={false}
              options={pickerOptions}
              bind:timelineManager={pickerTimelineManager}
              assetInteraction={pickerMultiSelectManager}
              isSelectionMode={true}
              singleSelect={false}
            />
          {/if}
        </div>
      </div>
    </main>
    <ControlAppBar onClose={handleExitAddMode}>
      {#snippet leading()}
        <p class="text-lg dark:text-immich-dark-fg">
          {#if !pickerMultiSelectManager.selectionActive}
            {$t('add_to_album')}
          {:else}
            {$t('selected_count', { values: { count: pickerMultiSelectManager.assets.length } })}
          {/if}
        </p>
      {/snippet}

      {#snippet trailing()}
        <HeaderActionButton action={Upload} />
        <HeaderActionButton
          action={{
            ...AddAssets,
            onAction: () => {
              const selected = pickerMultiSelectManager.assets;
              void addAssetsToAlbumWithOutcome(
                album.id,
                selected.map(({ id }) => id),
                { notify: true },
              ).then(({ ok, addedIds, deniedIds }) => {
                // The server answers 200 with per-asset outcomes, so only paint in what it
                // actually accepted — a denied asset would otherwise appear and then vanish on
                // reload. Stay in the picker only when the server genuinely REFUSED something and
                // nothing landed; a selection that was entirely duplicates has nothing left to do,
                // so it closes like any other success rather than trapping the user.
                if (!ok || (addedIds.length === 0 && deniedIds.length > 0)) {
                  return;
                }
                const accepted = new Set(addedIds);
                return handleAddAssetsSuccess(selected.filter(({ id }) => accepted.has(id)));
              });
            },
          }}
        />
      {/snippet}
    </ControlAppBar>
  </section>
{/if}
