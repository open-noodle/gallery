# Phase A Slice A2 — `asset_quality` table + `qualityScoredAt` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fork-only `asset_quality` table (per-asset heuristic scores) plus a nullable `qualityScoredAt` timestamp on `asset_job_status`, with a fork migration, matching `@Table` classes, and a revert-script entry — so A3 can write scores and A4 can read them.

**Architecture:** Per OQ-A1, scores live in a dedicated fork table `asset_quality` (keeps the hot upstream `asset_exif` table untouched → minimal rebase surface; revert = single `DROP TABLE`). The job-completion timestamp `qualityScoredAt` rides the existing `asset_job_status` table, matching the established fork columns `petsDetectedAt`/`classifiedAt`. One fork migration creates both. Medium tests build their schema by running migrations (`test/medium/globalSetup.ts:49`), so the migration is genuinely exercised; swc strips types at test runtime, so the medium spec gets a clean runtime red before the migration exists.

**CI drift gate (must not break):** CI builds the server, applies migrations, then runs `pnpm migrations:generate src/TestMigration` and **fails if any file under `server/src` changed** (test.yml:766-775, "Verify migration files have not changed"). sql-tools compares the live DB schema (after our migration) against the `@Table` decorator schema and emits a `TestMigration` only on a mismatch. The comparison is **structural, not by constraint name** — proof: the fork's hand-written `asset_duplicate_checksum` migration uses pg-auto-named constraints (not sql-tools' frozen `PK_<hash>`/`FK_<hash>` names) and `petsDetectedAt` is a plain `ALTER TABLE ADD`, and both pass this gate today. Therefore the migration below mirrors those two proven idioms exactly: a bare `CREATE TABLE` with inline `REFERENCES`/`PRIMARY KEY` (like `asset_duplicate_checksum`) and a plain `ALTER TABLE ADD` column (like `petsDetectedAt`). No separate index on the PK FK column (the PK's unique index covers it — matches `asset_job_status`'s sole-PK-FK decorator, which has no `index` field). `upsertJobStatus` is a plain method (not `@GenerateSqlQueries`-decorated), so the `pnpm sync:sql` git-clean gate (test.yml:776+, regenerates `server/src/queries/*.sql`) is unaffected by A2.

**Tech Stack:** NestJS, Kysely, `@immich/sql-tools` decorators, fork migrations in `server/src/schema/migrations-gallery/`, Vitest medium tests (testcontainers Postgres).

**No API/DTO change in A2** → no OpenAPI/SDK regen, `make check-web` unaffected (run it only as a confirmation). Agent exposure is A4.

---

## File Structure

- **Create** `server/test/medium/specs/repositories/asset-quality.repository.spec.ts` — schema round-trip + nullable + cascade + `qualityScoredAt` default/write tests (the TDD gate).
- **Create** `server/src/schema/migrations-gallery/1779100000000-AddAssetQualityScoring.ts` — fork migration: `CREATE TABLE asset_quality` + `ALTER TABLE asset_job_status ADD qualityScoredAt`.
- **Create** `server/src/schema/tables/asset-quality.table.ts` — `@Table('asset_quality')` class (drives Kysely `DB` type + schema-drift agreement).
- **Modify** `server/src/schema/index.ts` — import + `tables` array entry + `DB` interface entry for `AssetQualityTable`.
- **Modify** `server/src/schema/tables/asset-job-status.table.ts` — add `qualityScoredAt` column.
- **Modify** `server/src/repositories/asset.repository.ts` — add `qualityScoredAt` to `upsertJobStatus` `doUpdateSet` (required by the `satisfies Record<JobStatusColumns, unknown>` check at `:429` and to persist the value).
- **Modify** `scripts/revert-to-immich.sql` — step 2 `DROP TABLE asset_quality`, step 4 `DROP COLUMN qualityScoredAt`, step 8 add migration name, step 9 add `'asset_quality'` to the table sanity list.

**Column naming/types (resolved):** table `asset_quality`; columns `sharpness`, `exposure`, `brightness`, `quality` (un-suffixed — the table name supplies context, and they match the ML `_predict` output keys exactly, so A3 stores `{...output}` directly). Type `integer` — `@immich/sql-tools` table classes only use `'integer'` (no `'smallint'` anywhere in the codebase). All four nullable.

