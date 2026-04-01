# Search Sorting Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add sort options (relevance/newest/oldest) to space smart search with infinite scroll pagination and date-grouped display.

**Architecture:** Two-phase CTE query — recall top-500 by vector similarity, re-sort by date in outer query. Frontend sort dropdown sets the `order` param on `SmartSearchDto`. IntersectionObserver replaces "Load more" button. Date-sorted results grouped by month in the template.

**Tech Stack:** NestJS (Kysely SQL), SvelteKit (Svelte 5 runes), OpenAPI codegen, Vitest

**Design:** [docs/plans/2026-04-01-search-sorting-design.md](2026-04-01-search-sorting-design.md)

---

## Task 1: Backend — Add `order` to SmartSearchDto and SmartSearchOptions

**Files:**

- Modify: `server/src/dtos/search.dto.ts:236-255`
- Modify: `server/src/repositories/search.repository.ts:137-146`

**Step 1: Add `order` field to `SmartSearchDto`**

In `server/src/dtos/search.dto.ts`, add after the `language` field (before the `page` field):

```typescript
@ValidateEnum({
  enum: AssetOrder,
  name: 'AssetOrder',
  optional: true,
  description: 'Sort order (omit for relevance)',
})
order?: AssetOrder;
```

**Step 2: Add `SearchOrderOptions` to `SmartSearchOptions`**

In `server/src/repositories/search.repository.ts`, change:

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
  SearchSpaceOptions;
```

to:

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
  SearchOrderOptions;
```

**Step 3: Commit**

```
feat: add order param to SmartSearchDto
```

---

## Task 2: Backend — Service passes order through

**Files:**

- Modify: `server/src/services/search.service.ts:161-166`
- Test: `server/src/services/search.service.spec.ts`

**Step 1: Write failing tests**

In `server/src/services/search.service.spec.ts`, add inside the `describe('searchSmart')` block:

```typescript
it('should pass orderDirection when order is set', async () => {
  await sut.searchSmart(authStub.user1, { query: 'test', order: AssetOrder.Desc });

  expect(mocks.search.searchSmart).toHaveBeenCalledWith(
    { page: 1, size: 100 },
    expect.objectContaining({ orderDirection: AssetOrder.Desc }),
  );
});

it('should not pass orderDirection when order is not set', async () => {
  await sut.searchSmart(authStub.user1, { query: 'test' });

  expect(mocks.search.searchSmart).toHaveBeenCalledWith(
    { page: 1, size: 100 },
    expect.objectContaining({ orderDirection: undefined }),
  );
});
```

Import `AssetOrder` at the top if not already imported.

**Step 2: Run tests to verify they fail**

```bash
cd server && pnpm test -- --run src/services/search.service.spec.ts
```

Expected: The `orderDirection` test fails — current code does not pass `orderDirection`.

**Step 3: Implement in service**

In `server/src/services/search.service.ts`, change line ~165:

```typescript
{ ...dto, userIds: await userIds, embedding },
```

to:

```typescript
{ ...dto, userIds: await userIds, embedding, orderDirection: dto.order },
```

**Step 4: Run tests to verify they pass**

```bash
cd server && pnpm test -- --run src/services/search.service.spec.ts
```

Expected: All tests pass.

**Step 5: Commit**

```
feat: pass order through to smart search repository
```

---

## Task 3: Backend — Two-phase CTE in searchSmart repository

**Files:**

- Modify: `server/src/repositories/search.repository.ts:329-359`

**Step 1: Implement CTE branch**

Replace the `searchSmart` method body. When `options.orderDirection` is set, use a CTE; otherwise keep current behavior.

```typescript
@GenerateSql({
  params: [
    { page: 1, size: 200 },
    {
      takenAfter: DummyValue.DATE,
      embedding: DummyValue.VECTOR,
      lensModel: DummyValue.STRING,
      withStacked: true,
      isFavorite: true,
      userIds: [DummyValue.UUID],
      spacePersonIds: [DummyValue.UUID],
      orderDirection: 'desc',
    },
  ],
})
searchSmart(pagination: SearchPaginationOptions, options: SmartSearchOptions) {
  if (!isValidInteger(pagination.size, { min: 1, max: 1000 })) {
    throw new Error(`Invalid value for 'size': ${pagination.size}`);
  }

  return this.db.transaction().execute(async (trx) => {
    await sql`set local vchordrq.probes = ${sql.lit(probes[VectorIndex.Clip])}`.execute(trx);

    const baseQuery = searchAssetBuilder(trx, options)
      .selectAll('asset')
      .innerJoin('smart_search', 'asset.id', 'smart_search.assetId')
      .orderBy(sql`smart_search.embedding <=> ${options.embedding}`);

    if (options.orderDirection) {
      const orderDirection = options.orderDirection.toLowerCase() as OrderByDirection;
      const candidates = baseQuery.limit(500);
      const items = await trx
        .selectFrom(candidates.as('candidates'))
        .selectAll()
        .orderBy('candidates.fileCreatedAt', sql`${sql.raw(orderDirection)} nulls last`)
        .limit(pagination.size + 1)
        .offset((pagination.page - 1) * pagination.size)
        .execute();
      return paginationHelper(items as any, pagination.size);
    }

    const items = await baseQuery
      .limit(pagination.size + 1)
      .offset((pagination.page - 1) * pagination.size)
      .execute();
    return paginationHelper(items, pagination.size);
  });
}
```

