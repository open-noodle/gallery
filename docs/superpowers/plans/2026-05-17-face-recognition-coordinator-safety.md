# Face Recognition Coordinator Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Slice 3 coverage proving the facial-recognition coordinator skips, drains, resets, queues, and hands off maintenance work without destructive surprises, especially for overnight issue #597-style queue states.

**Architecture:** Keep most coverage in small unit specs for `PersonService` and `JobRepository`, because Slice 3 is primarily queue orchestration and call ordering. Add medium database tests only for the destructive force-recognition reset over populated face identity state. Production changes are allowed only when the new TDD tests prove a real coordinator bug; expected candidate fixes are limited to `server/src/services/person.service.ts` and `server/src/repositories/job.repository.ts`.

**Tech Stack:** TypeScript, NestJS service tests, Vitest, Gallery small test factories, Gallery medium DB test harness, Kysely, BullMQ job names, BullMQ queue states.

---

## File Structure

- Modify: `server/src/services/person.service.spec.ts`
  - Owns small unit coverage for `handleQueueRecognizeFaces()` ordering, skip behavior, force-reset scope, per-face job fan-out, shared-space full-rebuild fan-out, maintenance marker ordering, and `handleFaceIdentityMaintenanceAfterRecognition()`.
- Modify only if a new failing small test proves a coordinator bug: `server/src/services/person.service.ts`
  - Owns the actual recognition coordinator and maintenance marker implementations.
- Modify: `server/src/repositories/job.repository.spec.ts`
  - Owns stable job replacement and dedupe coverage for `FacialRecognitionQueueAll` and its force follow-up stable job.
- Modify only if a new failing repository test proves a stable-job bug: `server/src/repositories/job.repository.ts`
  - Owns BullMQ stable-job replacement behavior.
- Modify: `server/test/medium/specs/services/person.service.spec.ts`
  - Owns DB-backed destructive-state coverage for force recognition over populated ML, manual, EXIF, and shared-space identity data.

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
/home/pierre/dev/gallery/.worktrees/face-trigger-slice-3-plan
codex/face-trigger-slice-3-plan
```

`git status --short` must be empty before editing. If it is not empty, inspect every listed file and preserve user-owned work.

- [ ] **Step 2: Run the Slice 3 baseline small specs**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter immich exec vitest --config test/vitest.config.mjs run src/services/person.service.spec.ts src/repositories/job.repository.spec.ts src/services/queue.service.spec.ts
```

Expected: all three specs pass before new tests are added. The `queue.service.spec.ts` run confirms Slice 1 scheduled/admin trigger coverage still passes after the Slice 3 branch starts.

- [ ] **Step 3: Run the Slice 3 baseline medium service spec**

Run:

```bash
pnpm --filter immich test:medium --run test/medium/specs/services/person.service.spec.ts
```

Expected: the medium service spec passes before new DB-backed recognition tests are added.

## TDD Protocol For This Slice

- [ ] **Step 1: Write the failing or coverage test first**

Add the new test before editing production code. For coverage of existing behavior, it may pass immediately.

- [ ] **Step 2: Run the smallest focused selector**

Run the exact `-t` selector from each task. Expected result:

- FAIL when the current implementation violates the Slice 3 contract.
- PASS when the contract already exists and this is coverage-only.

- [ ] **Step 3: Make the smallest production fix only after a failing test proves it**

Do not change per-face recognition assignment, shared-space matching internals, identity backfill pagination, or manual people operations in this slice.

- [ ] **Step 4: Prove assertions can fail**

For each touched spec file, temporarily change one expected `QueueName`, `JobName`, `SourceType`, queue-state count, or persisted face id to an intentionally wrong value, run the focused test and confirm it fails, then restore the correct expectation before committing.

## Spec Coverage Map

- Nightly recognition skip before queue drains or destructive reset: Task 1.
- Non-force recognition with waiting, delayed, paused, or extra active work skips without destructive work or duplicate fan-out: Task 2.
- Force recognition waits for thumbnail, face detection, and people backfill prerequisites before draining and deleting assignments: Task 3.
- Force recognition unassigns and unlinks only machine-learning faces, queues only ML face jobs, suppresses per-face shared-space matching, queues enabled-space full rebuild jobs, queues the terminal maintenance marker, and writes last-run state: Task 3 and Task 6.
- Maintenance marker requeues while recognition work is waiting, delayed, paused, or still active; queues backfill only after the queue is drained and no backfill is active/pending: Task 4.
- Failed or paused stable coordinator jobs do not permanently block legitimate future coordinator work: Task 5.
- Force recognition over populated DB state preserves manual/EXIF asset faces and identity links, clears only intended ML assignment/link state, wipes shared-space people by design, and idempotently queues the coordinator rebuild handoff over repeated force runs: Task 6.
- Cross-slice overnight chains with library scan and EXIF import remain Slice 8. Per-face recognition assignment remains Slice 4.

## Shared Small-Spec Helpers

- [ ] **Step 1: Add coordinator helper functions**

In `server/src/services/person.service.spec.ts`, add this import with the existing DTO imports:

```ts
import { QueueStatisticsDto } from 'src/dtos/queue.dto';
```

Then place these helpers near the existing top-level test helpers inside `describe(PersonService.name, () => { ... })`, after `expectNoRecognitionFanout()`:

```ts
const recognitionCounts = (overrides: Partial<QueueStatisticsDto> = {}) =>
  factory.queueStatistics({
    active: 1,
    waiting: 0,
    delayed: 0,
    paused: 0,
    completed: 0,
    failed: 0,
    ...overrides,
  });

const expectNoRecognitionCoordinatorMutation = () => {
  expect(mocks.job.empty).not.toHaveBeenCalled();
  expect(mocks.database.prewarm).not.toHaveBeenCalled();
  expect(mocks.person.unassignFaces).not.toHaveBeenCalled();
  expect(mocks.faceIdentity.unlinkFacesBySourceType).not.toHaveBeenCalled();
  expect(mocks.sharedSpace.deleteAllPersonFaces).not.toHaveBeenCalled();
  expect(mocks.sharedSpace.deleteAllPersons).not.toHaveBeenCalled();
  expect((mocks.faceIdentity as any).deleteUnreferencedIdentities).not.toHaveBeenCalled();
  expect(mocks.person.vacuum).not.toHaveBeenCalled();
  expect(mocks.job.queueAll).not.toHaveBeenCalled();
  expect(mocks.job.queue).not.toHaveBeenCalledWith({
    name: JobName.FaceIdentityMaintenanceAfterRecognition,
    data: expect.anything(),
  });
  expect(mocks.job.queue).not.toHaveBeenCalledWith({ name: JobName.FaceIdentityBackfill, data: {} });
  expect(mocks.systemMetadata.set).not.toHaveBeenCalled();
};
```

