# Same-Scope Merge Collapse Design

## Problem

Merging two duplicate people that already have separate profiles **in the same physical scope** fails. The manual scoped-merge endpoint (`POST /people/same-person` → `PersonService.mergeScopedPeople`) rejects the operation instead of combining the duplicates.

Field evidence (tester report, `brainstorm-people-merge-propagation` line):

- Merging two space people that are both visible in the **same shared space** always fails with `Cannot merge people that already have separate profiles in the same scope`. Reproduced across three independent person pairs; behaviour is 100% consistent.
- Merging two personal duplicates from `/people` works **only** when both resolve to personal profiles (classic `mergePerson`). When either duplicate's accessible primary profile is a space person, the merge is routed to `mergeScopedPeople` and hits the same wall.

The user intent is unambiguous: "these two entries are the same person, combine them." Refusing the merge is a defect, not a guard.

## Background — Why It Fails Today

There are three real merge paths, each with a distinct contract:

| Path                        | Endpoint                                                       | Behaviour                                                                                                                                                  |
| --------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Personal physical merge     | `POST /people/:id/merge` (`mergePerson`)                       | Reassign `asset_face.personId` source→target, **delete the source `person` row**, then `mergeIdentities`.                                                  |
| Same-space physical merge   | `POST /spaces/:id/people/:personId/merge` (`mergeSpacePeople`) | Reassign `shared_space_person_face` source→target, recount, **delete the source `shared_space_person` row**, then `mergeIdentitiesForSpacePersonEvidence`. |
| Cross-scope identity repair | `POST /people/same-person` (`mergeScopedPeople`)               | Resolve scoped refs, validate access/type, then `mergeIdentities`. **Never deletes a profile row.** Currently throws on any same-scope conflict.           |

The two physical paths already use a **collapse-then-merge** sequence: they delete the duplicate row _before_ calling `mergeIdentities`. By the time `mergeIdentities` runs, there is no same-scope conflict, so its internal guard passes. This is why `mergePerson` (Test case A) works.

`mergeScopedPeople` skips that collapse step. It calls `mergeIdentities` while **both** profile rows still exist. Two layers then refuse the operation, because a naive `identityId` reassignment would violate the partial-unique indexes `person_ownerId_identityId_key` and `shared_space_person_spaceId_identityId_key`:

1. **Service gate** — `person.service.ts:177` throws `BadRequestException` when `resolveRepairRefs` reports `hasScopedProfileConflict`.
2. **Repository no-op** — `face-identity.repository.ts` `mergeIdentities` preflights `countMergeConflicts` and **returns early doing nothing** when any conflict exists; its `person`/`shared_space_person` reassignments additionally carry `NOT EXISTS` guards that would otherwise leave the conflicting source row orphaned.

Both layers were introduced to protect **cross-scope** merges (personal + space, or space + space across _different_ spaces) from clobbering two legitimately-separate profiles. They are too broad: two profiles in the **same** physical scope being merged is exactly the case where collapsing one **is** the correct merge.

## Vocabulary

- **Physical scope**: the uniqueness boundary for a profile row. For a `person` it is its `ownerId`; for a `shared_space_person` it is its `spaceId`.
- **Scoped profile**: a `person` row or a `shared_space_person` row.
- **Same-scope conflict**: two or more profiles that belong to the set of merged identities (target identity ∪ source identities) and share one physical scope.
- **Collapse**: move all backing faces from a redundant profile onto the surviving profile in that scope, link those faces to the target identity, then delete the redundant row. Child rows that reference the deleted profile by foreign key — `shared_space_person_face`, `shared_space_person_alias`, and `person_face_suggestion` — are all `ON DELETE CASCADE`, so anything not explicitly moved first is removed with the row.
- **Survivor**: the single profile that remains in a physical scope after collapse, carrying the target identity.

## Design Direction

Make `mergeScopedPeople` resolve same-scope conflicts by **collapsing** them, the same way the dedicated physical-merge endpoints already do, instead of refusing. The cross-scope identity repair becomes a universal manual merge: regardless of which physical tables the selected profiles live in, "merge these people" succeeds and yields one profile per physical scope plus one unified identity.

The collapse runs **before** the identity link reassignment, inside the same database transaction as `mergeIdentities`, so the whole operation is atomic.

