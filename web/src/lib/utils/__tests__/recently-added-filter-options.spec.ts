import { AssetOrder, AssetOrderBy, AssetTypeEnum, AssetVisibility } from '@immich/sdk';
import { describe, expect, it } from 'vitest';
import { createFilterState } from '$lib/components/filter-panel/filter-panel';
import {
  buildRecentlyAddedPickerBucketOptions,
  buildRecentlyAddedSuggestionRequest,
  buildRecentlyAddedTimelineOptions,
  shouldShowRecentlyAddedCount,
} from '$lib/utils/recently-added-filter-options';

describe('shouldShowRecentlyAddedCount', () => {
  it('hides the count while loading or for an empty account', () => {
    // No buckets loaded yet (assetCount is transiently 0) and no filters: showing
    // "0 items" would flash a wrong count. The EmptyPlaceholder communicates emptiness.
    expect(shouldShowRecentlyAddedCount(0, false)).toBe(false);
  });

  it('shows "0 items" when a filter matched nothing', () => {
    // Informative: tells the user their filter matched nothing, rather than
    // looking like an empty account.
    expect(shouldShowRecentlyAddedCount(0, true)).toBe(true);
  });

  it('shows the count for a populated view without filters', () => {
    expect(shouldShowRecentlyAddedCount(5, false)).toBe(true);
  });

  it('shows the count for a populated filtered view', () => {
    expect(shouldShowRecentlyAddedCount(5, true)).toBe(true);
  });

  it('shows the count at the singular boundary (plural wording is left to i18n)', () => {
    expect(shouldShowRecentlyAddedCount(1, false)).toBe(true);
  });
});

