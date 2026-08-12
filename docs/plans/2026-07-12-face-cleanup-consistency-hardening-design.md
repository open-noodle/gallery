# Face Cleanup — temporal-consistency hardening — design

**Status:** approved (brainstorm 2026-07-12). Ready for `/writing-plans` → slice-by-slice implementation via
`/impl-loop`.

**Branch / PR:** extends `feat/face-cleanup-resolution` (PR #770, the full per-face resolution feature);
implement on `feat/face-cleanup-consistency`.

**Origin:** a post-implementation adversarial audit of the durable-drain guarantee (does a resolved face ever
resurface on a later scan?). The audit found the scan-time filter machinery is sound, but two real gaps break
durability across scans and one deliberate-move case has no "settled" marker.

**Implementation approach — TDD (non-negotiable).** Every slice follows red-green-refactor
(`superpowers:test-driven-development`): write the failing test **first**, watch it fail for the right reason,
implement the minimum to pass, then refactor. No production line lands without a test that would fail without
it. The §7 matrix is the coverage contract — every edge case E1–E15 maps to a named test.

**Builds on (all on `feat/face-cleanup-resolution`):**

- Full per-face resolution — [`2026-07-10-face-cleanup-full-resolution-design.md`](2026-07-10-face-cleanup-full-resolution-design.md)
  (the 5 terminal states, `POST /admin/face-repair/resolve`, `face_repair_lock`, the resolutions page).

---

## 1. Motivation

The Face Cleanup feature promises a **durable drain**: every flagged face resolves to a persisted terminal
state and never silently reappears on a later scan. The scan's flag-builder (`buildRepairPlan`) already runs
`applyDeclineFilters` — dropping declined and locked faces — **before** it persists the snapshot
(`replaceScanFlaggedFaces`), and each new scan re-derives from scratch and re-applies that filter. So the
architecture is correct in the common case: durability rides on the persisted decline/lock state, not on
carrying an old snapshot forward.

The audit surfaced four ways a **resolved** face nonetheless resurfaces over time:

1. **Lock is silently destroyed by a person merge or delete.** `face_repair_lock.personId` is a non-nullable
   FK with `ON DELETE CASCADE`, even though `personId` is display/audit only (the lock is owner-agnostic —
   keyed on `assetFaceId`). `mergePersonProfile` reassigns the source person's `asset_face.personId` to the
   target and then **deletes the source person**, so merging a locked-on cluster (routine consolidation)
   cascades the lock row away while the face survives. The exact age-gap face the lock exists to silence
   re-flags on the next scan. This is the most serious hole and the strongest guarantee in the feature.

2. **Decline is silently destroyed by a suspected-owner merge** (same class, milder). `face_repair_decline`
   `suspectedOwnerId` is `ON DELETE CASCADE`. Merging suspected-owner Q into Q′ cascades the `(face, Q)`
   decline, and Q's votes move to Q′, so the next scan re-proposes `face → Q′` — a resurface of a soft-stay
   toward what is effectively the same person.

3. **A deliberate "Move → chosen person" writes no "settled" marker.** A move only re-attributes the face
   (`reattributeFaces` sets `asset_face.personId`); no decline or lock is written. Moves to the **suggested**
   owner are self-durable (the face resembles that owner, so the scan won't re-flag it), but a **deliberate
   override** — moving a face to a chosen person it does not visually resemble (the age-gap case) — re-flags
   on the next scan toward the visually-nearest third person. There is no way to move a face and pin it in one
   action.

4. **Dashboard "Dismiss whole person" reappears on reload.** Dismiss writes a `type='person'` decline but only
   filters the person out **client-side**; it never drains the server snapshot, and the console's main-list
   reader (`getLatestScanStatus`) is not decline-filtered. On page reload the dismissed person reappears (it
   self-heals only on the next scan). A within-scan inconsistency, not an across-scan hole, but a real one.

Separately, `getDeclineMaps()` on the scan path loads the **entire** `face_repair_decline` + `face_repair_lock`
tables into memory on every scan (unscoped) — correctness-safe, but grows unbounded as "Keep here" declines
accumulate over months/years.

## 2. Requirements (locked in brainstorm 2026-07-12)

1. **Lock survives its person.** A confirm/lock must never be lost when its person is merged or deleted; the
   owner-agnostic guarantee ("this face is never re-flagged, whatever owner a future scan proposes") holds
   across cluster consolidation.
2. **Decline survives a suspected-owner merge.** A soft-stay against owner Q must not resurface as a proposal
   toward Q′ merely because Q was merged into Q′.
3. **A deliberate move can be pinned in one action.** Moving a face to a chosen person offers a "lock so it
   won't re-flag" option, defaulting **on** (the override is a deliberate assertion that should stick).
   Suggested-owner moves are unchanged (no lock; already durable). The pin is undoable on the Resolutions page.
4. **Dismiss drains the server snapshot.** Dismissing a person removes it from the latest scan server-side, so
   a reload does not resurface it — mirroring resolve's drop-on-any-resolution.
5. **Bounded per-scan filter load.** The scan scopes its decline/lock load to the flagged set instead of two
   full-table scans; behavior is identical.

## 3. The five fixes

| #   | Fix                          | Surface                                   | Severity |
| --- | ---------------------------- | ----------------------------------------- | -------- |
| 1   | Lock survives merge/delete   | schema (migration) + `mergePersonProfile` | HIGH     |
| 2   | Decline survives owner-merge | `mergePersonProfile`                      | MED      |
| 3   | Move-and-lock                | DTO + `resolveFaces` + PersonPicker + SDK | MED      |
| 4   | Dismiss drains snapshot      | dismiss service/controller path           | MED      |
| 5   | Scope `getDeclineMaps`       | `buildRepairPlan`                         | LOW      |

## 4. Server architecture

### 4.1 Lock survives merge/delete (req 1)

- **Migration** (fork, `server/src/schema/migrations-gallery/` with a round timestamp after
  `1785000000000-AddFaceRepairLock` — e.g. `1786000000000-FaceRepairLockPersonNullable`; **verify the
  timestamp is free** first — the resolution feature hit a `1782000000000` collision): make
  `face_repair_lock.personId` **nullable** and change its FK to `ON DELETE SET NULL`. On a hard person delete
  the lock row is kept (owner-agnostic; `personId` goes null) instead of cascading away. Update
  `face-repair-lock.table.ts` (`personId!: string | null`, `@ForeignKeyColumn(..., { onDelete: 'SET NULL',
nullable: true, index: true })`). Add the migration name to `scripts/revert-to-immich.sql`'s
  `kysely_migrations` DELETE list (fork switch-back requirement); no new table, so no extra DROP.
- **`mergePersonProfile`** (`server/src/repositories/person.repository.ts`): **before** the source-person
  delete, re-point `face_repair_lock.personId` from `sourcePersonId` → `targetPersonId`
  (`UPDATE face_repair_lock SET personId = target WHERE personId = source`), on the **same `db`/transaction
  handle** `mergePersonProfile` already uses (atomic with the merge; never `this.db`, per the #595
  in-transaction trap). No unique index on `personId`, so no conflict. The lock filter is keyed on
  `assetFaceId` and is unaffected either way — re-pointing only keeps the audit reference accurate.

### 4.2 Decline survives owner-merge (req 2)

- **`mergePersonProfile`**: before the source delete, re-point `face_repair_decline.suspectedOwnerId` from
  `sourcePersonId` → `targetPersonId`, on the **same `db`/transaction handle** (atomic with the merge; never
  `this.db`). Only `type='face'` rows carry `suspectedOwnerId`. The unique index `(assetFaceId,
suspectedOwnerId)` means a `(face, target)` decline may already exist, so the re-point must **dedup on
  conflict**: insert the re-pointed rows `ON CONFLICT (assetFaceId, suspectedOwnerId) DO NOTHING`, then delete
  the `suspectedOwnerId = source` rows (or an equivalent conflict-safe `UPDATE`). No migration — the existing
  `CASCADE` FK still correctly drops a decline whose owner is **hard-deleted** (that owner's votes vanish, so
  the pairing is moot).
- The face-level decline's own `personId` column is always **null** (`createDeclines` sets `personId: null`
  for `type='face'` rows — only `type='person'` dismiss rows set it), so deleting or merging the _reviewed_
  person does not affect a face-level decline; only the `suspectedOwnerId` side matters here. The
  **person-level dismiss** (`type='person'`) surviving an owner merge — which would additionally require
  re-pointing the `personId` column **and** the `suspectedOwnerIds` jsonb fingerprint — is deferred (§9); it
  is neither req 2 nor req 4 and adds materially more surface.

### 4.3 Move-and-lock (req 3)

- **DTO** (`server/src/dtos/face-repair.dto.ts`): add an optional `lock` boolean to the move-group schema —
  `MoveGroupSchema = z.object({ destinationPersonId: z.uuidv4(), faceIds: z.array(z.uuidv4()).min(1), lock:
z.boolean().default(false) })`. No SDK-facing enum; a plain boolean.
- **`executeRepair` must surface the moved ids.** Today it returns only `{ moved, skipped }` counts — it
  computes the per-route `movedIds` (from `reattributeFaces`, which returns the ids it actually re-pointed)
  but discards them. Extend `RepairExecution` to also carry the set of moved `assetFaceId`s (accumulate the
  per-route `movedIds`). This is the only way to lock **exactly** the faces that moved; a re-query of
  `asset_face.personId = destination` would misattribute a face that was already on the destination.
- **`resolveFaces`** (`server/src/services/face-repair.service.ts`): after `executeRepair` commits the moves,
  for each `moveToPerson` group with `lock === true`, insert `face_repair_lock(assetFaceId,
personId=group.destinationPersonId, createdBy=resolvedBy)` for each of the group's faces **that is in the
  returned moved-id set** (so a skipped / moved-off face is not spuriously locked — E8). Count the inserted
  locks into the response `locked`. Two rules that distinguish this from the standalone `lock` bucket:
  - **Snapshot-membership bypass.** The standalone `stay`/`lock`/`detach` buckets are validated against the
    flagged snapshot (`findUnresolvableIds`); a **move-lock is tied to the move**, which accepts any eligible
    face on the person (including rest-of-cluster faces), so it is **not** subject to that check.
  - **No disjoint-bucket violation.** The face is only ever in `moveToPerson`; the server adds the lock. The
    E7-resolution disjoint check (`findOverlappingIds`) is over `moveToPerson`/`stay`/`lock`/`detach` and is
    unaffected — a move-lock face is never also placed in the standalone `lock` bucket.
  - Locks are idempotent (`ON CONFLICT (assetFaceId) DO NOTHING`), so a face already locked and then move-locked
    is a no-op.
- Undo is unchanged: the move-lock produces an ordinary `face_repair_lock` row surfaced on the Resolutions
  page; undoing it re-enables flagging without undoing the move (the face stays on the destination).

### 4.4 Dismiss drains snapshot (req 4)

- The service `createDeclines` currently only writes rows and never drains (only `resolveFaces` calls
  `removePersonsFromLatestScan`). In its **`persons` branch** (the dismiss path — `declineFaceRepair` with
  `persons: [...]`, `type='person'`), after writing the dismiss rows, also call
  `removePersonsFromLatestScan(persons.map((p) => p.personId))`, mirroring resolve's unconditional
  drop-on-resolution. (The `faces` branch is reached only from `resolveFaces`, which already drains its person
  — so scope the drain to the `persons` branch to avoid a double call.) The dismissed person leaves the latest
  scan snapshot immediately, so the unfiltered `getLatestScanStatus` reader no longer surfaces it on reload.
  The persisted person-decline still governs future scans (unchanged — the person re-surfaces only under
  genuinely new suspected-owner evidence, the existing subset check).
- The web dismiss handler drops its client-only list mutation (or keeps it as an optimistic update backed by
  the server drain); the source of truth is the server snapshot.

### 4.5 Scope `getDeclineMaps` (req 5)

- `buildRepairPlan` builds `flaggedByPerson` (the candidate flagged faces) **before** `applyDeclineFilters`.
  Scope the load to that set: `getDeclineMaps({ assetFaceIds: <all flagged assetFaceIds>, personIds: <all
flagged personIds> })` — the same scoped API the review/resolve paths already use — instead of the unscoped
  two-full-table load. `applyDeclineFilters` needs `assetFaceIds` (lock + face-decline) and `personIds`
  (person-dismiss subset check); both are known from `flaggedByPerson`. The resulting `applyDeclineFilters`
  drops are identical — the scoped maps are smaller (only the flagged faces' declines/locks) but cover every
  flagged face, which is all the filter reads.

## 5. Web architecture

- **PersonPicker** (`web/src/routes/admin/face-cleanup/[personId]/PersonPicker.svelte`): add a **"Lock so it
  won't re-flag"** checkbox, default **checked**, shown when routing a selection to a chosen person. The value
  flows into the tile's `other`-state resolution.
- **`review.svelte.ts` — `buildResolveRequest()`**: for `other`-state faces (chosen-person moves), emit the
  group with `lock: <toggle value>`. Owner-state (default → owner) groups always emit `lock: false` /
  omit it — suggested-owner moves are not auto-locked.
- **Dismiss** (dashboard `+page.svelte`): rely on the server drain (§4.4); the list refresh reflects the
  server-removed person.
- OpenAPI/SDK regenerated (the `lock` field on the resolve DTO changes `packages/sdk/src/fetch-client.ts`);
  because the resolve DTO is a required `@Body()`, the web must always pass
  `{ faceRepairResolveRequestDto: {...} }` (unchanged). Dart client regenerated (`mise run open-api-dart`) so
  the OpenAPI Clients CI check stays green.

## 6. Edge cases

- **E1 — Lock survives hard person delete.** Delete person P that a face is locked on → `face_repair_lock.
personId` set null, row kept; the next scan still drops the face for all owners.
- **E2 — Lock survives person merge.** Merge P into P′ → the lock's `personId` re-pointed P→P′ (before the
  source delete), row kept; the next scan drops the face. The age-gap face the lock protects does not resurface.
- **E3 — Decline survives suspected-owner merge.** Merge owner Q into Q′ → `(face, Q)` decline re-pointed to
  `(face, Q′)`; the next scan drops the re-proposed `face → Q′` pairing.
- **E4 — Decline-merge unique conflict.** If `(face, Q′)` already exists, the re-point from `(face, Q)` is a
  no-op (`ON CONFLICT DO NOTHING`) and the `(face, Q)` row is deleted — exactly one row remains, no unique
  violation.
- **E5 — Move-and-lock (chosen person).** A `moveToPerson` group with `lock: true` moves the faces to the
  destination **and** inserts a `face_repair_lock` on each moved face; the next scan never re-flags them.
- **E6 — Move without lock.** A `moveToPerson` group with `lock: false` (or omitted) moves without locking; the
  face remains re-flaggable (existing behavior, e.g. a default → suggested-owner move).
- **E7 — Move-and-lock a rest-of-cluster (non-flagged) face.** A face not in the flagged snapshot can be
  move-locked (the lock is tied to the move, bypassing the snapshot-membership check); no 400.
- **E8 — Move-and-lock only the faces that actually moved.** If a `lock: true` group contains a face that
  moved off the person since the scan (skipped by `executeRepair`), that face is **not** locked (locks
  intersect the moved ids), so no orphan lock is written for an unmoved face.
- **E9 — Move-and-lock composes with survival.** A move-locked face whose destination is later merged keeps its
  lock (re-pointed per E2) — the pin survives consolidation.
- **E10 — Move-and-lock undo.** Undoing the lock on the Resolutions page re-enables flagging on the next scan;
  the **move is not undone** (the face stays on the destination).
- **E11 — Dismiss drains + re-surfaces only on new evidence.** Dismissing a person removes it from the latest
  scan (reload does not show it); the persisted person-decline still lets it re-surface on a future scan only
  when a genuinely new suspected owner appears (unchanged subset check). _(A dismissed person that is later
  merged is a deferred edge — see §9.)_
- **E12 — Scoped `getDeclineMaps` equivalence.** The scoped load yields the identical `applyDeclineFilters`
  result as the full-table load; a decline/lock for a face outside the flagged set is neither loaded nor needed.
- **E13 — Move-lock idempotency.** Move-locking a face that is already locked inserts nothing new (`ON CONFLICT
(assetFaceId) DO NOTHING`); one lock row.
- **E14 — Lock re-point has no unique conflict.** `face_repair_lock`'s unique key is `assetFaceId` (one lock
  per face); `personId` is **not** part of it. So re-pointing `personId` source→target on merge is a plain
  `UPDATE` of at most one row per face — there is no `(assetFaceId, personId)` collision to handle, unlike the
  decline re-point (E4), whose unique key includes `suspectedOwnerId` and so needs the conflict-safe dedup.
