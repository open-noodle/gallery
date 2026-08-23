import { AssetTypeEnum } from '@immich/sdk';
import { browser } from '$app/environment';

const COLLAPSED_KEY = 'gallery-filter-collapsed';

/**
 * Load the persisted filter-panel collapsed preference. Shared by the panel itself and the header
 * filter button (external toggle), so a page can initialise its bound `collapsed` state to match.
 */
export function loadFilterCollapsed(): boolean {
  if (browser) {
    try {
      const raw = localStorage.getItem(COLLAPSED_KEY);
      if (raw !== null) {
        return JSON.parse(raw) as boolean;
      }
    } catch {
      /* corrupted — fall through */
    }
  }
  return false;
}

/** Persist the filter-panel collapsed preference. */
export function saveFilterCollapsed(collapsed: boolean): void {
  if (browser) {
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify(collapsed));
    } catch {
      /* localStorage unavailable */
    }
  }
}

export type FilterSection =
  'timeline' | 'people' | 'location' | 'camera' | 'tags' | 'rating' | 'media' | 'favorites' | 'albums' | 'text';

/**
 * The canonical filter sections, in render order — the single source of truth every surface
 * derives its section list from (#802: the Map view had silently drifted to 9 of 10 sections).
 *
 * A surface may only drop a section when the server physically cannot honour it there, and the
 * omission must be justified in `filter-section-parity.spec.ts`. Adding a section here makes it
 * appear on every surface at once, which is the point.
 */
export const ALL_FILTER_SECTIONS: readonly FilterSection[] = [
  'timeline',
  'people',
  'location',
  'camera',
  'tags',
  'rating',
  'media',
  'favorites',
  'albums',
  'text',
] as const;

/**
 * The sections a browser could already have recorded before #447 replaced the stored
 * `string[]` of visible sections with a `{ selected, known }` ledger — a frozen historical
 * fact, not a list to keep in step with `ALL_FILTER_SECTIONS`.
 *
 * Legacy storage carries no `known` list, so on upgrade every section outside this baseline
 * counts as introduced-since and is revealed. Deriving that from the baseline rather than
 * naming the newer sections explicitly is what keeps it correct: the old list named `favorites`
 * and `albums` but was never extended with `text` when #722 added it, so browsers still holding
 * legacy storage lost that section for good (#797).
 */
export const PRE_LEDGER_FILTER_SECTIONS: readonly FilterSection[] = [
  'timeline',
  'people',
  'location',
  'camera',
  'tags',
  'rating',
  'media',
] as const;

export interface PersonOption {
  id: string;
  name: string;
  thumbnailUrl?: string;
}

export interface LocationOption {
  value: string;
  type: 'country' | 'city';
}

export interface CameraOption {
  value: string;
  type: 'make' | 'model';
}

export interface TagOption {
  id: string;
  name: string;
}

export interface FilterSuggestionsResponse {
  countries: string[];
  cities?: string[];
  cameraMakes: string[];
  cameraModels?: string[];
  tags: TagOption[];
  people: PersonOption[];
  ratings: number[];
  mediaTypes: string[];
  hasUnnamedPeople: boolean;
  hasFavorites: boolean;
  hasAssetsInAlbum: boolean;
  hasAssetsNotInAlbum: boolean;
}

export interface FilterPanelConfig {
  sections: FilterSection[];
  suggestionsProvider?: (filters: FilterState) => Promise<FilterSuggestionsResponse>;
  /**
   * Facets for this surface's scope with no filters applied (#910). The panel only calls this when it
   * mounts with filters already active — otherwise the ordinary response is already the baseline.
   *
   * Resolving `undefined` means "no cheap baseline here", and the panel then never hides a section.
   * The three query-mode surfaces return `undefined` deliberately: their `smartFacetInFlight` slot is
   * single-entry and their `smartFacets` state feeds the timeline and the result count, so a second
   * concurrent facet request would abort the first and then overwrite the page's own data. See spec
   * §4.5 — this hook exists because `suggestionsProvider(createFilterState())` cannot be used.
   */
  baselineProvider?: () => Promise<FilterSuggestionsResponse | undefined>;
  providers?: {
    people?: (context?: FilterContext) => Promise<PersonOption[]>;
    allPeople?: () => Promise<PersonOption[]>;
    locations?: (context?: FilterContext) => Promise<LocationOption[]>;
    cities?: (country: string, context?: FilterContext) => Promise<string[]>;
    cameras?: (context?: FilterContext) => Promise<CameraOption[]>;
    cameraModels?: (make: string, context?: FilterContext) => Promise<string[]>;
    tags?: (context?: FilterContext) => Promise<TagOption[]>;
  };
}