Note: The Kysely `.as('candidates')` wraps the inner query as a subquery/CTE. The `sql.raw(orderDirection)` is safe here because `orderDirection` is validated to be `'asc' | 'desc'` by the enum. If Kysely's `.orderBy` does not accept a raw direction with `nulls last` cleanly, use:

```typescript
.orderBy(sql`"candidates"."fileCreatedAt" ${sql.raw(orderDirection)} nulls last`)
```

Test the exact Kysely syntax during implementation — the key constraint is that `NULLS LAST` must be present and the direction must be parameterized.

**Step 2: Verify server builds**

```bash
cd server && pnpm build
```

**Step 3: Run existing search tests**

```bash
cd server && pnpm test -- --run src/services/search.service.spec.ts
```

Expected: All tests pass (including the ones added in Task 2).

**Step 4: Commit**

```
feat: two-phase CTE for date-sorted smart search
```

---

## Task 4: Frontend — Extend FilterState with 'relevance'

**Files:**

- Modify: `web/src/lib/components/filter-panel/filter-panel.ts:58,73`
- Modify: `web/src/lib/utils/photos-filter-options.ts:37`
- Test: `web/src/lib/components/filter-panel/__tests__/filter-state.spec.ts`
- Test: `web/src/lib/utils/__tests__/photos-filter-options.spec.ts`

**Step 1: Write failing tests**

In `web/src/lib/components/filter-panel/__tests__/filter-state.spec.ts`, add:

```typescript
it('should preserve relevance sortOrder on clearFilters', () => {
  const state = createFilterState();
  state.sortOrder = 'relevance';
  const cleared = clearFilters(state);
  expect(cleared.sortOrder).toBe('relevance');
});
```

In `web/src/lib/utils/__tests__/photos-filter-options.spec.ts`, add:

```typescript
it('should default to desc order when sortOrder is relevance', () => {
  const filters = { ...createFilterState(), sortOrder: 'relevance' as const };
  const options = buildPhotosTimelineOptions(filters);
  expect(options.order).toBe(AssetOrder.Desc);
});
```

**Step 2: Run tests to verify they fail**

```bash
cd web && pnpm test -- --run src/lib/components/filter-panel/__tests__/filter-state.spec.ts
cd web && pnpm test -- --run src/lib/utils/__tests__/photos-filter-options.spec.ts
```

Expected: TypeScript error on `'relevance'` — not assignable to `'asc' | 'desc'`.

**Step 3: Extend the type**

In `web/src/lib/components/filter-panel/filter-panel.ts`, change line 58:

```typescript
sortOrder: 'asc' | 'desc';
```

to:

```typescript
sortOrder: 'asc' | 'desc' | 'relevance';
```

`createFilterState()` stays unchanged (returns `'desc'`).

**Step 4: Update photos-filter-options.ts**

In `web/src/lib/utils/photos-filter-options.ts`, change line 37:

```typescript
base.order = filters.sortOrder === 'asc' ? AssetOrder.Asc : AssetOrder.Desc;
```

to:

```typescript
if (filters.sortOrder === 'asc') {
  base.order = AssetOrder.Asc;
} else {
  base.order = AssetOrder.Desc;
}
```

This explicitly maps both `'desc'` and `'relevance'` to `AssetOrder.Desc` for the timeline.

**Step 5: Run tests to verify they pass**

```bash
cd web && pnpm test -- --run src/lib/components/filter-panel/__tests__/filter-state.spec.ts
cd web && pnpm test -- --run src/lib/utils/__tests__/photos-filter-options.spec.ts
```

Expected: All pass.

**Step 6: Commit**

```
feat: extend FilterState.sortOrder with 'relevance'
```

---

## Task 5: Frontend — Add order and isFavorite to buildSmartSearchParams

**Files:**

- Modify: `web/src/lib/utils/space-search.ts`
- Test: `web/src/lib/utils/space-search.spec.ts`

**Step 1: Write failing tests**

In `web/src/lib/utils/space-search.spec.ts`, add:

```typescript
it('should set order to Asc when sortOrder is asc', () => {
  const filters = { ...createFilterState(), sortOrder: 'asc' as const };
  const result = buildSmartSearchParams('test', 'space-1', filters);
  expect(result.order).toBe(AssetOrder.Asc);
});

it('should set order to Desc when sortOrder is desc', () => {
  const filters = { ...createFilterState(), sortOrder: 'desc' as const };
  const result = buildSmartSearchParams('test', 'space-1', filters);
  expect(result.order).toBe(AssetOrder.Desc);
});

it('should not set order when sortOrder is relevance', () => {
  const filters = { ...createFilterState(), sortOrder: 'relevance' as const };
  const result = buildSmartSearchParams('test', 'space-1', filters);
  expect(result.order).toBeUndefined();
});

it('should map isFavorite filter', () => {
  const filters = { ...createFilterState(), isFavorite: true };
  const result = buildSmartSearchParams('test', 'space-1', filters);
  expect(result.isFavorite).toBe(true);
});

it('should not include isFavorite when undefined', () => {
  const result = buildSmartSearchParams('test', 'space-1', createFilterState());
  expect(result.isFavorite).toBeUndefined();
});
```

Also update the existing "should handle all filters active simultaneously" test (line ~114) to
include the new fields:

```typescript
it('should handle all filters active simultaneously', () => {
  const filters = {
    ...createFilterState(),
    personIds: ['p-1'],
    city: 'Tokyo',
    country: 'Japan',
    make: 'Sony',
    model: 'A7IV',
    tagIds: ['t-1', 't-2'],
    rating: 5,
    mediaType: 'video' as const,
    selectedYear: 2025,
    selectedMonth: 3,
    sortOrder: 'desc' as const,
    isFavorite: true,
  };
  const result = buildSmartSearchParams('cherry blossoms', 'space-1', filters);
  expect(result.query).toBe('cherry blossoms');
  expect(result.spaceId).toBe('space-1');
  expect(result.spacePersonIds).toEqual(['p-1']);
  expect(result.city).toBe('Tokyo');
  expect(result.country).toBe('Japan');
  expect(result.make).toBe('Sony');
  expect(result.model).toBe('A7IV');
  expect(result.tagIds).toEqual(['t-1', 't-2']);
  expect(result.rating).toBe(5);
  expect(result.type).toBe(AssetTypeEnum.Video);
  expect(result.takenAfter).toBeDefined();
  expect(result.takenBefore).toBeDefined();
  expect(result.order).toBe(AssetOrder.Desc);
  expect(result.isFavorite).toBe(true);
});
```

Add `import { AssetOrder } from '@immich/sdk';` to the imports if not present.

**Step 2: Run tests to verify they fail**

```bash
cd web && pnpm test -- --run src/lib/utils/space-search.spec.ts
```

Expected: The new tests fail because `order` and `isFavorite` are not mapped. The updated
"all filters" test also fails on the new assertions.

**Step 3: Implement**

In `web/src/lib/utils/space-search.ts`, add after the temporal filter block (before `return params`):

```typescript
if (filters.sortOrder === 'asc') {
  params.order = AssetOrder.Asc;
} else if (filters.sortOrder === 'desc') {
  params.order = AssetOrder.Desc;
}

if (filters.isFavorite !== undefined) {
  params.isFavorite = filters.isFavorite;
}
```

Add `AssetOrder` to the imports from `@immich/sdk`.

**Step 4: Run tests to verify they pass**

```bash
cd web && pnpm test -- --run src/lib/utils/space-search.spec.ts
```

Expected: All pass.

**Step 5: Commit**

```
feat: pass sort order and isFavorite in space search params
```

---

## Task 6: Frontend — Space page sort behavior (entry/exit/reset/$effect)

**Files:**

- Modify: `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.svelte`

This task modifies the space page to:

1. Set `sortOrder` to `'relevance'` on search entry
2. Reset `sortOrder` to `'desc'` on search clear
3. Add `sortOrder` and `isFavorite` to `$effect` dependency array
4. Update timeline options builder for `'relevance'` fallback

Note: SortToggle type narrowing is deferred to Task 8 where the full conditional replacement
happens, to avoid throwaway code.

**Step 1: Update `handleSearchSubmit`**

Find `handleSearchSubmit` (~line 631):

```typescript
const handleSearchSubmit = () => {
  searchPage = 1;
  void executeSearch(1, false);
};
```

Change to:

```typescript
const handleSearchSubmit = () => {
  filters = { ...filters, sortOrder: 'relevance' };
  searchPage = 1;
  void executeSearch(1, false);
};
```

**Step 2: Update `clearSearch`**

Find `clearSearch` (~line 640):

```typescript
const clearSearch = () => {
  searchAbortController?.abort();
  searchQuery = '';
  searchResults = [];
  showSearchResults = false;
  searchPage = 1;
  hasMoreResults = false;
  isSearching = false;
};
```

