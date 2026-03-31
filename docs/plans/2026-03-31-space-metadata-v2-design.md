# Space Metadata Visibility v2

**Date:** 2026-03-31
**Depends on:** PR #242 (merged)

## Problem

PR #242 made tags and people visible to space members in the detail panel, but only when viewing through the space page (where `spaceId` is passed explicitly). When the same asset is opened from:

- The user's timeline (via `showInTimeline`)
- Search results
- Direct URL

...the `spaceId` is missing, so `isSpaceMember` is false and people/tags are hidden even though the user has space access.

Additionally, the space filter panel shows "No people found" when people exist but haven't been named, with no hint to the user about what to do.

## Fix 1: Server-side space context fallback

### Server change

In `asset.service.get()`, the `else` branch (non-owner without `spaceId`) currently strips all people. Replace with a fallback that auto-resolves the space:

```typescript
} else {
  // No spaceId — try to find a space containing this asset for this user
  const spaceForAsset = await this.sharedSpaceRepository.findSpaceForAssetAndUser(id, auth.user.id);
  if (spaceForAsset) {
    const globalPersonIds = (data.people || []).map((p) => p.id);
    const spacePersonMap = await this.sharedSpaceRepository.findSpacePersonsByLinkedPersonIds(
      spaceForAsset.spaceId,
      globalPersonIds,
    );
    for (const person of data.people || []) {
      const spacePerson = spacePersonMap.get(person.id);
      if (spacePerson) {
        person.spacePersonId = spacePerson.id;
      }
    }
    data.people = (data.people || []).filter(
      (p) => p.spacePersonId && !spacePersonMap.get(p.id)?.isHidden,
    );
    data.resolvedSpaceId = spaceForAsset.spaceId;
  } else {
    data.people = [];
  }
}
```

### New repository method

`findSpaceForAssetAndUser(assetId, userId)` in `shared-space.repository.ts`. Returns `{ spaceId: string } | undefined`. Both UNION branches JOIN the `asset` table to filter deleted/offline assets (matching the pattern in `checkSpaceAccessForSpace`):

```typescript
async findSpaceForAssetAndUser(assetId: string, userId: string) {
  return this.db
    .selectFrom(
      this.db
        .selectFrom('shared_space_asset')
        .innerJoin('shared_space_member', 'shared_space_member.spaceId', 'shared_space_asset.spaceId')
        .innerJoin('asset', (join) =>
          join
            .onRef('asset.id', '=', 'shared_space_asset.assetId')
            .on('asset.deletedAt', 'is', null),
        )
        .select('shared_space_asset.spaceId')
        .where('shared_space_asset.assetId', '=', assetId)
        .where('shared_space_member.userId', '=', userId)
        .union(
          this.db
            .selectFrom('shared_space_library')
            .innerJoin('shared_space_member', 'shared_space_member.spaceId', 'shared_space_library.spaceId')
            .innerJoin('asset', (join) =>
              join
                .onRef('asset.libraryId', '=', 'shared_space_library.libraryId')
                .on('asset.id', '=', assetId)
                .on('asset.deletedAt', 'is', null)
                .on('asset.isOffline', '=', false),
            )
            .select('shared_space_library.spaceId')
            .where('shared_space_member.userId', '=', userId),
        )
        .as('combined'),
    )
    .select('combined.spaceId')
    .limit(1)
    .executeTakeFirst();
}
```

### New DTO field

Add `resolvedSpaceId?: string` as `@ApiPropertyOptional` on `AssetResponseDto`. Assigned after `mapAsset()` when the server auto-resolves space context. Requires OpenAPI + SDK regeneration.

### Frontend changes

In `detail-panel.svelte`, replace:

```typescript
let isSpaceMember = $derived(!!spaceId);
```

With:

```typescript
let effectiveSpaceId = $derived(spaceId || asset.resolvedSpaceId);
let isSpaceMember = $derived(!!effectiveSpaceId);
```

