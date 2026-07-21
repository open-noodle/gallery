# Recently Added — Slice 2: Browse filter panel (9 metadata sections) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Recently Added view the 9-section metadata filter panel (Timeline-date, People, Location, Camera, Tags, Rating, Media type, Favorites, Albums) with chips, URL persistence, and a header count that reflects the filtered set — while never surfacing shared-space assets and always ordering/grouping by _added_ date.

**Architecture:** Pure modules carry the decision logic under exhaustive unit tests: `recently-added-filter-options.ts` (extended from Slice 1) gains `buildRecentlyAddedTimelineOptions` and `buildRecentlyAddedSuggestionRequest`; a new `recently-added-filter-config.ts` builds the `FilterPanelConfig`. A prerequisite change registers `/recently-added` as a URL-persisting page without granting it query support. The route mirrors the Photos page minus everything search-related, and is covered both by a route-level vitest spec and by Playwright acceptance scenarios.

**Tech Stack:** SvelteKit + Svelte 5 runes, TypeScript (strict), Vitest + @testing-library/svelte, Playwright.

## Global Constraints

From the spec (`docs/superpowers/specs/2026-07-19-recently-added-filters-design.md`) — these bind every task:

- **Scope:** Web only. No server / API / mobile / DTO changes.
- **Do not modify** the Photos page or the shared `filter-panel/` / `Timeline` / `UserPageLayout` components. (`searchable-page-search.ts` **is** modified this slice — see Task 1 — but in a way that leaves Photos and Spaces behaviour bit-for-bit unchanged.)
- **The single scope invariant:** Recently Added is an **own + partner** surface, **never shared spaces**. `withSharedSpaces` must never appear in timeline options, filter-suggestion requests, or provider requests.
- **`orderBy: AssetOrderBy.CreatedAt` always** — under every filter combination. The defining trait of the view.
- **No free-text / smart search in this slice.** Nothing may reference `committedQuery`, `SmartSearchResults`, `searchSmartFacets`, or smart facets. The `'text'` section arrives in Slice 3 with its search path, so the text input is never present without a working submit. `isSearchable` must stay **false** for `/recently-added` this slice.
- **No `resultCount` and no `onAddAllToCollection`** on `ActiveFiltersBar` — the header carries the single count (spec §5.2).
- No i18n additions: reuse the existing `items_count` key.
- The `AssetSelectControlBar` block in the route stays unchanged, as does the `{#snippet empty()}` / `EmptyPlaceholder` block (Slice 1's e2e asserts its copy).
- Code style: Prettier (120 char, single quotes, trailing commas, semicolons); no relative imports in web — use `$lib/`.
- ESLint: **no new errors and no new warnings**. Web's `pnpm lint` does not pass `--max-warnings 0`, and ~640 pre-existing Tailwind warnings are expected — but do not add to them.

## Baseline: what Slice 1 delivered (do not redo)

Committed on this branch: `recently-added-filter-options.ts` exporting `shouldShowRecentlyAddedCount(count, hasActiveFilters)`; its spec; `e2e/src/specs/web/recently-added-filters.e2e-spec.ts` with 3 passing scenarios; and the route deriving `assetCount` + `countLabel` and passing `description={countLabel}` to `UserPageLayout`. This slice extends all four.

## Task order and why

1. URL-persistence prerequisite (unit TDD) — without it every filter→URL step downstream silently no-ops.
2. Options builders (unit TDD).
3. Filter config (unit TDD).
4. Route-level vitest spec (red).
5. E2E acceptance scenarios (red).
6. Route wiring (turns 4 and 5 green).

Do not reorder — Tasks 4 and 5 are only genuinely red before Task 6.

---

## Reference: commands used in this slice

Web unit tests (`"test": "vitest"` is watch-mode by default, so `--run` is required):

```bash
cd web && pnpm test -- --run src/lib/utils/__tests__/recently-added-filter-options.spec.ts
```

Note: in this repo's vitest workspace setup the path argument does not always isolate to one file — the whole project suite may run. That is expected; find your file's results in the output.

E2E web suite — **never use `:2283`** (a `mise dev` stack returns HTTP 200 with a 0-byte body for page routes there, producing bogus "element not found" failures; the dev stack's real web app is the Vite container on `:3000`).

**Preferred — the dedicated e2e stack** (Playwright defaults; serves the built web app on `:2285` with Postgres on `5435`, the port `utils.resetDatabase()` hardcodes):

```bash
cd e2e && docker compose up --build -d     # rebuild after any web source change — the app is baked into the image
cd e2e && pnpm exec playwright test --project=web --retries=0 src/specs/web/recently-added-filters.e2e-spec.ts
```

Pass `--retries=0` on the deliberate red runs — the `web` project sets `retries: 4`, which would otherwise multiply every expected 30s `waitForSelector` timeout by five.

**Fallback — against a running `mise dev` stack** (serves from source via Vite HMR, no rebuild between runs):

```bash
socat TCP-LISTEN:5435,fork,reuseaddr TCP:127.0.0.1:5432 &   # resetDatabase() hardcodes 5435; dev Postgres is on 5432
cd e2e && PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 PLAYWRIGHT_DISABLE_WEBSERVER=1 \
  pnpm exec playwright test --project=web --retries=0 src/specs/web/recently-added-filters.e2e-spec.ts
kill %1
```

Prettier is a **separate CI gate** from ESLint — always `prettier --check` touched files. A `**/*.svelte` glob does not match inside the `[[…]]` route directory; use the concrete escaped path.

---

## File Structure

| File                                                                                                | Status              | Responsibility                                                                             |
| --------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------ |
| `web/src/lib/utils/searchable-page-search.ts`                                                       | **Modify** (Task 1) | Register `/recently-added` as a URL-persisting page; split `isSearchable` from `basePath`. |
| `web/src/lib/utils/__tests__/searchable-page-search.spec.ts`                                        | **Modify** (Task 1) | Cases for the new path and the split flag.                                                 |
| `web/src/lib/utils/recently-added-filter-options.ts`                                                | **Modify** (Task 2) | Add `buildRecentlyAddedTimelineOptions`, `buildRecentlyAddedSuggestionRequest`.            |
| `web/src/lib/utils/__tests__/recently-added-filter-options.spec.ts`                                 | **Modify** (Task 2) | Exhaustive cases for both builders.                                                        |
| `web/src/lib/utils/recently-added-filter-config.ts`                                                 | **Create** (Task 3) | `buildRecentlyAddedFilterConfig(): FilterPanelConfig`.                                     |
| `web/src/lib/utils/__tests__/recently-added-filter-config.spec.ts`                                  | **Create** (Task 3) | Config unit tests, mirroring `album-filter-config.spec.ts`.                                |
| `web/src/routes/(user)/recently-added/[[photos=photos]]/[[assetId=id]]/recently-added-page.spec.ts` | **Create** (Task 4) | Route-level component spec, mirroring `photos-page.spec.ts`.                               |
| `e2e/src/specs/web/recently-added-filters.e2e-spec.ts`                                              | **Modify** (Task 5) | Append the browse-filter acceptance scenarios.                                             |
| `web/src/routes/(user)/recently-added/[[photos=photos]]/[[assetId=id]]/+page.svelte`                | **Modify** (Task 6) | Host the filter panel, toolbar, chips, URL sync; count reflects filters.                   |

---

## Task 1: Register `/recently-added` for URL persistence, without granting query support

**Files:**

- Modify: `web/src/lib/utils/searchable-page-search.ts`
- Test: `web/src/lib/utils/__tests__/searchable-page-search.spec.ts`

**Interfaces:**

- Produces: `getSearchablePageBasePath('/recently-added…')` → `'/recently-added'`, which makes `buildSearchablePageUrl` return a real URL for this route (Task 6 depends on it); and `getSearchablePageState(url).isSearchable === false` for that same path.

**Why this task exists.** `buildSearchablePageUrl` bails to `null` when `getSearchablePageBasePath` does not recognise the pathname (`searchable-page-search.ts:115-118`), and today it recognises only `/photos` and `/spaces/…`:

```ts
export function getSearchablePageBasePath(pathname: string): string | null {
  if (pathname.startsWith('/photos')) {
    return '/photos';
  }

  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] !== 'spaces' || parts[1] === undefined) {
    return null;
  }
  …
}
```

Without registering the path, every filter change on Recently Added would update the grid but never the URL — the write path fails silently. (The _read_ path already works: `getSearchablePageFilterState` parses `searchParams` with no basePath check, which is why deep links would appear to half-work.)

But `getSearchablePageState` currently derives the query capability from the same fact:

```ts
return {
  basePath,
  isSearchable: true,
  …
};
```

and consumers key off `isSearchable`: `global-search-input-trigger.svelte:10` (`showSearchSortControl`) and `global-search-manager.svelte.ts:663` / `:670` (typed display text).

**The dangerous consumer is not gated by that flag at all.** `buildSearchDestination` (`global-search-manager.svelte.ts:1540-1543`) branches purely on `buildSearchablePageUrl` returning non-null:

```ts
private buildSearchDestination(text: string, filters?: FilterState): string {
  const searchablePageUrl = buildSearchablePageUrl(page.url, text, this.searchSortOrder, filters);
  if (searchablePageUrl) {
    return searchablePageUrl;
  }
  …
  return buildSearchablePageUrl(new URL('/photos', page.url), text, this.searchSortOrder, filters) ?? '/photos';
}
```

It is reached from `activateSearch` (`:1692-1694`) — the ordinary type-a-query-and-press-Enter path. Today on `/recently-added` the first call returns `null`, so the search runs on `/photos` and works. The moment we register the base path, it returns a real URL and `buildSearchablePageUrl:130-131` sets `q`, landing the user on `/recently-added?q=beach`: a route with no query handling until Slice 3. Unfiltered grid, stale `q`, no error — a silent regression against working behavior. `isSearchable: false` does **not** prevent it (it only suppresses pre-filling the box; nothing stops the user typing).

**So the predicate must be enforced where the query is written, not only where it is advertised** — in `buildSearchablePageUrl` itself, which keeps `buildSearchDestination`'s `/photos` fallback intact.

Accepted, deliberate consequence: `global-search-manager.svelte.ts:1594` (`applyFilters`) now sees a non-null base path and keeps filter application on Recently Added instead of redirecting to `/photos`. That is benign — it passes a literal `''` query, so it writes filter params only, which is exactly this slice's own behavior. Two other newly-reachable consumers are no-ops: `:1601` (`applySearchSort`) is unreachable because its control is `isSearchable`-gated, and `:1632` (`activateSearch('')`) passes no `filters`, so the built URL equals the current one.

One further newly-reachable path is intentional, not a bug: `navigateToFieldResults` (`:1595`) also passes a literal `''`, so the guard correctly lets it through. Field searches from global search (filename / description / OCR) will now write `?filename=…` / `?description=…` / `?ocr=…` onto `/recently-added` instead of redirecting to `/photos`. That works end to end this slice — the params are parsed by `getSearchablePageFilterState`, consumed by `buildRecentlyAddedTimelineOptions`, rendered as chips by `active-filters-bar.svelte:151-157`, and removable via `handlePhotosRemoveFilter`. The only rough edge is that the panel has no `'text'` section yet, so such a chip is visible and removable but not editable in the panel until Slice 3. Do not "fix" this.

- [ ] **Step 1: Write the failing tests**

Append to `web/src/lib/utils/__tests__/searchable-page-search.spec.ts` (keep the existing `/photos` and `/spaces/…` cases untouched — they are the regression guard that this change is behaviour-preserving elsewhere):

```ts
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

  it('is not query-capable until the text slice lands', () => {
    // Slice 3 flips this to true together with the text section and the search path, so the
    // global search UI never offers a query this page cannot answer.
    const state = getSearchablePageState(new URL('https://gallery.test/recently-added'));

    expect(state.basePath).toBe('/recently-added');
    expect(state.isSearchable).toBe(false);
  });

  it('refuses to build a query URL for a page that cannot answer one', () => {
    // This is the load-bearing case. global-search-manager's buildSearchDestination falls back to
    // /photos only when this returns null, so returning a URL here would strand a `?q=` on a route
    // with no query handling.
    expect(buildSearchablePageUrl(new URL('https://gallery.test/recently-added'), 'beach')).toBeNull();
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
```

Add any imports the file does not already have (`getSearchablePageBasePath`, `getSearchablePageState`, `buildSearchablePageUrl`, `createFilterState`) — read the file's existing import block first and extend it rather than duplicating.

- [ ] **Step 2: Run to verify RED**

```bash
cd web && pnpm test -- --run src/lib/utils/__tests__/searchable-page-search.spec.ts
```

Expected: **FAIL** — `getSearchablePageBasePath('/recently-added')` returns `null`, `buildSearchablePageUrl` returns `null`, and `isSearchable` is `false` only because `basePath` is null (so that one case may pass for the wrong reason — the first two failures are the real signal). Paste the output.

- [ ] **Step 3: Implement**

In `web/src/lib/utils/searchable-page-search.ts`, add the path to `getSearchablePageBasePath`, immediately after the `/photos` branch:

```ts
if (pathname.startsWith('/recently-added')) {
  return '/recently-added';
}
```

Add the capability predicate above `getSearchablePageState`, and enforce it in **both** places below:

```ts
/**
 * Query (free-text) support is a separate capability from URL filter persistence.
 *
 * Recently Added persists its filters in the URL but cannot answer a `?q=` yet — its text
 * section and smart-search path arrive together in the text slice. Until then it must not
 * advertise itself as searchable, or the global search UI would offer a query that silently
 * does nothing. Remove this exclusion in the same change that adds the search path.
 */
function isQueryCapablePage(basePath: string): boolean {
  return basePath !== '/recently-added';
}
```

Enforcement 1 — `getSearchablePageState` reports the capability:

```ts
return {
  basePath,
  isSearchable: isQueryCapablePage(basePath),
  query,
  hasExplicitSort: rawSort === 'asc' || rawSort === 'desc',
  sortOrder: getSortOrder(query, rawSort),
};
```

Enforcement 2 — `buildSearchablePageUrl` refuses to _write_ a query for such a page. Insert this immediately after the existing `const trimmedQuery = query.trim();` line (which currently sits just below the `basePath` null check):

```ts
// A page that persists filters in the URL is not necessarily able to answer a `?q=`.
// Returning null here keeps global-search-manager's buildSearchDestination falling back to
// /photos, instead of stranding a query on a route that would silently ignore it.
if (trimmedQuery && !isQueryCapablePage(basePath)) {
  return null;
}
```

Filter-only calls (empty query) are unaffected, which is exactly what this slice's `syncFilterUrl` needs.

- [ ] **Step 4: Run to verify GREEN**

```bash
cd web && pnpm test -- --run src/lib/utils/__tests__/searchable-page-search.spec.ts
```

Expected: **PASS** — the new cases and every pre-existing case in the file. The pre-existing ones passing is the proof that Photos and Spaces are unaffected. Paste the output.

- [ ] **Step 5: Format and commit**

```bash
cd web && pnpm exec prettier --check src/lib/utils/searchable-page-search.ts src/lib/utils/__tests__/searchable-page-search.spec.ts
cd .. && git add web/src/lib/utils/searchable-page-search.ts web/src/lib/utils/__tests__/searchable-page-search.spec.ts
git commit -m "feat(web): persist Recently Added filters in the URL without enabling query mode (#805)"
```

---

## Task 2: Timeline-options and suggestion-request builders

**Files:**

- Modify: `web/src/lib/utils/recently-added-filter-options.ts`
- Test: `web/src/lib/utils/__tests__/recently-added-filter-options.spec.ts`

**Interfaces:**

- Produces:
  - `export function buildRecentlyAddedTimelineOptions(filters: FilterState): Record<string, unknown>`
  - `export function buildRecentlyAddedSuggestionRequest(filters: FilterState)` (inferred object return)

  Task 3 imports the suggestion request; Task 6 imports the timeline options.

**Facts about the code you build on:**

`buildPhotosTimelineOptions` (`web/src/lib/utils/photos-filter-options.ts`) starts from:

```ts
const includeSharedTimelineAssets = filters.isFavorite === undefined;
const base: Record<string, unknown> = {
  visibility: AssetVisibility.Timeline,
  withStacked: true,
  ...(includeSharedTimelineAssets ? { withPartners: true, withSharedSpaces: true } : {}),
};
```

then conditionally sets `personIds`, `city`, `country`, `make`, `model`, trimmed `description`/`originalFileName`/`ocr`, `tagIds`, `rating`, `isFavorite`, `isNotInAlbum` (true only), `isInAlbum` (true only), `$type` (when `mediaType !== 'all'`), always sets `order` (`AssetOrder.Asc` for `sortOrder === 'asc'`, else `AssetOrder.Desc`), and adds `takenAfter`/`takenBefore` from `buildFilterContext(filters)`.

`withPartners` and `withSharedSpaces` are added **together**, gated only on `filters.isFavorite === undefined`. Stripping `withSharedSpaces` therefore leaves `withPartners` for non-favorite filters and drops both under Favorites — exactly the intended behavior.

`createFilterState()` returns `{ personIds: [], tagIds: [], mediaType: 'all', sortOrder: 'desc' }`, and `buildFilterContext` returns `undefined` for it (no date keys).

**ESLint note — use a bare underscore.** `web/eslint.config.js` sets `varsIgnorePattern: '^_$'`, which matches **only** the literal `_`, and typescript-eslint defaults `ignoreRestSiblings` to `false`. A name like `_omitSharedSpaces` would raise a new warning. The repo convention is the bare `_` — see `web/src/lib/utils/space-search.ts:92`: `const { order: _, ...params } = buildSmartSearchParams(args);`.

- [ ] **Step 1: Write the failing tests**

Update the existing import at the top of `web/src/lib/utils/__tests__/recently-added-filter-options.spec.ts` to:

```ts
import {
  buildRecentlyAddedSuggestionRequest,
  buildRecentlyAddedTimelineOptions,
  shouldShowRecentlyAddedCount,
} from '$lib/utils/recently-added-filter-options';
```

and add these imports:

```ts
import { AssetOrder, AssetOrderBy, AssetTypeEnum, AssetVisibility } from '@immich/sdk';
import { createFilterState } from '$lib/components/filter-panel/filter-panel';
```

Then append (keep the existing `shouldShowRecentlyAddedCount` describe as-is):

```ts
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
      description: '   ',
      originalFileName: '   ',
      ocr: '   ',
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
});
```

- [ ] **Step 2: Run to verify RED**

```bash
cd web && pnpm test -- --run src/lib/utils/__tests__/recently-added-filter-options.spec.ts
```

Expected: **FAIL** — the module does not export the two new builders, so the import fails (`does not provide an export named 'buildRecentlyAddedTimelineOptions'`). Paste the output.

- [ ] **Step 3: Implement both builders**

Add to `web/src/lib/utils/recently-added-filter-options.ts` (leave `shouldShowRecentlyAddedCount` unchanged). Imports:

```ts
import { AssetOrderBy, AssetTypeEnum } from '@immich/sdk';
import { buildFilterContext, type FilterState } from '$lib/components/filter-panel/filter-panel';
import { buildPhotosTimelineOptions } from '$lib/utils/photos-filter-options';
```

Body:

```ts
/**
 * Timeline query for the Recently Added view.
 *
 * Reuses Photos' predicate mapping, then applies the two invariants that define this view:
 *  1. never surface shared-space assets — `withSharedSpaces` is stripped in every case, so the
 *     view stays own + partner (and own-only under a Favorites filter, which Photos treats as
 *     a personal flag);
 *  2. always order and day-group by *added* date.
 *
 * Note the date filter still filters *taken* date (there is no created-at range predicate);
 * day-groups reflect added date. That mismatch is intentional — e.g. old photos just imported.
 */
export function buildRecentlyAddedTimelineOptions(filters: FilterState): Record<string, unknown> {
  const { withSharedSpaces: _, ...base } = buildPhotosTimelineOptions(filters);
  return { ...base, orderBy: AssetOrderBy.CreatedAt };
}

/**
 * Filter-suggestion request for the Recently Added panel. Deliberately carries no
 * `withSharedSpaces` / `albumId` / `spaceId` — suggestions must describe the same own+partner
 * set the timeline shows.
 */
export function buildRecentlyAddedSuggestionRequest(filters: FilterState) {
  const context = buildFilterContext(filters);
  return {
    personIds: filters.personIds.length > 0 ? filters.personIds : undefined,
    country: filters.country,
    city: filters.city,
    make: filters.make,
    model: filters.model,
    tagIds: filters.tagIds.length > 0 ? filters.tagIds : undefined,
    rating: filters.rating,
    isFavorite: filters.isFavorite,
    mediaType:
      filters.mediaType === 'all'
        ? undefined
        : filters.mediaType === 'image'
          ? AssetTypeEnum.Image
          : AssetTypeEnum.Video,
    takenAfter: context?.takenAfter,
    takenBefore: context?.takenBefore,
  };
}
```

- [ ] **Step 4: Run to verify GREEN**

```bash
cd web && pnpm test -- --run src/lib/utils/__tests__/recently-added-filter-options.spec.ts
```

Expected: **PASS**, all three describes. Paste the output.

- [ ] **Step 5: Format and commit**

```bash
cd web && pnpm exec prettier --check src/lib/utils/recently-added-filter-options.ts src/lib/utils/__tests__/recently-added-filter-options.spec.ts
cd .. && git add web/src/lib/utils/recently-added-filter-options.ts web/src/lib/utils/__tests__/recently-added-filter-options.spec.ts
git commit -m "feat(web): Recently Added timeline options and suggestion request builders (#805)"
```

---

## Task 3: The filter-panel config

**Files:**

- Create: `web/src/lib/utils/recently-added-filter-config.ts`
- Test: `web/src/lib/utils/__tests__/recently-added-filter-config.spec.ts`

**Interfaces:**

- Consumes: `buildRecentlyAddedSuggestionRequest` (Task 2); `getPhotosPersonFilterId` / `getPhotosPersonFilterThumbnailUrl` from `$lib/utils/photos-filter-options`; `FilterPanelConfig` from `$lib/components/filter-panel/filter-panel`.
- Produces: `export function buildRecentlyAddedFilterConfig(): FilterPanelConfig` — used by Task 6, extended in Slice 3.

**Template:** `web/src/lib/utils/album-filter-config.ts` + `__tests__/album-filter-config.spec.ts`. Differences: nine of the ten `FilterSection` values (Recently Added adds `'albums'`; `'text'` waits for Slice 3), and no `albumId` scoping anywhere.

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/utils/__tests__/recently-added-filter-config.spec.ts`:

```ts
import { AssetTypeEnum, getFilterSuggestions, getSearchSuggestions, Type } from '@immich/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFilterState } from '$lib/components/filter-panel/filter-panel';
import { buildRecentlyAddedFilterConfig } from '$lib/utils/recently-added-filter-config';

vi.mock('@immich/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@immich/sdk')>();
  return {
    ...actual,
    getFilterSuggestions: vi.fn().mockResolvedValue({
      countries: ['Germany'],
      cameraMakes: ['Sony'],
      tags: [{ id: 'tag-1', value: 'Vacation' }],
      people: [{ id: 'person-1', name: 'Alice' }],
      ratings: [5],
      mediaTypes: ['IMAGE'],
      hasUnnamedPeople: false,
    }),
    getSearchSuggestions: vi.fn().mockResolvedValue(['Berlin']),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('buildRecentlyAddedFilterConfig', () => {
  it('exposes the nine metadata sections in plan order', () => {
    // 'text' is deliberately absent — it arrives in Slice 3 with the search path, so the input
    // is never rendered without a working submit.
    expect(buildRecentlyAddedFilterConfig().sections).toEqual([
      'timeline',
      'people',
      'location',
      'camera',
      'tags',
      'rating',
      'media',
      'favorites',
      'albums',
    ]);
  });

  it('never scopes suggestions to shared spaces, albums, or spaces', async () => {
    const config = buildRecentlyAddedFilterConfig();

    await config.suggestionsProvider!(createFilterState());
    await config.providers!.cities!('Germany');
    await config.providers!.cameraModels!('Sony');

    const filterRequest = vi.mocked(getFilterSuggestions).mock.calls[0][0];
    const cityRequest = vi.mocked(getSearchSuggestions).mock.calls[0][0];
    const cameraRequest = vi.mocked(getSearchSuggestions).mock.calls[1][0];

    for (const request of [filterRequest, cityRequest, cameraRequest]) {
      expect(request).not.toHaveProperty('withSharedSpaces');
      expect(request).not.toHaveProperty('albumId');
      expect(request).not.toHaveProperty('spaceId');
    }
  });

  it('maps tags and people suggestions', async () => {
    vi.mocked(getFilterSuggestions).mockResolvedValueOnce({
      countries: ['Germany'],
      cameraMakes: ['Sony'],
      tags: [{ id: 'tag-1', value: 'Vacation' }],
      people: [{ id: 'person-1', name: 'Alice' }],
      ratings: [5],
      mediaTypes: ['IMAGE'],
      hasUnnamedPeople: true,
    } as never);

    const result = await buildRecentlyAddedFilterConfig().suggestionsProvider!(createFilterState());

    expect(result.tags).toEqual([{ id: 'tag-1', name: 'Vacation' }]);
    expect(result.people).toEqual([
      expect.objectContaining({
        id: 'person-1',
        name: 'Alice',
        thumbnailUrl: expect.stringContaining('/people/person-1/thumbnail'),
      }),
    ]);
    expect(result.hasUnnamedPeople).toBe(true);
    expect(result.countries).toEqual(['Germany']);
    expect(result.cameraMakes).toEqual(['Sony']);
    expect(result.ratings).toEqual([5]);
  });

  it('resolves a space-person suggestion to its shared-space thumbnail', async () => {
    // A shared-space person can still be *suggested* (they may appear on an own asset); only the
    // asset scope is restricted. The thumbnail must route to the space endpoint, because the
    // space-person id has no row in the owner-only person table.
    vi.mocked(getFilterSuggestions).mockResolvedValueOnce({
      countries: [],
      cameraMakes: [],
      tags: [],
      people: [
        {
          id: 'space-person:space-person-1',
          name: 'Space Person',
          primaryProfile: { type: Type.SpacePerson, id: 'space-person-1', spaceId: 'space-1' },
        },
      ],
      ratings: [],
      mediaTypes: [],
      hasUnnamedPeople: false,
    } as never);

    const result = await buildRecentlyAddedFilterConfig().suggestionsProvider!(createFilterState());

    expect(result.people).toEqual([
      expect.objectContaining({
        id: 'space-person:space-person-1',
        thumbnailUrl: '/api/shared-spaces/space-1/people/space-person-1/thumbnail',
      }),
    ]);
  });

  it('maps people suggestions by scoped filter id', async () => {
    vi.mocked(getFilterSuggestions).mockResolvedValueOnce({
      countries: [],
      cameraMakes: [],
      tags: [],
      people: [
        {
          id: 'identity-group-1',
          filterId: 'person:person-1',
          name: 'Alice',
          primaryProfile: { type: Type.UserPerson, id: 'person-1' },
        },
      ],
      ratings: [],
      mediaTypes: [],
      hasUnnamedPeople: false,
    } as never);

    const result = await buildRecentlyAddedFilterConfig().suggestionsProvider!(createFilterState());

    expect(result.people[0]).toEqual(expect.objectContaining({ id: 'person:person-1', name: 'Alice' }));
  });

  it('forwards the active filters to the suggestion request', async () => {
    await buildRecentlyAddedFilterConfig().suggestionsProvider!({
      ...createFilterState(),
      personIds: ['person:p1'],
      tagIds: ['tag-1'],
      mediaType: 'image',
      isFavorite: true,
      dateAfter: '2024-01-01',
      dateBefore: '2024-12-31',
    });

    expect(getFilterSuggestions).toHaveBeenCalledWith(
      expect.objectContaining({
        personIds: ['person:p1'],
        tagIds: ['tag-1'],
        mediaType: AssetTypeEnum.Image,
        isFavorite: true,
        takenAfter: '2024-01-01T00:00:00.000Z',
        takenBefore: '2025-01-01T00:00:00.000Z',
      }),
    );
  });

  it('passes the dependent-provider arguments and context through', async () => {
    const config = buildRecentlyAddedFilterConfig();

    await config.providers!.cities!('Germany', { takenAfter: '2024-01-01T00:00:00.000Z' });
    await config.providers!.cameraModels!('Sony', { takenBefore: '2024-12-31T00:00:00.000Z' });

    expect(getSearchSuggestions).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ country: 'Germany', takenAfter: '2024-01-01T00:00:00.000Z' }),
    );
    expect(getSearchSuggestions).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ make: 'Sony', takenBefore: '2024-12-31T00:00:00.000Z' }),
    );
  });
});
```

- [ ] **Step 2: Run to verify RED**

```bash
cd web && pnpm test -- --run src/lib/utils/__tests__/recently-added-filter-config.spec.ts
```

Expected: **FAIL** — `Failed to resolve import "$lib/utils/recently-added-filter-config"`. Paste the output.

- [ ] **Step 3: Implement**

Create `web/src/lib/utils/recently-added-filter-config.ts`:

```ts
import { getFilterSuggestions, getSearchSuggestions, SearchSuggestionType } from '@immich/sdk';
import type { FilterPanelConfig } from '$lib/components/filter-panel/filter-panel';
import { getPhotosPersonFilterId, getPhotosPersonFilterThumbnailUrl } from '$lib/utils/photos-filter-options';
import { buildRecentlyAddedSuggestionRequest } from '$lib/utils/recently-added-filter-options';

