# Same-Scope Merge Collapse Implementation Plan

**Goal:** Make `mergeScopedPeople` (`POST /people/same-person`) collapse same-physical-scope duplicates instead of refusing them, and narrow the permission gate so a user can merge their own personal people and editor-space people. Server-side fix; every UI entry point benefits without per-screen routing changes.

**Spec:** `docs/plans/2026-05-29-same-scope-merge-collapse-design.md` (read it first — this plan implements it exactly; do not diverge without updating the spec).

**Method:** Strict TDD, red-green-refactor. Every behaviour gets the smallest failing test, observed failing _for the expected reason_, before the minimal production code that passes it. Land the repository collapse before the service flips off the `hasScopedProfileConflict` throw, so the service never calls into an unimplemented collapse.

**Tech stack:** NestJS services/repositories, Kysely (transaction-aware), Vitest unit + medium (testcontainers) tests, Playwright/Vitest e2e.

---

## Reference — exact code touchpoints

- `server/src/repositories/face-identity.repository.ts`
  - `mergeIdentities` (line ~2496) — add opt-in collapse; keep the existing body as "identity finalisation".
  - `countMergeConflicts` (~2596) / `getMergeConflicts` (~2637) — unchanged; still used by automatic reconciliation.
  - `linkPersonFaces` (~2007) — parameterise with an optional executor for reuse on `trx`.
  - `resolveRepairRefs` (~1128) + `RepairRefsResolution` type (~122) — change the permission fields (Task 4).
  - `areAttachedProfilesRepairable` (~1303) / `hasRepairProfileConflict` (~1333) — replace with a per-conflict-scope check (Task 4).
- `server/src/services/person.service.ts`
  - `mergeScopedPeople` (~169) — gate change + pass `collapseScopedConflicts: true`.
- `server/src/repositories/shared-space.repository.ts`
  - `reassignPersonFacesSafe` (~1539), `recountPersons` (~1798), `deletePerson` (~1486) — SQL to mirror on `trx` (do **not** call directly inside the transaction).
- `server/src/repositories/person.repository.ts`
  - `reassignFaces` (~115, `UpdateFacesData`) — SQL to mirror on `trx`.
- Schema (cascade facts, already verified): `person_face_suggestion.personId`, `shared_space_person_face.personId`, `shared_space_person_alias.personId` are all `ON DELETE CASCADE`. Partial-unique indexes: `person_ownerId_identityId_key`, `shared_space_person_spaceId_identityId_key`. **No DB migration is required** — this change is behavioural (an opt-in flag plus new read queries), with no schema change.

### Test commands

```bash
# server unit (focused)
pnpm --dir server test src/services/person.service.spec.ts -- --run -t "<name>"
# server medium (real DB via testcontainers)
pnpm --dir server test:medium test/medium/specs/repositories/face-identity.repository.spec.ts -- --run -t "<name>"
# e2e api (needs the e2e stack: `make e2e` once, or run against a `make dev` stack via `make e2e-api-dev`)
pnpm --dir e2e test server/api/person.e2e-spec.ts
# gates
pnpm --dir server lint && pnpm --dir server format && pnpm --dir server check
```

### Transaction discipline (applies to all repository tasks)

The collapse runs inside `mergeIdentities`' existing `this.db.transaction()`. **Every collapse query runs on `trx`.** Never call `this.db`-based helpers (`reassignPersonFacesSafe`, `recountPersons`, `reassignFaces`, `resolveAssignedFace`, the un-parameterised `linkPersonFaces`) inside the transaction — that reserves a second pool connection and deadlocks the 10-connection pool (issue #595, `feedback_kysely_no_thisdb_in_transaction`). Reuse SQL either by (1) parameterising the helper with `db: Kysely<DB> | Transaction<DB> = this.db` and passing `trx`, or (2) inlining the equivalent SQL on `trx`.

---

## Coverage Matrix — every spec test maps to a task

