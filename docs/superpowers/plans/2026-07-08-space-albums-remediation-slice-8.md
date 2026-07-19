# Space-Albums Remediation — Slice 8: Album trash lifecycle (migrations + triggers) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make album soft-delete (the user-deletion trash window) and restore drive shared-space album sync correctly — members' devices drop a trashed album immediately and get it back on restore with fresh grants, and a re-linked album re-delivers assets added while it was unlinked.

**Architecture:** One new PL/pgSQL statement trigger on `album` (fired on `UPDATE`, guarded to real `deletedAt` NULL↔NOT-NULL transitions) tombstones the album's shared-space grants + link rows on soft-delete and re-creates the grants (with fresh `createId`) + bumps the link `updateId` on restore. A repo-side `album.deletedAt IS NULL` filter on `SharedSpaceAlbumLinkSync` stops soft-deleted link rows re-appearing after their tombstone. A one-line `ON CONFLICT … DO UPDATE` change to the existing re-link grant trigger closes the stale-`createId` gap.

**Tech Stack:** NestJS 11 / Kysely / PostgreSQL PL/pgSQL triggers / `@immich/sql-tools` schema decorators + fork `migration_overrides` registry / Vitest medium tests (testcontainers Postgres).

Closes: **correctness-3 (= albums-4)**, **albums-2**, **albums-3**, **albums-9**.

---

## Global Constraints

Copy these verbatim into every task's mental model — they apply to all tasks.

- **Fork migration layout.** New migrations are fork-only files in `server/src/schema/migrations-gallery/` with **round** timestamps that do **not** collide and are **greater than every existing** file. Max existing timestamp is `1781181889688`. This slice uses `1782000000000` (Task 1) and `1782100000000` (Task 3). Both verified collision-free against the directory listing.
- **Trigger-function split (the fork pattern — mirror it exactly).** Each trigger function is (a) declared in `server/src/schema/functions.ts` via `registerFunction`, (b) attached to a table via a `@After…Trigger` decorator in `server/src/schema/tables/*.table.ts`, and (c) created in the migration via raw `CREATE OR REPLACE FUNCTION`/`CREATE OR REPLACE TRIGGER`, **and** registered in the `migration_overrides` table (one row per function, one per trigger) as escaped JSONB. Fork trigger functions are intentionally **NOT** added to `ImmichDatabase.functions` in `server/src/schema/index.ts` (the existing siblings `shared_space_album_delete_audit`, `user_has_album_path`, … are not there either). Reference migrations: `1779100000000-AddSharedSpaceAlbumCreateSideTriggers.ts`, `1779200000000-AddSharedSpaceAlbumDeleteSideTriggers.ts`, `1779300000000-FixUserHasAlbumPathSoftDeleted.ts`.
- **No local DB.** Docker is down. There is **no** `migrations:run`, **no** `make sql`, **no** `test:medium` locally. Local proof = `cd server && pnpm run check` (tsc) + `pnpm run lint`. Every behavioral test is authored here and **validated in CI** (which runs `test:medium` against a real Postgres). The medium tests are the only validation of the trigger SQL and the escaped JSONB — write them thoroughly.
- **`revert-to-immich.sql`.** Every new trigger/function gets a `DROP` entry and its `migration_overrides` name gets a `DELETE` entry in `scripts/revert-to-immich.sql`. This slice adds **no new table**, so the closing `fork_tables_left` guard IN-list is **not** touched here (its pre-existing staleness is correctness-7, owned by Slice 11).
- **No Claude co-author trailers** on commits. Commit boundaries are defined per task.
- **Kysely:** never issue `this.db` queries inside a `transaction()` callback (pool deadlock). Not relevant to this slice (no transactions added), noted for completeness.

---

## Background the implementer MUST understand before editing

### B.1 How album soft-delete actually happens (scope)

Individual albums are **hard**-deleted. Album **soft-delete only happens in the user-deletion window**:

- `AlbumRepository.softDeleteAll(userId)` = `UPDATE album SET "deletedAt" = <now> WHERE isAlbumOwned(userId)` (`server/src/repositories/album.repository.ts:369`).
- `AlbumRepository.restoreAll(userId)` = `UPDATE album SET "deletedAt" = null WHERE isAlbumOwned(userId)` (`album.repository.ts:365`).
- Called from `server/src/services/user-admin.service.ts:109` (soft-delete) and `:135` (restore).

`softDeleteAll` does **not** filter `WHERE "deletedAt" IS NULL` — it re-stamps `deletedAt` on **all** owned albums, including already-trashed ones. So a batch `UPDATE` can carry rows that do **not** cross the NULL↔NOT-NULL boundary. **This is why the trigger must guard on the real transition direction, not merely "deletedAt was in the SET list."** There is no per-album trash flow to build — album restore always coincides with user restore.

### B.2 The two independent sync surfaces a trashed album must disappear from

