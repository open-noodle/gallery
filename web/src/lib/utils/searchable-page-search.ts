import type { FilterState } from '$lib/components/filter-panel/filter-panel';

export type SearchablePageSortOrder = 'relevance' | 'asc' | 'desc';

export const SEARCHABLE_PAGE_FILTER_PARAMS = [
  'people',
  'tags',
  'city',
  'country',
  'make',
  'model',
  'description',
  'filename',
  'ocr',
  'type',
  'favorite',
  'album',
  'rating',
  'from',
  'to',
] as const;

export type SearchablePageFilterState = Partial<
  Pick<
    FilterState,
    | 'personIds'
    | 'tagIds'
    | 'city'
    | 'country'
    | 'make'
    | 'model'
    | 'description'
    | 'originalFileName'
    | 'ocr'
    | 'mediaType'
    | 'isFavorite'
    | 'isNotInAlbum'
    | 'isInAlbum'
    | 'rating'
    | 'dateAfter'
    | 'dateBefore'
  >
>;

export type SearchablePageTransientTemporalState = Partial<Pick<FilterState, 'selectedYear' | 'selectedMonth'>>;

type SearchablePageState = {
  basePath: string | null;
  isSearchable: boolean;
  query: string;
  hasExplicitSort: boolean;
  sortOrder: SearchablePageSortOrder;
};

function getSortOrder(query: string, rawSort: string | null): SearchablePageSortOrder {
  if (rawSort === 'asc' || rawSort === 'desc') {
    return rawSort;
  }
  if (query.length === 0) {
    return 'desc';
  }
  return 'relevance';
}

export function getSearchablePageBasePath(pathname: string): string | null {
  if (pathname.startsWith('/photos')) {
    return '/photos';
  }

  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] !== 'spaces' || parts[1] === undefined) {
    return null;
  }

  if (parts.length === 2) {
    return `/spaces/${parts[1]}`;
  }

  if (parts[2] === 'photos') {
    return `/spaces/${parts[1]}/photos`;
  }

  return null;
}

export function getSearchablePageState(url: URL): SearchablePageState {
  const basePath = getSearchablePageBasePath(url.pathname);
  if (!basePath) {
    return {
      basePath: null,
      isSearchable: false,
      query: '',
      hasExplicitSort: false,
      sortOrder: 'desc',
    };
  }

  const query = (url.searchParams.get('q') ?? '').trim();
  const rawSort = url.searchParams.get('sort');
  return {
    basePath,
    isSearchable: true,
    query,
    hasExplicitSort: rawSort === 'asc' || rawSort === 'desc',
    sortOrder: getSortOrder(query, rawSort),
  };
}

export function buildSearchablePageUrl(
  url: URL,
  query: string,
  sortOrder: SearchablePageSortOrder = 'relevance',
  filters?: FilterState,
): string | null {
  const basePath = getSearchablePageBasePath(url.pathname);
  if (!basePath) {
    return null;
  }

  const trimmedQuery = query.trim();
  const params = new URLSearchParams(url.searchParams);

  // `at` is a one-shot grid scroll target left over from closing the asset viewer. It must not
  // survive a search/filter change: the layout re-seeds `gridScrollTarget` from it on every
  // navigation, so a stale `at` makes the timeline re-scroll to (and focus) that asset on each
  // keystroke — stealing focus from the filter inputs and loading the asset's non-matching
  // buckets behind a "0 results" empty state.
  params.delete('at');

  if (trimmedQuery) {
    params.set('q', trimmedQuery);
    if (sortOrder === 'relevance') {
      params.delete('sort');
    } else {
      params.set('sort', sortOrder);
    }
  } else {
    params.delete('q');
    if (sortOrder === 'asc' || sortOrder === 'desc') {
      params.set('sort', sortOrder);
    } else {
      params.delete('sort');
    }
  }

  if (filters !== undefined) {
    clearSearchablePageFilterParams(params);
    appendSearchablePageFilterParams(params, filters);
  }

  const search = params.toString();
  return basePath + (search ? `?${search}` : '');
}

export function clearSearchablePageFilterParams(params: URLSearchParams) {
  for (const key of SEARCHABLE_PAGE_FILTER_PARAMS) {
    params.delete(key);
  }
}

