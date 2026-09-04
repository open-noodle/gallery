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
    /**
     * Map.svelte renders its "open in map view" control ONLY when this callback is passed (see
     * Map.svelte's `{#if onOpenInMapView && showSimpleControls}`), so a caller that withholds it
     * genuinely has no control. Mirror that here: the stub's button exists iff the callback does.
     */
    onOpenInMapView?: () => Promise<void> | void;
    /**
     * Map.svelte's click handler for placing a pin (location-round.svelte's guess flow). Mirrored
     * here as a button so a page test can drive a location guess end to end; the real component
     * needs a WebGL canvas happy-dom lacks, so it can't be clicked directly.
     */
    onClickPoint?: (point: { lat: number; lng: number }) => void;
    [key: string]: unknown;
  }

  let { mapMarkers = [], popup, onClusterSelect, onOpenInMapView, onClickPoint, ...rest }: Props = $props();

  // Mirrors Map.svelte's handleClusterClick: a cluster hands its caller the LEAF ids plus the TIGHT
  // bounding box of those leaves. Deriving the bbox from the markers (rather than hard-coding one)
  // is what lets a page test exercise the cluster selection being recomputed from later markers.
  const clusterLeaves = $derived(
    mapMarkers.filter((marker) => marker.lat !== undefined && marker.lon !== undefined),
  ) as Array<Marker & { lat: number; lon: number }>;
  const clusterBBox = $derived({
    west: Math.min(...clusterLeaves.map((marker) => marker.lon)),
    south: Math.min(...clusterLeaves.map((marker) => marker.lat)),
    east: Math.max(...clusterLeaves.map((marker) => marker.lon)),
    north: Math.max(...clusterLeaves.map((marker) => marker.lat)),
  });
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
  {#if onOpenInMapView}
    <button type="button" data-testid="map-stub-open-in-map-view" onclick={() => onOpenInMapView()}>
      Open in map view
    </button>
  {/if}
  {#if onClickPoint}
    <button type="button" data-testid="map-stub-click-point" onclick={() => onClickPoint({ lat: 12.5, lng: 45.5 })}>
      Click map
    </button>
    <!-- maplibre's real lngLat (from map.unproject) is not wrapped to [-180, 180] — panning across
         the antimeridian on a world guessing map routinely yields values like 200 or -230. This
         button lets a test drive that out-of-range case end to end through a real onClickPoint
         consumer, the way the fixed-value button above can't. -->
    <button
      type="button"
      data-testid="map-stub-click-point-antimeridian"
      onclick={() => onClickPoint({ lat: 5, lng: 200 })}
    >
      Click map past the antimeridian
    </button>
  {/if}
  {#if onClusterSelect && clusterLeaves[0]}
    <button
      type="button"
      data-testid={`map-cluster-${clusterLeaves[0].id}`}
      onclick={() =>
        onClusterSelect(
          clusterLeaves.map((marker) => marker.id),
          clusterBBox,
        )}
    >
      Open cluster
    </button>
  {/if}
</div>
