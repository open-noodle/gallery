# Face re-attribution repair — Slice 2 (Flag rule) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.
> Strict TDD: failing test first, RUN it (capture red), minimal impl, RUN green. Report red+green output.
> Build ONLY on Slice 1 (`ReattributionTally` from `src/utils/face-repair.ts`, `FaceRepairService`).
> Do NOT implement Slice 3+ (review-only routing, contamination cap, repair, report, endpoint).

**Goal:** Turn the Slice-1 vote tally into a flag decision — flag a face only when a confident external owner `Q`
out-votes the current person `P` (or `P` doesn't claim it) AND `Q` is **absolutely** close to the face (within
`maxAttributionDistance`).

**Architecture:** A pure `decideReattribution(tally, params)` function + a thin `FaceRepairService.findFlaggedFaces`
that streams Slice-1 candidates through it. **Design note (decision-2 reversal):** the family-shuffle guard is an
**absolute** distance floor measured to `Q` (`topOtherNearest ≤ maxAttributionDistance`), NOT a relative "Q closer
than P" margin. A relative margin backfires on co-located contamination: when many wrong faces sit together on `P`,
`P`'s nearest face to a leaked face is another co-located leaked sibling at the same distance as the true owner, so
the relative guard suppresses exactly the mass contamination we target. The floor is on `Q` only, so co-location
can't fool it; the **vote margin** protects genuine faces (own cluster out-votes locally); very-similar relatives
_within_ the floor are protected by the per-person cap (Slice 3), not here.

**Read first:** `src/utils/face-repair.ts` (`ReattributionTally`), `src/services/face-repair.service.ts`
(`findReattributionCandidates`, `ReattributionCandidate`).

---

### Task 1: Pure flag-decision function

**Files:** Modify `server/src/utils/face-repair.ts` (+ `decideReattribution`, `FlagParams`, `FlagDecision`);
Modify `server/src/utils/face-repair.spec.ts`.

- [ ] **Step 1: Write the failing unit tests**

```typescript
import { decideReattribution, ReattributionTally } from 'src/utils/face-repair';

const tally = (over: Partial<ReattributionTally>): ReattributionTally => ({
  ownCount: 0,
  ownNearest: null,
  topOtherPersonId: null,
  topOtherCount: 0,
  topOtherNearest: null,
  ...over,
});
const params = { minFaces: 3, voteMargin: 2, maxAttributionDistance: 0.35 };

describe('decideReattribution', () => {
  it('flags when a confident, close Q out-votes P by the vote margin', () => {
    const d = decideReattribution(
      tally({ ownCount: 1, topOtherPersonId: 'Q', topOtherCount: 8, topOtherNearest: 0.2 }),
      params,
    );
    expect(d).toEqual({ flagged: true, suspectedOwnerId: 'Q' });
  });

  it('flags when P does not claim F (ownCount < minFaces) and Q is confident and close', () => {
    const d = decideReattribution(
      tally({ ownCount: 1, topOtherPersonId: 'Q', topOtherCount: 5, topOtherNearest: 0.2 }),
      params,
    );
    expect(d.flagged).toBe(true);
    expect(d.suspectedOwnerId).toBe('Q');
  });

  it('does NOT flag a within-vote-margin rival when P also claims F', () => {
    const d = decideReattribution(
      tally({ ownCount: 6, topOtherPersonId: 'Q', topOtherCount: 7, topOtherNearest: 0.2 }),
      params,
    );
    expect(d).toEqual({ flagged: false, suspectedOwnerId: null });
  });

  it('does NOT flag when Q is not confident (topOtherCount < minFaces)', () => {
    const d = decideReattribution(
      tally({ ownCount: 0, topOtherPersonId: 'Q', topOtherCount: 2, topOtherNearest: 0.1 }),
      params,
    );
    expect(d.flagged).toBe(false);
  });

  it('enforces the absolute distance floor at the boundary', () => {
    // Q out-votes P, but Q's nearest is 0.40 > floor 0.35 -> NOT flagged
    const tooFar = decideReattribution(
      tally({ ownCount: 0, topOtherPersonId: 'Q', topOtherCount: 9, topOtherNearest: 0.4 }),
      params,
    );
    expect(tooFar.flagged).toBe(false);
    // Q's nearest is 0.30 <= 0.35 -> flagged
    const closeEnough = decideReattribution(
      tally({ ownCount: 0, topOtherPersonId: 'Q', topOtherCount: 9, topOtherNearest: 0.3 }),
      params,
    );
    expect(closeEnough.flagged).toBe(true);
  });

  it('does not use the current person distance (co-located contamination still flags)', () => {
    // ownNearest tiny (a co-located wrong sibling), Q equally close, Q out-votes -> MUST still flag.
    const d = decideReattribution(
      tally({ ownCount: 1, ownNearest: 0.05, topOtherPersonId: 'Q', topOtherCount: 9, topOtherNearest: 0.05 }),
      params,
    );
    expect(d.flagged).toBe(true);
  });
});
```

- [ ] **Step 2: Run, confirm red** — `cd server && pnpm test -- --run src/utils/face-repair.spec.ts` → FAIL (`decideReattribution` not exported).

- [ ] **Step 3: Implement** (append to `src/utils/face-repair.ts`):

