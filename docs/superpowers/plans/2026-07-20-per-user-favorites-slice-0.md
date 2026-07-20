# Per-user favorites — Slice 0 (schema foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the `asset_favorite` + `asset_favorite_audit` tables, backfill existing owner favorites into them, and make `revert-to-immich` actually cover them — with no user-facing behavior change.

**Architecture:** `asset_favorite` is a per-user overlay keyed `(userId, assetId)`, modelled on `shared_space_person_alias`, plus `createId`/`updateId` sync watermarks and an `_audit` tombstone table modelled on `album_space_asset` + `album_space_asset_audit` (§4.3 — favorites are their own synced entity because a favorite write must not bump the owner's `asset.updateId`). `asset.isFavorite` is **left in place** this slice; it is dropped in slice 3.

**Tech Stack:** NestJS 11, Kysely (not TypeORM), `@immich/sql-tools` decorators, PostgreSQL, Vitest (unit + medium via testcontainers).

**Spec:** `docs/superpowers/specs/2026-07-20-per-user-favorites-design.md` §4, §4.1, §4.2, §4.3. Edge cases E8-substrate, E12, E13.

## Global Constraints

- Fork migrations go in `server/src/schema/migrations-gallery/` only — never `migrations/`. Use a round timestamp for easy identification. Use `1784000000000` (the current max is `1783700000000`).
- No relative imports in `server/` — use the `src/` path alias.
- Prettier: 120 cols, single quotes, trailing commas. `prettier --check` and eslint are **separate** CI gates; passing eslint does not imply passing prettier. Run prettier on every modified file including source.
- Never run `make sql` / `mise //:sql` without a running DB — it deletes all query files.
- Do **not** add `Co-Authored-By` or `Generated-with` trailers to commits.
- `asset.isFavorite` must still exist and still work at the end of this slice. Any change to read or write behavior belongs to slices 1–2.

---

### Task 1: `asset_favorite` + `asset_favorite_audit` schema and migration

**Files:**

- Create: `server/src/schema/tables/asset-favorite.table.ts`
- Create: `server/src/schema/tables/asset-favorite-audit.table.ts`
- Create: `server/src/schema/migrations-gallery/1784000000000-AddAssetFavoriteTables.ts`
- Modify: `server/src/schema/index.ts` (import, `tables` array, `DB` interface map — three edits per table, mirroring `AlbumSpaceAssetTable` at `:33`, `:129`, `:257`)
- Test: `server/test/medium/specs/repositories/asset-favorite.repository.spec.ts`

**Interfaces:**

- Consumes: nothing (first task).
- Produces: table `asset_favorite` with columns `userId: string`, `assetId: string`, `createdAt: Timestamp`, `createId: string`, `updateId: string`, PK `("userId","assetId")`. Table `asset_favorite_audit` with `id: string`, `userId: string`, `assetId: string`, `deletedAt: Timestamp`. Kysely `DB` keys `asset_favorite` and `asset_favorite_audit`. Slices 1–2 query these; slice 6 consumes the audit stream.

- [ ] **Step 1: Write the failing medium test**

Create `server/test/medium/specs/repositories/asset-favorite.repository.spec.ts`. Model the harness on the existing `server/test/medium/specs/repositories/album.repository.spec.ts` — read it first for the exact `newMediumService` / testcontainers DB setup idiom used in this repo, and copy that idiom rather than inventing one.

Assertions required (these are E8-substrate, E12, E13 from the spec):

```ts
describe('asset_favorite schema', () => {
  it('persists a row and reads it back by (userId, assetId)', async () => {
    // insert { userId: user.id, assetId: asset.id }; select; expect one row
    // expect createId and updateId to be non-null (defaults applied)
  });

  it('lets two users favorite the same asset independently', async () => {
    // insert for userA and userB on the same assetId; expect both rows present
  });

  it('rejects a duplicate (userId, assetId) via the composite PK', async () => {
    // second insert with onConflict doNothing -> still exactly one row, no throw
  });

  it('cascade-deletes rows for every user when the asset is deleted', async () => {
    // userA + userB favorite assetX; delete assetX; expect zero asset_favorite rows  (E12)
  });

  it('cascade-deletes a user rows but leaves other users rows for the same asset', async () => {
    // userA + userB favorite assetX; delete userA; expect exactly userB row remains  (E13)
  });

  it('writes an audit tombstone when a favorite row is deleted', async () => {
    // insert then delete a favorite; expect one asset_favorite_audit row
    // carrying the same userId + assetId
  });

  it('emits one audit row per row on a multi-row delete', async () => {
    // statement-level trigger check: two favorites deleted in one DELETE
    // -> two audit rows (guards against a FOR EACH STATEMENT trigger that
    //    only records once)
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd server && pnpm test:medium -- --run test/medium/specs/repositories/asset-favorite.repository.spec.ts
```

Expected: FAIL. The first error will be a Postgres `relation "asset_favorite" does not exist`, or a Kysely type error because `asset_favorite` is not a key of `DB`. Both are the correct red. If it passes, stop — something is wrong.

- [ ] **Step 3: Create the table definitions**

`server/src/schema/tables/asset-favorite.table.ts`:

```ts
import { Column, CreateDateColumn, CreateIdColumn, ForeignKeyColumn, Table, UpdateIdColumn } from '@immich/sql-tools';
import { AssetTable } from 'src/schema/tables/asset.table';
import { UserTable } from 'src/schema/tables/user.table';
import { Generated, Timestamp } from 'src/sql-tools/from-code/index';

// Per-user favorites overlay (#763). A favorite is a fact about (user, asset), never about an
// asset alone — see docs/superpowers/specs/2026-07-20-per-user-favorites-design.md §3.
// Carries its own createId/updateId watermarks (+ asset_favorite_audit) because favorites are a
// separately-synced entity: a favorite write must NOT bump the owner's asset.updateId, which
// would re-sync that asset to every space member (§4.3).
@Table('asset_favorite')
export class AssetFavoriteTable {
  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', primary: true })
  userId!: string;

  @ForeignKeyColumn(() => AssetTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', primary: true, index: true })
  assetId!: string;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @CreateIdColumn({ index: true })
  createId!: Generated<string>;

  @UpdateIdColumn({ index: true })
  updateId!: Generated<string>;
}
```

Before writing this file, open `server/src/schema/tables/album-space-asset.table.ts` and copy its exact import paths and decorator option spellings for `CreateIdColumn` / `UpdateIdColumn` / `Generated` / `Timestamp`. The snippet above is the intended shape; the imports must match what that file actually uses in this checkout.

`server/src/schema/tables/asset-favorite-audit.table.ts` — mirror `server/src/schema/tables/album-space-asset-audit.table.ts` exactly, substituting `userId` + `assetId` for its key columns.

- [ ] **Step 4: Register both tables in the schema index**

In `server/src/schema/index.ts`, make three edits per table, mirroring how `AlbumSpaceAssetTable` appears at `:33` (import), `:129` (tables array) and `:257` (`DB` interface map). Keep the existing alphabetical-ish ordering of each list.

- [ ] **Step 5: Write the migration**

`server/src/schema/migrations-gallery/1784000000000-AddAssetFavoriteTables.ts`. Follow the raw-`sql` DDL style of `1783000000000-AddAlbumSpaceAssetTable.ts` (explicit named PK constraint, explicit indexes, a `down()` that drops). For the audit table and its delete trigger, copy the trigger/function pattern from `1783100000000-AddAlbumSpaceAssetSyncAndAudit.ts` — read that file and mirror it; do not invent trigger SQL.

The migration must, in order:

1. `CREATE TABLE "asset_favorite"` with `"userId"`/`"assetId"` uuid FKs (`ON UPDATE CASCADE ON DELETE CASCADE`), `"createdAt" timestamptz NOT NULL DEFAULT now()`, `"createId" uuid NOT NULL DEFAULT immich_uuid_v7()`, `"updateId" uuid NOT NULL DEFAULT immich_uuid_v7()`, and `CONSTRAINT "asset_favorite_pkey" PRIMARY KEY ("userId", "assetId")`.
2. Create indexes on `"assetId"`, `"createId"`, `"updateId"`.
3. `CREATE TABLE "asset_favorite_audit"` mirroring `album_space_asset_audit`.
4. Create the `AFTER DELETE ... REFERENCING OLD TABLE` trigger + function that inserts audit rows.
5. **Backfill**, exactly:

```sql
INSERT INTO "asset_favorite" ("userId", "assetId")
SELECT "ownerId", "id" FROM "asset" WHERE "isFavorite" = true
ON CONFLICT DO NOTHING;
```

Note the double-quoted camelCase identifiers — unquoted identifiers are folded to lowercase by Postgres and the insert will fail against the generated schema.

The migration must **not** drop `asset."isFavorite"`. That is slice 3.

- [ ] **Step 6: Run the medium test to verify it passes**

```bash
cd server && pnpm test:medium -- --run test/medium/specs/repositories/asset-favorite.repository.spec.ts
```

Expected: PASS, all seven cases.

- [ ] **Step 7: Verify the backfill against seeded data**

Add to the same spec file:

```ts
it('backfills one row per owner-favorited asset', async () => {
  // seed: assetA (owner U1, isFavorite true), assetB (owner U1, isFavorite false),
  //       assetC (owner U2, isFavorite true)
  // run the migration (or assert against a DB where it has run)
  // expect exactly {(U1,assetA), (U2,assetC)}
});

it('backfills cleanly on a database with zero favorites', async () => {
  // no isFavorite=true rows -> migration succeeds, asset_favorite is empty
});
```

Run the same command; expected PASS.

- [ ] **Step 8: Verify schema/type checks and formatting**

```bash
cd server && pnpm check && npx prettier --check src/schema/tables/asset-favorite.table.ts src/schema/tables/asset-favorite-audit.table.ts src/schema/migrations-gallery/1784000000000-AddAssetFavoriteTables.ts src/schema/index.ts
```

Expected: no type errors; prettier reports all files formatted.

- [ ] **Step 9: Commit**

```bash
git add server/src/schema server/test/medium/specs/repositories/asset-favorite.repository.spec.ts
git commit -m "feat(favorites): add asset_favorite + audit tables with backfill (#763)"
```

---

### Task 2: revert-to-immich coverage and column restore

**Files:**

- Modify: `server/src/schema/revert-to-immich.spec.ts:38` (widen `forkTables` filter) and add column-restore assertions
- Modify: `scripts/revert-to-immich.sql` (column restore, DROP lines, step-8 migration name, step-9 guard list)

**Interfaces:**

- Consumes: tables `asset_favorite`, `asset_favorite_audit` and migration name `1784000000000-AddAssetFavoriteTables` from Task 1.
- Produces: a revert path that restores `asset."isFavorite"` from owner rows. Slice 3 re-runs these assertions after the column drop.

- [ ] **Step 1: Widen the fork-table filter and watch it go red**

`server/src/schema/revert-to-immich.spec.ts:38` currently reads:

```ts
const forkTables = [...createdTables].filter((name) => name.startsWith('shared_space') || name.endsWith('_audit'));
```

`asset_favorite` matches neither predicate, so it is silently excluded from both the DROP-line test and the step-9 guard test — the table would ship with zero revert coverage (spec §4.2). Replace with an explicit allowlist-free form that covers every fork-created table:

```ts
// Every table migrations-gallery CREATEs is a fork table and needs a revert entry.
// (Was previously narrowed to shared_space* / *_audit, which silently excluded
// fork tables outside those naming conventions — e.g. asset_favorite. #763)
const forkTables = [...createdTables];
```

- [ ] **Step 2: Run the spec to verify it fails**

```bash
cd server && pnpm test -- --run src/schema/revert-to-immich.spec.ts
```

Expected: FAIL on at least three counts — `asset_favorite` (and possibly other previously-excluded fork tables) missing a `DROP TABLE IF EXISTS` line, missing from the step-9 guard list, and `1784000000000-AddAssetFavoriteTables` missing from the step-8 DELETE block.

**If widening the filter surfaces pre-existing fork tables unrelated to favorites**, that is a real pre-existing coverage hole. Add their DROP/guard entries too — do not re-narrow the filter to hide them. Report how many were found.

- [ ] **Step 3: Add the column-restore assertions**

Append to `server/src/schema/revert-to-immich.spec.ts`:

```ts
it('restores asset.isFavorite before dropping asset_favorite', () => {
  const addColumn = sql.indexOf('ADD COLUMN "isFavorite"');
  const backfill = sql.indexOf('FROM asset_favorite');
  const dropTable = sql.indexOf('DROP TABLE IF EXISTS "asset_favorite"');

  expect(addColumn).toBeGreaterThan(-1);
  expect(backfill).toBeGreaterThan(-1);
  expect(dropTable).toBeGreaterThan(-1);
  // ordering is load-bearing: the backfill reads asset_favorite, so it must
  // run before the table is dropped
  expect(addColumn).toBeLessThan(backfill);
  expect(backfill).toBeLessThan(dropTable);
});
```

- [ ] **Step 4: Edit `scripts/revert-to-immich.sql`**

Three separate edits:

1. **Before** the `DROP TABLE IF EXISTS` block (which starts around `:107`), add the column restore:

```sql
-- #763: per-user favorites. Gallery replaced asset."isFavorite" with the
-- asset_favorite overlay, so reverting must RESTORE the upstream column before
-- the overlay is dropped. This is the first fork change that removes upstream
-- schema, so it is the first restore step in this script.
-- LOSSY: favorites belonging to non-owners (space members who favorited someone
-- else's photo) have nowhere to live in plain Immich and are discarded.
ALTER TABLE "asset" ADD COLUMN IF NOT EXISTS "isFavorite" boolean NOT NULL DEFAULT false;

UPDATE "asset"
   SET "isFavorite" = true
  FROM "asset_favorite" f
 WHERE f."assetId" = "asset"."id"
   AND f."userId"  = "asset"."ownerId";
```

2. In the DROP block, add both tables (audit first, mirroring how `album_space_asset_audit` precedes `album_space_asset` at `:114-115`):

```sql
DROP TABLE IF EXISTS "asset_favorite_audit" CASCADE;
DROP TABLE IF EXISTS "asset_favorite" CASCADE;
```

3. Add `'1784000000000-AddAssetFavoriteTables'` to the step-8 `DELETE FROM "kysely_migrations"` name list, and `'asset_favorite'` + `'asset_favorite_audit'` to the step-9 `tablename IN (` guard list.

- [ ] **Step 5: Run the spec to verify it passes**

```bash
cd server && pnpm test -- --run src/schema/revert-to-immich.spec.ts
```

Expected: PASS, all four cases.

- [ ] **Step 6: Document the lossy revert**

In the switch-back guide under `docs/docs/guides/` (locate the revert-to-immich guide with `grep -rln "revert-to-immich" docs/docs/guides/`), add a short note that favorites belonging to non-owners are discarded on revert, and that each user's own favorites on their own assets are preserved. Run `npx prettier --write` on any markdown touched — CI Docs Build is strict.

- [ ] **Step 7: Commit**

```bash
git add server/src/schema/revert-to-immich.spec.ts scripts/revert-to-immich.sql docs/docs/guides
git commit -m "feat(favorites): restore asset.isFavorite on revert-to-immich (#763)"
```

---

### Task 3: Slice-0 verification gate

**Files:** none modified — this task only runs checks.

- [ ] **Step 1: Full server unit suite**

```bash
cd server && pnpm test -- --run
```

Expected: PASS. Nothing in this slice changes runtime behavior, so any failure is a real regression.

- [ ] **Step 2: Medium suite for the touched area**

```bash
cd server && pnpm test:medium -- --run test/medium/specs/repositories/asset-favorite.repository.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Type check and lint**

```bash
cd server && pnpm check && pnpm lint
```

Expected: no type errors, zero eslint warnings.

- [ ] **Step 4: Confirm no behavior drift**

```bash
git diff --stat main...HEAD
```

Expected: changes confined to `server/src/schema/`, `server/test/medium/`, `scripts/revert-to-immich.sql`, `docs/`. **If any file under `server/src/services/`, `server/src/repositories/` (other than schema), `web/`, or `mobile/` appears, the slice has drifted** — those belong to slices 1–7.

- [ ] **Step 5: Push**

```bash
git push -u origin worktree-fix-763-space-member-favorite
```

---

## Self-Review

**Spec coverage.** §4 table definition → Task 1 Step 3. §4.3 watermarks + audit table → Task 1 Steps 3, 5 and the two audit assertions in Step 1. §4.1 migration + backfill (quoted identifiers) → Task 1 Step 5, verified Step 7. §4.2 revert restore, ordering, filter widening, step-8/step-9 entries, lossy-revert documentation → Task 2. Edge cases: E8-substrate → Task 1 Step 1 case 3; E12 → case 4; E13 → case 5; zero-favorites backfill and #752-migration compatibility → Task 1 Step 7 (the unordered-migration path is exercised implicitly because the testcontainers DB applies all prior migrations first).

**Deliberate deviation from the spec.** The spec's slice-0 "Fix" list says to register a repository in `test/medium.factory.ts` and `BaseService`. This plan **defers that to slice 2**, where the write path first needs it. Creating an unused repository here would be dead code, and the `BaseService.create()` positional-list hazard is better taken on in the slice that actually exercises it. The medium tests in Task 1 use the Kysely DB directly, which is sufficient to assert schema behavior.

**Placeholder scan.** No TBD/TODO. Two steps deliberately instruct the implementer to read a named existing file and mirror it (`album-space-asset-audit.table.ts`, `1783100000000-AddAlbumSpaceAssetSyncAndAudit.ts`) rather than inlining trigger SQL that I have not verified line-by-line in this checkout — this is a correctness safeguard, not a placeholder, and each names the exact file to copy.

**Type consistency.** `userId` / `assetId` / `createdAt` / `createId` / `updateId` are used identically in the table definition, the migration DDL, the backfill, the revert SQL and the tests. The audit table's key columns match. Migration timestamp `1784000000000` is above the current max `1783700000000` and is referenced identically in the migration filename and the step-8 revert entry.
