# Space Albums Phase 2A — Slice A1: Grant + Audit Tables — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the three new fork tables — `shared_space_album_user` (grant), `shared_space_album_audit` (link-removal audit), `shared_space_album_user_audit` (grant-revocation audit) — as bare tables (no triggers/functions yet; those land in A2/A3), with a reversible fork migration and matching Kysely table decorators, pinned by a medium test for shape + FK-cascade behavior.

**Architecture:** Mirror the shipped `library_user` blueprint exactly, swapping `library`→`album`. The grant table has FK-CASCADE columns (`userId`→`user`, `albumId`→`album`); the two audit tables are FK-less append logs (plain `uuid` columns), exactly like `shared_space_library_audit` / `library_audit`. Fork migration lives in `migrations-gallery/`; decorators in `schema/tables/` register in `schema/index.ts` so sql-tools' schema diff matches.

**Tech Stack:** NestJS, Kysely, `@immich/sql-tools` decorators, Vitest medium tests (testcontainers + real Postgres).

**Spec:** `docs/superpowers/specs/2026-06-15-space-albums-phase2a-server-sync-design.md` §4 (data model), §11 (A1).

**Scope guard:** A1 creates **bare tables only**. NO `user_has_album_path`, NO create/delete triggers, NO `migration_overrides` (those are for functions/triggers — A2/A3). Do not add `@AfterInsertTrigger`/`@BeforeDeleteTrigger` decorators in A1.

---

## File Structure

- Create: `server/src/schema/tables/shared-space-album-user.table.ts` — grant table decorator (clone of `library-user.table.ts`).
- Create: `server/src/schema/tables/shared-space-album-audit.table.ts` — link-removal audit decorator (clone of `shared-space-library-audit.table.ts`).
- Create: `server/src/schema/tables/shared-space-album-user-audit.table.ts` — grant-revocation audit decorator (clone of `library-audit.table.ts` **without** its `@AfterInsertTrigger`).
- Modify: `server/src/schema/index.ts` — import + add each class to the tables array (~lines 148–174) + add each to the `DB` interface map (~lines 277–314).
- Create: `server/src/schema/migrations-gallery/1779000000000-AddSharedSpaceAlbumUserTables.ts` — `up()` creates the three tables + indexes; `down()` drops them.
- Create: `server/test/medium/specs/sync/shared-space-album-user-migration.spec.ts` — shape + FK-cascade medium test.

---

### Task 1: RED — medium test for table shape + FK cascade

**Files:**

- Test: `server/test/medium/specs/sync/shared-space-album-user-migration.spec.ts`

Read first for factory helper names + patterns: `server/test/medium.factory.ts` (confirm `newUser`, `newAlbum` exist; `newAlbum` is used by `sync-album.spec.ts`), and `server/test/medium/specs/sync/sync-library.spec.ts` (DB + getKyselyDB pattern).

- [ ] **Step 1: Write the failing test**

