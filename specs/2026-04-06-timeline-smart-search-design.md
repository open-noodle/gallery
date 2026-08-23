# Design: Smart Search on the Main Timeline (/photos)

**Date:** 2026-04-06
**Scope:** Bring the spaces unified-search experience to the main `/photos` timeline. Adds smart search with sort dropdown, date grouping, asset viewer overlay, and FilterPanel composition. Top global searchbar and `/search` route are explicitly out of scope.

**Revision history:**

- 2026-04-06 (initial) — first draft after brainstorming.
- 2026-04-06 (revised) — corrected after `/review` pass found that `withSharedSpaces` already exists on `SmartSearchDto`, the dumb grid component needs an explicit `isShared` prop, `searchAssetBuilder` already accepts `timelineSpaceIds`, and several edge cases / tests were missing.
- 2026-04-06 (revised again) — second `/review` pass discovered that spaces _unmounts_ Timeline during search (and uses `enableRouting={false}`); switched `/photos` to the same unmount pattern instead of CSS-hiding to avoid asset-viewer routing conflicts and wasted background bucket refetches. Also tightened the wrapper effect spec, made multi-select handling explicit, and fixed minor inconsistencies.
- 2026-04-06 (revised, third pass — test thoroughness) — third `/review` pass focused on testing. Found that `space-search.spec.ts` does not exist (creating new, not renaming), the E2E path is `e2e/src/specs/web/` (not `e2e/src/web/specs/`), and several leftover "Timeline mounts hidden" phrases needed updating. Decided not to rename the utility (consistency with the dumb grid). Decided the smart-search-disabled UX. Expanded the test plan with ~30 additional cases across backend, frontend unit, API E2E, and Playwright E2E layers, and called out the spaces regression specs as non-negotiable gates.
- 2026-04-06 (fifth pass — SearchBar import path) — fifth `/review` pass discovered the doc was importing `SearchBar` from `$lib/components/shared-components/search-bar/search-bar.svelte`, which is the **global top searchbar** with history box, modal, and `/search` navigation. The correct import is `$lib/elements/SearchBar.svelte` (the simple input used by spaces). Fixed the import path and added an explicit warning under the import block calling out the two same-named components.
- 2026-04-06 (sixth pass — `showLoadingSpinner` plumbing) — sixth `/review` pass found that `$lib/elements/SearchBar.svelte` declares `showLoadingSpinner: boolean` as a required prop, but the doc's snippet omitted it. Added the prop along with `$bindable` plumbing to expose the wrapper's internal `isLoading` state to the page so the SearchBar can reflect it. Also added `noScroll: true` to the `goto` calls (matches the existing pattern in `setting-accordion-state.svelte:39`).

---

## Problem

Today, `/photos` supports filters (people, location, tags, rating, etc.) but has no smart search. Users who want to find "beach photos from last summer" must use the global top searchbar, which navigates to `/search` — a separate `GalleryViewer` route with no sort dropdown, no date grouping, no FilterPanel composition. The good search experience built for spaces in PR #254 (sort by relevance/newest/oldest, two-phase CTE, infinite scroll) is unreachable from the main timeline.

## Solution

Replicate the spaces unified-search UX on `/photos`: a search input in the page header that transforms the timeline in place, with the sort dropdown, date grouping, and asset viewer overlay all coming along. Extract the spaces fetch/state machinery into a reusable `<SmartSearchResults>` wrapper so both pages share one source of truth. The backend already declares `withSharedSpaces` on `SmartSearchDto` but `searchSmart` doesn't honor it yet — close that gap so `/photos` search reaches into spaces the user has pinned to their timeline.

---

## Decisions

