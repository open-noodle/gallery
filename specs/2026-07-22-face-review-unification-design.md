# Unifying face suggestions (#592) and face cleanup (#770) on one verdict layer

**Status:** design approved 2026-07-22, ready for `/impl-loop`
**Supersedes as a shipping vehicle:** PR #592 (`brainstorm/face-recognition-suggestions`) and PR #770
(`feat/face-cleanup-resolution`) — both stay open and **untouched** as reference/review context; neither
ships alone.
**Target branch:** `feat/face-review-unified`

---

## 1. Goal

Ship both face-review features together on a single shared truth layer, so that a decision made in one
feature is never re-asked, silently reverted, or left stale by the other.

Today the two features each keep their own private record of human decisions. Because neither reads the
other's, a face can be confirmed by a user and immediately re-flagged for an admin to move away — with no
recovery path. This spec removes the private records and replaces them with one shared, identity-keyed
verdict layer that both engines write to and read from.

Non-goal: changing what either feature does for its own user. Both surfaces, both actors, both mental
models stay exactly as designed. Only the storage and the exclusion filters change.

---

## 2. Background: how the pieces work today

### 2.1 The two features

**#592 — face suggestions** (per-user + shared-space). The facial-recognition job auto-assigns a face when
the embedding distance is within `facialRecognition.maxDistance`. #592 adds an additive band: faces in
`(maxDistance, suggestionMaxDistance]` become _suggestions_ on a named person's detail page, reviewed
one-at-a-time and confirmed / rejected / ignored / dismissed. Generation is automatic via background scan
jobs. Scope: `type='person'` named identities only.

**#770 — face cleanup** (admin-only, global, owner-scoped). An admin-triggered scan flags faces that are
already assigned to a person but appear to belong to a different _suspected owner_. Each flagged face gets
one of five terminal resolutions: move to owner, move to a chosen person, keep here, confirm/lock, or
"not a face".

The two are complementary in scope and cannot collide at any instant — suggestions require
`asset_face.personId IS NULL`, cleanup requires `personId IS NOT NULL`. They hand faces back and forth
**over time**, and that is where every defect lives.

### 2.2 The same three facts, stored five ways

```
FACT                            #592 stores it as        #770 stores it as        canonical home
                                (suggestions, user)      (cleanup, admin)         (already exists!)
──────────────────────────────  ───────────────────────  ───────────────────────  ───────────────────────
"a human placed face F          person_face_suggestion   face_repair_lock         face_identity_face
 on human I"                      .status='confirmed'      (assetFaceId,            .source='manual'
                                                            personId)              <- both already write it

"face F is NOT human I"         person_face_suggestion   face_repair_decline      (nothing)
                                  .status='rejected'       type='face'              <- THE ONLY REAL GAP
                                  .status='ignored'        (assetFaceId,
                                                            suspectedOwnerId)

"face F is not a face at all"   (nothing; scan still     asset_face.deletedAt     asset_face.deletedAt
                                 writes rows for these)   (set by detach)          <- already canonical
```

Two of the three facts already have a canonical home that **both** features already write to. Only the
middle row needs new storage.

### 2.3 Root cause

Each feature mixed **queue** ("what to ask a human") and **verdict** ("what a human decided") into one
table. A verdict trapped inside a feature-private table is invisible to the other engine. Every defect
below is a symptom of that one mistake.

### 2.4 Verified defect inventory

Line references are against the two branches as of 2026-07-22.

| #     | Defect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Evidence                                                                                                        |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **1** | **Confirm → re-flag ping-pong.** `confirmFaceSuggestion` → `reassignFacesById` → `reassignFace` sets `personId` only; `sourceType` stays `machine-learning`. The cleanup scan's eligibility filter is exactly `sourceType='machine-learning' AND personId IS NOT NULL AND deletedAt IS NULL AND isVisible`. So every confirmed suggestion is scan-eligible — and by construction it sits in the suggestion band, i.e. it is a marginal face, precisely the profile cleanup flags. The console then proposes moving the user's confirmed face away; because the suggestion row is now `confirmed`, it can never be re-suggested. Silent, unrecoverable revert. | `person.service.ts:266`, `face-repair.repository.ts:89,125`                                                     |
| **2** | **Detach → unbounded dead rows.** `searchFaces` filters `asset.deletedAt` but **not** `asset_face.deletedAt`, so the suggestion scan keeps writing pending rows for detached "not a face" crops forever. The read path does filter `af.deletedAt IS NULL`, so nothing surfaces today — the invariant is one relaxed filter away from asking "Is this Anna?" about a crop an admin declared not-a-face.                                                                                                                                                                                                                                                        | `search.repository.ts:983`, `person-face-suggestion.repository.ts:176-177`                                      |
| **3** | **Cleanup moves never purge suggestions.** `resolveFaces` writes `asset_face.personId` directly and never calls `resolveAssignedFace`. Stale pending rows survive, harmless _only_ because the read path re-checks `af.personId IS NULL`. The invariant is held by a query filter, not by the write path.                                                                                                                                                                                                                                                                                                                                                     | `face-repair.service.ts:678`                                                                                    |
| **4** | **Two negative ledgers, same fact.** `person_face_suggestion(status='rejected')` = "F is not P"; `face_repair_decline(assetFaceId, suspectedOwnerId)` = "don't propose F → O". Identical semantics, different tables, neither read by the other engine.                                                                                                                                                                                                                                                                                                                                                                                                       | both schemas                                                                                                    |
| **5** | **Scope mismatch, no bridge.** Cleanup is admin-only/global/owner-scoped and blocks cross-owner routing. Suggestions are per-user **plus** shared-space (`spacePersonId`). Space-person suggestions have no cleanup counterpart, and an admin cleanup move silently changes what a space viewer sees.                                                                                                                                                                                                                                                                                                                                                         | both schemas                                                                                                    |
| **6** | **Lock black hole.** `removeLocks({ids})` from the admin Resolutions page is the _only_ revocation path. Nothing revokes a lock when the face is later moved or unassigned by any other route. Once user confirms also write locks, a user who confirms and then unassigns leaves a lock on an unassigned face — invisible to both engines forever.                                                                                                                                                                                                                                                                                                           | `face-repair-lock.repository.ts:79` is the sole caller                                                          |
| **7** | ~~`getLockedFaceIds()` is unbounded.~~ **Investigated and withdrawn.** The unscoped `getLockedFaceIds()` is called only from medium tests; the live scan path reads locks **already scoped** to the flagged face ids via `getDeclineMaps({ personIds, assetFaceIds })`. There is no performance defect here. Retiring the lock table rests on defects 1 and 6 and the duplicate-fact argument alone — not on performance. Recorded so the claim is not re-derived.                                                                                                                                                                                            | `getDeclineMaps` at `face-repair-decline.repository.ts:91,125-131`; `getLockedFaceIds` call sites are test-only |
| **8** | **`unassignFaces()` leaves phantom positives.** `queueRecognizeFaces(force)` bulk-nulls `personId` on every ML face without touching `face_identity_face`. Under the new model that would leave permanent phantom positive verdicts library-wide after a "reset all people".                                                                                                                                                                                                                                                                                                                                                                                  | `person.service.ts:1163` → `person.repository.ts:234`                                                           |

### 2.5 The primitive that was already there

`face_identity_face(assetFaceId PK, identityId, source, confidence, ...)` is the fork's per-face → identity
link. `source` is an enum already including `'manual'`, and `replaceFaceIdentity(personId, faceId, 'manual')`
is called by **every** human reassignment — including `confirmFaceSuggestion` (`person.service.ts:268`) and
cleanup's own move path (`face-repair.service.ts:259`).

Both `person.identityId` and `shared_space_person.identityId` FK into `face_identity`, so identity is
already the fork's cross-scope "this human" primitive. Faces are owner-scoped via `asset.ownerId`, so
identity-keying carries no cross-user leak risk — a face only ever belongs to one owner.

`face_repair_lock` is therefore a parallel, person-keyed, non-merge-safe re-implementation of a fact that
already had a merge-safe home — which is exactly why it needed commit `76aff4188d` to survive merges.

---

## 3. Architecture

### 3.1 Three layers, made structural

```
  QUEUES (ephemeral | feature-private | regenerated by every scan | safe to truncate)
  +----------------------------------+   +--------------------------------------+
  | face_person_verdict              |   | face_repair_scan_flagged_face        |
  |   WHERE status='pending'         |   |   (unchanged)                        |
  |   unassigned face -> named person|   |   assigned face -> suspected owner   |
  +----------------------------------+   +--------------------------------------+
            |                                            |
            |  both WRITE v        both READ ^ as exclusion filter
            v                                            v
  ================================================================================
    VERDICTS  (durable | human | shared | identity-keyed)

     positive     face_identity_face.source = 'manual'      <- existed all along
     negative     face_person_verdict WHERE status IN        <- the one new thing
                    ('rejected','ignored')
     not-a-face   asset_face.deletedAt                      <- existed all along
  ================================================================================

  CONSOLE MUTE (UI only | not truth | stays private to #770)
  +----------------------------------------------------------+
  | face_repair_cluster_mute   (was face_repair_decline)      |
  +----------------------------------------------------------+
```

