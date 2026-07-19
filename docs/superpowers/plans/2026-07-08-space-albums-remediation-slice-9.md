# Space-Albums Remediation — Slice 9: Membership / creator lifecycle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three membership/creator-lifecycle findings in the shared-space album feature: a promoted co-Owner can no longer remove or demote the space **creator** (rbac-4/albums-5); a departing member's own linked albums are auto-unlinked so remaining members lose access (albums-6); and the TOCTOU race that strands album grants during concurrent revocations self-heals via a targeted post-commit reconciliation job (correctness-4).

**Architecture:** Three independent, service-layer-first fixes. (1) rbac-4: two guards in `SharedSpaceService` (`removeMember`, `updateMember`) reject removing/demoting the creator — pure service logic, **unit-testable, real red→green locally**. (2) albums-6: a new ownership-scoped Kysely delete in `SharedSpaceRepository` unlinks the departing user's **owned** albums; wired into both `removeMember` branches — the existing `shared_space_album_delete_audit` trigger fans out the grant revocations. (3) correctness-4: a new BullMQ job (`SharedSpaceAlbumGrantReconcile`) sweeps grants for a set of albums and tombstones any with no live `user_has_album_path`, enqueued **post-commit** from `unlinkAlbum` / `removeMember` / `remove`; because it runs after both racing transactions commit, it reads committed state and the snapshot race is gone. **No migration, no trigger/function change, no `revert-to-immich.sql` change.**

**Tech Stack:** NestJS 11 / Kysely (INSERT…SELECT + `sql` fragment for the existing `user_has_album_path` function) / BullMQ job queue / Vitest **unit** (`newTestService` auto-mocks — Docker-independent) + Vitest **medium** (testcontainers Postgres, CI-deferred).

Closes: **rbac-4 (= albums-5)**, **albums-6**, **correctness-4**.

---

## Global Constraints

Copy these verbatim into every task's mental model — they apply to all tasks.

