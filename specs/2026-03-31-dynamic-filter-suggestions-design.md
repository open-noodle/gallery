# Dynamic Filter Suggestions

**Date:** 2026-03-31
**Status:** Design approved, pending implementation

## Problem

When a filter is applied (e.g., selecting a country), all other filter panels still show every available value from the entire library. Users have no way to know which filter combinations will return results and which will produce zero hits. This makes multi-filter exploration trial and error.

## Goal

When a filter is applied, all other filter panels dynamically update to show only values present in the current filtered result set. Every visible option is a guaranteed valid choice.

**Example flow:**

1. User selects Hungary in Location filter -> 45 results
2. People filter now shows only persons appearing in those 45 photos
3. Tags filter shows only tags present in those 45 photos
4. Camera filter shows only cameras used for those 45 photos
5. Rating filter shows only ratings represented in those 45 photos

## Design Decisions

- **Unified endpoint** over individual calls: one round trip per filter change instead of 4-5
- **Faceted search (exclude own filter):** when computing suggestions for a category, that category's own filter is excluded. Selecting "Hungary" still shows all other countries matching the remaining filters. Standard faceted search behavior.
- **Hidden, not grayed out:** unavailable values are hidden entirely (cleanest UX, prevents zero-result picks). Orphaned selections (values selected before becoming unavailable) remain visible and dimmed per existing pattern.
- **GET endpoint** for consistency with existing suggestion endpoints
- **Photos page first:** build generically, wire up on `/photos` initially. Map and spaces pages adopt later.
- **Ratings and media types included** in the response for complete dynamic filtering
- **Favorites excluded** from dynamic suggestions (simple boolean toggle, not a faceted dimension)

## API

### `GET /search/suggestions/filters`

**Request** (`FilterSuggestionsRequestDto`):

| Parameter          | Type        | Description                             |
| ------------------ | ----------- | --------------------------------------- |
| `personIds`        | `string[]`  | Filter by people in photos              |
| `country`          | `string`    | Filter by country                       |
| `city`             | `string`    | Filter by city                          |
| `make`             | `string`    | Camera make                             |
| `model`            | `string`    | Camera model                            |
| `tagIds`           | `string[]`  | Filter by tags                          |
| `rating`           | `number`    | Filter by rating (1-5)                  |
| `mediaType`        | `AssetType` | Filter by IMAGE or VIDEO                |
| `isFavorite`       | `boolean`   | Filter by favorites                     |
| `takenAfter`       | `Date`      | Temporal lower bound                    |
| `takenBefore`      | `Date`      | Temporal upper bound                    |
| `spaceId`          | `string`    | Scope to specific shared space          |
| `withSharedSpaces` | `boolean`   | Include shared spaces user is member of |

**Note on empty arrays:** `personIds: []` and omitting `personIds` are treated identically by the server (no person filter applied). The DTO validation accepts both. The web client sends `undefined` (not `[]`) when no filter is active.

**Response** (`FilterSuggestionsResponseDto`):

```typescript
{
  countries: string[];
  cameraMakes: string[];
  tags: Array<{ id: string; value: string }>;
  people: Array<{ id: string; name: string }>;
  ratings: number[]; // e.g. [3, 4, 5]
  mediaTypes: AssetType[]; // e.g. ['IMAGE'] or ['IMAGE', 'VIDEO']
  hasUnnamedPeople: boolean; // true if unnamed people exist in the filtered set
}
```

**`hasUnnamedPeople`:** When the `people` array is empty, the client uses this flag to distinguish "no people in filtered photos" from "people exist but none are named." This replaces the current `allPeople` provider pattern and drives the "Name people to use this filter" hint in PeopleFilter.

## Server Implementation

### Service Layer

`SearchService.getFilterSuggestions(auth, dto)`:

1. Validate `spaceId` and `withSharedSpaces` are not both set (same guard as existing suggestion endpoints)
2. If `spaceId` is set, verify `Permission.SharedSpaceRead`
3. Resolve `userIds` via `getUserIdsToSearch` (own + partner IDs)
4. Resolve `timelineSpaceIds` if `withSharedSpaces` is set
5. Delegate to `searchRepository.getFilterSuggestions(userIds, options)`

### Repository Layer

Six parallel queries via `Promise.all`, each building a filtered asset set with that category's own filter excluded:

```typescript
async getFilterSuggestions(userIds, options) {
  const [countries, cameraMakes, tags, people, ratings, mediaTypes] = await Promise.all([
    this.getSuggestionValues('country', userIds, without(options, 'country', 'city')),
    this.getSuggestionValues('make', userIds, without(options, 'make', 'model')),
    this.getFilteredTags(userIds, without(options, 'tagIds')),
    this.getFilteredPeople(userIds, without(options, 'personIds')),
    this.getFilteredRatings(userIds, without(options, 'rating')),
    this.getFilteredMediaTypes(userIds, without(options, 'mediaType')),
  ]);
  return { countries, cameraMakes, tags, people, ratings, mediaTypes };
}
```

### Query Helpers

**`getSuggestionValues(field, userIds, options)`** -- similar to existing `getExifField` but with cross-domain filter joins:

- Base: `asset_exif` joined with `asset` (same space/temporal scoping as `getExifField`)
- Conditional joins for cross-domain filters:
  - `asset_face` for `personIds` (EXISTS subquery)
  - `tag_asset` for `tagIds` (EXISTS subquery)
- Direct WHERE clauses for exif filters (country, make, rating) on `asset_exif`
- Direct WHERE clauses for `mediaType` and `isFavorite` on `asset`

**`getFilteredPeople(userIds, options)`** -- queries `person` via `asset_face` -> `asset`, applying all non-person filters. Returns `{ id, name, hasUnnamedPeople }` for named, non-hidden people with thumbnails. The `hasUnnamedPeople` flag is derived from a second lightweight query: `EXISTS(SELECT 1 FROM person JOIN asset_face ... WHERE person.name = '' AND <filtered assets>)`.

**`getFilteredTags(userIds, options)`** -- queries `tag` via `tag_asset` -> `asset`, applying all non-tag filters. Returns `{ id, value }`.

**`getFilteredRatings(userIds, options)`** -- `SELECT DISTINCT rating` from `asset_exif` joined with filtered assets. Returns `number[]`.

**`getFilteredMediaTypes(userIds, options)`** -- `SELECT DISTINCT type` from filtered assets. Returns `AssetType[]`.

**`without(options, ...keys)`** -- spreads options object and sets excluded keys to `undefined`. Must be unit tested to verify it preserves all other keys and handles hierarchical pairs (country+city, make+model).

## Web Implementation

### FilterPanelConfig Extension

```typescript
export interface FilterSuggestionsResponse {
  countries: string[];
  cameraMakes: string[];
  tags: TagOption[];
  people: PersonOption[]; // Already mapped with thumbnailUrl
  ratings: number[];
  mediaTypes: string[];
  hasUnnamedPeople: boolean;
}

export interface FilterPanelConfig {
  sections: FilterSection[];
  // NEW: unified suggestions (photos page)
  suggestionsProvider?: (filters: FilterState) => Promise<FilterSuggestionsResponse>;
  // KEPT: individual providers for backward compat (map, spaces)
  providers?: {
    people?: (context?: FilterContext) => Promise<PersonOption[]>;
    allPeople?: () => Promise<PersonOption[]>;
    locations?: (context?: FilterContext) => Promise<LocationOption[]>;
    cities?: (country: string, context?: FilterContext) => Promise<string[]>;
    cameras?: (context?: FilterContext) => Promise<CameraOption[]>;
    cameraModels?: (make: string, context?: FilterContext) => Promise<string[]>;
    tags?: (context?: FilterContext) => Promise<TagOption[]>;
  };
}
```

### Response-to-State Mapping

The `suggestionsProvider` callback on the photos page is responsible for mapping the server response into the `FilterSuggestionsResponse` shape that FilterPanel expects. This includes:

1. **People thumbnails:** Server returns `{ id, name }`. The page-level wrapper constructs `PersonOption` with `thumbnailUrl: /people/${id}/thumbnail`.
2. **Name maps:** The wrapper populates `personNames` and `tagNames` SvelteMap instances (used by ActiveFiltersBar for human-readable chip labels).
3. **Tag mapping:** Server returns `{ id, value }`. The wrapper maps to `TagOption` with `{ id, name: value }`.

This mapping lives in the page component (not FilterPanel) because different pages may have different mapping needs.

### FilterPanel Changes

