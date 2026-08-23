import type { FilterSection, FilterSuggestionsResponse } from './filter-panel';

/**
 * Whether a filter section can do anything for the user right now (#910).
 *
 * - `available`   — render normally.
 * - `empty`       — the current filters narrowed it to nothing; grey it out with `(0)`.
 * - `unavailable` — nothing in this scope could ever populate it; do not render it at all.
 */
export type SectionAvailability = 'available' | 'empty' | 'unavailable';

export interface AvailabilityInput {
  /** Facets for the filters the user has applied right now. */
  current: FilterSuggestionsResponse;
  /** Facets for the same scope with no filters applied. `undefined` while it is still in flight. */
  baseline: FilterSuggestionsResponse | undefined;
  /** Whether this section itself currently holds a filter value. */
  hasActiveFilter: boolean;
  /** Timeline is fed by the page's own buckets rather than a server facet. */
  timeBucketCount: number;
}

/**
 * Whether this section's facet offers the user a choice. Not simply "is the list empty": a control that
 * can only select everything, or only select nothing, is equally useless.
 */
function isSectionEmpty(section: FilterSection, facets: FilterSuggestionsResponse): boolean {
  switch (section) {
    case 'people': {
      // Zero named people is still useful while unnamed faces exist — the empty state is the only
      // prompt to name one.
      return facets.people.length === 0 && !facets.hasUnnamedPeople;
    }
    case 'location': {
      return facets.countries.length === 0;
    }
    case 'camera': {
      return facets.cameraMakes.length === 0;
    }
    case 'tags': {
      return facets.tags.length === 0;
    }
    case 'rating': {
      return facets.ratings.length === 0;
    }
    case 'media': {
      // The control offers All / Photos / Videos, so it needs both of those types to discriminate:
      // with only images, "Photos" is a synonym for "All" and "Videos" is empty.
      //
      // NOT `mediaTypes.length < 2`. getFilteredMediaTypes returns raw `distinct asset.type` and
      // AssetType is IMAGE | VIDEO | AUDIO | OTHER (enum.ts:38), so a photo library holding one
      // OTHER asset would pass a length test with a dead Videos button.
      return !(facets.mediaTypes.includes('IMAGE') && facets.mediaTypes.includes('VIDEO'));
    }
    case 'favorites': {
      return !facets.hasFavorites;
    }
    case 'albums': {
      // Needs both sides: with nothing filed "Has album" is empty, with everything filed "Has no
      // album" is, and either way the control cannot discriminate.
      return !(facets.hasAssetsInAlbum && facets.hasAssetsNotInAlbum);
    }
    default: {
      return false;
    }
  }
}

export function getSectionAvailability(section: FilterSection, input: AvailabilityInput): SectionAvailability {
  // Free text has no enumerable domain to be empty of.
  if (section === 'text') {
    return 'available';
  }

  // Never strand a filter the user cannot then reach to clear. Cross-section narrowing can empty a
  // facet whose own filter is set — person X plus rating 5, where X has no rated photos.
  if (input.hasActiveFilter) {
    return 'available';
  }

  // Timeline's emptiness means "this page has no assets", which the surfaces handle with the panel's
  // `hidden` prop, so it greys but never hides.
  if (section === 'timeline') {
    return input.timeBucketCount === 0 ? 'empty' : 'available';
  }

  if (!isSectionEmpty(section, input.current)) {
    return 'available';
  }

  // A section is never hidden on missing information.
  if (input.baseline === undefined) {
    return 'empty';
  }

  return isSectionEmpty(section, input.baseline) ? 'unavailable' : 'empty';
}
