# Mobile Shared-Space Drift Sync Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give shared spaces the same Drift-backed, lazy-loading timeline architecture that remote albums already have on mobile, so opening a space feels instantaneous instead of taking multiple seconds on the network path.

**Architecture:** Mirror the existing remote-album sync pipeline (`AlbumSync` / `AlbumUserSync` / `AlbumAssetSync` / `AlbumAssetExifSync` / `AlbumToAssetSync`) for shared spaces, extended dimensionally with a parallel family of library sync classes. Mobile gets new Drift entities, sync-stream handlers, and a `DriftTimelineRepository.sharedSpace()` method whose bucket/asset sources are backed by a local SQL UNION over `shared_space_asset` (direct-add) and `shared_space_library` (library-linked) joined against `remote_asset`. Access revocation is driven by per-user audit-trigger fan-out, matching the album pattern, with a new `user_has_library_path` PL/pgSQL function computing transitive access over ownership, membership, and creator paths.

**Tech Stack:** TypeScript + NestJS + Kysely on the server; Flutter + Dart + Drift + Riverpod on mobile; PostgreSQL triggers for audit fan-out; OpenAPI code generation for the SDK.

**Reference design:** `docs/plans/2026-04-08-mobile-shared-space-drift-sync-design.md` — read this before starting. Every task below assumes familiarity with it.

**Delivery:** Two PRs shipping in a **single release**. PR 1 (tasks 0–19) adds server emitters, audit tables, mobile Drift entities, sync handlers, and the Drift timeline query with no UI change. PR 2 (tasks 20–39) adds library sync, the transitive-access trigger, extends the timeline query with the UNION, wires `SpaceDetailPage` to the new path, and deletes the old network-based path.

**Commit convention:** one commit per task completion. Commit message format: `feat(<area>): <what>` for new functionality, `test(<area>): <what>` for test-only additions, `chore(<area>): <what>` for wiring/regeneration. Never amend — always a new commit.

**TDD discipline:** every task that introduces new runtime behavior starts with a failing test. Red → green → commit. No exceptions. For tasks that are purely configuration (DTO wiring, OpenAPI regen), skip the test step but still commit separately.

---

## Prerequisites

Before starting Task 1, verify your environment:

- **Dev stack running**: `make dev` succeeds and the dev DB is accessible.
- **Java installed**: `java --version` succeeds (the Dart OpenAPI generator requires it — without Java, Tasks 10 and 28 will fail silently).
- **Test DB clean**: from a paused state, running `cd server && pnpm schema:reset && pnpm migrations:run` succeeds.
- **Mobile build_runner works**: `cd mobile && dart run build_runner build --delete-conflicting-outputs` succeeds at least once on a clean checkout.

---

## PR 1 — Direct-add Drift sync (plumbing only, no UI change)

### Task 0: Verify and add test factory helpers

**Files:**

- Possibly modify: `server/test/medium.factory.ts`
- Possibly modify: `mobile/test/medium/repository_context.dart`

**Context:** Several later tasks assume helpers like `ctx.newSharedSpace`, `ctx.newSharedSpaceMember`, `ctx.newSharedSpaceAsset`, `ctx.newSharedSpaceLibrary`, `ctx.newLibrary`, `insertSharedSpaceAsset` exist. Some are present already (verified during plan-writing), others may not be. This task is prerequisite plumbing — not feature work — and must complete before any test-writing task can proceed.

**Step 1: Audit the server-side factory**

```bash
grep -n "newSharedSpace\|newSharedSpaceMember\|newSharedSpaceLibrary\|newSharedSpaceAsset\|newLibrary" server/test/medium.factory.ts
```

Expected (verified during plan-writing): `newSharedSpace`, `newSharedSpaceMember`, `newSharedSpaceLibrary`, `newSharedSpaceAsset` exist. `newLibrary` may or may not — confirm.

**Step 2: Audit the mobile-side factory**

```bash
grep -rn "newSharedSpace\|insertSharedSpaceAsset\|newLibrary\|insertLibrary\|newSharedSpaceLibrary" mobile/test/medium/repository_context.dart
```

For each helper that does NOT exist, add it. The pattern follows existing helpers in the same file (read `newRemoteAsset`, `newRemoteAlbum`, `insertRemoteAlbumAsset` for reference).

**Step 3: Run the test suite once to confirm no regression**

```bash
cd server && pnpm test:medium -- sync-album
cd ../mobile && flutter test test/infrastructure/repositories/remote_album_repository_test.dart
```

Expected: existing tests still pass (helper additions are purely additive).

**Step 4: Commit**

```bash
git add server/test/medium.factory.ts mobile/test/medium/repository_context.dart
git commit -m "chore(test): add test-factory helpers for shared spaces and libraries"
```

If neither file changed (all helpers already existed), skip the commit and proceed to Task 1.

---

### Task 1: Add `SyncEntityType` values for shared spaces

**Files:**

- Modify: `server/src/enum.ts`

**Step 1: Locate the insertion point**

Read `server/src/enum.ts`. Find the `SyncEntityType` enum (around line 814). Scroll to the end of the enum — just before `SyncAckV1`, `SyncResetV1`, `SyncCompleteV1`.

**Step 2: Add a marker comment and the new values**

Insert immediately before `SyncAckV1`:

```typescript
  // --- gallery-fork additions ---

  SharedSpaceV1 = 'SharedSpaceV1',
  SharedSpaceDeleteV1 = 'SharedSpaceDeleteV1',

  SharedSpaceMemberV1 = 'SharedSpaceMemberV1',
  SharedSpaceMemberDeleteV1 = 'SharedSpaceMemberDeleteV1',
  SharedSpaceMemberBackfillV1 = 'SharedSpaceMemberBackfillV1',

  SharedSpaceAssetCreateV1 = 'SharedSpaceAssetCreateV1',
  SharedSpaceAssetUpdateV1 = 'SharedSpaceAssetUpdateV1',
  SharedSpaceAssetBackfillV1 = 'SharedSpaceAssetBackfillV1',

  SharedSpaceAssetExifCreateV1 = 'SharedSpaceAssetExifCreateV1',
  SharedSpaceAssetExifUpdateV1 = 'SharedSpaceAssetExifUpdateV1',
  SharedSpaceAssetExifBackfillV1 = 'SharedSpaceAssetExifBackfillV1',

  SharedSpaceToAssetV1 = 'SharedSpaceToAssetV1',
  SharedSpaceToAssetDeleteV1 = 'SharedSpaceToAssetDeleteV1',
  SharedSpaceToAssetBackfillV1 = 'SharedSpaceToAssetBackfillV1',
```

Also locate `SyncRequestType` in the same file and add the request types that the server handler loop will use (one per backfill family that the client can request):

```typescript
  SharedSpacesV1 = 'SharedSpacesV1',
  SharedSpaceMembersV1 = 'SharedSpaceMembersV1',
  SharedSpaceAssetsV1 = 'SharedSpaceAssetsV1',
  SharedSpaceAssetExifsV1 = 'SharedSpaceAssetExifsV1',
  SharedSpaceToAssetsV1 = 'SharedSpaceToAssetsV1',
```

Grep for where existing `AlbumsV1` etc. are declared in `SyncRequestType` to confirm the exact naming pattern before adding.

**Step 3: Add no-op handler stubs and update `SYNC_TYPES_ORDER`**

Adding `SyncRequestType` values breaks the exhaustive `Record<SyncRequestType, () => Promise<void>>` map at `server/src/services/sync.service.ts:173` and the `SYNC_TYPES_ORDER` array around line 70. Add temporary entries so typecheck passes:

In the `handlers` Record (inside `SyncService.stream`), append:

```typescript
// Shared-space sync handlers — wired in Task 10. No-op stubs keep the exhaustive Record happy.
[SyncRequestType.SharedSpacesV1]: () => Promise.resolve(),
[SyncRequestType.SharedSpaceMembersV1]: () => Promise.resolve(),
[SyncRequestType.SharedSpaceAssetsV1]: () => Promise.resolve(),
[SyncRequestType.SharedSpaceAssetExifsV1]: () => Promise.resolve(),
[SyncRequestType.SharedSpaceToAssetsV1]: () => Promise.resolve(),
```

In `SYNC_TYPES_ORDER` (top of the same file), append:

```typescript
// Shared spaces — wired in Task 10. Order: parent metadata before assets, exifs after assets.
SyncRequestType.SharedSpacesV1,
SyncRequestType.SharedSpaceMembersV1,
SyncRequestType.SharedSpaceAssetsV1,
SyncRequestType.SharedSpaceToAssetsV1,
SyncRequestType.SharedSpaceAssetExifsV1,
```

Task 10 will replace these entries with real implementations.

**Step 4: Run the typechecker**

```bash
cd server && pnpm check
```

Expected: passes.

**Step 5: Commit**

```bash
git add server/src/enum.ts server/src/services/sync.service.ts
git commit -m "feat(sync): add shared-space SyncEntityType and SyncRequestType values"
```

---

### Task 1.5: Regenerate the OpenAPI spec for the new enum values

**Files:** `open-api/immich-openapi-specs.json`, `open-api/typescript-sdk/src/fetch-client.ts`, `mobile/openapi/lib/model/sync_*.dart`

**Context:** `SyncEntityType` and `SyncRequestType` are exposed via OpenAPI. Adding values without regenerating the spec leaves CI failing on stale clients. The plan defers DTO regen to Task 11 — but the enum values themselves must be regenerated now.

```bash
cd server && pnpm build && pnpm sync:open-api
cd .. && make open-api-typescript
make open-api-dart  # only if Java is installed; otherwise defer to Task 11
```

Commit each regen as a separate `chore(sync): regenerate ...` so reviewers can scan past them.

---

### Task 2: Create audit table definitions and stub migration

**Files:**

- Create: `server/src/schema/tables/shared-space-audit.table.ts`
- Create: `server/src/schema/tables/shared-space-member-audit.table.ts`
- Create: `server/src/schema/tables/shared-space-asset-audit.table.ts`
- Create: `server/src/schema/migrations-gallery/1778100000000-SharedSpaceAuditTables.ts` (tables only; no triggers yet)

**Context:** Set up the audit table structure first, without triggers. Triggers come in Task 4 after the failing tests in Task 3 force their shape.

**Step 1: Create the three table definition files**

Create `server/src/schema/tables/shared-space-audit.table.ts` mirroring `album-audit.table.ts`:

```typescript
import { Column, CreateDateColumn, Generated, Table, Timestamp } from '@immich/sql-tools';
import { PrimaryGeneratedUuidV7Column } from 'src/decorators';

@Table('shared_space_audit')
export class SharedSpaceAuditTable {
  @PrimaryGeneratedUuidV7Column()
  id!: Generated<string>;

  @Column({ type: 'uuid', index: true })
  spaceId!: string;

  @Column({ type: 'uuid', index: true })
  userId!: string;

  @CreateDateColumn({ default: () => 'clock_timestamp()', index: true })
  deletedAt!: Generated<Timestamp>;
}
```

Create `shared-space-member-audit.table.ts` with identical shape (only the class name and `@Table` argument change).

Create `shared-space-asset-audit.table.ts` with `spaceId` and `assetId` columns (both `uuid`, both indexed) instead of `userId`.

**Step 2: Register the new tables in `server/src/schema/index.ts`**

Add imports for `SharedSpaceAuditTable`, `SharedSpaceMemberAuditTable`, `SharedSpaceAssetAuditTable`, then:

1. Add them to the `tables: [...]` array on `ImmichDatabase` (next to the existing `SharedSpaceTable` entries).
2. Add them to the `DB` type alias map (next to `shared_space: SharedSpaceTable;` etc.) — keys `shared_space_audit`, `shared_space_member_audit`, `shared_space_asset_audit`.

Without this, the tests can't reference the audit tables via Kysely.

**Step 3: Write the table-creation migration**

Create `server/src/schema/migrations-gallery/1778100000000-SharedSpaceAuditTables.ts`. Include only `CREATE TABLE` + indexes for now — no functions, no triggers. A matching `down()` that drops the tables.

Use the gallery index naming convention `{table}_{column}_idx`, NOT the upstream `IDX_xxx` convention (per `feedback_sql_tools_index_naming.md`).

**Step 4: Apply the migration**

```bash
cd server && pnpm build && pnpm migrations:run
```

