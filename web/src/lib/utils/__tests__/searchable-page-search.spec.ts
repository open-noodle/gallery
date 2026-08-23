import { describe, expect, it } from 'vitest';
import { createFilterState } from '$lib/components/filter-panel/filter-panel';
import {
  buildSearchablePageUrl,
  clearSearchablePageFilterParams,
  getSearchablePageBasePath,
  getSearchablePageFilterState,
  getSearchablePageState,
} from '$lib/utils/searchable-page-search';

describe('searchable page URL state', () => {
  it('detects photos as a searchable page', () => {
    const state = getSearchablePageState(new URL('https://gallery.test/photos?q=beach'));

    expect(state).toMatchObject({
      basePath: '/photos',
      isSearchable: true,
      query: 'beach',
      sortOrder: 'relevance',
    });
  });

  it('detects spaces and space photos as searchable pages', () => {
    expect(getSearchablePageState(new URL('https://gallery.test/spaces/space-1')).basePath).toBe('/spaces/space-1');
    expect(getSearchablePageState(new URL('https://gallery.test/spaces/space-1/photos')).basePath).toBe(
      '/spaces/space-1/photos',
    );
  });

  it('builds the existing query-only URL without filters', () => {
    const url = new URL('https://gallery.test/photos?view=timeline');

    expect(buildSearchablePageUrl(url, 'beach')).toBe('/photos?view=timeline&q=beach');
  });

  it('preserves existing typed filter params when no replacement filter state is supplied', () => {
    const url = new URL('https://gallery.test/photos?q=beach&people=person-1&city=Berlin&view=timeline');

    expect(buildSearchablePageUrl(url, 'sunset', 'asc')).toBe(
      '/photos?q=sunset&people=person-1&city=Berlin&view=timeline&sort=asc',
    );
  });

  it('drops the transient `at` grid scroll target so filter changes do not re-scroll to a stale asset', () => {
    const url = new URL('https://gallery.test/photos?at=asset-123&view=timeline');

    const result = buildSearchablePageUrl(url, '', 'desc', { ...createFilterState(), originalFileName: '20' });

    expect(result).not.toContain('at=');
    expect(result).toContain('filename=20');
  });
});

