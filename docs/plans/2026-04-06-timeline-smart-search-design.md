# Design: Smart Search on the Main Timeline (/photos)

**Date:** 2026-04-06
**Scope:** Bring the spaces unified-search experience to the main `/photos` timeline. Adds smart search with sort dropdown, date grouping, asset viewer overlay, and FilterPanel composition. Top global searchbar and `/search` route are explicitly out of scope.

**Revision history:**

- 2026-04-06 (initial) — first draft after brainstorming.
- 2026-04-06 (revised) — corrected after `/review` pass found that `withSharedSpaces` already exists on `SmartSearchDto`, the dumb grid component needs an explicit `isShared` prop, `searchAssetBuilder` already accepts `timelineSpaceIds`, and several edge cases / tests were missing.
- 2026-04-06 (revised again) — second `/review` pass discovered that spaces _unmounts_ Timeline during search (and uses `enableRouting={false}`); switched `/photos` to the same unmount pattern instead of CSS-hiding to avoid asset-viewer routing conflicts and wasted background bucket refetches. Also tightened the wrapper effect spec, made multi-select handling explicit, and fixed minor inconsistencies.

---

## Problem

Today, `/photos` supports filters (people, location, tags, rating, etc.) but has no smart search. Users who want to find "beach photos from last summer" must use the global top searchbar, which navigates to `/search` — a separate `GalleryViewer` route with no sort dropdown, no date grouping, no FilterPanel composition. The good search experience built for spaces in PR #254 (sort by relevance/newest/oldest, two-phase CTE, infinite scroll) is unreachable from the main timeline.

## Solution

Replicate the spaces unified-search UX on `/photos`: a search input in the page header that transforms the timeline in place, with the sort dropdown, date grouping, and asset viewer overlay all coming along. Extract the spaces fetch/state machinery into a reusable `<SmartSearchResults>` wrapper so both pages share one source of truth. The backend already declares `withSharedSpaces` on `SmartSearchDto` but `searchSmart` doesn't honor it yet — close that gap so `/photos` search reaches into spaces the user has pinned to their timeline.

---

## Decisions

| Decision                                        | Choice                                                                                                                     | Why                                                                                                       |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Search bar placement                            | Page header (`UserPageLayout` `buttons` slot), mirroring spaces                                                            | Spaces parity; the FilterPanel placement was reviewed and rejected for discoverability and mobile cost    |
| Code reuse                                      | Extract & generalize — new `<SmartSearchResults>` wrapper that owns fetch state, renders the existing dumb grid underneath | One source of truth, fixes apply to both pages                                                            |
| URL state                                       | `/photos?q=<query>` with `pushState` on submit, `replaceState` on clear                                                    | Shareable links, browser back exits search                                                                |
| Default sort on submit                          | Relevance                                                                                                                  | Matches spaces                                                                                            |
| Top global searchbar                            | Untouched, deferred                                                                                                        | Out of scope; still navigates to `/search`                                                                |
| `/search` route                                 | Untouched                                                                                                                  | Top bar still depends on it                                                                               |
| Mobile (`<640px`)                               | Hidden under `sm:block`                                                                                                    | Spaces parity; documented regression                                                                      |
| SortToggle for non-search browsing              | Not added on `/photos`                                                                                                     | Avoid scope creep; `/photos` keeps its current sort behavior                                              |
| Timeline-pinned space content in search         | Yes — implement existing `withSharedSpaces` flag in `searchSmart`                                                          | Search must match what the user sees in the unfiltered timeline                                           |
| `/photos` filter trampling on search enter/exit | Match spaces — force `relevance` on submit, `desc` on clear                                                                | Spaces parity                                                                                             |
| Timeline rendering during search                | Unmount via `{#if !showSearchResults}`, mirroring spaces                                                                   | Spaces parity; avoids asset-viewer routing conflict; bucket refetch on clear is the same cost spaces pays |

---

## Backend

The DTO field already exists. The endpoint silently accepts the flag today but does nothing with it. The work is to wire the flag through `searchSmart`, mirroring the existing pattern in `getSearchSuggestions` / `getAccessibleTags` / `getFilterSuggestions`.

### 1. Service — implement `withSharedSpaces` in `searchSmart`

**File:** `server/src/services/search.service.ts`

`searchSmart` (currently lines 121–175) needs two additions, both copy-paste from the suggestions endpoints:

**a) Reject the conflict** (mirror `getSearchSuggestions:184-186`):

