# Face Detection Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add thorough Slice 2 coverage proving face detection queue roots and per-asset detection mutate only the intended machine-learning face rows, preserve manual and EXIF identity evidence, and queue recognition follow-ups safely.

**Architecture:** This slice is mostly test-only. Use small `PersonService` unit tests for queue contracts, no-op/error paths, ML matching decisions, and job-status writes; use medium DB tests only where destructive row-level behavior must be proven. If a new test exposes a real bug, make the smallest production fix in `server/src/services/person.service.ts` or `server/src/repositories/person.repository.ts` and keep it in the same task commit.

**Tech Stack:** TypeScript, NestJS service tests, Vitest, Gallery small test factories, Gallery medium DB test harness, Kysely, BullMQ job names.

---

## File Structure

- Modify: `server/src/services/person.service.spec.ts`
  - Owns small unit coverage for `handleQueueDetectFaces()` and `handleDetectFaces()` job contracts, skip/error paths, ML face matching, source-type preservation, recognition fan-out, and `facesRecognizedAt` writes.
- Modify: `server/test/medium/specs/services/person.service.spec.ts`
  - Owns DB-backed destructive-state coverage for populated users: force detection, no-face detection, manual/EXIF preservation, identity-link cascade behavior, shared-space projection preservation, and successful asset job-status writes.
- Modify: `server/test/medium/specs/repositories/person.repository.spec.ts`
  - Owns repository-level `refreshFaces()` safety: deletes only explicitly supplied face ids, cascades only those identity links, inserts new ML faces and embeddings atomically, and preserves manual/EXIF rows.
- Modify only if a new failing test proves a bug:
  - `server/src/services/person.service.ts`
  - `server/src/repositories/person.repository.ts`

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
/home/pierre/dev/gallery/.worktrees/face-trigger-slice-2-plan
codex/face-trigger-slice-2-plan
```

`git status --short` must be empty before editing. If it is not empty, inspect every listed file and preserve user-owned work.

- [ ] **Step 2: Run the Slice 2 baseline small spec**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter immich exec vitest --config test/vitest.config.mjs run src/services/person.service.spec.ts
```

Expected: `person.service.spec.ts` passes before new tests are added.

- [ ] **Step 3: Run the Slice 2 baseline medium specs**

Run:

```bash
pnpm --filter immich test:medium -- --run test/medium/specs/services/person.service.spec.ts test/medium/specs/repositories/person.repository.spec.ts
```

Expected: both medium specs pass before new DB-backed tests are added. If local Docker or test-asset setup blocks the run, record the environment failure and still run the focused small spec before editing.

## TDD Protocol For This Slice

- [ ] **Step 1: Write the failing or coverage test first**

Add the test before editing production code. For coverage of existing behavior, it may pass immediately.

- [ ] **Step 2: Run the smallest focused selector**

Run the specific `-t` selector for the new test. Expected result:

- FAIL when the current implementation violates the contract.
- PASS when the contract already exists and this is coverage-only.

- [ ] **Step 3: Make the smallest production fix only if needed**

Do not refactor unrelated recognition or shared-space logic. Slice 3 owns recognition coordinator reset ordering; Slice 4 owns per-face recognition assignment; Slice 8 owns overnight queue-chain composition.

- [ ] **Step 4: Prove assertions can fail**

For each touched spec file, temporarily change one expected `JobName`, `SourceType`, or persisted face id to a wrong value, run the focused test and confirm it fails, then restore the correct expectation before committing.

## Shared Small-Spec Helpers

Add these helpers near the top of `server/src/services/person.service.spec.ts`, after `beforeEach()` or immediately before `describe('handleQueueDetectFaces')` if local scope is preferred:

```ts
const queuedBatchJobs = () => mocks.job.queueAll.mock.calls.flatMap(([jobs]) => jobs);
const queuedBatchJobNames = () => queuedBatchJobs().map((job) => job.name);

const expectNoFaceDetectionMutation = () => {
  expect(mocks.machineLearning.detectFaces).not.toHaveBeenCalled();
  expect(mocks.person.refreshFaces).not.toHaveBeenCalled();
  expect(mocks.faceIdentity.unlinkFaces).not.toHaveBeenCalled();
  expect(mocks.job.queue).not.toHaveBeenCalled();
  expect(mocks.job.queueAll).not.toHaveBeenCalled();
  expect(mocks.asset.upsertJobStatus).not.toHaveBeenCalled();
};

const expectNoRecognitionFanout = () => {
  expect(mocks.job.queue).not.toHaveBeenCalledWith(
    expect.objectContaining({ name: JobName.FacialRecognitionQueueAll }),
  );
  expect(queuedBatchJobNames()).not.toContain(JobName.FacialRecognitionQueueAll);
  expect(queuedBatchJobNames()).not.toContain(JobName.FacialRecognition);
};
```

These helpers intentionally flatten `queueAll` calls and assert each forbidden job name separately so a single forbidden job cannot slip through a multi-entry `arrayContaining` negation.

## Task 1: Small Queue-Root Face Detection Contracts

**Files:**

- Modify: `server/src/services/person.service.spec.ts`

- [ ] **Step 1: Strengthen `force=false` and omitted-force queue-root tests**

In `describe('handleQueueDetectFaces')`, add or replace the current non-force/omitted-force assertions with:

```ts
it.each([
  ['force=false', false],
  ['force omitted', undefined],
] as const)('should queue per-asset detection without destructive cleanup when %s', async (_label, force) => {
  const asset1 = AssetFactory.create();
  const asset2 = AssetFactory.create();
  mocks.assetJob.streamForDetectFacesJob.mockReturnValue(makeStream([asset1, asset2]));

  await expect(sut.handleQueueDetectFaces({ force })).resolves.toBe(JobStatus.Success);

  expect(mocks.assetJob.streamForDetectFacesJob).toHaveBeenCalledWith(force);
  expect(mocks.person.deleteFaces).not.toHaveBeenCalled();
  expect(mocks.person.delete).not.toHaveBeenCalled();
  expect(mocks.sharedSpace.deleteAllOrphanedPersons).not.toHaveBeenCalled();
  expect(mocks.person.vacuum).not.toHaveBeenCalled();
  expect(mocks.job.queueAll).toHaveBeenCalledTimes(1);
  expect(mocks.job.queueAll).toHaveBeenCalledWith([
    { name: JobName.AssetDetectFaces, data: { id: asset1.id } },
    { name: JobName.AssetDetectFaces, data: { id: asset2.id } },
  ]);

  if (force === undefined) {
    expect(mocks.job.queue).toHaveBeenCalledTimes(1);
    expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.PersonCleanup });
  } else {
    expect(mocks.job.queue).not.toHaveBeenCalled();
  }
});
```

This pins the distinction between user/admin refresh without `force`, explicit non-force detection, and destructive force detection.

- [ ] **Step 2: Strengthen force queue-root destructive cleanup scope**

Add a force-root test that asserts only ML source cleanup is requested and every queued asset job carries `force: true`:

```ts
it('should force-detect all assets after deleting only machine-learning faces', async () => {
  const asset1 = AssetFactory.create();
  const asset2 = AssetFactory.create();
  const orphan = PersonFactory.create();
  mocks.assetJob.streamForDetectFacesJob.mockReturnValue(makeStream([asset1, asset2]));
  mocks.person.getAllWithoutFaces.mockResolvedValue([orphan]);
  mocks.sharedSpace.deleteAllOrphanedPersons.mockResolvedValue(void 0 as any);

  await expect(sut.handleQueueDetectFaces({ force: true })).resolves.toBe(JobStatus.Success);

  expect(mocks.person.deleteFaces).toHaveBeenCalledTimes(1);
  expect(mocks.person.deleteFaces).toHaveBeenCalledWith({ sourceType: SourceType.MachineLearning });
  expect(mocks.person.deleteFaces).not.toHaveBeenCalledWith({ sourceType: SourceType.Manual });
  expect(mocks.person.deleteFaces).not.toHaveBeenCalledWith({ sourceType: SourceType.Exif });
  expect(mocks.person.delete).toHaveBeenCalledWith([orphan.id]);
  expect(mocks.sharedSpace.deleteAllOrphanedPersons).toHaveBeenCalledTimes(1);
  expect(mocks.person.vacuum).toHaveBeenCalledWith({ reindexVectors: true });
  expect(mocks.job.queueAll).toHaveBeenCalledTimes(1);
  expect(mocks.job.queueAll).toHaveBeenCalledWith([
    { name: JobName.AssetDetectFaces, data: { id: asset1.id, force: true } },
    { name: JobName.AssetDetectFaces, data: { id: asset2.id, force: true } },
  ]);
  expect(mocks.job.queue).toHaveBeenCalledWith({
    name: JobName.FileDelete,
    data: { files: [orphan.thumbnailPath] },
  });
});
```

- [ ] **Step 3: Add no-assets root behavior coverage**

Add this test to prevent empty streams from becoming destructive shortcuts:

```ts
it('should not enqueue recognition or cleanup shortcuts when the detection stream is empty', async () => {
  mocks.assetJob.streamForDetectFacesJob.mockReturnValue(makeStream([]));

  await expect(sut.handleQueueDetectFaces({ force: false })).resolves.toBe(JobStatus.Success);

  expect(queuedBatchJobs()).toEqual([]);
  expect(mocks.job.queue).not.toHaveBeenCalled();
  expect(mocks.person.deleteFaces).not.toHaveBeenCalled();
  expect(mocks.sharedSpace.deleteAllOrphanedPersons).not.toHaveBeenCalled();
  expectNoRecognitionFanout();
});
```

- [ ] **Step 4: Run focused queue-root tests**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter immich exec vitest --config test/vitest.config.mjs run src/services/person.service.spec.ts -t "handleQueueDetectFaces"
```

Expected: new `handleQueueDetectFaces` tests pass or expose one minimal production fix.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add server/src/services/person.service.spec.ts server/src/services/person.service.ts
git commit -m "test: cover face detection queue root safety"
```

If no production file changed, omit it from `git add`.

## Task 2: Small Per-Asset Skip, Error, And Status Safety

**Files:**

- Modify: `server/src/services/person.service.spec.ts`

- [ ] **Step 1: Add table-driven no-op/error coverage**

In `describe('handleDetectFaces')`, add:

```ts
it.each([
  {
    label: 'missing asset',
    asset: undefined,
    expected: JobStatus.Failed,
  },
  {
    label: 'asset without preview file',
    asset: AssetFactory.from().exif().build(),
    expected: JobStatus.Failed,
  },
  {
    label: 'asset with multiple preview files',
    asset: AssetFactory.from()
      .file({ type: AssetFileType.Preview, path: '/preview-1.jpg' })
      .file({ type: AssetFileType.Preview, path: '/preview-2.jpg' })
      .exif()
      .build(),
    expected: JobStatus.Failed,
  },
  {
    label: 'hidden asset with preview file',
    asset: AssetFactory.from({ visibility: AssetVisibility.Hidden })
      .file({ type: AssetFileType.Preview, path: '/hidden-preview.jpg' })
      .exif()
      .build(),
    expected: JobStatus.Skipped,
  },
] as const)('should not mutate faces or status for $label', async ({ asset, expected }) => {
  mocks.assetJob.getForDetectFacesJob.mockResolvedValue(asset ? getForDetectedFaces(asset) : undefined);

  await expect(sut.handleDetectFaces({ id: asset?.id ?? 'missing-asset' })).resolves.toBe(expected);

  expectNoFaceDetectionMutation();
});
```

This covers missing asset, no preview, multiple preview files, and hidden asset. The expected difference is return status only; all mutation and queue side effects must remain absent.

- [ ] **Step 2: Strengthen ML-disabled per-asset skip coverage**

Extend the existing ML-disabled test with:

```ts
expect(mocks.assetJob.getForDetectFacesJob).not.toHaveBeenCalled();
expect(mocks.machineLearning.detectFaces).not.toHaveBeenCalled();
expect(mocks.person.refreshFaces).not.toHaveBeenCalled();
expect(mocks.faceIdentity.unlinkFaces).not.toHaveBeenCalled();
expect(mocks.job.queue).not.toHaveBeenCalled();
expect(mocks.job.queueAll).not.toHaveBeenCalled();
expect(mocks.asset.upsertJobStatus).not.toHaveBeenCalled();
```

- [ ] **Step 3: Add ML inference failure status coverage**

Add:

```ts
it('should not write facesRecognizedAt or queue recognition when ML face detection throws', async () => {
  const asset = AssetFactory.from().file({ type: AssetFileType.Preview, path: '/preview.jpg' }).exif().build();
  mocks.assetJob.getForDetectFacesJob.mockResolvedValue(getForDetectedFaces(asset));
  mocks.machineLearning.detectFaces.mockRejectedValue(new Error('ml unavailable'));

  await expect(sut.handleDetectFaces({ id: asset.id })).rejects.toThrow('ml unavailable');

  expect(mocks.person.refreshFaces).not.toHaveBeenCalled();
  expect(mocks.faceIdentity.unlinkFaces).not.toHaveBeenCalled();
  expect(mocks.job.queue).not.toHaveBeenCalled();
  expect(mocks.job.queueAll).not.toHaveBeenCalled();
  expect(mocks.asset.upsertJobStatus).not.toHaveBeenCalled();
});
```

- [ ] **Step 4: Strengthen successful no-face status coverage**

Update the existing no-results test so it also proves no stale non-ML faces are removed when there are no existing ML faces:

```ts
expect(mocks.person.refreshFaces).not.toHaveBeenCalled();
expect(mocks.faceIdentity.unlinkFaces).not.toHaveBeenCalled();
expect(mocks.job.queue).not.toHaveBeenCalled();
expect(mocks.job.queueAll).not.toHaveBeenCalled();
expect(mocks.asset.upsertJobStatus).toHaveBeenCalledWith({
  assetId: asset.id,
  facesRecognizedAt: expect.any(Date),
});
```

