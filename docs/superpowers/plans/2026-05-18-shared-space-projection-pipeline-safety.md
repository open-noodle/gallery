# Shared-Space Projection Pipeline Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Slice 5 safety coverage for shared-space face projection jobs so stale, missing, duplicate, disabled, and linked-library paths cannot corrupt selected-space people or identity-backed face assignments.

**Architecture:** Keep queue metadata, stable job id, and handler branch coverage in small service/repository tests. Use DB-backed medium tests for destructive selected-space projection outcomes because correctness depends on real constraints, cascades, recounts, and repository cleanup. Make production changes only when a red test proves existing behavior is unsafe, and keep fixes limited to `server/src/services/shared-space.service.ts`, `server/src/repositories/shared-space.repository.ts`, or `server/src/repositories/job.repository.ts`.

**Tech Stack:** TypeScript, NestJS service tests, Vitest, Gallery small factories, Gallery medium DB harness, Kysely, BullMQ job metadata, shared-space identity repositories.

---

## Slice 5 Source

Spec: `docs/superpowers/specs/2026-05-17-face-identity-queue-testing-plan-design.md`

Slice 5 purpose: pin `SharedSpaceFaceMatch`, `SharedSpaceFaceMatchFromBackfill`, `SharedSpaceLibraryFaceSync`, `SharedSpaceFaceMatchAll`, and `SharedSpaceFaceMatchPage`.

Slice 4 status: already implemented on PR #604 (`codex/face-trigger-slice-4-plan`) and green as of the last babysit run. This Slice 5 plan is based on `origin/main` so it does not depend on the still-open Slice 4 branch.

## Existing Coverage To Preserve

`server/src/services/shared-space.service.spec.ts` already covers:

- missing and disabled spaces for `SharedSpaceFaceMatch`, `SharedSpaceFaceMatchFromBackfill`, `SharedSpaceFaceMatchAll`, `SharedSpaceFaceMatchPage`, `SharedSpaceLibraryFaceSync`, and `SharedSpacePersonDedup`
- targeted asset removed before execution for `SharedSpaceFaceMatch`
- identity-backed face attach/create paths
- nearby different identity does not override identity-backed matching
- stale selected-space assignment replacement
- wrong-identity selected-space assignment replacement
- type-incompatible assignment removal
- exact identity-backfill metadata refresh
- legacy no-identity face path
- no-person face wait path
- pet matching and type setting
- affected people queue `SharedSpaceIdentityReconciliation`
- successful target match queues `SharedSpacePersonDedup`
- `SharedSpaceFaceMatchFromBackfill` runs on `QueueName.PeopleBackfill`
- other shared-space face pipeline jobs run on `QueueName.FacialRecognition`
- full-space dispatcher queues only the first page
- page lookahead, batch clamping, continuation, disabled-between-pages, and final follow-up behavior
- library face sync link recheck and stop-after-unlink behavior

`server/test/medium/specs/services/shared-space-face-identity-repair.spec.ts` already covers:

- linked-library full rematch assigns EXIF identity faces without embeddings
- one identity-backed space person across multiple linked libraries
- stale linked-library assignment repair
- linked-library relink rebuild
- no-identity pet legacy path
- type-incompatible full rematch cleanup

`server/test/medium/specs/repositories/shared-space-face-matching.spec.ts` already covers repository-level selected-space face assignment behavior:

- duplicate assignment attempts are idempotent
- asset-face cascades remove selected-space face rows
- selected-space orphan cleanup removes faceless space people
- multiple-space and linked-library repository paths stay isolated

This plan fills the remaining high-risk gaps from Slice 5: `SharedSpaceFaceMatchFromBackfill` stable job ids, from-backfill asset-removal safety, identity-backed pet incompatibility in small tests, no-work linked-library follow-up suppression, and DB-backed destructive cleanup/duplication invariants.

## File Structure

- Modify: `server/src/repositories/job.repository.spec.ts`
  - Owns stable job id and failed/paused job behavior for `SharedSpaceFaceMatchFromBackfill`.
- Modify: `server/src/services/shared-space.service.spec.ts`
  - Owns small handler coverage for from-backfill targeted asset removal, identity-backed pet incompatibility, and no-work library-sync follow-up behavior.
- Modify only if a new red test proves unsafe behavior: `server/src/repositories/job.repository.ts`
  - Owns `SharedSpaceFaceMatchFromBackfill` job id and stable shared-space face pipeline treatment.
- Modify only if a new red test proves unsafe behavior: `server/src/services/shared-space.service.ts`
  - Owns handler skip/follow-up behavior and shared-space projection repair orchestration.
- Modify only if a new red test proves unsafe behavior: `server/src/repositories/shared-space.repository.ts`
  - Owns selected-space assignment cleanup, orphan deletion, and asset/library face selection queries.
- Modify: `server/test/medium/specs/services/shared-space-face-identity-repair.spec.ts`
  - Owns DB-backed destructive projection tests for missing, stale, wrong-identity, direct-plus-linked duplicate, direct asset removal, and library unlink cleanup.
- Verify: `server/test/medium/specs/repositories/shared-space-face-matching.spec.ts`
  - Preserves repository-level selected-space assignment idempotency, cascade cleanup, orphan cleanup, and linked-library isolation coverage required by the Slice 5 design.

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
/home/pierre/dev/gallery/.worktrees/face-trigger-slice-5-plan
codex/face-trigger-slice-5-plan
```

`git status --short` must be empty before implementation edits. If it lists files, inspect them and preserve user-owned work.

- [ ] **Step 2: Run the small Slice 5 baseline**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter immich exec vitest --config test/vitest.config.mjs run src/services/shared-space.service.spec.ts -t "handleSharedSpaceFaceMatch|handleSharedSpaceFaceMatchFromBackfill|handleSharedSpaceFaceMatchAll|handleSharedSpaceFaceMatchPage|handleSharedSpaceLibraryFaceSync"
```

Expected: all matching existing small tests pass before new coverage is added.

