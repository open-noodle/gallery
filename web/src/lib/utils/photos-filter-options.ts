import { AssetOrder, AssetTypeEnum, AssetVisibility } from '@immich/sdk';
import type { FilterState } from '$lib/components/filter-panel/filter-panel';
import { buildFilterContext } from '$lib/components/filter-panel/filter-panel';

export function buildPhotosTimelineOptions(filters: FilterState): Record<string, unknown> {
  const base: Record<string, unknown> = {
    visibility: AssetVisibility.Timeline,
    withStacked: true,
    withPartners: true,
    withSharedSpaces: true,
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
  if (filters.tagIds.length > 0) {
    base.tagIds = filters.tagIds;
  }
  if (filters.rating !== undefined) {
    base.rating = filters.rating;
  }
  if (filters.mediaType !== 'all') {
    base.$type = filters.mediaType === 'image' ? AssetTypeEnum.Image : AssetTypeEnum.Video;
  }
  base.order = filters.sortOrder === 'asc' ? AssetOrder.Asc : AssetOrder.Desc;

  const context = buildFilterContext(filters);
  if (context) {
    base.takenAfter = context.takenAfter;
    base.takenBefore = context.takenBefore;
  }

  return base;
}
