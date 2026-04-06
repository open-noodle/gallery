import type { FilterState } from '$lib/components/filter-panel/filter-panel';
import { buildSmartSearchParams } from '$lib/utils/space-search';
import { AssetOrder, AssetTypeEnum } from '@immich/sdk';
import { describe, expect, it } from 'vitest';

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

    it('builds takenAfter/takenBefore for selectedYear + selectedMonth (January)', () => {
      const result = buildSmartSearchParams({
        query: 'beach',
        filters: { ...baseFilters, selectedYear: 2024, selectedMonth: 1 },
      });
      expect(result.takenAfter).toBe(new Date(2024, 0, 1).toISOString());
      expect(result.takenBefore).toBe(new Date(2024, 1, 0, 23, 59, 59, 999).toISOString());
    });

    it('builds takenAfter/takenBefore for selectedYear only', () => {
      const result = buildSmartSearchParams({
        query: 'beach',
        filters: { ...baseFilters, selectedYear: 2024 },
      });
      expect(result.takenAfter).toBe(new Date(2024, 0, 1).toISOString());
      expect(result.takenBefore).toBe(new Date(2024, 11, 31, 23, 59, 59, 999).toISOString());
    });
  });
});