| Decision                                        | Choice                                                                                                                                  | Why                                                                                                                                                                 |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Search bar placement                            | Page header (`UserPageLayout` `buttons` slot), mirroring spaces                                                                         | Spaces parity; the FilterPanel placement was reviewed and rejected for discoverability and mobile cost                                                              |
| Code reuse                                      | Extract & generalize — new `<SmartSearchResults>` wrapper that owns fetch state, renders the existing dumb grid underneath              | One source of truth, fixes apply to both pages                                                                                                                      |
| URL state                                       | `/photos?q=<query>` with `pushState` on submit, `replaceState` on clear                                                                 | Shareable links, browser back exits search                                                                                                                          |
| Default sort on submit                          | Relevance                                                                                                                               | Matches spaces                                                                                                                                                      |
| Top global searchbar                            | Untouched, deferred                                                                                                                     | Out of scope; still navigates to `/search`                                                                                                                          |
| `/search` route                                 | Untouched                                                                                                                               | Top bar still depends on it                                                                                                                                         |
| Mobile (`<640px`)                               | Hidden under `sm:block`                                                                                                                 | Spaces parity; documented regression                                                                                                                                |
| SortToggle for non-search browsing              | Not added on `/photos`                                                                                                                  | Avoid scope creep; `/photos` keeps its current sort behavior                                                                                                        |
| Timeline-pinned space content in search         | Yes — implement existing `withSharedSpaces` flag in `searchSmart`                                                                       | Search must match what the user sees in the unfiltered timeline                                                                                                     |
| `/photos` filter trampling on search enter/exit | Match spaces — force `relevance` on submit, `desc` on clear                                                                             | Spaces parity                                                                                                                                                       |
| Timeline rendering during search                | Unmount via `{#if !showSearchResults}`, mirroring spaces                                                                                | Spaces parity; avoids asset-viewer routing conflict; bucket refetch on clear is the same cost spaces pays                                                           |
| Smart-search-disabled UX                        | SearchBar always rendered; backend `BadRequestException('Smart search is not enabled')` surfaces via the wrapper's existing error state | Spaces parity (spaces' SearchBar is also always shown when assetCount > 0); avoids the cost of plumbing an `isSmartSearchEnabled` config check into the page header |

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

**File:** `web/src/lib/utils/space-search.ts` (no rename — consistent with keeping `space-search-results.svelte` in place; both filenames retain their `space-` prefix for git history clarity, even though they now serve a generalized purpose)

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

**Files touched:**

- `web/src/lib/utils/space-search.ts` — modify `buildSmartSearchParams` body in place. The exported constant `SEARCH_FILTER_DEBOUNCE_MS = 250` stays at line 4.
- `web/src/lib/utils/__tests__/space-search.spec.ts` — **CREATE** (no existing file). Use the existing convention from `web/src/lib/utils/__tests__/photos-filter-options.spec.ts` (sibling `__tests__/` directory). Cover all cases listed in the test plan below.
- The wrapper component (Frontend §2) imports `buildSmartSearchParams` and `SEARCH_FILTER_DEBOUNCE_MS` from this same file.

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
  isLoading?: boolean;        // $bindable — exposes the wrapper's internal loading state to the page so the SearchBar's `showLoadingSpinner` can reflect it
}
```

The wrapper declares `isLoading` with `$bindable(false)` and writes to it inside `executeSearch` (set true before fetch, false after). The consumer page binds it via `bind:isLoading={isLoading}` so the page-level `<SearchBar>` can pass `showLoadingSpinner={isLoading}`. When the wrapper unmounts (search cleared), the bound value retains its last-written value but the page's local state is reset by `clearSearch` to `false`.

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
import SearchBar from '$lib/elements/SearchBar.svelte';
import SearchSortDropdown from '$lib/components/filter-panel/search-sort-dropdown.svelte';
import SmartSearchResults from '$lib/components/search/smart-search-results.svelte';
```

**Important — pick the right `SearchBar`:** the codebase has TWO components named `SearchBar`:

