# Face Cleanup — flagged-faces persist — Slice 2 (service wiring) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make `runScan` persist the flagged faces it already computes (via Slice 1's `replaceScanFlaggedFaces`),
and make `getPersonFlaggedFaces` read them (via `getScanFlaggedFaces` + `applyDeclineFilters`) instead of
recomputing with `buildRepairPlan` — so the review page does no KNN.

**Architecture:** Two edits to `FaceRepairService`: a persist call in `runScan` (before `completeScan`), and a
rewritten `getPersonFlaggedFaces` read path. The `FaceRepairPersonFacesDto` contract is unchanged — no web/OpenAPI
work. Unit tests pin the read path (no `buildRepairPlan`/`searchFaces`) and the persist call; a medium e2e proves
the real scan→review flow against Postgres.

**Tech Stack:** NestJS service, Vitest unit (`newTestService`) + medium (testcontainers), `applyDeclineFilters` +
`getDeclineMaps` reuse.

**Spec:** [`2026-06-29-face-cleanup-flagged-faces-persist-design.md`](2026-06-29-face-cleanup-flagged-faces-persist-design.md)
— Architecture §3–§5; edges E3, E4, E6, E9, E10, E12, E13, E14 (+ E1/E2 proven end-to-end here too).

## Global Constraints

- Depends on Slice 1: `FaceRepairScanRepository.replaceScanFlaggedFaces(scanId, { assetFaceId, personId,
suspectedOwnerId }[])` and `getScanFlaggedFaces(scanId, personId) → { assetFaceId, suspectedOwnerId }[]`.
- `getPersonFlaggedFaces` keeps its exact return type `{ personId, flaggedFaces: { assetFaceId, suspectedOwnerId
}[] }` — DO NOT change the controller/DTO/web. The recompute (`buildRepairPlan`) is **removed** from this method.
- Read path reuses `applyDeclineFilters` (`src/utils/face-repair.ts`) with `getDeclineMaps()` so faces declined
  since the scan are filtered with identical semantics; the Map passed in uses `currentPersonId: personId`
  (`FlaggedLike` requires it).
- `runScan` persists the **union** `[...plan.toRepair, ...plan.reviewOnlyFaces]` (the existing `allFlaggedFaces`
  local at `face-repair.service.ts:347`) mapped to `{ assetFaceId, personId: currentPersonId, suspectedOwnerId }`,
  **before** the `completeScan` call (line 387).
- `src/` alias; Prettier; `tsc --noEmit` clean per commit; full lint deferred to the final slice. Medium needs Docker.

---

## File Structure

- Modify: `server/src/services/face-repair.service.ts` — `runScan` persist + `getPersonFlaggedFaces` read.
- Modify: `server/src/services/face-repair.scan.spec.ts` — assert `runScan` persists the union (unit).
- Modify: `server/src/services/face-repair.person.spec.ts` — rewrite the `getPersonFlaggedFaces` unit tests for
  the new read path (the current ones mock + assert `buildRepairPlan`, which is removed).
- Create: `server/test/medium/specs/services/face-repair-flagged-faces.spec.ts` — real scan→review e2e.

---

## Task 1: Service wiring + unit tests (TDD)

**Files:**

- Modify: `server/src/services/face-repair.service.ts`
- Test: `server/src/services/face-repair.scan.spec.ts`, `server/src/services/face-repair.person.spec.ts`

**Interfaces:**

- Consumes (Slice 1): `mocks.faceRepairScan.replaceScanFlaggedFaces`, `mocks.faceRepairScan.getScanFlaggedFaces`,
  `mocks.faceRepairScan.getLatestScan`, `mocks.faceRepairDecline.getDeclineMaps`.
- Produces: `getPersonFlaggedFaces` now reads stored faces; `runScan` persists them.

- [ ] **Step 1: Write/rewrite the failing unit tests**

(a) In `server/src/services/face-repair.scan.spec.ts`: add `mocks.faceRepairScan.replaceScanFlaggedFaces.mockResolvedValue();`
to the `beforeEach` (next to the other `faceRepairScan` mock defaults ~line 41), then append this test inside the
`describe('runScan', …)` block:

```ts
it('persists the scan’s flagged faces (toRepair + reviewOnlyFaces) before completing', async () => {
  vi.spyOn(sut, 'buildRepairPlan').mockResolvedValue({
    toRepair: [{ assetFaceId: 'face-1', currentPersonId: 'P', suspectedOwnerId: 'Q' }],
    reviewOnlyFaces: [{ assetFaceId: 'face-2', currentPersonId: 'P', suspectedOwnerId: 'R', reason: 'over-cap' }],
    reviewOnlyPersonIds: [],
    unAttributableFaces: [],
    perPerson: [{ personId: 'P', eligible: 5, flagged: 2, flaggedFraction: 0.4 }],
  } as any);

  await sut.runScan('scan-1');

  expect(mocks.faceRepairScan.replaceScanFlaggedFaces).toHaveBeenCalledWith('scan-1', [
    { assetFaceId: 'face-1', personId: 'P', suspectedOwnerId: 'Q' },
    { assetFaceId: 'face-2', personId: 'P', suspectedOwnerId: 'R' },
  ]);
  // persisted before the scan is marked completed
  const persistOrder = mocks.faceRepairScan.replaceScanFlaggedFaces.mock.invocationCallOrder[0];
  const completeOrder = mocks.faceRepairScan.completeScan.mock.invocationCallOrder[0];
  expect(persistOrder).toBeLessThan(completeOrder);
});
```

(b) In `server/src/services/face-repair.person.spec.ts`: **replace** the entire `describe('getPersonFlaggedFaces', …)`
block (its tests mock `buildRepairPlan`, which no longer exists on this path) with:

```ts
describe('getPersonFlaggedFaces', () => {
  const noDeclines = { declinedFaceOwners: new Map(), dismissedPersons: new Map() };

  it('reads the latest scan’s stored flagged faces (no recompute / no KNN)', async () => {
    const planSpy = vi.spyOn(sut, 'buildRepairPlan');
    mocks.faceRepairScan.getLatestScan.mockResolvedValue({ id: 'scan-1' } as any);
    mocks.faceRepairScan.getScanFlaggedFaces.mockResolvedValue([
      { assetFaceId: 'f1', suspectedOwnerId: 'q1' },
      { assetFaceId: 'f2', suspectedOwnerId: 'q2' },
    ]);
    mocks.faceRepairDecline.getDeclineMaps.mockResolvedValue(noDeclines as any);

    const result = await sut.getPersonFlaggedFaces('p1');

    expect(mocks.faceRepairScan.getScanFlaggedFaces).toHaveBeenCalledWith('scan-1', 'p1');
    expect(result).toEqual({
      personId: 'p1',
      flaggedFaces: [
        { assetFaceId: 'f1', suspectedOwnerId: 'q1' },
        { assetFaceId: 'f2', suspectedOwnerId: 'q2' },
      ],
    });
    expect(planSpy).not.toHaveBeenCalled(); // E9: no recompute
    expect(mocks.search.searchFaces).not.toHaveBeenCalled(); // E9: no KNN
  });

  it('filters faces declined since the scan (E3)', async () => {
    mocks.faceRepairScan.getLatestScan.mockResolvedValue({ id: 'scan-1' } as any);
    mocks.faceRepairScan.getScanFlaggedFaces.mockResolvedValue([
      { assetFaceId: 'f1', suspectedOwnerId: 'q1' },
      { assetFaceId: 'f2', suspectedOwnerId: 'q2' },
    ]);
    mocks.faceRepairDecline.getDeclineMaps.mockResolvedValue({
      declinedFaceOwners: new Map([['f1', new Set(['q1'])]]),
      dismissedPersons: new Map(),
    } as any);

    const result = await sut.getPersonFlaggedFaces('p1');
    expect(result.flaggedFaces).toEqual([{ assetFaceId: 'f2', suspectedOwnerId: 'q2' }]);
  });

  it('returns empty when there is no scan (E6)', async () => {
    // eslint-disable-next-line unicorn/no-useless-undefined
    mocks.faceRepairScan.getLatestScan.mockResolvedValue(undefined);
    const result = await sut.getPersonFlaggedFaces('p1');
    expect(result).toEqual({ personId: 'p1', flaggedFaces: [] });
    expect(mocks.faceRepairScan.getScanFlaggedFaces).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify red**

Run: `cd server && npx vitest --config test/vitest.config.mjs run src/services/face-repair.person.spec.ts src/services/face-repair.scan.spec.ts`
Expected: FAIL — `getPersonFlaggedFaces` still calls `buildRepairPlan` (the new read assertions fail; `planSpy`
is called) and `runScan` does not yet call `replaceScanFlaggedFaces`.

- [ ] **Step 3: Implement the service changes**

In `server/src/services/face-repair.service.ts`:

(a) Replace the body of `getPersonFlaggedFaces` with the read path (keep the signature/return type):

```ts
  async getPersonFlaggedFaces(
    personId: string,
  ): Promise<{ personId: string; flaggedFaces: { assetFaceId: string; suspectedOwnerId: string }[] }> {
    const latest = await this.faceRepairScanRepository.getLatestScan();
    if (!latest) {
      return { personId, flaggedFaces: [] };
    }
    const stored = await this.faceRepairScanRepository.getScanFlaggedFaces(latest.id, personId);
    const declineMaps = await this.faceRepairDeclineRepository.getDeclineMaps();
    const byPerson = new Map([
      [personId, stored.map((s) => ({ assetFaceId: s.assetFaceId, currentPersonId: personId, suspectedOwnerId: s.suspectedOwnerId }))],
    ]);
    applyDeclineFilters(byPerson, declineMaps);
    const flaggedFaces = (byPerson.get(personId) ?? []).map((f) => ({
      assetFaceId: f.assetFaceId,
      suspectedOwnerId: f.suspectedOwnerId,
    }));
    return { personId, flaggedFaces };
  }
