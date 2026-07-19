# Slice 8 — Async lifecycle durability (M6, M7, L6, L7, L8) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. TDD, red→green.
> Phase 2 (deferred). Server-only. Distributed-systems durability — implement the DECIDED options below.

**Goal:** Make the album-grant / face-projection / member-departure reconcile machinery durably
convergent: survive job failures (M6), self-heal missing grants (M7), sweep stale faces (L6), make
member-removal atomic (L7), and backstop cascade-deletion strands (L8).

## Global Constraints (spec §0)

- TDD, positive control before negative. No co-author trailers. Targeted specs + tsc + lint; `make sql`
  only with Docker DB up (scratch). No `this.db` inside a `transaction()` — thread the `trx` handle.
  One commit per fix (or per coherent pair). Re-confirm lines.

## Verified anchors

- `handleSharedSpaceAlbumGrantReconcile` (`shared-space.service.ts:1425`) → `reconcileAlbumGrants(albumIds)`
  (currently **revoke-only**). `queueAlbumGrantReconcile` (`:1434`). `cleanupDepartingMemberAlbums`
  (`:1450`) → `removeOwnedAlbumLinksAddedBy` (`:1455`). `removeMember` (`:563` region) + `remove`.
- Job config switch: `job.repository.ts:488` (`SharedSpaceAlbumGrantReconcile`), `:508`
  (`SharedSpaceFaceMatchAll`). `FaceIdentityBackfill` already sets `removeOnFail:true` (precedent).
- `SharedSpaceFaceMatchAll` handler (`:1934`) = the durable per-space face re-projection.

---

### Fix M6 — jobs are fire-and-forget (DECIDED: removeOnFail:true + a cron backstop)

**Files:** `server/src/repositories/job.repository.ts` (`:488`, `:508`); new cron job (see L8).

- [ ] Add `removeOnFail: true` to the `SharedSpaceAlbumGrantReconcile` (`:488`) and
      `SharedSpaceFaceMatchAll` (`:508`) job options (match `FaceIdentityBackfill`), so a hard failure
      doesn't leave a failed job whose jobId key permanently blocks future reconciles.
- [ ] Test (unit): the job-config for both names includes `removeOnFail: true` (assert against the
      config switch, mirroring any existing job-config test).
- [ ] Commit (fold into the L8 cron commit if cleaner): part of `fix(spaces): durable album-grant reconcile (M6, M7, L8)`

### Fix M7 — create-side missing-grant race + false self-heal comment (DECIDED: bidirectional reconcile + enqueue from create sites)

**Files:** `server/src/repositories/shared-space.repository.ts` (`reconcileAlbumGrants`),
`server/src/services/shared-space.service.ts` (enqueue from `linkAlbum` + `addMember`), the false
RESOLUTION comment in `server/test/medium/specs/sync/shared-space-album-create-triggers.spec.ts:122`.

- [ ] **Test (medium) RED:** concurrent-ish member-join + album-link that misses the grant (or seed a
      member+album pair with no `shared_space_album_user` row) → after `reconcileAlbumGrants([albumId])` the
      missing grant is **created** (today reconcile is revoke-only → grant stays missing). Positive control:
      a legitimately-revoked grant is NOT re-created (only when a live path exists).
- [ ] **Implement:** make `reconcileAlbumGrants(albumIds)` **bidirectional** — keep the existing
      revoke sweep AND add the insert:

```sql
INSERT INTO shared_space_album_user (userId, albumId)
SELECT ssm.userId, ssa.albumId
FROM shared_space_album ssa
JOIN shared_space_member ssm USING (spaceId)
JOIN album a ON a.id = ssa.albumId AND a.deletedAt IS NULL
WHERE ssa.albumId IN (<albumIds>)
ON CONFLICT (userId, albumId) DO NOTHING
```

Enqueue `queueAlbumGrantReconcile` from `linkAlbum` and `addMember` (not just delete paths). Fix the
false RESOLUTION comment at `shared-space-album-create-triggers.spec.ts:122` (getCreatedAfter SELECTs
from the grant table, so a missing grant does NOT self-heal — the reconcile does).

- [ ] `make sql` for the changed decorated query. Commit: `fix(spaces): bidirectional album-grant reconcile self-heals missing grants (M7)`

