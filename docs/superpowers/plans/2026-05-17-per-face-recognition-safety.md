# Per-Face Recognition Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add thorough Slice 4 coverage proving each `FacialRecognition` job state assigns, repairs, merges, defers, skips, and fans out shared-space work without destructive identity side effects.

**Architecture:** Keep most coverage in `PersonService` small tests because `handleRecognizeFaces()` is branch-heavy and already owns mocked repositories for each decision. Use DB-backed medium tests in `people-identity-rbac.spec.ts` only for destructive identity outcomes that mocks cannot prove: strict conflict guards on post-join uploads and repeated recognition idempotency. Make production changes only where a new red test exposes unsafe behavior, with the expected fixes limited to `server/src/services/person.service.ts`.

**Tech Stack:** TypeScript, NestJS service tests, Vitest, Gallery small test factories, Gallery medium DB test harness, Kysely, BullMQ job names.

---

## File Structure

- Modify: `server/src/services/person.service.spec.ts`
  - Owns small unit coverage for safe no-op/failure states, already-assigned identity repair, shared-space fanout suppression and dedupe, min-face threshold behavior, non-core deferral, archive/hidden safety, core-person creation, existing-person assignment, and accessible shared identity conflict guards.
- Modify only when a new failing test proves the current service is unsafe: `server/src/services/person.service.ts`
  - Owns the shared-space fanout helper, no-fanout-without-assignment guard, and any minimal recognition branch fix required by Slice 4 tests.
- Modify: `server/test/medium/specs/services/people-identity-rbac.spec.ts`
  - Owns DB-backed destructive tests for member private uploads after joining a space, strict conflict guards, and repeated recognition idempotency.
- Audit only: `server/test/medium/specs/services/person.service.spec.ts`
  - This file owns face-detection medium fixtures and does not currently include a `SearchRepository`-backed recognition setup. Keep Slice 4 medium identity coverage in `people-identity-rbac.spec.ts` unless implementation discovers an existing recognition fixture here.

## Execution Preflight

- [ ] **Step 1: Confirm the worktree is isolated and clean**

Run:

```bash
git rev-parse --show-toplevel
git branch --show-current
git status --short
```

Expected:

```text
/home/pierre/dev/gallery/.worktrees/face-trigger-slice-4-plan
codex/face-trigger-slice-4-plan
```

`git status --short` must be empty before implementation edits. If it lists files, inspect them and preserve user-owned work.

- [ ] **Step 2: Run the Slice 4 small-spec baseline**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter immich exec vitest --config test/vitest.config.mjs run src/services/person.service.spec.ts -t "handleRecognizeFaces"
```

Expected: all existing `handleRecognizeFaces` tests pass before new tests are added.

- [ ] **Step 3: Run the Slice 4 medium baseline**

Run:

```bash
pnpm --filter immich test:medium -- --run test/medium/specs/services/people-identity-rbac.spec.ts -t "post-join private upload|repeated recognition|strict"
```

Expected: matching existing medium tests pass before new DB-backed tests are added. If the selector finds no existing repeated-recognition test, Vitest should still run the matching post-join upload tests.

## TDD Protocol For This Slice

- [ ] **Step 1: Write the failing or coverage test first**

Add each test before editing `server/src/services/person.service.ts`. Coverage tests for existing behavior may pass immediately; destructive-safety fixes should start red.

- [ ] **Step 2: Run the smallest focused selector**

Use a specific `-t` selector for the new test name. Expected result is either a red failure proving an unsafe gap or a pass proving the behavior already exists.

- [ ] **Step 3: Make the smallest production fix**

Only edit `server/src/services/person.service.ts` when the new test fails for product behavior. Do not refactor detection, shared-space projection, backfill, or overnight queue coordination in this slice.

- [ ] **Step 4: Re-run the focused selector**

Expected: the focused test passes.

- [ ] **Step 5: Commit each completed task**

Use one commit per task:

```bash
git add server/src/services/person.service.spec.ts server/src/services/person.service.ts server/test/medium/specs/services/people-identity-rbac.spec.ts
git commit -m "test: cover per-face recognition safety"
```

Adjust the staged paths to the files touched by the task.

## Task 1: Safe Early Exits

**Files:**

- Modify: `server/src/services/person.service.spec.ts`

- [ ] **Step 1: Add a local no-mutation assertion helper**

In the first `describe('handleRecognizeFaces')` block near `server/src/services/person.service.spec.ts:2864`, add this helper immediately after the `beforeEach()` block:

```ts
const expectNoRecognitionMutation = () => {
  expect(mocks.search.searchFaces).not.toHaveBeenCalled();
  expect(mocks.person.create).not.toHaveBeenCalled();
  expect(mocks.person.reassignFaces).not.toHaveBeenCalled();
  expect(mocks.faceIdentity.ensurePersonIdentity).not.toHaveBeenCalled();
  expect(mocks.faceIdentity.replaceFaceIdentity).not.toHaveBeenCalled();
  expect(mocks.faceIdentity.getMergeConflicts).not.toHaveBeenCalled();
  expect(mocks.faceIdentity.mergeIdentities).not.toHaveBeenCalled();
  expect(mocks.sharedSpace.getSpaceIdsForAsset).not.toHaveBeenCalled();
  expect(mocks.job.queue).not.toHaveBeenCalled();
};
```

- [ ] **Step 2: Strengthen the missing face and missing asset tests**

Update the existing tests named `should fail if face does not exist` and `should fail if face does not have asset` to call the helper:

```ts
it('should fail if face does not exist', async () => {
  expect(await sut.handleRecognizeFaces({ id: 'unknown-face' })).toBe(JobStatus.Failed);

  expectNoRecognitionMutation();
});

