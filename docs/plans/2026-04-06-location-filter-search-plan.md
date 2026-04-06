# Location Filter Search Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a search input to the Location filter that filters countries client-side, matching the existing People/Tags search pattern.

**Architecture:** Pure frontend change. Add search state, derived filtering/truncation, and search input markup to `location-filter.svelte`. No server changes — countries are already fully loaded client-side.

**Tech Stack:** Svelte 5 (runes), @immich/ui Icon component, Vitest + @testing-library/svelte

**Design doc:** `docs/plans/2026-04-06-location-filter-search-design.md`

---

### Task 1: Write failing tests for search filtering

**Files:**

- Test: `web/src/lib/components/filter-panel/__tests__/filter-sections.spec.ts`

**Step 1: Add test data and 11 new tests**

Inside the existing `describe('LocationFilter')` block, add a new country list and all 11 tests. The tests use the existing `mockCityFetch` helper.

```typescript
// --- Search tests ---
const manyCountries = [
  'Argentina',
  'Australia',
  'Brazil',
  'Canada',
  'China',
  'France',
  'Germany',
  'India',
  'Italy',
  'Japan',
  'Mexico',
  'Spain',
];

it('should filter countries via search input', async () => {
  const { getByTestId, queryByTestId } = render(LocationFilter, {
    props: {
      countries: manyCountries,
      onCityFetch: mockCityFetch,
      onSelectionChange: () => {},
    },
  });

  const searchInput = getByTestId('location-search-input');
  await fireEvent.input(searchInput, { target: { value: 'Ger' } });

  expect(queryByTestId('location-country-Germany')).toBeTruthy();
  expect(queryByTestId('location-country-France')).toBeNull();
  expect(queryByTestId('location-country-Italy')).toBeNull();
});

it('should search case-insensitively', async () => {
  const { getByTestId, queryByTestId } = render(LocationFilter, {
    props: {
      countries: manyCountries,
      onCityFetch: mockCityFetch,
      onSelectionChange: () => {},
    },
  });

  const searchInput = getByTestId('location-search-input');
  await fireEvent.input(searchInput, { target: { value: 'germany' } });

  expect(queryByTestId('location-country-Germany')).toBeTruthy();
});

it('should show all search results without truncation', async () => {
  const { getByTestId, queryByTestId } = render(LocationFilter, {
    props: {
      countries: manyCountries,
      onCityFetch: mockCityFetch,
      onSelectionChange: () => {},
    },
  });

  const searchInput = getByTestId('location-search-input');
  // "an" matches 6 countries — all shown regardless of search
  await fireEvent.input(searchInput, { target: { value: 'an' } });

  expect(queryByTestId('location-country-Argentina')).toBeTruthy();
  expect(queryByTestId('location-country-Canada')).toBeTruthy();
  expect(queryByTestId('location-country-France')).toBeTruthy();
  expect(queryByTestId('location-country-Germany')).toBeTruthy();
  expect(queryByTestId('location-country-Japan')).toBeTruthy();
  expect(queryByTestId('location-country-Spain')).toBeTruthy();
  // Non-matches hidden
  expect(queryByTestId('location-country-Brazil')).toBeNull();
  expect(queryByTestId('location-country-China')).toBeNull();
});

it('should show "Show N more" when list exceeds 10 countries', () => {
  const { getByTestId, queryByTestId } = render(LocationFilter, {
    props: {
      countries: manyCountries,
      onCityFetch: mockCityFetch,
      onSelectionChange: () => {},
    },
  });

  // First 10 should be visible
  expect(queryByTestId('location-country-Argentina')).toBeTruthy();
  expect(queryByTestId('location-country-Japan')).toBeTruthy();
  // 11th and 12th should be hidden
  expect(queryByTestId('location-country-Mexico')).toBeNull();
  expect(queryByTestId('location-country-Spain')).toBeNull();

  const showMore = getByTestId('location-show-more');
  expect(showMore.textContent).toContain('Show 2 more');
});

it('should expand list when "Show N more" is clicked', async () => {
  const { getByTestId, queryByTestId } = render(LocationFilter, {
    props: {
      countries: manyCountries,
      onCityFetch: mockCityFetch,
      onSelectionChange: () => {},
    },
  });

  await fireEvent.click(getByTestId('location-show-more'));

  expect(queryByTestId('location-country-Mexico')).toBeTruthy();
  expect(queryByTestId('location-country-Spain')).toBeTruthy();
});

it('should show "No matching locations" for empty search results', async () => {
  const { getByTestId } = render(LocationFilter, {
    props: {
      countries: manyCountries,
      onCityFetch: mockCityFetch,
      onSelectionChange: () => {},
    },
  });

  const searchInput = getByTestId('location-search-input');
  await fireEvent.input(searchInput, { target: { value: 'zzzzz' } });

  expect(getByTestId('location-no-results').textContent).toBe('No matching locations');
});

it('should keep orphaned country visible during search', async () => {
  const { getByTestId, queryByTestId } = render(LocationFilter, {
    props: {
      countries: mockCountries, // Germany, Italy, France
      selectedCountry: 'Switzerland', // Not in list = orphaned
      onCityFetch: mockCityFetch,
      onSelectionChange: () => {},
    },
  });

  const searchInput = getByTestId('location-search-input');
  await fireEvent.input(searchInput, { target: { value: 'Italy' } });

  // Orphaned country still visible
  expect(queryByTestId('location-country-Switzerland')).toBeTruthy();
  // Matched country visible
  expect(queryByTestId('location-country-Italy')).toBeTruthy();
  // Non-matched countries hidden
  expect(queryByTestId('location-country-Germany')).toBeNull();
});

it('should preserve selected country across search/clear cycle', async () => {
  const { getByTestId, queryByTestId } = render(LocationFilter, {
    props: {
      countries: mockCountries,
      selectedCountry: 'Germany',
      onCityFetch: mockCityFetch,
      onSelectionChange: () => {},
    },
  });

  const searchInput = getByTestId('location-search-input');

  // Search hides Germany
  await fireEvent.input(searchInput, { target: { value: 'Italy' } });
  expect(queryByTestId('location-country-Germany')).toBeNull();

  // Clear search — Germany reappears
  await fireEvent.input(searchInput, { target: { value: '' } });
  expect(queryByTestId('location-country-Germany')).toBeTruthy();
});

it('should show cities when searching for a country and clicking it', async () => {
  const { getByTestId, queryByTestId } = render(LocationFilter, {
    props: {
      countries: mockCountries,
      onCityFetch: mockCityFetch,
      onSelectionChange: () => {},
    },
  });

  const searchInput = getByTestId('location-search-input');
  await fireEvent.input(searchInput, { target: { value: 'Germany' } });
  await fireEvent.click(getByTestId('location-country-Germany'));

  await waitFor(() => {
    expect(queryByTestId('location-city-Munich')).toBeTruthy();
    expect(queryByTestId('location-city-Berlin')).toBeTruthy();
    expect(queryByTestId('location-city-Hamburg')).toBeTruthy();
  });
});

it('should not show search input when no countries exist', () => {
  const { queryByTestId } = render(LocationFilter, {
    props: {
      countries: [],
      onCityFetch: mockCityFetch,
      onSelectionChange: () => {},
    },
  });

  expect(queryByTestId('location-search-input')).toBeNull();
  expect(queryByTestId('location-empty')).toBeTruthy();
});

it('should restore expanded country with cities after search is cleared', async () => {
  const { getByTestId, queryByTestId } = render(LocationFilter, {
    props: {
      countries: mockCountries,
      selectedCountry: 'Germany',
      onCityFetch: mockCityFetch,
      onSelectionChange: () => {},
    },
  });

  // Expand Germany to load cities
  await fireEvent.click(getByTestId('location-country-Germany'));
  await waitFor(() => {
    expect(queryByTestId('location-city-Munich')).toBeTruthy();
  });

  // Search hides Germany (and its cities)
  const searchInput = getByTestId('location-search-input');
  await fireEvent.input(searchInput, { target: { value: 'Italy' } });
  expect(queryByTestId('location-country-Germany')).toBeNull();
  expect(queryByTestId('location-city-Munich')).toBeNull();

  // Clear search — Germany and cities reappear
  await fireEvent.input(searchInput, { target: { value: '' } });
  expect(queryByTestId('location-country-Germany')).toBeTruthy();
  await waitFor(() => {
    expect(queryByTestId('location-city-Munich')).toBeTruthy();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd web && pnpm test -- --run src/lib/components/filter-panel/__tests__/filter-sections.spec.ts`