```ts
import { Kysely, sql } from 'kysely';
import { DB } from 'src/schema';
import { SyncTestContext } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = async (db?: Kysely<DB>) => {
  const ctx = new SyncTestContext(db || defaultDatabase);
  const { auth, user } = await ctx.newSyncAuthUser();
  return { auth, user, ctx };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe('shared_space_album_user grant table', () => {
  it('accepts a (userId, albumId) row and defaults createId + createdAt', async () => {
    const { auth, ctx } = await setup();
    const { album } = await ctx.newAlbum({ ownerId: auth.user.id });

    await defaultDatabase
      .insertInto('shared_space_album_user')
      .values({ userId: auth.user.id, albumId: album.id })
      .execute();

    const rows = await defaultDatabase
      .selectFrom('shared_space_album_user')
      .selectAll()
      .where('userId', '=', auth.user.id)
      .where('albumId', '=', album.id)
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0].createId).toEqual(expect.any(String));
    expect(rows[0].createdAt).toBeDefined();
  });

  it('dedupes on (userId, albumId) primary key', async () => {
    const { auth, ctx } = await setup();
    const { album } = await ctx.newAlbum({ ownerId: auth.user.id });

    await defaultDatabase
      .insertInto('shared_space_album_user')
      .values({ userId: auth.user.id, albumId: album.id })
      .execute();
    await defaultDatabase
      .insertInto('shared_space_album_user')
      .values({ userId: auth.user.id, albumId: album.id })
      .onConflict((oc) => oc.columns(['userId', 'albumId']).doNothing())
      .execute();

    const rows = await defaultDatabase
      .selectFrom('shared_space_album_user')
      .selectAll()
      .where('albumId', '=', album.id)
      .execute();
    expect(rows).toHaveLength(1);
  });

  it('cascades when the album is deleted', async () => {
    const { auth, ctx } = await setup();
    const { album } = await ctx.newAlbum({ ownerId: auth.user.id });
    await defaultDatabase
      .insertInto('shared_space_album_user')
      .values({ userId: auth.user.id, albumId: album.id })
      .execute();

    await defaultDatabase.deleteFrom('album').where('id', '=', album.id).execute();

    const rows = await defaultDatabase
      .selectFrom('shared_space_album_user')
      .selectAll()
      .where('albumId', '=', album.id)
      .execute();
    expect(rows).toHaveLength(0);
  });

  it('cascades when the user is deleted', async () => {
    const { auth, ctx } = await setup();
    const { user: other } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: auth.user.id });
    await defaultDatabase
      .insertInto('shared_space_album_user')
      .values({ userId: other.id, albumId: album.id })
      .execute();

    await defaultDatabase.deleteFrom('user').where('id', '=', other.id).execute();

    const rows = await defaultDatabase
      .selectFrom('shared_space_album_user')
      .selectAll()
      .where('albumId', '=', album.id)
      .execute();
    expect(rows).toHaveLength(0);
  });
});

describe('shared_space_album audit tables (append logs, no FKs)', () => {
  it('shared_space_album_audit accepts a (spaceId, albumId) row with defaulted id + deletedAt', async () => {
    const id = (await sql<{ id: string }>`SELECT immich_uuid_v7() AS id`.execute(defaultDatabase)).rows[0].id;
    const fakeSpace = (await sql<{ id: string }>`SELECT immich_uuid_v7() AS id`.execute(defaultDatabase)).rows[0].id;
    const fakeAlbum = (await sql<{ id: string }>`SELECT immich_uuid_v7() AS id`.execute(defaultDatabase)).rows[0].id;

    // No FK: a row survives even though spaceId/albumId reference nothing.
    await defaultDatabase
      .insertInto('shared_space_album_audit')
      .values({ id, spaceId: fakeSpace, albumId: fakeAlbum })
      .execute();

    const rows = await defaultDatabase
      .selectFrom('shared_space_album_audit')
      .selectAll()
      .where('id', '=', id)
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0].deletedAt).toBeDefined();
  });

  it('shared_space_album_user_audit accepts an (albumId, userId) row with no FK constraint', async () => {
    const id = (await sql<{ id: string }>`SELECT immich_uuid_v7() AS id`.execute(defaultDatabase)).rows[0].id;
    const fakeAlbum = (await sql<{ id: string }>`SELECT immich_uuid_v7() AS id`.execute(defaultDatabase)).rows[0].id;
    const fakeUser = (await sql<{ id: string }>`SELECT immich_uuid_v7() AS id`.execute(defaultDatabase)).rows[0].id;

    await defaultDatabase
      .insertInto('shared_space_album_user_audit')
      .values({ id, albumId: fakeAlbum, userId: fakeUser })
      .execute();

    const rows = await defaultDatabase
      .selectFrom('shared_space_album_user_audit')
      .selectAll()
      .where('id', '=', id)
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0].deletedAt).toBeDefined();
  });
});
```

> If `ctx.newAlbum` does not exist or has a different signature, read `server/test/medium/specs/sync/sync-album.spec.ts` to copy the exact helper it uses to create an album, and adjust these calls. Do not invent a helper.

- [ ] **Step 2: Run the test, verify it fails for the right reason**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/sync/shared-space-album-user-migration.spec.ts`
Expected: FAIL at **runtime** with `relation "shared_space_album_user" does not exist` (vitest strips types, so the unknown-table type error does not surface here — it surfaces in `pnpm check` in Task 2 Step 5). This is the correct RED: the template DB has no such relations yet.

---

### Task 2: GREEN — table decorators + register in `index.ts`

**Files:**

- Create: `server/src/schema/tables/shared-space-album-user.table.ts`
- Create: `server/src/schema/tables/shared-space-album-audit.table.ts`
- Create: `server/src/schema/tables/shared-space-album-user-audit.table.ts`
- Modify: `server/src/schema/index.ts`

- [ ] **Step 1: Create the grant table decorator** (clone of `library-user.table.ts`)

`server/src/schema/tables/shared-space-album-user.table.ts`:

```ts
import { CreateDateColumn, ForeignKeyColumn, Generated, Index, Table, Timestamp } from '@immich/sql-tools';
import { CreateIdColumn } from 'src/decorators';
import { AlbumTable } from 'src/schema/tables/album.table';
import { UserTable } from 'src/schema/tables/user.table';