1. **Grant-driven** (album metadata + album assets): `SharedSpaceAlbumSync` / `SharedSpaceAlbumToAssetSync` / `SharedSpaceAlbumAssetSync` all key off the `shared_space_album_user` grant. `SharedSpaceAlbumSync.getDeletes` streams `shared_space_album_user_audit` rows as `SharedSpaceAlbumDeleteV1`. **Producing a grant-revocation audit row drops the album + its assets on the client.** `SharedSpaceAlbumSync.getUpserts`/`getCreatedAfter` are already `accessibleSpaceAlbums`-scoped (soft-deleted excluded — `sync.repository.ts:1475,1503`), so no metadata re-add.
2. **Space-scoped link row** (`shared_space_album` join row = the mobile shelf's `innerJoin`): `SharedSpaceAlbumLinkSync` streams these scoped by `accessibleSpaces` (space **membership**), **not** the grant. `getDeletes` reads `shared_space_album_audit` → `SharedSpaceAlbumLinkDeleteV1`. `getUpserts`/`getBackfill` currently have **no** `deletedAt` filter (`sync.repository.ts:1539-1564`), so a soft-deleted album's link row keeps streaming — and would **re-add** the row right after its tombstone. Both a tombstone **and** the filter are required.

### B.3 Existing audit consumer that does the actual grant deletion

`shared_space_album_user_delete_after_audit` (functions.ts:565-577; `AFTER INSERT ON shared_space_album_user_audit FOR EACH STATEMENT`) **unconditionally deletes** the matching `shared_space_album_user` grant rows. So this slice's soft-delete branch **inserts grant-audit rows**, and this existing consumer deletes the grants synchronously within the same statement. `user_has_album_path(...)` (functions.ts:520-556) returns FALSE for **everyone** once the album is soft-deleted (all three branches require `album."deletedAt" IS NULL`), so a soft-deleted album is universally inaccessible — the soft-delete tombstone can revoke **all** grants for the album with no gating.

### B.4 Table shapes (from `1779000000000-AddSharedSpaceAlbumUserTables.ts`)

```
shared_space_album_user       ("userId" uuid, "albumId" uuid, "createId" uuid DEFAULT immich_uuid_v7(), "createdAt" timestamptz DEFAULT now(), PK ("userId","albumId"))
shared_space_album_audit      ("id" uuid DEFAULT immich_uuid_v7(), "spaceId" uuid, "albumId" uuid, "deletedAt" timestamptz DEFAULT clock_timestamp(), PK ("id"))
shared_space_album_user_audit ("id" uuid DEFAULT immich_uuid_v7(), "albumId" uuid, "userId" uuid, "deletedAt" timestamptz DEFAULT clock_timestamp(), PK ("id"))
```

### B.5 CRITICAL DESIGN DECISION — plain `AFTER UPDATE` (not `AFTER UPDATE OF "deletedAt"`)

The spec text writes the trigger as `AFTER UPDATE OF "deletedAt" ON album`. **This plan deliberately implements plain `AFTER UPDATE ON "album"`** and moves the deletedAt-transition check entirely into an airtight PL/pgSQL body guard. Rationale (this is the top code-vs-spec divergence — see the closing risk section):

- `@immich/sql-tools` cannot express a column-restricted update trigger. `AfterUpdateTrigger` (`node_modules/@immich/sql-tools/dist/index.d.ts:19`) has no column list; `asTriggerCreate` (`index.js:1514`) emits `AFTER UPDATE ON "<table>"` with no `OF (...)`; and DB introspection (`index.js:2490-2510` via `pg_trigger`, not `tgattr`) reads the trigger's actions as `['update']` with the column list **invisible**.
- The fork registers a `trigger_<name>` row in `migration_overrides`, and the schema-diff compares that against `asTriggerCreate(decorator)`. Storing `OF "deletedAt"` there would mismatch the decorator's column-less form → a spurious override diff. Plain `AFTER UPDATE` makes **CREATE TRIGGER DDL == decorator == override SQL**, exactly like every existing fork trigger, with **zero** schema-diff novelty — the safest possible choice given "CI is the only validation."
- Behavior is **identical**: the body's early-exit `IF NOT EXISTS (… (o."deletedAt" IS NULL) <> (n."deletedAt" IS NULL) …) THEN RETURN NULL` short-circuits every non-`deletedAt` update (renames, `updateId` bumps from create-side grant triggers, etc.), and each branch is separately guarded on the exact transition direction. `OF "deletedAt"` would only be a micro-optimization; it is **not** load-bearing.

---

## File Structure

**Modified (production):**

- `server/src/schema/functions.ts` — add `album_soft_delete_shared_space_album` (Task 1); change `shared_space_album_after_insert_user`'s `ON CONFLICT` (Task 3).
- `server/src/schema/tables/album.table.ts` — add the `@AfterUpdateTrigger` decorator + import (Task 1).
- `server/src/repositories/sync.repository.ts` — `SharedSpaceAlbumLinkSync.getUpserts` + `getBackfill` gate (Task 2).
- `server/src/queries/sync.repository.sql` — regenerated for the Task 2 `@GenerateSql` change (CI-deferred; see Task 2 Step 6).
- `scripts/revert-to-immich.sql` — DROP + `migration_overrides` DELETE entries (Tasks 1 & 3).

**Created (migrations):**

- `server/src/schema/migrations-gallery/1782000000000-AddAlbumSoftDeleteSharedSpaceAlbumTrigger.ts` (Task 1).
- `server/src/schema/migrations-gallery/1782100000000-FixSharedSpaceAlbumGrantRelinkCreateId.ts` (Task 3).

**Created (tests):**

- `server/test/medium/specs/sync/shared-space-album-soft-delete-triggers.spec.ts` (Task 1 — trigger-level DB-state).
- `server/test/medium/specs/sync/sync-shared-space-album-trash-lifecycle.spec.ts` (Task 4 — end-to-end via `SyncService.syncStream`).

**Modified (tests):**

- `server/test/medium/specs/sync/shared-space-album-link-sync.spec.ts` (Task 2).
- `server/test/medium/specs/sync/shared-space-album-create-triggers.spec.ts` (Task 3).

**Commit map:** Commit 1 = Task 1. Commit 2 = Task 2. Commit 3 = Task 3. Commit 4 = Task 4 (end-to-end spec tying 1–3 together). Four commits, no Claude trailers.

---

## Task 1: Album soft-delete/restore trigger

**Files:**

- Modify: `server/src/schema/functions.ts` (append after `shared_space_member_after_insert_album`, ~line 707)
- Modify: `server/src/schema/tables/album.table.ts`
- Create: `server/src/schema/migrations-gallery/1782000000000-AddAlbumSoftDeleteSharedSpaceAlbumTrigger.ts`
- Modify: `scripts/revert-to-immich.sql`
- Test: `server/test/medium/specs/sync/shared-space-album-soft-delete-triggers.spec.ts`

**Interfaces:**

- Produces: PG trigger `album_soft_delete_shared_space_album` (function of same name) on the `album` table. On soft-delete it inserts into `shared_space_album_user_audit` (revokes grants via the existing consumer) and `shared_space_album_audit` (link tombstone). On restore it upserts `shared_space_album_user` grants (`ON CONFLICT ("userId","albumId") DO UPDATE SET "createId" = immich_uuid_v7(), "createdAt" = now()`) and bumps `shared_space_album."updateId"`. Task 4 relies on the produced `SharedSpaceAlbumDeleteV1` / `SharedSpaceAlbumLinkDeleteV1` / re-delivery behavior.

- [ ] **Step 1: Write the failing tests**

Create `server/test/medium/specs/sync/shared-space-album-soft-delete-triggers.spec.ts`:

```ts
import { Kysely } from 'kysely';
import { SharedSpaceRole } from 'src/enum';
import { DB } from 'src/schema';
import { SyncTestContext } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let db: Kysely<DB>;
beforeAll(async () => {
  db = await getKyselyDB();
});

const grantsFor = (albumId: string) =>
  db.selectFrom('shared_space_album_user').selectAll().where('albumId', '=', albumId).execute();
const grantAuditFor = (albumId: string) =>
  db.selectFrom('shared_space_album_user_audit').selectAll().where('albumId', '=', albumId).execute();
const linkAuditFor = (albumId: string) =>
  db.selectFrom('shared_space_album_audit').selectAll().where('albumId', '=', albumId).execute();

const softDelete = (albumId: string) =>
  db.updateTable('album').set({ deletedAt: new Date() }).where('id', '=', albumId).execute();
const restore = (albumId: string) =>
  db.updateTable('album').set({ deletedAt: null }).where('id', '=', albumId).execute();

// A space with owner (Owner member) + one Viewer member, linking `album`.
// newSharedSpaceAlbum fires the create-side grant trigger → both members granted.
const linkedSpace = async (ctx: SyncTestContext, ownerId: string, albumId: string, viewerId: string) => {
  const { space } = await ctx.newSharedSpace({ createdById: ownerId });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: ownerId, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewerId, role: SharedSpaceRole.Viewer });
  await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId, addedById: ownerId });
  return space;
};

describe('album_soft_delete_shared_space_album — soft-delete branch', () => {
  it('tombstones every grant and every space→album link when the album is soft-deleted', async () => {
    const ctx = new SyncTestContext(db);
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const space = await linkedSpace(ctx, owner.id, album.id, viewer.id);
    expect((await grantsFor(album.id)).length).toBe(2); // owner + viewer

    await softDelete(album.id);

    // grants revoked (consumer deleted them after the audit insert)
    expect(await grantsFor(album.id)).toHaveLength(0);
    // one grant-revocation audit row per prior grant-holder
    const ga = await grantAuditFor(album.id);
    expect(ga.map((r) => r.userId).sort()).toEqual([owner.id, viewer.id].sort());
    // one link tombstone per (space, album) link
    const la = await linkAuditFor(album.id);
    expect(la.map((r) => r.spaceId)).toEqual([space.id]);
  });

  it('does NOT act on a non-deletedAt update (updateId bump / rename)', async () => {
    const ctx = new SyncTestContext(db);
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    await linkedSpace(ctx, owner.id, album.id, viewer.id);

    await db.updateTable('album').set({ albumName: 'renamed' }).where('id', '=', album.id).execute();

    expect((await grantsFor(album.id)).length).toBe(2); // untouched
    expect(await grantAuditFor(album.id)).toHaveLength(0);
    expect(await linkAuditFor(album.id)).toHaveLength(0);
  });

  it('does NOT double-tombstone when softDeleteAll re-stamps an already-trashed album', async () => {
    const ctx = new SyncTestContext(db);
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    await linkedSpace(ctx, owner.id, album.id, viewer.id);

    await softDelete(album.id);
    const auditAfterFirst = (await grantAuditFor(album.id)).length;
    const linkAfterFirst = (await linkAuditFor(album.id)).length;

    // re-stamp deletedAt to a new timestamp (NOT NULL → NOT NULL, no transition)
    await db.updateTable('album').set({ deletedAt: new Date() }).where('id', '=', album.id).execute();

    expect((await grantAuditFor(album.id)).length).toBe(auditAfterFirst); // no new rows
    expect((await linkAuditFor(album.id)).length).toBe(linkAfterFirst);
  });
});

describe('album_soft_delete_shared_space_album — restore branch', () => {
  it('re-creates every member grant with a FRESH createId on restore', async () => {
    const ctx = new SyncTestContext(db);
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    await linkedSpace(ctx, owner.id, album.id, viewer.id);
    const before = await grantsFor(album.id);
    const viewerCreateIdBefore = before.find((g) => g.userId === viewer.id)!.createId;

    await softDelete(album.id);
    expect(await grantsFor(album.id)).toHaveLength(0);

    await restore(album.id);

    const after = await grantsFor(album.id);
    expect(after.map((r) => r.userId).sort()).toEqual([owner.id, viewer.id].sort());
    // re-created via plain INSERT → a new createId (default immich_uuid_v7()), strictly greater
    const viewerCreateIdAfter = after.find((g) => g.userId === viewer.id)!.createId;
    expect(viewerCreateIdAfter > viewerCreateIdBefore).toBe(true);
  });

  it('bumps shared_space_album.updateId on restore so the link row re-delivers', async () => {
    const ctx = new SyncTestContext(db);
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const space = await linkedSpace(ctx, owner.id, album.id, viewer.id);
    const updateIdBefore = (
      await db
        .selectFrom('shared_space_album')
        .select('updateId')
        .where('spaceId', '=', space.id)
        .where('albumId', '=', album.id)
        .executeTakeFirstOrThrow()
    ).updateId;

    await softDelete(album.id);
    await restore(album.id);

    const updateIdAfter = (
      await db
        .selectFrom('shared_space_album')
        .select('updateId')
        .where('spaceId', '=', space.id)
        .where('albumId', '=', album.id)
        .executeTakeFirstOrThrow()
    ).updateId;
    expect(updateIdAfter > updateIdBefore).toBe(true);
  });

  it('re-delivers a grant created DURING the trash window with a bumped createId (albums-3)', async () => {
    const ctx = new SyncTestContext(db);
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { user: latecomer } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const space = await linkedSpace(ctx, owner.id, album.id, viewer.id);

    await softDelete(album.id); // grants revoked

    // A new member joins DURING the window → member-join create-side trigger inserts a grant
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: latecomer.id, role: SharedSpaceRole.Viewer });
    const windowGrant = (await grantsFor(album.id)).find((g) => g.userId === latecomer.id)!;
    expect(windowGrant).toBeDefined();

    await restore(album.id);

    const after = await grantsFor(album.id);
    // latecomer's grant survived the ON CONFLICT and its createId was bumped
    const latecomerAfter = after.find((g) => g.userId === latecomer.id)!;
    expect(latecomerAfter.createId > windowGrant.createId).toBe(true);
    // and owner + viewer were re-created too
    expect(after.map((r) => r.userId).sort()).toEqual([owner.id, viewer.id, latecomer.id].sort());
  });
});

describe('album in two spaces during a trash window', () => {
  it('restore re-grants via the still-linked space without double-creating', async () => {
    const ctx = new SyncTestContext(db);
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { space: s1 } = await ctx.newSharedSpace({ createdById: owner.id });
    const { space: s2 } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: s1.id, userId: member.id, role: SharedSpaceRole.Viewer });
    await ctx.newSharedSpaceMember({ spaceId: s2.id, userId: member.id, role: SharedSpaceRole.Viewer });
    await ctx.newSharedSpaceAlbum({ spaceId: s1.id, albumId: album.id, addedById: owner.id });
    await ctx.newSharedSpaceAlbum({ spaceId: s2.id, albumId: album.id, addedById: owner.id });

    await softDelete(album.id);
    // one space unlinks the trashed album during the window
    await db.deleteFrom('shared_space_album').where('spaceId', '=', s1.id).where('albumId', '=', album.id).execute();

    await restore(album.id);

    // exactly one grant for member (PK dedups; re-granted via s2 only)
    const memberGrants = (await grantsFor(album.id)).filter((g) => g.userId === member.id);
    expect(memberGrants).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/sync/shared-space-album-soft-delete-triggers.spec.ts`
Expected (CI-deferred; Docker is down locally): FAIL — no `album_soft_delete_shared_space_album` trigger exists, so soft-delete leaves grants/links intact (`grantsFor` still length 2, no audit rows) and restore never re-creates grants.

- [ ] **Step 3: Add the trigger function to `functions.ts`**

Append after `shared_space_member_after_insert_album` (functions.ts ~line 707):

```ts
// --- gallery-fork: album soft-delete/restore → shared_space_album lifecycle ---
//
// One AFTER UPDATE statement trigger on album. Guarded (in-body) to real
// deletedAt NULL<->NOT-NULL transitions so it ignores the frequent non-deletedAt
// album updates (renames, updateId bumps from the create-side grant triggers) and
// the re-stamp softDeleteAll does on already-trashed albums.
//
// SOFT-DELETE (live -> trashed): tombstone every shared_space_album_user grant
// (SharedSpaceAlbumSync.getDeletes drops the album + assets on members' devices;
// the existing shared_space_album_user_delete_after_audit consumer deletes the
// grant rows) and every space->album link (SharedSpaceAlbumLinkSync.getDeletes
// drops the shelf link row). A soft-deleted album is universally inaccessible
// (user_has_album_path is FALSE for everyone once deletedAt is set), so revoking
// ALL grants ungated is correct.
//
// RESTORE (trashed -> live): re-create the grant for every member of every space
// still linking the album, with a FRESH createId. ON CONFLICT DO UPDATE bumps the
// createId of any grant that survived (e.g. a member who joined during the window),
// so getCreatedAfter re-delivers past a stale checkpoint (closes albums-2 + albums-3).
// Then bump shared_space_album.updateId so SharedSpaceAlbumLinkSync.getUpserts
// re-delivers the link row (its deletedAt filter passes again after restore).
//
// NOTE: declared as plain AFTER UPDATE (not AFTER UPDATE OF "deletedAt") because
// the sql-tools decorator/override toolchain cannot express a column-restricted
// update trigger; the in-body guard makes the column restriction non-load-bearing.
export const album_soft_delete_shared_space_album = registerFunction({
  name: 'album_soft_delete_shared_space_album',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM new_rows n
        INNER JOIN old_rows o ON o."id" = n."id"
        WHERE (o."deletedAt" IS NULL) <> (n."deletedAt" IS NULL)
      ) THEN
        RETURN NULL;
      END IF;

      -- soft-delete: revoke all grants for the trashed albums
      INSERT INTO shared_space_album_user_audit ("albumId", "userId")
      SELECT ssau."albumId", ssau."userId"
      FROM shared_space_album_user ssau
      WHERE ssau."albumId" IN (
        SELECT n."id" FROM new_rows n
        INNER JOIN old_rows o ON o."id" = n."id"
        WHERE o."deletedAt" IS NULL AND n."deletedAt" IS NOT NULL
      );

      -- soft-delete: tombstone all space->album links for the trashed albums
      INSERT INTO shared_space_album_audit ("spaceId", "albumId")
      SELECT ssa."spaceId", ssa."albumId"
      FROM shared_space_album ssa
      WHERE ssa."albumId" IN (
        SELECT n."id" FROM new_rows n
        INNER JOIN old_rows o ON o."id" = n."id"
        WHERE o."deletedAt" IS NULL AND n."deletedAt" IS NOT NULL
      );

      -- restore: re-create grants for members of every space still linking each album
      INSERT INTO shared_space_album_user ("userId", "albumId")
      SELECT DISTINCT ssm."userId", ssa."albumId"
      FROM shared_space_album ssa
      INNER JOIN shared_space_member ssm ON ssm."spaceId" = ssa."spaceId"
      WHERE ssa."albumId" IN (
        SELECT n."id" FROM new_rows n
        INNER JOIN old_rows o ON o."id" = n."id"
        WHERE o."deletedAt" IS NOT NULL AND n."deletedAt" IS NULL
      )
      ON CONFLICT ("userId", "albumId")
      DO UPDATE SET "createId" = immich_uuid_v7(), "createdAt" = now();

      -- restore: bump shared_space_album.updateId so the link row re-delivers
      UPDATE shared_space_album
      SET "updatedAt" = clock_timestamp(), "updateId" = immich_uuid_v7(clock_timestamp())
      WHERE "albumId" IN (
        SELECT n."id" FROM new_rows n
        INNER JOIN old_rows o ON o."id" = n."id"
        WHERE o."deletedAt" IS NOT NULL AND n."deletedAt" IS NULL
      );

      RETURN NULL;
    END`,
});
```

- [ ] **Step 4: Attach the trigger via the decorator on `AlbumTable`**

Edit `server/src/schema/tables/album.table.ts`. Change the sql-tools import to add `AfterUpdateTrigger`, import the function, and add the decorator on the class:

```ts
import {
  AfterUpdateTrigger,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  ForeignKeyColumn,
  Generated,
  PrimaryGeneratedColumn,
  Table,
  Timestamp,
  UpdateDateColumn,
} from '@immich/sql-tools';
import { UpdatedAtTrigger, UpdateIdColumn } from 'src/decorators';
import { AssetOrder } from 'src/enum';
import { album_soft_delete_shared_space_album } from 'src/schema/functions';
import { AssetTable } from 'src/schema/tables/asset.table';

