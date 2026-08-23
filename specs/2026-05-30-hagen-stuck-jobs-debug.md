# Hagen stuck/cycling jobs — diagnosis & fix plan (2026-05-30)

Production: fotos.meischner.info, v4.56.7, 563k assets, 3 spaces.
Worktree branch: `worktree-debug+hagen-stuck-jobs` (based on origin/main @ 2e1299dcc0).
bullmq@5.75.2 installed.

> Session note: the interactive harness output transport degraded mid-session (multi-line
> tool results truncate to ~1 line). All code anchors below were read cleanly _before_ that.
> Resume in a fresh session to execute the TDD work with reliable reads/test output.

---

## STATUS — IMPLEMENTED (2026-05-30, fresh session)

Both fixes implemented via TDD on this branch. Full server unit suite: **4495 passed**;
tsc + eslint clean; medium (real-DB) tests pass.

**Finding 1 (queue robustness)**

- `handleSharedSpacePersonDedup` now runs exactly ONE pass per job and re-queues a follow-up
  `SharedSpacePersonDedup` (`{ spaceId, pass: pass + 1 }`) while merges remain, capped at
  `SHARED_SPACE_DEDUP_MAX_PASSES` (100). Each job stays short so the BullMQ lock never expires.
- Follow-up passes use a **pass-scoped jobId** (`space-dedup-<spaceId>-pass-<n>`) in
  `job.repository.getJobOptions` so they enqueue while the current job is still `active`; the bare
  `space-dedup-<spaceId>` id is kept for the initial trigger (external-trigger dedupe preserved).
- `buildWorkerOptions` gives the FacialRecognition queue a 5-min `lockDuration`/`stalledInterval`
  (defense-in-depth for any remaining long handler); other queues stay on BullMQ defaults.
- `JobRepository.removeOrphanedActiveJobs` / `reconcileOrphanedActiveJobs` LREM job ids stuck in
  the `active` list with no backing hash (the orphan class). Wired into `QueueService.onBootstrap`
  before `startWorkers` on the Microservices worker (best-effort; never blocks startup). Does NOT
  use `clean(0,_,'active')` — only hashless ids are removed, so live jobs are never touched.

**Finding 2 (reconciliation collapse)**

- `applySharedSpaceIdentityReconciliationClaim`: personal-profile conflicts STILL skip; on a
  space-profile conflict it now calls `collapseSameSpaceReconciliationConflicts`, which uses the
  new `faceIdentityRepository.getSpaceMergeConflictPairs` (spans all spaces, since `mergeIdentities`
  checks conflicts globally), picks a survivor by `nameSource` precedence manual>inherited>auto>none
  (tie-break faceCount, then id), folds the loser in (reassign faces, migrate aliases, delete,
  recount), then runs `mergeIdentities` collision-free.

**Tests added:** unit collapse matrix + chunking/cap + worker-options + orphan self-heal + bootstrap
ordering; medium `getSpaceMergeConflictPairs` + collapse-then-merge unique-index convergence.

---

## Finding 1 — Zombie `space-dedup` job permanently "active", starves facialRecognition queue

### Symptom

`space-dedup-f04f559e-...` sits in BullMQ `active` list with NO backing job hash; no PG query;
no logs; `space-identity-reconcile-f04f559e-all-members-all-people` blocked behind it.
Only server restart or shell `LREM` clears it. No user-accessible recovery.

### Confirmed facts (file:line)