export interface FilterState {
  personIds: string[];
  city?: string;
  country?: string;
  make?: string;
  model?: string;
  lensModel?: string;
  state?: string;
  albumId?: string;
  ownerId?: string;
  description?: string;
  originalFileName?: string;
  ocr?: string;
  tagIds: string[];
  rating?: number;
  mediaType: 'all' | 'image' | 'video';
  isFavorite?: boolean;
  isNotInAlbum?: boolean;
  isInAlbum?: boolean;
  sortOrder: 'asc' | 'desc' | 'relevance';
  dateAfter?: string;
  dateBefore?: string;
  selectedYear?: number;
  selectedMonth?: number;
}

export function createFilterState(): FilterState {
  return {
    personIds: [],
    tagIds: [],
    mediaType: 'all',
    sortOrder: 'desc',
  };
}

export function getActiveFilterCount(state: FilterState): number {
  const hasTemporalFilter =
    hasDateValue(state.dateAfter) || hasDateValue(state.dateBefore) || state.selectedYear !== undefined;

  return (
    (state.personIds.length > 0 ? 1 : 0) +
    (state.city || state.country || state.state ? 1 : 0) + // location counts once (city/state/country)
    (state.make || state.model ? 1 : 0) + // camera counts once; a model-only value (no make) still applies ?model=
    (state.lensModel ? 1 : 0) +
    (state.albumId ? 1 : 0) +
    (state.ownerId ? 1 : 0) +
    (state.tagIds.length > 0 ? 1 : 0) +
    (state.rating === undefined ? 0 : 1) +
    (state.mediaType === 'all' ? 0 : 1) +
    (state.isFavorite === undefined ? 0 : 1) +
    (state.isNotInAlbum === true ? 1 : 0) +
    (state.isInAlbum === true ? 1 : 0) +
    (state.description?.trim() ? 1 : 0) +
    (state.originalFileName?.trim() ? 1 : 0) +
    (state.ocr?.trim() ? 1 : 0) +
    (hasTemporalFilter ? 1 : 0)
  );
}

/**
 * The active filter set, in the shape the suggestion endpoints take, so a second-level suggestion
 * list (cities under a country, models under a make) describes the assets the user is actually
 * looking at rather than their whole library (#858).
 *
 * Every key here MUST be a declared query param on BOTH `/search/suggestions` and
 * `/search/suggestions/filters` — the dependent providers spread this object straight into the
 * former, and an undeclared param is silently stripped by the server's validation pipe, which looks
 * exactly like "the list didn't narrow" with no error anywhere.
 *
 * `albumId` is deliberately absent: on those endpoints `albumId` is a *scope* that widens ownership
 * to album participants and is mutually exclusive with `spaceId` / `withSharedSpaces`, so spreading
 * the panel's album *filter* into them would 400 every /photos and Space suggestion request. The
 * three free-text filters (`description`, `originalFileName`, `ocr`) are absent too: they are typed
 * character by character and compile to unindexable ILIKE / trigram scans, so they belong on the
 * query, not on a facet list that refires per keystroke.
 */
export type FilterContext = {
  takenAfter?: string;
  takenBefore?: string;
  personIds?: string[];
  tagIds?: string[];
  rating?: number;
  isFavorite?: boolean;
  isNotInAlbum?: boolean;
  isInAlbum?: boolean;
  country?: string;
  state?: string;
  city?: string;
  make?: string;
  model?: string;
  lensModel?: string;
  /** Contributor narrowing. Composes inside the caller's scope; it can only shrink the set. */
  ownerId?: string;
  mediaType?: AssetTypeEnum;
};

function hasDateValue(value: string | undefined): value is string {
  return value !== undefined && value !== '';
}

