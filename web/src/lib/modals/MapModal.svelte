<script lang="ts">
  import { lazyComponent } from '$lib/utils/lazy-component.svelte';
  import { timeToLoadTheMap } from '$lib/constants';
  import { delay } from '$lib/utils/asset-utils';
  import type { MapMarkerResponseDto } from '@immich/sdk';
  import { Modal, ModalBody } from '@immich/ui';
  import { t } from 'svelte-i18n';
  import LoadingSpinner from '$lib/components/shared-components/LoadingSpinner.svelte';

  type Props = {
    onClose: (assetIds?: string[]) => void;
    mapMarkers: MapMarkerResponseDto[];
  };

  let { onClose, mapMarkers }: Props = $props();

  // Mounting the map through `{#await}` can leave the surrounding subtree unreactive.
  // See lazyComponent().
  const LazyMap = lazyComponent(() => import('$lib/components/shared-components/map/Map.svelte'));
</script>

<Modal title={$t('map')} size="giant" {onClose}>
  <ModalBody>
    <div class="flex size-full flex-col gap-2 rounded-2xl border border-gray-300 dark:border-light">
      <div class="h-[75vh] min-h-[300px] w-full">
        {#if LazyMap.current}
          {@const Map = LazyMap.current}
          <Map clickable={false} {mapMarkers} onSelect={onClose} showSettings={false} rounded autoFitBounds />
        {:else}
          {#await delay(timeToLoadTheMap) then}
            <!-- show the loading spinner only if loading the map takes too much time -->
            <div class="flex size-full items-center justify-center">
              <LoadingSpinner />
            </div>
          {/await}
        {/if}
      </div>
    </div>
  </ModalBody>
</Modal>