This refines — it does not contradict — the existing merge-cases design (`docs/superpowers/specs/2026-05-05-accessible-identity-merge-cases-design.md`). That design's "reject same-scope conflict / do not delete a space person row in a cross-scope merge" rule exists to keep merges across _different_ scopes from deleting legitimately-separate profiles. Same-physical-scope collapse is the deliberately-excluded case where deletion is the intended outcome. The earlier design routed same-scope merges to the physical endpoints via the UI; this design centralises that responsibility on the server so every entry point (people detail page, person-merge suggestion modal, command palette, and any direct API caller) is correct without per-screen routing logic.

## Collapse Semantics

Let `I = {targetIdentityId} ∪ sourceIdentityIds`. After a successful merge:

- Every face that backed any profile of an identity in `I` backs the target identity.
- Within each physical scope, there is **exactly one** surviving profile, and it carries the target identity.
- Source identities with no remaining profiles and no remaining face links are deleted.

### Survivor selection (deterministic)

Within one physical scope (one `ownerId`, or one `spaceId`), among all profiles whose identity is in `I`:

1. Prefer the profile already on the **target** identity.
2. Otherwise pick the lowest stable id, so re-runs and concurrent jobs converge on the same survivor.

This also fixes a latent defect in the current `NOT EXISTS` reassignment: when two **source** identities each have a profile in a scope where the target identity has none, today's single `UPDATE` reassigns both to the target identity and violates the partial-unique index. Survivor selection over the full set `I` collapses those too.

