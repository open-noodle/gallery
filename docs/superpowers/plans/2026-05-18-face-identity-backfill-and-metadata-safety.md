# Face Identity Backfill And Metadata Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the remaining Slice 6 safety coverage for `FaceIdentityBackfill`, `SharedSpaceFaceMatchFromBackfill`, and `SharedSpacePersonMetadataBackfill`, proving identity repair, targeted projection fan-out, durable pending targets, and inherited metadata cannot wipe or leak people data.

**Architecture:** Keep this as a test-first hardening slice. The current `origin/main` implementation already contains the phase-aware identity backfill, durable projection target table, and metadata inheritance logic; this plan adds missing service, repository, and medium coverage around race windows and destructive populated-data paths. If a new test fails, make the smallest production change in the touched service or repository and rerun that focused test before moving on.

**Tech Stack:** NestJS services, Vitest small specs, Vitest medium specs with Kysely/Postgres fixtures, BullMQ-backed `JobRepository` mocks, Gallery face identity/shared-space repositories.

---

## Slice 6 Source

Source spec: `docs/superpowers/specs/2026-05-17-face-identity-queue-testing-plan-design.md`, section "Slice 6: Identity Backfill And Metadata".

Supporting design: `docs/superpowers/specs/2026-05-09-face-identity-backfill-phased-fanout-design.md`.

Slice 6 purpose: pin:

- `FaceIdentityBackfill`
- `SharedSpaceFaceMatchFromBackfill`
- `SharedSpacePersonMetadataBackfill`

The implementation must follow strict TDD:

1. Write one failing test for one behavior.
2. Run the focused command and confirm the failure is the expected behavior gap.
3. Patch only the minimal production code needed for that behavior.
4. Rerun the focused command and confirm it passes.
5. Commit the red/green slice before moving to the next independent task.

No production code should be written before a failing test exists.

## Current Coverage Snapshot

`origin/main` already contains important Slice 6 coverage:

- `server/src/services/person.service.spec.ts`
  - bootstrap queues only a root `FaceIdentityBackfill`
  - pending root/cursor backfills block duplicate bootstrap enqueue
  - personal and space-person cursor pages queue only the next page
  - final identity work requeues root without projection or metadata fan-out
  - projection-only work queues `SharedSpaceFaceMatchFromBackfill`
  - pending durable targets are queued after identity work is clean
  - queue failures do not delete pending targets
  - metadata backfill is queued only when no targeted face-match work is queued
  - no `SharedSpaceFaceMatchAll` from identity backfill
- `server/src/repositories/job.repository.spec.ts`
  - stable ids for `FaceIdentityBackfill` and `SharedSpacePersonMetadataBackfill`
  - distinct stable ids for backfill-sourced shared-space face-match jobs
- `server/test/medium/specs/repositories/face-identity.repository.spec.ts`
  - phase-aware work summary
  - projection target discovery for direct and linked-library assets
  - pending target durability and stale snapshot safety
  - personal and space-person identity repair
- `server/src/services/shared-space.service.spec.ts`
  - metadata backfill queue assignment
  - scoped cursor continuation
  - conflict and source-priority metadata selection
- `server/test/medium/specs/services/people-identity-rbac.spec.ts`
  - legacy identity hydration across global people, filters, search, map, album scope
  - baseline timeline and membership RBAC around shared-space identity visibility

This plan fills remaining high-risk gaps:

- direct `space-person` stage resume behavior
- lower-cursor identity work appearing during a cursor run
- all target sources deduped together before queueing and pending-target deletion
- current `SharedSpaceFaceMatchFromBackfill` job-id assertions if Slice 5 has not landed yet
- projection target edge cases for multiple faces on one asset and identity-less-only work
- metadata backfill inheritance rules in the metadata backfill path, not only face-match path
- medium end-to-end `FaceIdentityBackfill -> SharedSpaceFaceMatchFromBackfill` materialization
- destructive metadata visibility after membership removal, timeline disablement, scoped merge, and detach

## Files

- Modify: `server/src/services/person.service.spec.ts`
  - Add small-service tests for cursor-stage race safety, target-source dedupe, and queue-failure cleanup boundaries.
- Modify: `server/src/repositories/job.repository.spec.ts`
  - Add or preserve assertions for `SharedSpaceFaceMatchFromBackfill` stable IDs and paused replacement.
- Modify: `server/test/medium/specs/repositories/face-identity.repository.spec.ts`
  - Add repository medium tests for projection target edge cases not yet covered by the target matrix.
- Modify: `server/src/services/shared-space.service.spec.ts`
  - Add metadata-backfill-specific unit tests for candidate type filtering, manual preservation, tie-breaks, and stale inherited metadata clearing.
- Modify: `server/test/medium/specs/services/people-identity-rbac.spec.ts`
  - Add destructive medium coverage for identity backfill projection materialization and metadata visibility under membership/timeline/repair changes.
- Modify production only if a failing test proves a bug:
  - `server/src/services/person.service.ts`
  - `server/src/services/shared-space.service.ts`
  - `server/src/repositories/face-identity.repository.ts`
  - `server/src/repositories/shared-space.repository.ts`
  - `server/src/repositories/job.repository.ts`

## Baseline

- [ ] **Step 1: Confirm the worktree**

Run:

```bash
git status --short --branch
```

Expected: branch is `codex/face-trigger-slice-6-plan` and the worktree is clean except this plan if it has not been committed yet.

