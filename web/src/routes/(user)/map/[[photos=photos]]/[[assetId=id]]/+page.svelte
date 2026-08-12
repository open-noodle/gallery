<script lang="ts">
  import { lazyComponent } from '$lib/utils/lazy-component.svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import ActiveFiltersBar from '$lib/components/filter-panel/active-filters-bar.svelte';
  import FilterPanel from '$lib/components/filter-panel/filter-panel.svelte';
  import FilterToggleButton from '$lib/components/filter-panel/filter-toggle-button.svelte';
  import {
    clearFilters,
    createFilterState,
    getActiveFilterCount,
    loadFilterCollapsed,
  } from '$lib/components/filter-panel/filter-panel';
  import type { FilterState } from '$lib/components/filter-panel/filter-panel';
  import { handlePhotosRemoveFilter } from '$lib/utils/photos-filter-options';
  import { buildMapMarkerOptions, buildMapTimeBucketOptions } from '$lib/utils/map-filter-options';
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import OnEvents from '$lib/components/OnEvents.svelte';
  import MapTimelinePanel from './MapTimelinePanel.svelte';
  import type { SelectionBBox } from '$lib/components/shared-components/map/types';
  import { QueryParameter, timeToLoadTheMap } from '$lib/constants';
  import Portal from '$lib/elements/Portal.svelte';
  import { assetViewerManager } from '$lib/managers/asset-viewer-manager.svelte';
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import { Route } from '$lib/route';
  import { handlePromiseError } from '$lib/utils';
  import { delay } from '$lib/utils/asset-utils';
  import { clusterMarkerIdsInBBox } from '$lib/utils/map-cluster-selection';
  import { buildMapFilterConfig } from '$lib/utils/map-filter-config';
  import { buildFilterStateUrl, isFilterStateUrlUnchanged, withoutAtParam } from '$lib/utils/filter-target';
  import { decodeFilterParams } from '$lib/utils/filter-url';
  import { navigate } from '$lib/utils/navigation';
  import { mapSettings } from '$lib/stores/preferences.store';
  import { buildSmartSearchParams, SEARCH_FILTER_DEBOUNCE_MS } from '$lib/utils/space-search';
  import {
    AssetVisibility,
    getFilteredMapMarkers,
    getTimeBuckets,
    type MapMarkerResponseDto,
    searchSmart,
  } from '@immich/sdk';
  import { IconButton, modalManager } from '@immich/ui';
  import SearchAddAllToCollectionModal from '$lib/modals/SearchAddAllToCollectionModal.svelte';
  import type { SearchTerms } from '$lib/services/search.service';
  import { resolveFilterNames } from '$lib/utils/filter-name-resolution';
  import { filterStateToSearchTerms } from '$lib/utils/filter-search-terms';
  import { lang } from '$lib/stores/preferences.store';
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';
  import { mdiArrowLeft } from '@mdi/js';
  import { onDestroy, onMount, untrack } from 'svelte';
  import { t } from 'svelte-i18n';
  import type { PageData } from './$types';
  import LoadingSpinner from '$lib/components/shared-components/LoadingSpinner.svelte';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();

  const spaceId = $derived(page.url.searchParams.get(QueryParameter.SPACE_ID) || undefined);
  const committedQuery = $derived(page.url.searchParams.get('q') ?? '');

  let selectedClusterBBox = $state.raw<SelectionBBox>();
  let isTimelinePanelVisible = $state(false);
  let showMobileFilters = $state(false);
  let isMobile = $state(false);

  function checkMobile() {
    isMobile = window.innerWidth < 640;
    if (!isMobile) {
      showMobileFilters = false;
    }
  }

  onMount(() => {
    checkMobile();
    // ResizeObserver observes elements, not the viewport; this tracks window width
    // to switch the map between mobile and desktop layouts.
    // eslint-disable-next-line unicorn/prefer-observer-apis
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  });

  // #767(b): this used to be an always-empty createFilterState(), so every filter active on the
  // surface you came from was dropped the moment you reached the map. The URL is the source of
  // truth now.
  //
  // Unlike the album page, the map KEEPS an albumId filter — /map?albumId=X is a legitimate scope
  // (that is what the server-side album-access fix in this slice exists for) — EXCEPT when the map is
  // already scoped to a space. Space ∩ album is unsatisfiable (the space scope demands the asset be
  // in the space; albumSharedSpaceScope, run with no timelineSpaceIds under a spaceId query, demands
  // it be in no space at all) and the server 400s it. Dropping it here means a hand-typed
  // /map?spaceId=S&albumId=A degrades to the space map instead of erroring.
  const hydrateMapFilters = (url: URL): FilterState => {
    const decoded = decodeFilterParams(url);
    const urlSpaceId = url.searchParams.get(QueryParameter.SPACE_ID) || undefined;
    return { ...createFilterState(), ...decoded, albumId: urlSpaceId ? undefined : decoded.albumId };
  };

  // Filter state
  let filters = $state<FilterState>(hydrateMapFilters(page.url));
  // Token guard for the URL $effect below, at-stripped like the album page — see withoutAtParam's
  // docs: replaceScrollTarget writes `?at=<assetId>` onto /map when the timeline panel's asset
  // viewer closes, and that is not a filter change. Re-hydrating on it is pure churn — the
  // FilterState it would rebuild is identical, since every filter is URL-backed — and it would
  // needlessly re-create `filters`, re-running the debounced marker/bucket fetch below.
  let lastHandledFilterSearch = $state(withoutAtParam(page.url.search));
  let mapMarkers = $state<MapMarkerResponseDto[]>([]);
  let timeBuckets = $state<Array<{ timeBucket: string; count: number }>>([]);
  let personNames = new SvelteMap<string, string>();
  let tagNames = new SvelteMap<string, string>();
  // /map?albumId=… and ?ownerId=… survive a reload and travel in a shared link, and nothing on this
  // page knows their names — resolve them by id, once, so the chip is a name and not a UUID.
  let albumNames = new SvelteMap<string, string>();
  let ownerNames = new SvelteMap<string, string>();
  $effect(() => {
    void resolveFilterNames(filters, { albumNames, ownerNames });
  });

  const filterConfig = $derived.by(() => {
    const base = buildMapFilterConfig(spaceId);
    const originalProvider = base.suggestionsProvider!;
    return {
      ...base,
      suggestionsProvider: async (f: FilterState) => {
        const result = await originalProvider(f);
        for (const p of result.people) {
          personNames.set(p.id, p.name);
        }
        for (const t of result.tags) {
          tagNames.set(t.id, t.name);
        }
        return result;
      },
    };
  });
  const hasActiveFilters = $derived(getActiveFilterCount(filters) > 0 || committedQuery.trim().length > 0);

  // Desktop filter-panel collapse — driven from a header filter button so the collapsed panel doesn't
  // float over the map's own controls (mobile keeps its separate drawer toggle).
  let filterCollapsed = $state(loadFilterCollapsed());
  const noResults = $derived(mapMarkers.length === 0 && hasActiveFilters);
  const hasUnappliedSmartSearch = $derived(
    committedQuery.trim().length > 0 && !featureFlagsManager.value.smartSearchHasCutoff,
  );

  const handleAddAllToCollection = () => {
    const query = committedQuery.trim();
    const terms: SearchTerms = {
      ...filterStateToSearchTerms(filters),
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
      total: mapMarkers.length,
      smartSearchEnabled: !!query,
      language: $lang,
    });
  };
  const timeBucketOptions = $derived.by(() => buildMapTimeBucketOptions(filters, spaceId));
  const mapMarkerOptions = $derived.by(() => buildMapMarkerOptions(filters, spaceId));

  // The cluster panel's asset scope, RECOMPUTED from the current markers on every refetch — i.e. on
  // every filter change (Task 10). It used to be the leaf ids captured once at click time, which
  // made the panel a one-way street: it could narrow, but a filter cleared from inside it could
  // never surface the assets that had just started matching, and its header count never moved off
  // the click-time number. See map-cluster-selection.ts.
  const selectedClusterIds = $derived(clusterMarkerIdsInBBox(mapMarkers, selectedClusterBBox));

  // Fetch time buckets for the temporal picker
  $effect(() => {
    void getTimeBuckets(timeBucketOptions).then((buckets) => {
      timeBuckets = buckets.map((b) => ({ timeBucket: b.timeBucket, count: b.count }));
    });
  });

  // Debounced marker fetch when filters change
  let fetchTimeout: ReturnType<typeof setTimeout> | undefined;
  let queryAbortController: AbortController | undefined;

  $effect(() => {
    // Read the derived options before the debounce callback so filter changes
    // are tracked as dependencies of this effect.
    const options = mapMarkerOptions;
    const currentSpaceId = spaceId;
    const query = committedQuery.trim();
    // Admin-only config: only the server can tell us whether machineLearning.clip.maxDistance is
    // configured in (0, 2), which is what makes searchSmart return a cutoff-limited result set.
    // Only then can the intersection loop below actually narrow anything — with no cutoff the
    // ranked result set isn't narrowed, and the loop would otherwise page it to exhaustion.
    const canApplySmartSearch = featureFlagsManager.value.smartSearchHasCutoff;

    clearTimeout(fetchTimeout);
    queryAbortController?.abort();
    const controller = new AbortController();
    queryAbortController = controller;

    fetchTimeout = setTimeout(() => {
      void (async () => {
        try {
          const markers = await getFilteredMapMarkers(options);

          if (controller.signal.aborted) {
            return;
          }

          if (!query || !canApplySmartSearch) {
            mapMarkers = markers;
            return;
          }

          if (markers.length === 0) {
            mapMarkers = [];
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
                  filters,
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

          mapMarkers = markers.filter((marker) => matchingIds.has(marker.id));
        } catch (error: unknown) {
          if (controller.signal.aborted) {
            return;
          }
          console.error('Failed to fetch filtered map markers:', error);
          mapMarkers = [];
        }
      })();
    }, SEARCH_FILTER_DEBOUNCE_MS);

    return () => {
      clearTimeout(fetchTimeout);
      controller.abort();
    };
  });

  function syncMapFilterUrl(nextFilters: FilterState) {
    const nextUrl = buildFilterStateUrl(page.url, nextFilters);
    // NOT a string compare — buildFilterStateUrl re-appends the filter params last, so a URL like
    // /map?make=Apple&spaceId=s1 rebuilds re-ordered. See filter-target.ts.
    if (isFilterStateUrlUnchanged(page.url, nextUrl)) {
      return;
    }
    void goto(nextUrl, { replaceState: true, keepFocus: true, noScroll: true });
  }

  $effect(() => {
    const nextFilterSearch = withoutAtParam(page.url.search);
    if (nextFilterSearch === lastHandledFilterSearch) {
      return;
    }

    untrack(() => {
      // Every filter — including the temporal picker's year/month — round-trips through the URL, so
      // rebuilding FilterState from the URL alone is lossless.
      filters = {
        ...createFilterState(),
        ...hydrateMapFilters(page.url),
      };
      lastHandledFilterSearch = nextFilterSearch;
    });
  });

  function clearCommittedQuery() {
    const url = new URL(page.url);
    url.searchParams.delete('q');
    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    // Only `q` is dropped. The re-hydrate effect above then rebuilds `filters` from the remaining
    // URL, which still carries every active filter — including the picked year/month.
    void goto(nextUrl, {
      replaceState: true,
      keepFocus: true,
      noScroll: true,
    });
  }

  // On mobile the panel *is* the drawer, so its collapse control has to dismiss the whole overlay.
  // Left to collapse itself it shrinks to a 48px icon strip under a full-screen scrim, which reads
  // as "stuck open" (#964). Feeding it a constant `false` also stops a close from persisting as
  // "collapsed" into the next open.
  function onMobileFilterCollapse(collapsed: boolean) {
    if (collapsed) {
      showMobileFilters = false;
    }
  }

  function closeTimelinePanel() {
    isTimelinePanelVisible = false;
    selectedClusterBBox = undefined;
  }

  onDestroy(() => {
    assetViewerManager.showAssetViewer(false);
  });

  if (!featureFlagsManager.value.map) {
    handlePromiseError(goto(Route.photos()));
  }

  async function onViewAssets(assetIds: string[]) {
    await assetViewerManager.setAssetId(assetIds[0]);
    closeTimelinePanel();
  }

  // The clicked cluster's leaf ids are deliberately NOT stored: they are a snapshot of the markers as
  // they stood under the filters at click time, and any filter change re-fetches the markers. The
  // bbox — the tight bounding box of those leaves — is the cluster's durable identity, and
  // `selectedClusterIds` above is re-derived from the current markers inside it.
  function onClusterSelect(_: string[], bbox: SelectionBBox) {
    selectedClusterBBox = bbox;
    isTimelinePanelVisible = true;
    assetViewerManager.showAssetViewer(false);
    handlePromiseError(navigate({ targetRoute: 'current', assetId: null }));
  }

  // Mounting the viewer through `{#await}` leaves it permanently unreactive on reopen.
  // See lazyComponent().
  const LazyAssetViewer = lazyComponent(() => import('$lib/components/asset-viewer/AssetViewer.svelte'));

  // Mounting the map through `{#await}` can leave the surrounding subtree unreactive.
  // See lazyComponent().
  const LazyMap = lazyComponent(() => import('$lib/components/shared-components/map/Map.svelte'));
</script>

{#if featureFlagsManager.value.map}
  <UserPageLayout title={data.meta.title}>
    {#snippet leading()}
      {#if spaceId}
        <IconButton
          variant="ghost"
          shape="round"
          color="secondary"
          aria-label={$t('back')}
          onclick={() => goto(`/spaces/${spaceId}`)}
          icon={mdiArrowLeft}
        />
      {/if}
      {#if isMobile}
        <!-- The same component the desktop header uses, rather than a hand-rolled button: that
             duplicate had drifted onto a different icon (mdiFilterVariant vs the mdiTune every
             other filter affordance uses) and carried no accessible name. -->
        <FilterToggleButton
          active={getActiveFilterCount(filters) > 0}
          onExpand={() => (showMobileFilters = !showMobileFilters)}
          testId="map-mobile-filter-toggle"
        />
      {/if}
    {/snippet}
    {#snippet descriptionTrailing()}
      <!-- Filter toggle right after the "Map" title: descriptionTrailing renders inside the title
           cluster, so the button sits next to the title without shifting it (leading) or drifting to
           the far right (buttons). -ms-6 pulls it back over the title's built-in pe-8 trailing pad so
           it sits snug against "Map". -->
      {#if !isMobile && filterCollapsed}
        <div class="-ms-6">
          <FilterToggleButton active={getActiveFilterCount(filters) > 0} onExpand={() => (filterCollapsed = false)} />
        </div>
      {/if}
    {/snippet}
    <OnEvents
      onAssetsDelete={() => {
        filters = { ...filters };
      }}
    />
    {#if isMobile && showMobileFilters}
      <!-- Portalled to the body, not nested in the map layout: the page header row is a later
           sibling of the content pane inside <main>, so it paints over everything the pane holds,
           and the `isolate` below traps any z-index that tries to out-rank it. That is what put
           "Map" on top of the panel's "Timeline" heading (#964).

           Offsetting the top by the navbar height rather than using `inset-0` keeps the panel's own
           header - close button and section menu - out of the navbar band, where iOS Safari paints
           the navbar over it, and leaves the main menu reachable while the drawer is open. -->
      <Portal target="body">
        <div
          class="fixed inset-x-0 top-(--navbar-height) bottom-0 z-30 max-md:top-(--navbar-height-md)"
          data-testid="map-mobile-filter-overlay"
        >
          <button
            type="button"
            class="absolute inset-0 bg-black/50"
            aria-label="Close filters"
            onclick={() => (showMobileFilters = false)}
          ></button>
          <div class="absolute inset-y-0 left-0 w-72 bg-light shadow-xl dark:bg-immich-dark-bg">
            <FilterPanel
              bind:filters
              bind:collapsed={() => false, onMobileFilterCollapse}
              config={filterConfig}
              {timeBuckets}
              storageKey="gallery-filter-visible-sections-map"
              persistCollapsed={false}
              onFiltersChange={syncMapFilterUrl}
            />
          </div>
        </div>
      </Portal>
    {/if}
    <div class="isolate flex size-full">
      {#if !isMobile}
        <FilterPanel
          bind:filters
          bind:collapsed={filterCollapsed}
          externalToggle
          config={filterConfig}
          {timeBuckets}
          storageKey="gallery-filter-visible-sections-map"
          onFiltersChange={syncMapFilterUrl}
        />
      {/if}
      <div class="relative flex min-h-0 min-w-0 flex-1 flex-col sm:flex-row">
        {#if hasActiveFilters}
          <div class="absolute inset-x-0 top-0 z-10 bg-light/95 backdrop-blur-sm">
            <ActiveFiltersBar
              {filters}
              resultCount={mapMarkers.length}
              searchQuery={committedQuery}
              onClearSearch={clearCommittedQuery}
              {personNames}
              {tagNames}
              {albumNames}
              {ownerNames}
              onRemoveFilter={(type, id) => {
                filters = handlePhotosRemoveFilter(filters, type, id);
                syncMapFilterUrl(filters);
              }}
              onClearAll={() => {
                filters = clearFilters(filters);
                syncMapFilterUrl(filters);
              }}
              onAddAllToCollection={handleAddAllToCollection}
            />
          </div>
        {/if}
        {#if hasUnappliedSmartSearch}
          <div
            class="pointer-events-none absolute inset-x-0 top-0 z-10 mt-12 flex justify-center px-4"
            data-testid="map-smart-search-notice"
            role="status"
          >
            <p class="pointer-events-auto rounded-lg bg-warning/90 px-4 py-2 text-sm text-dark shadow-sm">
              {$t('map_smart_search_not_applied')}
            </p>
          </div>
        {/if}
        <div
          class={[
            'relative min-h-0',
            isTimelinePanelVisible ? 'h-1/2 w-full pb-2 sm:h-full sm:w-2/3 sm:pe-2 sm:pb-0' : 'size-full',
          ]}
        >
          {#if LazyMap.current}
            {@const Map = LazyMap.current}
            <Map
              hash
              onSelect={onViewAssets}
              {onClusterSelect}
              onViewportClose={closeTimelinePanel}
              viewportGridActive={isTimelinePanelVisible}
              autoOpenPanel={$mapSettings.showAssetPanel}
              {spaceId}
              showSettings={false}
              {mapMarkers}
            />
          {:else}
            {#await delay(timeToLoadTheMap) then}
              <div class="flex size-full items-center justify-center">
                <LoadingSpinner />
              </div>
            {/await}
          {/if}
          {#if noResults}
            <div class="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div
                class="pointer-events-auto rounded-lg bg-white/90 px-4 py-3 text-sm text-gray-600 shadow-sm dark:bg-gray-800/90 dark:text-gray-300"
              >
                No matching photos
              </div>
            </div>
          {/if}
        </div>

        {#if isTimelinePanelVisible && selectedClusterBBox}
          <div class="h-1/2 min-h-0 w-full pt-2 sm:h-full sm:w-1/3 sm:ps-2 sm:pt-0">
            <MapTimelinePanel
              bbox={selectedClusterBBox}
              {selectedClusterIds}
              onClose={closeTimelinePanel}
              {spaceId}
              bind:filters
              onFiltersChange={syncMapFilterUrl}
            />
          </div>
        {/if}
      </div>
    </div>
  </UserPageLayout>
  <Portal target="body">
    {#if assetViewerManager.isViewing && !isTimelinePanelVisible}
      {#if LazyAssetViewer.current}
        {@const AssetViewer = LazyAssetViewer.current}
        <AssetViewer
          cursor={{ current: assetViewerManager.asset! }}
          showNavigation={false}
          onClose={() => {
            assetViewerManager.showAssetViewer(false);
            handlePromiseError(navigate({ targetRoute: 'current', assetId: null }));
          }}
          isShared={false}
        />
      {/if}
    {/if}
  </Portal>
{/if}
