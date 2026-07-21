import {
  getFilterSuggestions,
  getSearchSuggestions,
  searchSmartFacets,
  SearchSuggestionType,
  type SmartSearchFacetsResponseDto,
} from '@immich/sdk';
import type { FilterPanelConfig, FilterState } from '$lib/components/filter-panel/filter-panel';
import { getPhotosPersonFilterId, getPhotosPersonFilterThumbnailUrl } from '$lib/utils/photos-filter-options';
import { buildRecentlyAddedSuggestionRequest } from '$lib/utils/recently-added-filter-options';
import { buildSmartSearchFacetsParams, mapSmartSearchFacetsToFilterSuggestions } from '$lib/utils/space-search';

/**
 * All ten filter sections. `'text'` renders as `<TextFilter>`, editing the description /
 * originalFileName / ocr metadata filters — those already round-trip through the URL and through
 * `buildRecentlyAddedTimelineOptions`, independent of the query/smart-search path below.
 */
const sections = [
  'timeline',
  'people',
  'location',
  'camera',
  'tags',
  'rating',
  'media',
  'favorites',
  'albums',
  'text',
] as const;

function mapSuggestions(response: Awaited<ReturnType<typeof getFilterSuggestions>>) {
  return {
    countries: response.countries,
    cameraMakes: response.cameraMakes,
    tags: response.tags.map((tag) => ({ id: tag.id, name: tag.value })),
    people: response.people.map((person) => ({
      id: getPhotosPersonFilterId(person),
      name: person.name,
      thumbnailUrl: getPhotosPersonFilterThumbnailUrl(person),
    })),
    ratings: response.ratings,
    mediaTypes: response.mediaTypes,
    hasUnnamedPeople: response.hasUnnamedPeople,
  };
}

/**
 * The route's live search state, read at provider call time so it never goes stale.
 * `filters` must be the route's live FilterState — the dependent providers scope their facet
 * query by it, exactly as the Photos page does.
 */
export type RecentlyAddedSearchContext = { query: string; language: string; filters: FilterState };

function fetchFacets(context: RecentlyAddedSearchContext, filters: FilterState): Promise<SmartSearchFacetsResponseDto> {
  return searchSmartFacets({
    smartSearchFacetsDto: buildSmartSearchFacetsParams({
      query: context.query.trim(),
      filters,
      // Recently Added is own + partner in query mode exactly as in browse mode.
      withSharedSpaces: false,
      language: context.language,
    }),
  });
}

/**
 * Filter-panel config for the Recently Added view: own + partner scope only, so nothing here
 * carries `withSharedSpaces` / `albumId` / `spaceId`.
 *
 * `getSearchContext` is an accessor, not a plain value, because the panel's providers are called
 * later, during user interaction, and must see the query and the live filters as they are at call
 * time — values captured when the config is built would go stale the moment the user edits either.
 * It defaults to `() => undefined`, so a caller that never searches keeps the Slice-2 browse
 * behaviour unchanged.
 */
export function buildRecentlyAddedFilterConfig(
  getSearchContext: () => RecentlyAddedSearchContext | undefined = () => undefined,
): FilterPanelConfig {
  // Resolved per call, not per build: the panel invokes these during interaction.
  const activeSearch = (): RecentlyAddedSearchContext | undefined => {
    const context = getSearchContext();
    return context && context.query.trim() ? context : undefined;
  };

  return {
    sections: [...sections],
    suggestionsProvider: async (filters) => {
      const context = activeSearch();
      if (!context) {
        return mapSuggestions(await getFilterSuggestions(buildRecentlyAddedSuggestionRequest(filters)));
      }
      return mapSmartSearchFacetsToFilterSuggestions(await fetchFacets(context, filters));
    },
    providers: {
      cities: async (country, filterContext) => {
        const context = activeSearch();
        if (!context) {
          return getSearchSuggestions({ $type: SearchSuggestionType.City, country, ...filterContext });
        }
        // Scope by the LIVE filters (mirroring Photos' `filters: { ...filters, country }`), not by
        // the panel's FilterContext — see the module design note above.
        const facets = await fetchFacets(context, { ...context.filters, country });
        return facets.cities;
      },
      cameraModels: async (make, filterContext) => {
        const context = activeSearch();
        if (!context) {
          return getSearchSuggestions({ $type: SearchSuggestionType.CameraModel, make, ...filterContext });
        }
        const facets = await fetchFacets(context, { ...context.filters, make });
        return facets.cameraModels;
      },
    },
  };
}