**Migration timestamp:** `1779100000000` — round, after the current latest fork migration `1779000000000-AddAgentSessionWorkflowState`, no collision.

---

## Task 1: Failing medium test for the `asset_quality` schema + `qualityScoredAt`

**Files:**

- Create: `server/test/medium/specs/repositories/asset-quality.repository.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `server/test/medium/specs/repositories/asset-quality.repository.spec.ts`:

```ts
import { Kysely } from 'kysely';
import { AssetRepository } from 'src/repositories/asset.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  const { ctx } = newMediumService(BaseService, {
    database: db || defaultDatabase,
    real: [],
    mock: [LoggingRepository],
  });
  return { ctx, sut: ctx.get(AssetRepository) };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe('asset_quality schema (slice A2)', () => {
  it('stores and reads back per-asset quality scores', async () => {
    const { ctx } = setup();
    const { user } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: user.id });

    await ctx.database
      .insertInto('asset_quality')
      .values({ assetId: asset.id, sharpness: 82, exposure: 91, brightness: 47, quality: 78 })
      .execute();

    const row = await ctx.database
      .selectFrom('asset_quality')
      .selectAll()
      .where('assetId', '=', asset.id)
      .executeTakeFirstOrThrow();

    expect(row).toEqual({ assetId: asset.id, sharpness: 82, exposure: 91, brightness: 47, quality: 78 });
  });

  it('allows null scores for an unscored asset', async () => {
    const { ctx } = setup();
    const { user } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: user.id });

    await ctx.database.insertInto('asset_quality').values({ assetId: asset.id }).execute();

    const row = await ctx.database
      .selectFrom('asset_quality')
      .selectAll()
      .where('assetId', '=', asset.id)
      .executeTakeFirstOrThrow();

    expect(row).toEqual({ assetId: asset.id, sharpness: null, exposure: null, brightness: null, quality: null });
  });

  it('cascades the delete when the asset is removed', async () => {
    const { ctx } = setup();
    const { user } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    await ctx.database.insertInto('asset_quality').values({ assetId: asset.id, quality: 50 }).execute();

    await ctx.database.deleteFrom('asset').where('id', '=', asset.id).execute();

    const rows = await ctx.database.selectFrom('asset_quality').selectAll().where('assetId', '=', asset.id).execute();
    expect(rows).toEqual([]);
  });

  it('defaults asset_job_status.qualityScoredAt to null and persists it via upsertJobStatus', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: user.id });

    await ctx.newJobStatus({ assetId: asset.id });
    const before = await ctx.database
      .selectFrom('asset_job_status')
      .select('qualityScoredAt')
      .where('assetId', '=', asset.id)
      .executeTakeFirstOrThrow();
    expect(before.qualityScoredAt).toBeNull();

    const scoredAt = new Date('2026-05-31T00:00:00.000Z');
    await sut.upsertJobStatus({ assetId: asset.id, qualityScoredAt: scoredAt });
    const after = await ctx.database
      .selectFrom('asset_job_status')
      .select('qualityScoredAt')
      .where('assetId', '=', asset.id)
      .executeTakeFirstOrThrow();
    expect(after.qualityScoredAt).toEqual(scoredAt);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails (expected red)**

Run: `/opt/homebrew/bin/mise exec -- pnpm -C server test:medium -- --run asset-quality.repository.spec`

Expected: RED. The first three tests fail with a Postgres error like `relation "asset_quality" does not exist`; the fourth fails with `column "qualityScoredAt" does not exist` (the migration adding the table/column has not been written yet). swc does not type-check at runtime, so the file compiles and fails for the schema reason — confirm the error text mentions `asset_quality` / `qualityScoredAt`, not a TypeScript/compile error.

(Do not commit yet — red proven.)

---

## Task 2: Add the migration, `@Table` classes, index registration, and the upsert wiring (green)

**Files:**

- Create: `server/src/schema/migrations-gallery/1779100000000-AddAssetQualityScoring.ts`
- Create: `server/src/schema/tables/asset-quality.table.ts`
- Modify: `server/src/schema/index.ts`
- Modify: `server/src/schema/tables/asset-job-status.table.ts`
- Modify: `server/src/repositories/asset.repository.ts:419-433`

