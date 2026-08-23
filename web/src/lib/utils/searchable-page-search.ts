import type { FilterState } from '$lib/components/filter-panel/filter-panel';
import {
  clearFilterParams,
  decodeFilterParams,
  encodeFilterParams,
  type DecodedFilterState,
} from '$lib/utils/filter-url';

export type SearchablePageSortOrder = 'relevance' | 'asc' | 'desc';

// Widen to the codec's type so the four new dimensions are properly typed as they flow through
// the photos/spaces pages, rather than surviving only as an untyped runtime pass-through.
export type SearchablePageFilterState = DecodedFilterState;

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

  if (pathname.startsWith('/recently-added')) {
    return '/recently-added';
  }

  const parts = pathname.split('/').filter(Boolean);

  if (parts[0] === 'albums') {
    return albumBasePath(parts, '/albums', 1);
  }

  if (parts[0] !== 'spaces' || parts[1] === undefined) {
    return null;
  }

  if (parts[2] === 'albums') {
    return albumBasePath(parts, `/spaces/${parts[1]}/albums`, 3);
  }

  if (parts.length === 2) {
    return `/spaces/${parts[1]}`;
  }

  if (parts[2] === 'photos') {
    return `/spaces/${parts[1]}/photos`;
  }

  return null;
}

/**
 * Shared tail of the two album detail routes — `/albums/<id>` and `/spaces/<sid>/albums/<id>` —
 * which differ only in their prefix. `idIndex` is where the album id sits in `parts`.
 *
 * Mirrors the space timeline's shape above: the bare route and its `/photos` variant both resolve,
 * and an open asset (`…/photos/<assetId>`) resolves to the `/photos` base so a search or filter
 * change closes the viewer rather than trying to keep a now-filtered-out asset open. The album
 * LIST pages (`/albums`, `/spaces/<sid>/albums`) have no album id and stay non-searchable.
 */
function albumBasePath(parts: string[], prefix: string, idIndex: number): string | null {
  const albumId = parts[idIndex];
  if (albumId === undefined) {
    return null;
  }

  if (parts.length === idIndex + 1) {
    return `${prefix}/${albumId}`;
  }

  if (parts[idIndex + 1] === 'photos') {
    return `${prefix}/${albumId}/photos`;
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
    encodeFilterParams(params, filters);
  }

  const search = params.toString();
  return basePath + (search ? `?${search}` : '');
}

export function clearSearchablePageFilterParams(params: URLSearchParams) {
  clearFilterParams(params);
}

export function getSearchablePageFilterState(url: URL): SearchablePageFilterState {
  return decodeFilterParams(url);
}
