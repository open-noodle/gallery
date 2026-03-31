# Show Tags & People to Space Members — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Space members see tags and recognized people in the asset detail view (read-only for all, owner-only editing).

**Architecture:** Server enriches asset response with space person IDs when `spaceId` query param is provided. Frontend threads `spaceId` through the asset viewer stack, uses it for visibility, thumbnails, and person links.

**Tech Stack:** NestJS (server), Svelte 5 (web), Kysely (DB queries), Vitest (tests), OpenAPI codegen

**Design doc:** `docs/plans/2026-03-30-space-asset-metadata-design.md`

---

## Task 1: Add `checkSpaceAccessForSpace` to access repository

**Files:**

- Modify: `server/src/repositories/access.repository.ts:217-268`
- Test: `server/src/services/asset.service.spec.ts` (tested via Task 4)

**Step 1: Add the scoped space access check method**

Add below the existing `checkSpaceAccess` method (after line 268). This is the same query but with an added `WHERE shared_space.id = spaceId` clause on both UNION branches:

```typescript
@GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID, DummyValue.UUID_SET] })
@ChunkedSet({ paramIndex: 2 })
async checkSpaceAccessForSpace(userId: string, spaceId: string, assetIds: Set<string>) {
  if (assetIds.size === 0) {
    return new Set<string>();
  }

  return this.db
    .selectFrom(
      this.db
        .selectFrom('shared_space_asset')
        .innerJoin('shared_space_member', 'shared_space_member.spaceId', 'shared_space_asset.spaceId')
        .innerJoin('asset', (join) =>
          join.onRef('asset.id', '=', 'shared_space_asset.assetId').on('asset.deletedAt', 'is', null),
        )
        .select(['asset.id', 'asset.livePhotoVideoId'])
        .where('shared_space_member.userId', '=', userId)
        .where('shared_space_asset.spaceId', '=', spaceId)
        .where((eb) =>
          eb.or([eb('asset.id', 'in', [...assetIds]), eb('asset.livePhotoVideoId', 'in', [...assetIds])]),
        )
        .union(
          this.db
            .selectFrom('shared_space_library')
            .innerJoin('shared_space_member', 'shared_space_member.spaceId', 'shared_space_library.spaceId')
            .innerJoin('asset', (join) =>
              join
                .onRef('asset.libraryId', '=', 'shared_space_library.libraryId')
                .on('asset.deletedAt', 'is', null)
                .on('asset.isOffline', '=', false),
            )
            .select(['asset.id', 'asset.livePhotoVideoId'])
            .where('shared_space_member.userId', '=', userId)
            .where('shared_space_library.spaceId', '=', spaceId)
            .where((eb) =>
              eb.or([eb('asset.id', 'in', [...assetIds]), eb('asset.livePhotoVideoId', 'in', [...assetIds])]),
            ),
        )
        .as('combined'),
    )
    .select(['combined.id', 'combined.livePhotoVideoId'])
    .execute()
    .then((assets) => {
      const allowedIds = new Set<string>();
      for (const asset of assets) {
        if (asset.id && assetIds.has(asset.id)) {
          allowedIds.add(asset.id);
        }
        if (asset.livePhotoVideoId && assetIds.has(asset.livePhotoVideoId)) {
          allowedIds.add(asset.livePhotoVideoId);
        }
      }
      return allowedIds;
    });
}
```

**Step 2: Add mock for `checkSpaceAccessForSpace`**

In `server/test/repositories/access.repository.mock.ts`, add `checkSpaceAccessForSpace` to the `asset` block alongside the existing `checkSpaceAccess`:

```typescript
checkSpaceAccessForSpace: vitest.fn().mockResolvedValue(new Set()),
```

**Step 3: Run type check**

