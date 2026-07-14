<script lang="ts">
  import { lazyComponent } from '$lib/utils/lazy-component.svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import ActiveFiltersBar from '$lib/components/filter-panel/active-filters-bar.svelte';
  import FilterPanel from '$lib/components/filter-panel/filter-panel.svelte';
  import { clearFilters, createFilterState, getActiveFilterCount } from '$lib/components/filter-panel/filter-panel';
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
  import { buildMapFilterConfig } from '$lib/utils/map-filter-config';
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
  import { Icon, IconButton, modalManager } from '@immich/ui';
  import SearchAddAllToCollectionModal from '$lib/modals/SearchAddAllToCollectionModal.svelte';
  import type { SearchTerms } from '$lib/services/search.service';
  import { filterStateToSearchTerms } from '$lib/utils/filter-search-terms';
  import { lang } from '$lib/stores/preferences.store';
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';
  import { mdiArrowLeft, mdiFilterVariant } from '@mdi/js';
  import { onDestroy, onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import type { PageData } from './$types';
  import LoadingSpinner from '$lib/components/shared-components/LoadingSpinner.svelte';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();

  const spaceId = $derived(page.url.searchParams.get(QueryParameter.SPACE_ID) || undefined);
  const committedQuery = $derived(page.url.searchParams.get('q') ?? '');

  let selectedClusterIds = $state.raw(new Set<string>());
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
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  });

  // Filter state
  let filters = $state<FilterState>(createFilterState());
  let mapMarkers = $state<MapMarkerResponseDto[]>([]);
  let timeBuckets = $state<Array<{ timeBucket: string; count: number }>>([]);
  let personNames = new SvelteMap<string, string>();
  let tagNames = new SvelteMap<string, string>();

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
  const noResults = $derived(mapMarkers.length === 0 && hasActiveFilters);

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

          if (!query) {
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

  function clearCommittedQuery() {
    const url = new URL(page.url);
    url.searchParams.delete('q');
    void goto(`${url.pathname}${url.search}${url.hash}`, {
      replaceState: true,
      keepFocus: true,
      noScroll: true,
    });
  }

  function closeTimelinePanel() {
    isTimelinePanelVisible = false;
    selectedClusterBBox = undefined;
    selectedClusterIds = new Set();
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

  function onClusterSelect(assetIds: string[], bbox: SelectionBBox) {
    selectedClusterIds = new Set(assetIds);
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
        <button
          type="button"
          data-testid="map-mobile-filter-toggle"
          onclick={() => (showMobileFilters = !showMobileFilters)}
        >
          <Icon icon={mdiFilterVariant} size="24" />
        </button>
      {/if}
    {/snippet}
    <OnEvents
      onAssetsDelete={() => {
        filters = { ...filters };
      }}
    />
    <div class="isolate flex size-full">
      {#if !isMobile}
        <FilterPanel
          bind:filters
          config={filterConfig}
          {timeBuckets}
          storageKey="gallery-filter-visible-sections-map"
        />
      {/if}
      {#if isMobile && showMobileFilters}
        <div class="fixed inset-0 z-30">
          <button
            type="button"
            class="absolute inset-0 bg-black/50"
            aria-label="Close filters"
            onclick={() => (showMobileFilters = false)}
          ></button>
          <div class="absolute inset-y-0 left-0 w-72 bg-light shadow-xl dark:bg-immich-dark-bg">
            <FilterPanel
              bind:filters
              config={filterConfig}
              {timeBuckets}
              storageKey="gallery-filter-visible-sections-map"
              persistCollapsed={false}
            />
          </div>
        </div>
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
              onRemoveFilter={(type, id) => {
                filters = handlePhotosRemoveFilter(filters, type, id);
              }}
              onClearAll={() => {
                filters = clearFilters(filters);
              }}
              onAddAllToCollection={handleAddAllToCollection}
            />
          </div>
        {/if}
        <div
          class={[
            'relative min-h-0',
            isTimelinePanelVisible ? 'h-1/2 w-full pb-2 sm:h-full sm:w-2/3 sm:pe-2 sm:pb-0' : 'h-full w-full',
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
                class="pointer-events-auto rounded-lg bg-white/90 px-4 py-3 text-sm text-gray-600 shadow dark:bg-gray-800/90 dark:text-gray-300"
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
              assetCount={selectedClusterIds.size}
              onClose={closeTimelinePanel}
              {spaceId}
              bind:filters
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
