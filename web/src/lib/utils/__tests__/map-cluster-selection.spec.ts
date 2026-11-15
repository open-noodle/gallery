import { clusterMarkerIdsInBBox, clusterSelectionBBox } from '#lib/utils/map-cluster-selection.ts';

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

describe('clusterSelectionBBox', () => {
  // A cluster labelled 15 whose west edge is four photos taken at one spot and whose east edge is
  // one photo. `getClusterLeaves` hands the leaves back reprojected, a hair inside the markers'
  // coordinates, so a box spanned by the leaves dropped those five and the panel listed 10.
  const markers = [
    { id: 'west-1', lon: -6.269068, lat: 57.250636 },
    { id: 'west-2', lon: -6.269068, lat: 57.250636 },
    { id: 'middle', lon: -6.268412, lat: 57.25 },
    { id: 'south', lon: -6.265123, lat: 57.249755 },
    { id: 'east', lon: -6.26457, lat: 57.249922 },
    { id: 'outside', lon: -6.25789, lat: 57.250416 },
  ];
  const clusterIds = ['west-1', 'west-2', 'middle', 'south', 'east'];
  const nudge = 1e-9;
  const reprojectedLeafBBox = {
    west: -6.269068 + nudge,
    south: 57.249755 + nudge,
    east: -6.26457 - nudge,
    north: 57.250636 - nudge,
  };

  it('spans the markers of the clicked ids', () => {
    expect(clusterSelectionBBox(clusterIds, markers)).toEqual({
      west: -6.269068,
      south: 57.249755,
      east: -6.26457,
      north: 57.250636,
    });
  });

  it('keeps the markers on the edges of the cluster in the selection', () => {
    const ids = clusterMarkerIdsInBBox(markers, clusterSelectionBBox(clusterIds, markers));

    expect([...ids]).toEqual(clusterIds);
  });

  it('loses the edge markers with the reprojected leaf bbox (the bug this fixes)', () => {
    expect([...clusterMarkerIdsInBBox(markers, reprojectedLeafBBox)]).toEqual(['middle']);
  });

  it('ignores ids that have no marker', () => {
    expect(clusterSelectionBBox(['middle', 'gone'], markers)).toEqual({
      west: -6.268412,
      south: 57.25,
      east: -6.268412,
      north: 57.25,
    });
  });

  it('is undefined when no clicked id has a marker, so the caller keeps the leaf bbox', () => {
    expect(clusterSelectionBBox(['gone'], markers)).toBeUndefined();
    expect(clusterSelectionBBox([], markers)).toBeUndefined();
  });
});
