# Face Cleanup Console — Slice 4 (batch apply) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use
> checkbox (`- [ ]`) syntax. TDD: failing test → red → implement → green → commit.

**Goal:** Apply re-attribution for an admin-approved set of persons — exempt them from the over-cap + bad-target
gates, scope the plan to just those persons, drop any per-face deselects, and re-home their flagged faces via
the existing `executeRepair`.

**Architecture:** Extend `buildRepairPlan` with `approvedPersonIds` (routing) + `personIds` (scoping), extend
`streamEligibleFaces` with `personIds`, add `FaceRepairService.applyRepair({ approvedPersonIds, excludeFaceIds })`,
and a `POST /admin/face-repair/apply` admin route. Reuses `executeRepair` verbatim.

**Tech Stack:** NestJS, Kysely, zod DTOs, Vitest (service unit + medium), OpenAPI regen.

**Spec:** [`2026-06-03-face-cleanup-console-design.md`](2026-06-03-face-cleanup-console-design.md) §S-C/§S-D + §Testing/Slice 4.

---

## File Structure

- Modify `server/src/repositories/face-repair.repository.ts` — `streamEligibleFaces` gains `personIds?: string[]`.
- Modify `server/src/services/face-repair.service.ts` — `buildRepairPlan` gains `personIds?`/`approvedPersonIds?`;
  add `applyRepair`.
- Modify `server/src/dtos/face-repair.dto.ts` — add the apply request/response DTOs.
- Modify `server/src/controllers/face-repair-admin.controller.ts` — add `POST scan/apply`... (route `apply`).
- Test: extend `server/src/services/face-repair.scan.spec.ts` (or a new `face-repair.apply.spec.ts`) +
  `server/test/medium/specs/services/face-repair.scan.spec.ts` (or a new apply medium spec).

---

## Task 1: Plan routing + scoping + `applyRepair` (unit, TDD)

**Files:** `face-repair.repository.ts`, `face-repair.service.ts`, Test: `server/src/services/face-repair.apply.spec.ts`

- [ ] **Step 1: Scope `streamEligibleFaces` to a person-id set**

In `face-repair.repository.ts`, add `personIds?: string[]` to `streamEligibleFaces`'s options type and:

```ts
      .$if(!!options.personIds && options.personIds.length > 0, (qb) =>
        qb.where('asset_face.personId', 'in', options.personIds!),
      )
```

(keep the existing single `personId` filter; the two are independent and both optional).

- [ ] **Step 2: Add `approvedPersonIds` routing + `personIds` passthrough to `buildRepairPlan`**

Extend `buildRepairPlan`'s options with `personIds?: string[]` and `approvedPersonIds?: string[]`. Thread
`personIds` into `findReattributionCandidates` → `streamEligibleFaces` (it already passes `options` through).
Replace the toRepair/reviewOnly routing loop with (approved persons are exempt from BOTH gates):

```ts
const approved = new Set(options.approvedPersonIds ?? []);
const toRepair: FlaggedFace[] = [];
const reviewOnlyFaces: (FlaggedFace & { reason: ReviewOnlyReason })[] = [];
for (const [personId, faces] of flaggedByPerson) {
  if (approved.has(personId)) {
    for (const face of faces) {
      toRepair.push(face); // approved: exempt from over-cap AND bad-target
    }
    continue;
  }
  if (reviewOnlyPersonIds.has(personId)) {
    for (const face of faces) {
      reviewOnlyFaces.push({ ...face, reason: 'over-cap' });
    }
    continue;
  }
  for (const face of faces) {
    if (reviewOnlyPersonIds.has(face.suspectedOwnerId)) {
      reviewOnlyFaces.push({ ...face, reason: 'bad-target' });
    } else {
      toRepair.push(face);
    }
  }
}
```

`reviewOnlyPersonIds` is still computed normally (unchanged) so non-approved persons' bad-target checks and the
report classification are unaffected.

- [ ] **Step 3: Add `applyRepair`**