```typescript
if (dto.spaceId && dto.withSharedSpaces) {
  throw new BadRequestException('Cannot use both spaceId and withSharedSpaces');
}
```

Place this immediately after the existing `dto.spaceId` access check (line 128).

**b) Resolve `timelineSpaceIds`** (mirror `getSearchSuggestions:194-200`):

```typescript
let timelineSpaceIds: string[] | undefined;
if (dto.withSharedSpaces) {
  const spaceRows = await this.sharedSpaceRepository.getSpaceIdsForTimeline(auth.user.id);
  if (spaceRows.length > 0) {
    timelineSpaceIds = spaceRows.map((row) => row.spaceId);
  }
}
```

Place this before the `searchRepository.searchSmart` call (around line 163). Pass `timelineSpaceIds` into the spread:

```typescript
const { hasNextPage, items } = await this.searchRepository.searchSmart(
  { page, size },
  {
    ...dto,
    timelineSpaceIds, // NEW
    userIds: await userIds,
    embedding,
    orderDirection: dto.order,
    maxDistance: machineLearning.clip.maxDistance,
  },
);
```

When `withSharedSpaces` is true but the user has no shared spaces, `timelineSpaceIds` stays `undefined`, which falls back to owner-only behavior (matches the suggestions test at `search.service.spec.ts:463-477`).

### 2. Repository — already supports `timelineSpaceIds` via `searchAssetBuilder`

**File:** `server/src/repositories/search.repository.ts:362`

```typescript
const baseQuery = searchAssetBuilder(trx, options).selectAll('asset')...
```

`searchAssetBuilder` already accepts `timelineSpaceIds` as part of the options bag — it's the same builder used by `searchLargeAssets`, `searchRandom`, `searchExifField`, and the suggestion paths. **No repository changes required.** Verify by running the new service test (below) and confirming the SQL output references the expected joins.

### 3. Code generation