Expected: All 11 new tests FAIL (search input not found, show-more not found, etc.)

**Step 3: Commit failing tests**

```bash
git add web/src/lib/components/filter-panel/__tests__/filter-sections.spec.ts
git commit -m "test: add 11 failing tests for location filter search"
```

---

### Task 2: Implement search filtering in location-filter.svelte

**Files:**

- Modify: `web/src/lib/components/filter-panel/location-filter.svelte`

**Step 1: Add imports**

At the top of the `<script>` block, after the existing `FilterContext` import, add:

```typescript
import { Icon } from '@immich/ui';
import { mdiMagnify } from '@mdi/js';
```

**Step 2: Add state variables**

After the `emptyText` prop destructuring, add:

```typescript
let searchQuery = $state('');
let showAll = $state(false);

const INITIAL_SHOW_COUNT = 10;
```

**Step 3: Add search reset on countries change**

After the new state variables, add:

```typescript
// Clear search when countries list changes (e.g. temporal filter refetch)
let previousCountriesLength = 0;
$effect(() => {
  const currentLength = countries.length;
  if (previousCountriesLength > 0 && currentLength !== previousCountriesLength) {
    searchQuery = '';
    showAll = false;
  }
  previousCountriesLength = currentLength;
});
```

**Step 4: Add derived filtering and truncation**