@Table({ name: 'album' })
@UpdatedAtTrigger('album_updatedAt')
// gallery-fork: on album soft-delete/restore (the user-deletion trash window),
// tombstone/re-create shared_space_album grants + link rows. Body-guarded to real
// deletedAt transitions. See the function comment in schema/functions.ts.
@AfterUpdateTrigger({
  name: 'album_soft_delete_shared_space_album',
  scope: 'statement',
  referencingOldTableAs: 'old_rows',
  referencingNewTableAs: 'new_rows',
  function: album_soft_delete_shared_space_album,
})
export class AlbumTable {
```

(Leave the rest of the class body unchanged.)

- [ ] **Step 5: Write the migration**

Create `server/src/schema/migrations-gallery/1782000000000-AddAlbumSoftDeleteSharedSpaceAlbumTrigger.ts`. Mirror the escaping style of `1779100000000` **exactly** — the `value` JSONB is the CREATE statement escaped for a JSON string literal (`\n`→`\\n`, `"`→`\\"`). The `migration_overrides` `trigger_` SQL is the **column-less** `AFTER UPDATE ON "album"` form (what `asTriggerCreate` produces for the decorator) so the schema-diff stays clean; the actual `CREATE TRIGGER` is also plain `AFTER UPDATE` (identical), so there is no asymmetry.

```ts
import { Kysely, sql } from 'kysely';

// Slice 8: album soft-delete/restore trigger for the shared_space_album lifecycle.
// One AFTER UPDATE statement trigger on album, body-guarded to real deletedAt
// NULL<->NOT-NULL transitions. On soft-delete it revokes all shared_space_album_user
// grants (via shared_space_album_user_audit + the existing consumer) and tombstones
// the space->album links (shared_space_album_audit). On restore it re-creates the
// grants with fresh createId (ON CONFLICT DO UPDATE) and bumps shared_space_album.updateId.
//
// Mirrors the create/delete-side trigger migrations (1779100000000 / 1779200000000):
// CREATE OR REPLACE FUNCTION + CREATE OR REPLACE TRIGGER + a migration_overrides row
// per function and per trigger.

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE OR REPLACE FUNCTION album_soft_delete_shared_space_album()
  RETURNS TRIGGER
  LANGUAGE PLPGSQL
  AS $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM new_rows n
        INNER JOIN old_rows o ON o."id" = n."id"
        WHERE (o."deletedAt" IS NULL) <> (n."deletedAt" IS NULL)
      ) THEN
        RETURN NULL;
      END IF;

      INSERT INTO shared_space_album_user_audit ("albumId", "userId")
      SELECT ssau."albumId", ssau."userId"
      FROM shared_space_album_user ssau
      WHERE ssau."albumId" IN (
        SELECT n."id" FROM new_rows n
        INNER JOIN old_rows o ON o."id" = n."id"
        WHERE o."deletedAt" IS NULL AND n."deletedAt" IS NOT NULL
      );

      INSERT INTO shared_space_album_audit ("spaceId", "albumId")
      SELECT ssa."spaceId", ssa."albumId"
      FROM shared_space_album ssa
      WHERE ssa."albumId" IN (
        SELECT n."id" FROM new_rows n
        INNER JOIN old_rows o ON o."id" = n."id"
        WHERE o."deletedAt" IS NULL AND n."deletedAt" IS NOT NULL
      );

      INSERT INTO shared_space_album_user ("userId", "albumId")
      SELECT DISTINCT ssm."userId", ssa."albumId"
      FROM shared_space_album ssa
      INNER JOIN shared_space_member ssm ON ssm."spaceId" = ssa."spaceId"
      WHERE ssa."albumId" IN (
        SELECT n."id" FROM new_rows n
        INNER JOIN old_rows o ON o."id" = n."id"
        WHERE o."deletedAt" IS NOT NULL AND n."deletedAt" IS NULL
      )
      ON CONFLICT ("userId", "albumId")
      DO UPDATE SET "createId" = immich_uuid_v7(), "createdAt" = now();

      UPDATE shared_space_album
      SET "updatedAt" = clock_timestamp(), "updateId" = immich_uuid_v7(clock_timestamp())
      WHERE "albumId" IN (
        SELECT n."id" FROM new_rows n
        INNER JOIN old_rows o ON o."id" = n."id"
        WHERE o."deletedAt" IS NOT NULL AND n."deletedAt" IS NULL
      );

      RETURN NULL;
    END
  $$;`.execute(db);

  await sql`CREATE OR REPLACE TRIGGER "album_soft_delete_shared_space_album"
  AFTER UPDATE ON "album"
  REFERENCING OLD TABLE AS "old_rows" NEW TABLE AS "new_rows"
  FOR EACH STATEMENT
  EXECUTE FUNCTION album_soft_delete_shared_space_album();`.execute(db);

  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('function_album_soft_delete_shared_space_album', '{"type":"function","name":"album_soft_delete_shared_space_album","sql":"CREATE OR REPLACE FUNCTION album_soft_delete_shared_space_album()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      IF NOT EXISTS (\\n        SELECT 1\\n        FROM new_rows n\\n        INNER JOIN old_rows o ON o.\\"id\\" = n.\\"id\\"\\n        WHERE (o.\\"deletedAt\\" IS NULL) <> (n.\\"deletedAt\\" IS NULL)\\n      ) THEN\\n        RETURN NULL;\\n      END IF;\\n\\n      INSERT INTO shared_space_album_user_audit (\\"albumId\\", \\"userId\\")\\n      SELECT ssau.\\"albumId\\", ssau.\\"userId\\"\\n      FROM shared_space_album_user ssau\\n      WHERE ssau.\\"albumId\\" IN (\\n        SELECT n.\\"id\\" FROM new_rows n\\n        INNER JOIN old_rows o ON o.\\"id\\" = n.\\"id\\"\\n        WHERE o.\\"deletedAt\\" IS NULL AND n.\\"deletedAt\\" IS NOT NULL\\n      );\\n\\n      INSERT INTO shared_space_album_audit (\\"spaceId\\", \\"albumId\\")\\n      SELECT ssa.\\"spaceId\\", ssa.\\"albumId\\"\\n      FROM shared_space_album ssa\\n      WHERE ssa.\\"albumId\\" IN (\\n        SELECT n.\\"id\\" FROM new_rows n\\n        INNER JOIN old_rows o ON o.\\"id\\" = n.\\"id\\"\\n        WHERE o.\\"deletedAt\\" IS NULL AND n.\\"deletedAt\\" IS NOT NULL\\n      );\\n\\n      INSERT INTO shared_space_album_user (\\"userId\\", \\"albumId\\")\\n      SELECT DISTINCT ssm.\\"userId\\", ssa.\\"albumId\\"\\n      FROM shared_space_album ssa\\n      INNER JOIN shared_space_member ssm ON ssm.\\"spaceId\\" = ssa.\\"spaceId\\"\\n      WHERE ssa.\\"albumId\\" IN (\\n        SELECT n.\\"id\\" FROM new_rows n\\n        INNER JOIN old_rows o ON o.\\"id\\" = n.\\"id\\"\\n        WHERE o.\\"deletedAt\\" IS NOT NULL AND n.\\"deletedAt\\" IS NULL\\n      )\\n      ON CONFLICT (\\"userId\\", \\"albumId\\")\\n      DO UPDATE SET \\"createId\\" = immich_uuid_v7(), \\"createdAt\\" = now();\\n\\n      UPDATE shared_space_album\\n      SET \\"updatedAt\\" = clock_timestamp(), \\"updateId\\" = immich_uuid_v7(clock_timestamp())\\n      WHERE \\"albumId\\" IN (\\n        SELECT n.\\"id\\" FROM new_rows n\\n        INNER JOIN old_rows o ON o.\\"id\\" = n.\\"id\\"\\n        WHERE o.\\"deletedAt\\" IS NOT NULL AND n.\\"deletedAt\\" IS NULL\\n      );\\n\\n      RETURN NULL;\\n    END"}'::jsonb);`.execute(
    db,
  );

  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_album_soft_delete_shared_space_album', '{"type":"trigger","name":"album_soft_delete_shared_space_album","sql":"CREATE OR REPLACE TRIGGER \\"album_soft_delete_shared_space_album\\"\\n  AFTER UPDATE ON \\"album\\"\\n  REFERENCING OLD TABLE AS \\"old_rows\\" NEW TABLE AS \\"new_rows\\"\\n  FOR EACH STATEMENT\\n  EXECUTE FUNCTION album_soft_delete_shared_space_album();"}'::jsonb);`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DELETE FROM "migration_overrides" WHERE "name" IN (
    'function_album_soft_delete_shared_space_album',
    'trigger_album_soft_delete_shared_space_album'
  );`.execute(db);
  await sql`DROP TRIGGER IF EXISTS "album_soft_delete_shared_space_album" ON "album";`.execute(db);
  await sql`DROP FUNCTION IF EXISTS album_soft_delete_shared_space_album();`.execute(db);
}
```