- **E15 — Detach re-clustering (documented non-goal).** The nightly / non-force `RecognizeFaces` job
  enumerates `personId IS NULL` ML faces and can re-cluster a detached crop into a person, after which a scan
  can re-flag it. **Out of scope** (see §9); documented so users understand a detached "not a face" is durable
  against face-cleanup scans but not against a full face re-recognition.

**TDD is the build discipline.** Each slice writes its failing test first. The matrix below is the coverage
contract — no slice is "done" until its rows are green.

## 7. Test matrix

### 7.1 Server — pure unit (`src/utils/face-repair.spec.ts`)

- **U1** — `applyDeclineFilters` behaves identically whether fed full maps or maps scoped to the flagged set
  (the scoping produces the same drops). _(E12)_

### 7.2 Server — medium (real DB: `face-repair.resolve.spec.ts`, `person.repository`/merge medium spec, `face-repair.scan` spec)

- **M1** — lock survives **hard delete**: delete the locked-on person → lock row kept with `personId` null;
  a re-run scan drops the face for every owner. _(E1)_
- **M2** — lock survives **merge**: merge locked-on P into P′ → lock row kept, `personId` re-pointed to P′;
  a re-run scan drops the face. _(E2)_
- **M3** — decline survives **owner merge**: merge suspected-owner Q into Q′ → `(face, Q)` decline re-pointed
  to `(face, Q′)`; a re-run scan drops `face → Q′`. _(E3)_