After the reset effect, add:

```typescript
let filteredCountries = $derived(
  searchQuery.trim() ? countries.filter((c) => c.toLowerCase().includes(searchQuery.trim().toLowerCase())) : countries,
);

let visibleCountries = $derived(
  searchQuery.trim() || showAll ? filteredCountries : filteredCountries.slice(0, INITIAL_SHOW_COUNT),
);

let remainingCount = $derived(Math.max(0, filteredCountries.length - INITIAL_SHOW_COUNT));
```

**Step 5: Add search input markup**

In the template, inside the `{:else}` block, before the orphaned country block, add:

```svelte
    <!-- Search input -->
    <div class="relative mb-2">
      <div class="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500">
        <Icon icon={mdiMagnify} size="14" />
      </div>
      <input
        type="text"
        class="immich-form-input h-8 w-full rounded-lg pl-7 pr-2 text-sm"
        placeholder="Search locations..."
        bind:value={searchQuery}
        oninput={() => {
          showAll = false;
        }}
        data-testid="location-search-input"
      />
    </div>
```

**Step 6: Replace countries loop with visibleCountries**

Change the countries loop from:

```svelte
    {#each countries as country (country)}
```

to:

```svelte
    {#each visibleCountries as country (country)}
```

**Step 7: Add "No results" message**

After the orphaned country block and before the `{#each visibleCountries}` loop, add:

```svelte
    <!-- Empty search results -->
    {#if filteredCountries.length === 0 && searchQuery.trim()}
      <p class="text-sm text-gray-400 dark:text-gray-500" data-testid="location-no-results">
        No matching locations
      </p>
    {/if}
```

**Step 8: Add "Show more" button**

After the `{/each}` that closes the countries loop, add:

```svelte
    <!-- Show more link -->
    {#if !showAll && remainingCount > 0 && !searchQuery.trim()}
      <button
        type="button"
        class="py-1 text-xs font-medium text-immich-primary dark:text-immich-dark-primary"
        onclick={() => (showAll = true)}
        data-testid="location-show-more"
      >
        Show {remainingCount} more
      </button>
    {/if}
```

**Step 9: Run tests to verify they pass**

Run: `cd web && pnpm test -- --run src/lib/components/filter-panel/__tests__/filter-sections.spec.ts`

Expected: All tests PASS (existing + 11 new)

**Step 10: Run type check**

Run: `cd web && npx svelte-check --tsconfig ./tsconfig.json 2>&1 | tail -20`

Expected: No errors in `location-filter.svelte`

**Step 11: Commit**

```bash
git add web/src/lib/components/filter-panel/location-filter.svelte
git commit -m "feat: add search field to location filter"
```