- [ ] **Step 2: Run the small Slice 6 baseline**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter immich exec vitest --config test/vitest.config.mjs run src/services/person.service.spec.ts -t "handleFaceIdentityBackfill|onBootstrap|handleFaceIdentityMaintenanceAfterRecognition"
pnpm --config.verify-deps-before-run=false --filter immich exec vitest --config test/vitest.config.mjs run src/services/shared-space.service.spec.ts -t "backfillSpacePersonMetadata|handleSharedSpacePersonMetadataBackfill"
pnpm --config.verify-deps-before-run=false --filter immich exec vitest --config test/vitest.config.mjs run src/repositories/job.repository.spec.ts -t "FaceIdentityBackfill|SharedSpacePersonMetadataBackfill|SharedSpaceFaceMatchFromBackfill|identity-backfill"
```

Expected: existing tests pass. If a pre-existing failure appears, record it before adding new tests.

- [ ] **Step 3: Run the medium Slice 6 baseline**

Run from `server/`:

```bash
pnpm exec vitest --config test/vitest.config.medium.mjs run test/medium/specs/repositories/face-identity.repository.spec.ts
pnpm exec vitest --config test/vitest.config.medium.mjs run test/medium/specs/services/people-identity-rbac.spec.ts
```

Expected: existing focused medium specs pass. If the medium environment is unavailable, record the missing dependency and continue only with small tests until medium can be run.

## TDD Protocol For This Slice

For every task below:

- Add exactly the failing test described in the step.
- Run the exact focused command listed for the step.
- Confirm the failure is semantic, not a typo or fixture error.
- Patch production only after seeing the expected failure.
- Rerun the exact focused command and confirm pass.
- Run the task-level verification command.
- Commit the test and any production fix before starting the next task.

If a new test passes immediately because `origin/main` already has the behavior, keep the test if it pins a Slice 6 edge case that was not explicitly covered. Note in the commit message that this is coverage-only.

---

## Task 1: Person-Service Cursor And Phase Race Guards

**Files:**

- Modify: `server/src/services/person.service.spec.ts`
- Production only if needed: `server/src/services/person.service.ts`

**Coverage:**

- space-person identity page with cursor queues only next space-person page
- no personal phase rerun when resuming `stage: 'space-person'`
- lower-cursor identity work discovered after final pages requeues root only
- no projection discovery, metadata backfill, or full rebuild when identity work remains

- [ ] **Step 1: Add the direct space-person resume test**

In `describe('handleFaceIdentityBackfill')`, add:

```ts
it('queues only the next space-person page when resuming a space-person cursor', async () => {
  mocks.faceIdentity.backfillSpacePersonIdentities.mockResolvedValue({
    processed: 1000,
    conflictCount: 0,
    nextCursor: 'space-person-cursor-2',
    affectedSpaceAssets: [{ spaceId: 'space-1', assetId: 'asset-1' }],
  });

  await expect(
    sut.handleFaceIdentityBackfill({ stage: 'space-person', cursor: 'space-person-cursor-1' }),
  ).resolves.toBe(JobStatus.Success);

  expect(mocks.faceIdentity.backfillPersonalIdentities).not.toHaveBeenCalled();
  expect(mocks.faceIdentity.backfillSpacePersonIdentities).toHaveBeenCalledWith({
    cursor: 'space-person-cursor-1',
    limit: 1000,
  });
  expect(mocks.job.queue).toHaveBeenCalledTimes(1);
  expect(mocks.job.queue).toHaveBeenCalledWith({
    name: JobName.FaceIdentityBackfill,
    data: { stage: 'space-person', cursor: 'space-person-cursor-2' },
  });
  expect((mocks.faceIdentity as any).getBackfillWork).not.toHaveBeenCalled();
  expect((mocks.faceIdentity as any).getSharedSpaceFaceMatchBackfillTargets).not.toHaveBeenCalled();
  expect(mocks.job.queueAll).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the focused red check**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter immich exec vitest --config test/vitest.config.mjs run src/services/person.service.spec.ts -t "queues only the next space-person page when resuming a space-person cursor"
```

Expected: fail if the service reruns personal backfill, discovers projection work, or queues any job besides the next `FaceIdentityBackfill` page. Pass immediately is acceptable as coverage-only.

- [ ] **Step 3: Patch production only if the test fails**

If the test fails because `handleFaceIdentityBackfill()` reruns the personal phase for `stage: 'space-person'`, patch the top of the handler to preserve the existing branch:

```ts
if (stage === 'person') {
  const result = await this.faceIdentityRepository.backfillPersonalIdentities({
    cursor,
    limit: FACE_IDENTITY_BACKFILL_CHUNK_SIZE,
  });
  affectedSpaceAssets.push(...this.getAffectedSpaceAssets(result));

  if (result.nextCursor) {
    await this.jobRepository.queue({
      name: JobName.FaceIdentityBackfill,
      data: { stage: 'person', cursor: result.nextCursor },
    });
    return JobStatus.Success;
  }
}

const result = await this.faceIdentityRepository.backfillSpacePersonIdentities({
  cursor: stage === 'space-person' ? cursor : undefined,
  limit: FACE_IDENTITY_BACKFILL_CHUNK_SIZE,
});
```

- [ ] **Step 4: Add the lower-cursor identity work race test**

Add:

```ts
it('requeues root without fan-out when new identity work appears after a cursor page finishes', async () => {
  mocks.faceIdentity.backfillPersonalIdentities.mockResolvedValue({ processed: 0 });
  mocks.faceIdentity.backfillSpacePersonIdentities.mockResolvedValue({ processed: 0, conflictCount: 0 });
  (mocks.faceIdentity as any).getBackfillWork.mockResolvedValue({
    hasPersonalIdentityWork: false,
    hasSpacePersonIdentityWork: true,
    hasSharedSpaceProjectionWork: true,
  });

  await expect(
    sut.handleFaceIdentityBackfill({ stage: 'person', cursor: 'person-cursor-after-new-lower-id' }),
  ).resolves.toBe(JobStatus.Success);

  expect(mocks.job.queue).toHaveBeenCalledTimes(1);
  expect(mocks.job.queue).toHaveBeenCalledWith({
    name: JobName.FaceIdentityBackfill,
    data: { continuationId: expect.any(String) },
  });
  expect((mocks.faceIdentity as any).getSharedSpaceFaceMatchBackfillTargets).not.toHaveBeenCalled();
  expect((mocks.faceIdentity as any).getPendingSharedSpaceFaceMatchBackfillTargets).not.toHaveBeenCalled();
  expect(mocks.job.queueAll).not.toHaveBeenCalled();
  expect(mocks.job.queue).not.toHaveBeenCalledWith({
    name: JobName.SharedSpacePersonMetadataBackfill,
    data: {},
  });
  expect(mocks.job.queue).not.toHaveBeenCalledWith(expect.objectContaining({ name: JobName.SharedSpaceFaceMatchAll }));
});
```

- [ ] **Step 5: Run the focused red check**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter immich exec vitest --config test/vitest.config.mjs run src/services/person.service.spec.ts -t "requeues root without fan-out when new identity work appears after a cursor page finishes"
```

Expected: fail if projection or metadata work happens while identity work remains. Pass immediately is acceptable as coverage-only.

- [ ] **Step 6: Patch production only if the test fails**

If the test fails, ensure the identity-work branch happens before pending/projection target reads:

```ts
const work = await this.faceIdentityRepository.getBackfillWork();

if (work.hasPersonalIdentityWork || work.hasSpacePersonIdentityWork) {
  await this.jobRepository.queue({
    name: JobName.FaceIdentityBackfill,
    data: { continuationId: this.getNextFaceIdentityBackfillContinuationId(continuationId) },
  });
  return JobStatus.Success;
}
```

- [ ] **Step 7: Verify and commit Task 1**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter immich exec vitest --config test/vitest.config.mjs run src/services/person.service.spec.ts -t "handleFaceIdentityBackfill"
```

Commit:

```bash
git add server/src/services/person.service.spec.ts server/src/services/person.service.ts
git commit -m "test: cover identity backfill cursor race guards"
```

---

## Task 2: Target Fan-Out Dedupe And Stable Job IDs

**Files:**

- Modify: `server/src/services/person.service.spec.ts`
- Modify: `server/src/repositories/job.repository.spec.ts`
- Production only if needed: `server/src/services/person.service.ts`
- Production only if needed: `server/src/repositories/job.repository.ts`

**Coverage:**

- pending durable targets, affected repair targets, and projection discovery targets dedupe together
- pending rows are deleted only after successful queueing
- no global metadata backfill when any targeted face-match job is queued
- `SharedSpaceFaceMatchFromBackfill` has a stable, source-specific job id
- paused `SharedSpaceFaceMatchFromBackfill` jobs are replaced safely

- [ ] **Step 1: Add the all-source target dedupe test**

In `server/src/services/person.service.spec.ts`, add:

```ts
it('dedupes pending repair and projection targets together before deleting pending rows', async () => {
  const pendingTargets = [
    {
      spaceId: 'space-1',
      assetId: 'asset-1',
      updateId: 'pending-1',
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
    {
      spaceId: 'space-3',
      assetId: 'asset-3',
      updateId: 'pending-3',
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
  ];
  mocks.faceIdentity.backfillPersonalIdentities.mockResolvedValue({
    processed: 1,
    affectedSpaceAssets: [
      { spaceId: 'space-1', assetId: 'asset-1' },
      { spaceId: 'space-2', assetId: 'asset-2' },
    ],
  });
  mocks.faceIdentity.backfillSpacePersonIdentities.mockResolvedValue({
    processed: 1,
    conflictCount: 0,
    affectedSpaceAssets: [{ spaceId: 'space-2', assetId: 'asset-2' }],
  });
  (mocks.faceIdentity as any).getBackfillWork.mockResolvedValue({
    hasPersonalIdentityWork: false,
    hasSpacePersonIdentityWork: false,
    hasSharedSpaceProjectionWork: true,
  });
  (mocks.faceIdentity as any).getPendingSharedSpaceFaceMatchBackfillTargets.mockResolvedValue(pendingTargets);
  (mocks.faceIdentity as any).getSharedSpaceFaceMatchBackfillTargets.mockResolvedValue([
    { spaceId: 'space-2', assetId: 'asset-2' },
    { spaceId: 'space-4', assetId: 'asset-4' },
  ]);

  await expect(sut.handleFaceIdentityBackfill({ stage: 'person' })).resolves.toBe(JobStatus.Success);

  expect(mocks.job.queueAll).toHaveBeenCalledTimes(1);
  expect(mocks.job.queueAll).toHaveBeenCalledWith([
    { name: JobName.SharedSpaceFaceMatchFromBackfill, data: { spaceId: 'space-1', assetId: 'asset-1' } },
    { name: JobName.SharedSpaceFaceMatchFromBackfill, data: { spaceId: 'space-2', assetId: 'asset-2' } },
    { name: JobName.SharedSpaceFaceMatchFromBackfill, data: { spaceId: 'space-3', assetId: 'asset-3' } },
    { name: JobName.SharedSpaceFaceMatchFromBackfill, data: { spaceId: 'space-4', assetId: 'asset-4' } },
  ]);
  expect((mocks.faceIdentity as any).deletePendingSharedSpaceFaceMatchBackfillTargets).toHaveBeenCalledWith(
    pendingTargets,
  );
  expect(mocks.job.queue).not.toHaveBeenCalledWith({
    name: JobName.SharedSpacePersonMetadataBackfill,
    data: {},
  });
});
```

- [ ] **Step 2: Run the focused red check**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter immich exec vitest --config test/vitest.config.mjs run src/services/person.service.spec.ts -t "dedupes pending repair and projection targets together before deleting pending rows"
```

Expected: fail if duplicates are queued, pending rows are deleted too early, or metadata backfill is queued alongside targeted work.

- [ ] **Step 3: Patch production only if the test fails**

If duplicates are queued, keep target sorting and dedupe in `queueSharedSpaceFaceMatchTargets()`:

```ts
const uniqueTargets = [
  ...new Map(
    targets
      .toSorted((a, b) => a.spaceId.localeCompare(b.spaceId) || a.assetId.localeCompare(b.assetId))
      .map((target) => [`${target.spaceId}:${target.assetId}`, target]),
  ).values(),
];
```

If pending rows are deleted before queue success, ensure deletion happens only after `queueSharedSpaceFaceMatchTargets()` resolves:

```ts
const queuedTargets = await this.queueSharedSpaceFaceMatchTargets([...pendingTargets, ...affectedSpaceAssets]);
await this.faceIdentityRepository.deletePendingSharedSpaceFaceMatchBackfillTargets(pendingTargets);
if (queuedTargets.length === 0) {
  await this.queueSpacePersonMetadataBackfill();
}
```

- [ ] **Step 4: Add stable id coverage for `SharedSpaceFaceMatchFromBackfill`**

In `server/src/repositories/job.repository.spec.ts`, add or preserve this test if Slice 5 has already landed:

```ts
it('uses stable job ids for shared-space face matches queued from identity backfill', async () => {
  const { sut, queue } = setup();
  setHandlers(sut, [JobName.SharedSpaceFaceMatch, JobName.SharedSpaceFaceMatchFromBackfill]);

  await sut.queueAll([
    { name: JobName.SharedSpaceFaceMatch, data: { spaceId: 'space-1', assetId: 'asset-1' } },
    { name: JobName.SharedSpaceFaceMatchFromBackfill, data: { spaceId: 'space-1', assetId: 'asset-1' } },
  ]);

  expect(queue.addBulk).not.toHaveBeenCalled();
  expect(queue.add).toHaveBeenCalledWith(
    JobName.SharedSpaceFaceMatch,
    { spaceId: 'space-1', assetId: 'asset-1' },
    { jobId: 'shared-space-face-match/space-1/asset-1', removeOnComplete: true },
  );
  expect(queue.add).toHaveBeenCalledWith(
    JobName.SharedSpaceFaceMatchFromBackfill,
    { spaceId: 'space-1', assetId: 'asset-1' },
    { jobId: 'shared-space-face-match/from-backfill/space-1/asset-1', removeOnComplete: true },
  );
});
```

- [ ] **Step 5: Add paused replacement coverage**

Extend the paused stable-job replacement table with:

```ts
[
  JobName.SharedSpaceFaceMatchFromBackfill,
  { spaceId: 'space-1', assetId: 'asset-1' },
  'shared-space-face-match/from-backfill/space-1/asset-1',
],
```

The test should assert the paused job is removed before the replacement add and that the replacement id is stable.

- [ ] **Step 6: Run the focused red checks**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter immich exec vitest --config test/vitest.config.mjs run src/repositories/job.repository.spec.ts -t "shared-space face matches queued from identity backfill|replaces paused stable"
```

Expected: fail if `SharedSpaceFaceMatchFromBackfill` is missing a stable id or paused replacement behavior.

- [ ] **Step 7: Patch production only if the tests fail**

In `server/src/repositories/job.repository.ts`, keep the `SharedSpaceFaceMatchFromBackfill` case distinct from normal incremental matching:

```ts
case JobName.SharedSpaceFaceMatchFromBackfill: {
  return {
    jobId: `shared-space-face-match/from-backfill/${item.data.spaceId}/${item.data.assetId}`,
    removeOnComplete: true,
  };
}
```

Ensure `isStableJob()` includes `JobName.SharedSpaceFaceMatchFromBackfill`.

- [ ] **Step 8: Verify and commit Task 2**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter immich exec vitest --config test/vitest.config.mjs run src/services/person.service.spec.ts -t "handleFaceIdentityBackfill"
pnpm --config.verify-deps-before-run=false --filter immich exec vitest --config test/vitest.config.mjs run src/repositories/job.repository.spec.ts
```

Commit:

```bash
git add server/src/services/person.service.spec.ts server/src/services/person.service.ts server/src/repositories/job.repository.spec.ts server/src/repositories/job.repository.ts
git commit -m "test: cover identity backfill target fanout safety"
```

---

## Task 3: Repository Projection Target Edge Cases

**Files:**

- Modify: `server/test/medium/specs/repositories/face-identity.repository.spec.ts`
- Production only if needed: `server/src/repositories/face-identity.repository.ts`

**Coverage:**

- one asset with multiple eligible identity-linked faces in the same space returns one `(spaceId, assetId)` target
- identity-less-only faces are identity work, not projection work
- same eligible asset in many enabled spaces returns one target per enabled space and no target for disabled spaces
- target discovery remains aligned with `getBackfillWork()`

- [ ] **Step 1: Add the multi-face single-target medium test**

In `server/test/medium/specs/repositories/face-identity.repository.spec.ts`, near the projection-target tests, add:

```ts
it('returns one projection target for an asset with multiple identity-linked faces in one space', async () => {
  const { ctx, sut } = setup();
  const { user } = await ctx.newUser();
  try {
    const first = await newIdentityFace(ctx, sut, { ownerId: user.id });
    const { person: secondPerson } = await ctx.newPerson({ ownerId: user.id });
    const { assetFace: secondFace } = await ctx.newAssetFace({
      assetId: first.asset.id,
      personId: secondPerson.id,
    });
    const secondIdentity = await sut.ensurePersonIdentity(secondPerson.id);
    await sut.linkFace({ assetFaceId: secondFace.id, identityId: secondIdentity.id, source: 'backfill' });
    const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: first.asset.id, addedById: user.id });

    await expect(sut.getBackfillWork()).resolves.toMatchObject({ hasSharedSpaceProjectionWork: true });
    await expect(sut.getSharedSpaceFaceMatchBackfillTargets()).resolves.toEqual([
      { spaceId: space.id, assetId: first.asset.id },
    ]);
  } finally {
    await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
  }
});
```

- [ ] **Step 2: Run the focused red check**

Run from `server/`:

```bash
pnpm exec vitest --config test/vitest.config.medium.mjs run test/medium/specs/repositories/face-identity.repository.spec.ts -t "returns one projection target for an asset with multiple identity-linked faces in one space"
```

Expected: fail if target discovery returns duplicate asset-level jobs.

- [ ] **Step 3: Patch production only if the test fails**

In `getSharedSpaceFaceMatchBackfillTargets()`, ensure the target query selects distinct asset-level targets:

```sql
SELECT DISTINCT "spaceId", "assetId"
FROM face_spaces
```

Keep the final `ORDER BY "spaceId", "assetId"` so queueing is deterministic.

- [ ] **Step 4: Add the identity-less-only classification test**

Add:

```ts
it('classifies identity-less assigned faces as identity work without projection targets', async () => {
  const { ctx, sut } = setup();
  const { user } = await ctx.newUser();
  try {
    const { person } = await ctx.newPerson({ ownerId: user.id });
    const { asset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
    await ctx.newAssetFace({ assetId: asset.id, personId: person.id });
    const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });

    await expect(sut.getBackfillWork()).resolves.toEqual({
      hasPersonalIdentityWork: true,
      hasSpacePersonIdentityWork: false,
      hasSharedSpaceProjectionWork: false,
    });
    await expect(sut.getSharedSpaceFaceMatchBackfillTargets()).resolves.toEqual([]);
  } finally {
    await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
  }
});
```

- [ ] **Step 5: Run the focused red check**

Run from `server/`:

```bash
pnpm exec vitest --config test/vitest.config.medium.mjs run test/medium/specs/repositories/face-identity.repository.spec.ts -t "classifies identity-less assigned faces as identity work without projection targets"
```

Expected: fail if projection target discovery ignores the identity-link requirement.

- [ ] **Step 6: Patch production only if the test fails**

Keep the projection target query joined to `face_identity_face`:

```sql
INNER JOIN face_identity_face ON face_identity_face."assetFaceId" = asset_face.id
```

Do not fall back to `SharedSpaceFaceMatchAll` when projection targets are empty.

- [ ] **Step 7: Verify and commit Task 3**

Run from `server/`:

```bash
pnpm exec vitest --config test/vitest.config.medium.mjs run test/medium/specs/repositories/face-identity.repository.spec.ts -t "projection|identity-less|multiple identity-linked faces|same photo lives in ten spaces|pending face-match targets"
```

Commit:

```bash
git add server/test/medium/specs/repositories/face-identity.repository.spec.ts server/src/repositories/face-identity.repository.ts
git commit -m "test: cover identity backfill projection target edges"
```

---

## Task 4: Metadata Backfill Selection Rules

**Files:**

- Modify: `server/src/services/shared-space.service.spec.ts`
- Production only if needed: `server/src/services/shared-space.service.ts`

**Coverage:**

- metadata backfill inherits only type-compatible candidates
- same-priority metadata conflicts leave existing metadata unchanged
- asset-adder metadata wins when priority is otherwise tied
- manual name and birth date remain manual
- stale inherited name and birth date are cleared when no candidates remain
- scoped identity cursoring is preserved across pages

- [ ] **Step 1: Add the type-compatible metadata backfill test**

In `describe('backfillSpacePersonMetadata')`, add:

```ts
it('should inherit only from type-compatible candidates during metadata backfill', async () => {
  const spaceId = newUuid();
  const personId = newUuid();
  const identityId = newUuid();
  const compatibleSourceId = newUuid();
  const person = factory.sharedSpacePerson({
    id: personId,
    spaceId,
    identityId,
    type: 'person',
    nameSource: 'none',
    birthDateSource: 'none',
  });

  mocks.sharedSpace.getSpacePersonMetadataBackfillPage.mockResolvedValue([person]);
  mocks.sharedSpace.getPersonById.mockResolvedValue(person);
  mocks.sharedSpace.getSpacePersonAssetAdderIds.mockResolvedValue([]);
  mocks.sharedSpace.getMetadataInheritanceCandidates.mockResolvedValue([
    {
      personId: newUuid(),
      userId: newUuid(),
      role: SharedSpaceRole.Owner,
      name: 'Pet Name',
      birthDate: null,
      type: 'pet',
      species: 'cat',
      updatedAt: newDate(),
      supportingFaceCount: 10,
      isAssetAdder: true,
    },
    {
      personId: compatibleSourceId,
      userId: newUuid(),
      role: SharedSpaceRole.Viewer,
      name: 'Person Name',
      birthDate: new Date('1992-02-03T00:00:00.000Z'),
      type: 'person',
      species: null,
      updatedAt: newDate(),
      supportingFaceCount: 1,
      isAssetAdder: false,
    },
  ]);
  mocks.sharedSpace.updatePerson.mockResolvedValue(person);

  const result = await sut.backfillSpacePersonMetadata({ limit: 50 });

  expect(result).toEqual({ processed: 1, inherited: 1, skipped: 0 });
  expect(mocks.sharedSpace.updatePerson).toHaveBeenCalledWith(
    personId,
    expect.objectContaining({
      name: 'Person Name',
      birthDate: '1992-02-03',
      nameSourceProfileId: compatibleSourceId,
      birthDateSourceProfileId: compatibleSourceId,
    }),
  );
  expect(mocks.sharedSpace.updatePerson).not.toHaveBeenCalledWith(
    personId,
    expect.objectContaining({ name: 'Pet Name' }),
  );
});
```

- [ ] **Step 2: Run the focused red check**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter immich exec vitest --config test/vitest.config.mjs run src/services/shared-space.service.spec.ts -t "inherit only from type-compatible candidates during metadata backfill"
```

Expected: fail if incompatible human/pet metadata can be inherited.

- [ ] **Step 3: Add the manual-source preservation test**

Add:

```ts
it('should preserve manual name and birth date during metadata backfill', async () => {
  const spaceId = newUuid();
  const personId = newUuid();
  const identityId = newUuid();
  const person = factory.sharedSpacePerson({
    id: personId,
    spaceId,
    identityId,
    name: 'Manual Alice',
    nameSource: 'manual',
    birthDate: new Date('1988-08-08T00:00:00.000Z'),
    birthDateSource: 'manual',
  });

  mocks.sharedSpace.getSpacePersonMetadataBackfillPage.mockResolvedValue([person]);
  mocks.sharedSpace.getPersonById.mockResolvedValue(person);
  mocks.sharedSpace.getSpacePersonAssetAdderIds.mockResolvedValue([]);
  mocks.sharedSpace.getMetadataInheritanceCandidates.mockResolvedValue([
    {
      personId: newUuid(),
      userId: newUuid(),
      role: SharedSpaceRole.Owner,
      name: 'Inherited Alice',
      birthDate: new Date('1999-09-09T00:00:00.000Z'),
      type: 'person',
      species: null,
      updatedAt: newDate(),
      supportingFaceCount: 10,
      isAssetAdder: true,
    },
  ]);

  const result = await sut.backfillSpacePersonMetadata({ limit: 50 });

  expect(result).toEqual({ processed: 1, inherited: 0, skipped: 1 });
  expect(mocks.sharedSpace.updatePerson).not.toHaveBeenCalled();
});
```

- [ ] **Step 4: Run the focused red check**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter immich exec vitest --config test/vitest.config.mjs run src/services/shared-space.service.spec.ts -t "preserve manual name and birth date during metadata backfill"
```

Expected: fail if manual name or manual birth date is overwritten.

- [ ] **Step 5: Add the stale inherited clear test**

Add:

```ts
it('should clear stale inherited metadata when no candidates remain', async () => {
  const spaceId = newUuid();
  const personId = newUuid();
  const identityId = newUuid();
  const person = factory.sharedSpacePerson({
    id: personId,
    spaceId,
    identityId,
    name: 'Old Inherited',
    nameSource: 'inherited',
    nameSourceProfileId: newUuid(),
    birthDate: new Date('1991-01-01T00:00:00.000Z'),
    birthDateSource: 'inherited',
    birthDateSourceProfileId: newUuid(),
  });

  mocks.sharedSpace.getSpacePersonMetadataBackfillPage.mockResolvedValue([person]);
  mocks.sharedSpace.getPersonById.mockResolvedValue(person);
  mocks.sharedSpace.getSpacePersonAssetAdderIds.mockResolvedValue([]);
  mocks.sharedSpace.getMetadataInheritanceCandidates.mockResolvedValue([]);
  mocks.sharedSpace.updatePerson.mockResolvedValue(person);

  const result = await sut.backfillSpacePersonMetadata({ limit: 50 });

  expect(result).toEqual({ processed: 1, inherited: 1, skipped: 0 });
  expect(mocks.sharedSpace.updatePerson).toHaveBeenCalledWith(
    personId,
    expect.objectContaining({
      name: '',
      nameSource: 'none',
      nameSourceProfileId: null,
      birthDate: null,
      birthDateSource: 'none',
      birthDateSourceProfileId: null,
    }),
  );
});
```

- [ ] **Step 6: Run the focused red check**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter immich exec vitest --config test/vitest.config.mjs run src/services/shared-space.service.spec.ts -t "clear stale inherited metadata when no candidates remain"
```

Expected: fail if stale inherited metadata remains after candidates disappear.

- [ ] **Step 7: Add the asset-adder priority test in the metadata backfill path**

Add:

```ts
it('should prefer asset-adder metadata at equal role face and source priority during metadata backfill', async () => {
  const spaceId = newUuid();
  const personId = newUuid();
  const identityId = newUuid();
  const assetAdderId = newUuid();
  const adderSourceId = newUuid();
  const person = factory.sharedSpacePerson({ id: personId, spaceId, identityId, nameSource: 'none' });

  mocks.sharedSpace.getSpacePersonMetadataBackfillPage.mockResolvedValue([person]);
  mocks.sharedSpace.getPersonById.mockResolvedValue(person);
  mocks.sharedSpace.getSpacePersonAssetAdderIds.mockResolvedValue([assetAdderId]);
  mocks.sharedSpace.getMetadataInheritanceCandidates.mockResolvedValue([
    {
      personId: newUuid(),
      userId: newUuid(),
      role: SharedSpaceRole.Viewer,
      name: 'Other Alice',
      birthDate: null,
      type: 'person',
      species: null,
      updatedAt: newDate(),
      supportingFaceCount: 1,
      isAssetAdder: false,
    },
    {
      personId: adderSourceId,
      userId: assetAdderId,
      role: SharedSpaceRole.Viewer,
      name: 'Adder Alice',
      birthDate: null,
      type: 'person',
      species: null,
      updatedAt: newDate(),
      supportingFaceCount: 1,
      isAssetAdder: true,
    },
  ]);
  mocks.sharedSpace.updatePerson.mockResolvedValue(person);

  await sut.backfillSpacePersonMetadata({ limit: 50 });

  expect(mocks.sharedSpace.getMetadataInheritanceCandidates).toHaveBeenCalledWith({
    spaceId,
    identityId,
    assetAdderIds: [assetAdderId],
  });
  expect(mocks.sharedSpace.updatePerson).toHaveBeenCalledWith(
    personId,
    expect.objectContaining({ name: 'Adder Alice', nameSourceProfileId: adderSourceId }),
  );
});
```

- [ ] **Step 8: Patch production only if these tests fail**

Keep `inheritSpacePersonMetadata()` filtering candidates by target type:

```ts
const candidates = metadataCandidates.filter((item) => item.type === person.type);
```

Keep manual-source guards:

```ts
if ((person.nameSource === 'none' || person.nameSource === 'inherited') && nameCandidate) {
  // inherited name update
}

if ((person.birthDateSource === 'none' || person.birthDateSource === 'inherited') && birthDateCandidate) {
  // inherited birth date update
}
```

Keep stale inherited clear branches for `nameSource === 'inherited'` and `birthDateSource === 'inherited'`.

Keep `selectMetadataCandidate()` ranking by role, asset-adder, supporting face count, source profile type, and same-value conflict detection.

- [ ] **Step 9: Verify and commit Task 4**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter immich exec vitest --config test/vitest.config.mjs run src/services/shared-space.service.spec.ts -t "backfillSpacePersonMetadata|handleSharedSpacePersonMetadataBackfill"
```

Commit:

```bash
git add server/src/services/shared-space.service.spec.ts server/src/services/shared-space.service.ts
git commit -m "test: cover metadata backfill inheritance safety"
```

---

## Task 5: Medium Identity Backfill To Targeted Projection Materialization

**Files:**

- Modify: `server/test/medium/specs/services/people-identity-rbac.spec.ts`
- Production only if needed: `server/src/services/person.service.ts`
- Production only if needed: `server/src/services/shared-space.service.ts`
- Production only if needed: `server/src/repositories/face-identity.repository.ts`

**Coverage:**

- legacy personal identity backfill queues `SharedSpaceFaceMatchFromBackfill`, not `SharedSpaceFaceMatchAll`
- paginated repository backfill persists page-one targets and the service queues them only after the final page
- queued targeted jobs materialize selected-space face assignments
- pending backfill target rows are deleted only after queue success
- final state has no identity/projection backfill work
- same photo in many enabled spaces materializes exactly once per enabled space
- direct shared-space asset plus linked-library path materializes one assignment
- stale wrong-identity selected-space assignment is repaired without leaving orphaned person-face rows
- EXIF/imported face evidence uses targeted projection jobs, not full-space rebuilds
- force recognition reset still preserves the full shared-space rebuild path outside identity backfill

- [ ] **Step 1: Add a helper to drain targeted backfill face-match jobs**

Near `drainSharedSpaceFaceJobs`, add:

```ts
const drainSharedSpaceFaceMatchFromBackfillJobs = async (
  sharedSpaceService: SharedSpaceService,
  jobs: Mocked<JobRepository>,
) => {
  const queued = jobs.queueAll.mock.calls.flatMap(([items]) => items);

  for (const job of queued) {
    if (job.name === JobName.SharedSpaceFaceMatchFromBackfill) {
      await sharedSpaceService.handleSharedSpaceFaceMatchFromBackfill(job.data);
    }
  }
};
```

- [ ] **Step 2: Add the targeted materialization medium test**

Add:

```ts
it('identity backfill queues targeted projection jobs and materializes selected-space faces', async () => {
  const { ctx, sut, faceIdentityRepository } = setup();
  const { sut: sharedSpaceService } = setupSharedSpace();
  const jobs = ctx.getMock<JobRepository, Mocked<JobRepository>>(JobRepository);
  const { user: owner } = await ctx.newUser();
  const { user: member } = await ctx.newUser();
  try {
    const { space } = await ctx.newSharedSpace({ createdById: owner.id, faceRecognitionEnabled: true });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Viewer });
    const { person } = await ctx.newPerson({ ownerId: owner.id, identityId: null, name: 'Legacy Alice' });
    const { asset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
    const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: person.id });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: owner.id });

    await expect(faceIdentityRepository.hasBackfillWork()).resolves.toBe(true);

    await sut.handleFaceIdentityBackfill({ stage: 'person' });

    const queuedTargetJobs = jobs.queueAll.mock.calls.flatMap(([items]) => items);
    expect(queuedTargetJobs).toEqual([
      { name: JobName.SharedSpaceFaceMatchFromBackfill, data: { spaceId: space.id, assetId: asset.id } },
    ]);
    expect(jobs.queue).not.toHaveBeenCalledWith(expect.objectContaining({ name: JobName.SharedSpaceFaceMatchAll }));
    await expect(faceIdentityRepository.getPendingSharedSpaceFaceMatchBackfillTargets()).resolves.toEqual([]);

    await drainSharedSpaceFaceMatchFromBackfillJobs(sharedSpaceService, jobs);

    const selectedFaces = await ctx.database
      .selectFrom('shared_space_person_face')
      .innerJoin('shared_space_person', 'shared_space_person.id', 'shared_space_person_face.personId')
      .select(['shared_space_person.spaceId', 'shared_space_person.identityId', 'shared_space_person_face.assetFaceId'])
      .where('shared_space_person.spaceId', '=', space.id)
      .execute();
    const updatedPerson = await ctx.database
      .selectFrom('person')
      .select('identityId')
      .where('id', '=', person.id)
      .executeTakeFirstOrThrow();

    expect(selectedFaces).toEqual([
      {
        spaceId: space.id,
        identityId: updatedPerson.identityId,
        assetFaceId: assetFace.id,
      },
    ]);
    await expect(faceIdentityRepository.hasBackfillWork()).resolves.toBe(false);
  } finally {
    await ctx.database.deleteFrom('user').where('id', 'in', [owner.id, member.id]).execute();
  }
});
```

- [ ] **Step 3: Run the focused red check**

Run from `server/`:

```bash
pnpm exec vitest --config test/vitest.config.medium.mjs run test/medium/specs/services/people-identity-rbac.spec.ts -t "identity backfill queues targeted projection jobs and materializes selected-space faces"
```

Expected: fail if identity backfill does not queue targeted jobs, queues a full rebuild, leaves pending targets behind after success, or targeted jobs do not materialize selected-space face rows.

- [ ] **Step 4: Add the ten-space materialization medium test**

Add:

```ts
it('identity backfill materializes one selected-space assignment per enabled space for the same photo', async () => {
  const { ctx, sut, faceIdentityRepository } = setup();
  const { sut: sharedSpaceService } = setupSharedSpace();
  const jobs = ctx.getMock<JobRepository, Mocked<JobRepository>>(JobRepository);
  const { user: owner } = await ctx.newUser();
  try {
    const { person } = await ctx.newPerson({ ownerId: owner.id, identityId: null, name: 'Shared Alice' });
    const { asset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
    const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: person.id });
    const enabledSpaces = [];
    for (let index = 0; index < 10; index++) {
      const { space } = await ctx.newSharedSpace({ createdById: owner.id, faceRecognitionEnabled: true });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: owner.id });
      enabledSpaces.push(space);
    }
    const { space: disabledSpace } = await ctx.newSharedSpace({ createdById: owner.id, faceRecognitionEnabled: false });
    await ctx.newSharedSpaceMember({ spaceId: disabledSpace.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceAsset({ spaceId: disabledSpace.id, assetId: asset.id, addedById: owner.id });

    await sut.handleFaceIdentityBackfill({ stage: 'person' });

    const queuedTargetJobs = jobs.queueAll.mock.calls.flatMap(([items]) => items);
    const expectedJobs = enabledSpaces
      .map((space) => ({
        name: JobName.SharedSpaceFaceMatchFromBackfill,
        data: { spaceId: space.id, assetId: asset.id },
      }))
      .toSorted((a, b) => a.data.spaceId.localeCompare(b.data.spaceId));
    expect(queuedTargetJobs).toEqual(expectedJobs);

    await drainSharedSpaceFaceMatchFromBackfillJobs(sharedSpaceService, jobs);

    const selectedFaces = await ctx.database
      .selectFrom('shared_space_person_face')
      .innerJoin('shared_space_person', 'shared_space_person.id', 'shared_space_person_face.personId')
      .select(['shared_space_person.spaceId', 'shared_space_person_face.assetFaceId'])
      .where('shared_space_person_face.assetFaceId', '=', assetFace.id)
      .orderBy('shared_space_person.spaceId')
      .execute();

    expect(selectedFaces).toEqual(
      enabledSpaces
        .map((space) => ({ spaceId: space.id, assetFaceId: assetFace.id }))
        .toSorted((a, b) => a.spaceId.localeCompare(b.spaceId)),
    );
    expect(selectedFaces.map((row) => row.spaceId)).not.toContain(disabledSpace.id);
    await expect(faceIdentityRepository.hasBackfillWork()).resolves.toBe(false);
  } finally {
    await ctx.database.deleteFrom('user').where('id', '=', owner.id).execute();
  }
});
```

- [ ] **Step 5: Run the focused red check**

Run from `server/`:

```bash
pnpm exec vitest --config test/vitest.config.medium.mjs run test/medium/specs/services/people-identity-rbac.spec.ts -t "identity backfill materializes one selected-space assignment per enabled space for the same photo"
```

Expected: fail if the pipeline queues duplicates, queues disabled spaces, uses full rebuild, or leaves projections missing.

- [ ] **Step 6: Add the paginated delayed-fanout medium test**

Add:

```ts
it('delays page-one projection fanout until the final identity backfill page', async () => {
  const { ctx, sut, faceIdentityRepository } = setup();
  const { sut: sharedSpaceService } = setupSharedSpace();
  const jobs = ctx.getMock<JobRepository, Mocked<JobRepository>>(JobRepository);
  const { user: owner } = await ctx.newUser();
  try {
    const { space } = await ctx.newSharedSpace({ createdById: owner.id, faceRecognitionEnabled: true });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    const first = await ctx.newPerson({ ownerId: owner.id, identityId: null, name: 'Page One Alice' });
    const second = await ctx.newPerson({ ownerId: owner.id, identityId: null, name: 'Page Two Alice' });
    const { asset: firstAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
    const { asset: secondAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
    const { assetFace: firstFace } = await ctx.newAssetFace({ assetId: firstAsset.id, personId: first.person.id });
    const { assetFace: secondFace } = await ctx.newAssetFace({ assetId: secondAsset.id, personId: second.person.id });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: firstAsset.id, addedById: owner.id });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: secondAsset.id, addedById: owner.id });

    const firstPage = await faceIdentityRepository.backfillPersonalIdentities({ limit: 1 });
    expect(firstPage).toEqual({
      processed: 1,
      nextCursor: expect.any(String),
      affectedSpaceAssets: [{ spaceId: space.id, assetId: firstAsset.id }],
    });
    expect(jobs.queueAll).not.toHaveBeenCalled();
    await expect(faceIdentityRepository.getPendingSharedSpaceFaceMatchBackfillTargets()).resolves.toMatchObject([
      { spaceId: space.id, assetId: firstAsset.id },
    ]);

    await sut.handleFaceIdentityBackfill({ stage: 'person', cursor: firstPage.nextCursor });

    const queuedTargetJobs = jobs.queueAll.mock.calls.flatMap(([items]) => items);
    expect(queuedTargetJobs).toEqual([
      { name: JobName.SharedSpaceFaceMatchFromBackfill, data: { spaceId: space.id, assetId: firstAsset.id } },
      { name: JobName.SharedSpaceFaceMatchFromBackfill, data: { spaceId: space.id, assetId: secondAsset.id } },
    ]);
    await expect(faceIdentityRepository.getPendingSharedSpaceFaceMatchBackfillTargets()).resolves.toEqual([]);

    await drainSharedSpaceFaceMatchFromBackfillJobs(sharedSpaceService, jobs);

    const selectedFaces = await ctx.database
      .selectFrom('shared_space_person_face')
      .select('assetFaceId')
      .where('assetFaceId', 'in', [firstFace.id, secondFace.id])
      .orderBy('assetFaceId')
      .execute();
    expect(selectedFaces.map((row) => row.assetFaceId)).toEqual([firstFace.id, secondFace.id].toSorted());
    await expect(faceIdentityRepository.hasBackfillWork()).resolves.toBe(false);
  } finally {
    await ctx.database.deleteFrom('user').where('id', '=', owner.id).execute();
  }
});
```

- [ ] **Step 7: Run the focused red check**

Run from `server/`:

```bash
pnpm exec vitest --config test/vitest.config.medium.mjs run test/medium/specs/services/people-identity-rbac.spec.ts -t "delays page-one projection fanout until the final identity backfill page"
```

Expected: fail if page-one targets are queued early, lost after pagination, or left pending after successful final queueing.

- [ ] **Step 8: Add the direct-plus-linked dedupe materialization test**

Add:

```ts
it('identity backfill materializes once when an asset is both directly added and linked by library', async () => {
  const { ctx, sut, faceIdentityRepository } = setup();
  const { sut: sharedSpaceService } = setupSharedSpace();
  const jobs = ctx.getMock<JobRepository, Mocked<JobRepository>>(JobRepository);
  const { user: owner } = await ctx.newUser();
  try {
    const { library } = await ctx.newLibrary({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id, faceRecognitionEnabled: true });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    const { person } = await ctx.newPerson({ ownerId: owner.id, identityId: null, name: 'Library Alice' });
    const { asset } = await ctx.newAsset({
      ownerId: owner.id,
      libraryId: library.id,
      visibility: AssetVisibility.Timeline,
    });
    const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: person.id });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: owner.id });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: owner.id });

    await sut.handleFaceIdentityBackfill({ stage: 'person' });

    const queuedTargetJobs = jobs.queueAll.mock.calls.flatMap(([items]) => items);
    expect(queuedTargetJobs).toEqual([
      { name: JobName.SharedSpaceFaceMatchFromBackfill, data: { spaceId: space.id, assetId: asset.id } },
    ]);

    await drainSharedSpaceFaceMatchFromBackfillJobs(sharedSpaceService, jobs);

    const selectedFaces = await ctx.database
      .selectFrom('shared_space_person_face')
      .innerJoin('shared_space_person', 'shared_space_person.id', 'shared_space_person_face.personId')
      .select(['shared_space_person.spaceId', 'shared_space_person_face.assetFaceId'])
      .where('shared_space_person.spaceId', '=', space.id)
      .where('shared_space_person_face.assetFaceId', '=', assetFace.id)
      .execute();
    expect(selectedFaces).toEqual([{ spaceId: space.id, assetFaceId: assetFace.id }]);
    await expect(faceIdentityRepository.hasBackfillWork()).resolves.toBe(false);
  } finally {
    await ctx.database.deleteFrom('user').where('id', '=', owner.id).execute();
  }
});
```

- [ ] **Step 9: Run the focused red check**

Run from `server/`:

```bash
pnpm exec vitest --config test/vitest.config.medium.mjs run test/medium/specs/services/people-identity-rbac.spec.ts -t "identity backfill materializes once when an asset is both directly added and linked by library"
```

Expected: fail if direct plus linked-library reachability queues duplicate jobs or creates duplicate selected-space face rows.

- [ ] **Step 10: Add the stale wrong-identity repair medium test**

Add:

```ts
it('targeted identity backfill repairs wrong-identity selected-space assignments', async () => {
  const { ctx, faceIdentityRepository } = setup();
  const { sut: sharedSpaceService } = setupSharedSpace();
  const { user: owner } = await ctx.newUser();
  try {
    const correct = await createIdentityBackedFace(ctx, faceIdentityRepository, {
      ownerId: owner.id,
      personName: 'Correct Alice',
    });
    const wrong = await createIdentityBackedFace(ctx, faceIdentityRepository, {
      ownerId: owner.id,
      personName: 'Wrong Bob',
    });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id, faceRecognitionEnabled: true });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: correct.asset.id, addedById: owner.id });
    const wrongSpacePerson = await ctx.database
      .insertInto('shared_space_person')
      .values({
        spaceId: space.id,
        identityId: wrong.identity.id,
        representativeFaceId: correct.faceId,
        type: 'person',
        faceCount: 1,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await ctx.database
      .insertInto('shared_space_person_face')
      .values({ personId: wrongSpacePerson.id, assetFaceId: correct.faceId })
      .execute();

    await sharedSpaceService.handleSharedSpaceFaceMatchFromBackfill({ spaceId: space.id, assetId: correct.asset.id });

    const selectedFaces = await ctx.database
      .selectFrom('shared_space_person_face')
      .innerJoin('shared_space_person', 'shared_space_person.id', 'shared_space_person_face.personId')
      .select(['shared_space_person.id', 'shared_space_person.identityId', 'shared_space_person_face.assetFaceId'])
      .where('shared_space_person.spaceId', '=', space.id)
      .orderBy('shared_space_person.identityId')
      .execute();
    const wrongPerson = await ctx.database
      .selectFrom('shared_space_person')
      .select(['id', 'faceCount'])
      .where('id', '=', wrongSpacePerson.id)
      .executeTakeFirst();

    expect(selectedFaces).toEqual([
      {
        id: expect.any(String),
        identityId: correct.identity.id,
        assetFaceId: correct.faceId,
      },
    ]);
    expect(wrongPerson).toBeUndefined();
  } finally {
    await ctx.database.deleteFrom('user').where('id', '=', owner.id).execute();
  }
});
```

- [ ] **Step 11: Run the focused red check**

Run from `server/`:

```bash
pnpm exec vitest --config test/vitest.config.medium.mjs run test/medium/specs/services/people-identity-rbac.spec.ts -t "targeted identity backfill repairs wrong-identity selected-space assignments"
```

Expected: fail if a stale wrong-identity assignment remains, the new identity-correct assignment is missing, or orphaned wrong-identity people survive.

- [ ] **Step 12: Add the EXIF/imported face targeted-backfill test**

Add `SourceType` to the enum imports in `people-identity-rbac.spec.ts`, then add:

```ts
it('identity backfill uses targeted projection for EXIF-imported face evidence', async () => {
  const { ctx, sut, faceIdentityRepository } = setup();
  const jobs = ctx.getMock<JobRepository, Mocked<JobRepository>>(JobRepository);
  const { user: owner } = await ctx.newUser();
  try {
    const { space } = await ctx.newSharedSpace({ createdById: owner.id, faceRecognitionEnabled: true });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    const { person } = await ctx.newPerson({ ownerId: owner.id, identityId: null, name: 'Imported Alice' });
    const { asset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: owner.id });
    await ctx.newAssetFace({ assetId: asset.id, personId: person.id, sourceType: SourceType.Exif });

    await sut.handleFaceIdentityBackfill({ stage: 'person' });

    const queuedTargetJobs = jobs.queueAll.mock.calls.flatMap(([items]) => items);
    expect(queuedTargetJobs).toEqual([
      { name: JobName.SharedSpaceFaceMatchFromBackfill, data: { spaceId: space.id, assetId: asset.id } },
    ]);
    expect(jobs.queue).not.toHaveBeenCalledWith(expect.objectContaining({ name: JobName.SharedSpaceFaceMatchAll }));
    await expect(faceIdentityRepository.hasBackfillWork()).resolves.toBe(true);
  } finally {
    await ctx.database.deleteFrom('user').where('id', '=', owner.id).execute();
  }
});
```

- [ ] **Step 13: Run the focused red check**

Run from `server/`:

```bash
pnpm exec vitest --config test/vitest.config.medium.mjs run test/medium/specs/services/people-identity-rbac.spec.ts -t "identity backfill uses targeted projection for EXIF-imported face evidence"
```

Expected: fail if imported/EXIF face evidence falls back to `SharedSpaceFaceMatchAll` or does not queue a targeted from-backfill projection job.

- [ ] **Step 14: Add force-reset full rebuild medium coverage**

Add this medium test in `people-identity-rbac.spec.ts`:

```ts
it('force recognition still rebuilds shared-space projections through full-space jobs', async () => {
  const { ctx, sut, faceIdentityRepository } = setup();
  const { sut: sharedSpaceService, jobs: sharedJobs } = setupSharedSpace();
  const jobs = ctx.getMock<JobRepository, Mocked<JobRepository>>(JobRepository);
  jobs.waitForQueueCompletion.mockResolvedValue();
  jobs.empty.mockResolvedValue();
  jobs.getJobCounts.mockResolvedValue({ active: 0, waiting: 0, delayed: 0, paused: 0, failed: 0 });
  const { user: owner } = await ctx.newUser();
  try {
    const { space } = await ctx.newSharedSpace({ createdById: owner.id, faceRecognitionEnabled: true });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    const { person } = await ctx.newPerson({ ownerId: owner.id, name: 'EXIF Alice' });
    const identity = await faceIdentityRepository.ensurePersonIdentity(person.id);
    const { asset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
    const { assetFace } = await ctx.newAssetFace({
      assetId: asset.id,
      personId: person.id,
      sourceType: SourceType.Exif,
    });
    await faceIdentityRepository.linkFace({
      assetFaceId: assetFace.id,
      identityId: identity.id,
      source: 'owner-person',
    });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: owner.id });
    const staleSpacePerson = await ctx.database
      .insertInto('shared_space_person')
      .values({ spaceId: space.id, identityId: identity.id, representativeFaceId: assetFace.id, type: 'person' })
      .returningAll()
      .executeTakeFirstOrThrow();
    await ctx.database
      .insertInto('shared_space_person_face')
      .values({ personId: staleSpacePerson.id, assetFaceId: assetFace.id })
      .execute();

    await sut.handleQueueRecognizeFaces({ force: true });

    const fullRebuildJobs = jobs.queueAll.mock.calls
      .flatMap(([items]) => items)
      .filter((job) => job.name === JobName.SharedSpaceFaceMatchAll);
    expect(fullRebuildJobs).toEqual([{ name: JobName.SharedSpaceFaceMatchAll, data: { spaceId: space.id } }]);
    expect(jobs.queueAll.mock.calls.flatMap(([items]) => items)).not.toContainEqual(
      expect.objectContaining({ name: JobName.SharedSpaceFaceMatchFromBackfill }),
    );

    for (const job of fullRebuildJobs) {
      await sharedSpaceService.handleSharedSpaceFaceMatchAll(job.data);
    }
    await drainSharedSpaceFaceJobs(sharedSpaceService, sharedJobs);

    const selectedFaces = await ctx.database
      .selectFrom('shared_space_person_face')
      .innerJoin('shared_space_person', 'shared_space_person.id', 'shared_space_person_face.personId')
      .select(['shared_space_person.spaceId', 'shared_space_person.identityId', 'shared_space_person_face.assetFaceId'])
      .where('shared_space_person.spaceId', '=', space.id)
      .execute();
    expect(selectedFaces).toEqual([{ spaceId: space.id, identityId: identity.id, assetFaceId: assetFace.id }]);
  } finally {
    await ctx.database.deleteFrom('user').where('id', '=', owner.id).execute();
  }
});
```

- [ ] **Step 15: Run the focused red check**

Run from `server/`:

```bash
pnpm exec vitest --config test/vitest.config.medium.mjs run test/medium/specs/services/people-identity-rbac.spec.ts -t "force recognition still rebuilds shared-space projections through full-space jobs"
```

Expected: fail only if force recognition no longer queues full-space rebuild jobs for enabled spaces.

- [ ] **Step 16: Patch production only if these tests fail**

Patch only the root cause:

- Missing jobs: check `PersonService.queueSharedSpaceFaceMatchTargets()`.
- Full rebuild queued: check `PersonService.handleFaceIdentityBackfill()` for accidental `SharedSpaceFaceMatchAll`.
- Disabled spaces queued: check `FaceIdentityRepository.getSharedSpaceFaceMatchBackfillTargets()`.
- Pending targets left after queue success: check `deletePendingSharedSpaceFaceMatchBackfillTargets()` call ordering.
- Selected-space rows missing after job drain: check `SharedSpaceService.handleSharedSpaceFaceMatchFromBackfill()` delegates to current-state `handleSharedSpaceFaceMatch()`.
- Duplicate direct-plus-linked materialization: check both `FaceIdentityRepository.getSharedSpaceFaceMatchBackfillTargets()` and shared-space face assignment unique paths.
- Stale wrong-identity assignment survives: check `processSpaceFaceMatch()` stale assignment cleanup, recount, and orphan cleanup.

- [ ] **Step 17: Verify and commit Task 5**

Run from `server/`:

```bash
pnpm exec vitest --config test/vitest.config.medium.mjs run test/medium/specs/services/people-identity-rbac.spec.ts -t "identity backfill queues targeted projection jobs|identity backfill materializes one selected-space assignment|delays page-one projection fanout|directly added and linked by library|wrong-identity selected-space assignments|EXIF-imported face evidence|force recognition still rebuilds shared-space projections"
```

Commit:

```bash
git add server/test/medium/specs/services/people-identity-rbac.spec.ts server/src/services/person.service.ts server/src/services/shared-space.service.ts server/src/repositories/face-identity.repository.ts
git commit -m "test: cover identity backfill projection materialization"
```

---

## Task 6: Metadata Visibility After Membership And Timeline Changes

**Files:**

- Modify: `server/test/medium/specs/services/people-identity-rbac.spec.ts`
- Production only if needed: `server/src/repositories/shared-space.repository.ts`
- Production only if needed: `server/src/services/shared-space.service.ts`

**Coverage:**

- removing membership prevents stale inherited metadata from surfacing globally
- disabling timeline for the asset-adder/source member prevents stale shared-space metadata candidates
- metadata backfill clears stale inherited metadata when source evidence becomes inaccessible
- non-members and admins cannot see inherited shared-space metadata after access is removed

- [ ] **Step 1: Add membership removal stale metadata test**

Add this medium test near the existing timeline/membership RBAC tests:

```ts
it('clears stale inherited metadata after membership removal before global discovery', async () => {
  const { ctx, sut, faceIdentityRepository } = setup();
  const { sut: sharedSpaceService } = setupSharedSpace();
  const { user: owner } = await ctx.newUser();
  const { user: member } = await ctx.newUser();
  const { user: source } = await ctx.newUser();
  const { user: admin } = await ctx.newUser({ isAdmin: true });
  try {
    const { space } = await ctx.newSharedSpace({ createdById: owner.id, faceRecognitionEnabled: true });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Viewer });
    await ctx.newSharedSpaceMember({
      spaceId: space.id,
      userId: source.id,
      role: SharedSpaceRole.Editor,
      sharePersonMetadata: true,
    });
    const { person: sourcePerson } = await ctx.newPerson({ ownerId: source.id, name: 'Source Alice' });
    const identity = await faceIdentityRepository.ensurePersonIdentity(sourcePerson.id);
    const { asset } = await ctx.newAsset({ ownerId: source.id, visibility: AssetVisibility.Timeline });
    const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: sourcePerson.id });
    await faceIdentityRepository.linkFace({
      assetFaceId: assetFace.id,
      identityId: identity.id,
      source: 'owner-person',
    });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: source.id });
    const spacePerson = await ctx.database
      .insertInto('shared_space_person')
      .values({
        spaceId: space.id,
        identityId: identity.id,
        name: 'Source Alice',
        nameSource: 'inherited',
        nameSourceProfileType: 'user-person',
        nameSourceProfileId: sourcePerson.id,
        representativeFaceId: assetFace.id,
        type: 'person',
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await ctx.database
      .insertInto('shared_space_person_face')
      .values({ personId: spacePerson.id, assetFaceId: assetFace.id })
      .execute();

    await ctx.database
      .deleteFrom('shared_space_member')
      .where('spaceId', '=', space.id)
      .where('userId', '=', source.id)
      .execute();
    await sharedSpaceService.handleSharedSpacePersonMetadataBackfill({ identityId: identity.id, limit: 1000 });

    const refreshed = await ctx.database
      .selectFrom('shared_space_person')
      .select(['name', 'nameSource', 'nameSourceProfileId'])
      .where('id', '=', spacePerson.id)
      .executeTakeFirstOrThrow();
    const people = await sut.getAll(factory.auth({ user: member }), {
      withHidden: true,
      withSharedSpaces: true,
      page: 1,
      size: 50,
    } as any);
    const adminPeople = await sut.getAll(factory.auth({ user: admin }), {
      withHidden: true,
      withSharedSpaces: true,
      page: 1,
      size: 50,
    } as any);

    expect(refreshed).toEqual({ name: '', nameSource: 'none', nameSourceProfileId: null });
    expect(JSON.stringify(people)).not.toContain('Source Alice');
    expect(JSON.stringify(adminPeople)).not.toContain('Source Alice');
  } finally {
    await ctx.database.deleteFrom('user').where('id', 'in', [owner.id, member.id, source.id, admin.id]).execute();
  }
});
```

- [ ] **Step 2: Run the focused red check**

Run from `server/`:

```bash
pnpm exec vitest --config test/vitest.config.medium.mjs run test/medium/specs/services/people-identity-rbac.spec.ts -t "clears stale inherited metadata after membership removal before global discovery"
```

Expected: fail if `getMetadataInheritanceCandidates()` still considers removed members or stale inherited metadata remains visible.

- [ ] **Step 3: Add timeline-disabled source metadata test**

Add:

```ts
it('excludes timeline-disabled space profile metadata from later metadata backfills', async () => {
  const { ctx, sut, faceIdentityRepository } = setup();
  const { sut: sharedSpaceService } = setupSharedSpace();
  const { user: owner } = await ctx.newUser();
  const { user: viewer } = await ctx.newUser();
  try {
    const { person: personalPerson } = await ctx.newPerson({ ownerId: owner.id, name: 'Owner Alice' });
    const identity = await faceIdentityRepository.ensurePersonIdentity(personalPerson.id);
    const { space: sourceSpace } = await ctx.newSharedSpace({ createdById: owner.id, faceRecognitionEnabled: true });
    const { space: targetSpace } = await ctx.newSharedSpace({ createdById: owner.id, faceRecognitionEnabled: true });
    await ctx.newSharedSpaceMember({ spaceId: sourceSpace.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: targetSpace.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: sourceSpace.id, userId: viewer.id, role: SharedSpaceRole.Viewer });
    await ctx.newSharedSpaceMember({ spaceId: targetSpace.id, userId: viewer.id, role: SharedSpaceRole.Viewer });
    await ctx.database
      .updateTable('shared_space_member')
      .set({ showInTimeline: false })
      .where('spaceId', '=', sourceSpace.id)
      .where('userId', '=', viewer.id)
      .execute();
    const { asset: targetAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
    const { assetFace: targetFace } = await ctx.newAssetFace({ assetId: targetAsset.id, personId: personalPerson.id });
    await faceIdentityRepository.linkFace({
      assetFaceId: targetFace.id,
      identityId: identity.id,
      source: 'owner-person',
    });
    await ctx.newSharedSpaceAsset({ spaceId: targetSpace.id, assetId: targetAsset.id, addedById: viewer.id });
    const sourceSpacePerson = await ctx.database
      .insertInto('shared_space_person')
      .values({
        spaceId: sourceSpace.id,
        identityId: identity.id,
        name: 'Hidden Timeline Alias',
        type: 'person',
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    const targetSpacePerson = await ctx.database
      .insertInto('shared_space_person')
      .values({
        spaceId: targetSpace.id,
        identityId: identity.id,
        name: 'Hidden Timeline Alias',
        nameSource: 'inherited',
        nameSourceProfileType: 'space-person',
        nameSourceProfileId: sourceSpacePerson.id,
        representativeFaceId: targetFace.id,
        type: 'person',
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await ctx.database
      .insertInto('shared_space_person_face')
      .values({ personId: targetSpacePerson.id, assetFaceId: targetFace.id })
      .execute();

    await sharedSpaceService.handleSharedSpacePersonMetadataBackfill({ identityId: identity.id, limit: 1000 });

    const refreshed = await ctx.database
      .selectFrom('shared_space_person')
      .select(['name', 'nameSource', 'nameSourceProfileType', 'nameSourceProfileId'])
      .where('id', '=', targetSpacePerson.id)
      .executeTakeFirstOrThrow();
    const people = await sut.getAll(factory.auth({ user: viewer }), {
      withHidden: true,
      withSharedSpaces: true,
      page: 1,
      size: 50,
    } as any);

    expect(refreshed.name).not.toBe('Hidden Timeline Alias');
    expect(JSON.stringify(people)).not.toContain('Hidden Timeline Alias');
  } finally {
    await ctx.database.deleteFrom('user').where('id', 'in', [owner.id, viewer.id]).execute();
  }
});
```

- [ ] **Step 4: Run the focused red check**

Run from `server/`:

```bash
pnpm exec vitest --config test/vitest.config.medium.mjs run test/medium/specs/services/people-identity-rbac.spec.ts -t "excludes timeline-disabled space profile metadata from later metadata backfills"
```

Expected: fail if timeline-hidden source space profiles can continue contributing inherited metadata.

- [ ] **Step 5: Patch production only if these tests fail**

If removed members leak metadata, keep the personal candidate join constrained to current target-space members:

```ts
.innerJoin('shared_space_member', (join) =>
  join
    .onRef('shared_space_member.userId', '=', 'person.ownerId')
    .on('shared_space_member.spaceId', '=', input.spaceId)
    .on('shared_space_member.sharePersonMetadata', '=', true),
)
```

If timeline-hidden source space profiles leak metadata, keep the visible-space candidate join constrained by `source_member.showInTimeline = true` and target member `sharePersonMetadata = true`.

- [ ] **Step 6: Verify and commit Task 6**

Run from `server/`:

```bash
pnpm exec vitest --config test/vitest.config.medium.mjs run test/medium/specs/services/people-identity-rbac.spec.ts -t "membership removal|timeline-disabled|metadata"
```

Commit:

```bash
git add server/test/medium/specs/services/people-identity-rbac.spec.ts server/src/repositories/shared-space.repository.ts server/src/services/shared-space.service.ts
git commit -m "test: cover metadata visibility after access changes"
```

---

## Task 7: Scoped Merge And Detach Metadata Visibility

**Files:**

- Modify: `server/test/medium/specs/services/people-identity-rbac.spec.ts`
- Production only if needed: `server/src/repositories/face-identity.repository.ts`
- Production only if needed: `server/src/repositories/shared-space.repository.ts`
- Production only if needed: `server/src/services/shared-space.service.ts`

**Coverage:**

- scoped merge updates metadata visibility without leaking inaccessible profiles
- detach moves scoped profile evidence to a new identity and metadata backfill no longer inherits old identity metadata
- stale source person IDs do not remain in inherited source columns after merge or detach

- [ ] **Step 1: Add the scoped merge metadata visibility test**

Add inside `describe('repair RBAC')`:

```ts
it('scoped merge keeps inherited metadata limited to accessible profiles', async () => {
  const fx = await setupRepairFixture(SharedSpaceRole.Editor);
  await fx.ctx.database
    .updateTable('person')
    .set({ name: 'Actor Alice', birthDate: '1990-01-01' })
    .where('id', '=', fx.actorPerson.id)
    .execute();
  await fx.ctx.database
    .updateTable('shared_space_person')
    .set({
      name: 'Stale Space Alice',
      nameSource: 'inherited',
      nameSourceProfileType: 'space-person',
      nameSourceProfileId: fx.spacePerson.id,
      birthDate: '1980-01-01',
      birthDateSource: 'inherited',
      birthDateSourceProfileType: 'space-person',
      birthDateSourceProfileId: fx.spacePerson.id,
    })
    .where('id', '=', fx.spacePerson.id)
    .execute();

  await fx.sut.mergeScopedPeople(factory.auth({ user: fx.actor }), {
    target: { type: 'person', id: fx.actorPerson.id },
    sources: [{ type: 'space-person', id: fx.spacePerson.id, spaceId: fx.space.id }],
  });

  const { sut: sharedSpaceService } = setupSharedSpace();
  await sharedSpaceService.handleSharedSpacePersonMetadataBackfill({ identityId: fx.targetIdentity.id, limit: 1000 });

  const updatedSpacePerson = await fx.ctx.database
    .selectFrom('shared_space_person')
    .select([
      'identityId',
      'name',
      'nameSource',
      'nameSourceProfileType',
      'nameSourceProfileId',
      'birthDate',
      'birthDateSource',
      'birthDateSourceProfileType',
      'birthDateSourceProfileId',
    ])
    .where('id', '=', fx.spacePerson.id)
    .executeTakeFirstOrThrow();
  const nonMemberPeople = await fx.sut.getAll(factory.auth({ user: fx.otherUser }), {
    withHidden: true,
    withSharedSpaces: true,
    page: 1,
    size: 50,
  } as any);

  expect(updatedSpacePerson.identityId).toBe(fx.targetIdentity.id);
  expect(updatedSpacePerson).toEqual(
    expect.objectContaining({
      name: 'Actor Alice',
      nameSource: 'inherited',
      nameSourceProfileType: 'user-person',
      nameSourceProfileId: fx.actorPerson.id,
      birthDateSource: 'inherited',
      birthDateSourceProfileType: 'user-person',
      birthDateSourceProfileId: fx.actorPerson.id,
    }),
  );
  expect(updatedSpacePerson.nameSourceProfileId).not.toBe(fx.spacePerson.id);
  expect(updatedSpacePerson.birthDateSourceProfileId).not.toBe(fx.spacePerson.id);
  expect(JSON.stringify(nonMemberPeople)).not.toContain(fx.spacePerson.id);
  expect(JSON.stringify(nonMemberPeople)).not.toContain('Stale Space Alice');
});
```

- [ ] **Step 2: Run the focused red check**

Run from `server/`:

```bash
pnpm exec vitest --config test/vitest.config.medium.mjs run test/medium/specs/services/people-identity-rbac.spec.ts -t "scoped merge keeps inherited metadata limited to accessible profiles"
```

Expected: fail if merge leaves inherited metadata pointing at inaccessible source profiles or leaks source scoped IDs.

- [ ] **Step 3: Add the detach metadata visibility test**

Add:

```ts
it('detach keeps old identity metadata from leaking through the detached profile', async () => {
  const fx = await setupRepairFixture(SharedSpaceRole.Editor);
  await fx.ctx.database
    .updateTable('person')
    .set({ name: 'Actor Alice', birthDate: '1990-01-01' })
    .where('id', '=', fx.actorPerson.id)
    .execute();
  await fx.ctx.database
    .updateTable('shared_space_person')
    .set({
      name: 'Old Actor Alice',
      nameSource: 'inherited',
      nameSourceProfileType: 'user-person',
      nameSourceProfileId: fx.actorPerson.id,
      birthDate: '1990-01-01',
      birthDateSource: 'inherited',
      birthDateSourceProfileType: 'user-person',
      birthDateSourceProfileId: fx.actorPerson.id,
    })
    .where('id', '=', fx.spacePerson.id)
    .execute();
  const newIdentityId = await fx.faceIdentityRepository.detachScopedProfile({
    profileType: 'space-person',
    profileId: fx.spacePerson.id,
  });
  const { sut: sharedSpaceService } = setupSharedSpace();

  await sharedSpaceService.handleSharedSpacePersonMetadataBackfill({ identityId: newIdentityId, limit: 1000 });

  const detached = await fx.ctx.database
    .selectFrom('shared_space_person')
    .select([
      'identityId',
      'name',
      'nameSource',
      'nameSourceProfileId',
      'birthDate',
      'birthDateSource',
      'birthDateSourceProfileId',
    ])
    .where('id', '=', fx.spacePerson.id)
    .executeTakeFirstOrThrow();
  const targetPerson = await fx.ctx.database
    .selectFrom('person')
    .select('identityId')
    .where('id', '=', fx.actorPerson.id)
    .executeTakeFirstOrThrow();

  expect(detached.identityId).toBe(newIdentityId);
  expect(detached.identityId).not.toBe(targetPerson.identityId);
  expect(detached).toEqual(
    expect.objectContaining({
      name: '',
      nameSource: 'none',
      nameSourceProfileId: null,
      birthDate: null,
      birthDateSource: 'none',
      birthDateSourceProfileId: null,
    }),
  );
});
```

- [ ] **Step 4: Run the focused red check**

Run from `server/`:

```bash
pnpm exec vitest --config test/vitest.config.medium.mjs run test/medium/specs/services/people-identity-rbac.spec.ts -t "detach keeps old identity metadata from leaking through the detached profile"
```

Expected: fail if detach leaves the space person on the old identity or metadata backfill keeps old source profile IDs.

- [ ] **Step 5: Patch production only if these tests fail**

Patch the smallest proven issue:

- Merge identity leak: inspect `FaceIdentityRepository.mergeIdentities()` and scoped-profile conflict guards.
- Detach identity leak: inspect `FaceIdentityRepository.detachScopedProfile()`.
- Metadata source leak: inspect `SharedSpaceService.inheritSpacePersonMetadata()` stale clear branches and `SharedSpaceRepository.getMetadataInheritanceCandidates()`.

- [ ] **Step 6: Verify and commit Task 7**

Run from `server/`:

```bash
pnpm exec vitest --config test/vitest.config.medium.mjs run test/medium/specs/services/people-identity-rbac.spec.ts -t "repair RBAC|scoped merge|detach"
```

Commit:

```bash
git add server/test/medium/specs/services/people-identity-rbac.spec.ts server/src/repositories/face-identity.repository.ts server/src/repositories/shared-space.repository.ts server/src/services/shared-space.service.ts
git commit -m "test: cover scoped repair metadata visibility"
```

---

## Task 8: Final Slice 6 Verification

**Files:**

- All files touched in Tasks 1-7.

- [ ] **Step 1: Run focused small tests**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter immich exec vitest --config test/vitest.config.mjs run src/services/person.service.spec.ts -t "onBootstrap|handleFaceIdentityBackfill|handleFaceIdentityMaintenanceAfterRecognition"
pnpm --config.verify-deps-before-run=false --filter immich exec vitest --config test/vitest.config.mjs run src/services/shared-space.service.spec.ts -t "backfillSpacePersonMetadata|handleSharedSpacePersonMetadataBackfill|SharedSpaceFaceMatchFromBackfill"
pnpm --config.verify-deps-before-run=false --filter immich exec vitest --config test/vitest.config.mjs run src/repositories/job.repository.spec.ts
```

Expected: all focused small tests pass.

- [ ] **Step 2: Run focused medium tests**

Run from `server/`:

```bash
pnpm exec vitest --config test/vitest.config.medium.mjs run test/medium/specs/repositories/face-identity.repository.spec.ts
pnpm exec vitest --config test/vitest.config.medium.mjs run test/medium/specs/services/people-identity-rbac.spec.ts
```

Expected: both medium specs pass. If local medium dependencies are unavailable, document the exact missing dependency and run the affected focused selectors in CI.

- [ ] **Step 3: Run type checking**

Run:

```bash
pnpm --dir server check
```

Expected: TypeScript passes.

- [ ] **Step 4: Run lint and broad small-test verification**

Run:

```bash
pnpm --dir server lint
pnpm --config.verify-deps-before-run=false --filter immich exec vitest --config test/vitest.config.mjs run
```

Expected: ESLint passes with zero warnings and the broad server small-test suite passes. If the broad test suite is too slow locally, run it before opening the PR or document why CI is the first full broad run.

- [ ] **Step 5: Run formatting checks**

Run:

```bash
pnpm --dir server exec prettier --check src/services/person.service.spec.ts src/services/shared-space.service.spec.ts src/repositories/job.repository.spec.ts test/medium/specs/repositories/face-identity.repository.spec.ts test/medium/specs/services/people-identity-rbac.spec.ts
pnpm --dir docs exec prettier --check superpowers/plans/2026-05-18-face-identity-backfill-and-metadata-safety.md
git diff --check
```

Expected: formatting checks pass and `git diff --check` emits no output.

- [ ] **Step 6: Inspect final diff**

Run:

```bash
git diff --stat origin/main...HEAD
git diff --name-only origin/main...HEAD
```

Expected: diff contains this plan, Slice 6 tests, and any minimal production fixes directly proven by the new tests.

- [ ] **Step 7: Final commit**

If any verification-only fixes remain:

```bash
git add docs/superpowers/plans/2026-05-18-face-identity-backfill-and-metadata-safety.md server/src/services/person.service.spec.ts server/src/services/shared-space.service.spec.ts server/src/repositories/job.repository.spec.ts server/test/medium/specs/repositories/face-identity.repository.spec.ts server/test/medium/specs/services/people-identity-rbac.spec.ts server/src/services/person.service.ts server/src/services/shared-space.service.ts server/src/repositories/face-identity.repository.ts server/src/repositories/shared-space.repository.ts server/src/repositories/job.repository.ts
git commit -m "test: cover face identity backfill metadata safety"
```

## Edge Case Checklist

The implementation is complete only when these Slice 6 edge cases are explicitly covered by tests:

- Personal cursor page queues only the next personal page.
- Direct `space-person` cursor page queues only the next space-person page.
- Identity work remaining after final pages requeues `FaceIdentityBackfill` root only.
- Lower-cursor identity work appearing during a cursor run is caught by final work summary.
- Projection discovery is skipped while identity work remains.
- Pending durable targets survive queue failure.
- Pending durable targets are deleted after successful queueing.
- Page-one durable targets are not queued early and are recovered by final-page service fan-out.
- Pending, repair-returned, and projection-discovered targets dedupe together.
- Multiple faces on one asset queue one asset-level projection job per space.
- Same photo in many spaces queues one target per enabled space.
- Direct shared-space asset membership plus linked-library membership materializes exactly one selected-space face assignment.
- Stale wrong-identity selected-space assignments are moved to the identity-correct person and old orphaned rows are cleaned up.
- EXIF/imported face evidence uses targeted from-backfill projection jobs, not `SharedSpaceFaceMatchAll`.
- Disabled spaces, deleted assets, offline assets, hidden/deleted faces, unassigned faces, and identity-less faces are excluded from projection fan-out.
- Identity-less assigned faces are identity work, not projection work.
- `SharedSpaceFaceMatchAll` is never queued by identity backfill.
- Force recognition reset still queues `SharedSpaceFaceMatchAll` outside identity backfill.
- `SharedSpaceFaceMatchFromBackfill` uses stable source-specific job IDs.
- Metadata backfill remains on `QueueName.PeopleBackfill`.
- Metadata backfill cursoring preserves `identityId` scope.
- Metadata inheritance uses only accessible candidates.
- Metadata inheritance uses only type-compatible candidates.
- Same-priority conflicting names or birth dates leave existing metadata unchanged.
- Asset-adder metadata wins when priority is otherwise tied.
- Manual name and manual birth date are never overwritten by metadata backfill.
- Stale inherited name and birth date clear when candidates disappear.
- Membership removal prevents stale inherited metadata from surfacing globally.
- Timeline-disabled source space people do not contribute inherited metadata.
- Scoped merge and detach do not leak inaccessible source profile IDs through metadata.

## Out Of Scope

- Slice 5 shared-space projection handler behavior is not reimplemented here; only targeted jobs queued by Slice 6 are drained in medium tests.
- Slice 7 manual people delete/merge/reassign destructive operations remain separate unless they are needed as setup for metadata visibility assertions.
- Slice 8 overnight cross-slice queue-chain composition remains separate.
- Reworking identity reconciliation scoring, face-match thresholds, or metadata priority rules is not part of Slice 6 unless a new test proves the existing implementation violates the Slice 6 contract.

## Self-Review Checklist

- Spec coverage: every Slice 6 bullet maps to existing preserved coverage or Tasks 1-7 above.
- TDD: every task starts with a failing focused test and lists the exact focused command.
- Edge cases: the checklist includes race windows, durable pending targets, access removal, timeline visibility, type compatibility, manual source preservation, and full rebuild avoidance.
- Independence: the plan is based on `origin/main` and does not require the Slice 5 PR branch. If Slice 5 lands first, keep overlapping tests only if they still add Slice 6-specific assertions.
- Destructive safety: medium tests assert final database state, not only queued job calls.
