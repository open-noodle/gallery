# Face re-attribution repair — Slice 9 (coverage hardening) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Strict TDD: failing test
> first, RUN it (red), minimal change, RUN green. Report red+green per item. Build on the shipped Slices 1–8.
> **Do NOT change the mutation semantics** of `executeRepair`/`unassignFacesFromPerson` — the destructive path is
> verified and must not regress. **Do NOT run OpenAPI/SDK generation** (the human regenerates after, since the
> report DTO changes). Files: `server/src/utils/face-repair.ts`, `server/src/services/face-repair.service.ts`,
> `server/src/services/face-repair.summary.ts`, `server/src/dtos/face-repair.dto.ts`, the 6 face-repair test files.

This closes the gaps from the code review. Each item is independent; do them in order.

---

### Item 1 (M2): delete dead `findFlaggedFaces`

`findFlaggedFaces` (`face-repair.service.ts:121-134`) is never called outside tests (`buildRepairPlan` re-implements
the loop). Delete the method and its 3 medium tests in `face-repair.service.spec.ts` (the flag logic stays covered
by `decideReattribution` unit tests + `buildRepairPlan` tests). Also remove the now-unused `FlagDecision` import if
nothing else uses it. Run `pnpm exec tsc --noEmit` + the service spec to confirm green. Commit:
`refactor(server): drop unused findFlaggedFaces from face-repair`.

---

### Item 2 (M6): deterministic tie-break in `tallyReattribution`

In `face-repair.ts`, when two other persons tie on BOTH count and nearest distance, the winner is currently
Map-insertion-order-dependent. Make it deterministic by `personId` (string compare) as the final tiebreak.

- [ ] Failing unit test in `face-repair.spec.ts`: two neighbors `n('B',0.2)` and `n('A',0.2)` (same count=1, same
      distance) → `topOtherPersonId` is the deterministic one (e.g. `'A'` by lexical order); assert it twice with
      reversed input order to prove order-independence.
- [ ] Implement: in the winner comparison, add `|| (count === topOtherCount && nearest === topOtherNearest && personId < topOtherPersonId)`.
- Commit: `fix(server): deterministic tie-break in re-attribution tally`.

---

### Item 3 (M3 + M4): flag-rule boundary + voteMargin=0 unit tests

In `face-repair.spec.ts` add to the `decideReattribution` describe:

- [ ] **voteMargin exact boundary:** `ownCount:6, topOtherCount:8, topOtherNearest:0.2, params voteMargin:2` →
      flagged (8-6 === 2, `>=`); `ownCount:7, topOtherCount:8` → not flagged.
- [ ] **voteMargin:0 ties flag:** `ownCount:5, topOtherCount:5, topOtherNearest:0.2, voteMargin:0, minFaces:3` →
      flagged (a tie out-votes when margin is 0). This pins the documented "0 disables the family vote-margin"
      behavior. (Leave the DTO `min(0)`; this is intentional flexibility, now covered.)
- Commit: `test(server): cover re-attribution flag-rule boundaries`.

---

### Item 4 (C2 + M1): report review-only reasons + un-attributable signal (report-only, no mutation change)

