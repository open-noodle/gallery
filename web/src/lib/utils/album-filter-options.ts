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

/**
 * Picker options for a space album sourced from the SPACE pool rather than the caller's own
 * timeline, so other members' photos can be added. The server accepts those through the #764
 * contribution path (`album.service.tryContributeDeniedAssets`), which is what the space
 * timeline's "+" already uses — this just makes the same operation reachable from the album.
 *
 * `timelineAlbumId` is deliberately kept: it is not the query scope (that is `spaceId`) but the
 * marker query that greys out assets already in the album.
 *
 * Deliberately NOT built on `buildSpaceTimelineOptions`, despite the overlap:
 *
 * - that builder rewrites `filters.personIds` into `spacePersonIds`, which the server validates as
 *   bare `uuidv4`. This picker's filter panel is the personal one, so its person ids are scoped
 *   *tokens* (`person:<uuid>`) and the rewrite would 400 every bucket request. `personIds` accepts
 *   tokens and `TimelineService` resolves them against `scope.spaceId`, so they are passed through.
 * - it sets no visibility, letting the server default to Archive|Timeline. The picker pins
 *   `Timeline` so the Space tab does not quietly offer archived photos the My-photos tab hides.
 */
export function buildSpaceAlbumAssetPickerOptions(
  spaceId: string,
  albumId: string,
  filters: FilterState,
): Record<string, unknown> {
  return applyCommonFilterFields(
    {
      spaceId,
      visibility: AssetVisibility.Timeline,
      timelineAlbumId: albumId,
    },
    filters,
  );
}