describe('buildRecentlyAddedTimelineOptions', () => {
  it('returns the own+partner added-date shape by default', () => {
    // Exact shape on purpose: if buildPhotosTimelineOptions ever grows a new shared-scope key,
    // this fails rather than silently leaking it into Recently Added.
    expect(buildRecentlyAddedTimelineOptions(createFilterState())).toEqual({
      visibility: AssetVisibility.Timeline,
      withStacked: true,
      withPartners: true,
      order: AssetOrder.Desc,
      orderBy: AssetOrderBy.CreatedAt,
    });
  });

  it('never sends withSharedSpaces under a metadata filter', () => {
    const options = buildRecentlyAddedTimelineOptions({ ...createFilterState(), country: 'Germany' });
    expect(options).not.toHaveProperty('withSharedSpaces');
    expect(options.country).toBe('Germany');
  });

  it('never sends withSharedSpaces under a favorites filter', () => {
    expect(buildRecentlyAddedTimelineOptions({ ...createFilterState(), isFavorite: true })).not.toHaveProperty(
      'withSharedSpaces',
    );
  });

  it('keeps orderBy CreatedAt under every filter combination', () => {
    const cases = [
      createFilterState(),
      { ...createFilterState(), country: 'Germany' },
      { ...createFilterState(), isFavorite: true },
      { ...createFilterState(), sortOrder: 'asc' as const },
    ];
    for (const filters of cases) {
      expect(buildRecentlyAddedTimelineOptions(filters).orderBy).toBe(AssetOrderBy.CreatedAt);
    }
  });

  it('keeps partner assets for a non-favorite filter', () => {
    expect(buildRecentlyAddedTimelineOptions({ ...createFilterState(), rating: 4 }).withPartners).toBe(true);
  });

  it('drops partner assets under a favorites filter (favorites are personal)', () => {
    expect(buildRecentlyAddedTimelineOptions({ ...createFilterState(), isFavorite: true })).not.toHaveProperty(
      'withPartners',
    );
  });

  it('maps sortOrder to order without touching orderBy', () => {
    expect(buildRecentlyAddedTimelineOptions({ ...createFilterState(), sortOrder: 'asc' }).order).toBe(AssetOrder.Asc);
    expect(buildRecentlyAddedTimelineOptions({ ...createFilterState(), sortOrder: 'desc' }).order).toBe(
      AssetOrder.Desc,
    );
    expect(buildRecentlyAddedTimelineOptions({ ...createFilterState(), sortOrder: 'relevance' }).order).toBe(
      AssetOrder.Desc,
    );
  });

  it('degrades a relevance sort to newest-added-first in browse mode', () => {
    // A `?q=` in the URL resolves sortOrder to 'relevance'. Browse mode has no relevance ranking,
    // so it must fall back to the view's natural default rather than producing an invalid order.
    const options = buildRecentlyAddedTimelineOptions({ ...createFilterState(), sortOrder: 'relevance' });

    expect(options.order).toBe(AssetOrder.Desc);
    expect(options.orderBy).toBe(AssetOrderBy.CreatedAt);
  });

  it('passes metadata predicates through', () => {
    const options = buildRecentlyAddedTimelineOptions({
      ...createFilterState(),
      personIds: ['person:p1'],
      city: 'Berlin',
      country: 'Germany',
      make: 'Sony',
      model: 'A7',
      tagIds: ['tag-1'],
      rating: 5,
    });

    expect(options).toMatchObject({
      personIds: ['person:p1'],
      city: 'Berlin',
      country: 'Germany',
      make: 'Sony',
      model: 'A7',
      tagIds: ['tag-1'],
      rating: 5,
    });
  });

  it('maps mediaType to $type and omits it for "all"', () => {
    expect(buildRecentlyAddedTimelineOptions({ ...createFilterState(), mediaType: 'image' }).$type).toBe(
      AssetTypeEnum.Image,
    );
    expect(buildRecentlyAddedTimelineOptions({ ...createFilterState(), mediaType: 'video' }).$type).toBe(
      AssetTypeEnum.Video,
    );
    expect(buildRecentlyAddedTimelineOptions({ ...createFilterState(), mediaType: 'all' })).not.toHaveProperty('$type');
  });

  it('trims text predicates and omits them when blank', () => {
    const set = buildRecentlyAddedTimelineOptions({
      ...createFilterState(),
      description: '  sunset  ',
      originalFileName: '  IMG_1.jpg  ',
      ocr: '  invoice  ',
    });
    expect(set).toMatchObject({ description: 'sunset', originalFileName: 'IMG_1.jpg', ocr: 'invoice' });

    const blank = buildRecentlyAddedTimelineOptions({
      ...createFilterState(),
      description: ' '.repeat(3),
      originalFileName: ' '.repeat(3),
      ocr: ' '.repeat(3),
    });
    expect(blank).not.toHaveProperty('description');
    expect(blank).not.toHaveProperty('originalFileName');
    expect(blank).not.toHaveProperty('ocr');
  });

  it('passes album membership flags only when true', () => {
    expect(buildRecentlyAddedTimelineOptions({ ...createFilterState(), isNotInAlbum: true }).isNotInAlbum).toBe(true);
    expect(buildRecentlyAddedTimelineOptions({ ...createFilterState(), isInAlbum: true }).isInAlbum).toBe(true);
    expect(buildRecentlyAddedTimelineOptions({ ...createFilterState(), isNotInAlbum: false })).not.toHaveProperty(
      'isNotInAlbum',
    );
    expect(buildRecentlyAddedTimelineOptions({ ...createFilterState(), isInAlbum: false })).not.toHaveProperty(
      'isInAlbum',
    );
  });

  it('derives takenAfter/takenBefore from the timeline date filter', () => {
    // Documented semantic: the date filter filters *taken* date while day-groups reflect *added*
    // date. Intentional — no created-at range predicate exists (that would be backend work).
    const year = buildRecentlyAddedTimelineOptions({ ...createFilterState(), selectedYear: 2024 });
    expect(year.takenAfter).toBe('2024-01-01T00:00:00.000Z');
    expect(year.takenBefore).toBe('2025-01-01T00:00:00.000Z');

    const yearMonth = buildRecentlyAddedTimelineOptions({
      ...createFilterState(),
      selectedYear: 2024,
      selectedMonth: 3,
    });
    expect(yearMonth.takenAfter).toBe('2024-03-01T00:00:00.000Z');
    expect(yearMonth.takenBefore).toBe('2024-04-01T00:00:00.000Z');

    const custom = buildRecentlyAddedTimelineOptions({
      ...createFilterState(),
      dateAfter: '2024-01-01',
      dateBefore: '2024-12-31',
    });
    expect(custom.takenAfter).toBe('2024-01-01T00:00:00.000Z');
    expect(custom.takenBefore).toBe('2025-01-01T00:00:00.000Z');

    const fromOnly = buildRecentlyAddedTimelineOptions({ ...createFilterState(), dateAfter: '2024-01-01' });
    expect(fromOnly.takenAfter).toBe('2024-01-01T00:00:00.000Z');
    expect(fromOnly).not.toHaveProperty('takenBefore');

    const toOnly = buildRecentlyAddedTimelineOptions({ ...createFilterState(), dateBefore: '2024-12-31' });
    expect(toOnly.takenBefore).toBe('2025-01-01T00:00:00.000Z');
    expect(toOnly).not.toHaveProperty('takenAfter');
  });

  it('holds both invariants under a multi-filter combination', () => {
    const options = buildRecentlyAddedTimelineOptions({
      ...createFilterState(),
      personIds: ['person:p1'],
      country: 'Germany',
      tagIds: ['tag-1'],
      mediaType: 'video',
      sortOrder: 'asc',
    });

    expect(options.orderBy).toBe(AssetOrderBy.CreatedAt);
    expect(options).not.toHaveProperty('withSharedSpaces');
  });
});