- [ ] **Step 5: Run focused skip/error tests**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter immich exec vitest --config test/vitest.config.mjs run src/services/person.service.spec.ts -t "handleDetectFaces"
```

Expected: all per-asset skip/error tests pass or expose one minimal production fix.

- [ ] **Step 6: Commit Task 2**

Run:

```bash
git add server/src/services/person.service.spec.ts server/src/services/person.service.ts
git commit -m "test: cover face detection skip and error safety"
```

If no production file changed, omit it from `git add`.

## Task 3: Small Per-Asset Source Preservation And IOU Matching

**Files:**

- Modify: `server/src/services/person.service.spec.ts`

- [ ] **Step 1: Add stale ML removal with manual/EXIF preservation**

Add:

```ts
it('should remove only stale machine-learning faces and unlink only those identity links', async () => {
  const assetId = newUuid();
  const mlFace = AssetFaceFactory.create({ assetId, id: 'ml-face', sourceType: SourceType.MachineLearning });
  const exifFace = AssetFaceFactory.create({ assetId, id: 'exif-face', sourceType: SourceType.Exif });
  const manualFace = AssetFaceFactory.create({ assetId, id: 'manual-face', sourceType: SourceType.Manual });
  const asset = AssetFactory.from({ id: assetId })
    .face(mlFace)
    .face(exifFace)
    .face(manualFace)
    .file({ type: AssetFileType.Preview, path: '/preview.jpg' })
    .exif()
    .build();
  mocks.assetJob.getForDetectFacesJob.mockResolvedValue(getForDetectedFaces(asset));
  mocks.machineLearning.detectFaces.mockResolvedValue({ imageHeight: 500, imageWidth: 400, faces: [] });

  await expect(sut.handleDetectFaces({ id: asset.id })).resolves.toBe(JobStatus.Success);

  expect(mocks.person.refreshFaces).toHaveBeenCalledWith([], [mlFace.id], []);
  expect(mocks.faceIdentity.unlinkFaces).toHaveBeenCalledTimes(1);
  expect(mocks.faceIdentity.unlinkFaces).toHaveBeenCalledWith([mlFace.id]);
  expect(mocks.faceIdentity.unlinkFaces).not.toHaveBeenCalledWith(expect.arrayContaining([exifFace.id]));
  expect(mocks.faceIdentity.unlinkFaces).not.toHaveBeenCalledWith(expect.arrayContaining([manualFace.id]));
  expectNoRecognitionFanout();
  expect(mocks.asset.upsertJobStatus).toHaveBeenCalledWith({
    assetId: asset.id,
    facesRecognizedAt: expect.any(Date),
  });
});
```

- [ ] **Step 2: Add populated forced per-asset detection coverage**

Add:

```ts
it('forced per-asset detection removes stale ML faces while preserving manual and EXIF evidence', async () => {
  const assetId = newUuid();
  const staleMlFace = AssetFaceFactory.create({
    assetId,
    id: 'stale-ml-face',
    sourceType: SourceType.MachineLearning,
    boundingBoxX1: 700,
    boundingBoxY1: 500,
    boundingBoxX2: 900,
    boundingBoxY2: 700,
  });
  const exifFace = AssetFaceFactory.create({
    assetId,
    id: 'force-exif-face',
    sourceType: SourceType.Exif,
    boundingBoxX1: 10,
    boundingBoxY1: 10,
    boundingBoxX2: 40,
    boundingBoxY2: 40,
  });
  const manualFace = AssetFaceFactory.create({
    assetId,
    id: 'force-manual-face',
    sourceType: SourceType.Manual,
    boundingBoxX1: 300,
    boundingBoxY1: 300,
    boundingBoxX2: 350,
    boundingBoxY2: 350,
  });
  const asset = AssetFactory.from({ id: assetId })
    .face(staleMlFace)
    .face(exifFace)
    .face(manualFace)
    .file({ type: AssetFileType.Preview, path: '/preview.jpg' })
    .exif()
    .build();
  mocks.assetJob.getForDetectFacesJob.mockResolvedValue(getForDetectedFaces(asset));
  mocks.crypto.randomUUID.mockReturnValue('force-new-ml-face');
  mocks.machineLearning.detectFaces.mockResolvedValue({
    imageHeight: 500,
    imageWidth: 400,
    faces: [
      {
        boundingBox: { x1: 100, y1: 80, x2: 250, y2: 200 },
        embedding: '[1, 2, 3, 4]',
        score: 0.99,
      },
    ],
  });

  await expect(sut.handleDetectFaces({ id: asset.id, force: true })).resolves.toBe(JobStatus.Success);

  expect(mocks.person.refreshFaces).toHaveBeenCalledWith(
    [
      expect.objectContaining({
        id: 'force-new-ml-face',
        assetId: asset.id,
        boundingBoxX1: 100,
        boundingBoxY1: 80,
        boundingBoxX2: 250,
        boundingBoxY2: 200,
      }),
    ],
    [staleMlFace.id],
    [{ faceId: 'force-new-ml-face', embedding: '[1, 2, 3, 4]' }],
  );
  expect(mocks.faceIdentity.unlinkFaces).toHaveBeenCalledWith([staleMlFace.id]);
  expect(mocks.faceIdentity.unlinkFaces).not.toHaveBeenCalledWith(expect.arrayContaining([exifFace.id]));
  expect(mocks.faceIdentity.unlinkFaces).not.toHaveBeenCalledWith(expect.arrayContaining([manualFace.id]));
  expect(mocks.job.queue).toHaveBeenCalledWith({
    name: JobName.FacialRecognitionQueueAll,
    data: { force: true },
  });
  expect(mocks.job.queueAll).not.toHaveBeenCalled();
  expect(mocks.asset.upsertJobStatus).toHaveBeenCalledWith({
    assetId: asset.id,
    facesRecognizedAt: expect.any(Date),
  });
});
```

- [ ] **Step 3: Add manual-face matching coverage**

Existing tests cover EXIF matching. Add the manual equivalent:

```ts
it('should add an embedding to a matching manual face instead of creating a duplicate', async () => {
  const manualFace = AssetFaceFactory.create({ sourceType: SourceType.Manual });
  const asset = AssetFactory.from({ id: manualFace.assetId })
    .face(manualFace)
    .file({ type: AssetFileType.Preview, path: '/preview.jpg' })
    .exif()
    .build();
  mocks.assetJob.getForDetectFacesJob.mockResolvedValue(getForDetectedFaces(asset));
  mocks.machineLearning.detectFaces.mockResolvedValue(getAsDetectedFace(manualFace));

  await expect(sut.handleDetectFaces({ id: asset.id })).resolves.toBe(JobStatus.Success);

  expect(mocks.person.refreshFaces).toHaveBeenCalledWith(
    [],
    [],
    [{ faceId: manualFace.id, embedding: '[1, 2, 3, 4]' }],
  );
  expect(mocks.crypto.randomUUID).not.toHaveBeenCalled();
  expect(mocks.faceIdentity.unlinkFaces).not.toHaveBeenCalled();
  expectNoRecognitionFanout();
});
```

- [ ] **Step 4: Add matching existing ML face coverage**

Add:

```ts
it('should keep a matching existing ML face without adding a duplicate or unlinking identities', async () => {
  const mlFace = AssetFaceFactory.create({ sourceType: SourceType.MachineLearning });
  const asset = AssetFactory.from({ id: mlFace.assetId })
    .face(mlFace)
    .file({ type: AssetFileType.Preview, path: '/preview.jpg' })
    .exif()
    .build();
  mocks.assetJob.getForDetectFacesJob.mockResolvedValue(getForDetectedFaces(asset));
  mocks.machineLearning.detectFaces.mockResolvedValue(getAsDetectedFace(mlFace));

  await expect(sut.handleDetectFaces({ id: asset.id })).resolves.toBe(JobStatus.Success);

  expect(mocks.person.refreshFaces).not.toHaveBeenCalled();
  expect(mocks.crypto.randomUUID).not.toHaveBeenCalled();
  expect(mocks.faceIdentity.unlinkFaces).not.toHaveBeenCalled();
  expectNoRecognitionFanout();
  expect(mocks.asset.upsertJobStatus).toHaveBeenCalledWith({
    assetId: asset.id,
    facesRecognizedAt: expect.any(Date),
  });
});
```

- [ ] **Step 5: Add changed-image-dimensions IOU preservation coverage**

Add:

```ts
it('should preserve an existing metadata face when scaled detection boxes still overlap', async () => {
  const assetId = newUuid();
  const exifFace = AssetFaceFactory.create({
    assetId,
    id: 'scaled-exif-face',
    sourceType: SourceType.Exif,
    imageWidth: 1000,
    imageHeight: 800,
    boundingBoxX1: 200,
    boundingBoxY1: 160,
    boundingBoxX2: 500,
    boundingBoxY2: 400,
  });
  const asset = AssetFactory.from({ id: assetId })
    .face(exifFace)
    .file({ type: AssetFileType.Preview, path: '/preview.jpg' })
    .exif()
    .build();
  mocks.assetJob.getForDetectFacesJob.mockResolvedValue(getForDetectedFaces(asset));
  mocks.machineLearning.detectFaces.mockResolvedValue({
    imageWidth: 500,
    imageHeight: 400,
    faces: [
      {
        boundingBox: { x1: 100, y1: 80, x2: 250, y2: 200 },
        embedding: '[1, 2, 3, 4]',
        score: 0.99,
      },
    ],
  });

  await expect(sut.handleDetectFaces({ id: asset.id })).resolves.toBe(JobStatus.Success);

  expect(mocks.person.refreshFaces).toHaveBeenCalledWith([], [], [{ faceId: exifFace.id, embedding: '[1, 2, 3, 4]' }]);
  expect(mocks.crypto.randomUUID).not.toHaveBeenCalled();
  expect(mocks.faceIdentity.unlinkFaces).not.toHaveBeenCalled();
  expectNoRecognitionFanout();
});
```

The detected box is in a half-size preview coordinate space, while the existing EXIF face is in the full-size original coordinate space. These boxes represent the same face and should overlap after scaling. If this test fails, make the minimal production fix in `handleDetectFaces()` so IOU comparison scales detection boxes from ML image dimensions into existing face dimensions.

- [ ] **Step 6: Add changed-dimensions non-overlap coverage**

Add:

```ts
it('should create a new ML face when scaled detection boxes do not overlap existing manual or EXIF faces', async () => {
  const assetId = newUuid();
  const exifFace = AssetFaceFactory.create({
    assetId,
    id: 'far-exif-face',
    sourceType: SourceType.Exif,
    imageWidth: 1000,
    imageHeight: 800,
    boundingBoxX1: 700,
    boundingBoxY1: 500,
    boundingBoxX2: 900,
    boundingBoxY2: 700,
  });
  const asset = AssetFactory.from({ id: assetId })
    .face(exifFace)
    .file({ type: AssetFileType.Preview, path: '/preview.jpg' })
    .exif()
    .build();
  mocks.assetJob.getForDetectFacesJob.mockResolvedValue(getForDetectedFaces(asset));
  mocks.crypto.randomUUID.mockReturnValue('new-ml-face');
  mocks.machineLearning.detectFaces.mockResolvedValue({
    imageWidth: 500,
    imageHeight: 400,
    faces: [
      {
        boundingBox: { x1: 100, y1: 80, x2: 250, y2: 200 },
        embedding: '[1, 2, 3, 4]',
        score: 0.99,
      },
    ],
  });

  await expect(sut.handleDetectFaces({ id: asset.id })).resolves.toBe(JobStatus.Success);

  expect(mocks.person.refreshFaces).toHaveBeenCalledWith(
    [
      expect.objectContaining({
        id: 'new-ml-face',
        assetId: asset.id,
        boundingBoxX1: 100,
        boundingBoxY1: 80,
        boundingBoxX2: 250,
        boundingBoxY2: 200,
      }),
    ],
    [],
    [{ faceId: 'new-ml-face', embedding: '[1, 2, 3, 4]' }],
  );
  expect(mocks.faceIdentity.unlinkFaces).not.toHaveBeenCalled();
  expect(mocks.job.queueAll).toHaveBeenCalledWith([
    { name: JobName.FacialRecognitionQueueAll, data: { force: false } },
    { name: JobName.FacialRecognition, data: { id: 'new-ml-face' } },
  ]);
});
```

- [ ] **Step 7: Run focused matching tests**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter immich exec vitest --config test/vitest.config.mjs run src/services/person.service.spec.ts -t "matching manual face|matching existing ML face|scaled detection|stale machine-learning|forced per-asset detection"
```