- **No local DB.** Docker is down. There is **no** `migrations:run`, **no** `make sql`, **no** `test:medium` locally. The service guards (Task 1) and the service-wiring assertions (Tasks 2–3) are **unit tests** (`newTestService`) → **real red→green locally**. The SQL surfaces (the albums-6 ownership-scoped delete; the correctness-4 reconcile sweep) are **medium tests** validated only in **CI** (which runs `test:medium` against real Postgres). Author the medium tests thoroughly — they are the only validation of the SQL.
- **Local gate for every task:** `cd server && pnpm run check` (tsc `--noEmit`) + `pnpm run lint` (ESLint, zero-warnings). Unit-tested tasks additionally run `pnpm test --run <spec>` locally.
- **This slice adds NO migration.** Every fix is a service guard, a Kysely query, or a job — all against **existing** tables (`shared_space_album`, `shared_space_album_user`, `shared_space_album_user_audit`) and the **existing** `user_has_album_path(uuid, uuid, uuid)` function. Therefore **no** `migrations-gallery/` file, **no** `functions.ts` change, **no** `migration_overrides` row, and **no** `scripts/revert-to-immich.sql` change. (Confirmed: `revert-to-immich.sql` already carries every album grant table + the `user_has_album_path` / `album_soft_delete_shared_space_album` / consumer drops from Slice 8.)
- **rbac-4 part (b) is DEFERRED, not implemented — see §B.5.** The spec proposes ALSO dropping the `createdById` UNION arm from `accessibleSpaces`. Investigation found that change has a large, blind, library-path-spanning blast radius and is redundant once guard (a) lands. Ship (a); defer (b) with a precise recipe in the "Deferred follow-ups" section.
- **correctness-4 uses Option B (targeted reconciliation), NOT advisory locks — see §B.4.** Advisory locks (Option A) are rejected as too dangerous to land without a DB (deadlock risk, unvalidatable). Option B is CI-validatable and deadlock-free.
- **Kysely:** never issue `this.db` queries inside a `transaction()` callback (pool deadlock, #595). Not relevant here (no transactions added). The medium race test in Task 3 uses **explicit two-connection `db.connection()`** reservations (not `transaction()`), which is safe.
- **No Claude co-author trailers** on commits. Commit boundaries are one per task (three commits total).

---

## Background the implementer MUST understand before editing

### B.1 The creator-is-always-a-member invariant (load-bearing for rbac-4)

`SharedSpaceService.create` (`server/src/services/shared-space.service.ts:113-128`) creates the space with `createdById = auth.user.id` and **immediately** calls `addMember({ spaceId, userId: auth.user.id, role: Owner })`. There is **no other space-creation path**: `grep -rn "sharedSpaceRepository.create\|addMember"` over `server/src` shows exactly these two lines create/populate a space; the only migration touching `shared_space` DDL (`1772240000000-CreateSharedSpaceTables.ts`) inserts **no rows**. The unit test `create › should create space and add creator as owner` (`shared-space.service.spec.ts:272`) pins this. **Conclusion: the creator is always an Owner member.** rbac-4 guard (a) below simply keeps it that way.

### B.2 rbac-4 — the removed-creator split-brain, and why guard (a) alone closes it

`accessibleSpaces` (`server/src/utils/shared-space-album-scope.ts:86-97`) scopes **all** space sync streams as `createdById = userId UNION member`. The `createdById` arm is immutable — never revoked. Today `removeMember` has **no last-owner / creator guard**, so a promoted co-Owner can remove the creator: REST then denies the ex-creator, but the sync streams keep delivering forever (the `createdById` arm), and `user_has_album_path` branch 3 preserves their album grants — a permanent read/sync split-brain.

**Guard (a) closes this at the source.** Once `removeMember`/`updateMember` forbid removing **or** demoting the creator:

- The creator can never be stripped from `shared_space_member` → the `createdById` arm is **redundant** (membership always covers it) and never grants access the membership arm wouldn't.
- The member-delete trigger (`shared_space_member_delete_album_audit`) never fires for the creator → their grants are never revoked → the "`getCreatedAfter` keyed on the member `createId` can't re-backfill" contradiction the spec worries about **cannot arise** (nothing revoked ⇒ nothing to re-backfill).
- Whole-space `remove()` deletes the entire space (all members incl. creator) — that is correct wholesale teardown, not a "creator keeps sync" leak. A deleted **user** cascade-deletes their member row and has no session to sync.

So **(a) alone** makes the removed-creator state unreachable. Dropping the `createdById` arm (part b) is a redundant cleanup — deferred in §B.5.

### B.3 albums-6 — how album ownership is determined (there is NO `album.ownerId` column)

`AlbumTable` (`server/src/schema/tables/album.table.ts:30-60`) has **no `ownerId` column**. Album ownership is `album_user.role = 'owner'` (`AlbumUserRole.Owner`), enforced by a partial unique index (`album-user.table.ts:25` — `where: role = 'owner'`). The canonical ownership check is `AccessRepository.checkOwnerAccess(userId, albumIds)` (`access.repository.ts:81-99`): `INNER JOIN album_user ON album.id = album_user.albumId AND album_user.role = 'owner' AND album_user.userId = <user>` with `album.deletedAt IS NULL`. Slice 7's `unlinkAlbum` uses `Permission.AlbumDelete` (owner-only) for the same purpose.

`removeMember` currently does **nothing** to `shared_space_album` rows the departing member added; `unlinkAlbum` needs current-space Editor membership (Slice 7 additionally lets the album **owner** unlink), so an ex-member can't clean up. albums-6 fix: on removal/leave, delete the `shared_space_album` rows where `addedById = <departing user>` **AND** the departing user **owns** the album (via the `album_user role='owner'` join above). Deleting those rows fires the existing `shared_space_album_delete_audit` trigger, which writes the link tombstone + revokes remaining members' grants (gated by `user_has_album_path`). Rows the departing member added for albums they **don't** own are left untouched.

### B.4 correctness-4 — the TOCTOU race, and the Option A/B/C decision

`user_has_album_path(target_album, target_user, exclude_space)` (`functions.ts:520-556`) is `STABLE LANGUAGE SQL`. Under READ COMMITTED each statement evaluates it against its own snapshot. Two concurrent revocations of an album linked to **two** spaces — T1 unlinks the album from S1, T2 removes a member from S2 — each see the **other's** (uncommitted) path still present, so **both** skip the grant-revocation audit. After both commit, the user has no live path but the `shared_space_album_user` grant **survives** with no delete emitted. Same shape in the library path. REST is unaffected (it re-checks live access every request); only the sync grant is stranded.

**Decision — the three options weighed for a no-DB-validation slice:**

- **(A) `pg_advisory_xact_lock` per `(albumId, userId)`** taken in a deterministic `ORDER BY hashtextextended(...)` pre-loop inside the delete-side triggers **and** the create-side grant-insert triggers **and** Slice 8's restore trigger. **REJECTED.** Correctness depends on a _global_ consistent lock order across **five** PL/pgSQL functions; a single missed or mis-ordered site deadlocks. It cannot be validated locally (no DB), and even a green CI concurrency test doesn't cover every production interleaving. A prod deadlock is strictly worse than the rare, read-safe race. "Be conservative — a correct-but-deferred correctness-4 beats a blind advisory-lock that deadlocks prod."
- **(B) Targeted post-commit reconciliation job.** **CHOSEN.** A BullMQ job (`SharedSpaceAlbumGrantReconcile { albumIds }`) enqueued from the service revocation paths (`unlinkAlbum`, `removeMember`, `remove`) **after** the mutation commits. The job re-evaluates `user_has_album_path(albumId, userId, <nil sentinel>)` for every grant of those albums and inserts the stranded ones into `shared_space_album_user_audit` — the existing consumer deletes the grant and `SharedSpaceAlbumSync.getDeletes` delivers the device tombstone. Because it runs **post-commit**, it reads committed state → the snapshot race is gone. **No hot-path lock → cannot deadlock. Idempotent** (a live-path grant is skipped; an already-revoked grant has no row). **CI-validatable** (deterministic medium tests below). Reuses the existing audit→consumer→sync machinery → **no schema change**. Convergence window = job latency (seconds), acceptable for a rare MEDIUM race with a safe read path.
- **(C) Document + defer.** Weaker than (B): leaves the finding open. (B) is low-risk enough (no lock, no migration, CI-validated, benign failure modes) to actually close it. (C) is the fallback only if review rejects the new job infra.

**Why the nil sentinel is correct and cannot over-revoke.** The delete triggers pass the _modified_ space as `exclude_space_id` to ask "is there any **other** path?". The reconcile asks "is there **any** live path at all?" → exclude nothing real → `'00000000-0000-0000-0000-000000000000'::uuid` (never a real `immich_uuid_v7()` space id). For a legit grant holder who is a member of the single space linking the (live) album, branch 2's `ssa2."spaceId" <> exclude_space_id` is `realSpaceId <> nil` = TRUE → path found → grant **kept**. `user_has_album_path` is the exact function every delete trigger already trusts in production; reusing it with the nil sentinel adds no new predicate risk. A medium test below pins "legit grant survives the sweep".

### B.5 Deferred: rbac-4 part (b) — dropping the `createdById` arm (do NOT implement here)

The spec proposes also removing the `createdById` UNION arm from `accessibleSpaces`. **This plan does NOT implement it**, for reasons the spec did not anticipate (the task explicitly authorizes deferral: "If dropping the arm is riskier than expected, the guard (a) alone may suffice"):

1. **Redundant once (a) lands** (§B.2): the arm never grants access membership wouldn't, because the creator is always a member and can no longer be removed.
2. **Large, blind, library-spanning blast radius.** `accessibleSpaces` scopes the **library** sync path too (`sync.repository.ts:1194,1435,1447,…`), not just albums. `grep -rn "creator branch\|no member row\|pure creator branch"` over `server/test` finds **five** medium specs that **deliberately pin** the `createdById`-only ("no member row") behavior and would all have to be inverted blind, with only CI to catch a mistake:
   - `server/test/medium/specs/sync/sync-shared-space.spec.ts:20` — `emits a space whose only access path is the creator branch (no member row)`
   - `server/test/medium/specs/sync/sync-shared-space-library.spec.ts:45` — `No newSharedSpaceMember — exercise the pure creator branch`
   - `server/test/medium/specs/sync/sync-library.spec.ts:61,174` — `emits libraries linked via a space the user created (creator path, no member row)`
   - `server/test/medium/specs/sync/library-audit-triggers.spec.ts:264,274`
   - `server/test/medium/specs/sync/library-user-triggers.spec.ts:427`
3. **Scope-vs-gate asymmetry.** The trigger-side creator branches (`user_has_album_path` branch 3, `user_has_library_path`'s creator branch, and the `OLD."createdById"` arms in the delete-side audit functions) would remain while the sync scope drops it — a subtle inconsistency to reason about with no DB to check.
4. Those tests' own comments call the arm a **deliberate defensive path**; with guard (a) reinforcing the invariant, keeping the arm is the _more_ defensive posture.

**Deferral recipe (for a future DB-backed slice):** delete the `.union(...)` arm in `accessibleSpaces` (`shared-space-album-scope.ts:91-96`), leaving only the `shared_space_member` select; invert the five specs above to assert the `createdById`-only space/library is **excluded** and add member-row variants that are included; regenerate `sync.repository.sql` on a scratch DB; verify the trigger-side creator branches (they may then also want dropping for symmetry). Not in this slice.

### B.6 Test harness cheat-sheet (from the existing specs)

- **Unit** (`shared-space.service.spec.ts`): `newTestService(SharedSpaceService)` → `{ sut, mocks }`. `factory.auth({ user: { id } })`, `newUuid()`, `makeMemberResult({ spaceId, userId, role })` (spreads `factory.sharedSpaceMember()`). Repo mocks live under `mocks.sharedSpace.*` and `mocks.job.queue`. Auto-mocked methods return `undefined` unless `.mockResolvedValue(...)` is set — so new code must tolerate `undefined` from newly-added repo methods (use `?? []`).
- **Medium** (`server/test/medium/specs/sync/*.spec.ts` + `.../repositories/*.spec.ts`): `db = await getKyselyDB()`; `const ctx = new SyncTestContext(db)` **or** `newMediumService(BaseService, { database, real: [], mock: [LoggingRepository] })` → `ctx.get(SharedSpaceRepository)`. Context helpers: `ctx.newUser()` → `{ user }`; `ctx.newAlbum({ ownerId })` → `{ album }` (also creates the `album_user role='owner'` row); `ctx.newSharedSpace({ createdById })` → `{ space }`; `ctx.newSharedSpaceMember({ spaceId, userId, role })`; `ctx.newSharedSpaceAlbum({ spaceId, albumId, addedById })` (fires the create-side grant trigger). `const grantsFor = (albumId) => db.selectFrom('shared_space_album_user').selectAll().where('albumId','=',albumId).execute();`

---

## File Structure

**Modified (production):**

- `server/src/services/shared-space.service.ts` — `updateMember` creator guard (Task 1); `removeMember` creator guard + album-6 unlink + reconcile enqueue (Tasks 1, 2, 3); `unlinkAlbum` + `remove` reconcile enqueue + `queueAlbumGrantReconcile`/`handleSharedSpaceAlbumGrantReconcile` (Task 3).
- `server/src/repositories/shared-space.repository.ts` — `removeOwnedAlbumLinksAddedBy` (Task 2); `getLinkedAlbumIds` + `reconcileAlbumGrants` (Task 3).
- `server/src/enum.ts` — `JobName.SharedSpaceAlbumGrantReconcile` (Task 3).
- `server/src/types.ts` — `ISharedSpaceAlbumGrantReconcileJob` + `JobItem` union entry (Task 3).
- `server/src/repositories/job.repository.ts` — dedup `jobId` case for the new job (Task 3).

**Modified (tests):**

- `server/src/services/shared-space.service.spec.ts` — new `removeMember`/`updateMember` guard cases + album-6 + reconcile-enqueue cases (Tasks 1, 2, 3).

**Created (tests):**

- `server/test/medium/specs/sync/shared-space-member-album-lifecycle.spec.ts` — albums-6 ownership-scoped delete (Task 2).
- `server/test/medium/specs/repositories/shared-space-album-grant-reconcile.spec.ts` — correctness-4 reconcile sweep + deterministic race (Task 3).

**NOT touched:** no `migrations-gallery/`, no `functions.ts`, no `scripts/revert-to-immich.sql`, no `sync.repository.sql` (no `@GenerateSql` query changes to the sync repo; Task 2/3 repo methods carry `@GenerateSql` on `shared-space.repository.ts` → `server/src/queries/shared-space.repository.sql` regen is **CI-deferred**, noted per task).

**Commit map:** Commit 1 = Task 1 (rbac-4 guards). Commit 2 = Task 2 (albums-6). Commit 3 = Task 3 (correctness-4). Three commits, no Claude trailers.

---

## Task 1: rbac-4 — forbid removing/demoting the space creator

**Files:**

- Modify: `server/src/services/shared-space.service.ts` (`updateMember` ~438-473; `removeMember` ~541-569)
- Test: `server/src/services/shared-space.service.spec.ts` (`updateMember` describe ~1730; `removeMember` describe ~2012)

**Interfaces:**

- Consumes: `this.sharedSpaceRepository.getById(spaceId)` → returns `{ id, createdById, faceRecognitionEnabled, … } | undefined` (existing method, `shared-space.repository.ts:115`).
- Produces: `removeMember` now fetches `space` once at the top (reused by Tasks 2 & 3) and throws `ForbiddenException('Cannot remove the space creator')` when a non-self target is the creator. `updateMember` throws `ForbiddenException('Cannot demote the space creator')` when the target is the creator and the new role is not `Owner`.

- [ ] **Step 1: Write the failing unit tests**

Add to `server/src/services/shared-space.service.spec.ts`. Inside the existing `describe('removeMember', …)` block (~2012), add:

```ts
it('rejects removing the space creator (rbac-4)', async () => {
  const auth = factory.auth({ user: { id: 'co-owner' } });
  const creatorId = 'creator-1';
  mocks.sharedSpace.getMember.mockResolvedValue(makeMemberResult({ userId: 'co-owner', role: SharedSpaceRole.Owner }));
  mocks.sharedSpace.getById.mockResolvedValue(factory.sharedSpace({ id: 'space-1', createdById: creatorId }));

  await expect(sut.removeMember(auth, 'space-1', creatorId)).rejects.toBeInstanceOf(ForbiddenException);
  expect(mocks.sharedSpace.removeMember).not.toHaveBeenCalled();
});

it('still allows removing a non-creator member', async () => {
  const auth = factory.auth({ user: { id: 'owner-1' } });
  mocks.sharedSpace.getMember.mockResolvedValue(makeMemberResult({ userId: 'owner-1', role: SharedSpaceRole.Owner }));
  mocks.sharedSpace.getById.mockResolvedValue(factory.sharedSpace({ id: 'space-1', createdById: 'owner-1' }));
  mocks.sharedSpace.removeMember.mockResolvedValue(void 0);
  mocks.sharedSpace.logActivity.mockResolvedValue(void 0);

  await sut.removeMember(auth, 'space-1', 'other-user');

  expect(mocks.sharedSpace.removeMember).toHaveBeenCalledWith('space-1', 'other-user');
});
```

Inside `describe('updateMember', …)` (~1730), add:

```ts
it('rejects demoting the space creator (rbac-4)', async () => {
  const auth = factory.auth({ user: { id: 'co-owner' } });
  const creatorId = 'creator-1';
  mocks.sharedSpace.getMember.mockResolvedValue(makeMemberResult({ userId: creatorId, role: SharedSpaceRole.Owner }));
  mocks.sharedSpace.getById.mockResolvedValue(factory.sharedSpace({ id: 'space-1', createdById: creatorId }));

  await expect(sut.updateMember(auth, 'space-1', creatorId, { role: SharedSpaceRole.Viewer })).rejects.toBeInstanceOf(
    ForbiddenException,
  );
  expect(mocks.sharedSpace.updateMember).not.toHaveBeenCalled();
});

it('allows a no-op role set on the creator (stays Owner)', async () => {
  const auth = factory.auth({ user: { id: 'co-owner' } });
  const creatorId = 'creator-1';
  mocks.sharedSpace.getMember.mockResolvedValue(makeMemberResult({ userId: creatorId, role: SharedSpaceRole.Owner }));
  mocks.sharedSpace.getById.mockResolvedValue(factory.sharedSpace({ id: 'space-1', createdById: creatorId }));
  mocks.sharedSpace.updateMember.mockResolvedValue(void 0 as never);
  mocks.sharedSpace.logActivity.mockResolvedValue(void 0);

  await sut.updateMember(auth, 'space-1', creatorId, { role: SharedSpaceRole.Owner });

  expect(mocks.sharedSpace.updateMember).toHaveBeenCalledWith('space-1', creatorId, {
    role: SharedSpaceRole.Owner,
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && pnpm test --run src/services/shared-space.service.spec.ts -t "rbac-4"`
Expected: FAIL — no creator guard exists, so `removeMember`/`updateMember` proceed and call the repo (`removeMember`/`updateMember` were called; no `ForbiddenException` thrown).

- [ ] **Step 3: Add the `updateMember` creator guard**

Edit `server/src/services/shared-space.service.ts`, `updateMember` (~438-473). After the `existingMember` null-check (currently ~451-453), before `const oldRole = existingMember.role;`, insert:

```ts
// rbac-4: a promoted co-Owner must not be able to demote the space creator.
// The creator is always an Owner member (create() inserts them); keeping the
// role at Owner is a harmless no-op, anything lower is a demotion → reject.
const space = await this.sharedSpaceRepository.getById(spaceId);
if (space && userId === space.createdById && dto.role !== SharedSpaceRole.Owner) {
  throw new ForbiddenException('Cannot demote the space creator');
}
```

- [ ] **Step 4: Add the `removeMember` creator guard (and fetch `space` once at the top)**

Edit `server/src/services/shared-space.service.ts`, `removeMember` (~541-569). Replace the whole method with (this is the full new body — the `space` fetch at the top is reused by Tasks 2 & 3):

```ts
  async removeMember(auth: AuthDto, spaceId: string, userId: string): Promise<void> {
    const isSelf = auth.user.id === userId;
    const space = await this.sharedSpaceRepository.getById(spaceId);

    if (isSelf) {
      const member = await this.requireMembership(auth, spaceId);
      if (member.role === SharedSpaceRole.Owner) {
        throw new BadRequestException('Owner cannot leave the space');
      }
      await this.sharedSpaceRepository.removeMember(spaceId, userId);
      await this.sharedSpaceRepository.logActivity({
        spaceId,
        userId,
        type: SharedSpaceActivityType.MemberLeave,
        data: {},
      });
      await this.queueSpacePersonMetadataBackfill();
      return;
    }

    await this.requireRole(auth, spaceId, SharedSpaceRole.Owner);
    // rbac-4: a promoted co-Owner must not be able to remove the space creator
    // (the creator is always an Owner member, so their sync/grants would otherwise
    // survive removal forever). Deleting the whole space via remove() is still allowed.
    if (space && space.createdById === userId) {
      throw new ForbiddenException('Cannot remove the space creator');
    }
    await this.sharedSpaceRepository.removeMember(spaceId, userId);
    await this.sharedSpaceRepository.logActivity({
      spaceId,
      userId: auth.user.id,
      type: SharedSpaceActivityType.MemberRemove,
      data: { removedUserId: userId },
    });
    await this.queueSpacePersonMetadataBackfill();
  }
```

`ForbiddenException` is already imported (`shared-space.service.ts:1`). The creator can never reach the self-leave branch as a bypass — they are an Owner, and the `Owner cannot leave the space` check already blocks Owner self-leave.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd server && pnpm test --run src/services/shared-space.service.spec.ts`
Expected: PASS — the four new cases green **and** every pre-existing `removeMember`/`updateMember` test still green. (The added `getById` returns `undefined` in the pre-existing cases that don't mock it → `if (space && …)` short-circuits, so no behavior change; the pre-existing `removeMember` cases that assert `job.queue` was called exactly once are unaffected — Task 1 adds no queue call.)

- [ ] **Step 6: Local gate + commit**

Run: `cd server && pnpm run check && pnpm run lint`
Expected: PASS.

```bash
git add server/src/services/shared-space.service.ts server/src/services/shared-space.service.spec.ts
git commit -m "fix(spaces): forbid removing or demoting the space creator"
```

---

## Task 2: albums-6 — auto-unlink a departing member's own albums

**Files:**

- Create: `server/src/repositories/shared-space.repository.ts` method `removeOwnedAlbumLinksAddedBy` (add near the album-link CRUD, ~558-601)
- Modify: `server/src/services/shared-space.service.ts` (`removeMember` — both branches, after `removeMember`)
- Modify: `server/src/services/shared-space.service.spec.ts` (`removeMember` describe)
- Create: `server/test/medium/specs/sync/shared-space-member-album-lifecycle.spec.ts`

**Interfaces:**

- Produces: `SharedSpaceRepository.removeOwnedAlbumLinksAddedBy(spaceId: string, userId: string): Promise<string[]>` — deletes `shared_space_album` rows for `spaceId` where `addedById = userId` **and** `userId` owns the album (`album_user.role='owner'`, `album.deletedAt IS NULL`); returns the deleted album ids. Deleting the rows fires the existing `shared_space_album_delete_audit` trigger.
- Consumed by: `removeMember` (both branches) in Task 2; the returned album ids feed the optional face-orphan cleanup and (Task 3) the reconcile enqueue set.

- [ ] **Step 1: Write the failing unit test (service wiring)**

Add to `server/src/services/shared-space.service.spec.ts` inside `describe('removeMember', …)`:

```ts
it("unlinks the departing member's OWNED albums on removal (albums-6)", async () => {
  const auth = factory.auth({ user: { id: 'owner-1' } });
  mocks.sharedSpace.getMember.mockResolvedValue(makeMemberResult({ userId: 'owner-1', role: SharedSpaceRole.Owner }));
  mocks.sharedSpace.getById.mockResolvedValue(
    factory.sharedSpace({ id: 'space-1', createdById: 'owner-1', faceRecognitionEnabled: false }),
  );
  mocks.sharedSpace.removeMember.mockResolvedValue(void 0);
  mocks.sharedSpace.removeOwnedAlbumLinksAddedBy.mockResolvedValue(['album-a']);
  mocks.sharedSpace.logActivity.mockResolvedValue(void 0);

  await sut.removeMember(auth, 'space-1', 'member-2');

  expect(mocks.sharedSpace.removeOwnedAlbumLinksAddedBy).toHaveBeenCalledWith('space-1', 'member-2');
});

it("unlinks the leaver's OWNED albums on self-leave (albums-6)", async () => {
  const auth = factory.auth({ user: { id: 'member-2' } });
  mocks.sharedSpace.getMember.mockResolvedValue(makeMemberResult({ userId: 'member-2', role: SharedSpaceRole.Editor }));
  mocks.sharedSpace.getById.mockResolvedValue(
    factory.sharedSpace({ id: 'space-1', createdById: 'owner-1', faceRecognitionEnabled: false }),
  );
  mocks.sharedSpace.removeMember.mockResolvedValue(void 0);
  mocks.sharedSpace.removeOwnedAlbumLinksAddedBy.mockResolvedValue([]);
  mocks.sharedSpace.logActivity.mockResolvedValue(void 0);

  await sut.removeMember(auth, 'space-1', 'member-2');

  expect(mocks.sharedSpace.removeOwnedAlbumLinksAddedBy).toHaveBeenCalledWith('space-1', 'member-2');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd server && pnpm test --run src/services/shared-space.service.spec.ts -t "albums-6"`
Expected: FAIL — `mocks.sharedSpace.removeOwnedAlbumLinksAddedBy` does not exist yet (TypeScript: property does not exist on the mock) / is never called.

- [ ] **Step 3: Add the repository method**

Edit `server/src/repositories/shared-space.repository.ts`. Add after `removeAlbum` (~574). `AlbumUserRole`, `DummyValue`, and `GenerateSql` are already imported in this file (used by `getLinkedAlbums`, etc.):

```ts
  // albums-6: on member removal/leave, unlink the shared_space_album rows the
  // departing user ADDED and OWNS (album_user role='owner', album not soft-deleted).
  // Remaining members lose access to the ex-member's album (its future assets too).
  // Rows the member added for albums they do NOT own are left untouched. Deleting the
  // rows fires shared_space_album_delete_audit (link tombstone + gated grant revocation
  // for remaining members). Returns the album ids actually unlinked.
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async removeOwnedAlbumLinksAddedBy(spaceId: string, userId: string): Promise<string[]> {
    const deleted = await this.db
      .deleteFrom('shared_space_album')
      .where('shared_space_album.spaceId', '=', spaceId)
      .where('shared_space_album.addedById', '=', userId)
      .where('shared_space_album.albumId', 'in', (eb) =>
        eb
          .selectFrom('album_user')
          .innerJoin('album', 'album.id', 'album_user.albumId')
          .select('album_user.albumId')
          .where('album_user.userId', '=', userId)
          .where('album_user.role', '=', AlbumUserRole.Owner)
          .where('album.deletedAt', 'is', null),
      )
      .returning('shared_space_album.albumId')
      .execute();
    return deleted.map((row) => row.albumId);
  }
```

- [ ] **Step 4: Wire it into `removeMember` (both branches)**

Edit `server/src/services/shared-space.service.ts`, `removeMember`. Add the unlink + optional face-orphan cleanup **after** `this.sharedSpaceRepository.removeMember(...)` in **each** branch (before the `logActivity` call), calling a shared private helper. First add the helper (place it just below `removeMember`, or above `queueSpacePersonMetadataBackfill` ~1364):

```ts
  /**
   * albums-6: unlink the departing user's OWNED albums from the space and clean up
   * any now-orphaned space person faces (mirrors unlinkAlbum's cleanup). Returns the
   * unlinked album ids so the caller can also enqueue grant reconciliation (Task 3).
   */
  private async cleanupDepartingMemberAlbums(
    spaceId: string,
    userId: string,
    faceRecognitionEnabled: boolean,
  ): Promise<string[]> {
    const unlinkedAlbumIds = (await this.sharedSpaceRepository.removeOwnedAlbumLinksAddedBy(spaceId, userId)) ?? [];
    if (faceRecognitionEnabled && unlinkedAlbumIds.length > 0) {
      for (const albumId of unlinkedAlbumIds) {
        const orphanedAssetIds = await this.sharedSpaceRepository.getAlbumAssetIdsWithoutOtherSpacePath(
          spaceId,
          albumId,
        );
        if (orphanedAssetIds.length > 0) {
          await this.sharedSpaceRepository.removePersonFacesByAssetIds(spaceId, orphanedAssetIds);
        }
      }
      await this.sharedSpaceRepository.deleteOrphanedPersons(spaceId);
    }
    return unlinkedAlbumIds;
  }
```

Then in `removeMember`, in the **self-leave** branch, replace:

```ts
await this.sharedSpaceRepository.removeMember(spaceId, userId);
await this.sharedSpaceRepository.logActivity({
  spaceId,
  userId,
  type: SharedSpaceActivityType.MemberLeave,
  data: {},
});
await this.queueSpacePersonMetadataBackfill();
return;
```

with:

```ts
await this.sharedSpaceRepository.removeMember(spaceId, userId);
await this.cleanupDepartingMemberAlbums(spaceId, userId, space?.faceRecognitionEnabled ?? false);
await this.sharedSpaceRepository.logActivity({
  spaceId,
  userId,
  type: SharedSpaceActivityType.MemberLeave,
  data: {},
});
await this.queueSpacePersonMetadataBackfill();
return;
```

And in the **owner-removes-other** branch, replace:

```ts
await this.sharedSpaceRepository.removeMember(spaceId, userId);
await this.sharedSpaceRepository.logActivity({
  spaceId,
  userId: auth.user.id,
  type: SharedSpaceActivityType.MemberRemove,
  data: { removedUserId: userId },
});
await this.queueSpacePersonMetadataBackfill();
```

with:

```ts
await this.sharedSpaceRepository.removeMember(spaceId, userId);
await this.cleanupDepartingMemberAlbums(spaceId, userId, space?.faceRecognitionEnabled ?? false);
await this.sharedSpaceRepository.logActivity({
  spaceId,
  userId: auth.user.id,
  type: SharedSpaceActivityType.MemberRemove,
  data: { removedUserId: userId },
});
await this.queueSpacePersonMetadataBackfill();
```

(Pre-existing `removeMember` unit tests are unaffected: `removeOwnedAlbumLinksAddedBy` auto-mocks to `undefined` → `?? []` → the face-cleanup branch is skipped, no extra `job.queue` call, `removeMember` still called with the same args.)

- [ ] **Step 5: Run the unit tests to verify pass**

Run: `cd server && pnpm test --run src/services/shared-space.service.spec.ts`
Expected: PASS — both albums-6 wiring cases green; all pre-existing `removeMember` cases still green.

- [ ] **Step 6: Write the medium test (ownership-scoped SQL — CI-validated)**

Create `server/test/medium/specs/sync/shared-space-member-album-lifecycle.spec.ts`:

```ts
import { Kysely } from 'kysely';
import { AlbumUserRole, SharedSpaceRole } from 'src/enum';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { newMediumService, SyncTestContext } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let db: Kysely<DB>;
beforeAll(async () => {
  db = await getKyselyDB();
});

const setup = () => {
  const { ctx } = newMediumService(BaseService, { database: db, real: [], mock: [LoggingRepository] });
  return { ctx: new SyncTestContext(db), sut: ctx.get(SharedSpaceRepository), db };
};

const linksFor = (spaceId: string) =>
  db.selectFrom('shared_space_album').selectAll().where('spaceId', '=', spaceId).execute();

describe('removeOwnedAlbumLinksAddedBy (albums-6)', () => {
  it('unlinks an album the departing member added AND owns', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser(); // space owner + album owner
    const { user: member } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: member.id }); // member OWNS this album
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, addedById: member.id });
    expect(await linksFor(space.id)).toHaveLength(1);

    const unlinked = await sut.removeOwnedAlbumLinksAddedBy(space.id, member.id);

    expect(unlinked).toEqual([album.id]);
    expect(await linksFor(space.id)).toHaveLength(0);
    // the delete-audit trigger tombstoned the (space, album) link
    const linkAudit = await db
      .selectFrom('shared_space_album_audit')
      .selectAll()
      .where('albumId', '=', album.id)
      .where('spaceId', '=', space.id)
      .execute();
    expect(linkAudit).toHaveLength(1);
  });

  it('does NOT unlink an album the member added but does NOT own', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    // owner owns the album; member is only an editor of it (album_user role=editor)
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    await db
      .insertInto('album_user')
      .values({ albumId: album.id, userId: member.id, role: AlbumUserRole.Editor })
      .execute();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, addedById: member.id });

    const unlinked = await sut.removeOwnedAlbumLinksAddedBy(space.id, member.id);

    expect(unlinked).toEqual([]);
    expect(await linksFor(space.id)).toHaveLength(1); // link preserved
  });

  it('does NOT unlink an owned album that a DIFFERENT user added', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: member.id }); // member owns it
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Editor });
    // owner added the link, not member
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

    const unlinked = await sut.removeOwnedAlbumLinksAddedBy(space.id, member.id);

    expect(unlinked).toEqual([]);
    expect(await linksFor(space.id)).toHaveLength(1);
  });
});
```

- [ ] **Step 7: Run the medium test (CI-deferred) + note SQL regen**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/sync/shared-space-member-album-lifecycle.spec.ts`
Expected (CI): PASS. (Local: cannot run — Docker down. Prove locally via Step 8.)