describe('buildRecentlyAddedPickerBucketOptions', () => {
  it('buckets by taken date, not by added date', () => {
    // The regression this exists to prevent: the temporal picker's year/month grid used to be
    // sourced from the CreatedAt-ordered *timeline* buckets, so it listed **upload** years — while
    // clicking a year emits takenAfter/takenBefore against localDateTime. A library imported in
    // 2026 therefore showed a single "2026" chip that matched zero assets. The grid and the
    // predicate must read the same column, and takenAt is the one the predicate uses.
    expect(buildRecentlyAddedPickerBucketOptions(createFilterState()).orderBy).toBe(AssetOrderBy.TakenAt);
  });

  it('keeps the own+partner scope of the view it describes', () => {
    // Same invariant as the timeline: a facet grid must never count shared-space assets the
    // timeline below it will not show.
    expect(buildRecentlyAddedPickerBucketOptions(createFilterState())).toEqual({
      visibility: AssetVisibility.Timeline,
      withStacked: true,
      withPartners: true,
      order: AssetOrder.Desc,
      orderBy: AssetOrderBy.TakenAt,
    });
  });

  it('never sends withSharedSpaces under any filter', () => {
    const cases = [
      { ...createFilterState(), country: 'Germany' },
      { ...createFilterState(), isFavorite: true },
      { ...createFilterState(), personIds: ['person:p1'] },
    ];
    for (const filters of cases) {
      expect(buildRecentlyAddedPickerBucketOptions(filters)).not.toHaveProperty('withSharedSpaces');
    }
  });

  it('keeps orderBy TakenAt under every filter combination', () => {
    const cases = [
      createFilterState(),
      { ...createFilterState(), country: 'Germany' },
      { ...createFilterState(), isFavorite: true },
      { ...createFilterState(), sortOrder: 'asc' as const },
      { ...createFilterState(), selectedYear: 2024 },
    ];
    for (const filters of cases) {
      expect(buildRecentlyAddedPickerBucketOptions(filters).orderBy).toBe(AssetOrderBy.TakenAt);
    }
  });

  it('scopes the grid by the other active filters', () => {
    // The counts on each year chip must describe the set the timeline is showing, so every
    // non-temporal predicate carries over.
    expect(
      buildRecentlyAddedPickerBucketOptions({
        ...createFilterState(),
        personIds: ['person:p1'],
        country: 'Germany',
        tagIds: ['tag-1'],
        rating: 5,
        mediaType: 'video',
      }),
    ).toMatchObject({
      personIds: ['person:p1'],
      country: 'Germany',
      tagIds: ['tag-1'],
      rating: 5,
      $type: AssetTypeEnum.Video,
    });
  });
});

