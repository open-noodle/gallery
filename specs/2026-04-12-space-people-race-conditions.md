# Space People Race Conditions Fix

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix race conditions that cause space people to be missing or incorrect after face recognition runs (#331).

**Architecture:** Two bugs produce the reported symptoms. Bug A is the primary cause (display-layer: space persons exist in DB but are filtered out by a query that depends on global person thumbnail state). Bug B is a defensive fix (data-layer: already-recognized faces skip space matching on force re-run). A comprehensive medium test suite validates the full pipeline under various timing/ordering scenarios.

**Tech Stack:** NestJS, Kysely, Vitest, BullMQ

---

## Bug Summary

| Bug | Symptom                                                                         | Root Cause                                                                                                                                                                                                                                     | Impact                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | "21 vs 159 persons" — space persons exist but don't appear in UI                | `getPersonsBySpaceId` filters on `person.thumbnailPath` via LEFT JOIN through `representativeFaceId` → `asset_face.personId` → `person`. If the global person has no thumbnail yet (or the chain resolves to NULL), the space person is hidden | **PRIMARY** — explains the massive count discrepancy                                                                                                                              |
| B   | After force-recognition reset, faces with existing personId skip space matching | `handleRecognizeFaces` returns early at line 505 when `face.personId` is set, before reaching the space face matching code at line 563-570                                                                                                     | **DEFENSIVE** — narrow scenario (ML faces are unassigned during force reset, so line 505 rarely triggers; but EXIF/manual faces are already handled by `SharedSpaceFaceMatchAll`) |

### What we're NOT changing

**`SharedSpaceFaceMatchAll` in force-recognition reset stays.** The review found that removing it (original Task 3) would break EXIF/manual-sourced face handling. These faces are skipped at line 495 (`sourceType !== MachineLearning`), so they never reach line 505 — Bug B's fix doesn't help them. `SharedSpaceFaceMatchAll` is the only path that catches them. The ordering issue (runs before recognition) is actually fine for non-ML faces since their personIds are never unassigned.

---

## Task 1: Medium test — `getPersonsBySpaceId` returns persons regardless of global person thumbnail

This is the PRIMARY fix. The query at `server/src/repositories/shared-space.repository.ts:547-588` uses LEFT JOINs to `asset_face` and `person`, then filters `person.thumbnailPath IS NOT NULL`. With LEFT JOINs, if the representative face's global person has no thumbnail (or no personId), those columns are NULL and the space person is filtered out.

**Files:**

- Modify: `server/src/repositories/shared-space.repository.ts:556-557`
- Test: `server/test/medium/specs/repositories/shared-space.repository.spec.ts`
- Regen: `server/src/queries/shared.space.repository.sql`

### Step 1: Write failing medium test

Add a `describe('getPersonsBySpaceId')` block to the medium test file. This tests the REAL query against a real DB.

```typescript
describe('getPersonsBySpaceId', () => {
  it('should return space persons whose global person has no thumbnail', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
    const { asset } = await ctx.newAsset({ ownerId: user.id });

    // Create a global person WITHOUT a thumbnail
    const { person } = await ctx.newPerson({ ownerId: user.id, thumbnailPath: '' });

    // Create a face assigned to this person
    const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: person.id });
    await ctx.database.insertInto('face_search').values({ faceId: assetFace.id, embedding: newEmbedding() }).execute();

    // Create space person with representativeFaceId pointing to this face
    const spacePerson = await sut.createPerson({
      spaceId: space.id,
      name: 'Test Person',
      representativeFaceId: assetFace.id,
      type: 'person',
    });
    await sut.addPersonFaces([{ personId: spacePerson.id, assetFaceId: assetFace.id }], { skipRecount: false });

    const result = await sut.getPersonsBySpaceId(space.id, {});

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(spacePerson.id);
    expect(result[0].name).toBe('Test Person');
  });

  it('should return space persons whose representativeFace has no global personId', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
    const { asset } = await ctx.newAsset({ ownerId: user.id });

    // Face with NO personId (recognition hasn't run yet)
    const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
    await ctx.database.insertInto('face_search').values({ faceId: assetFace.id, embedding: newEmbedding() }).execute();

    const spacePerson = await sut.createPerson({
      spaceId: space.id,
      name: 'Unrecognized Person',
      representativeFaceId: assetFace.id,
      type: 'person',
    });
    await sut.addPersonFaces([{ personId: spacePerson.id, assetFaceId: assetFace.id }], { skipRecount: false });

    const result = await sut.getPersonsBySpaceId(space.id, {});

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Unrecognized Person');
  });

  it('should return space persons whose representative face was deleted', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const { person } = await ctx.newPerson({ ownerId: user.id, thumbnailPath: '/thumb.jpg' });

    // Create face and space person, then soft-delete the representative face.
    // This simulates force-detection reset where the face is removed but the
    // space person hasn't been cleaned up yet.
    const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: person.id });
    await ctx.database.insertInto('face_search').values({ faceId: assetFace.id, embedding: newEmbedding() }).execute();

    const spacePerson = await sut.createPerson({
      spaceId: space.id,
      name: 'Deleted Face Person',
      representativeFaceId: assetFace.id,
      type: 'person',
    });
    // Add a SECOND face so the person has faces even after soft-deleting the representative
    const { asset: asset2 } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: face2 } = await ctx.newAssetFace({ assetId: asset2.id, personId: person.id });
    await sut.addPersonFaces(
      [
        { personId: spacePerson.id, assetFaceId: assetFace.id },
        { personId: spacePerson.id, assetFaceId: face2.id },
      ],
      { skipRecount: false },
    );

    // Soft-delete the representative face
    await ctx.database
      .updateTable('asset_face')
      .set({ deletedAt: new Date() })
      .where('id', '=', assetFace.id)
      .execute();

    const result = await sut.getPersonsBySpaceId(space.id, {});

    // Should still appear — the LEFT JOIN to asset_face may return null
    // for a soft-deleted face, but the space person itself has faces
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Deleted Face Person');
  });

  it('should fall back to global person name when space person has no name', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const { person } = await ctx.newPerson({
      ownerId: user.id,
      name: 'Global Name',
      thumbnailPath: '/path/to/thumb.jpg',
    });
    const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: person.id });
    await ctx.database.insertInto('face_search').values({ faceId: assetFace.id, embedding: newEmbedding() }).execute();

    const spacePerson = await sut.createPerson({
      spaceId: space.id,
      name: '', // empty — should fall back to global
      representativeFaceId: assetFace.id,
      type: 'person',
    });
    await sut.addPersonFaces([{ personId: spacePerson.id, assetFaceId: assetFace.id }], { skipRecount: false });

    const result = await sut.getPersonsBySpaceId(space.id, {});

    expect(result).toHaveLength(1);
    expect(result[0].personalName).toBe('Global Name');
  });
});
```

### Step 2: Run test to verify it fails

```bash
cd server && pnpm test:medium -- --run test/medium/specs/repositories/shared-space.repository.spec.ts -t "getPersonsBySpaceId"
```

Expected: FAIL — first two tests fail because the `person.thumbnailPath` filter excludes them.

### Step 3: Fix the repository query

In `server/src/repositories/shared-space.repository.ts`, remove lines 556-557:

```typescript
// REMOVE these two lines:
.where('person.thumbnailPath', 'is not', null)
.where('person.thumbnailPath', '!=', '')
```

### Step 4: Run medium test to verify it passes

```bash
cd server && pnpm test:medium -- --run test/medium/specs/repositories/shared-space.repository.spec.ts -t "getPersonsBySpaceId"
```

Expected: All 4 tests PASS.

### Step 5: Run full test suites

```bash
cd server && pnpm test -- --run src/services/shared-space.service.spec.ts
cd server && pnpm test:medium -- --run test/medium/specs/repositories/shared-space.repository.spec.ts
```

### Step 6: Regenerate SQL query files

```bash
cd server && pnpm sync:sql
```

### Step 7: Commit

```bash
git add server/src/repositories/shared-space.repository.ts server/src/queries/shared.space.repository.sql server/test/medium/specs/repositories/shared-space.repository.spec.ts
git commit -m "fix(spaces): remove thumbnailPath filter from getPersonsBySpaceId

The query filtered on person.thumbnailPath via LEFT JOIN through
representativeFaceId -> asset_face.personId -> person. If the global
person had no thumbnail yet, the space person was silently hidden.
This caused space views to show far fewer people than the global
Photos view (e.g. 21 vs 159 in #331).

Added medium tests covering: no thumbnail, no personId on face,
null representativeFaceId, and global name fallback."
```

---

## Task 2: Queue space face matching after early-return in `handleRecognizeFaces` (Bug B)

When `handleRecognizeFaces` finds `face.personId` is already set (line 505), it returns early before reaching the space face matching code at line 563-570. This is a defensive fix — during normal operation, force-recognition unassigns all ML faces so line 505 doesn't trigger. But edge cases exist (manual personId assignment, partial runs).

**Note:** EXIF/manual-sourced faces are handled separately by `SharedSpaceFaceMatchAll` (which we're keeping). This fix covers ML faces that already have a personId.

**Files:**

- Modify: `server/src/services/person.service.ts:505-508`
- Test: `server/src/services/person.service.spec.ts`

### Step 1: Write failing test

Add to the `handleRecognizeFaces` describe block:

```typescript
it('should queue space face matching even when face already has a person assigned', async () => {
  const asset = AssetFactory.create();
  const face = AssetFaceFactory.from({ assetId: asset.id }).person().build();
  mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(face, asset));
  mocks.sharedSpace.getSpaceIdsForAsset.mockResolvedValue([{ spaceId: 'space-1' }]);

  expect(await sut.handleRecognizeFaces({ id: face.id })).toBe(JobStatus.Skipped);

  expect(mocks.sharedSpace.getSpaceIdsForAsset).toHaveBeenCalledWith(face.assetId);
  expect(mocks.job.queue).toHaveBeenCalledWith({
    name: JobName.SharedSpaceFaceMatch,
    data: { spaceId: 'space-1', assetId: face.assetId },
  });
});

it('should not queue space face matching when face has personId but no spaces', async () => {
  const asset = AssetFactory.create();
  const face = AssetFaceFactory.from({ assetId: asset.id }).person().build();
  mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(face, asset));
  mocks.sharedSpace.getSpaceIdsForAsset.mockResolvedValue([]);

  expect(await sut.handleRecognizeFaces({ id: face.id })).toBe(JobStatus.Skipped);

  expect(mocks.sharedSpace.getSpaceIdsForAsset).toHaveBeenCalledWith(face.assetId);
  expect(mocks.job.queue).not.toHaveBeenCalled();
});
```

### Step 2: Run test to verify it fails

```bash
cd server && pnpm test -- --run src/services/person.service.spec.ts -t "should queue space face matching even when face already has a person assigned"
```

Expected: FAIL — `getSpaceIdsForAsset` not called.

### Step 3: Implement the fix

In `server/src/services/person.service.ts`, change the early return at line 505-508:

```typescript
if (face.personId) {
  this.logger.debug(`Face ${id} already has a person assigned`);

  // Still queue space face matching — this face may belong to a space
  // that was created/linked after the face was originally recognized.
  const spaceIds = await this.sharedSpaceRepository.getSpaceIdsForAsset(face.assetId);
  for (const { spaceId } of spaceIds) {
    await this.jobRepository.queue({
      name: JobName.SharedSpaceFaceMatch,
      data: { spaceId, assetId: face.assetId },
    });
  }

  return JobStatus.Skipped;
}
```

### Step 4: Run tests

```bash
cd server && pnpm test -- --run src/services/person.service.spec.ts
```

Expected: All pass. The existing `beforeEach` at line 1077 mocks `getSpaceIdsForAsset` to return `[]`, so existing tests are unaffected.

### Step 5: Commit

```bash
git add server/src/services/person.service.ts server/src/services/person.service.spec.ts
git commit -m "fix(spaces): queue space face matching for already-recognized faces

handleRecognizeFaces returned early when face.personId was set,
skipping the space face matching code. Now queues
SharedSpaceFaceMatch before the early return so faces in spaces
created after recognition still get space-matched."
```

---

## Task 3: Move `SharedSpaceFaceMatchAll` after recognition jobs in force reset

The force-recognition reset at `server/src/services/person.service.ts:444-450` queues `SharedSpaceFaceMatchAll` BEFORE the `FacialRecognition` jobs. Since they share the same FIFO queue (concurrency 1), `SharedSpaceFaceMatchAll` runs first when all ML personIds are still NULL — it successfully processes EXIF/manual faces but wastes time scanning all ML faces for nothing.

Move the queueing to AFTER all recognition jobs are queued so it runs last and can catch any stragglers.

**Files:**

- Modify: `server/src/services/person.service.ts:428-475`
- Test: `server/src/services/person.service.spec.ts`

### Step 1: Write failing test

```typescript
it('should queue SharedSpaceFaceMatchAll AFTER FacialRecognition jobs on force reset', async () => {
  const asset = AssetFactory.create();
  const face = AssetFaceFactory.create({ assetId: asset.id });

  mocks.person.getAllFaces.mockReturnValue(makeStream([face]));
  mocks.person.getAllWithoutFaces.mockResolvedValue([]);
  mocks.sharedSpace.deleteAllPersonFaces.mockResolvedValue(void 0 as any);
  mocks.sharedSpace.deleteAllPersons.mockResolvedValue(void 0 as any);
  mocks.sharedSpace.deleteAllOrphanedPersons.mockResolvedValue(void 0 as any);
  mocks.sharedSpace.getSpaceIdsWithFaceRecognitionEnabled.mockResolvedValue(['space-1']);

  await sut.handleQueueRecognizeFaces({ force: true });

  // Verify ordering: queueAll for recognition jobs is called BEFORE
  // queueAll for SharedSpaceFaceMatchAll
  const queueAllCalls = mocks.job.queueAll.mock.calls;
  const recognitionCallIndex = queueAllCalls.findIndex((call) =>
    call[0].some((job: any) => job.name === JobName.FacialRecognition),
  );
  const spaceMatchCallIndex = queueAllCalls.findIndex((call) =>
    call[0].some((job: any) => job.name === JobName.SharedSpaceFaceMatchAll),
  );

  expect(recognitionCallIndex).toBeGreaterThanOrEqual(0);
  expect(spaceMatchCallIndex).toBeGreaterThanOrEqual(0);
  expect(spaceMatchCallIndex).toBeGreaterThan(recognitionCallIndex);
});
```

### Step 2: Run test to verify it fails

```bash
cd server && pnpm test -- --run src/services/person.service.spec.ts -t "should queue SharedSpaceFaceMatchAll AFTER"
```

Expected: FAIL — `SharedSpaceFaceMatchAll` is queued before recognition jobs.

### Step 3: Implement the fix

Move the `SharedSpaceFaceMatchAll` queueing from line 444-450 to after line 475 (after all recognition jobs are queued):

```typescript
if (force) {
  await this.personRepository.unassignFaces({ sourceType: SourceType.MachineLearning });
  await this.handlePersonCleanup();
  await this.personRepository.vacuum({ reindexVectors: false });

  await this.sharedSpaceRepository.deleteAllPersonFaces();
  await this.sharedSpaceRepository.deleteAllPersons();
}
// ... (existing recognition job queueing) ...

await this.jobRepository.queueAll(jobs);

// Queue SharedSpaceFaceMatchAll AFTER recognition jobs so it runs last.
// This catches EXIF/manual-sourced faces whose personIds survive
// unassignFaces (non-ML source). Queued after recognition jobs so
// ML faces have been processed by the per-face space matching path first.
if (force) {
  const spaceIds = await this.sharedSpaceRepository.getSpaceIdsWithFaceRecognitionEnabled();
  await this.jobRepository.queueAll(
    spaceIds.map((spaceId) => ({
      name: JobName.SharedSpaceFaceMatchAll as const,
      data: { spaceId },
    })),
  );
}
```

### Step 4: Run tests

```bash
cd server && pnpm test -- --run src/services/person.service.spec.ts
```

Expected: All pass (update existing tests that check `SharedSpaceFaceMatchAll` ordering if needed).

### Step 5: Commit

```bash
git add server/src/services/person.service.ts server/src/services/person.service.spec.ts
git commit -m "fix(spaces): queue SharedSpaceFaceMatchAll after recognition jobs

SharedSpaceFaceMatchAll was queued before FacialRecognition jobs on
the same FIFO queue. It ran first when all ML personIds were still
NULL, wasting time scanning ML faces. Moved to after recognition
jobs so it runs last and catches EXIF/manual faces efficiently."
```

---

## Task 4: Comprehensive medium tests for space face matching pipeline

These tests validate the full pipeline with a real database under various timing/ordering scenarios. They're the most important part of this change — they'll catch regressions and document the expected behavior.

**Files:**

- Create: `server/test/medium/specs/services/shared-space-face-matching.spec.ts`

### Test Infrastructure Setup

The medium test needs real repositories for SharedSpace, Person, Asset, and Search, but mocks for Job (to verify job queueing) and ML.

```typescript
import { Kysely } from 'kysely';
import { AssetVisibility, JobName, SourceType } from 'src/enum';
import { AccessRepository } from 'src/repositories/access.repository';
import { AssetJobRepository } from 'src/repositories/asset-job.repository';
import { AssetRepository } from 'src/repositories/asset.repository';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { MachineLearningRepository } from 'src/repositories/machine-learning.repository';
import { PersonRepository } from 'src/repositories/person.repository';
import { SearchRepository } from 'src/repositories/search.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { StorageRepository } from 'src/repositories/storage.repository';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository';
import { DB } from 'src/schema';
import { SharedSpaceService } from 'src/services/shared-space.service';
import { newMediumService } from 'test/medium.factory';
import { newEmbedding } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  return newMediumService(SharedSpaceService, {
    database: db || defaultDatabase,
    real: [
      AccessRepository,
      DatabaseRepository,
      PersonRepository,
      AssetRepository,
      SearchRepository,
      SharedSpaceRepository,
      AssetJobRepository,
      SystemMetadataRepository,
    ],
    mock: [JobRepository, LoggingRepository, StorageRepository, MachineLearningRepository],
  });
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});
```

Note: The exact `real`/`mock` split may need adjustment based on what `newMediumService` supports for `SharedSpaceService`. If `SharedSpaceService` isn't directly supported, test through the repository directly and invoke `processSpaceFaceMatch`-like logic manually. Adapt the setup as needed.

### Test Group A: Space person visibility (validates Bug A fix)

```typescript
describe('space person visibility after face matching', () => {
  it('should show space person when global person has empty thumbnailPath', async () => {
    // Setup: user, space, library, asset, face with person (thumbnailPath='')
    // Action: run face matching for the asset
    // Assert: getPersonsBySpaceId returns the space person
  });

  it('should show space person when representative face has no global person', async () => {
    // Setup: face with personId=null (recognition hasn't run)
    // Action: create space person manually (simulating old code path)
    // Assert: getPersonsBySpaceId returns it
  });

  it('should show space person when global person is later deleted', async () => {
    // Setup: space person created, global person exists
    // Action: delete the global person (simulates force-recognition cleanup)
    // Assert: space person still appears (LEFT JOIN returns NULL, no filter)
  });

  it('should correctly count space persons across states', async () => {
    // Setup: 5 space persons — 2 with thumbnails, 2 without, 1 with null representativeFace
    // Assert: getPersonsBySpaceId returns all 5
  });

  it('should return correct results with takenAfter/takenBefore temporal filter', async () => {
    // The temporal filter uses an EXISTS subquery joining through
    // shared_space_person_face → asset_face → asset. Verify it still
    // works after removing the thumbnailPath WHERE clause.
    // Setup: 2 space persons — SP1 has faces on assets from 2024, SP2 from 2026
    // Action: getPersonsBySpaceId with takenAfter=2025-01-01
    // Assert: returns only SP2
  });

  it('should return empty array for space with no faces or persons', async () => {
    // Setup: space with library linked but no assets/faces
    // Action: getPersonsBySpaceId
    // Assert: returns [] (not error)
  });
});
```

### Test Group B: Face matching under different ordering scenarios

```typescript
describe('face matching ordering scenarios', () => {
  it('Scenario 1: library linked AFTER all recognition completes', async () => {
    // This is the happy path
    // 1. Create assets with faces
    // 2. Assign personIds to all faces (simulate recognition complete)
    // 3. Create space, link library
    // 4. Run processSpaceFaceMatch for each asset
    // Assert: all faces with personId create space persons
    // Assert: faces sharing a global personId share a space person (Layer 1)
  });

  it('Scenario 2: library linked WHILE recognition is in progress', async () => {
    // 1. Create 4 assets with faces
    // 2. Assign personId to 2 faces, leave 2 with personId=null
    // 3. Create space, link library
    // 4. Run processSpaceFaceMatch for all assets
    // Assert: 2 faces with personId create space persons
    // Assert: 2 faces without personId are skipped (strict gate)
    // 5. Assign personId to remaining 2 faces
    // 6. Run processSpaceFaceMatch again for those assets
    // Assert: remaining 2 faces now create/join space persons
    // Assert: total space person count is correct
  });

  it('Scenario 3: space created AFTER all recognition completes', async () => {
    // 1. Create library with assets, all faces recognized
    // 2. Create space, link library
    // 3. Run SharedSpaceLibraryFaceSync logic (processSpaceFaceMatch for all)
    // Assert: all recognized faces create space persons
  });

  it('Scenario 4: force-recognition reset with existing spaces', async () => {
    // 1. Full setup: library, space, faces recognized, space persons created
    // 2. Simulate force reset: unassign all ML faces, delete space persons
    // 3. Re-assign personIds (simulate re-recognition)
    // 4. Run processSpaceFaceMatch for each asset
    // Assert: space persons rebuilt correctly
    // Assert: no orphaned space persons
  });

  it('Scenario 4b: force-detection reset cascades to space persons', async () => {
    // Force-detection reset deletes asset_face rows. shared_space_person_face
    // has ON DELETE CASCADE from asset_face, so space person faces are deleted.
    // Then deleteAllOrphanedPersons cleans up empty space persons.
    // 1. Full setup: library, space, faces recognized, space persons created
    // 2. Simulate force detection reset: delete all ML asset_face rows
    // Assert: shared_space_person_face rows are cascade-deleted
    // 3. Run deleteAllOrphanedPersons
    // Assert: space persons with no remaining faces are deleted
    // 4. Re-detect faces (new asset_face rows with new IDs)
    // 5. Run recognition → processSpaceFaceMatch
    // Assert: new space persons created correctly with new face IDs
  });

  it('Scenario 5: same global person across multiple assets in space', async () => {
    // 1. Create 3 assets, each with a face assigned to the SAME global person
    // 2. Create space, link library
    // 3. Run processSpaceFaceMatch for each asset sequentially
    // Assert: only ONE space person created (Layer 1 reuse)
    // Assert: space person has faceCount=3, assetCount=3
  });

  it('Scenario 6: cross-owner bridging via Layer 2', async () => {
    // 1. Create 2 users, each with an asset+face assigned to DIFFERENT global persons
    // 2. Both faces have similar embeddings (same physical person)
    // 3. Create space with both libraries
    // 4. Run processSpaceFaceMatch for both assets
    // Assert: Layer 1 misses (different personIds)
    // Assert: Layer 2 matches (similar embeddings) — single space person
  });

  it('Scenario 7: duplicate processSpaceFaceMatch calls are idempotent', async () => {
    // The isPersonFaceAssigned check at line 1085 guards against duplicates.
    // 1. Create asset with face, assign personId
    // 2. Create space, link library
    // 3. Run processSpaceFaceMatch for the asset
    // Assert: 1 space person created with 1 face
    // 4. Run processSpaceFaceMatch AGAIN for the same asset
    // Assert: still 1 space person with 1 face (no duplicates)
    // Assert: addPersonFaces NOT called on second run
  });

  it('Scenario 8: multiple spaces for same library', async () => {
    // 1. Create library with assets, all faces recognized
    // 2. Create Space A and Space B, both link the same library
    // 3. Run processSpaceFaceMatch for each asset in each space
    // Assert: each space has its own independent space persons
    // Assert: space persons in Space A are distinct from Space B
    // Assert: face counts are correct in both spaces
  });
});
```

### Test Group C: Dedup correctness

```typescript
describe('dedup scenarios', () => {
  it('should merge duplicate space persons with similar embeddings', async () => {
    // 1. Create space with 2 space persons that have similar representativeFace embeddings
    // 2. Run dedup
    // Assert: merged into 1 space person
    // Assert: all faces reassigned to survivor
    // Assert: orphan deleted
  });

  it('should NOT merge space persons with different embeddings', async () => {
    // 1. Create 2 space persons with dissimilar embeddings
    // 2. Run dedup
    // Assert: both still exist
  });

  it('should handle space persons without representativeFaceId in dedup', async () => {
    // 1. Create 3 space persons: 2 with embeddings, 1 without (null representativeFaceId)
    // 2. Run dedup
    // Assert: the 2 with embeddings participate in dedup
    // Assert: the 1 without embedding is untouched (not deleted, not merged)
  });

  it('should handle representativeFace with missing face_search entry', async () => {
    // getSpacePersonsWithEmbeddings uses INNER JOIN to face_search.
    // If face_search row is missing, the space person is silently excluded.
    // 1. Create 3 space persons with valid representativeFaceId
    // 2. Delete face_search row for SP3's representative face
    // 3. SP1 and SP2 have similar embeddings
    // 4. Run dedup
    // Assert: SP1 and SP2 merge (both have valid embeddings)
    // Assert: SP3 is untouched (excluded from dedup, NOT deleted)
  });

  it('should preserve the space person with more faces during merge', async () => {
    // 1. SP1 with 5 faces, SP2 with 2 faces, similar embeddings
    // 2. Run dedup
    // Assert: SP1 survives (more faces), SP2 deleted
    // Assert: SP1 now has 7 faces
  });

  it('should transfer name from source to target when target is unnamed', async () => {
    // 1. SP1 (unnamed, 5 faces), SP2 (named "Alice", 2 faces), similar embeddings
    // 2. Run dedup
    // Assert: SP1 survives (more faces), now named "Alice"
    // Assert: SP2 deleted
  });
});
```

### Test Group D: Recount accuracy

```typescript
describe('recount accuracy after pipeline operations', () => {
  it('should have correct counts after face matching', async () => {
    // 1. Asset with 3 visible faces assigned to same person
    // 2. Run face matching
    // Assert: space person faceCount=3, assetCount=1
  });

  it('should exclude invisible faces from counts', async () => {
    // 1. 2 visible faces + 1 invisible face on same asset
    // 2. Add all to space person, run recount
    // Assert: faceCount=2 (not 3), assetCount=1
  });

  it('should exclude trashed assets from counts', async () => {
    // 1. 2 faces on normal asset + 1 face on trashed asset
    // 2. Add all to space person, run recount
    // Assert: faceCount=2, assetCount=1
  });

  it('should count distinct assets not faces for assetCount', async () => {
    // 1. Asset A with 2 faces, Asset B with 1 face — all same person
    // 2. Run recount
    // Assert: faceCount=3, assetCount=2
  });

  it('should have accurate counts after incremental face matching', async () => {
    // Tests that recount is called correctly when faces are added in batches.
    // This catches the reporter's Issue #4 (incorrect counts per person).
    // 1. Create space person, add 3 faces, run recount
    // Assert: faceCount=3, assetCount=3
    // 2. Add 2 more faces to the SAME space person, run recount again
    // Assert: faceCount=5, assetCount=5 (not stale at 3)
  });

  it('should handle recount with zero faces gracefully', async () => {
    // After a force-detection reset, space persons may temporarily have
    // all their faces cascade-deleted.
    // 1. Create space person with 3 faces
    // 2. Delete all faces (simulate cascade)
    // 3. Run recount
    // Assert: faceCount=0, assetCount=0 (not error)
  });
});
```

### Test Group E: Filter/search with space persons

```typescript
describe('filtering by space person', () => {
  it('should return only assets containing the specified space person', async () => {
    // 1. 3 assets: A has person X, B has person Y, C has person X
    // 2. Filter by space person for X
    // Assert: returns assets A and C only
  });

  it('should not return assets where the face was soft-deleted', async () => {
    // 1. Asset with face assigned to space person, face is soft-deleted
    // 2. Filter by space person
    // Assert: asset not returned
  });

  it('should not return assets where the face is invisible', async () => {
    // 1. Asset with invisible face assigned to space person
    // 2. Filter by space person
    // Assert: asset not returned
  });

  it('should not return phantom photos after face reassignment (Issue #3)', async () => {
    // The reporter saw photos returned for a person that don't contain
    // that person's face. This tests that reassignPersonFacesSafe
    // properly removes the old mapping, not just adds a new one.
    // 1. Face F1 on Asset A, assigned to space person SP1
    // 2. Reassign F1 from SP1 to SP2 (via reassignPersonFacesSafe)
    // 3. Filter by SP1
    // Assert: Asset A is NOT returned (F1 no longer belongs to SP1)
    // 4. Filter by SP2
    // Assert: Asset A IS returned (F1 now belongs to SP2)
  });

  it('should not return phantom photos when face personId changes after space matching', async () => {
    // A more subtle phantom scenario: face was matched to space person SP1,
    // then global recognition re-clusters the face to a different global
    // person, but shared_space_person_face still links to SP1.
    // This tests that the filter query relies on shared_space_person_face
    // (which is the source of truth for space assignment), not on
    // asset_face.personId (which can change).
    // 1. Face F1 with personId=P1, matched to space person SP1
    // 2. Change F1's personId to P2 (simulate re-recognition)
    // 3. Filter by SP1
    // Assert: Asset still returned (shared_space_person_face links F1→SP1)
    // Note: This is the EXPECTED behavior — space person assignment is
    // independent of global person assignment. Phantom photos occur when
    // the user EXPECTS re-recognition to update space assignments, but
    // it doesn't. The fix for this would be re-running space face matching
    // after re-recognition, which Task 2 addresses.
  });
});
```

### Implementation Notes

- Each test group should be its own `describe` block
- Use the medium test context (`ctx.newUser()`, `ctx.newAsset()`, `ctx.newAssetFace()`, etc.)
- For face_search embeddings, use `newEmbedding()` from `test/small.factory`
- For "similar" embeddings (Layer 2/dedup tests), create embeddings that are close in vector space
- For processSpaceFaceMatch, call the service method directly if possible, or invoke the repository methods in sequence
- Mock only `JobRepository` (to verify job queueing), `StorageRepository`, and `MachineLearningRepository`
- Run with: `cd server && pnpm test:medium -- --run test/medium/specs/services/shared-space-face-matching.spec.ts`

### Step-by-step implementation

1. Create the test file with setup and Test Group A (visibility tests)
2. Run — expect failures on tests that hit the `thumbnailPath` filter
3. After Task 1 fix, these should pass
4. Add Test Group B (ordering scenarios) — these test `processSpaceFaceMatch` directly
5. Run and verify
6. Add Test Groups C, D, E
7. Run all and verify

### Commit

```bash
git add server/test/medium/specs/services/shared-space-face-matching.spec.ts
git commit -m "test(spaces): comprehensive medium tests for face matching pipeline

Tests cover: person visibility with missing thumbnails, face matching
under different ordering scenarios (library linked before/during/after
recognition), dedup correctness, recount accuracy, and space person
search filtering. All use real DB queries via medium test infrastructure."
```

---

## Task 5: Type check and lint

### Step 1: Run type check

```bash
cd server && npx tsc --noEmit
```

### Step 2: Fix any issues

### Step 3: Run all test suites

```bash
cd server && pnpm test -- --run src/services/person.service.spec.ts src/services/shared-space.service.spec.ts
cd server && pnpm test:medium -- --run test/medium/specs/repositories/shared-space.repository.spec.ts test/medium/specs/services/shared-space-face-matching.spec.ts
```

---

## Verification

After all tasks, use the running dev stack to verify:

1. Check DB: `SELECT count(*) FROM shared_space_person` — should match expected count
2. Check DB: `SELECT ssp.name, ssp."assetCount", p."thumbnailPath" FROM shared_space_person ssp LEFT JOIN asset_face af ON af.id = ssp."representativeFaceId" LEFT JOIN person p ON p.id = af."personId"` — persons with NULL thumbnailPath should now appear
3. Open Space ALL in browser — person count should match global person count (minus minFaces exclusions)
4. Test force-recognition reset and verify space persons rebuild