Add sort reset:

```typescript
const clearSearch = () => {
  searchAbortController?.abort();
  searchQuery = '';
  searchResults = [];
  showSearchResults = false;
  searchPage = 1;
  hasMoreResults = false;
  isSearching = false;
  filters = { ...filters, sortOrder: 'desc' };
};
```

**Step 3: Add `sortOrder` and `isFavorite` to `$effect` dependency array**

Find the `$effect` at ~line 650 that tracks filter changes for re-search. Add `filters.sortOrder` and `filters.isFavorite` to the tracked array:

```typescript
$effect(() => {
  const _ = [
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
  // ... rest unchanged
});
```

**Step 4: Update timeline options builder for `'relevance'` fallback**

Find ~line 315:

```typescript
base.order = filters.sortOrder === 'asc' ? AssetOrder.Asc : AssetOrder.Desc;
```

Change to:

```typescript
if (filters.sortOrder === 'asc') {
  base.order = AssetOrder.Asc;
} else {
  base.order = AssetOrder.Desc;
}
```

**Step 5: Type check**

```bash
cd web && npx svelte-check --tsconfig tsconfig.json 2>&1 | head -50
```

Expected: No errors in the modified file.

**Step 6: Commit**

```
feat: space page sort entry/exit/reset behavior
```

---

## Task 7: Frontend — Sort dropdown component for search results

**Files:**

- Create: `web/src/lib/components/filter-panel/search-sort-dropdown.svelte`
- Create: `web/src/lib/components/filter-panel/__tests__/search-sort-dropdown.spec.ts`

**Step 1: Write failing tests**

Create `web/src/lib/components/filter-panel/__tests__/search-sort-dropdown.spec.ts`:

```typescript
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import SearchSortDropdown from '../search-sort-dropdown.svelte';

describe('SearchSortDropdown', () => {
  it('should render with current sort mode label', () => {
    render(SearchSortDropdown, {
      props: { sortOrder: 'relevance', onSelect: vi.fn() },
    });
    expect(screen.getByTestId('search-sort-btn')).toHaveTextContent('Relevance');
  });

  it('should show Newest first label for desc', () => {
    render(SearchSortDropdown, {
      props: { sortOrder: 'desc', onSelect: vi.fn() },
    });
    expect(screen.getByTestId('search-sort-btn')).toHaveTextContent('Newest first');
  });

  it('should show Oldest first label for asc', () => {
    render(SearchSortDropdown, {
      props: { sortOrder: 'asc', onSelect: vi.fn() },
    });
    expect(screen.getByTestId('search-sort-btn')).toHaveTextContent('Oldest first');
  });

  it('should open dropdown and show all options on click', async () => {
    render(SearchSortDropdown, {
      props: { sortOrder: 'relevance', onSelect: vi.fn() },
    });
    await userEvent.click(screen.getByTestId('search-sort-btn'));
    expect(screen.getByText('Relevance')).toBeInTheDocument();
    expect(screen.getByText('Newest first')).toBeInTheDocument();
    expect(screen.getByText('Oldest first')).toBeInTheDocument();
  });

  it('should call onSelect with correct value', async () => {
    const onSelect = vi.fn();
    render(SearchSortDropdown, {
      props: { sortOrder: 'relevance', onSelect },
    });
    await userEvent.click(screen.getByTestId('search-sort-btn'));
    await userEvent.click(screen.getByText('Newest first'));
    expect(onSelect).toHaveBeenCalledWith('desc');
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
cd web && pnpm test -- --run src/lib/components/filter-panel/__tests__/search-sort-dropdown.spec.ts
```

Expected: Fail — component does not exist.

**Step 3: Create the component**

Create `web/src/lib/components/filter-panel/search-sort-dropdown.svelte`:

```svelte
<script lang="ts">
  import { Icon } from '@immich/ui';
  import { mdiChevronDown, mdiMagnify, mdiSortCalendarAscending, mdiSortCalendarDescending } from '@mdi/js';

  type SortMode = 'relevance' | 'asc' | 'desc';

  interface Props {
    sortOrder: SortMode;
    onSelect: (mode: SortMode) => void;
  }

  let { sortOrder, onSelect }: Props = $props();
  let open = $state(false);

  const options: { value: SortMode; label: string; icon: string }[] = [
    { value: 'relevance', label: 'Relevance', icon: mdiMagnify },
    { value: 'desc', label: 'Newest first', icon: mdiSortCalendarDescending },
    { value: 'asc', label: 'Oldest first', icon: mdiSortCalendarAscending },
  ];

  let currentOption = $derived(options.find((o) => o.value === sortOrder) ?? options[0]);

  function handleSelect(value: SortMode) {
    open = false;
    onSelect(value);
  }

  function handleClickOutside(event: MouseEvent) {
    if (!(event.target as HTMLElement).closest('[data-testid="search-sort-container"]')) {
      open = false;
    }
  }
</script>

<svelte:window onclick={handleClickOutside} />

<div class="relative" data-testid="search-sort-container">
  <button
    type="button"
    class="flex items-center gap-1 rounded-full px-3 py-1.5 text-sm text-gray-500 hover:bg-subtle dark:text-gray-400"
    data-testid="search-sort-btn"
    onclick={() => (open = !open)}
  >
    <Icon icon={currentOption.icon} size="16" />
    <span>{currentOption.label}</span>
    <Icon icon={mdiChevronDown} size="14" />
  </button>

  {#if open}
    <div
      class="absolute right-0 top-full z-10 mt-1 min-w-[160px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800"
    >
      {#each options as option (option.value)}
        <button
          type="button"
          class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
          class:font-semibold={option.value === sortOrder}
          onclick={() => handleSelect(option.value)}
        >
          <Icon icon={option.icon} size="16" />
          <span>{option.label}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>
```

**Step 4: Run tests to verify they pass**

```bash
cd web && pnpm test -- --run src/lib/components/filter-panel/__tests__/search-sort-dropdown.spec.ts
```

Expected: All pass.

**Step 5: Commit**

```
feat: search sort dropdown component
```

---

## Task 8: Frontend — Wire sort dropdown into space page

**Files:**

- Modify: `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.svelte`

**Step 1: Import the component**

Add to imports:

```typescript
import SearchSortDropdown from '$lib/components/filter-panel/search-sort-dropdown.svelte';
```

**Step 2: Replace SortToggle conditional with sort dropdown + type narrowing**

Find the `SortToggle` block (~line 743):

```svelte
{#if !showSearchResults}
  <SortToggle
    sortOrder={filters.sortOrder}
    onToggle={(order) => {
      filters = { ...filters, sortOrder: order };
    }}
  />
{/if}
```

Replace with:

```svelte
{#if showSearchResults}
  <SearchSortDropdown
    sortOrder={filters.sortOrder}
    onSelect={(mode) => {
      filters = { ...filters, sortOrder: mode };
    }}
  />
{:else}
  <SortToggle
    sortOrder={filters.sortOrder === 'relevance' ? 'desc' : filters.sortOrder}
    onToggle={(order) => {
      filters = { ...filters, sortOrder: order };
    }}
  />
{/if}
```

**Step 3: Type check**

```bash
cd web && npx svelte-check --tsconfig tsconfig.json 2>&1 | head -50
```

**Step 4: Commit**

```
feat: wire sort dropdown into space search UI
```

---

## Task 9: Frontend — Infinite scroll in SpaceSearchResults

**Files:**

- Modify: `web/src/lib/components/spaces/space-search-results.svelte`
- Test: `web/src/lib/components/spaces/space-search-results.spec.ts`

**Step 1: Update tests**

In `space-search-results.spec.ts`, update the load-more tests. Remove the button-specific tests and add sentinel tests:

Replace the "should show load more button" and "should disable load more button" and "should call onLoadMore when button clicked" tests with:

```typescript
it('should render scroll sentinel when hasMore is true', () => {
  render(SpaceSearchResults, {
    props: {
      results: mockAssets,
      isLoading: false,
      hasMore: true,
      totalLoaded: 100,
      onLoadMore: vi.fn(),
      sortMode: 'relevance',
    },
  });
  expect(screen.getByTestId('scroll-sentinel')).toBeInTheDocument();
});

it('should not render scroll sentinel when hasMore is false', () => {
  render(SpaceSearchResults, {
    props: {
      results: mockAssets,
      isLoading: false,
      hasMore: false,
      totalLoaded: 3,
      onLoadMore: vi.fn(),
      sortMode: 'relevance',
    },
  });
  expect(screen.queryByTestId('scroll-sentinel')).not.toBeInTheDocument();
});
```

Also update all existing test `props` to include `sortMode: 'relevance'` (the new required prop).

**Note:** The test environment (`happy-dom`) may not provide `IntersectionObserver`. The project
has a mock at `web/src/lib/__mocks__/intersection-observer.mock.ts`. If tests fail with
"IntersectionObserver is not defined", import the mock at the top of the spec file or add it to
the vitest setup. Check the existing `people-infinite-scroll.svelte` tests to see how they handle
this — the mock auto-registers via the setup file.

**Step 2: Run tests to verify they fail**

```bash
cd web && pnpm test -- --run src/lib/components/spaces/space-search-results.spec.ts
```

**Step 3: Implement infinite scroll**