- **M4** — decline-merge **conflict**: pre-seed `(face, Q′)`; merge Q into Q′ → exactly one `(face, Q′)` row,
  no unique violation, `(face, Q)` gone. _(E4)_
- **M5** — **move-and-lock**: `resolveFaces({ moveToPerson: [{ dest, faceIds:[f1], lock:true }] })` moves f1 to
  `dest` **and** writes a `face_repair_lock(f1, dest)`; a re-run scan never re-flags f1; response `locked` ≥ 1.
  Also asserts idempotency — re-issuing the same move-lock inserts no second lock row. _(E5, E13)_
- **M6** — **move without lock**: same call with `lock:false` moves f1, writes **no** lock; a re-run scan may
  re-flag f1. _(E6)_
- **M7** — **move-lock a rest-of-cluster face**: a face not in the flagged snapshot, moved with `lock:true`,
  is moved and locked — no `BadRequestException`. _(E7)_
- **M8** — **move-lock intersects moved ids**: a `lock:true` group with a face that moved off the person since
  the scan → that face is skipped by `executeRepair` and **not** locked (no orphan lock). _(E8)_
- **M9** — **dismiss drains**: dismissing person P (`declineFaceRepair persons:[P]`) removes P from the latest
  scan snapshot; a fresh `getLatestScan` read does not include P; the person-decline row still exists. _(E11)_
