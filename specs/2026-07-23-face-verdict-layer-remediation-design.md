# Face verdict layer remediation — closing the 2026-07-23 review findings on PR #834

**Branch:** `feat/face-review-unified` (PR #834), worktree `.claude/worktrees/face-unified`.
**Parent spec:** `2026-07-22-face-review-unification-design.md` (all § references below are to that document unless
prefixed "this doc").
**Review of record:** the five-agent review of 2026-07-23 (findings D1–D17 below). Every blocker was verified
end-to-end against the code before this spec was written; file:line references are from `feat/face-review-unified`
at `9ddea634a8`.

---

## 1. Goal

PR #834's contract — _a human decision recorded by either engine is never re-asked, silently reverted, or left
stale by the other_ — currently holds only for the **exact same target, in the same scope, with no merge in
between**. The cleanup engine implements the shared layer faithfully; the suggestion engine writes into the layer
but never reads from it, and the layer itself is not merge-durable. This spec closes every finding from the
review, TDD-first: each slice starts with a red test that reproduces the defect, and those tests remain as the
permanent regression suite. The branch must be green after every slice.

**Non-goals (unchanged from parent §5.5):** no mobile UI, no shared-space cleanup scanning, no snooze
server-side migration, no merged review surface. The two deferred parent follow-ups ("skipped: human-confirmed"
review section; user-facing undo-my-reject) stay deferred — but this spec corrects the parent's coverage-matrix
rows that claimed tests for them (Slice 10).

---

## 2. Defect inventory (from the 2026-07-23 review)

Severity: **B** blocker (truth layer broken), **M** major, **m** minor.

| ID  | Sev | Defect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | B   | **Merges destroy negative verdicts.** `face_person_verdict.identityId` is `ON DELETE CASCADE` (`face-person-verdict.table.ts:97`); nothing re-keys it (zero `updateTable('face_person_verdict')` sites); both identity-merge paths (`face-identity.repository.ts:3046-3106`, `:3108-3196`) and `deleteUnreferencedIdentities` (`:2450-2481`) count only person/space-person/face-link references before deleting identities. Person merge = `personId` SET NULL + identity CASCADE → row gone → decision re-asked.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| D2  | B   | **Suggestion-side verdict writes omit `identityId` and `actorId`** (`person.service.ts:399,406`; `shared-space.service.ts:1348-1349`), violating §5.1 rows 2–4. Rows orphan on person delete/merge; cross-scope identity matching can never fire for user verdicts; resolutions actor column is null. Unit tests pin the two-arg call (`person.service.spec.ts:6513`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| D3  | B   | **The suggestion engine never consults the shared exclusion layer.** `getNegativeVerdictTokens` and `getManualLinkedFaceIds` each have exactly one consumer (cleanup's `buildVerdictMaps`, `face-repair.service.ts:125-126`). Defect 5 of the parent (§2.4) is unimplemented: a reject in one scope re-asks in the other. Space **confirm** re-asks itself: `confirmSpacePersonFaceSuggestion` (`shared-space.service.ts:1296-1325`) writes the manual link + drain but never assigns `asset_face.personId`, writes no space projection, and queues no face-match — the same space's next scan re-proposes the face; so do the owner's personal scan and every other space.                                                                                                                                                                                                                                                           |
| D4  | B   | **Positive verdicts (`source='manual'`) are erased by three write sites** Slice 1 of the parent didn't cover: (a) `mergeIdentities` blanket-overwrites `source` on every link of the losing identity — the automatic `'shared-space-evidence'` reconciliation downgrades manual links (`face-identity.repository.ts:3046-3050`); (b) `handleRecognizeFaces`' already-assigned branch replaces the link with `'owner-person'` after a queued job races a user confirm (`person.service.ts:1297-1299` via the unconditional upsert at `face-identity.repository.ts:2337-2341`); (c) `linkPersonFaces`' backfill catch-all overwrites on conflict (`face-identity.repository.ts:2409-2414`). Flip side needing an explicit decision: people merges stamp `'manual'` onto every face of the merged cluster (`identity-merge-propagation.service.ts:330,368`), fabricating human placements that blind the cleanup scan to whole clusters. |
| D5  | M   | **Perpetual schema-drift warnings.** Migration 1787 stores all four partial-index overrides with a bare `WHERE "col" IS NOT NULL` (`1787000000000-AddFacePersonVerdict.ts:76-95`) while `schemaFromCode` emits it parenthesized — the exact bug migration 1784 (same PR) fixes for `face_repair_scan_in_flight_uq` — and `schema-drift.spec.ts:33-43` filters offenders to that one index, so CI cannot see the four new ones.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| D6  | M   | **RBAC leak:** `GET /people/:id/face-suggestions` is gated on `PersonRead` (= owner ∪ any space member, viewers included, `person.service.ts:340`; `utils/access.ts:319-326`) then reads unscoped — a viewer sharing one photo receives the owner's whole-library pending queue metadata.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| D7  | M   | **Admin cleanup surfaces render blind.** All face crops go through user-scoped `/people/...` thumbnail endpoints; `PersonRead` has no admin bypass and `face-repair-admin.controller.ts` has no thumbnail route → broken images for every non-owned cluster. The resolutions page fails **structurally**: `getRepresentativeFaceForUpdate` (`person.repository.ts:516`) joins face→person by assignment-or-identity-link, which a negative-verdict face by definition lacks toward its target — its `person.service.ts` callers (`:452`, `:489`) throw a 400, and the user-scoped crop endpoint 404s the unowned face image.                                                                                                                                                                                                                                                                                                          |
| D8  | M   | **Suggestion modal loses ~half the queue per pass and swallows action errors.** It pages with original offsets over a server list its own actions shrink (`PersonSuggestionReviewModal.svelte:76-118`), closing "complete" early; `act()`'s bare `catch` (`:135-137`) makes 500s/network drops indistinguishable from success.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| D9  | M   | **Space reject/ignore silently no-ops when the row isn't pending** (`shared-space.service.ts:1337-1350`); the personal path upserts unconditionally. A band shrink or drain race turns a user's "not this person" into nothing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| D10 | M   | **A user reject overwrites an existing keep-here row**, nulling its `identityId` and `actorId` and flipping `source` (unguarded `doUpdateSet`, `face-person-verdict.repository.ts:148-159`) — the strongest-keyed verdicts degrade to the weakest form.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| D11 | m   | `getPendingForPerson` (`face-person-verdict.repository.ts:344-353`) lacks the asset gates its space twin has (`af.isVisible`, `asset.deletedAt`, `asset.isOffline`, `asset.visibility`) — trashed/locked/offline assets surface in the personal queue.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| D12 | m   | Cleanup dashboard person counts (`getLatestScanStatus`, `face-repair.service.ts:576-584`) go stale when the suggestion engine settles faces after a scan.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| D13 | m   | `scripts/revert-to-immich.sql:218-286` override cleanup omits `index_face_repair_scan_in_flight_uq` → reverted upstream instances log override drift on every boot.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| D14 | m   | Personal confirm is four autocommit statements (`person.service.ts:369-390` → `reassignFacesById:260-277`) while `executeRepair` transacts the identical move+link pair for the documented backfill-revert hazard; the cleanup engine's two pending drains run outside their transactions (`face-repair.service.ts:315-319`, `:1029-1031`), and the suggestion engine's own drain likewise (`person.service.ts:267`, inside `reassignFacesById`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| D15 | m   | **Suite gaps that let D1–D4 ship green:** no test moves a negative verdict across any merge; cross-flow leak 1 swallows the confirm with `.catch(() => {})` (`face-review-cross-flow.spec.ts:186-189`); the parent's Slice-4 exclusion tests were never written; defect-5 scenarios absent (no space person in the cross-flow spec); keep-here's `identityId` never asserted; band boundaries unpinned; resolutions space-person/SET-NULL rendering untested (all fixtures `spacePersonId: null`); a repo spec's title claims CASCADE where schema says SET NULL (`face-person-verdict.repository.spec.ts:638-661`); the `.serial` e2e suite has documented order-coupling; no test loads a thumbnail.                                                                                                                                                                                                                                |
| D16 | m   | Hygiene: stale "face*repair_lock/decline" test titles (`face-repair.resolve.spec.ts:1264,1036`), controller summary "declines + locks" (`face-repair-admin.controller.ts:132` + regenerated clients), `@GenerateSql` params for the four `mark*`methods malformed (doc SQL only), 19 orphaned`admin.face_cleanup\*\*` keys in de/fr.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| D17 | m   | Web polish: snooze baseline never rebases and is keyed per person, not per user (`face-suggestion-snooze.ts:21-31`); modal back-nav re-enables acted rows; failed initial loads render as reassuring empty states (`resolutions/+page.svelte:52-62`, `[personId]/+page.svelte:157-161`); console bulk-apply partial failure skips the refetch (`admin/face-cleanup/+page.svelte:234-252`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

---

## 3. Design decisions

| Decision                                                                                          | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Verdicts follow the survivor** on every merge                                                   | Merges are the routine operation the identity-keying exists to survive. Both identity-merge paths re-key `face_person_verdict.identityId` to the target **inside the existing transaction, before** source identities are deleted; person/space-person merges re-target `personId`/`spacePersonId` to the survivor with a survivor-wins collision policy (if the survivor already holds a row for the same face, the source row is deleted — one verdict class, the survivor's standing answer is kept).                                                                                                                                                                                                                                                                            |
| **`identityId` FK flips `CASCADE` → `SET NULL`**                                                  | Defense-in-depth: any deletion path that misses re-keying (GC, future code) degrades the row to target-fallback matching instead of destroying it. Orphan rows (all keys NULL) remain unreachable-and-harmless per parent §4.1. `deleteUnreferencedIdentities` stays as-is — after re-keying, merge paths leave nothing behind, and GC-ing an identity referenced only by verdicts now degrades rather than destroys.                                                                                                                                                                                                                                                                                                                                                               |
| **Suggestion writers always carry `identityId` + `actorId` + `source`**                           | Matches §5.1 rows 2–4 as written. Writers call `ensurePersonIdentity`/`ensureSpacePersonIdentity` first (the space confirm path already does at `shared-space.service.ts:1315`), so the identity always exists at write time. No data backfill: the table has never shipped (RC databases are reset per the PR deploy note).                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **One shared exclusion provider, consumed by both engines**                                       | `buildVerdictMaps` moves out of `FaceRepairService` into a `FaceVerdictService` (thin: repos only, no engine deps) so `person.service` / `shared-space.service` consume it without a cleanup dependency. Suggestion scans exclude at **write time** (manual-linked faces and identity-or-target negative matches never become pending rows, per §5.2); the pending **reads** additionally gain manual-link and identity-negative anti-joins so rows settled after a scan self-heal out of the queue.                                                                                                                                                                                                                                                                                |
| **Space confirm writes the space projection**                                                     | The confirm's user-visible meaning in a space is "this face is this space person". Confirm inserts the `shared_space_person_face` projection row (same shape the face-match job writes) in the same operation as the link+drain, so the same space's scan candidate set (`getAssignedFaceIdsForSpace`) excludes it structurally, not just via the manual-link filter.                                                                                                                                                                                                                                                                                                                                                                                                               |
| **`'manual'` is only ever written by an explicit human placement; nothing else may overwrite it** | Extends the parent's Slice-1 rule to every write site: `mergeIdentities` preserves `'manual'` per-link (CASE, like `realignFacesToPersonIdentity:2694-2712`); `handleRecognizeFaces`' already-assigned branch skips the replace when the existing link is `'manual'`; `linkPersonFaces` conflict-update preserves `'manual'`. **Product decision (flagged for sign-off, default chosen):** people merges stop stamping `'manual'` on rode-along faces — the merge re-points identity but **preserves each face's prior source**. A merge is a person-level decision, not a per-face attestation; stamping fabricated positives blinds cleanup to entire merged clusters. The explicit face-level writers (confirm, move, lock, createFace, updateRepresentativeFace) are unchanged. |
| **Never weaken a verdict row in place**                                                           | `recordPersonalVerdict`/`recordSpacePersonVerdict` conflict-updates coalesce `identityId` (`COALESCE(EXCLUDED."identityId", existing)`) and keep last-human-wins for `status`/`source`/`actorId`. With D2 fixed the incoming write carries an identity anyway; the coalesce guards the degenerate caller.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Space reject reachability check decouples from pendingness**                                    | The `hasPendingForSpacePerson` gate doubled as the 3-path RBAC reachability check. It is replaced by an explicit face-reachability check (face's asset visible to the space via `spaceAssetPathBranches`), after which reject/ignore upsert unconditionally — matching the personal path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Admin thumbnails get their own face-keyed route**                                               | `GET /admin/face-repair/faces/:assetFaceId/thumbnail`, `@Authenticated({ admin: true })`, serves the crop by `asset_face` row alone (no person join — which is also why it fixes the resolutions 404). All four admin surfaces switch to it. User-scoped endpoints are untouched.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Personal suggestions read becomes owner-only**                                                  | Parent §5.5: personal suggestion review is an owner surface; space members have the space routes. `getFaceSuggestions` (+ reject/ignore/dismiss, already owner-only via `PersonUpdate`) requires ownership, mirroring `getFacesForPicker`'s non-owner refusal.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Edit migration 1787 in place; no fix-forward migration**                                        | Parent decision "authored in final form" still applies: nothing has shipped, RC DBs are reset. The four override strings gain parentheses to byte-match `asIndexCreate`; the drift spec flips from one-index filtering to **zero offenders overall**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Modal refetches from offset 0**                                                                 | Acted items vanish server-side, so the only stable cursor is the head of the list. The modal keeps a client-side `actedFaceIds` set to skip rows the server hasn't settled yet (benign-advance races), refetches page 1 when the buffer runs low, and closes only when a fresh page-1 fetch returns empty. Errors surface via `handleError`; only the documented already-resolved 400 advances silently.                                                                                                                                                                                                                                                                                                                                                                            |

---

## 4. Schema changes

All in `server/src/schema/migrations-gallery/1787000000000-AddFacePersonVerdict.ts` + `face-person-verdict.table.ts` (edited in place, parent §4 layout otherwise unchanged):

1. `identityId` FK: `ON DELETE CASCADE` → `ON DELETE SET NULL` (decorator + migration + generated SQL docs).
2. The four `migration_overrides` values gain parentheses: `WHERE ("personId" IS NOT NULL)` etc., byte-matching `asIndexCreate`.
3. No new tables, columns, or indexes. `face_repair_decline` keeps its name (parent §4.2's `face_repair_cluster_mute` rename remains unshipped; the parent doc gets a correction note in Slice 10).

`scripts/revert-to-immich.sql`: add `'index_face_repair_scan_in_flight_uq'` to the override-deletion list.

---

## 5. Behaviour deltas

### 5.1 Write-matrix corrections (rows renumbered from parent §5.1)

| #   | Action (actor)                          | Delta vs parent                                                                                                                                                                               |
| --- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2/3 | Reject / Ignore (user)                  | Now writes `+ (F, P, I(P))` **with `identityId`, `source='suggestion'`, `actorId`** — as §5.1 always specified. Space variants identical with the space-person target.                        |
| 2b  | Reject when a row exists                | Conflict-update coalesces `identityId`, never nulls it; `status`/`source`/`actorId` reflect the latest human.                                                                                 |
| 1s  | Confirm (space editor)                  | Additionally writes the `shared_space_person_face` projection row.                                                                                                                            |
| 12  | **Person/space-person merge** (new row) | Verdict rows re-target to the survivor (survivor-wins on collision); `face_identity_face` re-points **preserving per-face `source`**; verdict `identityId` re-keys to the surviving identity. |
| 13  | **Identity merge** (new row)            | Same re-key; automatic (`shared-space-evidence`) merges must not touch `'manual'` link sources.                                                                                               |

### 5.2 Read-path corrections

Both engines now genuinely apply the parent's three checks:

```
SUGGESTION SCAN + PENDING READS additionally exclude:
  face_identity_face.source = 'manual'                       (any identity — human already placed it)
  face_person_verdict status IN ('rejected','ignored')
      matched identity-first (I(target)) OR target token     (one "not Anna" answers every scope)
CLEANUP: unchanged (already correct), now consuming FaceVerdictService.
```

`getPendingForPerson` gains the space twin's asset gates. `GET /people/:id/face-suggestions` is owner-only.

---

## 6. Slice overview

| Slice | Delivers                                                                              | Closes      |
| ----- | ------------------------------------------------------------------------------------- | ----------- |
| 1     | Merge durability of verdicts (re-key, re-target, SET NULL)                            | D1          |
| 2     | Identity+actor on suggestion writes; coalescing upsert; space reject unconditional    | D2, D9, D10 |
| 3     | Shared exclusion provider consumed by the suggestion engine; space-confirm projection | D3          |
| 4     | `'manual'` preservation at every write site; merge-stamp policy                       | D4          |
| 5     | Override parenthesization + zero-offender drift gate + revert script                  | D5, D13     |
| 6     | Owner-only suggestions read; personal pending asset gates                             | D6, D11     |
| 7     | Admin face-thumbnail route + web wiring                                               | D7          |
| 8     | Modal paging/error correctness + web polish                                           | D8, D17     |
| 9     | Confirm transactionality, in-trx drains, dashboard staleness                          | D14, D12    |
| 10    | Suite hardening, hygiene, parent-doc corrections, regen, full gate                    | D15, D16    |

Each slice: red first, green, refactor, done gate run **in full by the driving session**, commit, push. The
branch stays green after every slice.

> **Red-command convention:** `pnpm test -- --run <path>` and `pnpm test:medium -- --run <path>` silently drop
> the path filter in this repo. Use `pnpm exec vitest --run <path>` (unit) and
> `pnpm exec vitest --config test/vitest.config.medium.mjs --run <path>` (medium) for every targeted run, then
> confirm the intended file actually executed.

---

## Slice 1 — Verdicts survive merges

**Goal:** D1. A negative verdict outlives person merges, space-person merges, identity merges, and identity GC.

**Changes:** re-key `face_person_verdict.identityId` in `mergeIdentities` and
`mergeIdentitiesAfterProfileResolution` (inside their existing transactions, before source-identity deletion);
re-target `personId`/`spacePersonId` in the person- and space-person-merge paths with survivor-wins collision
handling; flip the FK to SET NULL (schema §4 of this doc); update the false merge-safety comment at
`person.repository.ts:180-185`.

### TDD steps

1. **Red.** New medium spec `server/test/medium/specs/services/face-verdict.merge-durability.spec.ts`:
   - keep-here verdict `(F, Bob, I(Bob), rejected, cleanup)` → merge Bob into Robert (full service path) →
     assert the row exists with `identityId = I(Robert)` and is honoured by a cleanup scan (F not re-flagged
     toward Robert) **and** by `getNegativeVerdictTokens`.
   - suggestion reject (after Slice 2 lands this gains identity; here seed the row shape directly) → same merge
     → row survives via re-target.
   - identity-only merge (`mergeIdentities` with `shared-space-evidence`) → row re-keyed, not deleted.
   - collision: survivor already holds a rejected row for F → source row dropped, survivor row untouched.
   - GC: delete the person, leave the verdict, run `deleteUnreferencedIdentities` → row degrades to
     `identityId NULL` (SET NULL), is **not** deleted.
     Run: `cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/services/face-verdict.merge-durability.spec.ts`.
     Expected red: rows CASCADE-deleted / orphaned; scan re-flags.
2. **Green.** Implement re-key + re-target + FK flip.
3. **Refactor.** Extract the survivor-wins re-target into one repository helper used by both person and
   space-person merge paths.

### Edge cases

| Edge case                                                                 | Expected                                                                                                                                                                            |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Both merged people hold **pending** rows for the same face                | Survivor's row kept, source row dropped (queue slot stays unique)                                                                                                                   |
| Source pending + survivor rejected (and vice versa)                       | Survivor's row wins regardless of status — its standing answer holds                                                                                                                |
| Merge where loser has no identity                                         | Target re-key is a no-op; personId re-target still fires                                                                                                                            |
| Identity merge where the same face has verdicts via both identities       | Re-key would collide only on (identity, face) — no unique exists; both rows keyed to target; reads treat them as one fact                                                           |
| Self-merge / merge rolled back mid-transaction                            | All-or-nothing: re-key participates in the merge trx                                                                                                                                |
| `deleteUnreferencedIdentities` on an identity referenced only by verdicts | SET NULL degrade, never delete                                                                                                                                                      |
| Person merge: one row needs both re-writes                                | `personId` re-targets to the survivor (unique index — survivor-wins), then `identityId` re-keys the surviving row (non-unique index — no collision); both fire inside the merge trx |

### Done gate

Slice spec + `face-repair.merge-consistency.spec.ts` + `face-person-verdict.repository.spec.ts` +
`face-person-verdict.migration.spec.ts` green; `pnpm lint`, `pnpm check`.
Commit `fix(server): re-key face verdicts through merges instead of cascading them away`.

---

## Slice 2 — Suggestion writes carry identity and actor; no silent no-ops; no weakening upserts

**Goal:** D2, D9, D10.

**Changes:** `rejectFaceSuggestion`/`ignoreFaceSuggestion` call `ensurePersonIdentity` and pass
`{ identityId, source: 'suggestion', actorId: auth.user.id }`; space twins likewise (identity already ensured in
scope). `recordPersonalVerdict`/`recordSpacePersonVerdict` conflict-updates coalesce `identityId`.
`resolveSpacePersonFaceSuggestion` replaces the `hasPendingForSpacePerson` gate with an explicit 3-path
face-reachability check, then upserts unconditionally. Fix the pinned unit assertions
(`person.service.spec.ts:6461,6513` and the shared-space twins) to expect the full opts.

### TDD steps

1. **Red (unit).** Update the four service specs to expect `markRejected(personId, faceId, { identityId, source: 'suggestion', actorId })`.
   Run: `cd server && pnpm exec vitest --run src/services/person.service.spec.ts` — red: called with 2 args.
2. **Red (medium).** `face-person-verdict.repository.spec.ts` additions: reject-over-keep-here preserves
   `identityId` (coalesce) while updating status/source/actor; space reject with a drained row still records the
   verdict; space reject on a face **not reachable** in the space is refused.
   Run: `cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/repositories/face-person-verdict.repository.spec.ts`.
3. **Green.** Implement. 4. **Refactor.** One private `verdictOpts(auth, identityId)` helper per service.

### Edge cases

| Edge case                                                    | Expected                                                                      |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Reject a person that has no identity yet                     | `ensurePersonIdentity` creates one first — rows always carry `I(P)`           |
| Reject after the face was CASCADE-deleted                    | 0 rows affected, benign 200 (parent behaviour preserved)                      |
| Double reject / reject-then-ignore race                      | Last human wins on status; identity never nulled (existing race tests extend) |
| Space reject by a viewer                                     | Still 403 via the Editor gate (unchanged)                                     |
| Space reject on a face reachable only via the 3rd scope path | Accepted — reachability check uses `spaceAssetPathBranches`                   |
| Resolutions page after this slice                            | Actor column populated for user verdicts (fixture + web spec updated)         |

### Done gate

Unit + medium above, `shared-space.service.spec.ts`, `shared-space-face-suggestions.service.spec.ts`,
resolutions web spec green; `pnpm lint`, `pnpm check`.
Commit `fix(server): user face verdicts carry identity and actor; space rejects never no-op`.

---

## Slice 3 — The suggestion engine reads the shared layer

**Goal:** D3. §5.2's "both engines, same three checks" becomes true. This is the slice that closes the parent's
defect 5 and the two §5.4 cross-flows in **both** directions.

**Changes:** new `FaceVerdictService` (or `utils` provider fed by repositories) hosting `buildVerdictMaps`;
`FaceRepairService` delegates to it (behaviour-neutral refactor, its specs must not change);
`handlePersonSuggestionScan`/`handleSpacePersonSuggestionScan` exclude candidates whose face is manual-linked or
carries a negative verdict matching the scan's target (identity-first, token fallback) **before** upserting;
`getPendingForPerson`/`getPendingForSpacePerson` gain manual-link + identity-negative anti-joins;
`confirmSpacePersonFaceSuggestion` writes the `shared_space_person_face` projection row. It does **not** write `asset_face.personId` — a space person is not the owner's personal person; cross-scope re-proposal is suppressed by the manual link (all scopes) + the projection row (same space), never by an owner-column assignment.

### TDD steps

1. **Red (medium, the parent's never-written Slice-4 tests).** New
   `server/test/medium/specs/services/face-suggestion-exclusions.spec.ts`:
   - face with a manual link (any identity) → proposed to **no one** (personal scan, same-space scan, second-space scan);
   - negative verdict toward `I(Anna)` → not proposed for personal Anna **or** space-Anna sharing the identity;
   - admin keep-here `(F, O, I(O))` → F later unassigned → not suggested toward O or O's space profile;
   - space confirm → next scan of the **same space** does not re-propose (projection row present);
   - a face settled _after_ the scan disappears from both pending reads (anti-join self-heal).
     Run: `cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/services/face-suggestion-exclusions.spec.ts`. Expected red: every scenario re-proposes today.
2. **Red (cross-flow).** Extend `face-review-cross-flow.spec.ts` with the parent's missing BDD scenarios:
   "One rejection answers personal and space scope" (defect 5) and "keep-here suppresses a later suggestion"
   — driven through both engines on one DB.
3. **Green.** Implement provider + wiring. 4. **Refactor.** Cleanup's three call sites move to the shared
   provider; delete the private copy.

### Edge cases

| Edge case                                                       | Expected                                                                    |
| --------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Negative toward O only                                          | F still proposable toward Q (target-scoped semantics preserved — #770 rule) |
| Manual link to identity X, scan proposes person with identity X | Excluded (already settled positively)                                       |
| Manual link to X, scan proposes person with identity Y          | Excluded too — "human already placed this face" is owner-agnostic (§5.2)    |
| Scan config gate off / band empty                               | Exclusion provider not consulted (no extra queries on the skip path)        |
| Provider scope discipline                                       | Scan builds maps for exactly its candidate face set — never unscoped        |
| Projection row already exists (face-match raced the confirm)    | Idempotent upsert, no duplicate                                             |

### Done gate

New specs + full existing cleanup suite (`face-repair.*`), suggestion service specs, cross-flow spec green;
`pnpm lint`, `pnpm check`.
Commit `feat(server): suggestion engine consults the shared verdict layer`.

---

## Slice 4 — `'manual'` survives every non-human write

**Goal:** D4. The positive verdict can only be created or removed by an explicit human action or `unconfirm`.

> **Gate (R1) — do not auto-proceed:** this slice embeds a reversible **product decision** (people merges stop stamping
> `'manual'` on rode-along faces). It requires Pierre's explicit sign-off **before its commit lands**. `/impl-loop` does
> not pause on its own, so the driving session must halt here even under a "run all slices" instruction.

**Changes:** `mergeIdentities` re-points links with a CASE preserving `source='manual'` (mirrors
`realignFacesToPersonIdentity:2694-2712`); `handleRecognizeFaces`' already-assigned branch skips the replace when
the current link is `'manual'`; `linkPersonFaces` conflict-update preserves `'manual'`;
`identity-merge-propagation.service.ts:330,368` stop stamping `'manual'` — merge re-pointing preserves each
face's prior source (**product decision per §3; reversible by changing one argument**).

### TDD steps

1. **Red (medium).** Extend `face-identity.manual-durability.spec.ts`:
   - manual link on the losing identity of an automatic `shared-space-evidence` merge → still `'manual'` after;
   - user confirm, then execute a queued `handleRecognizeFaces` for the same (assigned) face → link still `'manual'`;
   - drifted manual link swept by `repairRemainingPersonalIdentityFaceLinks` → still `'manual'`;
   - people merge of two ML clusters → rode-along faces still `source='ml'`/`'owner-person'` (no fabricated positives) **and** cleanup can still flag them; faces that were manually placed stay `'manual'`.
     Run: `cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/repositories/face-identity.manual-durability.spec.ts`. Expected red: downgrades / mass-stamp.
2. **Green.** Implement the three CASEs + merge-source change. 3. **Refactor.** Single
   `preserveManualSource(sourceExpr)` SQL helper.

### Edge cases

| Edge case                                                      | Expected                                                                                               |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Recognition race where the face is assigned but **not** linked | Link written as `'owner-person'` (today's behaviour, still correct)                                    |
| Manual merge (user-driven people merge)                        | Also preserves per-face sources — the merge itself is recorded on identity keys, not by stamping faces |
| `unconfirm` after this slice                                   | Still demotes `manual → ml` (the one sanctioned downgrade path)                                        |
| Backfill after merge (parent Slice-1 scenario)                 | Unchanged — realign CASE already correct; new tests keep it pinned                                     |

### Done gate

Durability spec + full `face-repair` medium suite + `identity-merge-propagation.service.spec.ts` green (cleanup
coverage numbers may **improve** — flagged counts on merged clusters change; update affected assertions
deliberately, not mechanically); `pnpm lint`, `pnpm check`.
Commit `fix(server): manual face placements survive merges, races, and backfill sweeps`.

---

## Slice 5 — Schema-drift silence and revert hygiene

**Goal:** D5, D13. Zero drift output on boot, on every instance, provably.

**Changes:** parenthesize the four override strings in 1787 (edit in place); rewrite
`schema-drift.spec.ts` to assert **zero offenders overall** (drop the single-index filter); add
`'index_face_repair_scan_in_flight_uq'` to the revert script's override deletion.

### TDD steps

1. **Red.** Rewrite the drift spec to `expect(drift.asHuman()).toEqual([])`.
   Run: `cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/schema-drift.spec.ts`.
   Expected red: four `OverrideUpdate` + `IndexDrop/IndexCreate` messages for the `face_person_verdict` indexes.
2. **Green.** Fix the override strings. If the zero-offender assertion exposes other pre-existing drift, fix it
   in this slice (that is the point of the gate) — do not re-filter.
3. Revert script: covered by the existing Revert-to-Immich Validation workflow (run it; known to false-fail on
   Docker Hub rate limits — read the failure, re-run if transient).

### Done gate

Drift spec green on a fresh migrated DB; revert validation workflow green; `pnpm lint`, `pnpm check`.
Commit `fix(server): byte-match face_person_verdict index overrides; drift gate covers everything`.

---

## Slice 6 — Read-side RBAC and queue hygiene

**Goal:** D6, D11.

**Changes:** `getFaceSuggestions` requires ownership (mirror `getFacesForPicker`'s non-owner refusal at
`person.service.ts:420-429`); `getPendingForPerson` gains `af.isVisible`, `asset.deletedAt`, `asset.isOffline`,
`asset.visibility` gates (copy the space twin's block at `face-person-verdict.repository.ts:417-422`).

### TDD steps

1. **Red (medium).** `person.repository`/verdict-repo spec: space member (viewer **and** editor) calling the
   personal suggestions read for a person they can see via a space → 400/403, owner → 200; e2e API spec gains
   the member case (today only a stranger is tested). Pending read: trash the asset / set `isVisible=false`
   after the scan → row no longer surfaces.
   Run: `cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/repositories/face-person-verdict.repository.spec.ts`.
2. **Green.** Implement both.

### Edge cases

| Edge case                                  | Expected                                                          |
| ------------------------------------------ | ----------------------------------------------------------------- |
| Admin calling another user's personal read | Also refused — admin surfaces are the `/admin/face-repair` routes |
| Locked-folder asset                        | Excluded by the visibility gate                                   |
| Asset restored from trash                  | Row resurfaces (gates are read-time, rows were never deleted)     |

### Done gate

Medium + e2e API suite green; `pnpm lint`, `pnpm check`.
Commit `fix(server): owner-only personal suggestion reads; pending queue honours asset state`.

---

## Slice 7 — Admin surfaces can actually see faces

**Goal:** D7.

**Changes:** new `GET /admin/face-repair/faces/:assetFaceId/thumbnail` (admin-gated, face-keyed — reuses the
crop pipeline from `getFaceThumbnail` minus the person join); web `getAdminFaceThumbnailUrl` helper; all four
admin call sites switch (`FaceCleanupTable.svelte:23`, `[personId]/+page.svelte:112-113`,
`PersonPicker.svelte:55`, `resolutions/+page.svelte:45-46`). OpenAPI + clients regenerate in Slice 10.

### TDD steps

1. **Red (medium/controller).** Route spec: admin 200 for a face on **another user's** asset; non-admin 403;
   tombstoned face still served (resolutions lists not-a-face rows); unknown id 404.
   Run: `cd server && pnpm exec vitest --run src/controllers/face-repair-admin.controller.spec.ts`.
2. **Red (e2e).** Extend `face-cleanup.e2e-spec.ts`: seed the cluster under a **second user** (finally breaking
   the everything-owned-by-admin blind spot), assert review-page and resolutions face `<img>` elements actually
   load (naturalWidth > 0 or response 200), not merely exist.
   Run (against the **:2285 e2e stack**, never the :2283 dev stack — §9): `cd e2e && pnpm exec playwright test src/specs/web/face-cleanup.e2e-spec.ts --project=web`.
   Expected red today: broken images / 400s.
3. **Green.** Implement route + wiring.

### Done gate

Controller spec, web unit specs, `make e2e-web-dev`-equivalent run on the **:2285 e2e stack** (the :2283 dev
stack serves 0-byte bodies — known trap) green; `pnpm lint` both packages, `pnpm check` both.
Commit `feat(server+web): admin face thumbnails; cleanup surfaces render non-owned clusters`.

---

## Slice 8 — The suggestion modal tells the truth

**Goal:** D8, D17.

**Changes (web only):** modal refetches from offset 0 with an `actedFaceIds` skip-set; closes only on an empty
fresh fetch; `act()` surfaces errors via `handleError` (only an already-resolved 400 advances silently — match
the server's benign-advance contract); back-nav marks acted rows read-only; failed initial loads render error
states, not empty states (`resolutions`, `[personId]`, console); console bulk-apply always refetches in
`finally`; snooze keys by `userId:personId` and rebases its baseline on every banner fetch.

### TDD steps

1. **Red (component).** `PersonSuggestionReviewModal.spec.ts`: 120 pending (3 pages) → act through everything →
   every face was shown exactly once, close fires only after the final empty fetch, progress counter matches
   acts; server 500 on item 3 → error toast, item not marked acted, retry possible; back-nav shows acted state.
   Run: `cd web && pnpm exec vitest --run src/lib/modals/PersonSuggestionReviewModal.spec.ts`. Expected red:
   premature close at ~half, silent 500.
2. **Red (component).** Error-state specs for the three pages; snooze spec: reject-elsewhere then a new
   suggestion → banner resurfaces; two users, one browser → independent snoozes.
3. **Green.** Implement.

### Done gate

`cd web && pnpm check:typescript && pnpm check:svelte && pnpm test` (full — the shared components have wide
blast radius); `pnpm lint` if it survives the known local tscompat crash, otherwise defer lint verdict to CI.
Commit `fix(web): suggestion modal paging/error truthfulness; admin pages fail loudly`.

---

## Slice 9 — Atomicity and freshness

**Goal:** D14, D12.

**Changes:** personal confirm wraps claim → reassign → link → drain in one transaction (same pattern and
rationale as `executeRepair:280-291`; respect the fork rule — every query inside the callback uses `trx`);
`executeRepair`/`resolveFaces` move `drainPendingForFaces` inside their transactions; `getLatestScanStatus`
applies the shared verdict filters when computing person counts so suggestion-side settlements don't inflate the
dashboard (measure: if the filtered count is too slow for the dashboard poll, fall back to draining flagged-face
snapshot rows on verdict writes instead — decide by benchmark in-slice, document the choice).

### TDD steps

1. **Red (medium).** Confirm-path spec: inject a failure between link and drain (fault-injection via a spying
   repository) → assert **no** partial state escapes (row still pending, no link) — red today: link written,
   pending alive. Dashboard spec: cleanup scan → user verdict settles a flagged face → dashboard count drops.
   Run: `cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/services/face-suggestion-confirm-atomicity.spec.ts` (new confirm-atomicity spec) and
   `... --run test/medium/specs/services/face-repair.service.spec.ts` (dashboard-count assertion). Expected red: partial state escapes / stale count.
2. **Green.** Implement.

### Done gate

Medium confirm/dashboard specs + full `face-repair` suite green; `pnpm lint`, `pnpm check`.
Commit `fix(server): transactional confirm and drains; live dashboard counts`.

---

## Slice 10 — Suite hardening, hygiene, regeneration, final gate

**Goal:** D15, D16, and every regeneration the slices above accumulated.

> **Note:** Slices 1–9 already delivered the behaviour; Slice 10's test reworks (steps 1–6) are **regression locks**, not
> red-first cycles — they go green immediately against the fixed code and guard against future regressions. Treat the
> steps below as an internal checklist, not one red→green pass.

**Changes:**

1. `face-review-cross-flow.spec.ts:186-189` — remove the `.catch(() => {})`; the confirm path must pass green
   against the real DB.
2. Band boundaries: repo spec cases at exactly `distance == maxDistance` and `== suggestionMaxDistance` pinning
   the `>` / `>=` semantics.
3. Keep-here: assert the stored `identityId`/`actorId` (extend `declineRowsFor` to select them).
4. Resolutions: medium + web fixtures gain a space-person verdict row and a SET-NULL-target row ("shown with its
   space named"; "never a broken row").
5. Fix the mislabeled FK test (`face-person-verdict.repository.spec.ts:638-661`) to assert SET NULL explicitly
   (post-Slice-1 semantics: orphan-and-degrade, not delete).
6. e2e `.serial` decoupling: scope the keep-here `toHaveCount(0)` assertion to the row it created (filter by
   person name) so test order stops mattering; keep `.serial` (shared DB) but remove the order-coupling.
7. Hygiene: fix the two stale lock/decline test titles, the controller summary ("resolutions (declines + locks)"
   → "negative verdicts from both engines"), the four `@GenerateSql` param objects; delete the 19 orphaned
   `admin.face_cleanup_*` keys from de/fr (grep `web/src` **and** `mobile/lib` first — i18n is shared).
8. Parent-doc corrections (append a "2026-07-23 corrections" note): §4.2 rename unshipped; §4.4 missing 1784;
   coverage rows 34/35/37 marked deferred-not-covered; merge-safety claim corrected to cite this spec.
9. Regenerate: `cd server && pnpm build && pnpm sync:open-api`, `make open-api` (TS + Dart), `mise sql` (clean
   `dist`, migrated throwaway DB via `DB_URL=...`, never without a DB), `cd docs && pnpm format`.
10. Full gate: server `pnpm test` + `pnpm test:medium` (full), web `pnpm test` + checks, e2e API + web suites
    against the e2e stack, then dispatch the full CI set (`ci-full-set-dispatch`; feature branches trigger no CI
    on push — use `gh workflow run ... --ref feat/face-review-unified`) and babysit to green.

### Done gate

Everything in step 10 green; PR #834 description updated with a "review remediation" section summarizing
D1–D17 → slice mapping and correcting the "leaks 1–5 proven" claim to point at the new cross-flow scenarios.
Commit series per change class; final commit `test: close the verdict-layer coverage gaps found in review`.

---

## 7. Risks

| ID  | Risk                                                                                                              | Mitigation                                                                                                                                                                                                                                                                                                                                         |
| --- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | **Slice 4's merge-source decision is a product change** (merged clusters become cleanup-visible again).           | Flagged in §3; default = preserve prior source; reversible by one argument. Get Pierre's explicit sign-off before Slice 4 lands.                                                                                                                                                                                                                   |
| R2  | Slice 3's write-time exclusions add per-scan queries; large libraries could regress scan time.                    | Provider batches per candidate set (one query per map, same as cleanup); measure in the medium scan spec with a 1k-face fixture before/after. **Fallback if it regresses:** drop the write-time exclusion and rely on the read-time anti-join alone — the anti-join self-heal (§5.2) already guarantees correctness; document the choice in-slice. |
| R3  | The zero-offender drift gate (Slice 5) may surface pre-existing drift unrelated to this PR.                       | Fix it in-slice; if genuinely upstream, add a **documented, dated** exclusion — never an index-name filter.                                                                                                                                                                                                                                        |
| R4  | Slice 9's transactional confirm changes error semantics under concurrency (claim now rolls back on late failure). | The claim-then-work contract is preserved: a rolled-back claim leaves the row pending — strictly safer; race specs from Slice 2 re-run here.                                                                                                                                                                                                       |
| R5  | Editing migration 1787 in place breaks any DB that already ran it.                                                | Same population as the PR's existing deploy note (RC/personal clones) — reset, don't upgrade. Note stays in the PR description.                                                                                                                                                                                                                    |
| R6  | Web full-suite lint aborts locally (tscompat crash) — CI is the only lint gate.                                   | Known; rely on CI Docs/web lint jobs; never claim lint-green locally without CI.                                                                                                                                                                                                                                                                   |
| R7  | Subagent-reported "green" misses what integrated runs catch.                                                      | Every done gate runs in full by the driving session. Non-negotiable.                                                                                                                                                                                                                                                                               |

---

## 8. Coverage matrix (finding → slice → proving test)

| Finding                                                                                      | Slice | Test                                                                                     |
| -------------------------------------------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------- |
| D1 person merge kills verdict                                                                | 1     | merge-durability "keep-here survives Bob→Robert"                                         |
| D1 identity merge kills verdict                                                              | 1     | merge-durability "shared-space-evidence merge re-keys"                                   |
| D1 GC kills verdict                                                                          | 1     | merge-durability "GC degrades to SET NULL"                                               |
| D1 collision policy                                                                          | 1     | merge-durability "survivor wins"                                                         |
| D2 identity+actor on writes                                                                  | 2     | updated service unit specs + repo "reject carries I(P)"                                  |
| D9 space reject no-op                                                                        | 2     | repo "drained row still records verdict"                                                 |
| D10 weakening upsert                                                                         | 2     | repo "reject-over-keep-here preserves identityId"                                        |
| D3 manual link → not proposed to anyone                                                      | 3     | suggestion-exclusions spec (3 scan scopes)                                               |
| D3 defect 5 both directions                                                                  | 3     | cross-flow "one rejection answers personal and space"; "keep-here suppresses suggestion" |
| D3 space confirm self-re-ask                                                                 | 3     | suggestion-exclusions "same space does not re-propose" + projection row assert           |
| D3 read-time self-heal                                                                       | 3     | suggestion-exclusions "settled face leaves both pending reads"                           |
| D4a auto-merge downgrade                                                                     | 4     | manual-durability "evidence merge preserves manual"                                      |
| D4b recognition race                                                                         | 4     | manual-durability "queued job cannot downgrade a confirm"                                |
| D4c backfill catch-all                                                                       | 4     | manual-durability "catch-all preserves manual"                                           |
| D4d merge mass-stamp                                                                         | 4     | manual-durability "rode-along faces keep prior source; cleanup still flags them"         |
| D5 override drift ×4                                                                         | 5     | schema-drift zero-offender assertion                                                     |
| D13 revert override                                                                          | 5     | Revert-to-Immich Validation workflow                                                     |
| D6 member read leak                                                                          | 6     | medium + e2e member-403 cases                                                            |
| D11 personal queue asset gates                                                               | 6     | repo "trashed/hidden asset leaves the queue"                                             |
| D7 admin thumbnails (console + resolutions)                                                  | 7     | controller cross-owner 200 spec + e2e image-load asserts on second-user cluster          |
| D8 modal paging + errors                                                                     | 8     | modal spec "every face shown once / closes on empty fetch / 500 surfaces"                |
| D17 snooze / back-nav / error states / bulk refetch                                          | 8     | snooze + page component specs                                                            |
| D14 confirm atomicity + in-trx drains                                                        | 9     | fault-injection confirm spec                                                             |
| D12 dashboard staleness                                                                      | 9     | dashboard "user verdict drops the count"                                                 |
| D15 cross-flow `.catch` / bands / keep-here identity / fixtures / FK label / serial coupling | 10    | the respective reworked specs (Slice 10 steps 1–6)                                       |
| D16 hygiene                                                                                  | 10    | grep gates in the done gate                                                              |

---

## 9. Process notes for the executing session

- Slice plans go to `docs/superpowers/plans/2026-07-23-face-verdict-remediation-slice-<n>.md`; prettier reaches
  them (`cd docs && pnpm format` before every docs commit).
- Red → green → refactor → **full done gate run by you, not a subagent** → commit → push, per slice. The branch
  must be green after every slice.
- Targeted test runs: `pnpm exec vitest --run <path>` / `pnpm exec vitest --config test/vitest.config.medium.mjs --run <path>` —
  the `pnpm test -- --run <path>` forms silently drop the filter. Verify the intended file ran.
- `mise sql` only with a clean `dist` and a migrated throwaway DB (`DB_URL=...`); **never** without a running DB.
- Server lint is `--max-warnings 0`: run full `pnpm lint`, not per-file. Web lint may abort locally (tscompat) —
  CI is the gate. Defer the slow full-package lint to each slice's done gate, not per-edit.
- Feature-branch pushes trigger **no** CI: dispatch with `gh workflow run <wf> --ref feat/face-review-unified`
  (account `Deeds67`), and read job-level results — run-level "success" can hide failed jobs.
- e2e web runs go against the **:2285 e2e stack**, never the :2283 dev stack (0-byte-body trap). The e2e stack
  and `immich-e2e` project are machine-wide singletons — check nothing else is using them.
- `e2e utils.createFace` writes `source='manual'`; flagged-face seeding must go through `seedFlaggedScan`'s
  ML-downgrade (existing helper) — do not seed around it.
- No `Co-Authored-By` / `Generated with` trailers. Ask Pierre before any release/deploy action.
- **Slice 4 requires Pierre's sign-off on the merge-source decision (R1) before its commit lands.**