In `space-search-results.svelte`, update the Props interface and add the IntersectionObserver:

```svelte
<script lang="ts">
  import { page } from '$app/state';
  import LoadingSpinner from '$lib/components/shared-components/LoadingSpinner.svelte';
  import Portal from '$lib/elements/Portal.svelte';
  import type { AssetCursor } from '$lib/components/asset-viewer/asset-viewer.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { handlePromiseError } from '$lib/utils';
  import { navigate } from '$lib/utils/navigation';
  import { type AssetResponseDto, getAssetInfo } from '@immich/sdk';
  import { t } from 'svelte-i18n';

  interface Props {
    results: AssetResponseDto[];
    isLoading: boolean;
    hasMore: boolean;
    totalLoaded: number;
    onLoadMore: () => void;
    spaceId?: string;
    sortMode: 'relevance' | 'asc' | 'desc';
  }

  let { results, isLoading, hasMore, totalLoaded, onLoadMore, spaceId, sortMode }: Props = $props();

  let isViewerOpen = $state(false);
  let sentinelElement: HTMLElement | undefined = $state();

  // Infinite scroll observer
  const observer = new IntersectionObserver((entries) => {
    if (entries[0]?.isIntersecting && hasMore && !isLoading) {
      onLoadMore();
    }
  });

  $effect(() => {
    if (sentinelElement) {
      observer.disconnect();
      observer.observe(sentinelElement);
    }
  });

  // ... keep existing getFullAsset, buildCursor, openAsset, $effect for URL, handleClose ...
```

Replace the template's load-more button section. Find:

```svelte
{#if hasMore}
  <div class="mt-4 flex justify-center">
    <button
      type="button"
      data-testid="load-more-btn"
      disabled={isLoading}
      onclick={onLoadMore}
      class="rounded-lg bg-immich-primary px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-immich-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {$t('spaces_load_more')}
    </button>
  </div>
{/if}
```

Replace with:

```svelte
{#if hasMore}
  <div bind:this={sentinelElement} data-testid="scroll-sentinel" class="flex justify-center py-4">
    {#if isLoading}
      <LoadingSpinner size="small" />
    {/if}
  </div>
{/if}
```

**Step 4: Run tests to verify they pass**

```bash
cd web && pnpm test -- --run src/lib/components/spaces/space-search-results.spec.ts
```

**Step 5: Commit**

```
feat: infinite scroll in space search results
```

---

## Task 10: Frontend — Date-grouped display and result count

**Files:**

- Modify: `web/src/lib/components/spaces/space-search-results.svelte`
- Test: `web/src/lib/components/spaces/space-search-results.spec.ts`

**Step 1: Write failing tests for date grouping**

In `space-search-results.spec.ts`, add mock assets with dates and tests:

```typescript
const mockAssetsWithDates = [
  { id: 'a1', originalFileName: 'p1.jpg', fileCreatedAt: '2024-06-15T10:00:00.000Z' },
  { id: 'a2', originalFileName: 'p2.jpg', fileCreatedAt: '2024-06-10T10:00:00.000Z' },
  { id: 'a3', originalFileName: 'p3.jpg', fileCreatedAt: '2024-03-01T10:00:00.000Z' },
] as AssetResponseDto[];

it('should show date headers when sortMode is desc', () => {
  render(SpaceSearchResults, {
    props: {
      results: mockAssetsWithDates,
      isLoading: false,
      hasMore: false,
      totalLoaded: 3,
      onLoadMore: vi.fn(),
      sortMode: 'desc',
    },
  });
  expect(screen.getByTestId('date-group-header-0')).toHaveTextContent('June 2024');
  expect(screen.getByTestId('date-group-header-1')).toHaveTextContent('March 2024');
});

it('should not show date headers when sortMode is relevance', () => {
  render(SpaceSearchResults, {
    props: {
      results: mockAssetsWithDates,
      isLoading: false,
      hasMore: false,
      totalLoaded: 3,
      onLoadMore: vi.fn(),
      sortMode: 'relevance',
    },
  });
  expect(screen.queryByTestId('date-group-header-0')).not.toBeInTheDocument();
});

it('should show contextual result count for date-sorted mode', () => {
  render(SpaceSearchResults, {
    props: {
      results: mockAssetsWithDates,
      isLoading: false,
      hasMore: true,
      totalLoaded: 100,
      onLoadMore: vi.fn(),
      sortMode: 'desc',
    },
  });
  expect(screen.getByTestId('result-count')).toHaveTextContent('100 of up to 500');
});
```

**Step 2: Run tests to verify they fail**

```bash
cd web && pnpm test -- --run src/lib/components/spaces/space-search-results.spec.ts
```

**Step 3: Implement date grouping and result count**

Add grouping logic and update the template in `space-search-results.svelte`.

