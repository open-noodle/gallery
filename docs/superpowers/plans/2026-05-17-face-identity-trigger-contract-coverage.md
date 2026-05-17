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
- Audit/Modify: `server/src/services/person.service.spec.ts`
  - Owns app bootstrap identity backfill trigger contracts from the trigger matrix.
- Audit: `server/src/repositories/job.repository.spec.ts`
  - Owns stable job id behavior for duplicate root backfill jobs and retrigger dedupe; do not edit unless the audit finds missing coverage.

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
pnpm --filter immich test -- --run src/services/job.service.spec.ts src/services/queue.service.spec.ts src/services/asset.service.spec.ts src/services/library.service.spec.ts src/services/metadata.service.spec.ts src/services/duplicate.service.spec.ts src/services/shared-space.service.spec.ts src/services/pet-detection.service.spec.ts src/services/person.service.spec.ts
```

Expected: all targeted specs pass before new tests are added. If a pre-existing failure appears, stop and investigate before adding coverage.

- [ ] **Step 3: Audit existing stable-job dedupe coverage**

Run:

```bash
rg -n "FaceIdentityBackfill|SharedSpacePersonMetadataBackfill|stable|jobId" server/src/repositories/job.repository.spec.ts
```

Expected: output includes root, cursor, continuation, and metadata-backfill stable job id coverage. If those cases are missing, add `server/src/repositories/job.repository.spec.ts` to this plan before implementation and cover manual retrigger dedupe there.

## TDD Protocol For This Coverage Slice

This is primarily a test-coverage slice. Most behavior may already be implemented. Use this protocol for every task:

- [ ] **Step 1: Write tests before production code**

Add the new service-spec assertions first. Do not edit service implementation before the new test exists.

- [ ] **Step 2: Run the smallest targeted test selection**

Use either the full spec command in the task or a focused `-t` selector for the new test name. Expected result:

- FAIL if the current implementation does not satisfy the contract.
- PASS if the contract was already implemented and this is coverage-only.

- [ ] **Step 3: If a test fails, make the minimal production fix**

Only change production code for a failing contract test. Do not combine unrelated queue behavior changes in this slice.

- [ ] **Step 4: Prove the assertion can fail**

For at least one new assertion per touched spec file, temporarily change one expected `JobName` or `force` value to an intentionally wrong value, run the focused test and confirm it fails, then restore the correct expectation before committing. This prevents adding a vacuous test that cannot catch regressions.

## Spec Coverage Map

- Upload and thumbnail completion: Task 2 covers upload, non-upload, hidden upload, missing asset, image, and video job contracts.
- Manual asset jobs: Task 2 covers multi-asset refresh faces and access failure no-op.
- Admin queue starts: Task 1 covers face detection, facial recognition, people backfill, active recognition start behavior, and unrelated queues.
- Nightly jobs: Task 1 covers `PersonCleanup`, missing thumbnails, non-force `clusterNewFaces`, disabled switches, and issue #597 scheduled-trigger boundaries. Stuck recognition queue mutation behavior belongs to Slice 3 and full overnight composition belongs to Slice 8.
- Manual job endpoint: Task 2 covers identity backfill, shared-space metadata backfill, person cleanup, invalid jobs, and root-only side effects. Stable backfill job id dedupe remains in `job.repository.spec.ts`; audit that file before execution and only add a job repository test if coverage is missing.
- App bootstrap: Task 7 covers root backfill queueing, no-work no-op, active/waiting/delayed/paused dedupe query, and no direct projection fan-out.
- Metadata face import: Task 4 covers disabled import, no-space import, multi-space targeted backfill, identity linking, and thumbnail queueing.
- Library sync and link: Task 3 covers scheduled scan roots and linked-library asset import; Task 5 covers link, duplicate link, unlink cleanup, and disabled face-recognition link behavior.
- Shared-space membership and asset changes: Task 5 covers face-recognition toggle, add/remove members, add/remove assets, delete space, queue bulk add, and bulk-add handler behavior.
- Duplicate resolution: Task 6 covers keeper propagation, no editable spaces, no keepers, add failure, queue failure retry, and downstream disabled-space skip behavior.
- Pet detection: Task 6 covers disabled queue root, force fan-out, missing asset or preview, hidden asset, new species, existing species, first thumbnail, and no-pet no-op.
- Manual people and face operations: intentionally deferred to Slice 7; they are destructive user operations rather than Slice 1 queue-trigger roots.

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

- [ ] **Step 4: Add explicit nightly cleanup trigger coverage**

In `describe('handleNightlyJobs')`, add:

```ts
it('should queue PersonCleanup only when nightly database cleanup is enabled', async () => {
  await sut.handleNightlyJobs();
  expect(mocks.job.queueAll.mock.calls[0][0]).toContainEqual({ name: JobName.PersonCleanup });

  mocks.job.queueAll.mockClear();
  mocks.systemMetadata.get.mockResolvedValue({
    nightlyTasks: {
      ...defaults.nightlyTasks,
      databaseCleanup: false,
    },
  });

  await sut.handleNightlyJobs();

  expect(mocks.job.queueAll.mock.calls[0][0]).not.toContainEqual({ name: JobName.PersonCleanup });
});
```

- [ ] **Step 5: Add unrelated queue start no-face coverage**

In `describe('handleCommand')`, add:

```ts
it.each([
  QueueName.VideoConversion,
  QueueName.SmartSearch,
  QueueName.MetadataExtraction,
  QueueName.Sidecar,
  QueueName.ThumbnailGeneration,
  QueueName.Library,
] as const)('should not enqueue face identity roots when starting unrelated queue %s', async (queueName) => {
  mocks.job.isActive.mockResolvedValue(false);
  mocks.job.getJobCounts.mockResolvedValue(factory.queueStatistics());

  await sut.runCommandLegacy(queueName, { command: QueueCommand.Start, force: false });

  expect(mocks.job.queue).not.toHaveBeenCalledWith(expect.objectContaining({ name: JobName.AssetDetectFacesQueueAll }));
  expect(mocks.job.queue).not.toHaveBeenCalledWith(expect.objectContaining({ name: JobName.FacialRecognitionQueueAll }));
  expect(mocks.job.queue).not.toHaveBeenCalledWith(expect.objectContaining({ name: JobName.FaceIdentityBackfill }));
});
```

- [ ] **Step 6: Run QueueService tests**

Run:

```bash
pnpm --filter immich test -- --run src/services/queue.service.spec.ts
```

Expected: PASS. If a new test fails, fix only the trigger contract that failed.

- [ ] **Step 7: Commit Task 1**

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

- [ ] **Step 3: Add invalid manual job no-queue coverage**

In `server/src/services/job.service.spec.ts`, extend the invalid manual job test with explicit queue assertions:

```ts
it('should not queue anything for an invalid manual job name', async () => {
  await expect(sut.create({ name: 'invalid-job' as ManualJobName })).rejects.toThrow(BadRequestException);

  expect(mocks.job.queue).not.toHaveBeenCalled();
  expect(mocks.job.queueAll).not.toHaveBeenCalled();
});
```

- [ ] **Step 4: Add hidden upload queue-decision coverage**

In `server/src/services/job.service.spec.ts`, inside `describe('onDone - AssetGenerateThumbnails')`, add:

```ts
it('should still queue upload follow-up jobs for hidden assets while suppressing upload notifications', async () => {
  mocks.job.run.mockResolvedValue(JobStatus.Success);
  const id = newUuid();
  const asset = AssetFactory.create({ id, visibility: AssetVisibility.Hidden });
  mocks.asset.getByIdsWithAllRelationsButStacks.mockResolvedValue([asset] as any);

  await sut.onJobRun(QueueName.ThumbnailGeneration, {
    name: JobName.AssetGenerateThumbnails,
    data: { id, source: 'upload' },
  });

  expect(mocks.job.queueAll).toHaveBeenCalledWith([
    { name: JobName.SmartSearch, data: { id, source: 'upload' } },
    { name: JobName.AssetDetectFaces, data: { id, source: 'upload' } },
    { name: JobName.Ocr, data: { id, source: 'upload' } },
    { name: JobName.PetDetection, data: { id, source: 'upload' } },
  ]);
  expect(mocks.websocket.clientSend).not.toHaveBeenCalled();
});
```

- [ ] **Step 5: Strengthen manual refresh-faces multi-asset coverage**

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

- [ ] **Step 6: Add manual refresh-faces access failure no-queue assertion**

In `server/src/services/asset.service.spec.ts`, extend the existing access failure test with:

```ts
expect(mocks.job.queue).not.toHaveBeenCalled();
expect(mocks.job.queueAll).not.toHaveBeenCalled();
```

- [ ] **Step 7: Run JobService and AssetService tests**

Run:

```bash
pnpm --filter immich test -- --run src/services/job.service.spec.ts src/services/asset.service.spec.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 2**

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
  mocks.job.queue.mockResolvedValue(undefined as any);

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

