import { AssetTypeEnum } from '@immich/sdk';
import { buildFilterContext, type FilterState } from '$lib/components/filter-panel/filter-panel';
import type { SearchTerms } from '$lib/services/search.service';

/**
 * Maps the shared filter-panel state to metadata-search terms, so the exact filters that drive a
 * timeline view can be replayed against `POST /search/metadata` to collect every matching asset id
 * (see `collectSearchResultAssetIds`). Only the filter fields are mapped here — surface-specific
 * scoping (visibility, withPartners / withSharedSpaces, spaceId, albumIds, personId) is added by the
 * caller, mirroring how each `build*TimelineOptions` helper scopes its own timeline query.
 */
export function filterStateToSearchTerms(filters: FilterState): SearchTerms {
  const terms: SearchTerms = {};

  if (filters.personIds.length > 0) {
    terms.personIds = filters.personIds;
  }
  if (filters.tagIds.length > 0) {
    terms.tagIds = filters.tagIds;
  }
  if (filters.city) {
    terms.city = filters.city;
  }
  if (filters.country) {
    terms.country = filters.country;
  }
  if (filters.make) {
    terms.make = filters.make;
  }
  if (filters.model) {
    terms.model = filters.model;
  }
  if (filters.description?.trim()) {
    terms.description = filters.description.trim();
  }
  if (filters.originalFileName?.trim()) {
    terms.originalFileName = filters.originalFileName.trim();
  }
  if (filters.ocr?.trim()) {
    terms.ocr = filters.ocr.trim();
  }
  if (filters.rating !== undefined) {
    terms.rating = filters.rating;
  }
  if (filters.isFavorite !== undefined) {
    terms.isFavorite = filters.isFavorite;
  }
  if (filters.isNotInAlbum === true) {
    terms.isNotInAlbum = true;
  }
  if (filters.isInAlbum === true) {
    terms.isInAlbum = true;
  }
  if (filters.mediaType !== 'all') {
    terms.type = filters.mediaType === 'image' ? AssetTypeEnum.Image : AssetTypeEnum.Video;
  }

  const context = buildFilterContext(filters);
  if (context?.takenAfter) {
    terms.takenAfter = context.takenAfter;
  }
  if (context?.takenBefore) {
    terms.takenBefore = context.takenBefore;
  }

  return terms;
}
