# Face re-attribution repair — Slice 3 (Review-only routing) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.
> Strict TDD: failing test first, RUN it (capture red), minimal impl, RUN green. Report red+green output.
> Build ONLY on Slices 1–2 (`findReattributionCandidates`, `decideReattribution`, `FlaggedFace`).
> Do NOT implement Slice 4+ (the actual unassign/re-home, report DTO, endpoint, chunking).

**Goal:** Categorize flagged faces into an actionable repair plan: `toRepair` vs `reviewOnly`, applying the
per-person contamination cap and the "don't re-home into a known-bad cluster" rule. Faces with no confident
external owner are naturally never flagged, so they are simply left untouched (effectively review-only).

**Architecture:** A `FaceRepairService.buildRepairPlan(options)` that makes ONE pass over the Slice-1 candidate
stream, accumulating per-person eligible counts + the (small) flagged set, then: (1) marks any person whose
`flagged / eligible > maxFlaggedFraction` as **review-only** (whole-cluster / fused protection); (2) routes each
flagged face whose **suspected owner `Q` is itself a review-only person** to review-only (`bad-target`); (3) the
rest become `toRepair`. Memory is bounded by #persons + #flagged (not all candidates).

**Read first:** `src/services/face-repair.service.ts` (`findReattributionCandidates`, `findFlaggedFaces`,
`FlaggedFace`), `src/utils/face-repair.ts` (`decideReattribution`, `FlagParams`).

---

### Task 1: `buildRepairPlan`

**Files:** Modify `server/src/services/face-repair.service.ts`; Modify
`server/test/medium/specs/services/face-repair.service.spec.ts`.

- [ ] **Step 1: Write the failing medium tests.** Reuse the existing `axisEmbedding` + cluster helpers. Params:
      `{ maxDistance: 0.6, voteWindow: 50, minFaces: 3, voteMargin: 2, maxAttributionDistance: 0.35, maxFlaggedFraction: 0.5 }`.
  - **Normal leak under cap → toRepair:** Karina-main 10 `first`-axis faces; Alexia has 8 genuine `second`-axis
    faces + 3 leaked `first`-axis faces (flaggedFraction 3/11 ≈ 0.27 < 0.5). Assert the 3 leaked faces are in
    `plan.toRepair` (suspectedOwnerId = karina), and Alexia is NOT in `reviewOnlyPersonIds`.
  - **Over-cap person → review-only (+ boundary):** a person `dup` with 10 `first`-axis faces, 6 of which are
    flagged toward Karina (build so flagged/eligible = 6/10 = 0.6 > 0.5). Assert `dup ∈ reviewOnlyPersonIds`, its
    flagged faces appear in `plan.reviewOnlyFaces` with `reason: 'over-cap'`, and NONE are in `toRepair`. Boundary:
    a sibling person with 5/10 flagged (= 0.5, NOT > 0.5) → its 5 flagged faces ARE in `toRepair`.
  - **Bad-target → review-only:** person `victimA` has 7 faces flagged toward an over-cap person `dup` (from the
    previous scenario). Assert those faces are in `plan.reviewOnlyFaces` with `reason: 'bad-target'` and NOT in
    `toRepair`. (Build `victimA` so it is itself under the cap, isolating the bad-target rule.)
  - **Un-attributable left untouched:** a lone person `solo` with 4 `third`-axis faces and no other person nearby
    → no confident `Q` → `solo` contributes 0 flagged; assert none of `solo`'s faces are in `toRepair` or
    `reviewOnlyFaces`, and `solo` appears in `plan.perPerson` with `flagged: 0`.

  (Use a 3rd disjoint axis for `solo`: thirds of the 512-dim vector, or reuse `second` if no other cluster shares
  it. Keep clusters' axes disjoint so cross-talk is controlled.)

- [ ] **Step 2: Run, confirm red** — `cd server && pnpm test:medium run test/medium/specs/services/face-repair.service.spec.ts` → FAIL (`buildRepairPlan` not a function).

- [ ] **Step 3: Implement** (add to `FaceRepairService`):

```typescript
export type ReviewOnlyReason = 'over-cap' | 'bad-target';

export interface RepairPlan {
  toRepair: FlaggedFace[];
  reviewOnlyFaces: (FlaggedFace & { reason: ReviewOnlyReason })[];
  reviewOnlyPersonIds: string[];
  perPerson: { personId: string; eligible: number; flagged: number; flaggedFraction: number }[];
}

// in the class:
async buildRepairPlan(
  options: { ownerId?: string; personId?: string; maxDistance: number; voteWindow: number; maxFlaggedFraction: number } & FlagParams,
): Promise<RepairPlan> {
  const eligibleByPerson = new Map<string, number>();
  const flaggedByPerson = new Map<string, FlaggedFace[]>();

  for await (const candidate of this.findReattributionCandidates(options)) {
    eligibleByPerson.set(candidate.currentPersonId, (eligibleByPerson.get(candidate.currentPersonId) ?? 0) + 1);
    const decision = decideReattribution(candidate, options);
    if (decision.flagged && decision.suspectedOwnerId) {
      const list = flaggedByPerson.get(candidate.currentPersonId) ?? [];
      list.push({
        assetFaceId: candidate.assetFaceId,
        currentPersonId: candidate.currentPersonId,
        suspectedOwnerId: decision.suspectedOwnerId,
      });
      flaggedByPerson.set(candidate.currentPersonId, list);
    }
  }

  const reviewOnlyPersonIds = new Set<string>();
  for (const [personId, eligible] of eligibleByPerson) {
    const flagged = flaggedByPerson.get(personId)?.length ?? 0;
    if (eligible > 0 && flagged / eligible > options.maxFlaggedFraction) {
      reviewOnlyPersonIds.add(personId);
    }
  }

  const toRepair: FlaggedFace[] = [];
  const reviewOnlyFaces: (FlaggedFace & { reason: ReviewOnlyReason })[] = [];
  for (const [personId, faces] of flaggedByPerson) {
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

  const perPerson = [...eligibleByPerson].map(([personId, eligible]) => {
    const flagged = flaggedByPerson.get(personId)?.length ?? 0;
    return { personId, eligible, flagged, flaggedFraction: eligible > 0 ? flagged / eligible : 0 };
  });

  return { toRepair, reviewOnlyFaces, reviewOnlyPersonIds: [...reviewOnlyPersonIds], perPerson };
}
```

(`decideReattribution` is already imported from Slice 2. Import `decideReattribution`/`FlagParams` if not present.)

- [ ] **Step 4: Run, confirm green** — same command → PASS.
- [ ] **Step 5: Validate + commit** — `cd server && pnpm exec prettier --write <changed> && pnpm exec eslint <changed> --max-warnings 0 && pnpm exec tsc --noEmit`; `git add -A && git commit -m "feat(server): categorize re-attribution repair plan (cap + bad-target)"`.

---

## Self-review

- Slice-3 matrix rows: per-person cap → review-only (+ boundary) ✓ (T1 scenario 2); suspected-Q over-cap → face
  review-only ✓ (T1 scenario 3); un-attributable not repaired ✓ (T1 scenario 4); very-similar-within-floor cap
  protection is exercised by the over-cap scenario. No unassign/re-home (Slice 4), no report DTO (Slice 5), no
  chunking/scope (Slice 6). Types consistent (`FlaggedFace`, `RepairPlan`). No placeholders. Cap uses strict `>`
  so exactly-at-cap is repaired (boundary test pins it).