Expected: the focused tests pass or expose one minimal production fix.

- [ ] **Step 8: Commit Task 3**

Run:

```bash
git add server/src/services/person.service.spec.ts server/src/services/person.service.ts
git commit -m "test: cover face detection source preservation"
```

If no production file changed, omit it from `git add`.

## Task 4: Small Recognition Fan-Out And `facesRecognizedAt` Contracts

**Files:**

- Modify: `server/src/services/person.service.spec.ts`

- [ ] **Step 1: Strengthen non-force new-face fan-out**

Update the non-force new-face tests so they assert exact queue calls and no direct force coordinator:

```ts
expect(mocks.job.queue).not.toHaveBeenCalled();
expect(mocks.job.queueAll).toHaveBeenCalledTimes(1);
expect(mocks.job.queueAll).toHaveBeenCalledWith([
  { name: JobName.FacialRecognitionQueueAll, data: { force: false } },
  { name: JobName.FacialRecognition, data: { id: face.id } },
]);
expect(mocks.asset.upsertJobStatus).toHaveBeenCalledWith({
  assetId: asset.id,
  facesRecognizedAt: expect.any(Date),
});
```

- [ ] **Step 2: Strengthen force-created new-face fan-out**

Update the forced detection test so it proves forced per-asset detection never queues immediate per-face recognition:

```ts
expect(mocks.job.queue).toHaveBeenCalledTimes(1);
expect(mocks.job.queue).toHaveBeenCalledWith({
  name: JobName.FacialRecognitionQueueAll,
  data: { force: true },
});
expect(mocks.job.queueAll).not.toHaveBeenCalled();
expect(mocks.asset.upsertJobStatus).toHaveBeenCalledWith({
  assetId: asset.id,
  facesRecognizedAt: expect.any(Date),
});
```

- [ ] **Step 3: Add queue failure status guard**

Add:

```ts
it('should not write facesRecognizedAt when recognition fan-out queueing fails', async () => {
  const asset = AssetFactory.from().file({ type: AssetFileType.Preview, path: '/preview.jpg' }).exif().build();
  const face = AssetFaceFactory.create({ assetId: asset.id });
  mocks.crypto.randomUUID.mockReturnValue(face.id);
  mocks.machineLearning.detectFaces.mockResolvedValue(getAsDetectedFace(face));
  mocks.assetJob.getForDetectFacesJob.mockResolvedValue(getForDetectedFaces(asset));
  mocks.person.refreshFaces.mockResolvedValue();
  mocks.job.queueAll.mockRejectedValue(new Error('redis unavailable'));

  await expect(sut.handleDetectFaces({ id: asset.id })).rejects.toThrow('redis unavailable');

  expect(mocks.person.refreshFaces).toHaveBeenCalled();
  expect(mocks.asset.upsertJobStatus).not.toHaveBeenCalled();
});
```

