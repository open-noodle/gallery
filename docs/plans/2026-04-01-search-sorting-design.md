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
  SearchOrderOptions;  // NEW
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
context, components can set `'relevance'` as the initial mode.

### 6. Sort Dropdown for Search Results

**File:** New component or inline in space page

When `showSearchResults` is true, replace the existing `SortToggle` (2-state asc/desc icon) with
a dropdown showing three options:

- **Relevance** — default for search, no `order` param sent to API
- **Newest first** — `order: 'desc'`
- **Oldest first** — `order: 'asc'`

When `showSearchResults` is false, keep the existing `SortToggle` for the timeline.

The dropdown is a compact button showing the current sort icon + chevron, opening a 3-item
popover. This is more discoverable than a 3-state cycle toggle.

### 7. Pass sort to search API

**File:** `web/src/lib/utils/space-search.ts`

In `buildSmartSearchParams()`, add `order` when sort mode is not relevance:

```typescript
if (sortOrder === 'asc') {
  params.order = AssetOrder.Asc;
} else if (sortOrder === 'desc') {
  params.order = AssetOrder.Desc;
}
// 'relevance' — omit order param
```

### 8. Reset pagination on sort change

**File:** `web/src/routes/(user)/spaces/[spaceId]/.../+page.svelte`

Add `filters.sortOrder` to the `$effect` dependency array (line ~651) so changing sort mode
resets `searchPage = 1` and re-executes the search with `append: false`.

### 9. Infinite scroll in SpaceSearchResults

**File:** `web/src/lib/components/spaces/space-search-results.svelte`

Replace the "Load more" button with an `IntersectionObserver` sentinel on the last grid item
(same pattern as `people-infinite-scroll.svelte`). Guard against firing during `isLoading`.

### 10. Date-grouped display for date-sorted results

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

This is a lightweight frontend grouping — no new backend endpoint or time bucket API needed.

---

## Code Generation

- Regenerate TypeScript SDK: `make open-api-typescript`
- Regenerate Dart client: `make open-api-dart`
- Regenerate SQL queries: `make sql`
- Update `@GenerateSql` params on `searchSmart`

---

## Tests

- **Server unit test:** Verify `orderDirection` is passed through when `dto.order` is set, and
  undefined when not set
- **`buildSmartSearchParams` test:** Verify `order` is included when sort mode is not relevance
- **Sort dropdown component test:** Renders all three states, emits correct values
- **Infinite scroll:** Sentinel triggers `onLoadMore`, guarded by `isLoading`

---

## Summary of Changes

| Layer | File | Change |
|-------|------|--------|
| DTO | `search.dto.ts` | Add `order?: AssetOrder` to `SmartSearchDto` |
| Types | `search.repository.ts` | Add `SearchOrderOptions` to `SmartSearchOptions` |
| Repository | `search.repository.ts` | CTE path when `orderDirection` set |
| Service | `search.service.ts` | Pass `dto.order` → `orderDirection` |
| FilterState | `filter-panel.ts` | Extend `sortOrder` with `'relevance'` |
| Sort UI | space page | Sort dropdown (3 options) when in search mode |
| Search params | `space-search.ts` | Pass `order` when not relevance |
| Pagination reset | space page | Add `sortOrder` to `$effect` deps |
| Infinite scroll | `space-search-results.svelte` | Replace button with IntersectionObserver |
| Date grouping | `space-search-results.svelte` | Group by month when date-sorted |
| Codegen | OpenAPI + SQL | Regenerate all |

---

## Future Work (not in scope)

- **Main `/search` page:** Same sort dropdown + infinite scroll
- **Google-style two-tier layout:** Top results by relevance + remainder chronological
- **Adaptive threshold:** Stddev-based cutoff for automatic "relevant" set sizing
- **Score exposure:** Return similarity score in API response
- **Rework relevance display:** Improve the flat grid for relevance-sorted results