| Spec test (from `## TDD Requirements`)                                          | Task | Layer            |
| ------------------------------------------------------------------------------- | ---- | ---------------- |
| same-space collapse, conflict-safe both-rows face                               | 1    | medium repo      |
| same-owner collapse, `linkPersonFaces` unlinked-face, name/birthDate fill       | 1    | medium repo      |
| source `person_face_suggestion` rows gone after collapse (cascade)              | 1    | medium repo      |
| survivor selection (target present → survives; absent → lowest-id source)       | 2    | medium repo      |
| two source identities in one scope, target absent → single survivor, no UQ viol | 2    | medium repo      |
| multi-source batch, some scopes conflict & some don't                           | 2    | medium repo      |
| pet-type collapse                                                               | 2    | medium repo      |
| hidden survivor/source preserved                                                | 2    | medium repo      |
| cross-scope non-conflict: personal + space (diff scope) → both survive          | 2    | medium repo      |
| cross-scope non-conflict: two spaces → both survive                             | 2    | medium repo      |
| legacy `collapseScopedConflicts: false` no-op/`NOT EXISTS` preserved            | 1    | medium repo      |
| `getMergeConflicts` still reports counts                                        | 1    | medium repo      |
| idempotency of collapsing merge                                                 | 2    | medium repo      |
| concurrency (overlapping merges) — if feasible                                  | 2    | medium repo      |
| same-space refs (editor) → `mergeIdentities(collapse:true)`, no throw           | 4    | service unit     |
| permission narrowing: own personals + view-only no-collision → success          | 3, 4 | service + medium |
| both in view-only space → `Forbidden` w/ space-named message                    | 3, 4 | service + medium |
| mixed: repairable conflict + unrelated view-only no-conflict → success          | 4    | service unit     |
| preserve: non-repairable/inaccessible selected ref → `BadRequest`               | 4    | service unit     |
| preserve: incompatible type → `BadRequest`                                      | 4    | service unit     |
| preserve: success queues `SharedSpacePersonMetadataBackfill`                    | 4    | service unit     |
| reconciliation still skips conflicts, never passes `collapse:true`              | 5    | service unit     |
| `mergeSpacePeople` / `mergePerson` unchanged                                    | 5    | service/medium   |
| route: same-space merge → success, combined counts                              | 6    | e2e              |
| route: non-admin editor same-space → success                                    | 6    | e2e              |
| route: non-admin own personals also in view-only (no collision) → success       | 6    | e2e              |
| route: viewer both-in-view-only-space → `Forbidden` space-named                 | 6    | e2e              |
| route: navigate to collapsed source id → not found                              | 6    | e2e              |

---

## Task 0 — Baseline regression audit

Confirm the suites this plan touches are green before changing anything. Stop and fix any red before Task 1.

- [ ] Run and confirm PASS:

```bash
pnpm --dir server test src/services/person.service.spec.ts -- --run -t "scoped people repair|mergePerson"
pnpm --dir server test:medium test/medium/specs/repositories/face-identity.repository.spec.ts -- --run
pnpm --dir server test src/services/shared-space.service.spec.ts -- --run -t "mergeSpacePeople|reconcil|dedup"
```

---

## Task 1 — Repository: opt-in collapse in `mergeIdentities` (same-space + same-owner)

**Files:** `server/src/repositories/face-identity.repository.ts`, `server/test/medium/specs/repositories/face-identity.repository.spec.ts`

- [ ] **Step 1 (RED): same-space collapse test.** In the medium spec, add a test under `describe(FaceIdentityRepository.name, …)`: create one space, two `shared_space_person` rows (target identity + source identity) each with `shared_space_person_face` links — include one `asset_face` linked to **both** rows. Call `sut.mergeIdentities({ targetIdentityId, sourceIdentityIds:[source], source:'manual', collapseScopedConflicts:true })`. Assert: one `shared_space_person` remains in the space on the target identity; its `shared_space_person_face` set is the **union** (no PK violation, no duplicate); the source `shared_space_person` row is gone; the source `face_identity` row is deleted. Run → **RED** (flag unknown / not collapsing).

```bash
pnpm --dir server test:medium test/medium/specs/repositories/face-identity.repository.spec.ts -- --run -t "collapses two same-space"
```

