# Space People Performance Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate the N+2 query loop when loading space people by replacing it with a single aggregated SQL query, and remove the people count badge from the hero.

**Architecture:** Replace `getPersonsBySpaceId` + per-person `getPersonFaceCount`/`getPersonAssetCount` calls with a single `getPersonsBySpaceIdWithCounts` repository method that uses `GROUP BY` + `COUNT`. Add a `top` query parameter to limit results for the people strip. Remove `peopleCount` from the hero component.

**Tech Stack:** Kysely (SQL query builder), NestJS DTOs with class-validator, SvelteKit, OpenAPI codegen

---

### Task 1: Add `top` parameter to SpacePeopleQueryDto

**Files:**

- Modify: `server/src/dtos/shared-space-person.dto.ts:5-14`

**Step 1: Add the `top` field to SpacePeopleQueryDto**

In `server/src/dtos/shared-space-person.dto.ts`, add the `top` parameter after the existing fields:

```typescript
export class SpacePeopleQueryDto {
  @ValidateDate({ optional: true })
  takenAfter?: Date;

  @ValidateDate({ optional: true })
  takenBefore?: Date;

  @ValidateBoolean({ optional: true })
  withHidden?: boolean;

  @ApiPropertyOptional({
    description: 'Maximum number of people to return (sorted by asset count)',
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  top?: number;
}
```

You'll need to add these imports at the top of the file (some may already exist):

```typescript
import { IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
```

**Step 2: Verify build**

Run: `cd server && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```
feat: add top parameter to SpacePeopleQueryDto
```

---

### Task 2: Add aggregated repository method

**Files:**

- Modify: `server/src/repositories/shared-space.repository.ts:489-596`

**Step 1: Add `getPersonsBySpaceIdWithCounts` method**

Add this new method in `server/src/repositories/shared-space.repository.ts` after the existing `getPersonsBySpaceIdWithTemporalFilter` method (after line 531). This replaces the N+2 query pattern with a single aggregated query:

```typescript
@GenerateSql({
  params: [DummyValue.UUID, { withHidden: false, petsEnabled: true, limit: 10 }],
})
getPersonsBySpaceIdWithCounts(
  spaceId: string,
  options: {
    withHidden?: boolean;
    petsEnabled?: boolean;
    limit?: number;
    takenAfter?: Date;
    takenBefore?: Date;
  },
) {
  return this.db
    .selectFrom('shared_space_person')
    .innerJoin('shared_space_person_face', 'shared_space_person_face.personId', 'shared_space_person.id')
    .innerJoin('asset_face', 'asset_face.id', 'shared_space_person_face.assetFaceId')
    .leftJoin('person', 'person.id', 'asset_face.personId')
    .select([
      'shared_space_person.id',
      'shared_space_person.spaceId',
      'shared_space_person.name',
      'shared_space_person.isHidden',
      'shared_space_person.type',
      'shared_space_person.birthDate',
      'shared_space_person.representativeFaceId',
      'shared_space_person.createdAt',
      'shared_space_person.updatedAt',
    ])
    .select(['person.name as personalName', 'person.thumbnailPath as personalThumbnailPath'])
    .select((eb) => [
      eb.fn.countAll().as('faceCount'),
      eb.fn.count(eb.fn('distinct', ['asset_face.assetId'])).as('assetCount'),
    ])
    .where('shared_space_person.spaceId', '=', spaceId)
    .$if(!options.withHidden, (qb) => qb.where('shared_space_person.isHidden', '=', false))
    .$if(!options.petsEnabled, (qb) => qb.where('shared_space_person.type', '!=', 'pet'))
    .where('person.thumbnailPath', 'is not', null)
    .where('person.thumbnailPath', '!=', '')
    .$if(!!options.takenAfter || !!options.takenBefore, (qb) =>
      qb.where((eb) =>
        eb.exists(
          eb
            .selectFrom('shared_space_person_face as spf2')
            .innerJoin('asset_face as af2', 'af2.id', 'spf2.assetFaceId')
            .innerJoin('asset', 'asset.id', 'af2.assetId')
            .whereRef('spf2.personId', '=', 'shared_space_person.id')
            .$if(!!options.takenAfter, (qb2) => qb2.where('asset.fileCreatedAt', '>=', options.takenAfter!))
            .$if(!!options.takenBefore, (qb2) => qb2.where('asset.fileCreatedAt', '<', options.takenBefore!)),
        ),
      ),
    )
    .groupBy([
      'shared_space_person.id',
      'person.name',
      'person.thumbnailPath',
    ])
    .orderBy('assetCount', 'desc')
    .$if(!!options.limit, (qb) => qb.limit(options.limit!))
    .execute();
}
```

**Step 2: Verify build**

Run: `cd server && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```
feat: add aggregated getPersonsBySpaceIdWithCounts repository method
```

