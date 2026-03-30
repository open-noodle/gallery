# Space Person Deduplication Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Automatically prevent and merge duplicate space persons when multiple external libraries are linked to a shared space.

**Architecture:** Two-layer dedup: (1) `personId` fallback during face sync prevents same-owner duplicates, (2) post-sync merge pass using the vector index catches cross-owner and unmerged-person duplicates. A new background job and API endpoint allow manual trigger from space owners.

**Tech Stack:** NestJS services, Kysely queries, BullMQ jobs, Svelte 5 frontend, Vitest tests.

**Design doc:** `docs/plans/2026-03-29-space-person-dedup-design.md`

---

### Task 1: Add `personId` Fallback in `processSpaceFaceMatch` (Layer 1)

**Files:**

- Modify: `server/src/services/shared-space.service.ts:946-963`
- Test: `server/src/services/shared-space.service.spec.ts`

**Step 1: Write the failing test**

In `shared-space.service.spec.ts`, inside the `handleSharedSpaceLibraryFaceSync` describe block (after line ~4093), add:

```typescript
it('should reuse existing space person when face personId matches (Layer 1 dedup)', async () => {
  const spaceId = newUuid();
  const libraryId = newUuid();
  const assetId = newUuid();
  const faceId = newUuid();
  const personalPersonId = newUuid();
  const existingSpacePersonId = newUuid();

  mocks.sharedSpace.getById.mockResolvedValue(factory.sharedSpace({ id: spaceId, faceRecognitionEnabled: true }));
  mocks.sharedSpace.hasLibraryLink.mockResolvedValue(true);
  mocks.asset.getByLibraryIdWithFaces.mockResolvedValueOnce([{ id: assetId }]).mockResolvedValueOnce([]);
  mocks.sharedSpace.getAssetFacesForMatching.mockResolvedValue([
    { id: faceId, assetId, personId: personalPersonId, embedding: '[0.1,0.2]' },
  ]);
  mocks.sharedSpace.isPersonFaceAssigned.mockResolvedValue(false);
  mocks.sharedSpace.findClosestSpacePerson.mockResolvedValue([]); // No embedding match
  mocks.sharedSpace.findSpacePersonByLinkedPersonId.mockResolvedValue(
    factory.sharedSpacePerson({ id: existingSpacePersonId, spaceId }),
  );
  mocks.sharedSpace.addPersonFaces.mockResolvedValue([]);
  mocks.sharedSpace.getPetFacesForAsset.mockResolvedValue([]);

  await sut.handleSharedSpaceLibraryFaceSync({ spaceId, libraryId });

  // Should NOT create a new person
  expect(mocks.sharedSpace.createPerson).not.toHaveBeenCalled();
  // Should assign face to the existing space person found by personId
  expect(mocks.sharedSpace.addPersonFaces).toHaveBeenCalledWith([
    { personId: existingSpacePersonId, assetFaceId: faceId },
  ]);
});

it('should prefer embedding match over personId fallback', async () => {
  const spaceId = newUuid();
  const libraryId = newUuid();
  const assetId = newUuid();
  const faceId = newUuid();
  const personalPersonId = newUuid();
  const embeddingMatchPersonId = newUuid();

  mocks.sharedSpace.getById.mockResolvedValue(factory.sharedSpace({ id: spaceId, faceRecognitionEnabled: true }));
  mocks.sharedSpace.hasLibraryLink.mockResolvedValue(true);
  mocks.asset.getByLibraryIdWithFaces.mockResolvedValueOnce([{ id: assetId }]).mockResolvedValueOnce([]);
  mocks.sharedSpace.getAssetFacesForMatching.mockResolvedValue([
    { id: faceId, assetId, personId: personalPersonId, embedding: '[0.1,0.2]' },
  ]);
  mocks.sharedSpace.isPersonFaceAssigned.mockResolvedValue(false);
  mocks.sharedSpace.findClosestSpacePerson.mockResolvedValue([
    { personId: embeddingMatchPersonId, name: '', distance: 0.3 },
  ]);
  mocks.sharedSpace.addPersonFaces.mockResolvedValue([]);
  mocks.sharedSpace.getPetFacesForAsset.mockResolvedValue([]);

  await sut.handleSharedSpaceLibraryFaceSync({ spaceId, libraryId });

  // Embedding match should be used — personId fallback should NOT be called
  expect(mocks.sharedSpace.findSpacePersonByLinkedPersonId).not.toHaveBeenCalled();
  expect(mocks.sharedSpace.addPersonFaces).toHaveBeenCalledWith([
    { personId: embeddingMatchPersonId, assetFaceId: faceId },
  ]);
});

it('should create new space person only when no personId match exists', async () => {
  const spaceId = newUuid();
  const libraryId = newUuid();
  const assetId = newUuid();
  const faceId = newUuid();
  const personalPersonId = newUuid();

  mocks.sharedSpace.getById.mockResolvedValue(factory.sharedSpace({ id: spaceId, faceRecognitionEnabled: true }));
  mocks.sharedSpace.hasLibraryLink.mockResolvedValue(true);
  mocks.asset.getByLibraryIdWithFaces.mockResolvedValueOnce([{ id: assetId }]).mockResolvedValueOnce([]);
  mocks.sharedSpace.getAssetFacesForMatching.mockResolvedValue([
    { id: faceId, assetId, personId: personalPersonId, embedding: '[0.1,0.2]' },
  ]);
  mocks.sharedSpace.isPersonFaceAssigned.mockResolvedValue(false);
  mocks.sharedSpace.findClosestSpacePerson.mockResolvedValue([]); // No embedding match
  mocks.sharedSpace.findSpacePersonByLinkedPersonId.mockResolvedValue(undefined); // No personId match either
  mocks.sharedSpace.createPerson.mockResolvedValue(factory.sharedSpacePerson({ spaceId }));
  mocks.sharedSpace.addPersonFaces.mockResolvedValue([]);
  mocks.sharedSpace.getPetFacesForAsset.mockResolvedValue([]);

  await sut.handleSharedSpaceLibraryFaceSync({ spaceId, libraryId });

  expect(mocks.sharedSpace.createPerson).toHaveBeenCalled();
});
```