```

> `applyDeclineFilters` is already imported in this file (used by `buildRepairPlan`); confirm the import is
> present. `this.faceRepairDeclineRepository` is the existing injected accessor (used by `createDeclines`).

(b) In `runScan`, immediately **before** the `completeScan` call (line 387), persist the flagged faces using the
existing `allFlaggedFaces` local (built at line 347):

```ts
await this.faceRepairScanRepository.replaceScanFlaggedFaces(
  scanId,
  allFlaggedFaces.map((f) => ({
    assetFaceId: f.assetFaceId,
    personId: f.currentPersonId,
    suspectedOwnerId: f.suspectedOwnerId,
  })),
);
```

- [ ] **Step 4: Run to verify green**

Run: `cd server && npx vitest --config test/vitest.config.mjs run src/services/face-repair.person.spec.ts src/services/face-repair.scan.spec.ts`
Expected: PASS — the new read-path tests, the persist test, and the pre-existing `runScan`/scan cases.

- [ ] **Step 5: Type-check + format**

Run: `cd server && npx tsc --noEmit` → exit 0.
Run: `cd .. && npx prettier --check server/src/services/face-repair.service.ts server/src/services/face-repair.scan.spec.ts server/src/services/face-repair.person.spec.ts` (write + re-run if needed).

- [ ] **Step 6: Commit**

```bash
git add server/src/services/face-repair.service.ts server/src/services/face-repair.scan.spec.ts server/src/services/face-repair.person.spec.ts
git commit -m "feat(server): persist scan flagged faces + read them on review (no recompute)"
```

---

## Task 2: Medium e2e — real scan → review (TDD)

**Files:**

- Create: `server/test/medium/specs/services/face-repair-flagged-faces.spec.ts`

**Interfaces:**

- Consumes (real): `FaceRepairService.{triggerScan, handleFaceRepairScan, getPersonFlaggedFaces, createDeclines}`,
  `FaceRepairScanRepository.{createScan, completeScan, replaceScanFlaggedFaces}`, and the medium ctx seeders.

- [ ] **Step 1: Write the failing tests**

Create `server/test/medium/specs/services/face-repair-flagged-faces.spec.ts`. The first test runs a **real scan**
(proving `runScan` persists); the rest seed a completed scan + flagged rows directly (fast, deterministic) to
exercise the read path. Reuse the over-cap seeding pattern from the sibling
`server/test/medium/specs/services/face-repair.apply.spec.ts`:

```ts
import { Kysely } from 'kysely';
import { SourceType } from 'src/enum';
import { ConfigRepository } from 'src/repositories/config.repository';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository';
import { FaceRepairDeclineRepository } from 'src/repositories/face-repair-decline.repository';
import { FaceRepairScanRepository, RepairScanParams } from 'src/repositories/face-repair-scan.repository';
import { FaceRepairRepository } from 'src/repositories/face-repair.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { PersonRepository } from 'src/repositories/person.repository';
import { SearchRepository } from 'src/repositories/search.repository';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository';
import { DB } from 'src/schema';
import { FaceRepairService } from 'src/services/face-repair.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';
import { Mocked } from 'vitest';

