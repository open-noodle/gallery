<script lang="ts">
  import { lazyComponent } from '$lib/utils/lazy-component.svelte';
  import { goto } from '$app/navigation';
  import FilteredMapNoResults from '$lib/gallery/filtered-map/FilteredMapNoResults.svelte';
  import FilteredMapPage from '$lib/gallery/filtered-map/FilteredMapPage.svelte';
  import FilteredMapStatus from '$lib/gallery/filtered-map/FilteredMapStatus.svelte';
  import { MapFilterController } from '$lib/gallery/filtered-map/map-filter-controller.svelte';
  import MapTimelinePanel from './MapTimelinePanel.svelte';
  import type { SelectionBBox } from '$lib/components/shared-components/map/types';
  import { timeToLoadTheMap } from '$lib/constants';
  import Portal from '$lib/elements/Portal.svelte';
  import { assetViewerManager } from '$lib/managers/asset-viewer-manager.svelte';
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import { Route } from '$lib/route';
  import { handlePromiseError } from '$lib/utils';
  import { delay } from '$lib/utils/asset-utils';
  import { clusterMarkerIdsInBBox } from '$lib/utils/map-cluster-selection';
  import { navigate } from '$lib/utils/navigation';
  import { mapSettings } from '$lib/stores/preferences.store';
  import { LoadingSpinner } from '@immich/ui';
  import { onDestroy } from 'svelte';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();

  const map = new MapFilterController();

  let selectedClusterBBox = $state.raw<SelectionBBox>();
  let isTimelinePanelVisible = $state(false);

  // The cluster panel's asset scope, RECOMPUTED from the current markers on every refetch — i.e. on
  // every filter change (Task 10). It used to be the leaf ids captured once at click time, which
  // made the panel a one-way street: it could narrow, but a filter cleared from inside it could
  // never surface the assets that had just started matching, and its header count never moved off
  // the click-time number. See map-cluster-selection.ts.
  const selectedClusterIds = $derived(clusterMarkerIdsInBBox(map.mapMarkers, selectedClusterBBox));

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
  <FilteredMapPage controller={map} title={data.meta.title}>
    <div class="relative flex min-h-0 min-w-0 flex-1 flex-col sm:flex-row">
      <FilteredMapStatus controller={map} />
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
            {...map.mapProps}
          />
        {:else}
          {#await delay(timeToLoadTheMap) then}
            <div class="flex size-full items-center justify-center">
              <LoadingSpinner />
            </div>
          {/await}
        {/if}
        <FilteredMapNoResults controller={map} />
      </div>

      {#if isTimelinePanelVisible && selectedClusterBBox}
        <div class="h-1/2 min-h-0 w-full pt-2 sm:h-full sm:w-1/3 sm:ps-2 sm:pt-0">
          <MapTimelinePanel
            bbox={selectedClusterBBox}
            {selectedClusterIds}
            onClose={closeTimelinePanel}
            spaceId={map.spaceId}
            bind:filters={map.filters}
            onFiltersChange={map.syncUrl}
          />
        </div>
      {/if}
    </div>
  </FilteredMapPage>
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
