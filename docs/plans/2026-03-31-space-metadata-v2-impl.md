# Space Metadata Visibility v2 — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Space members see people/tags when opening assets from timeline or search (not just space page), plus "name people" hint in filter panel.

**Architecture:** Server auto-resolves space context via `findSpaceForAssetAndUser` when `spaceId` not provided. Frontend uses `resolvedSpaceId` from the response.

**Tech Stack:** NestJS, Svelte 5, Kysely, Vitest, OpenAPI codegen

**Design doc:** `docs/plans/2026-03-31-space-metadata-v2-design.md`

---

## Task 1: Add `findSpaceForAssetAndUser` repository method

**Files:**

- Modify: `server/src/repositories/shared-space.repository.ts` (after line 1003, end of `findSpacePersonsByLinkedPersonIds`)

**Step 1: Add the method**

```typescript
@GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
async findSpaceForAssetAndUser(assetId: string, userId: string) {
  return this.db
    .selectFrom(
      this.db
        .selectFrom('shared_space_asset')
        .innerJoin('shared_space_member', 'shared_space_member.spaceId', 'shared_space_asset.spaceId')
        .innerJoin('asset', (join) =>
          join.onRef('asset.id', '=', 'shared_space_asset.assetId').on('asset.deletedAt', 'is', null),
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

**Step 2: Type check**

Run: `cd server && npx tsc --noEmit 2>&1 | head -10`

**Step 3: Commit**

```
feat: add findSpaceForAssetAndUser repository method
```

---

## Task 2: Add `resolvedSpaceId` to DTO and implement server fallback

**Files:**

- Modify: `server/src/dtos/asset-response.dto.ts:56` (AssetResponseDto class)
- Modify: `server/src/services/asset.service.ts:141-142` (else branch)

**Step 1: Add DTO field**

In `asset-response.dto.ts`, add to `AssetResponseDto` (after the last field, before the closing `}`):

```typescript
@ApiPropertyOptional({ description: 'Resolved space ID (when server auto-detects space context)' })
resolvedSpaceId?: string;
```

**Step 2: Implement the fallback**

In `asset.service.ts`, replace lines 141-142 (`} else { data.people = []; }`) with:

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

**Step 3: Type check**

Run: `cd server && npx tsc --noEmit 2>&1 | head -10`

**Step 4: Commit**

```
feat: server-side space context fallback for asset metadata
```

---

## Task 3: Write server unit tests

**Files:**

- Modify: `server/src/services/asset.service.spec.ts`

**Step 1: Add tests** after the existing space-related tests in the `describe('get')` block.

Use factory: `AssetFactory.from().exif().face({}, (f) => f.person({ id: 'person-1', name: 'Test Person' })).build()`

```typescript
it('should keep people for space member without spaceId (fallback)', async () => {
  const asset = AssetFactory.from()
    .exif()
    .face({}, (f) => f.person({ id: 'person-1', name: 'Test Person' }))
    .build();
  mocks.access.asset.checkSpaceAccess.mockResolvedValue(new Set([asset.id]));
  mocks.asset.getById.mockResolvedValue(asset as any);
  mocks.sharedSpace.findSpaceForAssetAndUser.mockResolvedValue({ spaceId: 'space-1' });
  mocks.sharedSpace.findSpacePersonsByLinkedPersonIds.mockResolvedValue(
    new Map([['person-1', { id: 'sp-1', isHidden: false }]]),
  );

  const result = await sut.get(authStub.admin, asset.id);

  expect(result).toHaveProperty('people');
  expect((result as any).people.length).toBeGreaterThan(0);
  expect((result as any).resolvedSpaceId).toBe('space-1');
});

it('should strip people when fallback finds no space', async () => {
  const asset = AssetFactory.from()
    .exif()
    .face({}, (f) => f.person({ id: 'person-1', name: 'Test Person' }))
    .build();
  mocks.access.asset.checkPartnerAccess.mockResolvedValue(new Set([asset.id]));
  mocks.asset.getById.mockResolvedValue(asset as any);
  mocks.sharedSpace.findSpaceForAssetAndUser.mockResolvedValue(void 0 as any);

  const result = await sut.get(authStub.admin, asset.id);

  expect(result).toHaveProperty('people', []);
  expect(result).not.toHaveProperty('resolvedSpaceId');
});