- [ ] **Step 2: Run the helper compile check**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter immich exec vitest --config test/vitest.config.mjs run src/services/person.service.spec.ts -t "handleQueueRecognizeFaces"
```

Expected: existing `handleQueueRecognizeFaces` tests still compile and pass before new tests are added.

## Task 1: Nightly Recognition Skip Must Happen Before Queue Wait And Reset

**Files:**

- Modify: `server/src/services/person.service.spec.ts`
- Modify only if the new test fails: `server/src/services/person.service.ts`

- [ ] **Step 1: Write the failing early-skip tests**

In `describe('handleQueueRecognizeFaces')`, add:

```ts
it.each([
  ['scheduled non-force nightly', { force: false, nightly: true }],
  ['defensive force+nightly payload', { force: true, nightly: true }],
] as const)('skips %s before prerequisite waits or destructive reset when no new faces exist', async (_label, data) => {
  const lastRun = new Date('2026-05-17T02:00:00.000Z');
  mocks.systemMetadata.get.mockResolvedValue({ lastRun: lastRun.toISOString() });
  mocks.person.getLatestFaceDate.mockResolvedValue(new Date(lastRun.getTime() - 1_000).toISOString());
  mocks.job.getJobCounts.mockResolvedValue(recognitionCounts({ waiting: 25_000, delayed: 1_000, paused: 3 }));

  await expect(sut.handleQueueRecognizeFaces(data)).resolves.toBe(JobStatus.Skipped);

  expect(mocks.systemMetadata.get).toHaveBeenCalledWith(SystemMetadataKey.FacialRecognitionState);
  expect(mocks.person.getLatestFaceDate).toHaveBeenCalledOnce();
  expect(mocks.job.waitForQueueCompletion).not.toHaveBeenCalled();
  expect(mocks.person.getAllFaces).not.toHaveBeenCalled();
  expectNoRecognitionCoordinatorMutation();
});
```

This is the Slice 3 issue #597 guard: a nightly skip must happen before waiting for queues and before any force-style wipe.

- [ ] **Step 2: Run the focused test and observe the failure**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter immich exec vitest --config test/vitest.config.mjs run src/services/person.service.spec.ts -t "skips .* before prerequisite waits"
```

Expected on current `origin/main`: FAIL because `handleQueueRecognizeFaces()` waits for thumbnail/face-detection queues before the nightly freshness skip.

- [ ] **Step 3: Move the nightly freshness skip before prerequisite queue waits**

In `server/src/services/person.service.ts`, move the existing `if (nightly) { ... }` block so it runs immediately after the facial-recognition-enabled check and before `waitForQueueCompletion(...)`.

The resulting structure must be:

```ts
const { machineLearning } = await this.getConfig({ withCache: false });
if (!isFacialRecognitionEnabled(machineLearning)) {
  return JobStatus.Skipped;
}

if (nightly) {
  const [state, latestFaceDate] = await Promise.all([
    this.systemMetadataRepository.get(SystemMetadataKey.FacialRecognitionState),
    this.personRepository.getLatestFaceDate(),
  ]);

  if (state?.lastRun && latestFaceDate && state.lastRun > latestFaceDate) {
    this.logger.debug('Skipping facial recognition nightly since no face has been added since the last run');
    return JobStatus.Skipped;
  }
}

await this.jobRepository.waitForQueueCompletion(QueueName.ThumbnailGeneration, QueueName.FaceDetection);
```

Do not change the skip comparison in this task.

