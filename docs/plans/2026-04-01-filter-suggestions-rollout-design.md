# Filter Suggestions Rollout: Map + Spaces

**Date:** 2026-04-01
**Status:** Design approved, pending implementation

## Goal

Roll out interdependent filtering (faceted search) from the Photos page to the Map page and Spaces pages. The unified endpoint and FilterPanel `suggestionsProvider` mechanism already exist from PR #250 — this is purely web wiring plus a DTO bug fix and E2E tests.

## Changes

### 1. Fix: `@Type(() => Number)` on `rating` in `FilterSuggestionsRequestDto`

GET query params arrive as strings. The `rating` field uses `@IsInt()` + `@Min(1)` + `@Max(5)` but has no `@Type(() => Number)` transform, so `?rating=5` fails validation with "rating must be an integer number". The fix matches the existing pattern in `FilteredMapMarkerDto` (line 39 of `gallery-map.dto.ts`).

**File:** `server/src/dtos/search.dto.ts` — add `@Type(() => Number)` before `rating?: number;`

### 2. Spaces page: wire up `suggestionsProvider`

**File:** `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.svelte`

Replace the `providers` block (lines 167-239) with a `suggestionsProvider` that calls `getFilterSuggestions({ ...filters, spaceId: space.id })`. Keep `cities` and `cameraModels` as fallback providers for hierarchical drill-down with `spaceId` scoping.

Key differences from the Photos page implementation:

- Scoping: `spaceId: space.id` instead of `withSharedSpaces: true`
- Thumbnail URL: `/people/${id}/thumbnail` (global route works for space members)
- Removes `allPeople` provider (replaced by `hasUnnamedPeople` in response)
- Populates `personNames` and `tagNames` maps from response (same as Photos)

New imports needed: `getFilterSuggestions`, `AssetTypeEnum`, `buildFilterContext`, `FilterState` from `@immich/sdk` and filter-panel module.

### 3. Map page: wire up `suggestionsProvider`

**File:** `web/src/lib/utils/map-filter-config.ts`

The `buildMapFilterConfig(spaceId?)` function signature stays the same — callers don't change. Only the return value changes internally: it now includes `suggestionsProvider` instead of individual `providers`.

Two branches:

- With `spaceId`: `getFilterSuggestions({ ...filters, spaceId })`
- Without `spaceId`: `getFilterSuggestions({ ...filters, withSharedSpaces: true })`

Keep `cameraModels` as fallback provider for hierarchical drill-down.

New imports needed: `getFilterSuggestions`, `AssetTypeEnum`, `buildFilterContext`, `type FilterState` from `@immich/sdk` and filter-panel module.

Notes:

- The map has no `'location'` section (sections are `['timeline', 'people', 'camera', 'tags', 'rating', 'media', 'favorites']`). The `countries` field in the response is unused — harmless, the FilterPanel ignores it since no LocationFilter renders.
- The `favorites` section works automatically — `isFavorite` from `FilterState` is passed through like all other fields.
- No `personNames`/`tagNames` maps needed — the map doesn't use ActiveFiltersBar with name chips.

### 4. E2E tests for cross-filter narrowing

**File:** `e2e/src/specs/server/api/filter-suggestions.e2e-spec.ts` (new)

Server-side API E2E tests (Vitest, not Playwright) that verify the filter suggestions endpoint returns narrowed results when filters are applied. These test the core query logic end-to-end against a real database — the same kind of bug that was found during PR #250 (tag filtering not narrowing countries) would be caught here.

**Test data setup** (`beforeAll`):

Upload 4 test-asset photos with real EXIF (different cameras), set distinct coordinates (triggering reverse geocoding for different countries), create and apply tags, and set ratings. Wait for `assetUpdate` websocket events to ensure reverse geocoding has completed before running assertions.

| Asset | File                | Coordinates           | Tag    | Rating |
| ----- | ------------------- | --------------------- | ------ | ------ |
| A     | prairie_falcon.jpg  | Paris (48.85, 2.35)   | nature | 5      |
| B     | denali.webp         | Tokyo (35.69, 139.69) | travel | 4      |
| C     | glarus.nef          | Berlin (52.52, 13.41) | nature | 5      |
| D     | el_torcal_rocks.jpg | Tokyo (35.69, 139.69) | travel | 3      |

**Test approach — dynamic assertions, not hardcoded values:**

Rather than hardcoding specific country names (which depend on reverse geocoding), the tests:

1. Call `GET /search/suggestions/filters` unfiltered to discover the full set of values
2. Call it with a specific filter applied
3. Assert the OTHER categories narrowed (returned fewer values than unfiltered)

**Tests:**

- **Unfiltered baseline**: Call with no filters, verify all categories are non-empty and store counts
- **Country filter narrows tags**: Select the first country → assert `tags.length < unfilteredTags.length`
- **Tag filter narrows countries**: Select the first tag → assert `countries.length < unfilteredCountries.length`
- **Rating filter narrows countries**: Select rating 3 (only asset D) → assert `countries.length < unfilteredCountries.length`
- **Camera filter narrows countries**: Select a camera make → assert `countries.length <= unfilteredCountries.length` (uses `<=` not `<` because test assets may have only 1 make if EXIF data is limited)
- **Combined filters narrow further**: Select country + tag → assert result is narrower than either alone
- **Rating query param parsing**: Send `rating=5` as query string, verify 200 response (validates the `@Type(() => Number)` fix)
- **Single tagId array coercion**: Send a single `tagIds=uuid` (not duplicated), verify 200 response and narrowed results (validates the `@Transform` fix from PR #250)
- **Empty result set**: Apply filters that match no assets (e.g., a country + a tag that don't overlap) → verify response has all empty arrays and `hasUnnamedPeople: false`, no 500 error
- **Spaces scoping**: Create a space with a subset of assets, call with `spaceId` → verify suggestions are scoped to only that space's assets (fewer results than unfiltered global)

## No server changes (besides the rating fix)

The `GET /search/suggestions/filters` endpoint already supports `spaceId` and `withSharedSpaces`. No new endpoints, no new repository methods, no migrations.

## Testing summary

| Area                   | What                                        | Type                       |
| ---------------------- | ------------------------------------------- | -------------------------- |
| Rating DTO fix         | `@Type(() => Number)` transform             | Covered by E2E rating test |
| Spaces page            | `suggestionsProvider` wiring                | Manual testing             |
| Map page               | `suggestionsProvider` wiring                | Manual testing             |
| Cross-filter narrowing | 10 E2E tests verifying faceted search works | New server E2E spec        |

## Scope

**In scope:**

- Fix `rating` query param parsing in `FilterSuggestionsRequestDto`
- Wire up `suggestionsProvider` on Spaces page
- Wire up `suggestionsProvider` in `buildMapFilterConfig`
- New server E2E test spec for cross-filter narrowing (7 tests)
- Regenerate OpenAPI spec if DTO change affects it

**Out of scope:**

- Child value cross-filtering (cities, camera models) — managed by LocationFilter/CameraFilter internally
- Map ActiveFiltersBar name resolution
- Playwright browser tests for filter panel UI (mechanism already tested in PR #250 component tests)
- Additional component tests (mechanism already tested)