**Step 2: Run tests to verify they fail**

Run: `cd server && pnpm test -- --run src/services/shared-space.service.spec.ts`
Expected: First test FAILS (createPerson is called instead of reusing), second test may pass or fail depending on mock.

**Step 3: Implement the `personId` fallback**

In `server/src/services/shared-space.service.ts`, replace lines 949-963 (the `else` branch when no embedding match):

```typescript
      } else {
        // Only create a new space person if the face has a linked personal person
        // (faces without one haven't passed the minFaces threshold yet)
        if (!face.personId) {
          continue;
        }

        // Layer 1 dedup: check if a space person already exists for this personal person
        const existingSpacePerson = await this.sharedSpaceRepository.findSpacePersonByLinkedPersonId(
          spaceId,
          face.personId,
        );

        if (existingSpacePerson) {
          personId = existingSpacePerson.id;
        } else {
          const newPerson = await this.sharedSpaceRepository.createPerson({
            spaceId,
            name: '',
            representativeFaceId: face.id,
            type: 'person',
          });
          personId = newPerson.id;
        }
      }
```

**Step 4: Run tests to verify they pass**

Run: `cd server && pnpm test -- --run src/services/shared-space.service.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add server/src/services/shared-space.service.ts server/src/services/shared-space.service.spec.ts
git commit -m "feat: add personId fallback to prevent duplicate space persons (Layer 1)"
```

---

### Task 2: Register `SharedSpacePersonDedup` Job

**Files:**

- Modify: `server/src/enum.ts:724`
- Modify: `server/src/types.ts:247-256` (interface) and `450-456` (union)

**Step 1: Add the job enum entry**

In `server/src/enum.ts`, after line 724 (`SharedSpaceLibraryFaceSync`), add:

```typescript
  SharedSpacePersonDedup = 'SharedSpacePersonDedup',
```

**Step 2: Add the job type interface**

In `server/src/types.ts`, near the other shared space job interfaces (~line 250), add:

```typescript
export interface ISharedSpacePersonDedupJob extends IBaseJob {
  spaceId: string;
}
```

**Step 3: Add to the JobItem union**

In `server/src/types.ts`, in the `JobItem` union after the `SharedSpaceLibraryFaceSync` entry (~line 453), add:

```typescript
  | { name: JobName.SharedSpacePersonDedup; data: ISharedSpacePersonDedupJob }
```

**Step 4: Verify compilation**

Run: `cd server && npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add server/src/enum.ts server/src/types.ts
git commit -m "feat: register SharedSpacePersonDedup job type"
```

---

### Task 3: Extend `findClosestSpacePerson` with `excludePersonIds` and `type` Filter

**Files:**

- Modify: `server/src/repositories/shared-space.repository.ts:693-719`
- Test: `server/src/services/shared-space.service.spec.ts` (existing tests still pass)

**Step 1: Modify the method signature and query**

In `server/src/repositories/shared-space.repository.ts`, update `findClosestSpacePerson` (line 696-718):

```typescript
  @GenerateSql({
    params: [DummyValue.UUID, DummyValue.VECTOR, { maxDistance: 0.6, numResults: 1 }],
  })
  findClosestSpacePerson(
    spaceId: string,
    embedding: string,
    options: { maxDistance: number; numResults: number; excludePersonIds?: string[]; type?: string },
  ) {
    return this.db.transaction().execute(async (trx) => {
      await sql`set local vchordrq.probes = ${sql.lit(probes[VectorIndex.Face])}`.execute(trx);
      return await trx
        .with('cte', (qb) =>
          qb
            .selectFrom('shared_space_person')
            .innerJoin('shared_space_person_face', 'shared_space_person_face.personId', 'shared_space_person.id')
            .innerJoin('face_search', 'face_search.faceId', 'shared_space_person_face.assetFaceId')
            .select([
              'shared_space_person.id as personId',
              'shared_space_person.name',
              sql<number>`face_search.embedding <=> ${embedding}`.as('distance'),
            ])
            .where('shared_space_person.spaceId', '=', spaceId)
            .$if(!!options.excludePersonIds?.length, (qb) =>
              qb.where('shared_space_person.id', 'not in', options.excludePersonIds!),
            )
            .$if(!!options.type, (qb) => qb.where('shared_space_person.type', '=', options.type!))
            .orderBy('distance')
            .limit(options.numResults),
        )
        .selectFrom('cte')
        .selectAll()
        .where('cte.distance', '<=', options.maxDistance)
        .execute();
    });
  }
```

**Step 2: Verify existing tests still pass**

