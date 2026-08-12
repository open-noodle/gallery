import type { FilterState } from '$lib/components/filter-panel/filter-panel';

/**
 * Bounds the URL length when a long free-text value is used as a filter (E13).
 *
 * Applies to ALL THREE free-text filters — description, filename and OCR — symmetrically on encode
 * and decode. A pasted 10KB value would otherwise go straight into the URL, and reverse proxies
 * commonly cap request headers at ~8KB. `text-filter.svelte` mirrors it as the inputs' `maxlength`.
 */
export const TEXT_FILTER_PARAM_MAX_LENGTH = 200;

/**
 * Clamp a free-text filter value to TEXT_FILTER_PARAM_MAX_LENGTH **code points**.
 *
 * NOT `.slice(0, n)`: that cuts UTF-16 code units, so an emoji (or any astral character) straddling
 * the boundary is split into a lone surrogate — which is not serializable, so URLSearchParams emits
 * U+FFFD in its place. That is a silent, irreversible corruption of the user's last character.
 */
function clampTextFilterParam(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const codePoints = [...value];
  return codePoints.length <= TEXT_FILTER_PARAM_MAX_LENGTH
    ? value
    : codePoints.slice(0, TEXT_FILTER_PARAM_MAX_LENGTH).join('');
}

export const FILTER_URL_PARAMS = [
  'people',
  'tags',
  'city',
  'state',
  'country',
  'make',
  'model',
  'lens',
  'description',
  'filename',
  'ocr',
  'type',
  'favorite',
  'album',
  'albumId',
  'owner',
  'rating',
  'from',
  'to',
  'year',
  'month',
] as const;

export type DecodedFilterState = Partial<
  Pick<
    FilterState,
    | 'personIds'
    | 'tagIds'
    | 'city'
    | 'state'
    | 'country'
    | 'make'
    | 'model'
    | 'lensModel'
    | 'albumId'
    | 'ownerId'
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
    | 'selectedYear'
    | 'selectedMonth'
  >
>;

export function clearFilterParams(params: URLSearchParams) {
  for (const key of FILTER_URL_PARAMS) {
    params.delete(key);
  }
}