After the Props destructuring, add the grouping logic:

```typescript
type DateGroup = { label: string; assets: AssetResponseDto[] };

const groupByMonth = (assets: AssetResponseDto[]): DateGroup[] => {
  const groups = new Map<string, AssetResponseDto[]>();
  for (const asset of assets) {
    const date = asset.fileCreatedAt ? new Date(asset.fileCreatedAt) : undefined;
    const key = date ? `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}` : 'unknown';
    const label = date
      ? date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', timeZone: 'UTC' })
      : 'Unknown date';
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(asset);
  }
  return [...groups.entries()].map(([, assets]) => {
    const first = assets[0];
    const date = first.fileCreatedAt ? new Date(first.fileCreatedAt) : undefined;
    const label = date
      ? date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', timeZone: 'UTC' })
      : 'Unknown date';
    return { label, assets };
  });
};

let dateGroups = $derived(sortMode !== 'relevance' ? groupByMonth(results) : []);
```

Update the template — replace the flat grid section:

```svelte
{:else}
  <div class="mb-4 flex items-center gap-2">
    <span class="text-sm text-gray-500 dark:text-gray-400" data-testid="result-count">
      {#if sortMode === 'relevance'}
        {totalLoaded}{hasMore ? '+' : ''} result{totalLoaded === 1 && !hasMore ? '' : 's'}
      {:else}
        {totalLoaded}{hasMore ? ` of up to 500` : ''} result{totalLoaded === 1 && !hasMore ? '' : 's'}
      {/if}
    </span>
    {#if isLoading}
      <LoadingSpinner size="small" />
    {/if}
  </div>

  {#if sortMode === 'relevance'}
    <div class="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-1">
      {#each results as asset (asset.id)}
        <button type="button" class="aspect-square cursor-pointer overflow-hidden rounded" onclick={() => openAsset(asset)}>
          <img src="/api/assets/{asset.id}/thumbnail" alt={asset.originalFileName} class="h-full w-full object-cover" />
        </button>
      {/each}
    </div>
  {:else}
    {#each dateGroups as group, i (group.label)}
      <h3 class="mb-2 mt-4 text-sm font-medium text-gray-500 first:mt-0 dark:text-gray-400" data-testid="date-group-header-{i}">
        {group.label}
      </h3>
      <div class="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-1">
        {#each group.assets as asset (asset.id)}
          <button type="button" class="aspect-square cursor-pointer overflow-hidden rounded" onclick={() => openAsset(asset)}>
            <img src="/api/assets/{asset.id}/thumbnail" alt={asset.originalFileName} class="h-full w-full object-cover" />
          </button>
        {/each}
      </div>
    {/each}
  {/if}

  {#if hasMore}
    <div bind:this={sentinelElement} data-testid="scroll-sentinel" class="flex justify-center py-4">
      {#if isLoading}
        <LoadingSpinner size="small" />
      {/if}
    </div>
  {/if}
{/if}
```

**Step 4: Run tests**

```bash
cd web && pnpm test -- --run src/lib/components/spaces/space-search-results.spec.ts
```

**Step 5: Commit**

```
feat: date-grouped display and contextual result count
```

---

## Task 11: Frontend — Pass sortMode to SpaceSearchResults from space page

**Files:**

- Modify: `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.svelte`

**Step 1: Update the SpaceSearchResults usage**

Find the `SpaceSearchResults` usage (~line 861):

```svelte
<SpaceSearchResults
  results={searchResults}
  isLoading={isSearching}
  hasMore={hasMoreResults}
  totalLoaded={searchResults.length}
  onLoadMore={handleLoadMore}
  spaceId={space.id}
/>
```

Add `sortMode`:

```svelte
<SpaceSearchResults
  results={searchResults}
  isLoading={isSearching}
  hasMore={hasMoreResults}
  totalLoaded={searchResults.length}
  onLoadMore={handleLoadMore}
  spaceId={space.id}
  sortMode={filters.sortOrder}
/>
```

**Step 2: Type check**

```bash
cd web && npx svelte-check --tsconfig tsconfig.json 2>&1 | head -50
```

**Step 3: Commit**

```
feat: pass sortMode to SpaceSearchResults
```

---

## Task 12: Code generation and final verification

**Files:**

- Regenerated: `open-api/typescript-sdk/`, `mobile/openapi/`, `server/src/queries/`

**Step 1: Build server**

```bash
cd server && pnpm build
```

**Step 2: Regenerate OpenAPI specs**

```bash
cd server && pnpm sync:open-api
```

**Step 3: Regenerate TypeScript SDK and Dart client**

```bash
make open-api
```

**Step 4: Regenerate SQL queries**

```bash
make sql
```

**Step 5: Run all server tests**

```bash
cd server && pnpm test -- --run
```

