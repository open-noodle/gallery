# Face re-attribution repair — Slices 5 + 6 (Report + Orchestration) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.
> Strict TDD: failing test first, RUN it (capture red), minimal impl, RUN green. Report red+green output.
> Build on Slices 1–4 (`buildRepairPlan`, `RepairPlan`, `executeRepair`). Do NOT implement Slice 7 (the HTTP
> endpoint/DTO) or Slice 8 (the drive-recognition e2e).

**Goal:** (5) Summarize a `RepairPlan` into a human-readable `RepairReport`. (6) A single top-level
`runRepair(options)` that resolves params from config + defaults, builds the plan (optionally scoped), refuses to
mutate while facial recognition is active, executes only when `dryRun=false`, and always returns the report.

**Architecture:** A pure `summarizeRepairPlan(plan)` (unit-tested) + `FaceRepairService.runRepair(options)` that
ties detection→routing (Slice 3) → execution (Slice 4) → report (Slice 5), reading recognition config via
`this.getConfig()` and guarding on `jobRepository.isActive(QueueName.FacialRecognition)`.

**Read first:** `src/services/face-repair.service.ts` (`buildRepairPlan`, `RepairPlan`, `executeRepair`,
`FlaggedFace`), `src/repositories/job.repository.ts:140` (`isActive`), `src/enum.ts`
(`QueueName.FacialRecognition`), and how a `BaseService` method calls `this.getConfig({ withCache: true })` and
reads `config.machineLearning.facialRecognition.{maxDistance,minFaces}` (see `person.service.ts:920,959`).

---

### Task 1 (Slice 5): `summarizeRepairPlan` (pure)

**Files:** Modify `server/src/services/face-repair.service.ts` (add types + function — function can be a top-level
export, not a method, so it is unit-testable without the service); Create
`server/src/services/face-repair.summary.spec.ts` (unit) — OR colocate in an existing unit spec. Prefer a new unit
spec file.

- [ ] **Step 1: Write the failing unit test** (`face-repair.summary.spec.ts`):

```typescript
import { RepairPlan } from 'src/services/face-repair.service';
import { summarizeRepairPlan } from 'src/services/face-repair.summary';

const plan: RepairPlan = {
  toRepair: [
    { assetFaceId: 'f1', currentPersonId: 'A', suspectedOwnerId: 'K' },
    { assetFaceId: 'f2', currentPersonId: 'A', suspectedOwnerId: 'K' },
  ],
  reviewOnlyFaces: [{ assetFaceId: 'f3', currentPersonId: 'D', suspectedOwnerId: 'X', reason: 'over-cap' }],
  reviewOnlyPersonIds: ['D'],
  perPerson: [
    { personId: 'A', eligible: 10, flagged: 2, flaggedFraction: 0.2 },
    { personId: 'D', eligible: 4, flagged: 1, flaggedFraction: 0.25 },
    { personId: 'K', eligible: 50, flagged: 0, flaggedFraction: 0 },
  ],
};

describe('summarizeRepairPlan', () => {
  it('aggregates totals across the plan', () => {
    const r = summarizeRepairPlan(plan);
    expect(r.totals).toEqual({
      eligibleFaces: 64,
      flaggedFaces: 3,
      toRepair: 2,
      reviewOnlyFaces: 1,
      reviewOnlyPersons: 1,
      affectedPersons: 2,
    });
  });

  it('reports per-person suspected owners and review-only flag, only for persons with flagged faces', () => {
    const r = summarizeRepairPlan(plan);
    const ids = r.persons.map((p) => p.personId).sort();
    expect(ids).toEqual(['A', 'D']); // K has 0 flagged -> omitted
    const a = r.persons.find((p) => p.personId === 'A')!;
    expect(a.reviewOnly).toBe(false);
    expect(a.suspectedOwners).toEqual([{ ownerPersonId: 'K', count: 2 }]);
    const d = r.persons.find((p) => p.personId === 'D')!;
    expect(d.reviewOnly).toBe(true);
    expect(d.suspectedOwners).toEqual([{ ownerPersonId: 'X', count: 1 }]);
  });
});
```

- [ ] **Step 2: Run, confirm red** — `cd server && pnpm test -- --run src/services/face-repair.summary.spec.ts` → FAIL (module/function missing).

