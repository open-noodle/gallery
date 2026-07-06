# Space Albums Phase 2A — Slice A2: `user_has_album_path()` + Create-side Triggers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add the `user_has_album_path(target_album_id, target_user_id, exclude_space_id)` SQL function and the two create-side triggers (`shared_space_album_after_insert_user` on `shared_space_album`; `shared_space_member_after_insert_album` on `shared_space_member`) that populate the `shared_space_album_user` grant table and bump `album.updateId` for re-delivery.

**Architecture:** Mirror the shipped `library_user` create-side blueprint exactly, swapping `library`→`album` and joining through `shared_space_album` (and `album_asset` is NOT involved here — grants are per-album, not per-asset). The grant fan-out is identical to `shared_space_library_after_insert_user` / `shared_space_member_after_insert_library`. `user_has_album_path` mirrors `user_has_library_path` and adds a 4th branch (manual `album_user` of any role) that libraries lack. Each function/trigger is declared three ways (the fork pattern): a `registerFunction` in `schema/functions.ts`, a `@AfterInsertTrigger` decorator on the table, and raw `CREATE` SQL + a `migration_overrides` row in a new fork migration.

**Tech Stack:** PostgreSQL PL/pgSQL + SQL functions, `@immich/sql-tools` `registerFunction`/`@AfterInsertTrigger`, Kysely migration, Vitest medium tests.

**Spec:** `docs/superpowers/specs/2026-06-15-space-albums-phase2a-server-sync-design.md` §5.1 (`user_has_album_path`), §5.2 (create-side triggers), §11 (A2).

**Depends on A1 (committed):** `shared_space_album_user` grant table exists. **Scope guard:** NO delete-side fan-out, NO consumer trigger, NO audit-writing (A3). NO sync read logic (A4). This slice only GRANTS (create-side) + the shared path function.

---

## File Structure

- Modify: `server/src/schema/functions.ts` — add three `registerFunction` exports: `user_has_album_path`, `shared_space_album_after_insert_user`, `shared_space_member_after_insert_album`.
- Modify: `server/src/schema/tables/shared-space-album.table.ts` — add `@AfterInsertTrigger(shared_space_album_after_insert_user)`.
- Modify: `server/src/schema/tables/shared-space-member.table.ts` — add a 3rd `@AfterInsertTrigger(shared_space_member_after_insert_album)`.
- Create: `server/src/schema/migrations-gallery/1779100000000-AddSharedSpaceAlbumCreateSideTriggers.ts` — `up()` creates the function + 2 trigger-functions + 2 triggers + 5 `migration_overrides` rows (1 function-override for `user_has_album_path`, plus 2× function+trigger overrides); `down()` reverses all.
- Create: `server/test/medium/specs/sync/user-has-album-path.spec.ts` — per-branch function tests (mirror `user-has-library-path.spec.ts`).
- Create: `server/test/medium/specs/sync/shared-space-album-create-triggers.spec.ts` — create-side grant fan-out + dedup + `updateId` bump (mirror `library-user-triggers.spec.ts`).

> **Run-command note:** scope medium tests with `pnpm test:medium <path>` (NOT `-- --run <path>`, which runs the whole suite).

---

### Task 1: `user_has_album_path()` — RED → GREEN

**Files:**

- Test: `server/test/medium/specs/sync/user-has-album-path.spec.ts`
- Modify: `server/src/schema/functions.ts`
- Create (start): `server/src/schema/migrations-gallery/1779100000000-AddSharedSpaceAlbumCreateSideTriggers.ts`

- [ ] **Step 1: Write the failing test** (read `server/test/medium/specs/sync/user-has-library-path.spec.ts` first to copy its structure, helper names, and `getKyselyDB` usage)

The test must cover every branch of `user_has_album_path(albumId, userId, excludeSpaceId)`:

```ts
import { Kysely, sql } from 'kysely';
import { AlbumUserRole, SharedSpaceRole } from 'src/enum';
import { DB } from 'src/schema';
import { SyncTestContext } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let db: Kysely<DB>;
beforeAll(async () => {
  db = await getKyselyDB();
});

const hasPath = async (albumId: string, userId: string, excludeSpaceId: string) => {
  const res = await sql<{
    ok: boolean;
  }>`SELECT user_has_album_path(${albumId}::uuid, ${userId}::uuid, ${excludeSpaceId}::uuid) AS ok`.execute(db);
  return res.rows[0].ok;
};

const NIL = '00000000-0000-0000-0000-000000000000'; // a "no excluded space" sentinel

describe('user_has_album_path', () => {
  it('true via album ownership (deletedAt NULL)', async () => {
    const ctx = new SyncTestContext(db);
    const { user } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: user.id });
    expect(await hasPath(album.id, user.id, NIL)).toBe(true);
  });

  it('false when the owning album is soft-deleted', async () => {
    const ctx = new SyncTestContext(db);
    const { user } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: user.id });
    await db.updateTable('album').set({ deletedAt: new Date() }).where('id', '=', album.id).execute();
    // ownership branch requires deletedAt IS NULL; no other path exists
    expect(await hasPath(album.id, user.id, NIL)).toBe(false);
  });

  it('true via a manual album_user row of any role', async () => {
    const ctx = new SyncTestContext(db);
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    await db
      .insertInto('album_user')
      .values({ albumId: album.id, userId: viewer.id, role: AlbumUserRole.Viewer })
      .execute();
    expect(await hasPath(album.id, viewer.id, NIL)).toBe(true);
  });

  it('true via membership in another space that links the album (excluding the given space)', async () => {
    const ctx = new SyncTestContext(db);
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { space: s2 } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: s2.id, userId: member.id, role: SharedSpaceRole.Viewer });
    await db
      .insertInto('shared_space_album')
      .values({ spaceId: s2.id, albumId: album.id, addedById: owner.id })
      .execute();
    // exclude a DIFFERENT space → s2 path still counts
    expect(await hasPath(album.id, member.id, NIL)).toBe(true);
    // exclude s2 itself → that path is removed; member has no other path
    expect(await hasPath(album.id, member.id, s2.id)).toBe(false);
  });

  it('true via being the creator of another space that links the album', async () => {
    const ctx = new SyncTestContext(db);
    const { user: creator } = await ctx.newUser();
    const { user: albumOwner } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: albumOwner.id });
    const { space } = await ctx.newSharedSpace({ createdById: creator.id });
    await db
      .insertInto('shared_space_album')
      .values({ spaceId: space.id, albumId: album.id, addedById: creator.id })
      .execute();
    expect(await hasPath(album.id, creator.id, NIL)).toBe(true);
    expect(await hasPath(album.id, creator.id, space.id)).toBe(false);
  });

  it('false when the user has no path at all', async () => {
    const ctx = new SyncTestContext(db);
    const { user: stranger } = await ctx.newUser();
    const { user: owner } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    expect(await hasPath(album.id, stranger.id, NIL)).toBe(false);
  });
});
```

> Verify `ctx.newAlbum`, `ctx.newUser`, `ctx.newSharedSpace`, `ctx.newSharedSpaceMember` signatures against `test/medium.factory.ts` and `sync-album.spec.ts`/`sync-library.spec.ts`. Confirm the `album_user` role enum import path (`AlbumUserRole` from `src/enum`). Adjust calls to match — do not invent helpers.

- [ ] **Step 2: Run, verify RED**

Run: `cd server && pnpm test:medium test/medium/specs/sync/user-has-album-path.spec.ts`
Expected: FAIL — `function user_has_album_path(uuid, uuid, uuid) does not exist`.

- [ ] **Step 3: Add the `registerFunction` to `server/src/schema/functions.ts`** (mirror `user_has_library_path`; add the `album_user` branch)

```ts
export const user_has_album_path = registerFunction({
  name: 'user_has_album_path',
  arguments: ['target_album_id uuid', 'target_user_id uuid', 'exclude_space_id uuid'],
  returnType: 'boolean',
  language: 'SQL',
  behavior: 'stable',
  body: `
    SELECT
      EXISTS (
        SELECT 1 FROM album a
        WHERE a."id" = target_album_id
          AND a."ownerId" = target_user_id
          AND a."deletedAt" IS NULL
      )
      OR EXISTS (
        SELECT 1 FROM album_user au
        WHERE au."albumId" = target_album_id
          AND au."userId" = target_user_id
      )
      OR EXISTS (
        SELECT 1
        FROM shared_space_album ssa2
        INNER JOIN shared_space_member ssm2 ON ssm2."spaceId" = ssa2."spaceId"
        WHERE ssa2."albumId" = target_album_id
          AND ssm2."userId" = target_user_id
          AND ssa2."spaceId" <> exclude_space_id
      )
      OR EXISTS (
        SELECT 1
        FROM shared_space_album ssa3
        INNER JOIN shared_space ss3 ON ss3."id" = ssa3."spaceId"
        WHERE ssa3."albumId" = target_album_id
          AND ss3."createdById" = target_user_id
          AND ssa3."spaceId" <> exclude_space_id
      );