Verify (note: the `_*_audit` glob doesn't match `shared_space_audit` itself — use `*audit*`):

```bash
docker compose -f docker/docker-compose.dev.yml exec database psql -U postgres -d immich -c "\dt shared_space*audit*"
```

Expected: three rows.

**Step 5: Sanity-check the schema diff**

```bash
pnpm migrations:debug
```

Expected: `No changes detected`. If anything is generated to `server/src/<timestamp>-Migration.ts`, the table definitions don't match the migration — fix and re-run before continuing.

**Step 6: Commit**

```bash
git add server/src/schema/tables/shared-space-audit.table.ts \
        server/src/schema/tables/shared-space-member-audit.table.ts \
        server/src/schema/tables/shared-space-asset-audit.table.ts \
        server/src/schema/migrations-gallery/1778100000000-SharedSpaceAuditTables.ts \
        server/src/schema/index.ts
git commit -m "feat(sync): add shared-space audit table definitions"
```

---

### Task 3: Write trigger medium tests (RED — must fail)

**Files:**

- Create: `server/test/medium/specs/sync/shared-space-audit-triggers.spec.ts`

**Context:** Strict TDD. Write the tests now, with the audit tables in place but no triggers populating them. Tests must fail because the audit tables stay empty after delete operations.

**Step 1: Read references**

Read `server/test/medium/specs/sync/sync-album.spec.ts` and `server/test/medium.factory.ts` (Task 0 verified the helpers exist).

**Important — factory return shape.** `ctx.newSharedSpace(...)` returns `{ space, result }` (NOT `{ sharedSpace, result }` as old plan revisions implied). `ctx.newSharedSpaceMember(...)` returns `{ member, result }`. Use those keys when destructuring.

**Important — `MediumTestContext` requires a Service.** Its constructor takes `(Service, options)` — you cannot just pass a database. Use `SyncTestContext` (which extends it with `SyncService` + the right repos pre-wired). Same setup pattern as `sync-album.spec.ts`.

**Important — the schema-driven cleanup test will start failing.** `server/test/medium/specs/services/sync.service.spec.ts > should cleanup every table` enumerates `_audit` tables from `schemaFromCode()` and asserts that `BaseSync.auditCleanup` was called once per table. Adding three new audit tables breaks this test until something on `SyncRepository` calls `auditCleanup` for each. Fix it now (not in Task 5) by adding three minimal stub classes inline in `server/src/repositories/sync.repository.ts`:

```typescript
// --- gallery-fork: shared-space sync stubs ---
// Tasks 5–9 extend these with full create/update/delete query methods. For now they
// only own audit-table cleanup so the schema-driven cleanup test stays green.

export class SharedSpaceSync extends BaseSync {
  cleanupAuditTable(daysAgo: number) {
    return this.auditCleanup('shared_space_audit', daysAgo);
  }
}

export class SharedSpaceMemberSync extends BaseSync {
  cleanupAuditTable(daysAgo: number) {
    return this.auditCleanup('shared_space_member_audit', daysAgo);
  }
}

export class SharedSpaceAssetSync extends BaseSync {
  cleanupAuditTable(daysAgo: number) {
    return this.auditCleanup('shared_space_asset_audit', daysAgo);
  }
}
```

Wire them onto `SyncRepository` (add three properties + three constructor `new` calls). Then in `server/src/services/sync.service.ts > onAuditTableCleanup`, append three lines:

```typescript
await this.syncRepository.sharedSpace.cleanupAuditTable(pruneThreshold);
await this.syncRepository.sharedSpaceMember.cleanupAuditTable(pruneThreshold);
await this.syncRepository.sharedSpaceAsset.cleanupAuditTable(pruneThreshold);
```

These are forward-compatible: Task 5 adds full query methods to the same classes.

**Step 2: Write the seven failing tests**

```typescript
import { Kysely } from 'kysely';
import { DB } from 'src/schema';
import { SyncTestContext } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe('shared_space audit triggers', () => {
  const setup = async () => {
    const ctx = new SyncTestContext(defaultDatabase);
    return { ctx, db: defaultDatabase };
  };

  it('fans out shared_space_audit rows to every member on space deletion', async () => {
    const { ctx, db } = await setup();
    const owner = await ctx.newUser();
    const memberA = await ctx.newUser();
    const memberB = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.user.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: memberA.user.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: memberB.user.id });

    await db.deleteFrom('shared_space').where('id', '=', space.id).execute();

    const rows = await db.selectFrom('shared_space_audit').select(['userId']).where('spaceId', '=', space.id).execute();

    expect(new Set(rows.map((r) => r.userId))).toEqual(new Set([owner.user.id, memberA.user.id, memberB.user.id]));
  });

  it('emits shared_space_audit for a single removed member', async () => {
    // Remove one member from a multi-member space, assert exactly one audit row.
  });

  it('fires shared_space_member_audit on member removal', async () => {
    // Assert a row lands in shared_space_member_audit for the (space, removedUser) pair.
  });

  it('does not double-populate shared_space_audit on space-delete cascade', async () => {
    // Delete a space with two members. Assert shared_space_audit has exactly three rows
    // (creator + two members), not six. Guards the pg_trigger_depth correctness.
  });

  it('does not double-populate shared_space_asset_audit on space-delete cascade', async () => {
    // Delete a space that contains direct-add assets. Assert each (space, asset) pair
    // appears in shared_space_asset_audit exactly once, not twice (no double-fire from
    // the cascade chain shared_space → shared_space_asset).
  });

  it('emits shared_space_asset_audit when an asset is removed from a space directly', async () => {
    // Via direct DELETE on shared_space_asset, assert the audit row lands.
  });

  it('emits shared_space_asset_audit when an asset is hard-deleted and cascades', async () => {
    // Delete the asset row; cascade through asset → shared_space_asset should fire the trigger.
  });
});
```

Fill in the remaining tests following the first one's shape.

**Step 3: Run the tests — they MUST fail**

```bash
cd server && pnpm test:medium -- shared-space-audit-triggers
```

Expected: all seven tests fail because the audit tables stay empty (no triggers populating them yet).

**Step 4: Commit the failing tests**

```bash
git add server/test/medium/specs/sync/shared-space-audit-triggers.spec.ts
git commit -m "test(sync): RED — failing trigger tests for shared-space audits"
```

---

### Task 4: Implement audit triggers (GREEN — make Task 3 tests pass)

**Files:**

- Modify: `server/src/schema/migrations-gallery/1778100000000-SharedSpaceAuditTables.ts`
- Modify: `server/src/schema/functions.ts`
- Modify: `server/src/schema/tables/shared-space.table.ts`
- Modify: `server/src/schema/tables/shared-space-member.table.ts`
- Modify: `server/src/schema/tables/shared-space-asset.table.ts`

**Context:** Add the trigger functions and triggers. The reference pattern is `album_users_delete_audit` at `server/src/schema/migrations/1747664684909-AddAlbumAuditTables.ts:25-67`, BUT the album one was the upstream pattern — fork code uses the newer `registerFunction` + `@AfterDeleteTrigger` decorator pattern (see `album.table.ts`, `album-asset.table.ts`).

**CRITICAL — `pg_trigger_depth()` does NOT distinguish direct from cascade.** When you `DELETE FROM shared_space`, the cascade DELETE on `shared_space_member` fires its trigger at depth=1 — the same value as a direct `DELETE FROM shared_space_member`. The album reference pattern works around this by emitting only the `ownerId` from the parent (because owners are not in `album_user`), but for shared spaces the creator IS in `shared_space_member` so the same trick produces duplicates.

The working solution (verified end-to-end during execution):

1. `shared_space_delete_audit` is a **BEFORE DELETE FOR EACH ROW** trigger on `shared_space` (not AFTER STATEMENT). This fires while `shared_space_member` is still populated for the deleted space. It UNIONs members + creator (DISTINCT) and inserts to `shared_space_audit`. Returns OLD.
2. `shared_space_member_delete_audit` is an AFTER STATEMENT trigger on `shared_space_member`. It always inserts to `shared_space_member_audit`. It also inserts to `shared_space_audit` ONLY if the parent shared_space row still exists: `WHERE EXISTS (SELECT 1 FROM shared_space ss WHERE ss.id = o."spaceId")`. This guard naturally distinguishes direct removal (parent exists) from cascade (parent gone).
3. The `@AfterDeleteTrigger` decorator on `SharedSpaceMemberTable` should NOT have a `when:` clause — let the function body handle the branching.
4. The `SharedSpaceTable` decorator must use `@TriggerFunction({ timing: 'before', actions: ['delete'], scope: 'row', function: shared_space_delete_audit })` since there's no `BeforeDeleteTrigger` shorthand exported by `@immich/sql-tools`.

Don't try to use `pg_trigger_depth() = 1` to detect cascade — depth is 1 in BOTH cases.

**CRITICAL — schema-tools requires four pieces of synchronization.** The sql-tools schema check (`pnpm migrations:debug`) compares the source-side schema (table decorators + registered functions) against the target-side schema (live DB). For trigger functions to pass without drift, you need:

1. **`registerFunction` in `src/schema/functions.ts`** so the source side (`schemaFromCode({ overrides: true })`) generates an override entry with the canonical sql.
2. **`@AfterDeleteTrigger` decorators** on the relevant table classes so the source side knows about the triggers.
3. **`CREATE FUNCTION` + `CREATE TRIGGER`** in the migration so the actual DB has them.
4. **`INSERT INTO migration_overrides`** in the same migration with byte-exact canonical sql so the target side (`schemaFromDatabase`) has matching override entries that compare equal under `haveEqualOverrides()`.

Hand-writing the override sql in step 4 is brittle — every byte of whitespace must match what `processOverrides` produces from step 1's `registerFunction`. The reliable workflow is:

1. Implement steps 1-3 first
2. Run `pnpm migrations:debug`
3. Copy the generated INSERT statements verbatim from the resulting `src/<timestamp>-Migration.ts`
4. Paste them into your migration's `up()`
5. Delete the scratch generated migration file
6. Re-run `pnpm migrations:debug` and confirm "No changes detected"

The SQL below is the right shape; follow steps 1–6 in order.

**Step 1a: Register the trigger functions in `src/schema/functions.ts`**

Append three `registerFunction` calls — these tell the source-side schema generator what trigger functions exist. Use the EXACT body strings shown (including the comments — they're part of the canonical sql comparison and must match the migration's INSERT statements byte-for-byte).

```typescript
export const shared_space_delete_audit = registerFunction({
  name: 'shared_space_delete_audit',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    BEGIN
      -- Fan out one shared_space_audit row per member of each deleted space.
      INSERT INTO shared_space_audit ("spaceId", "userId")
      SELECT ssm."spaceId", ssm."userId"
      FROM shared_space_member ssm
      WHERE ssm."spaceId" IN (SELECT "id" FROM "old");

      -- Plus one row per creator.
      INSERT INTO shared_space_audit ("spaceId", "userId")
      SELECT "id", "createdById" FROM "old";

      RETURN NULL;
    END`,
});

export const shared_space_member_delete_audit = registerFunction({
  /* ... */
});
export const shared_space_asset_delete_audit = registerFunction({
  /* ... */
});
```

**Step 1b: Add `@AfterDeleteTrigger` decorators to the three table classes**

For example on `SharedSpaceTable`:

```typescript
import { AfterDeleteTrigger /* ... */ } from '@immich/sql-tools';
import { shared_space_delete_audit } from 'src/schema/functions';

@Table('shared_space')
@UpdatedAtTrigger('shared_space_updatedAt')
@AfterDeleteTrigger({
  scope: 'statement',
  function: shared_space_delete_audit,
  referencingOldTableAs: 'old',
  when: 'pg_trigger_depth() = 0',
})
export class SharedSpaceTable {
  /* ... */
}
```

`SharedSpaceMemberTable` and `SharedSpaceAssetTable` use `when: 'pg_trigger_depth() <= 1'`. Reference: `server/src/schema/tables/album.table.ts` and `album-asset.table.ts`.

**Step 1c: Add the trigger function CREATE statements to the migration**

Append to `up()` after the `CREATE TABLE` block:

```typescript
await sql`CREATE OR REPLACE FUNCTION shared_space_delete_audit()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
  BEGIN
    -- Fan out one shared_space_audit row per member of each deleted space.
    INSERT INTO shared_space_audit ("spaceId", "userId")
    SELECT ssm."spaceId", ssm."userId"
    FROM shared_space_member ssm
    WHERE ssm."spaceId" IN (SELECT "id" FROM "old");

    -- Plus one row per creator.
    INSERT INTO shared_space_audit ("spaceId", "userId")
    SELECT "id", "createdById" FROM "old";

    RETURN NULL;
  END
$$;`.execute(db);
```

**Step 2: Add `shared_space_member_delete_audit()` function**

```typescript
await sql`CREATE OR REPLACE FUNCTION shared_space_member_delete_audit()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
  BEGIN
    -- Always emit the join-row delete to shared_space_member_audit
    INSERT INTO shared_space_member_audit ("spaceId", "userId")
    SELECT "spaceId", "userId" FROM "old";

    -- Also emit to shared_space_audit, BUT only if this delete is not a cascade
    -- from a parent shared_space delete (depth 1 means we're inside another trigger).
    IF pg_trigger_depth() = 1 THEN
      INSERT INTO shared_space_audit ("spaceId", "userId")
      SELECT "spaceId", "userId" FROM "old";
    END IF;

    RETURN NULL;
  END
$$;`.execute(db);
```

**Step 3: Add `shared_space_asset_delete_audit()` function**

```typescript
await sql`CREATE OR REPLACE FUNCTION shared_space_asset_delete_audit()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
  BEGIN
    INSERT INTO shared_space_asset_audit ("spaceId", "assetId")
    SELECT "spaceId", "assetId" FROM "old";
    RETURN NULL;
  END
$$;`.execute(db);
```

**Step 4: Create the three triggers**

```typescript
await sql`CREATE OR REPLACE TRIGGER "shared_space_delete_audit"
AFTER DELETE ON "shared_space"
REFERENCING OLD TABLE AS "old"
FOR EACH STATEMENT
WHEN (pg_trigger_depth() = 0)
EXECUTE FUNCTION shared_space_delete_audit();`.execute(db);

await sql`CREATE OR REPLACE TRIGGER "shared_space_member_delete_audit"
AFTER DELETE ON "shared_space_member"
REFERENCING OLD TABLE AS "old"
FOR EACH STATEMENT
WHEN (pg_trigger_depth() <= 1)
EXECUTE FUNCTION shared_space_member_delete_audit();`.execute(db);

await sql`CREATE OR REPLACE TRIGGER "shared_space_asset_delete_audit"
AFTER DELETE ON "shared_space_asset"
REFERENCING OLD TABLE AS "old"
FOR EACH STATEMENT
WHEN (pg_trigger_depth() <= 1)
EXECUTE FUNCTION shared_space_asset_delete_audit();`.execute(db);
```

The depth guards (`= 0` for the parent, `<= 1` for the children) prevent double-firing during cascade. This is the same structure as `album_users_delete_audit` at `1747664684909-AddAlbumAuditTables.ts:62-67`.

**Step 5: Generate the canonical override sql via `pnpm migrations:debug`**

At this point your migration creates the functions and triggers, and source side has `registerFunction` + `@AfterDeleteTrigger` decorators. But the schema check will still flag drift because the target side (DB) doesn't have matching `migration_overrides` rows.

Run:

```bash
cd server && pnpm schema:reset && pnpm build && pnpm migrations:run && pnpm migrations:debug
```

Expected: schema-tools writes a scratch `server/src/<timestamp>-Migration.ts` containing:

- A bunch of `DROP TRIGGER ... -- missing in source` and `DROP FUNCTION ... -- missing in source`
- Six `INSERT INTO "migration_overrides" (...)` statements with the canonical sql shapes you need

Open that scratch file. Copy out the six INSERT statements verbatim (including all the `\n` and `\\"` escapes — they encode the canonical whitespace). Paste them into your migration's `up()` after the `CREATE TRIGGER` block.