**Important: `FilterContext` is NOT expanded.** It stays `{ takenAfter?, takenBefore? }` to preserve the stable-context optimization that prevents non-temporal changes from triggering child component re-renders in LocationFilter and CameraFilter.

**New `$effect`** when `suggestionsProvider` is set:

- Watches the full `filters` object (every field)
- **Replaces** both the 4 mount `$effect` blocks AND the temporal re-fetch `$effect` — the old effects are skipped when `suggestionsProvider` is present
- **Debounce:** 50ms for discrete filter changes (batches rapid checkbox clicks), 200ms for temporal changes, 0ms on clear-all
- AbortController cancels stale in-flight requests
- Sets `isRefetching = true` on request start, `false` on `Promise.allSettled`
- Updates `people`, `countries`, `cameraMakes`, `tags` state variables
- Updates new `availableRatings: number[]` and `availableMediaTypes: AssetType[]` state
- Updates `hasUnnamedPeople` from response
- On initial mount, fires with default filter state to load full unfiltered suggestions

**Distinguishing temporal vs discrete changes:** The effect compares `selectedYear` and `selectedMonth` against previous values. If only temporal fields changed, use 200ms debounce. If temporal fields cleared (both became undefined), use 0ms. Otherwise (any non-temporal field changed), use 50ms.

**Child values (cities, camera models):** NOT re-fetched by the unified effect. LocationFilter and CameraFilter manage their own child state internally and re-fetch via their `onCityFetch`/`onModelFetch` callbacks when the parent selection or `filterContext` (temporal) changes. Cross-filter scoping for child values (e.g., narrowing cities by person) is out of scope — the top-level country/make lists already narrow correctly, which provides the main value.

**Backward compatibility:** When `suggestionsProvider` is not set, FilterPanel falls back to existing `providers`-based behavior. All existing mount effects and temporal re-fetch logic remain active. Map and spaces pages continue working unchanged.

### Orphaned Selections

The existing orphaned-selection pattern is preserved unchanged. When a selected value disappears from the suggestion list, it is NOT auto-cleared. It stays visible and dimmed (`opacity-50`) at the top of the list. The user can manually deselect it. This avoids infinite re-fetch loops and is better UX (user sees why result set is empty, can undo with one click).

### Component Changes

**RatingFilter:** new optional `availableRatings?: number[]` prop. When set, stars not in the list are hidden. When `undefined` (backward compat), all 5 stars shown as today.

**MediaTypeFilter:** new optional `availableMediaTypes?: string[]` prop. When set, buttons for unavailable types are hidden. When `undefined`, all buttons shown as today.

### Empty State

When a filter combination matches no assets, all suggestion lists may become empty. In this case:

- PeopleFilter shows "No people found" (or "Name people to use this filter" if `hasUnnamedPeople`)
- LocationFilter, CameraFilter, TagsFilter show empty sections
- RatingFilter hides all stars (section appears empty)
- MediaTypeFilter hides all buttons (section appears empty)
- The orphaned selections for the user's active filters remain visible and dimmed

This matches the existing behavior for temporal filtering that produces no matches.

### Photos Page Integration

```typescript
const filterConfig: FilterPanelConfig = {
  sections: ['timeline', 'people', 'location', 'camera', 'tags', 'rating', 'media'],
  suggestionsProvider: async (filters: FilterState) => {
    const context = buildFilterContext(filters);
    const response = await getFilterSuggestions({
      personIds: filters.personIds.length > 0 ? filters.personIds : undefined,
      country: filters.country,
      city: filters.city,
      make: filters.make,
      model: filters.model,
      tagIds: filters.tagIds.length > 0 ? filters.tagIds : undefined,
      rating: filters.rating,
      mediaType:
        filters.mediaType === 'all'
          ? undefined
          : filters.mediaType === 'image'
            ? AssetTypeEnum.Image
            : AssetTypeEnum.Video,
      isFavorite: filters.isFavorite,
      takenAfter: context?.takenAfter,
      takenBefore: context?.takenBefore,
      withSharedSpaces: true,
    });
    // Map server response to FilterSuggestionsResponse
    const mappedPeople = response.people.map((p) => ({
      id: p.id,
      name: p.name,
      thumbnailUrl: `/people/${p.id}/thumbnail`,
    }));
    // Populate name maps for ActiveFiltersBar
    for (const p of response.people) {
      personNames.set(p.id, p.name);
    }
    for (const t of response.tags) {
      tagNames.set(t.id, t.value);
    }
    return {
      countries: response.countries,
      cameraMakes: response.cameraMakes,
      tags: response.tags.map((t) => ({ id: t.id, name: t.value })),
      people: mappedPeople,
      ratings: response.ratings,
      mediaTypes: response.mediaTypes,
      hasUnnamedPeople: response.hasUnnamedPeople,
    };
  },
  providers: {
    // Hierarchical children still fetched on-demand via LocationFilter/CameraFilter
    cities: async (country, context) =>
      getSearchSuggestions({
        $type: SearchSuggestionType.City,
        country,
        withSharedSpaces: true,
        ...context,
      }),
    cameraModels: async (make, context) =>
      getSearchSuggestions({
        $type: SearchSuggestionType.CameraModel,
        make,
        withSharedSpaces: true,
        ...context,
      }),
  },
};
```

