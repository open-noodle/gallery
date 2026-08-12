import { clusterMarkerIdsInBBox } from '$lib/utils/map-cluster-selection';

const bbox = { west: 1, south: 1, east: 5, north: 5 };

describe('clusterMarkerIdsInBBox', () => {
  it('selects every marker inside the cluster bounding box', () => {
    const ids = clusterMarkerIdsInBBox(
      [
        { id: 'a', lat: 1, lon: 1 },
        { id: 'b', lat: 3, lon: 4 },
        { id: 'far', lat: 40, lon: 40 },
      ],
      bbox,
    );

    expect([...ids]).toEqual(['a', 'b']);
  });

  it('includes markers exactly on the boundary (the bbox IS the leaves)', () => {
    const ids = clusterMarkerIdsInBBox([{ id: 'corner', lat: 5, lon: 5 }], bbox);

    expect([...ids]).toEqual(['corner']);
  });

  // Narrow: a marker the new filters dropped leaves the selection, so the panel stops listing it.
  it('drops markers that the current filters no longer return', () => {
    expect([...clusterMarkerIdsInBBox([{ id: 'a', lat: 2, lon: 2 }], bbox)]).toEqual(['a']);
    expect([...clusterMarkerIdsInBBox([], bbox)]).toEqual([]);
  });

  // Widen: the half that was impossible while the ids were captured once at click time.
  it('picks up markers that only started matching after a filter changed', () => {
    const ids = clusterMarkerIdsInBBox(
      [
        { id: 'a', lat: 2, lon: 2 },
        { id: 'newly-matching', lat: 4, lon: 4 },
      ],
      bbox,
    );

    expect([...ids]).toEqual(['a', 'newly-matching']);
  });

  it('is empty with no selected cluster', () => {
    expect([...clusterMarkerIdsInBBox([{ id: 'a', lat: 2, lon: 2 }], undefined)]).toEqual([]);
  });
});
