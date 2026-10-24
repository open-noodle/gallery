import { getFilteredMapMarkers } from '@immich/sdk';
import { keepPreviousData, queryOptions } from '@tanstack/svelte-query';

type FilteredMapMarkerOptions = Parameters<typeof getFilteredMapMarkers>[0];

/**
 * Album map markers narrowed by the album page's live filters (#767). Keyed by the marker options
 * themselves: TanStack hashes the key by value, so a keystroke that leaves the options unchanged does
 * not refetch, a superseded request is dropped, and the previous markers stay up while a new set loads.
 */
export const getFilteredAlbumMapMarkersQuery = (albumId: string, options: FilteredMapMarkerOptions) =>
  queryOptions({
    queryKey: ['album', albumId, 'map-markers', 'filtered', options],
    queryFn: ({ signal }) => getFilteredMapMarkers(options, { signal }),
    placeholderData: keepPreviousData,
  });
