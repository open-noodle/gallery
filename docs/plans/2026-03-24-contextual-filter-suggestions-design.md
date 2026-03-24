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

| When this changes...      | ...these re-fetch scoped suggestions           |
| ------------------------- | ---------------------------------------------- |
| Temporal (year/month)     | People, locations, cameras                     |
| People, location, camera  | Temporal picker (via existing TimelineManager) |
| Country (within location) | City (existing cascade)                        |
| Make (within camera)      | Model (existing cascade)                       |

The temporal picker's bidirectional scoping is already handled: `timeBuckets` is
derived from `timelineManager.months`, which re-fetches when filter options change.
No additional work is needed for this direction.

## Server Changes

### SearchSuggestionRequestDto

Add optional `takenAfter` and `takenBefore` to `SearchSuggestionRequestDto`. This DTO
is standalone — it does not extend `BaseSearchDto` where these fields already exist.
Use `@ValidateDate` decorator (same as `BaseSearchDto`) so NestJS class-transformer
handles ISO string → `Date` conversion. The frontend sends ISO strings; the server
types are `Date`.

### Threading through the chain

1. **DTO** (`search.dto.ts`): Add `takenAfter?` and `takenBefore?` with
   `@ValidateDate` to `SearchSuggestionRequestDto`
2. **Service** (`search.service.ts`): Pass new fields through `getSuggestions()` to
   all repository methods
3. **Repository options type**: Add `takenAfter` and `takenBefore` to
   `SpaceScopeOptions` — since all per-field options interfaces (`GetStatesOptions`,
   `GetCitiesOptions`, `GetCameraMakesOptions`, `GetCameraModelsOptions`,
   `GetCameraLensModelsOptions`) extend `SpaceScopeOptions`, this propagates to all
   of them automatically
4. **`getExifField()` helper** (`search.repository.ts`): Add
   `.$if(!!options?.takenAfter, qb => qb.where('asset.fileCreatedAt', '>=', takenAfter))`
   and equivalent for `takenBefore`. This is the single place where temporal scoping
   is applied to all suggestion queries (countries, states, cities, camera makes,
   camera models, lens models).
5. **OpenAPI regeneration**: Since `SearchSuggestionRequestDto` changes the API
   contract, run `make open-api-typescript` to regenerate the TypeScript SDK

### People endpoint

`getSpacePeople` uses a different endpoint (`GET /spaces/:id/people`) which currently
takes only an `id` path parameter with no query params. Changes needed:

1. Create a new DTO (e.g., `SpacePeopleQueryDto`) with optional `takenAfter` and
   `takenBefore` fields using `@ValidateDate`
2. Update the controller to accept `@Query() query: SpacePeopleQueryDto`
3. Thread temporal params through the service to the repository query, filtering
   via `asset.fileCreatedAt` on the face's associated asset
4. Regenerate OpenAPI spec and TypeScript SDK (covered by the same
   `make open-api-typescript` step above)

### Fix pre-existing cascade bugs

Two cascade callbacks in `filter-panel.svelte` ignore their parent parameters:

1. **City cascade**: `onCityFetch` ignores the country parameter (the underscore `_`
   is never used). Fix to pass the selected country to the server.
2. **Camera model cascade**: `onModelFetch` has the identical bug — ignores the make
   parameter. Fix to pass the selected make to the server.

Both must be fixed before layering temporal scoping on top.

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

## Testing

### Server Unit Tests (`server/src/services/search.service.spec.ts`)

- **Temporal threading per suggestion type**: For each of `COUNTRY`, `STATE`, `CITY`,
  `CAMERA_MAKE`, `CAMERA_MODEL`, `CAMERA_LENS_MODEL`, pass `takenAfter` and
  `takenBefore` in the DTO and assert the repository method receives them in its
  options argument.
- **Temporal fields omitted**: Verify that when `takenAfter`/`takenBefore` are not
  set, the repository methods receive `undefined` for those fields (no accidental
  defaults).
