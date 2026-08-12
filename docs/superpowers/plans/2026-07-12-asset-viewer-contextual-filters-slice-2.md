# Asset Viewer Contextual Filters — Slice 2 (Web: pure filter-URL layer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure, UI-free foundation every later web slice depends on: one shared `FilterState ⇄ URLSearchParams` codec, a `resolveFilterTarget(url)` that says which timeline surface you are on, and a `buildContextualFilterUrl(url, patch)` that merges one metadata field into the current URL.

**Architecture:** Extract the existing codec out of `searchable-page-search.ts` into a new `filter-url.ts`, extend it with four new dimensions (`lens`, `state`, `albumId`, `owner`), and add a new `filter-target.ts` on top. `searchable-page-search.ts` keeps its exact public API and delegates — so `/photos` and `/spaces` behavior must not change at all. **No component or page is touched in this slice.**

**Tech Stack:** SvelteKit, TypeScript (strict), Vitest. Everything here is a plain function — no Svelte runes, no DOM.

**Spec:** `docs/superpowers/specs/2026-07-12-asset-viewer-contextual-filters-design.md` (§5.1–§5.6, §9 Slice 2)

## Global Constraints

- **The existing test file `web/src/lib/utils/__tests__/searchable-page-search.spec.ts` (238 lines) MUST pass completely UNMODIFIED.** It is the E16 regression guard. If a change to it seems necessary, you have broken the refactor — stop and escalate. Do not edit that file.
- **This slice adds NO UI.** Do not touch any `.svelte` file, any `+page.svelte`, or any component. Later slices do that.
- **Web lint has NO `--max-warnings 0`.** ~650 pre-existing `better-tailwindcss` warnings are expected and must be left alone. **Never run `eslint --fix` across the package** — it rewrites ~84 files for zero benefit.
- `pnpm check:svelte` reports 0 files locally (a known no-op) — rely on `pnpm check:typescript`.
- Run web commands from the `web/` directory. Use `pnpm test --run <path>` (not `-- --run`).
- **No `Co-Authored-By` or `Generated-with` trailers in commits.**

## File Structure

| File                                                  | Change     | Responsibility                                                                |
| ----------------------------------------------------- | ---------- | ----------------------------------------------------------------------------- |
| `web/src/lib/components/filter-panel/filter-panel.ts` | Modify     | Add 4 fields to `FilterState`; update `clearFilters` + `getActiveFilterCount` |
| `web/src/lib/utils/filter-url.ts`                     | **Create** | The single `FilterState ⇄ URLSearchParams` codec                              |
| `web/src/lib/utils/searchable-page-search.ts`         | Modify     | Keep its public API; delegate the codec to `filter-url.ts`                    |
| `web/src/lib/utils/filter-target.ts`                  | **Create** | `resolveFilterTarget` + `buildContextualFilterUrl`                            |
| `web/src/lib/utils/__tests__/filter-url.spec.ts`      | **Create** | Codec tests (E1, E7, E12, E13, E25)                                           |
| `web/src/lib/utils/__tests__/filter-target.spec.ts`   | **Create** | Target + merge tests (E3, E5, E23, E24, E25)                                  |

---

### Task 1: Extend `FilterState` and extract the codec into `filter-url.ts`

**Files:**

- Modify: `web/src/lib/components/filter-panel/filter-panel.ts`
- Create: `web/src/lib/utils/filter-url.ts`
- Modify: `web/src/lib/utils/searchable-page-search.ts`
- Create: `web/src/lib/utils/__tests__/filter-url.spec.ts`

**Interfaces:**

- Produces: `FilterState.lensModel?: string`, `.state?: string`, `.albumId?: string`, `.ownerId?: string`
- Produces: `decodeFilterParams(url: URL): SearchablePageFilterState`, `encodeFilterParams(params: URLSearchParams, filters: FilterState): void`, `clearFilterParams(params: URLSearchParams): void`, `FILTER_URL_PARAMS: readonly string[]`
- Consumed by: Task 2 (`filter-target.ts`) and by Slices 3, 4, 6, 7.

