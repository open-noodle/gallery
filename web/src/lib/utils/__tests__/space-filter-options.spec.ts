import { AssetOrder, AssetTypeEnum } from '@immich/sdk';
import { describe, expect, it } from 'vitest';
import { createFilterState } from '$lib/components/filter-panel/filter-panel';
import { buildSpaceTimelineOptions, handleSpaceRemoveFilter } from '$lib/utils/space-filter-options';

describe('buildSpaceTimelineOptions', () => {
  it('maps custom dates and people for spaces timeline options', () => {
    const filters = {
      ...createFilterState(),
      personIds: ['space-person-1'],
      dateAfter: '2024-01-01',
      dateBefore: '2024-12-31',
    };

    expect(buildSpaceTimelineOptions('space-1', filters)).toEqual(
      expect.objectContaining({
        spaceId: 'space-1',
        withStacked: true,
        spacePersonIds: ['space-person-1'],
        takenAfter: '2024-01-01T00:00:00.000Z',
        takenBefore: '2025-01-01T00:00:00.000Z',
      }),
    );
  });

  it('prefers custom dates over selected year and month', () => {
    const filters = {
      ...createFilterState(),
      selectedYear: 2023,
      selectedMonth: 8,
      dateBefore: '2024-12-31',
    };

    const result = buildSpaceTimelineOptions('space-1', filters);
    expect(result.takenAfter).toBeUndefined();
    expect(result.takenBefore).toBe('2025-01-01T00:00:00.000Z');
  });

  it('maps media type and sort order for spaces timeline options', () => {
    const filters = { ...createFilterState(), mediaType: 'video' as const, sortOrder: 'asc' as const };

    expect(buildSpaceTimelineOptions('space-1', filters)).toEqual(
      expect.objectContaining({
        $type: AssetTypeEnum.Video,
        order: AssetOrder.Asc,
      }),
    );
  });

  it('preserves location, camera, rating, and tags in spaces timeline options', () => {
    const filters = {
      ...createFilterState(),
      city: 'Berlin',
      country: 'Germany',
      make: 'Sony',
      model: 'A7C',
      rating: 4,
      tagIds: ['tag-1'],
    };

    expect(buildSpaceTimelineOptions('space-1', filters)).toEqual(
      expect.objectContaining({
        city: 'Berlin',
        country: 'Germany',
        make: 'Sony',
        model: 'A7C',
        rating: 4,
        tagIds: ['tag-1'],
      }),
    );
  });

  it('preserves favorites in spaces timeline options', () => {
    const filters = { ...createFilterState(), isFavorite: true };

    expect(buildSpaceTimelineOptions('space-1', filters)).toEqual(
      expect.objectContaining({
        spaceId: 'space-1',
        isFavorite: true,
      }),
    );
  });

  it('preserves has-no-album in spaces timeline options', () => {
    const filters = { ...createFilterState(), isNotInAlbum: true };

    expect(buildSpaceTimelineOptions('space-1', filters)).toEqual(
      expect.objectContaining({
        spaceId: 'space-1',
        isNotInAlbum: true,
      }),
    );
  });

  it('omits has-no-album when it is false', () => {
    const filters = { ...createFilterState(), isNotInAlbum: false };

    expect(buildSpaceTimelineOptions('space-1', filters)).not.toHaveProperty('isNotInAlbum');
  });

  it('preserves has-album in spaces timeline options', () => {
    const filters = { ...createFilterState(), isInAlbum: true };

    expect(buildSpaceTimelineOptions('space-1', filters)).toEqual(
      expect.objectContaining({
        spaceId: 'space-1',
        isInAlbum: true,
      }),
    );
  });

  it('omits has-album when it is false', () => {
    const filters = { ...createFilterState(), isInAlbum: false };

    expect(buildSpaceTimelineOptions('space-1', filters)).not.toHaveProperty('isInAlbum');
  });

  it('includes trimmed description/filename/ocr text filters', () => {
    const filters = { ...createFilterState(), description: '  beach  ', originalFileName: 'IMG_001', ocr: 'invoice' };

    expect(buildSpaceTimelineOptions('space-1', filters)).toEqual(
      expect.objectContaining({ description: 'beach', originalFileName: 'IMG_001', ocr: 'invoice' }),
    );
  });

  it('omits empty / whitespace-only text filters', () => {
    const filters = { ...createFilterState(), description: ' '.repeat(3), originalFileName: '', ocr: undefined };
    const options = buildSpaceTimelineOptions('space-1', filters);

    expect(options).not.toHaveProperty('description');
    expect(options).not.toHaveProperty('originalFileName');
    expect(options).not.toHaveProperty('ocr');
  });

  it('forwards the new filter dimensions to the space timeline query', () => {
    const filters = {
      ...createFilterState(),
      lensModel: 'RF24-70mm F2.8 L IS USM',
      state: 'State of Berlin',
      albumId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
      ownerId: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
    };

    expect(buildSpaceTimelineOptions('space-1', filters)).toMatchObject({
      lensModel: 'RF24-70mm F2.8 L IS USM',
      state: 'State of Berlin',
      albumId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
      ownerId: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
    });
  });
});