`,
});
```

- [ ] **Step 4: Start the migration — create `user_has_album_path`** in `server/src/schema/migrations-gallery/1779100000000-AddSharedSpaceAlbumCreateSideTriggers.ts`

`up()` (this task adds the function; Task 2 appends the triggers to the same file). Follow the `migration_overrides` escaping pattern EXACTLY as in `1778300000000-AddLibraryUserTable.ts` (escape `\n`→`\\n`, `"`→`\\"`). The `migration_overrides` `value.sql` must be the canonical form sql-tools generates from the `registerFunction` above — the schema-diff guard (Task 3) FAILS if they differ, which is your verification.

```ts
import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE OR REPLACE FUNCTION user_has_album_path(target_album_id uuid, target_user_id uuid, exclude_space_id uuid)
  RETURNS boolean
  LANGUAGE SQL
  STABLE
  AS $$
    SELECT
      EXISTS (
        SELECT 1 FROM album a
        WHERE a."id" = target_album_id AND a."ownerId" = target_user_id AND a."deletedAt" IS NULL
      )
      OR EXISTS (
        SELECT 1 FROM album_user au
        WHERE au."albumId" = target_album_id AND au."userId" = target_user_id
      )
      OR EXISTS (
        SELECT 1 FROM shared_space_album ssa2
        INNER JOIN shared_space_member ssm2 ON ssm2."spaceId" = ssa2."spaceId"
        WHERE ssa2."albumId" = target_album_id AND ssm2."userId" = target_user_id AND ssa2."spaceId" <> exclude_space_id
      )
      OR EXISTS (
        SELECT 1 FROM shared_space_album ssa3
        INNER JOIN shared_space ss3 ON ss3."id" = ssa3."spaceId"
        WHERE ssa3."albumId" = target_album_id AND ss3."createdById" = target_user_id AND ssa3."spaceId" <> exclude_space_id
      );
  $$;`.execute(db);
  // migration_overrides for user_has_album_path — copy the canonical SQL form sql-tools
  // emits for the registerFunction above. Match the escaping pattern from 1778300000000.
  // (Task 3 schema-diff guard verifies this is byte-correct.)
  // ... INSERT INTO "migration_overrides" ('function_user_has_album_path', {...}) ...
}

