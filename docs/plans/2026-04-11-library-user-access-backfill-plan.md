# Library Access Backfill via `library_user` Table — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `library_user` denormalization table and four triggers so the sync stream correctly delivers library metadata and assets when a user gains access to a pre-existing library via a shared-space link (rejoin, first-time invite, or new link added to an existing space).

**Architecture:** New table populated via insert triggers on `library`, `shared_space_member`, and `shared_space_library`. Deletions consumed from the existing `library_audit` table via a new AFTER INSERT trigger. `LibrarySync.getCreatedAfter` queries `library_user` instead of `library`. Migration backfill preserves owner createIds and mints fresh ones for transitive access. Zero mobile changes.

**Tech Stack:** Postgres 14+, Kysely, NestJS, `@immich/sql-tools` schema decorators, Vitest (small + medium tests), Playwright/Vitest E2E.

**Design doc:** `docs/plans/2026-04-11-library-user-access-backfill-design.md` (READ THIS FIRST — it explains every trade-off and the full SQL bodies).

**Branch:** `fix/library-access-backfill` (this worktree). Do all work on this branch, one commit per task.

**Test runner shorthand:**

- Server unit/small tests: `cd server && pnpm test -- --run <path>`
- Server medium tests: `cd server && pnpm test:medium -- --run <path>`
- Server type check: `cd server && pnpm check`
- Schema check: `cd server && pnpm sync:open-api` NOT needed for schema-only work; the CI schema check is what validates table/trigger registration. Locally, run `cd server && pnpm check` which runs `tsc --noEmit` and validates the decorator metadata.

---

## Task 1: Migration file skeleton + CREATE TABLE

Create the migration file with just the table + indexes. No triggers yet — those come in later tasks. This keeps the first commit small and lets us verify the basic schema additions work before layering on trigger complexity.

**Files:**

- Create: `server/src/schema/migrations-gallery/1778300000000-AddLibraryUserTable.ts`

**Step 1: Create the migration file with up/down stubs**

```ts
import { Kysely, sql } from 'kysely';

// Adds the create-side mirror of library_audit: a denormalized (userId, libraryId)
// access-grant table with a per-user createId. Drives LibrarySync.getCreatedAfter
// so users gain access to pre-existing libraries via shared-space links correctly
// receive the library metadata and its asset backfill on next sync.
//
// See docs/plans/2026-04-11-library-user-access-backfill-design.md for the full
// design, trade-offs, and rationale.

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE "library_user" (
      "userId"    uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      "libraryId" uuid NOT NULL REFERENCES "library"(id) ON DELETE CASCADE,
      "createId"  uuid NOT NULL DEFAULT immich_uuid_v7(),
      "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
      PRIMARY KEY ("userId", "libraryId")
    );
  `.execute(db);

  // Hot-path index: LibrarySync.getCreatedAfter filters by userId then createId,
  // so a composite leading with userId lets the planner seek directly to the
  // user's slice and walk sorted. PK (userId, libraryId) doesn't serve this
  // query because it's ordered on the wrong column.
  await sql`CREATE INDEX "library_user_userId_createId_idx" ON "library_user" ("userId", "createId");`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS "library_user_userId_createId_idx";`.execute(db);
  await sql`DROP TABLE IF EXISTS "library_user";`.execute(db);
}
```

**Step 2: Run type check to confirm the file parses**

Run: `cd server && pnpm check 2>&1 | tail -10`

Expected: no TypeScript errors mentioning the new migration. (The decorator-based schema diff will still be unhappy because we haven't registered the table yet — that's Task 2.)

**Step 3: Commit**

```bash
git add server/src/schema/migrations-gallery/1778300000000-AddLibraryUserTable.ts
git commit -m "feat(server): add library_user migration skeleton"
```

---

## Task 2: Register `LibraryUserTable` decorator class

Add the Kysely table declaration that matches the migration. This is what `make sql` / CI schema check diffs against the DB. Without it, CI fails.

**Files:**

- Create: `server/src/schema/tables/library-user.table.ts`
- Modify: `server/src/schema/index.ts` (add import + register in the table list + add to the DB interface type)

**Step 1: Create the table class**

Pattern lifted from `server/src/schema/tables/shared-space-member.table.ts` but with only the columns we actually have (no `updateId`, no `updatedAt`, no `role`, no `showInTimeline`).

```ts
// server/src/schema/tables/library-user.table.ts
import { Column, CreateDateColumn, ForeignKeyColumn, Generated, Table, Timestamp } from '@immich/sql-tools';
import { CreateIdColumn } from 'src/decorators';
import { LibraryTable } from 'src/schema/tables/library.table';
import { UserTable } from 'src/schema/tables/user.table';

@Table('library_user')
export class LibraryUserTable {
  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', primary: true })
  userId!: string;

  @ForeignKeyColumn(() => LibraryTable, { onDelete: 'CASCADE', primary: true })
  libraryId!: string;

  @CreateIdColumn({ index: false })
  createId!: Generated<string>;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;
}
```

Note: `@CreateIdColumn({ index: false })` because we use a composite `(userId, createId)` index, not a standalone `createId` index. If the decorator library insists on a standalone index, override via the migration's raw SQL (Task 1 already creates the composite explicitly).

**Step 2: Register in `server/src/schema/index.ts`**

Add these edits in order:

1. **Import**: add `import { LibraryUserTable } from 'src/schema/tables/library-user.table';` near the other library table imports (around line 48–49).
2. **Tables array**: add `LibraryUserTable,` to the tables array (around line 124–125, next to `LibraryTable` and `LibraryAuditTable`).
3. **DB interface type**: add `library_user: LibraryUserTable;` to the DB interface (around line 243–244, next to `library` and `library_audit`).

**Step 3: Run type check**

Run: `cd server && pnpm check 2>&1 | tail -20`

Expected: no TypeScript errors. The schema diff (if checked) should now show that the registered table matches the migration's `CREATE TABLE`.

**Step 4: Commit**

```bash
git add server/src/schema/tables/library-user.table.ts server/src/schema/index.ts
git commit -m "feat(server): register LibraryUserTable in schema"
```

---

## Task 3: Failing test — `library_after_insert` trigger

Write the first trigger test BEFORE the trigger exists. This is the TDD gate: we verify the test fails for the right reason before writing implementation SQL.

**Files:**

- Create: `server/test/medium/specs/sync/library-user-triggers.spec.ts`

**Step 1: Create the medium test file with the first failing test**

```ts
import { LibraryRepository } from 'src/repositories/library.repository';
import { UserRepository } from 'src/repositories/user.repository';
import { newMediumService } from 'test/medium.factory';
import { defaultDatabase } from 'test/test-utils';

describe('library_user triggers', () => {
  describe('library_after_insert', () => {
    it('inserts a library_user row for the owner with library.createId', async () => {
      const { ctx } = await newMediumService({ repos: [LibraryRepository, UserRepository] });
      const { user } = await ctx.newUser();
      const { library } = await ctx.newLibrary({ ownerId: user.id });

      const rows = await defaultDatabase
        .selectFrom('library_user')
        .selectAll()
        .where('userId', '=', user.id)
        .where('libraryId', '=', library.id)
        .execute();

      expect(rows).toHaveLength(1);
      expect(rows[0].createId).toBe(library.createId);
      expect(rows[0].createdAt).toEqual(library.createdAt);
    });
  });
});
```

If `newMediumService` / `ctx.newLibrary` / `ctx.newUser` don't exist with those exact signatures, check `server/test/medium.factory.ts` and `server/test/medium/specs/sync/sync-library-asset.spec.ts` for the actual API. Adjust imports accordingly — this is a pattern-match task.