it('should fail if face does not have asset', async () => {
  const face = AssetFaceFactory.create();
  mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(face, null));

  expect(await sut.handleRecognizeFaces({ id: face.id })).toBe(JobStatus.Failed);

  expectNoRecognitionMutation();
});
```

- [ ] **Step 3: Add safe source and missing-embedding tests to the same recognition block**

Add these tests immediately after the missing-asset test:

```ts
it('skips non-machine-learning faces without mutating identities or queues', async () => {
  const asset = AssetFactory.create();
  const face = AssetFaceFactory.create({ assetId: asset.id, sourceType: SourceType.Exif });
  mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(face, asset));

  expect(await sut.handleRecognizeFaces({ id: face.id })).toBe(JobStatus.Skipped);

  expectNoRecognitionMutation();
});

it('fails when a machine-learning face has no embedding without mutating identities or queues', async () => {
  const asset = AssetFactory.create();
  const face = AssetFaceFactory.create({ assetId: asset.id });
  mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue({
    ...face,
    asset,
    faceSearch: null,
  } as any);

  expect(await sut.handleRecognizeFaces({ id: face.id })).toBe(JobStatus.Failed);

  expectNoRecognitionMutation();
});
```

- [ ] **Step 4: Run the focused safe-exit tests**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter immich exec vitest --config test/vitest.config.mjs run src/services/person.service.spec.ts -t "face does not exist|face does not have asset|non-machine-learning faces|no embedding"
```

Expected: all selected tests pass. If `getMergeConflicts` is called during an early exit, the test should fail and the service must be fixed before continuing.

- [ ] **Step 5: Commit Task 1**

```bash
git add server/src/services/person.service.spec.ts
git commit -m "test: cover safe recognition early exits"
```

## Task 2: Shared-Space Fanout Is Suppressed Or Deduped

**Files:**

- Modify: `server/src/services/person.service.spec.ts`
- Modify when red: `server/src/services/person.service.ts`

- [ ] **Step 1: Add a red test for deduped fanout on already-assigned faces**

In the first `describe('handleRecognizeFaces')` block, add this test after `should queue space face matching even when face already has a person assigned`:

```ts
it('queues shared-space face matching exactly once per space after repairing an assigned face', async () => {
  const asset = AssetFactory.create();
  const face = AssetFaceFactory.from({ assetId: asset.id }).person().build();
  mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(face, asset));
  mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: 'identity-1' } as any);
  mocks.sharedSpace.getSpaceIdsForAsset.mockResolvedValue([
    { spaceId: 'space-1' },
    { spaceId: 'space-1' },
    { spaceId: 'space-2' },
  ]);

  expect(await sut.handleRecognizeFaces({ id: face.id })).toBe(JobStatus.Skipped);

  const sharedSpaceJobs = mocks.job.queue.mock.calls
    .map(([job]) => job)
    .filter((job) => job.name === JobName.SharedSpaceFaceMatch);
  expect(sharedSpaceJobs).toEqual([
    { name: JobName.SharedSpaceFaceMatch, data: { spaceId: 'space-1', assetId: face.assetId } },
    { name: JobName.SharedSpaceFaceMatch, data: { spaceId: 'space-2', assetId: face.assetId } },
  ]);
});
```

- [ ] **Step 2: Add a red test for deduped fanout after successful incremental assignment**

Add this test after `should queue SharedSpaceFaceMatch for spaces containing the asset`:

```ts
it('queues one SharedSpaceFaceMatch job per unique space after assigning a face', async () => {
  const asset = AssetFactory.create();
  const [noPerson, primaryFace] = [
    AssetFaceFactory.create({ assetId: asset.id }),
    AssetFaceFactory.from().person().build(),
  ];
  const faces = [
    { ...noPerson, distance: 0 },
    { ...primaryFace, distance: 0.2 },
  ] as FaceSearchResult[];

  mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { facialRecognition: { minFaces: 1 } } });
  mocks.search.searchFaces.mockResolvedValue(faces);
  mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(noPerson, asset));
  mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: 'identity-1' } as any);
  mocks.sharedSpace.getSpaceIdsForAsset.mockResolvedValue([
    { spaceId: 'space-1' },
    { spaceId: 'space-2' },
    { spaceId: 'space-1' },
  ]);

  expect(await sut.handleRecognizeFaces({ id: noPerson.id })).toBe(JobStatus.Success);

  const sharedSpaceJobs = mocks.job.queue.mock.calls
    .map(([job]) => job)
    .filter((job) => job.name === JobName.SharedSpaceFaceMatch);
  expect(sharedSpaceJobs).toEqual([
    { name: JobName.SharedSpaceFaceMatch, data: { spaceId: 'space-1', assetId: noPerson.assetId } },
    { name: JobName.SharedSpaceFaceMatch, data: { spaceId: 'space-2', assetId: noPerson.assetId } },
  ]);
});
```

- [ ] **Step 3: Run the focused fanout tests and confirm they fail before the helper**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter immich exec vitest --config test/vitest.config.mjs run src/services/person.service.spec.ts -t "exactly once per space|per unique space"
```

Expected before implementation: FAIL because the service queues duplicate `SharedSpaceFaceMatch` jobs when the repository returns duplicate `spaceId` rows.

- [ ] **Step 4: Add a deduping fanout helper**

In `server/src/services/person.service.ts`, add this private helper after `handleRecognizeFaces()` and before `replaceFaceIdentity()`:

```ts
  private async queueSharedSpaceFaceMatchesForAsset(assetId: string): Promise<void> {
    const spaceIds = await this.sharedSpaceRepository.getSpaceIdsForAsset(assetId);
    const queuedSpaceIds = new Set<string>();
    for (const { spaceId } of spaceIds) {
      if (queuedSpaceIds.has(spaceId)) {
        continue;
      }
      queuedSpaceIds.add(spaceId);
      await this.jobRepository.queue({
        name: JobName.SharedSpaceFaceMatch,
        data: { spaceId, assetId },
      });
    }
  }
```

- [ ] **Step 5: Replace both raw shared-space fanout loops**

In the already-assigned branch, replace the loop at `server/src/services/person.service.ts:942-950` with:

```ts
// Still queue space face matching because this face may belong to a space
// that was created or linked after the face was originally recognized.
await this.queueSharedSpaceFaceMatchesForAsset(face.assetId);
```

Near the end of `handleRecognizeFaces()`, replace the loop at `server/src/services/person.service.ts:1044-1051` with:

```ts
await this.queueSharedSpaceFaceMatchesForAsset(face.assetId);
```

- [ ] **Step 6: Re-run the fanout tests**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter immich exec vitest --config test/vitest.config.mjs run src/services/person.service.spec.ts -t "exactly once per space|per unique space|skipSharedSpaceMatch|force jobs"
```

Expected: PASS. Existing `skipSharedSpaceMatch` tests must still prove `getSpaceIdsForAsset()` is not called when suppression is set.

- [ ] **Step 7: Commit Task 2**

```bash
git add server/src/services/person.service.spec.ts server/src/services/person.service.ts
git commit -m "test: dedupe recognition shared-space fanout"
```

## Task 3: Assignment Paths Link Identity And Avoid Spurious Work

**Files:**

- Modify: `server/src/services/person.service.spec.ts`

- [ ] **Step 1: Add an explicit min-face self-only threshold test**

In the first `describe('handleRecognizeFaces')` block, add this test after `should not queue face with no matches`:

```ts
it('skips self-only matches below the min-face threshold without deferring or assigning', async () => {
  const asset = AssetFactory.create();
  const face = AssetFaceFactory.create({ assetId: asset.id });

  mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { facialRecognition: { minFaces: 3 } } });
  mocks.search.searchFaces.mockResolvedValue([{ ...face, distance: 0 }] as FaceSearchResult[]);
  mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(face, asset));

  expect(await sut.handleRecognizeFaces({ id: face.id })).toBe(JobStatus.Skipped);

  expect(mocks.search.searchFaces).toHaveBeenCalledTimes(1);
  expect(mocks.person.create).not.toHaveBeenCalled();
  expect(mocks.person.reassignFaces).not.toHaveBeenCalled();
  expect(mocks.job.queue).not.toHaveBeenCalled();
  expect(mocks.sharedSpace.getSpaceIdsForAsset).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Strengthen the core-person creation test**

Update the existing test named `should create a new person if the face is a core point with no person` to include thumbnail and identity-link assertions:

```ts
it('should create a new person if the face is a core point with no person', async () => {
  const asset = AssetFactory.create();
  const [noPerson1, noPerson2] = [AssetFaceFactory.create({ assetId: asset.id }), AssetFaceFactory.create()];
  const person = PersonFactory.create({ ownerId: asset.ownerId });
  const sourceIdentityId = 'created-person-identity';

  const faces = [
    { ...noPerson1, distance: 0 },
    { ...noPerson2, distance: 0.3 },
  ] as FaceSearchResult[];

  mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { facialRecognition: { minFaces: 1 } } });
  mocks.search.searchFaces.mockResolvedValueOnce(faces).mockResolvedValueOnce([]);
  mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(noPerson1, asset));
  mocks.person.create.mockResolvedValue(person);
  mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: sourceIdentityId } as any);

  expect(await sut.handleRecognizeFaces({ id: noPerson1.id })).toBe(JobStatus.Success);

  expect(mocks.person.create).toHaveBeenCalledWith({
    ownerId: asset.ownerId,
    faceAssetId: noPerson1.id,
  });
  expect(mocks.job.queue).toHaveBeenCalledWith({
    name: JobName.PersonGenerateThumbnail,
    data: { id: person.id },
  });
  expect(mocks.person.reassignFaces).toHaveBeenCalledWith({
    faceIds: [noPerson1.id],
    newPersonId: person.id,
  });
  expect(mocks.faceIdentity.ensurePersonIdentity).toHaveBeenCalledWith(person.id);
  expect(mocks.faceIdentity.replaceFaceIdentity).toHaveBeenCalledWith({
    assetFaceId: noPerson1.id,
    identityId: sourceIdentityId,
    source: 'owner-person',
  });
});
```

- [ ] **Step 3: Add an existing-person no-thumbnail assertion**

Add this test after `should link identity after recognition assigns an existing person`:

```ts
it('assigns an existing person without creating a person or thumbnail job', async () => {
  const asset = AssetFactory.create();
  const [noPerson, matchedFace] = [
    AssetFaceFactory.create({ assetId: asset.id }),
    AssetFaceFactory.from().person().build(),
  ];
  const faces = [
    { ...noPerson, distance: 0 },
    { ...matchedFace, distance: 0.2 },
  ] as FaceSearchResult[];

  mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { facialRecognition: { minFaces: 1 } } });
  mocks.search.searchFaces.mockResolvedValue(faces);
  mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(noPerson, asset));
  mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: 'matched-identity' } as any);

  expect(await sut.handleRecognizeFaces({ id: noPerson.id })).toBe(JobStatus.Success);

  expect(mocks.person.create).not.toHaveBeenCalled();
  expect(mocks.job.queue).not.toHaveBeenCalledWith(expect.objectContaining({ name: JobName.PersonGenerateThumbnail }));
  expect(mocks.person.reassignFaces).toHaveBeenCalledWith({
    faceIds: [noPerson.id],
    newPersonId: matchedFace.person!.id,
  });
  expect(mocks.faceIdentity.replaceFaceIdentity).toHaveBeenCalledWith({
    assetFaceId: noPerson.id,
    identityId: 'matched-identity',
    source: 'owner-person',
  });
});
```

- [ ] **Step 4: Run focused assignment-path tests**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter immich exec vitest --config test/vitest.config.mjs run src/services/person.service.spec.ts -t "self-only matches|core point|existing person without creating"
```

Expected: PASS. A failure here means the service is creating people, thumbnails, or assignments in a branch that should be inert.

- [ ] **Step 5: Commit Task 3**

```bash
git add server/src/services/person.service.spec.ts
git commit -m "test: cover recognition assignment paths"
```

## Task 4: Non-Core, Archive, And Hidden Faces Never Fan Out Without Assignment

**Files:**

- Modify: `server/src/services/person.service.spec.ts`
- Modify when red: `server/src/services/person.service.ts`

- [ ] **Step 1: Add a red archive/hidden deferred test**

In the first `describe('handleRecognizeFaces')` block, add this test after `should not assign person to deferred non-core face with no matching person`:

```ts
it.each([AssetVisibility.Archive, AssetVisibility.Hidden, AssetVisibility.Locked])(
  'does not create a core person or queue shared-space matching for deferred %s assets without a person',
  async (visibility) => {
    const asset = AssetFactory.create({ visibility });
    const face = AssetFaceFactory.create({ assetId: asset.id });

    mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { facialRecognition: { minFaces: 1 } } });
    mocks.search.searchFaces
      .mockResolvedValueOnce([{ ...face, distance: 0 }] as FaceSearchResult[])
      .mockResolvedValueOnce([]);
    mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(face, asset));
    (mocks.faceIdentity as any).findClosestAccessibleIdentityForFace.mockResolvedValue({
      identityId: 'accessible-space-identity',
      distance: 0.2,
    });
    mocks.sharedSpace.getSpaceIdsForAsset.mockResolvedValue([{ spaceId: 'space-1' }]);

    expect(await sut.handleRecognizeFaces({ id: face.id, deferred: true })).toBe(JobStatus.Skipped);

    expect(mocks.person.create).not.toHaveBeenCalled();
    expect(mocks.person.reassignFaces).not.toHaveBeenCalled();
    expect(mocks.faceIdentity.ensurePersonIdentity).not.toHaveBeenCalled();
    expect(mocks.faceIdentity.replaceFaceIdentity).not.toHaveBeenCalled();
    expect(mocks.faceIdentity.mergeIdentities).not.toHaveBeenCalled();
    expect(mocks.sharedSpace.getSpaceIdsForAsset).not.toHaveBeenCalled();
    expect(mocks.job.queue).not.toHaveBeenCalledWith(expect.objectContaining({ name: JobName.SharedSpaceFaceMatch }));
  },
);
```

- [ ] **Step 2: Run the focused archive/hidden test and confirm it fails before the guard**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter immich exec vitest --config test/vitest.config.mjs run src/services/person.service.spec.ts -t "deferred .* assets without a person"
```

Expected before implementation: FAIL if the current service returns `Success`, queries spaces, or queues `SharedSpaceFaceMatch` after a deferred archive/hidden face resolves to no person.

- [ ] **Step 3: Add the no-person no-fanout guard**

In `server/src/services/person.service.ts`, after the `if (personId) { ... }` assignment block and before `if (skipSharedSpaceMatch)`, add:

```ts
if (!personId) {
  this.logger.debug(`Face ${id} did not resolve to a person, skipping shared-space face matching`);
  return JobStatus.Skipped;
}
```

The final branch order must be:

```ts
if (personId) {
  this.logger.debug(`Assigning face ${id} to person ${personId}`);
  await this.personRepository.reassignFaces({ faceIds: [id], newPersonId: personId });
  const sourceIdentityId = await this.replaceFaceIdentity(personId, id, 'owner-person');
  await this.mergeWithAccessibleSharedIdentity({
    userId: face.asset.ownerId,
    embedding: face.faceSearch.embedding,
    maxDistance: machineLearning.facialRecognition.maxDistance,
    sourceIdentityId,
    match: personId === createdPersonId ? accessibleIdentityMatch : undefined,
  });
}

if (!personId) {
  this.logger.debug(`Face ${id} did not resolve to a person, skipping shared-space face matching`);
  return JobStatus.Skipped;
}

if (skipSharedSpaceMatch) {
  return JobStatus.Success;
}

await this.queueSharedSpaceFaceMatchesForAsset(face.assetId);

return JobStatus.Success;
```

- [ ] **Step 4: Re-run non-core/deferred recognition tests**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter immich exec vitest --config test/vitest.config.mjs run src/services/person.service.spec.ts -t "deferred .* assets without a person|defer non-core|deferred non-core|skipSharedSpaceMatch"
```

Expected: PASS. Existing deferred tests must still prove one deferral, `skipSharedSpaceMatch` preservation, and assignment to an existing person when evidence exists.

- [ ] **Step 5: Commit Task 4**

```bash
git add server/src/services/person.service.spec.ts server/src/services/person.service.ts
git commit -m "test: block recognition fanout without assignment"
```

## Task 5: Accessible Shared Identity Merge Guards

**Files:**

- Modify: `server/src/services/person.service.spec.ts`

- [ ] **Step 1: Add same-space conflict coverage**

In the first `describe('handleRecognizeFaces')` block, add this test after `skips accessible shared identity merge when same-owner personal conflicts exist`:

```ts
it('skips accessible shared identity merge when same-space conflicts exist', async () => {
  const asset = AssetFactory.create();
  const [noPerson, matchedFace] = [
    AssetFaceFactory.create({ assetId: asset.id }),
    AssetFaceFactory.from().person().build(),
  ];
  const faces = [
    { ...noPerson, distance: 0 },
    { ...matchedFace, distance: 0.2 },
  ] as FaceSearchResult[];
  const sourceIdentityId = 'source-identity';
  const targetIdentityId = 'target-identity';

  mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { facialRecognition: { minFaces: 1 } } });
  mocks.search.searchFaces.mockResolvedValue(faces);
  mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(noPerson, asset));
  mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: sourceIdentityId } as any);
  (mocks.faceIdentity as any).findClosestAccessibleIdentityForFace.mockResolvedValue({
    identityId: targetIdentityId,
    distance: 0.2,
  });
  mocks.faceIdentity.getMergeConflicts.mockResolvedValue({
    personalProfileConflictCount: 0,
    spaceProfileConflictCount: 1,
  });

  expect(await sut.handleRecognizeFaces({ id: noPerson.id })).toBe(JobStatus.Success);

  expect(mocks.faceIdentity.getMergeConflicts).toHaveBeenCalledWith({
    targetIdentityId,
    sourceIdentityIds: [sourceIdentityId],
  });
  expect(mocks.faceIdentity.mergeIdentities).not.toHaveBeenCalled();
  expect(mocks.job.queue).not.toHaveBeenCalledWith(
    expect.objectContaining({ name: JobName.SharedSpacePersonMetadataBackfill }),
  );
});
```