This pins the order: status is written only after face refresh and recognition fan-out have succeeded.

- [ ] **Step 4: Add refresh failure status guard**

Add:

```ts
it('should not queue recognition or write facesRecognizedAt when refreshFaces fails', async () => {
  const asset = AssetFactory.from().file({ type: AssetFileType.Preview, path: '/preview.jpg' }).exif().build();
  const face = AssetFaceFactory.create({ assetId: asset.id });
  mocks.crypto.randomUUID.mockReturnValue(face.id);
  mocks.machineLearning.detectFaces.mockResolvedValue(getAsDetectedFace(face));
  mocks.assetJob.getForDetectFacesJob.mockResolvedValue(getForDetectedFaces(asset));
  mocks.person.refreshFaces.mockRejectedValue(new Error('refresh failed'));

  await expect(sut.handleDetectFaces({ id: asset.id })).rejects.toThrow('refresh failed');

  expect(mocks.job.queue).not.toHaveBeenCalled();
  expect(mocks.job.queueAll).not.toHaveBeenCalled();
  expect(mocks.asset.upsertJobStatus).not.toHaveBeenCalled();
});
```

- [ ] **Step 5: Run focused fan-out tests**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter immich exec vitest --config test/vitest.config.mjs run src/services/person.service.spec.ts -t "fan-out|facesRecognizedAt|force recognition coordinator|refreshFaces fails"
```

Expected: the focused tests pass or expose one minimal production fix.

- [ ] **Step 6: Commit Task 4**

Run:

```bash
git add server/src/services/person.service.spec.ts server/src/services/person.service.ts
git commit -m "test: cover face detection recognition fanout"
```

If no production file changed, omit it from `git add`.

## Task 5: Medium Service Destructive-State Tests

**Files:**

- Modify: `server/test/medium/specs/services/person.service.spec.ts`
- Modify only if tests expose a bug: `server/src/services/person.service.ts`

- [ ] **Step 1: Add medium face-detection setup**

In `server/test/medium/specs/services/person.service.spec.ts`, extend imports:

```ts
import {
  AssetFileType,
  AssetVisibility,
  JobName,
  JobStatus,
  SharedSpaceRole,
  SourceType,
  SystemMetadataKey,
} from 'src/enum';
import { AssetJobRepository } from 'src/repositories/asset-job.repository';
import { ConfigRepository } from 'src/repositories/config.repository';
import { MachineLearningRepository } from 'src/repositories/machine-learning.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository';
import { clearConfigCache } from 'src/utils/config';
import { Mocked } from 'vitest';
```

Add this setup helper near the existing `setup()`:

```ts
const setupFaceDetection = (db?: Kysely<DB>) => {
  clearConfigCache();

  const { sut, ctx } = newMediumService(PersonService, {
    database: db || defaultDatabase,
    real: [
      AccessRepository,
      AssetRepository,
      AssetJobRepository,
      ConfigRepository,
      DatabaseRepository,
      FaceIdentityRepository,
      PersonRepository,
      SharedSpaceRepository,
    ],
    mock: [JobRepository, LoggingRepository, MachineLearningRepository, StorageRepository, SystemMetadataRepository],
  });

  ctx.getMock<JobRepository, Mocked<JobRepository>>(JobRepository).queue.mockResolvedValue();
  ctx.getMock<JobRepository, Mocked<JobRepository>>(JobRepository).queueAll.mockResolvedValue();
  ctx
    .getMock<SystemMetadataRepository, Mocked<SystemMetadataRepository>>(SystemMetadataRepository)
    .get.mockImplementation(async (key) => {
      if (key === SystemMetadataKey.SystemConfig) {
        return { machineLearning: { facialRecognition: { minFaces: 1 } } } as any;
      }
      return undefined as any;
    });

  return { sut, ctx };
};
```

- [ ] **Step 2: Add helper queries for face rows and identity links**

Add below the setup helper:

```ts
const getAssetFaces = (ctx: ReturnType<typeof setupFaceDetection>['ctx'], assetId: string) =>
  ctx.database
    .selectFrom('asset_face')
    .select(['id', 'assetId', 'personId', 'sourceType'])
    .where('assetId', '=', assetId)
    .orderBy('id')
    .execute();

const getIdentityLinks = (ctx: ReturnType<typeof setupFaceDetection>['ctx'], faceIds: string[]) =>
  ctx.database
    .selectFrom('face_identity_face')
    .select(['assetFaceId', 'identityId', 'source'])
    .where('assetFaceId', 'in', faceIds)
    .orderBy('assetFaceId')
    .execute();