- **M10** — **move-lock undo**: undo the move-lock's lock row (`resolutions/remove` by lock id) → a re-run scan
  re-flags the face; the face is still on the move destination. _(E10)_
- **M11** — **scoped load equivalence**: `buildRepairPlan` with the scoped `getDeclineMaps` flags exactly the
  same faces as an unscoped baseline over a fixture with declines/locks both inside and outside the flagged
  set. _(E12)_
- **M12** — **move-lock composes with merge**: move-lock f1 to `dest`, then merge `dest` into `dest'` → the
  lock survives (re-pointed); a re-run scan does not re-flag f1. _(E9)_

### 7.3 Server — controller (`face-repair-admin.controller.spec.ts`)

- **C1** — the resolve DTO accepts a `moveToPerson` group with `lock: true|false` (and defaults `lock` to
  false when omitted); malformed `lock` (non-boolean) → 400. _(E5/E6)_
- **C2** — the dismiss route delegates to the service, which drains the latest scan (assert
  `removePersonsFromLatestScan` is invoked). _(E11)_

### 7.4 Web — unit (`review.svelte.ts`)

- **W1** — `buildResolveRequest()` emits `lock: true` on a chosen-person (`other`) group when the picker toggle
  is on, and `lock: false`/omitted on owner-state groups. _(E5)_