**Step 2: Run the test to verify it fails**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/sync/library-user-triggers.spec.ts 2>&1 | tail -15`

Expected: the test FAILS with `expected 1 to equal 0` or similar (the library_user table is empty because no trigger populates it yet). If it fails with "relation library_user does not exist", something is wrong with Task 1/2 — stop and fix before proceeding.

**Step 3: Commit the failing test**

```bash
git add server/test/medium/specs/sync/library-user-triggers.spec.ts
git commit -m "test(server): failing test for library_after_insert trigger"
```

---

## Task 4: Implement `library_after_insert` trigger

Add the trigger function + trigger to the migration. Run the test and watch it go green.

**Files:**

- Modify: `server/src/schema/migrations-gallery/1778300000000-AddLibraryUserTable.ts` (add function + trigger + migration_overrides)
- Modify: `server/src/schema/functions.ts` (register the function)
- Modify: `server/src/schema/tables/library-user.table.ts` (attach the trigger decorator)

**Step 1: Add the function to `server/src/schema/functions.ts`**

Add near the bottom, alongside the other library-related trigger functions (after `user_has_library_path`, around line 420):

```ts
export const library_after_insert = registerFunction({
  name: 'library_after_insert',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    BEGIN
      INSERT INTO library_user ("userId", "libraryId", "createId", "createdAt")
      SELECT "ownerId", "id", "createId", "createdAt"
      FROM inserted_rows
      WHERE "ownerId" IS NOT NULL AND "deletedAt" IS NULL
      ON CONFLICT DO NOTHING;
      RETURN NULL;
    END`,
});
```

**Step 2: Attach the trigger decorator to `LibraryUserTable`**

Wait — this is wrong. The trigger fires on INSERT to `library`, not `library_user`. Decorators go on the OBSERVED table. Attach it to `LibraryTable` instead, but that's an upstream file we shouldn't touch lightly.

Alternative: don't use a decorator. Write the trigger directly in the migration's `up()` function AND register it via `migration_overrides`. This is what `1778200000000-LibraryAuditTables.ts` does for triggers on shared_space / shared_space_library / shared_space_member. Follow that pattern.

Replace Step 2 with: no decorator change needed. Add to the migration directly in Step 3.

**Step 3: Add the CREATE FUNCTION + CREATE TRIGGER + migration_overrides to the migration's `up()`**

Append to `server/src/schema/migrations-gallery/1778300000000-AddLibraryUserTable.ts` up() body (after the CREATE INDEX):

```ts
// --- Create-side triggers ---

await sql`
  CREATE OR REPLACE FUNCTION library_after_insert()
  RETURNS TRIGGER
  LANGUAGE PLPGSQL
  AS $$
    BEGIN
      INSERT INTO library_user ("userId", "libraryId", "createId", "createdAt")
      SELECT "ownerId", "id", "createId", "createdAt"
      FROM inserted_rows
      WHERE "ownerId" IS NOT NULL AND "deletedAt" IS NULL
      ON CONFLICT DO NOTHING;
      RETURN NULL;
    END
  $$;
`.execute(db);

await sql`
  CREATE OR REPLACE TRIGGER "library_after_insert"
  AFTER INSERT ON "library"
  REFERENCING NEW TABLE AS "inserted_rows"
  FOR EACH STATEMENT
  EXECUTE FUNCTION library_after_insert();
`.execute(db);

// migration_overrides entries so sql-tools picks up the function and trigger
// during `pnpm migrations:run`. Pattern lifted from 1778200000000-LibraryAuditTables.ts.
await sql`
  INSERT INTO "migration_overrides" ("name", "value") VALUES (
    'function_library_after_insert',
    '{"type":"function","name":"library_after_insert","sql":"CREATE OR REPLACE FUNCTION library_after_insert()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      INSERT INTO library_user (\\"userId\\", \\"libraryId\\", \\"createId\\", \\"createdAt\\")\\n      SELECT \\"ownerId\\", \\"id\\", \\"createId\\", \\"createdAt\\"\\n      FROM inserted_rows\\n      WHERE \\"ownerId\\" IS NOT NULL AND \\"deletedAt\\" IS NULL\\n      ON CONFLICT DO NOTHING;\\n      RETURN NULL;\\n    END\\n  $$;"}'::jsonb
  );
`.execute(db);

await sql`
  INSERT INTO "migration_overrides" ("name", "value") VALUES (
    'trigger_library_after_insert',
    '{"type":"trigger","name":"library_after_insert","sql":"CREATE OR REPLACE TRIGGER \\"library_after_insert\\"\\n  AFTER INSERT ON \\"library\\"\\n  REFERENCING NEW TABLE AS \\"inserted_rows\\"\\n  FOR EACH STATEMENT\\n  EXECUTE FUNCTION library_after_insert();"}'::jsonb
  );
`.execute(db);
```

Mirror in `down()`:

```ts
await sql`DROP TRIGGER IF EXISTS "library_after_insert" ON "library";`.execute(db);
await sql`DROP FUNCTION IF EXISTS library_after_insert();`.execute(db);
await sql`DELETE FROM "migration_overrides" WHERE "name" IN ('function_library_after_insert', 'trigger_library_after_insert');`.execute(
  db,
);
```

**Step 4: Register the trigger function in `server/src/schema/functions.ts`**

This is the decorator-side half of the trigger definition so `pnpm check` / CI schema diff recognizes it. Add near the bottom:

```ts
export const library_after_insert = registerFunction({
  name: 'library_after_insert',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    BEGIN
      INSERT INTO library_user ("userId", "libraryId", "createId", "createdAt")
      SELECT "ownerId", "id", "createId", "createdAt"
      FROM inserted_rows
      WHERE "ownerId" IS NOT NULL AND "deletedAt" IS NULL
      ON CONFLICT DO NOTHING;
      RETURN NULL;
    END`,
});
```

**Step 5: Attach the trigger to `LibraryTable`**

Open `server/src/schema/tables/library.table.ts`. Add an `@AfterInsertTrigger` decorator on the class:

```ts
import { library_after_insert } from 'src/schema/functions';
// ... other imports ...

@Table('library')
// ... existing decorators ...
@AfterInsertTrigger({
  name: 'library_after_insert',
  scope: 'statement',
  referencingNewTableAs: 'inserted_rows',
  function: library_after_insert,
})
export class LibraryTable {
  // ... columns ...
}
```

Import `AfterInsertTrigger` from `@immich/sql-tools` if it isn't already.

**Step 6: Reset the test DB and re-run the trigger test**

The test DB needs to pick up the new migration. Depending on how `newMediumService` handles migrations (usually via testcontainers with a fresh DB per test), this may be automatic. If it's not, run:

```bash
cd server && pnpm test:medium -- --run test/medium/specs/sync/library-user-triggers.spec.ts 2>&1 | tail -15
```

Expected: the test now **PASSES**. If it still fails, double-check the trigger SQL — `inserted_rows` must be referenced from the trigger body exactly as written, and `REFERENCING NEW TABLE AS "inserted_rows"` must be in the CREATE TRIGGER clause.

**Step 7: Run `pnpm check` to verify schema registration is consistent**

Run: `cd server && pnpm check 2>&1 | tail -10`

Expected: no TypeScript errors. If the schema diff tool complains about a mismatch between the registered function body and the migration SQL, copy the exact body from the migration into `registerFunction`'s `body` field (they must match character-for-character after whitespace normalization).

**Step 8: Commit**

```bash
git add server/src/schema/migrations-gallery/1778300000000-AddLibraryUserTable.ts \
        server/src/schema/functions.ts \
        server/src/schema/tables/library.table.ts \
        server/test/medium/specs/sync/library-user-triggers.spec.ts
git commit -m "feat(server): library_after_insert trigger populates library_user for owners"
```

---

## Task 5: Additional `library_after_insert` edge-case tests

Pin the full semantics of the trigger with boundary cases. All tests should PASS on the first run since the trigger already exists.

**Files:**

- Modify: `server/test/medium/specs/sync/library-user-triggers.spec.ts`

**Step 1: Add the edge-case tests**

Inside the `describe('library_after_insert', ...)` block, add:

```ts
it('does not insert a library_user row when ownerId is NULL', async () => {
  const { ctx } = await newMediumService({ repos: [LibraryRepository] });
  // Insert a library with no owner (adjust the factory call to match reality;
  // may need to bypass the service layer and insert directly if the service
  // enforces ownerId NOT NULL).
  const row = await defaultDatabase
    .insertInto('library')
    .values({ name: 'orphan', ownerId: null })
    .returning(['id'])
    .executeTakeFirstOrThrow();

  const rows = await defaultDatabase.selectFrom('library_user').selectAll().where('libraryId', '=', row.id).execute();

  expect(rows).toHaveLength(0);
});

it('does not insert a library_user row when deletedAt is set at insert time', async () => {
  const { ctx } = await newMediumService({ repos: [LibraryRepository, UserRepository] });
  const { user } = await ctx.newUser();
  const row = await defaultDatabase
    .insertInto('library')
    .values({ name: 'already-deleted', ownerId: user.id, deletedAt: new Date() })
    .returning(['id'])
    .executeTakeFirstOrThrow();

  const rows = await defaultDatabase.selectFrom('library_user').selectAll().where('libraryId', '=', row.id).execute();

  expect(rows).toHaveLength(0);
});

