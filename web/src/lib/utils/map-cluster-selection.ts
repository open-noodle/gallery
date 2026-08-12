import type { SelectionBBox } from '$lib/components/shared-components/map/types';

type ClusterMarker = { id: string; lat: number; lon: number };

/**
 * The ids of the markers currently inside a selected cluster's bounding box.
 *
 * The map's cluster panel used to be fed the leaf ids captured at CLICK time, and nothing ever
 * recomputed them. Those ids are a snapshot of one particular filter state, but they were used as
 * the panel's client-side `assetFilter` (an EXCLUSION set — `timeline-manager.svelte.ts`
 * `isExcluded`, stripped from the request in `internal/request-options.ts`), so the panel could only
 * ever shrink: change a filter and the map's pins updated while the panel still answered from the
 * old set, and clearing a filter from INSIDE the panel could never surface the assets that had just
 * started matching. Its header, driven by `selectedClusterIds.size`, kept the click-time count
 * forever ("50 assets" over five pins).
 *
 * The cluster's durable identity is its GEOGRAPHY, not its member ids: the bbox is the tight
 * bounding box of the leaves (`Map.svelte` `handleClusterClick`). So the selection is recomputed
 * from the CURRENT markers on every marker refetch — which is exactly what a filter change triggers
 * — and the panel then narrows AND widens with the filters.
 *
 * Recomputing from the markers (rather than from the bbox alone, server-side) also keeps the
 * client-side smart-search intersection: `mapMarkers` is already narrowed by the `q` loop on the map
 * page, and the panel's own query knows nothing about `q`.
 */
export function clusterMarkerIdsInBBox(markers: ClusterMarker[], bbox: SelectionBBox | undefined): Set<string> {
  if (!bbox) {
    return new Set<string>();
  }

  const ids = markers
    .filter(
      (marker) =>
        marker.lon >= bbox.west && marker.lon <= bbox.east && marker.lat >= bbox.south && marker.lat <= bbox.north,
    )
    .map((marker) => marker.id);

  return new Set(ids);
}