export async function down(db: Kysely<any>): Promise<void> {
  // (Task 2 will prepend trigger drops here, before the function drop)
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'function_user_has_album_path';`.execute(db);
  await sql`DROP FUNCTION IF EXISTS user_has_album_path(uuid, uuid, uuid);`.execute(db);
}
```

> **How to get the `migration_overrides` byte-exact (do NOT hand-escape blind).** The fork's normal
> workflow auto-generates them: after adding the `registerFunction`(s) + decorators, run
> `pnpm migrations:generate` (needs a Postgres at `DB_URL`, default
> `postgres://postgres:postgres@localhost:5432/immich`; start `make dev` or point `DB_URL` at a throwaway
> DB with migrations applied). sql-tools emits a migration containing the canonical `CREATE …` SQL **and**
> the properly-escaped `migration_overrides` INSERTs. Lift those exact strings into the
> `1779100000000-…` migration (keep the round timestamp + the hand-written `down()`). If no DB is
> reachable, mirror `1778300000000`'s `function_*`/`trigger_*` JSON structure exactly and rely on the
> Task 3 drift check. The override's `value.sql` MUST equal the model's canonical SQL or `schema-check`
> reports drift.

- [ ] **Step 5: Run the test, verify GREEN**

Run: `cd server && pnpm test:medium test/medium/specs/sync/user-has-album-path.spec.ts`
Expected: PASS (6 cases).

- [ ] **Step 6: Commit**

```bash
git add server/src/schema/functions.ts \
        server/src/schema/migrations-gallery/1779100000000-AddSharedSpaceAlbumCreateSideTriggers.ts \
        server/test/medium/specs/sync/user-has-album-path.spec.ts
git commit -m "feat(spaces): add user_has_album_path() (Phase 2A slice A2)"
```

---

### Task 2: Create-side triggers — RED → GREEN

**Files:**

- Test: `server/test/medium/specs/sync/shared-space-album-create-triggers.spec.ts`
- Modify: `server/src/schema/functions.ts`
- Modify: `server/src/schema/tables/shared-space-album.table.ts`
- Modify: `server/src/schema/tables/shared-space-member.table.ts`
- Modify: `server/src/schema/migrations-gallery/1779100000000-AddSharedSpaceAlbumCreateSideTriggers.ts`

- [ ] **Step 1: Write the failing test** (mirror `library-user-triggers.spec.ts`)

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
const albumUpdateId = async (albumId: string) =>
  (await db.selectFrom('album').select('updateId').where('id', '=', albumId).executeTakeFirstOrThrow()).updateId;

describe('shared_space_album_after_insert_user (link → grant members)', () => {
  it('grants shared_space_album_user to every current member and bumps album.updateId', async () => {
    const ctx = new SyncTestContext(db);
    const { user: owner } = await ctx.newUser();
    const { user: m1 } = await ctx.newUser();
    const { user: m2 } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: m1.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: m2.id, role: SharedSpaceRole.Viewer });
    const before = await albumUpdateId(album.id);

    await db
      .insertInto('shared_space_album')
      .values({ spaceId: space.id, albumId: album.id, addedById: owner.id })
      .execute();

    const grants = await grantsFor(album.id);
    expect(new Set(grants.map((g) => g.userId))).toEqual(new Set([owner.id, m1.id, m2.id]));
    expect(grants.every((g) => g.createId)).toBe(true);
    expect(await albumUpdateId(album.id)).not.toEqual(before);
  });

  it('is idempotent on re-link (ON CONFLICT DO NOTHING — no duplicate grants)', async () => {
    const ctx = new SyncTestContext(db);
    const { user: owner } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await db
      .insertInto('shared_space_album')
      .values({ spaceId: space.id, albumId: album.id, addedById: owner.id })
      .onConflict((oc) => oc.doNothing())
      .execute();
    // a second (idempotent) insert attempt must not create duplicate grants
    await db
      .insertInto('shared_space_album')
      .values({ spaceId: space.id, albumId: album.id, addedById: owner.id })
      .onConflict((oc) => oc.doNothing())
      .execute();
    expect(await grantsFor(album.id)).toHaveLength(1);
  });
});

describe('shared_space_member_after_insert_album (join → grant linked albums)', () => {
  it('grants for every album already linked to the joined space and bumps each album.updateId', async () => {
    const ctx = new SyncTestContext(db);
    const { user: owner } = await ctx.newUser();
    const { user: joiner } = await ctx.newUser();
    const { album: a1 } = await ctx.newAlbum({ ownerId: owner.id });
    const { album: a2 } = await ctx.newAlbum({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await db
      .insertInto('shared_space_album')
      .values({ spaceId: space.id, albumId: a1.id, addedById: owner.id })
      .execute();
    await db
      .insertInto('shared_space_album')
      .values({ spaceId: space.id, albumId: a2.id, addedById: owner.id })
      .execute();
    const a1Before = await albumUpdateId(a1.id);

    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: joiner.id, role: SharedSpaceRole.Viewer });

    expect((await grantsFor(a1.id)).some((g) => g.userId === joiner.id)).toBe(true);
    expect((await grantsFor(a2.id)).some((g) => g.userId === joiner.id)).toBe(true);
    expect(await albumUpdateId(a1.id)).not.toEqual(a1Before);
  });

  it('no-ops when the joined space has no linked albums', async () => {
    const ctx = new SyncTestContext(db);
    const { user: owner } = await ctx.newUser();
    const { user: joiner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: joiner.id, role: SharedSpaceRole.Viewer });
    // nothing to assert beyond "no error"; the grant table stays empty for this space's (absent) albums
    expect(true).toBe(true);
  });
});
```

> If `ctx.newSharedSpaceMember` does not fire the trigger (e.g. it inserts via a path that bypasses statement triggers), insert the member row directly with `db.insertInto('shared_space_member')`. Check how `library-user-triggers.spec.ts` adds members and match it.

- [ ] **Step 2: Run, verify RED**

Run: `cd server && pnpm test:medium test/medium/specs/sync/shared-space-album-create-triggers.spec.ts`
Expected: FAIL — grants are empty / `updateId` unchanged (triggers don't exist yet).

- [ ] **Step 3: Add the two trigger functions to `server/src/schema/functions.ts`** (clone `shared_space_library_after_insert_user` / `shared_space_member_after_insert_library`, swap library→album, `shared_space_library`→`shared_space_album`)

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
      ON CONFLICT DO NOTHING;

      UPDATE album
      SET "updatedAt" = clock_timestamp(), "updateId" = immich_uuid_v7(clock_timestamp())
      WHERE "id" IN (SELECT DISTINCT "albumId" FROM inserted_rows);
      RETURN NULL;
    END`,
});