export function getSearchablePageFilterState(url: URL): SearchablePageFilterState {
  const result: SearchablePageFilterState = {};
  const people = splitListParam(url.searchParams.get('people'));
  const tags = splitListParam(url.searchParams.get('tags'));
  const rating = parseRating(url.searchParams.get('rating'));
  const mediaType = parseMediaType(url.searchParams.get('type'));
  const favorite = parseFavorite(url.searchParams.get('favorite'));
  const albumFilter = parseAlbumFilter(url.searchParams.get('album'));
  const from = parseDateParam(url.searchParams.get('from'));
  const to = parseDateParam(url.searchParams.get('to'));

  if (people.length > 0) {
    result.personIds = people;
  }
  if (tags.length > 0) {
    result.tagIds = tags;
  }
  if (url.searchParams.get('city')) {
    result.city = url.searchParams.get('city') ?? undefined;
  }
  if (url.searchParams.get('country')) {
    result.country = url.searchParams.get('country') ?? undefined;
  }
  if (url.searchParams.get('make')) {
    result.make = url.searchParams.get('make') ?? undefined;
  }
  if (url.searchParams.get('model')) {
    result.model = url.searchParams.get('model') ?? undefined;
  }
  const description = url.searchParams.get('description')?.trim();
  if (description) {
    result.description = description;
  }
  const filename = url.searchParams.get('filename')?.trim();
  if (filename) {
    result.originalFileName = filename;
  }
  const ocr = url.searchParams.get('ocr')?.trim();
  if (ocr) {
    result.ocr = ocr;
  }
  if (mediaType) {
    result.mediaType = mediaType;
  }
  if (favorite !== undefined) {
    result.isFavorite = favorite;
  }
  if (albumFilter === 'none') {
    result.isNotInAlbum = true;
  }
  if (albumFilter === 'has') {
    result.isInAlbum = true;
  }
  if (rating !== undefined) {
    result.rating = rating;
  }
  if (from) {
    result.dateAfter = from;
  }
  if (to) {
    result.dateBefore = to;
  }

  return result;
}

export function preserveTransientTemporalFilters<T extends SearchablePageFilterState>(
  filters: T,
  transient?: SearchablePageTransientTemporalState,
): T & SearchablePageTransientTemporalState {
  if (transient?.selectedYear === undefined || filters.dateAfter || filters.dateBefore) {
    return filters;
  }

  return {
    ...filters,
    selectedYear: transient.selectedYear,
    selectedMonth: transient.selectedMonth,
  };
}

function appendSearchablePageFilterParams(params: URLSearchParams, filters: FilterState) {
  if (filters.personIds.length > 0) {
    params.set('people', filters.personIds.join(','));
  }
  if (filters.tagIds.length > 0) {
    params.set('tags', filters.tagIds.join(','));
  }
  if (filters.city) {
    params.set('city', filters.city);
  }
  if (filters.country) {
    params.set('country', filters.country);
  }
  if (filters.make) {
    params.set('make', filters.make);
  }
  if (filters.model) {
    params.set('model', filters.model);
  }
  if (filters.description?.trim()) {
    params.set('description', filters.description.trim());
  }
  if (filters.originalFileName?.trim()) {
    params.set('filename', filters.originalFileName.trim());
  }
  if (filters.ocr?.trim()) {
    params.set('ocr', filters.ocr.trim());
  }
  if (filters.mediaType !== 'all') {
    params.set('type', filters.mediaType);
  }
  if (filters.isFavorite !== undefined) {
    params.set('favorite', String(filters.isFavorite));
  }
  if (filters.isNotInAlbum === true) {
    params.set('album', 'none');
  }
  if (filters.isInAlbum === true) {
    params.set('album', 'has');
  }
  if (filters.rating !== undefined) {
    params.set('rating', String(filters.rating));
  }
  if (filters.dateAfter) {
    params.set('from', filters.dateAfter);
  }
  if (filters.dateBefore) {
    params.set('to', filters.dateBefore);
  }
}

function splitListParam(value: string | null): string[] {
  return (
    value
      ?.split(',')
      .map((item) => item.trim())
      .filter(Boolean) ?? []
  );
}

function parseRating(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const rating = Number(value);
  return Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : undefined;
}

function parseMediaType(value: string | null): 'image' | 'video' | undefined {
  return value === 'image' || value === 'video' ? value : undefined;
}

function parseFavorite(value: string | null): boolean | undefined {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return undefined;
}

function parseAlbumFilter(value: string | null): 'has' | 'none' | undefined {
  if (value === 'none') {
    return 'none';
  }
  if (value === 'has') {
    return 'has';
  }
  return undefined;
}

function parseDateParam(value: string | null): string | undefined {
  if (!value) {
    return undefined;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return undefined;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return undefined;
  }

  return value;
}
