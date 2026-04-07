# Space Person Orphan Cleanup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Clean up orphaned space persons after face recognition reset and as a safety net in the dedup job.

**Architecture:** Add `deleteAllOrphanedPersons()` repo method (cross-space), call it proactively from the face detection reset path, and call `deleteOrphanedPersons(spaceId)` at the end of every dedup job run.

**Tech Stack:** NestJS, Kysely, Vitest

---

### Task 1: Add `deleteAllOrphanedPersons()` to SharedSpaceRepository

**Files:**

- Modify: `server/src/repositories/shared-space.repository.ts` (near existing `deleteOrphanedPersons` at line 668)

**Step 1: Add the method**

Add directly after the existing `deleteOrphanedPersons` method (line 675):

```typescript
@GenerateSql({})
async deleteAllOrphanedPersons() {
  await this.db
    .deleteFrom('shared_space_person')
    .where('id', 'not in', this.db.selectFrom('shared_space_person_face').select('personId'))
    .execute();
}
```

**Step 2: Verify types compile**

Run: `cd server && npx tsc --noEmit`
Expected: No errors related to `deleteAllOrphanedPersons`

**Step 3: Commit**

```
fix: add deleteAllOrphanedPersons repo method for cross-space orphan cleanup
```

---

### Task 2: Call `deleteAllOrphanedPersons` from face detection reset

**Files:**

- Modify: `server/src/services/person.service.ts:277-281` (the `force` block in `handleQueueDetectFaces`)

**Step 1: Add the cleanup call**

Change the force block from:

```typescript
if (force) {
  await this.personRepository.deleteFaces({ sourceType: SourceType.MachineLearning });
  await this.handlePersonCleanup();
  await this.personRepository.vacuum({ reindexVectors: true });
}
```

To:

```typescript
if (force) {
  await this.personRepository.deleteFaces({ sourceType: SourceType.MachineLearning });
  await this.handlePersonCleanup();
  await this.sharedSpaceRepository.deleteAllOrphanedPersons();
  await this.personRepository.vacuum({ reindexVectors: true });
}
```

**Step 2: Verify types compile**

Run: `cd server && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```
fix: clean up orphaned space persons during face detection reset
```

---

### Task 3: Add unit tests for face detection reset orphan cleanup

**Files:**

- Modify: `server/src/services/person.service.spec.ts` (in the `handleQueueDetectFaces` describe block, around line 527)

**Step 1: Add assertion to the existing force=true test**

In the test `'should queue all assets'` (line 504), after the existing assertions at line 515, add:

```typescript
expect(mocks.sharedSpace.deleteAllOrphanedPersons).toHaveBeenCalled();
```

**Step 2: Add assertion to the second force=true test**

In the test `'should delete existing people and faces if forced'` (line 549), after the existing assertions around line 569, add:

```typescript
expect(mocks.sharedSpace.deleteAllOrphanedPersons).toHaveBeenCalled();
```

**Step 3: Add assertion to the force=undefined test**

In the test `'should refresh all assets'` (line 529), after the existing `not.toHaveBeenCalled` assertions around line 538, add:

```typescript
expect(mocks.sharedSpace.deleteAllOrphanedPersons).not.toHaveBeenCalled();
```

**Step 4: Run tests**

Run: `cd server && pnpm test -- --run src/services/person.service.spec.ts`
Expected: All tests pass

**Step 5: Commit**

```
test: verify orphan cleanup during face detection reset
```

---

### Task 4: Add `deleteOrphanedPersons` call to dedup job

**Files:**

- Modify: `server/src/services/shared-space.service.ts:1011-1014` (end of `handleSharedSpacePersonDedup`)

**Step 1: Add orphan cleanup before the return**

Change from:

```typescript
this.logger.log(
  `Dedup finished for space ${job.spaceId}: ${totalMerges} total merges across ${pass} pass${pass === 1 ? '' : 'es'}`,
);
return JobStatus.Success;
```

To:

```typescript
// Clean up orphaned persons (no faces linked) as safety net
await this.sharedSpaceRepository.deleteOrphanedPersons(job.spaceId);

this.logger.log(
  `Dedup finished for space ${job.spaceId}: ${totalMerges} total merges across ${pass} pass${pass === 1 ? '' : 'es'}`,
);
return JobStatus.Success;
```

**Step 2: Verify types compile**

Run: `cd server && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```
fix: clean up orphaned space persons at end of dedup job
```

---

### Task 5: Add unit tests for dedup orphan cleanup

**Files:**

- Modify: `server/src/services/shared-space.service.spec.ts` (in the `handleSharedSpacePersonDedup` describe block, before the closing `});` at line 4925)

**Step 1: Add test for orphan cleanup after zero merges**

Add before line 4925:

```typescript
it('should clean up orphaned persons even with no merges', async () => {
  const spaceId = newUuid();
  mocks.sharedSpace.getById.mockResolvedValue(factory.sharedSpace({ id: spaceId, faceRecognitionEnabled: true }));
  mocks.sharedSpace.getSpacePersonsWithEmbeddings.mockResolvedValue([]);
  mocks.sharedSpace.deleteOrphanedPersons.mockResolvedValue(void 0 as any);

  const result = await sut.handleSharedSpacePersonDedup({ spaceId });
  expect(result).toBe(JobStatus.Success);
  expect(mocks.sharedSpace.deleteOrphanedPersons).toHaveBeenCalledWith(spaceId);
});
```

**Step 2: Add assertion to an existing merge test**

In the test `'should merge two people of the same type when embedding match found'` (line 4610), add the mock setup in the test body and an assertion at the end:

After `mocks.sharedSpace.deletePerson.mockResolvedValue(void 0 as any);` (line 4638), add:

```typescript
mocks.sharedSpace.deleteOrphanedPersons.mockResolvedValue(void 0 as any);
```

After `expect(mocks.sharedSpace.recountPersons).toHaveBeenCalledWith([personA]);` (around line 4644), add:

```typescript
expect(mocks.sharedSpace.deleteOrphanedPersons).toHaveBeenCalledWith(spaceId);
```

**Step 3: Run tests**

Run: `cd server && pnpm test -- --run src/services/shared-space.service.spec.ts`
Expected: All tests pass

**Step 4: Commit**

```
test: verify orphan cleanup in dedup job
```

---

### Task 6: Regenerate SQL query files and final verification

**Step 1: Rebuild server and regenerate SQL**

This requires the dev DB to be running. If it is:

Run: `cd server && pnpm build && make -C .. sql`

If the DB is not running, apply the SQL diff manually by adding the query for `deleteAllOrphanedPersons` to `server/src/queries/shared.space.repository.sql`.

**Step 2: Run full test suite**

Run: `cd server && pnpm test -- --run`
Expected: All tests pass

**Step 3: Run type checks**

Run: `cd server && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit SQL query files**

```
chore: regenerate SQL query files
```