/**
 * Nine of the ten filter sections. `'text'` is intentionally absent until Slice 3 adds the
 * smart-search path alongside it, so the text input is never rendered without a working submit.
 */
const sections = [
  'timeline',
  'people',
  'location',
  'camera',
  'tags',
  'rating',
  'media',
  'favorites',
  'albums',
] as const;

function mapSuggestions(response: Awaited<ReturnType<typeof getFilterSuggestions>>) {
  return {
    countries: response.countries,
    cameraMakes: response.cameraMakes,
    tags: response.tags.map((tag) => ({ id: tag.id, name: tag.value })),
    people: response.people.map((person) => ({
      id: getPhotosPersonFilterId(person),
      name: person.name,
      thumbnailUrl: getPhotosPersonFilterThumbnailUrl(person),
    })),
    ratings: response.ratings,
    mediaTypes: response.mediaTypes,
    hasUnnamedPeople: response.hasUnnamedPeople,
  };
}

/**
 * Filter-panel config for the Recently Added view: own + partner scope only, so nothing here
 * carries `withSharedSpaces` / `albumId` / `spaceId`.
 */
export function buildRecentlyAddedFilterConfig(): FilterPanelConfig {
  return {
    sections: [...sections],
    suggestionsProvider: async (filters) =>
      mapSuggestions(await getFilterSuggestions(buildRecentlyAddedSuggestionRequest(filters))),
    providers: {
      cities: (country, context) => getSearchSuggestions({ $type: SearchSuggestionType.City, country, ...context }),
      cameraModels: (make, context) =>
        getSearchSuggestions({ $type: SearchSuggestionType.CameraModel, make, ...context }),
    },
  };
}
```

This is deliberately near-identical to `buildAlbumAssetPickerFilterConfig` (differing only by the `'albums'` section). The spec sanctions mirroring `album-filter-config.ts` rather than extracting a shared helper; do not refactor the album module in this slice.

- [ ] **Step 4: Run to verify GREEN**

```bash
cd web && pnpm test -- --run src/lib/utils/__tests__/recently-added-filter-config.spec.ts
```

Expected: **PASS** — all 7 cases. Paste the output.

- [ ] **Step 5: Format and commit**

```bash
cd web && pnpm exec prettier --check src/lib/utils/recently-added-filter-config.ts src/lib/utils/__tests__/recently-added-filter-config.spec.ts
cd .. && git add web/src/lib/utils/recently-added-filter-config.ts web/src/lib/utils/__tests__/recently-added-filter-config.spec.ts
git commit -m "feat(web): Recently Added filter-panel config (#805)"
```

---

## Task 4: Route-level component spec (red-first for the wiring)

**Files:**

- Create: `web/src/routes/(user)/recently-added/[[photos=photos]]/[[assetId=id]]/recently-added-page.spec.ts`

**Interfaces:**

- Consumes: the route component. Asserts the wiring Task 6 must produce.
- Produces: fast, deterministic coverage of the URL-sync and options-derivation behavior that Playwright can only verify slowly.

**Template — read it first and mirror its mocking setup exactly:** `web/src/routes/(user)/photos/[[assetId=id]]/photos-page.spec.ts` (989 lines). It hoists `mockPage`, `mockAssetMultiSelectManager`, `mockAuthManager`, `mockRegisterSearchablePageFilters`; mocks `$app/navigation` (`goto`), `$app/state` (`page`), and swaps heavy components for stubs from `@test-data/mocks/` (`bindable-filter-panel.stub.svelte`, `active-filters-bar-actions.stub.svelte`, `noop-component.svelte`) plus the shared mock timeline wrapper. Reuse those same stubs. `web/src/routes/(user)/spaces/…` has a second example.

Copy only the mocks this route actually needs — the Recently Added route has **no** `SmartSearchResults`, no memories carousel, and no `registerSelectionContext`, so omit those mocks.

**How to assert — the two mechanisms `photos-page.spec.ts` uses.** Do not invent a third:

1. **The timeline stub renders its received options as JSON under a testid.** Assert against its text content, e.g. (`photos-page.spec.ts:670`, `:685`, `:688`):
   ```ts
   expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"day"');
   ```
2. **Spy on the options builder module** to assert what the route passed it (`photos-page.spec.ts:202-203` does this for `$lib/utils/photos-filter-options`). The Recently Added equivalent spies on `$lib/utils/recently-added-filter-options`:
   ```ts
   vi.mock('$lib/utils/recently-added-filter-options', async (importOriginal) => {
     const actual = await importOriginal<typeof import('$lib/utils/recently-added-filter-options')>();
     return { ...actual, buildRecentlyAddedTimelineOptions: vi.fn(actual.buildRecentlyAddedTimelineOptions) };
   });
   ```

URL assertions go against the mocked `goto` from `$app/navigation`. Follow the structure of `photos-page.spec.ts`'s `'syncs the URL when a location typed filter is cleared from the filter panel'` and `'clears typed filter URL params and q when clearing all active filters'`.

Write these **six** cases (Task 6 Step 2 checks for six passing):

```
1. derives timeline options from the filters — orderBy CreatedAt, no withSharedSpaces
2. seeds filter state from the URL on load (deep link, e.g. ?rating=5)
3. writes filter changes to the URL via goto  ← the case that would have caught the Task 1 no-op
4. clearing all filters removes the filter params from the URL
5. registers its filters with globalSearchManager (registerSearchablePageFilters called)
6. passes the nine sections to the filter panel, and no 'text' section
```

- [ ] **Step 1: Write the spec**

Create the file following the template above. Set `mockPage.url` to `new URL('https://gallery.test/recently-added')` and `mockPage.route.id` to `'/(user)/recently-added/[[photos=photos]]/[[assetId=id]]'`.

- [ ] **Step 2: Run to verify RED**

```bash
cd web && pnpm test -- --run "src/routes/(user)/recently-added/[[photos=photos]]/[[assetId=id]]/recently-added-page.spec.ts"
```

Expected: **FAIL** — the route renders no filter panel, so the stub receives nothing and no `goto` is called. Confirm the failures are assertion failures about missing filter wiring, **not** mock/setup errors (an unresolved stub import or a missing manager mock means your harness is wrong, not the route). Paste the output.

- [ ] **Step 3: Commit the red spec**

```bash
git add "web/src/routes/(user)/recently-added/[[photos=photos]]/[[assetId=id]]/recently-added-page.spec.ts"
git commit -m "test(web): route-level spec for Recently Added filters (#805)"
```

---

## Task 5: BDD acceptance scenarios (red-first)

**Files:**

- Modify: `e2e/src/specs/web/recently-added-filters.e2e-spec.ts`

**Interfaces:**

- Consumes: filter-panel testids already exercised by `e2e/src/specs/web/photos-filter-panel.e2e-spec.ts` — `discovery-panel`, `filter-toggle-btn`, `collapse-panel-btn`, `filter-section-<name>` (the template is `data-testid="filter-section-{testId}"` in `filter-section.svelte:25`, fed `testId={section}` from `filter-panel.svelte:754`, so every section emits one), `media-type-image` / `media-type-video`, `rating-star-5`, `active-filters-bar`, `active-chip`, `clear-all-btn`. The header count is `page-header-description`.
- Produces: the scenarios Task 6 turns green. Slice 3 appends search scenarios to the same file.

**Structure:** keep Slice 1's `test.describe('Recently Added', …)` exactly as-is and add a **sibling** `test.describe('Recently Added filters', …)` with its own `beforeAll`. The `web` Playwright project is `fullyParallel: false` with `workers: 1`, and Playwright runs `beforeAll` lazily per describe, so a second resetting `beforeAll` is safe.

**Video seeding — verified, use this.** `utils.createAsset(accessToken, dto?)` accepts `assetData?: { bytes?: Buffer; filename: string }`, and the server derives asset type from the **filename extension** (`mimeTypes.assetType(file.originalPath)`), so no real video fixture is needed. Existing precedent — `e2e/src/specs/server/api/shared-space-album-timeline.e2e-spec.ts:561`:

```ts
const videoAsset = await utils.createAsset(owner.accessToken, { assetData: { filename: 'example.mp4' } });
```

**URL parameters — verified** against `SEARCHABLE_PAGE_FILTER_PARAMS` (`web/src/lib/utils/searchable-page-search.ts:5-21`): rating is `rating`, camera make is `make`, and media type is **`type`** (e.g. `type=video`) — _not_ `mediaType`.

- [ ] **Step 1: Write the scenarios**

Extend the file's imports (Slice 1's version has none of these):

```ts
import { updateAsset } from '@immich/sdk';
import { thumbnailUtils } from 'src/ui/specs/timeline/utils';
import { asBearerAuth, utils } from 'src/utils';
```

(`thumbnailUtils` import path matches `e2e/src/specs/web/timeline-grouping.e2e-spec.ts:3`.)

Append:

```ts
test.describe('Recently Added filters', () => {
  let admin: LoginResponseDto;
  const videos: Awaited<ReturnType<typeof utils.createAsset>>[] = [];

  const TOTAL = 20;
  const VIDEOS = 5;
  const RATED = 3;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();

    // Seed with *taken* dates deliberately unrelated to upload order, so "ordered by added date"
    // is a meaningful assertion: taken dates run backwards while added order runs forwards.
    const images = [];
    for (let i = 0; i < TOTAL - VIDEOS; i++) {
      const day = String(TOTAL - VIDEOS - i).padStart(2, '0');
      images.push(
        await utils.createAsset(admin.accessToken, {
          fileCreatedAt: `2023-09-${day}T10:00:00.000Z`,
          fileModifiedAt: `2023-09-${day}T10:00:00.000Z`,
        }),
      );
    }

    // Videos' taken dates run *opposite* to their upload order, so within the video-filtered set
    // "newest added first" and "newest taken first" disagree. That disagreement is the whole point
    // of the ordering scenario below — seeding them ascending would make the test pass equally
    // against orderBy: TakenAt, i.e. unable to detect the bug it exists to catch.
    for (let i = 0; i < VIDEOS; i++) {
      videos.push(
        await utils.createAsset(admin.accessToken, {
          fileCreatedAt: `2023-10-0${VIDEOS - i}T10:00:00.000Z`,
          fileModifiedAt: `2023-10-0${VIDEOS - i}T10:00:00.000Z`,
          assetData: { filename: `example-${i}.mp4` },
        }),
      );
    }

    for (const asset of images.slice(0, RATED)) {
      await updateAsset({ id: asset.id, updateAssetDto: { rating: 5 } }, { headers: asBearerAuth(admin.accessToken) });
    }
  });

  async function gotoRecentlyAdded(
    context: import('@playwright/test').BrowserContext,
    page: import('@playwright/test').Page,
    search = '',
  ) {
    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/recently-added');
    // Panel collapse is persisted in localStorage — start every test from a clean state.
    await page.evaluate(() => localStorage.clear());
    await page.goto(`/recently-added${search}`);
    await page.waitForSelector('[data-testid="discovery-panel"], [data-testid="filter-toggle-btn"]');
  }

  test('renders the nine metadata filter sections and no text section', async ({ context, page }) => {
    await gotoRecentlyAdded(context, page);

    await expect(page.getByTestId('discovery-panel')).toBeVisible();
    for (const section of [
      'timeline',
      'people',
      'location',
      'camera',
      'tags',
      'rating',
      'media',
      'favorites',
      'albums',
    ]) {
      await expect(page.getByTestId(`filter-section-${section}`)).toBeVisible();
    }
    // Slice 3 adds this; it must not exist yet.
    await expect(page.getByTestId('filter-section-text')).toHaveCount(0);
  });

  // Spec scenario: Filtering by media type updates grid, URL, and count
  test('filtering by media type updates the count and the URL', async ({ context, page }) => {
    await gotoRecentlyAdded(context, page);
    await expect(page.getByTestId('page-header-description')).toHaveText(`${TOTAL} items`);

    const bucketResponse = page.waitForResponse((r) => r.url().includes('/timeline/buckets'));
    await page.getByTestId('media-type-video').click();
    await bucketResponse;

    await expect(page.getByTestId('page-header-description')).toHaveText(`${VIDEOS} items`);
    await expect(page).toHaveURL(/type=video/);
  });

  // Spec scenario: Removing a filter chip restores the full view
  test('removing the media-type chip restores the full view', async ({ context, page }) => {
    await gotoRecentlyAdded(context, page);

    const filtered = page.waitForResponse((r) => r.url().includes('/timeline/buckets'));
    await page.getByTestId('media-type-video').click();
    await filtered;
    await expect(page.getByTestId('page-header-description')).toHaveText(`${VIDEOS} items`);

    // Collapse the panel so the ActiveFiltersBar and its chips are shown.
    await page.getByTestId('collapse-panel-btn').click();
    await expect(page.getByTestId('active-filters-bar')).toBeVisible();
    const chip = page.getByTestId('active-chip').first();
    await expect(chip).toBeVisible();

    const restored = page.waitForResponse((r) => r.url().includes('/timeline/buckets'));
    // Remove the chip itself (exercises handleRemoveActiveFilter), not "clear all".
    // dispatchEvent avoids the UserPageLayout absolute header overlaying the control,
    // the same workaround photos-filter-panel.e2e-spec.ts uses.
    await chip.getByRole('button').last().dispatchEvent('click');
    await restored;

    await expect(page.getByTestId('page-header-description')).toHaveText(`${TOTAL} items`);
    await expect(page).not.toHaveURL(/type=video/);
  });

  test('clear all removes every active filter', async ({ context, page }) => {
    await gotoRecentlyAdded(context, page, '?rating=5');
    await expect(page.getByTestId('page-header-description')).toHaveText(`${RATED} items`);

    await page.getByTestId('collapse-panel-btn').click();
    await expect(page.getByTestId('active-filters-bar')).toBeVisible();

    const cleared = page.waitForResponse((r) => r.url().includes('/timeline/buckets'));
    await page.getByTestId('clear-all-btn').dispatchEvent('click');
    await cleared;

    await expect(page.getByTestId('page-header-description')).toHaveText(`${TOTAL} items`);
  });

  // Spec scenario: A filter matching nothing shows a zero count, not an empty account
  test('a filter that matches nothing shows "0 items" and keeps the panel open', async ({ context, page }) => {
    await gotoRecentlyAdded(context, page, '?make=NoSuchCameraMake');

    await expect(page.getByTestId('page-header-description')).toHaveText('0 items');
    // The panel must stay mounted so the user can change the filter.
    await expect(page.getByTestId('discovery-panel')).toBeVisible();
  });

  // Spec scenario: Filters survive a reload (URL is source of truth)
  test('filters survive a reload', async ({ context, page }) => {
    await gotoRecentlyAdded(context, page, '?rating=5');
    await expect(page.getByTestId('page-header-description')).toHaveText(`${RATED} items`);

    await page.reload();
    await expect(page.getByTestId('page-header-description')).toHaveText(`${RATED} items`);
    await expect(page).toHaveURL(/rating=5/);
  });

  // Spec scenario: Recently Added stays ordered by added date under a filter
  test('stays ordered by added date under a filter', async ({ context, page }) => {
    // Within the video-filtered set, added order and taken order run opposite (see the seeding),
    // so this scenario can tell the two ordering bases apart. Applying a filter must not change
    // the basis: the grid stays ordered by *added* date, newest first.
    await gotoRecentlyAdded(context, page);

    const filtered = page.waitForResponse((r) => r.url().includes('/timeline/buckets'));
    await page.getByTestId('media-type-video').click();
    await filtered;
    await expect(page.getByTestId('page-header-description')).toHaveText(`${VIDEOS} items`);

    // The LAST-UPLOADED video must lead the grid. Its taken date is the *oldest* of the five, so
    // this assertion fails if the view ever orders by taken date instead of added date.
    const first = thumbnailUtils.locator(page).first();
    await expect(first).toBeVisible();
    await expect(first).toHaveAttribute('data-asset', videos.at(-1)!.id);
  });
});
```

Note the final assertion must be the exact-id form above. A looser `toHaveAttribute('data-asset', /.+/)` is tautological — `thumbnailUtils.locator` selects `[data-thumbnail-focus-container]`, which always carries `data-asset` — and would leave BDD 5 covered in name only.

- [ ] **Step 2: Run to verify RED**

Run the spec with `--retries=0` (see the command reference). Expected: the 3 Slice-1 scenarios still **pass**; the 7 new ones **fail** because the route renders no filter panel — `gotoRecentlyAdded`'s `waitForSelector` times out. That timeout is the expected red signal.

Confirm the failure reason is the missing panel, not a seeding error, import error, or auth failure. Paste the output.

- [ ] **Step 3: Commit the red spec**

```bash
git add e2e/src/specs/web/recently-added-filters.e2e-spec.ts
git commit -m "test(e2e): acceptance scenarios for Recently Added browse filters (#805)"
```

---

## Task 6: Wire the filter panel into the route (turns Tasks 4 and 5 green)

**Files:**

- Modify: `web/src/routes/(user)/recently-added/[[photos=photos]]/[[assetId=id]]/+page.svelte`

**Interfaces:**

- Consumes: `buildRecentlyAddedTimelineOptions` (Task 2), `buildRecentlyAddedFilterConfig` (Task 3), `shouldShowRecentlyAddedCount` (Slice 1), and the URL registration from Task 1.
- Produces: the rendered filter UI asserted by Tasks 4 and 5.

**The template is the Photos page** — `web/src/routes/(user)/photos/[[assetId=id]]/+page.svelte`. Copy its structure, then delete every search-related part. Do not modify the Photos page itself.

**Take from Photos (line refs):**

- filter state seeding (`:105-124`), `filtersBeforePanelChange` + its `$effect` (`:116-140`)
- `timelineGrouping` / `temporalAnchor` (`:125-126`), `pendingFilterUrlSync` (`:129-131`)
- `personNames` / `tagNames` `SvelteMap`s + `consumeTypedSearchNamesInto` (`:141-143`)
- `globalSearchManager.registerSearchablePageFilters` effect (`:144`)
- `filterCollapsed` (`:349`), `isTimelineEmpty` (`:373`) — copy its explanatory comment too
- `syncFilterUrl` (`:438-456`), `handleFiltersChange` (`:458-470`), `handleTimelineBucketActivate` (`:472-484`), `handleTimelineGroupingChange` (`:486-490`), `handleRemoveActiveFilter` (`:492-499`), `handleClearAllFilters` (`:501-508`), the URL→filters `$effect` (`:510-543`)
- the layout shell (`:556-641`): `<div class="flex h-full">` → `<FilterPanel>` → `<div class="flex flex-1 flex-col overflow-hidden pl-4">` → filters-bar snippet → `<FilterToolbar>` → `<Timeline>`

**OMIT (all Slice 3 territory):**

- `committedQuery`, `showSearchResults`, `isLoading`, `clearSearch`, and the query parts of `lastHandledSearchState`
- `smartFacets`, `smartFacetKey`, `smartFacetInFlight`, `loadPhotoSmartFacets`, `smartFacetBuckets`, `smartFacetTotal`, and the `buildSmartSearchFacetKey` / `buildSmartSearchFacetsParams` / `mapSmartSearchFacetsToFilterSuggestions` imports
- `<SmartSearchResults>` and the `{#if showSearchResults}` branch — render `<Timeline>` unconditionally
- the `{#key}` wrapper around `<FilterPanel>` (it exists only to remount on query/lang change)
- `handleAddAllToCollection`, `SearchAddAllToCollectionModal`, `filterStateToSearchTerms`, and the `resultCount` / `onAddAllToCollection` props on `<ActiveFiltersBar>`
- the memories `ImageCarousel`, and `registerSelectionContext` (not in this route today — do not add it)

**Concrete adaptations:**

- `const options = $derived({ ...buildRecentlyAddedTimelineOptions(filters), grouping: timelineGrouping });` — this **replaces** the static `const options = {...}`. That is the one sanctioned change to it.
- `const filterConfig = withNameCapture(buildRecentlyAddedFilterConfig(), personNames, tagNames);` — `withNameCapture(config: FilterPanelConfig, personNames: Map<string, string>, tagNames: Map<string, string>): FilterPanelConfig` from `$lib/utils/filter-name-capture` (verified signature; real call site: `spaces/[spaceId]/albums/[albumId=id]/…/+page.svelte:110`). This is what lets chips render person/tag names.
- `syncFilterUrl` passes a literal empty query — there is no search this slice. **You must keep an equivalent of Photos' `relevance` fallback**, or every filter URL gains a spurious `sort=desc`:

  ```ts
  function syncFilterUrl(nextFilters: FilterState) {
    const currentSearchState = getSearchablePageState(page.url);
    // `buildSearchablePageUrl` writes an explicit `sort=` param whenever it is handed a literal
    // 'asc' | 'desc'; only 'relevance' clears it. `createFilterState()` defaults sortOrder to
    // 'desc', so passing it straight through would stamp `sort=desc` onto every filter URL the
    // user never asked for. Convert the *implicit* default to 'relevance' (= "no explicit sort")
    // and pass through anything the user actually chose. Photos does the same thing; its extra
    // `!committedQuery.trim()` condition is query-mode-only and drops out here.
    const sortOrder =
      nextFilters.sortOrder === 'desc' && !currentSearchState.hasExplicitSort ? 'relevance' : nextFilters.sortOrder;
    const nextUrl = buildSearchablePageUrl(page.url, '', sortOrder, nextFilters);
    …
  }
  ```

  Expected URL shapes, which Task 4's route spec asserts exactly: applying a country filter gives `/recently-added?country=Germany` (no `sort`), and clearing all filters gives bare `/recently-added`. If you see `sort=desc` in either, this conversion is missing.

- `<FilterPanel … storageKey="gallery-filter-visible-sections-recently-added" timeBuckets={timelineBuckets} hidden={isTimelineEmpty} />` — view-specific storage key.
- `<ActiveFiltersBar embedded {filters} {personNames} {tagNames} onRemoveFilter={handleRemoveActiveFilter} onClearAll={handleClearAllFilters} />` — **no** `resultCount`, **no** `onAddAllToCollection`, **no** `searchQuery` / `onClearSearch`.
- `<FilterToolbar … showGrouping={!assetMultiSelectManager.selectionActive} showFilters={hasActiveFilters} filters={recentlyAddedFiltersBar} showFilterButton={filterCollapsed && !isTimelineEmpty && !assetMultiSelectManager.selectionActive} filterActive={getActiveFilterCount(filters) > 0} onExpandFilters={() => (filterCollapsed = false)} />` — drops Photos' `!showSearchResults`.
- `const hasActiveFilters = $derived(getActiveFilterCount(filters) > 0);` — no `|| showSearchResults`.
- Count now reflects filters: `shouldShowRecentlyAddedCount(assetCount, hasActiveFilters)`. **Replace the Slice-1 literal `false`** and delete the now-stale comment above it that predicted this change.
- `const timelineBuckets = $derived(getTimelineManagerTimeBuckets(timelineManager));` from `$lib/utils/timeline-zoom-navigation` (takes `TemporalBucketSource | undefined`).
- Keep `<Timeline>`'s existing props and add, mirroring Photos: `onTimelineBucketActivate`, `{temporalAnchor}`, `onTemporalAnchorResolved`, `grouping={timelineGrouping}`, `onGroupingChange`.
- **Keep the existing `{#snippet empty()}` / `EmptyPlaceholder` block** — Slice 1's e2e asserts its copy.
- The `AssetSelectControlBar` block stays **byte-identical**.

- [ ] **Step 1: Implement the route**

Work with the Photos file open beside you; copy its handler code exactly rather than paraphrasing, so behavior matches.

- [ ] **Step 2: Turn the route-level spec GREEN**

```bash
cd web && pnpm test -- --run "src/routes/(user)/recently-added/[[photos=photos]]/[[assetId=id]]/recently-added-page.spec.ts"
```

Expected: **PASS** — all six cases from Task 4. This is your fast feedback loop — get it green before touching Playwright. Paste the output.

- [ ] **Step 3: Type-check and lint**

```bash
cd web && pnpm check:typescript && pnpm lint
```

Fix errors before running e2e. (`check:svelte` reports 0 files locally — a known no-op; CI is authoritative. Run it anyway.)

- [ ] **Step 4: Turn the e2e spec GREEN**

Run the spec (rebuild the e2e stack image first if you use `:2285`).
Expected: **10 passed** — 3 from Slice 1 plus the 7 from Task 5. Paste the output.

If a scenario fails, fix the **route**, not the test — unless the test encodes a genuinely wrong expectation about the shared filter-panel components, in which case explain the discrepancy in your report before changing it.

- [ ] **Step 5: Full slice gate**

```bash
cd web && pnpm check:typescript && pnpm check:svelte && pnpm lint && pnpm test -- --run
cd web && pnpm exec prettier --check \
  "src/routes/(user)/recently-added/[[photos=photos]]/[[assetId=id]]/+page.svelte" \
  "src/routes/(user)/recently-added/[[photos=photos]]/[[assetId=id]]/recently-added-page.spec.ts" \
  src/lib/utils/recently-added-filter-options.ts \
  src/lib/utils/recently-added-filter-config.ts \
  src/lib/utils/searchable-page-search.ts \
  src/lib/utils/__tests__/recently-added-filter-options.spec.ts \
  src/lib/utils/__tests__/recently-added-filter-config.spec.ts \
  src/lib/utils/__tests__/searchable-page-search.spec.ts
cd ../e2e && pnpm exec prettier --check src/specs/web/recently-added-filters.e2e-spec.ts
```

- [ ] **Step 6: Commit**

```bash
git add "web/src/routes/(user)/recently-added/[[photos=photos]]/[[assetId=id]]/+page.svelte"
git commit -m "feat(web): browse filters for Recently Added (#805)"
```

---

## Slice 2 Done Gate

- [ ] `cd web && pnpm check:typescript` — clean
- [ ] `cd web && pnpm check:svelte` — clean
- [ ] `cd web && pnpm lint` — no **errors**, and no **new** warnings
- [ ] `cd web && pnpm test -- --run` — all pass, including the new searchable-page, options, config, and route-level cases
- [ ] E2E `recently-added-filters.e2e-spec.ts` — **10 passed**
- [ ] Prettier `--check` clean on all touched files
- [ ] Red→green evidence recorded for Tasks 1, 2, 3 (unit), 4→6 (route spec), 5→6 (e2e)
- [ ] Photos page, `filter-panel/`, `Timeline`, `UserPageLayout` unmodified — `git diff --stat main...HEAD`
- [ ] Photos/Spaces search behaviour unchanged — the pre-existing `searchable-page-search.spec.ts` cases still pass untouched
- [ ] `AssetSelectControlBar` block and the `{#snippet empty()}` block byte-identical — `git diff` on the route
- [ ] **No search leakage:** `grep -rn "committedQuery\|SmartSearchResults\|searchSmartFacets\|smartFacet" "web/src/routes/(user)/recently-added/" web/src/lib/utils/recently-added-filter-*.ts` returns nothing
- [ ] **`isSearchable` still false for this route:** the Task 1 unit case asserts it; confirm no code sets it otherwise
- [ ] **No shared-space leakage:** `grep -rn "withSharedSpaces" web/src/lib/utils/recently-added-filter-*.ts` returns only the destructured-and-discarded `_` in the options builder
- [ ] Six commits made as specified

## Coverage check against the spec

| Spec item (§Slice 2)                                                                    | Covered by                                                                                                                             |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| URL persistence works at all (spec §3.1.1 prerequisite)                                 | Task 1 units; Task 4 route-spec URL-sync case; Task 5 e2e reload/deep-link                                                             |
| Filter matches zero assets → panel stays open, "0 items"                                | Task 5 e2e "matches nothing"; Slice 1 unit `shouldShowRecentlyAddedCount(0, true)`                                                     |
| `withSharedSpaces` leakage in any path                                                  | Task 2 options `toEqual` + `not.toHaveProperty` ×2 + suggestion-request unit; Task 3 config unit (all 3 request types); Done-Gate grep |
| Future stray key from `buildPhotosTimelineOptions`                                      | Task 2 default-case `toEqual` (exact shape)                                                                                            |
| Favorites filter → own-only                                                             | Task 2 "drops partner assets under a favorites filter"                                                                                 |
| Any filter combination keeps `orderBy: CreatedAt`                                       | Task 2 "keeps orderBy CreatedAt under every filter combination" + multi-filter case; Task 5 e2e "stays ordered by added date"          |
| Sort asc/desc flips `order`, not `orderBy`                                              | Task 2 "maps sortOrder to order without touching orderBy"                                                                              |
| All predicate passthroughs + date ranges (year, year+month, custom, from-only, to-only) | Task 2 predicate / mediaType / text-trim / album-flag / date cases                                                                     |
| Suggestion request omits shared/album/space scope                                       | Task 2 "never scopes to shared spaces, albums, or spaces"                                                                              |
| Config = 9 sections, correct suggestion/provider calls                                  | Task 3, all 7 cases                                                                                                                    |
| BDD 1: media type updates grid, URL, count                                              | Task 5 "filtering by media type…"                                                                                                      |
| BDD 2: removing a chip restores the full view                                           | Task 5 "removing the media-type chip…" (chip control, not clear-all) + "clear all removes every active filter"                         |
| BDD 3: filter matching nothing → 0 items                                                | Task 5 "matches nothing"                                                                                                               |
| BDD 4: filters survive a reload                                                         | Task 5 "filters survive a reload"                                                                                                      |
| BDD 5: stays ordered by added date under a filter                                       | Task 5 "stays ordered by added date under a filter"                                                                                    |
| Count flicker on apply                                                                  | Accepted + documented (spec §5.5); e2e asserts the settled count via auto-retrying assertions                                          |
| Grouping day↔month                                                                      | Copied `handleTimelineGroupingChange` / `FilterToolbar` wiring; manual smoke                                                           |
| Suggestion fetch failure                                                                | `FilterPanel`'s own AbortController path — no new handling, matching `album-filter-config.ts`                                          |