`removeOwnedAlbumLinksAddedBy` carries `@GenerateSql`, so `server/src/queries/shared-space.repository.sql` gains a generated entry. **Do NOT run `make sql` locally (no DB → deletes query files).** Regenerate on a scratch migrated DB or let CI's SQL check flag the drift and regenerate there. Note this in the commit body.

- [ ] **Step 8: Local gate + commit**

Run: `cd server && pnpm run check && pnpm run lint && pnpm test --run src/services/shared-space.service.spec.ts`
Expected: PASS.

```bash
git add server/src/repositories/shared-space.repository.ts server/src/services/shared-space.service.ts \
  server/src/services/shared-space.service.spec.ts \
  server/test/medium/specs/sync/shared-space-member-album-lifecycle.spec.ts \
  server/src/queries/shared-space.repository.sql
git commit -m "fix(spaces): unlink a departing member's own albums on removal"
```

(If `shared-space.repository.sql` was not regenerated locally, omit it and add a `-m` note that it must be regenerated on a scratch DB / in CI.)

---

## Task 3: correctness-4 — targeted post-commit grant reconciliation

**Files:**

- Modify: `server/src/enum.ts` (`JobName`, ~992)
- Modify: `server/src/types.ts` (`ISharedSpaceAlbumGrantReconcileJob` ~343; `JobItem` union ~597)
- Modify: `server/src/repositories/job.repository.ts` (dedup `jobId` case, ~528)
- Create: `server/src/repositories/shared-space.repository.ts` methods `getLinkedAlbumIds`, `reconcileAlbumGrants`
- Modify: `server/src/services/shared-space.service.ts` (`unlinkAlbum` ~673-700; `remove` ~362-366; `removeMember`; new `queueAlbumGrantReconcile` + `handleSharedSpaceAlbumGrantReconcile`)
- Modify: `server/src/services/shared-space.service.spec.ts` (`unlinkAlbum`/`removeMember` enqueue cases)
- Create: `server/test/medium/specs/repositories/shared-space-album-grant-reconcile.spec.ts`