Run: `cd server && pnpm test -- --run src/services/shared-space.service.spec.ts`
Expected: PASS (existing callers don't pass the new optional params, so behavior is unchanged)

**Step 3: Commit**

```bash
git add server/src/repositories/shared-space.repository.ts
git commit -m "feat: add excludePersonIds and type filter to findClosestSpacePerson"
```

---

### Task 4: Add `getSpacePersonsWithEmbeddings` Repository Method

**Files:**

- Modify: `server/src/repositories/shared-space.repository.ts`

**Step 1: Add the new method**

In `server/src/repositories/shared-space.repository.ts`, in the "Face Matching Queries" section (after `findClosestSpacePerson`, ~line 719), add:

```typescript
  @GenerateSql({ params: [DummyValue.UUID] })
  getSpacePersonsWithEmbeddings(spaceId: string) {
    return this.db
      .selectFrom('shared_space_person')
      .innerJoin('face_search', 'face_search.faceId', 'shared_space_person.representativeFaceId')
      .select([
        'shared_space_person.id',
        'shared_space_person.name',
        'shared_space_person.type',
        'shared_space_person.isHidden',
        'face_search.embedding',
      ])
      .where('shared_space_person.spaceId', '=', spaceId)
      .execute();
  }
```

**Step 2: Verify compilation**

Run: `cd server && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add server/src/repositories/shared-space.repository.ts
git commit -m "feat: add getSpacePersonsWithEmbeddings repository method"
```

---

### Task 5: Add `reassignPersonFacesConflictSafe` and `migrateAliases` Repository Methods

**Files:**

- Modify: `server/src/repositories/shared-space.repository.ts`

**Step 1: Add conflict-safe face reassignment**

Near the existing `reassignPersonFaces` method (~line 609), add:

```typescript
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async reassignPersonFacesSafe(fromPersonId: string, toPersonId: string) {
    // Delete faces that already exist on the target to avoid PK violation
    await this.db
      .deleteFrom('shared_space_person_face')
      .where('personId', '=', fromPersonId)
      .where(
        'assetFaceId',
        'in',
        this.db.selectFrom('shared_space_person_face').select('assetFaceId').where('personId', '=', toPersonId),
      )
      .execute();

    await this.db
      .updateTable('shared_space_person_face')
      .set({ personId: toPersonId })
      .where('personId', '=', fromPersonId)
      .execute();
  }
```

**Step 2: Add alias migration**

Near the alias methods (~line 687), add:

```typescript
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async migrateAliases(fromPersonId: string, toPersonId: string) {
    // Get aliases from the source person
    const sourceAliases = await this.db
      .selectFrom('shared_space_person_alias')
      .selectAll()
      .where('personId', '=', fromPersonId)
      .execute();

    for (const alias of sourceAliases) {
      await this.db
        .insertInto('shared_space_person_alias')
        .values({ personId: toPersonId, userId: alias.userId, alias: alias.alias })
        .onConflict((oc) => oc.doNothing())
        .execute();
    }

    // Delete source aliases
    await this.db.deleteFrom('shared_space_person_alias').where('personId', '=', fromPersonId).execute();
  }
```

**Step 3: Verify compilation**

Run: `cd server && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add server/src/repositories/shared-space.repository.ts
git commit -m "feat: add conflict-safe face reassignment and alias migration methods"
```

---

### Task 6: Implement `deduplicateSpacePeople` and Job Handler

**Files:**

- Modify: `server/src/services/shared-space.service.ts`
- Test: `server/src/services/shared-space.service.spec.ts`

**Step 1: Write failing tests**

Add a new `describe('handleSharedSpacePersonDedup')` block in the spec file:

```typescript
describe('handleSharedSpacePersonDedup', () => {
  it('should skip when space does not exist', async () => {
    mocks.sharedSpace.getById.mockResolvedValue(void 0);
    const result = await sut.handleSharedSpacePersonDedup({ spaceId: newUuid() });
    expect(result).toBe(JobStatus.Skipped);
  });

  it('should skip when face recognition is disabled', async () => {
    const spaceId = newUuid();
    mocks.sharedSpace.getById.mockResolvedValue(factory.sharedSpace({ id: spaceId, faceRecognitionEnabled: false }));
    const result = await sut.handleSharedSpacePersonDedup({ spaceId });
    expect(result).toBe(JobStatus.Skipped);
  });

  it('should succeed with no merges when space has no people', async () => {
    const spaceId = newUuid();
    mocks.sharedSpace.getById.mockResolvedValue(factory.sharedSpace({ id: spaceId, faceRecognitionEnabled: true }));
    mocks.sharedSpace.getSpacePersonsWithEmbeddings.mockResolvedValue([]);

    const result = await sut.handleSharedSpacePersonDedup({ spaceId });
    expect(result).toBe(JobStatus.Success);
  });

  it('should merge two people of the same type when embedding match found', async () => {
    const spaceId = newUuid();
    const personA = newUuid();
    const personB = newUuid();

    mocks.sharedSpace.getById.mockResolvedValue(factory.sharedSpace({ id: spaceId, faceRecognitionEnabled: true }));
    mocks.sharedSpace.getSpacePersonsWithEmbeddings
      .mockResolvedValueOnce([
        { id: personA, name: 'Alice', type: 'person', isHidden: false, embedding: '[0.1,0.2]' },
        { id: personB, name: '', type: 'person', isHidden: false, embedding: '[0.11,0.21]' },
      ])
      .mockResolvedValueOnce([{ id: personA, name: 'Alice', type: 'person', isHidden: false, embedding: '[0.1,0.2]' }]);
    // personA has more faces -> becomes target
    mocks.sharedSpace.getPersonFaceCount.mockResolvedValueOnce(5).mockResolvedValueOnce(2);
    mocks.sharedSpace.findClosestSpacePerson.mockImplementation(
      async (_spaceId: string, _embedding: string, options: any) => {
        if (options.excludePersonIds?.includes(personA)) {
          return [{ personId: personA, name: 'Alice', distance: 0.1 }];
        }
        if (options.excludePersonIds?.includes(personB)) {
          return [{ personId: personB, name: '', distance: 0.1 }];
        }
        return [];
      },
    );
    mocks.sharedSpace.reassignPersonFacesSafe.mockResolvedValue(void 0);
    mocks.sharedSpace.migrateAliases.mockResolvedValue(void 0);
    mocks.sharedSpace.updatePerson.mockResolvedValue(void 0);
    mocks.sharedSpace.deletePerson.mockResolvedValue(void 0);

    const result = await sut.handleSharedSpacePersonDedup({ spaceId });
    expect(result).toBe(JobStatus.Success);
    expect(mocks.sharedSpace.reassignPersonFacesSafe).toHaveBeenCalledWith(personB, personA);
    expect(mocks.sharedSpace.deletePerson).toHaveBeenCalledWith(personB);
  });

  it('should succeed with no merges when space has one person (self-exclusion)', async () => {
    const spaceId = newUuid();
    const personA = newUuid();

    mocks.sharedSpace.getById.mockResolvedValue(factory.sharedSpace({ id: spaceId, faceRecognitionEnabled: true }));
    mocks.sharedSpace.getSpacePersonsWithEmbeddings.mockResolvedValue([
      { id: personA, name: 'Alice', type: 'person', isHidden: false, embedding: '[0.1,0.2]' },
    ]);
    mocks.sharedSpace.findClosestSpacePerson.mockResolvedValue([]);

    const result = await sut.handleSharedSpacePersonDedup({ spaceId });
    expect(result).toBe(JobStatus.Success);
    expect(mocks.sharedSpace.reassignPersonFacesSafe).not.toHaveBeenCalled();
  });

  it('should succeed with no merges when all persons are unique', async () => {
    const spaceId = newUuid();

    mocks.sharedSpace.getById.mockResolvedValue(factory.sharedSpace({ id: spaceId, faceRecognitionEnabled: true }));
    mocks.sharedSpace.getSpacePersonsWithEmbeddings.mockResolvedValue([
      { id: newUuid(), name: 'Alice', type: 'person', isHidden: false, embedding: '[0.1,0.2]' },
      { id: newUuid(), name: 'Bob', type: 'person', isHidden: false, embedding: '[0.9,0.8]' },
    ]);
    mocks.sharedSpace.findClosestSpacePerson.mockResolvedValue([]);

    const result = await sut.handleSharedSpacePersonDedup({ spaceId });
    expect(result).toBe(JobStatus.Success);
    expect(mocks.sharedSpace.reassignPersonFacesSafe).not.toHaveBeenCalled();
  });

  it('should handle transitive merge chains (A matches B, B matches C)', async () => {
    const spaceId = newUuid();
    const personA = newUuid();
    const personB = newUuid();
    const personC = newUuid();

    mocks.sharedSpace.getById.mockResolvedValue(factory.sharedSpace({ id: spaceId, faceRecognitionEnabled: true }));
    // Pass 1: A matches B, merge B into A
    mocks.sharedSpace.getSpacePersonsWithEmbeddings
      .mockResolvedValueOnce([
        { id: personA, name: '', type: 'person', isHidden: false, embedding: '[0.1,0.2]' },
        { id: personB, name: '', type: 'person', isHidden: false, embedding: '[0.11,0.21]' },
        { id: personC, name: '', type: 'person', isHidden: false, embedding: '[0.12,0.22]' },
      ])
      // Pass 2: merged A now matches C
      .mockResolvedValueOnce([
        { id: personA, name: '', type: 'person', isHidden: false, embedding: '[0.1,0.2]' },
        { id: personC, name: '', type: 'person', isHidden: false, embedding: '[0.12,0.22]' },
      ])
      // Pass 3: only A remains, no more merges
      .mockResolvedValueOnce([{ id: personA, name: '', type: 'person', isHidden: false, embedding: '[0.1,0.2]' }]);

    mocks.sharedSpace.getPersonFaceCount.mockResolvedValue(3);
    let callCount = 0;
    mocks.sharedSpace.findClosestSpacePerson.mockImplementation(async () => {
      callCount++;
      // Pass 1: A finds B
      if (callCount === 1) {
        return [{ personId: personB, name: '', distance: 0.1 }];
      }
      // Pass 1: B already deleted, C finds nothing (A excluded, B deleted)
      if (callCount === 2) {
        return [];
      }
      // Pass 2: A finds C
      if (callCount === 3) {
        return [{ personId: personC, name: '', distance: 0.15 }];
      }
      // Pass 3: A finds nothing
      return [];
    });
    mocks.sharedSpace.reassignPersonFacesSafe.mockResolvedValue(void 0);
    mocks.sharedSpace.migrateAliases.mockResolvedValue(void 0);
    mocks.sharedSpace.updatePerson.mockResolvedValue(void 0);
    mocks.sharedSpace.deletePerson.mockResolvedValue(void 0);

    const result = await sut.handleSharedSpacePersonDedup({ spaceId });
    expect(result).toBe(JobStatus.Success);
    // Both B and C should be merged into A
    expect(mocks.sharedSpace.deletePerson).toHaveBeenCalledWith(personB);
    expect(mocks.sharedSpace.deletePerson).toHaveBeenCalledWith(personC);
  });

  it('should gracefully handle person deleted between fetch and merge (concurrent safety)', async () => {
    const spaceId = newUuid();
    const personA = newUuid();
    const personB = newUuid();

    mocks.sharedSpace.getById.mockResolvedValue(factory.sharedSpace({ id: spaceId, faceRecognitionEnabled: true }));
    mocks.sharedSpace.getSpacePersonsWithEmbeddings
      .mockResolvedValueOnce([
        { id: personA, name: '', type: 'person', isHidden: false, embedding: '[0.1,0.2]' },
        { id: personB, name: '', type: 'person', isHidden: false, embedding: '[0.11,0.21]' },
      ])
      .mockResolvedValueOnce([]);
    mocks.sharedSpace.getPersonFaceCount.mockResolvedValueOnce(5).mockResolvedValueOnce(2);
    mocks.sharedSpace.findClosestSpacePerson.mockResolvedValueOnce([{ personId: personB, name: '', distance: 0.1 }]);
    mocks.sharedSpace.reassignPersonFacesSafe.mockResolvedValue(void 0);
    mocks.sharedSpace.migrateAliases.mockResolvedValue(void 0);
    // updatePerson throws because target was concurrently deleted
    mocks.sharedSpace.updatePerson.mockRejectedValue(new Error('no result'));
    mocks.sharedSpace.deletePerson.mockResolvedValue(void 0);

    const result = await sut.handleSharedSpacePersonDedup({ spaceId });
    // Should succeed despite the error — graceful skip
    expect(result).toBe(JobStatus.Success);
    // deletePerson should still be called even though updatePerson failed
    expect(mocks.sharedSpace.deletePerson).toHaveBeenCalledWith(personB);
  });

  it('should skip match when findClosestSpacePerson returns a person already merged in this pass', async () => {
    const spaceId = newUuid();
    const personA = newUuid();
    const personB = newUuid();
    const personC = newUuid();

    mocks.sharedSpace.getById.mockResolvedValue(factory.sharedSpace({ id: spaceId, faceRecognitionEnabled: true }));
    mocks.sharedSpace.getSpacePersonsWithEmbeddings
      .mockResolvedValueOnce([
        { id: personA, name: '', type: 'person', isHidden: false, embedding: '[0.1,0.2]' },
        { id: personB, name: '', type: 'person', isHidden: false, embedding: '[0.11,0.21]' },
        { id: personC, name: '', type: 'person', isHidden: false, embedding: '[0.12,0.22]' },
      ])
      .mockResolvedValueOnce([{ id: personA, name: '', type: 'person', isHidden: false, embedding: '[0.1,0.2]' }]);
    mocks.sharedSpace.getPersonFaceCount.mockResolvedValue(3);
    // A matches B, then C also matches B (already deleted)
    mocks.sharedSpace.findClosestSpacePerson
      .mockResolvedValueOnce([{ personId: personB, name: '', distance: 0.1 }]) // A's match
      .mockResolvedValueOnce([{ personId: personB, name: '', distance: 0.1 }]) // C tries B (already in deletedIds)
      .mockResolvedValue([]); // subsequent passes
    mocks.sharedSpace.reassignPersonFacesSafe.mockResolvedValue(void 0);
    mocks.sharedSpace.migrateAliases.mockResolvedValue(void 0);
    mocks.sharedSpace.updatePerson.mockResolvedValue(void 0);
    mocks.sharedSpace.deletePerson.mockResolvedValue(void 0);

    const result = await sut.handleSharedSpacePersonDedup({ spaceId });
    expect(result).toBe(JobStatus.Success);
    // B should be deleted (merged into A), but C should NOT be merged
    // because B was already in deletedIds when C's match returned it
    expect(mocks.sharedSpace.deletePerson).toHaveBeenCalledTimes(1);
    expect(mocks.sharedSpace.deletePerson).toHaveBeenCalledWith(personB);
  });

  it('should skip person that was already merged as a source earlier in same pass', async () => {
    const spaceId = newUuid();
    const personA = newUuid();
    const personB = newUuid();

    mocks.sharedSpace.getById.mockResolvedValue(factory.sharedSpace({ id: spaceId, faceRecognitionEnabled: true }));
    // persons list has B after A; A merges B, then loop reaches B
    mocks.sharedSpace.getSpacePersonsWithEmbeddings
      .mockResolvedValueOnce([
        { id: personA, name: '', type: 'person', isHidden: false, embedding: '[0.1,0.2]' },
        { id: personB, name: '', type: 'person', isHidden: false, embedding: '[0.11,0.21]' },
      ])
      .mockResolvedValueOnce([{ id: personA, name: '', type: 'person', isHidden: false, embedding: '[0.1,0.2]' }]);
    mocks.sharedSpace.getPersonFaceCount.mockResolvedValueOnce(5).mockResolvedValueOnce(2);
    mocks.sharedSpace.findClosestSpacePerson
      .mockResolvedValueOnce([{ personId: personB, name: '', distance: 0.1 }])
      .mockResolvedValue([]);
    mocks.sharedSpace.reassignPersonFacesSafe.mockResolvedValue(void 0);
    mocks.sharedSpace.migrateAliases.mockResolvedValue(void 0);
    mocks.sharedSpace.updatePerson.mockResolvedValue(void 0);
    mocks.sharedSpace.deletePerson.mockResolvedValue(void 0);

    const result = await sut.handleSharedSpacePersonDedup({ spaceId });
    expect(result).toBe(JobStatus.Success);
    // B should be skipped when loop reaches it (in deletedIds)
    // findClosestSpacePerson should only be called once for A (B is skipped)
    expect(mocks.sharedSpace.reassignPersonFacesSafe).toHaveBeenCalledTimes(1);
  });

  it('should not merge people of different types', async () => {
    const spaceId = newUuid();
    const personA = newUuid();
    const petB = newUuid();

    mocks.sharedSpace.getById.mockResolvedValue(factory.sharedSpace({ id: spaceId, faceRecognitionEnabled: true }));
    mocks.sharedSpace.getSpacePersonsWithEmbeddings.mockResolvedValue([
      { id: personA, name: '', type: 'person', isHidden: false, embedding: '[0.1,0.2]' },
      { id: petB, name: '', type: 'pet', isHidden: false, embedding: '[0.11,0.21]' },
    ]);
    mocks.sharedSpace.findClosestSpacePerson.mockResolvedValue([]);

    const result = await sut.handleSharedSpacePersonDedup({ spaceId });
    expect(result).toBe(JobStatus.Success);
    expect(mocks.sharedSpace.reassignPersonFacesSafe).not.toHaveBeenCalled();
    // Verify type filter was passed — each person's type should be used
    expect(mocks.sharedSpace.findClosestSpacePerson).toHaveBeenCalledWith(
      spaceId,
      expect.any(String),
      expect.objectContaining({ type: 'person' }),
    );
    expect(mocks.sharedSpace.findClosestSpacePerson).toHaveBeenCalledWith(
      spaceId,
      expect.any(String),
      expect.objectContaining({ type: 'pet' }),
    );
  });

  it('should preserve non-empty name when merging', async () => {
    const spaceId = newUuid();
    const personA = newUuid(); // target (more faces), no name
    const personB = newUuid(); // source, has name

    mocks.sharedSpace.getById.mockResolvedValue(factory.sharedSpace({ id: spaceId, faceRecognitionEnabled: true }));
    mocks.sharedSpace.getSpacePersonsWithEmbeddings
      .mockResolvedValueOnce([
        { id: personA, name: '', type: 'person', isHidden: false, embedding: '[0.1,0.2]' },
        { id: personB, name: 'Alice', type: 'person', isHidden: false, embedding: '[0.11,0.21]' },
      ])
      .mockResolvedValueOnce([{ id: personA, name: 'Alice', type: 'person', isHidden: false, embedding: '[0.1,0.2]' }]);
    mocks.sharedSpace.getPersonFaceCount.mockResolvedValueOnce(5).mockResolvedValueOnce(2);
    mocks.sharedSpace.findClosestSpacePerson.mockImplementation(
      async (_spaceId: string, _embedding: string, options: any) => {
        if (options.excludePersonIds?.includes(personA)) {
          return [{ personId: personA, name: '', distance: 0.1 }];
        }
        if (options.excludePersonIds?.includes(personB)) {
          return [{ personId: personB, name: 'Alice', distance: 0.1 }];
        }
        return [];
      },
    );
    mocks.sharedSpace.reassignPersonFacesSafe.mockResolvedValue(void 0);
    mocks.sharedSpace.migrateAliases.mockResolvedValue(void 0);
    mocks.sharedSpace.updatePerson.mockResolvedValue(void 0);
    mocks.sharedSpace.deletePerson.mockResolvedValue(void 0);

    await sut.handleSharedSpacePersonDedup({ spaceId });

    // Target (personA) should get the name from source (personB)
    expect(mocks.sharedSpace.updatePerson).toHaveBeenCalledWith(personA, expect.objectContaining({ name: 'Alice' }));
  });

  it('should make merged result visible if either person is visible', async () => {
    const spaceId = newUuid();
    const personA = newUuid(); // hidden, more faces
    const personB = newUuid(); // visible

    mocks.sharedSpace.getById.mockResolvedValue(factory.sharedSpace({ id: spaceId, faceRecognitionEnabled: true }));
    mocks.sharedSpace.getSpacePersonsWithEmbeddings
      .mockResolvedValueOnce([
        { id: personA, name: '', type: 'person', isHidden: true, embedding: '[0.1,0.2]' },
        { id: personB, name: '', type: 'person', isHidden: false, embedding: '[0.11,0.21]' },
      ])
      .mockResolvedValueOnce([{ id: personA, name: '', type: 'person', isHidden: false, embedding: '[0.1,0.2]' }]);
    mocks.sharedSpace.getPersonFaceCount.mockResolvedValueOnce(5).mockResolvedValueOnce(2);
    mocks.sharedSpace.findClosestSpacePerson.mockImplementation(
      async (_spaceId: string, _embedding: string, options: any) => {
        if (options.excludePersonIds?.includes(personA)) {
          return [{ personId: personA, name: '', distance: 0.1 }];
        }
        if (options.excludePersonIds?.includes(personB)) {
          return [{ personId: personB, name: '', distance: 0.1 }];
        }
        return [];
      },
    );
    mocks.sharedSpace.reassignPersonFacesSafe.mockResolvedValue(void 0);
    mocks.sharedSpace.migrateAliases.mockResolvedValue(void 0);
    mocks.sharedSpace.updatePerson.mockResolvedValue(void 0);
    mocks.sharedSpace.deletePerson.mockResolvedValue(void 0);

    await sut.handleSharedSpacePersonDedup({ spaceId });

    expect(mocks.sharedSpace.updatePerson).toHaveBeenCalledWith(personA, expect.objectContaining({ isHidden: false }));
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd server && pnpm test -- --run src/services/shared-space.service.spec.ts`
Expected: FAIL (`handleSharedSpacePersonDedup` method doesn't exist)

**Step 3: Implement the dedup method and job handler**

In `server/src/services/shared-space.service.ts`, add after `handleSharedSpaceLibraryFaceSync` (~line 854):

```typescript
  @OnJob({ name: JobName.SharedSpacePersonDedup, queue: QueueName.FacialRecognition })
  async handleSharedSpacePersonDedup(job: JobOf<JobName.SharedSpacePersonDedup>): Promise<JobStatus> {
    const space = await this.sharedSpaceRepository.getById(job.spaceId);
    if (!space || !space.faceRecognitionEnabled) {
      this.logger.debug(`Dedup skipped for space ${job.spaceId}: ${!space ? 'not found' : 'face recognition disabled'}`);
      return JobStatus.Skipped;
    }

    const { machineLearning } = await this.getConfig({ withCache: true });
    const maxDistance = machineLearning.facialRecognition.maxDistance;

    const MAX_PASSES = 100;
    let totalMerges = 0;
    let pass = 0;
    let mergedAny = true;

    while (mergedAny) {
      mergedAny = false;
      pass++;

      if (pass > MAX_PASSES) {
        this.logger.error(`Dedup for space ${job.spaceId} exceeded ${MAX_PASSES} passes — aborting to prevent infinite loop`);
        break;
      }

      const persons = await this.sharedSpaceRepository.getSpacePersonsWithEmbeddings(job.spaceId);
      this.logger.log(`Dedup pass ${pass} for space ${job.spaceId}: ${persons.length} persons to check`);

      if (persons.length <= 1) {
        break;
      }

      const deletedIds = new Set<string>();
      let passMerges = 0;

      for (const person of persons) {
        if (deletedIds.has(person.id)) {
          continue;
        }

        const matches = await this.sharedSpaceRepository.findClosestSpacePerson(job.spaceId, person.embedding, {
          maxDistance,
          numResults: 1,
          excludePersonIds: [person.id, ...deletedIds],
          type: person.type,
        });

        if (matches.length === 0) {
          continue;
        }

        const match = matches[0];
        const matchPerson = persons.find((p) => p.id === match.personId);
        if (!matchPerson || deletedIds.has(match.personId)) {
          this.logger.debug(
            `Dedup: skipping stale match ${match.personId} for person ${person.id} (already merged in this pass)`,
          );
          continue;
        }

        // Determine target (more faces) and source
        const personFaceCount = await this.sharedSpaceRepository.getPersonFaceCount(person.id);
        const matchFaceCount = await this.sharedSpaceRepository.getPersonFaceCount(match.personId);

        const [target, source] =
          personFaceCount >= matchFaceCount ? [person, matchPerson] : [matchPerson, person];

        this.logger.log(
          `Dedup: merging person ${source.id} (${source.name || 'unnamed'}, ${
            personFaceCount >= matchFaceCount ? matchFaceCount : personFaceCount
          } faces) into ${target.id} (${target.name || 'unnamed'}, ${
            personFaceCount >= matchFaceCount ? personFaceCount : matchFaceCount
          } faces), distance=${match.distance.toFixed(4)}`,
        );

        // Reassign faces and migrate aliases
        await this.sharedSpaceRepository.reassignPersonFacesSafe(source.id, target.id);
        await this.sharedSpaceRepository.migrateAliases(source.id, target.id);

        // Determine merged properties
        const updates: Partial<{ name: string; isHidden: boolean }> = {};
        if (!target.name && source.name) {
          updates.name = source.name;
        }
        if (target.isHidden && !source.isHidden) {
          updates.isHidden = false;
        }

        // Update and delete separately so deletePerson still runs if updatePerson fails
        try {
          if (Object.keys(updates).length > 0) {
            await this.sharedSpaceRepository.updatePerson(target.id, updates);
          }
        } catch (error) {
          // Target may have been concurrently deleted — faces were already reassigned, continue to delete source
          this.logger.warn(`Dedup: updatePerson failed for target ${target.id}: ${error}`);
        }

        try {
          await this.sharedSpaceRepository.deletePerson(source.id);
        } catch (error) {
          // Source may have been concurrently deleted — safe to ignore
          this.logger.warn(`Dedup: deletePerson failed for source ${source.id}: ${error}`);
        }

        deletedIds.add(source.id);
        passMerges++;
        mergedAny = true;
      }

      totalMerges += passMerges;
      this.logger.log(`Dedup pass ${pass} complete: ${passMerges} merges`);
    }

    this.logger.log(
      `Dedup finished for space ${job.spaceId}: ${totalMerges} total merges across ${pass} pass${pass === 1 ? '' : 'es'}`,
    );
    return JobStatus.Success;
  }
```

Also update `handleSharedSpaceLibraryFaceSync` to queue the dedup job after sync (add before `return JobStatus.Success` at line ~853):

```typescript
// Queue dedup pass after library sync completes
await this.jobRepository.queue({
  name: JobName.SharedSpacePersonDedup,
  data: { spaceId: job.spaceId },
});

return JobStatus.Success;
```

Also update `handleSharedSpaceFaceMatchAll` (~line 856-872) to queue dedup after queuing all individual face match jobs. Add before `return JobStatus.Success`:

```typescript
// Queue dedup pass after all face matches complete
await this.jobRepository.queue({
  name: JobName.SharedSpacePersonDedup,
  data: { spaceId },
});
```

**Important:** Update existing tests for both `handleSharedSpaceLibraryFaceSync` and `handleSharedSpaceFaceMatchAll` to account for the new `jobRepository.queue` call. Add `mocks.job.queue.mockResolvedValue(void 0)` to the `beforeEach` of each `describe` block, or to each existing test that calls these handlers. Specifically, the `handleSharedSpaceFaceMatchAll` tests "should queue SharedSpaceFaceMatch for each asset in the space" and "should succeed with no assets" will break without this mock.

**Step 4: Run tests to verify they pass**

Run: `cd server && pnpm test -- --run src/services/shared-space.service.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add server/src/services/shared-space.service.ts server/src/services/shared-space.service.spec.ts
git commit -m "feat: implement deduplicateSpacePeople job handler (Layer 2)"
```

---

### Task 7: Add Dedup API Endpoint

**Files:**

- Modify: `server/src/controllers/shared-space.controller.ts`
- Modify: `server/src/services/shared-space.service.ts`
- Test: `server/src/services/shared-space.service.spec.ts`

**Step 1: Write the failing test**

In the spec file, add a new `describe('deduplicateSpacePeople')` block:

```typescript
describe('deduplicateSpacePeople', () => {
  it('should require owner role', async () => {
    mocks.sharedSpace.getMember.mockResolvedValue(makeMemberResult({ role: SharedSpaceRole.Editor }));

    await expect(sut.deduplicateSpacePeople(factory.auth(), newUuid())).rejects.toThrow(ForbiddenException);
  });

  it('should queue dedup job for owner', async () => {
    const spaceId = newUuid();
    mocks.sharedSpace.getMember.mockResolvedValue(makeMemberResult({ role: SharedSpaceRole.Owner }));

    await sut.deduplicateSpacePeople(factory.auth(), spaceId);

    expect(mocks.job.queue).toHaveBeenCalledWith({
      name: JobName.SharedSpacePersonDedup,
      data: { spaceId },
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd server && pnpm test -- --run src/services/shared-space.service.spec.ts`
Expected: FAIL (`deduplicateSpacePeople` doesn't exist)

**Step 3: Implement the service method**

In `server/src/services/shared-space.service.ts`, add a public method:

```typescript
  async deduplicateSpacePeople(auth: AuthDto, spaceId: string): Promise<void> {
    await this.requireRole(auth, spaceId, SharedSpaceRole.Owner);

    await this.jobRepository.queue({
      name: JobName.SharedSpacePersonDedup,
      data: { spaceId },
    });
  }
```

**Step 4: Add the controller endpoint**

In `server/src/controllers/shared-space.controller.ts`, after the merge endpoint (~line 357), add:

```typescript
  @Post(':id/people/deduplicate')
  @Authenticated({ permission: Permission.SharedSpaceUpdate })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Deduplicate people in a shared space',
    description: 'Queue a background job to find and merge duplicate people in a shared space.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  deduplicateSpacePeople(
    @Auth() auth: AuthDto,
    @Param('id') id: string,
  ): Promise<void> {
    return this.service.deduplicateSpacePeople(auth, id);
  }
```

**Step 5: Run tests to verify they pass**

Run: `cd server && pnpm test -- --run src/services/shared-space.service.spec.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add server/src/controllers/shared-space.controller.ts server/src/services/shared-space.service.ts server/src/services/shared-space.service.spec.ts
git commit -m "feat: add POST /spaces/:id/people/deduplicate endpoint"
```

---

### Task 8: Regenerate OpenAPI Specs and SDK

**Files:**

- Modified by generation: `open-api/immich-openapi-specs.json`, `open-api/typescript-sdk/src/fetch-client.ts`, `mobile/openapi/`

**Step 1: Build server and regenerate**

```bash
cd server && pnpm build
pnpm sync:open-api
cd .. && make open-api
```

**Step 2: Verify the new endpoint appears**

Check that `deduplicateSpacePeople` appears in `open-api/typescript-sdk/src/fetch-client.ts`.

**Step 3: Regenerate SQL queries**

```bash
make sql
```

**Step 4: Commit**

```bash
git add open-api/ mobile/openapi/ server/src/queries/
git commit -m "chore: regenerate OpenAPI specs, SDK, and SQL queries"
```

---

### Task 9: Add "Deduplicate People" Button to Space People Page

**Files:**

- Modify: `web/src/routes/(user)/spaces/[spaceId]/people/+page.svelte`

**Step 1: Add the button**

In the people page, the toolbar area where the "Show and hide people" button is rendered for editors (~line 136), add a deduplicate button for owners only:

```svelte
{#if isOwner}
  <Button
    leadingIcon={mdiAccountMultipleCheckOutline}
    onclick={handleDeduplicate}
    size="small"
    variant="ghost"
    color="secondary"
  >
    {$t('deduplicate_people')}
  </Button>
{/if}
```

Add the handler function:

```typescript
import { deduplicateSpacePeople } from '@immich/sdk';
import { NotificationType, notificationController } from '$lib/components/shared-components/notification/notification';

async function handleDeduplicate() {
  try {
    await deduplicateSpacePeople({ id: space.id });
    notificationController.show({
      type: NotificationType.Info,
      message: $t('dedup_people_started'),
    });
  } catch (error) {
    handleError(error, $t('dedup_people_error'));
  }
}
```

**Step 2: Add i18n keys**

Add to `i18n/en.json` (maintain alphabetical sort):

```json
"dedup_people_error": "Failed to start deduplication",
"dedup_people_started": "Deduplication started in background",
"deduplicate_people": "Deduplicate people",
```

**Step 3: Run i18n formatting**

```bash
pnpm --filter=immich-i18n format:fix
```

**Step 4: Verify web build**

```bash
cd web && npx svelte-check --threshold warning
```

**Step 5: Commit**

```bash
git add web/src/routes/\(user\)/spaces/\[spaceId\]/people/+page.svelte i18n/en.json
git commit -m "feat: add Deduplicate People button for space owners"
```

---

### Task 10: Lint, Format, and Final Verification

**Files:** All modified files

**Step 1: Format**

```bash
make format-server
make format-web
```

**Step 2: Lint**

```bash
make lint-server
make lint-web
```

**Step 3: Type check**

```bash
make check-server
make check-web
```

**Step 4: Run all tests**

```bash
cd server && pnpm test -- --run src/services/shared-space.service.spec.ts
cd ../web && pnpm test -- --run
```

**Step 5: Fix any issues and commit**

```bash
git add -A
git commit -m "chore: lint and format fixes"
```