## Testing

### Server Unit Tests

- Service method: auth, space scoping, partner inclusion
- `spaceId` and `withSharedSpaces` mutual exclusion guard
- Repository: each category excludes its own filter (verify `without()` behavior)
- Cross-domain filtering (selecting a person narrows countries)
- Empty filters returns full unfiltered suggestions
- `hasUnnamedPeople` flag: true when unnamed people exist, false otherwise
- Empty array vs undefined treated identically (no filter applied)
- `without()` utility: preserves all keys except excluded ones, handles hierarchical pairs

### Web Component Tests

- Filter change triggers `suggestionsProvider` with correct state
- Suggestions update when response arrives
- Response mapping: people get `thumbnailUrl`, tags get `name`
- Orphaned selections remain visible (dimmed)
- Debounce: rapid clicks batch into single request (50ms)
- Debounce: temporal changes use 200ms, clear uses 0ms
- AbortController: stale requests cancelled
- Child values (cities/models) managed by LocationFilter/CameraFilter internally
- Rating/MediaType hide unavailable options
- Rating/MediaType show all options when `availableRatings`/`availableMediaTypes` is undefined
- `hasUnnamedPeople` drives PeopleFilter empty text
- Backward compat: `providers`-only config still works (no `suggestionsProvider`)
- `isRefetching` flag set correctly during unified fetch
- Initial mount loads full unfiltered suggestions

### E2E Tests

Deferred -- requires ML pipeline for people detection and complex test data with overlapping filter dimensions.

## Scope

**In scope (this PR):**

- New `GET /search/suggestions/filters` endpoint with DTO/response types
- Repository queries for all 6 suggestion categories with faceted exclude-own-filter logic
- `without()` utility with unit tests
- `hasUnnamedPeople` flag in response
- FilterPanel `suggestionsProvider` mechanism with debounce and abort
- Response-to-state mapping in photos page wrapper
- `providers` normalized to `config.providers ?? {}` for safe access
- RatingFilter and MediaTypeFilter dynamic availability props
- Photos page integration
- OpenAPI spec regeneration
- Server unit tests and web component tests

**Out of scope (future):**

- Map page adoption
- Spaces page adoption
- E2E tests
- Loading skeleton for initial mount (monitor if noticeable)

## Design Decisions Log

| Decision                        | Rationale                                                                              |
| ------------------------------- | -------------------------------------------------------------------------------------- |
| `sortOrder` not in request DTO  | Sort order doesn't affect which values exist, only display order                       |
| `isFavorite` not in response    | Simple boolean toggle, not a faceted dimension                                         |
| GET not POST                    | Consistency with existing suggestion endpoints; array params work via `?personIds=a&b` |
| `FilterContext` not expanded    | Preserves stable-context optimization in child components                              |
| Child fetches stay separate     | Avoids fetching cities for all countries; keeps unified endpoint focused on top-level  |
| Orphaned selections not cleared | Avoids infinite re-fetch loops; user sees why result set is empty                      |
| 50ms debounce for discrete      | Batches rapid checkbox clicks at negligible UX cost                                    |
| `hasUnnamedPeople` in response  | Replaces separate `allPeople` provider call; single round trip                         |
| Page-level response mapping     | Different pages may construct thumbnailUrl differently; keeps FilterPanel generic      |