- [ ] **Step 2: Add same-identity no-conflict-query coverage**

Add this test immediately after the same-space conflict test:

```ts
it('does not run conflict checks when accessible shared evidence already points at the source identity', async () => {
  const asset = AssetFactory.create();
  const [noPerson, matchedFace] = [
    AssetFaceFactory.create({ assetId: asset.id }),
    AssetFaceFactory.from().person().build(),
  ];
  const faces = [
    { ...noPerson, distance: 0 },
    { ...matchedFace, distance: 0.2 },
  ] as FaceSearchResult[];
  const sourceIdentityId = 'source-identity';

  mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { facialRecognition: { minFaces: 1 } } });
  mocks.search.searchFaces.mockResolvedValue(faces);
  mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(noPerson, asset));
  mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: sourceIdentityId } as any);
  (mocks.faceIdentity as any).findClosestAccessibleIdentityForFace.mockResolvedValue({
    identityId: sourceIdentityId,
    distance: 0.1,
  });

  expect(await sut.handleRecognizeFaces({ id: noPerson.id })).toBe(JobStatus.Success);

  expect(mocks.faceIdentity.getMergeConflicts).not.toHaveBeenCalled();
  expect(mocks.faceIdentity.mergeIdentities).not.toHaveBeenCalled();
  expect(mocks.job.queue).not.toHaveBeenCalledWith(
    expect.objectContaining({ name: JobName.SharedSpacePersonMetadataBackfill }),
  );
});
```