- **Space + temporal combined**: Test that `spaceId`, `takenAfter`, and `takenBefore`
  all pass through together when all three are provided.

### Server Unit Tests (`server/src/services/shared-space.service.spec.ts`)

- **People with temporal scoping**: Verify `takenAfter`/`takenBefore` flow from the
  controller DTO through the service to the repository query.
- **People without temporal params**: Verify backward compatibility — calling without
  temporal params returns the full unscoped list.

### Repository / Medium Tests

If medium tests exist for `search.repository.ts` (real DB via testcontainers):

- **`getExifField` with temporal bounds**: Insert assets with known `fileCreatedAt`
  dates. Query `getCountries` with `takenAfter`/`takenBefore` and verify only
  countries from assets within the range are returned.
- **Temporal + space combined**: Insert assets in and out of a space, with varied
  dates. Verify the intersection (space AND temporal) is correct.
- **Boundary inclusivity**: `takenAfter` equal to an asset's exact timestamp,
  `takenBefore` before all assets (empty result).

### Web Component Tests (`web/src/lib/components/filter-panel/`)

- **Re-fetch on temporal change**: Mount FilterPanel with mock providers that accept
  `FilterContext`. Simulate selecting a year in the temporal picker. Assert that
  people, locations, and cameras providers are re-called with the correct
  `{ takenAfter, takenBefore }` context.
- **Debounce behavior**: Rapidly change temporal selection multiple times. Assert
  providers are called only once after the debounce settles (~200ms), not on every
  intermediate change.
- **AbortController cancellation**: Start a slow provider fetch (via a delayed mock),
  then change temporal selection before it resolves. Assert the first fetch is aborted
  and only the second fetch's results are applied.
- **Orphaned selections preserved**: Set up a person selection, then re-fetch with
  scoped suggestions that no longer include that person. Assert the person remains in
  `filters.personIds` and appears in the UI with muted styling.
- **Empty section collapse**: Mock a provider that returns `[]` after temporal scoping.
  Assert the section header shows `(0)` and the section content is collapsed.
- **City cascade fix**: Mount LocationFilter, select a country, assert that
  `onCityFetch` is called with the selected country string (not ignored).
- **Camera model cascade fix**: Mount CameraFilter, select a make, assert that
  `onModelFetch` is called with the selected make string (not ignored).

### E2E API Tests (`e2e/src/specs/server/api/`)

Extend the existing `GET /search/suggestions` tests:

- **Suggestions with temporal params**: Upload assets with different `fileCreatedAt`
  dates. Request suggestions with `takenAfter`/`takenBefore`. Assert only values from
  assets within the date range appear.
- **Suggestions with temporal + space**: Combine `spaceId` with temporal params.
  Assert the intersection is correct.
- **Temporal params with no matches**: Request with a date range containing no assets.
  Assert empty array response.
- **Backward compatibility**: Existing suggestion tests must continue passing without
  temporal params.
- **Space people with temporal params**: Call `GET /spaces/:id/people` with temporal
  params. Assert only people with face assets in the date range are returned.

### E2E Playwright Tests (`e2e/src/specs/web/`)

Requires test data with distinct metadata per time period (different people, locations,
cameras across different years/months):

- **Temporal scoping narrows suggestions**: Navigate to a space, select a year in the
  temporal picker, verify that location/camera/people dropdowns only show values from
  assets in that year.
- **Orphaned selection visual state**: Select a person, then apply a temporal filter
  that excludes that person. Assert the person chip remains visible with muted styling.
- **Empty section state**: Apply a temporal filter that leaves zero cameras. Assert
  the camera section shows `(0)` in its header and content is collapsed.
- **Cascade correctness under temporal scoping**: Select a year, then select a country
  in the location filter. Assert the city dropdown only shows cities matching both
  the country AND the date range.

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