- [ ] **Step 4: Re-run the focused test**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter immich exec vitest --config test/vitest.config.mjs run src/services/person.service.spec.ts -t "skips .* before prerequisite waits"
```

Expected: PASS.

- [ ] **Step 5: Prove the assertion can fail**

Temporarily change `expect(mocks.job.waitForQueueCompletion).not.toHaveBeenCalled();` to `toHaveBeenCalled();`, run the focused selector, confirm it fails, then restore the correct assertion.

- [ ] **Step 6: Commit Task 1**

Run:

```bash
git add server/src/services/person.service.spec.ts server/src/services/person.service.ts
git commit -m "test: cover nightly recognition early skip"
```

## Task 2: Non-Force Recognition Must Skip For All Pending Queue States

**Files:**

- Modify: `server/src/services/person.service.spec.ts`
- Modify only if the new test fails: `server/src/services/person.service.ts`

- [ ] **Step 1: Add table-driven pending-state skip coverage**

In `describe('handleQueueRecognizeFaces')`, add:

```ts
it.each([
  ['waiting jobs', { waiting: 87_000 }],
  ['delayed jobs', { delayed: 42 }],
  ['paused jobs', { paused: 9 }],
  ['another active job besides the coordinator', { active: 2 }],
] as const)('skips non-force recognition when FacialRecognition has %s', async (_label, counts) => {
  mocks.job.getJobCounts.mockResolvedValue(recognitionCounts(counts));
  mocks.person.getAllFaces.mockReturnValue(makeStream([AssetFaceFactory.create()]));

  await expect(sut.handleQueueRecognizeFaces({ force: false })).resolves.toBe(JobStatus.Skipped);

  expect(mocks.job.waitForQueueCompletion).toHaveBeenCalledWith(QueueName.ThumbnailGeneration, QueueName.FaceDetection);
  expectNoRecognitionCoordinatorMutation();
});
```

This test treats `active: 1` as the running coordinator itself and `active > 1` as additional recognition work that must block new non-force fan-out.

- [ ] **Step 2: Add issue #597-sized nightly pending-state coverage**

In the same `describe`, add:

```ts
it('does not expand a large stuck nightly queue or clear shared-space people', async () => {
  mocks.systemMetadata.get.mockResolvedValue({ lastRun: '2026-05-16T00:00:00.000Z' });
  mocks.person.getLatestFaceDate.mockResolvedValue('2026-05-17T00:00:00.000Z');
  mocks.job.getJobCounts.mockResolvedValue(recognitionCounts({ waiting: 87_000 }));
  mocks.person.getAllFaces.mockReturnValue(makeStream([AssetFaceFactory.create()]));

  await expect(sut.handleQueueRecognizeFaces({ force: false, nightly: true })).resolves.toBe(JobStatus.Skipped);

  expect(mocks.job.queueAll).not.toHaveBeenCalledWith(
    expect.arrayContaining([expect.objectContaining({ name: JobName.FacialRecognition })]),
  );
  expect(mocks.job.queue).not.toHaveBeenCalledWith({
    name: JobName.FaceIdentityMaintenanceAfterRecognition,
    data: expect.anything(),
  });
  expect(mocks.job.queue).not.toHaveBeenCalledWith({ name: JobName.FaceIdentityBackfill, data: {} });
  expect(mocks.sharedSpace.deleteAllPersonFaces).not.toHaveBeenCalled();
  expect(mocks.sharedSpace.deleteAllPersons).not.toHaveBeenCalled();
  expect(mocks.systemMetadata.set).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Run the focused tests and observe failures**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter immich exec vitest --config test/vitest.config.mjs run src/services/person.service.spec.ts -t "skips non-force recognition|large stuck nightly"
```

Expected on current `origin/main`: FAIL for delayed, paused, or extra-active cases if the coordinator only checks `waiting`.

- [ ] **Step 4: Broaden the non-force pending guard**

In `server/src/services/person.service.ts`, replace:

```ts
const { waiting } = await this.jobRepository.getJobCounts(QueueName.FacialRecognition);
```

with:

```ts
const { active, delayed, paused, waiting } = await this.jobRepository.getJobCounts(QueueName.FacialRecognition);
const hasOtherActiveRecognitionWork = active > 1;
const hasPendingRecognitionWork = waiting > 0 || delayed > 0 || paused > 0 || hasOtherActiveRecognitionWork;
```

Then replace the non-force guard:

```ts
} else if (waiting) {
  this.logger.debug(
    `Skipping facial recognition queueing because ${waiting} job${waiting > 1 ? 's are' : ' is'} already queued`,
  );
  return JobStatus.Skipped;
}
```

with:

```ts
} else if (hasPendingRecognitionWork) {
  this.logger.debug(
    `Skipping facial recognition queueing because recognition work is already pending ` +
      `(${active} active, ${waiting} waiting, ${delayed} delayed, ${paused} paused)`,
  );
  return JobStatus.Skipped;
}
```

- [ ] **Step 5: Re-run the focused tests**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter immich exec vitest --config test/vitest.config.mjs run src/services/person.service.spec.ts -t "skips non-force recognition|large stuck nightly"
```

Expected: PASS.

- [ ] **Step 6: Prove the assertion can fail**

Temporarily change the paused row to expect `JobStatus.Success`, run the focused selector, confirm it fails, then restore `JobStatus.Skipped`.

- [ ] **Step 7: Commit Task 2**

Run:

```bash
git add server/src/services/person.service.spec.ts server/src/services/person.service.ts
git commit -m "test: cover recognition pending-state skips"
```

## Task 3: Force Recognition Reset Ordering, Source Scope, And Full-Space Fan-Out

**Files:**

- Modify: `server/src/services/person.service.spec.ts`
- Modify only if the new tests fail: `server/src/services/person.service.ts`

- [ ] **Step 1: Strengthen prerequisite wait ordering**

Replace the current force-reset wait assertion test with:

```ts
it('force recognition waits for thumbnail, face detection, and people backfill before draining and clearing identities', async () => {
  const face = AssetFaceFactory.create();
  mocks.job.getJobCounts.mockResolvedValue(recognitionCounts());
  mocks.person.getAllFaces.mockReturnValue(makeStream([face]));
  mocks.person.getAllWithoutFaces.mockResolvedValue([]);
  mocks.sharedSpace.deleteAllPersonFaces.mockResolvedValue(void 0 as any);
  mocks.sharedSpace.deleteAllPersons.mockResolvedValue(void 0 as any);
  mocks.sharedSpace.getSpaceIdsWithFaceRecognitionEnabled.mockResolvedValue([]);

  await expect(sut.handleQueueRecognizeFaces({ force: true })).resolves.toBe(JobStatus.Success);

  expect(mocks.job.waitForQueueCompletion).toHaveBeenCalledWith(
    QueueName.ThumbnailGeneration,
    QueueName.FaceDetection,
    QueueName.PeopleBackfill,
  );
  expect(mocks.job.waitForQueueCompletion.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.job.empty.mock.invocationCallOrder[0],
  );
  expect(mocks.job.empty.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.person.unassignFaces.mock.invocationCallOrder[0],
  );
  expect(mocks.job.empty.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.faceIdentity.unlinkFacesBySourceType.mock.invocationCallOrder[0],
  );
  expect(mocks.job.empty.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.sharedSpace.deleteAllPersonFaces.mock.invocationCallOrder[0],
  );
  expect(mocks.job.empty.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.sharedSpace.deleteAllPersons.mock.invocationCallOrder[0],
  );
});
```

This prevents force recognition from wiping shared-space people while identity backfill still has work in flight.

- [ ] **Step 2: Add full reset collaborator contract coverage**

In the same `describe`, add:

```ts
it('force recognition performs the full ML reset and maintenance handoff contract', async () => {
  const mlFace = AssetFaceFactory.from({ sourceType: SourceType.MachineLearning }).person().build();
  const orphan = PersonFactory.create();
  mocks.job.getJobCounts.mockResolvedValue(recognitionCounts());
  mocks.person.getAllFaces.mockReturnValue(makeStream([mlFace]));
  mocks.person.getAllWithoutFaces.mockResolvedValue([orphan]);
  mocks.sharedSpace.deleteAllPersonFaces.mockResolvedValue(void 0 as any);
  mocks.sharedSpace.deleteAllPersons.mockResolvedValue(void 0 as any);
  mocks.sharedSpace.getSpaceIdsWithFaceRecognitionEnabled.mockResolvedValue(['enabled-space']);

  await expect(sut.handleQueueRecognizeFaces({ force: true })).resolves.toBe(JobStatus.Success);

  expect(mocks.job.empty).toHaveBeenCalledWith(QueueName.FacialRecognition, true);
  expect(mocks.person.unassignFaces).toHaveBeenCalledWith({ sourceType: SourceType.MachineLearning });
  expect(mocks.faceIdentity.unlinkFacesBySourceType).toHaveBeenCalledWith(SourceType.MachineLearning);
  expect(mocks.person.delete).toHaveBeenCalledWith([orphan.id]);
  expect(mocks.job.queue).toHaveBeenCalledWith({
    name: JobName.FileDelete,
    data: { files: [orphan.thumbnailPath] },
  });
  expect(mocks.person.vacuum).toHaveBeenCalledWith({ reindexVectors: false });
  expect(mocks.sharedSpace.deleteAllPersonFaces).toHaveBeenCalledOnce();
  expect(mocks.sharedSpace.deleteAllPersons).toHaveBeenCalledOnce();
  expect((mocks.faceIdentity as any).deleteUnreferencedIdentities).toHaveBeenCalledOnce();
  expect(mocks.job.queueAll).toHaveBeenCalledWith([
    {
      name: JobName.FacialRecognition,
      data: { id: mlFace.id, deferred: false, skipSharedSpaceMatch: true },
    },
  ]);
  expect(mocks.job.queueAll).toHaveBeenCalledWith([
    { name: JobName.SharedSpaceFaceMatchAll, data: { spaceId: 'enabled-space' } },
  ]);
  expect(mocks.job.queue).toHaveBeenCalledWith({
    name: JobName.FaceIdentityMaintenanceAfterRecognition,
    data: {},
  });
  expect(mocks.systemMetadata.set).toHaveBeenCalledWith(SystemMetadataKey.FacialRecognitionState, {
    lastRun: expect.any(String),
  });
});
```

This test pins the complete force reset collaborator contract in the fast unit suite. The medium tests in Task 6 then prove the same reset does not destroy preserved DB evidence.

- [ ] **Step 3: Add ML-only force fan-out scope coverage**

In the same `describe`, add:

```ts
it('force recognition queues only machine-learning faces and suppresses per-face shared-space matching', async () => {
  const mlFace = AssetFaceFactory.from({ sourceType: SourceType.MachineLearning }).person().build();
  mocks.job.getJobCounts.mockResolvedValue(recognitionCounts());
  mocks.person.getAllFaces.mockReturnValue(makeStream([mlFace]));
  mocks.person.getAllWithoutFaces.mockResolvedValue([]);
  mocks.sharedSpace.deleteAllPersonFaces.mockResolvedValue(void 0 as any);
  mocks.sharedSpace.deleteAllPersons.mockResolvedValue(void 0 as any);
  mocks.sharedSpace.getSpaceIdsWithFaceRecognitionEnabled.mockResolvedValue([]);

  await expect(sut.handleQueueRecognizeFaces({ force: true })).resolves.toBe(JobStatus.Success);

  expect(mocks.person.getAllFaces).toHaveBeenCalledWith({ sourceType: SourceType.MachineLearning });
  expect(mocks.person.getAllFaces).not.toHaveBeenCalledWith(undefined);
  expect(mocks.job.queueAll).toHaveBeenCalledWith([
    {
      name: JobName.FacialRecognition,
      data: { id: mlFace.id, deferred: false, skipSharedSpaceMatch: true },
    },
  ]);
});
```

- [ ] **Step 4: Add enabled-space-only full rebuild coverage**

In the same `describe`, add:

```ts
it('force recognition queues SharedSpaceFaceMatchAll only for enabled spaces after personal jobs', async () => {
  const face = AssetFaceFactory.from({ sourceType: SourceType.MachineLearning }).person().build();
  mocks.job.getJobCounts.mockResolvedValue(recognitionCounts());
  mocks.person.getAllFaces.mockReturnValue(makeStream([face]));
  mocks.person.getAllWithoutFaces.mockResolvedValue([]);
  mocks.sharedSpace.deleteAllPersonFaces.mockResolvedValue(void 0 as any);
  mocks.sharedSpace.deleteAllPersons.mockResolvedValue(void 0 as any);
  mocks.sharedSpace.getSpaceIdsWithFaceRecognitionEnabled.mockResolvedValue(['enabled-space-1', 'enabled-space-2']);

  await expect(sut.handleQueueRecognizeFaces({ force: true })).resolves.toBe(JobStatus.Success);

  const queueAllCalls = mocks.job.queueAll.mock.calls;
  const personalJobCall = queueAllCalls.findIndex((call) =>
    call[0].some((job) => job.name === JobName.FacialRecognition),
  );
  const sharedSpaceCall = queueAllCalls.findIndex((call) =>
    call[0].some((job) => job.name === JobName.SharedSpaceFaceMatchAll),
  );

  expect(personalJobCall).toBeGreaterThanOrEqual(0);
  expect(sharedSpaceCall).toBeGreaterThan(personalJobCall);
  expect(queueAllCalls[sharedSpaceCall][0]).toEqual([
    { name: JobName.SharedSpaceFaceMatchAll, data: { spaceId: 'enabled-space-1' } },
    { name: JobName.SharedSpaceFaceMatchAll, data: { spaceId: 'enabled-space-2' } },
  ]);
});
```