1. `$lib/elements/SearchBar.svelte` — the small input component used by spaces (`bind:name`, `onSearch({ force })`, `onReset`). **This is the one to import.**
2. `$lib/components/shared-components/search-bar/search-bar.svelte` — the global top searchbar with history box, search filter modal, and navigation to `/search`. **Do NOT import this** — it's a different component with different responsibilities.

#### b. New page state

```typescript
let searchQuery = $state(page.url.searchParams.get('q') ?? '');
let isLoading = $state(false); // bound to <SmartSearchResults> isLoading
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
      showLoadingSpinner={isLoading}
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

`showLoadingSpinner={isLoading}` is required by the `<SearchBar>` interface (`$lib/elements/SearchBar.svelte` declares the prop as required, no `?`). The page reads `isLoading` from its own state, which is two-way bound to `<SmartSearchResults>` via `bind:isLoading` (see Frontend §5e below).

This mirrors the spaces buttons snippet (`spaces/.../+page.svelte:720-753`) exactly, minus the `SortToggle` for non-search browsing (deliberately omitted on `/photos`) and the spaces-specific buttons (members, map, add photos).

`bind:name={searchQuery}` ties the input to the page state, so typing updates `searchQuery` immediately. `onSearch={({ force })}` matches the SearchBar callback shape (verified at `spaces/.../+page.svelte:729`).

#### e. Conditional render — unmount Timeline during search (mirrors spaces)

```svelte
{#if showSearchResults}
  <SmartSearchResults
    bind:isLoading
    {searchQuery}
    {filters}
    isShared={false}
    withSharedSpaces={true}
  />
{:else}
  <Timeline {...existingTimelineProps} />
{/if}
```

`bind:isLoading` exposes the wrapper's internal loading state to the page so the `<SearchBar>`'s `showLoadingSpinner` can reflect it. The same pattern is added to the spaces page so the spaces SearchBar continues to show the loading spinner after the wrapper extraction.

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
  void goto(url.pathname + url.search, { keepFocus: true, noScroll: true });
}

function clearSearch() {
  searchQuery = '';
  isLoading = false;
  filters = { ...filters, sortOrder: 'desc' };
  void goto('/photos', { replaceState: true, keepFocus: true, noScroll: true });
}
```

Notes:

- `handleSearchSubmit` takes no arguments; it reads `searchQuery` from state (matches spaces' `handleSearchSubmit` at `spaces/.../+page.svelte:623`).
- `goto` with default options uses `pushState` semantics (browser back exits search).
- `clearSearch` uses `replaceState: true` to avoid polluting history with empty `/photos`.
- `keepFocus: true` keeps the search input focused after navigation (standard SvelteKit pattern).
- `noScroll: true` prevents SvelteKit from scrolling to the top on URL update — matches the pattern in `setting-accordion-state.svelte:39`. Without it, every search submit could jump scroll position.
- `clearSearch` resets `isLoading = false` because the wrapper unmount may not propagate the bound value back to the page in time.

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
5. `showSearchResults` becomes `true` → `<SmartSearchResults>` mounts; `<Timeline>` unmounts (or doesn't mount on first load with `?q=foo`).
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

| #   | Case                                                         | Handling                                                                                                                                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Page loads with `?q=foo` in URL                              | `searchQuery` seeded from URL via initial-value (`let searchQuery = $state(page.url.searchParams.get('q') ?? '')`); `<SmartSearchResults>` mounts on first render; `<Timeline>` does NOT mount because `showSearchResults` is true. No flicker because seeding is synchronous.                                                                    |
| 2   | First mount with `?q=foo` and `$effect` race                 | The `$effect` guard `if (q !== searchQuery)` prevents a redundant set when the URL value already matches the seeded state. No double-fetch.                                                                                                                                                                                                       |
| 3   | Empty query submitted via Enter                              | `handleSearchSubmit` early-returns (matches spaces). User clears via the explicit X on the search input (`<SearchBar onReset>`) or the chip in `ActiveFiltersBar`.                                                                                                                                                                                |
| 4   | URL with empty `q` param (`/photos?q=`)                      | `searchQuery` seeded as empty string, `showSearchResults` false, no search runs. URL keeps the empty `q` until next user action — cosmetic, not functional.                                                                                                                                                                                       |
| 5   | Search with no results                                       | Empty state from existing dumb grid component                                                                                                                                                                                                                                                                                                     |
| 6   | Search + active filters                                      | Filters compose with the smart search request via `buildSmartSearchParams`                                                                                                                                                                                                                                                                        |
| 7   | Network error during search                                  | Error state from existing dumb grid (mirrors spaces)                                                                                                                                                                                                                                                                                              |
| 8   | Special characters in query (`&`, `?`, emoji)                | Encoded via `URLSearchParams`; backend already validates `SmartSearchDto.query` length                                                                                                                                                                                                                                                            |
| 9   | Concurrent submits (user types fast)                         | Wrapper's `searchAbortController` aborts the previous request before starting the new one (same pattern as spaces' `executeSearch:592-594`). Each submit increments the active controller; aborted responses early-return at the `controller.signal.aborted` check.                                                                               |
| 10  | Submit while `loadMore` is in flight                         | Same abort controller covers both — the in-flight pagination request is aborted by the new submit. New request starts at page 1.                                                                                                                                                                                                                  |
| 11  | Filter change while `loadMore` is in flight                  | Wrapper's debounced filter effect triggers `executeSearch(1, false)` which aborts the in-flight pagination and restarts at page 1.                                                                                                                                                                                                                |
| 12  | Smart search disabled (`isSmartSearchEnabled` returns false) | SearchBar always renders (matches spaces, which doesn't gate on the ML config). On submit, backend throws `BadRequestException('Smart search is not enabled')` at `search.service.ts:135-137`. Wrapper's existing `try/catch` (mirroring spaces' `executeSearch:610-616`) catches and surfaces the empty/error state. No special-cased UI hiding. |
| 13  | User has `withSharedSpaces=true` but no shared spaces        | Service `timelineSpaceIds` stays `undefined`, falls back to owner-only behavior (matches `getSearchSuggestions` test pattern at `:463-477`)                                                                                                                                                                                                       |
| 14  | User has timeline-pinned space + searches                    | `withSharedSpaces=true` flag ensures search reaches into those spaces                                                                                                                                                                                                                                                                             |
| 15  | Asset deleted/trashed/archived from viewer during search     | Same handling as spaces today: the result set is not auto-refreshed; the deleted asset still appears in the wrapper's `searchResults` until the next manual fetch. Acceptable for parity. Document as known.                                                                                                                                      |
| 16  | Asset multi-selection during search                          | Automatically disabled — `<AssetSelectControlBar>` only renders when `assetMultiSelectManager.selectionActive` is true, and selection is driven by Timeline interactions. Since `<Timeline>` is unmounted during search, no selection can be triggered. No code change needed; spaces parity. Revisit as a follow-up if users ask.                |
| 17  | Mobile (`<640px`)                                            | Search bar hidden via `sm:block`. Top global searchbar still works (navigates to `/search`). Documented regression.                                                                                                                                                                                                                               |
| 18  | Asset viewer prev/next at edges                              | Inherits behavior from the existing asset viewer used by spaces — no new logic                                                                                                                                                                                                                                                                    |
| 19  | Closing asset viewer preserves `?q=`                         | The existing `navigate({ targetRoute: 'current', assetId: null })` call is uncertain on `/photos` due to route pattern differences. **Verification task #1** — fall back to a route-aware close handler if needed.                                                                                                                                |
| 20  | TimelineManager state on clear                               | `<Timeline>` re-mounts on clear, fetches fresh bucket metadata. Same cost spaces pays. Scroll position resets — accepted.                                                                                                                                                                                                                         |
| 21  | FilterPanel collapse state                                   | Independent of search — search works regardless                                                                                                                                                                                                                                                                                                   |
| 22  | User clicks `ActiveFiltersBar` "search:" chip X              | Calls `clearSearch` (existing prop on `ActiveFiltersBar`)                                                                                                                                                                                                                                                                                         |
| 23  | Sharing `/photos?q=beach` URL to another user                | Recipient sees the search but with their own (default) filter state. Filters remain in-memory, not URL-persisted. Same as spaces. Acceptable.                                                                                                                                                                                                     |
| 24  | Page navigation away with active search                      | Component unmounts, all state cleared. Returning to `/photos` (without `?q=`) starts fresh, no stale search.                                                                                                                                                                                                                                      |

---

## Testing strategy

### Test file locations and naming conventions

- **Server unit tests:** co-located, `*.spec.ts` (e.g., `server/src/services/search.service.spec.ts`)
- **Web util unit tests:** sibling `__tests__/` directory, `*.spec.ts` (e.g., `web/src/lib/utils/__tests__/space-search.spec.ts`)
- **Web component unit tests:** sometimes co-located (e.g., `space-search-results.spec.ts`), sometimes in sibling `__tests__/` (e.g., `filter-panel/__tests__/active-filters-bar.spec.ts`). Follow whatever the surrounding directory uses.
- **Server API E2E:** `e2e/src/specs/server/api/*.e2e-spec.ts`
- **Playwright web E2E:** `e2e/src/specs/web/*.e2e-spec.ts`
- **All E2E files end in `.e2e-spec.ts`**, not `.spec.ts`

### Unit (vitest) — backend

**File:** `server/src/services/search.service.spec.ts`

Tests for `searchSmart` + `withSharedSpaces` (mirror the existing patterns in the `getSearchSuggestions` describe block at `:434-498`):

1. **Reject conflict** — `searchSmart` throws `BadRequestException` when both `spaceId` and `withSharedSpaces` are set (with the same error message used by other endpoints: `'Cannot use both spaceId and withSharedSpaces'`)
2. **Resolve `timelineSpaceIds`** — `searchSmart` calls `sharedSpaceRepository.getSpaceIdsForTimeline(auth.user.id)` when `withSharedSpaces=true` and no `spaceId`, and passes the resolved IDs to `searchRepository.searchSmart`
3. **Empty-spaces fallback** — `searchSmart` calls the repository with `timelineSpaceIds: undefined` when `withSharedSpaces=true` but `getSpaceIdsForTimeline` returns `[]`
4. **Absent flag** — `searchSmart` does not call `getSpaceIdsForTimeline` when `withSharedSpaces` is absent
5. **Explicit false** — `searchSmart` does not call `getSpaceIdsForTimeline` when `withSharedSpaces: false`
6. **`spaceId` set bypasses lookup** — `searchSmart` does not call `getSpaceIdsForTimeline` when `spaceId` is set, regardless of `withSharedSpaces`
7. **Composes with filters** — `searchSmart({ query, withSharedSpaces: true, personIds, tagIds, city, country, order })` passes all fields to the repository alongside `timelineSpaceIds` (composition test)
8. **Composes with sort modes** — `searchSmart({ query, withSharedSpaces: true, order })` passes through `'asc'`, `'desc'`, and `undefined` (relevance) correctly
9. **Composes with `queryAssetId`** — `searchSmart({ queryAssetId, withSharedSpaces: true })` resolves `timelineSpaceIds` and uses the asset embedding query path
10. **`spacePersonIds requires spaceId`** still rejects — `searchSmart({ withSharedSpaces: true, spacePersonIds: [...] })` throws because `spacePersonIds` requires `spaceId` (existing guard at `:130-132` must still fire)
11. **DTO smoke test** — `withSharedSpaces` accepts `true`, `false`, and absent; rejects non-boolean (controller-level validation, can be a single test)

**File:** `server/src/repositories/search.repository.spec.ts`

12. **Repository smart search with `timelineSpaceIds`** returns assets from those spaces (extend the existing `searchSmart` repository test; reuse the helper used by `searchLargeAssets` / `searchExifField` tests)
13. **Repository smart search with `timelineSpaceIds` excludes archived/trashed assets from those spaces** — ensures the visibility check at `searchAssetBuilder` is respected even when the timeline-spaces join is added
14. **Repository smart search with `timelineSpaceIds: undefined`** behaves identically to the legacy owner-only case (regression check)

### Server API E2E (vitest, real DB)

**File:** `e2e/src/specs/server/api/search.e2e-spec.ts` (extend)

These run against a live server + database, so they catch wiring bugs the unit tests can't.

15. **`POST /search/smart` with `withSharedSpaces: true`** returns timeline-pinned space content for a user who is a member
16. **`POST /search/smart` with `withSharedSpaces: true` AND `spaceId`** returns 400 with the conflict message
17. **`POST /search/smart` with `withSharedSpaces: true`** for a user with no shared spaces returns owner-only content (no error)
18. **Cross-user isolation** — User A's `withSharedSpaces=true` query never returns assets from a space user A is not a member of, even when user B (the space owner) has a matching asset
19. **Kicked-from-space regression** — User A is removed from a space after embedding generation. A subsequent `withSharedSpaces=true` query does NOT return assets from that space.
20. **`withSharedSpaces=false` (or absent)** does NOT include shared-space content even when the user has spaces pinned to their timeline (regression check that the flag is the only switch)

### Unit (vitest) — frontend

**File:** `web/src/lib/utils/__tests__/space-search.spec.ts` (NEW — does not exist today)

`buildSmartSearchParams` is a pure function — exhaustive coverage of conditional branches is cheap.

21. **`spaceId` provided** — sets `params.spaceId`, maps `personIds → spacePersonIds`, ignores `withSharedSpaces` even when set
22. **`spaceId` absent** — does NOT set `params.spaceId`, maps `personIds → personIds` directly, sets `withSharedSpaces` from arg when truthy
23. **`withSharedSpaces: false`** does NOT set the field on the DTO (omitted, not `false`)
24. **`withSharedSpaces: undefined`** does NOT set the field on the DTO
25. **`withSharedSpaces: true` + `spaceId` provided** → output has `spaceId` and NO `withSharedSpaces` field (regression for the "ignores" branch)
26. **Empty `personIds: []`** → no `personIds` and no `spacePersonIds` in output (boundary)
27. **`selectedYear + selectedMonth`** → `takenAfter`/`takenBefore` correctly span the month (test January → 31 days, February → 28/29, end-of-year boundary)
28. **`selectedYear` only** → `takenAfter`/`takenBefore` span the full year
29. **`mediaType: 'all'`** → no `type` field on the DTO
30. **`mediaType: 'image'`** → `type: AssetTypeEnum.Image`
31. **`mediaType: 'video'`** → `type: AssetTypeEnum.Video`
32. **`sortOrder: 'relevance'`** → no `order` field on the DTO (omitted; relevance is signaled by absence)
33. **`sortOrder: 'asc'`** → `order: AssetOrder.Asc`
34. **`sortOrder: 'desc'`** → `order: AssetOrder.Desc`
35. **`isFavorite: false`** → `isFavorite: false` on the DTO (vs `undefined` which is omitted)
36. **`isFavorite: true`** → `isFavorite: true`
37. **`isFavorite: undefined`** → field omitted

**File:** `web/src/lib/components/search/smart-search-results.spec.ts` (NEW)

The wrapper is a self-contained piece of state machinery — unit-testing it well buys correctness without expensive E2E. Use vitest fake timers for debounce assertions.

38. **Initial mount with non-empty `searchQuery`** schedules exactly ONE fetch after the debounce window (validates the "single combined effect" no-double-fire promise)
39. **Initial mount with empty `searchQuery`** does NOT fetch (gate works)
40. **`searchQuery` change** triggers a new debounced `executeSearch(1, false)`, aborts the previous if in flight
41. **Filter change** triggers debounced re-fetch
42. **Multiple consecutive filter changes within the debounce window** → only ONE fetch fires (debouncing correctness)
43. **Debounce window boundary** — fake timer advance at 249ms doesn't fire, at 250ms does
44. **Filter change with empty `searchQuery`** → no fetch (gate works)
45. **Sort change from `'relevance'` to `'asc'`** triggers re-fetch with `order: AssetOrder.Asc`
46. **Sort change from `'asc'` to `'relevance'`** triggers re-fetch with `order` omitted
47. **`loadMore`** triggers `executeSearch(2, true)` and appends to `searchResults`
48. **`loadMore` with `hasMore: false`** does nothing (boundary)
49. **`loadMore` while previous `loadMore` in flight** — abort controller cancels the first request; the second request wins. Both calls go through `executeSearch` but only the second result is applied (matches spaces' inherited abort-controller pattern)
50. **Concurrent submit** — query A in flight, query B submitted; A's response is ignored, B's is applied
51. **Submit while `loadMore` in flight** — loadMore aborted, restart from page 1
52. **Wrapper unmount mid-fetch** — abort controller fires, no state update on resolved-after-unmount response
53. **Backend throws `BadRequestException`** (smart search disabled or other backend error) → wrapper catches in try/catch, sets error state, doesn't crash
54. **Backend returns `0` results** → `searchResults = []`, empty state propagates to dumb grid
55. **`spaceId` prop** — when set, wrapper calls `buildSmartSearchParams` with `spaceId`, no `withSharedSpaces`
56. **`spaceId` prop** — when undefined, wrapper calls `buildSmartSearchParams` with `withSharedSpaces` from prop
57. **`isShared` prop forwarded** to the dumb grid render
    57b. **`isLoading` `$bindable` prop** — wrapper sets `isLoading=true` before fetch, `isLoading=false` after success/error/abort. Two-way binding propagates to parent.

**File:** `web/src/lib/components/spaces/space-search-results.spec.ts` (extend)

58. **`isShared={true}`** — `<AssetViewer>` receives `isShared={true}` (existing behavior, regression test)
59. **`isShared={false}`** — `<AssetViewer>` receives `isShared={false}` (new behavior)
60. **`getAssetInfo` called WITH `spaceId`** when `spaceId` prop is set
61. **`getAssetInfo` called WITHOUT `spaceId` field** when `spaceId` prop is undefined (verify the conditional spread, not just `spaceId: undefined`)

### Playwright web E2E

**File:** `e2e/src/specs/web/photos-search.e2e-spec.ts` (NEW), or extend `photos-filter-panel.e2e-spec.ts`

Per `feedback_e2e_mock_filterpanel.md`, FilterPanel-adjacent E2E must use real-server tests (no mocks).

62. **Smart search flow** — submit query → results render → sort dropdown appears → switch to "newest first" → date group headers appear → switch back to relevance → flat list (no headers) → clear search → timeline returns
63. **URL persistence** — navigate to `/photos?q=beach` directly → results render on load, no flash of timeline
64. **Browser back from search** — search → click back → returns to unsearched timeline, `?q=` removed
65. **Browser forward after back** — search → back → forward → returns to search results, `?q=` restored
66. **Browser refresh during search** — F5 on `/photos?q=beach` → search results restored
67. **Empty query submit** — type nothing, press Enter → no-op, no URL change
68. **Whitespace-only query submit** — type `"   "`, press Enter → no-op
69. **Special characters in query** — `"beach & sunset?"` → URL encoded round-trip, results render
70. **Empty `?q=` URL** (`/photos?q=`) → no search runs, FilterPanel + Timeline visible, no spinner
71. **Filter composition** — search → toggle a person filter → results re-fetch with combined params (verify the request payload via the network layer or by asserting result count change)
72. **Filter then search** — set people filter first → THEN search → results respect both
73. **Search with date filter** — search → change date range → date-grouped results update
74. **Sort UX swap** — sort dropdown (`SearchSortDropdown`) only visible when search active; not visible on plain timeline
75. **Date grouping appearance** — relevance mode renders flat (no month headers); date mode renders month headers
76. **Asset viewer open/close preserves `?q=`** — covers verification task #1 directly
77. **Asset viewer prev/next at first/last result** — boundary navigation behavior
78. **Cancel search mid-fetch** — search → quickly clear before fetch completes → no flash of stale results
79. **Multi-select disabled during search** — search → assert `<AssetSelectControlBar>` does not appear (no Timeline interaction surface)
80. **`<ImageCarousel>` memories hidden during search** — confirm the memory carousel disappears when search is active
81. **FilterPanel collapse state preserved** — collapse FilterPanel → search → clear → FilterPanel still collapsed
82. **`<ActiveFiltersBar>` "search:" chip** — search → click X on the search chip → search cleared
83. **Timeline-pinned space content** — set up a shared space with `showInTimeline=true`, search → results include space content
84. **Smart search disabled UX** — set `isSmartSearchEnabled=false`, search → wrapper shows error/empty state (matches the locked-in decision in Decisions table)
85. **Owner actions in asset viewer** — open asset from `/photos` search → asset viewer shows owner actions (delete, edit) because `isShared={false}`
86. **Mobile viewport** — set viewport to 639px, navigate `/photos`, verify SearchBar is hidden; set to 640px, verify it's visible

### Spaces refactor regression gates (NON-NEGOTIABLE)

The wrapper extraction touches the spaces page. Existing E2E suites MUST pass without modification:

87. **`e2e/src/specs/web/spaces-search.e2e-spec.ts`** — full pass, no test changes allowed (any required test change indicates a behavior regression in spaces)
88. **`e2e/src/specs/web/spaces-filter-panel.e2e-spec.ts`** — full pass
89. **`e2e/src/specs/web/spaces-p1.e2e-spec.ts`**, **`p2`**, **`p3`** — full pass

These tests are the safety net for the spaces refactor. The implementation plan must run them as a checkpoint after the wrapper extraction is complete and before the `/photos` integration starts. **Any failure here is a blocker, not a "fix in next PR" deferral.**

### Manual QA

90. **Side-by-side parity** — `/photos` search and spaces search feel identical for the same query
91. **Layout health** — the new `buttons` snippet on `/photos` doesn't break the existing `UserPageLayout` header layout (visual)
92. **Mobile** (`<640px`) — SearchBar is hidden, no search affordance on `/photos` (spaces parity); top global searchbar still works
93. **Clear-search bucket refetch latency** — measure on a real-world library (10k+ assets); confirm acceptable
94. **First page load with `?q=foo`** — no flash of timeline before search results render
95. **`<FilterPanel>` doesn't disappear during search** — covers verification task #3
96. **Visual: dumb grid date headers** look the same on `/photos` as in spaces (same component, but verify consistent context)
97. **Accessibility: tab order** — SearchBar → SortDropdown → grid results → asset viewer
98. **Keyboard** — Enter submits, Escape closes asset viewer, focus returns to grid after close
99. **Real ML instance smoke test** — search a real ML-enabled instance with real photos and verify results match user expectation
100.  **Owner actions sanity** — open asset from search, delete/archive/edit, verify the result set behaves consistently (deleted item still visible until next refresh — accepted per edge case #15)

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
- Renaming `space-search-results.svelte` or `space-search.ts` — cosmetic, adds git churn; both keep their `space-` prefix even though the contents are now generic
- Hiding the SearchBar when smart search is disabled — backend rejection surfaces via the wrapper's existing error state instead
