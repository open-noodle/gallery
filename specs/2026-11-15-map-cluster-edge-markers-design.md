# Map cluster panel: keep the markers on a cluster's edges

## Problem

Clicking a cluster on the map opens the timeline panel with fewer assets than the cluster's label.
A cluster labelled 15 listed 10; another labelled 121 listed 120. The missing assets are always the
ones on the edge of the cluster: in the 15 case, four photos taken at one spot formed the west edge
and one photo the east edge, and exactly those five were missing. The server is not involved: the
markers endpoint and the bbox-scoped timeline endpoints return the same ids.

## Cause

The panel's asset scope is `selectedClusterIds = clusterMarkerIdsInBBox(map.mapMarkers, bbox)`
(`web/src/lib/utils/map-cluster-selection.ts`). It compares each marker's exact `lon`/`lat` against
the selected bbox with inclusive bounds, and the panel's timeline uses that set as its client-side
`assetFilter`, so a marker outside the set is never listed.

The bbox comes from upstream's `handleClusterClick` in `Map.svelte`, which spans it over the leaves
`getClusterLeaves` returns. Those leaves are not the features the source was fed: MapLibre's GeoJSON
index stores points projected and reprojects them on the way out, so a leaf's coordinates can differ
from its marker's in the last bits. Whenever a leaf comes back a hair inside its marker, the
marker that defines that edge of the box falls outside it and drops out of the panel. How many
assets are lost depends on how many share the edge coordinate and on the direction of the rounding,
so it changes with the cluster and the zoom level.

Upstream does not have the bug: its panel filters by the clicked leaf ids, which are exact. The fork
replaced that with the bbox recomputation so the panel follows filter changes (see the comment on
`clusterMarkerIdsInBBox`), and that comparison is where the two coordinate sources meet.

## Decision

Span the selected bbox over the markers of the clicked ids (`clusterSelectionBBox(ids, markers)`),
so the box and the comparison use the same numbers. The bbox stays the cluster's identity, so the
panel still narrows and widens with the filters. When none of the ids has a marker, the page keeps
the leaf bbox from `Map.svelte`.

The fix lives in the fork's `map-cluster-selection.ts` and the fork's `onClusterSelect` on the map
page, which already receives the leaf ids and used to discard them. `Map.svelte` stays upstream
text; the page's diff against the upstream tag does not grow (the handler takes upstream's
`assetIds` parameter name again).

Rejected: widening the comparison with an epsilon. It would also pull in neighbouring markers that
are not in the cluster, and the right tolerance depends on MapLibre's internal projection.

## Compatibility

Web only. No API, schema, sync or mobile change, so every client/server pairing behaves as before.
