# Face re-attribution repair — Slice 8 (End-to-end) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.
> Strict TDD: write the failing test, RUN it (red), then it passes once the assertions are correct (this slice
> adds NO production code — it drives the already-built `runRepair` + real `handleRecognizeFaces`). If a test
> fails because of a real defect, STOP and report it (do not weaken the test). Build on Slices 1–7.

**Goal:** Prove the full loop end-to-end: a contaminated cluster, after `runRepair({ dryRun: false })` unassigns the
leaked faces and **real `PersonService.handleRecognizeFaces`** re-homes them, lands the leaked faces on their TRUE
owner, preserves names, leaves `getBackfillWork().hasPersonalIdentityWork === false` (no loop), and splits a
multi-owner contamination correctly.

**Architecture:** A new medium spec that stands up BOTH a `FaceRepairService` sut and a real `PersonService` sut
sharing one isolated DB (mirroring how `people-identity-rbac.spec.ts` composes services), drives `runRepair`, then
drives `handleRecognizeFaces` for each unassigned face (captured from the mocked `JobRepository.queueAll` calls).

**Read first and MIRROR for setup:** `test/medium/specs/services/people-identity-rbac.spec.ts` — its
`newMediumService(PersonService, { real: [...], mock: [JobRepository, LoggingRepository, SystemMetadataRepository] })`
block (lines ~39–53), the `metadata.get.mockResolvedValue({ machineLearning: { facialRecognition: { minFaces: 1 } } })`
config mock, and how it calls `personService.handleRecognizeFaces({ id })` (line ~667). Also reuse the
identity+link cluster setup from `test/medium/specs/services/face-repair.service.spec.ts` (the `executeRepair`
suite's `ensurePersonIdentity` + `linkFace` helper).

**Key facts:** `handleRecognizeFaces` requires `face.sourceType === MachineLearning`, an embedding, asset
`visibility = Timeline`, and a config where facial recognition is enabled; with `minFaces: 1` and a 10-face
Karina-main cluster at distance ~0, an unassigned leaked face re-homes to Karina (nearest assigned face is
Karina-main; the co-located leaked siblings are now `personId = NULL` so they don't vote). `JobRepository` is
mocked, so the queued recognition jobs do NOT auto-run — the test drives `handleRecognizeFaces` for the queued ids.

---

### Task 1: End-to-end re-home + no-loop

**Files:** Create `server/test/medium/specs/services/face-repair-e2e.spec.ts`.

- [ ] **Step 1: Write the test.** Setup (isolated DB via `getKyselyDB()`):
  - a `FaceRepairService` sut and a `PersonService` sut sharing that DB; mock `JobRepository` on the FaceRepair sut
    (to capture `queueAll`), and mock `SystemMetadataRepository` on the PersonService sut with
    `{ machineLearning: { facialRecognition: { minFaces: 1 } } }` so recognition is enabled.
  - **Karina** (named, e.g. `name: 'Karina'`): 10 faces, embedding `axisEmbedding('first')`, asset visibility
    Timeline, `sourceType` machine-learning; `ensurePersonIdentity(karina.id)` + `linkFace` each.
  - **Alexia**: 5 genuine faces `axisEmbedding('second')` + 3 leaked faces `axisEmbedding('first')` (the
    contamination); identity + linked; Timeline; ML.

  Steps + assertions:
  - call `faceRepair.runRepair({ ownerId, dryRun: false, maxDistance: 0.6, voteWindow: 50, minFaces: 1, voteMargin: 2, maxAttributionDistance: 0.35, maxFlaggedFraction: 0.5 })`; expect `result.mutated === true` and `result.executed!.unassigned === 3`;
  - read the queued face ids from the `JobRepository` mock: `queueAll` was called with `JobName.FacialRecognition`
    items — collect those `data.id`s (should be the 3 leaked faces, now `personId = NULL` in the DB);
  - for each queued id, `await personService.handleRecognizeFaces({ id, deferred: false })`;
  - assert each of the 3 leaked faces now has `personId === karina.id` (re-homed to the true owner);
  - assert Karina's `name` is still `'Karina'` (name preserved) and Alexia still exists with her 5 genuine faces;
  - assert `faceIdentityRepository.getBackfillWork()` → `hasPersonalIdentityWork === false` (no loop / no mismatch)
    AND was also false at baseline before `runRepair`.

- [ ] **Step 2: Run** — `cd server && pnpm test:medium run test/medium/specs/services/face-repair-e2e.spec.ts`.
      Expect red first (assertions not yet satisfied while you iterate the setup), then green. If a leaked face does
      NOT re-home to Karina, investigate (it is a real signal) — do not relax the assertion.

- [ ] **Step 3: Commit** — `git add -A && git commit -m "test(server): end-to-end face re-attribution repair re-homes leaked faces"`

---

### Task 2: Multi-owner contamination splits correctly

**Files:** same spec file.

- [ ] **Step 1: Write the test.** Setup: **Karina** (10 `axisEmbedding('first')`), **Bob** (10 faces on a third
      disjoint axis — reuse the `mixedAxisEmbedding(slot)` helper from `face-repair.service.spec.ts` or define a third
      axis), and **Alexia** with genuine `second`-axis faces + 2 leaked `first`-axis (Karina) + 2 leaked third-axis
      (Bob). Run `runRepair({ ownerId, dryRun: false, ...same params })`, drive `handleRecognizeFaces` for each queued
      id, then assert: the 2 Karina-leaks now `personId === karina.id`, the 2 Bob-leaks now `personId === bob.id`
      (the contamination splits to the correct owners), and `getBackfillWork().hasPersonalIdentityWork === false`.

- [ ] **Step 2: Run** — same command → green.
- [ ] **Step 3: Validate + commit** — `cd server && pnpm exec prettier --write <file> && pnpm exec eslint <file> --max-warnings 0 && pnpm exec tsc --noEmit`; `git add -A && git commit -m "test(server): multi-owner face re-attribution splits to correct owners"`.

---

## Self-review

- Slice-8 matrix rows: leaked face re-homes to true owner ✓ (T1, T2); name preserved ✓ (T1); no re-corruption (a
  re-homed face lands on the right person) ✓ (T1, T2); multi-owner split ✓ (T2); post-re-home no-loop ✓ (T1, T2);
  full dry-run→real→idempotent is already covered in Slice 6 — optionally add a one-line idempotency re-check here.
  Shared-space-projection-no-dangling is the one matrix row needing a shared space; if cheap, add a variant with a
  `shared_space_person_face` row for a leaked face and assert no dangling projection after repair — otherwise note
  it as covered by the Slice 4 repository behavior + manual testing. No production code in this slice.