```

- [ ] **Step 3: Add force root preservation medium test**

Add a new `describe('handleQueueDetectFaces safety')` block:

```ts
describe('handleQueueDetectFaces safety', () => {
  it('force detection deletes ML faces and identity links while preserving manual and EXIF evidence', async () => {
    const { sut, ctx } = setupFaceDetection();
    const faceIdentityRepo = ctx.get(FaceIdentityRepository);
    const jobMock = ctx.getMock<JobRepository, Mocked<JobRepository>>(JobRepository);
    const { user } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
    await ctx.newAssetFile({ assetId: asset.id, type: AssetFileType.Preview, path: 'preview.jpg' });
    await ctx.newExif({ assetId: asset.id, exifImageWidth: 200, exifImageHeight: 200 });
    await ctx.newJobStatus({ assetId: asset.id });
    const { person: mlPerson } = await ctx.newPerson({ ownerId: user.id, name: 'ML' });
    const { person: manualPerson } = await ctx.newPerson({ ownerId: user.id, name: 'Manual' });
    const { person: exifPerson } = await ctx.newPerson({ ownerId: user.id, name: 'EXIF' });
    const { result: mlFaceId } = await ctx.newAssetFace({
      assetId: asset.id,
      personId: mlPerson.id,
      sourceType: SourceType.MachineLearning,
    });
    const { result: manualFaceId } = await ctx.newAssetFace({
      assetId: asset.id,
      personId: manualPerson.id,
      sourceType: SourceType.Manual,
    });
    const { result: exifFaceId } = await ctx.newAssetFace({
      assetId: asset.id,
      personId: exifPerson.id,
      sourceType: SourceType.Exif,
    });
    const mlIdentity = await faceIdentityRepo.ensurePersonIdentity(mlPerson.id);
    const manualIdentity = await faceIdentityRepo.ensurePersonIdentity(manualPerson.id);
    const exifIdentity = await faceIdentityRepo.ensurePersonIdentity(exifPerson.id);
    await faceIdentityRepo.replaceFaceIdentity({ assetFaceId: mlFaceId, identityId: mlIdentity.id, source: 'ml' });
    await faceIdentityRepo.replaceFaceIdentity({
      assetFaceId: manualFaceId,
      identityId: manualIdentity.id,
      source: 'manual',
    });
    await faceIdentityRepo.replaceFaceIdentity({
      assetFaceId: exifFaceId,
      identityId: exifIdentity.id,
      source: 'import',
    });
    const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });
    const mlSpacePersonId = factory.uuid();
    const manualSpacePersonId = factory.uuid();
    const exifSpacePersonId = factory.uuid();
    await ctx.database
      .insertInto('shared_space_person')
      .values([
        { id: mlSpacePersonId, spaceId: space.id, identityId: mlIdentity.id, name: 'ML', type: 'person' },
        { id: manualSpacePersonId, spaceId: space.id, identityId: manualIdentity.id, name: 'Manual', type: 'person' },
        { id: exifSpacePersonId, spaceId: space.id, identityId: exifIdentity.id, name: 'EXIF', type: 'person' },
      ])
      .execute();
    await ctx.database
      .insertInto('shared_space_person_face')
      .values([
        { personId: mlSpacePersonId, assetFaceId: mlFaceId },
        { personId: manualSpacePersonId, assetFaceId: manualFaceId },
        { personId: exifSpacePersonId, assetFaceId: exifFaceId },
      ])
      .execute();

    await expect(sut.handleQueueDetectFaces({ force: true })).resolves.toBe(JobStatus.Success);

    await expect(getAssetFaces(ctx, asset.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: manualFaceId, sourceType: SourceType.Manual }),
        expect.objectContaining({ id: exifFaceId, sourceType: SourceType.Exif }),
      ]),
    );
    const remainingFaces = await getAssetFaces(ctx, asset.id);
    expect(remainingFaces.map((face) => face.id)).not.toContain(mlFaceId);
    await expect(getIdentityLinks(ctx, [mlFaceId, manualFaceId, exifFaceId])).resolves.toEqual(
      expect.arrayContaining([
        { assetFaceId: manualFaceId, identityId: manualIdentity.id, source: 'manual' },
        { assetFaceId: exifFaceId, identityId: exifIdentity.id, source: 'import' },
      ]),
    );
    const remainingLinks = await getIdentityLinks(ctx, [mlFaceId, manualFaceId, exifFaceId]);
    expect(remainingLinks.map((link) => link.assetFaceId)).not.toContain(mlFaceId);
    await expect(ctx.get(PersonRepository).getById(manualPerson.id)).resolves.toEqual(
      expect.objectContaining({ id: manualPerson.id }),
    );
    await expect(ctx.get(PersonRepository).getById(exifPerson.id)).resolves.toEqual(
      expect.objectContaining({ id: exifPerson.id }),
    );
    await expect(ctx.get(PersonRepository).getById(mlPerson.id)).resolves.toBeUndefined();
    await expect(
      ctx.database
        .selectFrom('shared_space_person')
        .select(['id', 'identityId', 'name'])
        .where('id', 'in', [mlSpacePersonId, manualSpacePersonId, exifSpacePersonId])
        .orderBy('name')
        .execute(),
    ).resolves.toEqual([
      { id: exifSpacePersonId, identityId: exifIdentity.id, name: 'EXIF' },
      { id: manualSpacePersonId, identityId: manualIdentity.id, name: 'Manual' },
    ]);
    const remainingSpaceFaceLinks = await ctx.database
      .selectFrom('shared_space_person_face')
      .select(['personId', 'assetFaceId'])
      .where('personId', 'in', [mlSpacePersonId, manualSpacePersonId, exifSpacePersonId])
      .execute();
    expect(remainingSpaceFaceLinks).toEqual(
      expect.arrayContaining([
        { personId: manualSpacePersonId, assetFaceId: manualFaceId },
        { personId: exifSpacePersonId, assetFaceId: exifFaceId },
      ]),
    );
    expect(remainingSpaceFaceLinks.map((link) => link.personId)).not.toContain(mlSpacePersonId);
    expect(jobMock.queueAll.mock.calls.flatMap(([jobs]) => jobs)).toContainEqual({
      name: JobName.AssetDetectFaces,
      data: { id: asset.id, force: true },
    });
  });
});
```

- [ ] **Step 4: Add non-force no-detected-faces medium test**

Add:

```ts
it('non-force detection removes stale ML faces without deleting manual or EXIF people', async () => {
  const { sut, ctx } = setupFaceDetection();
  const machineLearningMock = ctx.getMock<MachineLearningRepository, Mocked<MachineLearningRepository>>(
    MachineLearningRepository,
  );
  const { user } = await ctx.newUser();
  const { asset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
  await ctx.newAssetFile({ assetId: asset.id, type: AssetFileType.Preview, path: 'preview.jpg' });
  await ctx.newExif({ assetId: asset.id, exifImageWidth: 200, exifImageHeight: 200 });
  const { person: mlPerson } = await ctx.newPerson({ ownerId: user.id, name: 'ML' });
  const { person: manualPerson } = await ctx.newPerson({ ownerId: user.id, name: 'Manual' });
  const { person: exifPerson } = await ctx.newPerson({ ownerId: user.id, name: 'EXIF' });
  const { result: mlFaceId } = await ctx.newAssetFace({
    assetId: asset.id,
    personId: mlPerson.id,
    sourceType: SourceType.MachineLearning,
  });
  const { result: manualFaceId } = await ctx.newAssetFace({
    assetId: asset.id,
    personId: manualPerson.id,
    sourceType: SourceType.Manual,
  });
  const { result: exifFaceId } = await ctx.newAssetFace({
    assetId: asset.id,
    personId: exifPerson.id,
    sourceType: SourceType.Exif,
  });
  machineLearningMock.detectFaces.mockResolvedValue({ imageWidth: 200, imageHeight: 200, faces: [] });

  await expect(sut.handleDetectFaces({ id: asset.id })).resolves.toBe(JobStatus.Success);

  const remainingFaces = await getAssetFaces(ctx, asset.id);
  expect(remainingFaces.map((face) => face.id)).toEqual(expect.arrayContaining([manualFaceId, exifFaceId]));
  expect(remainingFaces.map((face) => face.id)).not.toContain(mlFaceId);
  await expect(ctx.get(PersonRepository).getById(manualPerson.id)).resolves.toEqual(
    expect.objectContaining({ id: manualPerson.id }),
  );
  await expect(ctx.get(PersonRepository).getById(exifPerson.id)).resolves.toEqual(
    expect.objectContaining({ id: exifPerson.id }),
  );
  await expect(ctx.get(PersonRepository).getById(mlPerson.id)).resolves.toEqual(
    expect.objectContaining({ id: mlPerson.id }),
  );
  await expect(
    ctx.database
      .selectFrom('asset_job_status')
      .select('facesRecognizedAt')
      .where('assetId', '=', asset.id)
      .executeTakeFirstOrThrow(),
  ).resolves.toEqual({ facesRecognizedAt: expect.any(Date) });
});
```

- [ ] **Step 5: Add shared-space projection preservation medium test**

Add:

```ts
it('non-force detection preserves existing shared-space people for manual, EXIF, and stale ML identities', async () => {
  const { sut, ctx } = setupFaceDetection();
  const machineLearningMock = ctx.getMock<MachineLearningRepository, Mocked<MachineLearningRepository>>(
    MachineLearningRepository,
  );
  const faceIdentityRepo = ctx.get(FaceIdentityRepository);
  const { user } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
  const { asset } = await ctx.newAsset({ ownerId: user.id });
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });
  await ctx.newAssetFile({ assetId: asset.id, type: AssetFileType.Preview, path: 'preview.jpg' });
  await ctx.newExif({ assetId: asset.id, exifImageWidth: 200, exifImageHeight: 200 });
  const { person: mlPerson } = await ctx.newPerson({ ownerId: user.id, name: 'ML' });
  const { person: manualPerson } = await ctx.newPerson({ ownerId: user.id, name: 'Manual' });
  const { person: exifPerson } = await ctx.newPerson({ ownerId: user.id, name: 'EXIF' });
  const { result: mlFaceId } = await ctx.newAssetFace({
    assetId: asset.id,
    personId: mlPerson.id,
    sourceType: SourceType.MachineLearning,
  });
  const { result: manualFaceId } = await ctx.newAssetFace({
    assetId: asset.id,
    personId: manualPerson.id,
    sourceType: SourceType.Manual,
  });
  const { result: exifFaceId } = await ctx.newAssetFace({
    assetId: asset.id,
    personId: exifPerson.id,
    sourceType: SourceType.Exif,
  });
  const mlIdentity = await faceIdentityRepo.ensurePersonIdentity(mlPerson.id);
  const manualIdentity = await faceIdentityRepo.ensurePersonIdentity(manualPerson.id);
  const exifIdentity = await faceIdentityRepo.ensurePersonIdentity(exifPerson.id);
  await faceIdentityRepo.replaceFaceIdentity({
    assetFaceId: mlFaceId,
    identityId: mlIdentity.id,
    source: 'ml',
  });
  await faceIdentityRepo.replaceFaceIdentity({
    assetFaceId: manualFaceId,
    identityId: manualIdentity.id,
    source: 'manual',
  });
  await faceIdentityRepo.replaceFaceIdentity({
    assetFaceId: exifFaceId,
    identityId: exifIdentity.id,
    source: 'import',
  });
  const mlSpacePersonId = factory.uuid();
  const manualSpacePersonId = factory.uuid();
  const exifSpacePersonId = factory.uuid();
  await ctx.database
    .insertInto('shared_space_person')
    .values([
      { id: mlSpacePersonId, spaceId: space.id, identityId: mlIdentity.id, name: 'ML', type: 'person' },
      { id: manualSpacePersonId, spaceId: space.id, identityId: manualIdentity.id, name: 'Manual', type: 'person' },
      { id: exifSpacePersonId, spaceId: space.id, identityId: exifIdentity.id, name: 'EXIF', type: 'person' },
    ])
    .execute();
  await ctx.database
    .insertInto('shared_space_person_face')
    .values([
      { personId: mlSpacePersonId, assetFaceId: mlFaceId },
      { personId: manualSpacePersonId, assetFaceId: manualFaceId },
      { personId: exifSpacePersonId, assetFaceId: exifFaceId },
    ])
    .execute();
  machineLearningMock.detectFaces.mockResolvedValue({ imageWidth: 200, imageHeight: 200, faces: [] });

  await expect(sut.handleDetectFaces({ id: asset.id })).resolves.toBe(JobStatus.Success);

  await expect(
    ctx.database
      .selectFrom('shared_space_person')
      .select(['id', 'identityId', 'name'])
      .where('id', 'in', [mlSpacePersonId, manualSpacePersonId, exifSpacePersonId])
      .orderBy('name')
      .execute(),
  ).resolves.toEqual([
    { id: exifSpacePersonId, identityId: exifIdentity.id, name: 'EXIF' },
    { id: mlSpacePersonId, identityId: mlIdentity.id, name: 'ML' },
    { id: manualSpacePersonId, identityId: manualIdentity.id, name: 'Manual' },
  ]);
  const remainingSpaceFaceLinks = await ctx.database
    .selectFrom('shared_space_person_face')
    .select(['personId', 'assetFaceId'])
    .where('personId', 'in', [mlSpacePersonId, manualSpacePersonId, exifSpacePersonId])
    .execute();
  expect(remainingSpaceFaceLinks).toEqual(
    expect.arrayContaining([
      { personId: manualSpacePersonId, assetFaceId: manualFaceId },
      { personId: exifSpacePersonId, assetFaceId: exifFaceId },
    ]),
  );
  expect(remainingSpaceFaceLinks.map((link) => link.personId)).not.toContain(mlSpacePersonId);
  expect(remainingSpaceFaceLinks.map((link) => link.assetFaceId)).not.toContain(mlFaceId);
});
```

- [ ] **Step 6: Run focused medium service tests**

Run:

```bash
pnpm --filter immich test:medium -- --run test/medium/specs/services/person.service.spec.ts -t "face detection"
```

Expected: the new medium tests pass or expose a real destructive-state bug.

- [ ] **Step 7: Commit Task 5**

Run:

```bash
git add server/test/medium/specs/services/person.service.spec.ts server/src/services/person.service.ts
git commit -m "test: cover face detection destructive state"
```

If no production file changed, omit it from `git add`.

## Task 6: Medium Repository `refreshFaces()` Safety

**Files:**

- Modify: `server/test/medium/specs/repositories/person.repository.spec.ts`
- Modify only if tests expose a bug: `server/src/repositories/person.repository.ts`

- [ ] **Step 1: Add repository `refreshFaces()` import coverage**

At the top of `server/test/medium/specs/repositories/person.repository.spec.ts`, ensure these imports exist:

```ts
import { SourceType } from 'src/enum';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository';
import { newEmbedding } from 'test/small.factory';
```

`FaceIdentityRepository` is already imported in this file; only add missing imports.

- [ ] **Step 2: Add `refreshFaces()` preservation test**

Add this near existing face repository tests:

```ts
describe('refreshFaces', () => {
  it('deletes only requested ML faces, cascades only those identity links, and preserves manual and EXIF evidence', async () => {
    const { ctx, sut } = setup();
    const faceIdentityRepository = ctx.get(FaceIdentityRepository);
    const { user } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const { person: mlPerson } = await ctx.newPerson({ ownerId: user.id, name: 'ML' });
    const { person: manualPerson } = await ctx.newPerson({ ownerId: user.id, name: 'Manual' });
    const { person: exifPerson } = await ctx.newPerson({ ownerId: user.id, name: 'EXIF' });
    const { result: mlFaceId } = await ctx.newAssetFace({
      assetId: asset.id,
      personId: mlPerson.id,
      sourceType: SourceType.MachineLearning,
    });
    const { result: manualFaceId } = await ctx.newAssetFace({
      assetId: asset.id,
      personId: manualPerson.id,
      sourceType: SourceType.Manual,
    });
    const { result: exifFaceId } = await ctx.newAssetFace({
      assetId: asset.id,
      personId: exifPerson.id,
      sourceType: SourceType.Exif,
    });
    const mlIdentity = await faceIdentityRepository.ensurePersonIdentity(mlPerson.id);
    const manualIdentity = await faceIdentityRepository.ensurePersonIdentity(manualPerson.id);
    const exifIdentity = await faceIdentityRepository.ensurePersonIdentity(exifPerson.id);
    await faceIdentityRepository.replaceFaceIdentity({
      assetFaceId: mlFaceId,
      identityId: mlIdentity.id,
      source: 'ml',
    });
    await faceIdentityRepository.replaceFaceIdentity({
      assetFaceId: manualFaceId,
      identityId: manualIdentity.id,
      source: 'manual',
    });
    await faceIdentityRepository.replaceFaceIdentity({
      assetFaceId: exifFaceId,
      identityId: exifIdentity.id,
      source: 'import',
    });
    const newFaceId = '11111111-1111-4111-8111-111111111111';
    const embedding = newEmbedding();

    await sut.refreshFaces(
      [
        {
          id: newFaceId,
          assetId: asset.id,
          imageWidth: 200,
          imageHeight: 200,
          boundingBoxX1: 10,
          boundingBoxY1: 10,
          boundingBoxX2: 60,
          boundingBoxY2: 60,
        },
      ],
      [mlFaceId],
      [{ faceId: newFaceId, embedding }],
    );

    const faceRows = await ctx.database
      .selectFrom('asset_face')
      .select(['id', 'sourceType'])
      .where('assetId', '=', asset.id)
      .execute();
    expect(faceRows).toEqual(
      expect.arrayContaining([
        { id: manualFaceId, sourceType: SourceType.Manual },
        { id: exifFaceId, sourceType: SourceType.Exif },
        { id: newFaceId, sourceType: SourceType.MachineLearning },
      ]),
    );
    expect(faceRows.map((face) => face.id)).not.toContain(mlFaceId);

    const links = await ctx.database
      .selectFrom('face_identity_face')
      .select(['assetFaceId', 'identityId', 'source'])
      .where('assetFaceId', 'in', [mlFaceId, manualFaceId, exifFaceId])
      .execute();
    expect(links).toEqual(
      expect.arrayContaining([
        { assetFaceId: manualFaceId, identityId: manualIdentity.id, source: 'manual' },
        { assetFaceId: exifFaceId, identityId: exifIdentity.id, source: 'import' },
      ]),
    );
    expect(links.map((link) => link.assetFaceId)).not.toContain(mlFaceId);
    await expect(
      ctx.database.selectFrom('face_search').select(['faceId']).where('faceId', '=', newFaceId).executeTakeFirst(),
    ).resolves.toEqual({ faceId: newFaceId });
  });
});
```

- [ ] **Step 3: Add empty-input no-op coverage**

Add:

```ts
it('does not mutate face rows when refreshFaces receives no inserts, removals, or embeddings', async () => {
  const { ctx, sut } = setup();
  const { user } = await ctx.newUser();
  const { asset } = await ctx.newAsset({ ownerId: user.id });
  const { result: manualFaceId } = await ctx.newAssetFace({
    assetId: asset.id,
    sourceType: SourceType.Manual,
  });

  await sut.refreshFaces([], [], []);

  await expect(
    ctx.database.selectFrom('asset_face').select(['id', 'sourceType']).where('assetId', '=', asset.id).execute(),
  ).resolves.toEqual([{ id: manualFaceId, sourceType: SourceType.Manual }]);
});
```

- [ ] **Step 4: Run focused repository tests**

Run:

```bash
pnpm --filter immich test:medium -- --run test/medium/specs/repositories/person.repository.spec.ts -t "refreshFaces"
```

Expected: focused repository tests pass.

- [ ] **Step 5: Commit Task 6**

Run:

```bash
git add server/test/medium/specs/repositories/person.repository.spec.ts server/src/repositories/person.repository.ts
git commit -m "test: cover refreshFaces row safety"
```

If no production file changed, omit it from `git add`.

## Task 7: Final Verification And Review

**Files:**

- Verify: all Slice 2 touched files.

- [ ] **Step 1: Run small spec**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter immich exec vitest --config test/vitest.config.mjs run src/services/person.service.spec.ts
```