- [ ] **Step 3: Implement** `server/src/services/face-repair.summary.ts`:

```typescript
import { FlaggedFace, RepairPlan, ReviewOnlyReason } from 'src/services/face-repair.service';

export interface SuspectedOwnerCount {
  ownerPersonId: string;
  count: number;
}

export interface RepairReportPerson {
  personId: string;
  eligible: number;
  flagged: number;
  flaggedFraction: number;
  reviewOnly: boolean;
  suspectedOwners: SuspectedOwnerCount[];
}

export interface RepairReport {
  totals: {
    eligibleFaces: number;
    flaggedFaces: number;
    toRepair: number;
    reviewOnlyFaces: number;
    reviewOnlyPersons: number;
    affectedPersons: number;
  };
  persons: RepairReportPerson[];
}

export const summarizeRepairPlan = (plan: RepairPlan): RepairReport => {
  const reviewOnlyPersons = new Set(plan.reviewOnlyPersonIds);
  const allFlagged: FlaggedFace[] = [...plan.toRepair, ...plan.reviewOnlyFaces];

  const ownersByPerson = new Map<string, Map<string, number>>();
  for (const face of allFlagged) {
    const owners = ownersByPerson.get(face.currentPersonId) ?? new Map<string, number>();
    owners.set(face.suspectedOwnerId, (owners.get(face.suspectedOwnerId) ?? 0) + 1);
    ownersByPerson.set(face.currentPersonId, owners);
  }

  const persons: RepairReportPerson[] = plan.perPerson
    .filter((p) => p.flagged > 0)
    .map((p) => ({
      personId: p.personId,
      eligible: p.eligible,
      flagged: p.flagged,
      flaggedFraction: p.flaggedFraction,
      reviewOnly: reviewOnlyPersons.has(p.personId),
      suspectedOwners: [...(ownersByPerson.get(p.personId) ?? new Map<string, number>())].map(
        ([ownerPersonId, count]) => ({ ownerPersonId, count }),
      ),
    }));

  return {
    totals: {
      eligibleFaces: plan.perPerson.reduce((sum, p) => sum + p.eligible, 0),
      flaggedFaces: allFlagged.length,
      toRepair: plan.toRepair.length,
      reviewOnlyFaces: plan.reviewOnlyFaces.length,
      reviewOnlyPersons: plan.reviewOnlyPersonIds.length,
      affectedPersons: persons.length,
    },
    persons,
  };
};
```

(`ReviewOnlyReason`/`RepairPlan`/`FlaggedFace` are exported from `face-repair.service.ts` — export them if not
already. Avoid a circular import by keeping `summarizeRepairPlan` in its own file importing types only.)

- [ ] **Step 4: Run, confirm green** — same command → PASS.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(server): summarize face re-attribution repair plan"`

---

### Task 2 (Slice 6): `runRepair` orchestration

**Files:** Modify `server/src/services/face-repair.service.ts`; Modify
`server/test/medium/specs/services/face-repair.service.spec.ts`.

- [ ] **Step 1: Write the failing medium tests.** Reuse the executeRepair suite's isolated-DB + identity-linked
      setup. Mock `JobRepository` (control `isActive`). Scenarios:
  - **dry-run (default):** `runRepair({ ownerId })` (no `dryRun`) → returns `{ dryRun: true, mutated: false }`,
    `report.totals.flaggedFaces > 0`, and **nothing is mutated** (leaked faces still have their original
    `personId`; `jobRepository.queueAll` NOT called).
  - **execute:** `runRepair({ ownerId, dryRun: false })` with `isActive` mocked → `false` → returns
    `{ dryRun: false, mutated: true }`, leaked faces now `personId = NULL`, `queueAll` called.
  - **concurrency guard:** `isActive` mocked → `true`, `runRepair({ ownerId, dryRun: false })` → **throws** (and
    nothing mutated). `dryRun: true` with `isActive` true → still succeeds (read-only).
  - **scope:** two owners each with a leak; `runRepair({ ownerId: ownerA, dryRun: false })` mutates only ownerA's
    faces; ownerB's remain assigned.
  - **idempotency:** after a real `runRepair({ ownerId, dryRun: false })`, a second `runRepair({ ownerId })` (dry)
    reports `flaggedFaces === 0` (the unassigned faces are no longer eligible; genuine faces are not flagged).