// Internal, write-once (userId, albumId) album-access grant with a per-user
// createId watermark. Trigger-maintained (A2/A3); never user-facing; never
// album_user. Drives SharedSpaceAlbumSync.getCreatedAfter (the per-album asset
// backfill loop). Mirrors library_user.
//
// See docs/superpowers/specs/2026-06-15-space-albums-phase2a-server-sync-design.md §4.1.
@Table({ name: 'shared_space_album_user' })
@Index({ name: 'shared_space_album_user_userId_createId_idx', columns: ['userId', 'createId'] })
export class SharedSpaceAlbumUserTable {
  @ForeignKeyColumn(() => UserTable, {
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
    nullable: false,
    primary: true,
    index: false,
  })
  userId!: string;

  @ForeignKeyColumn(() => AlbumTable, {
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
    nullable: false,
    primary: true,
    index: false,
  })
  albumId!: string;

  @CreateIdColumn()
  createId!: Generated<string>;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;
}
```

- [ ] **Step 2: Create the link-removal audit decorator** (clone of `shared-space-library-audit.table.ts`)

`server/src/schema/tables/shared-space-album-audit.table.ts`:

```ts
import { Column, CreateDateColumn, Generated, Table, Timestamp } from '@immich/sql-tools';
import { PrimaryGeneratedUuidV7Column } from 'src/decorators';

// Ungated link-removal audit: one row per removed (space, album) link.
// Consumed by SharedSpaceAlbumLinkSync.getDeletes (A4). FK-less append log.
// Mirrors shared_space_library_audit.
@Table('shared_space_album_audit')
export class SharedSpaceAlbumAuditTable {
  @PrimaryGeneratedUuidV7Column()
  id!: Generated<string>;

  @Column({ type: 'uuid', index: true })
  spaceId!: string;

  @Column({ type: 'uuid', index: true })
  albumId!: string;

  @CreateDateColumn({ default: () => 'clock_timestamp()', index: true })
  deletedAt!: Generated<Timestamp>;
}
```

- [ ] **Step 3: Create the grant-revocation audit decorator** (clone of `library-audit.table.ts`, WITHOUT its `@AfterInsertTrigger` — the consumer trigger lands in A3)

`server/src/schema/tables/shared-space-album-user-audit.table.ts`:

```ts
import { Column, CreateDateColumn, Generated, Table, Timestamp } from '@immich/sql-tools';
import { PrimaryGeneratedUuidV7Column } from 'src/decorators';

// Gated grant-revocation audit: one row per (album, user) who has lost all
// paths. In A3, the consumer trigger shared_space_album_user_delete_after_audit
// (AFTER INSERT on this table) deletes the grant row; SharedSpaceAlbumSync.getDeletes
// (A4) also reads it. FK-less append log. Mirrors library_audit (minus the trigger,
// which A3 adds).
@Table('shared_space_album_user_audit')
export class SharedSpaceAlbumUserAuditTable {
  @PrimaryGeneratedUuidV7Column()
  id!: Generated<string>;

  @Column({ type: 'uuid', index: true })
  albumId!: string;

  @Column({ type: 'uuid', index: true })
  userId!: string;

  @CreateDateColumn({ default: () => 'clock_timestamp()', index: true })
  deletedAt!: Generated<Timestamp>;
}
```

- [ ] **Step 4: Register the three classes in `server/src/schema/index.ts`**

Add three imports (alphabetical-ish, next to the existing `shared-space-*` imports near line 78–84):

```ts
import { SharedSpaceAlbumAuditTable } from 'src/schema/tables/shared-space-album-audit.table';
import { SharedSpaceAlbumUserTable } from 'src/schema/tables/shared-space-album-user.table';
import { SharedSpaceAlbumUserAuditTable } from 'src/schema/tables/shared-space-album-user-audit.table';
```

Add to the tables array (next to `SharedSpaceAlbumTable` ~line 172):

```ts
    SharedSpaceAlbumTable,
    SharedSpaceAlbumAuditTable,
    SharedSpaceAlbumUserTable,
    SharedSpaceAlbumUserAuditTable,