Then `rm server/src/<timestamp>-Migration.ts` and re-run:

```bash
pnpm schema:reset && pnpm build && pnpm migrations:run && pnpm migrations:debug
```

Expected: `No changes detected`.

**Step 6: Add the matching `DELETE FROM migration_overrides` to `down()`**

```typescript
await sql`DELETE FROM "migration_overrides" WHERE "name" IN (
  'function_shared_space_delete_audit',
  'function_shared_space_member_delete_audit',
  'function_shared_space_asset_delete_audit',
  'trigger_shared_space_delete_audit',
  'trigger_shared_space_member_delete_audit',
  'trigger_shared_space_asset_delete_audit'
)`.execute(db);
```

This goes BEFORE the `DROP TRIGGER` statements in `down()`.

**Step 7: Implement `down()`**

Update the `down()` to drop triggers and functions in reverse order, then the tables.

```typescript
await sql`DROP TRIGGER IF EXISTS "shared_space_asset_delete_audit" ON "shared_space_asset";`.execute(db);
await sql`DROP TRIGGER IF EXISTS "shared_space_member_delete_audit" ON "shared_space_member";`.execute(db);
await sql`DROP TRIGGER IF EXISTS "shared_space_delete_audit" ON "shared_space";`.execute(db);
await sql`DROP FUNCTION IF EXISTS shared_space_asset_delete_audit();`.execute(db);
await sql`DROP FUNCTION IF EXISTS shared_space_member_delete_audit();`.execute(db);
await sql`DROP FUNCTION IF EXISTS shared_space_delete_audit();`.execute(db);
await sql`DROP TABLE IF EXISTS "shared_space_asset_audit";`.execute(db);
await sql`DROP TABLE IF EXISTS "shared_space_member_audit";`.execute(db);
await sql`DROP TABLE IF EXISTS "shared_space_audit";`.execute(db);
```

**Step 8: Re-run the migration and test it**

```bash
cd server && pnpm schema:reset && pnpm build && pnpm migrations:run
pnpm test:medium -- shared-space-audit-triggers
```

Expected: all seven tests now pass. Pre-existing exif test failures (3) are unrelated and can be ignored.

**Important — testcontainers can kill the dev DB.** During `pnpm test:medium`, the testcontainers runtime creates short-lived Postgres containers. If you have the dev stack running, the medium test run may bring down the dev `database` container or its volume. After running medium tests, verify the dev DB is still up before continuing:

```bash
docker compose -f /home/pierre/dev/gallery/docker/docker-compose.dev.yml ps
```

If `database` is missing, restart the dev stack and re-apply migrations:

```bash
cd /home/pierre/dev/gallery/docker && docker compose -f docker-compose.dev.yml up -d database
cd /home/pierre/dev/gallery/.worktrees/<your-worktree>/server && pnpm schema:reset
```

**Step 9: Test the rollback path**

```bash
cd server && pnpm migrations:revert
docker compose -f docker/docker-compose.dev.yml exec database psql -U postgres -d immich -c "\dt shared_space_*_audit"
```

Expected: zero rows — the three audit tables are gone. Then re-apply:

```bash
pnpm migrations:run
```

Expected: clean re-application.

**Step 8: Commit**

```bash
git add server/src/schema/migrations-gallery/1778100000000-SharedSpaceAuditTables.ts
git commit -m "feat(sync): GREEN — implement shared-space audit triggers"
```

---

### Task 5: Create `SharedSpaceSync` class (with tests)

**Files:**

- Modify: `server/src/repositories/sync.repository.ts` (add new class + shared `accessibleSpaces` helper)
- Create: `server/test/medium/specs/sync/sync-shared-space.spec.ts`

**Context:** `SharedSpaceSync` mirrors `AlbumSync`. Find the class with `grep -n "class AlbumSync" server/src/repositories/sync.repository.ts` and read it in full before writing the new one.

**Important — `accessibleSpaces` helper placement.** This task introduces the `ACCESSIBLE_SPACES(userId)` subquery that ALL five PR 1 sync classes will use. To prevent the divergence the design doc flags as a risk, define it ONCE — either as a free function in `sync.repository.ts` (alongside the existing class definitions) or as a static method on a new helper class. Do NOT define it inside `SharedSpaceSync` — Tasks 6, 7, 8, and 9 cannot reference a private method on a sibling class. The simplest pattern: a top-level function in the same file:

```typescript
function accessibleSpaces<EB extends ExpressionBuilder<DB, never>>(eb: EB, userId: string) {
  return eb
    .selectFrom('shared_space')
    .select('id')
    .where('createdById', '=', userId)
    .union((eb) =>
      eb.parens(
        eb
          .selectFrom('shared_space_member')
          .select('shared_space_member.spaceId as id')
          .where('shared_space_member.userId', '=', userId),
      ),
    );
}
```

**Step 1: Write the failing test**

Create `server/test/medium/specs/sync/sync-shared-space.spec.ts`. Base it on `sync-album.spec.ts`. Tests to include:

- `should sync a shared space with the correct properties` — creator syncs, space appears in response.
- `should sync a shared space to a member who is not the creator` — second user joins, space appears in their sync.
- `should sync an updated shared space when properties change` — `getUpdates` returns the row after a name/description edit.
- `should not sync a shared space to a user with no access` — third user runs sync, receives no shared-space rows.
- `should emit SharedSpaceDeleteV1 to a user when they are removed from a space` — reads from `shared_space_audit`.
- `should emit SharedSpaceDeleteV1 to all members when a space is deleted` — cascade fan-out test.

Test file shape follows `sync-album.spec.ts` exactly.

**Step 2: Run tests to verify they fail**

```bash
cd server && pnpm test:medium -- sync-shared-space
```

Expected: all tests fail because `SharedSpaceSync` doesn't exist yet.

**Step 3: Implement `SharedSpaceSync` and the `accessibleSpaces` helper**

In `server/src/repositories/sync.repository.ts`:

1. Add the top-level `accessibleSpaces` helper function (see Important section above).
2. Add a new class `SharedSpaceSync extends BaseSync` immediately after `AlbumSync`. Copy `AlbumSync`'s structure exactly, substituting:
   - `albums` → `shared_space`
   - `albums_audit` → `shared_space_audit`
   - `album_user` → `shared_space_member`
   - Use the `accessibleSpaces` helper for the WHERE clause in `getCreates`/`getUpdates` (e.g., `.where('shared_space.id', 'in', accessibleSpaces(eb, userId))`)
   - Column selection: `id, name, description, color, createdById, thumbnailAssetId, thumbnailCropY, faceRecognitionEnabled, petsEnabled, lastActivityAt, createdAt, updatedAt, updateId`
3. `getDeletes` reads `FROM shared_space_audit WHERE userId = :userId` — simple, no membership join.

Add to the `SyncRepository` class constructor and property:

```typescript
sharedSpace: SharedSpaceSync;
// ...
this.sharedSpace = new SharedSpaceSync(this.db);
```

**Step 4: Run tests to verify they pass**

```bash
cd server && pnpm test:medium -- sync-shared-space
```

Expected: all five tests pass.

**Step 5: Commit**

```bash
git add server/src/repositories/sync.repository.ts \
        server/test/medium/specs/sync/sync-shared-space.spec.ts
git commit -m "feat(sync): add SharedSpaceSync repository class"
```

---

### Task 6: Create `SharedSpaceMemberSync` class (with tests)

**Files:**

- Modify: `server/src/repositories/sync.repository.ts`
- Create: `server/test/medium/specs/sync/sync-shared-space-member.spec.ts`

**Context:** Mirror `AlbumUserSync` (find via `grep -n "class AlbumUserSync" server/src/repositories/sync.repository.ts`). Read it first.

**Step 1: Write the failing tests**

Tests to include:

- `getBackfill` returns all members of a specific space.
- `getCreates` emits new member rows for spaces the user has access to.
- `getUpdates` emits a member row when the role or `showInTimeline` setting is changed.
- `getDeletes` reads from `shared_space_member_audit WHERE userId = :userId`.
- Explicitly excludes `lastViewedAt` from emitted columns — assert the response payload keys do not include `lastViewedAt`.

Reference `sync-album-user.spec.ts` for structure.

**Step 2: Run tests — they fail**

**Step 3: Implement**

Add `SharedSpaceMemberSync extends BaseSync` mirroring `AlbumUserSync`. Column selection: `spaceId, userId, role, joinedAt, showInTimeline, updateId`. Use the `accessibleSpaces` helper from Task 5 — do NOT redefine it.

**Step 4: Run tests — they pass**

**Step 5: Commit**

```bash
git commit -m "feat(sync): add SharedSpaceMemberSync repository class"
```

---

### Task 7: Create `SharedSpaceAssetSync` class (with tests)

**Files:**

- Modify: `server/src/repositories/sync.repository.ts`
- Create: `server/test/medium/specs/sync/sync-shared-space-asset.spec.ts`

**Context:** Mirror `AlbumAssetSync` (find via `grep -n "class AlbumAssetSync" server/src/repositories/sync.repository.ts`). Streams full asset rows scoped through `shared_space_asset` joined to `asset`.

**Step 1: Write the failing tests**

- `getCreates` emits foreign asset rows (owned by anyone) for assets in a space the user is a member of.
- `getCreates` does not emit asset rows from spaces the user is not in.
- `getCreates` does NOT filter by `asset.ownerId` — assert that an asset owned by userA is emitted to userB when both are in the same space.
- `getCreates` emits the same asset once per `shared_space_asset` row for assets added to multiple accessible spaces (documents the accepted write amplification — the test ASSERTS `.toHaveLength(N)` rather than `.toHaveLength(1)` to lock in the expected behavior).
- `getUpdates` emits an asset row after a metadata field changes (e.g., asset is favorited or modified).

Reference `sync-album-asset.spec.ts`.

**Step 2: Run tests — they fail**

**Step 3: Implement**

Add `SharedSpaceAssetSync extends BaseSync`. Full asset column selection via `columns.syncAsset`. Scoping: inner-join `shared_space_asset → asset`, leftJoin through `shared_space` and `shared_space_member`, WHERE OR on creator/member.

**Step 4: Run tests — they pass**

**Step 5: Commit**

```bash
git commit -m "feat(sync): add SharedSpaceAssetSync repository class"
```

---

### Task 8: Create `SharedSpaceAssetExifSync` class (with tests)

**Files:**

- Modify: `server/src/repositories/sync.repository.ts`
- Create: `server/test/medium/specs/sync/sync-shared-space-asset-exif.spec.ts`

**Context:** Mirror `AlbumAssetExifSync` (find via `grep -n "class AlbumAssetExifSync" server/src/repositories/sync.repository.ts`). Streams `asset_exif` rows for assets in accessible spaces, with ack-sequenced ordering relative to `SharedSpaceAssetSync`.

**Step 1: Write the failing tests**

Mirror `sync-album-asset-exif.spec.ts`:

- `getBackfill` returns exif rows for assets in a specific space.
- `getCreates` emits exif rows scoped by space membership.
- `getUpdates` uses `ack.updateId <= sharedSpaceToAssetAck.updateId` to avoid emitting exif for assets the client hasn't acked yet.
- `getUpdates` correctly emits a new exif row when an asset's exif is updated server-side after the previous ack.

**Step 2 — 5:** follow the same red → green → commit flow.

```bash
git commit -m "feat(sync): add SharedSpaceAssetExifSync repository class"
```

---

### Task 9: Create `SharedSpaceToAssetSync` class (with tests)

**Files:**

- Modify: `server/src/repositories/sync.repository.ts`
- Create: `server/test/medium/specs/sync/sync-shared-space-to-asset.spec.ts`

**Context:** Mirror `AlbumToAssetSync` (find via `grep -n "class AlbumToAssetSync" server/src/repositories/sync.repository.ts`). Streams the join rows `(spaceId, assetId, updateId)`. `getDeletes` reads from `shared_space_asset_audit`.

**Step 1 — 5:** Mirror `AlbumToAssetSync`. Test cases:

- `getBackfill` returns join rows for a space.
- `getCreates` emits new join rows for accessible spaces.
- `getDeletes` includes entries from `shared_space_asset_audit` scoped by `spaceId IN accessible_spaces(userId)`.
- `getDeletes` does not include join rows from unrelated spaces (even if the audit table has them).

```bash
git commit -m "feat(sync): add SharedSpaceToAssetSync repository class"
```

---

### Task 10: Wire the five new sync classes into `SyncService`

**Files:**

- Modify: `server/src/services/sync.service.ts`

**Context:** `SyncService.stream` dispatches sync request types to per-entity handler methods. Find it via `grep -n "stream(" server/src/services/sync.service.ts` and locate the outer `switch` over `type`. Each family has its own `syncX` private method (e.g., `syncAlbumsV1`, `syncAlbumAssetsV1`). Add parallel private methods for the five new families.

**Step 1: Read the reference handlers**

Read `syncAlbumsV1`, `syncAlbumUsersV1`, `syncAlbumAssetsV1`, `syncAlbumAssetExifsV1`, `syncAlbumToAssetsV1` in `sync.service.ts`. Note:

- Each uses a `checkpointMap` keyed by `SyncEntityType`.
- Backfill methods iterate over a list of new parent entities (`this.syncRepository.album.getCreatedAfter`) and stream per-parent.
- `sendEntityBackfillCompleteAck` marks per-entity completion.
- The `case` statement in the outer dispatch picks which handlers run per requested entity type.

**Step 2: Implement five new private methods**

Add, in order:

- `syncSharedSpacesV1` — mirrors `syncAlbumsV1`. Emits creates/updates/deletes.
- `syncSharedSpaceMembersV1` — mirrors `syncAlbumUsersV1`. Backfill is per-space.
- `syncSharedSpaceAssetsV1` — mirrors `syncAlbumAssetsV1`. Backfill is per-space.
- `syncSharedSpaceAssetExifsV1` — mirrors `syncAlbumAssetExifsV1`. Ack-sequenced after shared-space asset creates.
- `syncSharedSpaceToAssetsV1` — mirrors `syncAlbumToAssetsV1`. Backfill is per-space.

