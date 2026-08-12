# Slice 2 — Relax E15 for `detach` and `unknown`

Spec: `docs/superpowers/specs/2026-07-23-manual-face-review-mode-design.md` §5.1, §5.2, §5.4
Branch: `feat/face-manual-review`
Depends on: slice 1 (which already removed `lock` from the snapshot gate and added
`getEligibleFaceIdsForPerson`).

> Line numbers are deliberately **not** used to locate tests — slice 1 shifted them. Locate by
> `describe(...)` string.

## Goal

`detach` and `unknown` stop being gated on the flagged snapshot. After this slice the gate covers
**`stay` only**. No eligibility read is added for these two: unlike `lock`, both are already
person-scoped at the write layer (§5.2), and that is asserted here rather than assumed.

## Why no eligibility check is needed for these two

- `detachFaces` (`server/src/repositories/face-repair.repository.ts:275-284`) filters
  `.where('personId', '=', personId)`, and its identity-strip is keyed on the `RETURNING` output, not
  the caller's raw ids — so a foreign id is inert on both writes.
- `unknown` routes through `executeRepair` → `reattributeFaces` (`:228-237`), which filters
  `.where('personId', '=', fromPersonId)` — a foreign id is skipped at write time.

Both claims are pinned by tests below rather than trusted.

## Step 1 — RED

File: `server/test/medium/specs/services/face-repair.resolve.spec.ts`

### 1a. Rewrite the detach E15 describe

Find `describe('FaceRepairService.resolveFaces: detach on a non-flagged face ...` (the test asserting
`'Some faces are not in the flagged snapshot for this person'` for a `detach` id). Rename to
`'FaceRepairService.resolveFaces: detach on a non-flagged face (E15 relaxed)'` and replace with:

```ts
it('detaches a non-flagged face that is currently on this person', async () => {
  // seed f1 (flagged) + notFlagged, both on `source`; seedFlaggedSnapshot with f1 only
  const result = await sut.resolveFaces(
    { personId: source.id, moveToPerson: [], stay: [], lock: [], detach: [notFlagged], unknown: [] },
    user.id,
  );
  expect(result.detached).toBe(1);
  // row assertions INVERT from the old test: personId now null, deletedAt set, identity link gone
});
```

Old assertions that invert: the face was `toBeTruthy()`/unchanged, now `personId === null` and
`deletedAt !== null`; the manual link row count goes from unchanged to `0`.

### 1b. NEW — detach with no scan at all succeeds

No `seedFlaggedSnapshot`; expect `detached: 1`.

### 1c. NEW — detach cannot touch another person's cluster (pins the person scope)

Seed `other` person + `foreignFace` on it. Call
`resolveFaces({ personId: source.id, detach: [foreignFace], ... })`.
Assert: the call does **not** throw (the guard is gone), `result.detached` is `0`, and `foreignFace`
is **completely untouched** — still on `other`, `deletedAt` still null, identity link intact.
This is the test that proves removing the gate did not open a cross-cluster write.

### 1d. Rewrite the `unknown` stale-face test — §5.4 behaviour change

Find the test asserting the E15 rejection for a stale `unknown` id (inside the unknown/park describe;
the face was **moved off `source` since the scan**, so the snapshot no longer resolves it).

This is **not** a rest-of-cluster case. After relaxation: the guard no longer fires → `executeRepair`'s
still-on-source check skips the face → `movedFaceIds.length === 0` → the freshly created cluster is
deleted. So it becomes:

```ts
it('returns success with unknown: 0 for a face that left this person since the scan', async () => {
  const result = await sut.resolveFaces(
    { personId: source.id, moveToPerson: [], stay: [], lock: [], detach: [], unknown: [movedAway] },
    user.id,
  );
  expect(result.unknown).toBe(0); // truthfully reports zero parks
  // the face is STILL on `elsewhere`, unchanged
  // NO new person was created (the empty cluster was cleaned up) — person count unchanged
  // no manual link was written for it
});
```

Keep the existing person-count and face-location assertions; only the `rejects.toThrow` becomes a
resolved result. **Rename the test** so it no longer claims to test a rejection.