function parseDateOnly(value: string | undefined): Date | undefined {
  if (!hasDateValue(value)) {
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

  return date;
}

function dateOnlyToUtcStart(value: string | undefined): string | undefined {
  return parseDateOnly(value)?.toISOString();
}

function dateOnlyToExclusiveUtcEnd(value: string | undefined): string | undefined {
  const date = parseDateOnly(value);
  if (!date) {
    return undefined;
  }

  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString();
}

/**
 * Forward the three fields the `text` filter section produces onto a request payload, trimmed,
 * omitting any that are blank. Shared by every surface's option builder so the map, album and
 * photos views cannot drift apart again (#802).
 */
export function applyTextFilters(
  base: Record<string, unknown>,
  filters: Pick<FilterState, 'description' | 'originalFileName' | 'ocr'>,
): Record<string, unknown> {
  const description = filters.description?.trim();
  if (description) {
    base.description = description;
  }

  const originalFileName = filters.originalFileName?.trim();
  if (originalFileName) {
    base.originalFileName = originalFileName;
  }

  const ocr = filters.ocr?.trim();
  if (ocr) {
    base.ocr = ocr;
  }

  return base;
}

export function buildFilterContext(
  state: FilterState,
  exclude: Array<keyof FilterState> = [],
): FilterContext | undefined {
  const context: FilterContext = {};
  const includes = (key: keyof FilterState) => !exclude.includes(key);

  if (includes('personIds') && state.personIds?.length > 0) {
    context.personIds = state.personIds;
  }

  if (includes('tagIds') && state.tagIds?.length > 0) {
    context.tagIds = state.tagIds;
  }

  if (includes('rating') && state.rating !== undefined) {
    context.rating = state.rating;
  }

  if (includes('isFavorite') && state.isFavorite !== undefined) {
    context.isFavorite = state.isFavorite;
  }

  if (includes('isNotInAlbum') && state.isNotInAlbum === true) {
    context.isNotInAlbum = true;
  }

  if (includes('isInAlbum') && state.isInAlbum === true) {
    context.isInAlbum = true;
  }

  if (includes('country') && state.country) {
    context.country = state.country;
  }

  if (includes('state') && state.state) {
    context.state = state.state;
  }

  if (includes('city') && state.city) {
    context.city = state.city;
  }

  if (includes('make') && state.make) {
    context.make = state.make;
  }

  if (includes('model') && state.model) {
    context.model = state.model;
  }

  if (includes('lensModel') && state.lensModel) {
    context.lensModel = state.lensModel;
  }

  if (includes('ownerId') && state.ownerId) {
    context.ownerId = state.ownerId;
  }

  if (includes('mediaType') && state.mediaType && state.mediaType !== 'all') {
    context.mediaType = state.mediaType === 'image' ? AssetTypeEnum.Image : AssetTypeEnum.Video;
  }

  const validDateAfter = includes('dateAfter') ? dateOnlyToUtcStart(state.dateAfter) : undefined;
  const validDateBefore = includes('dateBefore') ? dateOnlyToExclusiveUtcEnd(state.dateBefore) : undefined;

  if (validDateAfter || validDateBefore) {
    if (validDateAfter) {
      context.takenAfter = validDateAfter;
    }
    if (validDateBefore) {
      context.takenBefore = validDateBefore;
    }
  } else if (state.selectedYear && includes('selectedYear')) {
    if (state.selectedMonth && includes('selectedMonth')) {
      context.takenAfter = new Date(Date.UTC(state.selectedYear, state.selectedMonth - 1, 1)).toISOString();
      context.takenBefore = new Date(Date.UTC(state.selectedYear, state.selectedMonth, 1)).toISOString();
    } else {
      context.takenAfter = new Date(Date.UTC(state.selectedYear, 0, 1)).toISOString();
      context.takenBefore = new Date(Date.UTC(state.selectedYear + 1, 0, 1)).toISOString();
    }
  }

  return Object.keys(context).length > 0 ? context : undefined;
}

export function clearFilters(state: FilterState): FilterState {
  return {
    ...state,
    personIds: [],
    city: undefined,
    country: undefined,
    make: undefined,
    model: undefined,
    lensModel: undefined,
    state: undefined,
    albumId: undefined,
    ownerId: undefined,
    description: undefined,
    originalFileName: undefined,
    ocr: undefined,
    tagIds: [],
    rating: undefined,
    mediaType: 'all',
    isFavorite: undefined,
    isNotInAlbum: undefined,
    isInAlbum: undefined,
    dateAfter: undefined,
    dateBefore: undefined,
    selectedYear: undefined,
    selectedMonth: undefined,
    // sortOrder is NOT cleared — it's a view preference
  };
}