**Step 3: Wire into the dispatch case statement**

In `SyncService.stream`, find the outer `switch` on `type`. Add new case arms for each `SyncRequestType.SharedSpaceXV1`, calling the matching `syncSharedSpaceXV1` method.

**Step 4: Run the existing sync service tests to confirm no regression**

```bash
cd server && pnpm test -- sync.service
```

Expected: passes.

**Step 5: Commit**

```bash
git add server/src/services/sync.service.ts
git commit -m "feat(sync): wire shared-space sync handlers into SyncService"
```

---

### Task 11: Add `SyncAckV1` DTOs and regenerate OpenAPI

**Files:**

- Modify: `server/src/dtos/sync.dto.ts` (add DTOs for each new entity type)
- Regenerate: `open-api/typescript-sdk/*`, `mobile/openapi/*`

**Prerequisite:** `java --version` must succeed. The Dart OpenAPI generator requires Java; without it `make open-api` fails silently with no Dart output. Install Java first if needed.

**Context:** Each `SyncEntityType` family needs a DTO defining the payload shape the client receives. Reference the existing `SyncAlbumV1`, `SyncAlbumUserV1`, `SyncAlbumAssetV1`, etc. DTOs in `sync.dto.ts`.

**Step 1: Add the DTOs**

For each new family, add a class mirroring its album counterpart. Name them `SyncSharedSpaceV1`, `SyncSharedSpaceDeleteV1`, `SyncSharedSpaceMemberV1`, etc.

**Step 2: Regenerate OpenAPI**

```bash
cd server && pnpm build && pnpm sync:open-api
cd .. && make open-api
```

Expected: generates new TypeScript SDK types in `open-api/typescript-sdk/` and new Dart classes under `mobile/openapi/`.

**Step 3: Verify the build**

```bash
cd server && pnpm check
cd ../mobile && dart analyze
```

Expected: both pass.

**Step 4: Commit**

```bash
git add server/src/dtos/sync.dto.ts open-api/ mobile/openapi/
git commit -m "feat(sync): add shared-space sync DTOs and regenerate OpenAPI"
```

---

### Task 12: Create mobile Drift entities for shared spaces

**Files:**

- Create: `mobile/lib/infrastructure/entities/shared_space.entity.dart`
- Create: `mobile/lib/infrastructure/entities/shared_space_member.entity.dart`
- Create: `mobile/lib/infrastructure/entities/shared_space_asset.entity.dart`

**Context:** Mirror `remote_album.entity.dart` and `remote_album_asset.entity.dart`. Use Drift's `Table` base class and the `@DataClassName` annotation.

**Step 1: Read the reference entities**

Read:

- `mobile/lib/infrastructure/entities/remote_album.entity.dart`
- `mobile/lib/infrastructure/entities/remote_album_asset.entity.dart`
- `mobile/lib/infrastructure/entities/remote_album_user.entity.dart`

**Step 2: Create `shared_space.entity.dart`**

```dart
import 'package:drift/drift.dart';
import 'package:immich_mobile/infrastructure/entities/user.entity.dart';
import 'package:immich_mobile/infrastructure/utils/drift_default.mixin.dart';

class SharedSpaceEntity extends Table with DriftDefaultsMixin {
  const SharedSpaceEntity();

  TextColumn get id => text()();
  TextColumn get name => text()();
  TextColumn get description => text().nullable()();
  TextColumn get color => text()();
  TextColumn get createdById => text().references(UserEntity, #id, onDelete: KeyAction.cascade)();
  TextColumn get thumbnailAssetId => text().nullable()();
  RealColumn get thumbnailCropY => real().nullable()();
  BoolColumn get faceRecognitionEnabled => boolean().withDefault(const Constant(true))();
  BoolColumn get petsEnabled => boolean().withDefault(const Constant(false))();
  DateTimeColumn get lastActivityAt => dateTime().nullable()();
  DateTimeColumn get createdAt => dateTime()();
  DateTimeColumn get updatedAt => dateTime()();

  @override
  Set<Column> get primaryKey => {id};
}
```

Match column types against `server/src/schema/tables/shared-space.table.ts` — any column nullable on the server is nullable here.

**Step 3: Create `shared_space_member.entity.dart`**

```dart
class SharedSpaceMemberEntity extends Table with DriftDefaultsMixin {
  const SharedSpaceMemberEntity();

  TextColumn get spaceId => text().references(SharedSpaceEntity, #id, onDelete: KeyAction.cascade)();
  TextColumn get userId => text().references(UserEntity, #id, onDelete: KeyAction.cascade)();
  TextColumn get role => text()();
  DateTimeColumn get joinedAt => dateTime()();
  BoolColumn get showInTimeline => boolean().withDefault(const Constant(true))();

  @override
  Set<Column> get primaryKey => {spaceId, userId};
}
```

**Step 4: Create `shared_space_asset.entity.dart`**

```dart
class SharedSpaceAssetEntity extends Table with DriftDefaultsMixin {
  const SharedSpaceAssetEntity();

  TextColumn get spaceId => text().references(SharedSpaceEntity, #id, onDelete: KeyAction.cascade)();
  // Intentionally NO references() on assetId — see design doc "Sync ordering" section.
  TextColumn get assetId => text()();

  @override
  Set<Column> get primaryKey => {spaceId, assetId};
}
```

**Step 5: Verify the files compile standalone**

```bash
cd mobile && dart analyze lib/infrastructure/entities/shared_space*.entity.dart
```

Expected: no errors. (Warnings about unused code are OK at this stage.)

**Step 6: Commit**

```bash
git add mobile/lib/infrastructure/entities/shared_space*.entity.dart
git commit -m "feat(mobile): add Drift entities for shared spaces"
```

---

### Task 13: Register the new entities and add a Drift migration step

**Files:**

- Modify: `mobile/lib/infrastructure/repositories/db.repository.dart`
- Regenerate: `mobile/lib/infrastructure/repositories/db.repository.drift.dart` (auto by build_runner)
- Regenerate: `mobile/lib/infrastructure/repositories/db.repository.steps.dart` (auto by `drift_dev schema steps`)
- Create: `mobile/drift_schemas/main/drift_schema_v{N+1}.json` (via `drift_dev schema dump`)
- Create: `mobile/test/drift/main/generated/schema_v{N+1}.dart` (via `drift_dev schema generate`)

**CRITICAL — `db.repository.steps.dart` is generated, NOT hand-edited.** Old plan revisions wrongly suggested adding the migration step lambda directly to that file. The actual workflow:

1. Add the migration step lambda to the `MigrationStrategy onUpgrade` block in **`db.repository.dart`** (the `from{N}To{N+1}` named parameter passed to `migrationSteps(...)`).
2. Bump `schemaVersion` in the same file.
3. Run `dart run build_runner build --delete-conflicting-outputs` to regenerate `db.repository.drift.dart` and the entity `.drift.dart` files. This does NOT update `db.repository.steps.dart`.
4. Dump a new schema snapshot: `dart run drift_dev schema dump lib/infrastructure/repositories/db.repository.dart drift_schemas/main/`. This produces `drift_schemas/main/drift_schema_v{N+1}.json`.
5. Regenerate the steps file from all dumps: `dart run drift_dev schema steps drift_schemas/main/ lib/infrastructure/repositories/db.repository.steps.dart`. This rewrites the entire steps file based on the JSON dumps in `drift_schemas/main/`.
6. Regenerate the test fixture: `dart run drift_dev schema generate test/drift/main/generated/ test/drift/main/generated/`. This creates `test/drift/main/generated/schema_v{N+1}.dart`.

**Pitfall 1**: `dart run drift_dev schema steps <wrong_dir> <output>` (e.g., pointing at `test/drift/main/generated/`) will silently CLOBBER the steps file with an empty stub. If this happens, `git checkout HEAD -- mobile/lib/infrastructure/repositories/db.repository.steps.dart` to revert and retry with the correct path (`drift_schemas/main/`).

**Pitfall 2**: `dart run drift_dev schema generate <wrong_input> <output>` is equally destructive. The input must be the JSON dump directory (`drift_schemas/main/`), NOT the existing test fixtures directory. If you point it at `test/drift/main/generated/`, it will only see the newest dump (the one you just wrote there) and clobber `schema.dart` to contain only that single version — breaking `migration_test.dart` because `GeneratedHelper.versions` will list only `[N+1]` instead of `[1..N+1]`. The correct invocation is `dart run drift_dev schema generate drift_schemas/main/ test/drift/main/generated/`. Recovery: re-run with the correct input dir.

**Step 1: Register the tables on the Drift database class**

In `db.repository.dart`, find the `@DriftDatabase` annotation. Add the three new entity classes to the `tables:` list. Add the matching imports at the top of the file.

**Step 2: Add a migration step in `db.repository.dart`**

Find the latest migration step (e.g., `from21To22` in the `MigrationStrategy onUpgrade` block). Append the new step:

```dart
from{N}To{N+1}: (m, v{N+1}) async {
  await m.createTable(v{N+1}.sharedSpaceEntity);
  await m.createTable(v{N+1}.sharedSpaceMemberEntity);
  await m.createTable(v{N+1}.sharedSpaceAssetEntity);
  await m.createIndex(v{N+1}.idxSharedSpaceCreatedById);
  await m.createIndex(v{N+1}.idxSharedSpaceAssetSpaceAsset);
},
```

The exact index variable names (`idxSharedSpaceCreatedById`, `idxSharedSpaceAssetSpaceAsset`) come from the `@TableIndex.sql(...)` annotations on the entity classes; drift*dev names them by stripping `idx*` prefix and camelCasing.

Bump `schemaVersion` from `{N}` to `{N+1}` in the same file.

**Step 3: Regenerate Drift code** (`build_runner`)

```bash
cd mobile && dart run build_runner build --delete-conflicting-outputs
```

**Step 4: Dump the new schema and regenerate the steps file** (`drift_dev`)

```bash
dart run drift_dev schema dump lib/infrastructure/repositories/db.repository.dart drift_schemas/main/
dart run drift_dev schema steps drift_schemas/main/ lib/infrastructure/repositories/db.repository.steps.dart
dart run drift_dev schema generate drift_schemas/main/ test/drift/main/generated/
```

NOTE: the third command's INPUT is `drift_schemas/main/` (the JSON dumps), not `test/drift/main/generated/`. See Pitfall 2 in the CRITICAL block above.

**Step 5: Run the migration test to verify the new step works**

```bash
flutter test test/drift/main/migration_test.dart
```

Expected: every consecutive `from N to N+1` migration passes, including the new `from {N} to {N+1}`. If this fails, the migration step in Step 2 is wrong (likely a bad index variable name or missing table create).

**Step 6: Verify the app compiles**

```bash
cd mobile && dart analyze lib/infrastructure/repositories/db.repository.dart
```

Expected: "No issues found".

**Step 7: Commit**

```bash
git add mobile/lib/infrastructure/repositories/db.repository.dart \
        mobile/lib/infrastructure/repositories/db.repository.drift.dart \
        mobile/lib/infrastructure/repositories/db.repository.steps.dart \
        mobile/lib/infrastructure/entities/shared_space*.entity.drift.dart \
        mobile/drift_schemas/main/drift_schema_v{N+1}.json \
        mobile/test/drift/main/generated/schema_v{N+1}.dart \
        mobile/test/drift/main/generated/schema.dart
git commit -m "feat(mobile): register shared-space Drift tables with migration step"
```

---

### Task 14: Write Drift query tests for `sharedSpace()` (RED)

**Files:**

- Create: `mobile/test/infrastructure/repositories/shared_space_repository_test.dart`

**Context:** Reference `mobile/test/infrastructure/repositories/remote_album_repository_test.dart` for the test shape. Mobile tests use an in-memory Drift DB via `MediumRepositoryContext`.

**Step 1: Write the failing tests**

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/constants/enums.dart';
import 'package:immich_mobile/infrastructure/repositories/timeline.repository.dart';
import '../../medium/repository_context.dart';

void main() {
  late MediumRepositoryContext ctx;
  late DriftTimelineRepository sut;

  setUp(() async {
    ctx = MediumRepositoryContext();
    sut = DriftTimelineRepository(ctx.db);
  });

  tearDown(() async {
    await ctx.dispose();
  });

  group('sharedSpace() TimelineQuery', () {
    late String userId;
    late String spaceId;

    setUp(() async {
      final user = await ctx.newUser();
      userId = user.id;
      final space = await ctx.newSharedSpace(createdById: userId);
      spaceId = space.id;
    });

    test('returns empty bucket list for a space with no assets', () async {
      final query = sut.sharedSpace(spaceId, GroupAssetsBy.day);
      final buckets = await query.bucketSource().first;
      expect(buckets, isEmpty);
    });

    test('returns bucket counts grouped by day', () async {
      final asset1 = await ctx.newRemoteAsset(
        ownerId: userId,
        createdAt: DateTime(2026, 4, 1, 12),
      );
      final asset2 = await ctx.newRemoteAsset(
        ownerId: userId,
        createdAt: DateTime(2026, 4, 1, 18),
      );
      final asset3 = await ctx.newRemoteAsset(
        ownerId: userId,
        createdAt: DateTime(2026, 4, 2, 9),
      );
      await ctx.insertSharedSpaceAsset(spaceId: spaceId, assetId: asset1.id);
      await ctx.insertSharedSpaceAsset(spaceId: spaceId, assetId: asset2.id);
      await ctx.insertSharedSpaceAsset(spaceId: spaceId, assetId: asset3.id);

      final query = sut.sharedSpace(spaceId, GroupAssetsBy.day);
      final buckets = await query.bucketSource().first;

      expect(buckets, hasLength(2));
      expect(buckets[0].assetCount, 1); // April 2
      expect(buckets[1].assetCount, 2); // April 1
    });

    test('returns assets ordered by createdAt DESC with offset/limit', () async {
      // ... create 5 assets on different days, request offset=1 count=2,
      // assert the middle slice is returned.
    });

    test('returns assets from multiple owners (foreign assets)', () async {
      // ... insert an asset owned by a different user, assert it appears.
    });

    test('returns NO assets when querying a different space', () async {
      // Create a second space, insert assets into it via newSharedSpace + insertSharedSpaceAsset.
      // Query the FIRST space's timeline. Assert it returns zero buckets and zero assets.
      // This locks in the per-space scoping property — without it, the query could leak across spaces.
    });
  });
}
```

Note: `insertSharedSpaceAsset` and `newSharedSpace` were verified or added to `MediumRepositoryContext` in Task 0. If you're hitting "method not found" errors, return to Task 0.

**Step 2: Run the tests**

```bash
cd mobile && flutter test test/infrastructure/repositories/shared_space_repository_test.dart
```

Expected: all fail because `DriftTimelineRepository.sharedSpace()` doesn't exist yet.

**Step 3: Commit the failing tests**

```bash
git add mobile/test/infrastructure/repositories/shared_space_repository_test.dart \
        mobile/test/medium/repository_context.dart
