# Face Identity Trigger Contract Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add focused small-service tests proving every Slice 1 face identity trigger queues the expected jobs, queues nothing when disabled or unauthorized, and never turns scheduled overnight work into destructive face identity work.

**Architecture:** This slice is test-only unless a trigger contract test exposes a real bug. Keep coverage in the service spec that owns each trigger, assert exact job names and job data, and avoid medium DB tests. Issue #597 is represented here only as scheduled-trigger coverage: nightly `clusterNewFaces` must queue non-force recognition, and scheduled missing-thumbnail/library-scan roots must not directly queue destructive face work.

**Tech Stack:** TypeScript, NestJS service unit tests, Vitest, Gallery small test mocks, BullMQ job names.

---

## File Structure

- Modify: `server/src/services/queue.service.spec.ts`
  - Owns admin queue starts, nightly task fan-out, and issue #597 scheduled recognition trigger contracts.
- Modify: `server/src/services/job.service.spec.ts`
  - Owns thumbnail-completion follow-up jobs and manual job endpoint contracts.
- Modify: `server/src/services/asset.service.spec.ts`
  - Owns user-triggered asset job contracts such as `AssetJobName.REFRESH_FACES`.
- Modify: `server/src/services/library.service.spec.ts`
  - Owns scheduled external library scan roots and linked-library sync trigger contracts.
- Modify: `server/src/services/metadata.service.spec.ts`
  - Owns EXIF face import queue contracts.
- Modify: `server/src/services/shared-space.service.spec.ts`
  - Owns shared-space member, asset, bulk-add, delete, link, and unlink trigger contracts.
- Modify: `server/src/services/duplicate.service.spec.ts`
  - Owns duplicate-resolution keeper propagation and retryable queue-failure trigger contracts.
- Modify: `server/src/services/pet-detection.service.spec.ts`
  - Owns pet detection queue-root and per-asset trigger contracts.

## Execution Preflight

- [ ] **Step 1: Confirm the implementation worktree is isolated and clean**

Run:

```bash
git rev-parse --show-toplevel
git branch --show-current
git status --short
```

Expected:

```text
/home/pierre/dev/gallery/.worktrees/face-queues-test-plan
codex/face-queues-test-plan
```

`git status --short` should be empty before editing server tests. If it is not empty, inspect every listed file and preserve user-owned work.

- [ ] **Step 2: Run the Slice 1 baseline suite**

Run:

```bash
pnpm --filter immich test -- --run src/services/job.service.spec.ts src/services/queue.service.spec.ts src/services/asset.service.spec.ts src/services/library.service.spec.ts src/services/metadata.service.spec.ts src/services/duplicate.service.spec.ts src/services/shared-space.service.spec.ts src/services/pet-detection.service.spec.ts
```

Expected: all targeted specs pass before new tests are added. If a pre-existing failure appears, stop and investigate before adding coverage.

## Task 1: QueueService Scheduled And Admin Triggers

**Files:**

- Modify: `server/src/services/queue.service.spec.ts`

- [ ] **Step 1: Add explicit nightly recognition contract coverage**

In `describe('handleNightlyJobs')`, add:

```ts
it('should queue nightly face clustering as non-force recognition only', async () => {
  await sut.handleNightlyJobs();

  const jobs = mocks.job.queueAll.mock.calls[0][0];
  expect(jobs).toContainEqual({
    name: JobName.FacialRecognitionQueueAll,
    data: { force: false, nightly: true },
  });
  expect(jobs).not.toContainEqual(expect.objectContaining({ name: JobName.AssetDetectFacesQueueAll }));
  expect(jobs).not.toContainEqual(
    expect.objectContaining({
      name: JobName.FacialRecognitionQueueAll,
      data: expect.objectContaining({ force: true }),
    }),
  );
});
```

This pins the Slice 1 part of issue #597: the scheduled trigger must not request a forced recognition wipe.

- [ ] **Step 2: Add explicit missing-thumbnail scheduled root coverage**

In the same `describe('handleNightlyJobs')`, add:

```ts
it('should queue missing thumbnails without direct face detection work', async () => {
  await sut.handleNightlyJobs();

  const jobs = mocks.job.queueAll.mock.calls[0][0];
  expect(jobs).toContainEqual({
    name: JobName.AssetGenerateThumbnailsQueueAll,
    data: { force: false },
  });
  expect(jobs).not.toContainEqual(expect.objectContaining({ name: JobName.AssetDetectFacesQueueAll }));
});
```

