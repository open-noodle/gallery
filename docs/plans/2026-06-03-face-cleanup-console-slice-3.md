# Face Cleanup Console — Slice 3 (scan job + read API) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use
> checkbox (`- [ ]`) syntax. TDD: failing test → red → implement → green → commit.

**Goal:** A background `FaceRepairScan` job that runs `buildRepairPlan`, classifies + enriches each flagged
person, and persists the report via the Slice-1 repository; plus admin endpoints to trigger a scan and read
the latest.

**Architecture:** New `JobName.FaceRepairScan` (payload `{ scanId }`) handled in `FaceRepairService.handleFaceRepairScan`,
which calls a new `runScan(scanId)`. `POST /admin/face-repair/scan` creates the scan row (single-flight) +
enqueues the job + returns `{ scanId }`; `GET /admin/face-repair/scan/latest` returns the persisted latest.
Reuses Slice-1 `FaceRepairScanRepository`, Slice-2 `classifyFlaggedPerson`, and the existing `buildRepairPlan`/
`summarizeRepairPlan`.

**Tech Stack:** NestJS, BullMQ jobs, Kysely, zod DTOs (`nestjs-zod`), Vitest (service unit + medium), OpenAPI regen.

**Spec:** [`2026-06-03-face-cleanup-console-design.md`](2026-06-03-face-cleanup-console-design.md) §S-A/§S-D + §Testing/Slice 3.

---

## File Structure

- Modify `server/src/enum.ts` — add `FaceRepairScan = 'FaceRepairScan'` to `JobName`.
- Modify `server/src/types.ts` — add `IFaceRepairScanJob` + register in the `Jobs` map and the `JobItem` union.
- Modify `server/src/repositories/face-repair.repository.ts` — add `countEligibleFaces(options)`.
- Modify `server/src/services/face-repair.service.ts` — add `runScan` + `@OnJob` `handleFaceRepairScan`, and an
  optional `onProgress` hook on `buildRepairPlan`.
- Modify `server/src/dtos/face-repair.dto.ts` — add scan-trigger + latest-scan DTOs.
- Modify `server/src/controllers/face-repair-admin.controller.ts` — add the two routes.
- Test: `server/src/services/face-repair.scan.spec.ts` (service unit, mocked repos) + extend
  `server/test/medium/specs/...` with a scan medium test.

---

## Task 1: Job wiring + `countEligibleFaces` + `onProgress` hook

**Files:** `server/src/enum.ts`, `server/src/types.ts`, `server/src/repositories/face-repair.repository.ts`,
`server/src/services/face-repair.service.ts`

- [ ] **Step 1: Add the JobName**

In `server/src/enum.ts`, inside `export enum JobName {`, add (keep alphabetical-ish near the other `Face*`/
person jobs):

```ts
  FaceRepairScan = 'FaceRepairScan',
```

- [ ] **Step 2: Type the job payload**

In `server/src/types.ts`:

- Add the interface near the other `I*Job` interfaces (e.g. by `ISharedSpacePersonDedupJob` ~line 274):

```ts
export interface IFaceRepairScanJob extends IBaseJob {
  scanId: string;
}
```

- Register it in the `Jobs` interface/map (find the object literal whose keys are `JobName.*` and values are
  the payload types — `JobOf<T> = Jobs[T]`). Add:

```ts
  [JobName.FaceRepairScan]: IFaceRepairScanJob;
```

- Register it in the `JobItem` union (~line 500, next to `{ name: JobName.SharedSpacePersonDedup; data: ... }`):

```ts
  | { name: JobName.FaceRepairScan; data: IFaceRepairScanJob }
```

> Verify the exact shape of the `Jobs` map by reading it — match its existing key style. `IBaseJob` is already
> imported/defined in `types.ts`.

- [ ] **Step 3: Add `countEligibleFaces` to the repository (TDD via the medium test in Task 4 — implement now, asserted later)**

In `server/src/repositories/face-repair.repository.ts`, add a method mirroring `streamEligibleFaces`'s
filters but returning a count:

```ts
  async countEligibleFaces(options: { ownerId?: string; personId?: string }): Promise<number> {
    const { count } = await this.db
      .selectFrom('asset_face')
      .innerJoin('asset', 'asset.id', 'asset_face.assetId')
      .innerJoin('face_search', 'face_search.faceId', 'asset_face.id')
      .select((eb) => eb.fn.countAll().as('count'))
      .where('asset_face.personId', 'is not', null)
      .where('asset_face.sourceType', '=', sql.lit(SourceType.MachineLearning))
      .where('asset_face.deletedAt', 'is', null)
      .where('asset_face.isVisible', '=', true)
      .where('asset.deletedAt', 'is', null)
      .$if(!!options.ownerId, (qb) => qb.where('asset.ownerId', '=', options.ownerId!))
      .$if(!!options.personId, (qb) => qb.where('asset_face.personId', '=', options.personId!))
      .executeTakeFirstOrThrow();
    return Number(count);
  }
```

> `sql` + `SourceType` are already imported in this file (used by `streamEligibleFaces`). Confirm and reuse.

- [ ] **Step 4: Add an optional `onProgress` hook to `buildRepairPlan`**

In `face-repair.service.ts`, extend `buildRepairPlan`'s options with `onProgress?: (scanned: number) => Promise<void> | void`,
and call it inside the `for await (const candidate of this.findReattributionCandidates(options))` loop after
incrementing a local `scanned` counter:

```ts
let scanned = 0;
for await (const candidate of this.findReattributionCandidates(options)) {
  // ... existing body ...
  scanned++;
  await options.onProgress?.(scanned);
}
```

This is additive and optional — existing `runRepair` callers pass no `onProgress`, so behavior is unchanged.

- [ ] **Step 5: Verify compile + existing tests still pass**

Run: `cd server && npx tsc --noEmit` → exit 0.
Run: `cd server && npx vitest run src/utils/face-repair.spec.ts src/services/face-repair.summary.spec.ts` → green (no regressions).

- [ ] **Step 6: Commit**

```bash
git add server/src/enum.ts server/src/types.ts server/src/repositories/face-repair.repository.ts server/src/services/face-repair.service.ts
git commit -m "feat(server): wire FaceRepairScan job + eligible-face count + scan progress hook"
```

---

## Task 2: `runScan` + `handleFaceRepairScan` (service unit, TDD)

**Files:** `server/src/services/face-repair.service.ts`, Test: `server/src/services/face-repair.scan.spec.ts`

`runScan(scanId)` orchestration:

1. `updateScanProgress(scanId, { status: 'running', startedAt: new Date() })`.
2. Read the scan row (`getScanById`) for its `params`; if missing, use config defaults (same as `runRepair`).
3. `total = await faceRepairRepository.countEligibleFaces({ ownerId })`.
4. `const plan = await buildRepairPlan({ ...planOptions, onProgress: throttle(scanId, total) })` where the
   throttle writes `updateScanProgress(scanId, { progress: { scanned, total } })` every 200 candidates (and is
   harmless if `total` is small).
5. `reviewOnlyPersonIds = new Set(plan.reviewOnlyPersonIds)`.
6. Build per-person suspected-owner ids by grouping `[...plan.toRepair, ...plan.reviewOnlyFaces]` by
   `currentPersonId`. For each `plan.perPerson` with `flagged > 0`, make
   `{ personId, eligible, flagged, flaggedFraction, suspectedOwnerIds }`.
7. `const enriched = await faceRepairScanRepository.enrichReportPersons(rows)`.
8. For each enriched person, `const c = classifyFlaggedPerson({ personName: p.personName, faceCount: p.faceCount, suspectedOwnerIds: p.suspectedOwners.map(o => o.ownerPersonId) }, { reviewOnlyPersonIds, largeClusterThreshold })`; set `p.recommendation = c.recommendation; p.reviewReasons = c.reviewReasons`.
9. `const totals = summarizeRepairPlan(plan).totals`.
10. `await faceRepairScanRepository.completeScan(scanId, { totals, persons: enriched })`.
11. `await faceRepairScanRepository.pruneSupersededScans()`.

Wrap 2-11 in try/catch → on error `await faceRepairScanRepository.failScan(scanId, String(error))` and rethrow
so the job is marked failed.

`handleFaceRepairScan`:

```ts
  @OnJob({ name: JobName.FaceRepairScan, queue: QueueName.BackgroundTask })
  async handleFaceRepairScan({ scanId }: JobOf<JobName.FaceRepairScan>): Promise<JobStatus> {
    await this.runScan(scanId);
    return JobStatus.Success;
  }
```

