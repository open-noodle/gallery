import { AssetOrder, AssetTypeEnum, Type } from '@immich/sdk';
import { describe, expect, it } from 'vitest';
import type { FilterState } from '$lib/components/filter-panel/filter-panel';
import {
  buildSmartSearchFacetKey,
  buildSmartSearchFacetsParams,
  buildSmartSearchParams,
  mapSmartSearchFacetsToFilterSuggestions,
  QUERY_MODE_FILTER_HANDLING,
  SEARCH_FILTER_DEBOUNCE_MS,
} from '$lib/utils/space-search';

const baseFilters: FilterState = {
  personIds: [],
  tagIds: [],
  mediaType: 'all',
  sortOrder: 'desc',
};

describe('buildSmartSearchParams', () => {
  describe('with spaceId', () => {
    it('sets spaceId, maps personIds to spacePersonIds, ignores withSharedSpaces', () => {
      const result = buildSmartSearchParams({
        query: 'beach',
        filters: { ...baseFilters, personIds: ['p1', 'p2'] },
        spaceId: 'space-1',
        withSharedSpaces: true,
      });
      expect(result.spaceId).toBe('space-1');
      expect(result.spacePersonIds).toEqual(['p1', 'p2']);
      expect(result.personIds).toBeUndefined();
      expect(result.withSharedSpaces).toBeUndefined();
    });
  });

  describe('without spaceId', () => {
    it('omits spaceId, passes personIds directly, sets withSharedSpaces when truthy', () => {
      const result = buildSmartSearchParams({
        query: 'beach',
        filters: { ...baseFilters, personIds: ['p1'] },
        withSharedSpaces: true,
      });
      expect(result.spaceId).toBeUndefined();
      expect(result.personIds).toEqual(['p1']);
      expect(result.spacePersonIds).toBeUndefined();
      expect(result.withSharedSpaces).toBe(true);
    });

    it('omits withSharedSpaces when false', () => {
      const result = buildSmartSearchParams({
        query: 'beach',
        filters: baseFilters,
        withSharedSpaces: false,
      });
      expect(result.withSharedSpaces).toBeUndefined();
    });

    it('omits withSharedSpaces when undefined', () => {
      const result = buildSmartSearchParams({ query: 'beach', filters: baseFilters });
      expect(result.withSharedSpaces).toBeUndefined();
    });
  });

  describe('field mappings', () => {
    it('omits personIds and spacePersonIds when filters.personIds is empty', () => {
      const result = buildSmartSearchParams({ query: 'beach', filters: baseFilters });
      expect(result.personIds).toBeUndefined();
      expect(result.spacePersonIds).toBeUndefined();
    });

    it('sets language when provided', () => {
      const result = buildSmartSearchParams({ query: 'beach', filters: baseFilters, language: 'de' });
      expect(result.language).toBe('de');
    });

    it('sets type for mediaType image', () => {
      const result = buildSmartSearchParams({
        query: 'beach',
        filters: { ...baseFilters, mediaType: 'image' },
      });
      expect(result.type).toBe(AssetTypeEnum.Image);
    });

    it('sets type for mediaType video', () => {
      const result = buildSmartSearchParams({
        query: 'beach',
        filters: { ...baseFilters, mediaType: 'video' },
      });
      expect(result.type).toBe(AssetTypeEnum.Video);
    });

    it('omits type for mediaType all', () => {
      const result = buildSmartSearchParams({ query: 'beach', filters: baseFilters });
      expect(result.type).toBeUndefined();
    });

    it('sets order for sortOrder asc', () => {
      const result = buildSmartSearchParams({
        query: 'beach',
        filters: { ...baseFilters, sortOrder: 'asc' },
      });
      expect(result.order).toBe(AssetOrder.Asc);
    });

    it('sets order for sortOrder desc', () => {
      const result = buildSmartSearchParams({
        query: 'beach',
        filters: { ...baseFilters, sortOrder: 'desc' },
      });
      expect(result.order).toBe(AssetOrder.Desc);
    });

    it('omits order for sortOrder relevance', () => {
      const result = buildSmartSearchParams({
        query: 'beach',
        filters: { ...baseFilters, sortOrder: 'relevance' },
      });
      expect(result.order).toBeUndefined();
    });

    it('sets isFavorite when explicitly false', () => {
      const result = buildSmartSearchParams({
        query: 'beach',
        filters: { ...baseFilters, isFavorite: false },
      });
      expect(result.isFavorite).toBe(false);
    });

    it('sets isFavorite when true', () => {
      const result = buildSmartSearchParams({
        query: 'beach',
        filters: { ...baseFilters, isFavorite: true },
      });
      expect(result.isFavorite).toBe(true);
    });

    it('omits isFavorite when undefined', () => {
      const result = buildSmartSearchParams({ query: 'beach', filters: baseFilters });
      expect(result.isFavorite).toBeUndefined();
    });

    it('sets isNotInAlbum when has-no-album is selected', () => {
      const result = buildSmartSearchParams({
        query: 'beach',
        filters: { ...baseFilters, isNotInAlbum: true },
      });

      expect(result.isNotInAlbum).toBe(true);
    });

    it('omits isNotInAlbum when has-no-album is false', () => {
      const result = buildSmartSearchParams({
        query: 'beach',
        filters: { ...baseFilters, isNotInAlbum: false },
      });

      expect(result.isNotInAlbum).toBeUndefined();
    });

    it('sets isInAlbum when has-album is selected', () => {
      const result = buildSmartSearchParams({
        query: 'beach',
        filters: { ...baseFilters, isInAlbum: true },
      });

      expect(result.isInAlbum).toBe(true);
    });

    it('omits isInAlbum when has-album is false', () => {
      const result = buildSmartSearchParams({
        query: 'beach',
        filters: { ...baseFilters, isInAlbum: false },
      });

      expect(result.isInAlbum).toBeUndefined();
    });

    it('builds takenAfter/takenBefore for selectedYear + selectedMonth (January)', () => {
      const result = buildSmartSearchParams({
        query: 'beach',
        filters: { ...baseFilters, selectedYear: 2024, selectedMonth: 1 },
      });
      expect(result.takenAfter).toBe('2024-01-01T00:00:00.000Z');
      expect(result.takenBefore).toBe('2024-02-01T00:00:00.000Z');
    });

    it('builds takenAfter/takenBefore for selectedYear only', () => {
      const result = buildSmartSearchParams({
        query: 'beach',
        filters: { ...baseFilters, selectedYear: 2024 },
      });
      expect(result.takenAfter).toBe('2024-01-01T00:00:00.000Z');
      expect(result.takenBefore).toBe('2025-01-01T00:00:00.000Z');
    });

    it('builds takenAfter/takenBefore from custom dates', () => {
      const result = buildSmartSearchParams({
        query: 'beach',
        filters: { ...baseFilters, dateAfter: '2024-01-01', dateBefore: '2024-12-31' },
      });

      expect(result.takenAfter).toBe('2024-01-01T00:00:00.000Z');
      expect(result.takenBefore).toBe('2025-01-01T00:00:00.000Z');
    });

    it('prefers custom dates over selected year and month', () => {
      const result = buildSmartSearchParams({
        query: 'beach',
        filters: { ...baseFilters, selectedYear: 2023, selectedMonth: 8, dateAfter: '2024-01-01' },
      });

      expect(result.takenAfter).toBe('2024-01-01T00:00:00.000Z');
      expect(result.takenBefore).toBeUndefined();
    });
  });

  describe('compound cases', () => {
    it('handles all filters active simultaneously', () => {
      const result = buildSmartSearchParams({
        query: 'cherry blossoms',
        filters: {
          ...baseFilters,
          personIds: ['p-1'],
          city: 'Tokyo',
          country: 'Japan',
          make: 'Sony',
          model: 'A7IV',
          tagIds: ['t-1', 't-2'],
          rating: 5,
          mediaType: 'video',
          selectedYear: 2025,
          selectedMonth: 3,
          sortOrder: 'desc',
          isFavorite: true,
          isNotInAlbum: true,
        },
        spaceId: 'space-1',
      });
      expect(result.query).toBe('cherry blossoms');
      expect(result.spaceId).toBe('space-1');
      expect(result.spacePersonIds).toEqual(['p-1']);
      expect(result.city).toBe('Tokyo');
      expect(result.country).toBe('Japan');
      expect(result.make).toBe('Sony');
      expect(result.model).toBe('A7IV');
      expect(result.tagIds).toEqual(['t-1', 't-2']);
      expect(result.rating).toBe(5);
      expect(result.type).toBe(AssetTypeEnum.Video);
      expect(result.takenAfter).toBeDefined();
      expect(result.takenBefore).toBeDefined();
      expect(result.order).toBe(AssetOrder.Desc);
      expect(result.isFavorite).toBe(true);
      expect(result.isNotInAlbum).toBe(true);
    });

    it('does not include empty string fields', () => {
      const result = buildSmartSearchParams({
        query: 'beach',
        filters: { ...baseFilters, city: '', country: '', make: '', model: '' },
        spaceId: 'space-1',
      });
      expect(result.city).toBeUndefined();
      expect(result.country).toBeUndefined();
      expect(result.make).toBeUndefined();
      expect(result.model).toBeUndefined();
    });
  });

  // #767: these five were silently dropped — the chip rendered as active while the server never
  // received it, so query-mode results ignored the filter with no way for the user to tell.
  describe('the dimensions that used to be dropped in query mode', () => {
    it('forwards state, lensModel, ownerId and ocr', () => {
      const result = buildSmartSearchParams({
        query: 'beach',
        filters: {
          ...baseFilters,
          state: 'Bavaria',
          lensModel: 'RF 24-70mm',
          ownerId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
          ocr: '  invoice  ',
        },
      });

      expect(result.state).toBe('Bavaria');
      expect(result.lensModel).toBe('RF 24-70mm');
      expect(result.ownerId).toBe('aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa');
      // trimmed, matching filterStateToSearchTerms
      expect(result.ocr).toBe('invoice');
    });

    it('wraps a single albumId into the plural albumIds field', () => {
      const result = buildSmartSearchParams({
        query: 'beach',
        filters: { ...baseFilters, albumId: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb' },
      });

      expect(result.albumIds).toEqual(['bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb']);
    });

    it('composes albumIds with a spaceId scope', () => {
      // Unlike the suggestion endpoints, SmartSearchSchema has no IsNotSiblingOf guard between
      // albumIds and spaceId / withSharedSpaces, so sending both must not be avoided here.
      const result = buildSmartSearchParams({
        query: 'beach',
        filters: { ...baseFilters, albumId: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb' },
        spaceId: 'space-1',
      });

      expect(result.spaceId).toBe('space-1');
      expect(result.albumIds).toEqual(['bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb']);
    });

    it('omits all five when unset, and omits a whitespace-only ocr', () => {
      const result = buildSmartSearchParams({
        query: 'beach',
        filters: { ...baseFilters, ocr: ' '.repeat(3) },
      });

      expect(result.state).toBeUndefined();
      expect(result.lensModel).toBeUndefined();
      expect(result.ownerId).toBeUndefined();
      expect(result.ocr).toBeUndefined();
      expect(result.albumIds).toBeUndefined();
    });

    it('scopes the search to the album route it was called from', () => {
      const result = buildSmartSearchParams({
        query: 'beach',
        filters: baseFilters,
        albumIds: ['cccccccc-cccc-4ccc-cccc-cccccccccccc'],
      });

      expect(result.albumIds).toEqual(['cccccccc-cccc-4ccc-cccc-cccccccccccc']);
    });

    // An album detail page is scoped by its ROUTE, and its filter panel never offers an album
    // control, so the two can only ever coincide via a hand-edited URL. Union rather than
    // overwrite: the route scope must survive whatever the URL carries.
    it('unions the route album scope with an albumId filter', () => {
      const result = buildSmartSearchParams({
        query: 'beach',
        filters: { ...baseFilters, albumId: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb' },
        albumIds: ['cccccccc-cccc-4ccc-cccc-cccccccccccc'],
      });

      expect(result.albumIds).toEqual(['cccccccc-cccc-4ccc-cccc-cccccccccccc', 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb']);
    });

    it('does not duplicate an album that is both the route scope and the filter', () => {
      const result = buildSmartSearchParams({
        query: 'beach',
        filters: { ...baseFilters, albumId: 'cccccccc-cccc-4ccc-cccc-cccccccccccc' },
        albumIds: ['cccccccc-cccc-4ccc-cccc-cccccccccccc'],
      });

      expect(result.albumIds).toEqual(['cccccccc-cccc-4ccc-cccc-cccccccccccc']);
    });

    it('omits albumIds for an empty route scope', () => {
      const result = buildSmartSearchParams({ query: 'beach', filters: baseFilters, albumIds: [] });

      expect(result.albumIds).toBeUndefined();
    });

    it('does not send description or originalFileName, which SmartSearchDto cannot express', () => {
      const result = buildSmartSearchParams({
        query: 'beach',
        filters: { ...baseFilters, description: 'birthday', originalFileName: 'IMG_1234.jpg' },
      });

      // Documents a real limitation rather than asserting desired behaviour: browse mode applies
      // both (MetadataSearchDto), query mode cannot. QUERY_MODE_FILTER_HANDLING marks them
      // 'unsupported'. If SmartSearchDto ever gains them, this test should flip.
      expect(result).not.toHaveProperty('description');
      expect(result).not.toHaveProperty('originalFileName');
    });
  });
});

describe('QUERY_MODE_FILTER_HANDLING', () => {
  // The compile-time `satisfies Record<keyof FilterState, …>` is the real guard — adding a
  // dimension to FilterState without classifying it fails tsc (verified: TS2741). These runtime
  // assertions pin the classifications a reader is most likely to get wrong.
  it('classifies the previously-dropped dimensions as sent', () => {
    expect(QUERY_MODE_FILTER_HANDLING.state).toBe('sent');
    expect(QUERY_MODE_FILTER_HANDLING.lensModel).toBe('sent');
    expect(QUERY_MODE_FILTER_HANDLING.ownerId).toBe('sent');
    expect(QUERY_MODE_FILTER_HANDLING.ocr).toBe('sent');
    expect(QUERY_MODE_FILTER_HANDLING.albumId).toBe('sent');
  });

  it('records the two SmartSearchDto gaps and the derived date fields', () => {
    expect(QUERY_MODE_FILTER_HANDLING.description).toBe('unsupported');
    expect(QUERY_MODE_FILTER_HANDLING.originalFileName).toBe('unsupported');
    expect(QUERY_MODE_FILTER_HANDLING.dateAfter).toBe('derived');
    expect(QUERY_MODE_FILTER_HANDLING.dateBefore).toBe('derived');
    expect(QUERY_MODE_FILTER_HANDLING.selectedYear).toBe('derived');
    expect(QUERY_MODE_FILTER_HANDLING.selectedMonth).toBe('derived');
  });
});

describe('buildSmartSearchFacetsParams', () => {
  it('uses the same filters as smart search but strips sort order', () => {
    const result = buildSmartSearchFacetsParams({
      query: 'beach',
      filters: { ...baseFilters, sortOrder: 'asc', rating: 4, mediaType: 'image' },
      withSharedSpaces: true,
      language: 'de',
    });

    expect(result).toEqual({
      query: 'beach',
      withSharedSpaces: true,
      language: 'de',
      rating: 4,
      type: AssetTypeEnum.Image,
    });
    expect(result).not.toHaveProperty('order');
    expect(result).not.toHaveProperty('page');
    expect(result).not.toHaveProperty('size');
  });

  it('maps space people to spacePersonIds and omits withSharedSpaces for spaces', () => {
    const result = buildSmartSearchFacetsParams({
      query: 'beach',
      filters: { ...baseFilters, personIds: ['space-person-1'] },
      spaceId: 'space-1',
      withSharedSpaces: true,
    });

    expect(result).toMatchObject({ spaceId: 'space-1', spacePersonIds: ['space-person-1'] });
    expect(result.personIds).toBeUndefined();
    expect(result.withSharedSpaces).toBeUndefined();
  });

  // The facet counts and the time-bucket rail sit beside a result grid that IS album-scoped. If the
  // scope did not reach the facets request they would describe the whole library instead.
  it('carries the route album scope so the facets match the results they annotate', () => {
    const result = buildSmartSearchFacetsParams({
      query: 'beach',
      filters: baseFilters,
      albumIds: ['cccccccc-cccc-4ccc-cccc-cccccccccccc'],
    });

    expect(result.albumIds).toEqual(['cccccccc-cccc-4ccc-cccc-cccccccccccc']);
  });

  it('uses a different facet key per album scope', () => {
    const albumOne = buildSmartSearchFacetKey({
      query: 'beach',
      filters: baseFilters,
      albumIds: ['cccccccc-cccc-4ccc-cccc-cccccccccccc'],
    });
    const albumTwo = buildSmartSearchFacetKey({
      query: 'beach',
      filters: baseFilters,
      albumIds: ['dddddddd-dddd-4ddd-dddd-dddddddddddd'],
    });

    expect(albumOne).not.toBe(albumTwo);
  });

  it('uses the same key for sort-only changes', () => {
    const relevanceKey = buildSmartSearchFacetKey({
      query: 'beach',
      filters: { ...baseFilters, sortOrder: 'relevance' },
      withSharedSpaces: true,
    });
    const ascendingKey = buildSmartSearchFacetKey({
      query: 'beach',
      filters: { ...baseFilters, sortOrder: 'asc' },
      withSharedSpaces: true,
    });

    expect(ascendingKey).toBe(relevanceKey);
  });

  it('changes the key for facet-affecting filters', () => {
    const baseKey = buildSmartSearchFacetKey({ query: 'beach', filters: baseFilters, withSharedSpaces: true });
    const countryKey = buildSmartSearchFacetKey({
      query: 'beach',
      filters: { ...baseFilters, country: 'Germany' },
      withSharedSpaces: true,
    });

    expect(countryKey).not.toBe(baseKey);
  });

  it('changes the key when language changes', () => {
    const englishKey = buildSmartSearchFacetKey({
      query: 'beach',
      filters: baseFilters,
      withSharedSpaces: true,
      language: 'en',
    });
    const germanKey = buildSmartSearchFacetKey({
      query: 'beach',
      filters: baseFilters,
      withSharedSpaces: true,
      language: 'de',
    });

    expect(germanKey).not.toBe(englishKey);
  });
});

describe('mapSmartSearchFacetsToFilterSuggestions', () => {
  it('maps SDK facet response to FilterPanel suggestions and thumbnail URLs', () => {
    const result = mapSmartSearchFacetsToFilterSuggestions(
      {
        total: 2,
        timeBuckets: [{ timeBucket: '2024-01-01', count: 2 }],
        countries: ['Germany'],
        cities: ['Berlin'],
        cameraMakes: ['Sony'],
        cameraModels: ['A7'],
        tags: [{ id: 'tag-1', value: 'Travel' }],
        people: [{ id: 'person-1', name: 'Ada' }],
        ratings: [4],
        mediaTypes: [AssetTypeEnum.Image],
        hasUnnamedPeople: true,
        hasFavorites: true,
        hasAssetsInAlbum: true,
        hasAssetsNotInAlbum: true,
      },
      { spaceId: 'space-1' },
    );

    expect(result).toEqual({
      countries: ['Germany'],
      cities: ['Berlin'],
      cameraMakes: ['Sony'],
      cameraModels: ['A7'],
      tags: [{ id: 'tag-1', name: 'Travel' }],
      people: [
        {
          id: 'person-1',
          name: 'Ada',
          thumbnailUrl: '/api/shared-spaces/space-1/people/person-1/thumbnail',
        },
      ],
      ratings: [4],
      mediaTypes: [AssetTypeEnum.Image],
      hasUnnamedPeople: true,
      hasFavorites: true,
      hasAssetsInAlbum: true,
      hasAssetsNotInAlbum: true,
    });
  });

  it('maps global shared-space primary people to shared-space thumbnails', () => {
    const result = mapSmartSearchFacetsToFilterSuggestions({
      total: 1,
      timeBuckets: [],
      countries: [],
      cities: [],
      cameraMakes: [],
      cameraModels: [],
      tags: [],
      people: [
        {
          id: 'space-person:space-person-1',
          name: 'Ada',
          primaryProfile: { type: Type.SpacePerson, id: 'space-person-1', spaceId: 'space-1' },
        },
      ],
      ratings: [],
      mediaTypes: [],
      hasUnnamedPeople: false,
      hasFavorites: false,
      hasAssetsInAlbum: false,
      hasAssetsNotInAlbum: false,
    });

    expect(result.people).toEqual([
      {
        id: 'space-person:space-person-1',
        name: 'Ada',
        thumbnailUrl: '/api/shared-spaces/space-1/people/space-person-1/thumbnail',
      },
    ]);
  });

  it('maps global smart-search facet people by scoped filter id', () => {
    const result = mapSmartSearchFacetsToFilterSuggestions({
      total: 1,
      timeBuckets: [],
      countries: [],
      cities: [],
      cameraMakes: [],
      cameraModels: [],
      tags: [],
      people: [
        {
          id: 'identity-group-1',
          filterId: 'person:person-1',
          name: 'Ada',
          primaryProfile: { type: Type.UserPerson, id: 'person-1' },
        } as never,
      ],
      ratings: [],
      mediaTypes: [],
      hasUnnamedPeople: false,
      hasFavorites: false,
      hasAssetsInAlbum: false,
      hasAssetsNotInAlbum: false,
    });

    expect(result.people[0]).toEqual(
      expect.objectContaining({
        id: 'person:person-1',
        name: 'Ada',
      }),
    );
  });

  it('forwards the #910 availability facets', () => {
    const result = mapSmartSearchFacetsToFilterSuggestions({
      total: 0,
      timeBuckets: [],
      countries: [],
      cities: [],
      cameraMakes: [],
      cameraModels: [],
      tags: [],
      people: [],
      ratings: [],
      mediaTypes: [],
      hasUnnamedPeople: false,
      hasFavorites: false,
      hasAssetsInAlbum: false,
      hasAssetsNotInAlbum: true,
    });

    expect(result.hasFavorites).toBe(false);
    expect(result.hasAssetsInAlbum).toBe(false);
    expect(result.hasAssetsNotInAlbum).toBe(true);
  });
});

describe('SEARCH_FILTER_DEBOUNCE_MS', () => {
  it('is 250ms', () => {
    expect(SEARCH_FILTER_DEBOUNCE_MS).toBe(250);
  });
});