**The URL-param ↔ field mapping (memorize — the names deliberately differ):**

| URL param  | `FilterState` field | Server DTO field   |
| ---------- | ------------------- | ------------------ |
| `lens`     | `lensModel`         | `lensModel`        |
| `state`    | `state`             | `state`            |
| `albumId`  | `albumId`           | `albumId`          |
| `owner`    | `ownerId`           | `ownerId`          |
| `filename` | `originalFileName`  | `originalFileName` |

`owner` (URL) vs `ownerId` (field/DTO) is intentional, matching the existing `filename`/`originalFileName` precedent. Do not "fix" it.

- [ ] **Step 1: Write the failing codec tests**

Create `web/src/lib/utils/__tests__/filter-url.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createFilterState, type FilterState } from '$lib/components/filter-panel/filter-panel';
import { clearFilterParams, decodeFilterParams, encodeFilterParams } from '$lib/utils/filter-url';

const encode = (filters: Partial<FilterState>): URLSearchParams => {
  const params = new URLSearchParams();
  encodeFilterParams(params, { ...createFilterState(), ...filters });
  return params;
};

describe('filter-url codec', () => {
  it('round-trips every filter field', () => {
    const filters: FilterState = {
      ...createFilterState(),
      personIds: ['person:p1', 'space-person:p2'],
      tagIds: ['t1', 't2'],
      city: 'Berlin',
      state: 'State of Berlin',
      country: 'Germany',
      make: 'Apple',
      model: 'iPhone 17 Pro Max',
      lensModel: 'iPhone 17 Pro Max back triple camera',
      albumId: 'a1',
      ownerId: 'u1',
      description: 'sunset',
      originalFileName: 'IMG_7465',
      ocr: 'hello',
      rating: 4,
      mediaType: 'image',
      isFavorite: true,
      dateAfter: '2026-01-01',
      dateBefore: '2026-01-31',
    };

    const decoded = decodeFilterParams(new URL(`https://g.test/photos?${encode(filters)}`));

    expect(decoded).toMatchObject({
      personIds: ['person:p1', 'space-person:p2'],
      tagIds: ['t1', 't2'],
      city: 'Berlin',
      state: 'State of Berlin',
      country: 'Germany',
      make: 'Apple',
      model: 'iPhone 17 Pro Max',
      lensModel: 'iPhone 17 Pro Max back triple camera',
      albumId: 'a1',
      ownerId: 'u1',
      description: 'sunset',
      originalFileName: 'IMG_7465',
      ocr: 'hello',
      rating: 4,
      mediaType: 'image',
      isFavorite: true,
      dateAfter: '2026-01-01',
      dateBefore: '2026-01-31',
    });
  });

  it('uses the short `owner` and `lens` param names', () => {
    const params = encode({ ownerId: 'u1', lensModel: 'RF24-70mm' });

    expect(params.get('owner')).toBe('u1');
    expect(params.get('lens')).toBe('RF24-70mm');
    expect(params.get('ownerId')).toBeNull();
    expect(params.get('lensModel')).toBeNull();
  });

  // E1 — mirrors the server: albumId takes precedence over isInAlbum/isNotInAlbum
  it('E1: never emits album=has|none alongside albumId', () => {
    const params = encode({ albumId: 'a1', isInAlbum: true });

    expect(params.get('albumId')).toBe('a1');
    expect(params.get('album')).toBeNull();
  });

  it('E1: decoding drops isInAlbum/isNotInAlbum when albumId is present', () => {
    const decoded = decodeFilterParams(new URL('https://g.test/photos?albumId=a1&album=has'));

    expect(decoded.albumId).toBe('a1');
    expect(decoded.isInAlbum).toBeUndefined();
    expect(decoded.isNotInAlbum).toBeUndefined();
  });

  // E7 — empty/whitespace values must not become filters
  it('E7: emits no param for empty or whitespace-only values', () => {
    const params = encode({ make: '   ', lensModel: '', state: '  ', ownerId: '' });

    expect(params.get('make')).toBeNull();
    expect(params.get('lens')).toBeNull();
    expect(params.get('state')).toBeNull();
    expect(params.get('owner')).toBeNull();
  });

  // E12 — URL-special characters must survive a round trip
  it('E12: round-trips values containing URL-special characters', () => {
    const lensModel = 'FE 24-70mm F2.8 GM / II + adapter & hood?';
    const decoded = decodeFilterParams(new URL(`https://g.test/photos?${encode({ lensModel })}`));

    expect(decoded.lensModel).toBe(lensModel);
  });

  // E13 — bound the URL length, on BOTH sides of the codec
  it('E13: truncates description to 200 characters when encoding', () => {
    const params = encode({ description: 'x'.repeat(500) });

    expect(params.get('description')).toHaveLength(200);
  });

  it('E13: clamps an over-long description param when decoding', () => {
    // A hand-crafted or legacy URL can carry more than the encoder would ever emit. Clamp on the
    // way in too, so encode(decode(u)) is stable and the filter panel does not silently rewrite
    // the user's URL on the next hydrate.
    const decoded = decodeFilterParams(new URL(`https://g.test/photos?description=${'x'.repeat(500)}`));

    expect(decoded.description).toHaveLength(200);
  });

  it('clearFilterParams removes every filter param but leaves q and sort alone', () => {
    const params = new URLSearchParams('q=beach&sort=asc&make=Apple&lens=RF24&owner=u1&albumId=a1&state=Hamburg');

    clearFilterParams(params);

    expect(params.get('q')).toBe('beach');
    expect(params.get('sort')).toBe('asc');
    expect(params.get('make')).toBeNull();
    expect(params.get('lens')).toBeNull();
    expect(params.get('owner')).toBeNull();
    expect(params.get('albumId')).toBeNull();
    expect(params.get('state')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify RED**

```bash
cd web && pnpm test --run src/lib/utils/__tests__/filter-url.spec.ts
```

Expected: **FAIL** — `$lib/utils/filter-url` does not exist (module resolution error).

- [ ] **Step 3: Add the four fields to `FilterState`**

In `web/src/lib/components/filter-panel/filter-panel.ts`, add to the `FilterState` interface (after `model`):

```ts
  make?: string;
  model?: string;
  lensModel?: string;
  state?: string;
  albumId?: string;
  ownerId?: string;
```

Add all four to `clearFilters` (alongside the existing `make: undefined, model: undefined`):

```ts
    lensModel: undefined,
    state: undefined,
    albumId: undefined,
    ownerId: undefined,
```

And extend `getActiveFilterCount`.

**Collapse the location group into a single term.** The existing code counts `city`, then `country` only when there is no `city` — an awkward way of saying "location counts once". Adding `state` as its own term would break that: `country=Germany&state=Hamburg` (no city) would count **2**, while `active-filters-bar.svelte` renders location as **one** chip (it builds a single chip from city/country). The filter-count badge would then disagree with the chip bar. So replace the city/country pair with one location term — this is behavior-identical for every existing case (city alone → 1; city+country → 1; country alone → 1) and correctly makes `state` fold in:

```ts
  return (
    (state.personIds.length > 0 ? 1 : 0) +
    (state.city || state.country || state.state ? 1 : 0) + // location counts once (city/state/country)
    (state.make ? 1 : 0) + // `model` is intentionally not counted separately from `make`
    (state.lensModel ? 1 : 0) +
    (state.albumId ? 1 : 0) +
    (state.ownerId ? 1 : 0) +
    (state.tagIds.length > 0 ? 1 : 0) +
    // … every remaining term unchanged …
  );
```

`createFilterState()` needs no change — the four new fields are optional and start `undefined`.

**Now write the RED tests for this step first.** The counting/clearing tests live in
`web/src/lib/components/filter-panel/__tests__/filter-state.spec.ts` (NOT `filter-panel.spec.ts`). Add:

```ts
it('counts each new dimension as one active filter', () => {
  const filters = { ...createFilterState(), lensModel: 'RF24-70mm', albumId: 'a1', ownerId: 'u1' };

  expect(getActiveFilterCount(filters)).toBe(3);
});

it('counts city, state and country together as a single location filter', () => {
  const location = { ...createFilterState(), city: 'Berlin', state: 'State of Berlin', country: 'Germany' };
  expect(getActiveFilterCount(location)).toBe(1);

  // …and a state without a city is still just one location filter, not two
  const noCity = { ...createFilterState(), state: 'Hamburg', country: 'Germany' };
  expect(getActiveFilterCount(noCity)).toBe(1);
});

it('clearFilters clears the four new dimensions', () => {
  const filters = {
    ...createFilterState(),
    lensModel: 'RF24-70mm',
    state: 'Hamburg',
    albumId: 'a1',
    ownerId: 'u1',
  };

  expect(clearFilters(filters)).toMatchObject({
    lensModel: undefined,
    state: undefined,
    albumId: undefined,
    ownerId: undefined,
  });
});
```

Run them, confirm they FAIL (the fields don't exist yet / aren't counted), then make the change above.

- [ ] **Step 4: Create `web/src/lib/utils/filter-url.ts`**

Move the codec bodies out of `searchable-page-search.ts` (`getSearchablePageFilterState` and `appendSearchablePageFilterParams`, plus the private `splitListParam` / `parseRating` / `parseMediaType` / `parseFavorite` / `parseAlbumFilter` / `parseDateParam` helpers) into this new module, then add the four new dimensions.

```ts
import type { FilterState } from '$lib/components/filter-panel/filter-panel';

/** Bounds the URL length when a long description is used as a filter (E13). */
export const DESCRIPTION_PARAM_MAX_LENGTH = 200;

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
  setTrimmed('description', filters.description?.trim().slice(0, DESCRIPTION_PARAM_MAX_LENGTH));
  setTrimmed('filename', filters.originalFileName);
  setTrimmed('ocr', filters.ocr);

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
  result.description = get('description')?.slice(0, DESCRIPTION_PARAM_MAX_LENGTH);
  result.originalFileName = get('filename');
  result.ocr = get('ocr');
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
    }
    if (albumFilter === 'has') {
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

  // Strip keys we set to `undefined` above so the object is a clean partial.
  for (const key of Object.keys(result) as Array<keyof DecodedFilterState>) {
    if (result[key] === undefined) {
      delete result[key];
    }
  }

  return result;
}
```

Then move the six private parse helpers (`splitListParam`, `parseRating`, `parseMediaType`, `parseFavorite`, `parseAlbumFilter`, `parseDateParam`) verbatim from `searchable-page-search.ts` into this file, below the exports.

- [ ] **Step 5: Make `searchable-page-search.ts` delegate**

Keep every existing export and its exact signature. Replace the bodies:

```ts
import {
  clearFilterParams,
  decodeFilterParams,
  encodeFilterParams,
  FILTER_URL_PARAMS,
  type DecodedFilterState,
} from '$lib/utils/filter-url';

export const SEARCHABLE_PAGE_FILTER_PARAMS = FILTER_URL_PARAMS;

// Widen to the codec's type so the four new dimensions are properly typed as they flow through
// the photos/spaces pages, rather than surviving only as an untyped runtime pass-through.
export type SearchablePageFilterState = DecodedFilterState;

export function clearSearchablePageFilterParams(params: URLSearchParams) {
  clearFilterParams(params);
}

export function getSearchablePageFilterState(url: URL): SearchablePageFilterState {
  return decodeFilterParams(url);
}
```

Delete the old hand-written `SearchablePageFilterState` type (the `Partial<Pick<FilterState, …>>` block) — it is now this alias.

and inside `buildSearchablePageUrl`, swap the private `appendSearchablePageFilterParams(params, filters)` call for `encodeFilterParams(params, filters)`, deleting the now-dead private function and the six parse helpers you moved out.

Leave `getSearchablePageBasePath`, `getSearchablePageState`, `buildSearchablePageUrl`'s q/sort/`at` logic, and `preserveTransientTemporalFilters` **exactly as they are** — ⌘K depends on them and they are out of scope.

- [ ] **Step 6: Run the new tests AND the untouched regression suite**

```bash
cd web && pnpm test --run src/lib/utils/__tests__/filter-url.spec.ts src/lib/utils/__tests__/searchable-page-search.spec.ts src/lib/components/filter-panel/__tests__/filter-panel.spec.ts
```

Expected: **all pass**, and `searchable-page-search.spec.ts` passes **without you having edited it** (E16). If it fails, the delegation changed behavior — fix `filter-url.ts`, not the test.

- [ ] **Step 7: Typecheck**

```bash
cd web && pnpm check:typescript
```

- [ ] **Step 8: Commit**

```bash
git add web/src/lib/utils/filter-url.ts web/src/lib/utils/__tests__/filter-url.spec.ts \
        web/src/lib/utils/searchable-page-search.ts web/src/lib/components/filter-panel/filter-panel.ts
git commit -m "refactor(web): extract the filter URL codec and add lens/state/albumId/owner

One FilterState <-> URLSearchParams codec, shared by every timeline surface.
searchable-page-search delegates to it and keeps its public API, so /photos and
/spaces behavior is unchanged — its existing test suite passes unmodified.

albumId takes precedence over album=has|none, mirroring the server, which guards
isInAlbum/isNotInAlbum with `&& !options.albumId`."
```

---

### Task 2: `filter-target.ts` — resolve the surface and build the merged URL

**Files:**

- Create: `web/src/lib/utils/filter-target.ts`
- Create: `web/src/lib/utils/__tests__/filter-target.spec.ts`

**Interfaces:**

- Consumes: `decodeFilterParams`, `encodeFilterParams`, `clearFilterParams` from Task 1.
- Produces: `resolveFilterTarget(url: URL): FilterTarget | null` and `buildContextualFilterUrl(url: URL, patch: Partial<FilterState>, opts?: { global?: boolean }): string` — consumed by Slices 4, 6 and 7.

**Two semantics that are easy to get wrong — read before writing code:**

1. **Arrays REPLACE, they never append (E25).** A patch of `{ tagIds: ['sunset'] }` against an active `tags=beach` yields `tags=sunset`, not `tags=beach,sunset`. This is not arbitrary: on the server `personIds` is AND-ed (`hasPeople` uses `HAVING count(DISTINCT personId) = ids.length`) while `tagIds` is OR-ed (`withAnyTagId`), so appending would make two adjacent rows of the info panel move the result set in **opposite directions**. Replace gives both one meaning: "filter by the thing I clicked."
2. **`global: true` starts from a CLEAN filter state**, not from the current one. It replaces the old deprecated `Route.search({ make, model })` link, which always began a fresh search. Carrying the current filters over would also drag a Space's `space-person:<uuid>` scoped person tokens onto `/photos`, where they are meaningless.

- [ ] **Step 1: Write the failing tests**

Create `web/src/lib/utils/__tests__/filter-target.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildContextualFilterUrl, resolveFilterTarget } from '$lib/utils/filter-target';

const u = (path: string) => new URL(`https://g.test${path}`);

describe('resolveFilterTarget', () => {
  it('resolves /photos, with or without an open asset', () => {
    expect(resolveFilterTarget(u('/photos'))).toMatchObject({ kind: 'photos', basePath: '/photos' });
    expect(resolveFilterTarget(u('/photos/asset-1'))).toMatchObject({ kind: 'photos', basePath: '/photos' });
  });

  it('resolves a space, with or without an open asset', () => {
    expect(resolveFilterTarget(u('/spaces/s1'))).toMatchObject({ kind: 'space', spaceId: 's1' });
    expect(resolveFilterTarget(u('/spaces/s1/photos/a1'))).toMatchObject({ kind: 'space', spaceId: 's1' });
  });

  it('resolves an album, with or without an open asset', () => {
    expect(resolveFilterTarget(u('/albums/al1'))).toMatchObject({ kind: 'album', albumId: 'al1' });
    expect(resolveFilterTarget(u('/albums/al1/photos/a1'))).toMatchObject({ kind: 'album', albumId: 'al1' });
  });

  // E23 — /map is a filter target too
  it('E23: resolves the map, carrying its spaceId', () => {
    expect(resolveFilterTarget(u('/map'))).toMatchObject({ kind: 'map', basePath: '/map' });
    expect(resolveFilterTarget(u('/map/photos/a1?spaceId=s1'))).toMatchObject({ kind: 'map', spaceId: 's1' });
  });

  // E3 — non-filterable surfaces
  it('E3: returns null for surfaces with no filterable timeline', () => {
    for (const path of [
      '/favorites',
      '/archive',
      '/trash',
      '/folders',
      '/memories',
      '/search',
      '/people/p1',
      '/tags/x',
    ]) {
      expect(resolveFilterTarget(u(path)), path).toBeNull();
    }
  });
});

describe('buildContextualFilterUrl', () => {
  it('merges the patch into the current filters, preserving the others', () => {
    const url = buildContextualFilterUrl(u('/spaces/s1/photos/a1?people=person:p1'), {
      make: 'Apple',
      model: 'iPhone 17 Pro Max',
    });

    expect(url).toContain('/spaces/s1');
    expect(url).toContain('people=person%3Ap1');
    expect(url).toContain('make=Apple');
  });

  it('closes the asset viewer by targeting the base path', () => {
    expect(buildContextualFilterUrl(u('/photos/asset-1'), { make: 'Apple' })).not.toContain('asset-1');
  });

  it('preserves an active search query and sort', () => {
    const url = buildContextualFilterUrl(u('/photos?q=beach&sort=asc'), { make: 'Apple' });

    expect(url).toContain('q=beach');
    expect(url).toContain('sort=asc');
  });

  // E25 — arrays replace, never append
  it('E25: replaces the tag array rather than appending', () => {
    const url = buildContextualFilterUrl(u('/photos?tags=beach'), { tagIds: ['sunset'] });

    expect(url).toContain('tags=sunset');
    expect(url).not.toContain('beach');
  });

  it('E25: replaces the person array rather than appending', () => {
    const url = buildContextualFilterUrl(u('/photos?people=person:anna'), { personIds: ['person:ben'] });

    expect(url).toContain('people=person%3Aben');
    expect(url).not.toContain('anna');
  });

  // E24 — clicking the same value twice is a no-op.
  //
  // Assert the IDEMPOTENCE PROPERTY f(f(u)) === f(u), not string equality against the original
  // URL. The encoder re-emits filter params in its own canonical order, so `/photos?model=X&make=Y`
  // legitimately normalises to `/photos?make=Y&model=X`. A string-equality test against the raw
  // input would only pass when the fixture happens to already be in canonical order — it would be
  // green by luck, not by design.
  it('E24: applying the same patch twice is idempotent', () => {
    const patch = { make: 'Apple', model: 'iPhone 17 Pro Max' };
    const once = buildContextualFilterUrl(u('/photos?model=iPhone%2017%20Pro%20Max&make=Apple'), patch);
    const twice = buildContextualFilterUrl(new URL(`https://g.test${once}`), patch);

    expect(twice).toBe(once);
  });

  it('drops the one-shot `at` scroll target', () => {
    expect(buildContextualFilterUrl(u('/photos?at=asset-9'), { make: 'Apple' })).not.toContain('at=');
  });

  it('preserves non-filter params such as view and panel', () => {
    const url = buildContextualFilterUrl(u('/photos?view=timeline'), { make: 'Apple' });

    expect(url).toContain('view=timeline');
    expect(url).toContain('make=Apple');
  });

  // E5 / global — escape the current context, starting from a clean slate
  it('global: true targets /photos and carries NOTHING over — not filters, not the query', () => {
    const url = buildContextualFilterUrl(
      u('/spaces/s1/photos/a1?q=beach&sort=asc&people=space-person:p1&city=Berlin'),
      { make: 'Apple' },
      { global: true },
    );

    expect(url).toContain('/photos');
    expect(url).not.toContain('/spaces');
    expect(url).toContain('make=Apple');
    // A space-scoped person token matches nothing on /photos.
    expect(url).not.toContain('space-person');
    expect(url).not.toContain('city=Berlin');
    // "Search everywhere for THIS camera" is a NEW search, not the old one plus a camera.
    expect(url).not.toContain('q=');
  });

  // E3 — fallback
  it('E3: falls back to /photos from a non-filterable surface', () => {
    const url = buildContextualFilterUrl(u('/favorites/a1'), { make: 'Apple' });

    expect(url).toContain('/photos');
    expect(url).toContain('make=Apple');
  });

  it('keeps the map on the map, preserving its spaceId', () => {
    const url = buildContextualFilterUrl(u('/map/photos/a1?spaceId=s1'), { make: 'Apple' });

    expect(url).toContain('/map');
    expect(url).toContain('spaceId=s1');
    expect(url).toContain('make=Apple');
  });

  // The map stores its viewport in the hash. Losing it resets the map on every filter click.
  it('preserves the map viewport hash', () => {
    const url = buildContextualFilterUrl(u('/map/photos/a1?spaceId=s1#12.5/52.52/13.40'), { make: 'Apple' });

    expect(url).toContain('#12.5/52.52/13.40');
  });

  it('does not leak a hash onto non-map surfaces', () => {
    expect(buildContextualFilterUrl(u('/photos/a1#foo'), { make: 'Apple' })).not.toContain('#');
  });
});
```

- [ ] **Step 2: Run to verify RED**

```bash
cd web && pnpm test --run src/lib/utils/__tests__/filter-target.spec.ts
```

Expected: **FAIL** — `$lib/utils/filter-target` does not exist.

- [ ] **Step 3: Create `web/src/lib/utils/filter-target.ts`**

```ts
import { createFilterState, type FilterState } from '$lib/components/filter-panel/filter-panel';
import { clearFilterParams, decodeFilterParams, encodeFilterParams } from '$lib/utils/filter-url';

export type FilterTarget =
  | { kind: 'photos'; basePath: '/photos' }
  | { kind: 'space'; basePath: string; spaceId: string }
  | { kind: 'album'; basePath: string; albumId: string }
  | { kind: 'map'; basePath: '/map'; spaceId?: string };

/**
 * Which timeline surface is this URL on, for the purpose of contextual filtering?
 *
 * Deliberately SEPARATE from `getSearchablePageBasePath` in searchable-page-search.ts, which
 * answers a different question ("can ⌘K run a text query here?") and must not change.
 */
export function resolveFilterTarget(url: URL): FilterTarget | null {
  const parts = url.pathname.split('/').filter(Boolean);
  const [root, id, sub] = parts;

  if (root === 'photos') {
    return { kind: 'photos', basePath: '/photos' };
  }

  if (root === 'map') {
    const spaceId = url.searchParams.get('spaceId') ?? undefined;
    return { kind: 'map', basePath: '/map', spaceId };
  }

  // /spaces/{id}, /spaces/{id}/photos, /spaces/{id}/photos/{assetId}
  if (root === 'spaces' && id && (sub === undefined || sub === 'photos')) {
    return { kind: 'space', basePath: `/spaces/${id}`, spaceId: id };
  }

  // /albums/{id}, /albums/{id}/photos, /albums/{id}/photos/{assetId}
  if (root === 'albums' && id && (sub === undefined || sub === 'photos')) {
    return { kind: 'album', basePath: `/albums/${id}`, albumId: id };
  }

  return null;
}

/**
 * Merge one metadata patch into the current URL's filters and return the URL to navigate to.
 *
 * The result targets the surface's BASE path, which excludes any open assetId — so a single
 * goto() both closes the asset viewer and applies the filter.
 *
 * Merge semantics: the patched fields are SET; every other active filter is preserved. Array
 * fields (personIds, tagIds) are REPLACED, never appended — see the module docs and spec §5.6.
 */
export function buildContextualFilterUrl(url: URL, patch: Partial<FilterState>, opts?: { global?: boolean }): string {
  const target = opts?.global ? null : resolveFilterTarget(url);
  const basePath = target?.basePath ?? '/photos';

  // `global` (and the non-filterable-surface fallback) start from a CLEAN slate rather than
  // carrying the current context over. This replaces the old Route.search(...) link, which always
  // began a fresh search. It deliberately drops the active `q` and `sort` as well as the filters:
  // "search everywhere for THIS camera" is a new search, not the old one plus a camera. It also
  // avoids dragging a Space's `space-person:<uuid>` scoped tokens onto /photos, where a scoped
  // token matches nothing.
  const carryOver = target !== null;

  const params = new URLSearchParams(carryOver ? url.searchParams : undefined);

  // `at` is a one-shot grid scroll target left behind by closing the asset viewer. It must not
  // survive a filter change, or the timeline re-scrolls to a now-filtered-out asset.
  params.delete('at');
  clearFilterParams(params);

  const current: FilterState = {
    ...createFilterState(),
    ...(carryOver ? decodeFilterParams(url) : {}),
    ...patch,
  };

  encodeFilterParams(params, current);

  // The map keeps its viewport (zoom/lat/lng) in the URL HASH — `<Map hash>` on the map page, and
  // Route.map emits `#zoom/lat/lng`. Dropping it would silently reset the map's viewport every
  // time you filter from an asset opened on the map. No other surface uses the hash.
  const hash = target?.kind === 'map' ? url.hash : '';

  const search = params.toString();
  return basePath + (search ? `?${search}` : '') + hash;
}
```

- [ ] **Step 4: Run to verify GREEN**

```bash
cd web && pnpm test --run src/lib/utils/__tests__/filter-target.spec.ts
```

Expected: **PASS**, all cases.

- [ ] **Step 5: Full web gate**

```bash
cd web && pnpm test --run src/lib/utils src/lib/components/filter-panel && pnpm check:typescript && pnpm lint
```

`pnpm lint` will print ~650 pre-existing `better-tailwindcss` warnings — that is expected and **exits 0**. It must report **0 errors**. Do not attempt to fix the warnings.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/utils/filter-target.ts web/src/lib/utils/__tests__/filter-target.spec.ts
git commit -m "feat(web): resolve the contextual filter target and build merged filter URLs

resolveFilterTarget maps /photos, /spaces/{id}, /albums/{id} and /map (including
an open asset viewer on any of them) to a filter target; everything else is null
and falls back to /photos.

buildContextualFilterUrl merges one metadata patch into the current URL's filters
and returns the surface's BASE path, so a single goto() both closes the asset
viewer and applies the filter. Array fields are REPLACED, never appended: the
server ANDs personIds but ORs tagIds, so appending would move two adjacent rows of
the info panel in opposite directions."
```

---

## Done When

- `FilterState` carries `lensModel`, `state`, `albumId`, `ownerId`, and they round-trip through the URL as `lens`, `state`, `albumId`, `owner`.
- `searchable-page-search.spec.ts` passes **completely unmodified** (E16).
- `resolveFilterTarget` handles photos / space / album / map, including asset-viewer URLs, and returns `null` elsewhere (E3, E23).
- `buildContextualFilterUrl` merges rather than replaces, replaces arrays rather than appending (E25), is idempotent (E24), drops `at`, and escapes to a clean `/photos` under `global` (E5).
- No `.svelte` file was touched.