- [ ] **Step 5: Run focused tests and observe expected failures**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter immich exec vitest --config test/vitest.config.mjs run src/services/person.service.spec.ts -t "force recognition waits|full ML reset|queues only machine-learning faces|enabled spaces"
```

Expected on current `origin/main`: FAIL for the `PeopleBackfill` prerequisite, ML-only `getAllFaces` scope, or full reset collaborator contract if those production fixes are not present.

- [ ] **Step 6: Make the minimal production fix**

In `server/src/services/person.service.ts`, update the prerequisite wait:

```ts
await this.jobRepository.waitForQueueCompletion(
  QueueName.ThumbnailGeneration,
  QueueName.FaceDetection,
  ...(force ? [QueueName.PeopleBackfill] : []),
);
```

Then update the face pagination scope:

```ts
const facePagination = this.personRepository.getAllFaces(
  force ? { sourceType: SourceType.MachineLearning } : { personId: null, sourceType: SourceType.MachineLearning },
);
```

Do not change per-face `FacialRecognition` handler behavior in this task.

- [ ] **Step 7: Re-run focused tests**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter immich exec vitest --config test/vitest.config.mjs run src/services/person.service.spec.ts -t "force recognition waits|full ML reset|queues only machine-learning faces|enabled spaces"
```

Expected: PASS.

- [ ] **Step 8: Prove the assertion can fail**

Temporarily change the expected `QueueName.PeopleBackfill` to `QueueName.BackgroundTask`, run the focused selector, confirm it fails, then restore `QueueName.PeopleBackfill`. Then temporarily change the full reset test's `reindexVectors: false` assertion to `reindexVectors: true`, run the focused selector, confirm it fails, and restore `reindexVectors: false`.

- [ ] **Step 9: Commit Task 3**

Run:

```bash
git add server/src/services/person.service.spec.ts server/src/services/person.service.ts
git commit -m "test: cover force recognition reset scope"
```

## Task 4: Maintenance Marker Drains Recognition Work Before Backfill

**Files:**

- Modify: `server/src/services/person.service.spec.ts`
- Modify only if the new tests fail: `server/src/services/person.service.ts`

- [ ] **Step 1: Add missing paused-state marker coverage**

In `describe('handleFaceIdentityMaintenanceAfterRecognition')`, add:

```ts
it('requeues itself with a delay when FacialRecognition has paused jobs', async () => {
  mocks.job.getJobCounts.mockResolvedValue(recognitionCounts({ active: 1, paused: 2 }));

  await expect(sut.handleFaceIdentityMaintenanceAfterRecognition({})).resolves.toBe(JobStatus.Success);

  expect(mocks.job.queue).toHaveBeenCalledWith({
    name: JobName.FaceIdentityMaintenanceAfterRecognition,
    data: { delay: 10_000 },
  });
  expect(mocks.job.queue).not.toHaveBeenCalledWith({ name: JobName.FaceIdentityBackfill, data: {} });
  expect(mocks.job.searchJobs).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Add failed-job non-blocking coverage**

In the same `describe`, add:

```ts
it('ignores failed recognition jobs when deciding whether the queue has drained', async () => {
  mocks.job.getJobCounts.mockResolvedValue(recognitionCounts({ active: 1, failed: 12 }));
  mocks.job.searchJobs.mockResolvedValue([]);

  await expect(sut.handleFaceIdentityMaintenanceAfterRecognition({})).resolves.toBe(JobStatus.Success);

  expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.FaceIdentityBackfill, data: {} });
  expect(mocks.job.queue).not.toHaveBeenCalledWith({
    name: JobName.FaceIdentityMaintenanceAfterRecognition,
    data: expect.anything(),
  });
});
```

- [ ] **Step 3: Strengthen PeopleBackfill dedupe status coverage**

Replace the existing duplicate-backfill assertion with:

```ts
it('does not queue duplicate FaceIdentityBackfill if PeopleBackfill already has one active, waiting, delayed, or paused', async () => {
  mocks.job.getJobCounts.mockResolvedValue(recognitionCounts({ active: 1 }));
  mocks.job.searchJobs.mockResolvedValue([{ id: '1', name: JobName.FaceIdentityBackfill, timestamp: 0, data: {} }]);

  await expect(sut.handleFaceIdentityMaintenanceAfterRecognition({})).resolves.toBe(JobStatus.Skipped);

  expect(mocks.job.searchJobs).toHaveBeenCalledWith(QueueName.PeopleBackfill, {
    status: [QueueJobStatus.Active, QueueJobStatus.Delayed, QueueJobStatus.Paused, QueueJobStatus.Waiting],
  });
  expect(mocks.job.queue).not.toHaveBeenCalledWith({ name: JobName.FaceIdentityBackfill, data: {} });
});
```

Ensure `QueueJobStatus` is already imported in the spec. If it is not, import it from `src/enum` with the existing enum imports.

- [ ] **Step 4: Run focused marker tests**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter immich exec vitest --config test/vitest.config.mjs run src/services/person.service.spec.ts -t "handleFaceIdentityMaintenanceAfterRecognition"
```

Expected: PASS or expose one minimal marker fix.

- [ ] **Step 5: Prove the assertion can fail**

Temporarily change `delay: 10_000` to `delay: 1`, run the focused selector, confirm it fails, then restore `delay: 10_000`.

- [ ] **Step 6: Commit Task 4**

Run:

```bash
git add server/src/services/person.service.spec.ts server/src/services/person.service.ts
git commit -m "test: cover recognition maintenance marker drains"
```

## Task 5: Stable FacialRecognitionQueueAll Replacement Edge Cases

**Files:**

- Modify: `server/src/repositories/job.repository.spec.ts`
- Modify only if the new tests fail: `server/src/repositories/job.repository.ts`

- [ ] **Step 1: Add failed force-follow-up replacement coverage**

In `server/src/repositories/job.repository.spec.ts`, near the existing `FacialRecognitionQueueAll` stable-job tests, add:

```ts
it('removes a failed force follow-up coordinator before queueing a replacement follow-up', async () => {
  const { sut, queue } = setup();
  const activeNonForceCoordinator = {
    data: { force: false },
    getState: vi.fn().mockResolvedValue('active'),
    remove: vi.fn().mockResolvedValue(void 0),
    updateData: vi.fn().mockResolvedValue(void 0),
  };
  const failedForceFollowUp = {
    data: { force: true },
    getState: vi.fn().mockResolvedValue('failed'),
    remove: vi.fn().mockResolvedValue(void 0),
  };
  queue.getJob.mockImplementation((jobId: string) =>
    Promise.resolve(
      jobId === JobName.FacialRecognitionQueueAll
        ? activeNonForceCoordinator
        : jobId === 'FacialRecognitionQueueAll/force'
          ? failedForceFollowUp
          : undefined,
    ),
  );
  setHandlers(sut, [JobName.FacialRecognitionQueueAll]);

  await sut.queue({ name: JobName.FacialRecognitionQueueAll, data: { force: true } });

  expect(queue.getJob).toHaveBeenCalledWith(JobName.FacialRecognitionQueueAll);
  expect(queue.getJob).toHaveBeenCalledWith('FacialRecognitionQueueAll/force');
  expect(failedForceFollowUp.getState).toHaveBeenCalled();
  expect(failedForceFollowUp.remove).toHaveBeenCalled();
  expect(queue.add).toHaveBeenCalledWith(
    JobName.FacialRecognitionQueueAll,
    { force: true },
    {
      jobId: 'FacialRecognitionQueueAll/force',
      removeOnComplete: true,
    },
  );
});
```

- [ ] **Step 2: Verify paused primary coordinator replacement is already covered**

Run:

```bash
rg -n "replaces a pending .*paused.*FacialRecognitionQueueAll|waiting', 'delayed', 'paused" server/src/repositories/job.repository.spec.ts
```

Expected: output points to the existing table-driven test that removes waiting, delayed, and paused non-force primary coordinators when force is requested. Do not add a duplicate paused-primary test in this task.

- [ ] **Step 3: Run focused repository tests**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter immich exec vitest --config test/vitest.config.mjs run src/repositories/job.repository.spec.ts -t "force follow-up|facial-recognition coordinator"
```

Expected: PASS or expose one minimal stable-job replacement fix.

- [ ] **Step 4: Prove the assertion can fail**

Temporarily change the expected follow-up `jobId` to `JobName.FacialRecognitionQueueAll`, run the focused selector, confirm it fails, then restore `'FacialRecognitionQueueAll/force'`.

- [ ] **Step 5: Commit Task 5**

Run:

```bash
git add server/src/repositories/job.repository.spec.ts server/src/repositories/job.repository.ts
git commit -m "test: cover force recognition stable job replacement"
```

If no production file changed, omit it from `git add`.

## Task 6: Medium Force Recognition Destructive-State Safety

**Files:**

- Modify: `server/test/medium/specs/services/person.service.spec.ts`
- Modify only if a DB-backed test proves a bug: `server/src/services/person.service.ts`

These medium tests intentionally stop at the coordinator boundary. They prove destructive DB side effects and queued rebuild handoffs, but they do not execute the queued per-face recognition or shared-space rematch jobs; final assignment and projection rebuild behavior remains covered by Slice 4 and the cross-queue Slice 8 chain.

- [ ] **Step 1: Add a recognition-specific medium setup helper**

In `server/test/medium/specs/services/person.service.spec.ts`, add `QueueName` to the existing enum imports and then add this helper after `setupFaceDetection`:

```ts
const setupFaceRecognition = (db?: Kysely<DB>) => {
  clearConfigCache();

  const { sut, ctx } = newMediumService(PersonService, {
    database: db || defaultDatabase,
    real: [
      AccessRepository,
      AssetRepository,
      ConfigRepository,
      DatabaseRepository,
      FaceIdentityRepository,
      PersonRepository,
      SharedSpaceRepository,
    ],
    mock: [JobRepository, LoggingRepository, MachineLearningRepository, StorageRepository, SystemMetadataRepository],
  });

  const jobMock = ctx.getMock<JobRepository, Mocked<JobRepository>>(JobRepository);
  jobMock.waitForQueueCompletion.mockResolvedValue();
  jobMock.empty.mockResolvedValue();
  jobMock.queue.mockResolvedValue();
  jobMock.queueAll.mockResolvedValue();
  jobMock.getJobCounts.mockResolvedValue({
    active: 1,
    waiting: 0,
    delayed: 0,
    paused: 0,
    completed: 0,
    failed: 0,
  });

  ctx
    .getMock<SystemMetadataRepository, Mocked<SystemMetadataRepository>>(SystemMetadataRepository)
    .get.mockImplementation((key) => {
      if (key === SystemMetadataKey.SystemConfig) {
        return { machineLearning: { facialRecognition: { enabled: true, minFaces: 1 } } } as any;
      }
      return undefined as any;
    });

  ctx
    .getMock<SystemMetadataRepository, Mocked<SystemMetadataRepository>>(SystemMetadataRepository)
    .set.mockResolvedValue();

  return { sut, ctx };
};
```

- [ ] **Step 2: Add recognition DB query helpers**

After `getIdentityLinks`, add:

```ts
const getPeopleByIds = (ctx: ReturnType<typeof setupFaceRecognition>['ctx'], ids: string[]) =>
  ctx.database.selectFrom('person').select(['id', 'name']).where('id', 'in', ids).orderBy('name').execute();

const getSpacePeople = (ctx: ReturnType<typeof setupFaceRecognition>['ctx'], spaceIds: string[]) =>
  ctx.database
    .selectFrom('shared_space_person')
    .select(['id', 'identityId', 'name', 'spaceId'])
    .where('spaceId', 'in', spaceIds)
    .orderBy('name')
    .execute();
