# Filter Suggestions for Shared Space Content

## Problem

When a non-admin user opens the Photos or Map view, the Location and Camera filter panels show empty
("No locations found", "No cameras found") even though photos from shared spaces are visible in the timeline.

The timeline includes space content via `withSharedSpaces: true`, but the filter suggestion endpoints
(`getSearchSuggestions`) only query by `ownerId IN (user, partners)` — completely ignoring shared space membership.

## Scope

**In scope:** Location (country, state, city) and Camera (make, model, lens) filter suggestions.

**Out of scope:** People filter suggestions — space people and user people live in different tables
(`shared_space_person` vs `person`) with no dedup key. This needs a separate design for cross-table
person deduplication.

## Affected Pages

- **Photos** (`/photos`) — FilterPanel providers call `getSearchSuggestions()` without space context
- **Map** (`/map`, non-space branch) — `buildMapFilterConfig()` calls `getSearchSuggestions()` without
  space context

Space-specific views already work correctly because they pass `spaceId` explicitly.

## Design

### 1. DTO Change

Add `withSharedSpaces?: boolean` to `SearchSuggestionRequestDto`:

```typescript
@ValidateBoolean({ optional: true, description: 'Include suggestions from shared spaces' })
withSharedSpaces?: boolean;
```

Mutually exclusive with `spaceId` — reject requests that set both. Space views pass `spaceId`, timeline
views pass `withSharedSpaces`.

### 2. Service Change (`SearchService.getSearchSuggestions`)

When `withSharedSpaces` is true:

1. Fetch user's timeline space IDs via `sharedSpaceRepository.getSpaceIdsForTimeline(auth.user.id)`
2. If any spaces found, pass `timelineSpaceIds` array to repository methods
3. If no spaces, fall through to existing owner-only behavior

This mirrors the pattern in `TimelineService.getTimeBucketOptions()`.

Note: `getSuggestions()` currently passes the full DTO to repository methods. The service must translate
`withSharedSpaces` into `timelineSpaceIds` on the options object before passing to the repository, since
the repository expects `SpaceScopeOptions` (not the DTO directly).

### 3. Repository Change (`SearchRepository.getExifField`)

Add `timelineSpaceIds?: string[]` to `SpaceScopeOptions`. The query gains a third branch:

- **No space context** (`!spaceId && !timelineSpaceIds`): existing `WHERE ownerId IN (userIds)` filter
- **Single space** (`spaceId` set): existing space asset/library subquery filter
- **Timeline spaces** (`timelineSpaceIds` set): `WHERE ownerId IN (userIds) OR` space asset/library
  subquery matching any of `timelineSpaceIds`

The timeline branch uses `OR` so users see both their own content and space content, matching how the
timeline itself works. `DISTINCT ON(field)` naturally deduplicates string values (e.g., "Germany"
appears once regardless of source).

### 4. Frontend Changes

**Photos page** (`+page.svelte`) — add `withSharedSpaces: true` to all suggestion provider calls:
`locations`, `cities`, `cameras`, `cameraModels`.

**Map filter config** (`map-filter-config.ts`) — add `withSharedSpaces: true` to the non-space branch
providers: `cameras`, `cameraModels`.

### 5. Generated Files

- OpenAPI spec regeneration (new DTO field)
- TypeScript SDK regeneration
- Dart SDK regeneration
- SQL query documentation

## Edge Cases

- **User with no spaces**: `getSpaceIdsForTimeline` returns empty, `timelineSpaceIds` stays undefined,
  query falls back to owner-only. No change in behavior.
- **Admin users**: Same logic applies — admins who are space members see space content in suggestions.
- **`showInTimeline` flag**: `getSpaceIdsForTimeline` already filters by `showInTimeline = true`, so
  spaces hidden from timeline are excluded from suggestions.
- **Overlapping content**: An asset owned by the user that is also in a space produces the same EXIF
  value — `DISTINCT ON` collapses it to one suggestion.

## Testing

**Unit tests (server)**:

- `SearchService.getSearchSuggestions` with `withSharedSpaces: true` verifies space IDs are fetched and
  passed to repository
- `SearchService.getSearchSuggestions` with `withSharedSpaces` absent preserves existing owner-only
  behavior (regression)
- `SearchService.getSearchSuggestions` rejects `spaceId` + `withSharedSpaces` combination
- Repository-level tests for `getExifField` with `timelineSpaceIds`

**Unit tests (web)**:

- Photos page filter config passes `withSharedSpaces: true`
- Map filter config passes `withSharedSpaces: true` when no `spaceId`

**E2E tests**:

- Non-admin user with space membership sees Location suggestions from space content on Photos page
- Non-admin user with space membership sees Camera suggestions from space content on Photos page
- Non-admin user with space membership sees Camera suggestions from space content on Map page
- Cascading filter: selecting a country returns cities from space content with `withSharedSpaces`

## Files to Modify

**Server:**

- `server/src/dtos/search.dto.ts` — add `withSharedSpaces` to `SearchSuggestionRequestDto`
- `server/src/services/search.service.ts` — resolve space IDs, pass to repository
- `server/src/repositories/search.repository.ts` — `SpaceScopeOptions` + `getExifField` multi-space
  branch

**Web:**

- `web/src/routes/(user)/photos/[[assetId=id]]/+page.svelte` — add `withSharedSpaces: true` to
  providers
- `web/src/lib/utils/map-filter-config.ts` — add `withSharedSpaces: true` to non-space providers

**Generated:**

- OpenAPI spec, TypeScript SDK, Dart SDK, SQL query docs