export const shared_space_member_after_insert_album = registerFunction({
  name: 'shared_space_member_after_insert_album',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    BEGIN
      INSERT INTO shared_space_album_user ("userId", "albumId")
      SELECT DISTINCT ir."userId", ssa."albumId"
      FROM inserted_rows ir
      INNER JOIN shared_space_album ssa ON ssa."spaceId" = ir."spaceId"
      ON CONFLICT DO NOTHING;

      UPDATE album
      SET "updatedAt" = clock_timestamp(), "updateId" = immich_uuid_v7(clock_timestamp())
      WHERE "id" IN (
        SELECT DISTINCT ssa."albumId"
        FROM inserted_rows ir
        INNER JOIN shared_space_album ssa ON ssa."spaceId" = ir."spaceId"
      );
      RETURN NULL;
    END`,
});
```

- [ ] **Step 4: Add the trigger decorators**

`server/src/schema/tables/shared-space-album.table.ts` — add the import and the decorator (after `@UpdatedAtTrigger`):

```ts
import { shared_space_album_after_insert_user } from 'src/schema/functions';
// ...
@AfterInsertTrigger({
  name: 'shared_space_album_after_insert_user',
  scope: 'statement',
  referencingNewTableAs: 'inserted_rows',
  function: shared_space_album_after_insert_user,
})
```

(Add `AfterInsertTrigger` to the `@immich/sql-tools` import list.)

`server/src/schema/tables/shared-space-member.table.ts` — add the import to the existing `from 'src/schema/functions'` block and a 3rd `@AfterInsertTrigger` (place it after `shared_space_member_after_insert_library` so alphabetical trigger order is `…_album` < `…_library`? — note: `album` < `library`, so name it to sort correctly; the library one is `shared_space_member_after_insert_library`. The new one `shared_space_member_after_insert_album` sorts BEFORE `_library` alphabetically — this is fine, both are independent statement triggers; place the decorator wherever, ordering of independent grant inserts does not matter):

```ts
import { shared_space_member_after_insert_album } from 'src/schema/functions';
// ...
@AfterInsertTrigger({
  name: 'shared_space_member_after_insert_album',
  scope: 'statement',
  referencingNewTableAs: 'inserted_rows',
  function: shared_space_member_after_insert_album,
})
```

- [ ] **Step 5: Add the CREATE FUNCTION/TRIGGER SQL + `migration_overrides` to the migration** (append to `1779100000000-…`'s `up()`, mirroring 1778300000000's blocks for these two triggers; prepend the trigger drops to `down()` BEFORE the function drop)

Append to `up()` (after the `user_has_album_path` block): the two `CREATE OR REPLACE FUNCTION` + `CREATE OR REPLACE TRIGGER` statements (the trigger on `shared_space_album` AFTER INSERT REFERENCING NEW TABLE AS inserted_rows FOR EACH STATEMENT; the trigger on `shared_space_member` likewise), plus four `migration_overrides` rows (function + trigger for each). Copy the escaping pattern verbatim from `1778300000000-AddLibraryUserTable.ts` lines 95–133.

`down()` (full, replacing the Task-1 stub):

```ts
export async function down(db: Kysely<any>): Promise<void> {
  await sql`DELETE FROM "migration_overrides" WHERE "name" IN (
    'function_user_has_album_path',
    'function_shared_space_album_after_insert_user',
    'trigger_shared_space_album_after_insert_user',
    'function_shared_space_member_after_insert_album',
    'trigger_shared_space_member_after_insert_album'
  );`.execute(db);
  await sql`DROP TRIGGER IF EXISTS "shared_space_member_after_insert_album" ON "shared_space_member";`.execute(db);
  await sql`DROP FUNCTION IF EXISTS shared_space_member_after_insert_album();`.execute(db);
  await sql`DROP TRIGGER IF EXISTS "shared_space_album_after_insert_user" ON "shared_space_album";`.execute(db);
  await sql`DROP FUNCTION IF EXISTS shared_space_album_after_insert_user();`.execute(db);
  await sql`DROP FUNCTION IF EXISTS user_has_album_path(uuid, uuid, uuid);`.execute(db);
}
```

- [ ] **Step 6: Run the test, verify GREEN**

Run: `cd server && pnpm test:medium test/medium/specs/sync/shared-space-album-create-triggers.spec.ts`
Expected: PASS (4 cases). Also re-run Task 1's spec to confirm no regression.

- [ ] **Step 7: Commit**

```bash
git add server/src/schema/functions.ts \
        server/src/schema/tables/shared-space-album.table.ts \
        server/src/schema/tables/shared-space-member.table.ts \
        server/src/schema/migrations-gallery/1779100000000-AddSharedSpaceAlbumCreateSideTriggers.ts \
        server/test/medium/specs/sync/shared-space-album-create-triggers.spec.ts
git commit -m "feat(spaces): add create-side album grant triggers (Phase 2A slice A2)"
```

---

### Task 3: Schema-consistency gates

- [ ] **Step 1: tsc + schema-drift check (the real guard for `migration_overrides`)**

Run: `cd server && pnpm check`
Then check for schema drift between the decorator model and the migrations. The authoritative tool is
the `schema-check` command (`src/commands/schema-check.ts` → `CliService.schemaReport()` → `drift`), which
CI runs; locally, the equivalent is `pnpm migrations:generate` against a DB with all migrations applied —
**it must produce an EMPTY migration (no drift)**. If it emits any `CREATE/DROP FUNCTION|TRIGGER` or a
non-empty diff, the `migration_overrides` `value.sql` does not match the model — align it to the exact SQL
the tool prints and re-run until empty. The plain `pnpm check` + the gallery-copy spec do NOT catch this;
drift detection does. (If no DB is reachable locally, this gate is enforced by CI's schema-check, caught
during babysit — but prefer verifying locally.)

- [ ] **Step 2: Run the broader trigger/sync regression** (catch interaction with the existing library/space triggers)

Run: `cd server && pnpm test:medium test/medium/specs/sync/library-user-triggers.spec.ts test/medium/specs/sync/shared-space-album-user-migration.spec.ts`
Expected: PASS — the new member-insert trigger coexists with the existing library member-insert trigger; A1 still green.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A && git commit -m "fix(spaces): align A2 migration_overrides with schema model"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** §5.1 `user_has_album_path` (4 branches incl. `album_user`, `excludeSpaceId` gating) → Task 1. §5.2 `shared_space_album_after_insert_user` + `shared_space_member_after_insert_album` (grant fan-out + `updateId` bump) → Task 2. §11 A2 RED tests (per-branch path + create-side fan-out/dedup/bump) → Tasks 1–2. ✓
- **Scope:** No delete-side fan-out / consumer / audit-writing (A3). No sync read logic (A4). ✓
- **No placeholders:** all SQL/TS shown; the only deferred detail is the exact `migration_overrides` escaped JSON, which is explicitly delegated to "copy 1778300000000's pattern + verify via the Task 3 schema-diff guard" — a verification loop, not a TODO. ✓
- **Type/name consistency:** function name `user_has_album_path` and trigger names `shared_space_album_after_insert_user` / `shared_space_member_after_insert_album` are identical across functions.ts, decorators, migration, `down()`, and tests. Grant table `shared_space_album_user` matches A1. ✓
- **Dependency:** relies on A1's `shared_space_album_user` table + the Phase-1 `shared_space_album` table + `album.updateId` column (used by personal AlbumSync, confirmed present). ✓