**Goal:** the dry-run report must (M1) break review-only down by reason, and (C2) surface "un-attributable" faces —
faces `P` doesn't claim (`ownCount < minFaces`) that resemble some other person closely (`topOtherNearest <=
maxAttributionDistance`) but with no confident `Q` (so they're never flagged/repaired). This is REPORT-ONLY: it
does not change `toRepair` or any mutation.

- [ ] **buildRepairPlan** (`face-repair.service.ts`): while iterating candidates, after `decideReattribution`, if
      NOT flagged AND `candidate.ownCount < options.minFaces` AND `candidate.topOtherPersonId !== null` AND
      `candidate.topOtherNearest !== null && candidate.topOtherNearest <= options.maxAttributionDistance`, collect
      `{ assetFaceId, currentPersonId }` into a new `unAttributableFaces` array, and add that array to the
      `RepairPlan` interface and the return value.
- [ ] **summarizeRepairPlan** (`face-repair.summary.ts`): add a `reviewOnlyByReason` object to
      `RepairReport.totals` counting `reviewOnlyFaces` by `reason` plus the `unAttributableFaces` length. Keep the
      existing fields.
- [ ] **DTO** (`face-repair.dto.ts`): add a `reviewOnlyByReason` object — `overCap`, `badTarget`,
      `unAttributable`, all `z.number()` — to the response `totals` schema.
- [ ] **Tests:**
  - `face-repair.summary.spec.ts`: extend the existing plan fixture with a `reviewOnlyFaces` entry of reason
    `'bad-target'` and a non-empty `unAttributableFaces`; assert `totals.reviewOnlyByReason` = `{ overCap: N,
badTarget: M, unAttributable: K }`.
  - `face-repair.service.spec.ts` (medium): a person whose face has `ownCount < minFaces` and a close-but-sub-
    `minFaces` other owner → appears in `plan.unAttributableFaces` and NOT in `toRepair`; and confirm a sparse but
    isolated person (no close other owner) is NOT un-attributable (excluded — avoids false noise).
- Commit: `feat(server): report re-attribution review-only reasons + un-attributable faces`.
- **Document (design doc):** note `unAttributable` is a heuristic surface (close-but-unconfident), not full
  fused-cluster/bimodality detection, which remains out of scope.

---

### Item 5 (H4): widen the vote window + large-co-located-leak test

In `face-repair.service.ts` bump `DEFAULT_VOTE_WINDOW` from `50` to `200` so the tally can still see the true owner
when contamination is large. (The k-NN is owner-scoped + indexed; 200 is fine.)

- [ ] Medium test in `face-repair.service.spec.ts`: Karina-main 10 faces; **60** co-located leaked faces on Alexia
      (> the old 50 window). With `voteWindow: 200`, assert all 60 still flag toward Karina. Also note in the
      design that contamination exceeding `voteWindow` is a documented limitation (raise the param if needed).
- Commit: `fix(server): widen re-attribution vote window for large co-located leaks`.

---

### Item 6 (M5): controller invalid-param + passthrough tests

In `face-repair-admin.controller.spec.ts`, add (mirroring the existing harness):

- [ ] invalid-param 400s: `{ maxDistance: 0 }`, `{ maxDistance: 3 }`, `{ voteMargin: -1 }`, `{ minFaces: 0 }`,
      `{ maxAttributionDistance: 0 }`, `{ maxAttributionDistance: 3 }` — each → 400, `service.runRepair` NOT called.
      (Confirm the DTO schema rejects each; tighten the Zod schema if any slips through — e.g. ensure `maxDistance`
      is `.gt(0).max(2)`, `maxAttributionDistance` `.gt(0).max(2)`, `minFaces` `.int().min(1)`, `voteMargin`
      `.int().min(0)`, `voteWindow` `.int().min(1)`.)
- [ ] passthrough: `POST` with `{ dryRun: false, ownerId: <uuid>, maxDistance: 0.4, voteMargin: 3 }` →
      `service.runRepair` called with those exact values (`toHaveBeenCalledWith(expect.objectContaining({...}))`).
- Commit: `test(server): cover face-repair endpoint param validation + passthrough`.

---

### Item 7 (H1): re-home tested at production minFaces + sub-minFaces stays blank

In `face-repair-e2e.spec.ts` add a scenario at **`minFaces: 3`** (a second `setupPerson`/config mock with
`minFaces: 3`, or parameterize): Karina-main 10 `first`-axis faces, Alexia with leaked `first`-axis faces.

- [ ] After `runRepair({ dryRun: false, ... minFaces: 3 })` + driving `handleRecognizeFaces` for each queued id:
      a leaked face that has **≥3** Karina neighbors re-homes to Karina (`personId === karina.id`); and add a
      **lone leaked face** (one Alexia face on a `third`-axis embedding with **<3** same-axis neighbors anywhere) —
      after repair + recognition it stays `personId = NULL` (sub-`minFaces` → blank, the accepted outcome); and
      `getBackfillWork().hasPersonalIdentityWork === false` throughout.
- Commit: `test(server): e2e re-home at production minFaces + sub-minFaces stays unassigned`.

---

### Item 8 (L3 + H2): empty-owner + non-Timeline eligibility tests

- [ ] **L3 (empty owner):** `face-repair.service.spec.ts` medium — `runRepair` for a fresh user with no faces →
      resolves, `report.totals.flaggedFaces === 0`, `mutated === false`, no throw.
- [ ] **H2 (non-Timeline accepted):** `face-repair.repository.spec.ts` medium — a machine-learning face on an asset
      with `visibility != Timeline` (e.g. Archive) IS returned by `streamEligibleFaces` (documents the accepted
      "eligible, may be left blank" decision). Add a one-line comment in `streamEligibleFaces` noting non-Timeline
      faces are intentionally eligible and may be left unassigned if recognition can't re-home them.
- Commit: `test(server): cover empty-owner repair + non-Timeline eligibility`.

---

### Item 9: design-doc updates (no code)

Update `docs/plans/2026-05-31-face-reattribution-repair-design.md`:

- **H3 (de-scope shared-space):** remove the matrix row "Shared-space face → no dangling projection / stale count"
  and the repair-step-2 shared-space reconcile sentence; add a note: space projections are refreshed by the
  existing SharedSpaceFaceMatch backfill that re-home triggers; space-side repair stays the deferred follow-up.
- **L1:** matrix row "faceAssetId + counts reconciled" → "faceAssetId reconciled (no stored counts — computed on read)".
- **L2:** matrix row "Chunk boundary" → "Streaming (`.stream()` cursor) covers every eligible face exactly once
  (no pagination boundaries)".
- **C1:** add a note that the vote uses the same `searchFaces` neighbor scope as recognition (so detection and
  re-home are consistent); aligning voter visibility/deleted filters would require changing shared recognition
  behavior and is intentionally out of scope.
- **H2 + C2:** the notes described in Items 4 and 8.
- Run the **docs-package prettier** (`cd docs && pnpm exec prettier --write plans/2026-05-31-...`).
- Commit: `docs(server): reconcile face-repair design with shipped behavior + review findings`.

---

## Self-review

All items are additive tests, report-only fields, or docs — none change `executeRepair`/`unassignFacesFromPerson`
mutation semantics. The report DTO grew (`reviewOnlyByReason`) → the human will regenerate OpenAPI/SDK. Run, before
handing back: full `pnpm test -- --run` (unit), the face-repair medium specs + the e2e spec, `pnpm exec tsc
--noEmit`, `pnpm exec eslint <changed> --max-warnings 0`, server prettier on changed `.ts`.
