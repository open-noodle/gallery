# Face Cleanup Console — Slice 2 (confidence classification) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this
> plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A pure function `classifyFlaggedPerson(person, ctx)` that labels each flagged person `confident` or
`review-first` with the reasons, so the scan (Slice 3) can auto-select the confident long tail and surface the
rest first.

**Architecture:** One pure, dependency-free function added to `server/src/utils/face-repair.ts` (next to
`decideReattribution`), with exhaustive unit tests in `server/src/utils/face-repair.spec.ts`. No DB, no I/O.

**Tech Stack:** TypeScript, Vitest (plain unit — no medium/Docker).

**Spec:** [`2026-06-03-face-cleanup-console-design.md`](2026-06-03-face-cleanup-console-design.md) §S-B + §Testing/Slice 2.

---

## File Structure

- Modify `server/src/utils/face-repair.ts` — add the types + `classifyFlaggedPerson` at the end (after `decideReattribution`).
- Modify `server/src/utils/face-repair.spec.ts` — add a `describe('classifyFlaggedPerson')` block.

**Types + function (the exact code Task 1 implements):**

```ts
export type ClassifyRecommendation = 'confident' | 'review-first';
export type ClassifyReason = 'named' | 'large-cluster' | 'multiple-owners' | 'bad-target';

export interface ClassifyPersonInput {
  personName: string | null; // null or '' (whitespace-only) = unnamed
  faceCount: number;
  suspectedOwnerIds: string[]; // owner person ids for this person's flagged faces (may repeat)
}

export interface ClassifyContext {
  reviewOnlyPersonIds: ReadonlySet<string>;
  largeClusterThreshold: number;
}

export interface ClassifyDecision {
  recommendation: ClassifyRecommendation;
  reviewReasons: ClassifyReason[];
}

// A flagged person is "review-first" if ANY reason applies; otherwise "confident". Reason order is fixed
// (named → large-cluster → multiple-owners → bad-target) so output is deterministic.
export const classifyFlaggedPerson = (person: ClassifyPersonInput, ctx: ClassifyContext): ClassifyDecision => {
  const reviewReasons: ClassifyReason[] = [];

  if (person.personName !== null && person.personName.trim() !== '') {
    reviewReasons.push('named');
  }
  if (person.faceCount > ctx.largeClusterThreshold) {
    reviewReasons.push('large-cluster');
  }
  const distinctOwners = new Set(person.suspectedOwnerIds);
  if (distinctOwners.size > 1) {
    reviewReasons.push('multiple-owners');
  }
  if ([...distinctOwners].some((ownerId) => ctx.reviewOnlyPersonIds.has(ownerId))) {
    reviewReasons.push('bad-target');
  }

  return { recommendation: reviewReasons.length > 0 ? 'review-first' : 'confident', reviewReasons };
};
```

> **Zero-flagged note:** the classifier is only ever called for persons that HAVE flagged faces (Slice 3 filters
> `flagged > 0` before classifying), and the input has no "flagged count" field — so there is no zero-flagged
> input to classify here. The spec's "zero-flagged never classified" case is a Slice-3 call-site concern, not a
> Slice-2 unit test. Documented, not tested here.

---

## Task 1: `classifyFlaggedPerson` (pure, TDD)

**Files:**

- Modify: `server/src/utils/face-repair.ts`
- Test: `server/src/utils/face-repair.spec.ts`

- [ ] **Step 1: Write the failing tests**

Append to `server/src/utils/face-repair.spec.ts`. Add `classifyFlaggedPerson`, `ClassifyContext`,
`ClassifyPersonInput` to the existing import from `'src/utils/face-repair'`.