**Interfaces:**

- Produces:
  - `JobName.SharedSpaceAlbumGrantReconcile = 'SharedSpaceAlbumGrantReconcile'`.
  - `interface ISharedSpaceAlbumGrantReconcileJob extends IBaseJob { albumIds: string[] }`.
  - `SharedSpaceRepository.getLinkedAlbumIds(spaceId: string): Promise<string[]>` — album ids currently linked to the space.
  - `SharedSpaceRepository.reconcileAlbumGrants(albumIds: string[]): Promise<number>` — for each grant of the given albums with **no** live `user_has_album_path`, inserts a `shared_space_album_user_audit` row (existing consumer deletes the grant + `SharedSpaceAlbumSync.getDeletes` emits the tombstone); returns the count revoked.
  - `SharedSpaceService.queueAlbumGrantReconcile(albumIds: string[]): Promise<void>` (private) — enqueues the job iff `albumIds` non-empty.
  - `SharedSpaceService.handleSharedSpaceAlbumGrantReconcile(job)` — `@OnJob` handler calling `reconcileAlbumGrants`.
- Consumes: the existing `user_has_album_path(uuid, uuid, uuid)` DB function; the existing `shared_space_album_user_delete_after_audit` consumer trigger.

- [ ] **Step 1: Add the `JobName` + job type + `JobItem` union entry + dedup jobId**

