# Face Cleanup — Temporal-Consistency Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking. **Organised as vertical slices** — each cuts DB → server → SDK → web → tests and ends in a
> user-testable, independently shippable increment, so `/impl-loop` can take one slice at a time. Slices are
> linear (each builds on the last).

**Goal:** Guarantee resolved faces never resurface across re-scans — make confirm/lock and soft-decline survive
a person merge/delete, add a "move and lock" pin, drain the snapshot on Dismiss, and scope the per-scan filter
load.

**Architecture:** Extends the resolution feature (`feat/face-cleanup-resolution`). The scan already filters
declined/locked faces at flag time (`buildRepairPlan` → `applyDeclineFilters`); durability rides on the
persisted `face_repair_lock` / `face_repair_decline` rows. This plan closes the paths that silently drop those
rows (person merge/delete) and the one deliberate-move case with no persisted marker.

**Tech Stack:** NestJS 11 + Kysely (server), fork migrations in `migrations-gallery/`, nestjs-zod DTOs,
oazapfts + openapi-generator SDKs, SvelteKit + Svelte 5 runes (web), Vitest (unit + medium/testcontainers),
Playwright (e2e).

**Spec:** [`2026-07-12-face-cleanup-consistency-hardening-design.md`](2026-07-12-face-cleanup-consistency-hardening-design.md)

## Global Constraints

- **TDD, always.** Every step writes the failing test first, watches it fail for the right reason, then
  implements the minimum. The §7 matrix (U1, M1–M12, C1–C2, W1–W2, P1–P2, X1–X2) is the coverage contract.
- **Fork migrations** go in `server/src/schema/migrations-gallery/` with a round timestamp; **verify it is
  free** (`ls migrations-gallery/`) — the resolution feature hit a `1782000000000` collision. Add every new
  migration name to `scripts/revert-to-immich.sql`'s `kysely_migrations` DELETE list.