Use `effectiveSpaceId` everywhere `spaceId` was used: thumbnail URLs, person links, forwarding to DetailPanelTags.

In `detail-panel-tags.svelte`, same derivation:

```typescript
let effectiveSpaceId = $derived(spaceId || asset.resolvedSpaceId);
let isSpaceMember = $derived(!!effectiveSpaceId);
```

The `getAssetInfo` re-fetch calls (lines 27, 33) can optionally pass `effectiveSpaceId` for efficiency, but the server fallback will resolve it anyway if omitted.

## Fix 2: "Name people" hint in space filter panel

In `filter-panel.svelte` (around line 278-281), after the people provider returns an empty array in space context:

1. Make a secondary call: `getSpacePeople({ id: spaceId, limit: 1 })` without `named`
2. If it returns results, pass `emptyText="Name people to use this filter"` to `PeopleFilter`
3. Only do this in space context (non-space pages keep the default "No people found")

The `PeopleFilter` component already accepts an `emptyText` prop — no component changes needed.

## Testing

### Server unit tests

| Test                                                | Expected                                                                         |
| --------------------------------------------------- | -------------------------------------------------------------------------------- |
| Space member without spaceId sees people (fallback) | `findSpaceForAssetAndUser` returns space → people preserved with `spacePersonId` |
| Space member without spaceId gets `resolvedSpaceId` | Response includes `resolvedSpaceId` matching the found space                     |
| Non-member without spaceId gets empty people        | `findSpaceForAssetAndUser` returns undefined → `people = []`                     |
| Partner without spaceId gets empty people           | No space found → `people = []`                                                   |
| Owner without spaceId still sees all people         | Owner path (line ~111) unchanged, never hits fallback                            |
| Library-linked asset resolves via fallback          | Second UNION branch finds library space                                          |
| Hidden space person filtered in fallback            | Same filtering as explicit spaceId path                                          |
| Explicit spaceId still works (existing tests)       | PR #242 tests unchanged                                                          |

### Frontend behavior verification

| Scenario                                 | Expected                                         |
| ---------------------------------------- | ------------------------------------------------ |
| Space member opens asset from timeline   | People and tags visible (via `resolvedSpaceId`)  |
| Space member opens asset from search     | People and tags visible (via `resolvedSpaceId`)  |
| Space member opens asset from space page | People and tags visible (via explicit `spaceId`) |
| Owner opens own asset from timeline      | Full edit controls (owner path)                  |
| Non-member opens asset                   | No people, no tags section                       |
| Space filter with unnamed people         | Shows "Name people to use this filter"           |
| Space filter with named people           | Shows people normally                            |
| Non-space filter with no people          | Shows "No people found" (default)                |

### Full test matrix (roles × entry points × metadata)

| Role       | Entry Point | People | Tags   | Rating | Location | Description | EXIF |
| ---------- | ----------- | ------ | ------ | ------ | -------- | ----------- | ---- |
| Owner      | Space page  | Edit   | Edit   | Edit   | Edit     | Edit        | View |
| Owner      | Timeline    | Edit   | Edit   | Edit   | Edit     | Edit        | View |
| Editor     | Space page  | Read   | Read   | Read   | Read     | Read        | View |
| Editor     | Timeline    | Read   | Read   | Read   | Read     | Read        | View |
| Viewer     | Space page  | Read   | Read   | Read   | Read     | Read        | View |
| Viewer     | Timeline    | Read   | Read   | Read   | Read     | Read        | View |
| Non-member | Any         | Hidden | Hidden | -      | -        | -           | -    |
| Partner    | Any         | Hidden | -      | Read   | Read     | Read        | View |

## Out of scope

1. **Photos page people filter** — needs cross-space person dedup logic
2. **Tag editing for space editors** — `TagAsset` permission model limitation
3. **`$preferences.tags.enabled` bypass** — space members must enable tags in settings
4. **Nav bar actions for editors** — edit/archive/favorite buttons hidden for non-owners
