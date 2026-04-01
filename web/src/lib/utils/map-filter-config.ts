import {
  buildFilterContext,
  type FilterPanelConfig,
  type FilterState,
} from '$lib/components/filter-panel/filter-panel';
import { createUrl } from '$lib/utils';
import { AssetTypeEnum, getFilterSuggestions, getSearchSuggestions, SearchSuggestionType } from '@immich/sdk';

export function buildMapFilterConfig(spaceId?: string): FilterPanelConfig {
  const sections = ['timeline', 'people', 'camera', 'tags', 'rating', 'media', 'favorites'] as const;

  const suggestionsProvider = async (filters: FilterState) => {
    const context = buildFilterContext(filters);
    const response = await getFilterSuggestions({
      personIds: filters.personIds.length > 0 ? filters.personIds : undefined,
      country: filters.country,
      city: filters.city,
      make: filters.make,
      model: filters.model,
      tagIds: filters.tagIds.length > 0 ? filters.tagIds : undefined,
      rating: filters.rating,
      mediaType:
        filters.mediaType === 'all'
          ? undefined
          : filters.mediaType === 'image'
            ? AssetTypeEnum.Image
            : AssetTypeEnum.Video,
      isFavorite: filters.isFavorite,
      takenAfter: context?.takenAfter,
      takenBefore: context?.takenBefore,
      ...(spaceId ? { spaceId } : { withSharedSpaces: true }),
    });
    return {
      countries: response.countries,
      cameraMakes: response.cameraMakes,
      tags: response.tags.map((t: { id: string; value: string }) => ({ id: t.id, name: t.value })),
      people: response.people.map((p: { id: string; name: string }) => ({
        id: p.id,
        name: p.name,
        thumbnailUrl: createUrl(`/people/${p.id}/thumbnail`),
      })),
      ratings: response.ratings,
      mediaTypes: response.mediaTypes,
      hasUnnamedPeople: response.hasUnnamedPeople,
    };
  };

  return {
    sections: [...sections],
    suggestionsProvider,
    providers: {
      cameraModels: (make: string, context) =>
        getSearchSuggestions({
          $type: SearchSuggestionType.CameraModel,
          make,
          ...(spaceId ? { spaceId } : { withSharedSpaces: true }),
          ...context,
        }),
    },
  };
}