Edit `server/src/enum.ts`. In the background `JobName` block, next to `SharedSpaceBulkAddAssets` (~997), add:

```ts
  SharedSpaceAlbumGrantReconcile = 'SharedSpaceAlbumGrantReconcile',
```

Edit `server/src/types.ts`. Add the interface near the other shared-space job interfaces (~343):

```ts
export interface ISharedSpaceAlbumGrantReconcileJob extends IBaseJob {
  albumIds: string[];
}
```

And add the union member next to `SharedSpaceBulkAddAssets` in the `JobItem` union (~601):

```ts
  | { name: JobName.SharedSpaceAlbumGrantReconcile; data: ISharedSpaceAlbumGrantReconcileJob }
```

Edit `server/src/repositories/job.repository.ts`. Add a dedup `jobId` case near the other shared-space cases (~528), so overlapping enqueues for the same album set collapse:

```ts
      case JobName.SharedSpaceAlbumGrantReconcile: {
        const data = item.data as { albumIds: string[] };
        return { jobId: `space-album-grant-reconcile-${[...data.albumIds].sort().join(',')}`, removeOnComplete: true };
      }
```

- [ ] **Step 2: Write the failing medium test (the reconcile sweep + the deterministic race)**

Create `server/test/medium/specs/repositories/shared-space-album-grant-reconcile.spec.ts`:

```ts
import { Kysely, sql } from 'kysely';
import { SharedSpaceRole } from 'src/enum';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { newMediumService, SyncTestContext } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let db: Kysely<DB>;
beforeAll(async () => {
  db = await getKyselyDB();
});

const setup = () => {
  const { ctx } = newMediumService(BaseService, { database: db, real: [], mock: [LoggingRepository] });
  return { ctx: new SyncTestContext(db), sut: ctx.get(SharedSpaceRepository), db };
};

const grantsFor = (albumId: string) =>
  db.selectFrom('shared_space_album_user').selectAll().where('albumId', '=', albumId).execute();
const grantAuditFor = (albumId: string, userId: string) =>
  db
    .selectFrom('shared_space_album_user_audit')
    .selectAll()
    .where('albumId', '=', albumId)
    .where('userId', '=', userId)
    .execute();

describe('reconcileAlbumGrants (correctness-4)', () => {
  it('tombstones a stranded grant that has no live path', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: stranded } = await ctx.newUser(); // NOT an album_user, NOT a space member
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    await db.insertInto('shared_space_album_user').values({ userId: stranded.id, albumId: album.id }).execute();
    expect((await grantsFor(album.id)).some((g) => g.userId === stranded.id)).toBe(true);

    const revoked = await sut.reconcileAlbumGrants([album.id]);

    expect(revoked).toBe(1);
    expect((await grantsFor(album.id)).some((g) => g.userId === stranded.id)).toBe(false); // consumer deleted it
    expect(await grantAuditFor(album.id, stranded.id)).toHaveLength(1); // tombstone emitted
  });

  it('keeps a grant that still has a live path (no over-revocation)', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Viewer });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });
    expect((await grantsFor(album.id)).some((g) => g.userId === member.id)).toBe(true);

    const revoked = await sut.reconcileAlbumGrants([album.id]);

    expect(revoked).toBe(0);
    expect((await grantsFor(album.id)).some((g) => g.userId === member.id)).toBe(true); // kept
  });

  it('is idempotent (a second sweep is a no-op)', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: stranded } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    await db.insertInto('shared_space_album_user').values({ userId: stranded.id, albumId: album.id }).execute();

    expect(await sut.reconcileAlbumGrants([album.id])).toBe(1);
    expect(await sut.reconcileAlbumGrants([album.id])).toBe(0); // grant already gone
  });

  it('resolves the TOCTOU race: two concurrent revocations strand a grant, reconcile converges it', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { space: s1 } = await ctx.newSharedSpace({ createdById: owner.id });
    const { space: s2 } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: s1.id, userId: member.id, role: SharedSpaceRole.Viewer });
    await ctx.newSharedSpaceMember({ spaceId: s2.id, userId: member.id, role: SharedSpaceRole.Viewer });
    await ctx.newSharedSpaceAlbum({ spaceId: s1.id, albumId: album.id, addedById: owner.id });
    await ctx.newSharedSpaceAlbum({ spaceId: s2.id, albumId: album.id, addedById: owner.id });
    expect((await grantsFor(album.id)).some((g) => g.userId === member.id)).toBe(true);

    // Force the interleave with two overlapping transactions. Neither sees the other's
    // uncommitted DELETE, so each trigger's user_has_album_path (STABLE, READ COMMITTED)
    // finds the OTHER path present → both skip the grant-revocation audit. Deterministic
    // (statement-ordered, no timing).
    await db.connection().execute(async (c1) => {
      await db.connection().execute(async (c2) => {
        await sql`BEGIN`.execute(c1);
        await sql`BEGIN`.execute(c2);
        await sql`DELETE FROM shared_space_album WHERE "spaceId" = ${s1.id} AND "albumId" = ${album.id}`.execute(c1);
        await sql`DELETE FROM shared_space_member WHERE "spaceId" = ${s2.id} AND "userId" = ${member.id}`.execute(c2);
        await sql`COMMIT`.execute(c1);
        await sql`COMMIT`.execute(c2);
      });
    });

    // The bug: member now has NO live path (not in s2; album no longer in s1) but the grant SURVIVED.
    expect((await grantsFor(album.id)).some((g) => g.userId === member.id)).toBe(true);

    // The fix: the post-commit reconcile (enqueued by removeMember/unlinkAlbum) converges it.
    const revoked = await sut.reconcileAlbumGrants([album.id]);
    expect(revoked).toBe(1);
    expect((await grantsFor(album.id)).some((g) => g.userId === member.id)).toBe(false);
    expect((await grantAuditFor(album.id, member.id)).length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/repositories/shared-space-album-grant-reconcile.spec.ts`