```ts
const ctx = (over: Partial<ClassifyContext> = {}): ClassifyContext => ({
  reviewOnlyPersonIds: new Set<string>(),
  largeClusterThreshold: 50,
  ...over,
});

const person = (over: Partial<ClassifyPersonInput> = {}): ClassifyPersonInput => ({
  personName: null,
  faceCount: 10,
  suspectedOwnerIds: ['owner-1'],
  ...over,
});

describe('classifyFlaggedPerson', () => {
  it('confident: unnamed, small, single clean owner', () => {
    expect(classifyFlaggedPerson(person(), ctx())).toEqual({ recommendation: 'confident', reviewReasons: [] });
  });

  it('review-first: named person (even with one clean owner)', () => {
    expect(classifyFlaggedPerson(person({ personName: 'Jula' }), ctx())).toEqual({
      recommendation: 'review-first',
      reviewReasons: ['named'],
    });
  });

  it('treats empty / whitespace name as unnamed', () => {
    expect(classifyFlaggedPerson(person({ personName: '' }), ctx()).reviewReasons).toEqual([]);
    expect(classifyFlaggedPerson(person({ personName: '   ' }), ctx()).reviewReasons).toEqual([]);
  });

  it('large-cluster boundary: 50 is confident, 51 is review-first', () => {
    expect(classifyFlaggedPerson(person({ faceCount: 50 }), ctx()).recommendation).toBe('confident');
    expect(classifyFlaggedPerson(person({ faceCount: 51 }), ctx())).toEqual({
      recommendation: 'review-first',
      reviewReasons: ['large-cluster'],
    });
  });

  it('uses the ctx largeClusterThreshold, not a hard-coded 50', () => {
    const c = ctx({ largeClusterThreshold: 10 });
    expect(classifyFlaggedPerson(person({ faceCount: 10 }), c).recommendation).toBe('confident');
    expect(classifyFlaggedPerson(person({ faceCount: 11 }), c).reviewReasons).toEqual(['large-cluster']);
  });

  it('review-first: more than one distinct suspected owner', () => {
    expect(classifyFlaggedPerson(person({ suspectedOwnerIds: ['owner-1', 'owner-2'] }), ctx()).reviewReasons).toEqual([
      'multiple-owners',
    ]);
  });

  it('does NOT flag multiple-owners when the same owner repeats', () => {
    expect(
      classifyFlaggedPerson(person({ suspectedOwnerIds: ['owner-1', 'owner-1', 'owner-1'] }), ctx()).reviewReasons,
    ).toEqual([]);
  });

  it('review-first: suspected owner is itself in reviewOnlyPersonIds (bad-target)', () => {
    const c = ctx({ reviewOnlyPersonIds: new Set(['owner-1']) });
    expect(classifyFlaggedPerson(person(), c).reviewReasons).toEqual(['bad-target']);
  });

  it('accumulates reasons in deterministic order (named + large + multi + bad-target)', () => {
    const c = ctx({ reviewOnlyPersonIds: new Set(['owner-2']) });
    const result = classifyFlaggedPerson(
      person({ personName: 'Jula', faceCount: 99, suspectedOwnerIds: ['owner-1', 'owner-2'] }),
      c,
    );
    expect(result).toEqual({
      recommendation: 'review-first',
      reviewReasons: ['named', 'large-cluster', 'multiple-owners', 'bad-target'],
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && npx vitest run src/utils/face-repair.spec.ts -t "classifyFlaggedPerson"`
Expected: FAIL — `classifyFlaggedPerson` is not exported / not a function.

- [ ] **Step 3: Implement the function**

Add the types + `classifyFlaggedPerson` (from the File Structure block above) to the end of
`server/src/utils/face-repair.ts`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && npx vitest run src/utils/face-repair.spec.ts`
Expected: PASS — the new `classifyFlaggedPerson` cases plus the pre-existing `decideReattribution`/
`tallyReattribution` cases all green.

- [ ] **Step 5: Type-check + lint**

Run: `cd .. && make check-server && make lint-server`
Expected: both clean. (`eslint --fix` may reformat; include any fixes in the commit.)

- [ ] **Step 6: Commit**

```bash
git add server/src/utils/face-repair.ts server/src/utils/face-repair.spec.ts
git commit -m "feat(server): classify flagged persons confident vs review-first"
```

---

## Self-Review

- **Spec coverage (Slice 2 list):** single clean owner→confident ✓; named→review-first ✓; faceCount 50/51
  boundary ✓; multiple owners ✓; bad-target ✓; reasons accumulate in deterministic order ✓; threshold from
  `ctx` ✓; zero-flagged — documented as a Slice-3 call-site concern (no input to classify here) ✓. Extra
  hardening added: empty/whitespace name = unnamed; same-owner-repeated does NOT trigger multiple-owners.
- **Placeholders:** none — full code + exact test assertions + commands.
- **Type consistency:** `ClassifyReason` values (`named`/`large-cluster`/`multiple-owners`/`bad-target`) match
  §S-B and the Slice-1 `RepairScanPerson.reviewReasons`/`recommendation` field shapes. `ReadonlySet` accepts the
  `Set` the tests pass.
- **Carry-forward to Slice 3:** Slice 3 builds `ClassifyPersonInput` from each flagged person
  (`personName` from the report, `faceCount` from the person, `suspectedOwnerIds` = the per-face owner ids) and
  a `ClassifyContext` (`reviewOnlyPersonIds` from `buildRepairPlan`, `largeClusterThreshold` from params), then
  writes `recommendation`/`reviewReasons` onto each enriched person before `completeScan`.
