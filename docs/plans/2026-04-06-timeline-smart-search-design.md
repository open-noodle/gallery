# Design: Smart Search on the Main Timeline (/photos)

**Date:** 2026-04-06
**Scope:** Bring the spaces unified-search experience to the main `/photos` timeline. Adds smart search with sort dropdown, date grouping, asset viewer overlay, and FilterPanel composition. Top global searchbar and `/search` route are explicitly out of scope.

---

## Problem

Today, `/photos` supports filters (people, location, tags, rating, etc.) but has no smart search. Users who want to find "beach photos from last summer" must use the global top searchbar, which navigates to `/search` — a separate `GalleryViewer` route with no sort dropdown, no date grouping, no FilterPanel composition. The good search experience built for spaces in PR #254 (sort by relevance/newest/oldest, two-phase CTE, infinite scroll) is unreachable from the main timeline.

## Solution

Replicate the spaces unified-search UX on `/photos`: a search input in the page header that transforms the timeline in place, with the sort dropdown, date grouping, and asset viewer overlay all coming along. Extract the spaces fetch/state machinery into a reusable `<SmartSearchResults>` wrapper so both pages share one source of truth. Backend gains a `withSharedSpaces` flag on `SmartSearchDto` so `/photos` search reaches into spaces the user has pinned to their timeline.

---

## Decisions

| Decision                                        | Choice                                                                                                                     | Why                                                                                                    |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Search bar placement                            | Page header (`UserPageLayout` `buttons` slot), mirroring spaces                                                            | Spaces parity; the FilterPanel placement was reviewed and rejected for discoverability and mobile cost |
| Code reuse                                      | Extract & generalize — new `<SmartSearchResults>` wrapper that owns fetch state, renders the existing dumb grid underneath | One source of truth, fixes apply to both pages                                                         |
| URL state                                       | `/photos?q=<query>` with `pushState` on submit, `replaceState` on clear                                                    | Shareable links, browser back exits search                                                             |
| Default sort on submit                          | Relevance                                                                                                                  | Matches spaces                                                                                         |
| Top global searchbar                            | Untouched, deferred                                                                                                        | Out of scope; still navigates to `/search`                                                             |
| `/search` route                                 | Untouched                                                                                                                  | Top bar still depends on it                                                                            |
| Mobile (`<640px`)                               | Hidden under `sm:block`                                                                                                    | Spaces parity; documented regression                                                                   |
| SortToggle for non-search browsing              | Not added on `/photos`                                                                                                     | Avoid scope creep; `/photos` keeps its current sort behavior                                           |
| Timeline-pinned space content in search         | Yes — new `withSharedSpaces` flag on `SmartSearchDto`                                                                      | Search must match what the user sees in the unfiltered timeline                                        |
| `/photos` filter trampling on search enter/exit | Match spaces — force `relevance` on submit, `desc` on clear                                                                | Spaces parity                                                                                          |

---

## Backend

No new endpoints. The existing `POST /search/smart` from PR #254 already supports relevance/asc/desc via the two-phase CTE. We add one optional flag.

### 1. DTO — Add `withSharedSpaces` to `SmartSearchDto`

**File:** `server/src/dtos/search.dto.ts`