const EMBEDDING = '[' + Array.from({ length: 512 }, () => 1).join(',') + ']';
const PARAMS: RepairScanParams = {
  maxDistance: 0.5,
  minFaces: 3,
  voteWindow: 200,
  voteMargin: 2,
  maxAttributionDistance: 0.35,
  maxFlaggedFraction: 0.5,
  largeClusterThreshold: 50,
};
const zeroTotals = () => ({
  eligibleFaces: 0,
  flaggedFaces: 0,
  toRepair: 0,
  reviewOnlyFaces: 0,
  reviewOnlyPersons: 0,
  affectedPersons: 0,
  reviewOnlyByReason: { overCap: 0, badTarget: 0, unAttributable: 0 },
});

// Two disjoint embedding axes (cosine ~1.0) so the detector treats them as different people.
const axisEmbedding = (axis: 'first' | 'second') =>
  '[' + Array.from({ length: 512 }, (_, i) => ((axis === 'first' ? i < 256 : i >= 256) ? 1 : 0)).join(',') + ']';

let db: Kysely<DB>;

const setup = () => {
  const { ctx, sut } = newMediumService(FaceRepairService, {
    database: db,
    real: [
      FaceRepairRepository,
      FaceRepairScanRepository,
      FaceRepairDeclineRepository,
      FaceIdentityRepository,
      SearchRepository,
      PersonRepository,
      ConfigRepository,
      SystemMetadataRepository,
    ],
    mock: [LoggingRepository, JobRepository],
  });
  const jobMock = ctx.getMock<JobRepository, Mocked<JobRepository>>(JobRepository);
  jobMock.isActive.mockResolvedValue(false);
  jobMock.queue.mockResolvedValue();
  jobMock.queueAll.mockResolvedValue();
  return { sut, ctx, scanRepo: ctx.get(FaceRepairScanRepository) };
};

type Ctx = ReturnType<typeof setup>['ctx'];

// Over-cap person: leaked faces on `first` axis (voting toward owner Q's 10-face cluster) + genuine faces on
// `second`. leaked/(leaked+genuine) > maxFlaggedFraction → the cluster is flagged.
const seedOverCapPerson = async (ctx: Ctx, ownerId: string, opts: { leakedCount: number; genuineCount: number }) => {
  const { person: ownerQ } = await ctx.newPerson({ ownerId, name: '' });
  for (let i = 0; i < 10; i++) {
    const { asset } = await ctx.newAsset({ ownerId });
    const { assetFace } = await ctx.newAssetFace({
      assetId: asset.id,
      personId: ownerQ.id,
      sourceType: SourceType.MachineLearning,
    });
    await db
      .insertInto('face_search')
      .values({ faceId: assetFace.id, embedding: axisEmbedding('first') })
      .execute();
  }
  const { person } = await ctx.newPerson({ ownerId, name: '' });
  const leakedFaceIds: string[] = [];
  for (let i = 0; i < opts.leakedCount; i++) {
    const { asset } = await ctx.newAsset({ ownerId });
    const { assetFace } = await ctx.newAssetFace({
      assetId: asset.id,
      personId: person.id,
      sourceType: SourceType.MachineLearning,
    });
    await db
      .insertInto('face_search')
      .values({ faceId: assetFace.id, embedding: axisEmbedding('first') })
      .execute();
    leakedFaceIds.push(assetFace.id);
  }
  for (let i = 0; i < opts.genuineCount; i++) {
    const { asset } = await ctx.newAsset({ ownerId });
    const { assetFace } = await ctx.newAssetFace({
      assetId: asset.id,
      personId: person.id,
      sourceType: SourceType.MachineLearning,
    });
    await db
      .insertInto('face_search')
      .values({ faceId: assetFace.id, embedding: axisEmbedding('second') })
      .execute();
  }
  return { person, ownerQ, leakedFaceIds };
};

const seedEligibleFace = async (ctx: Ctx, userId: string, personId: string): Promise<string> => {
  const { asset } = await ctx.newAsset({ ownerId: userId });
  const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId, sourceType: SourceType.MachineLearning });
  await db.insertInto('face_search').values({ faceId: assetFace.id, embedding: EMBEDDING }).execute();
  return assetFace.id;
};