git commit -m "test(mobile): failing Drift tests for sharedSpace() TimelineQuery"
```

---

### Task 15: Implement `DriftTimelineRepository.sharedSpace()` (GREEN)

**Files:**

- Modify: `mobile/lib/infrastructure/repositories/timeline.repository.dart`
- Modify: `mobile/lib/domain/services/timeline.service.dart` (add `TimelineOrigin.remoteSpace` if not already present; add factory method)

**Context:** Mirror `remoteAlbum()` exactly (find via `grep -n "remoteAlbum\b" mobile/lib/infrastructure/repositories/timeline.repository.dart`), substituting `remoteAlbumAssetEntity` → `sharedSpaceAssetEntity` and dropping the album-order logic (spaces have no order setting in PR 1).

**Step 1: Add `TimelineOrigin.remoteSpace` if missing**

Grep for `TimelineOrigin` in `mobile/lib/domain/services/timeline.service.dart`. If `remoteSpace` is not already an enum value (it likely is, since `fromAssetsWithBuckets` uses it), skip. Otherwise add it.

**Step 2: Implement `sharedSpace()`**

Add to `DriftTimelineRepository` immediately after `remoteAlbum()`:

```dart
TimelineQuery sharedSpace(String spaceId, GroupAssetsBy groupBy) => (
  bucketSource: () => _watchSharedSpaceBucket(spaceId, groupBy: groupBy),
  assetSource: (offset, count) =>
      _getSharedSpaceBucketAssets(spaceId, offset: offset, count: count),
  origin: TimelineOrigin.remoteSpace,
);

Stream<List<Bucket>> _watchSharedSpaceBucket(String spaceId, {GroupAssetsBy groupBy = GroupAssetsBy.day}) {
  if (groupBy == GroupAssetsBy.none) {
    throw UnsupportedError("GroupAssetsBy.none is not supported for sharedSpace");
  }

  final assetCountExp = _db.remoteAssetEntity.id.count();
  final dateExp = _db.remoteAssetEntity.effectiveCreatedAt(groupBy);

  final query = _db.remoteAssetEntity.selectOnly()
    ..addColumns([assetCountExp, dateExp])
    ..join([
      innerJoin(
        _db.sharedSpaceAssetEntity,
        _db.sharedSpaceAssetEntity.assetId.equalsExp(_db.remoteAssetEntity.id),
        useColumns: false,
      ),
    ])
    ..where(_db.remoteAssetEntity.deletedAt.isNull() & _db.sharedSpaceAssetEntity.spaceId.equals(spaceId))
    ..groupBy([dateExp])
    ..orderBy([OrderingTerm.desc(dateExp)]);

  return query.map((row) {
    final timeline = row.read(dateExp)!.truncateDate(groupBy);
    final assetCount = row.read(assetCountExp)!;
    return TimeBucket(date: timeline, assetCount: assetCount);
  }).watch();
}

Future<List<BaseAsset>> _getSharedSpaceBucketAssets(String spaceId, {required int offset, required int count}) async {
  final query = _db.remoteAssetEntity.select().addColumns([_db.localAssetEntity.id]).join([
    innerJoin(
      _db.sharedSpaceAssetEntity,
      _db.sharedSpaceAssetEntity.assetId.equalsExp(_db.remoteAssetEntity.id),
      useColumns: false,
    ),
    leftOuterJoin(
      _db.localAssetEntity,
      _db.remoteAssetEntity.checksum.equalsExp(_db.localAssetEntity.checksum),
      useColumns: false,
    ),
  ])
    ..where(_db.remoteAssetEntity.deletedAt.isNull() & _db.sharedSpaceAssetEntity.spaceId.equals(spaceId))
    ..orderBy([OrderingTerm.desc(_db.remoteAssetEntity.createdAt)])
    ..limit(count, offset: offset);

  return query
      .map((row) => row.readTable(_db.remoteAssetEntity).toDto(localId: row.read(_db.localAssetEntity.id)))
      .get();
}
```

**Step 3: Add `sharedSpace` to `TimelineFactory`**

In `mobile/lib/domain/services/timeline.service.dart`, find the `TimelineFactory` class (`grep -n "class TimelineFactory" mobile/lib/domain/services/timeline.service.dart`) and add:

```dart
TimelineService sharedSpace({required String spaceId}) =>
    TimelineService(_timelineRepository.sharedSpace(spaceId, groupBy));
```

**Step 4: Run the tests**

```bash
cd mobile && flutter test test/infrastructure/repositories/shared_space_repository_test.dart
```

Expected: all pass.

**Step 5: Commit**

```bash
git add mobile/lib/infrastructure/repositories/timeline.repository.dart \
        mobile/lib/domain/services/timeline.service.dart
git commit -m "feat(mobile): add DriftTimelineRepository.sharedSpace() and factory method"
```

---

### Task 16: Add mobile sync stream handlers for shared spaces (RED)

**Files:**

- Create: a new failing test group in `mobile/test/infrastructure/repositories/sync_stream_repository_test.dart` (or create the file if it doesn't exist — check first)
- Modify: `mobile/lib/infrastructure/repositories/sync_stream.repository.dart`

**Context:** Reference the existing `updateAlbumsV1` / `deleteAlbumsV1` / `updateAlbumUsersV1` / `updateAlbumToAssetsV1` methods in `sync_stream.repository.dart`. Each is a Drift batch transaction.

**Step 1: Check if a sync stream test file exists**

```bash
ls mobile/test/infrastructure/repositories/sync_stream_repository_test.dart 2>&1
```

If absent, create it using the `MediumRepositoryContext` pattern from other tests.

**Step 2: Write failing tests for each handler**

Tests needed:

- `updateSharedSpacesV1` inserts new rows and upserts existing ones (idempotent).
- `deleteSharedSpacesV1` removes rows and cascades to `shared_space_member` + `shared_space_asset`.
- `updateSharedSpaceMembersV1` inserts and upserts.
- `deleteSharedSpaceMembersV1` removes the (space, user) pair.
- `updateSharedSpaceAssetsV1` delegates to the shared asset-upsert helper (used by the existing `updateAssetsV1` too).
- `updateSharedSpaceAssetExifsV1` inserts/upserts into `remoteExifEntity`.
- `updateSharedSpaceToAssetsV1` inserts join rows. An out-of-order insert (join row before asset row exists) does NOT crash.
- `deleteSharedSpaceToAssetsV1` removes join rows.

**Step 3: Run tests — they fail**

**Step 4: Implement the handlers**

Add the eight new methods to `SyncStreamRepository`. Each is a Drift batch transaction mirroring the album counterpart.

For `updateSharedSpaceAssetsV1`, extract a shared helper `_upsertRemoteAsset(batch, dto)` from the existing `updateAssetsV1` logic if one doesn't already exist, and reuse it for both paths. This is the shared-helper refactor the design doc flags.

**Step 5: Run tests — they pass**

**Step 6: Commit**

```bash
git commit -m "feat(mobile): add sync stream handlers for shared-space entities"
```

---

### Task 17: Wire the handlers into the sync dispatch loop

**Files:**

- Modify: `mobile/lib/infrastructure/repositories/sync_stream.repository.dart` (or wherever the `SyncEntityType` → handler dispatch lives; grep for `SyncEntityType.AlbumV1` to find it)

**Step 1: Find the dispatch site**

```bash
grep -rni "SyncEntityType\.albumV1" mobile/lib/infrastructure/repositories/ 2>&1
```

The exact casing of the Dart enum value depends on how the OpenAPI generator emits it (camelCase by Dart convention). The grep is case-insensitive (`-i`) to find it regardless.

**Step 2: Add new case arms**

For each new `SyncEntityType` value added in Task 1, add a dispatch arm calling the matching handler. Mirror the existing album dispatch exactly.

**Step 3: Verify the dispatch compiles and existing tests pass**

```bash
cd mobile && dart analyze && flutter test test/infrastructure/repositories/
```

**Step 4: Commit**

```bash
git commit -m "feat(mobile): dispatch shared-space sync events to new handlers"
```

---

### Task 18: Confirm unknown `SyncEntityType` values don't crash the mobile coordinator

**Files:**

- Modify: `mobile/test/infrastructure/repositories/sync_stream_repository_test.dart` (add regression test)
- Potentially modify: `mobile/lib/infrastructure/repositories/sync_stream.repository.dart` (only if dispatch crashes)

**Context:** The design doc Risk section flags: "the single-release assumption is enforced by convention, not mechanism. Confirm during PR 1 review that the existing mobile sync coordinator ignores unknown `SyncEntityType` values gracefully."

**Step 1: Inspect the dispatch**

Read the switch / case handling new-entity-type dispatch (found in Task 17). Check whether the default arm throws, logs + continues, or silently ignores.

**Step 2: Add a regression test**

Add to `mobile/test/infrastructure/repositories/sync_stream_repository_test.dart` (under a new `group('unknown SyncEntityType handling', ...)`):

```dart
test('dispatching an unknown SyncEntityType does not crash and advances the ack', () async {
  final ctx = MediumRepositoryContext();
  final coordinator = ctx.syncStreamCoordinator; // or however the dispatch is exposed

  // Construct a sync event whose `type` field is a string the enum has no arm for.
  // The exact construction depends on how events are decoded — if the enum decoder
  // throws on unknown values, mock the decoder or feed a raw envelope past it.
  final unknownEvent = SyncEventV1(
    type: 'TotallyMadeUpV1', // not a real SyncEntityType value
    data: {'irrelevant': true},
    ack: 'unknown-ack-id',
  );

  // The dispatch should NOT throw. The ack should advance.
  await expectLater(
    coordinator.handleEvent(unknownEvent),
    completes, // not throwsA
  );

  // Verify the ack advanced (or at minimum, no crash).
  // If the coordinator exposes its current ack state, assert it's now 'unknown-ack-id'.
});
```

If the existing dispatch already has a default arm that logs + continues, the test passes immediately. If not, it crashes — proceed to Step 3.

**Step 3: If the dispatch crashes on unknown types, fix it**

Add a `default:` arm to the dispatch switch that logs a warning (using the existing logger) and returns without throwing. Re-run the test.

**Step 4: Commit**

```bash
git add mobile/test/infrastructure/repositories/sync_stream_repository_test.dart
# If dispatch fix was needed:
git add mobile/lib/infrastructure/repositories/sync_stream.repository.dart
git commit -m "chore(mobile): gracefully ignore unknown SyncEntityType values"
```

(Or just `test(mobile): regression test for unknown SyncEntityType` if no fix was needed.)

---

### Task 19: PR 1 manual verification, lint, and checkpoint

**Files:** none.

**Step 1: Run all checks before manual verification**

```bash
make check-server
cd mobile && dart analyze
make lint-server  # only if you've modified files outside the conventional patterns
```

Expected: zero errors, zero warnings. CI runs the full suite anyway, but catching local issues now saves a review round-trip.

**Step 2: Start the dev stack**

```bash
make dev
```

**Step 3: Smoke test the sync plumbing**

- Use the web or admin CLI to create a shared space with 10 photos.
- Run mobile app → trigger a sync → dump the Drift DB. The exact path depends on the platform:
  - Android: `adb shell run-as de.opennoodle.gallery cat databases/immich.sqlite > /tmp/immich.sqlite` (verify the package name matches what `flutter run` reports).
  - iOS simulator: `find ~/Library/Developer/CoreSimulator -name 'immich.sqlite' 2>/dev/null` then copy from the path.
- Open the dumped DB in `sqlite3` or another viewer and confirm:
  - `shared_space` has one row with the expected metadata.
  - `shared_space_member` has the owner row.
  - `shared_space_asset` has 10 rows.
  - `remote_asset` contains 10 new rows (owned by whoever created them on the server).
- Open the space in the existing UI — verify it still uses the old `getSpaceAssets()` path and still loads at the existing speed. No regression.

**Step 4: Remove a member from the space on the server, sync again**

Verify the mobile device removes the local member row and that the server's `shared_space_audit` table has the expected row.

**Step 5: Test migration on an existing-install device**

If you have a pre-PR1 install of the app, take a copy of its Drift database, install the new build, and verify the migration applies cleanly without data loss. The migration step from Task 13 should add the three new tables on top of the existing schema without touching anything else.

**Step 6: Checkpoint**

At this point PR 1 is complete. The new Drift tables are populated by sync, the query method works in tests, and nothing user-visible has changed. Do not squash commits — they're bite-sized on purpose for review.

**Step 7: Open PR 1**

```bash
git push -u origin investigate/mobile-space-slowness
gh pr create --title "feat(mobile): add shared-space Drift sync plumbing" \
  --body "$(cat <<'EOF'
## Summary

- New server-side `Sync*` classes and audit tables for `shared_space`, `shared_space_member`, `shared_space_asset`.
- New mobile Drift entities, migration step, and sync stream handlers.
- New `DriftTimelineRepository.sharedSpace()` query method (not yet wired to UI).
- No user-visible changes. PR 2 will wire the query to `SpaceDetailPage` and add library sync.