describe('typed filter URL state', () => {
  it('serializes typed filters into photos URLs while preserving query and sort', () => {
    const url = new URL('https://gallery.test/photos?view=timeline');
    const filters = {
      ...createFilterState(),
      personIds: ['person-1', 'person-2'],
      tagIds: ['tag-1'],
      city: 'Berlin',
      country: 'Germany',
      make: 'Nikon',
      model: 'Z8',
      mediaType: 'image' as const,
      isFavorite: true,
      isNotInAlbum: true,
      rating: 4,
      dateAfter: '2025-01-01',
      dateBefore: '2026-12-31',
      sortOrder: 'asc' as const,
    };

    const result = buildSearchablePageUrl(url, 'beach', 'asc', filters);

    expect(result).toBe(
      '/photos?view=timeline&q=beach&sort=asc&people=person-1%2Cperson-2&tags=tag-1&city=Berlin&country=Germany&make=Nikon&model=Z8&type=image&favorite=true&album=none&rating=4&from=2025-01-01&to=2026-12-31',
    );
  });

  it('omits has-no-album from URLs when false', () => {
    const url = new URL('https://gallery.test/photos');
    const filters = { ...createFilterState(), isNotInAlbum: false };

    expect(buildSearchablePageUrl(url, '', 'desc', filters)).toBe('/photos?sort=desc');
  });

  // D2 — the year/month is IN the codec, so it serializes like any other filter.
  it('serializes the selected year and month into URL params', () => {
    const url = new URL('https://gallery.test/photos?view=timeline');
    const filters = { ...createFilterState(), personIds: ['person-1'], selectedYear: 2015, selectedMonth: 8 };

    expect(buildSearchablePageUrl(url, '', 'desc', filters)).toBe(
      '/photos?view=timeline&sort=desc&people=person-1&year=2015&month=8',
    );
  });

  it('serializes typed filters into space URLs', () => {
    const url = new URL('https://gallery.test/spaces/space-1/photos?panel=closed');
    const filters = {
      ...createFilterState(),
      city: 'Berlin',
      mediaType: 'video' as const,
      sortOrder: 'relevance' as const,
    };

    const result = buildSearchablePageUrl(url, 'beach', 'relevance', filters);

    expect(result).toBe('/spaces/space-1/photos?panel=closed&q=beach&city=Berlin&type=video');
  });

  it('hydrates typed filter params into FilterState', () => {
    const url = new URL(
      'https://gallery.test/photos?q=beach&people=person-1%2Cperson-2&tags=tag-1&type=video&favorite=false&album=none&rating=5&from=2025-01-01&to=2026-12-31',
    );

    expect(getSearchablePageFilterState(url)).toEqual({
      personIds: ['person-1', 'person-2'],
      tagIds: ['tag-1'],
      mediaType: 'video',
      isFavorite: false,
      isNotInAlbum: true,
      rating: 5,
      dateAfter: '2025-01-01',
      dateBefore: '2026-12-31',
    });
  });

  it('drops invalid typed filter URL params without crashing', () => {
    const url = new URL(
      'https://gallery.test/photos?type=gif&favorite=maybe&album=all&rating=9&from=soon&to=2026-99-01',
    );

    expect(getSearchablePageFilterState(url)).toEqual({});
  });

  // D2 — the selected year/month is URL-backed, not transient. There is no carry-over slot to
  // smuggle it across the page's own goto(): it hydrates from the URL like every other filter.
  it('hydrates the selected year and month from the URL', () => {
    const urlFilters = getSearchablePageFilterState(
      new URL('https://gallery.test/photos?city=Berlin&year=2023&month=6'),
    );

    expect(urlFilters).toEqual({
      city: 'Berlin',
      selectedYear: 2023,
      selectedMonth: 6,
    });
  });

  it('does not hydrate a year alongside an explicit custom date range (from/to wins)', () => {
    const urlFilters = getSearchablePageFilterState(new URL('https://gallery.test/photos?from=2024-01-01&year=2023'));

    expect(urlFilters).toEqual({
      dateAfter: '2024-01-01',
    });
  });

  it('clears only typed filter params', () => {
    const params = new URLSearchParams('q=beach&sort=desc&people=p1&city=Berlin&album=none&view=timeline');

    clearSearchablePageFilterParams(params);

    expect(params.toString()).toBe('q=beach&sort=desc&view=timeline');
  });

  it('serializes has-album into URLs as album=has', () => {
    const url = new URL('https://gallery.test/photos');
    const filters = { ...createFilterState(), isInAlbum: true };

    expect(buildSearchablePageUrl(url, '', 'desc', filters)).toBe('/photos?sort=desc&album=has');
  });

  it('hydrates album=has into isInAlbum', () => {
    const url = new URL('https://gallery.test/photos?album=has');

    expect(getSearchablePageFilterState(url)).toEqual({ isInAlbum: true });
  });

  it('still hydrates album=none into isNotInAlbum', () => {
    const url = new URL('https://gallery.test/photos?album=none');

    expect(getSearchablePageFilterState(url)).toEqual({ isNotInAlbum: true });
  });
});

describe('text filter URL params', () => {
  it('reads description / filename / ocr params into filter state', () => {
    const state = getSearchablePageFilterState(
      new URL('https://gallery.test/photos?description=beach&filename=IMG_001&ocr=invoice'),
    );

    expect(state.description).toBe('beach');
    expect(state.originalFileName).toBe('IMG_001');
    expect(state.ocr).toBe('invoice');
  });

  it('trims and omits empty / whitespace-only text params', () => {
    const state = getSearchablePageFilterState(
      new URL('https://gallery.test/photos?description=%20%20&filename=&ocr=%20hi%20'),
    );

    expect(state.description).toBeUndefined();
    expect(state.originalFileName).toBeUndefined();
    expect(state.ocr).toBe('hi');
  });

  it('serializes text filters back to URL params, mapping originalFileName to filename', () => {
    const filters = {
      ...createFilterState(),
      description: 'beach',
      originalFileName: 'IMG_001',
      ocr: 'invoice',
    };

    const url = buildSearchablePageUrl(new URL('https://gallery.test/photos'), '', 'desc', filters)!;
    const params = new URL(`https://gallery.test${url}`).searchParams;

    expect(params.get('description')).toBe('beach');
    expect(params.get('filename')).toBe('IMG_001');
    expect(params.get('ocr')).toBe('invoice');
    expect(params.get('originalFileName')).toBeNull();
  });

  it('clears text filter params while leaving non-filter params intact', () => {
    const params = new URLSearchParams('description=beach&filename=IMG&ocr=invoice&sort=desc');

    clearSearchablePageFilterParams(params);

    expect(params.get('description')).toBeNull();
    expect(params.get('filename')).toBeNull();
    expect(params.get('ocr')).toBeNull();
    expect(params.get('sort')).toBe('desc');
  });

  it('coexists with existing filters', () => {
    const state = getSearchablePageFilterState(
      new URL('https://gallery.test/photos?people=p1&album=has&description=beach'),
    );

    expect(state.personIds).toEqual(['p1']);
    expect(state.isInAlbum).toBe(true);
    expect(state.description).toBe('beach');
  });
});