it('inserts one library_user row per library when multiple libraries are created in one statement', async () => {
  const { ctx } = await newMediumService({ repos: [UserRepository] });
  const { user } = await ctx.newUser();

  // Bulk insert 5 libraries in a single statement via the kysely query builder
  const libraries = await defaultDatabase
    .insertInto('library')
    .values([
      { name: 'bulk-1', ownerId: user.id },
      { name: 'bulk-2', ownerId: user.id },
      { name: 'bulk-3', ownerId: user.id },
      { name: 'bulk-4', ownerId: user.id },
      { name: 'bulk-5', ownerId: user.id },
    ])
    .returning(['id', 'createId', 'createdAt'])
    .execute();

  expect(libraries).toHaveLength(5);

  const rows = await defaultDatabase.selectFrom('library_user').selectAll().where('userId', '=', user.id).execute();

  expect(rows).toHaveLength(5);
  // Each library_user row's createId must match its library's createId exactly.
  const byLibraryId = new Map(rows.map((r) => [r.libraryId, r]));
  for (const lib of libraries) {
    const userRow = byLibraryId.get(lib.id);
    expect(userRow).toBeDefined();
    expect(userRow!.createId).toBe(lib.createId);
  }
  // All 5 createIds must be distinct (verifies immich_uuid_v7 VOLATILE
  // per-row evaluation in both library row inserts and trigger copies)
  const uniqueCreateIds = new Set(rows.map((r) => r.createId));
  expect(uniqueCreateIds.size).toBe(5);
});
```

**Step 2: Run all library_after_insert tests**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/sync/library-user-triggers.spec.ts 2>&1 | tail -15`

Expected: 4 tests pass (1 from Task 3 + 3 new).

**Step 3: Commit**

```bash
git add server/test/medium/specs/sync/library-user-triggers.spec.ts
git commit -m "test(server): pin library_after_insert edge cases (null owner, soft-delete, bulk insert)"
```

---

## Task 6: Failing test — `shared_space_member_after_insert_library` trigger

**Files:**

- Modify: `server/test/medium/specs/sync/library-user-triggers.spec.ts`

**Step 1: Add the failing test inside a new describe block**

```ts
describe('shared_space_member_after_insert_library', () => {
  it('grants library_user for every library linked to the space the new member joined', async () => {
    const { ctx } = await newMediumService({
      repos: [LibraryRepository, UserRepository, SharedSpaceRepository],
    });
    const { user: owner } = await ctx.newUser();
    const { user: newMember } = await ctx.newUser();

    // Space owned by `owner`
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });

    // Three libraries, all owned by `owner`, all linked to the space
    const libraryA = (await ctx.newLibrary({ ownerId: owner.id })).library;
    const libraryB = (await ctx.newLibrary({ ownerId: owner.id })).library;
    const libraryC = (await ctx.newLibrary({ ownerId: owner.id })).library;
    await ctx.linkLibraryToSpace(space.id, libraryA.id);
    await ctx.linkLibraryToSpace(space.id, libraryB.id);
    await ctx.linkLibraryToSpace(space.id, libraryC.id);

    // Capture library.updateId BEFORE the trigger bumps them
    const beforeUpdateIds = await defaultDatabase
      .selectFrom('library')
      .select(['id', 'updateId'])
      .where('id', 'in', [libraryA.id, libraryB.id, libraryC.id])
      .execute();

    // Add newMember to the space → trigger fires
    await ctx.addSharedSpaceMember(space.id, newMember.id);

    // Each library should have a library_user row for newMember
    const rows = await defaultDatabase
      .selectFrom('library_user')
      .select(['libraryId', 'createId'])
      .where('userId', '=', newMember.id)
      .execute();

    expect(rows.map((r) => r.libraryId).sort()).toEqual([libraryA.id, libraryB.id, libraryC.id].sort());

    // The createIds should all be distinct and freshly-minted (not equal to library.createId)
    const uniqueCreateIds = new Set(rows.map((r) => r.createId));
    expect(uniqueCreateIds.size).toBe(3);

    // library.updateId should be bumped for all three libraries
    const afterUpdateIds = await defaultDatabase
      .selectFrom('library')
      .select(['id', 'updateId'])
      .where('id', 'in', [libraryA.id, libraryB.id, libraryC.id])
      .execute();
    const beforeById = new Map(beforeUpdateIds.map((r) => [r.id, r.updateId]));
    for (const after of afterUpdateIds) {
      expect(after.updateId).not.toBe(beforeById.get(after.id));
    }
  });
});
```

Factory helpers like `ctx.linkLibraryToSpace` and `ctx.addSharedSpaceMember` probably already exist — check `server/test/medium/specs/sync/sync-shared-space-library.spec.ts` or similar for the names. If they don't exist, add them to `test/medium.factory.ts` as part of this task.

**Step 2: Run the test, expect FAIL**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/sync/library-user-triggers.spec.ts -t "shared_space_member_after_insert_library" 2>&1 | tail -15`

Expected: the assertion `expect(rows.map(...)).toEqual(...)` fails because no rows are in library_user (no trigger yet). If it fails with a setup error (unknown factory method), fix the setup before proceeding.

**Step 3: Commit the failing test**

```bash
git add server/test/medium/specs/sync/library-user-triggers.spec.ts
git commit -m "test(server): failing test for shared_space_member_after_insert_library trigger"
```

---

## Task 7: Implement `shared_space_member_after_insert_library` trigger

**Files:**

- Modify: `server/src/schema/migrations-gallery/1778300000000-AddLibraryUserTable.ts`
- Modify: `server/src/schema/functions.ts`
- Modify: `server/src/schema/tables/shared-space-member.table.ts` (attach the new trigger)

**Step 1: Add function + trigger to the migration up() (after the library_after_insert block)**

```ts
await sql`
  CREATE OR REPLACE FUNCTION shared_space_member_after_insert_library()
  RETURNS TRIGGER
  LANGUAGE PLPGSQL
  AS $$
    BEGIN
      INSERT INTO library_user ("userId", "libraryId")
      SELECT DISTINCT ir."userId", ssl."libraryId"
      FROM inserted_rows ir
      INNER JOIN shared_space_library ssl ON ssl."spaceId" = ir."spaceId"
      ON CONFLICT DO NOTHING;

      UPDATE library
      SET "updatedAt" = clock_timestamp(), "updateId" = immich_uuid_v7(clock_timestamp())
      WHERE "id" IN (
        SELECT DISTINCT ssl."libraryId"
        FROM inserted_rows ir
        INNER JOIN shared_space_library ssl ON ssl."spaceId" = ir."spaceId"
      );
      RETURN NULL;
    END
  $$;
`.execute(db);

await sql`
  CREATE OR REPLACE TRIGGER "shared_space_member_after_insert_library"
  AFTER INSERT ON "shared_space_member"
  REFERENCING NEW TABLE AS "inserted_rows"
  FOR EACH STATEMENT
  EXECUTE FUNCTION shared_space_member_after_insert_library();
`.execute(db);
```

Plus the corresponding `migration_overrides` entries for the function and trigger (same pattern as Task 4 — encode the SQL as a JSON-escaped string). And mirror the drops in `down()`.

**Step 2: Register the function in `server/src/schema/functions.ts`**

```ts
export const shared_space_member_after_insert_library = registerFunction({
  name: 'shared_space_member_after_insert_library',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    BEGIN
      INSERT INTO library_user ("userId", "libraryId")
      SELECT DISTINCT ir."userId", ssl."libraryId"
      FROM inserted_rows ir
      INNER JOIN shared_space_library ssl ON ssl."spaceId" = ir."spaceId"
      ON CONFLICT DO NOTHING;

      UPDATE library
      SET "updatedAt" = clock_timestamp(), "updateId" = immich_uuid_v7(clock_timestamp())
      WHERE "id" IN (
        SELECT DISTINCT ssl."libraryId"
        FROM inserted_rows ir
        INNER JOIN shared_space_library ssl ON ssl."spaceId" = ir."spaceId"
      );
      RETURN NULL;
    END`,
});
```

**Step 3: Attach the trigger decorator to `SharedSpaceMemberTable`**

In `server/src/schema/tables/shared-space-member.table.ts`, add a new `@AfterInsertTrigger` decorator (sibling of the existing `shared_space_member_after_insert`):

```ts
import {
  shared_space_member_after_insert,
  shared_space_member_after_insert_library, // new
  // ... existing imports
} from 'src/schema/functions';

@Table('shared_space_member')
// ... existing decorators ...
@AfterInsertTrigger({
  name: 'shared_space_member_after_insert',
  // ... existing ...
})
// New: populate library_user + bump library.updateId for every library linked
// to the space the new member joined. See docs/plans/2026-04-11-library-user-access-backfill-design.md.
@AfterInsertTrigger({
  name: 'shared_space_member_after_insert_library',
  scope: 'statement',
  referencingNewTableAs: 'inserted_rows',
  function: shared_space_member_after_insert_library,
})
// ... rest ...
export class SharedSpaceMemberTable {
  /* ... */
}
```

**Step 4: Run the test**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/sync/library-user-triggers.spec.ts -t "shared_space_member_after_insert_library" 2>&1 | tail -15`

Expected: the test PASSES.

**Step 5: Run `pnpm check`**

Run: `cd server && pnpm check 2>&1 | tail -10`

Expected: no errors.

**Step 6: Commit**

```bash
git add server/src/schema/migrations-gallery/1778300000000-AddLibraryUserTable.ts \
        server/src/schema/functions.ts \
        server/src/schema/tables/shared-space-member.table.ts \
        server/test/medium/specs/sync/library-user-triggers.spec.ts
git commit -m "feat(server): shared_space_member_after_insert_library trigger"
```

---

## Task 8: Additional `shared_space_member_after_insert_library` edge-case tests

**Files:**

- Modify: `server/test/medium/specs/sync/library-user-triggers.spec.ts`

**Step 1: Add these tests inside the describe block**

```ts
it('is a no-op when the space has zero linked libraries', async () => {
  const { ctx } = await newMediumService({ repos: [UserRepository, SharedSpaceRepository] });
  const { user: owner } = await ctx.newUser();
  const { user: newMember } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: owner.id });
  // No libraries linked.

  await ctx.addSharedSpaceMember(space.id, newMember.id);

  const rows = await defaultDatabase
    .selectFrom('library_user')
    .selectAll()
    .where('userId', '=', newMember.id)
    .execute();
  expect(rows).toHaveLength(0);
});