- [ ] **Step 2 (RED): same-owner collapse test.** Two `person` rows owned by one user (target + source identities). Give the source person a face with **no** `face_identity_face` row yet, and leave the survivor `name` empty while the source has a name. Merge with `collapseScopedConflicts:true`. Assert: one `person` remains on the target identity; `asset_face.personId` reassigned; **every** survivor face (including the previously unlinked one) has a `face_identity_face` row on the target identity; source person deleted; survivor `name` filled from source. Run → **RED**.

- [ ] **Step 3 (RED): suggestion cascade test.** Source person has a pending `person_face_suggestion`. After the same-owner collapse, assert no `person_face_suggestion` rows reference the deleted person. Run → **RED**.

- [ ] **Step 4 (implement).**
  - Add `collapseScopedConflicts?: boolean` to the `mergeIdentities` input type (default `false`).
  - Parameterise `linkPersonFaces(input, db: Kysely<DB> | Transaction<DB> = this.db)` and use `db` throughout it.
  - Inside the `mergeIdentities` transaction, **before** `countMergeConflicts`, when the flag is set:
    1. `SELECT … FOR UPDATE` the `face_identity` rows for `I = [target, ...sources]`.
    2. Load the `person` and `shared_space_person` rows whose `identityId IN I`, grouped by physical scope (`ownerId` / `spaceId`).
    3. For each scope with ≥2 rows from `I`, pick the survivor (row on the target identity, else lowest `id`) and collapse the rest, all on `trx`:
       - **personal:** fill survivor `name`/`birthDate` if empty; `UPDATE asset_face SET personId = survivor WHERE personId = nonsurvivor`; `this.linkPersonFaces({ personId: survivor, identityId: target, source:'manual' }, trx)`; `DELETE FROM person WHERE id = nonsurvivor` (suggestions cascade).
       - **space:** conflict-safe reassign of `shared_space_person_face` (delete links already on survivor, then `UPDATE … SET personId = survivor`); recompute the survivor's `faceCount`/`assetCount` by mirroring `recountPersons`' self-contained `UPDATE shared_space_person` on `trx` — this is required, because `mergeSpacePeople` calls `recountPersons` explicitly and the queued `SharedSpacePersonMetadataBackfill` does **not** recompute per-space-person face/asset counts; `DELETE FROM shared_space_person WHERE id = nonsurvivor` (faces/aliases cascade).
  - Leave the existing body unchanged; after collapse `countMergeConflicts` returns 0 so the early-return path is not taken and the `NOT EXISTS` reassignments are no-conflict.
  - Run Steps 1–3 → **GREEN**.

- [ ] **Step 5 (RED→GREEN): legacy behaviour preserved.** Add/confirm a test: with `collapseScopedConflicts` omitted/`false`, a same-space conflict still produces the early-return no-op (`spaceProfileConflictCount: 1`, no rows moved). Confirm `getMergeConflicts` still returns the same-owner/same-space counts. Run → **GREEN** (no code change needed; this guards the default path).

- [ ] **Step 6 (refactor).** Factor the collapse into a private `collapseScopedConflicts(trx, { targetIdentityId, sourceIdentityIds })` helper for readability; no behaviour change. Re-run the whole medium repo spec:

```bash
pnpm --dir server test:medium test/medium/specs/repositories/face-identity.repository.spec.ts -- --run
```

- [ ] **Step 7 (commit).** `feat(server): collapse same-scope conflicts in identity merge (opt-in)`

---

## Task 2 — Repository: survivor selection, multi-source, cross-scope non-conflict, type/hidden, idempotency

**Files:** same medium spec + `face-identity.repository.ts` (only if a test exposes a gap).

