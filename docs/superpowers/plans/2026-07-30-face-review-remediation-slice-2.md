# Slice 2 — Make the existing suite able to fail

**Spec:** [`2026-07-30-face-review-unification-remediation-slices.md`](../specs/2026-07-30-face-review-unification-remediation-slices.md)
(Slice 2, finding F4)
**Branch:** `feat/face-review-unified`
**Worktree:** `/Users/pierre/dev/gallery/.claude/worktrees/pr834-rebase`

## Goal

Every test that names a guarantee actually fails when that guarantee breaks. This slice lands before
the behavioural slices so their regressions are genuinely caught.

## The inverted loop (read this before starting)

This slice's "red" step is inverted. For each item:

1. **Mutate the production code** the test claims to cover, in the way the item names.
2. Run the test. It should **pass** — that is the proof it is vacuous. Record that output.
3. Repair the test.
4. Run it again with the mutation still applied. It must now **fail**. Record that output.
5. Revert the mutation. Run again. It must pass. Record that output.

A repair you cannot demonstrate going red against the mutation is not a repair. Report all three
runs per item.

## Files

| File                                                                      | Item |
| ------------------------------------------------------------------------- | ---- |
| `server/src/controllers/face-repair-admin.controller.spec.ts`             | A    |
| `server/test/medium/specs/services/face-review-cross-flow.spec.ts`        | B, C |
| `server/test/medium/specs/services/face-verdict.merge-durability.spec.ts` | D    |
| `web/src/routes/admin/face-cleanup/resolutions/page.spec.ts`              | E    |
| `web/src/lib/modals/PersonSuggestionReviewModal.svelte` + `.spec.ts`      | F    |
| `server/test/medium/specs/repositories/face-verdict-safety.spec.ts`       | G    |
| `e2e/src/specs/server/api/person-face-suggestions.e2e-spec.ts`            | H    |

Do **not** touch any other file. In particular do not edit the spec file — another slice is editing
it concurrently.

## Item A — admin-only guard assertions (17 routes)

**Defect.** Seven tests named `is admin-only` do
`ctx.authenticate.mockRejectedValue(new ForbiddenException('Forbidden'))` and then assert
`status === 403`. `ctx.authenticate` is a bare `vi.fn()` (`server/test/utils.ts:134`) and the guard
passes `admin: true` only as data in `metadata` (`server/src/middleware/auth.guard.ts:105`) — it is
never enforced in these tests. A mock that always rejects always yields 403, so the assertion is
independent of the decorator. The other ten routes only assert `expect(ctx.authenticate).toHaveBeenCalled()`.

**Mutation to prove it.** Change `@Authenticated({ admin: true })` to `@Authenticated({})` on all
routes in `server/src/controllers/face-repair-admin.controller.ts`. Every current test stays green.

**Repair.** Use the pattern the sibling controller spec already uses
(`server/src/controllers/person.controller.spec.ts:290-300`): assert the guard metadata.

```ts
expect(ctx.authenticate).toHaveBeenCalledWith(
  expect.objectContaining({
    metadata: expect.objectContaining({ admin: true }),
  }),
);
```

Apply it to **all 17 routes** on the controller, not just the seven that had an `is admin-only`
test. Read the controller and enumerate them; every route gets one assertion. Keep the existing
403-shaped tests as well — they are harmless — but they are no longer the thing carrying the
guarantee.

The `GET faces/:assetFaceId/thumbnail` route is the highest-value one: it is new, join-free, and
returns any user's face crop by id. Make sure it is covered.

## Item B — the confirm cross-flow test writes nothing

**Defect.** `face-review-cross-flow.spec.ts:280-307`, `leak 1 — a confirmed suggestion is never
re-flagged by the cleanup scan`. It calls `person.reassignFacesById(auth, anna.id, { id: leaked[0] })`
**first**, which itself writes the manual identity link (`person.service.ts:289`). By the time
`confirmFaceSuggestion` runs there is no pending row, so `claimPending` returns 0 and the method
returns at `person.service.ts:463-465` having executed no write. The spec's own inline comment
concedes this.

**Mutation to prove it.** Delete the `replaceFaceIdentity(..., 'manual')` call from
`confirmFaceSuggestion`'s transaction in `server/src/services/person.service.ts`. The test stays
green.

**Repair.** Drive the real path:

1. Seed a genuine **pending** row for `(anna, leaked[0])` — either by running
   `handlePersonSuggestionScan` or by calling `facePersonVerdictRepository.upsertPending` directly
   with a distance inside the configured band.
2. Assert the pending row exists (positive control).
3. Call **only** `confirmFaceSuggestion(auth, anna.id, leaked[0])` — remove the `reassignFacesById`
   call.