### 3.2 Design decisions and why

| Decision                                                                | Rationale                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Two surfaces, one truth layer** (not one merged feature)              | The features have different actors (end user vs admin) and different scopes (per-user + shared-space vs global owner-scoped). Merging the UX would mean giving up the shared-space half or promoting cleanup to a per-user feature. Merge the data, not the surfaces.                                   |
| **One consolidated branch, no backfill**                                | Neither feature has ever shipped, so every table is authored in final form. No rename migrations, no `INSERT...SELECT` backfills, no drop-table steps, no half-migrated-DB risk.                                                                                                                        |
| **A user's confirm writes the same verdict as an admin's move**         | One verdict class, no authority tiers, no precedence rules. `move → auto-lock` was already #770's precedent. Safety valve: an admin can revoke it (§5.3).                                                                                                                                               |
| **Negative verdict is identity-first with target fallback**             | "Not Anna" is a fact about the human, not a storage row. One reject answers the question in personal scope _and_ every space, and survives merges for free. The always-stored target covers people with no identity yet or one acquired later via `FaceIdentityBackfill`, so there is no gap to re-key. |
| **`face_repair_lock` is retired; the manual identity link is the lock** | Kills defects 1, 6, 7 at once, makes #770's merge-hardening redundant, and needs **zero new writes** on the confirm path. Load-bearing assumption stated in §7 R1 and proved in Slice 1.                                                                                                                |
| **`person_face_suggestion` is repurposed rather than split**            | Its uniqueness constraint over (target, face) is what makes the never-reappear guarantee free at the DB layer: the existing conditional `ON CONFLICT ... WHERE status='pending'` upsert already cannot resurrect a resolved row. Splitting would turn that into an anti-join.                           |
| **`rejected` and `ignored` both retained** despite identical behaviour  | Both are already built and translated, and they give the Resolutions page a meaningful intent column. Cost is one enum value.                                                                                                                                                                           |
| **Negatives listed globally; positives undone in context**              | The positive verdict is now "has a manual identity link", which includes every ordinary face-editor reassignment ever — unbounded and meaningless to list. Un-confirm belongs on the cleanup review page where the admin wonders why a face vanished.                                                   |

### 3.3 Testing strategy: TDD + BDD

- **TDD (example-based)** for pure decision functions and repository behaviour. Every slice starts red with
  a named failing command and its expected red output, then green, then refactor.
- **Medium tests (real Postgres via testcontainers)** are the primary gate for this feature — nearly every
  invariant here is a SQL-level one (FK/CASCADE semantics, partial unique indexes, conditional upserts,
  identity-or-target read predicates). Unit tests with mocked repositories cannot prove them.
- **BDD (Given/When/Then)** for the cross-flow behaviour and the web surfaces, as Playwright specs under
  `e2e/src/specs/web/`, written **red-first**.
- **Characterization tests first**: Slice 1 is test-only and proves the assumption the whole design rests
  on before any schema is written. If it fails, the design changes rather than the tests.

### 3.4 Files (whole feature)

**New:**