Add `withSharedSpaces?: boolean` to `SmartSearchDto`, mirroring the same flag already used by `getFilterSuggestions` for tags/location/camera (see PR #231).

```typescript
@ValidateBoolean({ optional: true })
withSharedSpaces?: boolean;
```

### 2. Service — `searchSmart` honors the flag

**File:** `server/src/services/search.service.ts` (lines 121–175)

When `withSharedSpaces === true` and no `spaceId` is passed, resolve `timelineSpaceIds` from the user's space membership (the same path the timeline uses) and pass them to the repository. When `false` or absent: existing owner-only behavior.

### 3. Repository — extend `searchAssetBuilder` for smart search

**File:** `server/src/repositories/search.repository.ts` (lines 352–390)

The two-phase CTE already wraps `searchAssetBuilder`. Wire `timelineSpaceIds` through the same way it's already wired for `searchLargeAssets` / `searchRandom` / `searchExifField` (existing pattern at lines 592, 619, 698, 748). The vector ranking and sort phases are unchanged.

### 4. Code generation

After the DTO change:

```bash
cd server && pnpm build
pnpm sync:open-api
make open-api          # regenerates Dart + TypeScript clients
make sql               # regenerates SQL query files (requires DB)
```

---

## Frontend

### 1. Refactor `buildSmartSearchParams`

**File:** `web/src/lib/utils/space-search.ts` → rename to `web/src/lib/utils/smart-search.ts`

**Old signature:**

```typescript
buildSmartSearchParams(query: string, spaceId: string, filters: FilterState): SmartSearchDto
```

**New signature:**

```typescript
buildSmartSearchParams(args: {
  query: string;
  filters: FilterState;
  spaceId?: string;
  withSharedSpaces?: boolean;
}): SmartSearchDto
```

Behavior:

- When `spaceId` provided: maps `filters.personIds` → `spacePersonIds` (existing behavior). `withSharedSpaces` is ignored.
- When `spaceId` absent: passes `filters.personIds` through directly as `personIds`. Sets `withSharedSpaces` from the arg.
- All other field mappings (`takenAfter`/`takenBefore` from `selectedYear`/`selectedMonth`, `isFavorite`, `order`, `mediaType` → `type`) preserved.

Update call sites:

- `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.svelte:599`
- New call site in `<SmartSearchResults>` (below)

Rename the co-located test file `space-search.spec.ts` → `smart-search.spec.ts` and add cases for the no-`spaceId` path with and without `withSharedSpaces`.

### 2. New: `<SmartSearchResults>` wrapper component

**File:** `web/src/lib/components/search/smart-search-results.svelte` (new)

Owns all the fetch/state machinery currently inlined in `spaces/.../+page.svelte:578-673`:

- Internal state: `results`, `isLoading`, `hasMore`, `totalLoaded`, `abortController`
- `executeSearch()` — calls `searchSmart(buildSmartSearchParams({ query, filters, spaceId, withSharedSpaces }))`, manages abort controller, handles errors
- `handleLoadMore()` — pagination
- Debounced `$effect` on `filters` — re-runs `executeSearch` when filters change while a search is active (mirror spaces' debounce window)
- Renders the existing `space-search-results.svelte` underneath, passing through `results`, `isLoading`, `hasMore`, `totalLoaded`, `onLoadMore`, `spaceId`, `sortMode`
- Plumbs `isShared` through to the asset viewer (true for spaces, false for `/photos`)

Props:

```typescript
{
  searchQuery: string;
  filters: FilterState;
  spaceId?: string;
  withSharedSpaces?: boolean;
  isShared: boolean;
}
```

### 3. Update spaces page to use the wrapper

**File:** `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.svelte`

Replace the inline `executeSearch`/`handleLoadMore`/abort controller logic (lines 578–673) with `<SmartSearchResults searchQuery={searchQuery} filters={filters} spaceId={space.id} isShared={true} />`. Spaces behavior must remain identical — verified by manual side-by-side QA.

### 4. `/photos` page changes

**File:** `web/src/routes/(user)/photos/[[assetId=id]]/+page.svelte`

#### a. New page state

```typescript
let searchQuery = $state('');
let showSearchResults = $derived(searchQuery.trim().length > 0);
```

Seed `searchQuery` from `$page.url.searchParams.get('q') ?? ''` on mount.

#### b. Add `{#snippet buttons()}` to `UserPageLayout`

```svelte
{#snippet buttons()}
  <SearchBar
    {searchQuery}
    onSearch={handleSearchSubmit}
    class="hidden h-10 sm:block sm:w-40 xl:w-60"
  />
  {#if showSearchResults}
    <SearchSortDropdown bind:sortMode={filters.sortOrder} />
  {/if}
{/snippet}
```

The `hidden h-10 sm:block` classes mirror spaces and accept the documented mobile regression.

#### c. Conditional render — keep Timeline mounted

```svelte
<Timeline class:hidden={showSearchResults} {...timelineProps} />
{#if showSearchResults}
  <SmartSearchResults
    {searchQuery}
    {filters}
    isShared={false}
    withSharedSpaces={true}
  />
{/if}
```

**Critical:** Timeline is hidden via CSS, not unmounted. This preserves `TimelineManager` state and scroll position, and avoids an expensive bucket refetch when the user clears the search.

#### d. Update `hasActiveFilters` derivation

```typescript
let hasActiveFilters = $derived(getActiveFilterCount(filters) > 0 || searchQuery.trim().length > 0);
```

Otherwise `<ActiveFiltersBar>` won't render when only a search is active.

#### e. Hide `ImageCarousel` memories during search

Change the existing guard from `!hasActiveFilters` to `!hasActiveFilters && !showSearchResults`.

#### f. Wire `<ActiveFiltersBar>` props

The component already accepts `searchQuery` and `onClearSearch` (see `web/src/lib/components/filter-panel/active-filters-bar.svelte:13,24`). Pass them from `/photos` — they're currently not provided.

#### g. Submit and clear handlers

```typescript
function handleSearchSubmit(query: string) {
  if (!query.trim()) return; // empty submit is no-op (matches spaces)
  searchQuery = query;
  filters.sortOrder = 'relevance';
  const url = new URL('/photos', window.location.origin);
  url.searchParams.set('q', query);
  goto(url.pathname + url.search, { pushState: true });
}

function clearSearch() {
  searchQuery = '';
  filters.sortOrder = 'desc';
  goto('/photos', { replaceState: true });
}
```

`pushState` on submit means browser back exits the search. `replaceState` on clear avoids polluting history with empty states.

#### h. URL state reactivity

A `$effect` watches `$page.url.searchParams.get('q')` and updates `searchQuery` accordingly. This handles browser back/forward correctly without an explicit handler.

---

## Data flow

**Search submit (Enter in `<SearchBar>`):**

1. `handleSearchSubmit(query)` → `searchQuery = query`, `filters.sortOrder = 'relevance'`
2. `goto('/photos?q=<encoded>', { pushState: true })`
3. `<SmartSearchResults>` mounts, `<Timeline>` becomes `hidden`
4. Wrapper calls `searchSmart(buildSmartSearchParams({ query, filters, withSharedSpaces: true }))`
5. Results returned → wrapper passes to `space-search-results.svelte` → grid renders flat (relevance) or month-grouped (asc/desc)
6. Infinite scroll triggers `handleLoadMore` for pagination
7. Asset click → AssetViewer overlay with `isShared={false}` → owner actions enabled

**Filter change while searching:**

1. FilterPanel updates `filters.{personIds|tagIds|city|country|...}`
2. Wrapper's debounced `$effect` re-runs `executeSearch` with new params
3. Old request aborted, new results replace old ones

**Sort change (`<SearchSortDropdown>`):**

1. `filters.sortOrder` updates (`'relevance'` / `'asc'` / `'desc'`)
2. Wrapper re-fetches with `order: AssetOrder.Asc` / `AssetOrder.Desc` (or omitted for relevance)
3. Grid switches between flat and month-grouped layout

**Clear search:**

1. `clearSearch()` → `searchQuery = ''`, `filters.sortOrder = 'desc'`
2. `goto('/photos', { replaceState: true })`
3. `<SmartSearchResults>` unmounts; `<Timeline>` un-hides
4. No refetch — `TimelineManager` state and scroll position preserved

**Browser back from a search:**

1. URL `?q=` removed by browser navigation
2. `$page.url.searchParams.get('q')` reactively updates to `null`
3. `$effect` updates `searchQuery = ''`, same outcome as `clearSearch` (without re-writing the URL)

---

## Edge cases

| #   | Case                                            | Handling                                                                                                                                               |
| --- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Page loads with `?q=foo` in URL                 | `searchQuery` seeded from URL on mount; `<SmartSearchResults>` mounts immediately; `<Timeline>` mounts hidden in background, no flicker                |
| 2   | Empty query submitted via Enter                 | No-op (matches spaces). Clear via the explicit X on the search input or the chip in `ActiveFiltersBar`.                                                |
| 3   | Search with no results                          | Empty state from existing dumb grid component                                                                                                          |
| 4   | Search + active filters                         | Filters compose with the smart search request via `buildSmartSearchParams`                                                                             |
| 5   | Network error during search                     | Error state from existing dumb grid (mirrors spaces)                                                                                                   |
| 6   | Special characters in query (`&`, `?`, emoji)   | Encoded via `URLSearchParams`                                                                                                                          |
| 7   | Asset multi-selection during search             | Disabled — spaces parity. Revisit as a follow-up if users ask.                                                                                         |
| 8   | User has timeline-pinned space + searches       | `withSharedSpaces=true` flag ensures search reaches into those spaces                                                                                  |
| 9   | Mobile (`<640px`)                               | Search bar hidden via `sm:block`. Top global searchbar still works (navigates to `/search`). Documented regression.                                    |
| 10  | Asset viewer prev/next at edges                 | Inherits behavior from the existing asset viewer used by spaces — no new logic                                                                         |
| 11  | Closing asset viewer preserves `?q=`            | The existing `navigate({ targetRoute: 'current', assetId: null })` updates the assetId segment without touching query params; verify in implementation |
| 12  | TimelineManager refetch on back-from-search     | Avoided by hiding via CSS, not unmounting                                                                                                              |
| 13  | FilterPanel collapse state                      | Independent of search — search works regardless                                                                                                        |
| 14  | User clicks `ActiveFiltersBar` "search:" chip X | Calls `clearSearch` (existing prop on `ActiveFiltersBar`)                                                                                              |

---

## Testing strategy

### Unit (vitest) — backend

- `search.service.spec.ts`: `searchSmart` resolves `timelineSpaceIds` when `withSharedSpaces=true` and no `spaceId`, doesn't resolve them when flag is false
- `search.repository.spec.ts`: smart search with `timelineSpaceIds` returns assets from those spaces
- DTO validation tests for `withSharedSpaces`

### Unit (vitest) — frontend

- `smart-search.spec.ts` (renamed from `space-search.spec.ts`): `buildSmartSearchParams` correctly maps with `spaceId`, without `spaceId`, with `withSharedSpaces`, and properly translates `personIds` vs `spacePersonIds`
- `smart-search-results.spec.ts`: wrapper component fetch lifecycle (mount → search → load more → filter change → unmount → abort), error and empty states

### E2E (Playwright, real-server, in `e2e/src/web/specs/`)

Per `feedback_e2e_mock_filterpanel.md`, FilterPanel-adjacent E2E must use real-server tests.

- `/photos` smart search flow: submit query → results render → sort dropdown appears → switch to "newest first" → date groups appear → switch back to relevance → flat list → clear search → timeline returns at original scroll position
- URL persistence: navigate to `/photos?q=beach` directly → results render on load
- Browser back: search → back button → returns to unsearched timeline
- Filter composition: search → toggle a person filter → results re-fetch with combined params
- Timeline-pinned space content: with a shared space configured `showInTimeline=true`, search returns assets from that space
- Asset viewer: open an asset from search results → close → search state preserved (`?q=` still present)

### Manual QA

- Side-by-side parity check: `/photos` search and spaces search feel identical for the same query
- Verify the new `buttons` snippet on `/photos` doesn't break the existing `UserPageLayout` header

---

## Out of scope (explicit YAGNI)

- Top global searchbar changes — deferred
- `/search` route changes or deprecation — still used by top bar
- New backend endpoints — existing `/search/smart` is sufficient with the new flag
- Mobile-specific search UI on `/photos` — accepted regression for spaces parity
- `SortToggle` for non-search browsing on `/photos`
- Search history, suggestions, recent queries
- Multi-select / bulk actions on search results
- Per-page search settings (similarity threshold UI on `/photos`)
- Stash-and-restore user sort preference around search — matches spaces' tramping