export function encodeFilterParams(params: URLSearchParams, filters: FilterState) {
  const setTrimmed = (key: string, value: string | undefined) => {
    const trimmed = value?.trim();
    if (trimmed) {
      params.set(key, trimmed);
    }
  };

  if (filters.personIds.length > 0) {
    params.set('people', filters.personIds.join(','));
  }
  if (filters.tagIds.length > 0) {
    params.set('tags', filters.tagIds.join(','));
  }
  setTrimmed('city', filters.city);
  setTrimmed('state', filters.state);
  setTrimmed('country', filters.country);
  setTrimmed('make', filters.make);
  setTrimmed('model', filters.model);
  setTrimmed('lens', filters.lensModel);
  setTrimmed('owner', filters.ownerId);
  setTrimmed('description', clampTextFilterParam(filters.description?.trim()));
  setTrimmed('filename', clampTextFilterParam(filters.originalFileName?.trim()));
  setTrimmed('ocr', clampTextFilterParam(filters.ocr?.trim()));

  if (filters.mediaType !== 'all') {
    params.set('type', filters.mediaType);
  }
  if (filters.isFavorite !== undefined) {
    params.set('favorite', String(filters.isFavorite));
  }

  // albumId takes precedence over the has/none album filter, mirroring the server
  // (asset.repository.ts guards isInAlbum/isNotInAlbum with `&& !options.albumId`). Emitting
  // both would be a contradiction the server silently resolves in albumId's favour anyway.
  const albumId = filters.albumId?.trim();
  if (albumId) {
    params.set('albumId', albumId);
  } else if (filters.isNotInAlbum === true) {
    params.set('album', 'none');
  } else if (filters.isInAlbum === true) {
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

  // The temporal picker's year/month. It drives takenAfter/takenBefore through buildFilterContext,
  // which PREFERS dateAfter/dateBefore (filter-panel.ts) — and the panel keeps the two mutually
  // exclusive. Mirror that precedence here: a year emitted beside from/to would be inert in the
  // query but still COUNTED by getActiveFilterCount and re-encoded on the next sync, i.e. a filter
  // the UI claims is active but the server never sees. A month with no year is meaningless to
  // buildFilterContext, so it is never emitted alone.
  if (!filters.dateAfter && !filters.dateBefore && filters.selectedYear !== undefined) {
    params.set('year', String(filters.selectedYear));
    if (filters.selectedMonth !== undefined) {
      params.set('month', String(filters.selectedMonth));
    }
  }
}

export function decodeFilterParams(url: URL): DecodedFilterState {
  const result: DecodedFilterState = {};
  const get = (key: string) => url.searchParams.get(key)?.trim() || undefined;

  const people = splitListParam(url.searchParams.get('people'));
  const tags = splitListParam(url.searchParams.get('tags'));
  if (people.length > 0) {
    result.personIds = people;
  }
  if (tags.length > 0) {
    result.tagIds = tags;
  }

  result.city = get('city');
  result.state = get('state');
  result.country = get('country');
  result.make = get('make');
  result.model = get('model');
  result.lensModel = get('lens');
  result.ownerId = get('owner');
  // Clamp on decode as well as encode: a hand-written or legacy URL can carry more than the
  // encoder would ever emit, and without this, encode(decode(url)) would rewrite the user's URL.
  result.description = clampTextFilterParam(get('description'));
  result.originalFileName = clampTextFilterParam(get('filename'));
  result.ocr = clampTextFilterParam(get('ocr'));
  result.albumId = get('albumId');

  const mediaType = parseMediaType(url.searchParams.get('type'));
  if (mediaType) {
    result.mediaType = mediaType;
  }
  const favorite = parseFavorite(url.searchParams.get('favorite'));
  if (favorite !== undefined) {
    result.isFavorite = favorite;
  }

  // Mirror the encoder + the server: albumId wins, so never surface a has/none flag beside it.
  if (!result.albumId) {
    const albumFilter = parseAlbumFilter(url.searchParams.get('album'));
    if (albumFilter === 'none') {
      result.isNotInAlbum = true;
    } else if (albumFilter === 'has') {
      result.isInAlbum = true;
    }
  }

  const rating = parseRating(url.searchParams.get('rating'));
  if (rating !== undefined) {
    result.rating = rating;
  }
  const from = parseDateParam(url.searchParams.get('from'));
  const to = parseDateParam(url.searchParams.get('to'));
  if (from) {
    result.dateAfter = from;
  }
  if (to) {
    result.dateBefore = to;
  }

  // Mirror the encoder + buildFilterContext: from/to wins, so never surface a year beside it. A
  // hand-typed `?from=2024-01-01&year=2023` would otherwise decode to BOTH — the year inert in the
  // query but still counted by getActiveFilterCount. An INVALID from/to does not suppress the year,
  // because it produces no takenAfter/takenBefore either.
  if (!result.dateAfter && !result.dateBefore) {
    const year = parseYearParam(url.searchParams.get('year'));
    if (year !== undefined) {
      result.selectedYear = year;
      // A month without a year is ignored by buildFilterContext, so it must not be surfaced (and
      // therefore counted) on its own.
      const month = parseMonthParam(url.searchParams.get('month'));
      if (month !== undefined) {
        result.selectedMonth = month;
      }
    }
  }

  // Strip keys we set to `undefined` above so the object is a clean partial.
  for (const key of Object.keys(result) as Array<keyof DecodedFilterState>) {
    if (result[key] === undefined) {
      delete result[key];
    }
  }

  return result;
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
  return Number.isSafeInteger(rating) && rating >= 1 && rating <= 5 ? rating : undefined;
}

/**
 * A 4-digit calendar year. Bounded rather than "any integer" so a hand-typed or fuzzed `?year=0` /
 * `?year=99999` can't reach `new Date(Date.UTC(year, …))` in buildFilterContext and produce a
 * nonsense takenAfter/takenBefore that quietly matches nothing.
 */
function parseYearParam(value: string | null): number | undefined {
  return parseBoundedInteger(value, 1000, 9999);
}

/** A 1-based calendar month, as buildFilterContext expects (it does `selectedMonth - 1`). */
function parseMonthParam(value: string | null): number | undefined {
  return parseBoundedInteger(value, 1, 12);
}

function parseBoundedInteger(value: string | null, min: number, max: number): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : undefined;
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
