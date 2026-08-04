import { AssetOrder, AssetTypeEnum, AssetVisibility, type FilterSuggestionsPersonDto } from '@immich/sdk';
import type { FilterState } from '$lib/components/filter-panel/filter-panel';
import { applyTextFilters, buildFilterContext } from '$lib/components/filter-panel/filter-panel';
import { createUrl } from '$lib/utils';
import { clearTimelineTemporalFilter } from '$lib/utils/timeline-temporal-filters';

export type PhotosPersonFilterReference = {
  id: string;
  filterId?: string | null;
  primaryProfile?: {
    type?: string;
    id?: string;
    spaceId?: string;
  };
};

export function buildPhotosTimelineOptions(filters: FilterState): Record<string, unknown> {
  const includeSharedTimelineAssets = filters.isFavorite === undefined;
  const base: Record<string, unknown> = {
    visibility: AssetVisibility.Timeline,
    withStacked: true,
    ...(includeSharedTimelineAssets && { withPartners: true, withSharedSpaces: true }),
  };

  if (filters.personIds.length > 0) {
    base.personIds = filters.personIds;
  }
  if (filters.city) {
    base.city = filters.city;
  }
  if (filters.country) {
    base.country = filters.country;
  }
  if (filters.make) {
    base.make = filters.make;
  }
  if (filters.model) {
    base.model = filters.model;
  }
  applyTextFilters(base, filters);
  if (filters.tagIds.length > 0) {
    base.tagIds = filters.tagIds;
  }
  if (filters.rating !== undefined) {
    base.rating = filters.rating;
  }
  if (filters.isFavorite !== undefined) {
    base.isFavorite = filters.isFavorite;
  }
  if (filters.isNotInAlbum === true) {
    base.isNotInAlbum = true;
  }
  if (filters.isInAlbum === true) {
    base.isInAlbum = true;
  }
  if (filters.mediaType !== 'all') {
    base.$type = filters.mediaType === 'image' ? AssetTypeEnum.Image : AssetTypeEnum.Video;
  }
  base.order = filters.sortOrder === 'asc' ? AssetOrder.Asc : AssetOrder.Desc;

  const context = buildFilterContext(filters);
  if (context) {
    if (context.takenAfter) {
      base.takenAfter = context.takenAfter;
    }
    if (context.takenBefore) {
      base.takenBefore = context.takenBefore;
    }
  }

  return base;
}

export function getPhotosPersonFilterThumbnailUrl(
  person: Pick<FilterSuggestionsPersonDto, 'id' | 'primaryProfile'>,
): string {
  const profile = person.primaryProfile;

  if (profile?.type === 'space-person' && profile.spaceId) {
    return createUrl(`/shared-spaces/${profile.spaceId}/people/${profile.id}/thumbnail`);
  }

  if (profile?.type === 'user-person') {
    return createUrl(`/people/${profile.id}/thumbnail`);
  }

  const userPersonId = person.id.startsWith('person:') ? person.id.slice('person:'.length) : person.id;
  return createUrl(`/people/${userPersonId}/thumbnail`);
}

export function getPhotosPersonFilterId(person: PhotosPersonFilterReference): string {
  if (person.filterId) {
    return person.filterId;
  }

  if (person.primaryProfile?.type === 'space-person' && person.primaryProfile.id) {
    return `space-person:${person.primaryProfile.id}`;
  }

  if (person.primaryProfile?.type === 'user-person' && person.primaryProfile.id) {
    return `person:${person.primaryProfile.id}`;
  }

  return person.id;
}

export function handlePhotosRemoveFilter(filters: FilterState, type: string, id?: string): FilterState {
  switch (type) {
    case 'person': {
      return { ...filters, personIds: filters.personIds.filter((p) => p !== id) };
    }
    case 'location': {
      return { ...filters, city: undefined, country: undefined };
    }
    case 'camera': {
      return { ...filters, make: undefined, model: undefined };
    }
    case 'tag': {
      return { ...filters, tagIds: filters.tagIds.filter((t) => t !== id) };
    }
    case 'rating': {
      return { ...filters, rating: undefined };
    }
    case 'media':
    case 'mediaType': {
      return { ...filters, mediaType: 'all' };
    }
    case 'favorites':
    case 'isFavorite': {
      return { ...filters, isFavorite: undefined };
    }
    case 'albums': {
      return { ...filters, isNotInAlbum: undefined, isInAlbum: undefined };
    }
    case 'isNotInAlbum': {
      return { ...filters, isNotInAlbum: undefined };
    }
    case 'isInAlbum': {
      return { ...filters, isInAlbum: undefined };
    }
    case 'timeline': {
      return clearTimelineTemporalFilter(filters);
    }
    case 'description': {
      return { ...filters, description: undefined };
    }
    case 'filename': {
      return { ...filters, originalFileName: undefined };
    }
    case 'ocr': {
      return { ...filters, ocr: undefined };
    }
    default: {
      return filters;
    }
  }
}