- [ ] **Step 1 (RED): survivor selection.** (a) target identity has a profile in the scope → it survives. (b) target identity absent, two source identities present → the lowest-`id` source profile survives and is reassigned to the target identity. Run → **RED** if selection isn't deterministic over the full `I`.
- [ ] **Step 2 (RED): two source identities, one space, target absent** → single survivor, no `shared_space_person_spaceId_identityId_key` violation (the latent multi-source defect).
- [ ] **Step 3 (RED): multi-source batch** (target + 2 sources) with a conflict in one scope and none in another → conflicted scope collapses to one; non-conflicted scope reassigns with no deletion.
- [ ] **Step 4 (RED): pet type** — two pet `shared_space_person` rows in one space collapse identically (type carried through).
- [ ] **Step 5 (RED): hidden preserved** — collapsing a hidden source into a visible survivor (and vice versa) keeps the survivor's `isHidden`; merge is not gated on hidden (manual path).
- [ ] **Step 6 (RED): cross-scope non-conflict regressions** — (a) `person` (owner A) + `shared_space_person` (space X) → identity merge only, **both rows survive** on the target identity, nothing deleted. (b) two `shared_space_person` rows in **different** spaces → both survive.
- [ ] **Step 7 (RED): idempotency** — re-run the collapsing merge over the merged set; assert no row/identity changes.
- [ ] **Step 8 (RED, best-effort): concurrency** — if expressible in medium tests, two overlapping collapsing merges do not both delete the survivor / leave a duplicate; one wins, the other no-ops or errors without corrupting state (relies on the `FOR UPDATE` from Task 1).
- [ ] **Step 9 (implement gaps → GREEN).** Most pass from Task 1; fix only what a red test exposes (likely survivor-selection ordering and the source–source case). Re-run full medium spec.
- [ ] **Step 10 (commit).** `test(server): cover survivor selection, multi-source, cross-scope, idempotency for collapse`

---

> **Ordering note (compile safety).** `RepairRefsResolution` is shared by its producer (`resolveRepairRefs`) and consumer (`mergeScopedPeople`). Changing it is a breaking change for both. To keep every task `tsc`-green, this is done **additively** (Task 3 adds `blockingConflict` while keeping the old fields) then **switched** (Task 4 moves the service onto it and only then removes the dead fields). Do not remove `allAttachedProfilesRepairable`/`hasScopedProfileConflict` until Task 4 Step 6.

## Task 3 — Resolver: per-conflict-scope repairability (additive)

**Files:** `server/src/repositories/face-identity.repository.ts`, `server/test/medium/specs/repositories/face-identity.repository.spec.ts`

Implements the real DB check and surfaces it as a **new, additive** field. The build stays green because nothing is removed yet.

- [ ] **Step 1: additive type.** Add `blockingConflict?: { scope: 'space'; spaceId: string; spaceName: string } | { scope: 'personal' }` to the `accessible: true` branch of `RepairRefsResolution`. Keep `allAttachedProfilesRepairable` and `hasScopedProfileConflict` for now. (`blockingConflict === undefined` ⇒ every conflicted scope is repairable by the actor.)
- [ ] **Step 2 (RED, medium): space conflict in a view-only space → blocking.** Two identities each with a `shared_space_person` in one space where the actor is **Viewer**. Assert `resolveRepairRefs(actor, dto)` returns `blockingConflict: { scope:'space', spaceId, spaceName }`. Run → **RED**.
- [ ] **Step 3 (RED, medium): same conflict where actor is Editor → not blocking.** `blockingConflict: undefined`.
- [ ] **Step 4 (RED, medium): personal conflict in another user's scope → blocking.** Two identities each with a `person` owned by user U ≠ actor, surfaced via space refs in **different** editor spaces (so the only conflict is the unrepairable personal one). Assert `blockingConflict: { scope:'personal' }`.
- [ ] **Step 5 (RED, medium): own-personal + unrelated view-only space, no collision → not blocking** (tester Part 1). Two of the actor's `person` rows (a same-owner conflict, repairable) whose identities also each have a space-person in **different** view-only spaces (no same-space collision) → `blockingConflict: undefined`.
- [ ] **Step 6 (implement → GREEN).** Add `findBlockingMergeConflictScope(actorUserId, identityIds)`:
  - personal: `SELECT 1 FROM person WHERE identityId IN I AND ownerId <> actor GROUP BY ownerId HAVING count(DISTINCT identityId) >= 2 LIMIT 1` → `{ scope:'personal' }`.
  - space: group `shared_space_person` by `spaceId` for `identityId IN I`, left-join `shared_space_member` for the actor, take a space `HAVING count(DISTINCT identityId) >= 2` whose actor role is not owner/editor; return `{ scope:'space', spaceId, spaceName }` (join the space name). Prefer a space result over a personal one for the more actionable message.
    Populate `blockingConflict` in `resolveRepairRefs` from it; leave the old fields in place. Run → **GREEN**. Build still compiles (additive).
