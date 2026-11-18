import {
  keepSpacesLoaded,
  libraryViewOptions,
  libraryViewShown,
} from '#lib/gallery/library-view/library-view.svelte.ts';
import { authManager } from '#lib/managers/auth-manager.svelte.ts';
import type { TimelineManager } from '#lib/managers/timeline-manager/timeline-manager.svelte.ts';
import { filterStateToSearchTerms } from '#lib/utils/filter-search-terms.ts';
import { buildMapFilterConfig } from '#lib/utils/map-filter-config.ts';
import { buildPhotosTimelineOptions } from '#lib/utils/photos-filter-options.ts';
import { AssetVisibility } from '@immich/sdk';
import { FilteredTimelineController, type FilteredTimelineConfig } from './filtered-timeline-controller.svelte';

const scope = { withSharedSpaces: true };
// The map's panel config is the same suggestion scope: every section, own + partners + shown spaces.
const browseConfig = buildMapFilterConfig(undefined, { offerLocationPresence: true });

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
  keepSpacesLoaded();
  return new FilteredTimelineController(photosTimelineConfig(getTimelineManager));
};