Expected: all `person.service.spec.ts` small tests pass.

- [ ] **Step 2: Run medium specs**

Run:

```bash
pnpm --filter immich test:medium -- --run test/medium/specs/services/person.service.spec.ts test/medium/specs/repositories/person.repository.spec.ts
```

Expected: both medium specs pass. If local environment fails for Docker, Postgres client limits, or missing submodule test assets, capture the exact failure and require CI confirmation before merge.

- [ ] **Step 3: Run type and formatting checks**

Run:

```bash
pnpm --filter immich check
pnpm --dir server exec prettier --check src/services/person.service.spec.ts test/medium/specs/services/person.service.spec.ts test/medium/specs/repositories/person.repository.spec.ts
```

Expected: both commands pass.

- [ ] **Step 4: Run placeholder scan on this plan**

Run:

```bash
rg -n "T[B]D|TO[D]O|FIX[M]E|place[ ]holder|\\?\\?\\?" docs/superpowers/plans/2026-05-17-face-detection-safety.md
```

Expected: no output.

- [ ] **Step 5: Review destructive invariant coverage**

Verify the final diff covers each Slice 2 invariant:

- `force=true`, `force=false`, and omitted `force`
- force root deletes only `SourceType.MachineLearning` faces
- removed ML faces lose identity links
- manual and EXIF `asset_face` rows survive force and non-force paths
- manual and EXIF `face_identity_face` rows survive
- non-force stale-face detection does not delete personal people or shared-space people globally, including ML-backed people whose stale face rows were removed
- populated per-asset `force=true` detection removes only stale ML face ids, preserves manual/EXIF evidence, and queues only the forced recognition coordinator
- missing asset, no preview, multiple preview files, hidden asset, ML-disabled, ML-error, refresh-error, and queue-error paths do not write `facesRecognizedAt`
- no detected faces removes stale ML faces but not manual/EXIF faces
- matching detection adds embeddings to existing EXIF/manual faces instead of creating duplicates
- matching detection keeps existing ML faces without deleting, recreating, or duplicating them
- changed dimensions with high IOU preserve existing metadata faces
- changed dimensions with low IOU create new ML faces
- successful non-force new faces queue `FacialRecognitionQueueAll(force:false)` and per-face `FacialRecognition`
- successful force new faces queue only `FacialRecognitionQueueAll(force:true)`
- medium repository tests prove `refreshFaces()` deletes only supplied ids and preserves unrelated rows