---

### Task 3: Update service to use aggregated query

**Files:**

- Modify: `server/src/services/shared-space.service.ts:596-633`

**Step 1: Rewrite `getSpacePeople` to use the new repository method**

Replace the entire `getSpacePeople` method (lines 596-633) with:

```typescript
async getSpacePeople(
  auth: AuthDto,
  spaceId: string,
  query?: SpacePeopleQueryDto,
): Promise<SharedSpacePersonResponseDto[]> {
  await this.requireMembership(auth, spaceId);

  const space = await this.sharedSpaceRepository.getById(spaceId);
  if (!space?.faceRecognitionEnabled) {
    return [];
  }

  const withHidden = query?.withHidden ?? false;
  const persons = await this.sharedSpaceRepository.getPersonsBySpaceIdWithCounts(spaceId, {
    withHidden,
    petsEnabled: space.petsEnabled,
    limit: query?.top,
    takenAfter: query?.takenAfter,
    takenBefore: query?.takenBefore,
  });

  const aliases = persons.length > 0
    ? await this.sharedSpaceRepository.getAliasesBySpaceAndUser(spaceId, auth.user.id)
    : [];
  const aliasMap = new Map(aliases.map((a) => [a.personId, a.alias]));

  return persons.map((person) =>
    this.mapSpacePerson(person, Number(person.faceCount), Number(person.assetCount), aliasMap.get(person.id) ?? null),
  );
}
```

Note: The `Number()` casts are needed because Kysely returns aggregate results as `string | number` depending on the driver.

Note: The sorting is now done in SQL (`ORDER BY assetCount DESC`) so the JS `.toSorted()` is removed.

Note: The filtering (isHidden, petsEnabled, personalThumbnailPath) is now in SQL, so the JS loop with `continue` statements is removed.

**Step 2: Verify build**

Run: `cd server && npx tsc --noEmit`
Expected: No errors. If there are type mismatches on the `person` parameter to `mapSpacePerson`, the aggregate columns (`faceCount`, `assetCount`) may need to be excluded from the type or the `mapSpacePerson` signature adjusted to accept the wider type.

**Step 3: Commit**

```
feat: use aggregated query in getSpacePeople service method
```

---

### Task 4: Update unit tests for getSpacePeople

**Files:**

- Modify: `server/src/services/shared-space.service.spec.ts:2437-2870`

**Step 1: Update all getSpacePeople tests**

Global pattern for all tests:

1. Replace `mocks.sharedSpace.getPersonsBySpaceId.mockResolvedValue([...])` with `mocks.sharedSpace.getPersonsBySpaceIdWithCounts.mockResolvedValue([...])`
2. Replace `mocks.sharedSpace.getPersonsBySpaceIdWithTemporalFilter.mockResolvedValue([...])` with `getPersonsBySpaceIdWithCounts` (temporal is now an option, not a separate method)
3. Remove all `mocks.sharedSpace.getPersonFaceCount.mockResolvedValue(...)` lines
4. Remove all `mocks.sharedSpace.getPersonAssetCount.mockResolvedValue(...)` lines
5. Add `faceCount` and `assetCount` inline in mock person objects
6. Filtering tests (hidden, pets, thumbnails) now verify correct options are passed to the repository instead of testing JS-side filtering