> **Implementer note (validated by CI, not tsc):** the two `value` JSONB strings above must each be a byte-exact escaped copy of the CREATE statement immediately above them (the `function_` value omits the trailing `\n  $$;` exactly as the sibling migration `1779100000000` does — it stores the body form; the `trigger_` value is the plain `AFTER UPDATE` form). If you change the SQL, regenerate the escape. `pnpm run check` only validates that these are well-formed TS string literals; the medium tests in Step 1 (which apply this migration to a real Postgres) validate that the JSONB parses and the trigger behaves.

- [ ] **Step 6: Extend `scripts/revert-to-immich.sql`**

Two edits.

(a) In section 1 ("Drop Gallery-only triggers on Immich-native tables", after `revert-to-immich.sql:95`), add:

```sql
DROP TRIGGER IF EXISTS "album_soft_delete_shared_space_album" ON "album";
```

(b) In section 5 (function drops, after `DROP FUNCTION IF EXISTS shared_space_album_user_delete_after_audit() CASCADE;` at `:174`), add:

```sql
DROP FUNCTION IF EXISTS album_soft_delete_shared_space_album() CASCADE;
```

(c) In section 6 (`migration_overrides` DELETE IN-list), add `'function_album_soft_delete_shared_space_album',` next to the other `function_shared_space_album_*` entries (~`:229`) and `'trigger_album_soft_delete_shared_space_album',` next to the other `trigger_shared_space_album_*` entries (~`:255`).

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/sync/shared-space-album-soft-delete-triggers.spec.ts`
Expected (CI): PASS — all soft-delete, restore, transition-guard, albums-3, and two-space assertions green. (Local: cannot run — Docker down. Prove locally via Step 8.)

- [ ] **Step 8: Local gate + commit**

Run: `cd server && pnpm run check && pnpm run lint`
Expected: PASS (tsc + eslint over `functions.ts`, `album.table.ts`, the migration, and the new spec).

```bash
git add server/src/schema/functions.ts server/src/schema/tables/album.table.ts \
  server/src/schema/migrations-gallery/1782000000000-AddAlbumSoftDeleteSharedSpaceAlbumTrigger.ts \
  scripts/revert-to-immich.sql \
  server/test/medium/specs/sync/shared-space-album-soft-delete-triggers.spec.ts
