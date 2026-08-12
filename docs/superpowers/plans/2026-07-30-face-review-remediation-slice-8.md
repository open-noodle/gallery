# Slice 8 — Verdict lifecycle: clearing and collection

**Spec:** [`2026-07-30-face-review-unification-remediation-slices.md`](../specs/2026-07-30-face-review-unification-remediation-slices.md)
(Slice 8, findings F15–F16)
**Branch:** `feat/face-review-unified`

## Goal

The verdict table never states a fact the rest of the system contradicts, and it does not grow without
bound.

## The two defects

**F15 — a negative verdict is never cleared when a human later places that face on that target.**
Every drain filters `status = 'pending'` (`resolveAssignedFace`, `drainPendingForFaces`,
`claimPending*` in `server/src/repositories/face-person-verdict.repository.ts`). Nothing deletes a
`rejected`/`ignored` row when the same (target, face) pairing is subsequently confirmed by a human.
Consequences, both real:

1. `GET /admin/face-repair/resolutions` lists "F is not Q" while F sits on Q — the page states a false
   fact.
2. If Q is later deleted and re-created, or a reset unassigns F, the stale negative means **the face a
   human explicitly placed on Q can never be suggested for Q again.**

**F16 — there is no GC.** No reaper for `face_person_verdict` exists anywhere in `server/src` (the only
deletes are the claims, the drains, `removeVerdicts`, the merge-collision delete, and the
`assetFaceId` CASCADE). "Reset all people" nulls `asset_face.personId`, deletes every
`face_identity_face` row, deletes faceless people (`personId` → NULL via `ON DELETE SET NULL`) and GCs
unreferenced identities (`identityId` → NULL). The result is rows with `personId`, `spacePersonId` and
`identityId` all NULL — matched by no read predicate, and retained until the face is **hard**-deleted.
Every user "not this person" decision is lost and the table grows monotonically.

## Locked decisions (spec §4)

- **Clearing:** a human placing face F on target T deletes any `rejected`/`ignored` row for `(T, F)`.
  The two facts are contradictory and the newer one wins. Verdicts against **other** targets are
  untouched — that scoping is the whole point, and getting it wrong destroys the console's semantics.
- **GC:** a row with all three keys NULL is unreachable and is collected by the existing
  `PersonCleanup` job. Rows retaining **any** target are kept.

## Files

| File                                                                           | Change                                                                                   |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `server/src/repositories/face-person-verdict.repository.ts`                    | `clearNegativeForTarget`, `deleteOrphanedVerdicts`                                       |
| `server/src/services/person.service.ts`                                        | call clearing from the human-placement paths; call the reaper from `handlePersonCleanup` |
| `server/src/services/shared-space.service.ts`                                  | call clearing from the space confirm                                                     |
| `server/src/services/face-repair.service.ts`                                   | call clearing from the move and lock buckets                                             |
| `server/test/medium/specs/repositories/face-person-verdict.repository.spec.ts` | S8.7, S8.9, S8.10                                                                        |
| `server/test/medium/specs/services/face-review-cross-flow.spec.ts`             | S8.1–S8.6                                                                                |
| `server/test/medium/specs/repositories/face-verdict-safety.spec.ts`            | S8.8                                                                                     |

Nothing else. Do not touch anything under `web/`, `e2e/`,
`server/src/repositories/person.repository.ts`, `shared-space.repository.ts` or `job.repository.ts`.

## Implementation

### 1. `clearNegativeForTarget(target, assetFaceIds, db?)`

Deletes rows with `status IN ('rejected','ignored')` for the given faces, matching the target the same
way the read paths do: by `personId`, by `spacePersonId`, **or** by `identityId` when the target
carries one. Signature should take a target descriptor (`{ personId?, spacePersonId?, identityId? }`)
rather than three separate methods.

Two things to get right:

- **Scope it to the target being placed onto.** A verdict against a _different_ person for the same
  face must survive. This is the same asymmetry `isSettledForOwner` already encodes.
- **Chunk the `assetFaceIds` `IN`-list** (the cleanup move path can pass up to 25 000), reusing
  `BULK_CHUNK_SIZE` in that file.
- **Keep a `db` parameter** so every caller can run it inside its existing transaction.

### 2. Call it from every human-placement path

- `person.service.ts`: `reassignFaces` and `reassignFacesById` (the face-editor paths), and inside
  `confirmFaceSuggestion`'s transaction.
- `shared-space.service.ts`: inside `confirmSpacePersonFaceSuggestion`'s transaction (added in an
  earlier slice — thread the same `trx`).