| File                                                                | Responsibility                                                    | Slice |
| ------------------------------------------------------------------- | ----------------------------------------------------------------- | ----- |
| `server/src/schema/tables/face-person-verdict.table.ts`             | The verdict + queue table (renamed from `person-face-suggestion`) | 2     |
| `server/src/schema/migrations-gallery/<ts>-AddFacePersonVerdict.ts` | Final-form migration (replaces three #592 migrations)             | 2     |
| `server/src/repositories/face-person-verdict.repository.ts`         | Identity-first reads, conditional upsert, purge helper            | 2     |
| `server/src/utils/face-verdict-filters.ts`                          | The three shared exclusion predicates + pure decision function    | 3     |
| `server/src/schema/tables/face-repair-cluster-mute.table.ts`        | Narrowed console mute (was `face-repair-decline`)                 | 5     |
| `server/src/repositories/face-repair-cluster-mute.repository.ts`    | Cluster-mute CRUD                                                 | 5     |

**Deleted:**

| File                                                     | Why                                  | Slice |
| -------------------------------------------------------- | ------------------------------------ | ----- |
| `server/src/schema/tables/face-repair-lock.table.ts`     | Manual identity link _is_ the lock   | 5     |
| `server/src/repositories/face-repair-lock.repository.ts` | ditto                                | 5     |
| `<ts>-AddFaceRepairLock.ts` migration                    | never created                        | 5     |
| `<ts>-AddFaceSuggestionIntentStatuses.ts` migration      | folded into the final-form migration | 2     |
| `server/src/schema/tables/face-repair-decline.table.ts`  | narrowed and renamed                 | 5     |

**Modified:** `person.service.ts`, `person.repository.ts`, `search.repository.ts`,
`face-repair.service.ts`, `face-repair.repository.ts`, `base.service.ts` (**three sites**, §3.5),
`test/medium.factory.ts`, the web Resolutions + cleanup review + person detail pages,
`scripts/revert-to-immich/`, `i18n/en.json`.

### 3.5 Two fork traps this feature walks straight into

1. **`BaseService` has THREE registration sites** — the import (`base.service.ts:49`), the positional list
   in `static create()` (`:131`), and the constructor parameter (`:199`). Renaming
   `PersonFaceSuggestionRepository` and deleting `FaceRepairLockRepository` touches all three. Missing the
   `create()` list silently **shifts every later repository by one**, and only medium tests catch it (a
   unit suite stays green).
2. **`test/medium.factory.ts` has TWO case groups, not one.** `PersonFaceSuggestionRepository` appears at
   `:530` (inside `newRealRepository`, the real DB-backed group) **and** at `:608` (the `automock` group).
   A rename must update both. A repository missing from `newRealRepository` fails with
   `Unable to create repository instance` at collection time, which reads like a BaseService regression.

Both are called out as explicit steps in Slices 2 and 5.

---

## 4. Schema

### 4.1 `face_person_verdict` (was `person_face_suggestion`)

Holds both the suggestion **queue** (`status='pending'`) and the shared **negative verdict**
(`status IN ('rejected','ignored')`). One uniqueness constraint over (target, face) spans both, which is
what makes never-reappear free.

```
   id                 uuid pk (uuidv7)
   assetFaceId        uuid  FK asset_face          ON DELETE CASCADE   NOT NULL
   identityId         uuid  FK face_identity       ON DELETE CASCADE   NULL
   personId           uuid  FK person              ON DELETE SET NULL  NULL
   spacePersonId      uuid  FK shared_space_person ON DELETE SET NULL  NULL
   distance           float8 NULL          -- scan artifact; NULL for cleanup-sourced rows
   status             varchar  'pending' | 'rejected' | 'ignored'
   source             varchar  'suggestion' | 'cleanup'
   actorId            uuid  FK user  ON DELETE SET NULL  NULL
   createdAt / updatedAt / updateId

   CHECK  status IN ('pending','rejected','ignored')
   CHECK  source IN ('suggestion','cleanup')
   CHECK  num_nonnulls("personId","spacePersonId") <= 1        -- never both; may be neither
   UNIQUE (personId,      assetFaceId) WHERE personId      IS NOT NULL
   UNIQUE (spacePersonId, assetFaceId) WHERE spacePersonId IS NOT NULL
   INDEX  (identityId,    assetFaceId) WHERE identityId    IS NOT NULL
   INDEX  (personId,      status, distance)
   INDEX  (spacePersonId, status, distance) WHERE spacePersonId IS NOT NULL
   INDEX  (assetFaceId)
```

**Why `SET NULL` on the targets and no "at least one non-null" check.** With `CASCADE` on `personId`,
merging P into Q deletes P's row and takes the negative verdict with it — the exact regression
identity-keying exists to prevent. With `SET NULL` _plus_ a `>= 1` check, the person delete itself fails
whenever a row has no identity. So: targets `SET NULL`, `identityId` `CASCADE`, and no lower-bound check.
Fully-orphaned rows (no target, no identity) are unreachable by every read predicate and die with their
face via the `assetFaceId` CASCADE — bounded by face count and harmless.

**`status='confirmed'` does not exist.** The positive verdict lives only in
`face_identity_face.source='manual'`. Keeping both would recreate the duplicate-fact problem this design
removes.

**Negative-verdict predicate** (the single read used by both engines):

```sql
status IN ('rejected','ignored')
AND "assetFaceId" = :F
AND ("identityId" = :I OR "personId" = :P OR "spacePersonId" = :S)
--   \__ identity-first __/   \_____ fallback while identityId is null _____/
```

### 4.2 `face_repair_cluster_mute` (was `face_repair_decline`)

With `type='face'` gone, the table no longer needs `type`, `assetFaceId`, or `suspectedOwnerId`:

```
   id              uuid pk
   personId        uuid  FK person  ON DELETE CASCADE  NOT NULL
   suspectedOwnerIds  jsonb   NOT NULL
   declinedBy      uuid  FK user  ON DELETE SET NULL  NULL
   createdAt
```

### 4.3 Unchanged

`face_repair_scan`, `face_repair_scan_flagged_face` and its in-flight index, `face_identity_face`,
`face_identity`, `asset_face`.

### 4.4 Final fork-migration set

`AddFacePersonVerdict`, `AddFaceRepairScan`, `AddFaceRepairScanFlaggedFace`, `AddFaceRepairScanInFlightIndex`,
`AddFaceRepairClusterMute`. No lock table, no intent-status migration, no alters. Timestamps must be fresh
and non-colliding — #770 already had to renumber twice, and the `migration-timestamps` guard rejects new
collisions.

---

## 5. Behaviour

### 5.1 Write matrix

`I(P)` = identity of person P. "purge" = delete this face's `status='pending'` rows for **all** targets.

| #   | Action (actor)                | `asset_face`                             | `face_identity_face`                | `face_person_verdict`                        |
| --- | ----------------------------- | ---------------------------------------- | ----------------------------------- | -------------------------------------------- |
| 1   | **Confirm** suggestion (user) | `personId := P`                          | replace → `(I(P), 'manual')`        | purge pending for F                          |
| 2   | **Reject** (user)             | —                                        | —                                   | `+ (F, P, I(P))` `rejected` `src=suggestion` |
| 3   | **Ignore** (user)             | —                                        | —                                   | `+ (F, P, I(P))` `ignored` `src=suggestion`  |
| 4   | **Dismiss** (user)            | —                                        | —                                   | = Reject                                     |
| 5   | **Snooze** (user)             | —                                        | —                                   | — (localStorage, unchanged)                  |
| 6   | **Move to owner O** (admin)   | `personId := O`                          | replace → `(I(O), 'manual')`        | purge pending for F                          |
| 7   | **Move → person Q** (admin)   | `personId := Q`                          | replace → `(I(Q), 'manual')`        | purge pending for F                          |
| 8   | **Keep here** (admin)         | —                                        | —                                   | `+ (F, O, I(O))` `rejected` `src=cleanup`    |
| 9   | **Confirm / lock** (admin)    | —                                        | re-affirm → `(I(current),'manual')` | purge pending for F                          |
| 10  | **Not a face** (admin)        | `personId := null`, `deletedAt := now()` | **delete** link                     | purge pending for F                          |
| 11  | **Cluster mute** (admin)      | —                                        | —                                   | — (`face_repair_cluster_mute`)               |

Only **#9** changes implementation rather than merely changing where it writes: it becomes
`replaceFaceIdentity(currentPerson, F, 'manual')` instead of inserting a lock row. #1, #6 and #7 already
write the manual link today — they just stop _also_ writing a lock.

Rows 1, 6, 7, 9 and 10 all funnel through **one shared purge helper**, so "resolving a face empties both
queues" becomes a write-path invariant instead of a read-filter accident (defect 3).

### 5.2 Read paths

```
  SUGGESTION SCAN (unassigned -> named person)     CLEANUP SCAN (assigned -> suspected owner)
  ------------------------------------------      ------------------------------------------
  candidates: asset_face.personId IS NULL          candidates: personId IS NOT NULL
              sourceType='machine-learning'                    sourceType='machine-learning'
              deletedAt IS NULL   <- NEW (def. 2)              deletedAt IS NULL   <- already
                                                               isVisible = true

  exclude if -----------------+                    +----------------- exclude if
                              v                    v
              ==================================================
                face_identity_face.source = 'manual'    positive verdict
                face_person_verdict status IN           negative verdict
                    ('rejected','ignored'),
                    matched identity-or-target
                asset_face.deletedAt IS NOT NULL        not-a-face
              ==================================================
                    ^ both engines, same three checks ^
```

The negative verdict is matched **against that engine's target**: cleanup excludes a face only for the
_suspected owner_ it was declined toward, so a face declined toward O remains flaggable toward a different
owner Q. That is #770's existing decline semantic, preserved.

### 5.3 Undo surfaces

| Need                                             | Surface                                                                                                         |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Admin un-declines so the scan re-flags           | `/admin/face-cleanup/resolutions` — negatives only, with `source` + `actor` columns and a filter                |
| Admin un-confirms so the scan re-flags           | Cleanup review page, per-person **"skipped: human-confirmed"** section; downgrades `source` `'manual'` → `'ml'` |
| User un-rejects so a face can be suggested again | Person detail page                                                                                              |
| User un-confirms                                 | Already covered — reassigning in the face editor replaces the manual link                                       |

### 5.4 Two intentional cross-flows

These are the shared layer working as designed, and belong in the PR description because they mean one
person's decision constrains the other's queue:

- A user's "not Anna" now suppresses a **cleanup** flag toward Anna if that face later lands in someone
  else's cluster.
- An admin's "keep here" (F is not O) now suppresses a **suggestion** of F → O if F is later unassigned.

### 5.5 Out of scope (named so they do not creep in)

Cleanup does **not** gain shared-space cluster scanning — it stays admin/global/owner-scoped. Snooze stays
client-side. No mobile UI for either feature. The two review surfaces stay separate. No changes to
recognition auto-assign behaviour or to `facialRecognition.maxDistance` semantics.

---

## 6. Slice overview

Slices are **implementation increments, not independent releases** — the whole feature ships as one PR.
Each slice is independently verifiable and leaves the branch green.

| Slice                                       | Delivers                                                                                          | Depends on |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------- |
| **0 — Branch consolidation**                | `feat/face-review-unified` = #770 + #592 rebased; full CI green; leaks present but nothing broken | —          |
| **1 — Prove the load-bearing assumption**   | Test-only. Manual identity links survive backfill, merge, and re-affirm — **or STOP**             | 0          |
| **2 — `face_person_verdict`**               | Final-form schema + repository with identity-first reads                                          | 1          |
| **3 — Shared exclusion predicates**         | One module both engines consume; pure decision fn + SQL builders                                  | 2          |
| **4 — Suggestion side rewiring**            | Write-matrix rows 1–4; scan consults shared predicates                                            | 3          |
| **5 — Cleanup side rewiring, lock retired** | Write-matrix rows 6–11; `face_repair_lock` deleted; decline narrowed                              | 3          |
| **6 — The two safety fixes**                | `searchFaces` `deletedAt`; `unassignFaces` clears manual links                                    | 3          |
| **7 — Cross-flow integration**              | The headline BDD scenarios across both engines                                                    | 4, 5, 6    |
| **8 — Web surfaces**                        | Resolutions page, skipped-section un-confirm, user undo-reject                                    | 7          |
| **9 — Regeneration and final gate**         | SDK/Dart/openapi/SQL regen, i18n, revert-to-immich, full CI dispatch                              | 8          |

---

## Slice 0 — Branch consolidation

**Goal:** one branch containing both features, fully green, with the defects still present. No behaviour
change. This is the known-good baseline every later slice is measured against.

**Steps:**

1. Push backup refs before touching anything:
   `git branch backup/pr592-2026-07-22 brainstorm/face-recognition-suggestions`,
   `git branch backup/pr770-2026-07-22 origin/feat/face-cleanup-resolution`, push both.
2. `git worktree add` a fresh worktree, branch `feat/face-review-unified` from
   `origin/feat/face-cleanup-resolution`.
3. Rebase #592's commits on top. Expected conflict surface: `person.service.ts`,
   `person.repository.ts`, `schema/migrations-gallery/`, `i18n/en.json`, `scripts/revert-to-immich/`.
4. **Generated artifacts are resolved by regenerating, never by hand**: the Dart client, the TypeScript
   SDK, `open-api/immich-openapi-specs.json`, and `server/src/queries/*`. Take either side, then run
   `pnpm build && pnpm sync:open-api && make open-api`, and `make sql` **with a DB running** (running it
   without one deletes every query file).
5. Resolve migration timestamp collisions between the two branches' fork migrations.

**Edge cases**

| Edge case                                                                                                                           | Expected                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Both branches added the same i18n key with different wording                                                                        | Keep #770's admin-console wording; suggestion keys are user-facing                                              |
| **Verified collision at `1784000000000`**: #592's `AddSpacePersonFaceSuggestion` vs #770's `FixFaceRepairScanInFlightIndexOverride` | Renumber #592's (neither is deployed); `migration-timestamps` guard must pass. Slice 2 removes this file anyway |
| Dart regen produces a non-zero diff                                                                                                 | Commit it; it is a real artifact, not a conflict                                                                |
| `pnpm lint` in `web/` aborts locally (tscompat crash)                                                                               | Known: CI is the only lint gate for web                                                                         |

**Full fork-migration inventory going in** (both branches, verified):
`1778900000000-AddPersonFaceSuggestion`, `1784000000000-AddSpacePersonFaceSuggestion`,
`1784100000000-AddFaceSuggestionIntentStatuses` (#592); `1780000000000-AddFaceRepairScan`,
`1781000000000-AddFaceRepairDecline`, `1781500000000-AddFaceRepairScanFlaggedFace`,
`1783050000000-AddFaceRepairScanInFlightIndex`, `1784000000000-FixFaceRepairScanInFlightIndexOverride`,
`1785000000000-AddFaceRepairLock`, `1786000000000-FaceRepairLockPersonNullable` (#770).
Slices 2 and 5 reduce these ten to five.

**Done gate:** all 10 gating CI workflows green on the branch (`gh workflow run` per
`ci-full-set-dispatch`). Commit trailer must not add Co-Authored-By.

---

## Slice 1 — Prove the load-bearing assumption (test-only)

**Goal:** prove that `face_identity_face.source='manual'` is durable. The entire positive-verdict model —
and therefore retiring `face_repair_lock` — rests on this. Written **before** any schema exists so that a
failure changes the design, not the tests.

**Why it is in doubt:** the evidence is suggestive but not conclusive.
`face-identity.repository.ts:3037` bypasses the incompatibility guard for `'manual'`, and the priority
`CASE` at `:2029` ranks `'manual'` at 0 — but no test asserts that a full `FaceIdentityBackfill` pass
cannot downgrade an existing manual link to `'ml'`.

### TDD steps

1. **Red.** Add `server/test/medium/specs/repositories/face-identity.manual-durability.spec.ts` with the
   three scenarios below. Run:
   `cd server && pnpm test:medium -- --run test/medium/specs/repositories/face-identity.manual-durability.spec.ts`
   (note: this command form is known to drop the path filter — verify the intended file actually ran).
   Expected red: assertions on `source` fail, or the spec fails to find fixtures.
2. **Green.** No production change expected — these characterize existing behaviour. If a test is red for a
   _real_ reason, that is the STOP signal.

### BDD acceptance scenarios

```gherkin
Feature: A human's face placement is durable

  Scenario: Backfill does not overwrite a human decision
    Given face F is linked to identity I with source "manual"
    When a full FaceIdentityBackfill pass runs over that person
    Then F is still linked to I with source "manual"

  Scenario: A merge carries the human decision to the survivor
    Given face F is linked to person P's identity with source "manual"
    When P is merged into Q
    Then F resolves to the surviving identity, still with source "manual"

  Scenario: Re-affirming an existing placement is a source-only update
    Given face F is assigned to P and linked to P's identity with source "ml"
    When a human re-affirms F on P
    Then exactly one link row remains, with the same identity and source "manual"
```

The direct motivation for scenario 1 is a comment on the cleanup move path itself
(`face-repair.service.ts:250-252`): "a later FaceIdentityBackfill can resolve back to `from` and silently
revert the approved move". Backfill demonstrably _can_ rewrite links. Whether `'manual'` is immune is the
open question.

### Medium tests (exhaustive)

```
manual link durability:
  1. survives FaceIdentityBackfill
     given a face linked (I, source='manual')
     when a full backfill pass runs over that face's person
     then the link is still (I, 'manual')

  2. survives a people merge
     given face F linked (I(P), 'manual') and P is merged into Q
     then F's link resolves to the surviving identity, still source='manual'

  3. re-affirm is an idempotent source-only update
     given face F already linked (I, source='ml') and assigned to P where I = I(P)
     when replaceFaceIdentity(P, F, 'manual') runs
     then exactly one row remains, source='manual', identityId unchanged
     and the `incompatible` guard is not triggered (same identity)
```

### Edge cases

| Edge case                                              | Expected                                             |
| ------------------------------------------------------ | ---------------------------------------------------- |
| Backfill runs twice over the same manual link          | Still `'manual'`                                     |
| Merge where **both** sides have manual links to F      | One row survives (PK is `assetFaceId`), still manual |
| Re-affirm on a face whose person has no identity yet   | `ensurePersonIdentity` creates one; link is manual   |
| Re-affirm on a face linked to a **different** identity | Link is replaced (this is the move case, not #9)     |

### OUTCOME (recorded 2026-07-22): assumption was FALSE, now fixed

The probe failed on two of four scenarios. `realignFacesToPersonIdentity`
(`face-identity.repository.ts:2642`) wrote `.set({ identityId, source: 'backfill' })` **unconditionally**,
so any face whose link identity drifted from its person's identity had its `source` rewritten — `'manual'`
included. Drift is not exotic: it is the normal state immediately after a people merge, so
**every human-confirmed face was one backfill pass away from silently losing its verdict.**

Fix applied in this slice: the realign now preserves `'manual'` and realigns everything else as before
(`CASE WHEN source = 'manual' THEN 'manual' ELSE 'backfill' END`). Realigning _which_ human a face links to
is that method's job; erasing the fact that _a_ human placed it is not. All four probes pass, and the
114-test `face-identity.repository.spec.ts` plus `face-repair.merge-consistency.spec.ts` suites stay green.

The fallback (identity-keyed lock table with auto-lapse) is therefore **not needed**; Slices 2-9 proceed as
written. Note this defect existed on #770 alone — a lock survived the merge, but the identity link behind
it did not.

### Done gate

Four medium tests green **or** a written STOP in this document. **If any had proved unfixable:** retiring
`face_repair_lock` would be invalid — fall back to keeping the table but re-keyed to `identityId` with
auto-lapse when the face's current identity link no longer matches (the option-C fallback from the design
conversation). Slices 2–9 are otherwise unaffected; only Slice 5's lock deletion changes.

---

## Slice 2 — `face_person_verdict` schema + repository

**Goal:** the final-form table and its repository. No caller rewiring yet.

**Files:** new table decorator + one final migration (deleting #592's `AddPersonFaceSuggestion`,
`AddSpacePersonFaceSuggestion` and `AddFaceSuggestionIntentStatuses`), renamed repository, its medium spec,
`base.service.ts` (**three sites**), `test/medium.factory.ts`.

### TDD steps

1. **Red.** Write `server/test/medium/face-person-verdict.repository.spec.ts` covering the cases below.
   Run: `cd server && pnpm test:medium -- --run test/medium/specs/repositories/face-person-verdict.repository.spec.ts`.
   Expected red: `Unable to create repository instance` (not yet in the `newRealRepository` switch), then
   missing-table errors.
2. **Green.** Author the table decorator, the migration, and the repository. Register the repository in
   **both** `medium.factory.ts` case groups (`:530` real, `:608` automock) **and** at all three
   `BaseService` sites (`:49` import, `:131` `create()` list, `:199` ctor).
3. **Refactor.** Fold the personal and space-person upsert paths onto one parameterised implementation now
   that both carry `identityId`.

Deletes `1778900000000-AddPersonFaceSuggestion`, `1784000000000-AddSpacePersonFaceSuggestion` and
`1784100000000-AddFaceSuggestionIntentStatuses`, replacing all three with one final-form migration.

### BDD acceptance scenarios

```gherkin
Feature: One verdict answers the question in every scope

  Scenario: A verdict written on a personal person is found by identity
    Given Anna exists as a personal person and a space person sharing identity I
    And a rejection is recorded for face F against the personal Anna
    When the verdict layer is queried for F against the space Anna
    Then the rejection is found

  Scenario: A verdict written before an identity exists is still found
    Given person P has no identity yet
    And a rejection is recorded for face F against P
    When the verdict layer is queried for F against P
    Then the rejection is found

  Scenario: A verdict outlives the person it was written against
    Given a rejection for face F against person P, whose identity is I
    When P is hard-deleted while I survives
    Then the rejection is still found when querying F against I

  Scenario: A resolved verdict is never resurrected by a scan
    Given face F was rejected for person P
    When a suggestion scan proposes F for P again
    Then the stored row remains "rejected" and no pending row is created
```

### Medium tests (exhaustive)

```
identity-first read with target fallback:
  verdict written with (personId=P, identityId=I)   -> matches query by I         PASS
  verdict written with (personId=P, identityId=NULL)-> matches query by P         PASS
  verdict written with (personId=P, identityId=I)   -> matches query by P         PASS
  verdict written with (spacePersonId=S, identityId=I) -> matches query by I      PASS
  verdict for identity I                            -> does NOT match identity J  PASS

uniqueness + never-reappear:
  upsertPending twice for (P,F)                     -> one row, distance updated
  upsertPending for (P,F) where status='rejected'   -> row unchanged, stays rejected
  upsertPending for (P,F) where status='ignored'    -> row unchanged, stays ignored
  same F, two different targets P and Q             -> two rows, both allowed

lifecycle:
  person P hard-deleted, row had identityId=I       -> row survives, personId NULL
  person P hard-deleted, row had identityId=NULL    -> row survives, unreachable (no error)
  identity I deleted                                -> rows with identityId=I CASCADE away
  face F deleted                                    -> all rows for F CASCADE away
  both personId and spacePersonId set               -> CHECK violation
  status outside the enum / source outside the enum -> CHECK violation

band read (queue):
  distance NULL row with status='pending'           -> excluded from the band read
  distance inside (maxDistance, suggestionMaxDistance] -> included
  distance exactly == maxDistance                   -> excluded (strict >)
  distance exactly == suggestionMaxDistance         -> included (inclusive <=)
  suggestionMaxDistance <= maxDistance              -> read returns empty (feature gate)
  person unnamed / hidden / type != 'person'        -> read returns empty (scannable gate)
  face is assigned (personId NOT NULL)              -> excluded
  face is soft-deleted (deletedAt NOT NULL)         -> excluded
```

### Edge cases

| Edge case                                                     | Expected                                     | Verified by                    |
| ------------------------------------------------------------- | -------------------------------------------- | ------------------------------ |
| Target acquires an identity _after_ the verdict was written   | Still matched via target fallback; no re-key | identity-first read case 2 + 3 |
| Personal P and space S share identity I; verdict written on P | Suppresses S too                             | identity-first read case 4     |
| Person deleted while identity survives                        | Verdict survives, keyed by identity          | lifecycle case 1               |
| Row fully orphaned (no target, no identity)                   | Unreachable, harmless, dies with the face    | lifecycle case 2 + 4           |
| Cleanup-sourced row has `distance` NULL                       | Never appears in the pending band read       | band read case 1               |
| Concurrent scan upsert vs user reject                         | Conditional upsert cannot resurrect          | never-reappear cases 2–3       |

### Done gate

`cd server && pnpm test:medium -- --run test/medium/face-person-verdict.repository.spec.ts`;
`pnpm test`; `make sql` (DB running); `migration-timestamps` guard passes; `pnpm lint`, `pnpm check`.
Commit `feat(server): face_person_verdict schema and repository`.

---

## Slice 3 — Shared exclusion predicates

**Goal:** one module both engines consume, so the three checks can never drift apart.

**Grounding (verified).** Cleanup does **not** filter in SQL. `face-repair.service.ts` calls
`applyDeclineFilters(flaggedByPerson, declineMaps)` at `:161`, `:587` and `:775` — an **in-memory**
post-filter over `Map<currentPersonId, FlaggedLike[]>`, where
`FlaggedLike = { assetFaceId, currentPersonId, suspectedOwnerId }`. Its input `DeclineMaps` is built by
`getDeclineMaps({ personIds, assetFaceIds })`, which is **already scoped** to the flagged set and
explicitly refuses to load the whole table on an unscoped read. This slice therefore **generalises the
existing function in place** rather than introducing a new SQL layer — a far smaller and safer change than
the design conversation assumed.

**Files:** `server/src/utils/face-repair.ts` (rename `applyDeclineFilters` → `applyVerdictFilters`,
generalise `DeclineMaps` → `VerdictMaps`) + its unit spec; the scoped fetch moves onto the new repository.

### The pure function

Same in-memory shape, same call sites, one new map and one generalised one:

```ts
// utils/face-repair.ts
export interface VerdictMaps {
  // NEW: faces a human has placed (face_identity_face.source='manual'). Owner-agnostic — replaces
  // DeclineMaps.lockedFaceIds one-for-one, so the existing filter arm is unchanged in shape.
  manualLinkedFaceIds?: Set<string>;
  // GENERALISED: was declinedFaceOwners (assetFaceId -> Set<suspectedOwnerId>). Now keyed by target
  // token so an identity-level verdict matches a person-level suspicion of the same human.
  negativeFaceTargets: Map<string, Set<string>>; // assetFaceId -> Set<targetToken>
  // UNCHANGED: the cluster mute.
  mutedPersons: Map<string, Set<string>>; // currentPersonId -> Set<suspectedOwnerId>
}

// A suspected owner is matched by BOTH tokens, so an identity-keyed verdict and a
// person-keyed one both hit. Deterministic, no DB access, trivially unit-testable.
export function targetTokens(target: { personId?: string; spacePersonId?: string; identityId?: string }): string[];

export function applyVerdictFilters<T extends FlaggedLike>(flaggedByPerson: Map<string, T[]>, maps: VerdictMaps): void;
```

The filter order from `applyDeclineFilters` is preserved exactly and for the same documented reason:
manual-link and face-level negatives run **before** the person-level mute, so a face re-flagged toward a
_new_ owner keeps its person surfaced.

Rationale per rule (each is a test row):

- `softDeleted` → excluded for **everyone**: the face is a not-a-face tombstone.
- `hasManualLink` → excluded for **everyone**: a human already placed this face.
- a negative verdict matching the target → excluded **for that target only**: a face declined toward O
  stays flaggable toward Q. This is the one rule that is target-scoped, and getting it wrong silently
  destroys #770's decline semantics.

### Unit tests (exhaustive)

```
targetTokens:
  { personId: P }                     -> ['person:P']
  { personId: P, identityId: I }       -> ['person:P', 'identity:I']
  { spacePersonId: S, identityId: I }  -> ['space-person:S', 'identity:I']
  { identityId: I }                    -> ['identity:I']
  {}                                   -> []            // never matches anything

applyVerdictFilters:
  manual-linked face, no negatives             -> dropped for every suspected owner
  face negative on 'identity:I',
      suspected owner tokens include 'identity:I'  -> dropped
  face negative on 'identity:I',
      suspected owner tokens include 'identity:J'  -> KEPT
  face negative on 'person:P', suspected owner P   -> dropped
  face negative on 'person:P', suspected owner Q   -> KEPT      (target-scoped, #770 semantics)
  face negative on 'person:P' only,
      suspected owner tokens ['person:P','identity:I'] -> dropped  (fallback path)
  face negative on 'identity:I' only,
      suspected owner tokens ['person:P','identity:I'] -> dropped  (identity-first path)
  no link, no negatives                        -> KEPT
  manual link AND negative verdict             -> dropped (either arm suffices, no ordering dependency)
  person muted, remaining owners are a subset of the fingerprint -> whole person dropped
  person muted, a NEW suspected owner appears                    -> person surfaced again
  face dropped by manual link leaves the person with zero faces  -> person drains (empty array, not stuck)
```

### Medium tests

The scoped fetch (`manualLinkedFaceIds` and `negativeFaceTargets` for a given set of flagged face ids)
returns exactly the rows the pure function expects, and never performs an unscoped read — asserted by
passing an empty scope and expecting empty maps, mirroring `getDeclineMaps`'s existing
"empty scope matches nothing" guard.

### BDD acceptance scenarios

```gherkin
Feature: One exclusion rule set, shared by both engines

  Scenario: A human placement hides a face from every suspicion
    Given face F carries a human placement
    When the cleanup filter runs with F suspected toward any owner
    Then F is excluded

  Scenario: A rejection is scoped to the human it was about
    Given face F was rejected against Anna
    When the cleanup filter runs with F suspected toward Anna
    Then F is excluded
    But when F is suspected toward Bob
    Then F is kept
```

### Edge cases

| Edge case                                           | Expected                                         |
| --------------------------------------------------- | ------------------------------------------------ |
| Face has a manual link to identity I, target is I   | Excluded (positive verdict beats everything)     |
| Face has both a manual link and a negative verdict  | Excluded; no ordering dependency                 |
| Target has no identity and no verdict rows          | Not excluded                                     |
| Negative verdict row whose target was `SET NULL`-ed | Matched by `identityId` only; no false positives |

### Done gate

`cd server && pnpm test -- --run src/utils/face-verdict-filters.spec.ts` and the medium spec green;
`pnpm lint`, `pnpm check`. Commit `feat(server): shared face verdict exclusion predicates`.

---

## Slice 4 — Suggestion side rewiring

**Goal:** write-matrix rows 1–4 and the suggestion scan, on the shared layer.

**Changes:** `markConfirmed` is deleted (no `confirmed` status); `confirmFaceSuggestion` calls the shared
purge helper; `markRejected`/`markIgnored` additionally persist `identityId`, `source='suggestion'` and
`actorId`; `handlePersonSuggestionScan` and its space-person twin consult the Slice 3 predicates.

### TDD steps

1. **Red.** Extend `person.service.spec.ts` with one test per write-matrix row asserting **exactly** which
   of the three stores each action touches (including the stores it must _not_ touch).
   Run: `cd server && pnpm test -- --run src/services/person.service.spec.ts`.
   Expected red: `markConfirmed is not a function` / missing `identityId` on the reject write.
2. **Green.** Rewire the service and the scan.
3. **Refactor.** Collapse `dismissFaceSuggestion` onto `rejectFaceSuggestion` explicitly (it already
   delegates) and document the confirm/reject RBAC asymmetry in place.

### Unit + medium tests

```
write matrix (one test each, asserting all three stores):
  confirm  -> asset_face.personId := P; manual link replaced; pending purged for F (all targets)
  confirm  -> writes NO verdict row (no 'confirmed' status exists)
  reject   -> verdict row (F,P,I(P),'rejected','suggestion',actor); asset_face untouched;
              face_identity_face untouched
  ignore   -> same but 'ignored'
  dismiss  -> identical observable effect to reject

scan:
  face with a manual link                 -> not proposed to anyone
  face soft-deleted                       -> not proposed to anyone
  face with negative verdict toward P     -> not proposed for P, still proposed for Q
  face with negative verdict toward I     -> not proposed for personal P or space S sharing I
  suggestionMaxDistance <= maxDistance    -> scan skipped
  person unnamed / hidden / type != person-> scan skipped
```

### BDD acceptance scenarios

```gherkin
Feature: Reviewing a face suggestion

  Scenario: Confirming assigns the face and records the placement
    Given face F is suggested as Anna
    When I confirm it
    Then F is assigned to Anna
    And F carries a human placement
    And no suggestion for F remains pending for anyone

  Scenario: Rejecting records a durable "not this person"
    Given face F is suggested as Anna
    When I reject it
    Then F remains unassigned
    And a rejection for F against Anna is recorded
    And a later suggestion scan does not propose F for Anna
    But a later scan may still propose F for Bob

  Scenario: Ignoring behaves like rejecting but records a different intent
    Given face F is suggested as Anna
    When I ignore it
    Then a later suggestion scan does not propose F for Anna
    And the recorded intent reads "ignored", not "rejected"
```

### Edge cases

| Edge case                                                              | Expected                                                    |
| ---------------------------------------------------------------------- | ----------------------------------------------------------- |
| Confirm a suggestion whose face was assigned by someone else meanwhile | Idempotent no-op; existing benign-400 path preserved        |
| Confirm where the person was deleted meanwhile                         | `requireAccess` 400 (owner-only precedence), unchanged      |
| Reject on a CASCADE-deleted face                                       | 0 rows affected, benign 200 — documented existing asymmetry |
| Two targets pending on the same face; one confirmed                    | The other's pending row is purged, not marked               |
| Space-person suggestion by a viewer (not owner/editor)                 | Forbidden; RBAC unchanged                                   |
| Scan runs concurrently with a user reject                              | Conditional upsert cannot resurrect the rejected row        |

### Done gate

`cd server && pnpm test && pnpm test:medium` for the touched specs; `pnpm lint`, `pnpm check`.
Commit `feat(server): route face suggestions through the shared verdict layer`.

---

## Slice 5 — Cleanup side rewiring, lock retired

**Goal:** write-matrix rows 6–11; `face_repair_lock` deleted; `face_repair_decline` narrowed to
`face_repair_cluster_mute`.

**Changes:** delete the lock table, migration and repository (and its `BaseService` +
`medium.factory.ts` registrations); `getLockedFaceIds()` becomes a join through the Slice 3 predicates;
moves stop writing locks; **Confirm/lock becomes `replaceFaceIdentity(currentPerson, F, 'manual')`**;
keep-here writes a `face_person_verdict` row instead of a decline; detach calls the shared purge helper;
`applyDeclineFilters` is replaced by the shared predicates for the face-level case and retained only for
cluster mutes.

### TDD steps

1. **Red.** Extend `face-repair.service.spec.ts` with one test per write-matrix row 6–11.
   Run: `cd server && pnpm test -- --run src/services/face-repair.service.spec.ts`.
   Expected red: assertions that no lock row is written fail (a lock is still written).
2. **Green.** Rewire; delete the lock module; narrow the decline module.
3. **Refactor.** Remove #770's now-redundant lock merge-survival machinery from commit `76aff4188d`, and
   delete its tests — they are replaced by Slice 1's identity-level durability tests. Delete the two lock
   migrations `1785000000000-AddFaceRepairLock` and `1786000000000-FaceRepairLockPersonNullable`; replace
   `1781000000000-AddFaceRepairDecline` with the narrowed cluster-mute migration. Deregister
   `FaceRepairLockRepository` from both `medium.factory.ts` groups and all three `BaseService` sites.
   Existing medium specs that call `getLockedFaceIds()` (`face-repair.merge-consistency.spec.ts:79,102`,
   `face-repair.resolutions.spec.ts:176,185`) are rewritten against human placements.

### BDD acceptance scenarios

```gherkin
Feature: Resolving a flagged face in the cleanup console

  Scenario: Moving a face records the placement without a separate lock
    Given face F is flagged in Anna's cluster, suspected to be Bob's
    When I move F to Bob
    Then F is assigned to Bob
    And F carries a human placement
    And a re-scan does not flag F again

  Scenario: Keeping a face here is scoped to the owner it was suspected toward
    Given face F is flagged in Anna's cluster, suspected to be Bob's
    When I choose "keep here"
    Then a re-scan does not flag F toward Bob
    But a re-scan may flag F toward Carol

  Scenario: Confirming a face is owner-agnostic
    Given face F keeps being suspected toward a different person on each scan
    When I confirm F on its current person
    Then no future scan flags F toward any owner

  Scenario: A face declared "not a face" leaves both queues for good
    Given face F is flagged in Anna's cluster
    When I resolve F as "not a face"
    Then F is unassigned and tombstoned
    And it carries no human placement
    And neither a cleanup scan nor a suggestion scan ever proposes it again
```

### Unit + medium tests

```
write matrix (one test each):
  move to owner O    -> personId := O; manual link (I(O)); pending purged; NO lock row anywhere
  move to person Q   -> personId := Q; manual link (I(Q)); pending purged
  keep here          -> verdict row (F,O,I(O),'rejected','cleanup',actor); asset_face untouched
  confirm / lock     -> manual link re-affirmed on the CURRENT person; no asset_face write
  not a face         -> personId NULL + deletedAt set; identity link deleted; pending purged
  cluster mute       -> cluster-mute row only

scan exclusion:
  face with a manual link                 -> not flagged for any suspected owner
  face declined toward O                  -> not flagged toward O, still flagged toward Q
  face soft-deleted                       -> not eligible at all
  person fully excluded                   -> drains from the console (no empty stuck person)
  cluster-muted person whose suspected-owner set is unchanged -> still muted
  cluster-muted person with a NEW suspected owner             -> reappears
```

### Edge cases

| Edge case                                               | Expected                                                    |
| ------------------------------------------------------- | ----------------------------------------------------------- |
| Confirm/lock on a face whose person has no identity yet | `ensurePersonIdentity` creates one; link is manual          |
| Confirm/lock on an already-manual face                  | Idempotent source-only update                               |
| A face resolved two ways in one request                 | 400, existing `findOverlappingIds` guard preserved          |
| Empty resolve (nothing to move/stay/lock/detach)        | 400, existing guard preserved                               |
| Destination person deleted between scan and resolve     | 400 for that group; existing re-validation preserved        |
| Cross-owner move attempt                                | Blocked; existing C6 defence-in-depth preserved             |
| Move where source person is emptied                     | Existing delete-gate (`countAllFaces`, not `countEligible`) |
| Detach then a later suggestion scan                     | Never re-proposed (Slice 6 makes this structural)           |
| Self-move (destination == current person)               | Harmless no-op; documented in #770's follow-ups             |

### Done gate

`cd server && pnpm test && pnpm test:medium` for the touched specs; `grep` proves no `face_repair_lock`
references remain; `pnpm lint`, `pnpm check`.
Commit `feat(server): retire face_repair_lock in favour of manual identity links`.

---

## Slice 6 — The two safety fixes

**Goal:** close defect 2 and hazard 8 at their source.

**Changes:** `searchFaces` gains `.where('asset_face.deletedAt', 'is', null)`;
`personRepository.unassignFaces()` clears `face_identity_face` manual links in the same operation.

### TDD steps

1. **Red.** Add medium tests: a soft-deleted face is not returned by `searchFaces`; after
   `unassignFaces()` no manual links remain. Run:
   `cd server && pnpm test:medium -- --run test/medium/specs/repositories/face-verdict-safety.spec.ts`.
   Expected red: the soft-deleted face **is** returned; the manual link **does** remain.
2. **Green.** Apply both changes.

### BDD acceptance scenarios

```gherkin
Feature: Deleted faces and reset libraries leave no phantom state

  Scenario: A tombstoned face is not a search candidate
    Given face F has been tombstoned as "not a face"
    When any embedding search for unassigned faces runs
    Then F is not among the results

  Scenario: Resetting all people clears human placements too
    Given several faces carry human placements
    When an admin resets all people and re-runs recognition
    Then no face carries a stale human placement
    And every face is eligible for recognition again
```

### Edge cases

| Edge case                                                       | Expected                                                             |
| --------------------------------------------------------------- | -------------------------------------------------------------------- |
| `searchFaces` used by facial recognition (not just suggestions) | Soft-deleted faces excluded there too — correct, they are deleted    |
| `searchFaces` with `spaceId` scope                              | Same exclusion; the three-path scope helper is unaffected            |
| `unassignFaces` on a library with zero manual links             | No-op, no error                                                      |
| `unassignFaces` chunking for very large libraries               | Chunked like the sibling paths; stays under the bind-parameter limit |
| A face whose only link is `source='ml'`                         | Untouched by the manual-link clear                                   |
| `queueRecognizeFaces(force)` end-to-end                         | Faces re-enter recognition with no phantom positive verdicts         |

### Done gate

Medium spec green; `pnpm test` (the shared `searchFaces` change has wide blast radius — run the full
server suite, not just the touched specs); `pnpm lint`, `pnpm check`.
Commit `fix(server): exclude soft-deleted faces from search and clear manual links on bulk unassign`.

---

## Slice 7 — Cross-flow integration

**Goal:** prove the leaks are actually closed end-to-end, across both engines. This is the slice that
would have caught every defect in §2.4.

### BDD acceptance scenarios (medium/e2e, red-first)

```gherkin
Feature: Face decisions are shared between suggestions and cleanup

  Scenario: A confirmed suggestion is never re-flagged        # defect 1, the headline
    Given a named person Anna and an unassigned face F in the suggestion band
    When I confirm F as Anna
    And an admin runs a face cleanup scan
    Then F is not flagged for any suspected owner
    And F is still assigned to Anna

  Scenario: A detached face is never re-suggested             # defect 2
    Given a face F assigned to Anna and flagged by a cleanup scan
    When the admin resolves F as "not a face"
    And a suggestion scan runs
    Then no pending suggestion row exists for F for any person

  Scenario: A cleanup move leaves no stale suggestion         # defect 3
    Given face F has a pending suggestion for Bob
    When an admin moves F to Carol
    Then no pending suggestion row exists for F

  Scenario: A user's rejection suppresses a later cleanup flag  # defect 4 + cross-flow
    Given I reject the suggestion that face F is Anna
    When F is later assigned to Bob and an admin runs a cleanup scan
    Then F is not flagged toward Anna
    But F may still be flagged toward Carol

  Scenario: An admin's "keep here" suppresses a later suggestion  # cross-flow, reverse
    Given an admin resolves face F as "keep here" against suspected owner Olive
    When F is later unassigned and a suggestion scan runs
    Then F is not proposed for Olive

  Scenario: One rejection answers personal and space scope     # defect 5
    Given Anna exists as a personal person and as a space person sharing one identity
    When I reject face F for the personal Anna
    And a suggestion scan runs
    Then F is not proposed for the space Anna either

  Scenario: Un-confirming makes a face eligible again          # undo path
    Given face F has a manual identity link from a confirm
    When an admin un-confirms F from the cleanup review page
    And a cleanup scan runs
    Then F may be flagged again
```

### Edge cases

| Edge case                                                      | Expected                                             |
| -------------------------------------------------------------- | ---------------------------------------------------- |
| Confirm then merge Anna into Anna-duplicate, then cleanup scan | Still not flagged (identity survives the merge)      |
| Reject, then Anna is renamed                                   | Verdict persists; scannable gate handles the rest    |
| Reject, then Anna is deleted but the identity survives         | Verdict persists via `identityId`                    |
| Reject, then Anna is deleted and had no identity               | Row orphaned, unreachable, harmless                  |
| Suggestion confirm, then the user unassigns in the face editor | Manual link replaced; face eligible again — intended |
| Both engines scan concurrently                                 | No collision; the two queues are mutually exclusive  |

### Done gate

Full `pnpm test:medium` and the e2e API suite green. Note the known trap: `waitForQueueFinish` returns
"done" while a queue is merely empty because the job has not been enqueued yet — **poll the
post-condition**, not the queue. Commit `test: cross-flow coverage for the shared face verdict layer`.

---

## Slice 8 — Web surfaces

**Goal:** the three undo surfaces from §5.3.

**Changes (all routes verified to exist on #770):**
`web/src/routes/admin/face-cleanup/resolutions/+page.svelte` becomes negatives-only with `source` and
`actor` columns plus a source filter (so admin declines do not drown in user rejects), and its locks
section is removed; `web/src/routes/admin/face-cleanup/[personId]/+page.svelte` (+ its `review.svelte.ts`
state module) gains a per-person **"skipped: human-confirmed"** section with an un-confirm action; the
person detail page gains undo-my-reject. Existing specs to update alongside:
`resolutions/page.spec.ts`, `[personId]/page.spec.ts`, `[personId]/review.spec.ts`.
The `admin/face-cleanup/declined/+page.ts` redirect stays.

E2E specs follow the repo convention `e2e/src/specs/web/<name>.e2e-spec.ts`.

### TDD steps

1. **Red.** Component specs for the three surfaces + Playwright specs, written before the routes exist.
   Run: `cd web && pnpm test -- --run <spec>` then the Playwright suite.
2. **Green.** Wire the routes and endpoints.

### BDD acceptance scenarios (Playwright, red-first)

```gherkin
  Scenario: Resolutions page separates the two sources
    Given both an admin decline and a user rejection exist
    When I open /admin/face-cleanup/resolutions
    Then both are listed with their source and actor
    And filtering by source "cleanup" hides the user rejection
    And no "locks" section is shown

  Scenario: Un-confirming from the review page
    Given a person whose cleanup scan skipped a human-confirmed face
    When I open that person's review page
    Then the face appears in the "skipped: human-confirmed" section
    And un-confirming it makes it eligible for the next scan

  Scenario: A user undoes their own rejection
    Given I rejected face F for Anna
    When I undo that rejection from Anna's page
    And a suggestion scan runs
    Then F is proposed for Anna again
```

### Edge cases

| Edge case                                            | Expected                                              |
| ---------------------------------------------------- | ----------------------------------------------------- |
| Resolutions page with zero rows                      | Empty state, no crash                                 |
| Verdict whose target person was `SET NULL`-ed        | Rendered by identity, or omitted — never a broken row |
| Space-person verdict listed on the admin page        | Shown with its space named                            |
| Space **viewer** attempts undo-reject                | Action absent; server rejects if forced               |
| Un-confirm a face that was meanwhile deleted         | Benign no-op with a toast                             |
| "skipped" section for a person with no skipped faces | Section hidden entirely                               |

### Done gate

`cd web && pnpm check:typescript && pnpm check:svelte && pnpm lint && pnpm test`, plus the Playwright web
suite against the **e2e stack on :2285** (`make e2e-web-dev` on :2283 serves 0-byte bodies on a dev stack
and produces bogus "element not found" failures).
Commit `feat(web): unified face verdict review surfaces`.

---

## Slice 9 — Regeneration and final gate

**Goal:** the branch is shippable.

**Steps:**

1. `cd server && pnpm build && pnpm sync:open-api`, then `make open-api` (TypeScript SDK + Dart client).
2. `make sql` with a DB running.
3. i18n: add new keys to `i18n/en.json`; remove the ~17 orphaned `face_cleanup_*` keys in the de/fr locale
   files noted in #770's follow-ups. Remember `i18n/` is shared by web **and** mobile — grep both before
   deleting a key.
4. `scripts/revert-to-immich/` covers the final five fork migrations; run the Revert-to-Immich Validation
   workflow (known to false-fail when a delta adds a migration — read the failure, do not assume).
5. Dispatch the full gating set per `ci-full-set-dispatch` and babysit to green.
6. PR description must state: reviewers should diff against the union of #592 and #770 and focus on the
   unification commits; and **any RC or personal clone that ran either branch must be reset, not
   upgraded** — recorded migration names no longer exist on disk and Kysely hard-fails on boot.

### Done gate

All 10 gating workflows green. #592 and #770 marked superseded (not merged).

---

## 7. Risks

| ID     | Risk                                                                                                                                                                                                                       | Mitigation                                                                                                         |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **R1** | **The whole positive-verdict model rests on `face_identity_face.source='manual'` surviving `FaceIdentityBackfill`.** Evidence is suggestive (`:3037`, `:2029`) but unproven. If false, retiring the lock table is invalid. | **Slice 1 proves it before any schema is written**, with a written fallback (identity-keyed lock with auto-lapse). |
| **R2** | The rebase: 130 commits over a large overlapping surface.                                                                                                                                                                  | Backup refs pushed first; regenerate rather than hand-resolve generated artifacts; full CI after Slice 0.          |
| **R3** | Migration timestamp collisions — #770 already had to renumber twice.                                                                                                                                                       | Fresh non-colliding timestamps in Slice 2/5; `migration-timestamps` guard is a hard gate.                          |
| **R4** | RC/personal clones that ran either branch will not boot.                                                                                                                                                                   | Reset, do not upgrade. Stated in the PR description (Slice 9).                                                     |
| **R5** | Review surface is the union of two large PRs.                                                                                                                                                                              | Three-block branch shape keeps blocks 1–2 diffable against the already-reviewed PRs.                               |
| **R6** | Confirm/lock (write-matrix #9) is the one genuinely new implementation.                                                                                                                                                    | Explicit tests in Slice 1 (re-affirm idempotence) and Slice 5.                                                     |
| **R7** | `searchFaces` is shared with facial recognition; the `deletedAt` fix has wide blast radius.                                                                                                                                | Slice 6's done gate runs the **full** server suite, not just touched specs.                                        |
| **R8** | Subagent-reported "green" routinely misses what integrated runs and CI catch.                                                                                                                                              | Every done gate is run in full by the driving session, not delegated.                                              |

---

## 8. Coverage matrix (every defect and edge case → slice → test)

| #   | Defect / edge case                                           | Slice | Test                                                        |
| --- | ------------------------------------------------------------ | ----- | ----------------------------------------------------------- |
| 1   | Confirm → cleanup re-flag ping-pong                          | 7     | BDD "confirmed suggestion is never re-flagged"              |
| 2   | Detach → unbounded dead suggestion rows                      | 6, 7  | medium `searchFaces` soft-delete; BDD "never re-suggested"  |
| 3   | Cleanup move leaves stale pending rows                       | 5, 7  | write-matrix rows 6–7; BDD "no stale suggestion"            |
| 4   | Two negative ledgers                                         | 2, 7  | repository identity-first reads; BDD "rejection suppresses" |
| 5   | Personal / shared-space scope mismatch                       | 2, 7  | identity-first read case 4; BDD "personal and space"        |
| 6   | Lock black hole (no revocation path)                         | 5     | lock module deleted; grep gate                              |
| 7   | ~~`getLockedFaceIds()` unbounded~~ — withdrawn, see §2.4     | —     | n/a; live path was already scoped                           |
| 8   | `unassignFaces` phantom positives                            | 6     | medium "no manual links remain"                             |
| 9   | Manual link survives backfill                                | 1     | durability case 1                                           |
| 10  | Manual link survives merge                                   | 1     | durability case 2                                           |
| 11  | Re-affirm is idempotent                                      | 1, 5  | durability case 3; confirm/lock write-matrix row            |
| 12  | Target has no identity yet                                   | 2     | identity-first read case 2                                  |
| 13  | Target acquires an identity later                            | 2     | identity-first read cases 2–3                               |
| 14  | Person deleted, identity survives                            | 2, 7  | lifecycle case 1; BDD edge table                            |
| 15  | Person deleted, no identity                                  | 2     | lifecycle case 2                                            |
| 16  | Face deleted                                                 | 2     | lifecycle case 4                                            |
| 17  | Both targets set on one row                                  | 2     | CHECK violation case                                        |
| 18  | Cleanup row has NULL `distance`                              | 2     | band read case 1                                            |
| 19  | Band boundaries (`==maxDistance`, `==suggestionMaxDistance`) | 2     | band read cases 3–4                                         |
| 20  | Feature gate `suggestionMaxDistance <= maxDistance`          | 2, 4  | band read case 5; scan skip                                 |
| 21  | Scannable gate (unnamed / hidden / non-person)               | 2, 4  | band read case 6; scan skip                                 |
| 22  | Decline stays target-scoped (O vs Q)                         | 3, 5  | pure fn rows 4/6; scan-exclusion case 2                     |
| 23  | Positive verdict beats negative                              | 3     | pure fn "manual link AND negative verdict"                  |
| 24  | Concurrent scan vs user action                               | 2, 4  | never-reappear cases 2–3                                    |
| 25  | Two targets pending on one face, one confirmed               | 4     | write-matrix confirm purge                                  |
| 26  | Confirm/reject RBAC asymmetry preserved                      | 4     | service specs                                               |
| 27  | Space viewer cannot write verdicts                           | 4, 8  | RBAC spec; Playwright edge                                  |
| 28  | Resolve-two-ways / empty-resolve guards preserved            | 5     | face-repair service specs                                   |
| 29  | Cross-owner move still blocked                               | 5     | face-repair service specs                                   |
| 30  | Emptied source person delete-gate preserved                  | 5     | face-repair service specs                                   |
| 31  | Cluster mute still works; new suspected owner reappears      | 5     | scan-exclusion cases 5–6                                    |
| 32  | `searchFaces` space-scope branch unaffected                  | 6     | medium spaceId case                                         |
| 33  | Recognition unaffected by the `deletedAt` fix                | 6     | full server suite                                           |
| 34  | Un-confirm makes a face eligible again                       | 7, 8  | BDD "un-confirming"; Playwright                             |
| 35  | Undo-reject makes a face suggestible again                   | 8     | Playwright "user undoes their own rejection"                |
| 36  | Resolutions page source filter, no locks section             | 8     | Playwright "separates the two sources"                      |
| 37  | Skipped section hidden when empty                            | 8     | component spec                                              |
| 38  | Verdict row whose target was `SET NULL`-ed renders safely    | 8     | component spec                                              |
| 39  | Both engines scanning concurrently                           | 7     | BDD edge table                                              |
| 40  | Confirm → merge → cleanup scan still not flagged             | 7     | BDD edge table                                              |

---

## 9. Process notes for impl-loop

- Slice plans are saved to `docs/superpowers/plans/2026-07-22-face-review-unification-slice-<n>.md`.
- Each slice: red test with the exact command and expected red output → green → refactor → done gate run
  **in full by the driving session** → commit → push.
- **Slice 1 is a gate, not a formality.** If it fails, stop and revise this document before writing schema.
- Slices are increments of one PR, not independent releases; the branch must be green after each, but only
  Slice 9 is shippable.
- No `Co-Authored-By` or `Generated with` trailers on any commit.
- Known local-verify traps that apply here: `pnpm test -- --run <path>` and
  `pnpm test:medium -- --run <path>` can drop the path filter (verify the intended file ran); `make sql`
  without a running DB deletes every query file; web `pnpm lint` may abort locally, leaving CI as the only
  lint gate; the web Playwright suite must run against :2285, not :2283.

---

## 2026-07-23 corrections

Recorded during the TDD remediation (`specs/2026-07-23-face-verdict-layer-remediation-design.md`,
Slices 1–10). This document is left otherwise unedited; the four corrections below are the ones the
remediation's review surfaced.

1. **§4.2 — the `face_repair_cluster_mute` rename never shipped.** The table, its repository, and its
   migration are still named `face_repair_decline`
   (`server/src/schema/tables/face-repair-decline.table.ts`,
   `server/src/repositories/face-repair-decline.repository.ts`,
   `server/src/schema/migrations-gallery/1781000000000-AddFaceRepairDecline.ts`). Slice 5 narrowed the table
   to the cluster-mute shape §4.2 describes (dropping `type`, `assetFaceId`, `suspectedOwnerId` in favor of
   the `suspectedOwnerIds` jsonb column) but kept the pre-existing name throughout. Read every `§4.2`/`§3.4`
   reference to `face_repair_cluster_mute` as `face_repair_decline`.

2. **§4.4 — the final fork-migration set is six, not five.** The listed set (`AddFacePersonVerdict`,
   `AddFaceRepairScan`, `AddFaceRepairScanFlaggedFace`, `AddFaceRepairScanInFlightIndex`,
   `AddFaceRepairClusterMute`) omits `1784000000000-FixFaceRepairScanInFlightIndexOverride`, which is
   unchanged by this feature but is part of the surviving set all the same (confirmed against
   `server/src/schema/migrations-gallery/`). §3.4/§4.4's "Slices 2 and 5 reduce these ten to five" (line 413)
   should read **ten to six**: the three #592 migrations (`AddPersonFaceSuggestion`,
   `AddSpacePersonFaceSuggestion`, `AddFaceSuggestionIntentStatuses`) collapse into one
   (`AddFacePersonVerdict`, −2), and the two #770 lock migrations (`AddFaceRepairLock`,
   `FaceRepairLockPersonNullable`) are retired outright (−2) — net −4 against the ten-migration starting
   inventory in §3.4, landing on six, not five. (`AddFaceIdentities` and
   `ReconcileFaceIdentityIndexOverrides` are pre-existing infrastructure outside this feature's ten-migration
   inventory and are unaffected either way.)

3. **§8 coverage matrix rows 34, 35, 37 claim tests that were never written.** Two follow-ups referenced by
   these rows were deferred, not shipped:
   - **Un-confirm / skipped-section (rows 34, 37).** Row 34's "BDD 'un-confirming'" claims a
     `face-review-cross-flow.spec.ts` scenario for "un-confirm → re-flag" (§ Slice 7's Gherkin scenario
     "Un-confirming makes a face eligible again") — no such scenario exists in
     `server/test/medium/specs/services/face-review-cross-flow.spec.ts`; only the admin-side
     `unconfirmFaces`/`X2` e2e coverage (`e2e/src/specs/web/face-cleanup.e2e-spec.ts`) shipped. Row 37's
     "skipped section hidden when empty" component spec was never built — no such UI element exists under
     `web/src/routes/admin/face-cleanup/`.
   - **Undo-my-reject (row 35).** No user-facing "undo my own rejection" surface or Playwright spec exists
     anywhere in `web/src` or `e2e/src` — the only undo surface shipped is the admin Resolutions page
     (§5.3), which is global/admin-scoped, not the per-user surface row 35 describes.

   Mark rows 34, 35, 37 **deferred, not covered** rather than tested.

4. **§3.2's merge-safety claim was false.** The "Negative verdict is identity-first with target fallback"
   row claims a reject "survives merges for free" — at the time this was written, `face_person_verdict
.identityId` was `ON DELETE CASCADE` (as shipped in the original `AddFacePersonVerdict` migration), so a
   merge that deleted the losing identity **destroyed** the verdict row rather than letting it survive.
   `server/src/repositories/person.repository.ts` carried a matching comment asserting the same
   free-durability claim. Both were corrected by the remediation's Slice 1
   (`docs/superpowers/plans/2026-07-23-face-verdict-remediation-slice-1.md`): merges now re-key
   `identityId`/re-target `personId`/`spacePersonId` onto the survivor inside the existing merge
   transactions, and the FK itself was flipped to `ON DELETE SET NULL` as defense-in-depth for any deletion
   path that misses the re-key (identity GC, future code) — degrading an orphaned row to target-fallback
   matching instead of destroying it. The `person.repository.ts` comment was rewritten to describe this
   actual (re-key + SET-NULL-degrade) mechanism instead of a "for free" guarantee.
