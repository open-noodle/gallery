import type { SelectionBBox } from '#lib/components/shared-components/map/types.ts';

type ClusterMarker = { id: string; lat: number; lon: number };

/**
The ids of the markers currently inside a selected cluster's bounding box.

The map's cluster panel used to be fed the leaf ids captured at CLICK time, and nothing ever
recomputed them. Those ids are a snapshot of one particular filter state, but they were used as
the panel's client-side `assetFilter` (an EXCLUSION set — `timeline-manager.svelte.ts`
`isExcluded`, stripped from the request in `lib/gallery/timeline/request-options.ts`), so the panel could only
ever shrink: change a filter and the map's pins updated while the panel still answered from the
old set, and clearing a filter from INSIDE the panel could never surface the assets that had just
started matching. Its header, driven by `selectedClusterIds.size`, kept the click-time count
forever ("50 assets" over five pins).

The cluster's durable identity is its GEOGRAPHY, not its member ids: the bbox is the tight
bounding box of the clicked leaves' markers (`clusterSelectionBBox` below). So the selection is
recomputed from the CURRENT markers on every marker refetch — which is exactly what a filter change
triggers — and the panel then narrows AND widens with the filters.

Recomputing from the markers (rather than from the bbox alone, server-side) also keeps the
client-side smart-search intersection: `mapMarkers` is already narrowed by the `q` loop on the map
page, and the panel's own query knows nothing about `q`.
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

/**
The bounding box of a clicked cluster, spanned by its members' MARKER coordinates.

`clusterMarkerIdsInBBox` compares the markers' exact coordinates against the selected bbox, so the
bbox has to come from those same numbers. The one `Map.svelte` hands over is spanned by the leaves
`getClusterLeaves` returns, and MapLibre's GeoJSON index gives those back reprojected: a leaf's
lon/lat can differ from its marker's in the last bits. When a leaf lands a hair inside its marker,
the marker on that edge falls outside the box and drops out of the panel, so a cluster labelled 15
listed 10 assets (four photos sharing the west edge, one on the east edge).

Looking the clicked ids up in the markers keeps the box and the comparison on the same numbers.
Returns `undefined` when none of the ids has a marker, so the caller keeps the leaf bbox.
See `specs/2026-11-15-map-cluster-edge-markers-design.md`.
*/
export function clusterSelectionBBox(ids: string[], markers: ClusterMarker[]): SelectionBBox | undefined {
  const clicked = new Set(ids);
  const members = markers.filter((marker) => clicked.has(marker.id));
  if (members.length === 0) {
    return undefined;
  }

  return {
    west: Math.min(...members.map((marker) => marker.lon)),
    south: Math.min(...members.map((marker) => marker.lat)),
    east: Math.max(...members.map((marker) => marker.lon)),
    north: Math.max(...members.map((marker) => marker.lat)),
  };
}