- **UUID validation:** entity ids (`asset_face.id`, `person.id`) are v4 → `z.uuidv4()`.
- **No `this.db` inside a Kysely `transaction()` callback** (#595 deadlock). Merge re-points use the `db`
  handle `mergePersonProfile` receives.
- **Required `@Body()` → required SDK arg:** web passes `{ faceRepairResolveRequestDto: {...} }`, never
  `undefined`.
- **Verify commands (this v3 base uses pnpm/mise, NOT `make`):** server tsc `cd server && pnpm check`; server
  lint `pnpm lint`; server medium `cd server && npx vitest run --config test/vitest.config.medium.mjs <name>`
  (positional filters are ignored by `pnpm test:medium`); server unit `pnpm test -- --run <files>`; web
  `cd web && pnpm check:typescript` + `pnpm check:svelte` + `pnpm lint`; web unit `pnpm test`; SDK regen
  `cd server && pnpm build && mise run //server:sync-open-api && mise run //:open-api-typescript && mise run
//:open-api-dart`. Docker must be up for medium tests. IGNORE editor/LSP diagnostics — only fresh CLI runs
  are authoritative (they lag on this project).
- **Prettier:** server `src/`+`test/`; web via `pnpm format`; `docs/` via `pnpm -C docs exec prettier --write
plans/<file>` (path relative to `docs/`). Run before each commit.
- **No `Co-Authored-By` / `Generated-with` trailers.**

## Reference facts (verified on `feat/face-cleanup-consistency`)

- **Lock table** `server/src/schema/tables/face-repair-lock.table.ts`: `personId!: string` (NOT NULL),
  `@ForeignKeyColumn(() => PersonTable, { onDelete: 'CASCADE', index: true })`; unique index on `assetFaceId`.
- **Decline table** `face-repair-decline.table.ts`: `suspectedOwnerId!: string | null` and `personId!: string
| null`, both `@ForeignKeyColumn(() => PersonTable, { onDelete: 'CASCADE', ... })`; unique
  `(assetFaceId, suspectedOwnerId)`. `createDeclines` sets `personId: null` for `type='face'` rows and
  `suspectedOwnerId: null` for `type='person'` rows (`face-repair-decline.repository.ts` ~line 36).
- **`mergePersonProfile`** (`server/src/repositories/person.repository.ts:127`): signature
  `mergePersonProfile(input, db = this.db)`; reassigns `UPDATE asset_face SET personId = target WHERE personId
= source`, then `DELETE FROM person WHERE id = source`. All statements on the passed `db` handle.
- **`FaceRepairLockRepository`** (`server/src/repositories/face-repair-lock.repository.ts`):
  `insertLocks(assetFaceIds, personId, createdBy)` (`ON CONFLICT (assetFaceId) DO NOTHING`),
  `getLockedFaceIds(): Promise<Set<string>>`, `listLocks()`, `removeLocks({ids?,faces?})`.
- **`getDeclineMaps(scope?: { personIds?; assetFaceIds? })`** (`face-repair-decline.repository.ts` ~line 90) →
  `{ declinedFaceOwners: Map<assetFaceId, Set<suspectedOwnerId>>, dismissedPersons: Map<personId,
Set<owner>>, lockedFaceIds: Set<assetFaceId> }`. Unscoped = full-table load.
- **`applyDeclineFilters(byPerson, maps)`** (`server/src/utils/face-repair.ts` ~line 141): drops locked faces
  (owner-agnostic), declined `(face, owner)` pairings, dismissed persons (subset check).
- **`executeRepair(plan)`** (`face-repair.service.ts` ~line 189) returns `RepairExecution = { moved: number;
skipped: number }` (interface ~line 87). Internally accumulates per-route `movedIds` (from
  `reattributeFaces`, which returns `string[]` of re-pointed ids) but **discards them**.
- **`resolveFaces(input, resolvedBy)`** (`face-repair.service.ts` ~line 700): builds `toRepair` from
  `moveToPerson` groups → `executeRepair`; stay/lock/detach buckets; then
  `removePersonsFromLatestScan([personId])`.
- **`MoveGroupSchema`** (`face-repair.dto.ts:254`): `z.object({ destinationPersonId: z.uuidv4(), faceIds:
z.array(z.uuidv4()).min(1) })`.
- **`buildRepairPlan`** (`face-repair.service.ts:103`): builds `flaggedByPerson` (candidate flagged faces),
  then at ~line 144 `const declineMaps = await ...getDeclineMaps(); applyDeclineFilters(flaggedByPerson,
declineMaps);` (unscoped).
- **Dismiss** = service `createDeclines(input)` (`face-repair.service.ts` ~line 563) called with
  `{ persons: [{ personId, suspectedOwnerIds }] }`; it delegates to the repo and does **not** drain.
- **Medium test harness:** `server/test/medium/specs/services/face-repair.resolve.spec.ts` — `newMediumService(
FaceRepairService, { database: db, real: [...repos], mock: [LoggingRepository, JobRepository] })`, `db` from
  `getKyselyDB()`. Register any new repo in `server/test/medium.factory.ts` (generic `new key(db)` bucket).
  A `PersonRepository` medium spec exists under `server/test/medium/specs/repositories/` for merge coverage.

---

## Slice 1 — Lock & decline survive merge/delete

**Goal (vertical, user-testable):** A confirm/lock survives a person merge or hard delete; a soft-decline
survives a suspected-owner merge. Server-only. **Covers** reqs 1, 2; edges E1, E2, E3, E4, E14. Tests **M1,
M2, M3, M4** + a `mergePersonProfile` medium test.

**Files:**

- Modify `server/src/schema/tables/face-repair-lock.table.ts` — `personId` nullable + `SET NULL`.
- Create `server/src/schema/migrations-gallery/<ts>-FaceRepairLockPersonNullable.ts`.
- Modify `scripts/revert-to-immich.sql` — add the migration name.
- Modify `server/src/repositories/person.repository.ts` — `mergePersonProfile` re-points lock + decline.
- Modify `server/test/medium/specs/services/face-repair.resolve.spec.ts` (or a new
  `face-repair.merge-consistency.spec.ts`) — M1–M4.

- [ ] **Step 1 — Failing medium M1/M2 (lock survives delete/merge).** In a new medium spec
      `server/test/medium/specs/services/face-repair.merge-consistency.spec.ts` (harness per Reference facts,
      `real: [FaceRepairLockRepository, FaceRepairDeclineRepository, PersonRepository, FaceRepairRepository,
...]`): seed owner P, a person Q, an `asset_face` f1 on P (ML/visible), and a `face_repair_lock(f1,
personId=P)`. **M1:** `personRepository.delete([P])` → assert the lock row still exists with `personId IS
NULL`, and `faceRepairLockRepository.getLockedFaceIds()` contains f1. **M2:** (fresh fixture) seed a lock
      on P, `personRepository.mergePersonProfile({ sourcePersonId: P, targetPersonId: P2 })` → assert the lock
      row exists with `personId = P2` and `getLockedFaceIds()` contains f1. Run
      `npx vitest run --config test/vitest.config.medium.mjs face-repair.merge-consistency` → **FAIL** (M1: row
      gone / M2: row gone — current CASCADE drops it).
- [ ] **Step 2 — Migration + table.** Update `face-repair-lock.table.ts`: `personId!: string | null;` and
      `@ForeignKeyColumn(() => PersonTable, { onDelete: 'SET NULL', nullable: true, index: true })`. Create
      `migrations-gallery/<free-ts>-FaceRepairLockPersonNullable.ts` (verify the timestamp is free) altering the
      column nullable and re-creating the FK as `ON DELETE SET NULL`:

  ```ts
  import { Kysely, sql } from 'kysely';
  export async function up(db: Kysely<any>): Promise<void> {
    await sql`ALTER TABLE "face_repair_lock" ALTER COLUMN "personId" DROP NOT NULL`.execute(db);
    await sql`ALTER TABLE "face_repair_lock" DROP CONSTRAINT IF EXISTS "face_repair_lock_personId_fkey"`.execute(db);
    await sql`ALTER TABLE "face_repair_lock" ADD CONSTRAINT "face_repair_lock_personId_fkey"
      FOREIGN KEY ("personId") REFERENCES "person" ("id") ON UPDATE NO ACTION ON DELETE SET NULL`.execute(db);
  }
  export async function down(db: Kysely<any>): Promise<void> {
    await sql`ALTER TABLE "face_repair_lock" DROP CONSTRAINT IF EXISTS "face_repair_lock_personId_fkey"`.execute(db);
    await sql`ALTER TABLE "face_repair_lock" ADD CONSTRAINT "face_repair_lock_personId_fkey"
      FOREIGN KEY ("personId") REFERENCES "person" ("id") ON UPDATE NO ACTION ON DELETE CASCADE`.execute(db);
    await sql`ALTER TABLE "face_repair_lock" ALTER COLUMN "personId" SET NOT NULL`.execute(db);
  }
  ```

  (Confirm the exact existing constraint name via `\d face_repair_lock` on a scratch DB; adjust if the
  generated FK name differs.) Add `'<free-ts>-FaceRepairLockPersonNullable',` to the `kysely_migrations`
  DELETE list in `scripts/revert-to-immich.sql` (no new table → no DROP TABLE entry).

- [ ] **Step 3 — `mergePersonProfile` re-points the lock.** In `person.repository.ts`, **before** the
      `deleteFrom('person')` call, on the same `db` handle:

  ```ts
  await db
    .updateTable('face_repair_lock')
    .set({ personId: input.targetPersonId })
    .where('personId', '=', input.sourcePersonId)
    .execute();
  ```

  Run Step 1's M1 + M2 → **PASS** (M1 via the new SET NULL; M2 via the re-point).

- [ ] **Step 4 — Failing medium M3/M4 (decline survives owner merge).** Add to the merge spec: seed
      `asset_face` f1 on person R, and a `face_repair_decline(type='face', assetFaceId=f1, suspectedOwnerId=Q)`.
      **M3:** `mergePersonProfile({ sourcePersonId: Q, targetPersonId: Q2 })` → assert the decline row now has
      `suspectedOwnerId = Q2`, and `faceRepairDeclineRepository.getDeclineMaps({ assetFaceIds: [f1] })
.declinedFaceOwners.get(f1)` contains `Q2`. **M4:** (fresh fixture) seed **both** `(f1, Q)` and `(f1, Q2)`
      declines; merge Q into Q2 → assert exactly **one** `(f1, Q2)` row remains (no unique violation) and `(f1,
Q)` is gone. Run → **FAIL** (current CASCADE drops the `(f1, Q)` row on Q's delete).
- [ ] **Step 5 — `mergePersonProfile` re-points the decline (conflict-safe).** Before the source delete, on
      the same `db` handle, dedup-on-conflict:

  ```ts
  // Re-point type='face' declines whose suspected owner is the merged-away source.
  await db
    .insertInto('face_repair_decline')
    .columns(['type', 'assetFaceId', 'suspectedOwnerId', 'personId', 'suspectedOwnerIds', 'declinedBy'])
    .expression((eb) =>
      eb
        .selectFrom('face_repair_decline')
        .select([
          'type',
          'assetFaceId',
          eb.val(input.targetPersonId).as('suspectedOwnerId'),
          'personId',
          'suspectedOwnerIds',
          'declinedBy',
        ])
        .where('type', '=', 'face')
        .where('suspectedOwnerId', '=', input.sourcePersonId),
    )
    .onConflict((oc) => oc.columns(['assetFaceId', 'suspectedOwnerId']).doNothing())
    .execute();
  await db
    .deleteFrom('face_repair_decline')
    .where('type', '=', 'face')
    .where('suspectedOwnerId', '=', input.sourcePersonId)
    .execute();
  ```

  (Insert-new-then-delete-old is conflict-safe; an equivalent guarded `UPDATE` is fine too.) Run Step 4's
  M3 + M4 → **PASS**. Then run the full merge spec + the existing `PersonRepository` merge medium spec to
  confirm no merge regression.

- [ ] **Step 6 — Gate + commit.** `cd server && pnpm check` (exit 0) + `pnpm lint` (exit 0);
      `npx vitest run --config test/vitest.config.medium.mjs face-repair.merge-consistency` (M1–M4 green) +
      the person-repository merge medium spec (green); `pnpm format` on touched server files;
      `pnpm -C docs exec prettier --write` is not needed (no docs change). Commit:
      `fix(face-cleanup): lock & face-decline survive person merge/delete`.

## Slice 2 — Dismiss drains the snapshot

**Goal:** Dismissing a person removes it from the latest scan server-side, so a reload no longer resurfaces
it. **Covers** req 4; edge E11. Tests **M9, C2, P2**.

**Files:**

- Modify `server/src/services/face-repair.service.ts` — `createDeclines` drains in the `persons` branch.
- Modify `server/src/controllers/face-repair-admin.controller.spec.ts` — C2.
- Modify `server/test/medium/specs/services/face-repair.resolve.spec.ts` (or the merge spec) — M9.
- Modify `web/src/routes/admin/face-cleanup/+page.svelte` + its `page.spec.ts` — P2.

- [ ] **Step 1 — Failing medium M9 (dismiss drains).** In the medium spec: seed a latest `face_repair_scan`
      with a flagged person P in its snapshot (reuse the resolve spec's scan-seeding helper). Call the service
      `sut.createDeclines({ persons: [{ personId: P, suspectedOwnerIds: [Q] }] })`. Assert (a) P is **no longer**
      in the latest scan (`faceRepairScanRepository.getLatestScan()` / `getScanFlaggedFacesForPersons` for P is
      empty), and (b) the `face_repair_decline(type='person', personId=P)` row exists. Run → **FAIL** (P still
      in the snapshot; `createDeclines` doesn't drain).
- [ ] **Step 2 — Drain in the `persons` branch.** In `face-repair.service.ts` `createDeclines`, after the repo
      call, when `input.persons?.length`:

  ```ts
  const created = await this.faceRepairDeclineRepository.createDeclines(input);
  if (input.persons?.length) {
    await this.faceRepairScanRepository.removePersonsFromLatestScan(input.persons.map((p) => p.personId));
  }
  return { created };
  ```

  (Do NOT drain for the `faces` branch — that path is only reached from `resolveFaces`, which drains its own
  person.) Run Step 1 → **PASS**.

- [ ] **Step 3 — Failing controller C2.** In `face-repair-admin.controller.spec.ts`, in the `POST
/admin/face-repair/decline` describe block, add a test that a persons-payload dismiss delegates to
      `service.createDeclines` (the service-level drain is covered by M9; the controller test asserts
      delegation with the persons payload). Run → **FAIL** if asserting new behavior, else confirm green.
- [ ] **Step 4 — Failing web P2 + wire dashboard.** In `web/.../face-cleanup/page.spec.ts`: after Dismiss
      resolves, assert the dismissed person is gone from the rendered list **driven by the server response**
      (mock `declineFaceRepair` to resolve, then a refetch of `getLatestScan` that omits P). Update
      `+page.svelte` `handleDismiss` to refetch/trust the server snapshot rather than only mutating the client
      list. Run → **PASS**.
- [ ] **Step 5 — Gate + commit.** `cd server && pnpm check` + `pnpm lint`;
      `npx vitest run --config test/vitest.config.medium.mjs face-repair` (M9 green) + controller spec green;
      `cd web && pnpm test` (P2 green) + `pnpm check:typescript` + `pnpm check:svelte` + `pnpm lint`;
      `pnpm format` (server + web). Commit: `fix(face-cleanup): dismiss drains the latest scan snapshot`.

## Slice 3 — Move-and-lock

**Goal:** A deliberate "Move → chosen person" can lock the moved faces so they never re-flag (default on).
**Covers** req 3; edges E5, E6, E7, E8, E9, E10, E13. Tests **M5, M6, M7, M8, M10, M12, C1, W1, W2, P1**.

**Files:**

- Modify `server/src/dtos/face-repair.dto.ts` — `MoveGroupSchema` gains `lock`.
- Modify `server/src/services/face-repair.service.ts` — `executeRepair` returns moved ids; `resolveFaces`
  inserts move-locks.
- SDK regen (`packages/sdk/src/fetch-client.ts`, `open-api/immich-openapi-specs.json`, `mobile/openapi/**`).
- Modify `web/src/routes/admin/face-cleanup/[personId]/PersonPicker.svelte` + `review.svelte.ts`.
- Tests alongside each.

- [ ] **Step 1 — Failing medium M5/M8 (move-and-lock; only moved faces).** In `face-repair.resolve.spec.ts`:
      **M5** — `resolveFaces({ personId, moveToPerson: [{ destinationPersonId: dest, faceIds: [f1], lock: true
}] }, admin)`: assert `asset_face.personId(f1) = dest`, a `face_repair_lock(f1, personId=dest)` row exists,
      response `locked >= 1`, and re-issuing the identical call inserts **no** second lock row (E13). **M8** —
      a `lock: true` group with `[f1, fGone]` where `fGone` moved off `personId` before the call: assert f1 is
      moved+locked but `fGone` is **not** locked (no lock row for `fGone`). Run → **FAIL** (`lock` unknown /
      no locks written).
- [ ] **Step 2 — DTO `lock` flag.** In `face-repair.dto.ts`, change `MoveGroupSchema` to
      `z.object({ destinationPersonId: z.uuidv4(), faceIds: z.array(z.uuidv4()).min(1), lock:
z.boolean().default(false) })`. Add a DTO validation test (accepts `lock:true/false`, defaults false;
      rejects non-boolean `lock` → 400). Run the DTO spec → **PASS**.
- [ ] **Step 3 — `executeRepair` returns moved ids.** Change the `RepairExecution` interface (~line 87) to
      `{ moved: number; skipped: number; movedFaceIds: string[] }`. In `executeRepair`, accumulate the per-route
      `movedIds` into a single array and return it as `movedFaceIds` (alongside the existing counts). Update any
      existing caller/tests that destructure `RepairExecution` (the resolve path already uses `result.moved` /
      `result.skipped` — leave those; just add the new field). Run the existing face-repair unit + resolve
      medium specs → **PASS** (no behaviour change yet).
- [ ] **Step 4 — `resolveFaces` inserts move-locks.** After `const result = await this.executeRepair(...)`,
      compute the moved set and lock the requested `lock:true` faces that actually moved:

  ```ts
  const movedSet = new Set(result.movedFaceIds);
  let locked = 0;
  for (const group of moveToPerson) {
    if (!group.lock) continue;
    const toLock = group.faceIds.filter((id) => movedSet.has(id));
    if (toLock.length > 0) {
      locked += await this.faceRepairLockRepository.insertLocks(toLock, group.destinationPersonId, resolvedBy);
    }
  }
  ```

  Add `locked` to the response (replacing the Slice-3 additions to any existing `locked` tally — a stay/lock
  bucket may also contribute; sum them). Run Step 1's M5 + M8 → **PASS**.

- [ ] **Step 5 — Failing medium M7/M10/M12.** **M7** — move-lock a **rest-of-cluster** face (a face on
      `personId`, eligible, but NOT in the flagged snapshot) with `lock:true` → moved + locked, no
      `BadRequestException` (the move-lock bypasses the snapshot-membership check). **M10** — after a move-lock,
      remove the lock via `removeResolutions`/`resolutions/remove` by the lock id → a re-run scan re-flags the
      face; the face is still on the destination. **M12** — move-lock f1 to `dest`, then
      `mergePersonProfile({ source: dest, target: dest2 })` → the lock survives (re-pointed, from Slice 1); a
      re-run scan does not re-flag f1. Run → **FAIL** then implement any gaps → **PASS** (M7/M12 should pass
      against Steps 4 + Slice 1; M10 exercises the existing resolutions-remove path).
- [ ] **Step 6 — Regen SDK.** `cd server && pnpm build && mise run //server:sync-open-api && mise run
//:open-api-typescript && mise run //:open-api-dart`. Verify `lock` appears on the resolve DTO in
      `packages/sdk/src/fetch-client.ts` and `mobile/openapi/**` regenerates cleanly (keeps the OpenAPI Clients
      CI check green). Commit server + SDK: `feat(face-cleanup): move-and-lock (server + SDK)`.
- [ ] **Step 7 — Failing web W1/W2 + PersonPicker toggle (P1).** In `review.spec.ts`/`PersonPicker.spec.ts`:
      **W1** — `buildResolveRequest()` emits `lock: true` on a chosen-person (`other`) group when the picker
      toggle is on, and owner-state groups emit `lock: false`/omit it. **W2** — toggling the picker lock off
      emits `lock: false`. **P1** — the PersonPicker renders a "Lock so it won't re-flag" checkbox **checked by
      default**, and its value reaches the routed selection. Run `pnpm -C web test -- review.spec PersonPicker`
      → **FAIL**.
- [ ] **Step 8 — Web implementation.** Add the checkbox (default `checked`) to `PersonPicker.svelte`; thread
      its value into the `other`-state resolution stored by `review.svelte.ts`; have `buildResolveRequest()`
      emit `lock` on `other`-state (chosen-person) groups and never on owner-state groups. Add the i18n key for
      the checkbox label to `i18n/en.json`. Run Step 7 → **PASS**.
- [ ] **Step 9 — Failing controller C1.** In `face-repair-admin.controller.spec.ts`: the resolve route accepts
      a `moveToPerson` group with `lock: true|false` and defaults `lock` to false when omitted; a non-boolean
      `lock` → 400. Run → **FAIL** then **PASS** (covered by Step 2's schema; assert at the controller layer).
- [ ] **Step 10 — Gate + commit.** `cd server && pnpm check`+`pnpm lint`; medium `face-repair.resolve` green;
      `cd web && pnpm test` + `check:typescript` + `check:svelte` + `pnpm lint`; `pnpm format` (server + web).
      Commit web: `feat(face-cleanup): move-and-lock picker toggle (web)`.

## Slice 4 — Scope the per-scan load + capstone

**Goal:** Bound the scan's decline/lock load and prove the whole feature end-to-end. **Covers** req 5; edge
E12. Tests **U1, M11, X1, X2** + the matrix-completeness gate.

**Files:**

- Modify `server/src/services/face-repair.service.ts` — `buildRepairPlan` scopes `getDeclineMaps`.
- Modify `server/src/utils/face-repair.spec.ts` — U1.
- Modify `server/test/medium/specs/services/face-repair.scan*.spec.ts` (or the resolve/scan medium spec) — M11.
- Modify `e2e/src/specs/web/face-cleanup.e2e-spec.ts` — X1, X2.
- Modify `i18n/en.json` if any picker copy is still missing.

- [ ] **Step 0 — Matrix-completeness gate.** Confirm every §7 id (U1, M1–M12, C1–C2, W1–W2, P1–P2, X1–X2) has
      a corresponding green test in the suite; fail the slice if any id is unscheduled or red. (E15 is the
      documented non-goal, correctly test-free.)
- [ ] **Step 1 — Failing unit U1 + medium M11 (scoped-load equivalence).** **U1** (`src/utils/face-repair.spec.ts`):
      `applyDeclineFilters` produces the identical drops whether fed full maps or maps scoped to the flagged
      set (construct both, assert equal `flaggedByPerson`). **M11** (scan medium spec): over a fixture with
      declines/locks both **inside and outside** the flagged set, `buildRepairPlan` flags exactly the same
      faces before and after scoping. Run → **FAIL** (M11 baseline captured before the change; U1 is a pure
      helper test that should pass, so make it a regression lock — write it against the current
      `applyDeclineFilters`).
- [ ] **Step 2 — Scope `getDeclineMaps`.** In `buildRepairPlan`, replace the unscoped call (~line 144) with a
      scoped one built from `flaggedByPerson`:

  ```ts
  const flaggedFaceIds = [...flaggedByPerson.values()].flat().map((f) => f.assetFaceId);
  const flaggedPersonIds = [...flaggedByPerson.keys()];
  const declineMaps = await this.faceRepairDeclineRepository.getDeclineMaps({
    assetFaceIds: flaggedFaceIds,
    personIds: flaggedPersonIds,
  });
  applyDeclineFilters(flaggedByPerson, declineMaps);
  ```

  Run M11 → **PASS** (same faces flagged).

- [ ] **Step 2b — Format + commit server.** `pnpm check`+`pnpm lint`; medium scan spec green;
      `pnpm format`. Commit: `perf(face-cleanup): scope the per-scan decline/lock load to the flagged set`.
- [ ] **Step 3 — Failing e2e X1/X2.** In `e2e/src/specs/web/face-cleanup.e2e-spec.ts` (seed a scan with flagged
      faces via direct inserts, as the resolution e2e does): **X1** — drive a chosen-person move with the lock
      toggle **on** → Apply → re-scan → assert the face is **not** re-flagged. **X2** — lock a face, merge its
      person into another via the API, re-scan → assert the face is still not re-flagged (lock survived the
      merge). Ensure the spec compiles (`cd e2e && pnpm check` + `pnpm lint`). Run `make e2e-web-dev` if a
      stack is readily available, else rely on CI. Run → written + compiling (CI validates Playwright).
- [ ] **Step 4 — i18n + full gate.** Add any missing `admin.face_cleanup_*` keys (the move-lock checkbox
      label) to `i18n/en.json`. Full gate: `cd server && pnpm check && pnpm lint && pnpm test -- --run &&
npx vitest run --config test/vitest.config.medium.mjs face-repair`; `cd web && pnpm check:typescript &&
pnpm check:svelte && pnpm lint && pnpm test`; `cd e2e && pnpm check && pnpm lint`. Fix any red. Commit:
      `test(face-cleanup): consistency capstone e2e + i18n + gate`.

---

## Self-Review — spec coverage

| Spec requirement / edge                            | Slice(s)         |
| -------------------------------------------------- | ---------------- |
| Req 1 lock survives merge/delete (E1, E2, E14)     | 1                |
| Req 2 decline survives owner-merge (E3, E4)        | 1                |
| Req 3 move-and-lock (E5, E6, E7, E8, E9, E10, E13) | 3                |
| Req 4 dismiss drains (E11)                         | 2                |
| Req 5 scoped load (E12)                            | 4                |
| E15 detach re-cluster (non-goal)                   | — (documented)   |
| Tests U1, M1–M12, C1–C2, W1–W2, P1–P2, X1–X2       | mapped per slice |

**Type consistency:** `RepairExecution.movedFaceIds` (Slice 3 Step 3) is consumed by `resolveFaces` (Step 4);
`MoveGroupSchema.lock` (Step 2) is consumed by `resolveFaces` (Step 4) and emitted by `buildResolveRequest`
(Slice 3 Step 8); `getDeclineMaps({ assetFaceIds, personIds })` (Slice 4) uses the existing scoped signature;
`insertLocks(faceIds, personId, createdBy)` and `getLockedFaceIds()` are used with their existing signatures.
