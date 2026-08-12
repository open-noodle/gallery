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
  const base = applyCommonFilterFields({ albumId, order }, filters);

  // The route already scopes the query to `albumId`; the server's albumId is a scalar driving one
  // inner join, so a second album cannot be AND-ed. A stray albumId filter is therefore never
  // forwarded here — it must not hijack the route's own album scope.
  if (filters.lensModel) {
    base.lensModel = filters.lensModel;
  }
  if (filters.state) {
    base.state = filters.state;
  }
  if (filters.ownerId) {
    base.ownerId = filters.ownerId;
  }

  return base;
}

// Intentionally does NOT forward lensModel/state/ownerId, unlike its buildAlbumTimelineOptions
// sibling above. This is safe today only because the picker's FilterState is component-local
// (never URL-hydrated) and the shared `sections` const in album-filter-config.ts has no control
// that can ever set these three fields on it — so they can never actually be present here. If
// `sections` (shared by BOTH the album-detail and picker filter configs) ever grows a control that
// sets one of these three, this omission becomes the same "filter honesty" lie #767c fixed for
// description/originalFileName/ocr/isInAlbum/isNotInAlbum above: forward the field here too, in
// the same change that adds the control. See album-filter-options.spec.ts for the pinning test.
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