- [ ] **Step 3: Run the job repository baseline**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter immich exec vitest --config test/vitest.config.mjs run src/repositories/job.repository.spec.ts -t "shared-space face pipeline|SharedSpaceFaceMatchFromBackfill|stable shared-space"
```

Expected: all matching existing job repository tests pass before new coverage is added.

- [ ] **Step 4: Run the medium Slice 5 baseline**

Run:

```bash
pnpm --filter immich test:medium -- --run test/medium/specs/services/shared-space-face-identity-repair.spec.ts
```

Expected: existing linked-library face identity repair medium tests pass before adding new destructive scenarios.

## TDD Protocol For This Slice

- [ ] **Step 1: Write the test first**

For each task, add the test before editing production code. If the test passes immediately, it still pins the behavior and should be committed as coverage.

- [ ] **Step 2: Run the smallest focused selector**

Use the exact `-t` selector shown in each task. Expected result is either a red failure proving an unsafe gap or a pass proving current behavior is safe.

- [ ] **Step 3: Make the smallest production fix only for red product behavior**

Only edit production files when the new test fails for product behavior. Do not refactor shared-space matching, identity reconciliation, metadata inheritance, or linked-library sync outside the failing branch.

- [ ] **Step 4: Re-run the focused selector**

Expected: the focused test passes.

- [ ] **Step 5: Commit each completed task**

Use one commit per task. Adjust staged paths to the files touched by the task.

## Task 1: From-Backfill Stable Job Identity

**Files:**

- Modify: `server/src/repositories/job.repository.spec.ts`
- Modify only if red: `server/src/repositories/job.repository.ts`

- [ ] **Step 1: Add `SharedSpaceFaceMatchFromBackfill` to stable visible-failure job id coverage**

In `server/src/repositories/job.repository.spec.ts`, update the test named `uses stable visible-failure job ids for shared-space face pipeline jobs`.

Replace the `setHandlers()` array with:

```ts
setHandlers(sut, [
  JobName.SharedSpaceFaceMatch,
  JobName.SharedSpaceFaceMatchFromBackfill,
  JobName.SharedSpaceFaceMatchAll,
  JobName.SharedSpaceFaceMatchPage,
  JobName.SharedSpacePersonDedup,
  JobName.SharedSpaceIdentityReconciliation,
]);
```

Replace the `queueAll()` input with:

```ts
await sut.queueAll([
  { name: JobName.SharedSpaceFaceMatch, data: { spaceId: 'space-1', assetId: 'asset-1' } },
  { name: JobName.SharedSpaceFaceMatch, data: { spaceId: 'space-1', assetId: 'asset-1' } },
  { name: JobName.SharedSpaceFaceMatch, data: { spaceId: 'space-2', assetId: 'asset-1' } },
  { name: JobName.SharedSpaceFaceMatchFromBackfill, data: { spaceId: 'space-1', assetId: 'asset-1' } },
  { name: JobName.SharedSpaceFaceMatchAll, data: { spaceId: 'space-1' } },
  { name: JobName.SharedSpaceFaceMatchPage, data: { spaceId: 'space-1' } },
  { name: JobName.SharedSpaceFaceMatchPage, data: { spaceId: 'space-1', afterAssetId: 'asset-9' } },
  { name: JobName.SharedSpacePersonDedup, data: { spaceId: 'space-1' } },
  { name: JobName.SharedSpaceIdentityReconciliation, data: { spaceId: 'space-1' } },
]);
```

Add this expectation after the existing `SharedSpaceFaceMatch` expectations:

```ts
expect(queue.add).toHaveBeenCalledWith(
  JobName.SharedSpaceFaceMatchFromBackfill,
  { spaceId: 'space-1', assetId: 'asset-1' },
  {
    jobId: 'shared-space-face-match/from-backfill/space-1/asset-1',
    removeOnComplete: true,
  },
);
```

- [ ] **Step 2: Add failed-job visibility coverage for from-backfill jobs**

Add this test after `does not remove failed stable shared-space jobs while queueing duplicates`:

```ts
it('does not remove failed from-backfill shared-space jobs while queueing duplicates', async () => {
  const { sut, queue } = setup();
  const failedJob = {
    getState: vi.fn().mockResolvedValue('failed'),
    remove: vi.fn().mockResolvedValue(void 0),
  };
  queue.getJob.mockResolvedValue(failedJob);
  setHandlers(sut, [JobName.SharedSpaceFaceMatchFromBackfill]);

  await sut.queue({
    name: JobName.SharedSpaceFaceMatchFromBackfill,
    data: { spaceId: 'space-1', assetId: 'asset-1' },
  });

  expect(queue.getJob).toHaveBeenCalledWith('shared-space-face-match/from-backfill/space-1/asset-1');
  expect(failedJob.getState).toHaveBeenCalled();
  expect(failedJob.remove).not.toHaveBeenCalled();
  expect(queue.add).toHaveBeenCalledWith(
    JobName.SharedSpaceFaceMatchFromBackfill,
    { spaceId: 'space-1', assetId: 'asset-1' },
    {
      jobId: 'shared-space-face-match/from-backfill/space-1/asset-1',
      removeOnComplete: true,
    },
  );
});
```

- [ ] **Step 3: Add paused replacement coverage for from-backfill jobs**

In the `it.each([...])('replaces paused stable %s jobs before requeueing them', ...)` table, add:

```ts
[
  JobName.SharedSpaceFaceMatchFromBackfill,
  { spaceId: 'space-1', assetId: 'asset-1' },
  'shared-space-face-match/from-backfill/space-1/asset-1',
],
```

- [ ] **Step 4: Run the focused job repository tests**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter immich exec vitest --config test/vitest.config.mjs run src/repositories/job.repository.spec.ts -t "from-backfill shared-space|stable visible-failure job ids|replaces paused stable"
```

Expected: PASS. If it fails because `SharedSpaceFaceMatchFromBackfill` does not get stable shared-space pipeline handling, update `server/src/repositories/job.repository.ts` so `getJobOptions()` returns:

```ts
case JobName.SharedSpaceFaceMatchFromBackfill: {
  return {
    jobId: `shared-space-face-match/from-backfill/${item.data.spaceId}/${item.data.assetId}`,
    removeOnComplete: true,
  };
}
```

and ensure `isSharedSpaceFacePipelineJob()` includes:

```ts
name === JobName.SharedSpaceFaceMatchFromBackfill;
```

- [ ] **Step 5: Commit Task 1**

```bash
git add server/src/repositories/job.repository.spec.ts server/src/repositories/job.repository.ts
git commit -m "test: cover from-backfill shared-space job ids"
```

If `server/src/repositories/job.repository.ts` was not changed, omit it from `git add`.

## Task 2: From-Backfill Targeted Handler Safety

**Files:**

- Modify: `server/src/services/shared-space.service.spec.ts`
- Modify only if red: `server/src/services/shared-space.service.ts`

- [ ] **Step 1: Add asset-removed safety coverage for from-backfill jobs**

In `server/src/services/shared-space.service.spec.ts`, inside `describe('handleSharedSpaceFaceMatchFromBackfill')`, add this test after `should skip when face recognition is disabled on the space`:

```ts
it('skips safely when a from-backfill asset is no longer in the space before execution', async () => {
  const spaceId = newUuid();
  const assetId = newUuid();

  mocks.sharedSpace.getById.mockResolvedValue(factory.sharedSpace({ id: spaceId, faceRecognitionEnabled: true }));
  mocks.sharedSpace.isAssetInSpace.mockResolvedValue(false);

  const result = await sut.handleSharedSpaceFaceMatchFromBackfill({ spaceId, assetId });

  expect(result).toBe(JobStatus.Success);
  expect(mocks.sharedSpace.getAssetFacesForMatching).not.toHaveBeenCalled();
  expect(mocks.sharedSpace.getPetFacesForAsset).not.toHaveBeenCalled();
  expect(mocks.sharedSpace.removePersonFaceAssignmentsForSpaceFace).not.toHaveBeenCalled();
  expect(mocks.sharedSpace.createPerson).not.toHaveBeenCalled();
  expect(mocks.sharedSpace.updatePerson).not.toHaveBeenCalled();
  expect(mocks.sharedSpace.addPersonFaces).not.toHaveBeenCalled();
  expect(mocks.sharedSpace.recountPersons).not.toHaveBeenCalled();
  expect(mocks.sharedSpace.deleteOrphanedPersonsByIds).not.toHaveBeenCalled();
  expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.SharedSpacePersonDedup, data: { spaceId } });
});
```

- [ ] **Step 2: Strengthen missing/disabled from-backfill no-mutation assertions**

Update the existing tests named `should skip when space not found` and `should skip when face recognition is disabled on the space` in the same describe block to include:

```ts
expect(mocks.sharedSpace.isAssetInSpace).not.toHaveBeenCalled();
expect(mocks.sharedSpace.getAssetFacesForMatching).not.toHaveBeenCalled();
expect(mocks.sharedSpace.getPetFacesForAsset).not.toHaveBeenCalled();
expect(mocks.sharedSpace.removePersonFaceAssignmentsForSpaceFace).not.toHaveBeenCalled();
expect(mocks.sharedSpace.createPerson).not.toHaveBeenCalled();
expect(mocks.sharedSpace.addPersonFaces).not.toHaveBeenCalled();
expect(mocks.job.queue).not.toHaveBeenCalled();
```

