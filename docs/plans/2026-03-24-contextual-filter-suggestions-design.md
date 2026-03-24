# Contextual Filter Suggestions

## Problem

When a user opens the FilterPanel (currently used in Spaces), each filter section
(people, locations, cameras, tags) fetches suggestions independently. If you select
"June 2024" in the temporal picker, the location dropdown still shows every city
across all time — including cities where photos only exist in 2019. This leads to
misleading filter options and empty-result dead ends.

## Decision

**Option C with bidirectional temporal:**

- Temporal (date range) scopes all other filter suggestions (people, locations, cameras)
- Non-temporal filters scope the temporal picker back (already free via TimelineManager)
- Existing cascades remain: country → city, make → model
- Non-temporal filters do NOT scope each other (person doesn't narrow locations)

## Scoping Model

| When this changes...      | ...these re-fetch scoped suggestions         |
| ------------------------- | --------------------------------------------- |
| Temporal (year/month)     | People, locations, cameras                    |
| People, location, camera  | Temporal picker (via existing TimelineManager) |
| Country (within location) | City (existing cascade)                       |
| Make (within camera)      | Model (existing cascade)                      |

The temporal picker's bidirectional scoping is already handled: `timeBuckets` is
derived from `timelineManager.months`, which re-fetches when filter options change.
No additional work is needed for this direction.

## Server Changes

### SearchSuggestionRequestDto

Add optional `takenAfter` and `takenBefore` (ISO date strings) to
`SearchSuggestionRequestDto`. This DTO is standalone — it does not extend
`BaseSearchDto` where these fields already exist.

### Threading through the chain

1. **DTO** (`search.dto.ts`): Add `takenAfter?` and `takenBefore?` to
   `SearchSuggestionRequestDto`
2. **Service** (`search.service.ts`): Pass new fields through `getSuggestions()` to
   all repository methods
3. **Repository options type**: Extend the options interface used by `getExifField()`
   to accept `takenAfter` and `takenBefore`
4. **`getExifField()` helper** (`search.repository.ts`): Add
   `.$if(!!options?.takenAfter, qb => qb.where('asset.fileCreatedAt', '>=', takenAfter))`
   and equivalent for `takenBefore`. This is the single place where temporal scoping
   is applied to all suggestion queries (countries, states, cities, camera makes,
   camera models, lens models).

### People endpoint

`getSpacePeople` uses a different endpoint from search suggestions — it queries
`asset_face` → `asset`. Add `takenAfter`/`takenBefore` optional params to this
endpoint, filtering through `asset.fileCreatedAt` on the face's associated asset.

### Fix pre-existing city cascade bug

The `onCityFetch` callback in `filter-panel.svelte` currently ignores the country
parameter (the underscore `_` is never used). Fix this so cities are fetched with the
selected country passed to the server. This must be done before layering temporal
scoping on top.

## Frontend Changes

### FilterPanel becomes self-contained

The page provides `FilterPanelConfig` with provider functions that now accept an
optional context parameter:

```typescript
type FilterContext = {
  takenAfter?: string;
  takenBefore?: string;
};

providers: {
  people: async (context?: FilterContext) => ...,
  locations: async (context?: FilterContext) => ...,
  cameras: async (context?: FilterContext) => ...,
}
```

The page constructs actual API calls — FilterPanel passes context through. This keeps
FilterPanel reusable across different pages (spaces, albums, future main timeline).

### Re-fetch flow

When a temporal filter changes:

1. 200ms debounce
2. Re-fetch people, locations, cameras in parallel, passing temporal context
3. Sections show current suggestions at reduced opacity (0.5) while loading
4. On response, swap suggestions and restore opacity
5. Skip opacity fade if response arrives within ~150ms (avoid flicker)

### Stale request handling

`AbortController` per fetch cycle. When a new debounced fetch fires, abort previous
in-flight requests.

### Orphaned selections

When suggestions narrow and a previously-selected value is no longer in the results
(e.g., selected "Alice" then picked a date range where Alice has no photos):

- **Keep the selection active**
- Show it at the top of the suggestion list, visually muted
- User can deselect manually
- Filter results remain correct (AND of all active filters)

### Empty sections

When a section has 0 suggestions after scoping, collapse to muted header with **(0)**
count. No layout shifts. Add a count prop to `FilterSection` derived from suggestion
array length.

## Deferred Work

### 1. Tags contextual scoping

**What:** Narrow the tag list to only tags applied to assets within the selected date
range.

**Why deferred:** `getAllTags()` returns user-level tags with no asset-scoping
mechanism. Would require a new query joining `tag_asset` → `asset` filtered by
`fileCreatedAt`, or a new `SearchSuggestionType.Tag`. Tag lists are typically small
enough that showing all of them isn't misleading.

**When to revisit:** If users report tag lists becoming unwieldy, or when adding
non-temporal cross-scoping.

**Implementation hint:** The cleanest approach would be adding a
`SearchSuggestionType.Tag` that queries through `tag_asset` → `asset` in
`getExifField()`-style, reusing the same temporal scoping infrastructure.

### 2. Non-temporal cross-scoping

**What:** Selecting a person narrows location/camera suggestions; selecting a location
narrows people/camera suggestions; etc.

**Why deferred:** Significant frontend complexity — every filter change re-fetches all
other sections, not just temporal. The server support is mostly there
(`searchAssetBuilder` handles all filter combinations) but the provider interface
would need full filter state, not just temporal context. Also introduces the "all
filters except self" pattern requiring careful UX thought around filter order
independence.

**When to revisit:** After v1 ships and we have user feedback on whether temporal
scoping alone is sufficient.

**Upgrade path:** Extend `FilterContext` to include all filter dimensions (`personIds`,
`city`, `country`, `make`, `model`, `rating`) and widen the re-fetch triggers so any
filter change re-fetches all other sections (except itself). The server endpoints
already accept these params on `BaseSearchDto`.

### 3. Batched facets endpoint

**What:** Single `POST /search/facets` returning all suggestion lists in one
round-trip.

**Why deferred:** Parallel individual requests for 4-5 lightweight DISTINCT queries
are fast enough (<50ms each). Batching adds a new endpoint contract with no
user-visible benefit unless latency becomes a problem.

**When to revisit:** If non-temporal cross-scoping is added (doubles re-fetches per
filter change) or if network latency makes parallel requests noticeably slow.

**Implementation hint:** A thin orchestration layer that calls existing repository
methods in parallel and returns a combined response. The shared query base
optimization (single CTE with multiple DISTINCT selects) would be a further
iteration.