```ts
  async applyRepair(input: { approvedPersonIds: string[]; excludeFaceIds?: string[] }): Promise<{ unassigned: number; requeued: number }> {
    if (input.approvedPersonIds.length === 0) {
      return { unassigned: 0, requeued: 0 };
    }
    if (await this.jobRepository.isActive(QueueName.FacialRecognition)) {
      throw new ConflictException('Refusing to apply while facial recognition is active');
    }
    const latest = await this.faceRepairScanRepository.getLatestScan();
    if (latest && (latest.status === 'pending' || latest.status === 'running')) {
      throw new ConflictException('Refusing to apply while a scan is in progress');
    }
    const { machineLearning } = await this.getConfig({ withCache: true });
    const recognition = machineLearning.facialRecognition;
    const plan = await this.buildRepairPlan({
      maxDistance: recognition.maxDistance,
      minFaces: recognition.minFaces,
      voteWindow: DEFAULT_VOTE_WINDOW,
      voteMargin: DEFAULT_VOTE_MARGIN,
      maxAttributionDistance: DEFAULT_MAX_ATTRIBUTION_DISTANCE,
      maxFlaggedFraction: DEFAULT_MAX_FLAGGED_FRACTION,
      personIds: input.approvedPersonIds,
      approvedPersonIds: input.approvedPersonIds,
    });
    const exclude = new Set(input.excludeFaceIds ?? []);
    const scopedPlan = { ...plan, toRepair: plan.toRepair.filter((face) => !exclude.has(face.assetFaceId)) };
    return this.executeRepair(scopedPlan);
  }
```