- [ ] **Step 3: Run focused merge-guard tests**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter immich exec vitest --config test/vitest.config.mjs run src/services/person.service.spec.ts -t "accessible shared identity merge|same-space conflicts|same-owner personal conflicts|already points at the source identity"
```

Expected: PASS. If same-space conflict still merges identities or queues metadata backfill, fix `mergeWithAccessibleSharedIdentity()` before continuing.

- [ ] **Step 4: Commit Task 5**

```bash
git add server/src/services/person.service.spec.ts
git commit -m "test: cover recognition shared identity merge guards"
```

## Task 6: Medium Destructive Identity Tests

**Files:**

- Modify: `server/test/medium/specs/services/people-identity-rbac.spec.ts`

- [ ] **Step 1: Strengthen the existing post-join private upload pass case**

In the existing test named `links a post-join private upload to a linked-library space identity and preserves owned access after leave`, add this assertion after `uploadedPerson` is loaded:

```ts
const targetIdentity = await fx.faceIdentityRepository.ensurePersonIdentity(fx.face.person.id);
expect(uploadedPerson.identityId).toBe(targetIdentity.id);
```

Expected behavior: a member private upload merges into accessible shared evidence only when the repository conflict guards allow the merge.

- [ ] **Step 2: Add a strict personal-conflict blocked medium test**

Add this test immediately after the strengthened pass case:

```ts
it('does not merge a post-join private upload when strict personal conflict guards fail', async () => {
  const fx = await createLinkedLibraryIdentityFixture({ personName: 'Library Source' });
  const embeddingRow = await fx.ctx.database
    .selectFrom('face_search')
    .select('embedding')
    .where('faceId', '=', fx.face.faceId)
    .executeTakeFirstOrThrow();
  const targetIdentity = await fx.faceIdentityRepository.ensurePersonIdentity(fx.face.person.id);

  const { result: memberConflictPerson } = await fx.ctx.newPerson({
    ownerId: fx.member.id,
    name: 'Member Existing Profile',
  });
  const memberConflictIdentity = await fx.faceIdentityRepository.ensurePersonIdentity(memberConflictPerson.id);
  await fx.faceIdentityRepository.mergeIdentities({
    targetIdentityId: targetIdentity.id,
    sourceIdentityIds: [memberConflictIdentity.id],
    source: 'manual',
  });

  const { asset } = await fx.ctx.newAsset({ ownerId: fx.member.id, visibility: AssetVisibility.Timeline });
  const { result: uploadedFaceId } = await fx.ctx.newAssetFace({ assetId: asset.id });
  await fx.ctx.database
    .insertInto('face_search')
    .values({ faceId: uploadedFaceId, embedding: embeddingRow.embedding })
    .execute();

  await fx.personService.handleRecognizeFaces({ id: uploadedFaceId });

  const uploadedPerson = await fx.ctx.database
    .selectFrom('asset_face')
    .innerJoin('person', 'person.id', 'asset_face.personId')
    .select(['person.id', 'person.identityId'])
    .where('asset_face.id', '=', uploadedFaceId)
    .executeTakeFirstOrThrow();
  const uploadedLinks = await fx.ctx.database
    .selectFrom('face_identity_face')
    .select(['assetFaceId', 'identityId', 'source'])
    .where('assetFaceId', '=', uploadedFaceId)
    .execute();
  const targetProfiles = await fx.ctx.database
    .selectFrom('person')
    .select(['id', 'ownerId', 'identityId'])
    .where('identityId', '=', targetIdentity.id)
    .orderBy('id')
    .execute();

  expect(uploadedPerson.id).not.toBe(memberConflictPerson.id);
  expect(uploadedPerson.identityId).not.toBe(targetIdentity.id);
  expect(uploadedLinks).toEqual([
    { assetFaceId: uploadedFaceId, identityId: uploadedPerson.identityId, source: 'owner-person' },
  ]);
  expect(targetProfiles).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: memberConflictPerson.id, ownerId: fx.member.id, identityId: targetIdentity.id }),
    ]),
  );
  expect(targetProfiles.map((profile) => profile.id)).not.toContain(uploadedPerson.id);
});
```

This test exercises the repository-side strict guard that prevents an accessible shared identity from being offered to a new private upload when that target identity already has a profile for the uploader. It complements the small Task 5 mocked conflict tests, which directly prove `getMergeConflicts()` blocks automatic merges when a same-owner or same-space conflict is reported after a candidate match is found.

- [ ] **Step 3: Add repeated-recognition idempotency medium coverage**

Add this test immediately after the strict personal-conflict test:

```ts
it('repeated recognition of an already assigned face preserves one person and one identity link', async () => {
  const fx = await createLinkedLibraryIdentityFixture({ personName: 'Library Source' });
  const embeddingRow = await fx.ctx.database
    .selectFrom('face_search')
    .select('embedding')
    .where('faceId', '=', fx.face.faceId)
    .executeTakeFirstOrThrow();

  const { asset } = await fx.ctx.newAsset({ ownerId: fx.member.id, visibility: AssetVisibility.Timeline });
  const { result: uploadedFaceId } = await fx.ctx.newAssetFace({ assetId: asset.id });
  await fx.ctx.database
    .insertInto('face_search')
    .values({ faceId: uploadedFaceId, embedding: embeddingRow.embedding })
    .execute();

  const readState = async () => {
    const assignedPerson = await fx.ctx.database
      .selectFrom('asset_face')
      .innerJoin('person', 'person.id', 'asset_face.personId')
      .select(['person.id as personId', 'person.identityId as identityId'])
      .where('asset_face.id', '=', uploadedFaceId)
      .executeTakeFirstOrThrow();
    const memberPeople = await fx.ctx.database
      .selectFrom('person')
      .select(['id', 'identityId'])
      .where('ownerId', '=', fx.member.id)
      .orderBy('id')
      .execute();
    const faceLinks = await fx.ctx.database
      .selectFrom('face_identity_face')
      .select(['assetFaceId', 'identityId', 'source'])
      .where('assetFaceId', '=', uploadedFaceId)
      .orderBy('assetFaceId')
      .execute();

    return { assignedPerson, memberPeople, faceLinks };
  };

  await fx.personService.handleRecognizeFaces({ id: uploadedFaceId });

  await fx.personService.handleRecognizeFaces({ id: uploadedFaceId });
  const assignedState = await readState();

  await fx.personService.handleRecognizeFaces({ id: uploadedFaceId });
  const repeatedState = await readState();

  expect(repeatedState).toEqual(assignedState);
  expect(repeatedState.memberPeople).toHaveLength(1);
  expect(repeatedState.faceLinks).toEqual([
    {
      assetFaceId: uploadedFaceId,
      identityId: repeatedState.assignedPerson.identityId,
      source: 'owner-person',
    },
  ]);
});
```

- [ ] **Step 4: Run focused medium destructive tests**

Run:

```bash
pnpm --filter immich test:medium -- --run test/medium/specs/services/people-identity-rbac.spec.ts -t "post-join private upload|strict personal conflict|repeated recognition"
```

Expected: PASS. The strict personal-conflict test must leave the uploaded person's identity separate from the accessible shared target. The repeated-recognition test must prove one member person row and one `face_identity_face` row for the uploaded face after multiple runs.

- [ ] **Step 5: Commit Task 6**

```bash
git add server/test/medium/specs/services/people-identity-rbac.spec.ts
git commit -m "test: cover recognition destructive identity cases"
```

## Task 7: Full Slice Verification

**Files:**

- Verify all modified files.

- [ ] **Step 1: Run the full small recognition spec**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter immich exec vitest --config test/vitest.config.mjs run src/services/person.service.spec.ts -t "handleRecognizeFaces"
```