describe('handleSpaceRemoveFilter', () => {
  it('clears both temporal modes when removing timeline filter', () => {
    const filters = {
      ...createFilterState(),
      dateAfter: '2024-01-01',
      dateBefore: '2024-12-31',
      selectedYear: 2023,
      selectedMonth: 8,
    };

    const result = handleSpaceRemoveFilter(filters, 'timeline');
    expect(result.dateAfter).toBeUndefined();
    expect(result.dateBefore).toBeUndefined();
    expect(result.selectedYear).toBeUndefined();
    expect(result.selectedMonth).toBeUndefined();
  });

  it('clears description / filename / ocr text filters by chip type', () => {
    const filters = { ...createFilterState(), description: 'beach', originalFileName: 'IMG', ocr: 'invoice' };
    expect(handleSpaceRemoveFilter(filters, 'description').description).toBeUndefined();
    expect(handleSpaceRemoveFilter(filters, 'filename').originalFileName).toBeUndefined();
    expect(handleSpaceRemoveFilter(filters, 'ocr').ocr).toBeUndefined();
  });

  it('timeline chip removal clears only temporal filter state', () => {
    const filters = {
      ...createFilterState(),
      personIds: ['person-1'],
      city: 'Berlin',
      country: 'Germany',
      make: 'Sony',
      model: 'A7C',
      tagIds: ['tag-1'],
      rating: 4,
      mediaType: 'video' as const,
      isFavorite: true,
      isNotInAlbum: true,
      sortOrder: 'asc' as const,
      dateAfter: '2024-01-01',
      dateBefore: '2024-12-31',
      selectedYear: 2023,
      selectedMonth: 8,
    };

    const result = handleSpaceRemoveFilter(filters, 'timeline');
    expect(result).toMatchObject({
      personIds: ['person-1'],
      city: 'Berlin',
      country: 'Germany',
      make: 'Sony',
      model: 'A7C',
      tagIds: ['tag-1'],
      rating: 4,
      mediaType: 'video',
      isFavorite: true,
      isNotInAlbum: true,
      sortOrder: 'asc',
      dateAfter: undefined,
      dateBefore: undefined,
      selectedYear: undefined,
      selectedMonth: undefined,
    });
  });

  it('clears favorites when removing favorites filter', () => {
    const filters = { ...createFilterState(), isFavorite: true };

    expect(handleSpaceRemoveFilter(filters, 'favorites').isFavorite).toBeUndefined();
    expect(handleSpaceRemoveFilter(filters, 'isFavorite').isFavorite).toBeUndefined();
  });

  it('clears has-no-album when removing albums filter', () => {
    const filters = { ...createFilterState(), isNotInAlbum: true };

    expect(handleSpaceRemoveFilter(filters, 'albums').isNotInAlbum).toBeUndefined();
    expect(handleSpaceRemoveFilter(filters, 'isNotInAlbum').isNotInAlbum).toBeUndefined();
  });

  it('clears has-album when removing albums filter', () => {
    const filters = { ...createFilterState(), isInAlbum: true };

    expect(handleSpaceRemoveFilter(filters, 'albums').isInAlbum).toBeUndefined();
    expect(handleSpaceRemoveFilter(filters, 'isInAlbum').isInAlbum).toBeUndefined();
  });

  it('clears lensModel for the lens chip (delegates to the shared handleRemoveFilter)', () => {
    const filters = { ...createFilterState(), lensModel: 'RF24-70mm F2.8 L IS USM' };
    const result = handleSpaceRemoveFilter(filters, 'lens');
    expect(result.lensModel).toBeUndefined();
  });
});
