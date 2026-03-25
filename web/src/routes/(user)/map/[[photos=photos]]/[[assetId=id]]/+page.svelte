<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import FilterPanel from '$lib/components/filter-panel/filter-panel.svelte';
  import { buildFilterContext, createFilterState } from '$lib/components/filter-panel/filter-panel';
  import type { FilterState } from '$lib/components/filter-panel/filter-panel';
  import UserPageLayout from '$lib/components/layouts/user-page-layout.svelte';
  import OnEvents from '$lib/components/OnEvents.svelte';
  import MapTimelinePanel from '$lib/components/shared-components/map/MapTimelinePanel.svelte';
  import type { SelectionBBox } from '$lib/components/shared-components/map/types';
  import { QueryParameter, timeToLoadTheMap } from '$lib/constants';
  import Portal from '$lib/elements/Portal.svelte';
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import { Route } from '$lib/route';
  import { assetViewingStore } from '$lib/stores/asset-viewing.store';
  import { handlePromiseError } from '$lib/utils';
  import { delay } from '$lib/utils/asset-utils';
  import { buildMapFilterConfig } from '$lib/utils/map-filter-config';
  import { navigate } from '$lib/utils/navigation';
  import { AssetVisibility, getFilteredMapMarkers, getTimeBuckets, type MapMarkerResponseDto } from '@immich/sdk';
  import { IconButton } from '@immich/ui';
  import { mdiArrowLeft } from '@mdi/js';
  import { onDestroy } from 'svelte';
  import { t } from 'svelte-i18n';
  import type { PageData } from './$types';
  import LoadingSpinner from '$lib/components/shared-components/LoadingSpinner.svelte';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();

  const spaceId = $derived($page.url.searchParams.get(QueryParameter.SPACE_ID) || undefined);

  let { isViewing: showAssetViewer, asset: viewingAsset, setAssetId } = assetViewingStore;

  let selectedClusterIds = $state.raw(new Set<string>());
  let selectedClusterBBox = $state.raw<SelectionBBox>();
  let isTimelinePanelVisible = $state(false);

  // Filter state
  let filters = $state<FilterState>(createFilterState());
  let mapMarkers = $state<MapMarkerResponseDto[]>([]);
  let timeBuckets = $state<Array<{ timeBucket: string; count: number }>>([]);
  const filterConfig = $derived(buildMapFilterConfig(spaceId));

  // Fetch time buckets for the temporal picker
  $effect(() => {
    const currentSpaceId = spaceId;
    void getTimeBuckets({
      ...(currentSpaceId ? { spaceId: currentSpaceId } : { visibility: AssetVisibility.Timeline }),
    }).then((buckets) => {
      timeBuckets = buckets.map((b) => ({ timeBucket: b.timeBucket, count: b.count }));
    });
  });

  // Debounced marker fetch when filters change
  let fetchTimeout: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    const { personIds, make, model, tagIds, rating, mediaType, isFavorite } = filters;
    const currentSpaceId = spaceId;
    const context = buildFilterContext(filters);

    clearTimeout(fetchTimeout);
    fetchTimeout = setTimeout(() => {
      void getFilteredMapMarkers({
        ...(currentSpaceId && { spaceId: currentSpaceId }),
        ...(personIds.length > 0 && { personIds }),
        ...(make && { make }),
        ...(model && { model }),
        ...(tagIds.length > 0 && { tagIds }),
        ...(rating !== undefined && { rating }),
        ...(mediaType !== 'all' && { $type: mediaType === 'image' ? 'IMAGE' : 'VIDEO' }),
        ...(isFavorite !== undefined && { isFavorite }),
        ...(context?.takenAfter && { takenAfter: context.takenAfter }),
        ...(context?.takenBefore && { takenBefore: context.takenBefore }),
      })
        .then((result) => {
          mapMarkers = result;
        })
        .catch((error: unknown) => {
          console.error('Failed to fetch filtered map markers:', error);
        });
    }, 200);

    return () => clearTimeout(fetchTimeout);
  });

  function closeTimelinePanel() {
    isTimelinePanelVisible = false;
    selectedClusterBBox = undefined;
    selectedClusterIds = new Set();
  }

  onDestroy(() => {
    assetViewingStore.showAssetViewer(false);
  });

  if (!featureFlagsManager.value.map) {
    handlePromiseError(goto(Route.photos()));
  }

  async function onViewAssets(assetIds: string[]) {
    await setAssetId(assetIds[0]);
    closeTimelinePanel();
  }

  function onClusterSelect(assetIds: string[], bbox: SelectionBBox) {
    selectedClusterIds = new Set(assetIds);
    selectedClusterBBox = bbox;
    isTimelinePanelVisible = true;
    assetViewingStore.showAssetViewer(false);
    handlePromiseError(navigate({ targetRoute: 'current', assetId: null }));
  }
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
    {/snippet}
    <OnEvents
      onAssetsDelete={() => {
        filters = { ...filters };
      }}
    />
    <div class="isolate flex h-full w-full">
      <FilterPanel bind:filters config={filterConfig} {timeBuckets} storageKey="gallery-filter-visible-sections-map" />
      <div class="flex min-h-0 min-w-0 flex-1 flex-col sm:flex-row">
        <div
          class={[
            'min-h-0',
            isTimelinePanelVisible ? 'h-1/2 w-full pb-2 sm:h-full sm:w-2/3 sm:pe-2 sm:pb-0' : 'h-full w-full',
          ]}
        >
          {#await import('$lib/components/shared-components/map/map.svelte')}
            {#await delay(timeToLoadTheMap) then}
              <div class="flex items-center justify-center h-full w-full">
                <LoadingSpinner />
              </div>
            {/await}
          {:then { default: Map }}
            <Map hash onSelect={onViewAssets} {onClusterSelect} {spaceId} showSettings={false} {mapMarkers} />
          {/await}
        </div>

        {#if isTimelinePanelVisible && selectedClusterBBox}
          <div class="h-1/2 min-h-0 w-full pt-2 sm:h-full sm:w-1/3 sm:ps-2 sm:pt-0">
            <MapTimelinePanel
              bbox={selectedClusterBBox}
              {selectedClusterIds}
              assetCount={selectedClusterIds.size}
              onClose={closeTimelinePanel}
              {spaceId}
              {filters}
            />
          </div>
        {/if}
      </div>
    </div>
  </UserPageLayout>
  <Portal target="body">
    {#if $showAssetViewer}
      {#await import('$lib/components/asset-viewer/asset-viewer.svelte') then { default: AssetViewer }}
        <AssetViewer
          cursor={{ current: $viewingAsset }}
          showNavigation={false}
          onClose={() => {
            assetViewingStore.showAssetViewer(false);
            handlePromiseError(navigate({ targetRoute: 'current', assetId: null }));
          }}
          isShared={false}
        />
      {/await}
    {/if}
  </Portal>
{/if}