- [ ] **Step 1: Write the fork migration**

Create `server/src/schema/migrations-gallery/1779100000000-AddAssetQualityScoring.ts`:

Mirror the proven `asset_duplicate_checksum` idiom (inline `REFERENCES` + inline `PRIMARY KEY`, pg-auto-named constraints) and the `petsDetectedAt` `ALTER TABLE ADD` idiom — both pass CI's drift gate:

```ts
import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE "asset_quality" (
      "assetId" uuid NOT NULL REFERENCES "asset"("id") ON DELETE CASCADE ON UPDATE CASCADE,
      "sharpness" integer,
      "exposure" integer,
      "brightness" integer,
      "quality" integer,
      PRIMARY KEY ("assetId")
    )
  `.execute(db);
  await sql`ALTER TABLE "asset_job_status" ADD "qualityScoredAt" timestamp with time zone`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE "asset_job_status" DROP COLUMN "qualityScoredAt"`.execute(db);
  await sql`DROP TABLE IF EXISTS "asset_quality"`.execute(db);
}
```

Do **not** add a separate index on `assetId` — it is the PRIMARY KEY (already uniquely indexed), and the `@Table` class below declares no `index`, so adding one would create drift.

- [ ] **Step 2: Write the `asset_quality` table class**

Create `server/src/schema/tables/asset-quality.table.ts` (mirrors `asset-job-status.table.ts`'s sole-PK `assetId` pattern and `asset-duplicate-checksum.table.ts`'s CASCADE FK):

```ts
import { Column, ForeignKeyColumn, Table } from '@immich/sql-tools';
import { AssetTable } from 'src/schema/tables/asset.table';

@Table('asset_quality')
export class AssetQualityTable {
  @ForeignKeyColumn(() => AssetTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', primary: true })
  assetId!: string;

  @Column({ type: 'integer', nullable: true })
  sharpness!: number | null;

  @Column({ type: 'integer', nullable: true })
  exposure!: number | null;

  @Column({ type: 'integer', nullable: true })
  brightness!: number | null;

  @Column({ type: 'integer', nullable: true })
  quality!: number | null;
}
```

- [ ] **Step 3: Add the `qualityScoredAt` column to the job-status table class**

In `server/src/schema/tables/asset-job-status.table.ts`, add after the `classifiedAt` column (last column, line ~25):

```ts
  @Column({ type: 'timestamp with time zone', nullable: true })
  qualityScoredAt!: Timestamp | null;
```

(`Timestamp` is already imported in that file.)

- [ ] **Step 4: Register `AssetQualityTable` in the schema index**

In `server/src/schema/index.ts` make three edits:

1. Add the import (near line 40, alongside the other `asset-*` table imports — exact line position will be normalized by prettier/organize-imports):

```ts
import { AssetQualityTable } from 'src/schema/tables/asset-quality.table';
```

2. Add to the `tables` array (near line 135, next to `AssetJobStatusTable`):

```ts
    AssetJobStatusTable,
    AssetQualityTable,
```

3. Add to the `DB` interface (near line 264, after `asset_job_status`):

```ts
asset_job_status: AssetJobStatusTable;
asset_quality: AssetQualityTable;
```

- [ ] **Step 5: Wire `qualityScoredAt` into `upsertJobStatus`**

In `server/src/repositories/asset.repository.ts`, inside `upsertJobStatus`'s `doUpdateSet` object (the block at lines ~422-429 that ends with `} satisfies Record<JobStatusColumns, unknown>`), add the new key after `classifiedAt`:

```ts
                petsDetectedAt: eb.ref('excluded.petsDetectedAt'),
                classifiedAt: eb.ref('excluded.classifiedAt'),
                qualityScoredAt: eb.ref('excluded.qualityScoredAt'),
```

This both satisfies the exhaustive `Record<JobStatusColumns, unknown>` check (tsc would otherwise fail now that the column exists on the table type) and persists the value on conflict (the Task 1 write test depends on it).

- [ ] **Step 6: Run the test to verify it passes (green)**