- [ ] **Step 7 (commit).** `feat(server): resolve per-conflict-scope repairability for scoped merge`

---

## Task 4 — Service: enable collapse, switch to `blockingConflict`, remove dead gate

**Files:** `server/src/services/person.service.ts`, `server/src/services/person.service.spec.ts`, `RepairRefsResolution` (cleanup) in `face-identity.repository.ts`.

Unit tests here mock `resolveRepairRefs`; the real resolver landed in Task 3.

- [ ] **Step 1 (RED): same-scope editor success.** Repurpose the existing test `rejects same-person repair when the scoped profiles conflict in the same owner or space` → `collapses same-scope conflicts the actor can repair`: mock `{ accessible:true, targetIdentityId, sourceIdentityIds, type, blockingConflict: undefined }`; assert `mergeIdentities` called with `{ …, source:'manual', collapseScopedConflicts:true }` and **no throw**. Run → **RED**.
- [ ] **Step 2 (RED): blocking conflict → Forbidden.** Repurpose `rejects global merge when an involved identity has inaccessible attached profiles` → mock `blockingConflict: { scope:'space', spaceId, spaceName:'Holidays' }`; assert `ForbiddenException` whose message names the space; `mergeIdentities` not called. Run → **RED**.
- [ ] **Step 3 (RED): mixed repairable conflict + unrelated view-only attachment** → `blockingConflict: undefined` → success with `collapseScopedConflicts:true`.
- [ ] **Step 4 (update preserved tests).** `rejects same-person repair for inaccessible scoped profiles` (accessible:false → `BadRequest`) stays. `merges same-person repair only after access and repairability checks` → add `collapseScopedConflicts:true` to the expected `mergeIdentities` call; keep the `SharedSpacePersonMetadataBackfill` queue assertion. (Incompatible type still returns `accessible:false, reason:'incompatible-type'` → `BadRequest`; keep/observe that test.)
- [ ] **Step 5 (implement → GREEN).** In `mergeScopedPeople`: after the `accessible` check, `if (resolved.blockingConflict) throw new ForbiddenException(<space-named message | generic personal message>)`; delete the `allAttachedProfilesRepairable` `ForbiddenException` and the `hasScopedProfileConflict` `BadRequestException`; call `mergeIdentities({ targetIdentityId, sourceIdentityIds, source:'manual', collapseScopedConflicts:true })`. Run service spec → **GREEN**.
- [ ] **Step 6 (cleanup → still green).** Now that no caller reads them, remove `allAttachedProfilesRepairable` and `hasScopedProfileConflict` from `RepairRefsResolution` and from `resolveRepairRefs`, and delete the now-dead private `areAttachedProfilesRepairable` / `hasRepairProfileConflict` (grep to confirm no other caller — `getMergeConflicts`/`countMergeConflicts` are separate and stay). Run `pnpm --dir server check` + both specs → **GREEN**.

```bash
pnpm --dir server test src/services/person.service.spec.ts -- --run -t "scoped people repair"
pnpm --dir server check
```

- [ ] **Step 7 (commit).** `feat(server): scoped merge collapses same-scope conflicts and narrows permission gate`

---

## Task 5 — Reconciliation & physical-endpoint regression

**Files:** `server/src/services/shared-space.service.spec.ts` (+ run mergePerson/mergeSpacePeople suites).