## Test plan

- [ ] Server medium tests pass
- [ ] Mobile Drift query tests pass
- [ ] Manual: fresh install syncs a shared space and populates the new tables (verified via adb pull)
- [ ] Manual: no regression on the existing spaces UI

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## PR 2 — Library sync + UI switchover

### Task 20: Add library `SyncEntityType` values

**Files:**

- Modify: `server/src/enum.ts`

**Step 1: Add the new values under the same marker**

Add, continuing after the PR 1 shared-space additions:

```typescript
  LibraryV1 = 'LibraryV1',
  LibraryDeleteV1 = 'LibraryDeleteV1',

  LibraryAssetCreateV1 = 'LibraryAssetCreateV1',
  LibraryAssetUpdateV1 = 'LibraryAssetUpdateV1',
  LibraryAssetBackfillV1 = 'LibraryAssetBackfillV1',

  LibraryAssetExifCreateV1 = 'LibraryAssetExifCreateV1',
  LibraryAssetExifUpdateV1 = 'LibraryAssetExifUpdateV1',
  LibraryAssetExifBackfillV1 = 'LibraryAssetExifBackfillV1',

  SharedSpaceLibraryV1 = 'SharedSpaceLibraryV1',
  SharedSpaceLibraryDeleteV1 = 'SharedSpaceLibraryDeleteV1',
  SharedSpaceLibraryBackfillV1 = 'SharedSpaceLibraryBackfillV1',
```

Add matching `SyncRequestType` values.

**Step 2: Run typecheck + commit**

```bash
cd server && pnpm check
git add server/src/enum.ts
git commit -m "feat(sync): add library and shared-space-library SyncEntityType values"
```

---

### Task 21: Create the `user_has_library_path` function and library audit tables (migration)

**Files:**

- Create: `server/src/schema/tables/library-audit.table.ts`
- Create: `server/src/schema/tables/library-asset-audit.table.ts`
- Create: `server/src/schema/tables/shared-space-library-audit.table.ts`
- Create: `server/src/schema/migrations-gallery/1778200000000-LibraryAuditTables.ts`
- Modify: `server/src/schema/index.ts` (register the three new tables on `ImmichDatabase` and in the `DB` type)
- Modify: `server/src/schema/functions.ts` (add `registerFunction` for `user_has_library_path` + the three trigger functions)
- Modify: `server/src/schema/tables/library.table.ts` (add `@AfterDeleteTrigger` for `asset_library_delete_audit` if `library` is the right hook table — verify by reading the existing decorators)
- Modify: `server/src/schema/tables/shared-space-library.table.ts` (add `@AfterDeleteTrigger` for `shared_space_library_delete_audit`)
- Modify: `server/src/schema/tables/shared-space-member.table.ts` (already has `@AfterDeleteTrigger` from Task 4 — append additional `shared_space_member_delete_library_audit` decorator OR fold both audit emissions into one trigger function)

**Context:** This is the largest and most correctness-critical migration in the whole plan. The `user_has_library_path` PL/pgSQL function is defined in full in the design doc "Case 1" section. Copy it verbatim.

**CRITICAL — same schema-tools four-piece sync as Task 4.** Re-read the "CRITICAL — schema-tools requires four pieces of synchronization" callout in Task 4. Every PL/pgSQL function and every trigger needs:

1. `registerFunction` in `src/schema/functions.ts`
2. `@AfterDeleteTrigger` decorator on the relevant table (or `@Trigger`/`@TriggerFunction` for the helper function `user_has_library_path`, which is called from other functions and has no associated trigger — check `@immich/sql-tools` exports for the right decorator).
3. `CREATE FUNCTION` / `CREATE TRIGGER` in the migration's `up()`
4. `INSERT INTO migration_overrides` in the migration with byte-exact canonical sql lifted from `pnpm migrations:debug` after pieces 1–3 are in place.

For the `user_has_library_path` helper function (no trigger, just a callable function), the registration is via `registerFunction({ name, returnType, language, body, ... })` in `functions.ts`. Without a `@Trigger` decorator there's no migration_overrides entry needed for the trigger side, but the function itself still needs an override row whose sql matches `processOverrides` output. If that doesn't work cleanly with helper-only functions, mark `synchronize: false` on the registerFunction options to opt out of override generation — at the cost of the function not being source-side comparable. Verify by running `pnpm migrations:debug` after each option.

**Step 1: Create the three audit table TypeScript definitions**

Mirror the PR 1 audit tables. `library_audit` has `(libraryId, userId)`, `library_asset_audit` has `(assetId)`, `shared_space_library_audit` has `(spaceId, libraryId)`.

**Step 2: Write the migration**

Create `1778200000000-LibraryAuditTables.ts`. The migration creates four PL/pgSQL functions and three triggers (the fourth function, `user_has_library_path`, is a helper called by the others — it does not have its own trigger). In order:

1. `CREATE TABLE` for the three audit tables + indexes.
2. `CREATE OR REPLACE FUNCTION user_has_library_path(...)` — helper function, copy verbatim from the design doc.
3. `CREATE OR REPLACE FUNCTION shared_space_library_delete_audit()` — trigger function, copy verbatim from the design doc (which includes the `shared_space_library_audit` insert as its first statement, plus the two `library_audit` fan-out inserts).
4. `CREATE OR REPLACE FUNCTION shared_space_member_delete_library_audit()` — trigger function, copy verbatim.
5. `CREATE OR REPLACE FUNCTION asset_library_delete_audit()` — trigger function, new. Inserts into `library_asset_audit` on `asset` DELETE where `libraryId IS NOT NULL`.
6. `CREATE TRIGGER` for the **three trigger functions** (steps 3, 4, 5), all `AFTER DELETE`, statement-level with `REFERENCING OLD TABLE`.
7. Ensure the `shared_space_library_delete_audit` trigger on `shared_space_library` DELETE uses `pg_trigger_depth() <= 1` so cascade from `library` or `shared_space` DELETE doesn't double-fire.

**Implement the `down()` function** in the same migration: drop the three triggers, drop the four functions (in reverse order — drop the trigger functions first, then `user_has_library_path` last because the trigger functions reference it), drop the three audit tables in reverse FK order.

**Step 3: Apply the migration**

```bash
cd server && pnpm build && pnpm migrations:run
```

Expected: migration succeeds. Verify:

```bash
docker compose -f docker/docker-compose.dev.yml exec database psql -U postgres -d immich -c "\dt library_audit library_asset_audit shared_space_library_audit"
docker compose -f docker/docker-compose.dev.yml exec database psql -U postgres -d immich -c "\df user_has_library_path"
```

**Step 4: Test the rollback path**

```bash
cd server && pnpm migrations:revert
docker compose -f docker/docker-compose.dev.yml exec database psql -U postgres -d immich -c "\dt library_audit library_asset_audit shared_space_library_audit"
docker compose -f docker/docker-compose.dev.yml exec database psql -U postgres -d immich -c "\df user_has_library_path"
```

Expected: zero tables, zero functions. Then re-apply:

```bash
pnpm migrations:run
```

Expected: clean re-application. The `down()` function must be idempotent and complete.

**Step 5: Commit**

```bash
git add server/src/schema/tables/library-audit.table.ts \
        server/src/schema/tables/library-asset-audit.table.ts \
        server/src/schema/tables/shared-space-library-audit.table.ts \
        server/src/schema/migrations-gallery/1778200000000-LibraryAuditTables.ts
git commit -m "feat(sync): add library audit tables and user_has_library_path function"
```

---

### Task 22: Write direct unit tests for `user_has_library_path` (RED)

**Files:**

- Create: `server/test/medium/specs/sync/user-has-library-path.spec.ts`

**Context:** This function is the correctness-critical new code. Test it directly, independent of trigger invocation.

**Step 1: Write the tests**

Five tests matching the design doc's enumerated list:

- `returns true for library owner` — user owns library L, function returns true for any `exclude_space_id`.
- `returns true for member of another linked space` — user is a member of space B which links L, `exclude_space_id = A`, function returns true.
- `returns true for creator of another linked space` — user created space B which links L (but is not in `shared_space_member`), `exclude_space_id = A`, function returns true.
- `returns false when excluded space is the only path` — user has exactly one access path via the excluded space, function returns false.
- `ignores soft-deleted libraries on owner branch` — user owns L, L has `deletedAt IS NOT NULL`, function returns false on the owner branch.

Call the function via raw SQL: `SELECT user_has_library_path(:lib, :user, :excl)`.

**Step 2 — 5:** Standard red → green → commit. Green is already achieved by Task 21 migration, so the test file is the only change here.

```bash
git commit -m "test(sync): unit tests for user_has_library_path function"
```

---

### Task 23: Write trigger scenario medium tests (RED)

**Files:**

- Create: `server/test/medium/specs/sync/library-audit-triggers.spec.ts`

**Context:** All ten trigger scenarios enumerated in the design doc's PR 2 testing section.

**Step 1: Write the ten tests**

Name each test after the enumerated design doc name:

1. `trigger_member_removed_library_still_visible_via_other_space`
2. `trigger_member_removed_library_not_visible_anywhere_else`
3. `trigger_member_removed_user_is_library_owner`
4. `trigger_member_removed_user_is_creator_of_other_space`
5. `trigger_library_unlinked_one_of_two_spaces`
6. `trigger_library_unlinked_last_space`
7. `trigger_library_deleted_cascades_to_per_user_audit`
8. `trigger_space_deleted_cascade`
9. `trigger_creator_check_uses_createdById_not_member_table`
10. `trigger_simultaneous_member_and_library_unlink`

Each test sets up a fixture scenario using `ctx.newUser`, `ctx.newLibrary`, `ctx.newSharedSpace`, `ctx.newSharedSpaceMember`, `ctx.newSharedSpaceLibrary`, then performs a delete, then asserts the row contents of `library_audit` via a direct SELECT.

For test 10 (concurrent), use two sequential transactions to simulate — full concurrency testing requires dedicated infrastructure and is out of scope.

**Step 2: Run the tests**

```bash
cd server && pnpm test:medium -- library-audit-triggers
```

Expected: all pass if Task 21 was implemented correctly. Any failures indicate trigger or path-function bugs.

**Step 3: If failures, fix Task 21**

Iterate on the migration SQL until all ten tests pass.

**Step 4: Commit**

```bash
git add server/test/medium/specs/sync/library-audit-triggers.spec.ts
git commit -m "test(sync): scenario medium tests for library audit triggers"
```

---

### Task 24: Create `LibrarySync` class (with tests)

**Files:**

- Modify: `server/src/repositories/sync.repository.ts`
- Create: `server/test/medium/specs/sync/sync-library.spec.ts`

**Context:** Mirrors `SharedSpaceSync` from Task 5 in shape, but uses the `ACCESSIBLE_LIBRARIES` scoping subquery. Add the `accessibleLibraries` helper alongside `accessibleSpaces` (from Task 5) on the same place — ideally a top-level utility used by all sync classes.

**Step 1: Write the failing tests**

- `getCreates` emits libraries the user owns.
- `getCreates` emits libraries linked via a space the user is a member of.
- `getCreates` emits libraries linked via a space the user created (creator path).
- `getCreates` does not emit libraries the user has no path to.
- `getCreates` does not emit soft-deleted libraries (`deletedAt IS NOT NULL`).
- `getUpdates` emits an updated library row when a property changes.
- `getDeletes` reads from `library_audit WHERE userId = :userId`.

**Step 2 — 5:** Standard red → implement → green → commit. The implementation adds `LibrarySync extends BaseSync` and an `accessibleLibraries` top-level helper alongside the `accessibleSpaces` helper from Task 5.

```bash
git commit -m "feat(sync): add LibrarySync repository class"
```

---

### Task 25: Create `LibraryAssetSync` class (with tests)

**Files:**

- Modify: `server/src/repositories/sync.repository.ts`
- Create: `server/test/medium/specs/sync/sync-library-asset.spec.ts`

**Context:** This is the class with the correctness-critical "once-per-asset" property. The query must filter `asset.libraryId IN ACCESSIBLE_LIBRARIES(userId)` directly on the asset table — not joining through `shared_space_library`.

**Step 1: Write the failing tests — especially the dedup property**

- `getCreates` emits each asset exactly once, even when the library is linked to multiple spaces the user is in. Create: library L with 3 assets, 2 spaces A+B both linking L, user in both. Assert `getCreates` returns exactly 3 rows, not 6.
- `getCreates` respects `ACCESSIBLE_LIBRARIES` scoping.
- `getCreates` does not emit assets from a library the user cannot access.
- `getUpdates` emits a library asset row when its metadata changes server-side.
- `getDeletes` reads from `library_asset_audit` scoped to `libraryId IN ACCESSIBLE_LIBRARIES(userId)`.
- `getDeletes` does not emit a delete event for a library asset whose library the user no longer has access to (the `library_audit` path handles whole-library revocation, so per-asset deletes for revoked libraries are filtered out by scoping).

**Step 2 — 5:** Standard flow. The implementation is mostly a direct SELECT on `asset` with the `libraryId IN (...)` WHERE clause; no join through `shared_space_library`.

```bash
git commit -m "feat(sync): add LibraryAssetSync with once-per-asset property"
```

---

### Task 26: Create `LibraryAssetExifSync` and `SharedSpaceLibrarySync` classes

**Files:**

- Modify: `server/src/repositories/sync.repository.ts`
- Create: `server/test/medium/specs/sync/sync-library-asset-exif.spec.ts`
- Create: `server/test/medium/specs/sync/sync-shared-space-library.spec.ts`

**Step 1 — 5:** Standard red → green → commit for each class, mirroring `AlbumAssetExifSync` and `AlbumUserSync` respectively.

```bash
git commit -m "feat(sync): add LibraryAssetExifSync repository class"
# second commit:
git commit -m "feat(sync): add SharedSpaceLibrarySync repository class"
```

---

### Task 27: Wire the four new sync classes into `SyncService`

**Files:**

- Modify: `server/src/services/sync.service.ts`