Run: `cd server && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors related to access.repository.ts

**Step 4: Commit**

```
feat: add checkSpaceAccessForSpace to access repository
```

---

## Task 2: Add `findSpacePersonsByLinkedPersonIds` batch query

**Files:**

- Modify: `server/src/repositories/shared-space.repository.ts:903-913`

**Step 1: Add batch method below existing `findSpacePersonByLinkedPersonId` (line 913)**

```typescript
@GenerateSql({ params: [DummyValue.UUID, [DummyValue.UUID]] })
async findSpacePersonsByLinkedPersonIds(spaceId: string, personIds: string[]) {
  if (personIds.length === 0) {
    return new Map<string, { id: string; isHidden: boolean }>();
  }

  const results = await this.db
    .selectFrom('shared_space_person')
    .innerJoin('shared_space_person_face', 'shared_space_person_face.personId', 'shared_space_person.id')
    .innerJoin('asset_face', 'asset_face.id', 'shared_space_person_face.assetFaceId')
    .select(['shared_space_person.id', 'shared_space_person.isHidden', 'asset_face.personId'])
    .where('shared_space_person.spaceId', '=', spaceId)
    .where('asset_face.personId', 'in', personIds)
    .groupBy(['shared_space_person.id', 'shared_space_person.isHidden', 'asset_face.personId'])
    .execute();

  const map = new Map<string, { id: string; isHidden: boolean }>();
  for (const row of results) {
    if (row.personId) {
      map.set(row.personId, { id: row.id, isHidden: row.isHidden });
    }
  }
  return map;
}
```

**Step 2: Run type check**

Run: `cd server && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

**Step 3: Commit**

```
feat: add batch findSpacePersonsByLinkedPersonIds query
```

---

## Task 3: Add `spacePersonId` to DTO and `spaceId` query param to controller

**Files:**

- Modify: `server/src/dtos/person.dto.ts:124-127`
- Modify: `server/src/controllers/asset.controller.ts:104-113`
- Modify: `server/src/services/asset.service.ts:85` (method signature)

**Step 1: Add `spacePersonId` to `PersonWithFacesResponseDto`**

In `server/src/dtos/person.dto.ts` at line 126, after `faces!:`:

```typescript
export class PersonWithFacesResponseDto extends PersonResponseDto {
  @ApiProperty({ description: 'Face detections' })
  faces!: AssetFaceWithoutPersonResponseDto[];
  @ApiPropertyOptional({ description: 'Space person ID (when viewed through a space)' })
  spacePersonId?: string;
}
```

**Step 2: Add `spaceId` query param to controller**

In `server/src/controllers/asset.controller.ts`, change the `getAssetInfo` method (line 111):

```typescript
getAssetInfo(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto, @Query('spaceId') spaceId?: string): Promise<AssetResponseDto> {
  return this.service.get(auth, id, spaceId) as Promise<AssetResponseDto>;
}
```

Add `import { Query } from '@nestjs/common';` if not already imported.

**Step 3: Update `asset.service.get()` method signature**

In `server/src/services/asset.service.ts` line 85, add `spaceId` parameter:

```typescript
async get(auth: AuthDto, id: string, spaceId?: string): Promise<AssetResponseDto | SanitizedAssetResponseDto> {
```

(Don't change the body yet — that's Task 4.)

**Step 4: Run type check**

Run: `cd server && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

**Step 5: Commit**

```
feat: add spaceId query param and spacePersonId DTO field
```

---

## Task 4: Implement server logic — keep people for space members

**Files:**

- Modify: `server/src/services/asset.service.ts:111-113`
- Test: `server/src/services/asset.service.spec.ts:177-225`

**Step 1: Write failing tests**

In `server/src/services/asset.service.spec.ts`, replace the existing test "should clear people for shared space access (non-owner)" (lines 217-225) and add new tests after it. Keep the existing "should allow shared space access" test (207-215) unchanged.

Replace lines 217-225 with:

```typescript
it('should keep people for space member with spaceId', async () => {
  const asset = AssetFactory.from()
    .exif()
    .face({}, (f) => f.person({ id: 'person-1', name: 'Test Person' }))
    .build();
  mocks.access.asset.checkSpaceAccess.mockResolvedValue(new Set([asset.id]));
  mocks.asset.getById.mockResolvedValue(asset as any);
  mocks.sharedSpace.getMember.mockResolvedValue({ role: 'viewer' } as any);
  mocks.access.asset.checkSpaceAccessForSpace.mockResolvedValue(new Set([asset.id]));
  mocks.sharedSpace.findSpacePersonsByLinkedPersonIds.mockResolvedValue(
    new Map([['person-1', { id: 'space-person-1', isHidden: false }]]),
  );

  const result = await sut.get(authStub.admin, asset.id, 'space-id');

  expect(result).toHaveProperty('people');
  expect((result as any).people.length).toBeGreaterThan(0);
});

