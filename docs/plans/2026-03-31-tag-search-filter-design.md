# Tag Search Filter Design

## Problem

Large tag collections (hundreds or thousands of keyword tags) make the Tags filter section
in FilterPanel unusable — especially on mobile. There is no way to search or truncate the
list, unlike the People filter which already has both.

## Solution

Add search input and "Show more" truncation to the Tags filter, matching the People filter
pattern. Also fix a truncation bug in the People filter where search results are capped at
`INITIAL_SHOW_COUNT` with no way to see the rest.

## Files Changed

### `tags-filter.svelte` — add search + truncation

New state and derived values:

- `searchQuery: $state('')`
- `showAll: $state(false)`
- `INITIAL_SHOW_COUNT = 10`
- `tagNameCache: Map<string, string>` — populated from `tags` prop, used for orphan display
- `filteredTags: $derived` — case-insensitive substring match on `searchQuery`
- `visibleTags: $derived` — when searching, show all results; otherwise truncate to
  `INITIAL_SHOW_COUNT` unless `showAll` is true
- `remainingCount: $derived` — `Math.max(0, filteredTags.length - INITIAL_SHOW_COUNT)`

UI additions:

- **Search input** — always visible when `tags.length > 0`, magnifying glass icon,
  placeholder "Search tags...", resets `showAll` on input
- **Orphaned tags** — selected tags no longer in current results shown at 50% opacity above
  the list, using cached names
- **"Show N more" button** — visible when not searching and more items exist beyond
  `INITIAL_SHOW_COUNT`
- **Empty search state** — "No matching tags" when search yields zero results
- **`aria-pressed`** on tag buttons for accessibility
- **Clear search on `tags` prop change** — `$effect` watching `tags` resets `searchQuery`

### `people-filter.svelte` — fix search truncation bug

Current behavior: when searching, results are still truncated to `INITIAL_SHOW_COUNT` (5)
and the "Show more" button is hidden (`!searchQuery.trim()` condition). Users cannot see
results beyond the first 5.

Fix: when `searchQuery` is active, `visiblePeople` shows all `filteredPeople` (no
truncation). The "Show more" button remains hidden during search since all results are
already visible.

Change to `visiblePeople` derived:

```typescript
// Before
let visiblePeople = $derived(showAll ? filteredPeople : filteredPeople.slice(0, INITIAL_SHOW_COUNT));

// After
let visiblePeople = $derived(
  searchQuery.trim() || showAll ? filteredPeople : filteredPeople.slice(0, INITIAL_SHOW_COUNT),
);
```

## What Does NOT Change

- No server changes
- No changes to `filter-panel.ts`, `filter-panel.svelte`, or any page files
- No new components or abstractions
- `TagOption` interface stays `{ id, name }`

## Testing

Unit tests for `tags-filter.svelte`:

- Search filtering narrows visible tags
- Show more expands full list
- Orphaned tags display with cached names at reduced opacity
- Empty search state shows "No matching tags"
- Search clears on `tags` prop change

Unit tests for `people-filter.svelte`:

- Search shows all matching results (no truncation)