it('should filter hidden persons in fallback path', async () => {
  const asset = AssetFactory.from()
    .exif()
    .face({}, (f) => f.person({ id: 'person-1', name: 'Test Person' }))
    .build();
  mocks.access.asset.checkSpaceAccess.mockResolvedValue(new Set([asset.id]));
  mocks.asset.getById.mockResolvedValue(asset as any);
  mocks.sharedSpace.findSpaceForAssetAndUser.mockResolvedValue({ spaceId: 'space-1' });
  mocks.sharedSpace.findSpacePersonsByLinkedPersonIds.mockResolvedValue(
    new Map([['person-1', { id: 'sp-1', isHidden: true }]]),
  );

  const result = await sut.get(authStub.admin, asset.id);

  expect(result).toHaveProperty('people', []);
});
```

**Step 2: Run tests**

Run: `cd server && pnpm test -- --run src/services/asset.service.spec.ts 2>&1 | tail -20`

**Step 3: Commit**

```
test: server tests for space context fallback
```

---

## Task 4: Regenerate OpenAPI spec and SDK

**Step 1: Build server**

Run: `cd server && pnpm build 2>&1 | tail -5`

**Step 2: Regenerate OpenAPI spec**

Run: `cd server && pnpm sync:open-api 2>&1 | tail -5`

**Step 3: Regenerate all clients**

Run: `make open-api 2>&1 | tail -10`

**Step 4: Verify resolvedSpaceId in SDK**

Run: `grep -n 'resolvedSpaceId' open-api/typescript-sdk/src/fetch-client.ts | head -5`

**Step 5: Commit**

```
chore: regenerate OpenAPI spec and SDK with resolvedSpaceId
```

---

## Task 5: Frontend — use `effectiveSpaceId` in detail panel

**Files:**

- Modify: `web/src/lib/components/asset-viewer/detail-panel.svelte:60`
- Modify: `web/src/lib/components/asset-viewer/detail-panel-tags.svelte:19-20`

**Step 1: Update detail-panel.svelte**

Change line 60 from:

```typescript
let isSpaceMember = $derived(!!spaceId);
```

To:

```typescript
let effectiveSpaceId = $derived(spaceId || asset.resolvedSpaceId);
let isSpaceMember = $derived(!!effectiveSpaceId);
```

Then replace all uses of `spaceId` in the template with `effectiveSpaceId`:

- Person thumbnail URL (around line 250)
- Person link href (around line 238)
- DetailPanelTags prop (around line 580): `<DetailPanelTags {asset} {isOwner} spaceId={effectiveSpaceId} />`

**Step 2: Update detail-panel-tags.svelte**

Change line 19-20 from:

```typescript
let { asset = $bindable(), isOwner, spaceId }: Props = $props();
let isSpaceMember = $derived(!!spaceId);
```

To:

```typescript
let { asset = $bindable(), isOwner, spaceId }: Props = $props();
let effectiveSpaceId = $derived(spaceId || asset.resolvedSpaceId);
let isSpaceMember = $derived(!!effectiveSpaceId);
```

Update the `getAssetInfo` re-fetch calls (lines 27, 33) to pass `effectiveSpaceId`:

```typescript
asset = await getAssetInfo({ id: asset.id, spaceId: effectiveSpaceId });
```

**Step 3: Type check**

Run: `cd web && npx tsc --noEmit 2>&1 | head -10`

**Step 4: Commit**

```
feat: use resolvedSpaceId for timeline/search asset metadata
```

---

## Task 6: "Name people" hint in filter panel

**Files:**

- Modify: `web/src/lib/components/filter-panel/filter-panel.svelte:278-282`
- Modify: `web/src/lib/components/filter-panel/filter-panel.ts` (FilterPanelConfig type, if needed)

**Step 1: Add `hasUnnamedPeople` state and secondary check**

In `filter-panel.svelte`, add state:

```typescript
let hasUnnamedPeople = $state(false);
```

Change lines 278-282 from:

```typescript
$effect(() => {
  if (config.providers.people && config.sections.includes('people')) {
    void config.providers.people().then((result) => {
      people = result;
    });
  }
});
```

To:

```typescript
$effect(() => {
  if (config.providers.people && config.sections.includes('people')) {
    void config.providers.people().then((result) => {
      people = result;
      if (result.length === 0 && config.providers.allPeople) {
        void config.providers.allPeople().then((all) => {
          hasUnnamedPeople = all.length > 0;
        });
      }
    });
  }
});
```

**Step 2: Add `allPeople` provider to FilterPanelConfig**

In `filter-panel.ts`, add to the providers interface:

```typescript
allPeople?: () => Promise<PersonOption[]>;
```

**Step 3: Pass `emptyText` to PeopleFilter**

Find where `PeopleFilter` is used in `filter-panel.svelte` and add:

```svelte
<PeopleFilter
  {people}
  ...
  emptyText={hasUnnamedPeople ? 'Name people to use this filter' : undefined}
/>
```

**Step 4: Wire the `allPeople` provider in the space page**

In the space page (`+page.svelte`), add to `filterConfig.providers`:

```typescript
allPeople: async () => {
  const people = await getSpacePeople({ id: space.id, limit: 1 });
  return people.map((p) => ({ id: p.id, name: p.name, thumbnailUrl: '' }));
},
```

**Step 5: Type check**

Run: `cd web && npx tsc --noEmit 2>&1 | head -10`

**Step 6: Commit**

```
feat: show "name people" hint when unnamed people exist in space filter
```

---

## Task 7: Regenerate SQL query files and apply CI diff

**Step 1: Build server**

Run: `cd server && pnpm build 2>&1 | tail -5`

**Step 2: Try local SQL regen (may need running DB)**

Run: `make sql 2>&1 | tail -10`

If no local DB, add the SQL manually for `findSpaceForAssetAndUser` to `server/src/queries/shared.space.repository.sql`. The query SQL will be provided by CI diff if needed.

**Step 3: Commit**

```
chore: regenerate SQL query files
```

---

## Task 8: Lint, format, final checks

**Step 1: Format**

Run: `make format-server && make format-web`

**Step 2: Lint**

Run: `make lint-server 2>&1 | tail -5`
Run: `make lint-web 2>&1 | tail -5`

**Step 3: Type check**

Run: `cd server && npx tsc --noEmit`
Run: `cd web && npx tsc --noEmit`

**Step 4: Run server tests**

Run: `cd server && pnpm test -- --run src/services/asset.service.spec.ts 2>&1 | tail -20`

**Step 5: Commit any changes**

```
style: format
```