it('should strip people for space member without spaceId', async () => {
  const asset = AssetFactory.from()
    .exif()
    .face({}, (f) => f.person({ id: 'person-1', name: 'Test Person' }))
    .build();
  mocks.access.asset.checkSpaceAccess.mockResolvedValue(new Set([asset.id]));
  mocks.asset.getById.mockResolvedValue(asset as any);

  const result = await sut.get(authStub.admin, asset.id);

  expect(result).toHaveProperty('people', []);
});

it('should reject non-member spaceId', async () => {
  const asset = AssetFactory.from().exif().build();
  mocks.access.asset.checkSpaceAccess.mockResolvedValue(new Set([asset.id]));
  mocks.asset.getById.mockResolvedValue(asset as any);
  mocks.sharedSpace.getMember.mockResolvedValue(void 0 as any);

  await expect(sut.get(authStub.admin, asset.id, 'bad-space-id')).rejects.toThrow();
});

it('should filter hidden space persons', async () => {
  const asset = AssetFactory.from()
    .exif()
    .face({}, (f) => f.person({ id: 'person-1', name: 'Test Person' }))
    .build();
  mocks.access.asset.checkSpaceAccess.mockResolvedValue(new Set([asset.id]));
  mocks.asset.getById.mockResolvedValue(asset as any);
  mocks.sharedSpace.getMember.mockResolvedValue({ role: 'viewer' } as any);
  mocks.access.asset.checkSpaceAccessForSpace.mockResolvedValue(new Set([asset.id]));
  mocks.sharedSpace.findSpacePersonsByLinkedPersonIds.mockResolvedValue(
    new Map([['person-1', { id: 'sp-1', isHidden: true }]]),
  );

  const result = await sut.get(authStub.admin, asset.id, 'space-id');

  expect(result).toHaveProperty('people', []);
});

it('should filter persons without space person mapping', async () => {
  const asset = AssetFactory.from()
    .exif()
    .face({}, (f) => f.person({ id: 'person-1', name: 'Test Person' }))
    .build();
  mocks.access.asset.checkSpaceAccess.mockResolvedValue(new Set([asset.id]));
  mocks.asset.getById.mockResolvedValue(asset as any);
  mocks.sharedSpace.getMember.mockResolvedValue({ role: 'viewer' } as any);
  mocks.access.asset.checkSpaceAccessForSpace.mockResolvedValue(new Set([asset.id]));
  mocks.sharedSpace.findSpacePersonsByLinkedPersonIds.mockResolvedValue(new Map());

  const result = await sut.get(authStub.admin, asset.id, 'space-id');

  expect(result).toHaveProperty('people', []);
});

it('should still strip people for partner access', async () => {
  const asset = AssetFactory.from()
    .exif()
    .face({}, (f) => f.person({ id: 'person-1', name: 'Test Person' }))
    .build();
  mocks.access.asset.checkPartnerAccess.mockResolvedValue(new Set([asset.id]));
  mocks.asset.getById.mockResolvedValue(asset as any);

  const result = await sut.get(authStub.admin, asset.id);

  expect(result).toHaveProperty('people', []);
});