Expected (CI): FAIL — `sut.reconcileAlbumGrants` does not exist yet (method missing).

- [ ] **Step 4: Add the repository methods**

Edit `server/src/repositories/shared-space.repository.ts`. Ensure `sql` is imported from `kysely` (it is — used elsewhere in this file). Add after `getLinkedAlbums` (~601):

```ts
  // correctness-4 support: album ids currently linked to a space (captured before a
  // member removal / space deletion so the reconcile job can target them post-commit).
  @GenerateSql({ params: [DummyValue.UUID] })
  async getLinkedAlbumIds(spaceId: string): Promise<string[]> {
    const rows = await this.db
      .selectFrom('shared_space_album')
      .select('albumId')
      .where('spaceId', '=', spaceId)
      .execute();
    return rows.map((row) => row.albumId);
  }

  // correctness-4: sweep the grants of the given albums and tombstone any with no live
  // access path. Runs POST-COMMIT (its own statement/txn), so the READ COMMITTED snapshot
  // race in the delete-side triggers is resolved — it sees committed state. Inserting into
  // shared_space_album_user_audit fires shared_space_album_user_delete_after_audit (deletes
  // the grant) + SharedSpaceAlbumSync.getDeletes (device tombstone). The nil sentinel
  // excludes no real space → "does the user have ANY live path?"; a grant with a live path
  // is skipped (no over-revocation), an already-revoked grant has no row to sweep. Returns
  // the number of grants tombstoned.
  @GenerateSql({ params: [[DummyValue.UUID]] })
  async reconcileAlbumGrants(albumIds: string[]): Promise<number> {
    if (albumIds.length === 0) {
      return 0;
    }
    const inserted = await this.db
      .insertInto('shared_space_album_user_audit')
      .columns(['albumId', 'userId'])
      .expression((eb) =>
        eb
          .selectFrom('shared_space_album_user')
          .select(['shared_space_album_user.albumId', 'shared_space_album_user.userId'])
          .where('shared_space_album_user.albumId', 'in', albumIds)
          .where(
            sql<boolean>`NOT user_has_album_path("shared_space_album_user"."albumId", "shared_space_album_user"."userId", '00000000-0000-0000-0000-000000000000'::uuid)`,
          ),
      )
      .returning('albumId')
      .execute();
    return inserted.length;
  }
```

- [ ] **Step 5: Run the medium test to verify pass**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/repositories/shared-space-album-grant-reconcile.spec.ts`
Expected (CI): PASS — stranded grant tombstoned, live-path grant kept, idempotent, race converges. (Local: Docker down — prove via Step 9.)

- [ ] **Step 6: Add the handler + enqueue helper (service)**

Edit `server/src/services/shared-space.service.ts`. Add the handler and helper near the other `@OnJob` handlers / `queueSpacePersonMetadataBackfill` (~1364). `JobStatus`, `JobName`, `QueueName`, `OnJob`, and `JobOf` are already imported:

```ts
  @OnJob({ name: JobName.SharedSpaceAlbumGrantReconcile, queue: QueueName.BackgroundTask })
  async handleSharedSpaceAlbumGrantReconcile(
    job: JobOf<JobName.SharedSpaceAlbumGrantReconcile>,
  ): Promise<JobStatus> {
    await this.sharedSpaceRepository.reconcileAlbumGrants(job.albumIds ?? []);
    return JobStatus.Success;
  }

  // correctness-4: enqueue a post-commit reconciliation for the given albums. Idempotent
  // and deadlock-free — it runs after the triggering transaction commits, resolving the
  // TOCTOU race in the delete-side grant-revocation triggers. No-op for an empty set.
  private async queueAlbumGrantReconcile(albumIds: string[]): Promise<void> {
    const unique = [...new Set(albumIds)];
    if (unique.length === 0) {
      return;
    }
    await this.jobRepository.queue({
      name: JobName.SharedSpaceAlbumGrantReconcile,
      data: { albumIds: unique },
    });
  }
```

- [ ] **Step 7: Enqueue from the three revocation paths**

**(a) `unlinkAlbum`** (`~673-700`). At the end of the method (after the orphaned-face cleanup block), add:

```ts
// correctness-4: reconcile grants for the just-unlinked album (its grant revocation
// in shared_space_album_delete_audit could have lost a delete to a concurrent revocation).
await this.queueAlbumGrantReconcile([albumId]);
```

**(b) `remove`** (space delete, `~362-366`). Replace the method with:

```ts
  async remove(auth: AuthDto, id: string): Promise<void> {
    await this.requireRole(auth, id, SharedSpaceRole.Owner);
    // Capture the space's linked albums BEFORE the cascade delete removes the link rows,
    // so the post-commit reconcile can target them.
    const affectedAlbumIds = (await this.sharedSpaceRepository.getLinkedAlbumIds(id)) ?? [];
    await this.sharedSpaceRepository.remove(id);
    await this.queueAlbumGrantReconcile(affectedAlbumIds);
    await this.queueSpacePersonMetadataBackfill();
  }
```

**(c) `removeMember`** (both branches). Capture the space's linked albums at the top (they persist through member removal, and the set includes any owned albums Task 2 later unlinks), and enqueue at the end of each branch. In `removeMember`, right after `const space = await this.sharedSpaceRepository.getById(spaceId);`, add:

```ts
const affectedAlbumIds = (await this.sharedSpaceRepository.getLinkedAlbumIds(spaceId)) ?? [];
```

Then, in the **self-leave** branch, after `await this.queueSpacePersonMetadataBackfill();` and **before** `return;`, add:

```ts
await this.queueAlbumGrantReconcile(affectedAlbumIds);
```

And in the **owner-removes-other** branch, after the final `await this.queueSpacePersonMetadataBackfill();`, add:

```ts
await this.queueAlbumGrantReconcile(affectedAlbumIds);
```

- [ ] **Step 8: Write & run the failing→passing unit tests (enqueue wiring)**

Add to `server/src/services/shared-space.service.spec.ts`. In `describe('unlinkAlbum', …)` (find it; if absent, add a `describe` block) assert the enqueue; and in `describe('removeMember', …)` assert enqueue happens iff the space has linked albums. Example cases:

```ts
it('enqueues album grant reconcile after unlink (correctness-4)', async () => {
  const auth = factory.auth({ user: { id: 'owner-1' } });
  mocks.sharedSpace.getMember.mockResolvedValue(makeMemberResult({ userId: 'owner-1', role: SharedSpaceRole.Owner }));
  mocks.sharedSpace.getAlbumAssetIdsWithoutOtherSpacePath.mockResolvedValue([]);
  mocks.sharedSpace.removeAlbum.mockResolvedValue(void 0 as never);
  mocks.sharedSpace.logActivity.mockResolvedValue(void 0);
  mocks.album.getById.mockResolvedValue(undefined);

  await sut.unlinkAlbum(auth, 'space-1', 'album-a');

  expect(mocks.job.queue).toHaveBeenCalledWith({
    name: JobName.SharedSpaceAlbumGrantReconcile,
    data: { albumIds: ['album-a'] },
  });
});
```

```ts
it('enqueues album grant reconcile for the space albums on member removal (correctness-4)', async () => {
  const auth = factory.auth({ user: { id: 'owner-1' } });
  mocks.sharedSpace.getMember.mockResolvedValue(makeMemberResult({ userId: 'owner-1', role: SharedSpaceRole.Owner }));
  mocks.sharedSpace.getById.mockResolvedValue(
    factory.sharedSpace({ id: 'space-1', createdById: 'owner-1', faceRecognitionEnabled: false }),
  );
  mocks.sharedSpace.getLinkedAlbumIds.mockResolvedValue(['album-a', 'album-b']);
  mocks.sharedSpace.removeMember.mockResolvedValue(void 0);
  mocks.sharedSpace.removeOwnedAlbumLinksAddedBy.mockResolvedValue([]);
  mocks.sharedSpace.logActivity.mockResolvedValue(void 0);

  await sut.removeMember(auth, 'space-1', 'member-2');

  expect(mocks.job.queue).toHaveBeenCalledWith({
    name: JobName.SharedSpaceAlbumGrantReconcile,
    data: { albumIds: ['album-a', 'album-b'] },
  });
});