describe('recently added page', () => {
  it('resolves the base path so filter changes can be written to the URL', () => {
    expect(getSearchablePageBasePath('/recently-added')).toBe('/recently-added');
    expect(getSearchablePageBasePath('/recently-added/photos')).toBe('/recently-added');
  });

  it('builds a filter URL for the recently added page', () => {
    const url = buildSearchablePageUrl(new URL('https://gallery.test/recently-added'), '', 'desc', {
      ...createFilterState(),
      rating: 5,
    });

    expect(url).not.toBeNull();
    expect(url).toContain('rating=5');
  });

  it('is query-capable now that the text section and search path exist', () => {
    const state = getSearchablePageState(new URL('https://gallery.test/recently-added'));

    expect(state.basePath).toBe('/recently-added');
    expect(state.isSearchable).toBe(true);
  });

  it('builds a query URL for the recently added page', () => {
    expect(buildSearchablePageUrl(new URL('https://gallery.test/recently-added'), 'beach')).toContain('q=beach');
  });

  it('still builds a filter-only URL for the same page', () => {
    const url = buildSearchablePageUrl(new URL('https://gallery.test/recently-added'), '', 'desc', {
      ...createFilterState(),
      rating: 5,
    });

    expect(url).toContain('rating=5');
  });

  it('leaves photos and spaces query-capable', () => {
    expect(getSearchablePageState(new URL('https://gallery.test/photos')).isSearchable).toBe(true);
    expect(getSearchablePageState(new URL('https://gallery.test/spaces/space-1')).isSearchable).toBe(true);
    expect(buildSearchablePageUrl(new URL('https://gallery.test/photos'), 'beach')).toContain('q=beach');
  });
});

describe('album detail pages', () => {
  it('resolves the base path for an album, its photos route and an open asset', () => {
    expect(getSearchablePageBasePath('/albums/album-1')).toBe('/albums/album-1');
    expect(getSearchablePageBasePath('/albums/album-1/photos')).toBe('/albums/album-1/photos');
    expect(getSearchablePageBasePath('/albums/album-1/photos/asset-9')).toBe('/albums/album-1/photos');
  });

  it('resolves the base path for a space album, its photos route and an open asset', () => {
    expect(getSearchablePageBasePath('/spaces/space-1/albums/album-1')).toBe('/spaces/space-1/albums/album-1');
    expect(getSearchablePageBasePath('/spaces/space-1/albums/album-1/photos')).toBe(
      '/spaces/space-1/albums/album-1/photos',
    );
    expect(getSearchablePageBasePath('/spaces/space-1/albums/album-1/photos/asset-9')).toBe(
      '/spaces/space-1/albums/album-1/photos',
    );
  });

  it('leaves the album list pages non-searchable', () => {
    expect(getSearchablePageBasePath('/albums')).toBeNull();
    expect(getSearchablePageBasePath('/spaces/space-1/albums')).toBeNull();
  });

  it('leaves the other space sub-pages non-searchable', () => {
    expect(getSearchablePageBasePath('/spaces/space-1/members')).toBeNull();
    expect(getSearchablePageBasePath('/spaces/space-1/people')).toBeNull();
  });

  it('builds a query URL that stays on the space album', () => {
    expect(buildSearchablePageUrl(new URL('https://gallery.test/spaces/space-1/albums/album-1'), 'beach')).toBe(
      '/spaces/space-1/albums/album-1?q=beach',
    );
  });

  it('builds a filter URL for an album', () => {
    const url = buildSearchablePageUrl(new URL('https://gallery.test/albums/album-1'), '', 'desc', {
      ...createFilterState(),
      rating: 5,
    });

    expect(url).toContain('rating=5');
  });
});