it('should still strip people for album access', async () => {
  const asset = AssetFactory.from()
    .exif()
    .face({}, (f) => f.person({ id: 'person-1', name: 'Test Person' }))
    .build();
  mocks.access.asset.checkAlbumAccess.mockResolvedValue(new Set([asset.id]));
  mocks.asset.getById.mockResolvedValue(asset as any);

  const result = await sut.get(authStub.admin, asset.id);

  expect(result).toHaveProperty('people', []);
});
```

**Step 2: Run tests to verify they fail**

Run: `cd server && pnpm test -- --run src/services/asset.service.spec.ts 2>&1 | tail -30`
Expected: New tests fail (method signature doesn't handle spaceId yet)

**Step 3: Implement the server logic**

In `server/src/services/asset.service.ts`, replace lines 111-113:

```typescript
if (auth.sharedLink) {
  data.people = [];
} else if (data.ownerId !== auth.user.id) {
  if (spaceId) {
    const member = await this.sharedSpaceRepository.getMember(spaceId, auth.user.id);
    if (!member) {
      throw new ForbiddenException('Not a member of this space');
    }

    const hasSpaceAccess = await this.accessRepository.asset.checkSpaceAccessForSpace(
      auth.user.id,
      spaceId,
      new Set([id]),
    );
    if (hasSpaceAccess.size === 0) {
      data.people = [];
    } else {
      const globalPersonIds = data.people.map((p) => p.id);
      const spacePersonMap = await this.sharedSpaceRepository.findSpacePersonsByLinkedPersonIds(
        spaceId,
        globalPersonIds,
      );
      for (const person of data.people) {
        const spacePerson = spacePersonMap.get(person.id);
        if (spacePerson) {
          person.spacePersonId = spacePerson.id;
        }
      }
      data.people = data.people.filter((p) => p.spacePersonId && !spacePersonMap.get(p.id)?.isHidden);
    }
  } else {
    data.people = [];
  }
}
```

Add `ForbiddenException` to the existing `@nestjs/common` import on line 1 of `asset.service.ts`.

**Step 4: Run tests to verify they pass**

Run: `cd server && pnpm test -- --run src/services/asset.service.spec.ts 2>&1 | tail -30`
Expected: All tests pass

**Step 5: Run full server type check**

Run: `cd server && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

**Step 6: Commit**

```
feat: keep people in asset response for space members
```

---

## Task 5: Regenerate OpenAPI spec and SDK

**Files:**

- Modified by codegen: `open-api/`, `server/immich-openapi-specs.json`

**Step 1: Build server**

Run: `cd server && pnpm build 2>&1 | tail -5`
Expected: Build succeeds

**Step 2: Regenerate OpenAPI spec**

Run: `cd server && pnpm sync:open-api 2>&1 | tail -5`

**Step 3: Regenerate TypeScript SDK and Dart client**

Run: `make open-api 2>&1 | tail -10`

Note: Must regenerate both TypeScript SDK and Dart client when API signatures change (per project convention).

**Step 4: Regenerate SQL query files**

Run: `make sql 2>&1 | tail -10`

**Step 5: Verify the SDK now includes `spaceId` parameter**

Run: `grep -n 'spaceId' open-api/typescript-sdk/src/fetch-client.ts | head -5`
Expected: `spaceId` appears in `getAssetInfo` function signature

**Step 6: Commit**

```
chore: regenerate OpenAPI spec and SDK with spaceId param
```

---

## Task 6: Add `Route.viewSpacePerson` to route helper

**Files:**

- Modify: `web/src/lib/route.ts:99-100`

**Step 1: Add the route helper**

After the `viewPerson` definition (line 100), add:

```typescript
viewSpacePerson: (spaceId: string, personId: string) => `/spaces/${spaceId}/people/${personId}`,
```

**Step 2: Run type check**

Run: `cd web && npx tsc --noEmit 2>&1 | head -10`

**Step 3: Commit**

```
feat: add viewSpacePerson route helper
```

---

## Task 7: Thread `spaceId` through Timeline → AssetViewer

**Files:**

- Modify: `web/src/lib/components/timeline/Timeline.svelte:30-63` (Props), `~723` (TimelineAssetViewer)
- Modify: `web/src/lib/components/timeline/TimelineAssetViewer.svelte:21-29` (Props), `~235` (AssetViewer)
- Modify: `web/src/lib/components/asset-viewer/asset-viewer.svelte:62-76` (Props), `~596` (DetailPanel)

**Step 1: Add `spaceId` to Timeline Props and forward it**

In `Timeline.svelte`, add to the Props interface:

```typescript
spaceId?: string;
```

Forward it to TimelineAssetViewer (around line 723):

```svelte
<TimelineAssetViewer bind:invisible {timelineManager} {removeAction} {withStacked} {isShared} {album} {person} {spaceId} />
```

**Step 2: Add `spaceId` to TimelineAssetViewer Props and forward it**

In `TimelineAssetViewer.svelte`, add to Props:

```typescript
spaceId?: string;
```

Forward to AssetViewer (around line 237):

```svelte
<AssetViewer {withStacked} cursor={assetCursor} {isShared} {album} {person} {spaceId} ... />
```

**Step 3: Add `spaceId` to AssetViewer Props and forward to DetailPanel**

In `asset-viewer.svelte`, add to Props:

```typescript
spaceId?: string;
```

Forward to DetailPanel (around line 596):

```svelte
<DetailPanel {asset} currentAlbum={album} {spaceId} />
```

**Step 4: Do NOT commit yet** — proceed to Task 8 immediately to avoid a broken intermediate commit.

---

## Task 8: Update DetailPanel — show people for space members

**Files:**

- Modify: `web/src/lib/components/asset-viewer/detail-panel.svelte:53-56` (Props), `~62` (derivations), `~189` (people guard), `~234` (person link), `~244` (thumbnail)

**Step 1: Add `spaceId` to Props and derive `isSpaceMember`**

Update Props (line 53-56):

```typescript
interface Props {
  asset: AssetResponseDto;
  currentAlbum?: AlbumResponseDto | null;
  spaceId?: string;
}
```

Add derivation after `isOwner` (line 62):

```typescript
let isSpaceMember = $derived(!!spaceId);
```

**Step 2: Update people section visibility guard**

Change line 189 from:

```svelte
{#if !authManager.isSharedLink && isOwner}
```

To:

```svelte
{#if !authManager.isSharedLink && (isOwner || isSpaceMember)}
```

**Step 3: Gate edit controls within people section to `isOwner` only**

Wrap the face edit button, show/hide toggle, and "tag people" button with `{#if isOwner}` guards. These are inside the people section but should only show for owners. Find them by looking for the `mdiPencil`, `mdiEye`/`mdiEyeOff`, and `mdiPlus` icon references within the people section.

**Step 4: Update person link to use space route**

Change the person link (around line 234) from:

```svelte
href={Route.viewPerson(person, { previousRoute })}
```

To:

```svelte
href={spaceId && person.spacePersonId
  ? Route.viewSpacePerson(spaceId, person.spacePersonId)
  : Route.viewPerson(person, { previousRoute })}
```

Import `Route.viewSpacePerson` if needed (should be on the same `Route` object).

**Step 5: Update person thumbnail to use space endpoint**

Change the thumbnail URL (around line 244) from:

```svelte
url={getPeopleThumbnailUrl(person)}
```

To:

```svelte
url={spaceId && person.spacePersonId
  ? createUrl(`/shared-spaces/${spaceId}/people/${person.spacePersonId}/thumbnail`, { updatedAt: person.updatedAt })
  : getPeopleThumbnailUrl(person)}
```

Add `createUrl` to imports if not already present (from `$lib/utils`).

**Step 6: Run type check**

Run: `cd web && npx tsc --noEmit 2>&1 | head -20`

**Step 7: Commit (includes Task 7 changes)**

```
feat: thread spaceId and show people to space members in detail panel
```

---

## Task 9: Update DetailPanelTags — show tags read-only for space members

**Files:**

- Modify: `web/src/lib/components/asset-viewer/detail-panel-tags.svelte`

**Step 1: Add `spaceId` to Props**

```typescript
interface Props {
  asset: AssetResponseDto;
  isOwner: boolean;
  spaceId?: string;
}

let { asset = $bindable(), isOwner, spaceId }: Props = $props();
let isSpaceMember = $derived(!!spaceId);
```

**Step 2: Update visibility guard**

Change line 40 from:

```svelte
{#if isOwner && !authManager.isSharedLink}
```

To:

```svelte
{#if (isOwner || isSpaceMember) && !authManager.isSharedLink}
```

**Step 3: Gate edit controls**

Wrap the `IconButton` (remove X, lines 54-61) with `{#if isOwner}`:

```svelte
{#if isOwner}
  <IconButton
    aria-label={$t('remove_tag')}
    icon={mdiClose}
    onclick={() => handleRemove(tag.id)}
    size="tiny"
    class="hover:bg-primary-400"
    shape="round"
  />
{/if}
```

Wrap the `HeaderActionButton` (add tag, line 64) with `{#if isOwner}`:

```svelte
{#if isOwner}
  <HeaderActionButton action={Tag} />
{/if}
```

**Step 4: Update `getAssetInfo` re-fetch calls to include `spaceId`**

Change line 25:

```typescript
asset = await getAssetInfo({ id: asset.id, spaceId });
```

Change line 31:

```typescript
asset = await getAssetInfo({ id: asset.id, spaceId });
```

**Step 5: Forward `spaceId` from DetailPanel**

In `detail-panel.svelte`, update the DetailPanelTags usage (around line 570):

```svelte
<DetailPanelTags {asset} {isOwner} {spaceId} />
```

**Step 6: Run type check**

Run: `cd web && npx tsc --noEmit 2>&1 | head -20`

**Step 7: Commit**

```
feat: show tags read-only to space members
```

---

## Task 10: Update AssetCacheManager and other `getAssetInfo` call sites

**Files:**

- Modify: `web/src/lib/managers/AssetCacheManager.svelte.ts:53-55`
- Modify: `web/src/lib/components/spaces/space-search-results.svelte:25`
- Modify: `web/src/lib/managers/asset-viewer-manager.svelte.ts:169-173`

**Step 1: Update AssetCacheManager to accept `spaceId` (bypass cache for space context)**

Change `getAsset` method (line 53). Space context always needs fresh data with person enrichment, so bypass the cache when `spaceId` is provided. This avoids cache key mismatch issues with `invalidateAsset`:

```typescript
async getAsset({ id, key, slug, spaceId }: { id: string; key?: string; slug?: string; spaceId?: string }, updateCache = true) {
  if (spaceId) {
    // Space context needs fresh data with person enrichment — bypass cache
    return getAssetInfo({ id, key, slug, spaceId });
  }
  return this.#assetCache.getOrFetch({ id, key, slug }, updateCache);
}
```

**Step 2: Update space-search-results.svelte**

This component has no `spaceId` prop. Add it:

1. Add `spaceId?: string` to the Props interface
2. Update `getFullAsset` (line 25) to include `spaceId`:

```typescript
const getFullAsset = async (id: string): Promise<AssetResponseDto> => {
  return getAssetInfo({ ...authManager.params, id, spaceId });
};
```

3. Forward `spaceId` to the dynamically imported `AssetViewer` (around line 110-111)
4. In the space page `+page.svelte`, find where `SpaceSearchResults` is used (around line 853) and pass `spaceId={space.id}`

**Step 3: Update TimelineAssetViewer call sites**

`TimelineAssetViewer.svelte` has two additional `getAssetInfo` calls that need `spaceId`:

1. Line ~42-44: `assetCacheManager.getAsset({ ...authManager.params, id })` — add `spaceId`
2. Line ~207: `getAssetInfo({ ...authManager.params, id: restoredAsset.id })` in the undo-delete handler — add `spaceId`

**Step 4: Update asset-viewer-manager.svelte.ts**

The `setAssetId` method (line 170) needs to accept and pass `spaceId`. Since the asset viewer manager is a singleton, passing `spaceId` per-call is better than storing it as state:

```typescript
async setAssetId(id: string, spaceId?: string): Promise<AssetResponseDto> {
  const asset = await getAssetInfo({ ...authManager.params, id, spaceId });
  this.setAsset(asset);
  return asset;
}
```

Update callers of `setAssetId` to pass `spaceId` when available.

**Step 5: Run type check**

Run: `cd web && npx tsc --noEmit 2>&1 | head -20`

**Step 5: Commit**