- **W2** — toggling the picker lock off emits `lock: false` for that group. _(E6)_

### 7.5 Web — component (`PersonPicker.spec.ts`, `[personId]/page.spec.ts`, dashboard `page.spec.ts`)

- **P1** — the PersonPicker "lock so it won't re-flag" checkbox renders **checked by default** and its value
  reaches the routed selection. _(E5)_
- **P2** — dashboard Dismiss reflects the server-removed person (no client-only filter needed); after the
  server call resolves, the person is gone. _(E11)_

### 7.6 E2E (`e2e/src/specs/web/face-cleanup.e2e-spec.ts`)

- **X1** — drive a chosen-person move with the lock toggle on → Apply → re-scan → assert the face is **not**
  re-flagged. _(E5)_
- **X2** — (if seedable) lock a face, merge its person into another via the API, re-scan → assert the face is
  still not re-flagged (lock survived the merge). _(E2)_

### 7.7 Coverage map

| Edge | Test(s)            | Edge | Test(s)                        |
| ---- | ------------------ | ---- | ------------------------------ |
| E1   | M1                 | E9   | M12                            |
| E2   | M2, X2             | E10  | M10                            |
| E3   | M3                 | E11  | M9, C2, P2                     |
| E4   | M4                 | E12  | U1, M11                        |
| E5   | M5, C1, W1, P1, X1 | E13  | M5 (idempotency asserted)      |
| E6   | M6, C1, W2         | E14  | M2 (single-row invariant)      |
| E7   | M7                 | E15  | _documented non-goal, no test_ |
| E8   | M8                 |      |                                |