- [ ] **Step 4: Strengthen linked-library disabled and no-space coverage**

In `describe('handleSyncFiles')`, inside `describe('space face matching')`, extend the existing no-space and disabled-space tests with exact queue assertions:

```ts
expect(mocks.job.queueAll).toHaveBeenCalledWith([
  { name: JobName.SidecarCheck, data: { id: expect.any(String), source: 'upload' } },
]);
expect(mocks.job.queue).not.toHaveBeenCalledWith(expect.objectContaining({ name: JobName.SharedSpaceFaceMatch }));
expect(mocks.job.queue).not.toHaveBeenCalledWith(expect.objectContaining({ name: JobName.SharedSpaceFaceMatchAll }));
```

- [ ] **Step 5: Run LibraryService tests**

Run:

```bash
pnpm --filter immich test -- --run src/services/library.service.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

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

- [ ] **Step 5: Strengthen face-recognition toggle assertions**

In `describe('update')`, extend the false-to-true, true-to-false, and already-true face-recognition tests with exact queue count assertions:

```ts
expect(mocks.job.queue).toHaveBeenCalledWith({
  name: JobName.SharedSpaceFaceMatchAll,
  data: { spaceId: space.id },
});
```

For the true-to-false and already-true tests, use:

```ts
expect(mocks.job.queue).not.toHaveBeenCalledWith(
  expect.objectContaining({ name: JobName.SharedSpaceFaceMatchAll }),
);
```

- [ ] **Step 6: Strengthen delete-space and remove-member metadata backfill assertions**

In `describe('remove')`, extend the delete-space metadata test with:

```ts
expect(mocks.job.queue).toHaveBeenCalledTimes(1);
expect(mocks.job.queue).toHaveBeenCalledWith({
  name: JobName.SharedSpacePersonMetadataBackfill,
  data: {},
});
```

In `describe('removeMember')`, extend both member-removal metadata tests with:

```ts
expect(mocks.job.queue).toHaveBeenCalledWith({
  name: JobName.SharedSpacePersonMetadataBackfill,
  data: {},
});
expect(mocks.job.queue).not.toHaveBeenCalledWith(expect.objectContaining({ name: JobName.SharedSpaceFaceMatchAll }));
```

- [ ] **Step 7: Strengthen remove-assets and bulk-add trigger assertions**

In `describe('removeAssets')`, extend the metadata backfill test with:

```ts
expect(mocks.sharedSpace.removePersonFacesByAssetIds).toHaveBeenCalledWith(spaceId, [assetId]);
expect(mocks.sharedSpace.deleteOrphanedPersons).toHaveBeenCalledWith(spaceId);
expect(mocks.job.queue).toHaveBeenCalledWith({
  name: JobName.SharedSpacePersonMetadataBackfill,
  data: {},
});
```

In `describe('queueBulkAdd')`, extend the editor and owner tests with:

```ts
expect(mocks.job.queue).toHaveBeenCalledWith({
  name: JobName.SharedSpaceBulkAddAssets,
  data: { spaceId, userId: auth.user.id },
});
```

In `describe('handleSharedSpaceBulkAddAssets')`, extend the count-zero and disabled tests with:

```ts
expect(mocks.job.queue).not.toHaveBeenCalledWith(
  expect.objectContaining({ name: JobName.SharedSpaceFaceMatchAll }),
);
```

For the enabled test, keep the exact positive assertion:

```ts
expect(mocks.job.queue).toHaveBeenCalledWith({
  name: JobName.SharedSpaceFaceMatchAll,
  data: { spaceId },
});
```

- [ ] **Step 8: Strengthen link-library trigger assertions**

In `describe('linkLibrary')`, extend the enabled test with:

```ts
expect(mocks.job.queue).toHaveBeenCalledWith({
  name: JobName.SharedSpaceLibraryFaceSync,
  data: { spaceId: space.id, libraryId: library.id },
});
```

For disabled and duplicate-link tests, use:

```ts
expect(mocks.job.queue).not.toHaveBeenCalledWith(
  expect.objectContaining({ name: JobName.SharedSpaceLibraryFaceSync }),
);
```

- [ ] **Step 9: Run SharedSpaceService tests**

Run:

```bash
pnpm --filter immich test -- --run src/services/shared-space.service.spec.ts
```

Expected: PASS.

- [ ] **Step 10: Commit Task 5**

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

## Task 7: PersonService App Bootstrap Trigger Audit

**Files:**

- Modify: `server/src/services/person.service.spec.ts`

- [ ] **Step 1: Strengthen bootstrap backfill trigger status coverage**

In `server/src/services/person.service.spec.ts`, update the import from `src/enum` to include `QueueJobStatus`:

```ts
import {
  AssetFileType,
  AssetVisibility,
  CacheControl,
  JobName,
  JobStatus,
  MetadataKey,
  QueueJobStatus,
  QueueName,
  SourceType,
  SystemMetadataKey,
} from 'src/enum';
```

Then add this test inside `describe('onBootstrap')`:

```ts
it('should not queue a duplicate identity backfill root while any backfill job is active, waiting, delayed, or paused', async () => {
  (mocks.faceIdentity as any).hasBackfillWork.mockResolvedValue(true);
  mocks.job.searchJobs.mockResolvedValue([
    {
      id: 'face-identity-backfill/root',
      name: JobName.FaceIdentityBackfill,
      timestamp: Date.now(),
      data: {},
    },
  ]);

  await sut.onBootstrap();

  expect(mocks.job.searchJobs).toHaveBeenCalledWith(QueueName.PeopleBackfill, {
    status: [QueueJobStatus.Active, QueueJobStatus.Delayed, QueueJobStatus.Paused, QueueJobStatus.Waiting],
  });
  expect(mocks.job.queue).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Assert bootstrap does not start projection fan-out directly**

Extend the existing positive bootstrap test with:

```ts
expect(mocks.job.queue).not.toHaveBeenCalledWith(expect.objectContaining({ name: JobName.SharedSpaceFaceMatchAll }));
expect(mocks.job.queue).not.toHaveBeenCalledWith(
  expect.objectContaining({ name: JobName.SharedSpaceFaceMatchFromBackfill }),
);
expect(mocks.job.queueAll).not.toHaveBeenCalled();
```

- [ ] **Step 3: Run PersonService bootstrap tests**

Run:

```bash
pnpm --filter immich test -- --run src/services/person.service.spec.ts -t "onBootstrap"
```

Expected: PASS.

- [ ] **Step 4: Commit Task 7**

Run:

```bash
git add server/src/services/person.service.spec.ts
git commit -m "test: cover bootstrap identity trigger contract"
```

## Task 8: Final Slice Verification

**Files:**

- Verify all modified Slice 1 service specs.

- [ ] **Step 1: Run the full Slice 1 small-test suite**

Run:

```bash
pnpm --filter immich test -- --run src/services/job.service.spec.ts src/services/queue.service.spec.ts src/services/asset.service.spec.ts src/services/library.service.spec.ts src/services/metadata.service.spec.ts src/services/duplicate.service.spec.ts src/services/shared-space.service.spec.ts src/services/pet-detection.service.spec.ts src/services/person.service.spec.ts
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

If final verification changed files, commit them:

```bash
git add server/src/services/job.service.spec.ts server/src/services/queue.service.spec.ts server/src/services/asset.service.spec.ts server/src/services/library.service.spec.ts server/src/services/metadata.service.spec.ts server/src/services/duplicate.service.spec.ts server/src/services/shared-space.service.spec.ts server/src/services/pet-detection.service.spec.ts server/src/services/person.service.spec.ts
git commit -m "test: complete face trigger contract coverage"
```

Expected: clean worktree after the final commit.

## Review Checklist

- [ ] Nightly `clusterNewFaces` is asserted as `{ force: false, nightly: true }`.
- [ ] Scheduled missing-thumbnail generation is asserted not to directly queue face detection.
- [ ] External library scan cron is asserted to queue only the library scan root directly.
- [ ] Manual face refresh queues one `AssetDetectFaces` per requested asset with no coordinator shortcut.
- [ ] Manual identity/backfill job endpoint queues only the requested root job.
- [ ] App bootstrap identity backfill queues one root job only when work exists and no backfill job is active, waiting, delayed, or paused.
- [ ] EXIF face import queues thumbnails, identity links, and targeted shared-space backfill only when applicable.
- [ ] Shared-space toggle/member/add/remove/delete/link/unlink/bulk triggers have explicit enabled and disabled assertions.
- [ ] Duplicate keeper propagation covers no spaces, no keepers, add failure, and queue failure retry.
- [ ] Pet queue root covers disabled, force, and per-asset fan-out.
- [ ] No test in this slice requires real ML, Redis workers, filesystem scanning, or medium DB fixtures.
