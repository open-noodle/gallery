# Tags Filter Access Fix Design

**Date:** 2026-03-29
**Branch:** `fix/tags-filter-space-library-access`

## Problem

Non-admin users see only a subset of tags in the FilterPanel. The `GET /tags` endpoint returns
only tags where `tag.userId = currentUser`. Tags attached to assets the user can access via
shared spaces (especially library-linked assets) are invisible.

**Root cause:** `tagRepository.getAll(userId)` queries `WHERE tag.userId = ?`, ignoring space
membership and library linkage. All other filter types (people, cameras, locations) use
space-aware queries that join through `shared_space_asset` and `shared_space_library`.

## Solution

Add a new `GET /search/suggestions/tags` endpoint that returns tags present on assets the user
can access, following the same access pattern as `getExifField` in `search.repository.ts`.

### Why a separate endpoint?

The existing `GET /search/suggestions` endpoint returns `string[]`. Tags need `{id, value}`
pairs because the filter panel passes tag UUIDs to the timeline/search API via `tagIds`. Tag
values are not globally unique across users sharing a space, so a value-to-ID lookup would be
unreliable. Changing the suggestions return type would require refactoring all suggestion
consumers.

## Server Changes

### 1. `search.repository.ts` — `getAccessibleTags`

New method joining `tag` → `tag_asset` → `asset` to find tags on accessible assets.

```typescript
getAccessibleTags(userIds: string[], options?: SpaceScopeOptions):
  Promise<Array<{ id: string; value: string }>>
```

Query logic:

- `SELECT DISTINCT tag.id, tag.value` from `tag`
- `INNER JOIN tag_asset ON tag.id = tag_asset.tagId`
- `INNER JOIN asset ON tag_asset.assetId = asset.id`
- `WHERE asset.visibility = 'timeline' AND asset.deletedAt IS NULL`
- Personal timeline (`!spaceId`): `AND asset.ownerId IN (userIds)`
- Space scope (`spaceId`): `AND (EXISTS shared_space_asset OR EXISTS shared_space_library)`
  — mutually exclusive branches via `$if`, matching `getExifField`
- Optional: `AND asset.fileCreatedAt >= takenAfter`, `AND asset.fileCreatedAt < takenBefore`
- `ORDER BY tag.value`

Note: joins through `tag_asset` directly, not `tag_closure`. The closure table is for
hierarchical filtering (finding assets matching a tag and its descendants). For listing
available tags, we want tags directly attached to assets.

### 2. `search.service.ts` — `getTagSuggestions`

```typescript
async getTagSuggestions(auth: AuthDto, dto: TagSuggestionRequestDto):
  Promise<Array<{ id: string; value: string }>>
```

- If `dto.spaceId` provided: check `Permission.SharedSpaceRead`
- Get partner-inclusive userIds via `getUserIdsToSearch(auth)`
- Call `searchRepository.getAccessibleTags(userIds, dto)`

### 3. `search.controller.ts` — new endpoint

```
GET /search/suggestions/tags?spaceId=&takenAfter=&takenBefore=
```

- Permission: `Permission.AssetRead` (consistent with existing suggestions endpoint)
- `@Endpoint` decorator with history metadata (matching other search controller methods)
- `@ApiOkResponse({ type: [TagSuggestionResponseDto] })` for array response type inference
- DTO: `TagSuggestionRequestDto` with optional `spaceId`, `takenAfter`, `takenBefore`
- Response: `TagSuggestionResponseDto[]` — `Array<{ id: string; value: string }>`

### 4. DTO definitions

`TagSuggestionRequestDto` in `search.dto.ts`:

- `spaceId?: string` (ValidateUUID, optional)
- `takenAfter?: Date` (optional)
- `takenBefore?: Date` (optional)

`TagSuggestionResponseDto` in `search.dto.ts`:

- `id: string` (`@ApiProperty`)
- `value: string` (`@ApiProperty`)

### 5. `@GenerateSql` decorator + `make sql`