Expected: all `handleRecognizeFaces` tests pass.

- [ ] **Step 2: Run the full people identity RBAC medium spec**

Run:

```bash
pnpm --filter immich test:medium -- --run test/medium/specs/services/people-identity-rbac.spec.ts
```

Expected: the full medium spec passes. If the local database or testcontainers environment blocks this run, capture the exact environment error and still run the focused medium selector from Task 6.

- [ ] **Step 3: Run formatting on touched files**

Run:

```bash
pnpm --dir server exec prettier --check src/services/person.service.ts src/services/person.service.spec.ts test/medium/specs/services/people-identity-rbac.spec.ts
```

Expected: Prettier reports all files are formatted.

- [ ] **Step 4: Run typecheck if production code changed**

Run when `server/src/services/person.service.ts` changed:

```bash
pnpm --dir server check
```

Expected: TypeScript check passes.

- [ ] **Step 5: Inspect final diff**

Run:

```bash
git diff --stat @{upstream}...HEAD
git diff @{upstream}...HEAD -- server/src/services/person.service.ts server/src/services/person.service.spec.ts server/test/medium/specs/services/people-identity-rbac.spec.ts
```

Expected: diff contains only Slice 4 recognition safety tests and the minimal service helper/guard required by those tests.

- [ ] **Step 6: Commit final verification metadata if needed**

If formatting changes files after earlier commits, commit them:

```bash
git add server/src/services/person.service.ts server/src/services/person.service.spec.ts server/test/medium/specs/services/people-identity-rbac.spec.ts
git commit -m "chore: format recognition safety tests"
```

If there are no formatting changes, do not create an empty commit.

## Spec Coverage Checklist

- [ ] Missing face and missing asset fail safely: Task 1.
- [ ] Non-ML source skips safely: Task 1.
- [ ] Missing embedding fails safely: Task 1.
- [ ] Already assigned face repairs identity and queues shared-space matches unless `skipSharedSpaceMatch` is set: Tasks 2 and existing strengthened tests.
- [ ] Min-face threshold skips self-only matches: Task 3.
- [ ] Non-core faces defer once and preserve `skipSharedSpaceMatch`: Task 4 re-runs existing deferred coverage and protects it from regressions.
- [ ] Deferred non-core face can still attach to an existing person when evidence exists: Task 4 re-runs existing focused coverage.
- [ ] Core face creates a person, queues thumbnail generation, reassigns face, and links owner identity: Task 3.
- [ ] Existing person match reassigns without creating a person: Task 3.
- [ ] Accessible shared identity match can merge only after conflict checks pass: Tasks 5 and 6.
- [ ] Same-owner and same-space conflicts prevent automatic identity merge: Tasks 5 and 6.
- [ ] Archive, hidden, or locked visibility does not create core people unexpectedly: Task 4.
- [ ] Spaces for the asset queue `SharedSpaceFaceMatch` exactly once per space for successful incremental recognition: Task 2.
- [ ] Member private upload after joining a space merges with accessible shared evidence only when strict conflict guards pass: Task 6.
- [ ] Repeated recognition of already assigned faces does not create duplicate people or duplicate identity links: Task 6.

## Explicit Out Of Scope

- Shared-space projection behavior inside `handleSharedSpaceFaceMatch*` belongs to Slice 5.
- Full overnight chain composition, including issue #597 end-to-end scheduled recovery, belongs to Slice 8.
- Face detection matching, stale ML-face deletion, and scaled detection matching belong to Slice 2.
- Force recognition reset ordering and stuck queue behavior belong to Slice 3.

## Self-Review Notes

- Spec coverage: every Slice 4 bullet maps to a task in the checklist above.
- Placeholder scan: this plan contains concrete file paths, test snippets, implementation snippets, commands, expected results, and commit commands.
- Type consistency: snippets use existing imports and names from the current codebase: `AssetVisibility.Archive`, `AssetVisibility.Hidden`, `JobName.SharedSpaceFaceMatch`, `JobName.PersonGenerateThumbnail`, `JobName.SharedSpacePersonMetadataBackfill`, `SourceType.Exif`, `FaceSearchResult`, `getForFacialRecognitionJob`, `createLinkedLibraryIdentityFixture`, and `newEmbedding` fixtures already present in the target specs.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-17-per-face-recognition-safety.md`. Two execution options:

**1. Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, and keep implementation commits small.

**2. Inline Execution** - execute tasks in this session using `superpowers:executing-plans`, with checkpoints after each task.