- Worker: `job.repository.ts:108-118` — `new Worker(queueName, ..., { ...bull.config, concurrency: 1 })`.
- `bull.config`: `config.repository.ts:297-308` — `prefix:'immich_bull'`, `defaultJobOptions:{attempts:1, removeOnComplete:true, removeOnFail:false}`. **No** lockDuration/stalledInterval/maxStalledCount/lockRenewTime set → BullMQ defaults: lockDuration 30s, stalledInterval 30s, maxStalledCount 1, lockRenewTime 15s.
- FacialRecognition is NOT a concurrent queue (`queue.service.ts` isConcurrentQueue) → stays concurrency 1.
- jobIds (deterministic): `job.repository.ts:401` `space-dedup-${spaceId}`; `:403-408` `space-identity-reconcile-${spaceId}-${userId ?? 'all-members'}-${spacePersonId ?? 'all-people'}`. Both `removeOnComplete:true`, no removeOnFail/attempts override, NO bullmq `deduplication` option (relies on legacy jobId).
- Add path: `job.repository.ts:241-283` `queueAll` → for jobId items uses `queue.add()`. Dedup/reconcile fall through to plain `queue.add` (NOT in `isSharedSpaceFacePipelineJob` 448-455, so `removePausedStableJob` 436-446 does NOT apply to them).
- Handler `handleSharedSpacePersonDedup`: `shared-space.service.ts:1704-1875`. Up to `MAX_PASSES=100` (`:1721`) passes; each pass re-runs `getSpacePersonsWithEmbeddings` + per-person vector `findClosestSpacePerson` + per-merge `reassignPersonFacesSafe`/`migrateAliases`/`mergeIdentitiesForSpacePersonEvidence`/`inheritSpacePersonMetadata`/`updatePerson`/`deletePerson` + `recountPersons`. Inner try/catch swallow per-merge errors. Returns `Skipped`(:1709)/`Success`(:1874). MAX_PASSES path `break`s then returns Success (does NOT throw). On a 563k-asset/large space this is many seconds→minutes — far exceeds the 30s lock.
- No custom Redis active-list surgery anywhere (no moveToFailed/moveToCompleted/LREM/RPOPLPUSH/obliterate). `removePausedStableJob`/`removeFailedStableJob` are state-gated (paused/failed) and don't touch active dedup jobs. No boot-time clean/obliterate/pause (`queue.service.ts:78-84` onBootstrap only does setup + startWorkers on microservices worker).

### #595 connection-pool deadlock — RULED OUT

`mergeIdentitiesForSpacePersonEvidence` (`shared-space.service.ts:2284-2311`) opens NO transaction;
it calls `assignIdentityToPerson` then `faceIdentityRepository.mergeIdentities` **sequentially**.
`mergeIdentities` (`face-identity.repository.ts:~2460-2556`) is fully `trx`-threaded incl
`countMergeConflicts(trx, ...)`. `getMergeConflicts` (`:2600-2605`) uses `this.db` but is only ever
called standalone, outside any open transaction. So there is NO nested `this.db`-in-transaction.
Finding 1 is NOT a deadlock — it is the long-handler/short-lock/no-recovery class.

### Root cause (class)

A long, unbounded handler runs on a shared concurrency-1 queue under a 30s lock with no
user-reachable recovery. Any single wedge — process restart/OOM mid-pass, a Redis blip dropping
the lock, or lock-expiry + stalled-recovery (maxStalledCount 1) racing with `removeOnComplete:true`
— leaves an orphaned `active` entry with no hash that **blocks the entire FacialRecognition queue**
(core face recognition + all space jobs). Restart/LREM is the only escape.

### Fix plan (Finding 1)

1. **Chunk the dedup handler (primary fix).** Replace the in-process up-to-100-pass `while` loop
   with ONE pass per job; if `mergedAny`, re-queue a follow-up `SharedSpacePersonDedup` for the
   same space (jobId frees after `removeOnComplete`). Each job stays short → lock never expires.
   Keep MAX_PASSES as a guard via a pass counter carried in job data.
2. **Per-queue worker settings.** Extend `startWorkers` (`job.repository.ts:108-118`) to pass
   `lockDuration`/`stalledInterval` (bullmq v5 top-level WorkerOptions) for long-handler queues as
   defense-in-depth (e.g. FacialRecognition 2-5 min). Confirm exact WorkerOptions field placement
   for 5.75.2.
3. **Self-heal orphaned active jobs (user-reachable, no shell).** On bootstrap and/or an admin/
   maintenance action, detect `active` job ids whose `getJob(id)` returns null (orphan) and remove
   them safely. Design the BullMQ-native removal carefully — do NOT blanket `clean(0,_,'active')`
   (kills legit running jobs). Likely: enumerate active ids, null-hash → LREM via queue client.
4. **Isolate dedup/reconcile off the core queue (optional, recommended).** New QueueName so a wedge
   can't starve core face recognition. Trade-off: enum + wiring + worker.