The new `getAccessibleTags` repository method must have the `@GenerateSql` decorator for query
documentation. Run `make sql` after implementation to regenerate SQL query docs.

## Frontend Changes

### 6. Update `FilterPanelConfig` type

Change tags provider signature for temporal scoping consistency:

```typescript
// Before
tags?: () => Promise<TagOption[]>;

// After
tags?: (context?: FilterContext) => Promise<TagOption[]>;
```

### 7. Update filter panel re-fetch logic

The filter panel's debounced `$effect` block in `filter-panel.svelte` (lines ~84-186) re-fetches
people, locations, and cameras when temporal context changes, but **tags are currently excluded**.
The `$effect` must be updated to also re-fetch tags with the new `FilterContext` when temporal
filters change. Without this, temporal scoping will not work despite the type signature change.

### 8. Update filter configs (3 locations)

**Photos page** (`routes/(user)/photos/[[assetId=id]]/+page.svelte`):

- Replace `getAllTags()` with new SDK `getTagSuggestions()` call
- Pass `FilterContext` (takenAfter/takenBefore)
- Continue populating `tagNames` map from response

**Spaces page** (`routes/(user)/spaces/[spaceId]/.../+page.svelte`):

- Replace `getAllTags()` with `getTagSuggestions({ spaceId })`
- Pass `FilterContext`

**Map page** (`utils/map-filter-config.ts`):

- Replace `getAllTags()` with `getTagSuggestions()` / `getTagSuggestions({ spaceId })`
- Pass `FilterContext`

### 9. SDK regeneration

Run `make open-api-typescript` after server changes. No Dart changes needed (mobile does not
use the FilterPanel).

## What Does Not Change

- `GET /tags` CRUD endpoint (tag management)
- `TagService.getAll()` and `TagRepository.getAll()`
- Tag creation, update, delete flows
- `hasTags()` / `withAnyTagId()` query helpers in `database.ts`
- No database schema changes, no migration needed

## Testing

### Repository (`getAccessibleTags`) unit tests

- Own tags only: user with no spaces or partners sees only tags on their own assets
- Partner tags included: user sees tags from partner assets on personal timeline
- Space — direct assets: tags from assets added directly to a space via `shared_space_asset`
- Space — library-linked assets: tags from assets in a library linked via `shared_space_library`
- Deleted asset exclusion: tags only on soft-deleted assets (`deletedAt IS NOT NULL`) are excluded
- Visibility filtering: tags only on archived assets (`visibility != Timeline`) are excluded
- Temporal scoping — `takenAfter`: only tags from assets after the date
- Temporal scoping — `takenBefore`: only tags from assets before the date
- Temporal scoping — range: combined `takenAfter` + `takenBefore` narrows correctly
- Deduplication: same tag attached to multiple accessible assets returns one row
- Cross-user same-value tags: two users each have a tag named "Vacation" (different IDs) — both
  appear when both users' assets are in the same space
- Empty results: user with no tagged accessible assets gets empty array
- Ordering: results are alphabetically ordered by `tag.value`
- Tag with no assets: a tag that exists but has no `tag_asset` rows does not appear

### Service (`getTagSuggestions`) unit tests

- Partner inclusion: `getUserIdsToSearch` is called and partner IDs are forwarded
- Space permission check: `SharedSpaceRead` is required when `spaceId` is provided
- Non-member rejection: user who is not a space member gets authorization error
- No spaceId — personal scope: without `spaceId`, uses owner-based scoping
- Admin vs non-admin: both go through the same code path (no special admin handling)

### Frontend unit tests

- Tags provider re-fetched on temporal change: filter panel calls tags provider with updated
  `FilterContext` when year/month changes (matching people/cameras behavior)
- Tags provider called without context on mount: initial load passes undefined context
- `tagNames` map populated: response from new endpoint populates the `SvelteMap` correctly
- Space page passes spaceId: spaces page config passes `spaceId` to the SDK call
- Map page handles both scoped and unscoped: map filter config works with and without `spaceId`