- [ ] **Step 3: Run the focused from-backfill safety tests**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter immich exec vitest --config test/vitest.config.mjs run src/services/shared-space.service.spec.ts -t "from-backfill asset is no longer|handleSharedSpaceFaceMatchFromBackfill"
```

Expected: PASS. If the asset-removed test fails because the handler mutates after `isAssetInSpace=false`, ensure `processSpaceFaceMatch()` starts with:

```ts
const isAssetInSpace = await this.sharedSpaceRepository.isAssetInSpace(spaceId, assetId);
if (!isAssetInSpace) {
  return [];
}
```

- [ ] **Step 4: Commit Task 2**

```bash
git add server/src/services/shared-space.service.spec.ts server/src/services/shared-space.service.ts
git commit -m "test: cover from-backfill projection skips"
```

If `server/src/services/shared-space.service.ts` was not changed, omit it from `git add`.

## Task 3: Identity-Backed Pet Projection Guards

**Files:**

- Modify: `server/src/services/shared-space.service.spec.ts`
- Modify only if red: `server/src/services/shared-space.service.ts`

- [ ] **Step 1: Add identity-backed pet incompatible-human guard**

In `server/src/services/shared-space.service.spec.ts`, inside `describe('handleSharedSpaceFaceMatch')`, add this test near the existing pet tests:

```ts
it('does not attach an identity-backed pet face to an existing human space person for the same identity', async () => {
  const spaceId = newUuid();
  const assetId = newUuid();
  const petFaceId = newUuid();
  const petPersonId = newUuid();
  const identityId = newUuid();
  const humanSpacePersonId = newUuid();
  const space = factory.sharedSpace({ id: spaceId, faceRecognitionEnabled: true });

  mocks.sharedSpace.getById.mockResolvedValue(space);
  mocks.sharedSpace.getAssetFacesForMatching.mockResolvedValue([]);
  mocks.sharedSpace.getPetFacesForAsset.mockResolvedValue([
    { id: petFaceId, assetId, personId: petPersonId, identityId, type: 'pet' },
  ]);
  mocks.sharedSpace.getPersonFaceAssignmentsForSpace.mockResolvedValue([]);
  mocks.sharedSpace.getSpacePersonByIdentity.mockResolvedValue(
    factory.sharedSpacePerson({ id: humanSpacePersonId, spaceId, identityId, type: 'person' }),
  );

  const result = await sut.handleSharedSpaceFaceMatch({ spaceId, assetId });

  expect(result).toBe(JobStatus.Success);
  expect(mocks.sharedSpace.addPersonFaces).not.toHaveBeenCalled();
  expect(mocks.sharedSpace.createPerson).not.toHaveBeenCalled();
  expect(mocks.sharedSpace.recountPersons).not.toHaveBeenCalled();
  expect(mocks.sharedSpace.deleteOrphanedPersonsByIds).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Add identity-backed pet stale-human assignment cleanup coverage**

Add this test after the previous one:

```ts
it('removes a stale human selected-space assignment for an identity-backed pet face without cross-type reassignment', async () => {
  const spaceId = newUuid();
  const assetId = newUuid();
  const petFaceId = newUuid();
  const petPersonId = newUuid();
  const identityId = newUuid();
  const humanSpacePersonId = newUuid();
  const space = factory.sharedSpace({ id: spaceId, faceRecognitionEnabled: true });

  mocks.sharedSpace.getById.mockResolvedValue(space);
  mocks.sharedSpace.getAssetFacesForMatching.mockResolvedValue([]);
  mocks.sharedSpace.getPetFacesForAsset.mockResolvedValue([
    { id: petFaceId, assetId, personId: petPersonId, identityId, type: 'pet' },
  ]);
  mocks.sharedSpace.getPersonFaceAssignmentsForSpace.mockResolvedValue([
    { personId: humanSpacePersonId, identityId, type: 'person' },
  ]);
  mocks.sharedSpace.getSpacePersonByIdentity.mockResolvedValue(
    factory.sharedSpacePerson({ id: humanSpacePersonId, spaceId, identityId, type: 'person' }),
  );
  mocks.sharedSpace.removePersonFaceAssignmentsForSpaceFace.mockResolvedValue([humanSpacePersonId]);

  const result = await sut.handleSharedSpaceFaceMatch({ spaceId, assetId });

  expect(result).toBe(JobStatus.Success);
  expect(mocks.sharedSpace.removePersonFaceAssignmentsForSpaceFace).toHaveBeenCalledWith(spaceId, petFaceId);
  expect(mocks.sharedSpace.addPersonFaces).not.toHaveBeenCalled();
  expect(mocks.sharedSpace.createPerson).not.toHaveBeenCalled();
  expect(mocks.sharedSpace.recountPersons).toHaveBeenCalledWith([humanSpacePersonId]);
  expect(mocks.sharedSpace.deleteOrphanedPersonsByIds).toHaveBeenCalledWith(spaceId, [humanSpacePersonId]);
});
```

- [ ] **Step 3: Run the focused pet projection tests**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter immich exec vitest --config test/vitest.config.mjs run src/services/shared-space.service.spec.ts -t "identity-backed pet"
```

Expected: PASS. If these fail because a pet face attaches to a human person, keep the fix in `findOrCreateCompatibleSpacePersonForIdentity()`:

```ts
if (existingByIdentity) {
  if (existingByIdentity.type && existingByIdentity.type !== input.type) {
    return undefined;
  }
  return existingByIdentity;
}
```

and verify both regular-face and pet-face branches remove stale selected-space rows before skipping incompatible assignment.

- [ ] **Step 4: Commit Task 3**

```bash
git add server/src/services/shared-space.service.spec.ts server/src/services/shared-space.service.ts
git commit -m "test: cover identity-backed pet projection guards"
```

If `server/src/services/shared-space.service.ts` was not changed, omit it from `git add`.

## Task 4: Library Sync No-Work Follow-Up Contract

**Files:**

- Modify: `server/src/services/shared-space.service.spec.ts`
- Modify only if red: `server/src/services/shared-space.service.ts`

- [ ] **Step 1: Strengthen no-assets library sync behavior**

In `server/src/services/shared-space.service.spec.ts`, inside `describe('handleSharedSpaceLibraryFaceSync')`, update the test named `should succeed with no work when library has no assets with faces` to include:

```ts
expect(mocks.job.queue).toHaveBeenCalledTimes(1);
expect(mocks.job.queue).toHaveBeenCalledWith({
  name: JobName.SharedSpacePersonDedup,
  data: { spaceId },
});
expect(mocks.job.queue).not.toHaveBeenCalledWith(
  expect.objectContaining({ name: JobName.SharedSpaceIdentityReconciliation }),
);
```

- [ ] **Step 2: Add assets-with-no-affected-people behavior**

Add this test after `should process library assets with faces in batches`:

```ts
it('does not queue identity reconciliation when library sync finds assets but changes no space people', async () => {
  const spaceId = newUuid();
  const libraryId = newUuid();
  const assetId = newUuid();

  mocks.sharedSpace.getById.mockResolvedValue(factory.sharedSpace({ id: spaceId, faceRecognitionEnabled: true }));
  mocks.sharedSpace.hasLibraryLink.mockResolvedValue(true);
  mocks.asset.getByLibraryIdWithFaces.mockResolvedValueOnce([{ id: assetId }]).mockResolvedValueOnce([]);
  mocks.sharedSpace.isAssetInSpace.mockResolvedValue(true);
  mocks.sharedSpace.getAssetFacesForMatching.mockResolvedValue([]);
  mocks.sharedSpace.getPetFacesForAsset.mockResolvedValue([]);

  const result = await sut.handleSharedSpaceLibraryFaceSync({ spaceId, libraryId });

  expect(result).toBe(JobStatus.Success);
  expect(mocks.sharedSpace.getAssetFacesForMatching).toHaveBeenCalledWith(assetId);
  expect(mocks.job.queue).toHaveBeenCalledTimes(1);
  expect(mocks.job.queue).toHaveBeenCalledWith({
    name: JobName.SharedSpacePersonDedup,
    data: { spaceId },
  });
  expect(mocks.job.queue).not.toHaveBeenCalledWith(
    expect.objectContaining({ name: JobName.SharedSpaceIdentityReconciliation }),
  );
});
```

- [ ] **Step 3: Run focused library-sync follow-up tests**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter immich exec vitest --config test/vitest.config.mjs run src/services/shared-space.service.spec.ts -t "library sync finds assets but changes no space people|no work when library has no assets"
```

Expected: PASS. If red because identity reconciliation is queued for no affected people, keep `handleSharedSpaceLibraryFaceSync()` gated by `affectedAny`:

```ts
if (affectedAny) {
  await this.queueSpaceIdentityReconciliation({ spaceId: job.spaceId });
}
```

- [ ] **Step 4: Commit Task 4**

```bash
git add server/src/services/shared-space.service.spec.ts server/src/services/shared-space.service.ts
git commit -m "test: cover library sync no-work follow-ups"
```

If `server/src/services/shared-space.service.ts` was not changed, omit it from `git add`.

## Task 5: Full-Space Rematch Repairs Missing, Stale, And Wrong Identity Rows

**Files:**

- Modify: `server/test/medium/specs/services/shared-space-face-identity-repair.spec.ts`
- Modify only if red: `server/src/services/shared-space.service.ts`
- Modify only if red: `server/src/repositories/shared-space.repository.ts`

- [ ] **Step 1: Add a DB helper for selected-space face assignments**

In `server/test/medium/specs/services/shared-space-face-identity-repair.spec.ts`, after `drainSharedSpaceFaceJobs()`, add:

```ts
const getSelectedSpaceFaceRows = async (ctx: ReturnType<typeof setup>['ctx'], spaceId: string) =>
  ctx.database
    .selectFrom('shared_space_person_face as face')
    .innerJoin('shared_space_person as person', 'person.id', 'face.personId')
    .select([
      'face.assetFaceId as assetFaceId',
      'face.personId as personId',
      'person.identityId as identityId',
      'person.type as type',
    ])
    .where('person.spaceId', '=', spaceId)
    .orderBy('face.assetFaceId')
    .execute();
```

- [ ] **Step 2: Add the destructive full-space repair test**

In the same file, add this test before `full-space rematch repairs stale selected-space face assignments from linked libraries`:

```ts
it('full-space rematch repairs missing stale and wrong-identity selected-space assignments without inflating counts', async () => {
  const { ctx, sut, faceIdentityRepository, sharedSpaceRepository, jobs } = setup();
  const { user } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
  const { library } = await ctx.newLibrary({ ownerId: user.id });
  await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: user.id });

  const target = await createIdentityFace(ctx, faceIdentityRepository, {
    ownerId: user.id,
    libraryId: library.id,
    name: 'Alice',
  });
  const missing = await createIdentityFace(ctx, faceIdentityRepository, {
    ownerId: user.id,
    libraryId: library.id,
    personId: target.person.id,
    identityId: target.identity.id,
  });
  const wrong = await createIdentityFace(ctx, faceIdentityRepository, {
    ownerId: user.id,
    libraryId: library.id,
    personId: target.person.id,
    identityId: target.identity.id,
  });
  const stale = await createIdentityFace(ctx, faceIdentityRepository, {
    ownerId: user.id,
    libraryId: library.id,
    personId: target.person.id,
    identityId: target.identity.id,
  });

  const correctPerson = await sharedSpaceRepository.createPerson({
    spaceId: space.id,
    identityId: target.identity.id,
    name: '',
    representativeFaceId: target.assetFace.id,
    type: 'person',
  });
  await sharedSpaceRepository.addPersonFaces([{ personId: correctPerson.id, assetFaceId: target.assetFace.id }], {
    skipRecount: true,
  });

  const { result: wrongOwnerPerson } = await ctx.newPerson({ ownerId: user.id, name: 'Wrong Alice' });
  const wrongIdentity = await faceIdentityRepository.ensurePersonIdentity(wrongOwnerPerson.id);
  const wrongSpacePerson = await sharedSpaceRepository.createPerson({
    spaceId: space.id,
    identityId: wrongIdentity.id,
    name: '',
    representativeFaceId: wrong.assetFace.id,
    type: 'person',
  });
  await sharedSpaceRepository.addPersonFaces([{ personId: wrongSpacePerson.id, assetFaceId: wrong.assetFace.id }], {
    skipRecount: true,
  });

  const staleSpacePerson = await sharedSpaceRepository.createPerson({
    spaceId: space.id,
    name: '',
    representativeFaceId: stale.assetFace.id,
    type: 'person',
  });
  await sharedSpaceRepository.addPersonFaces([{ personId: staleSpacePerson.id, assetFaceId: stale.assetFace.id }], {
    skipRecount: true,
  });

  await expect(sut.handleSharedSpaceFaceMatchAll({ spaceId: space.id })).resolves.toBe(JobStatus.Success);
  await drainSharedSpaceFaceJobs(sut, jobs);

  const repairedPerson = await ctx.database
    .selectFrom('shared_space_person')
    .selectAll()
    .where('spaceId', '=', space.id)
    .where('identityId', '=', target.identity.id)
    .executeTakeFirstOrThrow();
  expect(repairedPerson.id).toBe(correctPerson.id);

  const repairedRows = await getSelectedSpaceFaceRows(ctx, space.id);
  expect(repairedRows).toHaveLength(4);
  expect(repairedRows).toEqual(
    expect.arrayContaining([
      {
        assetFaceId: missing.assetFace.id,
        personId: repairedPerson.id,
        identityId: target.identity.id,
        type: 'person',
      },
      {
        assetFaceId: stale.assetFace.id,
        personId: repairedPerson.id,
        identityId: target.identity.id,
        type: 'person',
      },
      {
        assetFaceId: target.assetFace.id,
        personId: repairedPerson.id,
        identityId: target.identity.id,
        type: 'person',
      },
      {
        assetFaceId: wrong.assetFace.id,
        personId: repairedPerson.id,
        identityId: target.identity.id,
        type: 'person',
      },
    ]),
  );
  await expect(sharedSpaceRepository.getPersonById(wrongSpacePerson.id)).resolves.toBeUndefined();
  await expect(sharedSpaceRepository.getPersonById(staleSpacePerson.id)).resolves.toBeUndefined();
  await expect(
    sharedSpaceRepository.getPeopleFaceStatisticsBySpaceId(space.id, { minimumFaceCount: 1 }),
  ).resolves.toMatchObject({
    detectedFaceCount: 4,
    assignedVisibleFaceCount: 4,
    assignedHiddenFaceCount: 0,
    unassignedFaceCount: 0,
  });
});
```

- [ ] **Step 3: Run the focused destructive full-rematch test**

Run:

```bash
pnpm --filter immich test:medium -- --run test/medium/specs/services/shared-space-face-identity-repair.spec.ts -t "missing stale and wrong-identity"
```

Expected: PASS. If red because stale/wrong rows survive, keep the production fix scoped to the identity-backed branch in `processSpaceFaceMatch()`:

```ts
if (selectedSpaceAssignments.length > 0) {
  const removedPersonIds = await this.sharedSpaceRepository.removePersonFaceAssignmentsForSpaceFace(spaceId, face.id);
  for (const personId of removedPersonIds) {
    recountPersonIds.add(personId);
    stalePersonIds.add(personId);
  }
}
```

and ensure `deleteOrphanedPersonsByIds(spaceId, [...stalePersonIds])` runs after recounting.

- [ ] **Step 4: Commit Task 5**

```bash
git add server/test/medium/specs/services/shared-space-face-identity-repair.spec.ts server/src/services/shared-space.service.ts server/src/repositories/shared-space.repository.ts
git commit -m "test: cover full-space projection repair"
```

If production files were not changed, omit them from `git add`.

## Task 6: Direct Asset Removal Cleans Projection Rows

**Files:**

- Modify: `server/test/medium/specs/services/shared-space-face-identity-repair.spec.ts`
- Modify only if red: `server/src/services/shared-space.service.ts`
- Modify only if red: `server/src/repositories/shared-space.repository.ts`

- [ ] **Step 1: Add direct removal destructive cleanup coverage**

In `server/test/medium/specs/services/shared-space-face-identity-repair.spec.ts`, add this test after Task 5's test:

```ts
it('removing direct assets removes selected-space face rows and deletes orphaned space people', async () => {
  const { ctx, sut, faceIdentityRepository, sharedSpaceRepository } = setup();
  const { user } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
  const { library } = await ctx.newLibrary({ ownerId: user.id });
  const face = await createIdentityFace(ctx, faceIdentityRepository, {
    ownerId: user.id,
    libraryId: library.id,
    name: 'Alice',
  });
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: face.asset.id, addedById: user.id });

  await expect(sut.handleSharedSpaceFaceMatch({ spaceId: space.id, assetId: face.asset.id })).resolves.toBe(
    JobStatus.Success,
  );
  const projectedPerson = await ctx.database
    .selectFrom('shared_space_person')
    .selectAll()
    .where('spaceId', '=', space.id)
    .where('identityId', '=', face.identity.id)
    .executeTakeFirstOrThrow();
  await expect(getSelectedSpaceFaceRows(ctx, space.id)).resolves.toHaveLength(1);

  await sut.removeAssets(factory.auth({ user: { id: user.id } }), space.id, { assetIds: [face.asset.id] });

  await expect(getSelectedSpaceFaceRows(ctx, space.id)).resolves.toEqual([]);
  await expect(sharedSpaceRepository.getPersonById(projectedPerson.id)).resolves.toBeUndefined();
  await expect(
    sharedSpaceRepository.getPeopleFaceStatisticsBySpaceId(space.id, { minimumFaceCount: 1 }),
  ).resolves.toMatchObject({
    detectedFaceCount: 0,
    assignedVisibleFaceCount: 0,
    assignedHiddenFaceCount: 0,
    unassignedFaceCount: 0,
  });
});
```

- [ ] **Step 2: Run the focused direct removal test**

Run:

```bash
pnpm --filter immich test:medium -- --run test/medium/specs/services/shared-space-face-identity-repair.spec.ts -t "removing direct assets removes selected-space"
```

Expected: PASS. If red because selected-space rows remain after asset removal, keep the production fix in `SharedSpaceService.removeAssets()` after `removeAssets()`:

```ts
await this.sharedSpaceRepository.removePersonFacesByAssetIds(spaceId, dto.assetIds);
await this.sharedSpaceRepository.deleteOrphanedPersons(spaceId);
await this.queueSpacePersonMetadataBackfill();
```

- [ ] **Step 3: Commit Task 6**

```bash
git add server/test/medium/specs/services/shared-space-face-identity-repair.spec.ts server/src/services/shared-space.service.ts server/src/repositories/shared-space.repository.ts
git commit -m "test: cover direct asset projection cleanup"
```

If production files were not changed, omit them from `git add`.

## Task 7: Linked Library Unlink Cleans Projection Rows

**Files:**

- Modify: `server/test/medium/specs/services/shared-space-face-identity-repair.spec.ts`
- Modify only if red: `server/src/services/shared-space.service.ts`
- Modify only if red: `server/src/repositories/shared-space.repository.ts`

- [ ] **Step 1: Add linked-library unlink destructive cleanup coverage**

In `server/test/medium/specs/services/shared-space-face-identity-repair.spec.ts`, add this test after Task 6's test:

```ts
it('unlinking a library removes selected-space face rows and deletes orphaned space people', async () => {
  const { ctx, sut, faceIdentityRepository, sharedSpaceRepository } = setup();
  const { user } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
  const { library } = await ctx.newLibrary({ ownerId: user.id });
  await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: user.id });
  const face = await createIdentityFace(ctx, faceIdentityRepository, {
    ownerId: user.id,
    libraryId: library.id,
    name: 'Alice',
  });

  await expect(sut.handleSharedSpaceLibraryFaceSync({ spaceId: space.id, libraryId: library.id })).resolves.toBe(
    JobStatus.Success,
  );
  const projectedPerson = await ctx.database
    .selectFrom('shared_space_person')
    .selectAll()
    .where('spaceId', '=', space.id)
    .where('identityId', '=', face.identity.id)
    .executeTakeFirstOrThrow();
  await expect(getSelectedSpaceFaceRows(ctx, space.id)).resolves.toHaveLength(1);

  await sut.unlinkLibrary(factory.auth({ user: { id: user.id, isAdmin: true } }), space.id, library.id);

  await expect(getSelectedSpaceFaceRows(ctx, space.id)).resolves.toEqual([]);
  await expect(sharedSpaceRepository.getPersonById(projectedPerson.id)).resolves.toBeUndefined();
  await expect(
    sharedSpaceRepository.getPeopleFaceStatisticsBySpaceId(space.id, { minimumFaceCount: 1 }),
  ).resolves.toMatchObject({
    detectedFaceCount: 0,
    assignedVisibleFaceCount: 0,
    assignedHiddenFaceCount: 0,
    unassignedFaceCount: 0,
  });
});
```

- [ ] **Step 2: Run the focused unlink cleanup test**

Run:

```bash
pnpm --filter immich test:medium -- --run test/medium/specs/services/shared-space-face-identity-repair.spec.ts -t "unlinking a library removes selected-space"
```

Expected: PASS. If red because selected-space rows remain after unlink, keep the production fix in `SharedSpaceService.unlinkLibrary()` after `removeLibrary()`:

```ts
await this.sharedSpaceRepository.removePersonFacesByLibrary(spaceId, libraryId);
await this.sharedSpaceRepository.deleteOrphanedPersons(spaceId);
await this.queueSpacePersonMetadataBackfill();
```

- [ ] **Step 3: Commit Task 7**

```bash
git add server/test/medium/specs/services/shared-space-face-identity-repair.spec.ts server/src/services/shared-space.service.ts server/src/repositories/shared-space.repository.ts
git commit -m "test: cover linked-library projection cleanup"
```

If production files were not changed, omit them from `git add`.

## Task 8: Direct Plus Linked Path Dedupes One Assignment

**Files:**

- Modify: `server/test/medium/specs/services/shared-space-face-identity-repair.spec.ts`
- Modify only if red: `server/src/services/shared-space.service.ts`
- Modify only if red: `server/src/repositories/shared-space.repository.ts`

- [ ] **Step 1: Add direct-plus-linked duplicate protection coverage**

In `server/test/medium/specs/services/shared-space-face-identity-repair.spec.ts`, add this test after Task 7's test:

```ts
it('same asset direct plus linked-library path materializes only one selected-space face assignment', async () => {
  const { ctx, sut, faceIdentityRepository, sharedSpaceRepository } = setup();
  const { user } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
  const { library } = await ctx.newLibrary({ ownerId: user.id });
  await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: user.id });
  const face = await createIdentityFace(ctx, faceIdentityRepository, {
    ownerId: user.id,
    libraryId: library.id,
    name: 'Alice',
  });
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: face.asset.id, addedById: user.id });

  await expect(sut.handleSharedSpaceFaceMatch({ spaceId: space.id, assetId: face.asset.id })).resolves.toBe(
    JobStatus.Success,
  );
  await expect(sut.handleSharedSpaceLibraryFaceSync({ spaceId: space.id, libraryId: library.id })).resolves.toBe(
    JobStatus.Success,
  );

  const people = await ctx.database
    .selectFrom('shared_space_person')
    .selectAll()
    .where('spaceId', '=', space.id)
    .where('identityId', '=', face.identity.id)
    .execute();
  expect(people).toHaveLength(1);
  await expect(getSelectedSpaceFaceRows(ctx, space.id)).resolves.toEqual([
    {
      assetFaceId: face.assetFace.id,
      personId: people[0].id,
      identityId: face.identity.id,
      type: 'person',
    },
  ]);
  await expect(
    sharedSpaceRepository.getPeopleFaceStatisticsBySpaceId(space.id, { minimumFaceCount: 1 }),
  ).resolves.toMatchObject({
    detectedFaceCount: 1,
    assignedVisibleFaceCount: 1,
    assignedHiddenFaceCount: 0,
    unassignedFaceCount: 0,
  });
});
```

- [ ] **Step 2: Run the focused direct-plus-linked dedupe test**

Run:

```bash
pnpm --filter immich test:medium -- --run test/medium/specs/services/shared-space-face-identity-repair.spec.ts -t "direct plus linked-library"
```

Expected: PASS. If red because duplicate `shared_space_person_face` rows appear, keep the production fix in repository insert semantics:

```ts
.onConflict((oc) => oc.columns(['personId', 'assetFaceId']).doNothing())
```

and ensure identity-backed exact selected-space assignments skip re-adding faces.

- [ ] **Step 3: Commit Task 8**

```bash
git add server/test/medium/specs/services/shared-space-face-identity-repair.spec.ts server/src/services/shared-space.service.ts server/src/repositories/shared-space.repository.ts
git commit -m "test: cover direct and linked projection dedupe"
```

If production files were not changed, omit them from `git add`.

## Task 9: Full Slice 5 Verification

**Files:**

- Verify: `server/src/repositories/job.repository.spec.ts`
- Verify: `server/src/services/shared-space.service.spec.ts`
- Verify: `server/test/medium/specs/services/shared-space-face-identity-repair.spec.ts`
- Verify: `server/test/medium/specs/repositories/shared-space-face-matching.spec.ts`
- Verify changed production files if any

- [ ] **Step 1: Run the full job repository spec**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter immich exec vitest --config test/vitest.config.mjs run src/repositories/job.repository.spec.ts
```

Expected: PASS.

- [ ] **Step 2: Run the full shared-space service small spec**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter immich exec vitest --config test/vitest.config.mjs run src/services/shared-space.service.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Run the full linked-library face identity repair medium spec**

Run:

```bash
pnpm --filter immich test:medium -- --run test/medium/specs/services/shared-space-face-identity-repair.spec.ts
```

Expected: PASS.

- [ ] **Step 4: Run the full shared-space face matching repository medium spec**

Run:

```bash
pnpm --filter immich test:medium -- --run test/medium/specs/repositories/shared-space-face-matching.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Run formatting and type checks**

Run:

```bash
pnpm --dir server exec prettier --check src/repositories/job.repository.spec.ts src/services/shared-space.service.spec.ts test/medium/specs/services/shared-space-face-identity-repair.spec.ts test/medium/specs/repositories/shared-space-face-matching.spec.ts
pnpm --dir docs exec prettier --check superpowers/plans/2026-05-18-shared-space-projection-pipeline-safety.md
pnpm --dir server check
git diff --check
```

Expected: all commands pass.

- [ ] **Step 6: Inspect the final diff**

Run:

```bash
git diff @{upstream}...HEAD -- server/src/repositories/job.repository.ts server/src/repositories/job.repository.spec.ts server/src/services/shared-space.service.ts server/src/services/shared-space.service.spec.ts server/src/repositories/shared-space.repository.ts server/test/medium/specs/services/shared-space-face-identity-repair.spec.ts server/test/medium/specs/repositories/shared-space-face-matching.spec.ts docs/superpowers/plans/2026-05-18-shared-space-projection-pipeline-safety.md
```

Expected: diff contains only Slice 5 shared-space projection tests, this plan, and any minimal production fixes directly proven by the new tests.

- [ ] **Step 7: Commit final formatting if needed**

If formatting commands changed files after earlier task commits, commit them:

```bash
git add server/src/repositories/job.repository.spec.ts server/src/services/shared-space.service.spec.ts server/test/medium/specs/services/shared-space-face-identity-repair.spec.ts server/test/medium/specs/repositories/shared-space-face-matching.spec.ts docs/superpowers/plans/2026-05-18-shared-space-projection-pipeline-safety.md
git commit -m "chore: format shared-space projection tests"
```

If formatting produced no changes, do not create an empty commit.

## Spec Coverage Checklist

- [ ] Missing or disabled space skips without mutation: existing small tests preserved; Task 2 strengthens from-backfill no-mutation assertions.
- [ ] Asset removed from space before job execution skips mutation but remains safe: existing target-match test preserved; Task 2 adds from-backfill coverage.
- [ ] Identity-backed face attaches to existing compatible space person: existing small tests preserved.
- [ ] Identity-backed face creates new compatible space person when none exists: existing small tests preserved.
- [ ] Identity-backed face does not merge into nearby different identity just because embeddings are close: existing small tests preserved.
- [ ] Stale selected-space assignment is removed and replaced by the identity-correct person: existing small tests preserved; Task 5 adds DB-backed combined missing/stale/wrong coverage.
- [ ] Exact assignment from backfill refreshes inherited metadata: existing small tests preserved.
- [ ] Legacy face with person but no identity uses legacy embedding path: existing small tests preserved.
- [ ] Face with no person waits and does not create a space person: existing small tests preserved.
- [ ] Pet face creates or reuses pet space person and never attaches to a human person: existing small tests preserved; Task 3 adds identity-backed incompatible-human coverage.
- [ ] Type-incompatible identity-backed space person causes skip or compatible repair, not cross-type assignment: existing small and medium tests preserved; Task 3 strengthens pet-side coverage.
- [ ] Affected people queue `SharedSpaceIdentityReconciliation`: existing small tests preserved.
- [ ] Successful asset match queues `SharedSpacePersonDedup`: existing small tests preserved.
- [ ] From-backfill jobs run on `QueueName.PeopleBackfill`: existing small metadata test preserved.
- [ ] Other shared-space face pipeline jobs remain on `QueueName.FacialRecognition`: existing small metadata test preserved.
- [ ] Full-space dispatcher queues only first page: existing small tests preserved.
- [ ] Pages use keyset lookahead, process exactly the page, and queue final dedup/reconciliation once: existing small tests preserved.
- [ ] Disabled space between pages stops the page chain without final follow-ups: existing small tests preserved.
- [ ] Library face sync rechecks link existence between batches and stops after unlink: existing small tests preserved.
- [ ] Library face sync creates one identity-backed space person across multiple linked libraries: existing medium test preserved.
- [ ] Full-space rematch repairs missing, stale, and wrong-identity selected-space assignments without inflating counts: Task 5.
- [ ] Repository-level selected-space assignment idempotency, asset-face cascade cleanup, orphan cleanup, and multiple-space/linked-library isolation remain covered: existing `shared-space-face-matching.spec.ts`, verified in Task 9.
- [ ] Linked-library relink rebuilds identity-backed selected-space assignments: existing medium test preserved.
- [ ] Removing assets or unlinking libraries removes selected-space face rows and deletes orphaned space people: Tasks 6 and 7.
- [ ] Same asset direct plus linked-library path materializes only one selected-space face assignment: Task 8.
- [ ] From-backfill jobs use stable visible-failure job ids and paused replacement like the rest of the shared-space face pipeline: Task 1.

## Explicit Out Of Scope

- Per-face recognition assignment and shared-space fanout belongs to Slice 4.
- Identity backfill root pagination and metadata inheritance queue fanout belongs to Slice 6.
- Manual person merge/delete/reassign operations belong to Slice 7.
- Overnight end-to-end chain composition and issue #597 reproduction belongs to Slice 8.
- Reworking identity reconciliation scoring, dedup thresholds, or metadata priority rules is not part of Slice 5.

## Self-Review Notes

- Spec coverage: every Slice 5 bullet maps to existing preserved coverage or to Tasks 1-8 above.
- Placeholder scan: this plan contains exact file paths, concrete test snippets, focused commands, expected results, and commit commands.
- Type consistency: snippets use existing project names and imports already present in target files: `JobName`, `JobStatus`, `QueueName`, `SharedSpaceRole`, `factory`, `newUuid`, `createIdentityFace`, `drainSharedSpaceFaceJobs`, `faceIdentityRepository`, `sharedSpaceRepository`, `jobs`, and `ctx.database`.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-18-shared-space-projection-pipeline-safety.md`. Two execution options:

**1. Subagent-Driven (recommended)** - dispatch fresh workers by task group, review after each worker, and keep implementation commits small.

**2. Inline Execution** - execute tasks in this session using `superpowers:executing-plans`, with checkpoints after each task group.