Run: `/opt/homebrew/bin/mise exec -- pnpm -C server test:medium -- --run asset-quality.repository.spec`

Expected: PASS (all four tests). The migration created the table + column; the cascade FK drops the quality row with the asset; `upsertJobStatus` persists `qualityScoredAt`.

- [ ] **Step 7: Commit**

```bash
cd /Users/pierre/dev/gallery/.worktrees/explore-pi-agent-brainstorm
git add server/src/schema/migrations-gallery/1779100000000-AddAssetQualityScoring.ts \
        server/src/schema/tables/asset-quality.table.ts \
        server/src/schema/tables/asset-job-status.table.ts \
        server/src/schema/index.ts \
        server/src/repositories/asset.repository.ts \
        server/test/medium/specs/repositories/asset-quality.repository.spec.ts
git commit -m "feat(server): add asset_quality table + asset_job_status.qualityScoredAt (roadmap A2)"
```

---

## Task 3: Revert-to-immich.sql maintenance

**Files:**

- Modify: `scripts/revert-to-immich.sql`

The fork's `revert-to-immich.sql` must undo every fork schema change (it is load-bearing for "Immich starts up cleanly" — see `feedback_rebase_revert_script_update`). Four edits, mirroring how `asset_duplicate_checksum` / `petsDetectedAt` are handled.

- [ ] **Step 1: Drop the fork table (step 2 of the script)**

In the "Drop Gallery-only tables (CASCADE)" block, immediately after the `asset_duplicate_checksum` line (line ~139):

```sql
DROP TABLE IF EXISTS "asset_duplicate_checksum" CASCADE;
DROP TABLE IF EXISTS "asset_quality" CASCADE;
```

- [ ] **Step 2: Drop the fork column (step 4 of the script)**

In the "Drop Gallery-added columns from Immich-native tables" block, after the `classifiedAt` line (line ~180):

```sql
ALTER TABLE "asset_job_status"  DROP COLUMN IF EXISTS "petsDetectedAt";
ALTER TABLE "asset_job_status"  DROP COLUMN IF EXISTS "classifiedAt";
ALTER TABLE "asset_job_status"  DROP COLUMN IF EXISTS "qualityScoredAt";
```

- [ ] **Step 3: Delete the migration row (step 8 of the script)**

In the `DELETE FROM "kysely_migrations" WHERE "name" IN (...)` fork block, after the `'1779000000000-AddAgentSessionWorkflowState',` line (line ~375):

```sql
   '1779000000000-AddAgentSessionWorkflowState',
   '1779100000000-AddAssetQualityScoring',
```

- [ ] **Step 4: Add the table to the step-9 sanity check**

In the `fork_tables_left` `tablename IN (...)` list (line ~438), add `'asset_quality'` next to `'asset_duplicate_checksum'`:

```sql
       'storage_migration_log', 'asset_duplicate_checksum', 'asset_quality',
```

- [ ] **Step 5: Commit**

```bash
git add scripts/revert-to-immich.sql
git commit -m "chore(revert): drop asset_quality + qualityScoredAt in revert-to-immich (roadmap A2)"
```

---

## Task 4: Full verification gates + push

These are required by the spec's "CI discipline" section. vitest alone is not sufficient.

- [ ] **Step 1: Full server unit suite (catch schema/index or table-list regressions)**

Run: `/opt/homebrew/bin/mise exec -- pnpm -C server test -- --run`
Expected: PASS, no regressions. If a unit test enumerates tables/migrations and now fails, update it to include `asset_quality` / the new migration and note it in the commit.

- [ ] **Step 2: Full medium suite (no regressions from the new table/column)**

Run: `/opt/homebrew/bin/mise exec -- pnpm -C server test:medium -- --run`
Expected: PASS, including the new `asset-quality.repository.spec.ts` and all existing job-status / asset specs.

- [ ] **Step 3: TypeScript check**

Run: `make check-server`
Expected: clean. The `qualityScoredAt` addition to the table type is matched by the new `doUpdateSet` key, so the `satisfies Record<JobStatusColumns, unknown>` check passes. If tsc reports another exhaustive use of the job-status columns, grep for it (`grep -rn "JobStatusColumns\|asset_job_status" server/src`) and add `qualityScoredAt` there too.