it('ON CONFLICT DO NOTHING preserves an existing owner library_user row', async () => {
  const { ctx } = await newMediumService({
    repos: [LibraryRepository, UserRepository, SharedSpaceRepository],
  });
  const { user } = await ctx.newUser();
  const { library } = await ctx.newLibrary({ ownerId: user.id });

  // Owner already has a library_user row from library_after_insert,
  // with createId = library.createId
  const ownerRowBefore = await defaultDatabase
    .selectFrom('library_user')
    .select(['createId'])
    .where('userId', '=', user.id)
    .where('libraryId', '=', library.id)
    .executeTakeFirstOrThrow();
  expect(ownerRowBefore.createId).toBe(library.createId);

  // User joins a space that also links their own library
  const { space } = await ctx.newSharedSpace({ createdById: user.id });
  await ctx.linkLibraryToSpace(space.id, library.id);
  // Owner was auto-added as member on newSharedSpace; re-adding them would
  // be a duplicate. Use a fresh user instead.
  const { user: peer } = await ctx.newUser();
  await ctx.addSharedSpaceMember(space.id, peer.id);

  // Owner's row is unchanged (still has library.createId)
  const ownerRowAfter = await defaultDatabase
    .selectFrom('library_user')
    .select(['createId'])
    .where('userId', '=', user.id)
    .where('libraryId', '=', library.id)
    .executeTakeFirstOrThrow();
  expect(ownerRowAfter.createId).toBe(library.createId);
});
```

**Step 2: Run tests**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/sync/library-user-triggers.spec.ts 2>&1 | tail -15`

Expected: all tests pass.

**Step 3: Commit**

```bash
git add server/test/medium/specs/sync/library-user-triggers.spec.ts
git commit -m "test(server): pin shared_space_member trigger edge cases"
```

---

## Task 9: Failing test + implementation — `shared_space_library_after_insert_user` trigger

Bundled task because the pattern mirrors Task 6+7.

**Files:**

- Modify: `server/test/medium/specs/sync/library-user-triggers.spec.ts`
- Modify: `server/src/schema/migrations-gallery/1778300000000-AddLibraryUserTable.ts`
- Modify: `server/src/schema/functions.ts`
- Modify: `server/src/schema/tables/shared-space-library.table.ts`

**Step 1: Add the failing test**

```ts
describe('shared_space_library_after_insert_user', () => {
  it('grants library_user for every member of the space when a library is linked', async () => {
    const { ctx } = await newMediumService({
      repos: [LibraryRepository, UserRepository, SharedSpaceRepository],
    });
    const { user: owner } = await ctx.newUser();
    const { user: memberA } = await ctx.newUser();
    const { user: memberB } = await ctx.newUser();

    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.addSharedSpaceMember(space.id, memberA.id);
    await ctx.addSharedSpaceMember(space.id, memberB.id);

    const { library } = await ctx.newLibrary({ ownerId: owner.id });

    // Capture library.updateId before the trigger bumps it
    const before = await defaultDatabase
      .selectFrom('library')
      .select(['updateId'])
      .where('id', '=', library.id)
      .executeTakeFirstOrThrow();

    await ctx.linkLibraryToSpace(space.id, library.id);

    // memberA and memberB should get library_user rows
    const rows = await defaultDatabase
      .selectFrom('library_user')
      .select(['userId'])
      .where('libraryId', '=', library.id)
      .execute();

    const userIds = rows.map((r) => r.userId).sort();
    // owner was already in library_user via library_after_insert + is also
    // a space member, but ON CONFLICT preserves their existing row
    expect(userIds).toContain(owner.id);
    expect(userIds).toContain(memberA.id);
    expect(userIds).toContain(memberB.id);

    // library.updateId was bumped
    const after = await defaultDatabase
      .selectFrom('library')
      .select(['updateId'])
      .where('id', '=', library.id)
      .executeTakeFirstOrThrow();
    expect(after.updateId).not.toBe(before.updateId);
  });

  it('bumps library.updateId even when the space has zero members (covers empty-members edge)', async () => {
    // Hypothetical scenario since newSharedSpace always adds the creator as
    // a member, this might be impossible via the service layer. If so, use
    // direct SQL to bypass the creator-as-member invariant for the test.
    // (skipped if the factory doesn't expose a way)
  });
});
```

**Step 2: Run → expect fail on the first test**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/sync/library-user-triggers.spec.ts -t "shared_space_library_after_insert_user" 2>&1 | tail -15`

Expected: FAIL (memberA/memberB rows missing).

**Step 3: Add function + trigger + migration_overrides in the migration**

```ts
await sql`
  CREATE OR REPLACE FUNCTION shared_space_library_after_insert_user()
  RETURNS TRIGGER
  LANGUAGE PLPGSQL
  AS $$
    BEGIN
      INSERT INTO library_user ("userId", "libraryId")
      SELECT DISTINCT ssm."userId", ir."libraryId"
      FROM inserted_rows ir
      INNER JOIN shared_space_member ssm ON ssm."spaceId" = ir."spaceId"
      ON CONFLICT DO NOTHING;

      UPDATE library
      SET "updatedAt" = clock_timestamp(), "updateId" = immich_uuid_v7(clock_timestamp())
      WHERE "id" IN (SELECT DISTINCT "libraryId" FROM inserted_rows);
      RETURN NULL;
    END
  $$;
`.execute(db);

await sql`
  CREATE OR REPLACE TRIGGER "shared_space_library_after_insert_user"
  AFTER INSERT ON "shared_space_library"
  REFERENCING NEW TABLE AS "inserted_rows"
  FOR EACH STATEMENT
  EXECUTE FUNCTION shared_space_library_after_insert_user();
`.execute(db);
```

Plus matching `migration_overrides` entries. Mirror drops in `down()`.

**Step 4: Register in `functions.ts`** (same body as Step 3).

**Step 5: Attach decorator on `SharedSpaceLibraryTable`**

In `server/src/schema/tables/shared-space-library.table.ts`, add `@AfterInsertTrigger` with `function: shared_space_library_after_insert_user`.

**Step 6: Run test → expect PASS**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/sync/library-user-triggers.spec.ts -t "shared_space_library_after_insert_user" 2>&1 | tail -15`

Expected: PASS.

**Step 7: Run full trigger spec + check**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/sync/library-user-triggers.spec.ts 2>&1 | tail -20`
Run: `cd server && pnpm check 2>&1 | tail -10`

Expected: all tests pass, no type errors.

**Step 8: Commit**

```bash
git add server/src/schema/migrations-gallery/1778300000000-AddLibraryUserTable.ts \
        server/src/schema/functions.ts \
        server/src/schema/tables/shared-space-library.table.ts \
        server/test/medium/specs/sync/library-user-triggers.spec.ts