### 1e. NEW — unknown on a genuine non-flagged face parks it

Seed `notFlagged` on `source`, no snapshot entry for it, `unknown: [notFlagged]` → `result.unknown`
is 1, a new unnamed person exists holding it, with a `source='manual'` link.

### 1f. NEW — unknown on every face empties the source person

Park all of `source`'s faces. Assert the source person is deleted **only** when it is unnamed and
`countAllFaces` is 0 — the cleanup is gated on all-faces, not just eligible ones
(`face-repair.service.ts:1074-1083`). Seed the source with `name: ''` so the cleanup applies, and add
a sibling case with a **named** source proving it is kept.

### 1g. Regression — `stay` is now the ONLY snapshot-gated bucket

Assert `stay` on a non-flagged face still throws, and in the same file assert `lock`/`detach`/`unknown`
on non-flagged faces do not. (The `lock` arm already exists from slice 1; this adds the explicit
contrast so a future refactor cannot re-widen the gate unnoticed.)

**Expected RED:** 1a/1b/1d/1e/1f fail with `BadRequestException: Some faces are not in the flagged
snapshot for this person`; 1c fails the same way (it currently throws instead of no-oping).

### Why this slice does NOT need slice 1's three-phase red/green

Slice 1 discovered that `getScanFlaggedFacesForPersons`
(`face-repair-scan.repository.ts:293-316`) INNER JOINs `asset_face` and re-validates
`personId`/`deletedAt`/`isVisible`/`sourceType` at snapshot-read time — so the snapshot gate is a
**live guard**, not just a membership list. Removing it for `lock` created a real hazard, because
`replaceFaceIdentities` is unscoped; that is why slice 1 had to run an intermediate phase proving the
hazard before adding the eligibility check.

`detach` and `unknown` are different: both are person-scoped at the **write** layer
(`detachFaces` filters `personId`; `reattributeFaces` filters still-on-source). Removing the gate
therefore hands protection to a guard that already exists rather than to nothing. So a normal
two-phase red→green is correct here, **and no eligibility read is added**.

Test 1c is what proves that claim rather than assuming it: it must show a foreign id becomes an inert
no-op (`detached: 0`, target row completely untouched) — not an exception, and not a mutation. If 1c
shows the foreign face WAS mutated, stop immediately: that would mean detach is not actually
person-scoped and this slice needs slice 1's eligibility treatment too.

## Step 2 — GREEN

`server/src/services/face-repair.service.ts` — narrow the gate to `stay` only:

```ts
// E15: only `stay` is snapshot-gated. It writes a negative verdict against the face's SUSPECTED owner,
// read from the snapshot via snapshotOwnerByFace.get(id)! — with no snapshot row there is no owner to
// record against, and the non-null assertion would yield undefined (500 / FK violation). lock, detach
// and unknown are all meaningful for any face on this person (manual review): lock is gated on
// eligibility instead (slice 1), and detach/unknown are person-scoped at the write layer.
const unresolvable = findUnresolvableIds([...stay], flaggedIds);
if (unresolvable.length > 0) {
  throw new BadRequestException('Some faces are not in the flagged snapshot for this person');
}
```

No other source change. Do **not** add an eligibility read for detach/unknown — their write-layer
scoping is the guard, and 1c/1d pin it.

## Step 3 — Verify

From `server/`:

1. Full file:
   `pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/services/face-repair.resolve.spec.ts`
   Watch specifically that the drain-gate tests (`'settles none'` / the C1 drain describe) still pass —
   `settledFaceIds` now admits non-flagged ids, and although the `every()` check compares against
   `resolvable` so behaviour should be unchanged, those tests are what would catch it if not.
2. `pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/services/face-review-cross-flow.spec.ts`
3. `pnpm lint` + `pnpm exec prettier --check src test`

## Commit

`feat(server): allow detach and unknown on any face of a person, not only flagged ones`

Body: note that `stay` is now the only snapshot-gated bucket and why; note the §5.4 behaviour change
(a stale `unknown` id now returns success with `unknown: 0` instead of 400).

## Out of scope

No web changes. No new endpoint. No eligibility read beyond slice 1's.