- [ ] **Step 4: Lint**

Run: `make lint-server`
Expected: clean (`--max-warnings 0`). Fix import ordering in `index.ts` if flagged (`make format-server` normalizes organize-imports). No `5_000`-style numeric-separator issues are introduced.

- [ ] **Step 5: Web type check (confirmation only — A2 has no DTO change)**

Run: `make check-web`
Expected: unaffected/clean. If it fails, the failure is pre-existing/unrelated to A2 — record the evidence; do not add DTO fields here (agent exposure is A4).

- [ ] **Step 6: Confirm no OpenAPI/SDK regen needed**

A2 changes no controller/DTO/`agent-tool.dto.ts`/`agent-operation.dto.ts`. Do **not** regenerate OpenAPI/SDK in this slice. (A4 will.)

- [ ] **Step 6b: Local drift check (best effort — this is the CI gate at test.yml:752-775)**

If a local Postgres is reachable (e.g. the `make dev` DB on `localhost:5432`, or export `DB_URL`), reproduce the CI drift gate:

```bash
cd /Users/pierre/dev/gallery/.worktrees/explore-pi-agent-brainstorm/server
/opt/homebrew/bin/mise exec -- pnpm build
DB_URL=postgres://postgres:postgres@localhost:5432/immich /opt/homebrew/bin/mise exec -- pnpm schema:reset
DB_URL=postgres://postgres:postgres@localhost:5432/immich /opt/homebrew/bin/mise exec -- pnpm migrations:generate src/TestMigration
git status --porcelain server/src    # MUST be empty — no src/*TestMigration*.ts generated
git clean -f server/src/*TestMigration* 2>/dev/null || true
```

Expected: no `TestMigration` file produced (the migration's resulting schema matches the `@Table` decorators). If one IS produced, open it — it prints the exact structural delta sql-tools sees; align the migration DDL or the decorator to remove it, then re-run. If no local DB is available, skip this step — the CI "Verify migration files have not changed" job is the backstop and `babysit` will surface it.

- [ ] **Step 7: Push the branch**

```bash
git push
```

Expected: pushes to `origin/explore/pi-agent-brainstorm` (upstream already set).

---

## Self-Review (against the spec's A2 section)

- **Spec: "add nullable score columns ... OR a new `asset_quality` table"** → resolved to the dedicated table (Task 2 Step 1/2). ✅
- **Spec: "add `qualityScoredAt` to `asset_job_status`"** → Task 2 Steps 1, 3, 5. ✅
- **Spec: "fork migration in `migrations-gallery/` (round timestamp)"** → `1779100000000-AddAssetQualityScoring.ts`. ✅
- **Spec TDD: "migration up/down (medium test or sql-shape); the repository read returns the new fields nullable; default null for existing rows"** → Task 1 round-trip + null + default-null tests; `down()` provided and mirrors fork precedent. ✅
- **Spec edge cases: "existing assets read null; revert drops the columns/table cleanly"** → Task 1 "allows null scores" + "defaults ... to null"; Task 3 revert edits (table, column, migration row, sanity check). ✅ (Cascade-delete test added beyond the spec for FK safety.)
- **Spec: "Add the migration to `scripts/revert-to-immich.sql` DELETE list"** → Task 3 Step 3 (+ steps 1/2/4 for completeness). ✅
- **CI discipline (lint/tsc/check-web; OpenAPI only on DTO change)** → Task 4; OpenAPI explicitly skipped (no DTO change). ✅
- **Type consistency:** `AssetQualityTable`, columns `sharpness/exposure/brightness/quality` (integer, nullable), `qualityScoredAt` (timestamptz), DB key `asset_quality` — used consistently across migration, table class, index, and tests. ✅

**Out of scope (later slices):** ML-repo `analyzeAssetQuality` + job + queue (A3); `readAssetMetadata`/`listDuplicateGroups` exposure + MCP contract + OpenAPI (A4); keep-rule (A5); `visual_cleanup` workflow (A6); matrix + L3 (A7). No L1/L3 in A2 — A2 adds no routing/workflow/agent surface.