---

## Finding 2 — Identity reconciliation skips same-space duplicates forever ("merge conflicts")

### Symptom

Every ~6h (library scan cron `0 */6 * * *`) logs
`WARN SharedSpaceService: Skipping shared-space identity reconciliation for space person <id>: merge conflicts`
for the SAME persons (245c078b, 5930ee66, ...). /people shows duplicates that never collapse.

### Root cause — CONFIRMED

`applySharedSpaceIdentityReconciliationClaim` (`shared-space.service.ts:1484-1504`):
pre-checks `faceIdentityRepository.getMergeConflicts(...)`; if
`personalProfileConflictCount>0 || spaceProfileConflictCount>0` → logs warning + `return` (no merge).
`countMergeConflicts` (`face-identity.repository.ts:2559-2598`, esp. the space branch `2582-2591`)
flags **two `shared_space_person` rows in the SAME space**, one holding the target identity and one
the source identity. Merging would set source.identityId = target → collides with unique partial
index `shared_space_person_spaceId_identityId_key (spaceId, identityId) WHERE identityId IS NOT NULL`.
So it bails. `mergeIdentities` re-guards the same way (`2486-2495`) and its space UPDATE
(`2519-2533`) skips colliding rows via `NOT EXISTS`.

Why it never converges: dedup (`handleSharedSpacePersonDedup`) only collapses space-persons whose
**embeddings** are within maxDistance (`findClosestSpacePerson`). Hagen's stuck pairs are the same
real person but farther apart in embedding space, so dedup never touches them. Identity
reconciliation is the ONLY path that knows they're the same (bridged via a member's matching local
person) — and it's exactly the path that refuses to act. → infinite recurrence + /people dupes.

### Decision (from user)

On same-space conflict, **COLLAPSE** the two space-persons instead of skipping. Survivor by
`nameSource` precedence **manual > inherited > auto > none**; tie-break by face count, then id.

### Fix plan (Finding 2)

1. In `applySharedSpaceIdentityReconciliationClaim`, when the conflict is a SPACE conflict, resolve
   the two same-space `shared_space_person` rows (source-identity row vs target-identity row),
   choose survivor by nameSource precedence (tie-break faceCount, then id), then COLLAPSE:
   reassign loser faces (`reassignPersonFacesSafe` repo:1530), `migrateAliases` (repo:1871), carry
   winning name+nameSource, complete identity merge, delete loser (`deletePerson` repo:1623),
   `recountPersons` (repo:1789). Must run BEFORE `mergeIdentities`' colliding-row-skip UPDATE.
2. Keep the collapse transactional in ONE repo method (respect unique index; avoid #595 pattern —
   thread `trx`, never `this.db` inside the txn). Likely a new repo method
   `collapseSameSpaceConflict(spaceId, survivorId, loserId, ...)` or extend mergeIdentities to
   collapse instead of skip when given a space-collapse directive.
3. **personalProfileConflict (same owner, two LOCAL persons): recommend STILL SKIP** — that's the
   user's own local data across the bridge; auto-collapsing local persons could be wrong. Only
   collapse the space-side conflict. CONFIRM with user before coding.
4. Confirm exact `nameSource` enum strings + precedence helper: `chooseSpacePersonNameUpdate`
   (`shared-space.service.ts:2344`), `chooseAutomaticTargetIdentity`, and the enum source. (Could
   not re-read this session — verify in fresh session.)

### Test seams (TDD)

- Unit: `server/src/services/shared-space.service.spec.ts` (exists, large) — use `newTestService`.
  First failing test: two same-space space-persons (one `nameSource:'manual'` named, one `'auto'`),
  a reconciliation claim bridging their identities → EXPECT collapse to the manual-named survivor
  (loser deleted, faces reassigned, name carried), NOT a skip-with-warning.
- Medium (real DB): `server/test/medium/specs/repositories/face-identity.repository.spec.ts` and
  `.../shared-space.repository.spec.ts` for the transactional collapse + unique-index behavior.

---

## Immediate mitigations for Hagen (no code change)