> Use the same `DEFAULT_*` consts `runRepair` uses (they're already in this file). `ConflictException` is
> imported (Slice 3 added it).

- [ ] **Step 4: Write the failing unit tests** (`face-repair.apply.spec.ts`, `newTestService(FaceRepairService)` like the scan spec)

```ts
it('empty approvedPersonIds → no-op, no plan built', async () => {
  const r = await sut.applyRepair({ approvedPersonIds: [] });
  expect(r).toEqual({ unassigned: 0, requeued: 0 });
  expect(mocks.job.isActive).not.toHaveBeenCalled();
});

it('refuses (409) while facial recognition is active — nothing mutated', async () => {
  mocks.job.isActive.mockResolvedValue(true);
  await expect(sut.applyRepair({ approvedPersonIds: ['p1'] })).rejects.toThrow(ConflictException);
});

it('refuses (409) while a scan is running', async () => {
  mocks.job.isActive.mockResolvedValue(false);
  mocks.faceRepairScan.getLatestScan.mockResolvedValue({ status: 'running' } as any);
  await expect(sut.applyRepair({ approvedPersonIds: ['p1'] })).rejects.toThrow(ConflictException);
});

it('drops excludeFaceIds from toRepair before executeRepair', async () => {
  mocks.job.isActive.mockResolvedValue(false);
  mocks.faceRepairScan.getLatestScan.mockResolvedValue({ status: 'completed' } as any);
  vi.spyOn(sut, 'buildRepairPlan').mockResolvedValue({
    toRepair: [
      { assetFaceId: 'f1', currentPersonId: 'p1', suspectedOwnerId: 'q' },
      { assetFaceId: 'f2', currentPersonId: 'p1', suspectedOwnerId: 'q' },
    ],
    reviewOnlyFaces: [],
    reviewOnlyPersonIds: [],
    unAttributableFaces: [],
    perPerson: [],
  } as any);
  const execSpy = vi.spyOn(sut, 'executeRepair').mockResolvedValue({ unassigned: 1, requeued: 1 });
  await sut.applyRepair({ approvedPersonIds: ['p1'], excludeFaceIds: ['f2'] });
  expect(execSpy).toHaveBeenCalledWith(
    expect.objectContaining({ toRepair: [expect.objectContaining({ assetFaceId: 'f1' })] }),
  );
});
```

> Mirror the `face-repair.scan.spec.ts` harness setup (`newTestService`, `mocks.job`, `mocks.faceRepairScan`).
> Import `ConflictException` from `@nestjs/common` and `vi` from vitest.

- [ ] **Step 5: red → implement → green; check + lint; commit**

Run: `cd server && npx vitest run src/services/face-repair.apply.spec.ts` (red then green).
Run: `cd .. && make check-server && make lint-server`.

```bash
git add server/src/repositories/face-repair.repository.ts server/src/services/face-repair.service.ts server/src/services/face-repair.apply.spec.ts
git commit -m "feat(server): apply re-attribution for approved persons (scoped, bad-target lifted, deselects)"
```

---

## Task 2: Apply endpoint + DTO + OpenAPI

**Files:** `face-repair.dto.ts`, `face-repair-admin.controller.ts`, OpenAPI artifacts

- [ ] **Step 1: DTOs** in `face-repair.dto.ts`:

```ts
export const FaceRepairApplyRequestSchema = z
  .object({ approvedPersonIds: z.array(z.uuidv4()).min(1), excludeFaceIds: z.array(z.uuidv4()).optional() })
  .meta({ id: 'FaceRepairApplyRequestDto' });
export class FaceRepairApplyRequestDto extends createZodDto(FaceRepairApplyRequestSchema) {}

export const FaceRepairApplyResponseSchema = z
  .object({ unassigned: z.number(), requeued: z.number() })
  .meta({ id: 'FaceRepairApplyResponseDto' });
export class FaceRepairApplyResponseDto extends createZodDto(FaceRepairApplyResponseSchema) {}
```

> Match the existing `z.uuidv4()` usage already in this file (the existing request schema uses it).

- [ ] **Step 2: Route** in `face-repair-admin.controller.ts`:

```ts
  @Post('apply')
  @Authenticated({ admin: true })
  @Endpoint({ summary: 'Apply face re-attribution for approved persons', history: new HistoryBuilder().added('v1') })
  applyFaceRepair(@Body() dto: FaceRepairApplyRequestDto): Promise<FaceRepairApplyResponseDto> {
    return this.service.applyRepair(dto) as Promise<FaceRepairApplyResponseDto>;
  }
```

- [ ] **Step 3: Regenerate OpenAPI + SDK**

Run: `cd server && pnpm build && pnpm sync:open-api && cd .. && make open-api`. Commit the regenerated
`open-api/` + SDK (+ Dart) artifacts.

- [ ] **Step 4: check + lint, commit**

```bash
git add server/src/dtos/face-repair.dto.ts server/src/controllers/face-repair-admin.controller.ts open-api mobile/openapi
git commit -m "feat(server): POST /admin/face-repair/apply + regenerate OpenAPI"
```

---

## Task 3: Medium coverage (real DB, TDD)

**Files:** Test: `server/test/medium/specs/services/face-repair.apply.spec.ts` (or extend the scan medium spec)

Reuse the medium fixture pattern that seeds people with ML faces + embeddings (the Slice-3 medium scan test
already does a flagged-person setup — copy that fixture so the detector flags person P's faces toward owner Q).

- [ ] **Step 1: Write the failing medium tests**

Cases:

- **approve subset re-homes only approved; unapproved untouched:** two over-cap persons P1, P2 (both >50%
  flagged toward clean owners). `applyRepair({ approvedPersonIds: [P1.id] })` → P1's flagged faces become
  `personId = null` (assert via a query) and are re-queued (assert `jobRepository` got `FacialRecognition` jobs
  for them); **P2's faces are unchanged** (still assigned).
- **excludeFaceIds end-to-end:** approve P1, exclude one of its flagged faceIds → `unassigned === flaggedCount - 1`;
  the excluded face keeps its `personId`.
- **bad-target lifted on approval:** P1's suspected owner Q is itself over-cap and NOT approved →
  `applyRepair({ approvedPersonIds: [P1.id] })` still unassigns + re-queues P1's flagged faces; assert Q's own
  faces are NOT mutated by the apply (apply writes nothing to Q).
- **idempotent re-apply:** second `applyRepair({ approvedPersonIds: [P1.id] })` returns `unassigned: 0` (faces
  already moved — the write re-check skips them).
- **re-check at write:** before apply, manually move one of P1's flagged faces to another person; apply skips it
  (the count reflects the skip) — `unassignFacesFromPerson` only touches faces still on P1.

> If seeding embeddings that make the detector flag toward a SPECIFIC owner is too fiddly for every case, at
> minimum cover "approve subset re-homes only approved + unapproved untouched", "excludeFaceIds", and
> "idempotent re-apply" in medium; the bad-target + re-check cases can be unit tests against
> `buildRepairPlan`/`executeRepair` with controlled inputs if the embedding fixtures block you. Note what you
> covered where. Do not ship a test that asserts nothing.

- [ ] **Step 2: red → green; full check**

Run: `cd server && npx vitest --config test/vitest.config.medium.mjs run test/medium/specs/services/face-repair.apply.spec.ts` (red then green; container boot ~30-60s; retry once on transient).
Run: `cd .. && make check-server && make lint-server && make sql` (discard `server/src/queries` noise).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test(server): batch-apply medium coverage (scoped, excludeFaceIds, idempotent, bad-target)"
```

---

## Self-Review

- **Spec coverage (Slice 4):** approve subset re-homes only approved; unapproved stays reviewOnly (T3) ✓;
  excludeFaceIds drops faces (T1 unit + T3 medium) ✓; re-check at write (T3, or unit fallback) ✓; bad-target
  lifted on approval (T1 routing + T3) ✓; idempotent re-apply (T3) ✓; empty approvedPersonIds → no-op (T1) ✓;
  refusal 409 recognition-active OR scan-running (T1) ✓; admin guard (decorator; controller route) ✓.
- **Placeholders:** none material — the medium-fixture fallback note says exactly what to cover where.
- **Carry-forward:** Slice 5/6 (web) consume `POST /admin/face-repair/apply` with `approvedPersonIds`
  (bulk-approve from the list) and `+ excludeFaceIds` (per-face deselect from the review page).
