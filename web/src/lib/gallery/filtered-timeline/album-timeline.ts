import { AssetOrder, type AlbumResponseDto } from '@immich/sdk';
import { page } from '$app/state';
import { createFilterState, type FilterState } from '$lib/components/filter-panel/filter-panel';
import { albumStackPreferences } from '$lib/gallery/stack/album-stack-preferences.svelte';
import { authManager } from '$lib/managers/auth-manager.svelte';
import type { TimelineManager } from '$lib/managers/timeline-manager/timeline-manager.svelte';
import { buildAlbumAssetPickerFilterConfig, buildAlbumDetailFilterConfig } from '$lib/utils/album-filter-config';
import { buildAlbumTimelineOptions } from '$lib/utils/album-filter-options';
import { filterStateToSearchTerms } from '$lib/utils/filter-search-terms';
import { decodeFilterParams } from '$lib/utils/filter-url';
import { getSearchablePageState } from '$lib/utils/searchable-page-search';
import { AssetPickerFilters } from './asset-picker-filters.svelte';
import { FilteredTimelineController } from './filtered-timeline-controller.svelte';

/**
 * E9: the route already scopes the timeline to this album, and the server's `albumId` is a SCALAR
 * driving one inner join, so album ∩ album is impossible. A stray `?albumId=` is IGNORED: dropping
 * it here keeps it out of the active-filter count, the chip bar and the next URL write.
 */
export const hydrateAlbumFilters = (url: URL): FilterState => ({
  ...createFilterState(),
  ...decodeFilterParams(url),
  albumId: undefined,
  sortOrder: getSearchablePageState(url).sortOrder,
});

/**
 * Browse order. An album carries its own `order`, but the navbar sort dropdown renders on every
 * searchable page, so an EXPLICIT `?sort=` has to win or the control would do nothing here.
 */
const albumOrder = (album: AlbumResponseDto, filters: FilterState) => {
  if (!getSearchablePageState(page.url).hasExplicitSort) {
    return album.order ?? authManager.preferences.albums.defaultAssetOrder;
  }
  return filters.sortOrder === 'asc' ? AssetOrder.Asc : AssetOrder.Desc;
};

type AlbumTimelineOptions = {
  name: string;
  getAlbum: () => AlbumResponseDto;
  getTimelineManager: () => TimelineManager | undefined;
  isBrowse: () => boolean;
  /** Seed owner chip names from the album's users. */
  ownerNamesFromAlbumUsers?: boolean;
};

/**
 * An album detail route (`/albums/<id>`, `/spaces/<sid>/albums/<id>`). Search is scoped to the
 * album alone, never the space: the browse timeline is album-scoped and its panel speaks the
 * personal person tokens, and an added `spaceId` would widen server-side (`albumIds` resolves
 * `timelineSpaceIds`, which skips the space predicate).
 */
export const createAlbumTimeline = ({
  name,
  getAlbum,
  getTimelineManager,
  isBrowse,
  ownerNamesFromAlbumUsers = false,
}: AlbumTimelineOptions) =>
  new FilteredTimelineController({
    name,
    entityKey: () => getAlbum().id,
    getTimelineManager,
    isBrowse,
    urlMode: 'filter-state',
    hydrate: hydrateAlbumFilters,
    scope: () => ({ albumIds: [getAlbum().id] }),
    timelineOptions: (filters) => ({
      ...buildAlbumTimelineOptions(getAlbum().id, albumOrder(getAlbum(), filters), filters),
      ...(albumStackPreferences.countInAlbum && { stackCountInAlbum: true }),
    }),
    browseConfig: () => buildAlbumDetailFilterConfig(getAlbum().id),
    facetFailure: 'empty',
    queryModeProviders: false,
    resolveNames: ownerNamesFromAlbumUsers,
    // An `?ownerId=` chip on an album is all but always one of its users, already in scope.
    ownerNameSeed: () => getAlbum().albumUsers.map(({ user }) => ({ id: user.id, name: user.name })),
    isTimelineEmpty: (controller) =>
      controller.isLoadedEmpty && controller.activeFilterCount === 0 && !controller.showSearchResults,
    // The bar prints the SEARCH total, so the collector has to run the same search; without the
    // query it pages every asset in the album ("Add all 3" adding 800).
    collectTerms: (filters, query) => ({
      ...filterStateToSearchTerms(filters),
      albumIds: [getAlbum().id],
      ...(query && { query }),
    }),
  });

export const createAlbumPickerFilters = () => new AssetPickerFilters(buildAlbumAssetPickerFilterConfig());