```
feat: pass spaceId through cache manager and search results
```

---

## Task 11: Wire `spaceId` from space page to Timeline

**Files:**

- Modify: `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.svelte:877-941`

**Step 1: Pass `spaceId` to Timeline**

The space page already has `space.id` available. Add `spaceId={space.id}` to the Timeline component (around line 877):

```svelte
<Timeline
  enableRouting={false}
  bind:timelineManager
  {options}
  assetInteraction={currentAssetInteraction}
  {isSelectionMode}
  onEscape={handleEscape}
  spaceId={space.id}
>
```

**Step 2: Run svelte-check**

Run: `cd web && pnpm check 2>&1 | tail -20`

**Step 3: Commit**

```
feat: pass spaceId from space page to timeline
```

---

## Task 12: Server unit tests — comprehensive coverage

**Files:**

- Modify: `server/src/services/asset.service.spec.ts`

**Step 1: Verify all tests pass**

Run: `cd server && pnpm test -- --run src/services/asset.service.spec.ts 2>&1 | tail -30`
Expected: All tests from Task 4 pass

**Step 2: Add test for "space member but asset not in that space"**

```typescript
it('should strip people when asset is not in the specified space', async () => {
  const asset = AssetFactory.from()
    .exif()
    .face({}, (f) => f.person({ id: 'person-1', name: 'Test Person' }))
    .build();
  mocks.access.asset.checkSpaceAccess.mockResolvedValue(new Set([asset.id]));
  mocks.asset.getById.mockResolvedValue(asset as any);
  mocks.sharedSpace.getMember.mockResolvedValue({ role: 'viewer' } as any);
  mocks.access.asset.checkSpaceAccessForSpace.mockResolvedValue(new Set());

  const result = await sut.get(authStub.admin, asset.id, 'space-id');

  expect(result).toHaveProperty('people', []);
});
```

**Step 3: Run tests**

Run: `cd server && pnpm test -- --run src/services/asset.service.spec.ts 2>&1 | tail -20`
Expected: All pass

**Step 4: Commit**

```
test: comprehensive server tests for space metadata visibility
```

---

## Task 13: Frontend unit tests

**Files:**

- Modify: `web/src/lib/components/asset-viewer/detail-panel-tags.spec.ts` (create if needed)

**Step 1: Check if test files exist**

Run: `ls web/src/lib/components/asset-viewer/detail-panel*.spec.ts 2>/dev/null`

**Step 2: Write tests for DetailPanelTags**

Test that:

- Tags section visible when `spaceId` is set (even when not owner)
- Tags section hidden when no `spaceId` and not owner
- Remove buttons hidden when `spaceId` is set (read-only)
- Add tag button hidden when `spaceId` is set
- Owner still sees edit controls even with `spaceId`

**Step 3: Run frontend tests**

Run: `cd web && pnpm test -- --run src/lib/components/asset-viewer/detail-panel-tags.spec.ts 2>&1 | tail -20`

**Step 4: Commit**

```
test: frontend tests for space metadata visibility
```

---

## Task 14: Regenerate SQL query files and final checks

**Files:**

- Modified by codegen: `server/src/queries/`

**Step 1: Rebuild server**

Run: `cd server && pnpm build 2>&1 | tail -5`

**Step 2: Regenerate SQL**

Run: `make sql 2>&1 | tail -10`

**Step 3: Run full lint and type check**

Run: `make check-server 2>&1 | tail -20`
Then: `make check-web 2>&1 | tail -20`
Then: `make lint-server 2>&1 | tail -20`
Then: `make lint-web 2>&1 | tail -20`

**Step 4: Run full test suites**

Run: `cd server && pnpm test 2>&1 | tail -20`
Then: `cd web && pnpm test 2>&1 | tail -20`

**Step 5: Commit any codegen changes**

```
chore: regenerate SQL query files
```

---

## Task 15: Format and final commit

**Step 1: Format all changed files**

Run: `make format-server && make format-web`

**Step 2: Run final check**

Run: `make check-all 2>&1 | tail -30`

**Step 3: Commit any formatting changes**

```
style: format
```
