import { AssetOrderBy, AssetTypeEnum } from '@immich/sdk';
import { buildFilterContext, type FilterState } from '$lib/components/filter-panel/filter-panel';
import { buildPhotosTimelineOptions } from '$lib/utils/photos-filter-options';

/**
 * Whether the Recently Added header should display an item count.
 *
 * Hidden only when there is nothing to show *and* no filter is active: that state is either
 * "buckets have not loaded yet" or "empty account", and both are better served by the
 * EmptyPlaceholder than by a transient "0 items". With a filter active, "0 items" is
 * informative — it says the filter matched nothing.
 */
export function shouldShowRecentlyAddedCount(count: number, hasActiveFilters: boolean): boolean {
  return count > 0 || hasActiveFilters;
}

/**
 * Timeline query for the Recently Added view.
 *
 * Reuses Photos' predicate mapping, then applies the two invariants that define this view:
 *  1. never surface shared-space assets — `withSharedSpaces` is stripped in every case, so the
 *     view stays own + partner (and own-only under a Favorites filter, which Photos treats as
 *     a personal flag);
 *  2. always order and day-group by *added* date.
 *
 * Note the date filter still filters *taken* date (there is no created-at range predicate);
 * day-groups reflect added date. That mismatch is intentional — e.g. old photos just imported.
 * The filter panel's year/month grid must therefore be built from
 * `buildRecentlyAddedPickerBucketOptions`, NOT from these buckets.
 *
 * `userId` is required and always sent for the same reason `/photos` sends it (D3): it is this
 * view's owner gate, so an `albumId` chip NARROWS my own recently-added assets instead of
 * redefining the scope to "everything in that album".
 */
export function buildRecentlyAddedTimelineOptions(filters: FilterState, userId: string): Record<string, unknown> {
  const { withSharedSpaces: _, ...base } = buildPhotosTimelineOptions(filters, userId);
  return { ...base, orderBy: AssetOrderBy.CreatedAt };
}

/**
 * Bucket query backing the filter panel's temporal picker (the year / month grid).
 *
 * Identical to the timeline query except that it groups by **taken** date. The picker's grid and
 * the predicate a click on it produces have to read the same column: clicking a year emits
 * `takenAfter` / `takenBefore`, which the server applies to `asset.localDateTime`. Deriving the
 * grid from the timeline's `orderBy: CreatedAt` buckets instead listed *upload* years, so a
 * library imported this year offered a single chip that matched nothing.
 *
 * This is also what query mode already does — smart-search facets bucket on takenAt — so browse
 * and query mode now agree.
 */
export function buildRecentlyAddedPickerBucketOptions(filters: FilterState, userId: string): Record<string, unknown> {
  const { withSharedSpaces: _, ...base } = buildPhotosTimelineOptions(filters, userId);
  return { ...base, orderBy: AssetOrderBy.TakenAt };
}

/**
 * Filter-suggestion request for the Recently Added panel. Deliberately carries no
 * `withSharedSpaces` / `albumId` / `spaceId` — suggestions must describe the same own+partner
 * set the timeline shows.
 */
export function buildRecentlyAddedSuggestionRequest(filters: FilterState) {
  const context = buildFilterContext(filters);
  return {
    personIds: filters.personIds.length > 0 ? filters.personIds : undefined,
    country: filters.country,
    state: filters.state,
    city: filters.city,
    make: filters.make,
    model: filters.model,
    lensModel: filters.lensModel,
    ownerId: filters.ownerId,
    tagIds: filters.tagIds.length > 0 ? filters.tagIds : undefined,
    rating: filters.rating,
    isFavorite: filters.isFavorite,
    isNotInAlbum: filters.isNotInAlbum === true ? true : undefined,
    isInAlbum: filters.isInAlbum === true ? true : undefined,
    mediaType:
      filters.mediaType === 'all'
        ? undefined
        : filters.mediaType === 'image'
          ? AssetTypeEnum.Image
          : AssetTypeEnum.Video,
    takenAfter: context?.takenAfter,
    takenBefore: context?.takenBefore,
  };
}