**Complete test enumeration — every test and what changes:**

| #   | Test (line)                                                                              | Change type                                                                                                                                                     |
| --- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | "should require membership" (2438)                                                       | **No change** — doesn't reach repo                                                                                                                              |
| 2   | "should return empty array when faceRecognitionEnabled is false" (2444)                  | **No change** — returns before repo call                                                                                                                        |
| 3   | "should return enriched person list with face count, asset count, and alias" (2457)      | Replace mocks, inline counts                                                                                                                                    |
| 4   | "should sort people by asset count descending" (2490)                                    | Replace mocks, pre-sort mock data (SQL does sorting now)                                                                                                        |
| 5   | "should exclude people without thumbnails" (2535)                                        | **Restructure**: mock returns only people WITH thumbnails, verify options passed — SQL handles filtering                                                        |
| 6   | "should filter out pets when petsEnabled is false" (2566)                                | **Restructure**: mock returns only non-pets, verify `petsEnabled: false` in options                                                                             |
| 7   | "should exclude hidden persons" (2588)                                                   | **Restructure**: mock returns only visible, verify `withHidden: false` in options                                                                               |
| 8   | "should include pets when petsEnabled is true" (2610)                                    | Replace mocks, verify `petsEnabled: true` in options                                                                                                            |
| 9   | "should filter people by temporal range" (2632)                                          | Replace mock with `getPersonsBySpaceIdWithCounts`, verify `takenAfter`/`takenBefore` in options. Remove assertion about `getPersonsBySpaceId` not being called. |
| 10  | "should return all people when no temporal params provided" (2665)                       | Replace mock, verify `takenAfter: undefined, takenBefore: undefined`. Remove assertion about `getPersonsBySpaceIdWithTemporalFilter` not being called.          |
| 11  | "should exclude person with zero face assets in date range" (2691)                       | Replace mock — this is now a documentation test (SQL handles exclusion)                                                                                         |
| 12  | "should resolve name from personal person when space person has no name override" (2724) | Replace mocks, inline counts                                                                                                                                    |
| 13  | "should use space person name as override when set" (2748)                               | Replace mocks, inline counts                                                                                                                                    |
| 14  | "should exclude persons with no thumbnail from personal person" (2771)                   | **Restructure**: same as #5, SQL handles filtering                                                                                                              |
| 15  | "should exclude persons with null personal thumbnail" (2791)                             | **Restructure**: same as #5, SQL handles filtering                                                                                                              |
| 16  | "should use space person name override even when personal person has no name" (2810)     | Replace mocks, inline counts                                                                                                                                    |
| 17  | "should include hidden persons when withHidden is true" (2833)                           | Replace mocks, verify `withHidden: true` in options                                                                                                             |
| 18  | "should exclude hidden persons by default" (2852)                                        | **Restructure**: mock returns empty (SQL filtered), verify `withHidden: false` in options                                                                       |

**Tests that need fundamental restructuring (5, 6, 7, 14, 15, 18):**

These tests currently verify JS-side filtering by returning filtered-out items from the mock and checking they don't appear in results. After the refactor, filtering is in SQL, so these tests should:

1. Return only the expected results from the mock (SQL already filtered)
2. Assert the correct options were passed to `getPersonsBySpaceIdWithCounts`
3. Assert the returned results match

Example for test #6 ("should filter out pets when petsEnabled is false"):