```typescript
export interface FlagParams {
  minFaces: number;
  voteMargin: number;
  maxAttributionDistance: number;
}

export interface FlagDecision {
  flagged: boolean;
  suspectedOwnerId: string | null;
}

// Decide whether a face should be re-attributed away from its current person. Flag only when a confident
// external owner Q exists — Q has >= minFaces neighbors of F AND Q's nearest neighbor is within
// maxAttributionDistance (absolute resemblance guard, measured to Q so co-located contamination on P cannot
// suppress it) — AND Q either out-votes P by voteMargin or P does not claim F (ownCount < minFaces). The vote
// margin is the family guard for genuine faces; the current-person distance is intentionally NOT used.
export const decideReattribution = (tally: ReattributionTally, params: FlagParams): FlagDecision => {
  const { topOtherPersonId, topOtherCount, topOtherNearest, ownCount } = tally;

  const confidentOther =
    topOtherPersonId !== null &&
    topOtherNearest !== null &&
    topOtherCount >= params.minFaces &&
    topOtherNearest <= params.maxAttributionDistance;
  if (!confidentOther) {
    return { flagged: false, suspectedOwnerId: null };
  }

  const flagged = topOtherCount - ownCount >= params.voteMargin || ownCount < params.minFaces;
  return { flagged, suspectedOwnerId: flagged ? topOtherPersonId : null };
};
```

- [ ] **Step 4: Run, confirm green** — same command → PASS.
- [ ] **Step 5: Commit** — `git add server/src/utils/face-repair.ts server/src/utils/face-repair.spec.ts && git commit -m "feat(server): add face re-attribution flag decision"`

---

### Task 2: Service `findFlaggedFaces` + medium tests

**Files:** Modify `server/src/services/face-repair.service.ts`; Modify
`server/test/medium/specs/services/face-repair.service.spec.ts`.

- [ ] **Step 1: Write the failing medium tests.** Reuse `axisEmbedding` (disjoint, distance ~1.0). Add a
      `relativeAxisEmbedding` ≈0.45 from `axisEmbedding('first')`: `'[' + Array.from({length:512},(_, i)=> (i<140 ||
(i>=256 && i<372))?1:0).join(',') + ']'` (140 first-half + 116 second-half ones → cos = 140/256 ≈ 0.547 →
      distance ≈ 0.453, beyond the 0.35 floor but within maxDistance 0.6). Params for all:
      `{ maxDistance: 0.6, voteWindow: 50, minFaces: 3, voteMargin: 2, maxAttributionDistance: 0.35 }`.
  - **Co-located mass leak (the regression):** Karina-main = 10 `axisEmbedding('first')` faces; **5** leaked
    `axisEmbedding('first')` faces wrongly on Alexia (co-located, identical embedding). Assert `findFlaggedFaces`
    flags **all 5** leaked faces, each `suspectedOwnerId === karina.id`. (With the rejected relative guard these
    flagged 0; with the absolute floor — Karina ~0 ≤ 0.35 — they all flag.)
  - **Floor family guard:** personA = 4 `axisEmbedding('first')` faces; personB = 12 `relativeAxisEmbedding` faces
    (B larger, out-votes). Assert **none** of A's or B's faces are flagged — A's faces don't flag because B's
    nearest (~0.45) is beyond the 0.35 floor; B's faces don't flag because A is even farther / out-voted.
  - **Clean cluster:** a lone unrelated person's faces are not flagged.

- [ ] **Step 2: Run, confirm red** — `cd server && pnpm test:medium run test/medium/specs/services/face-repair.service.spec.ts` → FAIL (`findFlaggedFaces` not a function).

- [ ] **Step 3: Implement** (add to `FaceRepairService`):

```typescript
import { decideReattribution, FlagParams } from 'src/utils/face-repair';

export interface FlaggedFace {
  assetFaceId: string;
  currentPersonId: string;
  suspectedOwnerId: string;
}

// in the class:
async *findFlaggedFaces(
  options: { ownerId?: string; personId?: string; maxDistance: number; voteWindow: number } & FlagParams,
): AsyncIterableIterator<FlaggedFace> {
  for await (const candidate of this.findReattributionCandidates(options)) {
    const decision = decideReattribution(candidate, options);
    if (decision.flagged && decision.suspectedOwnerId) {
      yield {
        assetFaceId: candidate.assetFaceId,
        currentPersonId: candidate.currentPersonId,
        suspectedOwnerId: decision.suspectedOwnerId,
      };
    }
  }
}
```

- [ ] **Step 4: Run, confirm green** — same command → PASS. Confirm the measured cosine distance of
      `relativeAxisEmbedding` is between the floor (0.35) and `maxDistance` (0.6); if not, adjust the second-half ones
      count and re-confirm in the test.
- [ ] **Step 5: Validate + commit** — `cd server && pnpm exec prettier --write <changed> && pnpm exec eslint <changed> --max-warnings 0 && pnpm exec tsc --noEmit`; `git add -A && git commit -m "feat(server): stream flagged re-attribution faces"`.

---

## Self-review

- Slice-2 matrix rows: vote branch + P-doesn't-claim ✓ (T1); tie/within-margin not flagged ✓ (T1); Q-not-confident
  ✓ (T1); floor boundary in/out ✓ (T1); co-located mass leak all flagged ✓ (T2); similar-beyond-floor no cross-flag
  ✓ (T2). No cap/repair/report (Slice 3/4). Current-person distance NOT used in the decision (the reversal). No
  placeholders; types consistent with Slice 1.
