import { AssetTypeEnum } from '@immich/sdk';
import { describe, expect, it } from 'vitest';
import { createFilterState, type FilterState } from '$lib/components/filter-panel/filter-panel';
import { filterStateToSearchTerms } from '$lib/utils/filter-search-terms';

describe('filterStateToSearchTerms', () => {
  it('returns empty terms for a cleared filter state', () => {
    expect(filterStateToSearchTerms(createFilterState())).toEqual({});
  });

  it('maps text, people, tag, location, camera, rating, favorite and album filters', () => {
    const filters: FilterState = {
      ...createFilterState(),
      personIds: ['p1', 'p2'],
      tagIds: ['t1'],
      city: 'Lisbon',
      country: 'Portugal',
      make: 'Canon',
      model: 'R6',
      description: 'beach',
      originalFileName: 'IMG',
      ocr: 'invoice',
      rating: 4,
      isFavorite: true,
      isInAlbum: true,
      mediaType: 'image',
    };

    expect(filterStateToSearchTerms(filters)).toEqual({
      personIds: ['p1', 'p2'],
      tagIds: ['t1'],
      city: 'Lisbon',
      country: 'Portugal',
      make: 'Canon',
      model: 'R6',
      description: 'beach',
      originalFileName: 'IMG',
      ocr: 'invoice',
      rating: 4,
      isFavorite: true,
      isInAlbum: true,
      type: AssetTypeEnum.Image,
    });
  });

  it('maps mediaType video to the video asset type', () => {
    const terms = filterStateToSearchTerms({ ...createFilterState(), mediaType: 'video' });
    expect(terms.type).toBe(AssetTypeEnum.Video);
  });

  it('maps isNotInAlbum without emitting isInAlbum', () => {
    const terms = filterStateToSearchTerms({ ...createFilterState(), isNotInAlbum: true });
    expect(terms.isNotInAlbum).toBe(true);
    expect(terms.isInAlbum).toBeUndefined();
  });

  it('omits blank / whitespace-only text filters', () => {
    const terms = filterStateToSearchTerms({
      ...createFilterState(),
      description: ' '.repeat(3),
      originalFileName: '',
      ocr: '  ',
    });
    expect(terms).toEqual({});
  });

  it('maps lensModel and state to search terms', () => {
    const terms = filterStateToSearchTerms({
      ...createFilterState(),
      lensModel: 'RF24-70mm F2.8 L IS USM',
      state: 'State of Berlin',
    });

    expect(terms).toEqual(
      expect.objectContaining({
        lensModel: 'RF24-70mm F2.8 L IS USM',
        state: 'State of Berlin',
      }),
    );
  });

  // MetadataSearchDto's albumIds field is plural/array, so a single albumId filter must be wrapped.
  // Dropping this would make "add all filtered results to a collection" collect every album's assets
  // instead of just the one the user is viewing (live over-collection bug).
  it('maps albumId to albumIds on the search terms', () => {
    const terms = filterStateToSearchTerms({
      ...createFilterState(),
      albumId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
    });

    expect(terms).toEqual(
      expect.objectContaining({
        albumIds: ['aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'],
      }),
    );
  });

  // MetadataSearchDto now has an ownerId field (server-side fix landed alongside this test), so the
  // owner/contributor filter must be forwarded like every other narrowing filter. Dropping it would
  // make "add all filtered results to a collection" collect every owner's assets instead of just the
  // filtered owner's (live over-collection bug).
  it('maps ownerId to the search terms', () => {
    const terms = filterStateToSearchTerms({ ...createFilterState(), ownerId: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb' });

    expect(terms).toEqual(expect.objectContaining({ ownerId: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb' }));
  });

  // Assert the exact ISO instants, as the album/map page tests do. `toBeTruthy()` was vacuous:
  // swapping takenAfter/takenBefore in buildFilterContext (filter-panel.ts) — an INVERTED date
  // range, which matches nothing — left it green, because both fields are non-empty either way.
  // dateBefore is an INCLUSIVE calendar day, so it maps to the EXCLUSIVE start of the next one.
  it('maps a custom date range to takenAfter / takenBefore', () => {
    const terms = filterStateToSearchTerms({
      ...createFilterState(),
      dateAfter: '2024-01-01',
      dateBefore: '2024-12-31',
    });

    expect(terms.takenAfter).toBe('2024-01-01T00:00:00.000Z');
    expect(terms.takenBefore).toBe('2025-01-01T00:00:00.000Z');
  });
});