git commit -m "feat(server): shared_space_library_after_insert_user trigger"
```

---

## Task 10: Failing tests + implementation — `library_user_delete_after_audit` consumer trigger

This trigger is the delete-side counterpart. Bundled: failing tests, implementation, additional tests, commit.

**Files:**

- Modify: `server/test/medium/specs/sync/library-user-triggers.spec.ts`
- Modify: `server/src/schema/migrations-gallery/1778300000000-AddLibraryUserTable.ts`
- Modify: `server/src/schema/functions.ts`
- Modify: `server/src/schema/tables/library-audit.table.ts`

**Step 1: Write the failing tests inside a new describe block**

```ts
describe('library_user_delete_after_audit', () => {
  it('removes library_user when a member leaves a space and has no other path', async () => {
    const { ctx } = await newMediumService({
      /* relevant repos */
    });
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    const { library } = await ctx.newLibrary({ ownerId: owner.id });
    await ctx.linkLibraryToSpace(space.id, library.id);
    await ctx.addSharedSpaceMember(space.id, viewer.id);

    // Viewer has library access via the space path
    const before = await defaultDatabase
      .selectFrom('library_user')
      .selectAll()
      .where('userId', '=', viewer.id)
      .where('libraryId', '=', library.id)
      .execute();
    expect(before).toHaveLength(1);

    // Viewer leaves
    await ctx.removeSharedSpaceMember(space.id, viewer.id);

    const after = await defaultDatabase
      .selectFrom('library_user')
      .selectAll()
      .where('userId', '=', viewer.id)
      .where('libraryId', '=', library.id)
      .execute();
    expect(after).toHaveLength(0);
  });

  it('preserves library_user for the owner even when they leave a space that linked the library', async () => {
    const { ctx } = await newMediumService({
      /* ... */
    });
    const { user: owner } = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.linkLibraryToSpace(space.id, library.id);
    // Owner is auto-added as a member on space creation; leaving...
    // Actually the space creator can't leave their own space via the normal
    // service call — the creator is the owner of the space. Use a slightly
    // different setup: peer owner creates space and links a library they
    // also own, a different user (our "owner") is a space member AND owns
    // another library that's ALSO linked to the same space. Then the "owner"
    // leaves.
    // (exact setup depends on factory; adapt as needed)
  });

  it('defensive re-check: does NOT delete library_user when user_has_library_path is still true', async () => {
    // Setup: user owns library, and separately has library_audit row inserted
    // manually (bypassing the normal delete trigger chain). Since owner path
    // is still valid, user_has_library_path returns true → consumer trigger
    // must NOT delete library_user.
    const { ctx } = await newMediumService({
      /* ... */
    });
    const { user } = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: user.id });

    // Confirm the owner row exists
    const before = await defaultDatabase
      .selectFrom('library_user')
      .selectAll()
      .where('userId', '=', user.id)
      .where('libraryId', '=', library.id)
      .execute();
    expect(before).toHaveLength(1);

    // Manually insert into library_audit (bypassing gated triggers)
    await defaultDatabase.insertInto('library_audit').values({ libraryId: library.id, userId: user.id }).execute();

    // Defensive clause must have protected the row
    const after = await defaultDatabase
      .selectFrom('library_user')
      .selectAll()
      .where('userId', '=', user.id)
      .where('libraryId', '=', library.id)
      .execute();
    expect(after).toHaveLength(1);
  });

  it('hard-deleting a library removes library_user rows via FK cascade (no library_audit involvement)', async () => {
    const { ctx } = await newMediumService({
      /* ... */
    });
    const { user } = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: user.id });

    // library_user exists via library_after_insert
    const before = await defaultDatabase
      .selectFrom('library_user')
      .selectAll()
      .where('libraryId', '=', library.id)
      .execute();
    expect(before).toHaveLength(1);

    // Capture library_audit state before delete
    const auditBefore = await defaultDatabase
      .selectFrom('library_audit')
      .selectAll()
      .where('libraryId', '=', library.id)
      .execute();

    await defaultDatabase.deleteFrom('library').where('id', '=', library.id).execute();

    // library_user is gone via FK cascade
    const after = await defaultDatabase
      .selectFrom('library_user')
      .selectAll()
      .where('libraryId', '=', library.id)
      .execute();
    expect(after).toHaveLength(0);

    // library_audit has NO new rows (hard-delete bypasses the audit chain)
    const auditAfter = await defaultDatabase
      .selectFrom('library_audit')
      .selectAll()
      .where('libraryId', '=', library.id)
      .execute();
    expect(auditAfter).toHaveLength(auditBefore.length);
  });
});
```

**Step 2: Run → expect fail**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/sync/library-user-triggers.spec.ts -t "library_user_delete_after_audit" 2>&1 | tail -20`

Expected: the first three tests fail (the fourth — FK cascade — would actually pass right now because FK cascade is already declared on the table). The first test might fail because the existing delete chain inserts into library_audit but nothing deletes from library_user.

**Step 3: Add function + trigger + overrides in migration**

```ts
await sql`
  CREATE OR REPLACE FUNCTION library_user_delete_after_audit()
  RETURNS TRIGGER
  LANGUAGE PLPGSQL
  AS $$
    BEGIN
      DELETE FROM library_user lu
      USING inserted_rows ir
      WHERE lu."userId" = ir."userId"
        AND lu."libraryId" = ir."libraryId"
        AND NOT user_has_library_path(lu."libraryId", lu."userId", NULL);
      RETURN NULL;
    END
  $$;
`.execute(db);

await sql`
  CREATE OR REPLACE TRIGGER "library_user_delete_after_audit"
  AFTER INSERT ON "library_audit"
  REFERENCING NEW TABLE AS "inserted_rows"
  FOR EACH STATEMENT
  EXECUTE FUNCTION library_user_delete_after_audit();
`.execute(db);
```

Plus `migration_overrides` + `down()` drops.

**Step 4: Register in `functions.ts`**

```ts
export const library_user_delete_after_audit = registerFunction({
  name: 'library_user_delete_after_audit',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    BEGIN
      DELETE FROM library_user lu
      USING inserted_rows ir
      WHERE lu."userId" = ir."userId"
        AND lu."libraryId" = ir."libraryId"
        AND NOT user_has_library_path(lu."libraryId", lu."userId", NULL);
      RETURN NULL;
    END`,
});
```

**Step 5: Attach the decorator to `LibraryAuditTable`**

```ts
// server/src/schema/tables/library-audit.table.ts
import { AfterInsertTrigger } from '@immich/sql-tools';
import { library_user_delete_after_audit } from 'src/schema/functions';

@Table('library_audit')
// ... existing decorators ...
@AfterInsertTrigger({
  name: 'library_user_delete_after_audit',
  scope: 'statement',
  referencingNewTableAs: 'inserted_rows',
  function: library_user_delete_after_audit,
})
export class LibraryAuditTable {
  /* ... */
}
```

**Step 6: Run all tests in the spec**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/sync/library-user-triggers.spec.ts 2>&1 | tail -25`

Expected: every test passes.

**Step 7: Run `pnpm check`**

Run: `cd server && pnpm check 2>&1 | tail -10`

**Step 8: Commit**

```bash
git add server/src/schema/migrations-gallery/1778300000000-AddLibraryUserTable.ts \
        server/src/schema/functions.ts \
        server/src/schema/tables/library-audit.table.ts \
        server/test/medium/specs/sync/library-user-triggers.spec.ts
git commit -m "feat(server): library_user_delete_after_audit consumer trigger + defensive re-check"
```

---

## Task 11: Failing tests + implementation — migration backfill

Write the migration backfill passes and the tests that verify their correctness. Done as one task because the backfill is a single transaction in the migration file and the tests are tightly coupled.

**Files:**

- Create: `server/test/medium/specs/sync/library-user-migration.spec.ts`
- Modify: `server/src/schema/migrations-gallery/1778300000000-AddLibraryUserTable.ts`

**Step 1: Write the failing tests**

Migration tests are tricky because by the time the test suite runs, the migration has already been applied. The test needs to seed pre-migration state, then explicitly invoke the backfill SQL, then assert.