```typescript
it('should pass petsEnabled false to repository', async () => {
  const spaceId = newUuid();
  const space = factory.sharedSpace({ id: spaceId, faceRecognitionEnabled: true, petsEnabled: false });
  const humanPerson = factory.sharedSpacePerson({ spaceId, type: 'person' });

  mocks.sharedSpace.getMember.mockResolvedValue(makeMemberResult({ role: SharedSpaceRole.Viewer }));
  mocks.sharedSpace.getById.mockResolvedValue(space);
  mocks.sharedSpace.getPersonsBySpaceIdWithCounts.mockResolvedValue([
    { ...humanPerson, personalName: 'Human', personalThumbnailPath: '/thumb.jpg', faceCount: 1, assetCount: 1 },
  ]);
  mocks.sharedSpace.getAliasesBySpaceAndUser.mockResolvedValue([]);

  const result = await sut.getSpacePeople(factory.auth(), spaceId);

  expect(mocks.sharedSpace.getPersonsBySpaceIdWithCounts).toHaveBeenCalledWith(spaceId, {
    withHidden: false,
    petsEnabled: false,
    limit: undefined,
    takenAfter: undefined,
    takenBefore: undefined,
  });
  expect(result).toHaveLength(1);
});
```

**Step 2: Add new tests**

Add these new tests to the `getSpacePeople` describe block:

```typescript
it('should pass top limit to repository', async () => {
  const auth = factory.auth();
  const spaceId = newUuid();
  const space = factory.sharedSpace({ id: spaceId, faceRecognitionEnabled: true });

  mocks.sharedSpace.getMember.mockResolvedValue(makeMemberResult({ role: SharedSpaceRole.Viewer }));
  mocks.sharedSpace.getById.mockResolvedValue(space);
  mocks.sharedSpace.getPersonsBySpaceIdWithCounts.mockResolvedValue([]);
  mocks.sharedSpace.getAliasesBySpaceAndUser.mockResolvedValue([]);

  await sut.getSpacePeople(auth, spaceId, { top: 10 });

  expect(mocks.sharedSpace.getPersonsBySpaceIdWithCounts).toHaveBeenCalledWith(spaceId, {
    withHidden: false,
    petsEnabled: true,
    limit: 10,
    takenAfter: undefined,
    takenBefore: undefined,
  });
});

it('should handle string aggregate counts from database', async () => {
  const auth = factory.auth();
  const spaceId = newUuid();
  const person = factory.sharedSpacePerson({ spaceId });
  const space = factory.sharedSpace({ id: spaceId, faceRecognitionEnabled: true });

  mocks.sharedSpace.getMember.mockResolvedValue(makeMemberResult({ role: SharedSpaceRole.Viewer }));
  mocks.sharedSpace.getById.mockResolvedValue(space);
  mocks.sharedSpace.getPersonsBySpaceIdWithCounts.mockResolvedValue([
    { ...person, personalName: 'Alice', personalThumbnailPath: '/thumb.jpg', faceCount: '5', assetCount: '3' },
  ]);
  mocks.sharedSpace.getAliasesBySpaceAndUser.mockResolvedValue([]);

  const result = await sut.getSpacePeople(auth, spaceId);

  expect(result[0].faceCount).toBe(5);
  expect(result[0].assetCount).toBe(3);
  expect(typeof result[0].faceCount).toBe('number');
  expect(typeof result[0].assetCount).toBe('number');
});

it('should skip alias lookup when no persons returned', async () => {
  const auth = factory.auth();
  const spaceId = newUuid();
  const space = factory.sharedSpace({ id: spaceId, faceRecognitionEnabled: true });

  mocks.sharedSpace.getMember.mockResolvedValue(makeMemberResult({ role: SharedSpaceRole.Viewer }));
  mocks.sharedSpace.getById.mockResolvedValue(space);
  mocks.sharedSpace.getPersonsBySpaceIdWithCounts.mockResolvedValue([]);

  const result = await sut.getSpacePeople(auth, spaceId);

  expect(result).toEqual([]);
  expect(mocks.sharedSpace.getAliasesBySpaceAndUser).not.toHaveBeenCalled();
});

it('should pass combined options for hidden, temporal, and top', async () => {
  const auth = factory.auth();
  const spaceId = newUuid();
  const space = factory.sharedSpace({ id: spaceId, faceRecognitionEnabled: true, petsEnabled: false });
  const takenAfter = new Date('2025-06-01');

  mocks.sharedSpace.getMember.mockResolvedValue(makeMemberResult({ role: SharedSpaceRole.Viewer }));
  mocks.sharedSpace.getById.mockResolvedValue(space);
  mocks.sharedSpace.getPersonsBySpaceIdWithCounts.mockResolvedValue([]);
  mocks.sharedSpace.getAliasesBySpaceAndUser.mockResolvedValue([]);

  await sut.getSpacePeople(auth, spaceId, { withHidden: true, takenAfter, top: 5 });

  expect(mocks.sharedSpace.getPersonsBySpaceIdWithCounts).toHaveBeenCalledWith(spaceId, {
    withHidden: true,
    petsEnabled: false,
    limit: 5,
    takenAfter,
    takenBefore: undefined,
  });
});
```