```

- [ ] **Step 3: Add force-recognition preservation medium test**

Add a new `describe('handleQueueRecognizeFaces safety', () => { ... })` after the face-detection safety describe:

```ts
describe('handleQueueRecognizeFaces safety', () => {
  it('preserves manual and EXIF identity evidence while force recognition resets ML assignments and queues rebuilds', async () => {
    const { sut, ctx } = setupFaceRecognition();
    const jobMock = ctx.getMock<JobRepository, Mocked<JobRepository>>(JobRepository);
    const systemMetadataMock = ctx.getMock<SystemMetadataRepository, Mocked<SystemMetadataRepository>>(
      SystemMetadataRepository,
    );
    const { user } = await ctx.newUser();
    const asset = await createAssetReadyForFaceDetection(ctx, user.id);

    const ml = await createPersonFaceIdentity(ctx, {
      ownerId: user.id,
      assetId: asset.id,
      name: 'Machine',
      sourceType: SourceType.MachineLearning,
      linkSource: 'ml',
    });
    const manual = await createPersonFaceIdentity(ctx, {
      ownerId: user.id,
      assetId: asset.id,
      name: 'Manual',
      sourceType: SourceType.Manual,
      linkSource: 'manual',
    });
    const exif = await createPersonFaceIdentity(ctx, {
      ownerId: user.id,
      assetId: asset.id,
      name: 'Exif',
      sourceType: SourceType.Exif,
      linkSource: 'import',
    });

    const { space: enabledSpace } = await ctx.newSharedSpace({
      createdById: user.id,
      faceRecognitionEnabled: true,
    });
    const { space: disabledSpace } = await ctx.newSharedSpace({
      createdById: user.id,
      faceRecognitionEnabled: false,
    });
    await ctx.newSharedSpaceMember({ spaceId: enabledSpace.id, userId: user.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: disabledSpace.id, userId: user.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceAsset({ spaceId: enabledSpace.id, assetId: asset.id, addedById: user.id });
    await ctx.newSharedSpaceAsset({ spaceId: disabledSpace.id, assetId: asset.id, addedById: user.id });
    await createSpacePersonFace(ctx, {
      spaceId: enabledSpace.id,
      identityId: ml.identity.id,
      assetFaceId: ml.assetFace.id,
      name: 'Machine Enabled Space',
    });
    await createSpacePersonFace(ctx, {
      spaceId: enabledSpace.id,
      identityId: manual.identity.id,
      assetFaceId: manual.assetFace.id,
      name: 'Manual Enabled Space',
    });
    await createSpacePersonFace(ctx, {
      spaceId: disabledSpace.id,
      identityId: exif.identity.id,
      assetFaceId: exif.assetFace.id,
      name: 'Exif Disabled Space',
    });

    await expect(sut.handleQueueRecognizeFaces({ force: true })).resolves.toBe(JobStatus.Success);

    await expect(getAssetFaces(ctx, asset.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: ml.assetFace.id, personId: null, sourceType: SourceType.MachineLearning }),
        expect.objectContaining({ id: manual.assetFace.id, personId: manual.person.id, sourceType: SourceType.Manual }),
        expect.objectContaining({ id: exif.assetFace.id, personId: exif.person.id, sourceType: SourceType.Exif }),
      ]),
    );
    await expect(getIdentityLinks(ctx, [ml.assetFace.id, manual.assetFace.id, exif.assetFace.id])).resolves.toEqual(
      expect.arrayContaining([
        { assetFaceId: manual.assetFace.id, identityId: manual.identity.id, source: 'manual' },
        { assetFaceId: exif.assetFace.id, identityId: exif.identity.id, source: 'import' },
      ]),
    );
    await expect(getIdentityLinks(ctx, [ml.assetFace.id])).resolves.toEqual([]);
    await expect(getPeopleByIds(ctx, [manual.person.id, exif.person.id])).resolves.toEqual([
      { id: exif.person.id, name: 'Exif' },
      { id: manual.person.id, name: 'Manual' },
    ]);
    await expect(getSpacePeople(ctx, [enabledSpace.id, disabledSpace.id])).resolves.toEqual([]);

    const queuedJobs = jobMock.queueAll.mock.calls.flatMap(([jobs]) => jobs);
    expect(jobMock.waitForQueueCompletion).toHaveBeenCalledWith(
      QueueName.ThumbnailGeneration,
      QueueName.FaceDetection,
      QueueName.PeopleBackfill,
    );
    expect(jobMock.empty).toHaveBeenCalledWith(QueueName.FacialRecognition, true);
    expect(jobMock.queueAll).toHaveBeenCalledWith([
      {
        name: JobName.FacialRecognition,
        data: { id: ml.assetFace.id, deferred: false, skipSharedSpaceMatch: true },
      },
    ]);
    expect(jobMock.queueAll).toHaveBeenCalledWith([
      { name: JobName.SharedSpaceFaceMatchAll, data: { spaceId: enabledSpace.id } },
    ]);
    expect(queuedJobs).not.toContainEqual({
      name: JobName.SharedSpaceFaceMatchAll,
      data: { spaceId: disabledSpace.id },
    });
    expect(jobMock.queue).toHaveBeenCalledWith({
      name: JobName.FaceIdentityMaintenanceAfterRecognition,
      data: {},
    });
    expect(systemMetadataMock.set).toHaveBeenCalledWith(SystemMetadataKey.FacialRecognitionState, {
      lastRun: expect.any(String),
    });
  });
});
```

This test proves the force coordinator preserves manual/EXIF evidence while resetting ML-owned state and queueing the rebuild work. It must not assert final rebuilt ML assignments or final shared-space projections, because those jobs are queued but not executed in this slice.

- [ ] **Step 4: Add repeated-force idempotency medium test**

Inside the same `describe`, add:

```ts
it('keeps force recognition idempotent over repeated runs with populated manual and EXIF evidence', async () => {
  const { sut, ctx } = setupFaceRecognition();
  const jobMock = ctx.getMock<JobRepository, Mocked<JobRepository>>(JobRepository);
  const { user } = await ctx.newUser();
  const asset = await createAssetReadyForFaceDetection(ctx, user.id);
  const ml = await createPersonFaceIdentity(ctx, {
    ownerId: user.id,
    assetId: asset.id,
    name: 'Machine',
    sourceType: SourceType.MachineLearning,
    linkSource: 'ml',
  });
  const manual = await createPersonFaceIdentity(ctx, {
    ownerId: user.id,
    assetId: asset.id,
    name: 'Manual',
    sourceType: SourceType.Manual,
    linkSource: 'manual',
  });
  const exif = await createPersonFaceIdentity(ctx, {
    ownerId: user.id,
    assetId: asset.id,
    name: 'Exif',
    sourceType: SourceType.Exif,
    linkSource: 'import',
  });
  const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });
  await createSpacePersonFace(ctx, {
    spaceId: space.id,
    identityId: ml.identity.id,
    assetFaceId: ml.assetFace.id,
    name: 'Machine Space',
  });

  await expect(sut.handleQueueRecognizeFaces({ force: true })).resolves.toBe(JobStatus.Success);
  jobMock.queue.mockClear();
  jobMock.queueAll.mockClear();
  jobMock.empty.mockClear();

  await expect(sut.handleQueueRecognizeFaces({ force: true })).resolves.toBe(JobStatus.Success);

  await expect(getAssetFaces(ctx, asset.id)).resolves.toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: ml.assetFace.id, personId: null, sourceType: SourceType.MachineLearning }),
      expect.objectContaining({ id: manual.assetFace.id, personId: manual.person.id, sourceType: SourceType.Manual }),
      expect.objectContaining({ id: exif.assetFace.id, personId: exif.person.id, sourceType: SourceType.Exif }),
    ]),
  );
  await expect(getIdentityLinks(ctx, [ml.assetFace.id, manual.assetFace.id, exif.assetFace.id])).resolves.toEqual(
    expect.arrayContaining([
      { assetFaceId: manual.assetFace.id, identityId: manual.identity.id, source: 'manual' },
      { assetFaceId: exif.assetFace.id, identityId: exif.identity.id, source: 'import' },
    ]),
  );
  await expect(getIdentityLinks(ctx, [ml.assetFace.id])).resolves.toEqual([]);
  await expect(getSpacePeople(ctx, [space.id])).resolves.toEqual([]);
  expect(jobMock.empty).toHaveBeenCalledTimes(1);
  expect(jobMock.queueAll).toHaveBeenCalledWith([
    {
      name: JobName.FacialRecognition,
      data: { id: ml.assetFace.id, deferred: false, skipSharedSpaceMatch: true },
    },
  ]);
  expect(jobMock.queueAll).toHaveBeenCalledWith([
    { name: JobName.SharedSpaceFaceMatchAll, data: { spaceId: space.id } },
  ]);
  expect(jobMock.queue).toHaveBeenCalledWith({
    name: JobName.FaceIdentityMaintenanceAfterRecognition,
    data: {},
  });
});
```

- [ ] **Step 5: Run focused medium recognition tests**

Run:

```bash
pnpm --filter immich test:medium --run test/medium/specs/services/person.service.spec.ts -t "handleQueueRecognizeFaces safety"
```

Expected: PASS or expose one minimal production fix.

- [ ] **Step 6: Prove the DB assertion can fail**

Temporarily change the manual identity-link expected source from `'manual'` to `'ml'`, run the focused selector, confirm it fails, then restore `'manual'`.

- [ ] **Step 7: Commit Task 6**

Run:

```bash
git add server/test/medium/specs/services/person.service.spec.ts server/src/services/person.service.ts
git commit -m "test: cover force recognition destructive state"
```

If no production file changed in this task, omit it from `git add`.

## Task 7: Final Verification And Review

- [ ] **Step 1: Run the small service and repository specs**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter immich exec vitest --config test/vitest.config.mjs run src/services/person.service.spec.ts src/repositories/job.repository.spec.ts src/services/queue.service.spec.ts
```