> Verify `QueueName.BackgroundTask` exists (read `enum.ts` `QueueName`); if the closest non-FacialRecognition
> background queue has a different name, use that. The scan must NOT run on `QueueName.FacialRecognition` (it
> would block recognition). `JobStatus`/`QueueName`/`JobOf`/`@OnJob` import the same way `handleFaceIdentityBackfill`/
> other handlers in this codebase do — copy a sibling handler's imports.

- [ ] **Step 1: Write the failing service unit tests**

`server/src/services/face-repair.scan.spec.ts` — use the project's `newTestService` factory (copy the setup
from an existing `*.service.spec.ts`, e.g. `face-repair` has none yet, so mirror `shared-space.service.spec.ts`
or another service spec that uses `newTestService(FaceRepairService)`). Mock `faceRepairScanRepository` +
`faceRepairRepository` + `searchRepository` + `jobRepository`. Cases:

```ts
it('runScan: marks running, builds+classifies+enriches, persists completed, prunes', async () => {
  // arrange mocks: getScanById → row with params; countEligibleFaces → 5;
  // findReattributionCandidates path: stub buildRepairPlan inputs so plan has one flagged person P → owner Q
  // enrichReportPersons → [{personId:P, personName:'Jula', faceCount:10, suspectedOwners:[{ownerPersonId:Q,...}], ...}]
  await sut.runScan('scan-1');
  expect(mocks.faceRepairScan.updateScanProgress).toHaveBeenCalledWith(
    'scan-1',
    expect.objectContaining({ status: 'running' }),
  );
  expect(mocks.faceRepairScan.completeScan).toHaveBeenCalledWith(
    'scan-1',
    expect.objectContaining({
      totals: expect.any(Object),
      persons: expect.arrayContaining([
        expect.objectContaining({ personId: 'P', recommendation: 'review-first', reviewReasons: ['named'] }),
      ]),
    }),
  );
  expect(mocks.faceRepairScan.pruneSupersededScans).toHaveBeenCalled();
});

it('runScan: reports progress at least once during the stream', async () => {
  // countEligibleFaces → small; with onProgress firing, assert updateScanProgress called with a progress payload
  await sut.runScan('scan-1');
  expect(mocks.faceRepairScan.updateScanProgress).toHaveBeenCalledWith(
    'scan-1',
    expect.objectContaining({ progress: expect.objectContaining({ total: expect.any(Number) }) }),
  );
});

it('runScan: failure marks the scan failed and rethrows', async () => {
  mocks.faceRepairScan.completeScan.mockRejectedValue(new Error('boom'));
  await expect(sut.runScan('scan-1')).rejects.toThrow('boom');
  expect(mocks.faceRepairScan.failScan).toHaveBeenCalledWith('scan-1', expect.stringContaining('boom'));
});
```

> The exact mocking of `buildRepairPlan`'s internals (it calls `searchRepository.searchFaces` + streams
> `faceRepairRepository.streamEligibleFaces`) is fiddly to stub. SIMPLER: stub at the `buildRepairPlan` boundary
> — `vi.spyOn(sut, 'buildRepairPlan').mockResolvedValue(<a fixed RepairPlan>)` and
> `vi.spyOn(sut, 'findReattributionCandidates')` is not needed. For the progress test, since a stubbed
> `buildRepairPlan` won't call `onProgress`, instead make that ONE test NOT stub `buildRepairPlan` but stub the
> repositories so the real `buildRepairPlan` streams a couple of fake candidates and fires `onProgress`. Pick
> whichever stubbing the harness makes cleanest; the assertions above are the contract. If stubbing proves too
> brittle in unit form, move the progress + completed assertions to the Task-4 MEDIUM test (real DB) and keep
> only the failure-path test as a unit test — note which you chose.

- [ ] **Step 2-4: red → implement `runScan` + `handleFaceRepairScan` → green**

Run: `cd server && npx vitest run src/services/face-repair.scan.spec.ts` (red first, then green).

- [ ] **Step 5: tsc + lint, then commit**

Run: `cd .. && make check-server && make lint-server`.

```bash
git add server/src/services/face-repair.service.ts server/src/services/face-repair.scan.spec.ts
git commit -m "feat(server): FaceRepairScan handler runs plan, classifies, enriches, persists"
```