// Seed a completed scan listing `personId` plus its stored flagged rows (fast path for read-behaviour tests).
const seedCompletedScanWithFlagged = async (
  scanRepo: ReturnType<typeof setup>['scanRepo'],
  faces: { assetFaceId: string; personId: string; suspectedOwnerId: string }[],
) => {
  const scan = await scanRepo.createScan({ requestedBy: null, params: PARAMS });
  await scanRepo.completeScan(scan.id, { totals: zeroTotals(), persons: [] });
  await scanRepo.replaceScanFlaggedFaces(scan.id, faces);
  return scan;
};

beforeAll(async () => {
  db = await getKyselyDB();
});

afterEach(() => db.deleteFrom('face_repair_scan').execute());

describe('FaceRepairService.getPersonFlaggedFaces (scan-backed)', () => {
  it('a real scan persists flagged faces and the review reads them (E1, E14)', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person, leakedFaceIds } = await seedOverCapPerson(ctx, user.id, { leakedCount: 6, genuineCount: 4 });

    const { scanId } = await sut.triggerScan(user.id, undefined);
    await sut.handleFaceRepairScan({ scanId });
    expect((await sut.getLatestScanStatus())!.status).toBe('completed');

    const result = await sut.getPersonFlaggedFaces(person.id);
    expect(result.flaggedFaces.map((f) => f.assetFaceId).toSorted()).toEqual(leakedFaceIds.toSorted());
  });

  it('excludes a flagged face moved off the person since the scan (E2)', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id });
    const { person: owner } = await ctx.newPerson({ ownerId: user.id });
    const { person: other } = await ctx.newPerson({ ownerId: user.id });
    const f1 = await seedEligibleFace(ctx, user.id, person.id);
    const f2 = await seedEligibleFace(ctx, user.id, person.id);
    await seedCompletedScanWithFlagged(scanRepo, [
      { assetFaceId: f1, personId: person.id, suspectedOwnerId: owner.id },
      { assetFaceId: f2, personId: person.id, suspectedOwnerId: owner.id },
    ]);

    await db.updateTable('asset_face').set({ personId: other.id }).where('id', '=', f1).execute();

    const result = await sut.getPersonFlaggedFaces(person.id);
    expect(result.flaggedFaces.map((f) => f.assetFaceId)).toEqual([f2]);
  });

  it('filters a face-level decline made after the scan (E3)', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id });
    const { person: owner } = await ctx.newPerson({ ownerId: user.id });
    const f1 = await seedEligibleFace(ctx, user.id, person.id);
    const f2 = await seedEligibleFace(ctx, user.id, person.id);
    await seedCompletedScanWithFlagged(scanRepo, [
      { assetFaceId: f1, personId: person.id, suspectedOwnerId: owner.id },
      { assetFaceId: f2, personId: person.id, suspectedOwnerId: owner.id },
    ]);

    await sut.createDeclines({ faces: [{ assetFaceId: f1, suspectedOwnerId: owner.id }], declinedBy: user.id });

    const result = await sut.getPersonFlaggedFaces(person.id);
    expect(result.flaggedFaces.map((f) => f.assetFaceId)).toEqual([f2]);
  });

  it('filters a person-level dismiss made after the scan (E4)', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id });
    const { person: owner } = await ctx.newPerson({ ownerId: user.id });
    const f1 = await seedEligibleFace(ctx, user.id, person.id);
    await seedCompletedScanWithFlagged(scanRepo, [
      { assetFaceId: f1, personId: person.id, suspectedOwnerId: owner.id },
    ]);

    await sut.createDeclines({
      persons: [{ personId: person.id, suspectedOwnerIds: [owner.id] }],
      declinedBy: user.id,
    });

    const result = await sut.getPersonFlaggedFaces(person.id);
    expect(result.flaggedFaces).toEqual([]);
  });

  it('still shows a stored face whose owner cluster vanished (snapshot semantics, no recompute) (E13)', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id });
    const { person: owner } = await ctx.newPerson({ ownerId: user.id });
    const f1 = await seedEligibleFace(ctx, user.id, person.id);
    await seedCompletedScanWithFlagged(scanRepo, [
      { assetFaceId: f1, personId: person.id, suspectedOwnerId: owner.id },
    ]);

    // Delete the suspected owner — a fresh recompute could no longer flag f1, but the read is a snapshot.
    await db.deleteFrom('person').where('id', '=', owner.id).execute();

    const result = await sut.getPersonFlaggedFaces(person.id);
    expect(result.flaggedFaces.map((f) => f.assetFaceId)).toEqual([f1]);
  });

  it('returns a large flagged set as a bounded read (E10)', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id });
    const { person: owner } = await ctx.newPerson({ ownerId: user.id });
    const faces = [];
    for (let i = 0; i < 150; i++) {
      const id = await seedEligibleFace(ctx, user.id, person.id);
      faces.push({ assetFaceId: id, personId: person.id, suspectedOwnerId: owner.id });
    }
    await seedCompletedScanWithFlagged(scanRepo, faces);

    const result = await sut.getPersonFlaggedFaces(person.id);
    expect(result.flaggedFaces).toHaveLength(150);
  });

  it('returns empty when the latest scan has no rows yet (running re-scan) (E12)', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id });
    const { person: owner } = await ctx.newPerson({ ownerId: user.id });
    const f1 = await seedEligibleFace(ctx, user.id, person.id);
    await seedCompletedScanWithFlagged(scanRepo, [
      { assetFaceId: f1, personId: person.id, suspectedOwnerId: owner.id },
    ]);

    // A newer scan (no rows yet) becomes the latest.
    await scanRepo.createScan({ requestedBy: null, params: PARAMS });

    const result = await sut.getPersonFlaggedFaces(person.id);
    expect(result.flaggedFaces).toEqual([]);
  });

  it('returns empty when there is no scan at all (E6)', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id });
    const result = await sut.getPersonFlaggedFaces(person.id);
    expect(result.flaggedFaces).toEqual([]);
  });
});
```

> Confirm the real scan entrypoint: the sibling apply medium spec uses `sut.triggerScan(userId, params)` then
> `sut.handleFaceRepairScan({ scanId })`. Copy those exact method names if they differ. The `createScan`
> single-flight guard means each test that creates a scan starts from the `afterEach` clean slate.

- [ ] **Step 2: Run to verify red**

Run: `cd server && npx vitest --config test/vitest.config.medium.mjs run test/medium/specs/services/face-repair-flagged-faces.spec.ts`
Expected: FAIL — `getPersonFlaggedFaces` does not yet read stored rows (it recomputes), so the seeded-scan tests
return the wrong set, and the real-scan test finds no persisted rows. (After Task 1's service change is in, they
pass — if Task 1 is already committed, expect these GREEN and treat a RED as a real bug.)

- [ ] **Step 3: (implementation already done in Task 1)** — no production change here; this task adds the e2e proof.

- [ ] **Step 4: Run to verify green**

Run: `cd server && npx vitest --config test/vitest.config.medium.mjs run test/medium/specs/services/face-repair-flagged-faces.spec.ts`
Expected: PASS (all cases). First run boots a Postgres container (~15-30s).

- [ ] **Step 5: Type-check + format**

Run: `cd server && npx tsc --noEmit` → exit 0.
Run: `cd .. && npx prettier --check server/test/medium/specs/services/face-repair-flagged-faces.spec.ts` (write + re-run if needed).

- [ ] **Step 6: Commit**

```bash
git add server/test/medium/specs/services/face-repair-flagged-faces.spec.ts
git commit -m "test(server): medium e2e for scan-backed getPersonFlaggedFaces"
```

---

## Self-Review

- **Spec coverage (Slice 2):** `runScan` persist (Task 1, scan.spec) → E14; `getPersonFlaggedFaces` read + decline
  filter, no recompute (Task 1, person.spec) → E3, E6, E9; medium e2e (Task 2) → E1/E14 (real scan persists), E2
  (moved-off), E3/E4 (face + person declines), E13 (snapshot), E10 (large), E12 (running re-scan), E6 (no scan).
- **Placeholders:** none — full code + commands. The two "confirm method names" notes point at the sibling spec,
  not unresolved TBDs.
- **Type consistency:** `getPersonFlaggedFaces` return type unchanged; the read maps stored `{ assetFaceId,
suspectedOwnerId }` → `applyDeclineFilters` `FlaggedLike` (`+ currentPersonId`) → output `{ assetFaceId,
suspectedOwnerId }`. `runScan` persists `{ assetFaceId, personId: currentPersonId, suspectedOwnerId }` matching
  Slice 1's `replaceScanFlaggedFaces` signature.
- **Existing tests:** the old `getPersonFlaggedFaces` unit tests (mocking `buildRepairPlan`) are replaced; the
  pre-existing `runScan` tests keep passing (the new awaited `replaceScanFlaggedFaces` is mocked in `beforeEach`).