```

Add to the `DB` interface map (next to `shared_space_album:` ~line 312):

```ts
shared_space_album: SharedSpaceAlbumTable;
shared_space_album_audit: SharedSpaceAlbumAuditTable;
shared_space_album_user: SharedSpaceAlbumUserTable;
shared_space_album_user_audit: SharedSpaceAlbumUserAuditTable;
```

- [ ] **Step 5: Type-check**

Run: `cd server && pnpm check` (or `npx tsc --noEmit`)
Expected: PASS — the `DB` map now knows the three tables; the test file's `insertInto('shared_space_album_user')` type-checks. (The medium test still fails at runtime until the migration creates the relations — Task 4.)

---

### Task 3: GREEN — the fork migration

**Files:**

- Create: `server/src/schema/migrations-gallery/1779000000000-AddSharedSpaceAlbumUserTables.ts`

- [ ] **Step 1: Write the migration**

```ts
import { Kysely, sql } from 'kysely';

// Phase 2A slice A1: bare tables only (no triggers/functions — those land in
// A2/A3, where migration_overrides are added). Mirrors the library_user blueprint
// (1778300000000) and the audit tables (1778200000000).

export async function up(db: Kysely<any>): Promise<void> {
  // Grant table (FK-cascade), mirrors library_user.
  await sql`
    CREATE TABLE "shared_space_album_user" (
      "userId"   uuid NOT NULL REFERENCES "user"(id) ON UPDATE CASCADE ON DELETE CASCADE,
      "albumId"  uuid NOT NULL REFERENCES "album"(id) ON UPDATE CASCADE ON DELETE CASCADE,
      "createId" uuid NOT NULL DEFAULT immich_uuid_v7(),
      "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
      CONSTRAINT "shared_space_album_user_pkey" PRIMARY KEY ("userId", "albumId")
    );
  `.execute(db);
  await sql`CREATE INDEX "shared_space_album_user_userId_createId_idx" ON "shared_space_album_user" ("userId", "createId");`.execute(
    db,
  );

  // Link-removal audit (FK-less append log), mirrors shared_space_library_audit.
  await sql`
    CREATE TABLE "shared_space_album_audit" (
      "id"        uuid NOT NULL DEFAULT immich_uuid_v7(),
      "spaceId"   uuid NOT NULL,
      "albumId"   uuid NOT NULL,
      "deletedAt" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT "shared_space_album_audit_pkey" PRIMARY KEY ("id")
    );
  `.execute(db);
  await sql`CREATE INDEX "shared_space_album_audit_spaceId_idx" ON "shared_space_album_audit" ("spaceId");`.execute(db);
  await sql`CREATE INDEX "shared_space_album_audit_albumId_idx" ON "shared_space_album_audit" ("albumId");`.execute(db);
  await sql`CREATE INDEX "shared_space_album_audit_deletedAt_idx" ON "shared_space_album_audit" ("deletedAt");`.execute(
    db,
  );

  // Grant-revocation audit (FK-less append log), mirrors library_audit.
  await sql`
    CREATE TABLE "shared_space_album_user_audit" (
      "id"        uuid NOT NULL DEFAULT immich_uuid_v7(),
      "albumId"   uuid NOT NULL,
      "userId"    uuid NOT NULL,
      "deletedAt" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT "shared_space_album_user_audit_pkey" PRIMARY KEY ("id")
    );
  `.execute(db);
  await sql`CREATE INDEX "shared_space_album_user_audit_albumId_idx" ON "shared_space_album_user_audit" ("albumId");`.execute(
    db,
  );
  await sql`CREATE INDEX "shared_space_album_user_audit_userId_idx" ON "shared_space_album_user_audit" ("userId");`.execute(
    db,
  );
  await sql`CREATE INDEX "shared_space_album_user_audit_deletedAt_idx" ON "shared_space_album_user_audit" ("deletedAt");`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS "shared_space_album_user_audit";`.execute(db);
  await sql`DROP TABLE IF EXISTS "shared_space_album_audit";`.execute(db);
  await sql`DROP INDEX IF EXISTS "shared_space_album_user_userId_createId_idx";`.execute(db);
  await sql`DROP TABLE IF EXISTS "shared_space_album_user";`.execute(db);
}
```

> Column order, types, index names, and PK names must match what the decorators imply (they mirror the library blueprint, which these clone, so they will). If the schema-diff check in Task 4 Step 2 reports drift, align the migration SQL to the decorator output rather than the reverse.

- [ ] **Step 2: Commit checkpoint** (decorators + migration + registration, before running the DB test)

```bash
git add server/src/schema/tables/shared-space-album-user.table.ts \
        server/src/schema/tables/shared-space-album-audit.table.ts \
        server/src/schema/tables/shared-space-album-user-audit.table.ts \
        server/src/schema/index.ts \
        server/src/schema/migrations-gallery/1779000000000-AddSharedSpaceAlbumUserTables.ts
git commit -m "feat(spaces): add shared_space_album grant + audit tables (Phase 2A slice A1)"
```

---

### Task 4: GREEN — run the medium test + schema-diff check

- [ ] **Step 1: Run the medium test**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/sync/shared-space-album-user-migration.spec.ts`
Expected: PASS — all six cases (insert/default, PK dedupe, album-cascade, user-cascade, two audit-table inserts) green. The medium harness applies fork migrations on the test container, so the tables exist.

- [ ] **Step 2: Run the schema-consistency checks**

Run: `cd server && pnpm check`
Then run the schema/migration guard tests:
Run: `cd server && pnpm test -- --run src/schema/sync-gallery-migrations.spec.ts src/schema/composite-migration-provider.spec.ts`
Expected: PASS — decorators and the fork migration agree; no schema drift; the new migration is picked up by the composite provider.

> If a schema-diff assertion fails, it prints the exact divergence (a column/index the decorator expects but the migration didn't create, or vice-versa). Reconcile the migration SQL to match the decorators, re-run.

- [ ] **Step 3: Commit (if Step 2 required migration adjustments)**

```bash
git add -A && git commit -m "fix(spaces): align A1 migration with table decorators"
```

---

### Task 5: Verify `down()` reverses cleanly

- [ ] **Step 1: Confirm the medium harness / a revert exercises `down()`**

`getKyselyDB()` creates a **fresh, isolated database from the template** on each call (it runs
`CREATE DATABASE … WITH TEMPLATE`), so calling `down()` on a handle from a second `getKyselyDB()` call
is safe — it cannot affect `defaultDatabase` or other specs. First read `server/src/schema/sync-gallery-migrations.spec.ts`: if it already asserts every gallery migration's `down()` drops what `up()` created, this is covered — skip the test below. (A grep showed it does not mention `down`/`revert`, so it likely does **not** cover this — add the focused test:)

```ts
it('down() drops all three tables', async () => {
  // getKyselyDB() returns a fresh isolated DB from the template — safe to mutate.
  const db = await getKyselyDB();
  const migration = await import('src/schema/migrations-gallery/1779000000000-AddSharedSpaceAlbumUserTables');
  await migration.down(db as unknown as Kysely<any>);
  const exists = await sql<{ count: string }>`
    SELECT count(*)::text AS count FROM information_schema.tables
    WHERE table_name IN ('shared_space_album_user','shared_space_album_audit','shared_space_album_user_audit')
  `.execute(db);
  expect(exists.rows[0].count).toBe('0');
});
```

> Only add this test if the existing migration guard does not already cover `down()` reversibility. Do not duplicate coverage.

- [ ] **Step 2: Run + commit if added**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/sync/shared-space-album-user-migration.spec.ts`
Expected: PASS

```bash
git add -A && git commit -m "test(spaces): assert A1 migration down() reversibility"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** §4.1 grant table → Task 2 Step 1 + Task 3. §4.2 link audit → Task 2 Step 2 + Task 3. §4.3 grant-revocation audit (table only, trigger deferred) → Task 2 Step 3 + Task 3. §11 A1 RED table-shape/FK-cascade tests → Task 1. Correction-1 (audit table not built in Phase 1) → all three tables created here. ✓
- **Scope:** No triggers/functions/`migration_overrides`/`user_has_album_path` (A2/A3). No sync classes (A4). ✓
- **No placeholders:** all code shown; the only conditional is "verify `ctx.newAlbum` signature" and "only add down() test if not already covered" — both are explicit verification steps, not deferred work. ✓
- **Type consistency:** table names (`shared_space_album_user`, `shared_space_album_audit`, `shared_space_album_user_audit`), class names (`SharedSpaceAlbumUserTable`, `SharedSpaceAlbumAuditTable`, `SharedSpaceAlbumUserAuditTable`), and column names are identical across decorators, migration, `index.ts` map, and tests. ✓