- [ ] **Step 6: Commit final verification notes if needed**

No commit is needed for verification-only work. If a formatting-only fix is required, commit it separately:

```bash
git add server/src/services/person.service.spec.ts server/test/medium/specs/services/person.service.spec.ts server/test/medium/specs/repositories/person.repository.spec.ts
git commit -m "test: format face detection safety specs"
```

## Execution Notes

- Keep Slice 2 scoped to face detection safety. Recognition queue draining, force recognition reset ordering, and overnight stuck-queue behavior belong to Slice 3 and Slice 8.
- Prefer small tests for service call contracts. Use medium tests only when the assertion requires real DB cascades or real row preservation.
- Any production change must be justified by a failing test from this plan.
- When using `queueAll` negative assertions, flatten jobs and assert each forbidden job name individually.
- When adding medium tests that depend on config, call `clearConfigCache()` in the setup helper before constructing the service.

## Self-Review

- Spec coverage: every Slice 2 bullet from `docs/superpowers/specs/2026-05-17-face-identity-queue-testing-plan-design.md` maps to Task 1 through Task 7.
- Placeholder scan: this plan avoids unresolved placeholders and includes exact commands, file paths, and test code shapes.
- Type consistency: all snippets use existing `PersonService`, repository, factory, enum, and job names observed in the current codebase.