describe('buildRecentlyAddedSuggestionRequest', () => {
  it('never scopes to shared spaces, albums, or spaces', () => {
    const request = buildRecentlyAddedSuggestionRequest(createFilterState());
    expect(request).not.toHaveProperty('withSharedSpaces');
    expect(request).not.toHaveProperty('albumId');
    expect(request).not.toHaveProperty('spaceId');
  });

  it('sends undefined for empty person and tag selections', () => {
    const request = buildRecentlyAddedSuggestionRequest(createFilterState());
    expect(request.personIds).toBeUndefined();
    expect(request.tagIds).toBeUndefined();
  });

  it('sends arrays when people and tags are selected', () => {
    const request = buildRecentlyAddedSuggestionRequest({
      ...createFilterState(),
      personIds: ['person:p1'],
      tagIds: ['tag-1'],
    });
    expect(request.personIds).toEqual(['person:p1']);
    expect(request.tagIds).toEqual(['tag-1']);
  });

  it('maps mediaType and omits it for "all"', () => {
    expect(buildRecentlyAddedSuggestionRequest({ ...createFilterState(), mediaType: 'image' }).mediaType).toBe(
      AssetTypeEnum.Image,
    );
    expect(buildRecentlyAddedSuggestionRequest({ ...createFilterState(), mediaType: 'video' }).mediaType).toBe(
      AssetTypeEnum.Video,
    );
    expect(buildRecentlyAddedSuggestionRequest({ ...createFilterState(), mediaType: 'all' }).mediaType).toBeUndefined();
  });

  it('passes isFavorite and location/camera predicates through', () => {
    const request = buildRecentlyAddedSuggestionRequest({
      ...createFilterState(),
      isFavorite: true,
      country: 'Germany',
      city: 'Berlin',
      make: 'Sony',
      model: 'A7',
      rating: 3,
    });
    expect(request).toMatchObject({
      isFavorite: true,
      country: 'Germany',
      city: 'Berlin',
      make: 'Sony',
      model: 'A7',
      rating: 3,
    });
  });

  it('passes the date range for year and custom filters', () => {
    const year = buildRecentlyAddedSuggestionRequest({ ...createFilterState(), selectedYear: 2024 });
    expect(year.takenAfter).toBe('2024-01-01T00:00:00.000Z');
    expect(year.takenBefore).toBe('2025-01-01T00:00:00.000Z');

    const custom = buildRecentlyAddedSuggestionRequest({
      ...createFilterState(),
      dateAfter: '2024-01-01',
      dateBefore: '2024-12-31',
    });
    expect(custom.takenAfter).toBe('2024-01-01T00:00:00.000Z');
    expect(custom.takenBefore).toBe('2025-01-01T00:00:00.000Z');
  });

  it('passes album membership flags only when true', () => {
    expect(buildRecentlyAddedSuggestionRequest({ ...createFilterState(), isNotInAlbum: true }).isNotInAlbum).toBe(true);
    expect(buildRecentlyAddedSuggestionRequest({ ...createFilterState(), isInAlbum: true }).isInAlbum).toBe(true);
    expect(
      buildRecentlyAddedSuggestionRequest({ ...createFilterState(), isNotInAlbum: false }).isNotInAlbum,
    ).toBeUndefined();
    expect(buildRecentlyAddedSuggestionRequest({ ...createFilterState(), isInAlbum: false }).isInAlbum).toBeUndefined();
    expect(buildRecentlyAddedSuggestionRequest(createFilterState()).isNotInAlbum).toBeUndefined();
    expect(buildRecentlyAddedSuggestionRequest(createFilterState()).isInAlbum).toBeUndefined();
  });
});
