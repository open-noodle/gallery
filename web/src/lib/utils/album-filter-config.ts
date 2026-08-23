import { AssetTypeEnum, getFilterSuggestions, getSearchSuggestions, SearchSuggestionType } from '@immich/sdk';
import {
  ALL_FILTER_SECTIONS,
  buildFilterContext,
  type FilterPanelConfig,
  type FilterState,
} from '$lib/components/filter-panel/filter-panel';
import { getPhotosPersonFilterId, getPhotosPersonFilterThumbnailUrl } from '$lib/utils/photos-filter-options';

/**
 * Album *detail* is scoped to a single album, and asset.repository.ts guards both `isInAlbum` and
 * `isNotInAlbum` with `&& !options.albumId` — inside an album the former is a tautology and the
 * latter an always-empty set, so the server drops them. Rendering the section would give the user
 * two controls that do nothing. Every other section is shared with the rest of the app (#802).
 */
const albumDetailSections = ALL_FILTER_SECTIONS.filter((section) => section !== 'albums');

/**
 * The asset *picker* is not album-scoped server-side — `timelineAlbumId` is stripped from the
 * request before it leaves the timeline manager — so the album-membership filters do work here,
 * and "not in any album" is the natural way to find un-filed photos to add.
 */
const albumPickerSections = ALL_FILTER_SECTIONS;

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
    hasFavorites: response.hasFavorites,
    hasAssetsInAlbum: response.hasAssetsInAlbum,
    hasAssetsNotInAlbum: response.hasAssetsNotInAlbum,
  };
}

function toSuggestionRequest(filters: FilterState) {
  const context = buildFilterContext(filters);
  return {
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
    isFavorite: filters.isFavorite,
    mediaType:
      filters.mediaType === 'all'
        ? undefined
        : filters.mediaType === 'image'
          ? AssetTypeEnum.Image
          : AssetTypeEnum.Video,
    isNotInAlbum: filters.isNotInAlbum === true ? true : undefined,
    isInAlbum: filters.isInAlbum === true ? true : undefined,
    takenAfter: context?.takenAfter,
    takenBefore: context?.takenBefore,
  };
}

export function buildAlbumDetailFilterConfig(albumId: string): FilterPanelConfig {
  return {
    sections: [...albumDetailSections],
    suggestionsProvider: async (filters) =>
      mapSuggestions(await getFilterSuggestions({ albumId, ...toSuggestionRequest(filters) })),
    // #910: the baseline is the same call with the filter arguments dropped, keeping only the
    // album scope.
    baselineProvider: async () => mapSuggestions(await getFilterSuggestions({ albumId })),
    providers: {
      cities: (country, context) =>
        getSearchSuggestions({ $type: SearchSuggestionType.City, albumId, country, ...context }),
      cameraModels: (make, context) =>
        getSearchSuggestions({ $type: SearchSuggestionType.CameraModel, albumId, make, ...context }),
    },
  };
}

export function buildAlbumAssetPickerFilterConfig(): FilterPanelConfig {
  return {
    sections: [...albumPickerSections],
    suggestionsProvider: async (filters) => mapSuggestions(await getFilterSuggestions(toSuggestionRequest(filters))),
    // #910: the picker is not scoped to anything, so the baseline is a plain, filter-free call.
    baselineProvider: async () => mapSuggestions(await getFilterSuggestions({})),
    providers: {
      cities: (country, context) => getSearchSuggestions({ $type: SearchSuggestionType.City, country, ...context }),
      cameraModels: (make, context) =>
        getSearchSuggestions({ $type: SearchSuggestionType.CameraModel, make, ...context }),
    },
  };
}
