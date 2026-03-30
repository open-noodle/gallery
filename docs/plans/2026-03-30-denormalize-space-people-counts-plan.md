# Denormalize Space Person Counts Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Denormalize `faceCount`/`assetCount` onto `shared_space_person`, replace aggregation queries with simple reads, paginate the manage people page, and add a `named` filter.

**Architecture:** Add two integer columns to `shared_space_person`. Maintain counts automatically via `recountPersons()` called from write paths. Replace `GROUP BY` queries with simple `SELECT` + `ORDER BY` on denormalized columns. Paginate with `LIMIT`/`OFFSET` and infinite scroll.

**Tech Stack:** Kysely (SQL query builder), NestJS DTOs with class-validator, SvelteKit with Svelte 5, BullMQ jobs

**Design doc:** `docs/plans/2026-03-30-denormalize-space-people-counts-design.md`

---

### Task 1: Schema Migration + Table Definition

**Files:**

- Create: `server/src/schema/migrations-gallery/1777000000000-AddSpacePersonCounts.ts`
- Modify: `server/src/schema/tables/shared-space-person.table.ts`
- Modify: `server/src/database.ts:365-379`

**Step 1: Create the fork migration**

Create `server/src/schema/migrations-gallery/1777000000000-AddSpacePersonCounts.ts`:

```typescript
import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('shared_space_person')
    .addColumn('faceCount', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('assetCount', 'integer', (col) => col.notNull().defaultTo(0))
    .execute();

  await db.schema
    .createIndex('shared_space_person_space_count_idx')
    .on('shared_space_person')
    .columns(['spaceId', 'isHidden'])
    .expression('assetCount DESC')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('shared_space_person_space_count_idx').ifExists().execute();

  await db.schema.alterTable('shared_space_person').dropColumn('faceCount').dropColumn('assetCount').execute();
}
```

Note: The index expression syntax may need adjustment for Kysely — if `.expression()` is not available, use raw SQL: `await sql\`CREATE INDEX ... ON shared_space_person("spaceId", "isHidden", "assetCount" DESC)\`.execute(db);`

**Step 2: Update table schema**

In `server/src/schema/tables/shared-space-person.table.ts`, add after the `birthDate` column (before `createdAt`):

```typescript
@Column({ type: 'integer', default: 0 })
faceCount!: Generated<number>;

@Column({ type: 'integer', default: 0 })
assetCount!: Generated<number>;
```

**Step 3: Update database type**

In `server/src/database.ts`, add to the `SharedSpacePerson` type (line ~374, before `createdAt`):

```typescript
faceCount: number;
assetCount: number;
```

**Step 4: Write migration tests** (design tests 42-44)

Add to the medium test suite or a dedicated migration test file. These test against a real database:

```typescript
describe('AddSpacePersonCounts migration', () => {
  it('should add faceCount and assetCount columns with DEFAULT 0', async () => {
    // Verify: inserting a shared_space_person without faceCount/assetCount succeeds
    // Verify: the inserted row has faceCount=0 and assetCount=0
  });

  it('should create the composite index', async () => {
    // Verify: query pg_indexes for shared_space_person_space_count_idx
  });

  it('should succeed on an empty database', async () => {
    // Verify: migration runs without error when shared_space_person has no rows
  });
});
```

**Step 5: Verify build**

Run: `cd server && npx tsc --noEmit`

**Step 6: Commit**

```
feat: add faceCount and assetCount columns to shared_space_person
```

---

### Task 2: Add `recountPersons` Repository Method

**Files:**

- Modify: `server/src/repositories/shared-space.repository.ts`

**Step 1: Add the method**

Add after `deleteOrphanedPersons` (after line 658):

```typescript
@GenerateSql({ params: [[DummyValue.UUID]] })
async recountPersons(personIds: string[]) {
  if (personIds.length === 0) {
    return;
  }

  await this.db
    .updateTable('shared_space_person')
    .set((eb) => ({
      faceCount: eb
        .selectFrom('shared_space_person_face')
        .select((eb2) => eb2.fn.countAll().as('count'))
        .whereRef('shared_space_person_face.personId', '=', 'shared_space_person.id'),
      assetCount: eb
        .selectFrom('shared_space_person_face')
        .innerJoin('asset_face', 'asset_face.id', 'shared_space_person_face.assetFaceId')
        .select((eb2) => eb2.fn.count(eb2.fn('distinct', ['asset_face.assetId'])).as('count'))
        .whereRef('shared_space_person_face.personId', '=', 'shared_space_person.id'),
    }))
    .where('id', 'in', personIds)
    .execute();
}
```

