# Show Tags and People to Space Members in Asset Detail View

**Discussion:** [#194](https://github.com/open-noodle/gallery/discussions/194)
**Date:** 2026-03-30

## Problem

Space members (Viewers and Editors) cannot see tags or recognized people when viewing an asset's detail panel. This metadata is visible only to the asset owner.

Two layers cause this:

1. **Server** (`asset.service.ts:111-113`): `data.people = []` for all non-owners, including space members
2. **Frontend** (`detail-panel.svelte:189`, `detail-panel-tags.svelte:40`): Tags and people sections gated by `isOwner` check

## Design

### Approach

The server keeps people data when the user has space access, and enriches the response with space person IDs for thumbnail/link resolution. The frontend threads `spaceId` from the space page through the asset viewer stack and uses it for visibility decisions, thumbnail URLs, and person links.

### Server Changes

#### 1. `asset.service.get()` — keep people for space members and enrich with space person IDs

```typescript
// Before:
if (data.ownerId !== auth.user.id || auth.sharedLink) {
  data.people = [];
}

// After:
if (auth.sharedLink) {
  data.people = [];
} else if (data.ownerId !== auth.user.id) {
  if (spaceId) {
    // Validate user is a member of this specific space
    const member = await this.sharedSpaceRepository.getMember(spaceId, auth.user.id);
    if (!member) {
      throw new ForbiddenException('Not a member of this space');
    }

    // Verify asset is in this specific space (scoped check)
    const hasSpaceAccess = await this.accessRepository.asset.checkSpaceAccessForSpace(
      auth.user.id,
      spaceId,
      new Set([id]),
    );
    if (hasSpaceAccess.size === 0) {
      data.people = [];
    } else {
      // Batch-enrich with space person IDs, filter out unmapped and hidden persons
      const globalPersonIds = data.people.map((p) => p.id);
      const spacePersonMap = await this.sharedSpaceRepository.findSpacePersonsByLinkedPersonIds(
        spaceId,
        globalPersonIds,
      );
      for (const person of data.people) {
        const spacePerson = spacePersonMap.get(person.id);
        person.spacePersonId = spacePerson?.id;
      }
      data.people = data.people.filter((p) => p.spacePersonId && !spacePersonMap.get(p.id)?.isHidden);
    }
  } else {
    // Non-owner without spaceId: partner, album member, or other non-space context
    data.people = [];
  }
}
```

**Space membership check:** `SharedSpaceService.requireMembership()` is private. Instead, call `sharedSpaceRepository.getMember(spaceId, userId)` directly — this is the same underlying query and is already accessible via `BaseService`.

**Scoped space access check:** The existing `checkSpaceAccess(userId, assetIds)` checks if the asset is in _any_ space the user belongs to. We need a new `checkSpaceAccessForSpace(userId, spaceId, assetIds)` variant that confirms the asset is in the _specific_ `spaceId`. This prevents a user from passing `spaceId=A` to get person mappings from space A when the asset is only in space B. The query is a straightforward modification of the existing one with an added `WHERE shared_space.id = $spaceId` clause.

**Performance:** Adds one membership check + one scoped asset access check + one batch person lookup for non-owner views with `spaceId`. Without `spaceId`, behavior is identical to before (people stripped).

**Partner/album access unchanged:** Partners and album members still get `data.people = []`. The existing behavior is intentional (explicit tests confirm it). Only space access with explicit `spaceId` is special-cased.

**Important:** Omitting `spaceId` is the correct default for non-space contexts (photos page, albums, partner views). The space page is responsible for always providing it. Without `spaceId`, non-owners get empty people regardless of space membership.

#### 2. Person thumbnails and links — the data model challenge

Global persons (`person` table) and space persons (`shared_space_person` table) are separate entities linked indirectly through `shared_space_person_face` → `asset_face` → `person`. The `asset.people` response contains global `PersonResponseDto` objects, but:

- The person thumbnail endpoint (`/people/{id}/thumbnail`) requires `PersonRead` (owner-only) — space members get 403
- The global person page (`/people/{id}`) would either 403 or leak all the person's assets beyond the space
- The space person thumbnail endpoint (`/shared-spaces/{spaceId}/people/{spacePersonId}/thumbnail`) requires a space person ID, not a global person ID

**Solution:** The repository already has `findSpacePersonByLinkedPersonId(spaceId, personId)` which maps global person ID → space person ID for a given space. The server enrichment step above adds `spacePersonId` to each person in the response. The frontend uses this to construct space-scoped thumbnail URLs and person links.

**New batch query:** Add `findSpacePersonsByLinkedPersonIds(spaceId, personIds[])` to the shared space repository. Straightforward extension of the existing `findSpacePersonByLinkedPersonId` with `WHERE asset_face.personId IN (...)`. Returns a `Map<string, SharedSpacePerson>` keyed by global person ID.

**DTO change:** Add optional `spacePersonId?: string` to `PersonWithFacesResponseDto`. This is a fork-only field, unused by non-space contexts.

**API change:** Add optional `spaceId` query parameter to `GET /assets/:id`. Requires: `@Query()` parameter in the controller, rebuilding OpenAPI spec (`pnpm sync:open-api`), and regenerating SDK clients (`make open-api`).

#### 3. Hidden people filtering

`asset.people[].isHidden` reflects the global person's hidden status set by the asset owner. Space persons have their own `isHidden` flag. For space members, the space-level `isHidden` applies:

- People where the corresponding space person has `isHidden: true` are filtered out during the enrichment step above
- People with no space person mapping (below face threshold or not yet synced) are also filtered out
- The global `isHidden` flag is irrelevant in space context

### Frontend Changes

#### 1. Thread `spaceId` through the asset viewer stack

The space page already has the space ID from the route. Thread it as a single optional prop through the component chain. This requires adding `spaceId?: string` to four component interfaces:

1. **Timeline** — accepts `spaceId`, forwards to TimelineAssetViewer
2. **TimelineAssetViewer** — forwards to AssetViewer
3. **AssetViewer** — forwards to DetailPanel, passes to asset fetch calls
4. **DetailPanel** — forwards to DetailPanelTags, uses for visibility and person links

This matches the existing pattern of `album` and `isShared` being threaded through the same chain (Timeline → TimelineAssetViewer → AssetViewer). Note: `album`/`isShared` don't currently reach DetailPanel (it derives `isOwner` independently), so this extends the pattern one level deeper.

Non-space pages (photos, albums, etc.) don't pass `spaceId`, so they require zero changes.

Components derive:

```typescript
let isSpaceMember = $derived(!!spaceId);
```

#### 2. Pass `spaceId` to all asset fetch calls

**AssetViewer / asset viewer manager:** Pass `spaceId` to `getAssetInfo()`:

```typescript
const asset = await getAssetInfo({ id, spaceId });
```

**AssetCacheManager:** The `AssetCacheManager.getAsset()` method currently accepts `{ id, key, slug }`. Extend it to accept `spaceId`:

```typescript
async getAsset({ id, key, slug, spaceId }, updateCache = true) {
  return this.#assetCache.getOrFetch({ id, key, slug, spaceId }, updateCache);
}
```

The cache key must include `spaceId` so that the same asset fetched from space context (with people) and non-space context (without people) are cached separately. The `invalidateAsset` method should clear all variants for a given `id`.

**space-search-results.svelte:** This component calls `getAssetInfo()` directly in space context. It must also pass `spaceId`. The component is under `components/spaces/` and already has access to the space context.

**detail-panel-tags.svelte:** Lines 25 and 31 re-fetch the asset after tag add/remove via `getAssetInfo({ id: asset.id })`. These calls must include `spaceId` to preserve people data in the re-fetched response. The component needs `spaceId` as a prop (already threaded from DetailPanel).

#### 3. DetailPanel (`detail-panel.svelte`)

**People section visibility** — change from `isOwner` to `isOwner || isSpaceMember`:

```svelte
{#if !authManager.isSharedLink && (isOwner || isSpaceMember)}
```

**Within the people section:**

- Person thumbnails, names, ages: visible to all space members (read-only)
- Face edit button: `isOwner` only
- Show/hide hidden people toggle: `isOwner` only
- "Tag people" button: `isOwner` only (person assignment is owner-scoped)

**Person thumbnails:** When `spaceId` is present, use the space person thumbnail endpoint:

```typescript
const thumbnailUrl =
  spaceId && person.spacePersonId
    ? createUrl(`/shared-spaces/${spaceId}/people/${person.spacePersonId}/thumbnail`, {
        updatedAt: person.updatedAt,
      })
    : getPeopleThumbnailUrl(person);
```

**Person links:** When `spaceId` is present, link to the space person page. Add a `viewSpacePerson` helper to `route.ts`:

```typescript
// In route.ts:
viewSpacePerson: (spaceId: string, personId: string) => `/spaces/${spaceId}/people/${personId}`,
```

```svelte
href={spaceId && person.spacePersonId
  ? Route.viewSpacePerson(spaceId, person.spacePersonId)
  : Route.viewPerson(person, { previousRoute })}
```

The space person page and API already exist and require only space membership.

#### 4. DetailPanelTags (`detail-panel-tags.svelte`)

**Props change:** Add `spaceId?: string` to the component's Props interface (needed for asset re-fetch after tag operations).

**Tags visibility** — read-only for all space members:

```svelte
{#if (isOwner || isSpaceMember) && !authManager.isSharedLink}
```

**Read-only rendering:** Wrap each edit control individually in `{#if isOwner}` guards:

- The `IconButton` (remove X) on each tag badge: `{#if isOwner}`
- The `HeaderActionButton` (add tag): `{#if isOwner}`
- The tag value `Link` and `Badge` remain visible to all members

**Asset re-fetch:** Update lines 25 and 31 to include `spaceId`:

```typescript
asset = await getAssetInfo({ id: asset.id, spaceId });
```

**Tag editing deferred:** All space members (including Editors) see tags as read-only. The server's `TagAsset` permission checks tag ownership, not asset access. Space editors can only add/remove their own tags — not the owner's. Showing edit controls that partially work creates confusing UX. A follow-up should extend `TagAsset` or add tag-ownership-aware UI.

#### 5. Asset owner views own asset through space context

When the asset owner views their own asset through a space page, both `isOwner` and `isSpaceMember` are true. The `isOwner` path gives full edit controls. The `spacePersonId` enrichment still runs (harmless — owner already sees everything). No special handling needed.

### Testing

#### Server unit tests

| Test                                                  | What it verifies                                                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Space member sees people (with spaceId)               | `checkSpaceAccessForSpace` hit + `findSpacePersonsByLinkedPersonIds` → people preserved with `spacePersonId` |
| Non-member, non-owner sees no people                  | No owner/space access → `people` is `[]`                                                                     |
| Partner still sees no people                          | `checkPartnerAccess` hit but no `spaceId` → `people` is `[]`                                                 |
| Album member still sees no people                     | `checkAlbumAccess` hit but no `spaceId` → `people` is `[]`                                                   |
| Shared link still sees no people                      | `auth.sharedLink` set → `people` is `[]` regardless                                                          |
| Owner always sees people                              | `ownerId === auth.user.id` → people preserved (no space check)                                               |
| Hidden space person filtered out                      | Space person with `isHidden: true` → excluded from people                                                    |
| Person without space person filtered out              | Global person with no `shared_space_person` match → excluded                                                 |
| User is space member but asset not in that space      | `checkSpaceAccessForSpace` returns empty → `people` is `[]`                                                  |
| User passes spaceId for space they're not a member of | `getMember` returns null → 403                                                                               |

#### Frontend unit tests

| Test                                                          | What it verifies                          |
| ------------------------------------------------------------- | ----------------------------------------- |
| DetailPanel shows people when `spaceId` set                   | People section renders for space members  |
| DetailPanel hides people when no `spaceId` and not owner      | People section hidden                     |
| DetailPanel hides face edit for space members                 | Edit controls require `isOwner`           |
| DetailPanelTags shows tags when `spaceId` set                 | Tags section renders for space members    |
| DetailPanelTags hides add/remove for space members            | Tag editing requires `isOwner`            |
| Person link goes to space person route when `spaceId` present | Correct `href` using `spacePersonId`      |
| Person thumbnail uses space endpoint when `spaceId` present   | Correct thumbnail URL construction        |
| Asset with zero people shows nothing for viewer               | No empty people section for space viewers |
| Asset with zero people shows tag-people button for owner      | Owner sees the section even when empty    |

#### E2E tests

| Test                                               | What it verifies                                          |
| -------------------------------------------------- | --------------------------------------------------------- |
| Space viewer sees tags on asset detail             | Read-only tags visible                                    |
| Space viewer sees people on asset detail           | Read-only people with thumbnails visible                  |
| Space editor sees tags on asset detail (read-only) | No edit controls                                          |
| Non-member cannot see tags/people                  | Standard access denial                                    |
| Person link navigates to space person page         | Click person → `/spaces/{spaceId}/people/{spacePersonId}` |

### Edge Cases

| Edge Case                                          | Handling                                                                                                    |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Asset with zero tags and zero people               | Viewers see nothing (no empty sections). Owner sees sections with add buttons                               |
| Asset in multiple spaces, user has different roles | `spaceId` param scopes to the specific space — person mappings come from that space only                    |
| Space member removed mid-session                   | Next API call fails `requireAccess` → 403. Acceptable                                                       |
| Asset removed from space while viewing             | Same — 403 on next call                                                                                     |
| Global person has no space person mapping          | Filtered out of response (below face threshold or not yet synced)                                           |
| `isShared` prop interaction                        | `isShared` is for album context. Independent of `spaceId` — no conflict                                     |
| User passes wrong `spaceId` to API                 | `getMember` check rejects with 403 before any enrichment                                                    |
| User is member of space but asset not in it        | `checkSpaceAccessForSpace` returns empty set — people stripped, asset still viewable via other access paths |
| Same asset cached with and without spaceId         | Cache key includes `spaceId` — separate cache entries. `invalidateAsset` clears all variants for given `id` |

### Out of Scope (Follow-ups)

1. **Tag editing for space editors** — requires `TagAsset` permission model changes or tag-ownership-aware UI
2. **Face tagging / person assignment by editors** — complex person permission model
3. **Nav bar actions for space editors** — `asset-viewer-nav-bar.svelte` gates edit/archive/favorite by `isOwner`. Space editors have `AssetUpdate` permission but the nav bar hides buttons
4. **Description / rating / location editing for editors** — `DetailPanelDescription`, `DetailPanelRating`, `DetailPanelLocation` all gate edit controls on `isOwner`. Space editors already have server permission
5. **Mobile app** — separate feature
