import {
  AssetOrder,
  AssetTypeEnum,
  type SmartSearchDto,
  type SmartSearchFacetsDto,
  type SmartSearchFacetsResponseDto,
} from '@immich/sdk';
import { buildFilterContext, type FilterState } from '$lib/components/filter-panel/filter-panel';
import { createUrl } from '$lib/utils';
import { getPhotosPersonFilterId, getPhotosPersonFilterThumbnailUrl } from '$lib/utils/photos-filter-options';

export const SEARCH_FILTER_DEBOUNCE_MS = 250;

type SmartSearchParamsArgs = {
  query: string;
  filters: FilterState;
  spaceId?: string;
  withSharedSpaces?: boolean;
  language?: string;
};

/**
 * How query mode (smart search) treats each filter-panel dimension.
 *
 * - `sent` — forwarded to `SmartSearchDto`, possibly under a different name
 *   (`albumId` → `albumIds`, `mediaType` → `type`, `sortOrder` → `order`).
 * - `derived` — not sent directly; folded into another param by `buildFilterContext`
 *   (the date fields all collapse into `takenAfter` / `takenBefore`).
 * - `unsupported` — `SmartSearchDto` has no such field, so the chip cannot apply in query
 *   mode. Browse mode (`MetadataSearchDto`) does support these; see `filter-search-terms.ts`.
 *
 * `satisfies Record<keyof FilterState, …>` is the point of this map: adding a dimension to
 * `FilterState` without classifying it here fails `tsc`. Without that, a new filter silently
 * fails to reach smart search while its chip still renders as active — which is exactly how
 * `state`, `lensModel`, `ownerId`, `ocr` and `albumId` came to be dropped.
 */
export const QUERY_MODE_FILTER_HANDLING = {
  personIds: 'sent',
  city: 'sent',
  country: 'sent',
  make: 'sent',
  model: 'sent',
  lensModel: 'sent',
  state: 'sent',
  albumId: 'sent',
  ownerId: 'sent',
  ocr: 'sent',
  tagIds: 'sent',
  rating: 'sent',
  mediaType: 'sent',
  isFavorite: 'sent',
  isNotInAlbum: 'sent',
  isInAlbum: 'sent',
  sortOrder: 'sent',
  // SmartSearchDto exposes neither field. Both are unindexed leading-wildcard `ilike` scans that
  // upstream only put on MetadataSearchDto; adding them to smart search is a perf decision, not
  // plumbing. Until then a description / filename chip does not narrow query-mode results.
  description: 'unsupported',
  originalFileName: 'unsupported',
  dateAfter: 'derived',
  dateBefore: 'derived',
  selectedYear: 'derived',
  selectedMonth: 'derived',
} satisfies Record<keyof FilterState, 'sent' | 'derived' | 'unsupported'>;

export function buildSmartSearchParams(args: SmartSearchParamsArgs): SmartSearchDto {
  const { query, filters, spaceId, withSharedSpaces, language } = args;
  const params: SmartSearchDto = { query };
  if (language) {
    params.language = language;
  }

  if (spaceId) {
    params.spaceId = spaceId;
    if (filters.personIds.length > 0) {
      params.spacePersonIds = filters.personIds;
    }
  } else {
    if (filters.personIds.length > 0) {
      params.personIds = filters.personIds;
    }
    if (withSharedSpaces) {
      params.withSharedSpaces = true;
    }
  }

  if (filters.city) {
    params.city = filters.city;
  }
  if (filters.country) {
    params.country = filters.country;
  }
  if (filters.make) {
    params.make = filters.make;
  }
  if (filters.model) {
    params.model = filters.model;
  }
  if (filters.state) {
    params.state = filters.state;
  }
  if (filters.lensModel) {
    params.lensModel = filters.lensModel;
  }
  if (filters.ownerId) {
    params.ownerId = filters.ownerId;
  }
  if (filters.ocr?.trim()) {
    params.ocr = filters.ocr.trim();
  }
  if (filters.albumId) {
    // SmartSearchDto's albumIds is plural; wrap the single contextual filter value, matching
    // filterStateToSearchTerms. Unlike the suggestion endpoints — where albumId is a *scope* and
    // carries IsNotSiblingOf guards against spaceId / withSharedSpaces — here albumIds is a plain
    // filter with no sibling guard, so it composes safely with either scope.
    params.albumIds = [filters.albumId];
  }
  if (filters.tagIds.length > 0) {
    params.tagIds = filters.tagIds;
  }
  if (filters.rating !== undefined) {
    params.rating = filters.rating;
  }
  if (filters.mediaType !== 'all') {
    params.type = filters.mediaType === 'image' ? AssetTypeEnum.Image : AssetTypeEnum.Video;
  }
  if (filters.isNotInAlbum === true) {
    params.isNotInAlbum = true;
  }
  if (filters.isInAlbum === true) {
    params.isInAlbum = true;
  }
  const context = buildFilterContext(filters);
  if (context?.takenAfter) {
    params.takenAfter = context.takenAfter;
  }
  if (context?.takenBefore) {
    params.takenBefore = context.takenBefore;
  }

  if (filters.sortOrder === 'asc') {
    params.order = AssetOrder.Asc;
  } else if (filters.sortOrder === 'desc') {
    params.order = AssetOrder.Desc;
  }

  if (filters.isFavorite !== undefined) {
    params.isFavorite = filters.isFavorite;
  }

  return params;
}

export function buildSmartSearchFacetsParams(args: SmartSearchParamsArgs): SmartSearchFacetsDto {
  const { order: _, ...params } = buildSmartSearchParams(args);
  return params;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

export function buildSmartSearchFacetKey(args: SmartSearchParamsArgs): string {
  return stableJson(buildSmartSearchFacetsParams(args));
}

export function mapSmartSearchFacetsToFilterSuggestions(
  facets: SmartSearchFacetsResponseDto,
  options: { spaceId?: string } = {},
) {
  return {
    countries: facets.countries,
    cities: facets.cities,
    cameraMakes: facets.cameraMakes,
    cameraModels: facets.cameraModels,
    tags: facets.tags.map((tag) => ({ id: tag.id, name: tag.value })),
    people: facets.people.map((person) => ({
      id: options.spaceId ? person.id : getPhotosPersonFilterId(person),
      name: person.name,
      thumbnailUrl: options.spaceId
        ? createUrl(`/shared-spaces/${options.spaceId}/people/${person.id}/thumbnail`)
        : getPhotosPersonFilterThumbnailUrl(person),
    })),
    ratings: facets.ratings,
    mediaTypes: facets.mediaTypes,
    hasUnnamedPeople: facets.hasUnnamedPeople,
  };
}