Expected: all targeted small specs pass.

- [ ] **Step 2: Run the medium service spec**

Run:

```bash
pnpm --filter immich test:medium --run test/medium/specs/services/person.service.spec.ts
```

Expected: the medium service spec passes.

- [ ] **Step 3: Run formatting and lint checks**

Run:

```bash
pnpm --dir server exec prettier --check src/services/person.service.ts src/services/person.service.spec.ts src/repositories/job.repository.ts src/repositories/job.repository.spec.ts test/medium/specs/services/person.service.spec.ts
pnpm --dir server lint
```

Expected: Prettier and ESLint pass.

- [ ] **Step 4: Run typecheck**

Run:

```bash
pnpm --filter immich check
```

Expected: `tsc --noEmit` passes.

- [ ] **Step 5: Run placeholder scan on this plan**

Run:

```bash
rg -n "T[B]D|TO[D]O|imple[m]ent later|fill in det[a]ils|Similar to Ta[s]k|appropriate error handl[i]ng|write tests for the ab[o]ve" docs/superpowers/plans/2026-05-17-face-recognition-coordinator-safety.md
```

Expected: no matches.

- [ ] **Step 6: Review destructive invariant coverage**

Before opening a PR, confirm these statements are true from test names and assertions:

- Nightly no-new-face skip does not call `waitForQueueCompletion`, `empty`, reset methods, `queueAll`, maintenance marker queueing, or state writes.
- Non-force recognition skips for waiting, delayed, paused, and extra active recognition work.
- Force recognition waits for `ThumbnailGeneration`, `FaceDetection`, and `PeopleBackfill` before draining `FacialRecognition`.
- Force recognition unassigns and unlinks only `SourceType.MachineLearning`.
- Force recognition queues `FacialRecognition` jobs only for ML faces and always sets `skipSharedSpaceMatch: true`.
- Force recognition queues `SharedSpaceFaceMatchAll` only for enabled shared spaces and only after personal recognition jobs.
- The maintenance marker waits for waiting, delayed, paused, and extra active recognition work before queueing `FaceIdentityBackfill`.
- Medium tests prove manual and EXIF asset faces and identity links survive the force-recognition coordinator reset.
- Medium tests prove repeated force-recognition coordinator runs do not duplicate shared-space person rows, delete preserved manual/EXIF evidence, or enqueue disabled-space rebuild jobs.
- Medium tests do not claim final ML assignment or shared-space projection rebuilds are complete until the queued recognition and shared-space jobs run in later slices.

- [ ] **Step 7: Commit final verification notes only if a tracked file changed**

If verification required formatting changes, commit them:

```bash
git add server/src/services/person.service.spec.ts server/test/medium/specs/services/person.service.spec.ts
git commit -m "test: format recognition coordinator specs"
```

If no files changed, do not create an empty commit.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-17-face-recognition-coordinator-safety.md`.

Two execution options:

1. Subagent-Driven (recommended) - dispatch a fresh subagent per task, review between tasks, fast iteration.
2. Inline Execution - execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.