---

## Task 3: Endpoints + DTOs + refusal guards

**Files:** `server/src/dtos/face-repair.dto.ts`, `server/src/controllers/face-repair-admin.controller.ts`,
`server/src/services/face-repair.service.ts`

- [ ] **Step 1: Add DTOs** to `face-repair.dto.ts` (mirror the existing `createZodDto` + `.meta({ id })` style):

```ts
export const FaceRepairScanTriggerResponseSchema = z
  .object({ scanId: z.string() })
  .meta({ id: 'FaceRepairScanTriggerResponseDto' });
export class FaceRepairScanTriggerResponseDto extends createZodDto(FaceRepairScanTriggerResponseSchema) {}

const ScanSuspectedOwnerSchema = z.object({
  ownerPersonId: z.string(),
  ownerName: z.string().nullable(),
  thumbnailFaceId: z.string().nullable(),
  count: z.number(),
});
const ScanPersonSchema = z.object({
  personId: z.string(),
  ownerId: z.string(),
  personName: z.string().nullable(),
  faceCount: z.number(),
  thumbnailFaceId: z.string().nullable(),
  eligible: z.number(),
  flagged: z.number(),
  flaggedFraction: z.number(),
  suspectedOwners: z.array(ScanSuspectedOwnerSchema),
  recommendation: z.enum(['confident', 'review-first']),
  reviewReasons: z.array(z.string()),
});
export const FaceRepairScanStatusSchema = z
  .object({
    id: z.string(),
    status: z.enum(['pending', 'running', 'completed', 'failed']),
    progress: z.object({ scanned: z.number(), total: z.number() }).nullable(),
    totals: z
      .object({
        /* mirror RepairReport.totals */ eligibleFaces: z.number(),
        flaggedFaces: z.number(),
        toRepair: z.number(),
        reviewOnlyFaces: z.number(),
        reviewOnlyPersons: z.number(),
        affectedPersons: z.number(),
        reviewOnlyByReason: z.object({ overCap: z.number(), badTarget: z.number(), unAttributable: z.number() }),
      })
      .nullable(),
    persons: z.array(ScanPersonSchema),
    error: z.string().nullable(),
    startedAt: z.date().nullable(),
    finishedAt: z.date().nullable(),
    createdAt: z.date(),
  })
  .meta({ id: 'FaceRepairScanStatusDto' });
export class FaceRepairScanStatusDto extends createZodDto(FaceRepairScanStatusSchema) {}
```

> `GET latest` may return "no scan yet" — return `null`/`204`. Simplest: type the route as
> `Promise<FaceRepairScanStatusDto | null>` and return `null` when `getLatestScan()` is undefined. Confirm how
> other nullable-GET routes in this codebase express that (some use `200` + nullable body). Match the local idiom.

- [ ] **Step 2: Add service methods** `triggerScan(auth)` + `getLatestScanStatus()`:

```ts
  async triggerScan(requestedBy: string): Promise<{ scanId: string }> {
    if (await this.jobRepository.isActive(QueueName.FacialRecognition)) {
      throw new BadRequestException('Refusing to scan while facial recognition is active');
    }
    const { machineLearning } = await this.getConfig({ withCache: true });
    const params = { /* same defaults as runRepair, + largeClusterThreshold: DEFAULT_LARGE_CLUSTER_THRESHOLD */ };
    let scan;
    try {
      scan = await this.faceRepairScanRepository.createScan({ requestedBy, params });
    } catch {
      throw new ConflictException('A face-repair scan is already in progress');
    }
    await this.jobRepository.queue({ name: JobName.FaceRepairScan, data: { scanId: scan.id } });
    return { scanId: scan.id };
  }

  async getLatestScanStatus(): Promise<RepairScanRow | null> {
    return (await this.faceRepairScanRepository.getLatestScan()) ?? null;
  }
```

Add `const DEFAULT_LARGE_CLUSTER_THRESHOLD = 50;` near the other DEFAULT\_\* consts. Use the project's Nest
exception classes (`ConflictException` → 409, `BadRequestException` → 400; check whether the codebase prefers a
409 for the recognition-active case — `runRepair` currently throws a plain `Error`; for the console use
`ConflictException` (409) for both "scan running" and "recognition active" so the web can handle one status).
Reconcile to ONE status (409) for both refusals and assert it in tests.