Note: Kysely correlated subquery syntax may need adjustment. The key pattern is a correlated UPDATE where each subquery references `shared_space_person.id` from the outer UPDATE. If Kysely doesn't support `whereRef` in a `set()` subquery, use `sql` template literal for the UPDATE.

**Step 2: Write medium tests** (design tests 19-24)

Add to `server/test/medium/specs/repositories/shared-space.repository.spec.ts` in the shared space repository describe block:

```typescript
describe('recountPersons', () => {
  it('should set correct faceCount for a person with multiple faces', async () => {
    // Setup: create space, person, add 3 faces via shared_space_person_face
    // Act: call recountPersons([personId])
    // Verify: person.faceCount === 3
  });

  it('should set correct assetCount with distinct assets when multiple faces reference same asset', async () => {
    // Setup: create 3 faces, 2 pointing to same assetId
    // Act: call recountPersons([personId])
    // Verify: person.assetCount === 2 (distinct assets, not face count)
  });

  it('should set counts to 0 for a person with no faces', async () => {
    // Setup: create person with no shared_space_person_face rows
    // Act: call recountPersons([personId])
    // Verify: person.faceCount === 0, person.assetCount === 0
  });

  it('should update multiple persons in a single call', async () => {
    // Setup: create 2 persons with different face counts
    // Act: call recountPersons([person1Id, person2Id])
    // Verify: both persons have correct counts
  });

  it('should be a no-op with empty array', async () => {
    // Act: call recountPersons([])
    // Verify: no error, no rows affected
  });

  it('should count pet faces correctly', async () => {
    // Setup: create pet-type person, add pet faces
    // Act: call recountPersons([petPersonId])
    // Verify: faceCount and assetCount reflect pet faces
  });
});
```

**Step 3: Run medium tests to verify they fail**

Run: `cd server && pnpm test:medium`
Expected: FAIL — `recountPersons` method doesn't exist yet

**Step 4: Add the method**

(implementation code from Step 1 above)

**Step 5: Run medium tests to verify they pass**

Run: `cd server && pnpm test:medium`
Expected: PASS

**Step 6: Verify build**

Run: `cd server && npx tsc --noEmit`

**Step 7: Commit**

```
feat: add recountPersons repository method with medium tests
```

---

### Task 3: Update `addPersonFaces` with `skipRecount` Option

**Files:**

- Modify: `server/src/repositories/shared-space.repository.ts:578-589`
- Test: `server/src/services/shared-space.service.spec.ts`

**Step 1: Write failing tests**

Add to the service spec file, in a new describe block or within the existing face matching tests:

```typescript
it('should call recountPersons after addPersonFaces by default', async () => {
  // Setup: mock addPersonFaces to return inserted rows
  // Verify: recountPersons is called with the affected personIds
});

it('should not call recountPersons when skipRecount is true', async () => {
  // Setup: call addPersonFaces with { skipRecount: true }
  // Verify: recountPersons is NOT called
});

it('should not call recountPersons when values array is empty', async () => {
  // Setup: call addPersonFaces with []
  // Verify: recountPersons is NOT called
});
```

**Step 2: Run tests to verify they fail**

Run: `cd server && pnpm test -- --run src/services/shared-space.service.spec.ts`
Expected: FAIL — `recountPersons` is not called yet

**Step 3: Modify the repository method**

Update `addPersonFaces` (line 578) to accept options and call `recountPersons`:

```typescript
async addPersonFaces(values: Insertable<SharedSpacePersonFaceTable>[], options?: { skipRecount?: boolean }) {
  if (values.length === 0) {
    return [];
  }

  const result = await this.db
    .insertInto('shared_space_person_face')
    .values(values)
    .onConflict((oc) => oc.doNothing())
    .returningAll()
    .execute();

  if (!options?.skipRecount && result.length > 0) {
    const personIds = [...new Set(result.map((r) => r.personId))];
    await this.recountPersons(personIds);
  }

  return result;
}
```

**Step 4: Run tests, verify pass**

