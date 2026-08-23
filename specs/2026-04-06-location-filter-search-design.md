# Location Filter Search

## Summary

Add a "Search locations..." input to the Location filter, identical in behavior to the existing People and Tags search fields. Filters countries client-side with case-insensitive substring matching, truncates at 10 items with a "Show more" button.

## Motivation

In a large photo archive spanning many countries, finding a specific location by scrolling through the full country list is impractical. People and Tags filters already have search fields — Location should follow the same pattern.

## Scope

- **Single file change:** `web/src/lib/components/filter-panel/location-filter.svelte`
- **Test additions:** `web/src/lib/components/filter-panel/__tests__/filter-sections.spec.ts`
- **No server changes.** Countries are already fully loaded client-side via the filter suggestions endpoint.
- **Out of scope:** Camera filter has the same gap but is a separate concern.

## Design

### Search Scope

Countries only. Cities remain lazy-loaded when a country is expanded. This avoids prefetching all cities and keeps the existing hierarchical interaction model intact.

City sub-lists are unaffected by the search query — they render based on `expandedCountry` state, not the search input. Searching "Germany" and clicking it will show all German cities (Berlin, Munich, etc.) even though they don't match the search text. If a country is expanded and the user types a search that hides it, the cities disappear with the country row. When the search is cleared, the country reappears with its cities still loaded (the `cities` array persists since `expandedCountry` hasn't changed).

### Behavior

| Scenario                                | Behavior                                                                                  |
| --------------------------------------- | ----------------------------------------------------------------------------------------- |
| User types in search                    | Countries filtered by case-insensitive substring match, all matches shown (no truncation) |
| Search cleared                          | Returns to truncated view (first 10 countries)                                            |
| No search matches                       | Shows "No matching locations" message                                                     |
| No countries at all                     | Shows existing "No locations found" message (unchanged)                                   |
| Orphaned country                        | Always visible above the list regardless of search query                                  |
| Selected country hidden by search       | Selection preserved; reappears with cities still loaded when search is cleared            |
| Search for country, click, expand       | Cities appear normally — search only filters country rows, not city sub-lists             |
| Country expanded, then hidden by search | Cities disappear with country row; reappear with cities when search is cleared            |
| Countries list changes (refetch)        | Search query auto-clears, `showAll` resets                                                |
| Section collapsed and re-expanded       | Search state cleared (component is destroyed/recreated by FilterSection)                  |

### Truncation

- Default: first 10 countries shown, "Show N more" button reveals the rest
- Matches Tags filter (`INITIAL_SHOW_COUNT = 10`)
- While searching: all matching results shown, no truncation

### Implementation

Follows the exact pattern from `tags-filter.svelte`:

**New imports:**

- `Icon` from `@immich/ui`
- `mdiMagnify` from `@mdi/js`

**New state:**

```typescript
let searchQuery = $state('');
let showAll = $state(false);
const INITIAL_SHOW_COUNT = 10;
```

**Reset on refetch** (same pattern as Tags):

```typescript
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

**Derived filtering and truncation:**

```typescript
let filteredCountries = $derived(
  searchQuery.trim() ? countries.filter((c) => c.toLowerCase().includes(searchQuery.trim().toLowerCase())) : countries,
);

let visibleCountries = $derived(
  searchQuery.trim() || showAll ? filteredCountries : filteredCountries.slice(0, INITIAL_SHOW_COUNT),
);

let remainingCount = $derived(Math.max(0, filteredCountries.length - INITIAL_SHOW_COUNT));
```

**Template changes:**

1. Search input with magnifying glass icon before the country list
2. Replace `{#each countries as country}` with `{#each visibleCountries as country}`
3. "No matching locations" message when `filteredCountries` is empty during search
4. "Show N more" button after the country loop

## Tests

Ten new tests added to the existing `describe('LocationFilter')` block in `filter-sections.spec.ts`:

1. Search filters country list
2. Case-insensitive matching
3. No truncation when searching (all matches shown)
4. "Show N more" appears when more than 10 countries
5. "Show N more" expands the full list
6. "No matching locations" shown for empty search results
7. Orphaned country remains visible during search
8. Selected country preserved across search/clear cycle
9. Search for country, click it, cities load normally
10. Country expanded then hidden by search, cities reappear when search cleared

## Files Changed

| File                                                                    | Change                                  |
| ----------------------------------------------------------------------- | --------------------------------------- |
| `web/src/lib/components/filter-panel/location-filter.svelte`            | Add search input, filtering, truncation |
| `web/src/lib/components/filter-panel/__tests__/filter-sections.spec.ts` | 10 new tests                            |