**Step 3: Run tests**

Run: `cd server && pnpm test -- --run src/services/shared-space.service.spec.ts`
Expected: All tests pass

**Step 4: Commit**

```
test: update getSpacePeople tests for aggregated query
```

---

### Task 5: Remove old repository methods

**Files:**

- Modify: `server/src/repositories/shared-space.repository.ts`

**Step 1: Check for other callers of the old methods**

Search for all usages of `getPersonFaceCount`, `getPersonAssetCount`, `getPersonsBySpaceId`, and `getPersonsBySpaceIdWithTemporalFilter` across the codebase. The `getSpacePerson` (single person detail, line 635-652) and `updateSpacePerson` (line 671-714) still call `getPersonFaceCount` and `getPersonAssetCount` individually for a single person — these are fine (2 queries for 1 person).

So only remove:

- `getPersonsBySpaceId` (lines 489-500) — replaced by `getPersonsBySpaceIdWithCounts`
- `getPersonsBySpaceIdWithTemporalFilter` (lines 502-531) — merged into `getPersonsBySpaceIdWithCounts`

Keep:

- `getPersonFaceCount` (lines 577-585) — still used by `getSpacePerson` and `updateSpacePerson`
- `getPersonAssetCount` (lines 587-596) — still used by `getSpacePerson` and `updateSpacePerson`

**Step 2: Remove the two methods**

Delete `getPersonsBySpaceId` (lines 489-500) and `getPersonsBySpaceIdWithTemporalFilter` (lines 502-531).

**Step 3: Verify build**

Run: `cd server && npx tsc --noEmit`
Expected: No errors. If there are compile errors from other files referencing the removed methods, investigate and update those callers.

**Step 4: Run tests**

Run: `cd server && pnpm test -- --run src/services/shared-space.service.spec.ts`
Expected: All tests pass

**Step 5: Commit**

```
refactor: remove replaced getPersonsBySpaceId methods
```

---

### Task 6: Remove peopleCount from hero component

**Files:**

- Modify: `web/src/lib/components/spaces/space-hero.svelte:16-52, 159-169, 300-310`
- Modify: `web/src/lib/components/spaces/space-hero.spec.ts` (tests referencing peopleCount)
- Modify: `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.svelte:898`

**Step 1: Remove peopleCount from space-hero.svelte**

In `web/src/lib/components/spaces/space-hero.svelte`:

1. Remove `peopleCount?: number;` from the Props interface (line ~28)
2. Remove `peopleCount,` from the destructuring (line ~48)
3. Remove the collapsed people count block (lines 159-169) — the entire `{#if faceRecognitionEnabled && peopleCount && peopleCount > 0}` block with `hero-collapsed-people-count`
4. Remove the expanded people count block (lines 300-310) — the entire `{#if faceRecognitionEnabled && peopleCount && peopleCount > 0}` block with `hero-people-count`