Run: `cd server && pnpm test -- --run src/services/shared-space.service.spec.ts`
Expected: PASS

**Step 5: Commit**

```
feat: add skipRecount option to addPersonFaces with automatic recount
```

---

### Task 4: Update `removePersonFacesByAssetIds` with Targeted Recount

**Files:**

- Modify: `server/src/repositories/shared-space.repository.ts:632-649`

**Step 1: Write failing test**

```typescript
it('should query affected personIds before deleting and recount only those', async () => {
  // Verify: recountPersons called with personIds that had faces for the removed assets
});

it('should not call recountPersons when no persons are affected', async () => {
  // Verify: recountPersons NOT called when no faces match the asset IDs
});
```

**Step 2: Run tests to verify they fail**

Run: `cd server && pnpm test -- --run src/services/shared-space.service.spec.ts`
Expected: FAIL — recount logic doesn't exist yet

**Step 3: Modify the method**

Replace `removePersonFacesByAssetIds` to capture affected personIds first:

```typescript
@GenerateSql({ params: [DummyValue.UUID, [DummyValue.UUID]] })
async removePersonFacesByAssetIds(spaceId: string, assetIds: string[]) {
  // Capture affected person IDs before deleting
  const affected = await this.db
    .selectFrom('shared_space_person_face')
    .select('personId')
    .distinct()
    .where(
      'assetFaceId',
      'in',
      this.db.selectFrom('asset_face').select('asset_face.id').where('asset_face.assetId', 'in', assetIds),
    )
    .where(
      'personId',
      'in',
      this.db
        .selectFrom('shared_space_person')
        .select('shared_space_person.id')
        .where('shared_space_person.spaceId', '=', spaceId),
    )
    .execute();

  const personIds = affected.map((a) => a.personId);

  await this.db
    .deleteFrom('shared_space_person_face')
    .where(
      'assetFaceId',
      'in',
      this.db.selectFrom('asset_face').select('asset_face.id').where('asset_face.assetId', 'in', assetIds),
    )
    .where(
      'personId',
      'in',
      this.db
        .selectFrom('shared_space_person')
        .select('shared_space_person.id')
        .where('shared_space_person.spaceId', '=', spaceId),
    )
    .execute();

  if (personIds.length > 0) {
    await this.recountPersons(personIds);
  }
}
```

**Step 4: Run tests, verify pass**

Run: `cd server && pnpm test -- --run src/services/shared-space.service.spec.ts`
Expected: PASS

**Step 5: Commit**

```
feat: add targeted recount to removePersonFacesByAssetIds
```

---

### Task 5: Update `processSpaceFaceMatch` for Batched Recount

**Files:**

- Modify: `server/src/services/shared-space.service.ts:921-992`

**Step 1: Write failing tests**

```typescript
it('should collect all personIds and call recountPersons once at the end', async () => {
  // Setup: mock faces that match to 3 different persons
  // Verify: recountPersons called once with all 3 personIds
  // Verify: addPersonFaces called with { skipRecount: true } each time
});

it('should include newly created person IDs in recount', async () => {
  // Setup: mock a face that creates a new person
  // Verify: new person's ID is in the recountPersons call
});

it('should include pet face person IDs in recount', async () => {
  // Setup: mock pet faces
  // Verify: pet person IDs included in recountPersons call
});

it('should call recountPersons with empty array when no faces found', async () => {
  // Setup: mock no faces for asset
  // Verify: recountPersons called with [] (guard clause makes it no-op)
});
```

**Step 2: Modify the method**

Add a `Set<string>` to collect personIds, pass `{ skipRecount: true }` to all `addPersonFaces` calls, and call `recountPersons` at the end:

```typescript
private async processSpaceFaceMatch(spaceId: string, assetId: string): Promise<void> {
  const { machineLearning } = await this.getConfig({ withCache: true });
  const maxDistance = machineLearning.facialRecognition.maxDistance;
  const affectedPersonIds = new Set<string>();

  const faces = await this.sharedSpaceRepository.getAssetFacesForMatching(assetId);
  for (const face of faces) {
    // ... existing match/create logic unchanged ...

    await this.sharedSpaceRepository.addPersonFaces([{ personId, assetFaceId: face.id }], { skipRecount: true });
    affectedPersonIds.add(personId);
  }

  // Process pet faces
  const petFaces = await this.sharedSpaceRepository.getPetFacesForAsset(assetId);
  for (const petFace of petFaces) {
    // ... existing pet match/create logic unchanged ...

    await this.sharedSpaceRepository.addPersonFaces([{ personId, assetFaceId: petFace.id }], { skipRecount: true });
    affectedPersonIds.add(personId);
  }

  // Recount all affected persons once
  await this.sharedSpaceRepository.recountPersons([...affectedPersonIds]);
}
```