- [ ] **Step 3: Add table-driven admin face queue start coverage**

In `describe('handleCommand')`, add:

```ts
it.each([
  [QueueName.FaceDetection, false, { name: JobName.AssetDetectFacesQueueAll, data: { force: false } }],
  [QueueName.FaceDetection, true, { name: JobName.AssetDetectFacesQueueAll, data: { force: true } }],
  [QueueName.FacialRecognition, false, { name: JobName.FacialRecognitionQueueAll, data: { force: false } }],
  [QueueName.FacialRecognition, true, { name: JobName.FacialRecognitionQueueAll, data: { force: true } }],
  [QueueName.PeopleBackfill, false, { name: JobName.FaceIdentityBackfill, data: {} }],
] as const)('should queue %s start with force=%s as the expected face identity root', async (queueName, force, expected) => {
  mocks.job.isActive.mockResolvedValue(false);
  mocks.job.getJobCounts.mockResolvedValue(factory.queueStatistics());

  await sut.runCommandLegacy(queueName, { command: QueueCommand.Start, force });

  expect(mocks.job.queue).toHaveBeenCalledWith(expected);
});
```

- [ ] **Step 4: Run QueueService tests**

Run:

```bash
pnpm --filter immich test -- --run src/services/queue.service.spec.ts
```