```ts
import { sql } from 'kysely';
import { defaultDatabase } from 'test/test-utils';

describe('library_user migration backfill', () => {
  // These tests manipulate library_user directly, so clean up after each.
  afterEach(async () => {
    await defaultDatabase.deleteFrom('library_user').execute();
  });

  it('owner rows use library.createId (Pass 1)', async () => {
    // Seed: create user + library via direct SQL, leave the library_after_insert
    // trigger to populate library_user at insert time. Delete the triggered row
    // and re-run the backfill INSERT manually — verify the Pass 1 SQL produces
    // the same row.
    //
    // Simpler alternative: disable the trigger temporarily for this test, insert
    // the library, then run the backfill. Or: just assert that the row created
    // by the trigger has createId = library.createId (which the trigger test
    // already covers). This test is more about the migration SQL as a string.
    //
    // Actual test: run Pass 1 SQL in isolation against a small seeded state.
    const { user } = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: user.id });

    // Clear what the trigger inserted
    await defaultDatabase.deleteFrom('library_user').execute();

    // Run Pass 1 SQL
    await sql`
      INSERT INTO library_user ("userId", "libraryId", "createId", "createdAt")
      SELECT "ownerId", "id", "createId", "createdAt"
      FROM library
      WHERE "ownerId" IS NOT NULL AND "deletedAt" IS NULL
      ON CONFLICT ("userId", "libraryId") DO NOTHING;
    `.execute(defaultDatabase);

    const row = await defaultDatabase
      .selectFrom('library_user')
      .selectAll()
      .where('userId', '=', user.id)
      .executeTakeFirstOrThrow();
    expect(row.createId).toBe(library.createId);
    expect(row.createdAt).toEqual(library.createdAt);
  });

  it('transitive rows use fresh createId (Pass 2)', async () => {
    // Setup a user who has transitive access, simulate a stale state by
    // clearing library_user, then run Pass 2 and verify createId is fresh.
    // (details elided — same pattern)
  });

  it('Pass 2 preserves owner rows via ON CONFLICT DO NOTHING', async () => {
    // User owns library AND is in a space that links it. Run Pass 1 then
    // Pass 2. Assert only ONE row and its createId equals library.createId.
  });

  it('is idempotent: re-running both passes is a no-op', async () => {
    // Run Pass 1 + Pass 2. Capture state. Run them again. Assert state
    // unchanged.
  });

  it('includes soft-deleted libraries in Pass 2 when linked to a space (mirrors accessibleLibraries)', async () => {
    // ...
  });

  it('skips soft-deleted libraries in Pass 1 (owned path)', async () => {
    // ...
  });
});
```

