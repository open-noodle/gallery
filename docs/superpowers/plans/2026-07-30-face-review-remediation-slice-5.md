# Slice 5 — A human placement survives the next recognition pass

**Spec:** [`2026-07-30-face-review-unification-remediation-slices.md`](../specs/2026-07-30-face-review-unification-remediation-slices.md)
(Slice 5, findings F9–F10)
**Branch:** `feat/face-review-unified`
**Depends on:** Slices 3 and 4, which also edit `person.service.ts`. Start only after both are
committed.

## Goal

Confirming a suggestion on a shared-space person is durable: a later facial-recognition run cannot
re-home the face, and a crash mid-confirm cannot settle a face onto nobody.

## The revert chain, traced end to end

1. `confirmSpacePersonFaceSuggestion` (`server/src/services/shared-space.service.ts`, around
   `:1336-1346`) writes `face_identity_face(source='manual')` and a `shared_space_person_face` row,
   but **never** sets `asset_face.personId` — space people are a projection over personal people
   everywhere else in this codebase.
2. Non-forced recognition selects `{ personId: null, sourceType: MachineLearning }`
   (`server/src/services/person.service.ts`, around `:1312-1313`), so the face is re-queued.
3. The face was surfaced as a suggestion precisely because it sits outside `maxDistance`, so
   recognition clusters it to a _different_ personal person, or creates a new one (around
   `:1500-1505`).
4. `replaceFaceIdentity(…, 'owner-person')` keeps `source='manual'` via `preserveManualSource` but
   **repoints `identityId`** (`server/src/repositories/face-identity.repository.ts`, around
   `:2344-2364`).
5. `processSpaceFaceMatch` then runs. `selectedSpaceAssignments` is the row the confirm wrote, so
   `length > 0` is true; `isExactSelectedSpaceAssignment` is false because the identity moved; and
   `removePersonFaceAssignmentsForSpaceFace(spaceId, face.id)` (`shared-space.service.ts` around
   `:2815`) **deletes the confirmed row** before attaching the face to a different space person.

Net: the confirm disappears, and because there is deliberately no `confirmed` status, nothing records
that it happened. It only survives when recognition happens to route the face to the personal person
backing that space person.

**F10, separately:** those four writes are autocommit. Failing after `replaceFaceIdentity` but before
`addPersonFaces` leaves a `'manual'`-linked face attached to nobody — excluded from every suggestion
read and every cleanup scan, with no repair path, because `processSpaceFaceMatch` early-returns on
`if (!face.personId)`. The personal confirm path was deliberately wrapped in a transaction; the space
twin was not.

## Locked decision (spec §4) — do not substitute your own

The fix is **"recognition never claims a face a human has already placed"**, not "the space confirm
writes `asset_face.personId`". The rejected alternative would mean an editor's action in a shared
space writing into the _asset owner's_ personal people, a cross-owner side effect. If you believe the
alternative is better, report the argument — do not silently switch.

## Files

| File                                                                              | Change                                                     |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `server/src/repositories/person.repository.ts`                                    | `getAllFaces` gains `excludeManuallyPlaced?: boolean`      |
| `server/src/services/person.service.ts`                                           | the **non-forced** recognition feed passes it              |
| `server/src/services/shared-space.service.ts`                                     | wrap `confirmSpacePersonFaceSuggestion` in one transaction |
| `server/src/repositories/shared-space.repository.ts`                              | `addPersonFaces` gains a `db` parameter                    |
| `server/test/medium/specs/services/face-review-cross-flow.spec.ts`                | S5.4, S5.5, S5.6                                           |
| `server/test/medium/specs/repositories/person.repository.spec.ts`                 | S5.1–S5.3                                                  |
| `server/test/medium/specs/services/shared-space-face-suggestions.service.spec.ts` | S5.8–S5.10                                                 |

## Implementation

1. **`getAllFaces` gains `excludeManuallyPlaced?: boolean`.** When set, add
   `NOT EXISTS (SELECT 1 FROM face_identity_face fif WHERE fif.assetFaceId = asset_face.id AND fif.source = 'manual')`.
   Default off, so every other caller is unchanged.
2. **`handleQueueRecognizeFaces` passes `excludeManuallyPlaced: true` on the non-forced branch only.**
   The forced branch (`{ sourceType: MachineLearning }` with no `personId` filter) runs _after_
   `unassignFaces` has already deleted every `face_identity_face` row, so there is nothing to preserve
   and passing it there would be meaningless. Read the surrounding code and confirm that ordering
   before you rely on it.