Expected: PASS. If a new test fails, fix only the trigger contract that failed.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add server/src/services/queue.service.spec.ts
git commit -m "test: cover scheduled face queue triggers"
```

## Task 2: JobService And AssetService Manual Entry Points

**Files:**

- Modify: `server/src/services/job.service.spec.ts`
- Modify: `server/src/services/asset.service.spec.ts`

- [ ] **Step 1: Add generated-thumbnail no-op coverage for scheduled thumbnail roots**

In `server/src/services/job.service.spec.ts`, inside `describe('onDone - AssetGenerateThumbnails')`, add:

```ts
it('should not queue face detection for generated thumbnail jobs without upload or notify markers', async () => {
  mocks.job.run.mockResolvedValue(JobStatus.Success);
  const id = newUuid();

  await sut.onJobRun(QueueName.ThumbnailGeneration, {
    name: JobName.AssetGenerateThumbnails,
    data: { id },
  });

  expect(mocks.asset.getByIdsWithAllRelationsButStacks).not.toHaveBeenCalled();
  expect(mocks.job.queueAll).not.toHaveBeenCalled();
  expect(mocks.job.queue).not.toHaveBeenCalledWith(expect.objectContaining({ name: JobName.AssetDetectFaces }));
});
```

- [ ] **Step 2: Add manual identity job side-effect coverage**

In `server/src/services/job.service.spec.ts`, inside `describe('create')`, add:

```ts
it.each([
  [ManualJobName.FaceIdentityBackfill, { name: JobName.FaceIdentityBackfill, data: {} }],
  [ManualJobName.SharedSpacePersonMetadataBackfill, { name: JobName.SharedSpacePersonMetadataBackfill, data: {} }],
  [ManualJobName.PersonCleanup, { name: JobName.PersonCleanup }],
] as const)('should queue only the manual %s root job', async (manualName, expected) => {
  await sut.create({ name: manualName });

  expect(mocks.job.queue).toHaveBeenCalledTimes(1);
  expect(mocks.job.queue).toHaveBeenCalledWith(expected);
  expect(mocks.job.queueAll).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Strengthen manual refresh-faces multi-asset coverage**

In `server/src/services/asset.service.spec.ts`, inside `describe('run')`, add:

```ts
it('should queue only per-asset face detection jobs for manual refresh faces', async () => {
  mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(['asset-1', 'asset-2']));

  await sut.run(authStub.admin, { assetIds: ['asset-1', 'asset-2'], name: AssetJobName.REFRESH_FACES });

  expect(mocks.job.queueAll).toHaveBeenCalledTimes(1);
  expect(mocks.job.queueAll).toHaveBeenCalledWith([
    { name: JobName.AssetDetectFaces, data: { id: 'asset-1' } },
    { name: JobName.AssetDetectFaces, data: { id: 'asset-2' } },
  ]);
  expect(mocks.job.queue).not.toHaveBeenCalled();
});
```

- [ ] **Step 4: Run JobService and AssetService tests**

Run:

```bash
pnpm --filter immich test -- --run src/services/job.service.spec.ts src/services/asset.service.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git add server/src/services/job.service.spec.ts server/src/services/asset.service.spec.ts
git commit -m "test: cover manual face trigger contracts"
```

## Task 3: LibraryService Scheduled Scan And Linked Library Triggers

**Files:**

- Modify: `server/src/services/library.service.spec.ts`

- [ ] **Step 1: Add scheduled library scan cron root coverage**

In `describe('onConfigInit')`, add:

```ts
it('should schedule library scan cron to queue only the library scan root', async () => {
  mocks.cron.create.mockResolvedValue();

  await sut.onConfigInit({ newConfig: defaults });

  expect(mocks.cron.create).toHaveBeenCalledWith(
    expect.objectContaining({
      name: CronJob.LibraryScan,
      expression: defaults.library.scan.cronExpression,
      start: defaults.library.scan.enabled,
      onTick: expect.any(Function),
    }),
  );

  const onTick = mocks.cron.create.mock.calls[0][0].onTick;
  onTick();

  expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.LibraryScanQueueAll });
  expect(mocks.job.queue).not.toHaveBeenCalledWith(expect.objectContaining({ name: JobName.SharedSpaceFaceMatchAll }));
  expect(mocks.job.queueAll).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Strengthen all-library scan root coverage**

In `describe('handleQueueAllScan')`, extend the existing refresh test or add:

```ts
it('should queue library sync roots without direct face identity work', async () => {
  const library = factory.library();

  mocks.library.getAll.mockResolvedValue([library]);

  await expect(sut.handleQueueScanAll()).resolves.toBe(JobStatus.Success);

  expect(mocks.job.queue).toHaveBeenCalledWith({
    name: JobName.LibraryDeleteCheck,
    data: {},
  });
  expect(mocks.job.queueAll).toHaveBeenCalledWith([
    { name: JobName.LibrarySyncFilesQueueAll, data: { id: library.id } },
  ]);
  expect(mocks.job.queueAll).toHaveBeenCalledWith([
    { name: JobName.LibrarySyncAssetsQueueAll, data: { id: library.id } },
  ]);
  expect(mocks.job.queue).not.toHaveBeenCalledWith(expect.objectContaining({ name: JobName.SharedSpaceFaceMatch }));
  expect(mocks.job.queueAll).not.toHaveBeenCalledWith(
    expect.arrayContaining([expect.objectContaining({ name: JobName.SharedSpaceFaceMatchAll })]),
  );
});
```

- [ ] **Step 3: Strengthen linked-library new asset coverage**

In `describe('handleSyncFiles')`, inside `describe('space face matching')`, add:

```ts
it('should queue sidecar refresh and targeted space face match for imported linked-library assets', async () => {
  const libraryId = newUuid();
  const spaceId = newUuid();
  const library = factory.library({ id: libraryId });
  const assetId = newUuid();

  mocks.library.get.mockResolvedValue(library);
  mocks.asset.createAll.mockResolvedValue([assetId]);
  mocks.sharedSpace.getSpacesLinkedToLibrary.mockResolvedValue([
    {
      spaceId,
      libraryId,
      addedById: null,
      createdAt: newDate(),
      updatedAt: newDate(),
      createId: newUuid(),
      updateId: newUuid(),
      faceRecognitionEnabled: true,
    },
  ]);

  await sut.handleSyncFiles({ libraryId, paths: ['/photos/test.jpg'], progressCounter: 1, totalAssets: 1 });

  expect(mocks.job.queueAll).toHaveBeenCalledWith([
    { name: JobName.SidecarCheck, data: { id: assetId, source: 'upload' } },
  ]);
  expect(mocks.job.queue).toHaveBeenCalledWith({
    name: JobName.SharedSpaceFaceMatch,
    data: { spaceId, assetId },
  });
});
```

- [ ] **Step 4: Run LibraryService tests**

Run:

```bash
pnpm --filter immich test -- --run src/services/library.service.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

Run:

```bash
git add server/src/services/library.service.spec.ts
git commit -m "test: cover library face trigger contracts"
```

## Task 4: MetadataService EXIF Face Import Triggers

**Files:**

- Modify: `server/src/services/metadata.service.spec.ts`

- [ ] **Step 1: Add disabled import no-queue coverage**

Near the existing metadata face import tests, add:

```ts
it('should not queue face identity jobs when metadata face import is disabled', async () => {
  const asset = AssetFactory.create();
  mocks.assetJob.getForMetadataExtraction.mockResolvedValue(getForMetadataExtraction(asset));
  mocks.systemMetadata.get.mockResolvedValue({ metadata: { faces: { import: false } } });
  mockReadTags(makeFaceTags({ Name: 'Person 1' }));

  await sut.handleMetadataExtraction({ id: asset.id });

  expect(mocks.person.getDistinctNames).not.toHaveBeenCalled();
  expect(mocks.faceIdentity.ensurePersonIdentity).not.toHaveBeenCalled();
  expect(mocks.job.queueAll).not.toHaveBeenCalledWith(
    expect.arrayContaining([expect.objectContaining({ name: JobName.SharedSpaceFaceMatchFromBackfill })]),
  );
});
```

- [ ] **Step 2: Add imported-face no-space coverage**

Near `should queue shared-space matching for imported metadata faces`, add:

```ts
it('should not queue shared-space matching for imported metadata faces when the asset is in no spaces', async () => {
  const asset = AssetFactory.create();
  const person = PersonFactory.create();

  mocks.assetJob.getForMetadataExtraction.mockResolvedValue(getForMetadataExtraction(asset));
  mocks.systemMetadata.get.mockResolvedValue({ metadata: { faces: { import: true } } });
  mockReadTags(makeFaceTags({ Name: person.name }));
  mocks.person.getDistinctNames.mockResolvedValue([]);
  mocks.person.createAll.mockResolvedValue([person.id]);
  mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: 'identity-1' } as any);
  mocks.sharedSpace.getSpaceIdsForAsset.mockResolvedValue([]);

  await sut.handleMetadataExtraction({ id: asset.id });

  expect(mocks.sharedSpace.getSpaceIdsForAsset).toHaveBeenCalledWith(asset.id);
  expect(mocks.job.queueAll).not.toHaveBeenCalledWith(
    expect.arrayContaining([expect.objectContaining({ name: JobName.SharedSpaceFaceMatchFromBackfill })]),
  );
});
```

- [ ] **Step 3: Add multi-space imported-face fan-out coverage**

Near the same shared-space import tests, add:

```ts
it('should queue one backfill face match per space for imported metadata faces', async () => {
  const asset = AssetFactory.create();
  const person = PersonFactory.create();

  mocks.assetJob.getForMetadataExtraction.mockResolvedValue(getForMetadataExtraction(asset));
  mocks.systemMetadata.get.mockResolvedValue({ metadata: { faces: { import: true } } });
  mockReadTags(makeFaceTags({ Name: person.name }));
  mocks.person.getDistinctNames.mockResolvedValue([]);
  mocks.person.createAll.mockResolvedValue([person.id]);
  mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: 'identity-1' } as any);
  mocks.sharedSpace.getSpaceIdsForAsset.mockResolvedValue([{ spaceId: 'space-1' }, { spaceId: 'space-2' }]);

  await sut.handleMetadataExtraction({ id: asset.id });

  expect(mocks.job.queueAll).toHaveBeenCalledWith([
    { name: JobName.SharedSpaceFaceMatchFromBackfill, data: { spaceId: 'space-1', assetId: asset.id } },
    { name: JobName.SharedSpaceFaceMatchFromBackfill, data: { spaceId: 'space-2', assetId: asset.id } },
  ]);
});
```

- [ ] **Step 4: Run MetadataService tests**

Run:

```bash
pnpm --filter immich test -- --run src/services/metadata.service.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

Run:

```bash
git add server/src/services/metadata.service.spec.ts
git commit -m "test: cover metadata face import triggers"
```

## Task 5: SharedSpaceService Trigger Contracts

**Files:**

- Modify: `server/src/services/shared-space.service.spec.ts`

- [ ] **Step 1: Strengthen add-member enabled-face-recognition assertion**

In `describe('addMember')`, extend the existing enabled face materialization test with:

```ts
expect(queuedJobs).toContainEqual({
  name: JobName.SharedSpacePersonMetadataBackfill,
  data: {},
});
expect(queuedJobs).toContainEqual({
  name: JobName.SharedSpaceFaceMatchAll,
  data: { spaceId },
});
expect(queuedJobs).toContainEqual({
  name: JobName.SharedSpaceIdentityReconciliation,
  data: { spaceId, userId },
});
```

- [ ] **Step 2: Strengthen add-member disabled-face-recognition assertion**

In `describe('addMember')`, extend the existing disabled face materialization test with:

```ts
expect(queuedJobs).toContainEqual({
  name: JobName.SharedSpacePersonMetadataBackfill,
  data: {},
});
expect(queuedJobs).not.toContainEqual(expect.objectContaining({ name: JobName.SharedSpaceFaceMatchAll }));
```

- [ ] **Step 3: Strengthen add-assets disabled-face-recognition assertion**

In `describe('addAssets')`, extend the existing disabled face match test with:

```ts
expect(mocks.job.queueAll).not.toHaveBeenCalledWith(
  expect.arrayContaining([expect.objectContaining({ name: JobName.SharedSpaceFaceMatch })]),
);
```

- [ ] **Step 4: Strengthen unlink-library cleanup assertion**

In `describe('unlinkLibrary cleanup')`, extend the cleanup test with:

```ts
expect(mocks.job.queue).toHaveBeenCalledTimes(1);
expect(mocks.job.queue).toHaveBeenCalledWith({
  name: JobName.SharedSpacePersonMetadataBackfill,
  data: {},
});
```

- [ ] **Step 5: Run SharedSpaceService tests**

Run:

```bash
pnpm --filter immich test -- --run src/services/shared-space.service.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

Run:

```bash
git add server/src/services/shared-space.service.spec.ts
git commit -m "test: cover shared space face trigger contracts"
```

## Task 6: DuplicateService And PetDetectionService Trigger Contracts

**Files:**

- Modify: `server/src/services/duplicate.service.spec.ts`
- Modify: `server/src/services/pet-detection.service.spec.ts`

- [ ] **Step 1: Add duplicate queue-failure retry coverage**

In `server/src/services/duplicate.service.spec.ts`, inside `describe('shared space sync')`, add:

```ts
it('reports queue failure after keeper insertion so retry can queue face matches idempotently', async () => {
  const asset1 = AssetFactory.create();
  const asset2 = AssetFactory.create();
  setupBaseDuplicate(asset1, asset2);
  mocks.sharedSpace.getEditableByAssetIds.mockResolvedValue(new Set([spaceX]));
  mocks.sharedSpace.addAssets.mockResolvedValue([]);
  mocks.job.queueAll.mockRejectedValueOnce(new Error('queue unavailable')).mockResolvedValue(undefined as any);

  const first = await sut.resolve(authStub.admin, {
    groups: [{ duplicateId: 'group-1', keepAssetIds: [asset1.id], trashAssetIds: [asset2.id] }],
  });

  expect(first[0].success).toBe(false);
  expect(first[0].error).toBe(BulkIdErrorReason.UNKNOWN);
  expect(mocks.sharedSpace.addAssets).toHaveBeenCalledWith([
    { spaceId: spaceX, assetId: asset1.id, addedById: authStub.admin.user.id },
  ]);

  const second = await sut.resolve(authStub.admin, {
    groups: [{ duplicateId: 'group-1', keepAssetIds: [asset1.id], trashAssetIds: [asset2.id] }],
  });

  expect(second[0].success).toBe(true);
  expect(mocks.sharedSpace.addAssets).toHaveBeenCalledTimes(2);
  expect(mocks.job.queueAll).toHaveBeenCalledWith(
    expect.arrayContaining([{ name: JobName.SharedSpaceFaceMatch, data: { spaceId: spaceX, assetId: asset1.id } }]),
  );
});
```

- [ ] **Step 2: Strengthen duplicate no-keeper coverage**

Extend the existing no-keeper shared-space sync test with:

```ts
expect(mocks.job.queueAll).not.toHaveBeenCalledWith(
  expect.arrayContaining([expect.objectContaining({ name: JobName.SharedSpaceFaceMatch })]),
);
```

- [ ] **Step 3: Add pet queue disabled no-op coverage**

In `server/src/services/pet-detection.service.spec.ts`, inside `describe('handleQueuePetDetection')`, add:

```ts
it('should not queue pet jobs when pet detection is disabled', async () => {
  expect(await sut.handleQueuePetDetection({ force: false })).toEqual(JobStatus.Skipped);

  expect(mocks.assetJob.streamForPetDetectionJob).not.toHaveBeenCalled();
  expect(mocks.job.queueAll).not.toHaveBeenCalled();
});
```

- [ ] **Step 4: Add pet queue force fan-out coverage**

In the same describe block, add:

```ts
it('should queue pet detection jobs with force asset selection when force is true', async () => {
  const asset = AssetFactory.create();
  mocks.systemMetadata.get.mockResolvedValue({
    machineLearning: { enabled: true, petDetection: { enabled: true } },
  });
  mocks.assetJob.streamForPetDetectionJob.mockReturnValue(makeStream([asset]));

  expect(await sut.handleQueuePetDetection({ force: true })).toEqual(JobStatus.Success);

  expect(mocks.assetJob.streamForPetDetectionJob).toHaveBeenCalledWith(true);
  expect(mocks.job.queueAll).toHaveBeenCalledWith([{ name: JobName.PetDetection, data: { id: asset.id } }]);
});
```

- [ ] **Step 5: Run DuplicateService and PetDetectionService tests**

Run:

```bash
pnpm --filter immich test -- --run src/services/duplicate.service.spec.ts src/services/pet-detection.service.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 6**

Run:

```bash
git add server/src/services/duplicate.service.spec.ts server/src/services/pet-detection.service.spec.ts
git commit -m "test: cover duplicate and pet face trigger contracts"
```

## Task 7: Final Slice Verification

**Files:**

- Verify all modified Slice 1 service specs.

- [ ] **Step 1: Run the full Slice 1 small-test suite**

Run:

```bash
pnpm --filter immich test -- --run src/services/job.service.spec.ts src/services/queue.service.spec.ts src/services/asset.service.spec.ts src/services/library.service.spec.ts src/services/metadata.service.spec.ts src/services/duplicate.service.spec.ts src/services/shared-space.service.spec.ts src/services/pet-detection.service.spec.ts
```

Expected: PASS.

- [ ] **Step 2: Run static server checks**

Run:

```bash
pnpm --filter immich check
```

Expected: PASS.

- [ ] **Step 3: Check formatting and changed files**

Run:

```bash
git diff --check
git status --short
```

Expected: `git diff --check` emits no output. `git status --short` lists only intended Slice 1 test files if final commits have not yet been made.

- [ ] **Step 4: Commit any remaining verification-only adjustments**

If Task 7 changed files, commit them:

```bash
git add server/src/services/job.service.spec.ts server/src/services/queue.service.spec.ts server/src/services/asset.service.spec.ts server/src/services/library.service.spec.ts server/src/services/metadata.service.spec.ts server/src/services/duplicate.service.spec.ts server/src/services/shared-space.service.spec.ts server/src/services/pet-detection.service.spec.ts
git commit -m "test: complete face trigger contract coverage"
```

Expected: clean worktree after the final commit.

## Review Checklist

- [ ] Nightly `clusterNewFaces` is asserted as `{ force: false, nightly: true }`.
- [ ] Scheduled missing-thumbnail generation is asserted not to directly queue face detection.
- [ ] External library scan cron is asserted to queue only the library scan root directly.
- [ ] Manual face refresh queues one `AssetDetectFaces` per requested asset with no coordinator shortcut.
- [ ] Manual identity/backfill job endpoint queues only the requested root job.
- [ ] EXIF face import queues thumbnails, identity links, and targeted shared-space backfill only when applicable.
- [ ] Shared-space add/remove/member/link/unlink/bulk triggers have explicit enabled and disabled assertions.
- [ ] Duplicate keeper propagation covers no spaces, no keepers, add failure, and queue failure retry.
- [ ] Pet queue root covers disabled, force, and per-asset fan-out.
- [ ] No test in this slice requires real ML, Redis workers, filesystem scanning, or medium DB fixtures.