**Step 2: Remove peopleCount prop from page.svelte**

In `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.svelte`, remove the `peopleCount={spacePeople.length}` prop (line 898) from the `<SpaceHero>` component.

Also remove the `faceRecognitionEnabled={space.faceRecognitionEnabled}` and `spaceId={space.id}` props from `<SpaceHero>` if they were only used for the people count link. Check if they're used elsewhere in the hero component before removing.

**Step 3: Update hero tests**

In `web/src/lib/components/spaces/space-hero.spec.ts`, remove or update all tests that reference `peopleCount`:

- Remove: "should show people count chip when faceRecognitionEnabled and peopleCount > 0" (line 188)
- Remove: the test checking people count not shown when faceRecognition disabled (line ~205)
- Remove: "should not show people chip when peopleCount is 0" (line 212)
- Remove: the test checking people count links to people page (line ~228)
- Remove: the collapsed people count test (line ~357)
- Remove: the test checking collapsed people count not shown when not collapsed (line ~374)
- Remove `peopleCount` from any remaining test props where it was incidental

**Step 4: Run web tests**

Run: `cd web && pnpm test -- --run src/lib/components/spaces/space-hero.spec.ts`
Expected: All tests pass

**Step 5: Commit**

```
feat: remove people count badge from space hero
```

---

### Task 7: Update web to use `top` parameter for people strip

**Files:**

- Modify: `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.svelte:352-362`

**Step 1: Regenerate the OpenAPI SDK**

The `top` parameter was added to the DTO in Task 1. The SDK needs regenerating so the web client can use it:

```bash
cd server && pnpm build
cd server && pnpm sync:open-api
make open-api-typescript
```

**Step 2: Update loadSpacePeople to pass `top: 10`**

In `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.svelte`, update `loadSpacePeople` (line 358):

**Before:**

```typescript
spacePeople = await getSpacePeople({ id: space.id });
```

**After:**

```typescript
spacePeople = await getSpacePeople({ id: space.id, top: 10 });
```

**Step 3: Verify other web callers need no changes**

These callers of `getSpacePeople` were audited and need no changes (they continue calling without `top`):

- `+page.svelte` line 169 — FilterPanel people provider (passes `takenAfter`/`takenBefore`, no `top` needed)
- `/spaces/[spaceId]/people/+page.svelte` — People management page (needs all people with counts)
- `/spaces/[spaceId]/people/[personId]/+page.ts` — Person detail/merge page
- `web/src/lib/utils/map-filter-config.ts` — Map filter config

**Step 4: Commit**

```
feat: load only top 10 people for space people strip
```

---

### Task 8: Regenerate OpenAPI and SQL files

**Files:**

- Generated: `open-api/typescript-sdk/src/fetch-client.ts`
- Generated: `open-api/immich-openapi-specs.json`
- Generated: Various SQL query files

**Step 1: Regenerate everything**

```bash
cd server && pnpm build
cd server && pnpm sync:open-api
make open-api
make sql
```

**Step 2: Run linting**

```bash
make check-server
make check-web
make lint-server
make lint-web
```

Fix any issues found.

**Step 3: Commit**

```
chore: regenerate OpenAPI specs and SQL queries
```

---

### Task 9: Final verification

**Step 1: Run server tests**

```bash
cd server && pnpm test
```

Expected: All tests pass

**Step 2: Run web tests**

```bash
cd web && pnpm test
```

Expected: All tests pass

**Step 3: Manual smoke test (if dev stack is running)**

1. Open a space with people
2. Verify the people strip shows up to 10 people
3. Verify the FilterPanel people section loads all named people
4. Verify the hero no longer shows a people count badge
5. Check browser network tab — should see two `getSpacePeople` calls, one with `?top=10`
