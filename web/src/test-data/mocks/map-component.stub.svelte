<script lang="ts">
  import type { SelectionBBox } from '$lib/components/shared-components/map/types';
  import type { Snippet } from 'svelte';

  type Marker = {
    id: string;
    lat?: number;
    lon?: number;
    city?: string | null;
    state?: string | null;
    country?: string | null;
  };

  interface Props {
    mapMarkers?: Marker[];
    popup?: Snippet<[{ marker: Marker }]>;
    onClusterSelect?: (assetIds: string[], bbox: SelectionBBox) => void;
    [key: string]: unknown;
  }

  let { mapMarkers = [], popup, onClusterSelect, ...rest }: Props = $props();
</script>

<div
  {...rest}
  data-testid="map-stub"
  data-marker-count={String(mapMarkers.length)}
  data-marker-ids={mapMarkers.map((marker) => marker.id).join(',')}
>
  {#if popup && mapMarkers[0]}
    <div data-testid="map-popup">
      {@render popup({ marker: mapMarkers[0] })}
    </div>
  {/if}
  {#if onClusterSelect && mapMarkers[0]}
    <button
      type="button"
      data-testid={`map-cluster-${mapMarkers[0].id}`}
      onclick={() => onClusterSelect([mapMarkers[0].id], { west: 1, south: 2, east: 3, north: 4 })}
    >
      Open cluster
    </button>
  {/if}
</div>