**Step 2: Run → expect fail** (because the backfill SQL doesn't exist in the migration yet and the tests reference it as an isolated block).

Actually wait — the tests above run the backfill SQL inline, not via the migration. So they test the SQL string itself. The failing-state here is that without the TRIGGER being disabled, Pass 1 + Pass 2 would try to populate rows already populated by triggers. The `ON CONFLICT DO NOTHING` handles that. So the tests actually should pass as soon as the SQL is correct — they test the SQL, not the migration's execution order.

Modify the TDD flow: write the test, run it, it may pass already if the triggers + inline SQL work together. Then add the backfill SQL to the migration file so it runs for real during migration execution.

**Step 3: Add Pass 1 + Pass 2 to the migration `up()` (after the triggers are created so any seed data gets backfilled correctly)**

```ts
// --- Backfill pass 1: owned libraries inherit library.createId so existing
// synced clients don't re-backfill libraries they already have.
await sql`
  INSERT INTO library_user ("userId", "libraryId", "createId", "createdAt")
  SELECT "ownerId", "id", "createId", "createdAt"
  FROM library
  WHERE "ownerId" IS NOT NULL AND "deletedAt" IS NULL
  ON CONFLICT ("userId", "libraryId") DO NOTHING;
`.execute(db);

// --- Backfill pass 2: transitive access via shared_space_library with fresh
// createIds so users in the broken state get their missing libraries
// re-delivered on next sync. Soft-deleted libraries deliberately included —
// matches accessibleLibraries's space-link branch behavior.
await sql`
  INSERT INTO library_user ("userId", "libraryId")
  SELECT DISTINCT ssm."userId", ssl."libraryId"
  FROM shared_space_library ssl
  INNER JOIN shared_space_member ssm ON ssl."spaceId" = ssm."spaceId"
  ON CONFLICT ("userId", "libraryId") DO NOTHING;
`.execute(db);
```

**Step 4: Run all migration tests + all trigger tests to make sure nothing regressed**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/sync/library-user-migration.spec.ts 2>&1 | tail -20`
Run: `cd server && pnpm test:medium -- --run test/medium/specs/sync/library-user-triggers.spec.ts 2>&1 | tail -20`

Expected: all tests pass.

**Step 5: Commit**

```bash
git add server/src/schema/migrations-gallery/1778300000000-AddLibraryUserTable.ts \
        server/test/medium/specs/sync/library-user-migration.spec.ts
git commit -m "feat(server): migration backfill populates library_user from existing state"
```

---

## Task 12: Failing unit tests for `LibrarySync.getCreatedAfter`

Before rewriting the query, write the new expected behavior as unit tests. This pins the set-equality invariant and soft-delete behavior.

**Files:**

- Modify: `server/src/repositories/sync.repository.spec.ts` (or create a new focused spec file)

**Step 1: Add the failing tests**

```ts
describe('LibrarySync.getCreatedAfter', () => {
  it('returns libraries the user owns', async () => {
    // Setup via repo
    const { user } = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: user.id });
    // (trigger populates library_user automatically)

    const rows = await sut.getCreatedAfter({ nowId: dummyNowId, userId: user.id, afterCreateId: undefined });
    expect(rows.map((r) => r.id)).toContain(library.id);
  });

  it('returns libraries the user accesses via shared_space_library', async () => {
    /* similar */
  });

  it('returns empty for a user with no library access', async () => {
    /* similar */
  });

  it('filters by afterCreateId', async () => {
    /* two libraries, check that only the one >= afterCreateId is returned */
  });

  it('orders by createId ascending', async () => {
    /* seed 3 libraries with known createIds, assert order */
  });

  it('excludes a soft-deleted owned library when the user has no space-linked path', async () => {
    const { user } = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: user.id });
    // Soft-delete
    await defaultDatabase.updateTable('library').set({ deletedAt: new Date() }).where('id', '=', library.id).execute();

    const rows = await sut.getCreatedAfter({ nowId: dummyNowId, userId: user.id, afterCreateId: undefined });
    expect(rows.find((r) => r.id === library.id)).toBeUndefined();
  });

  it('includes a soft-deleted library when the user has a space-linked path to it', async () => {
    /* owner, stranger, space, linked library, soft-delete via owner,
       assert stranger still sees it */
  });

  it('set equality with accessibleLibraries', async () => {
    // Seed a user with a mix of owned, owned+soft-deleted, owned+space-linked,
    // and transitive libraries. Query both getCreatedAfter(afterCreateId=null)
    // and accessibleLibraries. Assert the set of libraryIds matches.
    const { user } = await ctx.newUser();
    const { library: owned } = await ctx.newLibrary({ ownerId: user.id });
    const { library: softDeleted } = await ctx.newLibrary({ ownerId: user.id });
    await defaultDatabase
      .updateTable('library')
      .set({ deletedAt: new Date() })
      .where('id', '=', softDeleted.id)
      .execute();

    const { user: peer } = await ctx.newUser();
    const { library: transitive } = await ctx.newLibrary({ ownerId: peer.id });
    const { space } = await ctx.newSharedSpace({ createdById: peer.id });
    await ctx.linkLibraryToSpace(space.id, transitive.id);
    await ctx.addSharedSpaceMember(space.id, user.id);

    const getCreatedAfterIds = new Set(
      (await sut.getCreatedAfter({ nowId: dummyNowId, userId: user.id, afterCreateId: undefined })).map((r) => r.id),
    );
    const accessibleIds = new Set(
      (
        await defaultDatabase
          .selectFrom('library')
          .select('id')
          .where('library.id', 'in', (eb) => accessibleLibraries(eb, user.id))
          .execute()
      ).map((r) => r.id),
    );

    expect(getCreatedAfterIds).toEqual(accessibleIds);
    expect(getCreatedAfterIds.has(owned.id)).toBe(true);
    expect(getCreatedAfterIds.has(softDeleted.id)).toBe(false); // excluded via accessibleLibraries
    expect(getCreatedAfterIds.has(transitive.id)).toBe(true);
  });
});
```

**Step 2: Run → expect fail**

Run: `cd server && pnpm test:medium -- --run src/repositories/sync.repository.spec.ts -t "LibrarySync.getCreatedAfter" 2>&1 | tail -20`

Expected: tests fail. The OLD query reads from `library` table and uses `library.createId`. For some seeded states the set will match, for others it won't. Specifically, the "set equality with accessibleLibraries" test should fail because the old query's filtering logic differs.

If some tests unexpectedly PASS, that's fine — they're pinning existing behavior that the new implementation must preserve. Note which ones passed so you know the new implementation must still make them pass.

**Step 3: Commit failing tests**

```bash
git add server/src/repositories/sync.repository.spec.ts
git commit -m "test(server): failing tests for LibrarySync.getCreatedAfter rewrite"
```

---

## Task 13: Rewrite `LibrarySync.getCreatedAfter`

**Files:**

- Modify: `server/src/repositories/sync.repository.ts` (the `LibrarySync.getCreatedAfter` method, around line 1117)

**Step 1: Replace the method body**

Current:

```ts
@GenerateSql({ params: [dummyCreateAfterOptions] })
getCreatedAfter({ nowId, userId, afterCreateId }: SyncCreatedAfterOptions) {
  return this.db
    .selectFrom('library')
    .select(['library.id', 'library.createId'])
    .where('library.id', 'in', (eb) => accessibleLibraries(eb, userId))
    .$if(!!afterCreateId, (qb) => qb.where('library.createId', '>=', afterCreateId!))
    .where('library.createId', '<', nowId)
    .orderBy('library.createId', 'asc')
    .execute();
}
```

New:

```ts
// BEFORE: queried `library` keyed by library.createId — missed re-adds and
// new invites because the library's own createId is past the user's checkpoint.
// AFTER: queries `library_user` keyed by the per-user access grant createId,
// mirroring SharedSpaceSync.getCreatedAfter and AlbumSync.getCreatedAfter.
//
// The `library.id IN accessibleLibraries(userId)` filter is preserved so that
// soft-deleted owned libraries are excluded from the backfill loop — matching
// the existing behavior where `accessibleLibraries` drops the ownership branch
// when `deletedAt IS NOT NULL`, while keeping soft-deleted libraries visible
// via the space-link branch. See
// docs/plans/2026-04-11-library-user-access-backfill-design.md.
@GenerateSql({ params: [dummyCreateAfterOptions] })
getCreatedAfter({ nowId, userId, afterCreateId }: SyncCreatedAfterOptions) {
  return this.db
    .selectFrom('library_user')
    .select(['library_user.libraryId as id', 'library_user.createId'])
    .where('library_user.userId', '=', userId)
    .where('library_user.libraryId', 'in', (eb) => accessibleLibraries(eb, userId))
    .$if(!!afterCreateId, (qb) => qb.where('library_user.createId', '>=', afterCreateId!))
    .where('library_user.createId', '<', nowId)
    .orderBy('library_user.createId', 'asc')
    .execute();
}
```

**Step 2: Run the getCreatedAfter tests**

Run: `cd server && pnpm test:medium -- --run src/repositories/sync.repository.spec.ts -t "LibrarySync.getCreatedAfter" 2>&1 | tail -20`

Expected: all tests pass.

**Step 3: Run the full sync-library test suites to check for regressions**

```bash
cd server && pnpm test:medium -- --run test/medium/specs/sync/sync-library.spec.ts 2>&1 | tail -20
cd server && pnpm test:medium -- --run test/medium/specs/sync/sync-library-asset.spec.ts 2>&1 | tail -20
cd server && pnpm test:medium -- --run test/medium/specs/sync/sync-library-asset-exif.spec.ts 2>&1 | tail -20
cd server && pnpm test:medium -- --run test/medium/specs/sync/library-audit-triggers.spec.ts 2>&1 | tail -20
```

Expected: all green.

**Step 4: Regenerate SQL query docs**

Run: `cd server && pnpm sql` (if available — this regenerates `server/src/queries/*.sql`)

Expected: a diff in `server/src/queries/sync.repository.sql` reflecting the new `getCreatedAfter` query. Commit the regenerated SQL alongside the code.

**Step 5: Commit**

```bash
git add server/src/repositories/sync.repository.ts server/src/queries/sync.repository.sql
git commit -m "fix(server): LibrarySync.getCreatedAfter queries library_user for per-user access grants"
```

---

## Task 14: Integration tests for the three failing scenarios

End-to-end sync stream assertions exercising the full stack: migration + triggers + rewritten query + existing `syncLibrariesV1` / `syncLibraryAssetsV1` service methods.

**Files:**

- Create: `server/test/medium/specs/sync/library-access-backfill.spec.ts`

**Step 1: Create the spec with the three scenarios**

```ts
import { SyncEntityType, SyncRequestType } from 'src/enum';
import { newSyncAuthUser, newSyncTest } from 'test/medium.factory';

describe('library access backfill — sync stream integration', () => {
  // Scenario 1: User re-added to a space after leaving
  it('re-delivers library metadata + assets after a user leaves and rejoins a space', async () => {
    const { ctx } = await newSyncTest();
    const auth = await newSyncAuthUser();
    const { user: owner } = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: owner.id });
    const { asset } = await ctx.newAsset({ ownerId: owner.id, libraryId: library.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.linkLibraryToSpace(space.id, library.id);
    await ctx.addSharedSpaceMember(space.id, auth.user.id);

    // First sync — should deliver library + asset
    const initial = await ctx.syncStream(auth, [SyncRequestType.LibrariesV1, SyncRequestType.LibraryAssetsV1]);
    expect(initial.filter((e) => e.type === SyncEntityType.LibraryV1).length).toBeGreaterThanOrEqual(1);
    // The asset may come via upsert or backfill — accept either
    const assetsInitial = initial.filter(
      (e) => e.type === SyncEntityType.LibraryAssetCreateV1 || e.type === SyncEntityType.LibraryAssetBackfillV1,
    );
    expect(assetsInitial.length).toBeGreaterThanOrEqual(1);

    await ctx.syncAckAll(auth, initial);

    // Leave the space
    await ctx.removeSharedSpaceMember(space.id, auth.user.id);

    // Sync the delete events so checkpoint advances past them
    const leaveSync = await ctx.syncStream(auth, [SyncRequestType.LibrariesV1, SyncRequestType.LibraryAssetsV1]);
    expect(leaveSync.some((e) => e.type === SyncEntityType.LibraryDeleteV1)).toBe(true);
    await ctx.syncAckAll(auth, leaveSync);

    // Re-add
    await ctx.addSharedSpaceMember(space.id, auth.user.id);

    // Third sync — THE TEST: library + asset should be re-delivered
    const rejoinSync = await ctx.syncStream(auth, [SyncRequestType.LibrariesV1, SyncRequestType.LibraryAssetsV1]);
    expect(rejoinSync.some((e) => e.type === SyncEntityType.LibraryV1)).toBe(true);
    const assetsRejoin = rejoinSync.filter(
      (e) => e.type === SyncEntityType.LibraryAssetCreateV1 || e.type === SyncEntityType.LibraryAssetBackfillV1,
    );
    expect(assetsRejoin.length).toBeGreaterThanOrEqual(1);
  });

  // Scenario 2: First-time invite to a space with pre-existing libraries
  it('delivers library metadata + assets on first sync of a user added to an existing space with linked libraries', async () => {
    const { ctx } = await newSyncTest();
    const { user: owner } = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: owner.id });
    const { asset } = await ctx.newAsset({ ownerId: owner.id, libraryId: library.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.linkLibraryToSpace(space.id, library.id);

    // NEW user, auth for them
    const auth = await newSyncAuthUser();
    // Add them to the existing space
    await ctx.addSharedSpaceMember(space.id, auth.user.id);

    // First sync — must deliver library + asset
    const response = await ctx.syncStream(auth, [SyncRequestType.LibrariesV1, SyncRequestType.LibraryAssetsV1]);
    expect(response.some((e) => e.type === SyncEntityType.LibraryV1)).toBe(true);
    const assetEvents = response.filter(
      (e) => e.type === SyncEntityType.LibraryAssetCreateV1 || e.type === SyncEntityType.LibraryAssetBackfillV1,
    );
    expect(assetEvents.length).toBeGreaterThanOrEqual(1);
  });

  // Scenario 3: Library newly linked to a space the user is already in
  it('delivers library metadata + assets when a library is newly linked to a space the user is already in', async () => {
    const { ctx } = await newSyncTest();
    const auth = await newSyncAuthUser();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.addSharedSpaceMember(space.id, auth.user.id);

    // User completes an initial sync with nothing library-related
    const initial = await ctx.syncStream(auth, [SyncRequestType.LibrariesV1, SyncRequestType.LibraryAssetsV1]);
    await ctx.syncAckAll(auth, initial);

    // NOW link a library to the space
    const { library } = await ctx.newLibrary({ ownerId: owner.id });
    const { asset } = await ctx.newAsset({ ownerId: owner.id, libraryId: library.id });
    await ctx.linkLibraryToSpace(space.id, library.id);

    // Next sync — library + asset delivered
    const response = await ctx.syncStream(auth, [SyncRequestType.LibrariesV1, SyncRequestType.LibraryAssetsV1]);
    expect(response.some((e) => e.type === SyncEntityType.LibraryV1)).toBe(true);
    const assetEvents = response.filter(
      (e) => e.type === SyncEntityType.LibraryAssetCreateV1 || e.type === SyncEntityType.LibraryAssetBackfillV1,
    );
    expect(assetEvents.length).toBeGreaterThanOrEqual(1);
  });
});
```

Verify the factory/harness method names against an existing spec like `sync-library-asset.spec.ts` — the exact names may differ.

**Step 2: Run the spec**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/sync/library-access-backfill.spec.ts 2>&1 | tail -30`

Expected: all 3 scenarios pass. If any fail, the fix is incomplete — stop and diagnose before proceeding.

**Step 3: Commit**

```bash
git add server/test/medium/specs/sync/library-access-backfill.spec.ts
git commit -m "test(server): integration tests for library access backfill across the three scenarios"
```

---

## Task 15: E2E spec additions at the HTTP boundary

End-to-end via the real `/sync/stream` HTTP endpoint with login + session token. This is the test that matches the failure mode we observed live (server returning `SyncCompleteV1` with nothing for a broken session).

**Files:**

- Modify: `e2e/src/specs/server/api/sync-library.e2e-spec.ts`

**Step 1: Add a new `describe` block for the three scenarios**

Use the existing test file's helpers and login patterns. Add this block alongside existing scenarios (search for `describe('SharedSpaceLibrariesV1'` to find a good insertion point):

```ts
describe('library access backfill (PR #XXX)', () => {
  beforeAll(async () => {
    // same setup as other blocks in this file
  });

  it('re-delivers libraries after a user leaves and rejoins a space', async () => {
    // 1. admin: create library + asset + space + link
    // 2. admin: add member (our test user)
    // 3. member: login, sync, ack
    // 4. admin: remove member
    // 5. member: sync, ack (drains the LibraryDeleteV1 events)
    // 6. admin: re-add member
    // 7. member: sync → assert LibraryV1 + LibraryAssetCreateV1 present
  });

  it('delivers libraries on first sync of a member added to an existing space', async () => {
    // 1. admin: existing setup
    // 2. admin: create a new user, add to space
    // 3. new user: first sync → assert libraries present
  });

  it('delivers libraries when a library is newly linked to a space the user is already in', async () => {
    // 1. admin: create space, add member
    // 2. member: initial sync (empty), ack
    // 3. admin: create library, link to space
    // 4. member: sync → assert libraries present
  });
});
```

Copy the detailed request/response patterns from the existing tests in the same file — they use `utils.syncStream`, `utils.syncAckAll`, etc.

**Step 2: Run the E2E spec**

Run: `cd e2e && pnpm test 2>&1 | tail -30`

Note: this requires the E2E test stack to be running (`make e2e` from repo root sets this up). The E2E tests are slower than medium tests and may require a running server.

Expected: the three new test cases pass. All existing `sync-library.e2e-spec.ts` cases continue to pass.

**Step 3: Commit**

```bash
git add e2e/src/specs/server/api/sync-library.e2e-spec.ts
git commit -m "test(e2e): HTTP-level coverage for library access backfill scenarios"
```

---

## Task 16: Regression sweep and final verification

Run the entire test suites that touch library / shared-space / sync to make sure nothing else broke.

**Files:** None — this task is verification only.

**Step 1: Run all server unit tests**

Run: `cd server && pnpm test 2>&1 | tail -20`

Expected: all green. If any regress, the fix is broken — diagnose.

**Step 2: Run all server medium sync tests**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/sync/ 2>&1 | tail -30`

Expected: all green.

**Step 3: Run the full type check**

Run: `cd server && pnpm check 2>&1 | tail -10`

Expected: clean.

**Step 4: Run the lint**

Skip per `feedback_lint_sequential.md` memory — CI handles lint.

**Step 5: If anything failed, commit fixes as separate tasks above. If all green, this is the final commit.**

No commit needed for this task unless you're fixing something. If the regression sweep is clean, move on to Task 17.

---

## Task 17: Push the branch and open a draft PR

**Files:** None — branch operations only.

**Step 1: Push the branch**

```bash
git push origin fix/library-access-backfill
```

**Step 2: Open a draft PR**

```bash
gh pr create --draft --title "fix(server): library_user access-grant denormalization for shared-space library backfill" --body "$(cat <<'EOF'
## Summary

Fixes the "user rejoined space, library never syncs" bug and two related scenarios (first-time invite to existing space, new link to existing space).

## Design

Full design doc at `docs/plans/2026-04-11-library-user-access-backfill-design.md`.

Summary: new `library_user (userId, libraryId, createId, createdAt)` denormalization table populated by insert triggers on `library`, `shared_space_member`, and `shared_space_library`. Delete-side consumed from the existing `library_audit` chain via a new `AFTER INSERT ON library_audit` trigger. `LibrarySync.getCreatedAfter` rewritten to query `library_user` with `accessibleLibraries` filter preserved for soft-delete correctness.

## Test plan

- [ ] New medium tests: `library-user-triggers.spec.ts`, `library-user-migration.spec.ts`, `library-access-backfill.spec.ts`
- [ ] New unit tests in `sync.repository.spec.ts` for `LibrarySync.getCreatedAfter`
- [ ] New E2E cases in `sync-library.e2e-spec.ts`
- [ ] Existing `sync-library*.spec.ts`, `library-audit-triggers.spec.ts`, and `sync-library.e2e-spec.ts` continue to pass
- [ ] Deploy to `pierre.opennoodle.de` via RC build and manually verify: viewer re-added to Google Takeout space sees photos on next sync without app restart

## Rollback

Additive: new table + triggers + one query change. Rollback options:

- Code-only: revert the `getCreatedAfter` rewrite; table/triggers stay dormant.
- Full: run the migration's `down()` to drop table + triggers + migration_overrides rows.

See design doc "Rollback plan" section.
EOF
)"
```

**Step 3: No commit — PR is opened against the branch head.**

---

## Summary of files touched

**New files:**

- `server/src/schema/migrations-gallery/1778300000000-AddLibraryUserTable.ts`
- `server/src/schema/tables/library-user.table.ts`
- `server/test/medium/specs/sync/library-user-triggers.spec.ts`
- `server/test/medium/specs/sync/library-user-migration.spec.ts`
- `server/test/medium/specs/sync/library-access-backfill.spec.ts`

**Modified files:**

- `server/src/schema/index.ts` (table registration)
- `server/src/schema/functions.ts` (four new trigger functions)
- `server/src/schema/tables/library.table.ts` (attach `library_after_insert` trigger decorator)
- `server/src/schema/tables/shared-space-member.table.ts` (attach `shared_space_member_after_insert_library` trigger decorator)
- `server/src/schema/tables/shared-space-library.table.ts` (attach `shared_space_library_after_insert_user` trigger decorator)
- `server/src/schema/tables/library-audit.table.ts` (attach `library_user_delete_after_audit` trigger decorator)
- `server/src/repositories/sync.repository.ts` (rewrite `LibrarySync.getCreatedAfter`)
- `server/src/queries/sync.repository.sql` (regenerated by `pnpm sql`)
- `server/src/repositories/sync.repository.spec.ts` (or a new focused file)
- `e2e/src/specs/server/api/sync-library.e2e-spec.ts` (new E2E cases)

**Not touched:**

- Any mobile code
- Any service-layer code (`syncLibrariesV1`, `syncLibraryAssetsV1`, etc.)
- Any wire-protocol / sync entity types
- Any existing delete-side trigger bodies

---

## Execution notes

- **Keep commits small and atomic** — one task = one commit. If a task's tests don't fully pass, don't commit; fix first.
- **Run `pnpm check` after every trigger addition** — the `registerFunction` body and the migration SQL must match character-for-character after whitespace normalization, and `pnpm check` catches divergence early.
- **Medium tests need a real Postgres** — make sure your local stack has the test DB available (`make dev` or the test container setup). If `newMediumService` blows up on startup, that's a stack/env issue, not a code issue.
- **Schema tool boilerplate is fiddly** — the `migration_overrides` JSON-encoded SQL strings must escape quotes and newlines exactly as shown. Copy-paste from `1778200000000-LibraryAuditTables.ts` as a template.
- **If the `sql-tools` decorator library doesn't support exactly the decorator form shown** for `@CreateIdColumn({ index: false })`, fall back to the raw migration index and just use `@CreateIdColumn()` in the table definition. The plan adapts — don't get stuck on that detail.
- **Don't merge to main until the full E2E + regression sweep is green** and the fix is manually verified on `pierre.opennoodle.de` via an RC build.