- [ ] **Step 3: Add controller routes** to `face-repair-admin.controller.ts`:

```ts
  @Post('scan')
  @Authenticated({ admin: true })
  @Endpoint({ summary: 'Trigger a face-repair scan', history: new HistoryBuilder().added('v1') })
  triggerScan(@Auth() auth: AuthDto): Promise<FaceRepairScanTriggerResponseDto> {
    return this.service.triggerScan(auth.user.id) as Promise<FaceRepairScanTriggerResponseDto>;
  }

  @Get('scan/latest')
  @Authenticated({ admin: true })
  @Endpoint({ summary: 'Get the latest face-repair scan', history: new HistoryBuilder().added('v1') })
  getLatestScan(): Promise<FaceRepairScanStatusDto | null> {
    return this.service.getLatestScanStatus() as Promise<FaceRepairScanStatusDto | null>;
  }
```

> Import `Get`, `Auth`, `AuthDto` as the codebase does elsewhere (grep a controller that uses `@Auth()`).

- [ ] **Step 4: tsc + lint, commit**

```bash
git add server/src/dtos/face-repair.dto.ts server/src/controllers/face-repair-admin.controller.ts server/src/services/face-repair.service.ts
git commit -m "feat(server): admin endpoints to trigger + read face-repair scans"
```

---

## Task 4: OpenAPI regen + medium test + refusal/guard tests

**Files:** OpenAPI artifacts, `server/test/medium/specs/...`

- [ ] **Step 1: Regenerate OpenAPI + SDK**

Run: `cd server && pnpm build && pnpm sync:open-api` then `cd .. && make open-api`. Commit the regenerated
`open-api/` + SDK artifacts.

- [ ] **Step 2: Medium test — the job persists a real scan**

Create/extend a medium spec that: seeds a couple of people with ML faces (reuse the person/face fixture pattern
from `face-repair-scan.repository.spec.ts` Task 6 of Slice 1), runs `handleFaceRepairScan({ scanId })` via the
medium service, and asserts the persisted scan is `completed` with `totals` + classified `persons`. Also:

- clean instance (no flagged faces) → scan completes with an empty report (persons `[]`, zeroed totals), not failed.
- `getLatestScan()` with no scan → `null`/undefined.

- [ ] **Step 3: Refusal + admin-guard tests** (service unit, extend `face-repair.scan.spec.ts`):
- `triggerScan` throws 409 when `jobRepository.isActive(FacialRecognition)` is true (nothing enqueued).
- `triggerScan` throws 409 when `createScan` rejects (scan already running).
- happy path enqueues exactly one `FaceRepairScan` job and returns `{ scanId }`.
- (Admin guard 403 is enforced by `@Authenticated({ admin: true })`; if the codebase has controller-level auth
  tests, add scan/latest there; otherwise the decorator is the guarantee — note it.)

- [ ] **Step 4: Full check, commit**

Run: `cd .. && make check-server && make lint-server && make sql` (discard unrelated `server/src/queries`
noise; confirm no `face_repair`-unexpected diff). Run the new medium + unit specs green.

```bash
git add -A
git commit -m "test(server): FaceRepairScan medium + refusal coverage; regenerate OpenAPI"
```

---

## Self-Review

- **Spec coverage (Slice 3):** job runs plan→classify→enrich→persist→completed (T2/T4) ✓; progress advances
  (T2, or T4 medium if unit stubbing too brittle — implementer notes which) ✓; `POST scan` returns scanId +
  enqueues one job (T4) ✓; refusal 409 scan-running + recognition-active (T4) ✓; handler error → failed (T2) ✓;
  clean instance → empty report (T4) ✓; `getLatest` none → null (T4) ✓; admin guard on both routes (decorator;
  T4 note) ✓; OpenAPI regen (T4) ✓.
- **Placeholders:** none material — the only "verify against codebase" notes are for exact `types.ts` map keys,
  `QueueName` name, `@Auth()` imports, and the nullable-GET idiom; each says exactly what to check and where.
- **Carry-forward:** Slice 4 adds `approvedPersonIds`/`excludeFaceIds` apply + `POST scan/apply`; Slice 5 web
  list consumes `GET scan/latest` + `POST scan`.
