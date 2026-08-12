import { AssetOrder, AssetTypeEnum } from '@immich/sdk';
import { applyTextFilters, buildFilterContext, type FilterState } from '$lib/components/filter-panel/filter-panel';
import { handleRemoveFilter } from '$lib/utils/filter-remove';

export function buildSpaceTimelineOptions(spaceId: string, filters: FilterState): Record<string, unknown> {
  const base: Record<string, unknown> = { spaceId, withStacked: true };

  if (filters.personIds.length > 0) {
    base.spacePersonIds = filters.personIds;
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
  if (filters.lensModel) {
    base.lensModel = filters.lensModel;
  }
  if (filters.state) {
    base.state = filters.state;
  }
  if (filters.ownerId) {
    base.ownerId = filters.ownerId;
  }
  if (filters.albumId) {
    base.albumId = filters.albumId;
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
  if (context?.takenAfter) {
    base.takenAfter = context.takenAfter;
  }
  if (context?.takenBefore) {
    base.takenBefore = context.takenBefore;
  }

  return base;
}

export function handleSpaceRemoveFilter(filters: FilterState, type: string, id?: string): FilterState {
  return handleRemoveFilter(filters, type, id);
}