it('does NOT enqueue reconcile when the space has no linked albums', async () => {
  const auth = factory.auth({ user: { id: 'owner-1' } });
  mocks.sharedSpace.getMember.mockResolvedValue(makeMemberResult({ userId: 'owner-1', role: SharedSpaceRole.Owner }));
  mocks.sharedSpace.getById.mockResolvedValue(
    factory.sharedSpace({ id: 'space-1', createdById: 'owner-1', faceRecognitionEnabled: false }),
  );
  mocks.sharedSpace.getLinkedAlbumIds.mockResolvedValue([]);
  mocks.sharedSpace.removeMember.mockResolvedValue(void 0);
  mocks.sharedSpace.removeOwnedAlbumLinksAddedBy.mockResolvedValue([]);
  mocks.sharedSpace.logActivity.mockResolvedValue(void 0);

  await sut.removeMember(auth, 'space-1', 'member-2');

  expect(mocks.job.queue).not.toHaveBeenCalledWith(
    expect.objectContaining({ name: JobName.SharedSpaceAlbumGrantReconcile }),
  );
});
```

> **Pre-existing test note:** the older `removeMember` cases that assert `mocks.job.queue` was called exactly once (`shared-space.service.spec.ts:2110,2130`) still pass because those cases don't mock `getLinkedAlbumIds` → it returns `undefined` → `?? []` → no reconcile enqueue → still exactly one queue call (the metadata backfill). Do **not** change those assertions.

Run: `cd server && pnpm test --run src/services/shared-space.service.spec.ts`
Expected: PASS (new enqueue cases green; pre-existing cases green).

- [ ] **Step 9: Local gate + SQL-regen note + commit**

Run: `cd server && pnpm run check && pnpm run lint && pnpm test --run src/services/shared-space.service.spec.ts`
Expected: PASS.

`getLinkedAlbumIds` + `reconcileAlbumGrants` carry `@GenerateSql` → `server/src/queries/shared-space.repository.sql` regen is **CI-deferred** (same handling as Task 2 Step 7). Note in the commit body.

```bash
git add server/src/enum.ts server/src/types.ts server/src/repositories/job.repository.ts \
  server/src/repositories/shared-space.repository.ts server/src/services/shared-space.service.ts \
  server/src/services/shared-space.service.spec.ts \
  server/test/medium/specs/repositories/shared-space-album-grant-reconcile.spec.ts \
  server/src/queries/shared-space.repository.sql
git commit -m "fix(spaces): reconcile stranded album grants after concurrent revocations"
```

---

## Deferred follow-ups (documented, NOT implemented in this slice)

1. **rbac-4 part (b) — drop the `createdById` arm from `accessibleSpaces`.** Redundant once guard (a) lands, and its blind blast radius spans the library sync path + five intentional medium specs (see §B.5). Recipe in §B.5. Land in a DB-backed slice.
2. **correctness-4 library-path symmetry.** The same TOCTOU race exists for `library_user` grants via `user_has_library_path` (revoked by `shared_space_member_delete_library_audit` / `shared_space_library_delete_audit`). Libraries are admin-only (rarer). Replicate the exact Task-3 pattern: a `reconcileLibraryGrants(libraryIds)` sweep (`INSERT INTO ... shared_space_library... audit ... WHERE NOT user_has_library_path(..., nil)`) enqueued from `unlinkLibrary` / `removeMember` / `remove`. Deferred to keep this slice's blind surface minimal; flagged as the primary code-vs-spec divergence.

---

## Self-Review

**1. Spec coverage (Slice 9 in the design doc):**

- rbac-4/albums-5 part (a) — creator remove/demote guards → **Task 1** (unit red→green).
- rbac-4/albums-5 part (b) — drop `createdById` arm → **deferred with recipe** (§B.5); the task explicitly permits "(a) alone may suffice — assess", and the investigation justifies deferral.
- albums-6 — ex-member's owned albums unlinked on removal/leave → **Task 2** (service delete via ownership-scoped repo method; unit + medium).
- correctness-4 — TOCTOU race → **Task 3** (Option B targeted reconcile; deterministic race medium test + convergence).
- Edge: single-owner-creator space → deleting the space still allowed (only membership-removal blocked) → Task 1 guard is in `removeMember`, not `remove`; `remove` unchanged except a reconcile enqueue → **covered** (Task 1 Step 4 comment + `remove` in Task 3).
- Edge: non-owner member leaving → links to albums they DON'T own are not deleted → **covered** (Task 2 Step 6 test 2 + 3).
- Edge: creator-removal rejected → **Task 1 tests**.
- Edge: advisory-lock hash collisions benign / library race symmetry → **N/A** (Option B chosen, not A) / **deferred** (follow-up 2).

**2. Placeholder scan:** none — every step carries complete code and exact commands.

**3. Type consistency:** `removeOwnedAlbumLinksAddedBy: (spaceId, userId) => Promise<string[]>`, `getLinkedAlbumIds: (spaceId) => Promise<string[]>`, `reconcileAlbumGrants: (albumIds) => Promise<number>`, `queueAlbumGrantReconcile: (albumIds) => Promise<void>`, `ISharedSpaceAlbumGrantReconcileJob { albumIds: string[] }`, `JobName.SharedSpaceAlbumGrantReconcile` — used identically across repo, service, types, enum, and both spec files. `space` (from `getById`) reused across Tasks 1–3 in `removeMember`. Guarded `?? []` on every newly-added repo call so auto-mocked (`undefined`) pre-existing unit tests don't break.

---

## Final validation (run before finishing the branch)

```bash
cd server
pnpm run check          # tsc --noEmit over service, repo, enum, types, job.repository, specs
pnpm run lint           # ESLint, zero warnings
pnpm test --run src/services/shared-space.service.spec.ts   # Tasks 1-3 unit red→green
```

Expected: all green locally. The three medium specs
(`shared-space-member-album-lifecycle.spec.ts`, `shared-space-album-grant-reconcile.spec.ts`)
are **CI-deferred** (Docker down) — they run in CI's `test:medium` against real Postgres and are
the sole validation of the albums-6 ownership-scoped delete and the correctness-4 reconcile SQL +
deterministic race. The two `@GenerateSql`-decorated repo methods (`removeOwnedAlbumLinksAddedBy`,
`getLinkedAlbumIds`, `reconcileAlbumGrants`) drift `server/src/queries/shared-space.repository.sql`;
regenerate on a scratch migrated DB or in CI (never `make sql` without a DB).

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-08-space-albums-remediation-slice-9.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks.

**2. Inline Execution** — execute Tasks 1–3 in this session with checkpoints.

**Which approach?**
