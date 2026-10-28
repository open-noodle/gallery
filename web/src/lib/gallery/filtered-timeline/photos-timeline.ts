import { AssetVisibility } from '@immich/sdk';
import { libraryViewOptions, libraryViewShown } from '$lib/gallery/library-view/library-view.svelte';
import { authManager } from '$lib/managers/auth-manager.svelte';
import type { TimelineManager } from '$lib/managers/timeline-manager/timeline-manager.svelte';
import { loadSpaces } from '$lib/stores/user.svelte';
import { filterStateToSearchTerms } from '$lib/utils/filter-search-terms';
import { buildMapFilterConfig } from '$lib/utils/map-filter-config';
import { buildPhotosTimelineOptions } from '$lib/utils/photos-filter-options';
import { FilteredTimelineController, type FilteredTimelineConfig } from './filtered-timeline-controller.svelte';

const scope = { withSharedSpaces: true };
// The map's panel config is the same suggestion scope: every section, own + partners + shown spaces.
const browseConfig = buildMapFilterConfig();

/** `/photos`: my timeline plus partners and the spaces I show on it, narrowed to the library view. */
export const photosTimelineConfig = (
  getTimelineManager: () => TimelineManager | undefined,
): FilteredTimelineConfig => ({
  name: 'photos',
  getTimelineManager,
  scope: () => scope,
  timelineOptions: (filters) => ({
    ...buildPhotosTimelineOptions(filters, authManager.user.id),
    ...libraryViewOptions(),
  }),
  showLibraryView: libraryViewShown,
  browseConfig: () => browseConfig,
  // Replays the filters (and query) against search so the collector can page every matching id;
  // browse mode mirrors buildPhotosTimelineOptions' shared-space scope.
  collectTerms: (filters, query) => ({
    ...filterStateToSearchTerms(filters),
    visibility: AssetVisibility.Timeline,
    ...(query ? { query } : { withSharedSpaces: true, ...libraryViewOptions() }),
  }),
});

export const createPhotosTimeline = (getTimelineManager: () => TimelineManager | undefined) => {
  // The library view needs the spaces list.
  loadSpaces();
  return new FilteredTimelineController(photosTimelineConfig(getTimelineManager));
};