- `face-repair.service.ts`: `executeRepair`'s move path (clearing against the destination person), and
  the `lock` bucket (clearing against the reviewed person). Both are already transactional — join the
  existing transaction, do not open a new one.

Resolve the target's `identityId` from whatever the caller already has, rather than adding a lookup —
each of these sites already ensures or holds an identity.

### 3. `deleteOrphanedVerdicts()` and its call site

Deletes rows where `personId IS NULL AND spacePersonId IS NULL AND identityId IS NULL`. Bounded /
chunked so it cannot build one enormous statement.

Call it from `handlePersonCleanup` in `person.service.ts`, **after** `deleteUnreferencedIdentities()`
— the identity GC is what nulls the last key, so running before it would miss exactly the rows this
exists to collect. Verify that ordering in the current source before wiring it.

## Tests

Every absence assertion needs a positive control in the same test body (spec §2).

| #     | Layer  | Test                                                                                                                                                                                                                                               |
| ----- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S8.1  | medium | **BDD** — **Given** an admin kept F away from Q via the stay bucket, **When** the owner later places F on Q through the face editor, **Then** `listResolutions` no longer lists "F is not Q" (assert it DID list it before the placement)          |
| S8.2  | medium | The same placement leaves a `rejected` row for a **different** person R intact — the scoping control                                                                                                                                               |
| S8.3  | medium | Identity-keyed clearing: a verdict whose `personId` is NULL but whose `identityId` matches the target is cleared                                                                                                                                   |
| S8.4  | medium | The space confirm clears a negative recorded against that space person, and one recorded against its identity                                                                                                                                      |
| S8.5  | medium | A cleanup move to Q clears any negative for `(Q, F)`; the `lock` bucket clears any negative for the reviewed person                                                                                                                                |
| S8.6  | medium | **BDD, the follow-on defect** — **Given** the S8.1 sequence, **When** Q is deleted and re-created and a suggestion scan runs, **Then** F is offered again. Assert it is NOT offered without the clearing fix (that is the red)                     |
| S8.7  | medium | `deleteOrphanedVerdicts` deletes an all-keys-NULL row and **keeps** rows retaining `personId` only, `spacePersonId` only, and `identityId` only — four assertions, one test                                                                        |
| S8.8  | medium | **BDD, reset** — **Given** verdicts of every shape, **When** a forced recognition run completes (`unassignFaces` → `handlePersonCleanup` → `deleteUnreferencedIdentities`), **Then** no fully-orphaned row survives and rows with a live target do |
| S8.9  | medium | The reaper runs **after** the identity GC: seed a row whose only key is an identity that the GC removes in the same run, and assert the row is gone. Ordered the other way it would survive — that is the discriminating case                      |
| S8.10 | medium | The reaper and the clearing both handle a large id set without a bind-parameter error (bulk-seed; do not loop single inserts)                                                                                                                      |

## Verification

```bash
cd server
pnpm exec vitest --config test/vitest.config.medium.mjs --run \
  test/medium/specs/repositories/face-person-verdict.repository.spec.ts \
  test/medium/specs/repositories/face-verdict-safety.spec.ts \
  test/medium/specs/services/face-review-cross-flow.spec.ts \
  test/medium/specs/services/face-repair.resolutions.spec.ts \
  test/medium/specs/services/face-repair.resolve.spec.ts
pnpm exec vitest --config test/vitest.config.mjs --run src/services/person.service.spec.ts src/services/shared-space.service.spec.ts src/services/face-repair.service.spec.ts
npx tsc --noEmit -p tsconfig.json
npx eslint <the files you touched> --max-warnings 0
npx prettier --check <the files you touched>
```

`face-repair.resolve.spec.ts` (~81 tests) and `face-person-verdict.repository.spec.ts` (~80) are the
regression nets — both must stay green. Always check the reported test COUNT; a vitest invocation that
matched zero files reports a clean pass.

## Constraints

- `pnpm test -- --run <path>` silently drops the path filter — use the forms above.
- **`vitest` does not typecheck.** Run tsc, eslint and prettier and show their output.
- Never run a `this.db` query inside a `this.db.transaction()` callback (issue #595) — every call site
  here is inside an existing transaction, so thread the handle.
- If you break a spec outside the file table, **report it with the exact fix** rather than editing it.
  This has caught five real breakages in this series; check actively.
- Never run `make sql` / `mise //:sql` — report which `.sql` files are stale.
- Do not add `Co-Authored-By` or "Generated with" trailers. Do not commit.

## Commit

```
fix(face-review): clear contradicted verdicts and collect orphaned ones
```
