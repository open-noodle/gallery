import { AssetTypeEnum, AssetVisibility, MapMediaType } from '@immich/sdk';
import { applyTextFilters, buildFilterContext, type FilterState } from '$lib/components/filter-panel/filter-panel';

function applyCommonMapFilters(base: Record<string, unknown>, filters: FilterState, includePersonIds = true) {
  if (includePersonIds && filters.personIds.length > 0) {
    base.personIds = filters.personIds;
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
  if (filters.isNotInAlbum === true) {
    base.isNotInAlbum = true;
  }
  if (filters.isInAlbum === true) {
    base.isInAlbum = true;
  }
  if (filters.city) {
    base.city = filters.city;
  }
  if (filters.country) {
    base.country = filters.country;
  }
  // #767 fresh instance: a Space filtered by description/filename/OCR carries those filters to the
  // map (encodeFilterParams), which hydrates them, counts them, and shows a removable chip for
  // each — but until now the marker/time-bucket queries never sent them, so the map showed every
  // pin in the space while claiming the filter was active. Mirror buildPhotosTimelineOptions.
  if (filters.description?.trim()) {
    base.description = filters.description.trim();
  }
  if (filters.originalFileName?.trim()) {
    base.originalFileName = filters.originalFileName.trim();
  }
  if (filters.ocr?.trim()) {
    base.ocr = filters.ocr.trim();
  }

  applyTextFilters(base, filters);

  const context = buildFilterContext(filters);
  if (context?.takenAfter) {
    base.takenAfter = context.takenAfter;
  }
  if (context?.takenBefore) {
    base.takenBefore = context.takenBefore;
  }

  return base;
}

export function buildMapMarkerOptions(filters: FilterState, spaceId?: string): Record<string, unknown> {
  const base = applyCommonMapFilters(spaceId ? { spaceId } : { withSharedSpaces: true }, filters);

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

  if (filters.mediaType !== 'all') {
    base.$type = filters.mediaType === 'image' ? MapMediaType.Image : MapMediaType.Video;
  }

  return base;
}

/**
 * The global/space scope of a map TIMELINE query (the temporal picker's buckets, and the cluster
 * panel's assets).
 *
 * `withSharedSpaces` and `isFavorite` cannot be sent together: `timeline.service.ts`
 * (`timeBucketChecks`) 400s the combination outright — a favourite is the ASSET OWNER's flag, so a
 * shared-space asset can never satisfy my favourites filter. Sending both made the map's favourites
 * chip error the temporal picker and the cluster panel while the markers answered correctly.
 *
 * `buildPhotosTimelineOptions` solves it the same way (drop the widening flags for a favourites
 * query), and so does the marker endpoint (`shared-space.service.ts` does NOT widen a favourites
 * query to shared spaces either) — so the two map surfaces still describe the same asset set.
 */
function mapTimelineScope(filters: FilterState, spaceId?: string): Record<string, unknown> {
  if (spaceId) {
    return { spaceId };
  }

  const includeSharedTimelineAssets = filters.isFavorite === undefined;
  return {
    visibility: AssetVisibility.Timeline,
    ...(includeSharedTimelineAssets && { withSharedSpaces: true }),
  };
}

export function buildMapTimeBucketOptions(filters: FilterState, spaceId?: string): Record<string, unknown> {
  const base = applyCommonMapFilters(mapTimelineScope(filters, spaceId), filters, !spaceId);

  if (spaceId && filters.personIds.length > 0) {
    base.spacePersonIds = filters.personIds;
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

  if (filters.mediaType !== 'all') {
    base.$type = filters.mediaType === 'image' ? AssetTypeEnum.Image : AssetTypeEnum.Video;
  }

  return base;
}

/**
 * Markers for ONE album, honouring that album's active filters.
 *
 * No `withSharedSpaces` and no owner scope: album ACCESS is the scope. The server checks AlbumRead
 * and then leaves `userIds` unset so searchAssetBuilder takes its album branch — owner-scoping an
 * album query hides the album owner's pins from a viewer of a shared album (issue #656).
 */
export function buildAlbumMapMarkerOptions(albumId: string, filters: FilterState): Record<string, unknown> {
  const base = applyCommonMapFilters({ albumId }, filters);

  if (filters.lensModel) {
    base.lensModel = filters.lensModel;
  }
  if (filters.state) {
    base.state = filters.state;
  }
  if (filters.ownerId) {
    base.ownerId = filters.ownerId;
  }

  if (filters.mediaType !== 'all') {
    base.$type = filters.mediaType === 'image' ? MapMediaType.Image : MapMediaType.Video;
  }

  return base;
}

/**
 * Assets behind the map's cluster panel.
 *
 * Its scope must be EXACTLY the marker query's scope (buildMapMarkerOptions): the panel lists the
 * assets behind the pins, so anything it can return that has no pin — or any pin it cannot return —
 * is the map contradicting itself. The active filters are therefore the ONLY thing that scopes it.
 *
 * In particular it takes nothing from `$mapSettings` (Task 11 Step 2). Those legacy toggles
 * (withPartners / onlyFavorites / includeArchived / withSharedAlbums / date range) belong to the
 * pre-filter-panel `/map/markers` endpoint, which Map.svelte still calls; the filtered marker
 * endpoint this page uses honours none of them:
 *   - `withPartners`: FilteredMapMarkerDto has no partner scope at all (shared-space.service.ts
 *     pins `userIds: [auth.user.id]`), so a partner asset never gets a pin — asking the panel for
 *     partner assets could only ever list an asset the map has no pin for. Masked today by the
 *     client-side `assetFilter` (the panel is constrained to ids taken from the markers); it
 *     surfaces the moment that constraint is relaxed.
 *   - `onlyFavorites`: the markers ignore it, so narrowing the panel by it made the panel show
 *     FEWER assets than the cluster's own pin count.
 */
export function buildMapTimelineOptions(
  filters: FilterState | undefined,
  bbox: string,
  selectedClusterIds: Set<string>,
  spaceId?: string,
): Record<string, unknown> {
  const activeFilters: FilterState = filters ?? {
    personIds: [],
    tagIds: [],
    mediaType: 'all',
    sortOrder: 'desc',
  };

  const base = applyCommonMapFilters(
    {
      bbox,
      ...mapTimelineScope(activeFilters, spaceId),
      assetFilter: selectedClusterIds,
    },
    activeFilters,
    false,
  );

  if (filters?.personIds && filters.personIds.length > 0) {
    if (spaceId) {
      base.spacePersonIds = filters.personIds;
    } else {
      base.personIds = filters.personIds;
    }
  }

  if (filters?.mediaType && filters.mediaType !== 'all') {
    base.$type = filters.mediaType === 'image' ? AssetTypeEnum.Image : AssetTypeEnum.Video;
  }

  return base;
}