git commit -m "feat(spaces): album soft-delete/restore drives shared-space album grant + link lifecycle"
```

---

## Task 2: `SharedSpaceAlbumLinkSync` deletedAt filter

**Files:**

- Modify: `server/src/repositories/sync.repository.ts` (`SharedSpaceAlbumLinkSync.getUpserts` ~1559-1564, `getBackfill` ~1539-1544)
- Modify: `server/src/queries/sync.repository.sql` (regenerated — CI-deferred)
- Test: `server/test/medium/specs/sync/shared-space-album-link-sync.spec.ts` (extend)

**Interfaces:**

- Consumes: nothing new (independent of Task 1's trigger at the DB level, but co-required for convergence — the trigger writes the link tombstone, this filter stops the tombstoned row re-appearing via `getUpserts`/`getBackfill`).
- Produces: `SharedSpaceAlbumLinkSync.getUpserts`/`getBackfill` now `innerJoin('album', 'album.id', 'shared_space_album.albumId').where('album.deletedAt', 'is', null)`.

- [ ] **Step 1: Write the failing tests**

Append to `server/test/medium/specs/sync/shared-space-album-link-sync.spec.ts`. Add `describe` blocks inside the file (it already imports `Kysely`, `SharedSpaceRole`, `SyncRepository`, `SyncTestContext`, `getKyselyDB`, and defines `NOW_ID`, `BEFORE_UPDATE_ID`, `setup()`):

```ts
describe('SharedSpaceAlbumLinkSync — soft-deleted album exclusion (Slice 8)', () => {
  it('getUpserts excludes a soft-deleted album link row but keeps live ones', async () => {
    const { ctx, db, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { album: live } = await ctx.newAlbum({ ownerId: owner.id });
    const { album: trashed } = await ctx.newAlbum({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: live.id, addedById: owner.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: trashed.id, addedById: owner.id });

    await db.updateTable('album').set({ deletedAt: new Date() }).where('id', '=', trashed.id).execute();

    const stream = sut.getUpserts({ nowId: NOW_ID, userId: owner.id });
    const result: any[] = [];
    for await (const row of stream) result.push(row);
    const albumIds = result.map((r: any) => r.albumId);
    expect(albumIds).toContain(live.id);
    expect(albumIds).not.toContain(trashed.id);
  });

  it('getBackfill excludes a soft-deleted album link row but keeps live ones', async () => {
    const { ctx, db, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { album: live } = await ctx.newAlbum({ ownerId: owner.id });
    const { album: trashed } = await ctx.newAlbum({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: live.id, addedById: owner.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: trashed.id, addedById: owner.id });

    await db.updateTable('album').set({ deletedAt: new Date() }).where('id', '=', trashed.id).execute();

    const stream = sut.getBackfill({ nowId: NOW_ID, beforeUpdateId: BEFORE_UPDATE_ID }, space.id);
    const result: any[] = [];
    for await (const row of stream) result.push(row);
    const albumIds = result.map((r: any) => r.albumId);
    expect(albumIds).toContain(live.id);
    expect(albumIds).not.toContain(trashed.id);
  });

  it('re-includes the link row after the album is restored', async () => {
    const { ctx, db, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

    await db.updateTable('album').set({ deletedAt: new Date() }).where('id', '=', album.id).execute();
    await db.updateTable('album').set({ deletedAt: null }).where('id', '=', album.id).execute();

    const stream = sut.getUpserts({ nowId: NOW_ID, userId: owner.id });
    const result: any[] = [];
    for await (const row of stream) result.push(row);
    expect(result.map((r: any) => r.albumId)).toContain(album.id);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/sync/shared-space-album-link-sync.spec.ts`
Expected (CI): the two exclusion tests FAIL — `getUpserts`/`getBackfill` currently stream the soft-deleted album's link row (no `deletedAt` filter), so `albumIds` still contains `trashed.id`.

- [ ] **Step 3: Add the `deletedAt` filter**

Edit `server/src/repositories/sync.repository.ts`. `getBackfill` (~1539-1544):

```ts
  @GenerateSql({ params: [dummyBackfillOptions, DummyValue.UUID], stream: true })
  getBackfill(options: SyncBackfillOptions, spaceId: string) {
    return this.backfillQuery('shared_space_album', options)
      .innerJoin('album', 'album.id', 'shared_space_album.albumId')
      .select(SHARED_SPACE_ALBUM_SYNC_COLUMNS)
      .where('shared_space_album.spaceId', '=', spaceId)
      // Slice 8 (correctness-3): never stream a soft-deleted album's link row; the
      // trigger tombstones it via shared_space_album_audit, and this stops getUpserts/
      // getBackfill re-adding it before restore.
      .where('album.deletedAt', 'is', null)
      .stream();
  }
```

`getUpserts` (~1559-1564):

```ts
  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getUpserts(options: SyncQueryOptions) {
    return this.upsertQuery('shared_space_album', options)
      .innerJoin('album', 'album.id', 'shared_space_album.albumId')
      .select(SHARED_SPACE_ALBUM_SYNC_COLUMNS)
      .where('shared_space_album.spaceId', 'in', (eb) => accessibleSpaces(eb, options.userId))
      // Slice 8 (correctness-3): exclude soft-deleted albums so a stale updateId bump
      // cannot re-add a tombstoned link row (convergence). Restore bumps updateId and
      // clears deletedAt → the row re-delivers.
      .where('album.deletedAt', 'is', null)
      .stream();
  }
```

(The `innerJoin('album', …)` is 1:1 on `shared_space_album.albumId → album.id`, so no row duplication; `SHARED_SPACE_ALBUM_SYNC_COLUMNS` are all from `shared_space_album` and the `updateId` ordering is unchanged.)

- [ ] **Step 4: Run to verify pass**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/sync/shared-space-album-link-sync.spec.ts`
Expected (CI): PASS — exclusion tests green, restore re-includes, and all pre-existing link-sync tests still pass.

- [ ] **Step 5: Local gate**

Run: `cd server && pnpm run check && pnpm run lint`
Expected: PASS.

- [ ] **Step 6: Regenerate the query SQL doc (CI-deferred)**

`getUpserts`/`getBackfill` carry `@GenerateSql`, so their generated SQL in `server/src/queries/sync.repository.sql` changes (added `inner join "album"` + `"album"."deletedAt" is null`). **Do NOT run `make sql` locally (no DB → it deletes query files).** Regenerate on a scratch migrated DB, or let CI's SQL-generation check flag the drift and regenerate there. If the committed `.sql` is stale, the CI "sql" check fails — regenerate before merge. Note this in the commit body.

- [ ] **Step 7: Commit**

```bash
git add server/src/repositories/sync.repository.ts \
  server/test/medium/specs/sync/shared-space-album-link-sync.spec.ts \
  server/src/queries/sync.repository.sql
git commit -m "fix(spaces): exclude soft-deleted albums from shared-space album link sync"
```

(If `sync.repository.sql` was not regenerated locally, omit it from this commit and add a `-m` note that it must be regenerated on a scratch DB / in CI.)

---

## Task 3: albums-9 — re-link grant gets a fresh createId

**Files:**

- Modify: `server/src/schema/functions.ts` (`shared_space_album_after_insert_user`, ~664-681)
- Create: `server/src/schema/migrations-gallery/1782100000000-FixSharedSpaceAlbumGrantRelinkCreateId.ts`
- Test: `server/test/medium/specs/sync/shared-space-album-create-triggers.spec.ts` (extend)

**Interfaces:**

- Produces: `shared_space_album_after_insert_user`'s grant insert changes from `ON CONFLICT DO NOTHING` to `ON CONFLICT ("userId", "albumId") DO UPDATE SET "createId" = immich_uuid_v7(), "createdAt" = now()`. Only the **re-link** create-side trigger (fired by `shared_space_album` INSERT) is changed; the member-join trigger `shared_space_member_after_insert_album` keeps `DO NOTHING` (a joining member with a pre-existing grant already has the assets — no re-backfill needed).

**Safety (albums-9 cannot resurrect a revoked grant):** `DO UPDATE` fires **only on conflict**, i.e. only when the `(userId, albumId)` grant row **already exists** — which means the user still had an access path (a legitimately-revoked grant was deleted by the delete-side consumer, so re-link does a plain INSERT for a now-valid space membership). `DO UPDATE` therefore never re-inserts a deleted grant; it only refreshes the `createId` of a surviving one. Verified.

- [ ] **Step 1: Write the failing test**

Append to `server/test/medium/specs/sync/shared-space-album-create-triggers.spec.ts` (uses the same `SyncTestContext`/`getKyselyDB`/`db`/`grantsFor` harness as the delete-triggers spec — add the helper if the file doesn't already define it):

```ts
describe('re-link after unlink refreshes the grant createId (albums-9)', () => {
  it('bumps createId on ON CONFLICT when the grant survived via another path', async () => {
    const ctx = new SyncTestContext(db);
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { space: s1 } = await ctx.newSharedSpace({ createdById: owner.id });
    const { space: s2 } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: s1.id, userId: member.id, role: SharedSpaceRole.Viewer });
    await ctx.newSharedSpaceMember({ spaceId: s2.id, userId: member.id, role: SharedSpaceRole.Viewer });

    // Link into both spaces → one grant for member (PK dedups). It survives an s1 unlink via s2.
    await ctx.newSharedSpaceAlbum({ spaceId: s1.id, albumId: album.id, addedById: owner.id });
    await ctx.newSharedSpaceAlbum({ spaceId: s2.id, albumId: album.id, addedById: owner.id });
    const grantBefore = (await grantsFor(album.id)).find((g) => g.userId === member.id)!;

    await db.deleteFrom('shared_space_album').where('spaceId', '=', s1.id).where('albumId', '=', album.id).execute();
    // grant retained via s2 (user_has_album_path true)
    expect((await grantsFor(album.id)).some((g) => g.userId === member.id)).toBe(true);

    // Re-link into s1 → ON CONFLICT DO UPDATE refreshes the surviving grant's createId
    await ctx.newSharedSpaceAlbum({ spaceId: s1.id, albumId: album.id, addedById: owner.id });

    const grantAfter = (await grantsFor(album.id)).find((g) => g.userId === member.id)!;
    expect(grantAfter.createId > grantBefore.createId).toBe(true);
  });

  it('a fresh legitimate grant (no prior path) is a plain insert, not a resurrection', async () => {
    const ctx = new SyncTestContext(db);
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Viewer });

    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });
    // unlink → sole path gone → grant revoked
    await db.deleteFrom('shared_space_album').where('spaceId', '=', space.id).where('albumId', '=', album.id).execute();
    expect((await grantsFor(album.id)).some((g) => g.userId === member.id)).toBe(false);

    // re-link → plain INSERT (no conflict), member re-granted exactly once
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });
    expect((await grantsFor(album.id)).filter((g) => g.userId === member.id)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/sync/shared-space-album-create-triggers.spec.ts`
Expected (CI): the `createId > grantBefore.createId` assertion FAILS — `ON CONFLICT DO NOTHING` keeps the original `createId`.

- [ ] **Step 3: Update `functions.ts`**

In `shared_space_album_after_insert_user` (functions.ts ~669-674), change the `ON CONFLICT` clause:

```ts
export const shared_space_album_after_insert_user = registerFunction({
  name: 'shared_space_album_after_insert_user',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    BEGIN
      INSERT INTO shared_space_album_user ("userId", "albumId")
      SELECT DISTINCT ssm."userId", ir."albumId"
      FROM inserted_rows ir
      INNER JOIN shared_space_member ssm ON ssm."spaceId" = ir."spaceId"
      ON CONFLICT ("userId", "albumId")
      DO UPDATE SET "createId" = immich_uuid_v7(), "createdAt" = now();

      UPDATE album
      SET "updatedAt" = clock_timestamp(), "updateId" = immich_uuid_v7(clock_timestamp())
      WHERE "id" IN (SELECT DISTINCT "albumId" FROM inserted_rows);
      RETURN NULL;
    END`,
});
```

- [ ] **Step 4: Write the migration**

Create `server/src/schema/migrations-gallery/1782100000000-FixSharedSpaceAlbumGrantRelinkCreateId.ts`. Mirror `1779300000000-FixUserHasAlbumPathSoftDeleted.ts`: `CREATE OR REPLACE FUNCTION` + `UPDATE migration_overrides SET value WHERE name` (the `function_shared_space_album_after_insert_user` row already exists). `down` restores `ON CONFLICT DO NOTHING`.

```ts
import { Kysely, sql } from 'kysely';

// Slice 8 (albums-9): re-linking an album whose grant survived via another path
// reused the original createId (ON CONFLICT DO NOTHING), so a client past that
// checkpoint got no backfill and missed assets added while unlinked. Refresh the
// createId on conflict so getCreatedAfter re-delivers.
//
// Only the re-link create-side trigger (shared_space_album INSERT) is changed;
// shared_space_member_after_insert_album (member-join) keeps DO NOTHING.

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE OR REPLACE FUNCTION shared_space_album_after_insert_user()
  RETURNS TRIGGER
  LANGUAGE PLPGSQL
  AS $$
    BEGIN
      INSERT INTO shared_space_album_user ("userId", "albumId")
      SELECT DISTINCT ssm."userId", ir."albumId"
      FROM inserted_rows ir
      INNER JOIN shared_space_member ssm ON ssm."spaceId" = ir."spaceId"
      ON CONFLICT ("userId", "albumId")
      DO UPDATE SET "createId" = immich_uuid_v7(), "createdAt" = now();

      UPDATE album
      SET "updatedAt" = clock_timestamp(), "updateId" = immich_uuid_v7(clock_timestamp())
      WHERE "id" IN (SELECT DISTINCT "albumId" FROM inserted_rows);
      RETURN NULL;
    END
  $$;`.execute(db);

  await sql`UPDATE "migration_overrides"
  SET "value" = '{"type":"function","name":"shared_space_album_after_insert_user","sql":"CREATE OR REPLACE FUNCTION shared_space_album_after_insert_user()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      INSERT INTO shared_space_album_user (\\"userId\\", \\"albumId\\")\\n      SELECT DISTINCT ssm.\\"userId\\", ir.\\"albumId\\"\\n      FROM inserted_rows ir\\n      INNER JOIN shared_space_member ssm ON ssm.\\"spaceId\\" = ir.\\"spaceId\\"\\n      ON CONFLICT (\\"userId\\", \\"albumId\\")\\n      DO UPDATE SET \\"createId\\" = immich_uuid_v7(), \\"createdAt\\" = now();\\n\\n      UPDATE album\\n      SET \\"updatedAt\\" = clock_timestamp(), \\"updateId\\" = immich_uuid_v7(clock_timestamp())\\n      WHERE \\"id\\" IN (SELECT DISTINCT \\"albumId\\" FROM inserted_rows);\\n      RETURN NULL;\\n    END\\n  $$;"}'::jsonb
  WHERE "name" = 'function_shared_space_album_after_insert_user';`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`CREATE OR REPLACE FUNCTION shared_space_album_after_insert_user()
  RETURNS TRIGGER
  LANGUAGE PLPGSQL
  AS $$
    BEGIN
      INSERT INTO shared_space_album_user ("userId", "albumId")
      SELECT DISTINCT ssm."userId", ir."albumId"
      FROM inserted_rows ir
      INNER JOIN shared_space_member ssm ON ssm."spaceId" = ir."spaceId"
      ON CONFLICT DO NOTHING;

      UPDATE album
      SET "updatedAt" = clock_timestamp(), "updateId" = immich_uuid_v7(clock_timestamp())
      WHERE "id" IN (SELECT DISTINCT "albumId" FROM inserted_rows);
      RETURN NULL;
    END
  $$;`.execute(db);

  await sql`UPDATE "migration_overrides"
  SET "value" = '{"type":"function","name":"shared_space_album_after_insert_user","sql":"CREATE OR REPLACE FUNCTION shared_space_album_after_insert_user()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      INSERT INTO shared_space_album_user (\\"userId\\", \\"albumId\\")\\n      SELECT DISTINCT ssm.\\"userId\\", ir.\\"albumId\\"\\n      FROM inserted_rows ir\\n      INNER JOIN shared_space_member ssm ON ssm.\\"spaceId\\" = ir.\\"spaceId\\"\\n      ON CONFLICT DO NOTHING;\\n\\n      UPDATE album\\n      SET \\"updatedAt\\" = clock_timestamp(), \\"updateId\\" = immich_uuid_v7(clock_timestamp())\\n      WHERE \\"id\\" IN (SELECT DISTINCT \\"albumId\\" FROM inserted_rows);\\n      RETURN NULL;\\n    END\\n  $$;"}'::jsonb
  WHERE "name" = 'function_shared_space_album_after_insert_user';`.execute(db);
}
```

(No `revert-to-immich.sql` change: `function_shared_space_album_after_insert_user` and the function/trigger drops are already listed; only the body changed.)

- [ ] **Step 5: Run to verify pass**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/sync/shared-space-album-create-triggers.spec.ts`
Expected (CI): PASS — createId bumped on re-link; plain insert on legitimate fresh grant; pre-existing create-trigger tests still green.

- [ ] **Step 6: Local gate + commit**

Run: `cd server && pnpm run check && pnpm run lint`
Expected: PASS.

```bash
git add server/src/schema/functions.ts \
  server/src/schema/migrations-gallery/1782100000000-FixSharedSpaceAlbumGrantRelinkCreateId.ts \
  server/test/medium/specs/sync/shared-space-album-create-triggers.spec.ts
git commit -m "fix(spaces): refresh shared-space album grant createId on re-link (albums-9)"
```

---

## Task 4: End-to-end trash-lifecycle sync (ties Tasks 1–3 together)

**Files:**

- Create: `server/test/medium/specs/sync/sync-shared-space-album-trash-lifecycle.spec.ts`

**Interfaces:**

- Consumes: the Task 1 trigger, the Task 2 link filter, and the Task 3 createId change — all three, driven through the real `SyncService.syncStream`.

- [ ] **Step 1: Write the end-to-end test**

Create `server/test/medium/specs/sync/sync-shared-space-album-trash-lifecycle.spec.ts`:

```ts
import { Kysely } from 'kysely';
import { SharedSpaceRole, SyncEntityType, SyncRequestType } from 'src/enum';
import { DB } from 'src/schema';
import { SyncTestContext } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = async () => {
  const ctx = new SyncTestContext(defaultDatabase);
  const { auth } = await ctx.newSyncAuthUser(); // the syncing member
  return { auth, ctx, db: defaultDatabase };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

const softDelete = (db: Kysely<DB>, albumId: string) =>
  db.updateTable('album').set({ deletedAt: new Date() }).where('id', '=', albumId).execute();
const restore = (db: Kysely<DB>, albumId: string) =>
  db.updateTable('album').set({ deletedAt: null }).where('id', '=', albumId).execute();

// Build: owner + album (with one asset) linked into a space the syncing member belongs to.
const scenario = async (ctx: SyncTestContext, memberId: string) => {
  const { user: owner } = await ctx.newUser();
  const { album } = await ctx.newAlbum({ ownerId: owner.id });
  const { asset } = await ctx.newAsset({ ownerId: owner.id });
  await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
  const { space } = await ctx.newSharedSpace({ createdById: owner.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: memberId, role: SharedSpaceRole.Viewer });
  await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });
  return { owner, album, asset, space };
};

const ALBUM_TYPES = [SyncRequestType.SharedSpaceAlbumsV1, SyncRequestType.SharedSpaceAlbumLinksV1];

describe('shared-space album trash lifecycle (Slice 8, end-to-end)', () => {
  it('soft-delete emits a grant-delete AND a link-delete to the member', async () => {
    const { auth, ctx, db } = await setup();
    const { album, space } = await scenario(ctx, auth.user.id);

    // initial converged sync
    const initial = await ctx.syncStream(auth, ALBUM_TYPES);
    await ctx.syncAckAll(auth, initial);

    await softDelete(db, album.id);

    const response = await ctx.syncStream(auth, ALBUM_TYPES);
    // grant-revocation → album drops (metadata + assets)
    expect(
      response.some((r) => r.type === SyncEntityType.SharedSpaceAlbumDeleteV1 && (r as any).data.albumId === album.id),
    ).toBe(true);
    // link tombstone → shelf link row drops
    expect(
      response.some(
        (r) =>
          r.type === SyncEntityType.SharedSpaceAlbumLinkDeleteV1 &&
          (r as any).data.albumId === album.id &&
          (r as any).data.spaceId === space.id,
      ),
    ).toBe(true);
    // Task 2: the soft-deleted link row must NOT be re-added by an upsert in the same stream
    expect(
      response.some((r) => r.type === SyncEntityType.SharedSpaceAlbumLinkV1 && (r as any).data.albumId === album.id),
    ).toBe(false);
  });

  it('restore re-delivers the album metadata + link + a fresh grant', async () => {
    const { auth, ctx, db } = await setup();
    const { album } = await scenario(ctx, auth.user.id);

    const initial = await ctx.syncStream(auth, ALBUM_TYPES);
    await ctx.syncAckAll(auth, initial);
    await softDelete(db, album.id);
    const afterDelete = await ctx.syncStream(auth, ALBUM_TYPES);
    await ctx.syncAckAll(auth, afterDelete);

    await restore(db, album.id);

    const response = await ctx.syncStream(auth, ALBUM_TYPES);
    // metadata re-delivered (SharedSpaceAlbumV1) and link re-delivered (SharedSpaceAlbumLinkV1)
    expect(response.some((r) => r.type === SyncEntityType.SharedSpaceAlbumV1 && (r as any).data.id === album.id)).toBe(
      true,
    );
    expect(
      response.some((r) => r.type === SyncEntityType.SharedSpaceAlbumLinkV1 && (r as any).data.albumId === album.id),
    ).toBe(true);
  });

  it('re-delivers album assets after restore (grant re-created, non-empty album)', async () => {
    const { auth, ctx, db } = await setup();
    const { album, asset } = await scenario(ctx, auth.user.id);

    const initial = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
    await ctx.syncAckAll(auth, initial);
    await softDelete(db, album.id);
    const afterDelete = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
    await ctx.syncAckAll(auth, afterDelete);

    await restore(db, album.id);

    const response = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
    const assetIds = response
      .filter((r) => r.type === SyncEntityType.SharedSpaceAlbumToAssetV1)
      .map((r) => (r as any).data.assetId);
    expect(assetIds).toContain(asset.id);
  });

  it('re-link delivers assets added while unlinked (albums-9 end-to-end)', async () => {
    const { auth, ctx, db } = await setup();
    const { owner, album } = await scenario(ctx, auth.user.id);
    // second space keeps a path so the grant survives the first unlink
    const { space: s2 } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: s2.id, userId: auth.user.id, role: SharedSpaceRole.Viewer });
    await ctx.newSharedSpaceAlbum({ spaceId: s2.id, albumId: album.id, addedById: owner.id });

    const initial = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
    await ctx.syncAckAll(auth, initial);

    // unlink from the first space (grant retained via s2), add an asset while unlinked
    const firstSpaceId = (
      await db.selectFrom('shared_space_album').select('spaceId').where('albumId', '=', album.id).execute()
    ).find((r) => r.spaceId !== s2.id)!.spaceId;
    await db
      .deleteFrom('shared_space_album')
      .where('spaceId', '=', firstSpaceId)
      .where('albumId', '=', album.id)
      .execute();
    const { asset: added } = await ctx.newAsset({ ownerId: owner.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: added.id });

    // re-link into the first space → ON CONFLICT DO UPDATE refreshes createId → backfill re-runs
    await ctx.newSharedSpaceAlbum({ spaceId: firstSpaceId, albumId: album.id, addedById: owner.id });

    const response = await ctx.syncStream(auth, [
      SyncRequestType.SharedSpaceAlbumsV1,
      SyncRequestType.SharedSpaceAlbumToAssetsV1,
    ]);
    const assetIds = response
      .filter((r) => r.type === SyncEntityType.SharedSpaceAlbumToAssetV1)
      .map((r) => (r as any).data.assetId);
    expect(assetIds).toContain(added.id);
  });
});
```

- [ ] **Step 2: Run to verify pass (CI)**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/sync/sync-shared-space-album-trash-lifecycle.spec.ts`
Expected (CI): PASS. (This spec is only green once Tasks 1–3 are all in; if run per-commit it belongs at the end.)

- [ ] **Step 3: Local gate + commit**

Run: `cd server && pnpm run check && pnpm run lint`
Expected: PASS.

```bash
git add server/test/medium/specs/sync/sync-shared-space-album-trash-lifecycle.spec.ts
git commit -m "test(spaces): end-to-end shared-space album trash lifecycle sync"
```

---

## Edge cases — every one is a named test above

| Edge case (spec §Slice 8)                                                                                                              | Where covered                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Album in **two** spaces, one unlinked during another's trash window → grant survives via the other path, restore doesn't double-create | Task 1 "album in two spaces during a trash window"                                                                                                                                                                                                                                     |
| Restore of an album whose owner is still trashed vs restored — define behavior                                                         | **Documented (B.1):** album restore ⟺ user restore; there is no independent album-restore path. No separate test needed — soft-delete and restore both go through `softDeleteAll`/`restoreAll`.                                                                                        |
| Hard delete after soft delete still emits the final delete (don't **double-tombstone**)                                                | Task 1 "does NOT double-tombstone when softDeleteAll re-stamps"; and the transition guard means the eventual hard-delete's `shared_space_album_delete_audit` produces at most an **idempotent** duplicate (client drop of an already-dropped album/link is a no-op) — documented below |
| `deletedAt` filter on `SharedSpaceAlbumLinkSync` does **not** hide **live** albums                                                     | Task 2 "getUpserts excludes a soft-deleted album link row but keeps live ones" (asserts `live.id` present) + "re-includes after restore"                                                                                                                                               |
| Fresh `createId` on re-link doesn't resurrect a legitimately-revoked grant (only when a path actually exists)                          | Task 3 "a fresh legitimate grant (no prior path) is a plain insert, not a resurrection" + the safety argument in Task 3                                                                                                                                                                |
| Grant created **during** a trash window then restore → delivered past a stale checkpoint (albums-3)                                    | Task 1 "re-delivers a grant created DURING the trash window" + Task 4 (implicitly, via createId bump)                                                                                                                                                                                  |
| Restore re-creates grants (albums-2) with fresh createId                                                                               | Task 1 "re-creates every member grant with a FRESH createId on restore" + Task 4 "restore re-delivers"                                                                                                                                                                                 |
| Transition guard ignores non-deletedAt updates                                                                                         | Task 1 "does NOT act on a non-deletedAt update"                                                                                                                                                                                                                                        |

**Idempotent double-tombstone note (documented, accepted):** on the _force_-delete path (`softDeleteAll` then a later hard-delete), the album's hard-delete cascades to `shared_space_album` and fires the existing `shared_space_album_delete_audit`, producing a second link-audit (and a grant-audit whose consumer no-ops because the grant was already deleted by the soft-delete branch). Both duplicates are **idempotent** on the client (dropping an already-dropped album/link is a no-op). Preventing them would require the hard-delete path to detect a prior soft-delete audit — unnecessary complexity for no correctness gain. This is the resolution of the spec's "don't double-tombstone" edge case.

---

## Validation

**Local gate (run after every task; the only thing runnable without Docker):**

```bash
cd server && pnpm run check && pnpm run lint
```

Expected: PASS — tsc over `functions.ts`, `album.table.ts`, both migrations, `sync.repository.ts`, and the four spec files; eslint zero-warnings.

**CI-deferred (the only behavioral validation — Docker is down locally):**

- `server/test/medium/specs/sync/shared-space-album-soft-delete-triggers.spec.ts` — soft-delete tombstones all grants + links; restore re-creates grants (fresh createId) + bumps link updateId; transition guard ignores non-deletedAt updates; no double-tombstone on re-stamp; albums-3 window-grant re-delivery; two-space restore no double-create.
- `server/test/medium/specs/sync/shared-space-album-link-sync.spec.ts` (extended) — `getUpserts`/`getBackfill` exclude soft-deleted, keep live, re-include on restore.
- `server/test/medium/specs/sync/shared-space-album-create-triggers.spec.ts` (extended) — re-link bumps createId; fresh legitimate grant is a plain insert.
- `server/test/medium/specs/sync/sync-shared-space-album-trash-lifecycle.spec.ts` — end-to-end via `SyncService.syncStream`: soft-delete emits `SharedSpaceAlbumDeleteV1` + `SharedSpaceAlbumLinkDeleteV1` and no re-adding `SharedSpaceAlbumLinkV1`; restore re-delivers metadata + link + assets; re-link delivers assets added while unlinked.
- **`src/queries/sync.repository.sql`** must be regenerated on a scratch migrated DB (Task 2) — the CI SQL-generation check fails on drift. Never `make sql` without a DB.
- Full server medium suite (`pnpm test:medium`) green — the migrations apply cleanly on a fresh DB and interleave (unordered) on an already-migrated DB; the pre-existing `shared-space-album-*` and `sync-shared-space-album*` specs still pass (the new trigger fires during their soft-delete `UPDATE`s but the transition guard + universal-inaccessibility of soft-deleted albums keep their assertions valid).

---

## Self-review (spec §Slice 8 coverage)

- **correctness-3 / albums-4** (soft-delete emits no sync deletes): closed by Task 1 (grant-audit + link-audit on soft-delete) **and** Task 2 (link filter, so the tombstone converges). ✔
- **albums-2** (grant over-revocation during trash window irreversible): closed by Task 1 restore branch (re-creates grants). ✔
- **albums-3** (backfill skips window-created grants): closed by Task 1 restore branch's `ON CONFLICT DO UPDATE` bumping `createId` (kept the `accessibleSpaceAlbums` filter in `getCreatedAfter` — the restore-trigger approach the spec prefers). ✔
- **albums-9** (re-link reuses old createId): closed by Task 3. ✔
- No new table → `fork_tables_left` guard untouched (correctness-7 stays in Slice 11). ✔
- Placeholder scan: no TBD/TODO; all SQL, decorators, migrations, and tests are inline and complete. ✔
- Type consistency: trigger/function name `album_soft_delete_shared_space_album` used identically in functions.ts, decorator, migration, and revert script; transition-table aliases `old_rows`/`new_rows` consistent between the `CREATE TRIGGER` and the decorator's `referencingOldTableAs`/`referencingNewTableAs`. ✔