4. Assert all three post-conditions: `asset_face.personId === anna.id`, a `face_identity_face` row
   for the face with `source === 'manual'`, and the pending row drained.
5. Then re-scan and assert `leaked[0]` is not flagged while `leaked[1]` and `leaked[2]` still are.

## Item C — the cross-scope assertions are absence-only

**Defect.** `face-review-cross-flow.spec.ts:451`, `:458` (`one rejection answers personal and space
scope (defect 5)`) and `:542`, `:548` (`keep-here suppresses a later suggestion`) assert only
`expect(await pendingFor(...)).toBe(false)`. There is no in-test control that the scan would have
produced a pending row at all. `JobStatus.Success` is **not** a control:
`handlePersonSuggestionScan` returns `Success` even when `bestByFace` is empty
(`person.service.ts:520`). If a fixture's embedding, `face_search` row, space-asset link or band
drifts, all four assertions pass while proving nothing.

**Mutation to prove it.** In `handlePersonSuggestionScan` and `handleSpacePersonSuggestionScan`,
make the candidate map unconditionally empty (e.g. `bestByFace.clear()` before the upsert). All four
assertions stay green.

**Repair.** In each of the two tests, add a **control face** that is seeded identically to the
subject face but carries no verdict, and assert in the same test body that the same scan call
produced a pending row for the control. The sibling file does exactly this — copy the shape from
`face-suggestion-exclusions.spec.ts:242` and `:295`.

For `keep-here suppresses a later suggestion`, also assert the intermediate fact the test depends
on: after `resolveFaces({ stay: [face.id] })`, a negative verdict row for `(o.id, face.id)` exists.
Today the test assumes it.

## Item D — the merge test covers only the safe status order

**Defect.** `face-verdict.merge-durability.spec.ts:211`, named `survivor wins on collision
regardless of which side is pending vs rejected`, sets up source = `pending`, survivor = `rejected`
— the order that is safe either way. The dangerous inverse (source = `rejected`, survivor =
`pending`) is not exercised, and it is a live defect: the collision delete in
`server/src/utils/face-verdict-merge.ts:35-44` has no `status` filter, so the human's rejection is
deleted and the machine's suggestion survives.

**Repair.** Split into two tests, one per order:

- keep the existing body as `survivor wins on collision when the survivor holds the negative`;
- add `a source negative outranks a survivor pending row` — source (Bob) holds `rejected` with its
  identity, survivor (Robert) holds `pending`; after `mergePersonalPeople(auth, robert.id, [bob.id])`
  there is exactly one row, and it is `status: 'rejected'`, `personId: robert.id`.

**This new test is expected to FAIL at the end of this slice.** It is the red test for Slice 6. Do
not skip it, do not mark it `.fails()`, do not delete it, and do not fix
`face-verdict-merge.ts` — that is Slice 6's work. Leave it red and say so clearly in your report.

## Item E — the resolutions page spec discards every interpolated value

**Defect.** `web/src/routes/admin/face-cleanup/resolutions/page.spec.ts:35-47` mocks `svelte-i18n`
as `run((key: string) => key)`, which accepts only the key and drops `{ values }`. Every attribution
assertion is therefore `getAllByText('admin.face_cleanup_resolutions_not_person')` — a constant
string identical for every row. The tests named `lists verdicts from both engines with their source
and target`, `renders a space-person verdict with its space named`, and the `unnamed` fallback case
never observe a person, space or actor name. `targetName()`
(`web/src/routes/admin/face-cleanup/resolutions/+page.svelte:56`) could return the wrong person and
all three pass.

**Mutation to prove it.** Make `targetName()` return a constant string. All three stay green.

**Repair.** Render against the real translations, the way
`web/src/routes/admin/face-cleanup/[personId]/PersonPicker.spec.ts` and both
`*ActionsHelpModal.spec.ts` already do — or add a `translations` sink like
`web/src/routes/admin/face-cleanup/scan/ReviewFirstLane.spec.ts:225` that records
`(key, { values })` pairs so the assertions can check the interpolated values. Prefer the real-`en.json`
approach; it is what the sibling specs use.

Then assert the actual rendered strings: the person name, the space person name, the space name, the
actor name (`_by_actor`, currently queried by no test), and the per-row `source-label` element
(`+page.svelte:183`, currently queried by no test). Keep the existing `dataset.source` assertions —
those are genuinely discriminating and must not be lost.

## Item F — duplicate `data-testid` in the review modal

**Defect.** `web/src/lib/modals/PersonSuggestionReviewModal.svelte:308` (the real overlay) and
`:313` (an `{:else}` `<div class="hidden">`) both emit `data-testid="suggestion-highlight"`.
`imgReady` flips only on `<img onload>`, which happy-dom never fires, so
`PersonSuggestionReviewModal.spec.ts:86`'s `getByTestId('suggestion-highlight')` always matches the
hidden placeholder. The face-highlight geometry (`getBoundingBox` + `getContentMetrics`) is
completely untested.