**Step 1 — 4:** Mirror Task 10. Add four new private methods (`syncLibrariesV1`, `syncLibraryAssetsV1`, `syncLibraryAssetExifsV1`, `syncSharedSpaceLibrariesV1`), then add case arms in the outer dispatch. Each backfill loop iterates `LibrarySync.getCreatedAfter` and uses the standard `isEntityBackfillComplete` / `sendEntityBackfillCompleteAck` pattern keyed to `library.createId`. Walk through `syncAlbumAssetsV1` carefully and replicate its shape.

**Accepted limitation — "user joins a space linking an old library"**: a user added to a pre-existing space whose linked library's `createId` is past the user's backfill checkpoint will not automatically receive that library's content. The library row appears (via the unscoped `getUpserts` stream), but the per-library backfill loop skips it because the checkpoint has already advanced. This is the **same limitation that exists for shared albums today** (`AlbumSync` enumerates from `album_user.createId`, which is per-membership, but that membership createId is established when the user joins — old albums whose content predates the membership still need a full resync to backfill). Users in this situation must reinstall the app or trigger a full sync reset. The fix would require per-(user, library) backfill markers, which is a sync-machinery change affecting albums and library together — out of scope for this PR. Document the parallel with album behavior in the PR description.

**Step 5: Commit**

```bash
git commit -m "feat(sync): wire library sync handlers into SyncService"
```

---

### Task 28: End-to-end medium test — full access control scenario

**Files:**

- Create: `server/test/medium/specs/sync/library-sync-end-to-end.spec.ts`

**Context:** The design doc's "server medium test — end-to-end access control" scenario. User A owns L1 and L2, creates space S, links both. User B joins S. Run sync for B.

**Step 1: Write the test**

Assertions:

- B receives both libraries.
- B receives every asset in L1 and L2 exactly once.
- B receives both `shared_space_library` rows.
- B does not receive library assets from libraries outside S.
- Then remove B from S → re-run sync for B → B receives `LibraryDeleteV1` for both L1 and L2.
- Then re-add B to S → assert the observed re-add behaviour and document it in the test comment (matches Known Limitations).

**Step 2 — 5:** Standard flow.

```bash
git commit -m "test(sync): end-to-end library access control medium test"
```

---

### Task 29: Add library DTOs and regenerate OpenAPI

**Files:**

- Modify: `server/src/dtos/sync.dto.ts`
- Regenerate: `open-api/`, `mobile/openapi/`

**Prerequisite:** Same as Task 11 — `java --version` must succeed.

Mirror Task 11. One commit for DTOs + regeneration.

```bash
git commit -m "feat(sync): add library sync DTOs and regenerate OpenAPI"
```

---

### Task 30: Create mobile Drift entities for libraries

**Files:**

- Create: `mobile/lib/infrastructure/entities/library.entity.dart`
- Create: `mobile/lib/infrastructure/entities/shared_space_library.entity.dart`

**Context:** Mirror Task 12.

```dart
class LibraryEntity extends Table with DriftDefaultsMixin {
  TextColumn get id => text()();
  TextColumn get name => text()();
  TextColumn get ownerId => text().references(UserEntity, #id, onDelete: KeyAction.cascade)();
  DateTimeColumn get createdAt => dateTime()();
  DateTimeColumn get updatedAt => dateTime()();

  @override
  Set<Column> get primaryKey => {id};
}

class SharedSpaceLibraryEntity extends Table with DriftDefaultsMixin {
  TextColumn get spaceId => text().references(SharedSpaceEntity, #id, onDelete: KeyAction.cascade)();
  TextColumn get libraryId => text()(); // no FK — loose, same reasoning as sharedSpaceAssetEntity
  TextColumn get addedById => text().nullable()();
  DateTimeColumn get createdAt => dateTime()();

  @override
  Set<Column> get primaryKey => {spaceId, libraryId};
}
```

Run `dart analyze`, commit.

```bash
git commit -m "feat(mobile): add Drift entities for libraries and shared-space-library links"
```

---

### Task 31: Register entities and add migration step (indexes)

**Files:**

- Modify: `mobile/lib/infrastructure/repositories/db.repository.dart`
- Modify: `mobile/lib/infrastructure/repositories/db.repository.steps.dart`

**Context:** New migration step that creates the two new tables and the hot-path indexes. Critical: add a composite index `remote_asset(libraryId, createdAt)` by default — the design doc calls this out as cheap insurance for the bucket query.

**Follow the same Drift workflow as Task 13** — see Task 13 Steps 1-6 for the full procedure (build_runner → schema dump → schema steps → schema generate). The `db.repository.steps.dart` file is GENERATED, not hand-edited.

**Step 1: Add the migration step in `db.repository.dart`**

Add to the `MigrationStrategy onUpgrade` block, after the `from22To23` step from Task 13:

```dart
from{Y}To{Y+1}: (m, v{Y+1}) async {
  await m.createTable(v{Y+1}.libraryEntity);
  await m.createTable(v{Y+1}.sharedSpaceLibraryEntity);
  await m.createIndex(v{Y+1}.idxSharedSpaceLibrarySpaceId);
  // Composite index on remote_asset is added via @TableIndex.sql on the entity class:
  await m.createIndex(v{Y+1}.idxRemoteAssetLibraryCreated);
},
```

Bump `schemaVersion`.

The composite `remote_asset(libraryId, createdAt DESC)` index goes on `RemoteAssetEntity` itself via `@TableIndex.sql('CREATE INDEX IF NOT EXISTS idx_remote_asset_library_created ON remote_asset_entity (library_id, created_at DESC)')`.

**Step 2: Add entities to `@DriftDatabase` tables list** (LibraryEntity, SharedSpaceLibraryEntity).

**Step 3: Regenerate Drift code via build_runner + drift_dev**

```bash
cd mobile
dart run build_runner build --delete-conflicting-outputs
dart run drift_dev schema dump lib/infrastructure/repositories/db.repository.dart drift_schemas/main/
dart run drift_dev schema steps drift_schemas/main/ lib/infrastructure/repositories/db.repository.steps.dart
dart run drift_dev schema generate test/drift/main/generated/ test/drift/main/generated/
dart analyze lib/infrastructure/repositories/db.repository.dart
```

Expected: "No issues found".

**Step 4: Commit**

```bash
git add mobile/lib/infrastructure/repositories/db.repository.dart \
        mobile/lib/infrastructure/repositories/db.repository.drift.dart \
        mobile/lib/infrastructure/repositories/db.repository.steps.dart \
        mobile/lib/infrastructure/entities/library*.entity.drift.dart \
        mobile/lib/infrastructure/entities/shared_space_library.entity.drift.dart \
        mobile/lib/infrastructure/entities/remote_asset.entity.drift.dart \
        mobile/drift_schemas/main/drift_schema_v{Y+1}.json \
        mobile/test/drift/main/generated/schema_v{Y+1}.dart \
        mobile/test/drift/main/generated/schema.dart
git commit -m "feat(mobile): register library Drift tables with migration and indexes"
```

---

### Task 32: Extend `sharedSpace()` timeline query with the UNION (RED → GREEN)

**Files:**

- Modify: `mobile/lib/infrastructure/repositories/timeline.repository.dart`
- Modify: `mobile/test/infrastructure/repositories/shared_space_repository_test.dart` (add tests)

**Step 1: Write the failing UNION tests**

Add to the existing test file from Task 14:

- UNION returns direct-add assets only (PR 1 scenario, should still work).
- UNION returns library assets only (library link, no direct-add).
- UNION returns the sum of both with no duplication when an asset is both directly added AND library-linked.
- UNION correctly handles empty `shared_space_library` but populated `shared_space_asset` (and vice versa).
- Removing a `sharedSpaceLibraryEntity` row drops those assets from the timeline via the reactive stream.
- Inserting a new `remoteAssetEntity` row with a `libraryId` matching a linked space fires the reactive stream.
- Inserting a new `sharedSpaceLibraryEntity` row for an already-populated library fires the reactive stream and the existing library assets appear.
- `EXPLAIN QUERY PLAN` on the bucket query includes the `remote_asset_library_id_idx` index.

**Step 2: Run — tests fail**

**Step 3: Extend the query**

Update `_watchSharedSpaceBucket` and `_getSharedSpaceBucketAssets` in `timeline.repository.dart` to use:

```dart
..where(
  _db.remoteAssetEntity.deletedAt.isNull() &
  (
    _db.remoteAssetEntity.id.isInQuery(
      _db.sharedSpaceAssetEntity.selectOnly()
        ..addColumns([_db.sharedSpaceAssetEntity.assetId])
        ..where(_db.sharedSpaceAssetEntity.spaceId.equals(spaceId))
    ) |
    _db.remoteAssetEntity.libraryId.isInQuery(
      _db.sharedSpaceLibraryEntity.selectOnly()
        ..addColumns([_db.sharedSpaceLibraryEntity.libraryId])
        ..where(_db.sharedSpaceLibraryEntity.spaceId.equals(spaceId))
    )
  )
)
```

Drop the inner join on `sharedSpaceAssetEntity` — the new shape uses a `WHERE ... IN (...)` subquery.

**Step 4: Run — tests pass**

**Step 5: Commit**

```bash
git commit -m "feat(mobile): extend sharedSpace() TimelineQuery with library UNION"
```

---

### Task 33: Add library sync stream handlers with inline sweep (RED → GREEN)

**Files:**

- Modify: `mobile/lib/infrastructure/repositories/sync_stream.repository.dart`
- Modify: `mobile/test/infrastructure/repositories/sync_stream_repository_test.dart`

**Context:** This includes the `LibraryDeleteV1` handler's inline orphan sweep — the most load-bearing mobile code in PR 2.

**Step 1: Write the failing tests**

Sync handler tests:

- `updateLibrariesV1` inserts/upserts rows.
- `deleteLibrariesV1` runs the inline sweep.
- `updateLibraryAssetsV1` delegates to the shared asset-upsert helper.
- `updateLibraryAssetExifsV1` delegates to the exif-upsert helper.
- `updateSharedSpaceLibrariesV1` inserts join rows.
- `deleteSharedSpaceLibrariesV1` removes join rows (does NOT sweep assets — that's handled separately).

Inline sweep tests (the four sweep-preservation clauses):

- Sweep preserves an asset owned by current user.
- Sweep preserves an asset owned by an active partner (create a partner relationship first).
- Sweep preserves an asset also present in `shared_space_asset`.
- Sweep deletes a foreign asset reachable only via the now-deleted library.
- Sweep runs in a single Drift batch — partial failure reverts all changes.

Plus two edge cases:

- `LibraryDeleteV1` for a library not in local state is a no-op.
- `SharedSpaceLibraryV1` arriving before `LibraryV1` inserts the join row; timeline query still works using only the join row.

**Step 2: Run — tests fail**

**Step 3: Source the current user id**

The `LibraryDeleteV1` handler needs the current user id for the sweep's owner-preservation clauses. Mobile sync handlers do not currently take a user id parameter — the existing pattern is to read it from a long-lived store. Find the right injection point:

```bash
grep -rn "currentUserId\|currentUser" mobile/lib/infrastructure/repositories/store.repository.dart 2>&1
```

The expected pattern is a `StoreRepository` that exposes the current user id via something like `_storeRepository.tryGet(StoreKey.currentUserId)`. If `SyncStreamRepository` does not currently depend on `StoreRepository`, add the dependency to its constructor and pass it through from wherever the repository is instantiated (likely a Riverpod provider).

Alternative: pass `currentUserId` as a parameter to `deleteLibrariesV1` from the dispatch site (Task 34) — the dispatch site already has access to the auth context. This is a smaller change but couples the dispatch loop to the handler signature. Use whichever fits the existing pattern in `sync_stream.repository.dart` better; mirror how other handlers that need auth context handle it (look for `updateAssetsV1` and how it deals with partner assets).

Document the chosen approach in a code comment on the new handler.

**Step 4: Implement the handlers**

Add the six new handler methods. The `deleteLibrariesV1` handler runs this sweep as part of the same batch:

```dart
Future<void> deleteLibrariesV1(Iterable<SyncLibraryDeleteV1> data) async {
  final libraryIds = data.map((d) => d.libraryId).toList();
  if (libraryIds.isEmpty) return;
  final currentUserId = _storeRepository.tryGet(StoreKey.currentUserId);
  if (currentUserId == null) {
    _logger.warning('deleteLibrariesV1 called without a current user id');
    return;
  }

  await _db.transaction(() async {
    for (final libraryId in libraryIds) {
      await _db.libraryEntity.deleteWhere((row) => row.id.equals(libraryId));
    }

    // Sweep orphan library assets — preserves user-owned, partner-shared, and direct-add paths.
    final placeholders = libraryIds.map((_) => '?').join(',');
    await _db.customStatement(
      '''
      DELETE FROM remote_asset
      WHERE library_id IS NOT NULL
        AND library_id IN ($placeholders)
        AND owner_id != ?
        AND owner_id NOT IN (
          SELECT shared_by_id FROM partner WHERE shared_with_id = ?
        )
        AND id NOT IN (SELECT asset_id FROM shared_space_asset)
      ''',
      [...libraryIds, currentUserId, currentUserId],
    );
  });
}
```

A few notes on the SQL:

- Column names use snake_case in raw SQL because that's how Drift maps Dart camelCase identifiers (`libraryId` → `library_id`). Verify the exact mapping by running a quick `EXPLAIN QUERY PLAN` against the generated Drift schema or by checking the `*.drift.dart` generated code.
- `transaction(() async { ... })` is preferred over `batch(...)` here because the sweep needs the table deletes to be visible to the customStatement DELETE. Verify this matches existing repository patterns in the file.
- `library_id IS NOT NULL` is technically redundant given the `library_id IN (...)` clause, but it documents intent and helps the query planner pick the index.

**Step 5: Run — tests pass**

**Step 6: Commit**

```bash
git commit -m "feat(mobile): library sync handlers with inline LibraryDeleteV1 sweep"
```

---

### Task 34: Wire library handlers into dispatch

**Files:**

- Modify: the mobile sync dispatch site (same as Task 17)

Add dispatch arms for each new library `SyncEntityType` value. Commit.

```bash
git commit -m "feat(mobile): dispatch library sync events to new handlers"
```

---

### Task 35: Wire up `SpaceDetailPage` — the UI switchover

**Files:**

- Modify: `mobile/lib/pages/library/spaces/space_detail.page.dart`

**Context:** This is the moment user-facing behaviour changes. Reference `mobile/lib/presentation/pages/drift_remote_album.page.dart` for the override pattern (search for `timelineServiceProvider.overrideWith` in that file). The current `SpaceDetailPage` has substantial state that depends on `_loadData()`: `_space`, `_members`, `_currentMember`, `_isOwner`, `_canEdit`, `_currentRole`, `_togglingTimeline`, `_isRefreshing`, `_toggleTimeline()`, `_addPhotos()`, `_deleteSpace()`, `_navigateToMembers()`, `_buildEmptyState()`. **All of this metadata and member state must be preserved** — only the asset-load path is being replaced.

**Step 1: Identify what to keep vs delete**

Read `mobile/lib/pages/library/spaces/space_detail.page.dart` in full. Catalog the state and methods:

| Element                                                                                            | Action                                                                   | Reason                                                  |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------- |
| `_space`, `_members`, `_loading`, `_error`, `_isRefreshing`, `_togglingTimeline`                   | KEEP                                                                     | Still needed for app bar, member actions, error display |
| `_assets` field                                                                                    | DELETE                                                                   | Replaced by Drift stream                                |
| `_loadData()` method                                                                               | KEEP but trim — remove `repo.getSpaceAssets(...)` from the `Future.wait` | Still loads space metadata + member list                |
| `_refreshAssets()` method                                                                          | DELETE                                                                   | Drift reactivity replaces it                            |
| All callers of `_refreshAssets()` (e.g., after `_addPhotos()`, `SpaceBottomSheet.onAssetsRemoved`) | REWIRE                                                                   | See Step 2                                              |
| `_currentMember`, `_isOwner`, `_canEdit`, `_currentRole`, `_showInTimeline` getters                | KEEP                                                                     | Still used by app bar                                   |
| `_toggleTimeline()`, `_addPhotos()`, `_deleteSpace()`, `_navigateToMembers()` methods              | KEEP                                                                     | App bar actions                                         |
| `_buildEmptyState()`                                                                               | KEEP                                                                     | Shown when timeline is empty                            |
| `build()` method's main timeline branch                                                            | REWRITE                                                                  | See Step 3                                              |

**Step 2: Rewire `_refreshAssets()` callers**

`_refreshAssets()` is currently called after `_addPhotos()` (line ~135 in current file) and from `SpaceBottomSheet`'s `onAssetsRemoved` callback. With Drift reactivity, asset additions/removals propagate automatically through the sync stream → Drift → reactive query, so explicit refresh of the timeline becomes unnecessary. However, member-related metadata may still need refreshing because adding photos can update `lastActivityAt` on the space row.

Replace each call site with:

```dart
// After _addPhotos:
final updatedSpace = await ref.read(sharedSpaceApiRepositoryProvider).get(widget.spaceId);
if (mounted) {
  setState(() => _space = updatedSpace);
}
ref.invalidate(sharedSpacesProvider);
```

Or simpler: add a new minimal helper `_refreshSpaceMetadata()` that only re-fetches the `_space` row (not assets, not members). Use it where the old `_refreshAssets()` was called.

**Step 3: Rewrite `_loadData()` to drop the asset fetch**

Current shape:

```dart
final results = await Future.wait([
  repo.get(widget.spaceId),
  repo.getMembers(widget.spaceId),
  repo.getSpaceAssets(widget.spaceId),  // DELETE THIS LINE
]);
// ...
_assets = results[2] as List<RemoteAsset>;  // DELETE THIS LINE
```

New shape:

```dart
final results = await Future.wait([
  repo.get(widget.spaceId),
  repo.getMembers(widget.spaceId),
]);
if (mounted) {
  setState(() {
    _space = results[0] as SharedSpaceResponseDto;
    _members = results[1] as List<SharedSpaceMemberResponseDto>;
    _loading = false;
  });
}
```

The page's `_loading` state now only gates on metadata + members loading (fast — small responses), not on assets. The Timeline widget renders independently from local Drift data.

**Step 4: Rewrite the timeline branch of `build()`**

Replace:

```dart
final assets = _assets ?? [];
if (assets.isEmpty) {
  return _buildEmptyState();
}
return ProviderScope(
  overrides: [
    timelineServiceProvider.overrideWith((ref) {
      final timelineService = ref
          .watch(timelineFactoryProvider)
          .fromAssetsWithBuckets(assets, TimelineOrigin.remoteSpace);
      ref.onDispose(timelineService.dispose);
      return timelineService;
    }),
  ],
  child: Timeline(/* ... */),
);
```

With:

```dart
return ProviderScope(
  overrides: [
    timelineServiceProvider.overrideWith((ref) {
      final timelineService = ref
          .watch(timelineFactoryProvider)
          .sharedSpace(spaceId: widget.spaceId);
      ref.onDispose(timelineService.dispose);
      return timelineService;
    }),
  ],
  child: Timeline(/* ...same as before, with the existing app bar and bottom sheet... */),
);
```

The empty-state branch must still work — when Drift returns zero buckets, the Timeline widget should render the empty state. Check whether the Timeline widget renders an empty placeholder by default; if not, keep an explicit `if (assets.isEmpty)` check by reading the first emission of the stream synchronously. If that's awkward, accept that the empty state is shown by the Timeline widget itself, and remove the page-level `_buildEmptyState()` branch.

**Step 5: Verify**

```bash
cd mobile && dart analyze
cd mobile && flutter test test/infrastructure/repositories/shared_space_repository_test.dart
```

Expected: zero analyzer errors, all tests pass.

**Step 6: Manual smoke test**

Run the app, open a space → it should render the timeline immediately with no loading spinner blocking the content.

**Step 7: Commit**

```bash
git add mobile/lib/pages/library/spaces/space_detail.page.dart
git commit -m "feat(mobile): wire SpaceDetailPage to Drift sharedSpace timeline query"
```

---

### Task 35a: Delete dead code in `SharedSpaceApiRepository`

**Files:**

- Modify: `mobile/lib/repositories/shared_space_api.repository.dart`

**Context:** Separated from Task 35 because the rewire is the risky change; this deletion is mechanical cleanup that should land in a separate commit for reviewability.

**Step 1: Confirm no remaining callers**

```bash
grep -rn "getSpaceAssets\|_parseDuration" mobile/lib/ 2>&1
```

Expected: no matches outside `shared_space_api.repository.dart` itself.

**Step 2: Delete the methods**

Remove `getSpaceAssets()`, `_parseDuration()`, and the `TimelineApi` constructor parameter if it's no longer used by any other method. Also drop the import.

**Step 3: Verify**

```bash
cd mobile && dart analyze
```

**Step 4: Commit**

```bash
git add mobile/lib/repositories/shared_space_api.repository.dart
git commit -m "chore(mobile): remove dead getSpaceAssets timeline path"
```

---

### Task 36: Scale test — 100k asset backfill

**Files:**

- Create: `mobile/test/infrastructure/repositories/shared_space_scale_test.dart` (or add to existing file — use skip annotation so it doesn't run in CI)

**Context:** Blocking deliverable for PR 2 per the design. Measurements documented in the PR body.

**Important — exercise the sync handler path, not raw inserts.** The original scale-test motivation was to validate that `sync_stream.repository.dart`'s single-batch insert strategy holds at 100k scale. A test that bypasses the sync handlers and writes directly to Drift would measure raw insertion performance, not the actual hot path. The test below feeds 100k synthetic `LibraryAssetV1` events through `updateLibraryAssetsV1` to exercise the real handler.

**Step 1: Write the test**

```dart
@Skip('Scale test — run manually via flutter test --dart-define=RUN_SCALE=1')
test('backfills 100k-asset library through the sync handler without OOM', () async {
  final ctx = MediumRepositoryContext();
  final syncStream = SyncStreamRepository(ctx.db, /* ... required deps */);

  // Build 100k synthetic LibraryAssetV1 DTOs
  final libraryId = 'lib-scale-test';
  await ctx.insertLibrary(id: libraryId, ownerId: 'user-1');

  final dtos = List.generate(100000, (i) => SyncLibraryAssetV1(
    id: 'asset-scale-$i',
    libraryId: libraryId,
    ownerId: 'user-1',
    // ... minimum required fields, use DateTime.now().subtract(Duration(minutes: i))
    //     for createdAt so the bucket query has multiple buckets to test against
  ));

  // Time the actual handler path
  final insertStart = DateTime.now();
  await syncStream.updateLibraryAssetsV1(dtos);
  final insertMs = DateTime.now().difference(insertStart).inMilliseconds;

  // Link the library to a space and time the bucket query
  final spaceId = await ctx.newSharedSpace(/* ... */).then((s) => s.id);
  await ctx.newSharedSpaceLibrary(spaceId: spaceId, libraryId: libraryId);

  final queryStart = DateTime.now();
  final buckets = await DriftTimelineRepository(ctx.db).sharedSpace(spaceId, GroupAssetsBy.day).bucketSource().first;
  final queryMs = DateTime.now().difference(queryStart).inMilliseconds;

  // Drift DB file size for storage measurement
  final dbSizeBytes = await ctx.db.executor.dialect == SqlDialect.sqlite
      ? File(ctx.db.executor.toString()).lengthSync()
      : 0;

  print('Insert: ${insertMs}ms, Query: ${queryMs}ms, Buckets: ${buckets.length}, DB size: ${dbSizeBytes ~/ 1024} KB');
  expect(queryMs, lessThan(500));  // loose sanity check — real target is 200ms with noise tolerance
});
```

The test exercises the same code path that runs during a real backfill. If memory pressure or insert latency surfaces, it will surface here exactly as it would in production.

**Step 2: Run it manually**

```bash
cd mobile && flutter test test/infrastructure/repositories/shared_space_scale_test.dart --dart-define=RUN_SCALE=1 --reporter expanded
```

Expected: records insert time, query time, and Drift DB size.

**Step 3: Record results in a scale notes file**

Create `docs/plans/2026-04-08-mobile-shared-space-drift-sync-scale-notes.md` with the measured numbers. This file goes into the PR body.

**Step 4: Decide on chunking**

If insert time exceeds "single-digit minutes" on your dev machine, add batched insertion to the `updateLibraryAssetsV1` handler (e.g., chunk into batches of 5000 inserts) and re-measure.

**Step 5: Commit**

```bash
git add mobile/test/infrastructure/repositories/shared_space_scale_test.dart \
        docs/plans/2026-04-08-mobile-shared-space-drift-sync-scale-notes.md
git commit -m "test(mobile): scale test for 100k-asset library backfill"
```

---

### Task 37: Manual verification of PR 2

**Files:** none.

**Step 1: Run all checks**

```bash
make check-server
make check-web  # only if web files were touched
cd mobile && dart analyze
```

Expected: zero errors.

**Step 2: Fresh install manual test**

- `make dev-update` to rebuild.
- Use the web to create a library with 1000 photos, link it to a space.
- Mobile fresh install, sync → open the space → loads instantly, all library content visible.
- Unlink the library → timeline drops those assets without manual refresh.
- Add a new photo to the library on the server → mobile timeline updates reactively.
- Remove the user from the space → verify `LibraryDeleteV1` arrives and the library + its assets disappear locally.
- Uninstall + reinstall → full resync completes, all data correct.

**Step 3: Verify no regression on direct-add spaces**

Open a space with only directly-added assets (no library link) → still works, still loads fast.

**Step 4: Test combined-release migration on an existing-install device**

Take a copy of a pre-PR1 device's Drift database. Install the new combined release. Verify both PR 1 and PR 2 migration steps apply in order without data loss. The two new tables (`library`, `shared_space_library`) should appear, the existing data should be untouched, and the first sync after upgrade should populate the library tables.

**Step 5: Checkpoint**

At this point PR 2 is complete. User-facing behaviour has changed: opening any shared space on mobile is now instant.

---

### Task 38: Open PR 2

```bash
git push
gh pr create --base main --title "feat(mobile): library sync and shared-space UI switchover" \
  --body "$(cat <<'EOF'
## Summary

- New server-side library and shared-space-library sync classes with `user_has_library_path` transitive access function.
- New mobile Drift entities for libraries and shared-space-library joins.
- Extended `sharedSpace()` TimelineQuery with UNION over direct-add and library-linked assets.
- Rewired `SpaceDetailPage` to use the Drift path — opening a shared space is now instant.
- Deleted `SharedSpaceApiRepository.getSpaceAssets` and the old network timeline path.

## Test plan

- [ ] Server medium tests pass (new library-audit-triggers, user-has-library-path, library-sync-end-to-end)
- [ ] Mobile Drift UNION tests pass
- [ ] Mobile sync handler tests pass (including LibraryDeleteV1 sweep)
- [ ] Scale test completed; results documented in `docs/plans/2026-04-08-mobile-shared-space-drift-sync-scale-notes.md`
- [ ] Manual: fresh install + library-linked space opens instantly
- [ ] Manual: revocation flows (user removed from space, library unlinked, library deleted)

## Related

Depends on #<PR1 number>.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

### Task 39: Merge both PRs together as one release

PR 1 and PR 2 must land in the same release. If your release process is a tagged merge of multiple PRs, merge PR 1 first then PR 2, then tag. If your process is a single release branch, merge PR 2 onto PR 1's branch, then merge the combined branch to main.

Do not tag a release containing only PR 1 without PR 2 — the new server sync emitters exist but the UI is still on the old path, which is fine temporarily but wastes sync bandwidth for no user benefit.

---

## Out-of-scope items (explicitly deferred)

Items in the design doc's Open Questions section are NOT part of this plan:

- Library ownership UI badge
- Per-space mobile sync opt-out
- `asset.libraryId` admin mutation handling
- E2E Playwright test for mobile (would need separate infrastructure)

If any of these surface as user requirements, they become separate follow-up PRs.
