import {
  AssetTypeEnum,
  getFilterSuggestions,
  getSearchSuggestions,
  SearchSuggestionType,
  type FilterSuggestionsPersonDto,
} from '@immich/sdk';
import {
  ALL_FILTER_SECTIONS,
  buildFilterContext,
  type FilterPanelConfig,
  type FilterState,
} from '$lib/components/filter-panel/filter-panel';
import { createUrl } from '$lib/utils';
import { getPhotosPersonFilterId, getPhotosPersonFilterThumbnailUrl } from '$lib/utils/photos-filter-options';

function mapSuggestions(response: Awaited<ReturnType<typeof getFilterSuggestions>>, spaceId?: string) {
  return {
    countries: response.countries,
    cameraMakes: response.cameraMakes,
    tags: response.tags.map((t: { id: string; value: string }) => ({ id: t.id, name: t.value })),
    people: response.people.map((p: FilterSuggestionsPersonDto) => ({
      id: spaceId ? p.id : getPhotosPersonFilterId(p),
      name: p.name,
      thumbnailUrl: spaceId
        ? createUrl(`/shared-spaces/${spaceId}/people/${p.primaryProfile?.id ?? p.id}/thumbnail`)
        : getPhotosPersonFilterThumbnailUrl(p),
    })),
    ratings: response.ratings,
    mediaTypes: response.mediaTypes,
    hasUnnamedPeople: response.hasUnnamedPeople,
    hasFavorites: response.hasFavorites,
    hasAssetsInAlbum: response.hasAssetsInAlbum,
    hasAssetsNotInAlbum: response.hasAssetsNotInAlbum,
  };
}

export function buildMapFilterConfig(spaceId?: string): FilterPanelConfig {
  const suggestionsProvider = async (filters: FilterState) => {
    const context = buildFilterContext(filters);
    const response = await getFilterSuggestions({
      personIds: filters.personIds.length > 0 ? filters.personIds : undefined,
      country: filters.country,
      state: filters.state,
      city: filters.city,
      make: filters.make,
      model: filters.model,
      lensModel: filters.lensModel,
      ownerId: filters.ownerId,
      tagIds: filters.tagIds.length > 0 ? filters.tagIds : undefined,
      rating: filters.rating,
      mediaType:
        filters.mediaType === 'all'
          ? undefined
          : filters.mediaType === 'image'
            ? AssetTypeEnum.Image
            : AssetTypeEnum.Video,
      isFavorite: filters.isFavorite,
      isNotInAlbum: filters.isNotInAlbum === true ? true : undefined,
      isInAlbum: filters.isInAlbum === true ? true : undefined,
      takenAfter: context?.takenAfter,
      takenBefore: context?.takenBefore,
      ...(spaceId ? { spaceId } : { withSharedSpaces: true }),
    });
    return mapSuggestions(response, spaceId);
  };

  return {
    sections: [...ALL_FILTER_SECTIONS],
    suggestionsProvider,
    // #910: the baseline is the same call with the filter arguments dropped, keeping only scope.
    baselineProvider: async () =>
      mapSuggestions(await getFilterSuggestions({ ...(spaceId ? { spaceId } : { withSharedSpaces: true }) }), spaceId),
    providers: {
      cities: (country: string, context) =>
        getSearchSuggestions({
          $type: SearchSuggestionType.City,
          country,
          ...(spaceId ? { spaceId } : { withSharedSpaces: true }),
          ...context,
        }),
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
