import { AssetTypeEnum, AssetVisibility, type AssetOrder } from '@immich/sdk';
import { applyTextFilters, buildFilterContext, type FilterState } from '$lib/components/filter-panel/filter-panel';

function applyCommonFilterFields(base: Record<string, unknown>, filters: FilterState): Record<string, unknown> {
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
  if (filters.isFavorite !== undefined) {
    base.isFavorite = filters.isFavorite;
  }
  // Only meaningful for the asset picker — the server drops both when `albumId` is set, so album
  // detail (which does not render the section anyway) is unaffected.
  if (filters.isNotInAlbum === true) {
    base.isNotInAlbum = true;
  }
  if (filters.isInAlbum === true) {
    base.isInAlbum = true;
  }
  applyTextFilters(base, filters);
  if (filters.mediaType !== 'all') {
    base.$type = filters.mediaType === 'image' ? AssetTypeEnum.Image : AssetTypeEnum.Video;
  }

  const context = buildFilterContext(filters);
  if (context) {
    base.takenAfter = context.takenAfter;
    base.takenBefore = context.takenBefore;
  }

  return base;
}

export function buildAlbumTimelineOptions(
  albumId: string,
  order: AssetOrder,
  filters: FilterState,
): Record<string, unknown> {
  return applyCommonFilterFields({ albumId, order }, filters);
}

export function buildAlbumAssetPickerOptions(albumId: string, filters: FilterState): Record<string, unknown> {
  return applyCommonFilterFields(
    {
      visibility: AssetVisibility.Timeline,
      ...(filters.isFavorite === undefined && { withPartners: true }),
      timelineAlbumId: albumId,
    },
    filters,
  );
}