The DTO field already exists, so the SDK is already generated with `withSharedSpaces` on `SmartSearchDto`. **No SDK regen needed.** The `@GenerateSql` example for `searchSmart` at `search.repository.ts:340-350` may need a `timelineSpaceIds` field added so `make sql` produces the right reference output (verification task #4 below). If so, that's the only generated-file touch.

---

## Frontend

### 1. Refactor `buildSmartSearchParams`

**File:** `web/src/lib/utils/space-search.ts` → rename to `web/src/lib/utils/smart-search.ts`

The current signature is `(query: string, spaceId: string, filters: FilterState)`. `spaceId` is required and positional. The body (`space-search.ts:6-54`) sets `spaceId` unconditionally, maps `personIds → spacePersonIds`, and reads `filters.sortOrder` for the `order` field.

**New signature:**

```typescript
buildSmartSearchParams(args: {
  query: string;
  filters: FilterState;
  spaceId?: string;
  withSharedSpaces?: boolean;
}): SmartSearchDto
```

**Behavior changes (only the conditional branches change; field mappings preserved):**

- When `spaceId` provided:
  - Sets `params.spaceId = spaceId`
  - Maps `filters.personIds → params.spacePersonIds` (existing behavior)
  - Ignores `withSharedSpaces`
- When `spaceId` absent:
  - Does **not** set `params.spaceId`
  - Maps `filters.personIds → params.personIds` directly (no rename)
  - Sets `params.withSharedSpaces` from the arg (only when truthy)
- All other fields (`takenAfter`/`takenBefore` from `selectedYear`/`selectedMonth`, `isFavorite`, `order`, `mediaType → type`, `city`, `country`, `make`, `model`, `tagIds`, `rating`) are mapped identically to the current implementation.

**File reorganization:**

- Rename `web/src/lib/utils/space-search.ts` → `web/src/lib/utils/smart-search.ts`
- Rename `web/src/lib/utils/space-search.spec.ts` → `web/src/lib/utils/smart-search.spec.ts` (extend with no-`spaceId` and `withSharedSpaces` cases)
- The exported constant `SEARCH_FILTER_DEBOUNCE_MS = 250` (currently at `space-search.ts:4`) moves with the file. Both consumers (spaces page, new wrapper) import from the new path.

**Update existing call sites:**

- `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.svelte:599` — switch to the new args-object signature: `buildSmartSearchParams({ query: searchQuery.trim(), filters, spaceId: space.id })`.
- New call site in `<SmartSearchResults>` (below).

### 2. New: `<SmartSearchResults>` wrapper component

**File:** `web/src/lib/components/search/smart-search-results.svelte` (new)

Owns the fetch/state machinery currently inlined in `spaces/.../+page.svelte:578-673`:

**State (moved from spaces page → wrapper):**

- `searchResults: AssetResponseDto[]`
- `isLoading: boolean`
- `hasMoreResults: boolean`
- `searchPage: number`
- `searchAbortController: AbortController | undefined`

**Methods (moved from spaces page → wrapper):**

- `executeSearch(page, append)` — calls `searchSmart({ smartSearchDto: buildSmartSearchParams({ query, filters, spaceId, withSharedSpaces }) })`, manages abort controller, handles errors. Identical to the current spaces implementation.
- `handleLoadMore()` — increments `searchPage` and calls `executeSearch(next, true)`.

**Reactive trigger — single combined `$effect`:**

The wrapper uses **one** debounced effect that tracks both `searchQuery` and the relevant filter fields. This avoids the double-fire trap of two separate effects firing on initial mount with a URL-seeded query.

```typescript
$effect(() => {
  // Track everything that should trigger a re-search
  const _ = [
    searchQuery,
    filters.personIds,
    filters.city,
    filters.country,
    filters.make,
    filters.model,
    filters.tagIds,
    filters.rating,
    filters.mediaType,
    filters.selectedYear,
    filters.selectedMonth,
    filters.sortOrder,
    filters.isFavorite,
  ];

  // Gate: don't fetch when search is empty
  if (!searchQuery.trim()) {
    return;
  }

  const timeout = setTimeout(() => {
    searchPage = 1;
    void executeSearch(1, false);
  }, SEARCH_FILTER_DEBOUNCE_MS);

  return () => {
    clearTimeout(timeout);
    searchAbortController?.abort();
  };
});
```

This is essentially spaces' debounce effect (`spaces/.../+page.svelte:644-673`) with `searchQuery` added to the deps and the `showSearchResults` gate dropped (the wrapper only mounts when search is active, so the gate is unnecessary).

On initial mount with a URL-seeded query, this effect fires exactly once: schedules a debounced `executeSearch(1, false)` after 250ms. No double-fire.

**State that stays on the page (NOT moved into the wrapper):**

- `searchQuery` itself — owned by the page so the page can drive the URL state and the SearchBar `bind:name`.
- `showSearchResults` — derived on the page from `searchQuery.trim().length > 0`.
- `handleSearchSubmit` and `clearSearch` — owned by the page so each consumer (spaces vs `/photos`) can apply page-specific URL handling and trample logic.

**Wrapper props:**

```typescript
{
  searchQuery: string;        // current query, drives the fetch
  filters: FilterState;       // for filter compositing + sortOrder
  spaceId?: string;           // present in spaces, absent on /photos
  withSharedSpaces?: boolean; // true on /photos, undefined in spaces
  isShared: boolean;          // true in spaces, false on /photos
}
```

**Render:** the wrapper passes its internal state and `isShared` down to `space-search-results.svelte` (the existing dumb grid):

```svelte
<SpaceSearchResults
  results={searchResults}
  {isLoading}
  hasMore={hasMoreResults}
  totalLoaded={searchResults.length}
  onLoadMore={handleLoadMore}
  {spaceId}
  {isShared}
  sortMode={filters.sortOrder}
/>
```

The page handles the "submit" intent by setting its `searchQuery` state; the wrapper's combined effect (above) reacts to the prop change and runs the debounced search.

### 3. Modify `space-search-results.svelte` (the dumb grid)

**File:** `web/src/lib/components/spaces/space-search-results.svelte`

The grid is mostly reusable but **two changes are required:**

**a) Add `isShared` prop and pass it to the asset viewer.**

Today `space-search-results.svelte:186` hardcodes `isShared={true}`:

```svelte
<AssetViewer {cursor} isShared={true} {spaceId} onClose={...} />
```

Change to:

```svelte
<AssetViewer {cursor} {isShared} {spaceId} onClose={...} />
```

Add `isShared: boolean` to the `Props` interface (currently lines 13–22) and to the `$props()` destructure (line 23). Default to `true` if you want to make it backwards-compatible, but better to make it required so call sites are explicit.

**b) Conditionally pass `spaceId` to `getAssetInfo`.**

`space-search-results.svelte:46-48` currently always passes `spaceId`:

```typescript
const getFullAsset = async (id: string): Promise<AssetResponseDto> => {
  return getAssetInfo({ ...authManager.params, id, spaceId });
};
```

When `spaceId` is `undefined`, the SDK call becomes `getAssetInfo({ ..., id, spaceId: undefined })`. The SDK probably tolerates this, but to be safe and to keep the network request clean, omit it conditionally:

```typescript
const getFullAsset = async (id: string): Promise<AssetResponseDto> => {
  return getAssetInfo({ ...authManager.params, id, ...(spaceId ? { spaceId } : {}) });
};
```

(No file rename — the dumb grid stays in `web/src/lib/components/spaces/space-search-results.svelte`. Renaming it adds git churn for marginal benefit; the wrapper's name `smart-search-results.svelte` already indicates its generality.)

### 4. Update spaces page to use the wrapper

**File:** `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.svelte`

**Removed (state and logic now owned by `<SmartSearchResults>`):**

- `searchResults`, `isSearching`, `searchPage`, `hasMoreResults`, `searchAbortController` (lines 579–584)
- `executeSearch`, `handleLoadMore` (lines 586–631)
- The debounced `$effect` watching filter fields (lines 644–673)

**Kept on the spaces page:**

- `searchQuery: string` state
- `showSearchResults` state (could become derived from `searchQuery.trim().length > 0` for parity with `/photos`, OR kept as explicit state if there are spaces-specific reasons; verify with the spaces page diff)
- `handleSearchSubmit()` — sets `filters.sortOrder = 'relevance'`, lets the wrapper auto-trigger
- `clearSearch()` — sets `filters.sortOrder = 'desc'`
- The `<SearchBar>` and conditional `<SearchSortDropdown>` / `<SortToggle>` swap inside `{#snippet buttons()}` (lines 720–753) — unchanged
- Replace the `<SpaceSearchResults>` direct render with `<SmartSearchResults searchQuery={searchQuery} filters={filters} spaceId={space.id} isShared={true} />` at the same location

**Spaces behavior must remain identical** — verified by manual side-by-side QA against main and by the existing space search E2E suite.

### 5. `/photos` page changes

**File:** `web/src/routes/(user)/photos/[[assetId=id]]/+page.svelte`

The current state of the file (verified):

- Imports from `$lib/components/filter-panel/filter-panel`, `$lib/components/layouts/user-page-layout.svelte`, etc.
- `let filters = $state(createFilterState())` at line 60
- `const hasActiveFilters = $derived(getActiveFilterCount(filters) > 0)` at line 127
- `const isTimelineEmpty = $derived(timelineManager?.isInitialized && totalAssetCount === 0 && !hasActiveFilters)` at line 129
- `<UserPageLayout>` at line 179 with no `buttons` snippet today
- `<ImageCarousel>` guarded by `$preferences.memories.enabled && !hasActiveFilters` at line 215
- `<ActiveFiltersBar>` rendered inside `{#if hasActiveFilters}` at lines 192–205, **without** `searchQuery` / `onClearSearch` props

**Changes:**

#### a. New imports

```typescript
import { goto } from '$app/navigation';
import { page } from '$app/state';
import SearchBar from '$lib/components/shared-components/search-bar/search-bar.svelte';
import SearchSortDropdown from '$lib/components/filter-panel/search-sort-dropdown.svelte';
import SmartSearchResults from '$lib/components/search/smart-search-results.svelte';
```

#### b. New page state

```typescript
let searchQuery = $state(page.url.searchParams.get('q') ?? '');
const showSearchResults = $derived(searchQuery.trim().length > 0);
```

Initial-value seeding (synchronous in the `let` declaration) avoids the "mount → onMount → set query" flicker.

#### c. Update `hasActiveFilters` to include search

```typescript
const hasActiveFilters = $derived(getActiveFilterCount(filters) > 0 || showSearchResults);
```

This:

- Causes `<ActiveFiltersBar>` to render when only a search is active.
- Causes the `ImageCarousel` memories to be hidden during search (existing guard `!hasActiveFilters` automatically extends).
- Keeps `isTimelineEmpty` correct: when searching, even if the underlying timeline has 0 assets, the FilterPanel stays visible (since `hasActiveFilters` is true) — which is the right behavior.

#### d. Add `{#snippet buttons()}` to `UserPageLayout`

```svelte
{#snippet buttons()}
  <div class="hidden h-10 sm:block sm:w-40 xl:w-60">
    <SearchBar
      placeholder={$t('search')}
      bind:name={searchQuery}
      onSearch={({ force }) => {
        if (force) {
          handleSearchSubmit();
        }
      }}
      onReset={clearSearch}
    />
  </div>
  {#if showSearchResults}
    <SearchSortDropdown
      sortOrder={filters.sortOrder}
      onSelect={(mode) => {
        filters = { ...filters, sortOrder: mode };
      }}
    />
  {/if}
{/snippet}
```

This mirrors the spaces buttons snippet (`spaces/.../+page.svelte:720-753`) exactly, minus the `SortToggle` for non-search browsing (deliberately omitted on `/photos`) and the spaces-specific buttons (members, map, add photos).

`bind:name={searchQuery}` ties the input to the page state, so typing updates `searchQuery` immediately. `onSearch={({ force })}` matches the SearchBar callback shape (verified at `spaces/.../+page.svelte:729`).

#### e. Conditional render — unmount Timeline during search (mirrors spaces)

```svelte
{#if showSearchResults}
  <SmartSearchResults
    {searchQuery}
    {filters}
    isShared={false}
    withSharedSpaces={true}
  />
{:else}
  <Timeline {...existingTimelineProps} />
{/if}
```

**Why unmount, not CSS-hide:** spaces does the same thing (`spaces/.../+page.svelte:875,890`) for two important reasons:

1. **No asset-viewer routing conflict.** Both `<Timeline>` (with `enableRouting={true}` on `/photos`) and the asset viewer inside `<SmartSearchResults>` react to the URL `assetId` segment. If both are mounted simultaneously, both try to render an asset viewer for the same id.
2. **No wasted background fetches.** A mounted-but-hidden Timeline would reactively rebuild `options = buildPhotosTimelineOptions(filters)` whenever `filters.sortOrder` changes via `<SearchSortDropdown>`, issuing background `getTimeBuckets` refetches the user can't see.

**Cost accepted:** when the user clears the search, `<Timeline>` re-mounts and `TimelineManager` issues a fresh `getTimeBuckets` request. Bucket metadata is small (counts per month) and the per-bucket asset loads are lazy, so the cost is bounded — same as spaces. Scroll position is lost on clear, which is the same as spaces.

#### f. Wire `<ActiveFiltersBar>` props

```svelte
{#if hasActiveFilters}
  <ActiveFiltersBar
    {filters}
    {searchQuery}
    onClearSearch={clearSearch}
    resultCount={totalAssetCount}
    {personNames}
    {tagNames}
    onRemoveFilter={...}
    onClearAll={...}
  />
{/if}
```

`ActiveFiltersBar` already accepts `searchQuery` and `onClearSearch` (verified at `web/src/lib/components/filter-panel/active-filters-bar.svelte:13,24`); they're currently not provided on `/photos`.

#### g. Submit and clear handlers

```typescript
function handleSearchSubmit() {
  if (!searchQuery.trim()) return; // empty submit is no-op (matches spaces)
  filters = { ...filters, sortOrder: 'relevance' };
  const url = new URL('/photos', window.location.origin);
  url.searchParams.set('q', searchQuery.trim());
  void goto(url.pathname + url.search, { keepFocus: true });
}

function clearSearch() {
  searchQuery = '';
  filters = { ...filters, sortOrder: 'desc' };
  void goto('/photos', { replaceState: true, keepFocus: true });
}
```

Notes:

- `handleSearchSubmit` takes no arguments; it reads `searchQuery` from state (matches spaces' `handleSearchSubmit` at `spaces/.../+page.svelte:623`).
- `goto` with default options uses `pushState` semantics (browser back exits search).
- `clearSearch` uses `replaceState: true` to avoid polluting history with empty `/photos`.
- `keepFocus: true` keeps the search input focused after navigation (standard SvelteKit pattern).

#### h. URL state reactivity

```typescript
$effect(() => {
  const q = page.url.searchParams.get('q') ?? '';
  if (q !== searchQuery) {
    searchQuery = q;
  }
});
```

The guard prevents double-fetching when `handleSearchSubmit` updates the URL (which would otherwise trigger the effect to "re-set" `searchQuery` to the same value, possibly causing reactive loops). Browser back/forward correctly funnels through this effect.

---

## Verification tasks (must run during implementation)

These are the "verify in implementation" items extracted explicitly so they don't get lost:

1. **`navigate({ targetRoute: 'current', assetId: null })` on `/photos`** — confirm that closing the asset viewer from `space-search-results.svelte:81` preserves `?q=` when used on the `/photos` route. The route patterns differ (`spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]` vs `photos/[[assetId=id]]`). If the helper drops `?q=`, replace the close handler with a route-aware version that explicitly preserves query params.
2. **`getAssetInfo` with omitted `spaceId`** — confirm the SDK call works correctly when the `spaceId` field is omitted from the call object (not passed as `undefined`).
3. **`isTimelineEmpty` interaction during search** — `<Timeline>` is unmounted during search, so `timelineManager?.isInitialized` may be false and `isTimelineEmpty` may flip. Confirm `<FilterPanel>` doesn't disappear because of this. If it does, gate `isTimelineEmpty` on `!showSearchResults` so the panel stays visible while searching.
4. **`@GenerateSql` decorator for `searchSmart`** — if the existing example at `search.repository.ts:340-350` doesn't include a `timelineSpaceIds` case, add one so `make sql` produces the right reference output.
5. **TimelineManager re-mount cost on clear** — measure how long `getTimeBuckets` takes on a real-world library (10k+ assets). If the latency is visible to users, consider stashing the previous `timelineManager` instance in component state and rehydrating instead of refetching. Stretch optimization, only if measured pain.

---

## Data flow

**Search submit (Enter in `<SearchBar>`):**

1. User types into `<SearchBar>`; `searchQuery` updates live via `bind:name`.
2. User presses Enter → `onSearch({ force: true })` fires → `handleSearchSubmit()` runs.
3. `handleSearchSubmit` sets `filters.sortOrder = 'relevance'`, then `goto('/photos?q=<encoded>')`.
4. `$effect` sees the URL change but `q === searchQuery`, no-op.
5. `showSearchResults` becomes `true` → `<SmartSearchResults>` mounts; `<Timeline>` becomes hidden.
6. Wrapper runs `executeSearch(1, false)` → calls `searchSmart({ smartSearchDto: buildSmartSearchParams({ query, filters, withSharedSpaces: true }) })`.
7. Service resolves `timelineSpaceIds` from `sharedSpaceRepository.getSpaceIdsForTimeline(auth.user.id)`, calls `searchRepository.searchSmart` with the IDs.
8. Repository runs the two-phase CTE, returns paginated results.
9. Wrapper updates `searchResults`, dumb grid renders flat (relevance) or month-grouped (asc/desc).
10. User clicks an asset → `<AssetViewer>` opens with `isShared={false}` → owner actions enabled.

**Filter change while searching:**

1. FilterPanel updates `filters.{personIds|tagIds|city|country|...}`.
2. Wrapper's combined `$effect` re-runs `executeSearch(1, false)` after `SEARCH_FILTER_DEBOUNCE_MS`.
3. Old request aborted via `searchAbortController`, new results replace old ones.
4. Timeline is unmounted, so no background work.

**Sort change (`<SearchSortDropdown>`):**

1. `filters.sortOrder` updates (`'relevance'` / `'asc'` / `'desc'`).
2. Wrapper's combined `$effect` re-fires (sortOrder is in the dep list).
3. New `searchSmart` call with `order: AssetOrder.Asc` / `AssetOrder.Desc` (or omitted for relevance).
4. Grid switches between flat and month-grouped layout.

**Clear search:**

1. `clearSearch()` → `searchQuery = ''`, `filters.sortOrder = 'desc'`.
2. `goto('/photos', { replaceState: true })`.
3. `showSearchResults` becomes `false` → `<SmartSearchResults>` unmounts; `<Timeline>` mounts fresh.
4. `TimelineManager` initializes and fetches bucket metadata (same cost spaces pays on clear). Scroll position resets to top — accepted trade-off for spaces parity.

**Browser back from a search:**

1. URL `?q=` removed by browser navigation.
2. `page.url.searchParams.get('q')` reactively returns `null`.
3. `$effect` fires, sets `searchQuery = ''`.
4. Same outcome as `clearSearch` (without re-writing the URL).

---

## Edge cases

| #   | Case                                                         | Handling                                                                                                                                                                                                                                                                                                                             |
| --- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Page loads with `?q=foo` in URL                              | `searchQuery` seeded from URL via initial-value (`let searchQuery = $state(page.url.searchParams.get('q') ?? '')`); `<SmartSearchResults>` mounts on first render; `<Timeline>` mounts hidden in background. No flicker because seeding is synchronous.                                                                              |
| 2   | First mount with `?q=foo` and `$effect` race                 | The `$effect` guard `if (q !== searchQuery)` prevents a redundant set when the URL value already matches the seeded state. No double-fetch.                                                                                                                                                                                          |
| 3   | Empty query submitted via Enter                              | `handleSearchSubmit` early-returns (matches spaces). User clears via the explicit X on the search input (`<SearchBar onReset>`) or the chip in `ActiveFiltersBar`.                                                                                                                                                                   |
| 4   | URL with empty `q` param (`/photos?q=`)                      | `searchQuery` seeded as empty string, `showSearchResults` false, no search runs. URL keeps the empty `q` until next user action — cosmetic, not functional.                                                                                                                                                                          |
| 5   | Search with no results                                       | Empty state from existing dumb grid component                                                                                                                                                                                                                                                                                        |
| 6   | Search + active filters                                      | Filters compose with the smart search request via `buildSmartSearchParams`                                                                                                                                                                                                                                                           |
| 7   | Network error during search                                  | Error state from existing dumb grid (mirrors spaces)                                                                                                                                                                                                                                                                                 |
| 8   | Special characters in query (`&`, `?`, emoji)                | Encoded via `URLSearchParams`; backend already validates `SmartSearchDto.query` length                                                                                                                                                                                                                                               |
| 9   | Concurrent submits (user types fast)                         | Wrapper's `searchAbortController` aborts the previous request before starting the new one (same pattern as spaces' `executeSearch:592-594`). Each submit increments the active controller; aborted responses early-return at the `controller.signal.aborted` check.                                                                  |
| 10  | Submit while `loadMore` is in flight                         | Same abort controller covers both — the in-flight pagination request is aborted by the new submit. New request starts at page 1.                                                                                                                                                                                                     |
| 11  | Filter change while `loadMore` is in flight                  | Wrapper's debounced filter effect triggers `executeSearch(1, false)` which aborts the in-flight pagination and restarts at page 1.                                                                                                                                                                                                   |
| 12  | Smart search disabled (`isSmartSearchEnabled` returns false) | Backend throws `BadRequestException('Smart search is not enabled')` at `search.service.ts:135-137`. Frontend wrapper catches in the existing `try/catch` (mirroring spaces) and shows the error state. The `/photos` SearchBar should also be hidden when ML is disabled — verify the existing global condition at the layout level. |
| 13  | User has `withSharedSpaces=true` but no shared spaces        | Service `timelineSpaceIds` stays `undefined`, falls back to owner-only behavior (matches `getSearchSuggestions` test pattern at `:463-477`)                                                                                                                                                                                          |
| 14  | User has timeline-pinned space + searches                    | `withSharedSpaces=true` flag ensures search reaches into those spaces                                                                                                                                                                                                                                                                |
| 15  | Asset deleted/trashed/archived from viewer during search     | Same handling as spaces today: the result set is not auto-refreshed; the deleted asset still appears in the wrapper's `searchResults` until the next manual fetch. Acceptable for parity. Document as known.                                                                                                                         |
| 16  | Asset multi-selection during search                          | Automatically disabled — `<AssetSelectControlBar>` only renders when `assetMultiSelectManager.selectionActive` is true, and selection is driven by Timeline interactions. Since `<Timeline>` is unmounted during search, no selection can be triggered. No code change needed; spaces parity. Revisit as a follow-up if users ask.   |
| 17  | Mobile (`<640px`)                                            | Search bar hidden via `sm:block`. Top global searchbar still works (navigates to `/search`). Documented regression.                                                                                                                                                                                                                  |
| 18  | Asset viewer prev/next at edges                              | Inherits behavior from the existing asset viewer used by spaces — no new logic                                                                                                                                                                                                                                                       |
| 19  | Closing asset viewer preserves `?q=`                         | The existing `navigate({ targetRoute: 'current', assetId: null })` call is uncertain on `/photos` due to route pattern differences. **Verification task #1** — fall back to a route-aware close handler if needed.                                                                                                                   |
| 20  | TimelineManager state on clear                               | `<Timeline>` re-mounts on clear, fetches fresh bucket metadata. Same cost spaces pays. Scroll position resets — accepted.                                                                                                                                                                                                            |
| 21  | FilterPanel collapse state                                   | Independent of search — search works regardless                                                                                                                                                                                                                                                                                      |
| 22  | User clicks `ActiveFiltersBar` "search:" chip X              | Calls `clearSearch` (existing prop on `ActiveFiltersBar`)                                                                                                                                                                                                                                                                            |
| 23  | Sharing `/photos?q=beach` URL to another user                | Recipient sees the search but with their own (default) filter state. Filters remain in-memory, not URL-persisted. Same as spaces. Acceptable.                                                                                                                                                                                        |
| 24  | Page navigation away with active search                      | Component unmounts, all state cleared. Returning to `/photos` (without `?q=`) starts fresh, no stale search.                                                                                                                                                                                                                         |

---

## Testing strategy

### Unit (vitest) — backend

- `search.service.spec.ts`:
  - `searchSmart` rejects when both `spaceId` and `withSharedSpaces` are set (mirror `:434-442` for suggestions)
  - `searchSmart` resolves `timelineSpaceIds` when `withSharedSpaces=true` and no `spaceId` (mirror `:444-461`)
  - `searchSmart` falls back to owner-only when `withSharedSpaces=true` but user has no shared spaces (mirror `:463-477`)
  - `searchSmart` preserves existing behavior when `withSharedSpaces` is absent or explicitly false (mirror `:479-498`)
  - `searchSmart` does not call `getSpaceIdsForTimeline` when `spaceId` is set
- `search.repository.spec.ts`:
  - Smart search with `timelineSpaceIds` returns assets from those spaces (extend the existing `searchSmart` test, the helper already exists for the suggestions tests)

### Unit (vitest) — frontend

- `smart-search.spec.ts` (renamed from `space-search.spec.ts`):
  - `buildSmartSearchParams` correctly maps with `spaceId` (existing tests, updated for new args-object signature)
  - `buildSmartSearchParams` correctly maps without `spaceId` (new): `personIds → personIds`, no `spacePersonIds`, `withSharedSpaces` set when truthy
  - `buildSmartSearchParams` ignores `withSharedSpaces` when `spaceId` is set
  - Field mappings preserved across both modes (favorites, sort order, dates, media type)
- `smart-search-results.spec.ts` (new):
  - Wrapper mounts → triggers `executeSearch(1, false)`
  - `searchQuery` change → triggers new `executeSearch`, aborts previous
  - Filter change → debounced re-fetch (use fake timers)
  - `loadMore` triggers `executeSearch(2, true)` and appends
  - `searchQuery` becomes empty → wrapper does NOT fetch
  - Concurrent submit → previous request aborted, only latest applied
  - Submit while `loadMore` in flight → loadMore aborted, restart from page 1
  - Backend throws → wrapper catches and surfaces error state
- `space-search-results.spec.ts` (extend or add):
  - `isShared` prop forwarded to `<AssetViewer>` correctly (`true` and `false` cases)
  - `getAssetInfo` called without `spaceId` field when `spaceId` prop is undefined

### E2E (Playwright, real-server, in `e2e/src/web/specs/`)

Per `feedback_e2e_mock_filterpanel.md`, FilterPanel-adjacent E2E must use real-server tests.

- `/photos` smart search flow: submit query → results render → sort dropdown appears → switch to "newest first" → date groups appear → switch back to relevance → flat list → clear search → timeline returns at original scroll position
- URL persistence: navigate to `/photos?q=beach` directly → results render on load
- Browser back: search → back button → returns to unsearched timeline
- Browser forward: search → back → forward → returns to search results
- Filter composition: search → toggle a person filter → results re-fetch with combined params
- Timeline-pinned space content: with a shared space configured `showInTimeline=true`, search returns assets from that space
- Asset viewer: open an asset from search results → close → search state preserved (`?q=` still present in URL — covers verification task #1)
- Smart search disabled: with `isSmartSearchEnabled` returning false, the SearchBar gracefully shows an error or is hidden (verify the chosen behavior)

### Manual QA

- Side-by-side parity check: `/photos` search and spaces search feel identical for the same query
- Verify the new `buttons` snippet on `/photos` doesn't break the existing `UserPageLayout` header layout
- Verify mobile (`<640px`): SearchBar is hidden, no search affordance on `/photos` (spaces parity); top global searchbar still works
- Measure clear-search bucket refetch latency on a real-world library; confirm it feels acceptable

---

## Out of scope (explicit YAGNI)

- Top global searchbar changes — deferred
- `/search` route changes or deprecation — still used by top bar
- New backend endpoints — existing `/search/smart` is sufficient
- Backend DTO changes — `withSharedSpaces` already exists
- OpenAPI / SDK regeneration — no DTO change
- SQL query file regeneration — no `@GenerateSql` shape change (only the example may be updated)
- Mobile-specific search UI on `/photos` — accepted regression for spaces parity
- `SortToggle` for non-search browsing on `/photos`
- Search history, suggestions, recent queries
- Multi-select / bulk actions on search results
- Per-page search settings (similarity threshold UI on `/photos`)
- Stash-and-restore user sort preference around search — matches spaces' tramping
- Preserving Timeline scroll position across search clear — matches spaces; would require `timelineManager` instance stashing
- Asset result invalidation after delete/trash/archive from viewer — matches spaces, follow-up if requested
- Renaming `space-search-results.svelte` — cosmetic, adds git churn