**Step 3: Run tests, commit**

```
feat: batch recount in processSpaceFaceMatch
```

---

### Task 6: Update `mergeSpacePeople` for Deferred Recount

**Files:**

- Modify: `server/src/services/shared-space.service.ts:726-766`

**Step 1: Write failing tests**

```typescript
it('should call recountPersons with target ID once after all merges', async () => {
  // Setup: merge 3 sources into target
  // Verify: recountPersons called once with [targetId]
});

it('should not call recountPersons for deleted source persons', async () => {
  // Verify: recountPersons NOT called with any sourceId
});
```

**Step 2: Add recount call after the merge loop**

After the `for (const source of sources)` loop (after line 758), add:

```typescript
await this.sharedSpaceRepository.recountPersons([targetPersonId]);
```

**Step 3: Run tests, commit**

```
feat: add deferred recount after person merge
```

---

### Task 7: Update DTO — Rename `top` to `limit`, Add `offset` and `named`

**Files:**

- Modify: `server/src/dtos/shared-space-person.dto.ts:6-27`

**Step 1: Update the DTO**

Replace the `top` field and add `offset` and `named`:

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
  limit?: number;

  @ApiPropertyOptional({ description: 'Number of items to skip', minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @ValidateBoolean({ optional: true })
  named?: boolean;
}
```

**Step 2: Verify build**

Run: `cd server && npx tsc --noEmit`

**Step 3: Commit**

```
feat: rename top to limit, add offset and named params to SpacePeopleQueryDto
```

---

### Task 8: Replace Aggregation Query with Simple SELECT

**Files:**

- Modify: `server/src/repositories/shared-space.repository.ts`

**Step 1: Replace `getPersonsBySpaceIdWithCounts` with `getPersonsBySpaceId`**

Remove the entire `getPersonsBySpaceIdWithCounts` method (lines 491-545). Add a new simpler method:

```typescript
@GenerateSql({
  params: [DummyValue.UUID, { withHidden: false, petsEnabled: true, limit: 50, offset: 0, named: false }],
})
getPersonsBySpaceId(
  spaceId: string,
  options: {
    withHidden?: boolean;
    petsEnabled?: boolean;
    limit?: number;
    offset?: number;
    named?: boolean;
    takenAfter?: Date;
    takenBefore?: Date;
  },
) {
  return this.db
    .selectFrom('shared_space_person')
    .leftJoin('asset_face', 'asset_face.id', 'shared_space_person.representativeFaceId')
    .leftJoin('person', 'person.id', 'asset_face.personId')
    .selectAll('shared_space_person')
    .select(['person.name as personalName', 'person.thumbnailPath as personalThumbnailPath'])
    .where('shared_space_person.spaceId', '=', spaceId)
    .$if(!options.withHidden, (qb) => qb.where('shared_space_person.isHidden', '=', false))
    .$if(!options.petsEnabled, (qb) => qb.where('shared_space_person.type', '!=', 'pet'))
    .where('person.thumbnailPath', 'is not', null)
    .where('person.thumbnailPath', '!=', '')
    .$if(!!options.named, (qb) =>
      qb.where((eb) =>
        eb.or([
          eb('shared_space_person.name', '!=', ''),
          eb.and([eb('person.name', 'is not', null), eb('person.name', '!=', '')]),
        ]),
      ),
    )
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
    .orderBy(
      (eb) => eb.case().when('shared_space_person.name', '!=', '').then(0)
        .when(eb.and([eb('person.name', 'is not', null), eb('person.name', '!=', '')])).then(0)
        .else(1).end(),
    )
    .orderBy('shared_space_person.assetCount', 'desc')
    .$if(!!options.limit, (qb) => qb.limit(options.limit!))
    .$if(!!options.offset, (qb) => qb.offset(options.offset!))
    .execute();
}
```

Note: The Kysely CASE expression syntax may differ — adjust to match the version used. The key point is: named people sort first, then by assetCount DESC.

**Step 2: Remove `getPersonFaceCount` and `getPersonAssetCount`**

Delete these two methods (lines 592-610). They are replaced by reading from denormalized columns.

**Step 3: Update service — `mapSpacePerson`, `getSpacePeople`, `getSpacePerson`, `updateSpacePerson`**

These changes must happen in the same task as the query replacement to avoid a broken intermediate state.

**Update `mapSpacePerson`**

Change the method signature to read counts from the person object (line 1064):

```typescript
private mapSpacePerson(
  person: SharedSpacePerson,
  alias: string | null,
): SharedSpacePersonResponseDto {
  return {
    id: person.id,
    spaceId: person.spaceId,
    name: person.name || person.personalName || '',
    thumbnailPath: person.personalThumbnailPath || '',
    isHidden: person.isHidden,
    birthDate: person.birthDate,
    representativeFaceId: person.representativeFaceId,
    faceCount: person.faceCount,
    assetCount: person.assetCount,
    alias,
    createdAt: (person.createdAt as unknown as Date).toISOString(),
    updatedAt: (person.updatedAt as unknown as Date).toISOString(),
    type: person.type,
  };
}
```

**Step 2: Update `getSpacePeople`**

Replace the method (line 596) to use the new repository method:

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

  const persons = await this.sharedSpaceRepository.getPersonsBySpaceId(spaceId, {
    withHidden: query?.withHidden ?? false,
    petsEnabled: space.petsEnabled,
    limit: query?.limit,
    offset: query?.offset,
    named: query?.named,
    takenAfter: query?.takenAfter,
    takenBefore: query?.takenBefore,
  });

  const aliases =
    persons.length > 0
      ? await this.sharedSpaceRepository.getAliasesBySpaceAndUser(spaceId, auth.user.id)
      : [];
  const aliasMap = new Map(aliases.map((a) => [a.personId, a.alias]));

  return persons.map((person) => this.mapSpacePerson(person, aliasMap.get(person.id) ?? null));
}
```

**Step 3: Update `getSpacePerson`**

Remove the separate count queries (lines ~639-640). Use counts from the person row:

```typescript
// Remove these lines:
// const faceCount = await this.sharedSpaceRepository.getPersonFaceCount(personId);
// const assetCount = await this.sharedSpaceRepository.getPersonAssetCount(personId);

// Change mapSpacePerson call to:
return this.mapSpacePerson(person, alias?.alias ?? null);
```

**Update `updateSpacePerson`:**

Same change — remove separate count queries, update `mapSpacePerson` call.

**Update all other `mapSpacePerson` callers:**

Search for all calls to `mapSpacePerson` in the file and remove the `faceCount` and `assetCount` arguments (they now come from the person object).

**Step 4: Verify build**

Run: `cd server && npx tsc --noEmit`
Expected: PASS (both repo and service updated together)

**Step 5: Commit**

```
feat: replace aggregation query with denormalized columns and update service
```

---

### Task 9: Update All Service Tests

**Files:**

- Modify: `server/src/services/shared-space.service.spec.ts`

**Step 1: Update `getSpacePeople` tests**

All tests currently mock `getPersonsBySpaceIdWithCounts`. Update to mock `getPersonsBySpaceId` instead. The mock return values already include `faceCount` and `assetCount` inline (from PR #227 test updates), so the mock data stays the same. Key changes:

- Replace `mocks.sharedSpace.getPersonsBySpaceIdWithCounts` → `mocks.sharedSpace.getPersonsBySpaceId`
- Update `toHaveBeenCalledWith` assertions: `limit` instead of `limit` (same), add `offset` and `named` to expected options
- Remove any `Number()` cast expectations (counts are now plain numbers from columns, not aggregates)
- Add new tests for `offset`, `named`, and pagination

**Step 2: Update `getSpacePerson` and `updateSpacePerson` tests**

Remove mocks for `getPersonFaceCount` and `getPersonAssetCount`. The counts come from the person row now.

**Step 3: Add these specific new tests** (design doc tests 10-18)

```typescript
// Test 10: Merge target count reflects sum
it('should reflect sum of all reassigned faces in target count after merge', async () => {
  // Setup: target has 5 faces, source has 3 faces, merge
  // Verify: target has faceCount reflecting all reassigned faces
});

// Test 11: removeAssets recount ordering
it('should recount affected persons before deleteOrphanedPersons', async () => {
  // Verify: removePersonFacesByAssetIds called (which recounts internally)
  // then deleteOrphanedPersons called after
});

// Test 12: limit/offset passthrough
it('should pass limit and offset to repository', async () => {
  // Verify: getPersonsBySpaceId called with { limit: 50, offset: 10 }
});

// Test 13: server order preserved
it('should return results in server order (named first, then by assetCount)', async () => {
  // Setup: mock returns [named-person, unnamed-person]
  // Verify: result order matches mock order
});

// Test 14: named filter passthrough
it('should pass named: true to repository', async () => {
  // Verify: getPersonsBySpaceId called with { named: true }
});

// Test 15: counts from person object
it('should read faceCount/assetCount from person object', async () => {
  // Setup: mock person with faceCount: 5, assetCount: 3
  // Verify: response has faceCount: 5, assetCount: 3
  // Verify: getPersonFaceCount and getPersonAssetCount NOT called
});

// Test 16: offset beyond total
it('should return empty array when offset exceeds total', async () => {
  // Setup: mock returns []
  // Verify: result is []
});

// Test 17: named + withHidden
it('should support named and withHidden combined', async () => {
  // Verify: getPersonsBySpaceId called with { named: true, withHidden: true }
});

// Test 18: getSpacePerson reads denormalized counts
it('should read counts from person row in getSpacePerson', async () => {
  // Setup: mock getPersonById returns person with faceCount/assetCount
  // Verify: no calls to getPersonFaceCount/getPersonAssetCount
});

// Test 45: processSpaceFaceMatch with zero faces
it('should handle asset with no faces gracefully', async () => {
  // Setup: mock getAssetFacesForMatching returns [], getPetFacesForAsset returns []
  // Verify: recountPersons called with [] (no-op)
});

// Test 46: mapSpacePerson reads from object
it('should read counts from person object in mapSpacePerson', async () => {
  // Setup: person with faceCount: 7, assetCount: 4
  // Verify: response faceCount is 7, assetCount is 4
});
```

**Step 4: Run all tests**

Run: `cd server && pnpm test -- --run src/services/shared-space.service.spec.ts`

**Step 5: Commit**

```
test: update service tests for denormalized counts
```

---

### Task 10: Web — Update People Strip and FilterPanel

**Files:**

- Modify: `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.svelte`
- Modify: `web/src/lib/utils/map-filter-config.ts`

**Step 1: Update people strip**

Change `loadSpacePeople` (line 358) from `top: 10` to `limit: 10`:

```typescript
spacePeople = await getSpacePeople({ id: space.id, limit: 10 });
```

**Step 2: Update FilterPanel provider**

Change the people provider (line 169) to use `named: true` and remove client-side filtering:

```typescript
people: async (context?: FilterContext) => {
  const people = await getSpacePeople({
    id: space.id,
    named: true,
    takenAfter: context?.takenAfter,
    takenBefore: context?.takenBefore,
  });
  for (const p of people) {
    personNames.set(p.id, p.name);
  }
  return people.map((p) => ({
    id: p.id,
    name: p.name,
    thumbnailUrl: p.thumbnailPath
      ? createUrl(`/shared-spaces/${space.id}/people/${p.id}/thumbnail`, { updatedAt: p.updatedAt })
      : undefined,
  }));
},
```

**Step 3: Update map filter config**

In `web/src/lib/utils/map-filter-config.ts`, add `named: true` and remove client-side filter:

```typescript
people: (context?: FilterContext) =>
  getSpacePeople({
    id: spaceId,
    named: true,
    ...(context?.takenAfter && { takenAfter: context.takenAfter }),
    ...(context?.takenBefore && { takenBefore: context.takenBefore }),
  }).then((people) =>
    people.map((p) => ({
      id: p.id,
      name: p.name,
      thumbnailUrl: createUrl(`/shared-spaces/${spaceId}/people/${p.id}/thumbnail`, {
        updatedAt: p.updatedAt,
      }),
    })),
  ),
```

**Step 4: Write web tests for these changes** (design tests 39-41)

```typescript
// FilterPanel test
it('should call getSpacePeople with named: true', async () => {
  // Verify: getSpacePeople called with { id, named: true }
});

// People strip test (update existing test)
it('should call getSpacePeople with limit: 10', async () => {
  // Verify: getSpacePeople called with { id, limit: 10 } (not top: 10)
});

// Map filter config test
it('should call getSpacePeople with named: true', async () => {
  // Verify: getSpacePeople called with { id, named: true }
});
```

**Step 5: Run web tests**

Run: `cd web && pnpm test`
Expected: PASS

**Step 6: Commit**

```
feat: use limit and named params in web people loading
```

---

### Task 11: Web — Paginate Manage People Page

**Files:**

- Modify: `web/src/routes/(user)/spaces/[spaceId]/people/+page.ts`
- Modify: `web/src/routes/(user)/spaces/[spaceId]/people/+page.svelte`

**Step 1: Update page loader**

Add `limit: 50` to the initial load:

```typescript
getSpacePeople({ id: params.spaceId, limit: 50 }),
```

**Step 2: Add infinite scroll to the page component**

In `+page.svelte`:

1. Add state variables for pagination:

```typescript
const PAGE_SIZE = 50;
let loading = $state(false);
let hasMore = $state(data.people.length >= PAGE_SIZE);
```

2. Remove the client-side sort from `visiblePeople` — server provides correct order:

```typescript
const visiblePeople = $derived(people.filter((p) => !p.isHidden));
```

3. Update `refreshPeople` to pass `limit`:

```typescript
async function refreshPeople() {
  try {
    people = await getSpacePeople({ id: space.id, limit: PAGE_SIZE });
    hasMore = people.length >= PAGE_SIZE;
  } catch (error) {
    handleError(error, $t('spaces_error_loading_people'));
  }
}
```

4. Add `loadMore` function:

```typescript
async function loadMore() {
  if (loading || !hasMore) return;
  loading = true;
  try {
    const more = await getSpacePeople({ id: space.id, limit: PAGE_SIZE, offset: people.length });
    people = [...people, ...more];
    hasMore = more.length >= PAGE_SIZE;
  } catch (error) {
    handleError(error, $t('spaces_error_loading_people'));
  } finally {
    loading = false;
  }
}
```

5. Add scroll detection — use an IntersectionObserver on a sentinel element at the bottom of the list:

```svelte
{#if hasMore}
  <div use:intersect on:intersect={loadMore} class="h-1" />
{/if}
```

Or use the simpler pattern of a "Load more" button / spinner at the bottom. Check what pattern the codebase uses for infinite scroll elsewhere.

**Step 3: Write web tests for pagination** (design tests 35-38)

```typescript
it('should load initial page with limit 50', async () => {
  // Verify: getSpacePeople called with { id, limit: 50 }
});

it('should load next page on scroll with correct offset', async () => {
  // Trigger scroll/intersection
  // Verify: getSpacePeople called with { id, limit: 50, offset: 50 }
});

it('should stop loading when fewer than 50 items returned', async () => {
  // Setup: return 30 items
  // Verify: no further load triggered
});

it('should not re-sort items client-side', async () => {
  // Setup: return items in mixed named/unnamed order
  // Verify: items rendered in same order as API response
});
```

**Step 4: Run web tests**

Run: `cd web && pnpm test -- --run src/routes/(user)/spaces/[spaceId]/people`
Expected: PASS

**Step 5: Commit**

```
feat: paginate manage people page with infinite scroll
```

---

### Task 12: Backfill Admin Job

**Files:**

- Modify: `server/src/enum.ts` (add job name)
- Modify: `server/src/services/shared-space.service.ts` (add job handler)
- Modify: `web/src/lib/components/QueuePanel.svelte` (add button)

**Step 1: Write backfill job tests** (design tests 25-29)

```typescript
describe('handleBackfillPersonCounts', () => {
  it('should process persons in batches', async () => {
    // Setup: mock getUnbackfilledPersonIds to return 100 then 50 then 0
    // Verify: recountPersons called twice (batch of 100, batch of 50)
  });

  it('should only backfill persons with faceCount=0 that have faces', async () => {
    // Verify: getUnbackfilledPersonIds is called (it filters internally)
  });

  it('should handle spaces with 0 people', async () => {
    // Setup: mock getUnbackfilledPersonIds returns []
    // Verify: recountPersons not called, returns Success
  });

  it('should be idempotent', async () => {
    // Setup: run twice, second run returns [] immediately
    // Verify: both return Success
  });

  it('should handle empty database', async () => {
    // Setup: mock getUnbackfilledPersonIds returns [] (no persons exist)
    // Verify: returns Success without calling recountPersons
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd server && pnpm test -- --run src/services/shared-space.service.spec.ts`
Expected: FAIL — handler doesn't exist yet

**Step 3: Add job name**

In `server/src/enum.ts`, add to the `JobName` enum:

```typescript
SharedSpaceBackfillPersonCounts = 'SharedSpaceBackfillPersonCounts',
```

**Step 4: Add job handler in the service**

```typescript
@OnJob({ name: JobName.SharedSpaceBackfillPersonCounts, queue: QueueName.BackgroundTask })
async handleBackfillPersonCounts(): Promise<JobStatus> {
  const batchSize = 100;

  while (true) {
    // Find persons with faceCount=0 that have faces (need backfill)
    // NOTE: offset is always 0 because successfully recounted rows
    // no longer match faceCount=0, so they drop out of the result set
    const persons = await this.sharedSpaceRepository.getUnbackfilledPersonIds(batchSize);
    if (persons.length === 0) {
      break;
    }

    await this.sharedSpaceRepository.recountPersons(persons.map((p) => p.id));
  }

  return JobStatus.Success;
}
```

Add repository method `getUnbackfilledPersonIds`:

```typescript
async getUnbackfilledPersonIds(limit: number) {
  return this.db
    .selectFrom('shared_space_person')
    .select('id')
    .where('faceCount', '=', 0)
    .where('id', 'in',
      this.db.selectFrom('shared_space_person_face').select('personId').distinct()
    )
    .limit(limit)
    .execute();
}
```

**Step 5: Run tests to verify they pass**

Run: `cd server && pnpm test -- --run src/services/shared-space.service.spec.ts`
Expected: PASS

**Step 6: Add admin UI button**

In `QueuePanel.svelte`, add an entry to `queueDetails` for the backfill job. Follow the existing pattern.

**Step 7: Commit**

```
feat: add admin backfill job for space person counts
```

---

### Task 13: E2E Tests (design tests 30-34)

**Files:**

- Create or modify: `e2e/src/specs/server/api/shared-space-people.e2e-spec.ts`

**Step 1: Write E2E tests**

```typescript
it('should return limited people with pagination', async () => {
  // GET /shared-spaces/:id/people?limit=2&offset=0
  // Verify: exactly 2 people returned
});

it('should return different page with offset', async () => {
  // GET /shared-spaces/:id/people?limit=2&offset=2
  // Verify: different people from first page
});

it('should return only named people with named=true', async () => {
  // GET /shared-spaces/:id/people?named=true
  // Verify: all returned people have non-empty name
});

it('should return empty array for offset beyond total', async () => {
  // GET /shared-spaces/:id/people?offset=9999
  // Verify: empty array
});

it('should update counts after face match', async () => {
  // Use expect.poll since face matching is a background job
  // Verify: faceCount and assetCount updated
});
```

**Step 2: Run E2E tests**

Run: `cd e2e && pnpm test`

**Step 3: Commit**

```
test: add E2E tests for space people pagination and counts
```

---

### Task 14: Regenerate OpenAPI, SQL, Lint, and Final Verification

**Files:**

- Generated files (OpenAPI specs, SQL queries)

**Step 1: Regenerate everything**

```bash
cd server && pnpm build
cd server && pnpm sync:open-api
make open-api
make sql
```

**Step 2: Run linting** (sequentially, long timeouts)

```bash
make check-server
make check-web
make lint-server
make lint-web
```

**Step 3: Run all tests**

```bash
cd server && pnpm test
cd web && pnpm test
```

**Step 4: Commit generated files**

```
chore: regenerate OpenAPI specs and SQL queries
```

---

### Task 15: Final Smoke Test

**Step 1: Run `make dev-update` to rebuild dev stack**

**Step 2: Manual verification**

- Open a space → verify people strip loads (limit 10)
- Open manage people page → verify it loads with pagination
- Scroll down → verify more people load
- Open FilterPanel → verify only named people appear
- Trigger the backfill job from admin page
- Verify counts are populated after backfill

**Step 3: Run E2E tests if dev stack supports it**

```bash
cd e2e && pnpm test
```