**Step 6: Run all web tests**

```bash
cd web && pnpm test -- --run
```

**Step 7: Type check both**

```bash
make check-server && make check-web
```

**Step 8: Commit all generated files**

```
chore: regenerate OpenAPI specs, SDK, and SQL queries
```

---

## Task 13: Update existing tests for new sortMode prop

**Files:**

- Modify: `web/src/lib/components/spaces/space-search-results.spec.ts`

The existing tests for `SpaceSearchResults` need the new `sortMode` prop. This was partially
addressed in Tasks 9 and 10, but verify all test cases pass and any remaining ones that don't
include `sortMode` are updated.

Also update the "should show result count with + when more pages exist" test — if `sortMode` is
`'relevance'`, the behavior should be unchanged (`100+ results`). Add a companion test for
date-sorted mode showing `"100 of up to 500"`.

**Step 1: Run full test suite**

```bash
cd web && pnpm test -- --run src/lib/components/spaces/space-search-results.spec.ts
```

Fix any failing tests by adding `sortMode: 'relevance'` to props that are missing it.

**Step 2: Commit**

```
test: update SpaceSearchResults tests for sortMode prop
```

---

## Task 14: E2E tests for search sorting and pagination

**Files:**

- Create: `e2e/src/api/specs/search-sorting.e2e-spec.ts` (or add to existing search spec)

E2E tests require a running server with ML disabled and test assets seeded into a shared space.
Check existing E2E test patterns in `e2e/src/api/specs/` for setup conventions (user creation,
space creation, asset upload).

**Step 1: Write E2E tests**

```typescript
describe('Smart search sorting', () => {
  // Setup: create a shared space, upload 3+ assets with known dates

  it('should return results in date-descending order when order=desc', async () => {
    const { assets } = await searchSmart({
      smartSearchDto: { query: 'test', spaceId, order: AssetOrder.Desc },
    });
    const dates = assets.items.map((a) => new Date(a.fileCreatedAt).getTime());
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i]).toBeLessThanOrEqual(dates[i - 1]);
    }
  });

  it('should return results in similarity order when order is omitted', async () => {
    const { assets } = await searchSmart({
      smartSearchDto: { query: 'test', spaceId },
    });
    // Verify results are returned (similarity order can't be easily asserted
    // without knowing embeddings, but we verify the endpoint works without order)
    expect(assets.items.length).toBeGreaterThan(0);
  });

  it('should paginate date-sorted results', async () => {
    const page1 = await searchSmart({
      smartSearchDto: { query: 'test', spaceId, order: AssetOrder.Desc, size: 2, page: 1 },
    });
    expect(page1.assets.items).toHaveLength(2);
    expect(page1.assets.nextPage).not.toBeNull();

    const page2 = await searchSmart({
      smartSearchDto: { query: 'test', spaceId, order: AssetOrder.Desc, size: 2, page: 2 },
    });
    expect(page2.assets.items.length).toBeGreaterThan(0);

    // No overlap between pages
    const page1Ids = new Set(page1.assets.items.map((a) => a.id));
    for (const asset of page2.assets.items) {
      expect(page1Ids.has(asset.id)).toBe(false);
    }
  });
});
```

**Note:** These tests require the ML service to be available for CLIP encoding, or test assets
that already have embeddings seeded. If the E2E environment runs without ML, these tests may
need to be skipped or placed in a separate suite. Check `e2e/` setup to determine feasibility.

**Step 2: Run E2E tests**

```bash
cd e2e && pnpm test -- --run src/api/specs/search-sorting.e2e-spec.ts
```

**Step 3: Commit**

```
test: e2e tests for search sorting and pagination
```

---

## Summary

| Task | Description                                            | Type     |
| ---- | ------------------------------------------------------ | -------- |
| 1    | Add `order` to SmartSearchDto + SmartSearchOptions     | Backend  |
| 2    | Service passes order through (TDD)                     | Backend  |
| 3    | Two-phase CTE in repository                            | Backend  |
| 4    | Extend FilterState with `'relevance'` (TDD)            | Frontend |
| 5    | Add order + isFavorite to buildSmartSearchParams (TDD) | Frontend |
| 6    | Space page sort entry/exit/reset/$effect               | Frontend |
| 7    | Sort dropdown component (TDD)                          | Frontend |
| 8    | Wire dropdown + SortToggle narrowing into space page   | Frontend |
| 9    | Infinite scroll (TDD)                                  | Frontend |
| 10   | Date-grouped display + result count (TDD)              | Frontend |
| 11   | Pass sortMode prop                                     | Frontend |
| 12   | Code generation + full verification                    | Codegen  |
| 13   | Update existing tests                                  | Tests    |
| 14   | E2E tests for sorting + pagination                     | E2E      |
