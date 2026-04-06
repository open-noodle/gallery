# Design: Smart Search Sorting in Space Search

**Date:** 2026-04-01
**Scope:** Space search only (main `/search` page is a follow-up)
**Research:** [docs/plans/research/2026-04-01-search-sorting.md](research/2026-04-01-search-sorting.md)

---

## Problem

Space search results are ordered exclusively by CLIP vector similarity. Users want to browse
semantically relevant results chronologically (e.g., "show all beach photos, newest first").
Additionally, space search pagination is broken — the "Load more" button is unreachable.

## Solution

Two-phase CTE query: recall top-500 by vector similarity, then re-sort by date. Add a sort
dropdown to the space search UI. Fix pagination with infinite scroll. Group date-sorted results
by month.

---

## Backend

### 1. DTO — Add `order` to `SmartSearchDto`

**File:** `server/src/dtos/search.dto.ts`

Add `order?: AssetOrder` to `SmartSearchDto`, same pattern as `MetadataSearchDto` (line 221):

```typescript
@ValidateEnum({
  enum: AssetOrder,
  name: 'AssetOrder',
  optional: true,
  description: 'Sort order (omit for relevance)',
})
order?: AssetOrder;
```

### 2. Types — Add `SearchOrderOptions` to `SmartSearchOptions`

**File:** `server/src/repositories/search.repository.ts`

```typescript
export type SmartSearchOptions = SearchDateOptions &
  SearchEmbeddingOptions &
  SearchExifOptions &
  SearchOneToOneRelationOptions &
  SearchStatusOptions &
  SearchUserIdOptions &
  SearchPeopleOptions &
  SearchTagOptions &
  SearchOcrOptions &
  SearchSpaceOptions &
  SearchOrderOptions; // NEW
```

### 3. Repository — Two-Phase CTE in `searchSmart`

**File:** `server/src/repositories/search.repository.ts` (lines 343-359)

When `options.orderDirection` is set, use a CTE to recall candidates then re-sort:

```sql
WITH candidates AS (
  SELECT asset.*
  FROM asset
  INNER JOIN smart_search ON asset.id = smart_search."assetId"
  WHERE ...(searchAssetBuilder filters)...
  ORDER BY smart_search.embedding <=> $embedding
  LIMIT 500
)
SELECT * FROM candidates
ORDER BY "fileCreatedAt" $direction
LIMIT $size + 1 OFFSET $offset;
```

When `orderDirection` is NOT set: current behavior unchanged — pure relevance ordering with no
CTE and no recall budget cap.

**Key details:**

- Recall budget: 500 (constant). The inner CTE `ORDER BY distance LIMIT 500` triggers the
  vector index (HNSW/VectorChord). The outer sort on 500 rows is trivial.
- Pagination: offset-based on the outer query. With page size 100, max 5 pages.
- Update `@GenerateSql` params to include `orderDirection` for SQL query regeneration.
- NULL `fileCreatedAt` handling: PostgreSQL sorts NULLs last with ASC, first with DESC. Add
  explicit `NULLS LAST` to the outer ORDER BY to keep NULL-dated assets at the end regardless
  of direction.

**Known limitation:** Date-sorted mode caps at 500 total results. If fewer than 500 match the
filters, all are returned. The ANN index may return fewer than 500 if filter selectivity is high
and probe budget is exhausted — this matches current behavior.

### 4. Service — Pass order through

**File:** `server/src/services/search.service.ts` (line ~163)

Map `dto.order` to `orderDirection`, same as `searchMetadata` does:

```typescript
const { hasNextPage, items } = await this.searchRepository.searchSmart(
  { page, size },
  { ...dto, userIds: await userIds, embedding, orderDirection: dto.order },
);
```

---

## Frontend

### 5. Extend `FilterState.sortOrder`

**File:** `web/src/lib/components/filter-panel/filter-panel.ts`

Change `sortOrder` type from `'asc' | 'desc'` to `'asc' | 'desc' | 'relevance'`:

```typescript
export interface FilterState {
  // ...
  sortOrder: 'asc' | 'desc' | 'relevance';
}
```

Default stays `'desc'` in `createFilterState()` (timeline behavior unchanged). In search
context, `'relevance'` is set as the initial mode when entering search.

**Updating existing consumers to handle `'relevance'` explicitly:**

Two sites currently use `sortOrder === 'asc' ? AssetOrder.Asc : AssetOrder.Desc`, which would
silently fall through to `Desc` for `'relevance'`. Both must be updated:

- `web/src/lib/utils/photos-filter-options.ts:37` — only set `base.order` when
  `sortOrder !== 'relevance'`:
  ```typescript
  if (filters.sortOrder !== 'relevance') {
    base.order = filters.sortOrder === 'asc' ? AssetOrder.Asc : AssetOrder.Desc;
  }
  ```
- `web/src/routes/(user)/spaces/.../+page.svelte:315` — same pattern, only set `base.order`
  when not `'relevance'`.

The timeline always needs an order, so when `sortOrder` is `'relevance'`, default to
`AssetOrder.Desc` explicitly:

```typescript
if (filters.sortOrder === 'relevance') {
  base.order = AssetOrder.Desc;
} else {
  base.order = filters.sortOrder === 'asc' ? AssetOrder.Asc : AssetOrder.Desc;
}
```

### 6. Sort Dropdown for Search Results

**File:** New component or inline in space page

When `showSearchResults` is true, replace the existing `SortToggle` (2-state asc/desc icon) with
a dropdown showing three options:

- **Relevance** — default for search, no `order` param sent to API
- **Newest first** — `order: 'desc'`
- **Oldest first** — `order: 'asc'`

When `showSearchResults` is false, keep the existing `SortToggle` for the timeline. The
`SortToggle` Props type remains `'asc' | 'desc'` — the timeline path narrows
`filters.sortOrder` before passing it (if `'relevance'`, pass `'desc'` as fallback).

The dropdown is a compact button showing the current sort icon + chevron, opening a 3-item
popover. This is more discoverable than a 3-state cycle toggle.

### 7. Pass sort to search API

**File:** `web/src/lib/utils/space-search.ts`

In `buildSmartSearchParams()`, add `order` when sort mode is not relevance. The function already
receives `filters` which contains `sortOrder`:

```typescript
if (filters.sortOrder === 'asc') {
  params.order = AssetOrder.Asc;
} else if (filters.sortOrder === 'desc') {
  params.order = AssetOrder.Desc;
}
// 'relevance' — omit order param, backend uses pure similarity ordering
```

**Drive-by fix:** Also add `isFavorite` mapping (pre-existing gap — `FilterState` has it but
`buildSmartSearchParams` never passed it through):

```typescript
if (filters.isFavorite !== undefined) {
  params.isFavorite = filters.isFavorite;
}
```

### 8. Reset pagination on sort change

**File:** `web/src/routes/(user)/spaces/[spaceId]/.../+page.svelte`

Add `filters.sortOrder` and `filters.isFavorite` to the `$effect` dependency array (line ~651)
so changing sort mode or favorite filter resets `searchPage = 1` and re-executes the search with
`append: false`. This ensures switching from relevance to date-sorted (or vice versa) fetches
fresh results from page 1. (`isFavorite` is a pre-existing gap — it's in `FilterState` but was
never tracked by the `$effect`.)

### 9. Search entry and exit sort behavior

**Entering search:** `handleSearchSubmit()` sets `filters = { ...filters, sortOrder: 'relevance' }`
before calling `executeSearch(1, false)`. This ensures every new search starts in relevance mode.
Note: `createFilterState()` still returns `'desc'` — the `'relevance'` override happens only in
`handleSearchSubmit`, not in the filter state factory.

**Clearing search:** `clearSearch()` adds `filters = { ...filters, sortOrder: 'desc' }` alongside
its existing reset of `searchQuery`, `searchResults`, etc. This is separate from `clearFilters()`
which intentionally preserves `sortOrder` as a view preference. The distinction:

- `clearSearch()` = exit search mode entirely → reset sort to timeline default (`'desc'`)
- `clearFilters()` = clear filter values within current mode → preserve sort preference

**Type narrowing for SortToggle:** When `!showSearchResults`, the `SortToggle` component expects
`'asc' | 'desc'`. Since `clearSearch()` always resets to `'desc'`, and `createFilterState()`
defaults to `'desc'`, `sortOrder` should never be `'relevance'` when the timeline is showing.
As a safety measure, use an explicit narrowing expression when passing to `SortToggle`:

```typescript
sortOrder={filters.sortOrder === 'relevance' ? 'desc' : filters.sortOrder}
```

### 10. Infinite scroll in SpaceSearchResults

**File:** `web/src/lib/components/spaces/space-search-results.svelte`

Replace the "Load more" button with an `IntersectionObserver` sentinel on the last grid item
(same pattern as `people-infinite-scroll.svelte`).

**Guards:**

- Do not call `onLoadMore` if `isLoading` is true (prevents double-fire)
- Do not call `onLoadMore` if `hasMore` is false (prevents unnecessary API call when small
  result sets make the sentinel immediately visible)

### 11. Date-grouped display for date-sorted results

**File:** `web/src/lib/components/spaces/space-search-results.svelte`

When results are sorted by date (`sortOrder !== 'relevance'`), group the results array by
month/year using `fileCreatedAt` and render date headers between grid sections:

```svelte
{#each groupedByMonth as [monthLabel, assets]}
  <h3 class="...">{monthLabel}</h3>
  <div class="grid ...">
    {#each assets as asset}...{/each}
  </div>
{/each}
```

When sorted by relevance, keep the current flat grid (no date headers).

**Edge cases:**

- Empty groups: not possible since grouping is derived from the results array
- Zero results: the existing "No results" empty state renders before the grouped view, so this
  path is unchanged
- Assets with null/missing `fileCreatedAt`: group under an "Unknown date" label at the end

This is a lightweight frontend grouping — no new backend endpoint or time bucket API needed.

### 12. Result count display

**File:** `web/src/lib/components/spaces/space-search-results.svelte`

The current display shows `{totalLoaded}{hasMore ? '+' : ''} result(s)`. In date-sorted mode,
the 500 recall budget means the total is capped. Update the display:

- **Relevance mode:** `"100+ results"` (unchanged — no recall cap, pages indefinitely)
- **Date-sorted mode:** `"100 of up to 500 results"` when `hasMore` is true, or just
  `"X results"` when all loaded. This communicates the recall budget without confusing users.

The `SpaceSearchResults` component needs a new `sortMode` prop to conditionally render the
count format.

---

## Code Generation

- Regenerate TypeScript SDK: `make open-api-typescript`
- Regenerate Dart client: `make open-api-dart`
- Regenerate SQL queries: `make sql`
- Update `@GenerateSql` params on `searchSmart`

---

## Tests

### Server unit tests

- **Service:** Verify `orderDirection` is passed through when `dto.order` is set, and undefined
  when not set
- **Service:** Verify `orderDirection` is not set when `dto.order` is omitted (relevance default)

### Server medium test (real DB)

- Insert 10 assets with known dates and embeddings into a space
- Search with `orderDirection: 'desc'` — verify results are in newest-first date order
- Search with `orderDirection: 'asc'` — verify oldest-first
- Search without `orderDirection` — verify results are in similarity order
- Verify pagination: page 1 returns `size` items, page 2 returns remainder

### Frontend unit tests

- **`buildSmartSearchParams`:** Verify `order` is included when `sortOrder` is `'asc'` or
  `'desc'`, and omitted when `'relevance'`. Also verify `isFavorite` is passed through.
- **Sort dropdown component:** Renders all three states, emits correct values, highlights
  current selection
- **Date grouping utility:** Given assets with various `fileCreatedAt` values, verify groups
  are correct, in order, and handle null dates
- **Infinite scroll:** Sentinel triggers `onLoadMore`, guarded by `isLoading` and `hasMore`
- **Result count display:** Shows correct format for relevance vs date-sorted modes
- **`handleSearchSubmit`:** Verify it sets `filters.sortOrder` to `'relevance'` before executing
- **`clearSearch`:** Verify it resets `filters.sortOrder` to `'desc'`
- **Sort mode switch re-search:** Verify changing `sortOrder` while results are displayed
  triggers a fresh search from page 1 (not appending to existing results)
- **Timeline options with `'relevance'`:** Verify `photos-filter-options.ts` and the space page
  timeline options builder both fall back to `AssetOrder.Desc` when `sortOrder` is `'relevance'`
- **`clearFilters` preserves `'relevance'`:** Verify `clearFilters()` does not reset `sortOrder`
  when it is `'relevance'` (user is in search mode, clears filters, stays in search)
- **Existing tests:** Update `filter-state.spec.ts` to account for `'relevance'` as a valid
  `sortOrder` value; update `sort-toggle.spec.ts` if the component interface changes

### E2E tests

- Search in a space with `order=desc`, verify response assets are in date-descending order
- Search in a space without `order`, verify response assets are in similarity order
- Infinite scroll: verify page 2 loads when scrolling to bottom of results

---

## Summary of Changes

| Layer             | File                          | Change                                                   |
| ----------------- | ----------------------------- | -------------------------------------------------------- |
| DTO               | `search.dto.ts`               | Add `order?: AssetOrder` to `SmartSearchDto`             |
| Types             | `search.repository.ts`        | Add `SearchOrderOptions` to `SmartSearchOptions`         |
| Repository        | `search.repository.ts`        | CTE path when `orderDirection` set, `NULLS LAST`         |
| Service           | `search.service.ts`           | Pass `dto.order` → `orderDirection`                      |
| FilterState       | `filter-panel.ts`             | Extend `sortOrder` with `'relevance'`                    |
| Photos filter     | `photos-filter-options.ts`    | Handle `'relevance'` explicitly                          |
| Sort UI           | space page                    | Sort dropdown (3 options) when in search mode            |
| Sort UI           | space page                    | Narrow type for `SortToggle` in timeline mode            |
| Search params     | `space-search.ts`             | Pass `order` from `filters.sortOrder` when not relevance |
| Drive-by fix      | `space-search.ts`             | Add missing `isFavorite` mapping                         |
| Drive-by fix      | space page `$effect`          | Add `isFavorite` to dependency array                     |
| Search entry/exit | space page                    | Set `'relevance'` on search entry, `'desc'` on clear     |
| Pagination reset  | space page                    | Add `sortOrder` to `$effect` deps                        |
| Infinite scroll   | `space-search-results.svelte` | Replace button with IntersectionObserver                 |
| Date grouping     | `space-search-results.svelte` | Group by month when date-sorted                          |
| Result count      | `space-search-results.svelte` | Contextual display for relevance vs date modes           |
| Codegen           | OpenAPI + SQL + Dart          | Regenerate all                                           |

---

## Future Work (not in scope)

- **Main `/search` page:** Same sort dropdown + infinite scroll
- **Google-style two-tier layout:** Top results by relevance + remainder chronological
- **Adaptive threshold:** Stddev-based cutoff for automatic "relevant" set sizing
- **Score exposure:** Return similarity score in API response
- **Rework relevance display:** Improve the flat grid for relevance-sorted results
