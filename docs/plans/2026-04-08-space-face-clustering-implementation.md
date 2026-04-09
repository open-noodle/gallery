# Space face clustering implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the shared-space face clustering bug from issue #272 by making space face matching mirror the native People view's density-validated clustering, and correct the contributing count/filter/cleanup bugs.

**Architecture:** Six independent commits in one PR. The main change is a gate in `processSpaceFaceMatch` that refuses to attach a face to a space-person unless the face already has a global `personId` (which only gets set after native recognition's density check). Supporting commits align count/filter queries with the native People view, add a Force-recognition space-person wipe with EXIF-aware re-population, add library-unlink cleanup, and hide empty unnamed space-persons from the UI list.

**Tech Stack:** TypeScript, NestJS, Kysely, vitest (unit + medium tests with real Postgres via testcontainers).

**Design doc:** `docs/plans/2026-04-08-space-face-clustering-design.md` — read it before starting. Every section number referenced below corresponds to a section in that doc.

**Worktree:** Work is already happening in `.worktrees/investigate-272/` on branch `investigate/space-people-count-272`.

---

## Pre-flight

**Step 0.1: Confirm baseline**

Run:

```bash
cd /home/pierre/dev/gallery/.worktrees/investigate-272/server && pnpm check
```

Expected: clean type-check. If it fails, stop and fix the baseline before touching anything.

**Step 0.2: Read the design doc**

Read `docs/plans/2026-04-08-space-face-clustering-design.md` end to end. Each commit below references sections by number.

**Step 0.3: Ordering**

Commits are independent — any ordering works — but the listed order minimises merge conflicts between commits. Do them in order.

**Gotchas you must know before writing any code:**

- Do **not** run `make sql` without a DB running (`feedback_make_sql_no_db` memory). If the SQL query file diff is needed and you don't have a DB, apply the CI diff manually.
- Do **not** run lint locally (`feedback_lint_sequential`). Only `pnpm check` (type check). CI handles lint.
- Do **not** run multiple test suites in parallel (`feedback_no_parallel_tests`).
- Mock type safety: use `void 0 as any` and `Promise.resolve` to satisfy CI's strict tsc + ESLint (`feedback_mock_type_safety`).
- `AssetRepository` has a manual mock file at `server/test/repositories/asset.repository.mock.ts`. New asset-repo methods used in service tests need entries there (`feedback_asset_repo_manual_mock`).
- Migration file names must follow sql-tools conventions (`feedback_ci_sql_tools_conventions`). Not applicable this PR — no new migrations.

---

## Commit 1: Strict clustering gate + isVisible filter

**Summary:** Gate `processSpaceFaceMatch` on `face.personId != null`, reorder to Layer 1 (personId) → Layer 2 (embedding) → Layer 3 (create new), and add `asset_face.isVisible = true` to `getAssetFacesForMatching`. Corresponds to design sections 1 and 7.

### Task 1.1: Failing test — ML face without personId is skipped

**Files:**

- Modify: `server/src/services/shared-space.service.spec.ts` — add a new `describe('processSpaceFaceMatch gate', ...)` block inside `describe('handleSharedSpaceFaceMatch', ...)`.

**Step 1: Write the failing test**

Add this test inside the existing `describe('handleSharedSpaceFaceMatch', ...)` block, after the existing "should skip faces that are already assigned" test:

```ts
it('should skip ML face without a personId (strict gate)', async () => {
  const spaceId = newUuid();
  const assetId = newUuid();
  const faceId = newUuid();
  const space = factory.sharedSpace({ id: spaceId, faceRecognitionEnabled: true });
  const embedding = '[1,2,3]';

  mocks.sharedSpace.getById.mockResolvedValue(space);
  mocks.sharedSpace.getAssetFacesForMatching.mockResolvedValue([{ id: faceId, assetId, personId: null, embedding }]);
  mocks.sharedSpace.isPersonFaceAssigned.mockResolvedValue(false);
  mocks.sharedSpace.getPetFacesForAsset.mockResolvedValue([]);

  const result = await sut.handleSharedSpaceFaceMatch({ spaceId, assetId });

  expect(result).toBe(JobStatus.Success);
  expect(mocks.sharedSpace.findClosestSpacePerson).not.toHaveBeenCalled();
  expect(mocks.sharedSpace.findSpacePersonByLinkedPersonId).not.toHaveBeenCalled();
  expect(mocks.sharedSpace.addPersonFaces).not.toHaveBeenCalled();
  expect(mocks.sharedSpace.createPerson).not.toHaveBeenCalled();
});
```

**Step 2: Run the test and confirm it fails**

```bash
cd server && pnpm test -- --run src/services/shared-space.service.spec.ts -t "should skip ML face without a personId"
```

Expected: FAIL. Current code calls `findClosestSpacePerson` before checking `personId`, so the assertion that it was not called fails.

### Task 1.2: Implement the gate and reordered layers

**Files:**

- Modify: `server/src/services/shared-space.service.ts` — the ML-face loop inside `processSpaceFaceMatch`, lines 1081–1124.

**Step 1: Replace the ML-face loop**

Replace the current body of the ML-face loop (starting at `const faces = await this.sharedSpaceRepository.getAssetFacesForMatching(assetId);` through the end of the `for (const face of faces)` block) with:

```ts
const faces = await this.sharedSpaceRepository.getAssetFacesForMatching(assetId);
for (const face of faces) {
  const isAssigned = await this.sharedSpaceRepository.isPersonFaceAssigned(face.id, spaceId);
  if (isAssigned) {
    continue;
  }

  // Strict gate: only faces native recognition has already assigned to a global
  // person are eligible to join a space-person. This guarantees every face in a
  // space-person belongs to a density-validated native cluster and eliminates the
  // single-face chaining bug reported in #272.
  if (!face.personId) {
    continue;
  }

  let personId: string;

  // Layer 1: same global personId → same space-person. Stable fast path, single
  // indexed lookup, no vector search.
  const existingSpacePerson = await this.sharedSpaceRepository.findSpacePersonByLinkedPersonId(spaceId, face.personId);

  if (existingSpacePerson) {
    personId = existingSpacePerson.id;
  } else {
    // Layer 2: cross-owner bridging via embedding similarity. Alice's "Dad" and
    // Bob's "Dad" are two separate native persons but should merge into one
    // space-person.
    const matches = await this.sharedSpaceRepository.findClosestSpacePerson(spaceId, face.embedding, {
      maxDistance,
      numResults: 1,
    });

    if (matches.length > 0) {
      personId = matches[0].personId;
    } else {
      // Layer 3: nothing close → create new space-person.
      const newPerson = await this.sharedSpaceRepository.createPerson({
        spaceId,
        name: '',
        representativeFaceId: face.id,
        type: 'person',
      });
      personId = newPerson.id;
    }
  }

  await this.sharedSpaceRepository.addPersonFaces([{ personId, assetFaceId: face.id }], { skipRecount: true });
  affectedPersonIds.add(personId);
}
```

**Step 2: Run the failing test and confirm it passes**

```bash
pnpm test -- --run src/services/shared-space.service.spec.ts -t "should skip ML face without a personId"
```

Expected: PASS.

**Step 3: Run the full `handleSharedSpaceFaceMatch` describe block to confirm no regressions**

```bash
pnpm test -- --run src/services/shared-space.service.spec.ts -t "handleSharedSpaceFaceMatch"
```

Expected: the following existing tests will now **fail** because they encode the old layer ordering and assume a face without a personId can still match via embedding:

- "should match face to existing person when distance is within threshold" — currently passes a face with `personId: null` but expects `findClosestSpacePerson` to be called. Under the gate, the face is skipped.
- "should create new person when no match is found" — passes a face with `personId: personalPersonId` but expects `findClosestSpacePerson` to be called first. Under Layer-1-first, `findSpacePersonByLinkedPersonId` is called first and returns undefined, then `findClosestSpacePerson`, then create. The call order is what it needs to verify.
- "should create new person when distance exceeds threshold" — same ordering issue.
- Any others in the block that match either pattern.

This is expected. Fix them in the next task.

### Task 1.3: Update existing tests to match the new gate and ordering

**Files:**

- Modify: `server/src/services/shared-space.service.spec.ts` — each test flagged in task 1.2 step 3.

**Step 1: Fix "should match face to existing person when distance is within threshold"**

The test must now supply a `personId` on the face and expect Layer 2 (embedding) to be the fall-through when Layer 1 returns undefined. Update to:

```ts
it('should match face to existing space-person via Layer 2 when Layer 1 has no match', async () => {
  const spaceId = newUuid();
  const assetId = newUuid();
  const faceId = newUuid();
  const personalPersonId = newUuid();
  const spacePersonId = newUuid();
  const space = factory.sharedSpace({ id: spaceId, faceRecognitionEnabled: true });
  const embedding = '[1,2,3]';

  mocks.sharedSpace.getById.mockResolvedValue(space);
  mocks.sharedSpace.getAssetFacesForMatching.mockResolvedValue([
    { id: faceId, assetId, personId: personalPersonId, embedding },
  ]);
  mocks.sharedSpace.isPersonFaceAssigned.mockResolvedValue(false);
  mocks.sharedSpace.findSpacePersonByLinkedPersonId.mockResolvedValue(void 0 as any);
  mocks.sharedSpace.findClosestSpacePerson.mockResolvedValue([
    { personId: spacePersonId, name: 'Alice', distance: 0.3 },
  ]);
  mocks.sharedSpace.addPersonFaces.mockResolvedValue([]);
  mocks.sharedSpace.getPetFacesForAsset.mockResolvedValue([]);

  const result = await sut.handleSharedSpaceFaceMatch({ spaceId, assetId });

  expect(result).toBe(JobStatus.Success);
  expect(mocks.sharedSpace.findSpacePersonByLinkedPersonId).toHaveBeenCalledWith(spaceId, personalPersonId);
  expect(mocks.sharedSpace.findClosestSpacePerson).toHaveBeenCalled();
  expect(mocks.sharedSpace.addPersonFaces).toHaveBeenCalledWith([{ personId: spacePersonId, assetFaceId: faceId }], {
    skipRecount: true,
  });
});
```

**Step 2: Fix "should create new person when no match is found"**

Update to expect both Layer 1 and Layer 2 to be consulted in order before creating:

```ts
it('should create new space-person when no Layer 1 or Layer 2 match', async () => {
  const spaceId = newUuid();
  const assetId = newUuid();
  const faceId = newUuid();
  const newPersonId = newUuid();
  const personalPersonId = newUuid();
  const space = factory.sharedSpace({ id: spaceId, faceRecognitionEnabled: true });
  const embedding = '[1,2,3]';
  const newPerson = factory.sharedSpacePerson({ id: newPersonId, spaceId });

  mocks.sharedSpace.getById.mockResolvedValue(space);
  mocks.sharedSpace.getAssetFacesForMatching.mockResolvedValue([
    { id: faceId, assetId, personId: personalPersonId, embedding },
  ]);
  mocks.sharedSpace.isPersonFaceAssigned.mockResolvedValue(false);
  mocks.sharedSpace.findSpacePersonByLinkedPersonId.mockResolvedValue(void 0 as any);
  mocks.sharedSpace.findClosestSpacePerson.mockResolvedValue([]);
  mocks.sharedSpace.createPerson.mockResolvedValue(newPerson);
  mocks.sharedSpace.addPersonFaces.mockResolvedValue([]);
  mocks.sharedSpace.getPetFacesForAsset.mockResolvedValue([]);

  const result = await sut.handleSharedSpaceFaceMatch({ spaceId, assetId });

  expect(result).toBe(JobStatus.Success);
  expect(mocks.sharedSpace.createPerson).toHaveBeenCalledWith({
    spaceId,
    name: '',
    representativeFaceId: faceId,
    type: 'person',
  });
  expect(mocks.sharedSpace.addPersonFaces).toHaveBeenCalledWith([{ personId: newPersonId, assetFaceId: faceId }], {
    skipRecount: true,
  });
});
```

**Step 3: Fix "should create new person when distance exceeds threshold"**

Same shape as step 2 — the test is now indistinguishable from "no Layer 2 match", so delete this duplicate test entirely.

**Step 4: Scan the rest of the describe block for other tests that pass `personId: null`**

For each one that was asserting on embedding matching or new-person creation with a null personId, either:

- Update the test to supply a real `personId` (if the behaviour under test is Layer 1/2/3), or
- Reframe the test as "skipped by the gate" if the null personId was the actual condition under test.

**Step 5: Run the full shared-space.service.spec and confirm everything passes**

```bash
pnpm test -- --run src/services/shared-space.service.spec.ts
```

Expected: all tests pass.

### Task 1.4: Add Layer 1 direct-hit test

**Files:**

- Modify: `server/src/services/shared-space.service.spec.ts`

**Step 1: Write the test**

```ts
it('should attach via Layer 1 when a space-person already exists for the personId', async () => {
  const spaceId = newUuid();
  const assetId = newUuid();
  const faceId = newUuid();
  const personalPersonId = newUuid();
  const existingSpacePersonId = newUuid();
  const space = factory.sharedSpace({ id: spaceId, faceRecognitionEnabled: true });
  const embedding = '[1,2,3]';

  mocks.sharedSpace.getById.mockResolvedValue(space);
  mocks.sharedSpace.getAssetFacesForMatching.mockResolvedValue([
    { id: faceId, assetId, personId: personalPersonId, embedding },
  ]);
  mocks.sharedSpace.isPersonFaceAssigned.mockResolvedValue(false);
  mocks.sharedSpace.findSpacePersonByLinkedPersonId.mockResolvedValue(
    factory.sharedSpacePerson({ id: existingSpacePersonId, spaceId }),
  );
  mocks.sharedSpace.addPersonFaces.mockResolvedValue([]);
  mocks.sharedSpace.getPetFacesForAsset.mockResolvedValue([]);

  const result = await sut.handleSharedSpaceFaceMatch({ spaceId, assetId });

  expect(result).toBe(JobStatus.Success);
  // Layer 1 hit → no embedding search, no person creation
  expect(mocks.sharedSpace.findClosestSpacePerson).not.toHaveBeenCalled();
  expect(mocks.sharedSpace.createPerson).not.toHaveBeenCalled();
  expect(mocks.sharedSpace.addPersonFaces).toHaveBeenCalledWith(
    [{ personId: existingSpacePersonId, assetFaceId: faceId }],
    { skipRecount: true },
  );
});
```

**Step 2: Run it and confirm it passes**

```bash
pnpm test -- --run src/services/shared-space.service.spec.ts -t "should attach via Layer 1"
```

Expected: PASS.

### Task 1.5: Add stale-row preservation regression test

**Files:**

- Modify: `server/src/services/shared-space.service.spec.ts`

**Step 1: Write the test**

```ts
it('should not touch pre-existing stale rows (isPersonFaceAssigned short-circuit)', async () => {
  // Pre-bug scenario: a face was added to a space-person by the old loose
  // algorithm with no global personId. After the gate lands, that stale mapping
  // MUST survive so users do not silently lose data.
  const spaceId = newUuid();
  const assetId = newUuid();
  const faceId = newUuid();
  const space = factory.sharedSpace({ id: spaceId, faceRecognitionEnabled: true });
  const embedding = '[1,2,3]';

  mocks.sharedSpace.getById.mockResolvedValue(space);
  mocks.sharedSpace.getAssetFacesForMatching.mockResolvedValue([{ id: faceId, assetId, personId: null, embedding }]);
  // Stale row already exists
  mocks.sharedSpace.isPersonFaceAssigned.mockResolvedValue(true);
  mocks.sharedSpace.getPetFacesForAsset.mockResolvedValue([]);

  const result = await sut.handleSharedSpaceFaceMatch({ spaceId, assetId });

  expect(result).toBe(JobStatus.Success);
  expect(mocks.sharedSpace.addPersonFaces).not.toHaveBeenCalled();
  expect(mocks.sharedSpace.createPerson).not.toHaveBeenCalled();
  // Crucially, no delete path is exercised
});
```

**Step 2: Run and verify**

```bash
pnpm test -- --run src/services/shared-space.service.spec.ts -t "pre-existing stale rows"
```

Expected: PASS.

### Task 1.6: Add `isVisible` filter to `getAssetFacesForMatching`

**Files:**

- Modify: `server/src/repositories/shared-space.repository.ts:834-843`
- Modify: `server/test/medium/specs/repositories/shared-space.repository.spec.ts` — add test

**Step 1: Write the failing medium test**

Add inside the `describe(SharedSpaceRepository.name, ...)` block, in a new `describe('getAssetFacesForMatching', ...)` block:

```ts
describe('getAssetFacesForMatching', () => {
  it('should exclude faces with isVisible = false', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: visibleFace } = await ctx.newAssetFace({ assetId: asset.id, isVisible: true });
    const { assetFace: invisibleFace } = await ctx.newAssetFace({ assetId: asset.id, isVisible: false });

    // getAssetFacesForMatching inner-joins face_search, so both faces need
    // face_search rows or they will be excluded independently of the isVisible
    // filter. Seed them directly.
    await ctx.database
      .insertInto('face_search')
      .values([
        { faceId: visibleFace.id, embedding: '[1,2,3]' },
        { faceId: invisibleFace.id, embedding: '[1,2,3]' },
      ])
      .execute();

    const result = await sut.getAssetFacesForMatching(asset.id);

    expect(result.map((f) => f.id)).toEqual([visibleFace.id]);
  });
});
```

`ctx.newAssetFace` and `ctx.database` both exist on the medium factory — verified in `server/test/medium.factory.ts`. The pattern `await ctx.database.insertInto('face_search')...` is analogous to the existing soft-delete seeds in the file.

**Step 2: Run the test and confirm it fails**

```bash
pnpm test:medium -- --run src/medium/specs/repositories/shared-space.repository.spec.ts -t "isVisible"
```

Expected: FAIL — both faces come back because the repo doesn't filter.

**Step 3: Implement the filter**

Edit `server/src/repositories/shared-space.repository.ts` inside `getAssetFacesForMatching`:

```ts
@GenerateSql({ params: [DummyValue.UUID] })
getAssetFacesForMatching(assetId: string) {
  return this.db
    .selectFrom('asset_face')
    .innerJoin('face_search', 'face_search.faceId', 'asset_face.id')
    .select(['asset_face.id', 'asset_face.assetId', 'asset_face.personId', 'face_search.embedding'])
    .where('asset_face.assetId', '=', assetId)
    .where('asset_face.deletedAt', 'is', null)
    .where('asset_face.isVisible', 'is', true)
    .execute();
}
```

**Step 4: Run the test and confirm it passes**

```bash
pnpm test:medium -- --run src/medium/specs/repositories/shared-space.repository.spec.ts -t "isVisible"
```

Expected: PASS.

**Step 5: Regenerate the SQL query file**

The `@GenerateSql` decorator means `server/src/queries/shared.space.repository.sql` now has a stale entry for `getAssetFacesForMatching`. Options:

- If you have a local DB running: `make sql`
- Otherwise, let CI fail on the schema/query check and apply the diff it emits manually (see `feedback_sql_query_regen`).

Do not skip this step — it will block the PR.

### Task 1.7: Type check and commit

**Step 1: Type check**

```bash
cd server && pnpm check
```

Expected: no errors.

**Step 2: Commit**

```bash
git add server/src/services/shared-space.service.ts \
        server/src/services/shared-space.service.spec.ts \
        server/src/repositories/shared-space.repository.ts \
        server/src/queries/shared.space.repository.sql \
        server/test/medium/specs/repositories/shared-space.repository.spec.ts
git commit -m "fix(spaces): require global personId before clustering face into space-person

Space face matching previously used single-linkage clustering — any face
within maxDistance of one existing face in a space-person got attached,
which caused chain drift and silently absorbed unrelated faces over time
(reported as wildly inflated space-person counts).

New behaviour mirrors the native People view: a face must have a global
personId (assigned by density-validated native recognition) before it
can join a space-person. Layer 1 reuses the space-person already linked
to that personId; Layer 2 falls back to embedding similarity for
cross-owner bridging; Layer 3 creates a new space-person.

Also excludes asset_face.isVisible=false faces from space matching so
hidden-globally stays hidden-everywhere.

Refs #272"
```

---

## Commit 2: Count filters on `recountPersons`

**Summary:** Add `asset.visibility = Timeline`, `asset.deletedAt IS NULL`, `asset_face.deletedAt IS NULL`, `asset_face.isVisible = true` filters to the `faceCount` and `assetCount` subqueries in `recountPersons`. Corresponds to design section 3.

### Task 2.1: Failing medium test

**Files:**

- Modify: `server/test/medium/specs/repositories/shared-space.repository.spec.ts`

**Step 1: Write the failing test**

Add a new `describe('recountPersons with filters', ...)` block inside the top-level `describe(SharedSpaceRepository.name, ...)`. Make sure `AssetVisibility` is imported from `src/enum` at the top of the file — add the import if missing.

```ts
describe('recountPersons with filters', () => {
  it('should exclude trashed, archived, invisible, and deleted-face rows from counts', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    const spacePerson = await sut.createPerson({
      spaceId: space.id,
      name: 'Test',
      representativeFaceId: null,
      type: 'person',
    });

    // Visible, timeline, not trashed — should count
    const { asset: assetA } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
    const { assetFace: faceA } = await ctx.newAssetFace({ assetId: assetA.id, isVisible: true });
    // Trashed asset — should NOT count
    const { asset: assetB } = await ctx.newAsset({ ownerId: user.id, deletedAt: new Date() });
    const { assetFace: faceB } = await ctx.newAssetFace({ assetId: assetB.id, isVisible: true });
    // Archived asset — should NOT count
    const { asset: assetC } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Archive });
    const { assetFace: faceC } = await ctx.newAssetFace({ assetId: assetC.id, isVisible: true });
    // Invisible face — should NOT count
    const { asset: assetD } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
    const { assetFace: faceD } = await ctx.newAssetFace({ assetId: assetD.id, isVisible: false });

    await sut.addPersonFaces(
      [faceA, faceB, faceC, faceD].map((f) => ({ personId: spacePerson.id, assetFaceId: f.id })),
      { skipRecount: true },
    );

    await sut.recountPersons([spacePerson.id]);

    const after = await sut.getPersonById(spacePerson.id);
    expect(after?.assetCount).toBe(1);
    expect(after?.faceCount).toBe(1);
  });
});
```

**Step 2: Run and confirm failure**

```bash
cd server && pnpm test:medium -- --run src/medium/specs/repositories/shared-space.repository.spec.ts -t "recountPersons with filters"
```

Expected: FAIL — counts are 4, not 1.

### Task 2.2: Implement the filters

**Files:**

- Modify: `server/src/repositories/shared-space.repository.ts:686-711`

**Step 1: Replace the `recountPersons` body**

```ts
@GenerateSql({ params: [[DummyValue.UUID]] })
async recountPersons(personIds: string[]) {
  if (personIds.length === 0) {
    return;
  }

  await this.db
    .updateTable('shared_space_person')
    .set((eb) => ({
      faceCount: eb
        .selectFrom('shared_space_person_face')
        .innerJoin('asset_face', 'asset_face.id', 'shared_space_person_face.assetFaceId')
        .innerJoin('asset', 'asset.id', 'asset_face.assetId')
        .where('asset_face.deletedAt', 'is', null)
        .where('asset_face.isVisible', 'is', true)
        .where('asset.deletedAt', 'is', null)
        .where('asset.visibility', '=', sql.lit(AssetVisibility.Timeline))
        .select((eb2) => eb2.fn.countAll().$castTo<number>().as('count'))
        .whereRef('shared_space_person_face.personId', '=', 'shared_space_person.id'),
      assetCount: eb
        .selectFrom('shared_space_person_face')
        .innerJoin('asset_face', 'asset_face.id', 'shared_space_person_face.assetFaceId')
        .innerJoin('asset', 'asset.id', 'asset_face.assetId')
        .where('asset_face.deletedAt', 'is', null)
        .where('asset_face.isVisible', 'is', true)
        .where('asset.deletedAt', 'is', null)
        .where('asset.visibility', '=', sql.lit(AssetVisibility.Timeline))
        .select((eb2) =>
          eb2.fn
            .count(eb2.fn('distinct', ['asset_face.assetId']))
            .$castTo<number>()
            .as('count'),
        )
        .whereRef('shared_space_person_face.personId', '=', 'shared_space_person.id'),
    }))
    .where('id', 'in', personIds)
    .execute();
}
```

You will need to import `AssetVisibility` from `src/enum` at the top of the file if it is not already imported.

**Step 2: Run the test and confirm it passes**

```bash
pnpm test:medium -- --run src/medium/specs/repositories/shared-space.repository.spec.ts -t "recountPersons with filters"
```

Expected: PASS.

**Step 3: Regenerate the SQL query file**

`recountPersons` has `@GenerateSql`. Regenerate as in task 1.6 step 5.

### Task 2.3: Type check and commit

```bash
cd server && pnpm check
git add server/src/repositories/shared-space.repository.ts \
        server/src/queries/shared.space.repository.sql \
        server/test/medium/specs/repositories/shared-space.repository.spec.ts
git commit -m "fix(spaces): exclude trashed, archived, and hidden assets from space person counts

recountPersons matched the native People view's getStatistics query:
asset.visibility = 'timeline', asset.deletedAt IS NULL,
asset_face.deletedAt IS NULL, asset_face.isVisible = true.

Counts now converge with the global People view whenever they are
recomputed. For static libraries, admins need to run Force to trigger
a recount.

Refs #272"
```

---

## Commit 3: `hasAnySpacePerson` / `hasSpacePerson` filter parity

**Summary:** Add `asset_face.deletedAt IS NULL` and `asset_face.isVisible = true` to the inner join in both helpers so asset searches/filters by space-person mirror the native `hasAnyPerson` helper. Corresponds to design section 4.

### Task 3.1: Failing medium test

**Files:**

- Modify: `server/test/medium/specs/repositories/shared-space.repository.spec.ts` — add a new repo-level test on `SharedSpaceRepository.getPersonAssetIds` which uses neither filter, then verify via a higher-level timeline/search query if needed. But the cleanest place to assert the new filter is via a fresh repo-level spec that exercises `hasAnySpacePerson` indirectly through an asset query.

Rather than hunting for a caller, write the test against the asset repository's search path. Check `server/test/medium/specs/repositories/asset.repository.spec.ts` for a `searchAssets` / `getByFilter` pattern that takes `spacePersonIds` — the grep in task 3.0 (below) will tell you the right file.

**Step 0: Locate the call site**

```bash
cd server && grep -rn "hasAnySpacePerson\|spacePersonIds" src/repositories src/utils | head
```

Pick the highest-level entry point that exercises `hasAnySpacePerson` via a filter option. As of the design snapshot, the most natural location is `asset.repository.ts` (`options.spacePersonIds`) in `searchRandom` / the timeline search path.

**Step 1: Write the failing test**

Add to whichever medium spec file owns the repository you picked (likely `server/test/medium/specs/repositories/asset.repository.spec.ts`):

```ts
it('should exclude assets whose only matching face is deleted or invisible when filtering by spacePersonId', async () => {
  const { ctx } = setup();
  const sut = ctx.get(SharedSpaceRepository);
  const assetRepo = ctx.get(AssetRepository);

  const { user } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: user.id });
  const { asset: assetVisible } = await ctx.newAsset({ ownerId: user.id });
  const { asset: assetInvisibleFace } = await ctx.newAsset({ ownerId: user.id });
  const { asset: assetDeletedFace } = await ctx.newAsset({ ownerId: user.id });

  const { assetFace: visibleFace } = await ctx.newAssetFace({ assetId: assetVisible.id, isVisible: true });
  const { assetFace: invisibleFace } = await ctx.newAssetFace({ assetId: assetInvisibleFace.id, isVisible: false });
  const { assetFace: deletedFace } = await ctx.newAssetFace({
    assetId: assetDeletedFace.id,
    isVisible: true,
    deletedAt: new Date(),
  });

  const spacePerson = await sut.createPerson({
    spaceId: space.id,
    name: 'Test',
    representativeFaceId: visibleFace.id,
    type: 'person',
  });
  await sut.addPersonFaces(
    [
      { personId: spacePerson.id, assetFaceId: visibleFace.id },
      { personId: spacePerson.id, assetFaceId: invisibleFace.id },
      { personId: spacePerson.id, assetFaceId: deletedFace.id },
    ],
    { skipRecount: true },
  );

  // Call whichever method on AssetRepository exercises hasAnySpacePerson.
  // As of this design, it is `searchRandom` / timeline query with
  // `spacePersonIds: [spacePerson.id]`. Adjust to the exact signature.
  const result = await assetRepo.getRandom({ userIds: [user.id], spacePersonIds: [spacePerson.id], count: 10 } as any);

  expect(result.map((a: any) => a.id).sort()).toEqual([assetVisible.id]);
});
```

If the chosen entry point's exact signature doesn't match the snippet, adjust accordingly — the behaviour under test is "only `assetVisible` comes back".

**Step 2: Run and confirm failure**

```bash
cd server && pnpm test:medium -- --run <path-to-file> -t "only matching face"
```

Expected: FAIL — all three assets return.

### Task 3.2: Implement the filter parity

**Files:**

- Modify: `server/src/utils/database.ts:190-212` — `hasSpacePerson` and `hasAnySpacePerson`.

**Step 1: Update both functions**

```ts
export function hasSpacePerson<O>(qb: SelectQueryBuilder<DB, 'asset', O>, spacePersonId: string) {
  return qb.where((eb) =>
    eb.exists(
      eb
        .selectFrom('shared_space_person_face')
        .innerJoin('asset_face', 'asset_face.id', 'shared_space_person_face.assetFaceId')
        .whereRef('asset_face.assetId', '=', 'asset.id')
        .where('asset_face.deletedAt', 'is', null)
        .where('asset_face.isVisible', 'is', true)
        .where('shared_space_person_face.personId', '=', asUuid(spacePersonId)),
    ),
  );
}

export function hasAnySpacePerson<O>(qb: SelectQueryBuilder<DB, 'asset', O>, spacePersonIds: string[]) {
  return qb.where((eb) =>
    eb.exists(
      eb
        .selectFrom('shared_space_person_face')
        .innerJoin('asset_face', 'asset_face.id', 'shared_space_person_face.assetFaceId')
        .whereRef('asset_face.assetId', '=', 'asset.id')
        .where('asset_face.deletedAt', 'is', null)
        .where('asset_face.isVisible', 'is', true)
        .where('shared_space_person_face.personId', '=', anyUuid(spacePersonIds)),
    ),
  );
}
```

**Step 2: Run the failing test and confirm it passes**

```bash
pnpm test:medium -- --run <path-to-file>
```

Expected: PASS.

**Step 3: Regenerate any affected `.sql` query files**

`hasAnySpacePerson` is used by multiple repositories that have `@GenerateSql`-decorated methods. Regenerate the SQL files for any repository whose query shape changed (search / asset repos). Same approach as task 1.6 step 5.

### Task 3.3: Type check and commit

```bash
cd server && pnpm check
git add server/src/utils/database.ts \
        server/src/queries/*.sql \
        server/test/medium/specs/repositories/<affected-file>
git commit -m "fix(spaces): hasAnySpacePerson filters match hasAnyPerson

Asset searches and timeline filters that scope by spacePersonId now
exclude asset_face rows with deletedAt != null or isVisible = false,
matching the native hasAnyPerson helper.

Refs #272"
```

---

## Commit 4: Force wipes space-person state + re-populates

**Summary:** Add `deleteAllPersonFaces`, `deleteAllPersons`, `getSpaceIdsWithFaceRecognitionEnabled` repo methods; wire Force (`handleQueueRecognizeFaces`) to call them and to queue `SharedSpaceFaceMatchAll` for every face-recognition-enabled space. Corresponds to design section 2.

**Order note:** the repo methods are added first (task 4.1) so the service test in task 4.2 can reference typed mocks — `ServiceMocks` is generated from the repository interface at compile time, so the test won't type-check until the methods exist.

### Task 4.1: Add the three repo methods first

**Files:**

- Modify: `server/src/repositories/shared-space.repository.ts`

**Step 1: Add `deleteAllPersonFaces` and `deleteAllPersons`**

Place these near the existing `deleteOrphanedPersons` methods:

```ts
@GenerateSql({ params: [] })
async deleteAllPersonFaces() {
  await this.db.deleteFrom('shared_space_person_face').execute();
}

@GenerateSql({ params: [] })
async deleteAllPersons() {
  await this.db.deleteFrom('shared_space_person').execute();
}
```

**Step 2: Add `getSpaceIdsWithFaceRecognitionEnabled`**

Place it near other `getSpace...` methods:

```ts
@GenerateSql({ params: [] })
async getSpaceIdsWithFaceRecognitionEnabled(): Promise<string[]> {
  const rows = await this.db
    .selectFrom('shared_space')
    .select('id')
    .where('faceRecognitionEnabled', '=', true)
    .execute();
  return rows.map((r) => r.id);
}
```

**Step 3: Regenerate the SQL query file** (as in task 1.6 step 5).

### Task 4.2: Failing unit tests — wipe + requeue + deadlock guard

**Files:**

- Modify: `server/src/services/person.service.spec.ts`

**Step 1: Find an existing `handleQueueRecognizeFaces` test** in the file and copy its mock setup verbatim into the new tests below. The existing tests already know the right shape for `mocks.systemMetadata.get`, `mocks.person.getAllFaces`, `mocks.database.prewarm`, etc. — do not guess.

**Step 2: Add these tests** inside the `describe` for `handleQueueRecognizeFaces`, using the mock-setup pattern you copied:

```ts
describe('force wipes space state', () => {
  it('should wipe shared_space_person tables and queue SharedSpaceFaceMatchAll per space when force=true', async () => {
    // ... copied mock setup for the force=true path ...
    mocks.sharedSpace.deleteAllPersonFaces.mockResolvedValue(void 0);
    mocks.sharedSpace.deleteAllPersons.mockResolvedValue(void 0);
    mocks.sharedSpace.getSpaceIdsWithFaceRecognitionEnabled.mockResolvedValue(['space-a', 'space-b']);

    await sut.handleQueueRecognizeFaces({ force: true });

    expect(mocks.sharedSpace.deleteAllPersonFaces).toHaveBeenCalledOnce();
    expect(mocks.sharedSpace.deleteAllPersons).toHaveBeenCalledOnce();
    expect(mocks.job.queue).toHaveBeenCalledWith({
      name: JobName.SharedSpaceFaceMatchAll,
      data: { spaceId: 'space-a' },
    });
    expect(mocks.job.queue).toHaveBeenCalledWith({
      name: JobName.SharedSpaceFaceMatchAll,
      data: { spaceId: 'space-b' },
    });
  });

  it('should not wipe space state when force=false', async () => {
    // ... copied mock setup for the force=false path ...

    await sut.handleQueueRecognizeFaces({ force: false });

    expect(mocks.sharedSpace.deleteAllPersonFaces).not.toHaveBeenCalled();
    expect(mocks.sharedSpace.deleteAllPersons).not.toHaveBeenCalled();
    expect(mocks.sharedSpace.getSpaceIdsWithFaceRecognitionEnabled).not.toHaveBeenCalled();
  });

  it('should not drain the FacialRecognition queue (deadlock guard)', async () => {
    // ... copied mock setup ...

    await sut.handleQueueRecognizeFaces({ force: false });

    // Every call to waitForQueueCompletion must not include FacialRecognition.
    for (const call of mocks.job.waitForQueueCompletion.mock.calls) {
      expect(call).not.toContain(QueueName.FacialRecognition);
    }
  });
});
```

Because the mocks are generated from the repository interface at compile time, `mocks.sharedSpace.deleteAllPersonFaces` etc. only exist after task 4.1 adds the methods. That's why 4.1 runs first.

**Step 3: Run and confirm failure**

```bash
cd server && pnpm test -- --run src/services/person.service.spec.ts -t "force wipes space state"
```

Expected: FAIL — the service code doesn't call the new methods yet.

### Task 4.3: Wire Force to call the new methods

**Files:**

- Modify: `server/src/services/person.service.ts:405-461` — `handleQueueRecognizeFaces`.

**Step 1: Update the force branch**

Inside the `if (force) { ... }` block at line 428, after `vacuum`, add:

```ts
if (force) {
  await this.personRepository.unassignFaces({ sourceType: SourceType.MachineLearning });
  await this.handlePersonCleanup();
  await this.personRepository.vacuum({ reindexVectors: false });

  // Wipe shared-space person state so the new strict clustering algorithm can
  // rebuild from scratch. Aliases cascade via the FK on personId; named
  // space-persons are lost by design (Force already clears named native persons).
  await this.sharedSpaceRepository.deleteAllPersonFaces();
  await this.sharedSpaceRepository.deleteAllPersons();

  // Queue one SharedSpaceFaceMatchAll per face-recognition-enabled space so EXIF
  // and manual-sourced faces (which keep their personIds across unassignFaces and
  // whose SharedSpaceFaceMatch is not triggered by handleRecognizeFaces early
  // return) also get re-clustered into the rebuilt space tables.
  const spaceIds = await this.sharedSpaceRepository.getSpaceIdsWithFaceRecognitionEnabled();
  for (const spaceId of spaceIds) {
    await this.jobRepository.queue({
      name: JobName.SharedSpaceFaceMatchAll,
      data: { spaceId },
    });
  }
} else if (waiting) {
  // ... existing code unchanged
```

**Step 2: Run the unit tests and confirm they pass**

```bash
pnpm test -- --run src/services/person.service.spec.ts -t "handleQueueRecognizeFaces"
```

Expected: PASS for the three new tests and the existing ones.

### Task 4.4: Type check and commit

```bash
cd server && pnpm check
git add server/src/repositories/shared-space.repository.ts \
        server/src/queries/shared.space.repository.sql \
        server/src/services/person.service.ts \
        server/src/services/person.service.spec.ts
git commit -m "fix(spaces): Force recognition now wipes and rebuilds space-person state

Force facial recognition (admin → Jobs → Facial Recognition → Force):
  1. Clears all ML-sourced native face→person assignments (existing).
  2. Deletes every row from shared_space_person and shared_space_person_face.
  3. Queues SharedSpaceFaceMatchAll for every space with face recognition
     enabled, so EXIF/manual-sourced faces (which keep their personIds across
     Force and bypass the SharedSpaceFaceMatch queueing in handleRecognizeFaces)
     still get re-clustered.
  4. Queues per-face native recognition as before.

FacialRecognition queue concurrency is fixed at 1, so the wipe cannot race
with an in-flight space face-match job.

Refs #272"
```

---

## Commit 5: `unlinkLibrary` cleanup

**Summary:** Add a set-based `removePersonFacesByLibrary` repo method and call it from `unlinkLibrary`. Corresponds to design section 6.

### Task 5.1: Failing medium test for `removePersonFacesByLibrary`

**Files:**

- Modify: `server/test/medium/specs/repositories/shared-space.repository.spec.ts`

**Step 1: Write the test**

```ts
describe('removePersonFacesByLibrary', () => {
  it('should delete space-person mappings for all assets in the given library and recount', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: user.id });
    const { space } = await ctx.newSharedSpace({ createdById: user.id });

    // 2 assets in the target library and 1 in a different library (no libraryId)
    const { asset: libAsset1 } = await ctx.newAsset({ ownerId: user.id, libraryId: library.id });
    const { asset: libAsset2 } = await ctx.newAsset({ ownerId: user.id, libraryId: library.id });
    const { asset: otherAsset } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: f1 } = await ctx.newAssetFace({ assetId: libAsset1.id });
    const { assetFace: f2 } = await ctx.newAssetFace({ assetId: libAsset2.id });
    const { assetFace: f3 } = await ctx.newAssetFace({ assetId: otherAsset.id });

    const spacePerson = await sut.createPerson({
      spaceId: space.id,
      name: '',
      representativeFaceId: null,
      type: 'person',
    });
    await sut.addPersonFaces(
      [f1, f2, f3].map((f) => ({ personId: spacePerson.id, assetFaceId: f.id })),
      { skipRecount: false },
    );

    await sut.removePersonFacesByLibrary(space.id, library.id);

    const remaining = await sut.getPersonAssetIds(spacePerson.id);
    expect(remaining.map((r) => r.assetId).sort()).toEqual([otherAsset.id]);
    const after = await sut.getPersonById(spacePerson.id);
    expect(after?.assetCount).toBe(1);
  });
});
```

**Step 2: Run and confirm failure**

```bash
pnpm test:medium -- --run src/medium/specs/repositories/shared-space.repository.spec.ts -t "removePersonFacesByLibrary"
```

Expected: FAIL — the method does not exist.

### Task 5.2: Implement `removePersonFacesByLibrary`

**Files:**

- Modify: `server/src/repositories/shared-space.repository.ts`

**Step 1: Add the method**

Place it near `removePersonFacesByAssetIds`:

```ts
@GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
async removePersonFacesByLibrary(spaceId: string, libraryId: string) {
  const assetFaceSubquery = this.db
    .selectFrom('asset_face')
    .innerJoin('asset', 'asset.id', 'asset_face.assetId')
    .select('asset_face.id')
    .where('asset.libraryId', '=', libraryId);

  const spacePersonSubquery = this.db
    .selectFrom('shared_space_person')
    .select('shared_space_person.id')
    .where('shared_space_person.spaceId', '=', spaceId);

  const affectedPersonIds = await this.db
    .selectFrom('shared_space_person_face')
    .select('personId')
    .distinct()
    .where('assetFaceId', 'in', assetFaceSubquery)
    .where('personId', 'in', spacePersonSubquery)
    .execute();

  await this.db
    .deleteFrom('shared_space_person_face')
    .where('assetFaceId', 'in', assetFaceSubquery)
    .where('personId', 'in', spacePersonSubquery)
    .execute();

  if (affectedPersonIds.length > 0) {
    await this.recountPersons(affectedPersonIds.map((r) => r.personId));
  }
}
```

**Step 2: Run the test and confirm it passes**

```bash
pnpm test:medium -- --run src/medium/specs/repositories/shared-space.repository.spec.ts -t "removePersonFacesByLibrary"
```

Expected: PASS.

**Step 3: Regenerate SQL query file** (as in task 1.6 step 5).

### Task 5.3: Failing unit test — `unlinkLibrary` wires the cleanup

**Files:**

- Modify: `server/src/services/shared-space.service.spec.ts`

**Step 1: Find the existing `unlinkLibrary` describe block (or create one) and add:**

```ts
describe('unlinkLibrary cleanup', () => {
  it('should call removePersonFacesByLibrary and deleteOrphanedPersons after unlink', async () => {
    const spaceId = newUuid();
    const libraryId = newUuid();
    const auth = factory.auth({ user: { isAdmin: true } });

    mocks.sharedSpace.getMember.mockResolvedValue(makeMemberResult({ role: SharedSpaceRole.Owner }));
    mocks.sharedSpace.removeLibrary.mockResolvedValue(void 0);
    mocks.sharedSpace.removePersonFacesByLibrary.mockResolvedValue(void 0);
    mocks.sharedSpace.deleteOrphanedPersons.mockResolvedValue(void 0);

    await sut.unlinkLibrary(auth, spaceId, libraryId);

    expect(mocks.sharedSpace.removeLibrary).toHaveBeenCalledWith(spaceId, libraryId);
    expect(mocks.sharedSpace.removePersonFacesByLibrary).toHaveBeenCalledWith(spaceId, libraryId);
    expect(mocks.sharedSpace.deleteOrphanedPersons).toHaveBeenCalledWith(spaceId);
  });
});
```

**Step 2: Run and confirm failure**

```bash
pnpm test -- --run src/services/shared-space.service.spec.ts -t "unlinkLibrary cleanup"
```

Expected: FAIL.

### Task 5.4: Wire `unlinkLibrary`

**Files:**

- Modify: `server/src/services/shared-space.service.ts:479-487`

**Step 1: Update the method body**

```ts
async unlinkLibrary(auth: AuthDto, spaceId: string, libraryId: string): Promise<void> {
  if (!auth.user.isAdmin) {
    throw new ForbiddenException('Only admins can unlink libraries from spaces');
  }

  await this.requireRole(auth, spaceId, SharedSpaceRole.Editor);

  await this.sharedSpaceRepository.removeLibrary(spaceId, libraryId);
  await this.sharedSpaceRepository.removePersonFacesByLibrary(spaceId, libraryId);
  await this.sharedSpaceRepository.deleteOrphanedPersons(spaceId);
}
```

**Step 2: Run the test and confirm it passes**

```bash
pnpm test -- --run src/services/shared-space.service.spec.ts -t "unlinkLibrary cleanup"
```

Expected: PASS.

### Task 5.5: Type check and commit

```bash
cd server && pnpm check
git add server/src/repositories/shared-space.repository.ts \
        server/src/queries/shared.space.repository.sql \
        server/src/services/shared-space.service.ts \
        server/src/services/shared-space.service.spec.ts \
        server/test/medium/specs/repositories/shared-space.repository.spec.ts
git commit -m "fix(spaces): clean up space-person face mappings when unlinking a library

Unlinking a library from a shared space now removes every
shared_space_person_face row whose asset belongs to that library, then
deletes any now-orphaned space-persons and recounts the rest.

Set-based SQL so libraries with millions of assets don't hit Postgres
parameter limits.

Refs #272"
```

---

## Commit 6: Hide empty unnamed space-persons from the list

**Summary:** Add `WHERE name != '' OR assetCount > 0` predicate to `getPersonsBySpaceId`. Corresponds to design section 8.

### Task 6.1: Failing medium test

**Files:**

- Modify: `server/test/medium/specs/repositories/shared-space.repository.spec.ts`

**Step 1: Write the test**

```ts
describe('getPersonsBySpaceId empty-person filter', () => {
  it('should hide unnamed space-persons with assetCount 0 and keep named ones', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });

    // Seed the three space-persons. getPersonsBySpaceId requires each space-person's
    // representativeFaceId to resolve to a `person` row with a non-null thumbnailPath
    // (left join + where thumbnailPath is not null / != '') — so every person in
    // this test needs a backing `person` row with a thumbnail, otherwise all three
    // get filtered out and the test can't distinguish the empty-filter behaviour.

    const seedRepresentative = async () => {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { person } = await ctx.newPerson({ ownerId: user.id, thumbnailPath: '/fake.jpg' });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: person.id });
      return { assetFace, asset };
    };

    // Unnamed, 0 assets → hidden
    const { assetFace: face1 } = await seedRepresentative();
    await sut.createPerson({ spaceId: space.id, name: '', representativeFaceId: face1.id, type: 'person' });

    // Named, 0 assets → visible
    const { assetFace: face2 } = await seedRepresentative();
    const namedPerson = await sut.createPerson({
      spaceId: space.id,
      name: 'Alice',
      representativeFaceId: face2.id,
      type: 'person',
    });

    // Unnamed, > 0 assets → visible
    const { assetFace: face3 } = await seedRepresentative();
    const thirdPerson = await sut.createPerson({
      spaceId: space.id,
      name: '',
      representativeFaceId: face3.id,
      type: 'person',
    });
    await sut.addPersonFaces([{ personId: thirdPerson.id, assetFaceId: face3.id }], { skipRecount: false });

    const people = await sut.getPersonsBySpaceId(space.id, {
      withHidden: true,
      petsEnabled: true,
      limit: 50,
      offset: 0,
    });
    const ids = people.map((p) => p.id);

    expect(ids).toHaveLength(2);
    expect(ids).toContain(namedPerson.id);
    expect(ids).toContain(thirdPerson.id);
  });
});
```

`ctx.newPerson` returns `{ person, result }` — verify the destructuring matches the factory definition at `test/medium.factory.ts:257`.

**Step 2: Run and confirm failure**

```bash
cd server && pnpm test:medium -- --run src/medium/specs/repositories/shared-space.repository.spec.ts -t "getPersonsBySpaceId empty-person filter"
```

Expected: FAIL — all three are returned.

### Task 6.2: Implement the filter

**Files:**

- Modify: `server/src/repositories/shared-space.repository.ts:491-544`

**Step 1: Add the predicate**

Inside `getPersonsBySpaceId`, after the existing `.where('shared_space_person.spaceId', '=', spaceId)` line, add:

```ts
.where((eb) =>
  eb.or([
    eb('shared_space_person.name', '!=', ''),
    eb('shared_space_person.assetCount', '>', 0),
  ]),
)
```

**Step 2: Run the test and confirm it passes**

```bash
pnpm test:medium -- --run src/medium/specs/repositories/shared-space.repository.spec.ts -t "getPersonsBySpaceId empty-person filter"
```

Expected: PASS.

**Step 3: Regenerate SQL query file** (as in task 1.6 step 5).

### Task 6.3: Type check and commit

```bash
cd server && pnpm check
git add server/src/repositories/shared-space.repository.ts \
        server/src/queries/shared.space.repository.sql \
        server/test/medium/specs/repositories/shared-space.repository.spec.ts
git commit -m "fix(spaces): hide unnamed space-persons with zero visible assets

getPersonsBySpaceId now requires either a non-empty name or a positive
assetCount. Mirrors the native getAllForUser behaviour for unnamed
persons below minimumFaceCount.

Refs #272"
```

---

## Post-commit verification

### Task 7.1: Full-file check

```bash
cd server && pnpm check
```

Expected: clean.

### Task 7.2: Run the full server unit suite

```bash
pnpm test
```

Expected: all green. Pay attention to any existing shared-space tests that may have incidentally relied on the old single-linkage behaviour and were not rewritten in task 1.3.

### Task 7.3: Run the shared-space medium suite

```bash
pnpm test:medium -- --run src/medium/specs/repositories/shared-space.repository.spec.ts
```

Expected: all green.

### Task 7.4: Push and open PR

```bash
git push -u origin investigate/space-people-count-272
gh pr create --title "fix(spaces): strict face clustering + count/filter fixes (#272)" --body "$(cat <<'EOF'
## Summary

Fixes the shared-space person count/assignment bug reported in #272. Design: docs/plans/2026-04-08-space-face-clustering-design.md.

- Strict gate in processSpaceFaceMatch — a face must have a global personId before it can join a space-person (Layer 1 personId → Layer 2 embedding → Layer 3 create). Eliminates single-face chaining.
- recountPersons / hasAnySpacePerson / hasSpacePerson filter by asset.visibility=Timeline, asset.deletedAt IS NULL, asset_face.deletedAt IS NULL, asset_face.isVisible=true — matches getStatistics.
- Force recognition now wipes shared_space_person and shared_space_person_face, then queues SharedSpaceFaceMatchAll per face-recognition-enabled space so EXIF/manual-sourced faces are re-clustered too.
- unlinkLibrary cleans up face mappings for the unlinked library via a set-based query.
- getPersonsBySpaceId hides unnamed space-persons with zero visible assets.
- getAssetFacesForMatching filters out asset_face.isVisible=false.

Existing corrupted clusters and inflated counts are not migrated automatically. Users who see bad state run admin → Jobs → Facial Recognition → Force. This clears all named people (native and space) and rebuilds from scratch.

## Test plan

- [ ] processSpaceFaceMatch unit tests: strict gate, Layer 1/2/3 ordering, stale-row preservation, Layer 1 with null representativeFaceId
- [ ] recountPersons medium test: trashed/archived/invisible-face exclusion
- [ ] hasAnySpacePerson medium test: filter parity
- [ ] handleQueueRecognizeFaces force=true: wipes and requeues per space
- [ ] handleQueueRecognizeFaces: does not drain FacialRecognition (deadlock guard)
- [ ] removePersonFacesByLibrary medium test: set-based cleanup
- [ ] unlinkLibrary unit test: calls the cleanup
- [ ] getPersonsBySpaceId medium test: empty unnamed hidden, named visible
- [ ] Full server unit suite green
- [ ] Full shared-space medium suite green

Refs #272
EOF
)"
```

### Task 7.5: Babysit CI

Use the `babysit` skill to watch the PR until it's green, fixing failures as they arrive.

---

## Known follow-ups (do NOT do in this PR)

These are documented in the design doc under "Out of scope / follow-ups":

- Centroid-based Layer 2 matching.
- Per-space rebuild action.
- Native face reassignment propagation into `shared_space_person_face`.
- Library sync soft-delete cleanup.
- `getAssetIdsInSpace` explicit-share branch filter asymmetry.