3. **Wrap the space confirm.** Move the four writes into
   `this.databaseRepository.transaction(async (trx) => { … })`, threading `trx` into
   `ensureSpacePersonIdentity`, `claimPendingForSpacePerson`, `replaceFaceIdentity`,
   `resolveAssignedFace` and `addPersonFaces`. The reads before them — `requireRole`,
   `requireSpacePersonInSpace`, the config read, `hasPendingForSpacePerson` — stay **outside**.
   `addPersonFaces` currently takes `(values, options?)` and no `db`; add one, defaulting to
   `this.db`, matching the sibling repository methods. Slice 3 may already have added a `db` parameter
   to `claimPendingForSpacePerson` — check before adding a second one.
   Never call a `this.db` method inside the callback (issue #595).

## Tests

Every absence assertion needs a positive control in the same test body (spec §2).

| #     | Layer  | Test                                                                                                                                                                                                                                                                                                                                                    |
| ----- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S5.1  | medium | `getAllFaces({ personId: null, sourceType: ML, excludeManuallyPlaced: true })` omits a face carrying a `manual` link and yields an unassigned control face with no link                                                                                                                                                                                 |
| S5.2  | medium | **pin** — the same query **without** the option still yields the manual-linked face                                                                                                                                                                                                                                                                     |
| S5.3  | medium | **pin** — `getAllFaces({ sourceType: ML })` (the force-branch shape) is unchanged                                                                                                                                                                                                                                                                       |
| S5.4  | medium | **BDD, the revert chain.** **Given** an editor has confirmed face F on space person S, **When** a non-forced `handleQueueRecognizeFaces` runs and every queued `handleRecognizeFaces` job is executed, **Then** F was not queued, `shared_space_person_face` still holds `(S, F)`, and the face's `face_identity_face.identityId` is still S's identity |
| S5.5  | medium | Red proof of S5.4 before the fix: the `(S, F)` row is gone. Fold into S5.4 once green rather than keeping both                                                                                                                                                                                                                                          |
| S5.6  | medium | A face carrying an `ml` / `owner-person` / `backfill` link **is** still queued by non-forced recognition — only `manual` is excluded (control for S5.1)                                                                                                                                                                                                 |
| S5.7  | medium | **pin** — personal confirm is unaffected: it sets `asset_face.personId`, so the `personId: null` filter already excluded it                                                                                                                                                                                                                             |
| S5.8  | medium | Fault injection: make `addPersonFaces` throw inside the space-confirm transaction ⇒ all four writes rolled back — the pending row is still `pending`, no `manual` link exists, no `sspf` row exists                                                                                                                                                     |
| S5.9  | medium | Fault injection at `replaceFaceIdentity` ⇒ the same all-or-nothing assertion                                                                                                                                                                                                                                                                            |
| S5.10 | medium | **pin** — double-submit under the transaction still resolves exactly once (`claimed === 0` on the second call)                                                                                                                                                                                                                                          |

S5.4 is the load-bearing test and the hardest to set up: it needs a real space, a contributed asset,
an editor, a pending suggestion inside the band, and then a full recognition cycle. Read
`face-review-cross-flow.spec.ts` for the existing embedding/space fixtures (`newSuggestionSpace`,
`newSuggestionAnchoredSpacePerson`, `newSuggestionCandidateFace`) and the recognition setup a previous
slice added to `person.service.spec.ts` (medium) for `handleRecognizeFaces`. Reuse both; do not invent
new fixture helpers.

## Verification

```bash
cd server
pnpm exec vitest --config test/vitest.config.medium.mjs --run \
  test/medium/specs/repositories/person.repository.spec.ts \
  test/medium/specs/services/face-review-cross-flow.spec.ts \
  test/medium/specs/services/shared-space-face-suggestions.service.spec.ts \
  test/medium/specs/services/person.service.spec.ts
npx tsc --noEmit -p tsconfig.json
npx eslint src/repositories/person.repository.ts src/repositories/shared-space.repository.ts src/services/person.service.ts src/services/shared-space.service.ts --max-warnings 0
npx prettier --check src/repositories/person.repository.ts src/repositories/shared-space.repository.ts src/services/person.service.ts src/services/shared-space.service.ts
```

## Constraints

- `pnpm test -- --run <path>` silently drops the path filter — use the forms above.
- Run **tsc and eslint**, not only vitest. Two earlier slices shipped type and lint errors that
  vitest does not catch and that fail CI.
- Never run a `this.db` query inside a `this.db.transaction()` callback (issue #595).
- Never run `make sql` / `mise //:sql` — report which `.sql` files are stale instead
  (`person.repository.sql` and `shared.space.repository.sql` are likely).
- Do not add `Co-Authored-By` or "Generated with" trailers. Do not commit.

## Commit

```
fix(face-review): keep human face placements out of automatic recognition
```