### Fix L6 — stale face rows never swept + fire-and-forget face cleanup

**Files:** `server/src/services/shared-space.service.ts` (the durable reconcile near `:2905`;
`cleanupDepartingMemberAlbums` `:1450`), `server/src/repositories/shared-space.repository.ts`.

- [ ] **Test (medium) RED:** an asset loses its space path (album removed/unlinked) → a
      `shared_space_person_face` row for that asset survives; after the durable reconcile it is **gone**
      (recount + `deleteOrphanedPersons`). Positive control: a face on a still-reachable asset is kept.
- [ ] **Implement:** add a space-path-scoped stale-face sweep to the durable per-space reconcile
      (delete `shared_space_person_face` rows whose asset has no remaining space path — reuse the
      NOT-EXISTS trio; then recount + `deleteOrphanedPersons`). Wrap `cleanupDepartingMemberAlbums`' face
      cleanup in `try/catch` that enqueues the reconcile on failure (don't swallow silently).
- [ ] `make sql` if changed. Commit: `fix(spaces): sweep stale space person-faces in durable reconcile (L6)`

### Fix L7 — member removal not atomic with departing-member album unlink (DECIDED: one transaction)

**Files:** `server/src/services/shared-space.service.ts` (`removeMember` `:563`, `remove` `:583`),
`server/src/repositories/shared-space.repository.ts` (a `trx`-accepting variant).

- [ ] **Test (medium) RED:** simulate a failure between the membership delete and
      `removeOwnedAlbumLinksAddedBy` (e.g. force the second to throw) → assert **neither** commits (atomic
      rollback), so the ex-member's own album is not left linked. (If forcing a mid-failure is impractical,
      assert both run inside one transaction by structure + a happy-path test that both effects land.)
- [ ] **Implement:** wrap the membership delete + `removeOwnedAlbumLinksAddedBy` in **one repository
      transaction** (thread `trx` through both, mirroring `recountPersons`'s trx pattern; the AFTER-statement
      audit triggers fire inside it, keeping tombstones atomic). Keep face cleanup + job enqueues OUTSIDE the
      transaction (fork's no-`this.db`-in-`transaction` rule), re-drivable via L6.
- [ ] Commit: `fix(spaces): make member removal + own-album unlink atomic (L7)`

### Fix L8 — cascade-deletion strands never enqueue reconcile (DECIDED: low-frequency cron sweep — also backstops M6)

**Files:** new `JobName` cron entry + handler in `server/src/services/shared-space.service.ts`, config in
`job.repository.ts`, cron registration (follow an existing nightly/cron job pattern — grep for `CronJob`
/ `onNightlyJob` / `QueueName` cron registration).

- [ ] **Test (unit):** the cron handler calls `reconcileAlbumGrants` over the set of albums in
      `shared_space_album_user` (mock the repo lister + reconcile; assert invocation).
- [ ] **Implement:** add a low-frequency scheduled job (`SharedSpaceAlbumGrantReconcileSweep` or reuse
      an existing nightly hook) that fetches all album ids present in `shared_space_album_user` and calls
      `reconcileAlbumGrants` over them — making the mechanism path-independent (backstops M6 durability, L7
      residue, and user-hard-delete cascade strands from L8). Register it in the cron/nightly schedule.
- [ ] `make sql` if a new decorated query. Commit: `fix(spaces): nightly album-grant reconcile sweep backstop (M6, L8)`

---

## Scope / risk notes

- This is the highest-complexity slice. If the **cron registration** (L8) proves larger than the rest,
  land M6+M7+L6+L7 first (they close the substantive convergence holes) and land the cron sweep as its
  own commit — do NOT leave a half-wired cron. Report clearly what landed.
- Every SQL change → `make sql` (scratch DB) + `revert-to-immich.sql`/guard only if a NEW table is added
  (none expected here — all changes are to existing tables/jobs).

## Definition of done

- 5 fixes with RED→GREEN TDD + positive controls where meaningful. tsc + lint clean; `make sql` run or
  flagged. Existing lifecycle tests (`shared-space-member-album-lifecycle.spec.ts`,
  `shared-space-album-create-triggers.spec.ts`) stay green. Commits pushed. Scope-clean.
