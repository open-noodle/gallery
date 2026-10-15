import type { SharedSpaceMemberResponseDto, SharedSpaceResponseDto } from '@immich/sdk';
import type { TimelineManager } from '$lib/managers/timeline-manager/timeline-manager.svelte';
import type { SearchTerms } from '$lib/services/search.service';
import { filterStateToSearchTerms } from '$lib/utils/filter-search-terms';
import { buildMapFilterConfig } from '$lib/utils/map-filter-config';
import { buildSpaceTimelineOptions, handleSpaceRemoveFilter } from '$lib/utils/space-filter-options';
import { FilteredTimelineController } from './filtered-timeline-controller.svelte';

type SpaceTimelineOptions = {
  getSpace: () => SharedSpaceResponseDto;
  getMembers: () => SharedSpaceMemberResponseDto[];
  getTimelineManager: () => TimelineManager | undefined;
  canZoom: () => boolean;
  onQueryChange: () => void;
};

/** `/spaces/<id>`: the space's own timeline; people are the space's, keyed by their own id. */
export const createSpaceTimeline = ({
  getSpace,
  getMembers,
  getTimelineManager,
  canZoom,
  onQueryChange,
}: SpaceTimelineOptions) => {
  const scope = () => ({ spaceId: getSpace().id });
  return new FilteredTimelineController({
    name: 'spaces',
    storageKey: 'gallery-filter-visible-sections',
    entityKey: () => getSpace().id,
    getTimelineManager,
    canZoom,
    scope,
    timelineOptions: (filters) => buildSpaceTimelineOptions(getSpace().id, filters),
    // Same scoped suggestions as the map inside a space; people keyed by their space id.
    browseConfig: () => buildMapFilterConfig(getSpace().id, { offerLocationPresence: true }),
    removeFilter: handleSpaceRemoveFilter,
    // An owner chip inside a space is always a member, already in scope: no lookup needed.
    ownerNameSeed: () => getMembers().map(({ userId, name }) => ({ id: userId, name })),
    collectTerms: (filters, query) => {
      const terms: SearchTerms = { ...filterStateToSearchTerms(filters), spaceId: getSpace().id };
      // Space timelines scope people via spacePersonIds, not personIds (see buildSpaceTimelineOptions).
      if (terms.personIds) {
        terms.spacePersonIds = terms.personIds;
        delete terms.personIds;
      }
      if (query) {
        terms.query = query;
      }
      return terms;
    },
    onQueryChange,
  });
};