Each collapse mirrors the data steps of the matching physical-merge endpoint. Because the collapse runs inside the `mergeIdentities` transaction, those steps must be issued on the transaction handle, not via the existing `this.db`-based repository helpers (see [Transaction discipline](#transaction-discipline)); the helper names below identify the SQL to reuse, not methods to call directly.

### Personal scope collapse

For a scope keyed by `ownerId` where a non-survivor `person` row exists (mirrors `mergePerson`):

- Before deleting, carry over display metadata only when the survivor lacks it (`name`, `birthDate`), matching `mergePerson`'s fill-if-empty behaviour.
- Reassign `asset_face.personId` from the redundant person to the survivor (the SQL of `personRepository.reassignFaces`).
- Link the survivor's faces to the target identity (the SQL of `faceIdentityRepository.linkPersonFaces`, `source: 'manual'`) so faces that had no prior `face_identity_face` row are covered — `mergeIdentities`' own face-link reassignment only moves rows that already point at a source identity.
- Delete the redundant `person` row. Its pending `person_face_suggestion` rows cascade-delete with it (no relink); the survivor keeps its own feature photo (`faceAssetId`).

Personal people counts are computed on read, so no recount is required.

### Space scope collapse

For a scope keyed by `spaceId` where a non-survivor `shared_space_person` row exists (mirrors `mergeSpacePeople`):

- Reassign `shared_space_person_face` from the redundant space person to the survivor using the **conflict-safe** form (`sharedSpaceRepository.reassignPersonFacesSafe` — delete the face links that already exist on the survivor, then move the rest), because `(personId, assetFaceId)` is the table's primary key.
- Resolve face suggestions for the moved faces (`resolveAssignedFace` per moved `assetFaceId`, as `resolveMovedSpacePersonFaces` does).
- Delete the redundant `shared_space_person` row. Its `shared_space_person_alias` rows cascade-delete (matching today's `mergeSpacePeople`, which does not migrate aliases — see Non-Goals).
- Recount the survivor (the SQL of `recountPersons`). Display metadata (name inheritance, representative face, thumbnail) is refreshed by the post-merge `SharedSpacePersonMetadataBackfill` job that `mergeScopedPeople` already queues — the survivor is the target row and keeps its own representative face until backfill runs, so no synchronous representative-face fix-up is needed.

### Identity finalisation

After every conflicted scope has exactly one surviving profile, the existing `mergeIdentities` body runs unchanged on the now conflict-free row set: surviving profiles still on a source identity are reassigned to the target identity (the `NOT EXISTS` guards now never fire because no scope holds two profiles from `I`), source-identity `face_identity_face` links are reassigned to the target identity, and source identities left with no profiles and no faces are deleted. `countMergeConflicts` returns zero after collapse, so the early-return no-op path is not taken.

### Transaction discipline

The collapse executes inside `mergeIdentities`' existing `this.db.transaction()`. Every collapse query **must** run on the transaction handle (`trx`). It must not call the existing `this.db`-based helpers (`reassignPersonFacesSafe`, `linkPersonFaces`, `recountPersons`, `resolveAssignedFace`, …) from inside the transaction: those issue queries on the base pool, and reserving a second connection while the transaction holds the first deadlocks against the 10-connection pool (the issue #595 failure mode — see `feedback_kysely_no_thisdb_in_transaction`). Implementation options, in order of preference:

1. Parameterise the reused helpers with an optional executor (`db: Kysely<DB> | Transaction<DB> = this.db`) and pass `trx`. This keeps one definition of each SQL and lets both the physical endpoints and the collapse share it.
2. Otherwise inline the equivalent SQL on `trx`.

Secondary, idempotent cleanups that are not integrity-critical (face-suggestion resolution, display-metadata inheritance, thumbnails) may instead run after the transaction commits or be left to the already-queued `SharedSpacePersonMetadataBackfill`, provided the integrity-critical mutations — face reassignment, face→identity linking, profile-row deletion, identity-link reassignment, identity cleanup — all commit atomically in the one transaction.

## Access and Permissions

**Product rule (decided):** a user may merge **(a)** their own personal people and **(b)** space people in spaces where they are owner/editor. A merge must never require modifying a scope the actor does not control.

Two gates enforce this. The first is unchanged; the second is **narrowed** from the current blanket attachment check.

1. **Every selected ref must be repairable by the actor** — `resolveRepairRefs`/`resolveRepairProfile` already require `person.ownerId = actor` for a personal ref and owner/editor membership for a space ref. A selected ref that is inaccessible or that the actor cannot repair ⇒ `BadRequestException` (not found / no access). _Unchanged._
2. **Every scope that requires a collapse must be repairable by the actor.** A collapse is required in a physical scope only when two or more of the merged identities (`I`) hold a separate profile there. For each such conflicted scope the actor must own it (personal `ownerId = actor`) or be owner/editor of the space. A required collapse in a scope the actor cannot repair ⇒ `ForbiddenException`. _This replaces the previous `allAttachedProfilesRepairable` rule._

### Why narrow, not drop, the attachment gate

The old `allAttachedProfilesRepairable` blocked the merge whenever **any** profile transitively attached to `I` lived in a space the actor could not edit — even a space not involved in any collision. That is what wrongly blocked a non-admin from merging their own duplicates (tester Part 1). The real invariant is narrower: completing a merge only requires editing a scope when that scope has a **same-scope conflict** (two profiles that must collapse to one to satisfy the partial-unique index). Reassigning a single profile's `identityId` (no deletion) is identity grouping, not space editing, and classic `mergePerson` already does it across view-only spaces today; matching that here keeps personal merges and editor-space merges working while still refusing to delete rows in a space the actor cannot edit.

Concretely, after this change:

- Two personal people the actor owns ⇒ merge succeeds; identity unification propagates into any spaces the identities appear in (collapsing nothing there unless both already appear separately in one space).
- Two space people in a space the actor edits ⇒ merge succeeds (tester Test case B for a non-admin editor).
- Two profiles whose identities **both** appear as separate space people in one space the actor can only **view** ⇒ refused with an actionable message (completing the merge would delete a row in that space). Defer to an editor of that space.
- A profile attached to a view-only space with **no** collision there ⇒ does not block the merge.

## Automatic Reconciliation Is Unaffected

`mergeIdentities` is also called by automatic, best-effort paths that must **not** collapse rows on conflict:

- `SharedSpaceService.applySharedSpaceIdentityReconciliationClaim` preflights `getMergeConflicts` and skips when any conflict exists.
- `mergeIdentitiesForSpacePersonEvidence` runs only after a physical same-space merge has already removed the conflict.

Collapse is therefore **opt-in**: `mergeIdentities` gains a `collapseScopedConflicts` option that defaults to `false` (today's behaviour: preflight counts, early-return no-op, `NOT EXISTS` guards). Only `mergeScopedPeople` passes `true`. `getMergeConflicts` and the early-return path are preserved for automatic callers. This keeps the existing reconciliation regression suites green.

## Atomicity, Idempotency, Concurrency

- The integrity-critical mutations execute in **one** `mergeIdentities` transaction (see Transaction discipline). A failure rolls back the whole merge — no half-collapsed state, no orphaned faces.
- Re-running the same merge is a no-op: after the first run the source profiles/identities are gone, so `resolveRepairRefs` returns "not found" for the stale refs and no rows change.
- Concurrency: today `mergeIdentities` runs no explicit row locks — it relies on transaction atomicity and the partial-unique indexes. To make a concurrent merge of an overlapping set deterministic rather than constraint-error-prone, the collapse transaction should `SELECT … FOR UPDATE` the candidate `face_identity` rows (target + sources) at the top of the transaction. The loser then either observes the merged state and no-ops, or fails its own transaction without corrupting state; a lost race must not hard-fail the user action. (This locking is a new requirement, not existing behaviour.)
- After a successful merge, queue `SharedSpacePersonMetadataBackfill` for the target identity (already done by `mergeScopedPeople`) so thumbnails, labels, and space metadata refresh.

## Error Handling

`mergeScopedPeople` outcomes after this change:

- Inaccessible / non-repairable **selected** profile ⇒ `BadRequestException` (unchanged).
- Incompatible type (person vs pet) ⇒ `BadRequestException` (unchanged).
- Same-scope conflict the actor **can** repair ⇒ **success with collapse** (was `BadRequestException`).
- Same-scope conflict in a scope the actor **cannot** repair ⇒ `ForbiddenException` with an actionable message naming the space and the role required, e.g. _"«Alice» and «Alice (2)» both appear in shared space «Holidays», which you can only view. Ask an editor of «Holidays» to merge them."_ (was the opaque `inaccessible attached profiles`).
- Stale / already-merged ref ⇒ not found / no-op (unchanged).

## TDD Requirements

Implementation is **test-first, red-green-refactor**. For each behaviour: add the smallest failing test, run it and confirm it fails _for the expected reason_, write the minimal production code to pass, re-run the focused test plus the nearest suite, then refactor on green. Do not add collapse production code before its red test has been observed failing. Commit history need not be one commit per test, but the working sequence must be test-first.

Suggested order (each step red-first): (1) repository same-space collapse, (2) repository same-owner collapse, (3) repository survivor-selection / source–source and multi-source cases, (4) repository cross-scope non-conflict regressions, (5) `mergeIdentities` opt-in flag preserves legacy behaviour, (6) service same-scope success + permission narrowing, (7) service permission refusal, (8) route/e2e. Land the repository collapse before the service flips off the `hasScopedProfileConflict` throw, so the service never reaches an unimplemented collapse.

### Repository (medium, real DB) — `server/test/medium/specs/repositories/face-identity.repository.spec.ts`

Collapse correctness (each RED first):

- Two `shared_space_person` profiles in the **same space** (`collapseScopedConflicts: true`) ⇒ one surviving space-person row on the target identity; all `shared_space_person_face` rows moved onto it (including the conflict-safe case where a face links to **both** rows — no PK violation, no duplicate link); source row deleted; emptied source identity deleted; survivor recounted.
- Two `person` profiles owned by the **same owner** ⇒ one surviving person row on the target identity; `asset_face.personId` reassigned; **all** survivor faces linked to the target identity in `face_identity_face`, including a face that had no prior identity link (proves the `linkPersonFaces` step, which the bare `mergeIdentities` reassignment would miss); source person deleted; empty `name`/`birthDate` filled from the source.
- Source person's pending `person_face_suggestion` rows are gone after collapse (cascade), and no stale suggestion points at a deleted person.
- Survivor selection: when the **target** identity has a profile in the scope it is the survivor; when it does not, the lowest-id source profile survives and is reassigned to the target identity (deterministic).
- Two **source** identities each with a profile in one scope where the target identity is absent ⇒ collapse to a single survivor without violating the partial-unique index (covers the latent multi-source defect).
- Multi-source batch (target + ≥2 sources) where conflicts exist in **some** scopes and not others ⇒ each conflicted scope collapses to one survivor; non-conflicted scopes reassign with no deletion.
- Collapse carries the entity `type` through (two **pet** space-people in one space collapse just like person profiles).
- Hidden survivor/source: a manual collapse merges regardless of hidden state and the survivor's hidden flag is preserved (manual merge is user-directed; hidden is not a gate here, unlike automatic reconciliation).

Cross-scope **non-conflict** regressions (must still pass, no row deleted):

- personal `person` (owner A) + `shared_space_person` (space X) — different scopes ⇒ identity merge only; both rows survive on the target identity.
- two `shared_space_person` rows in **different** spaces ⇒ both survive on the target identity.

Legacy / opt-out and counting:

- With `collapseScopedConflicts` defaulted/false, `mergeIdentities` keeps today's behaviour: `countMergeConflicts > 0` ⇒ early-return no-op, `NOT EXISTS` guards leave conflicting rows untouched.
- `getMergeConflicts` still reports same-owner and same-space conflict counts.

Idempotency & concurrency:

- Re-running the collapsing merge over the now-merged set changes nothing.
- (If feasible in medium tests) two overlapping collapsing merges do not both delete the same survivor or leave a duplicate; one wins, the other no-ops or errors without corrupting state.

### Service (unit) — `server/src/services/person.service.spec.ts`

- RED: `mergeScopedPeople` with two same-space space-person refs (actor is space editor) calls `mergeIdentities` with `collapseScopedConflicts: true` and **does not throw** (replaces the current `hasScopedProfileConflict` throw expectation).
- RED (permission narrowing — tester Part 1): a non-admin merging two of their **own** personal people whose identities are also attached to a space they only **view**, with **no** collision in that space, **succeeds** (was `ForbiddenException`).
- RED: merging two profiles whose identities **both** appear as separate space people in a **view-only** space ⇒ `ForbiddenException` carrying the actionable, space-named message.
- RED: a mixed batch with a same-space conflict the actor **can** repair plus an attachment in an unrelated view-only space (no conflict there) ⇒ succeeds (only conflicted scopes gate).
- Preserve: a selected ref the actor cannot access/repair ⇒ `BadRequestException`; incompatible type (person vs pet) ⇒ `BadRequestException`.
- Preserve: a successful merge queues `SharedSpacePersonMetadataBackfill` for the target identity.

### Automatic reconciliation regression — `server/src/services/shared-space.service.spec.ts`

- Preserve: `applySharedSpaceIdentityReconciliationClaim` still preflights `getMergeConflicts`, skips on any conflict, and never passes `collapseScopedConflicts: true`.
- Preserve: existing add-member / new-evidence / same-space dedup reconciliation tests stay green.
- Preserve: `mergeSpacePeople` and `mergePerson` behaviour is unchanged (their own suites stay green); if their reassign/link helpers are parameterised with an executor for reuse, the default-arg call sites keep identical behaviour.

### Route / end-to-end coverage — `e2e/`

- `POST /people/same-person` merging two same-space duplicates returns success and the surviving identity resolves to one accessible person with the combined asset and face counts.
- A **non-admin editor** of a space can merge two duplicates within that space via `POST /people/same-person` (tester Test case B for a non-admin).
- A **non-admin** can merge two of their own personal duplicates that also appear (without collision) in a view-only space.
- A **viewer** (non-editor) attempting to merge two profiles that both appear in that view-only space is refused with the space-named `ForbiddenException`.
- Navigating to the collapsed source profile id afterward returns not-found (expected; the row is gone).

## Web Follow-up (non-blocking)

With the server collapse in place, the per-screen routing that currently decides between physical and scoped endpoints can be simplified to "personal-only batch ⇒ `mergePerson`; everything else ⇒ `mergeScopedPeople`," because the scoped endpoint now handles same-space and same-owner batches correctly. The dedicated `mergeSpacePeople` in-space flow stays as a fast path. This cleanup is optional and out of scope for the core fix; it should keep the existing web merge specs green.

## Non-Goals

- Do not change automatic reconciliation policy (it continues to skip conflicts it cannot physically resolve first).
- Do not expose raw `face_identity.id` values.
- Do not unmerge identities on access loss.
- Do not allow a merge to delete or collapse a profile row in a scope the actor cannot edit (the narrowed gate still refuses this).
- Do not migrate per-user `shared_space_person_alias` rows off a collapsed space person — they cascade-delete, matching today's `mergeSpacePeople`. (Alias migration is a possible follow-up; if added, apply it to `mergeSpacePeople` too so the two paths stay consistent.)
- Do not make names or aliases automatic merge evidence.

## Resolved Decisions

1. **Tester Part 1 — non-admin merging own personal duplicates that also live in view-only spaces.** _Decided (2026-05-29):_ a user may merge their own personal people and space people in spaces where they are owner/editor. The blanket `allAttachedProfilesRepairable` gate is narrowed to a per-scope conflict-repairability gate (see Access and Permissions). The merge is refused only when completing it would require collapsing a row in a scope the actor can only view, and that refusal now carries an actionable, space-named message.