- **Zombie job:** restart server (reliable). Or shell surgical:
  `redis-cli LREM immich_bull:facialRecognition:active 0 "space-dedup-f04f559e-7fea-4838-bb41-ea8c8999632e"`
  then let the worker pick up the waiting reconcile job. Avoid admin "Clear queue" (maps to
  `queue.clean(...)`; semantics for an orphaned _active_ entry are uncertain — restart is safer).
- **Duplicate people:** manually merge the duplicate persons in the space people view
  (`mergeSpacePeople`) until the collapse fix ships.

## Decisions locked (2026-05-30)

- **Finding 2 collapse:** survivor by nameSource precedence **manual > inherited > auto > none**;
  tie-break faceCount, then id. CONFIRMED.
- **personalProfileConflict (same owner, two local persons): STILL SKIP.** Only the SPACE-side
  conflict auto-collapses. Do not auto-merge a user's own local persons across the bridge. CONFIRMED.
- **Execution:** resume the TDD work in a FRESH session (this session's interactive tool-output
  transport degraded — multi-line results intermittently truncated to ~1 line).

## Confirmed repo facts for the collapse (read 2026-05-30)

- `nameSource` is a free `character varying` default `'none'` (NOT a DB enum); values seen in code:
  `'none' | 'manual' | 'inherited' | 'auto'`. `shared-space-person.table.ts:74-75`.
- Unique partial index `shared_space_person_spaceId_identityId_key (spaceId, identityId) WHERE identityId IS NOT NULL`
  — table.ts:25-30. This is exactly what the collapse must respect.
- Reusable repo primitives (all on shared-space.repository.ts, all use `this.db` — NOT trx-wrapped):
  `reassignPersonFacesSafe(from,to)` :1530 (deletes dup faces then reassigns — PK-safe),
  `migrateAliases(from,to)` :1871, `deletePerson(id)` :1486, `recountPersons(ids)` :1789,
  `deleteOrphanedPersonsByIds(spaceId,ids)` :1757. A transactional `.transaction()` example exists at repo :1903.
- `mergeIdentitiesForSpacePersonEvidence` (service :2284-2336) opens NO transaction; calls
  `faceIdentityRepository.mergeIdentities` (trx-threaded) then `updatePerson`. The space collapse
  must run BEFORE mergeIdentities so the source space-person row is gone and the NOT EXISTS
  colliding-row skip (face-identity.repository.ts:2519-2533) doesn't strand it.
- metadata/name precedence helper for inheritance lives near `inheritSpacePersonMetadata`
  (service :2338+, nameSource handling at :2370-2373) — reuse its precedence notion for the
  survivor name carry-over rather than inventing a new ordering.

## Open items still to nail in fresh session (cheap, do first)

- Exact bullmq 5.75.2 WorkerOptions field placement for `lockDuration`/`stalledInterval`
  (top-level WorkerOptions; verify against node_modules type once deps installed in the worktree).
- Safe BullMQ-native removal of an orphaned ACTIVE job for the self-heal (enumerate active ids,
  `getJob(id) === null` ⇒ orphan ⇒ remove via queue client LREM on `<prefix>:<queue>:active`;
  do NOT blanket `clean(0,_,'active')` — it kills legit running jobs).
- Decide dedicated queue vs. reuse FacialRecognition for dedup/reconcile (recommend dedicated so a
  wedge can't starve core face recognition — but it's enum+wiring+worker cost; confirm scope).

## Resume prompt (paste into a fresh session in this worktree)

> Resume the Hagen stuck-jobs fixes. Read `specs/2026-05-30-hagen-stuck-jobs-debug.md` first.
> Implement BOTH fixes via TDD (superpowers:test-driven-development), starting with Finding 2
> (the collapse — lower risk, clear test seam in shared-space.service.spec.ts), then Finding 1
> (chunk the dedup handler + per-queue lock/stalled settings + orphaned-active self-heal).
> Decisions are locked in the plan: collapse survivor = nameSource precedence manual>inherited>auto>none
> (tie-break faceCount then id); personalProfile conflicts STILL skip. Run `cd server && pnpm test`
> for unit specs; use medium tests for the transactional repo collapse. Then prep PR(s) and the
> Hagen reply.
