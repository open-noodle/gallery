# Fix Space Person Orphans After Face Recognition Reset

## Problem

Resetting face recognition (`force=true`) deletes all `asset_face` rows, which cascade-deletes
all `shared_space_person_face` junction rows (`ON DELETE CASCADE` on `assetFaceId`) and sets
`shared_space_person.representativeFaceId` to NULL (`ON DELETE SET NULL`). But `shared_space_person`
records survive as orphans — zero junction rows, NULL representative face.

When face detection re-runs, new space persons are created alongside the old orphans, causing
duplicates. The dedup job (`handleSharedSpacePersonDedup`) can't clean them up because it INNER
JOINs on `face_search` via `representativeFaceId` — orphans with NULL are invisible.

`deleteOrphanedPersons(spaceId)` already exists in `SharedSpaceRepository` but is only called from
the asset-removal flow.

## Approach

Two-pronged fix: proactive cleanup during face reset + safety net in the dedup job.

## Changes

### 1. New repo method: `deleteAllOrphanedPersons()`

File: `server/src/repositories/shared-space.repository.ts`

Cross-space cleanup — deletes any `shared_space_person` with zero junction rows:

```sql
DELETE FROM shared_space_person
WHERE id NOT IN (SELECT personId FROM shared_space_person_face)
```

Decorated with `@GenerateSql` for SQL query file generation.

This is safe because:

- `personId` in `shared_space_person_face` is a non-nullable PK column — no NULL-in-NOT-IN gotcha
- If the junction table is empty (full reset), `NOT IN (empty set)` evaluates to TRUE for all rows,
  correctly deleting all space persons
- A space person with even one junction row is preserved

### 2. Proactive cleanup in face reset

File: `server/src/services/person.service.ts`

Called in the `force` block of `handleQueueDetectFaces`, after `handlePersonCleanup()` and before
`vacuum()` (groups cleanup operations together before the expensive reindex):

```typescript
if (force) {
  await this.personRepository.deleteFaces({ sourceType: SourceType.MachineLearning });
  await this.handlePersonCleanup();
  await this.sharedSpaceRepository.deleteAllOrphanedPersons(); // NEW
  await this.personRepository.vacuum({ reindexVectors: true });
}
```

### 3. Safety net in dedup job

File: `server/src/services/shared-space.service.ts`

At the end of `handleSharedSpacePersonDedup`, after the merge loop and final log, before the return:

```typescript
await this.sharedSpaceRepository.deleteOrphanedPersons(job.spaceId);
```

Uses the existing per-space method. Catches orphans regardless of how they were created.

## Assumptions

- BullMQ processes jobs in FIFO order within `QueueName.FacialRecognition`, so the dedup job runs
  after all face match jobs for that space complete. The orphan cleanup is idempotent — worst case a
  space person is deleted and immediately recreated on the next face match.
- No denormalized person count exists on the space table (verified — only `faceCount`/`assetCount`
  on the space person itself, which are deleted with the orphan row).

## What this does NOT do

- Does not handle `handleQueueRecognizeFaces(force=true)` — that path unassigns faces
  (`personId=null`) rather than deleting them, so junction rows survive and no orphans are created.
  Space persons whose representative face pointed at a now-deleted global person become invisible in
  the UI via the LEFT JOIN chain, but that is a separate concern.
- Does not add DB-level constraints or triggers.
- Does not change the dedup algorithm itself.
- Does not change `getPersonsBySpaceId` (orphans are already filtered out because the LEFT JOIN
  chain produces NULLs when `representativeFaceId` is NULL, failing the `person.thumbnailPath IS NOT
NULL` filter).

## Testing

1. Unit test: `handleQueueDetectFaces` with `force=true` calls `deleteAllOrphanedPersons`
2. Unit test: `handleQueueDetectFaces` without `force` does NOT call `deleteAllOrphanedPersons`
3. Unit test: `handleSharedSpacePersonDedup` calls `deleteOrphanedPersons(spaceId)` after merge
   loop — including when zero merges happen
4. Regenerate SQL query files (`make sql`)

## Files changed

1. `server/src/repositories/shared-space.repository.ts` — new `deleteAllOrphanedPersons()`
2. `server/src/services/person.service.ts` — call in force block
3. `server/src/services/shared-space.service.ts` — call at end of dedup
4. `server/src/services/person.service.spec.ts` — new unit tests
5. `server/src/services/shared-space.service.spec.ts` — new unit test