- [ ] **Step 1.** Confirm `applySharedSpaceIdentityReconciliationClaim` still preflights `getMergeConflicts`, skips on any conflict, and calls `mergeIdentities` **without** `collapseScopedConflicts` (default false). Add an assertion if missing.
- [ ] **Step 2.** Run `mergeSpacePeople`, `mergePerson`, and the reconciliation/dedup suites; all green (the `linkPersonFaces` executor default keeps existing call sites identical).

```bash
pnpm --dir server test src/services/shared-space.service.spec.ts -- --run
pnpm --dir server test src/services/person.service.spec.ts -- --run -t "mergePerson"
```

- [ ] **Step 3 (commit, if any test added).** `test(server): guard reconciliation does not collapse on conflict`

---

## Task 6 — Route / e2e coverage

**Files:** `e2e/src/specs/server/api/person.e2e-spec.ts`, `e2e/src/specs/server/api/shared-space.e2e-spec.ts`

- [ ] **Step 1 (RED→GREEN).** Add e2e covering, via `POST /people/same-person`:
  - two same-space duplicates → 200; the surviving identity resolves to one accessible person with the **combined** asset and face counts.
  - a **non-admin editor** merges two duplicates in their editor space → success (Test case B for a non-admin).
  - a **non-admin** merges two of their own personal duplicates that also appear (no collision) in a view-only space → success (tester Part 1).
  - a **viewer** who owns two personal people whose identities ALSO collide as separate space-people in a space they can only view → `403` with the space-named message. (Note: a viewer passing the view-only `space-person` refs _directly_ yields `400` — a viewer cannot resolve a space-person ref it can't repair, so the conflict check is never reached. The `403` path requires the actor to select refs it CAN repair, here its own personal people.)
  - fetching the collapsed source profile id afterward → not-found.

```bash
# requires the e2e stack up (`make e2e`, or `make e2e-api-dev` against a `make dev` stack)
pnpm --dir e2e test server/api/person.e2e-spec.ts
```

- [ ] **Step 2 (commit).** `test(e2e): cover same-scope merge collapse and viewer refusal`

---

## Task 7 — Final verification & generated artifacts

- [ ] Regenerate the SQL snapshot for any new `@GenerateSql`-decorated query: `make sql` (updates `server/src/queries/face-identity.repository.sql`). No OpenAPI change is expected (no new endpoint/DTO); if a DTO did change, run `pnpm --dir server build && pnpm --dir server sync:open-api && make open-api`.
- [ ] Gates:

```bash
pnpm --dir server lint && pnpm --dir server format && pnpm --dir server check
pnpm --dir server test src/services/person.service.spec.ts -- --run
pnpm --dir server test:medium test/medium/specs/repositories/face-identity.repository.spec.ts -- --run
git diff --check
```

- [ ] Manual smoke (per spec): merge two same-space duplicates from the global `/people` page (was failing) and from the space grid; merge own personal duplicates as a non-admin; confirm a viewer is refused with the named message.
- [ ] **Commit.** `chore(server): regenerate SQL snapshot for scoped merge collapse`

---

## Task 8 — Web routing simplification (optional, non-blocking)

Per the spec's "Web Follow-up": with the server collapse in place, the per-screen merge routing can simplify to "personal-only batch ⇒ `mergePerson`; everything else ⇒ `mergeScopedPeople`," keeping the in-space `mergeSpacePeople` fast path. Out of scope for the core fix; do only after Tasks 1–7 are merged, and keep the existing web merge specs green (`web/src/.../person-detail-page.spec.ts`, `space-person-detail-page.spec.ts`, `person-merge-suggestion-modal.spec.ts`).

---

## Definition of Done

- Every Coverage-Matrix row has a green test that was first observed red.
- `mergeScopedPeople` collapses repairable same-scope conflicts and refuses unrepairable ones with a space-named `ForbiddenException`; tester Test case B and Part 1 both pass.
- Automatic reconciliation, `mergeSpacePeople`, and `mergePerson` behaviour unchanged.
- `pnpm --dir server lint && format && check` clean; SQL snapshot regenerated; `git diff --check` clean.