**Mutation to prove it.** Break the overlay's geometry computation (e.g. return zeroed bounds). The
test stays green.

**Repair.**

1. Give the placeholder a distinct testid: `data-testid="suggestion-highlight-placeholder"` at
   `:313`. Leave `:308` as `suggestion-highlight`.
2. Update the existing assertion at `.spec.ts:86` to assert the **placeholder** is present before
   load.
3. Add a new test that dispatches a `load` event on the `suggestion-full-photo` img, waits for the
   re-render, then asserts `suggestion-highlight` exists and its computed inline geometry
   (`style.left` / `top` / `width` / `height`, whatever the component sets) matches the values
   derived from the fixture's bounding box and image dimensions. Compute the expected numbers in the
   test from the fixture, not by copying the component's arithmetic.

## Item G — `unassignFaces` test asserts nothing and mutates the shared DB

**Defect.** `face-verdict-safety.spec.ts:117-120`, `is a no-op when there are no faces of the given
source type`, is `await expect(personRepository.unassignFaces({ sourceType: SourceType.MachineLearning })).resolves.toBeUndefined()`.
`unassignFaces` returns `Promise<void>`, so any non-throwing implementation passes. Worse, the call
is unscoped — it unassigns every machine-learning face in the shared medium database while asserting
nothing, which can perturb sibling specs.

**Repair.** Replace the body with a discriminating one:

1. seed a face whose `sourceType` is **not** `MachineLearning` (assigned to a person, with a manual
   identity link);
2. seed a `MachineLearning` face likewise;
3. call `unassignFaces({ sourceType: SourceType.MachineLearning })`;
4. assert the ML face's `personId` is null and its `face_identity_face` row is gone, **and** the
   non-ML face is completely untouched (still assigned, link intact).

Rename the test to describe what it now proves. Keep the fixture scoped to a fresh user created in
the test so it cannot affect sibling specs.

## Item H — e2e assertions that pass on an empty response

**Defects** in `e2e/src/specs/server/api/person-face-suggestions.e2e-spec.ts`:

- `:170-181` (`items include required fields per DTO`) and `:199-203` (`results are ordered by
distance ascending`) are unguarded loops over `body.items` / `distances`. An endpoint regressed to
  `{ total: 0, items: [] }` passes both.
- `:242-250` asserts `expect(ids).not.toContain(faceForDismiss)` with no assertion that the other
  two seeded faces are still present.
- `:272-285` asserts the confirm only by HTTP 200 — nothing checks that `asset_face.personId` moved,
  that a `face_identity_face` row with `source='manual'` was written, or that the face left the
  queue.

**Repair.**

1. Add `expect(body.items.length).toBeGreaterThan(0)` immediately before each loop.
2. In the dismiss test, assert the two retained control faces are still returned.
3. In the confirm test, assert the post-conditions: a follow-up `GET` no longer lists the face, and
   the two control faces still are. Use whatever DB access the sibling e2e specs use for direct
   assertions (see `e2e/src/specs/web/face-cleanup.e2e-spec.ts` for the pattern) if asserting the
   `face_identity_face` row directly; if there is no clean DB handle in this suite, the
   queue-membership assertions alone are acceptable — say so in your report.

## Verification

```bash
cd server
pnpm exec vitest --config test/vitest.config.mjs --run src/controllers/face-repair-admin.controller.spec.ts
pnpm exec vitest --config test/vitest.config.medium.mjs --run \
  test/medium/specs/services/face-review-cross-flow.spec.ts \
  test/medium/specs/services/face-verdict.merge-durability.spec.ts \
  test/medium/specs/repositories/face-verdict-safety.spec.ts
cd ../web
pnpm exec vitest --run src/routes/admin/face-cleanup/resolutions/page.spec.ts src/lib/modals/PersonSuggestionReviewModal.spec.ts
```

Expected end state: everything green **except** Item D's new test, which is red by design.

The e2e suite needs the e2e stack; if it is not available, verify item H by inspection and say so
explicitly in your report rather than claiming a green run.

## Constraints

- `pnpm test -- --run <path>` silently drops the path filter — use the `pnpm exec vitest --config …`
  forms above.
- Medium tests spin up Postgres via testcontainers; Docker is available. Run only the named spec
  files, never the whole medium suite.
- Do not add `Co-Authored-By` or "Generated with" trailers.
- Do not commit — the controlling session commits.

## Commit

```
test(face-review): replace assertions that cannot fail with discriminating ones
```