## 8. Slice breakdown (for `/impl-loop`)

Linear vertical slices; each cuts DB → server → SDK → web → tests and ends in a shippable increment.

- **Slice 1 — Lock & decline survive merge/delete.** Migration (`face_repair_lock.personId` nullable + SET
  NULL) + table + `revert-to-immich.sql` entry; `mergePersonProfile` re-points lock and face-decline
  (`type='face'`) rows source→target on its own transaction handle, with conflict-safe dedup for the decline.
  Tests **M1, M2, M3, M4** plus the merge-repository medium coverage. Covers reqs 1, 2. _(Server only; no
  SDK/web.)_
- **Slice 2 — Dismiss drains the snapshot.** Dismiss service/controller path calls
  `removePersonsFromLatestScan`; web dismiss relies on the server drain. Tests **M9, C2, P2**. Covers req 4.
- **Slice 3 — Move-and-lock.** DTO `lock` flag; extend `executeRepair` to return the moved-id set;
  `resolveFaces` inserts locks for the `lock:true` faces that are in that set (snapshot-membership bypass,
  idempotent); SDK regen (TS + Dart); PersonPicker toggle (default on) + `buildResolveRequest`. Tests **M5,
  M6, M7, M8, M10, M12, C1, W1, W2, P1**. Covers req 3.
- **Slice 4 — Scope the per-scan load + capstone.** Scope `getDeclineMaps` in `buildRepairPlan` (**U1, M11**);
  e2e **X1, X2**; i18n for the new picker copy; the §7 matrix-completeness gate + full check/lint/test/medium
  gate. Covers req 5 + end-to-end proof.

Slices 1, 2, 4 are server-heavy (small web in 2); Slice 3 carries the SDK regen + the main web change.

## 9. Non-goals / future

- **Detach suppression flag (E15).** Making a detached "not a face" durable against a full `RecognizeFaces`
  re-clustering is the pre-existing §9 fast-follow from the resolution design; **out of scope**. Documented so
  users know detach is durable against face-cleanup scans but a face re-recognition can re-cluster an orphan
  crop.
- **Move-lock on the default → owner path.** Not offered — suggested-owner moves are already durable; auto-
  locking them would prevent legitimate future re-evaluation.
- **Reader-side defensive filter on `getLatestScanStatus`.** Fixing dismiss at the write side (drain) is
  sufficient for the known gap; a defensive read-side re-filter of the persisted `persons` JSON is deferred.
- **Person-level dismiss surviving an owner merge/delete.** A `type='person'` dismiss row keys on `personId`
  (the dismissed person, `ON DELETE CASCADE`) and stores a `suspectedOwnerIds` jsonb fingerprint; surviving a
  merge would require re-pointing **both** through `mergePersonProfile` — materially more surface than the
  face-level `suspectedOwnerId` re-point, and lower-frequency. Deferred: a dismissed cluster that is later
  merged may re-surface. Documented, not fixed here (distinct from req 2, which is the face-level decline).
- **Mobile.** The console is web-admin only.

## 10. Rollout

Pre-GA fork feature (RC only) → no deployed-DB compat burden; the `face_repair_lock.personId` migration is a
nullable/`SET NULL` alter (additive, no data loss). Steps: migration → server build → `pnpm sync:open-api` →
`mise run open-api-typescript` + `mise run open-api-dart` (keep the OpenAPI Clients CI green) → web. Add the
migration name to `scripts/revert-to-immich.sql`. Format docs with the **docs** package prettier before commit
(CI Docs Build is strict).