- [ ] **Step 2: Run, confirm red** — `cd server && pnpm test:medium run test/medium/specs/services/face-repair.service.spec.ts` → FAIL (`runRepair` not a function).

- [ ] **Step 3: Implement** (add to `FaceRepairService`; import `QueueName, JobName` from `src/enum`,
      `summarizeRepairPlan`/`RepairReport` from `./face-repair.summary`):

```typescript
const DEFAULT_VOTE_WINDOW = 50;
const DEFAULT_VOTE_MARGIN = 2;
const DEFAULT_MAX_ATTRIBUTION_DISTANCE = 0.35;
const DEFAULT_MAX_FLAGGED_FRACTION = 0.5;

export interface RunRepairOptions {
  dryRun?: boolean;
  ownerId?: string;
  personId?: string;
  maxDistance?: number;
  minFaces?: number;
  voteWindow?: number;
  voteMargin?: number;
  maxAttributionDistance?: number;
  maxFlaggedFraction?: number;
}

export interface RunRepairResult {
  dryRun: boolean;
  mutated: boolean;
  report: RepairReport;
  executed?: { unassigned: number; requeued: number };
}

// in the class:
async runRepair(options: RunRepairOptions = {}): Promise<RunRepairResult> {
  const { machineLearning } = await this.getConfig({ withCache: true });
  const recognition = machineLearning.facialRecognition;
  const dryRun = options.dryRun ?? true;

  const planOptions = {
    ownerId: options.ownerId,
    personId: options.personId,
    maxDistance: options.maxDistance ?? recognition.maxDistance,
    minFaces: options.minFaces ?? recognition.minFaces,
    voteWindow: options.voteWindow ?? DEFAULT_VOTE_WINDOW,
    voteMargin: options.voteMargin ?? DEFAULT_VOTE_MARGIN,
    maxAttributionDistance: options.maxAttributionDistance ?? DEFAULT_MAX_ATTRIBUTION_DISTANCE,
    maxFlaggedFraction: options.maxFlaggedFraction ?? DEFAULT_MAX_FLAGGED_FRACTION,
  };

  const plan = await this.buildRepairPlan(planOptions);

  let executed: { unassigned: number; requeued: number } | undefined;
  if (!dryRun) {
    if (await this.jobRepository.isActive(QueueName.FacialRecognition)) {
      throw new Error('Refusing to run face re-attribution repair while facial recognition is active');
    }
    executed = await this.executeRepair(plan);
  }

  return { dryRun, mutated: !dryRun, report: summarizeRepairPlan(plan), executed };
}
```

(Confirm `recognition.maxDistance`/`minFaces` exist on the config type; if names differ, use the actual ones.
Confirm `QueueName.FacialRecognition` is the queue recognition runs on. If `BaseService` doesn't expose a clean
error type, a plain `Error`/`BadRequestException` is fine — match how other services throw.)

- [ ] **Step 4: Run, confirm green** — same command → PASS.
- [ ] **Step 5: Validate + commit** — `cd server && pnpm exec prettier --write <changed> && pnpm exec eslint <changed> --max-warnings 0 && pnpm exec tsc --noEmit`; `git add -A && git commit -m "feat(server): orchestrate face re-attribution repair (dry-run, scope, guard)"`.

---

## Self-review

- Matrix rows: report shape + totals + per-person suspected owners ✓ (T1); dryRun mutates nothing ✓ (T2); scope
  restricts ✓ (T2); concurrency guard refuses when queue active ✓ (T2); idempotency ✓ (T2). Empty owner → empty
  report falls out of `summarizeRepairPlan` on an empty plan (add a tiny assertion if cheap). "Chunk boundary" — the
  detector streams all eligible faces in one pass via `streamEligibleFaces` (no pagination boundary to drop), so it
  is covered by the single-pass design; note this in the PR rather than a contrived test. No HTTP/DTO (Slice 7), no
  drive-recognition (Slice 8). Types consistent (`RepairPlan`, `RepairReport`, `FlaggedFace`). No placeholders.
