# Slice 5 — Mobile Sync of Cross-Owner Contributions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cross-owner contributions (`album_space_asset` rows, #764) appear, update, and disappear on the mobile app through the **existing** shared-space-album sync streams, with the contributed asset's payload + EXIF, converging identically to the album owner's own `album_asset` rows.

**Architecture:** Contributions ride the **existing** `SharedSpaceAlbum*` sync entity types — the mobile client is origin-blind (its `shared_space_album_asset_entity` membership table is a bare `(albumId, assetId)` pair with no owner column), so **no mobile production code, no OpenAPI regen, and no new `SyncEntityType`/`SyncRequestType`** are required. All work is server-side: (1) give `album_space_asset` the standard `updateId`/`updatedAt` sync watermark + a `BEFORE UPDATE` trigger, and a trigger-driven `album_space_asset_audit` delete table, so the contributed arm becomes a **mechanical mirror** of the `album_asset` arm; (2) union that arm into the three sync stream classes (`SharedSpaceAlbumToAssetSync`, `SharedSpaceAlbumAssetSync`, `SharedSpaceAlbumAssetExifSync`); (3) extend the Hidden/restore visibility parity and audit cleanup. A mobile Flutter convergence test is added as a regression guard.

**Tech Stack:** NestJS 11 + Kysely (server), Postgres (testcontainers medium tests via `SyncTestContext`), Flutter/Drift (mobile), vitest, `flutter test`.

## Global Constraints

- **Migrations:** fork-only files in `server/src/schema/migrations-gallery/` with round timestamps that don't collide. Existing `album_space_asset` migration is `1783000000000`. Use `1783100000000` for this slice's migration. Add `scripts/revert-to-immich.sql` DROP entries for every new table/function/trigger **and** allowlist entries for the new function/trigger names.
- **No relative imports** on the server — use the `src/` path alias.
- **Kysely transactions:** never issue `this.db` queries inside a `transaction()` callback (pool deadlock). None of this slice's changes run inside a `transaction()`.
- **`make sql` regeneration** happens **only** against a scratch migrated DB — never the dev-stack DB, never without a running DB (it deletes query files otherwise). Deferred to Task 7.
- **`@GenerateSql`-decorated** methods must keep their decorator; Task 7's `make sql` regenerates `server/src/queries/*.sql`.
- **No new repository class** is added, so `test/medium.factory.ts` `newRealRepository` and `BaseService` wiring are **not** touched. (`album_space_asset_audit` is a table read inside the existing `SyncRepository`, and written by a DB trigger — no repository of its own.)
- **No Claude co-author trailers.** One commit per task.
- **UUIDv7 watermark domain:** `updateId`, `createId`, and audit `id` are all `immich_uuid_v7()` — the same monotonic ordering domain, so a single per-entity-type client checkpoint stays valid across a UNION of `album_asset`-derived and `album_space_asset`-derived arms ordered by that watermark.

---

## Reference facts (confirmed against the worktree at plan time)

- **`album_space_asset`** (`server/src/schema/tables/album-space-asset.table.ts`, migration `1783000000000`): PK `(albumId, assetId)`; columns `spaceId`, `addedById` (nullable, SET NULL), `addedAt`, `createId` (v7), `createdAt`. **No `updateId`/`updatedAt` yet** — Task 1 adds them.
- **Delete path already exists** (`AlbumRepository.removeContributedAssetIds`, `album.repository.ts:475`): a plain `deleteFrom('album_space_asset')` — a `FOR EACH STATEMENT` `AFTER DELETE` trigger catches it plus every FK cascade (asset/album/space delete).
- **The three streams** live in `server/src/repositories/sync.repository.ts`: `SharedSpaceAlbumToAssetSync` (`:1609`), `SharedSpaceAlbumAssetSync` (`:1689`), `SharedSpaceAlbumAssetExifSync` (`:1763`). Registration fields `:86-88`, constructor `:124-126`. `BaseSync` helpers `:130-175`.
- **The membership DELETE arm** (`getDeletes`, `:1624`) already UNIONs two audit tables (`album_asset_audit` + `shared_space_album_asset_audit`) under one `ORDER BY id`. Task 2 adds a **third** arm from `album_space_asset_audit`.
- **Visibility purge/restore** live in `SharedSpaceRepository` (`shared-space.repository.ts`): `emitAlbumAssetVisibilityPurge` (`:540`, INSERTs `shared_space_album_asset_audit` tombstones on Hidden-flip), `emitAlbumAssetVisibilityRestore` (`:573`, bumps `album_asset.updatedAt` on un-hide). Called from `asset.service.ts:452` (purge) / `:425` (restore) — **call sites unchanged**; Task 4 only extends the two repository method bodies.
- **Audit cleanup** is scheduled in `sync.service.ts:297` (`this.syncRepository.sharedSpaceAlbumToAsset.cleanupAuditTable(pruneThreshold)`). `SharedSpaceAlbumToAssetSync.cleanupAuditTable` (`:1677`) currently prunes only `shared_space_album_asset_audit`; Task 4 makes it also prune `album_space_asset_audit`.
- **Mirror templates:** ALTER-add-sync-columns migration = `1778120000000-AddSharedSpaceAssetSyncColumns.ts`; delete-trigger blueprint = `1779200000000-AddSharedSpaceAlbumDeleteSideTriggers.ts`; decorator target = `server/src/schema/tables/shared-space-asset.table.ts` (`@UpdatedAtTrigger` + `@UpdateIdColumn` + `@UpdateDateColumn`).
- **Medium test harness:** `SyncTestContext` (`test/medium.factory.ts:395`) with helpers `newUser`, `newAlbum`, `newAsset`, `newAlbumAsset`, `newSharedSpace`, `newSharedSpaceMember`, `newSharedSpaceAlbum` (auto-creates grants via the `shared_space_album_after_insert_user` trigger). Sync-stream medium specs live in `server/test/medium/specs/sync/`. Task 1 adds a `newAlbumSpaceAsset` helper.

### Critical design note — why the contributed delete arm differs from the `shared_space_album_asset_audit` arm

The existing `shared_space_album_asset_audit` arm INNER-JOINs `asset` and filters `asset.ownerId != userId` because that table is **purge-only** (asset always exists) and the asset is the owner's own `album_asset` membership (the owner keeps it via their personal album sync). **Neither is true for contributions:**

- `album_space_asset_audit` is **trigger-driven**, so on FK cascade (asset deleted) the asset row is **gone** → the arm must **not** join `asset`.
- A contribution is **never** also an owner's `album_asset` row (an asset lands in exactly one of the two tables — spec §5.1), so the owner has **no independent path** to the `(album, asset)` membership. When a contribution is removed/deleted/Hidden, **every** member — including the asset's owner — must drop it. → **no `ownerId` filter.**

So the contributed delete arm is `SELECT id, assetId, albumId FROM album_space_asset_audit` with only the checkpoint window + `accessibleSpaceAlbums` scope. Simpler than the sibling arm; the difference is load-bearing and must be commented.

---

## Task 1: Schema foundation — `updateId` watermark + `album_space_asset_audit` + triggers

**Delivers.** `album_space_asset` gains the standard `updateId`/`updatedAt` sync watermark (+ `BEFORE UPDATE` trigger) so the contributed sync arm mirrors `album_asset` exactly; a new trigger-driven `album_space_asset_audit` table captures every contribution deletion (explicit + FK cascade). No user-facing behavior — fully covered by a medium schema test.

**Files:**

- Modify: `server/src/schema/tables/album-space-asset.table.ts` (add `updateId`/`updatedAt` + `@UpdatedAtTrigger`)
- Create: `server/src/schema/tables/album-space-asset-audit.table.ts`
- Modify: `server/src/schema/index.ts` (register the audit table)
- Create: `server/src/schema/migrations-gallery/1783100000000-AddAlbumSpaceAssetSyncAndAudit.ts`
- Modify: `scripts/revert-to-immich.sql` (DROP entries + function/trigger allowlist entries)
- Modify: `server/test/medium.factory.ts` (add `newAlbumSpaceAsset` helper)
- Create/Test: `server/test/medium/specs/sync/album-space-asset-audit.spec.ts`

**Interfaces:**

- Produces: `album_space_asset.updateId` / `.updatedAt` columns; `album_space_asset_audit` table `{ id (v7 PK), albumId, assetId, deletedAt }`; DB triggers `album_space_asset_updatedAt` (BEFORE UPDATE) and `album_space_asset_delete_audit` (AFTER DELETE STATEMENT); `SyncTestContext.newAlbumSpaceAsset({ albumId, assetId, spaceId, addedById? })`.

- [ ] **Step 1: Add the `newAlbumSpaceAsset` test helper**

In `server/test/medium.factory.ts`, immediately after `newSharedSpaceAlbum` (ends ~line 392), add a helper mirroring `newSharedSpaceAsset`:

```ts
  async newAlbumSpaceAsset(dto: { albumId: string; assetId: string; spaceId: string; addedById?: string | null }) {
    const result = await this.database
      .insertInto('album_space_asset')
      .values({
        albumId: dto.albumId,
        assetId: dto.assetId,
        spaceId: dto.spaceId,
        addedById: dto.addedById ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return { albumSpaceAsset: result, result };
  }
```

- [ ] **Step 2: Write the failing medium test**

Create `server/test/medium/specs/sync/album-space-asset-audit.spec.ts`:

```ts
import { Kysely } from 'kysely';
import { SharedSpaceRole } from 'src/enum';
import { DB } from 'src/schema';
import { SyncTestContext } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

// Schema-level guarantees for album_space_asset's sync substrate (#764 Slice 5):
//   - updateId bumps on UPDATE (the BEFORE-UPDATE trigger), enabling restore re-emit
//   - deleting a contribution row (explicit or FK cascade) writes an album_space_asset_audit row
//   - the audit trigger is statement-level (a multi-row delete writes one audit row per deleted row)

let db: Kysely<DB>;

const seedContribution = async (ctx: SyncTestContext) => {
  const { user: owner } = await ctx.newUser();
  const { user: contributor } = await ctx.newUser();
  const { album } = await ctx.newAlbum({ ownerId: owner.id });
  const { asset } = await ctx.newAsset({ ownerId: owner.id });
  const { space } = await ctx.newSharedSpace({ createdById: owner.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: contributor.id, role: SharedSpaceRole.Editor });
  await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
  await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: asset.id, spaceId: space.id, addedById: contributor.id });
  return { owner, contributor, album, asset, space };
};

beforeAll(async () => {
  db = await getKyselyDB();
});

describe('album_space_asset sync substrate', () => {
  it('bumps updateId when the row is updated', async () => {
    const ctx = new SyncTestContext(db);
    const { album, asset } = await seedContribution(ctx);

    const before = await db
      .selectFrom('album_space_asset')
      .select('updateId')
      .where('albumId', '=', album.id)
      .where('assetId', '=', asset.id)
      .executeTakeFirstOrThrow();

    await db
      .updateTable('album_space_asset')
      .set({ updatedAt: new Date() })
      .where('albumId', '=', album.id)
      .where('assetId', '=', asset.id)
      .execute();

    const after = await db
      .selectFrom('album_space_asset')
      .select('updateId')
      .where('albumId', '=', album.id)
      .where('assetId', '=', asset.id)
      .executeTakeFirstOrThrow();

    expect(after.updateId).not.toBe(before.updateId);
  });

  it('writes an album_space_asset_audit row when a contribution is deleted', async () => {
    const ctx = new SyncTestContext(db);
    const { album, asset } = await seedContribution(ctx);

    await db.deleteFrom('album_space_asset').where('albumId', '=', album.id).where('assetId', '=', asset.id).execute();

    const audit = await db
      .selectFrom('album_space_asset_audit')
      .selectAll()
      .where('albumId', '=', album.id)
      .where('assetId', '=', asset.id)
      .execute();

    expect(audit).toHaveLength(1);
    expect(audit[0].id).toBeDefined();
  });

  it('writes an audit row on FK cascade (asset delete)', async () => {
    const ctx = new SyncTestContext(db);
    const { album, asset } = await seedContribution(ctx);

    await db.deleteFrom('asset').where('id', '=', asset.id).execute();

    const audit = await db
      .selectFrom('album_space_asset_audit')
      .selectAll()
      .where('albumId', '=', album.id)
      .where('assetId', '=', asset.id)
      .execute();

    expect(audit).toHaveLength(1);
  });

  it('is statement-level: a multi-row delete writes one audit row per deleted contribution', async () => {
    const ctx = new SyncTestContext(db);
    const { user: owner } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { asset: a1 } = await ctx.newAsset({ ownerId: owner.id });
    const { asset: a2 } = await ctx.newAsset({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
    await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: a1.id, spaceId: space.id });
    await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: a2.id, spaceId: space.id });

    await db.deleteFrom('album_space_asset').where('albumId', '=', album.id).execute();

    const audit = await db
      .selectFrom('album_space_asset_audit')
      .select('assetId')
      .where('albumId', '=', album.id)
      .execute();

    expect(audit.map((r) => r.assetId).sort()).toEqual([a1.id, a2.id].sort());
  });
});
```

- [ ] **Step 3: Run the test to confirm it fails**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/sync/album-space-asset-audit.spec.ts`
Expected: FAIL — `column "updateId" does not exist` (updateId test) and `relation "album_space_asset_audit" does not exist` (audit tests). (If `pnpm test:medium` needs Docker, ensure the medium DB container is available per repo setup.)

- [ ] **Step 4: Add `updateId`/`updatedAt` to the table decorator**

Edit `server/src/schema/tables/album-space-asset.table.ts`. Update the imports and add the two columns + the `@UpdatedAtTrigger`. The header comment's "no update trigger — rows are immutable once created" line must change to reflect the deliberate restore-bump semantics.

Replace the import block + decorators + the tail of the class:

```ts
import {
  CreateDateColumn,
  ForeignKeyColumn,
  Generated,
  Index,
  Table,
  Timestamp,
  UpdateDateColumn,
} from '@immich/sql-tools';
import { CreateIdColumn, UpdatedAtTrigger, UpdateIdColumn } from 'src/decorators';
import { AlbumTable } from 'src/schema/tables/album.table';
import { AssetTable } from 'src/schema/tables/asset.table';
import { SharedSpaceTable } from 'src/schema/tables/shared-space.table';
import { UserTable } from 'src/schema/tables/user.table';

// A cross-owner contribution: a space photo the contributor does NOT own, bookmarked into a
// space-linked album (#764). Deliberately NOT `album_asset` — it must never become a permanent
// `checkAlbumAccess` grant for the album owner. Visibility is re-derived from live space membership
// + the live album↔space link on every read (see spaceContributedAssetExists). The adder's OWN
// photos take the ordinary `album_asset` path instead.
//
// Sync watermarks mirror `shared_space_asset` (spec §4): `createId` anchors the per-album backfill,
// `updateId` (bumped by the `album_space_asset_updatedAt` BEFORE-UPDATE trigger) drives incremental
// upserts. The row's DATA columns are immutable; `updateId` is bumped only on a deliberate
// `updatedAt` touch (visibility restore — see SharedSpaceRepository.emitAlbumAssetVisibilityRestore)
// so a contribution re-appears on devices that purged it when its asset was un-hidden.
@Table({ name: 'album_space_asset' })
@UpdatedAtTrigger('album_space_asset_updatedAt')
@Index({ name: 'album_space_asset_spaceId_idx', columns: ['spaceId'] })
export class AlbumSpaceAssetTable {
```

…and after the existing `createdAt` column (keep everything above `createId`/`createdAt` unchanged), append:

```ts
  @UpdateIdColumn({ index: true })
  updateId!: Generated<string>;

  @UpdateDateColumn()
  updatedAt!: Generated<Timestamp>;
}
```

- [ ] **Step 5: Create the audit table decorator**

Create `server/src/schema/tables/album-space-asset-audit.table.ts`, mirroring `shared-space-album-asset-audit.table.ts` (read it first for the exact decorator names):

```ts
import { Column, CreateDateColumn, Generated, Index, Table, Timestamp } from '@immich/sql-tools';
import { PrimaryGeneratedUuidV7Column } from 'src/decorators';

// Delete-audit for album_space_asset cross-owner contributions (#764). Trigger-driven
// (album_space_asset_delete_audit fires AFTER DELETE ... FOR EACH STATEMENT), so it captures BOTH
// explicit contribution removal (AlbumService.removeAssets) AND every FK cascade (asset/album/space
// delete). `id` is a UUIDv7 in the same watermark domain as album_asset_audit.id, so the
// SharedSpaceAlbumToAssetSync delete stream can UNION all three audit arms under one ORDER BY id.
//
// Distinct from #752's shared_space_album_asset_audit (which audits normal album_asset membership).
@Table('album_space_asset_audit')
@Index({ name: 'album_space_asset_audit_albumId_id_idx', columns: ['albumId', 'id'] })
export class AlbumSpaceAssetAuditTable {
  @PrimaryGeneratedUuidV7Column()
  id!: Generated<string>;

  @Column({ type: 'uuid', index: true })
  albumId!: string;

  @Column({ type: 'uuid', index: true })
  assetId!: string;

  @CreateDateColumn({ default: () => 'clock_timestamp()', index: true })
  deletedAt!: Generated<Timestamp>;
}
```

> Confirm the exact decorator import names by reading `server/src/schema/tables/shared-space-album-asset-audit.table.ts` and matching it verbatim (e.g. `PrimaryGeneratedUuidV7Column`). Adjust the import line if that file uses different names.

- [ ] **Step 6: Register the audit table in `schema/index.ts`**

In `server/src/schema/index.ts`: add the import (next to the other `*AuditTable` imports), add `AlbumSpaceAssetAuditTable` to the table array (next to `AlbumSpaceAssetTable` / the audit-table cluster), and add `album_space_asset_audit: AlbumSpaceAssetAuditTable;` to the `DB` interface (next to `album_space_asset:`). Mirror how `shared_space_album_asset_audit` is registered (see `index.ts:327`).

- [ ] **Step 7: Write the migration**

Create `server/src/schema/migrations-gallery/1783100000000-AddAlbumSpaceAssetSyncAndAudit.ts`. Uses the `1778120000000` ALTER template + the `1779200000000` trigger/`migration_overrides` blueprint:

```ts
import { Kysely, sql } from 'kysely';

// #764 Slice 5 — sync substrate for cross-owner contributions.
//
// 1. Add updateId/updatedAt to album_space_asset (createId/createdAt already exist from 1783000000000)
//    + the standard updated_at BEFORE-UPDATE trigger, so the contributed sync arm mirrors album_asset.
// 2. Create album_space_asset_audit + a statement-level AFTER-DELETE trigger that tombstones every
//    deleted contribution (explicit removal + FK cascade), driving SharedSpaceAlbumToAssetSync deletes.
export async function up(db: Kysely<any>): Promise<void> {
  // --- 1. Sync watermark columns on album_space_asset ---
  await sql`ALTER TABLE "album_space_asset" ADD COLUMN "updateId" uuid NOT NULL DEFAULT immich_uuid_v7();`.execute(db);
  await sql`ALTER TABLE "album_space_asset" ADD COLUMN "updatedAt" timestamp with time zone NOT NULL DEFAULT now();`.execute(
    db,
  );
  await sql`CREATE INDEX "album_space_asset_updateId_idx" ON "album_space_asset" ("updateId");`.execute(db);

  await sql`CREATE OR REPLACE TRIGGER "album_space_asset_updatedAt"
  BEFORE UPDATE ON "album_space_asset"
  FOR EACH ROW
  EXECUTE FUNCTION updated_at();`.execute(db);

  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_album_space_asset_updatedAt', '{"type":"trigger","name":"album_space_asset_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"album_space_asset_updatedAt\\"\\n  BEFORE UPDATE ON \\"album_space_asset\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(
    db,
  );

  // --- 2. Delete-audit table ---
  await sql`
    CREATE TABLE "album_space_asset_audit" (
      "id"        uuid NOT NULL DEFAULT immich_uuid_v7() PRIMARY KEY,
      "albumId"   uuid NOT NULL,
      "assetId"   uuid NOT NULL,
      "deletedAt" timestamp with time zone NOT NULL DEFAULT clock_timestamp()
    );
  `.execute(db);
  await sql`CREATE INDEX "album_space_asset_audit_albumId_id_idx" ON "album_space_asset_audit" ("albumId", "id");`.execute(
    db,
  );
  await sql`CREATE INDEX "album_space_asset_audit_albumId_idx" ON "album_space_asset_audit" ("albumId");`.execute(db);
  await sql`CREATE INDEX "album_space_asset_audit_assetId_idx" ON "album_space_asset_audit" ("assetId");`.execute(db);
  await sql`CREATE INDEX "album_space_asset_audit_deletedAt_idx" ON "album_space_asset_audit" ("deletedAt");`.execute(
    db,
  );

  // --- 3. AFTER-DELETE statement-level trigger → tombstone every deleted contribution ---
  await sql`CREATE OR REPLACE FUNCTION album_space_asset_delete_audit()
  RETURNS TRIGGER
  LANGUAGE PLPGSQL
  AS $$
    BEGIN
      INSERT INTO album_space_asset_audit ("albumId", "assetId")
      SELECT "albumId", "assetId" FROM "old";
      RETURN NULL;
    END
  $$;`.execute(db);

  await sql`CREATE OR REPLACE TRIGGER "album_space_asset_delete_audit"
  AFTER DELETE ON "album_space_asset"
  REFERENCING OLD TABLE AS "old"
  FOR EACH STATEMENT
  EXECUTE FUNCTION album_space_asset_delete_audit();`.execute(db);

  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('function_album_space_asset_delete_audit', '{"type":"function","name":"album_space_asset_delete_audit","sql":"CREATE OR REPLACE FUNCTION album_space_asset_delete_audit()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      INSERT INTO album_space_asset_audit (\\"albumId\\", \\"assetId\\")\\n      SELECT \\"albumId\\", \\"assetId\\" FROM \\"old\\";\\n      RETURN NULL;\\n    END\\n  $$;"}'::jsonb);`.execute(
    db,
  );

  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_album_space_asset_delete_audit', '{"type":"trigger","name":"album_space_asset_delete_audit","sql":"CREATE OR REPLACE TRIGGER \\"album_space_asset_delete_audit\\"\\n  AFTER DELETE ON \\"album_space_asset\\"\\n  REFERENCING OLD TABLE AS \\"old\\"\\n  FOR EACH STATEMENT\\n  EXECUTE FUNCTION album_space_asset_delete_audit();"}'::jsonb);`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DELETE FROM "migration_overrides" WHERE "name" IN (
    'trigger_album_space_asset_updatedAt',
    'function_album_space_asset_delete_audit',
    'trigger_album_space_asset_delete_audit'
  );`.execute(db);
  await sql`DROP TRIGGER IF EXISTS "album_space_asset_delete_audit" ON "album_space_asset";`.execute(db);
  await sql`DROP FUNCTION IF EXISTS album_space_asset_delete_audit();`.execute(db);
  await sql`DROP TABLE IF EXISTS "album_space_asset_audit";`.execute(db);
  await sql`DROP TRIGGER IF EXISTS "album_space_asset_updatedAt" ON "album_space_asset";`.execute(db);
  await sql`DROP INDEX IF EXISTS "album_space_asset_updateId_idx";`.execute(db);
  await sql`ALTER TABLE "album_space_asset" DROP COLUMN IF EXISTS "updatedAt";`.execute(db);
  await sql`ALTER TABLE "album_space_asset" DROP COLUMN IF EXISTS "updateId";`.execute(db);
}
```

> Verify `updated_at()` is the shared trigger function name used by sibling `*_updatedAt` triggers (it is, per `1778120000000`). Verify `immich_uuid_v7()` and `clock_timestamp()` are available (they are — used throughout `migrations-gallery/`).
>
> **`migration_overrides` strings (hardening):** the three `migration_overrides` `sql` JSON values above are hand-transcribed to match the sibling escaping (`\\"`, `\\n`, `::jsonb`) byte-for-byte. The sibling template notes these are "lifted via `pnpm migrations:debug`". After the migration applies on the scratch DB (Task 7 Step 1), run `pnpm migrations:debug` (or the repo's documented override-lift step) and confirm the normalizer emits the **same** strings for `album_space_asset_updatedAt` / `album_space_asset_delete_audit`; if it differs in whitespace, replace the hand-written values with the lifted ones. This does not affect the migration run or the medium tests — only a later schema-drift check.

- [ ] **Step 8: Add `revert-to-immich.sql` entries**

In `scripts/revert-to-immich.sql`:

- Add near the existing `DROP TABLE IF EXISTS "album_space_asset" CASCADE;` (line ~114): `DROP TABLE IF EXISTS "album_space_asset_audit" CASCADE;`
- Add to the `DROP FUNCTION` block: `DROP FUNCTION IF EXISTS album_space_asset_delete_audit() CASCADE;`
- Add to the known-function allowlist (the `'function_...'` list ~line 227): `'function_album_space_asset_delete_audit',`
- Add to the known-trigger allowlist (the `'trigger_...'` list ~line 254): `'trigger_album_space_asset_delete_audit',` and `'trigger_album_space_asset_updatedAt',`
- Add `album_space_asset_audit` to the known-tables allowlist (the array ~line 440 that already lists `shared_space_album_asset_audit`).

> Read the surrounding lines first and match the existing formatting/quoting exactly. If `revert-to-immich.sql` has a companion `.md` under `docs/`, it does not need touching — only the SQL.

- [ ] **Step 9: Run the medium test to confirm it passes**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/sync/album-space-asset-audit.spec.ts`
Expected: PASS (all four cases).

- [ ] **Step 10: Type-check**

Run: `cd server && pnpm check`
Expected: clean (no errors from the decorator/schema changes).

- [ ] **Step 11: Commit**

```bash
git add server/src/schema server/src/schema/migrations-gallery scripts/revert-to-immich.sql server/test/medium.factory.ts server/test/medium/specs/sync/album-space-asset-audit.spec.ts
git commit -m "feat(spaces): album_space_asset sync watermark + delete-audit trigger (#764 slice 5)"
```

---

## Task 2: Union the contributed arm into `SharedSpaceAlbumToAssetSync` (membership edge)

**Delivers.** The `(albumId, assetId)` membership edge for a contribution is emitted by the backfill, upsert, and (via the new audit table) delete arms — mirroring the `album_asset` arm, keyed on the shared `updateId` watermark.

**Files:**

- Modify: `server/src/repositories/sync.repository.ts` (`SharedSpaceAlbumToAssetSync`, `:1609-1680`)
- Test: `server/test/medium/specs/sync/shared-space-album-to-asset-sync.spec.ts` (extend)

**Interfaces:**

- Consumes: `album_space_asset.{assetId, albumId, updateId}`, `album_space_asset_audit.{id, assetId, albumId}` (Task 1); `accessibleSpaceAlbums`, `spaceVisibilityGate` (already imported in `sync.repository.ts`).
- Produces: contributed membership rows in the same shape `{ assetId, albumId, updateId }` the existing arm emits — no signature change, so `sync.service.ts` and mobile are untouched.

- [ ] **Step 1: Write failing medium tests**

Append to `server/test/medium/specs/sync/shared-space-album-to-asset-sync.spec.ts` (imports already include `AssetVisibility`, `SharedSpaceRole`, `SyncRepository`, `SyncTestContext`). Add a helper + three `describe` blocks:

```ts
const drain = async (stream: AsyncIterable<any>) => {
  const out: any[] = [];
  for await (const row of stream) {
    out.push(row);
  }
  return out;
};

describe('SharedSpaceAlbumToAssetSync — contributions (album_space_asset)', () => {
  it('getBackfill returns a contributed (albumId, assetId) row for the album', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: carol } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { asset } = await ctx.newAsset({ ownerId: carol.id }); // owned by someone else
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
    await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: asset.id, spaceId: space.id });

    const rows = await drain(sut.getBackfill({ nowId: NOW_ID, beforeUpdateId: BEFORE_UPDATE_ID }, album.id));
    expect(rows.some((r) => r.albumId === album.id && r.assetId === asset.id)).toBe(true);
  });

  it('getBackfill excludes a contributed row whose asset is Hidden (visibility gate)', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: carol } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { asset } = await ctx.newAsset({ ownerId: carol.id, visibility: AssetVisibility.Hidden });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
    await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: asset.id, spaceId: space.id });

    const rows = await drain(sut.getBackfill({ nowId: NOW_ID, beforeUpdateId: BEFORE_UPDATE_ID }, album.id));
    expect(rows.some((r) => r.assetId === asset.id)).toBe(false);
  });

  it('getUpserts returns a contributed row for a member with an album grant', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { user: carol } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { asset } = await ctx.newAsset({ ownerId: carol.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
    await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: asset.id, spaceId: space.id });

    const rows = await drain(sut.getUpserts({ nowId: NOW_ID, userId: member.id }));
    expect(rows.some((r) => r.albumId === album.id && r.assetId === asset.id)).toBe(true);
  });

  it('getUpserts does not return a contributed row for a non-member', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: stranger } = await ctx.newUser();
    const { user: carol } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { asset } = await ctx.newAsset({ ownerId: carol.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
    await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: asset.id, spaceId: space.id });

    const rows = await drain(sut.getUpserts({ nowId: NOW_ID, userId: stranger.id }));
    expect(rows.some((r) => r.assetId === asset.id)).toBe(false);
  });

  it('getDeletes emits the contributed edge to every member (incl. asset owner) after removal', async () => {
    const { ctx, db, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { user: carol } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { asset } = await ctx.newAsset({ ownerId: carol.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: carol.id, role: SharedSpaceRole.Viewer });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
    await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: asset.id, spaceId: space.id });

    await db.deleteFrom('album_space_asset').where('albumId', '=', album.id).where('assetId', '=', asset.id).execute();

    for (const viewer of [member.id, carol.id]) {
      const rows = await drain(sut.getDeletes({ nowId: NOW_ID, userId: viewer }));
      expect(rows.some((r) => r.albumId === album.id && r.assetId === asset.id)).toBe(true);
    }
  });

  it('getUpserts stops returning a contribution after the member leaves S (grant revoked by #752 trigger)', async () => {
    const { ctx, db, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { user: carol } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { asset } = await ctx.newAsset({ ownerId: carol.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
    await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: asset.id, spaceId: space.id });

    const before = await drain(sut.getUpserts({ nowId: NOW_ID, userId: member.id }));
    expect(before.some((r) => r.albumId === album.id && r.assetId === asset.id)).toBe(true);

    // Member leaves S → shared_space_member_delete_album_audit revokes the album grant (#752), same
    // path that drops the album (and thus its contribution edges) on device.
    await db
      .deleteFrom('shared_space_member')
      .where('spaceId', '=', space.id)
      .where('userId', '=', member.id)
      .execute();

    const after = await drain(sut.getUpserts({ nowId: NOW_ID, userId: member.id }));
    expect(after.some((r) => r.albumId === album.id && r.assetId === asset.id)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/sync/shared-space-album-to-asset-sync.spec.ts`
Expected: FAIL — the new contribution cases fail (streams only union `album_asset` today); existing cases still pass.

- [ ] **Step 3: Rewrite `getBackfill` as a two-arm union**

In `server/src/repositories/sync.repository.ts`, replace `SharedSpaceAlbumToAssetSync.getBackfill` (`:1611-1622`) with:

```ts
  @GenerateSql({ params: [dummyBackfillOptions, DummyValue.UUID], stream: true })
  getBackfill(options: SyncBackfillOptions, albumId: string) {
    const { nowId, beforeUpdateId, afterUpdateId } = options;
    // album_asset arm — the album owner's own membership (unchanged).
    const albumAssetArm = this.db
      .selectFrom('album_asset')
      .innerJoin('asset', 'asset.id', 'album_asset.assetId')
      .select(['album_asset.assetId as assetId', 'album_asset.albumId as albumId', 'album_asset.updateId'])
      .where('album_asset.albumId', '=', albumId)
      .where('album_asset.updateId', '<', nowId)
      .where('album_asset.updateId', '<=', beforeUpdateId)
      .$if(!!afterUpdateId, (qb) => qb.where('album_asset.updateId', '>', afterUpdateId!))
      // correctness-1/security-6: flat visibility gate — never backfill a Hidden/Locked asset's link.
      .where((eb) => spaceVisibilityGate(eb));

    // album_space_asset arm — cross-owner contributions (#764). Mechanical mirror keyed on updateId.
    const contributedArm = this.db
      .selectFrom('album_space_asset')
      .innerJoin('asset', 'asset.id', 'album_space_asset.assetId')
      .select([
        'album_space_asset.assetId as assetId',
        'album_space_asset.albumId as albumId',
        'album_space_asset.updateId',
      ])
      .where('album_space_asset.albumId', '=', albumId)
      .where('album_space_asset.updateId', '<', nowId)
      .where('album_space_asset.updateId', '<=', beforeUpdateId)
      .$if(!!afterUpdateId, (qb) => qb.where('album_space_asset.updateId', '>', afterUpdateId!))
      .where((eb) => spaceVisibilityGate(eb));

    return albumAssetArm.union(contributedArm).orderBy('updateId', 'asc').stream();
  }
```

- [ ] **Step 4: Rewrite `getUpserts` as a two-arm union**

Replace `SharedSpaceAlbumToAssetSync.getUpserts` (`:1658-1673`) with:

```ts
  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getUpserts(options: SyncQueryOptions) {
    const { userId, nowId, ack } = options;
    const albumAssetArm = this.db
      .selectFrom('album_asset')
      .innerJoin('asset', 'asset.id', 'album_asset.assetId')
      .innerJoin('shared_space_album_user', 'shared_space_album_user.albumId', 'album_asset.albumId')
      .select(['album_asset.assetId as assetId', 'album_asset.albumId as albumId', 'album_asset.updateId'])
      .where('shared_space_album_user.userId', '=', userId)
      .where('album_asset.albumId', 'in', (eb) => accessibleSpaceAlbums(eb, userId))
      .where('album_asset.updateId', '<', nowId)
      .$if(!!ack, (qb) => qb.where('album_asset.updateId', '>', ack!.updateId))
      // correctness-1/security-6: flat visibility gate — a restore's updateId bump must not re-add a
      // now-Hidden asset after the delete tombstone (resurrection); also blocks the metadata leak.
      .where((eb) => spaceVisibilityGate(eb));

    const contributedArm = this.db
      .selectFrom('album_space_asset')
      .innerJoin('asset', 'asset.id', 'album_space_asset.assetId')
      .innerJoin('shared_space_album_user', 'shared_space_album_user.albumId', 'album_space_asset.albumId')
      .select([
        'album_space_asset.assetId as assetId',
        'album_space_asset.albumId as albumId',
        'album_space_asset.updateId',
      ])
      .where('shared_space_album_user.userId', '=', userId)
      .where('album_space_asset.albumId', 'in', (eb) => accessibleSpaceAlbums(eb, userId))
      .where('album_space_asset.updateId', '<', nowId)
      .$if(!!ack, (qb) => qb.where('album_space_asset.updateId', '>', ack!.updateId))
      .where((eb) => spaceVisibilityGate(eb));

    return albumAssetArm.union(contributedArm).orderBy('updateId', 'asc').stream();
  }
```

- [ ] **Step 5: Add the third audit arm to `getDeletes`**

In `SharedSpaceAlbumToAssetSync.getDeletes` (`:1624-1656`), add a third arm after `spaceAlbumAssetArm` and fold it into the union. Insert before the `return`:

```ts
// album_space_asset_audit — cross-owner contribution removals (#764). Trigger-driven, so the
// asset row may already be gone on FK cascade → NO asset join. A contribution is never also an
// owner's album_asset row (spec §5.1), so the owner has no independent path → NO ownerId filter:
// every member, including the asset's owner, drops the edge on removal/delete/Hidden-purge.
const contributedAuditArm = this.db
  .selectFrom('album_space_asset_audit')
  .select(['id', 'assetId', 'albumId'])
  .where('id', '<', nowId)
  .$if(!!ack, (qb) => qb.where('id', '>', ack!.updateId))
  .where('albumId', 'in', (eb) => accessibleSpaceAlbums(eb, userId));
```

…and change the final `return` to union all three arms:

```ts
return albumAssetArm.union(spaceAlbumAssetArm).union(contributedAuditArm).orderBy('id', 'asc').stream();
```

- [ ] **Step 6: Wire `album_space_asset_audit` into this stream's audit cleanup**

Task 1 registered `album_space_asset_audit` in the schema, which makes the existing medium test `test/medium/specs/services/sync.service.spec.ts > should cleanup every table` (it derives audit tables from `schemaFromCode()` and asserts one `auditCleanup` call per registered `*_audit` table) expect one more `auditCleanup` call than the wiring currently makes — so it is **red until this step**. `SharedSpaceAlbumToAssetSync.cleanupAuditTable` (`:1677-1679`) currently prunes only `shared_space_album_asset_audit`; make it prune both audit tables this stream owns:

```ts
  // Prune the space-only audit tables this stream owns. The shared album_asset_audit is pruned by
  // albumToAsset.cleanupAuditTable (AlbumToAssetSync).
  async cleanupAuditTable(daysAgo: number) {
    await this.auditCleanup('shared_space_album_asset_audit', daysAgo);
    await this.auditCleanup('album_space_asset_audit', daysAgo);
  }
```

> `auditCleanup` returns a Kysely `.execute()` promise; awaiting both sequentially is fine. The caller (`sync.service.ts:297`) already `await`s `cleanupAuditTable`, so converting it from returning one promise to `async … Promise<void>` is safe.

- [ ] **Step 7: Run the tests to confirm green (incl. the cleanup test Task 1 left red)**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/sync/shared-space-album-to-asset-sync.spec.ts test/medium/specs/services/sync.service.spec.ts`
Expected: PASS — new contribution cases green, all pre-existing cases green, and `should cleanup every table` green again (now `auditCleanup` is called for `album_space_asset_audit`).

- [ ] **Step 8: Type-check**

Run: `cd server && pnpm check`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add server/src/repositories/sync.repository.ts server/test/medium/specs/sync/shared-space-album-to-asset-sync.spec.ts
git commit -m "feat(spaces): union contributions into SharedSpaceAlbumToAssetSync (#764 slice 5)"
```

---

## Task 3: Union the contributed arm into the asset + EXIF payload streams

**Delivers.** A contributed asset's full payload (`SharedSpaceAlbumAssetSync`) and EXIF (`SharedSpaceAlbumAssetExifSync`) reach every member, so a contributed photo renders (not a grey placeholder) on device.

**Files:**

- Modify: `server/src/repositories/sync.repository.ts` (`SharedSpaceAlbumAssetSync` `:1689-1758`, `SharedSpaceAlbumAssetExifSync` `:1763-1808`)
- Test: `server/test/medium/specs/sync/shared-space-album-asset-sync.spec.ts` (extend — payload) and `server/test/medium/specs/sync/shared-space-album-asset-exif-sync.spec.ts` (extend — exif)

> **Test-file targeting (verified):** these two repo-level specs already define `NOW_ID`, `BEFORE_UPDATE_ID`, and a `setup()` returning `sut = ctx.get(SyncRepository).sharedSpaceAlbumAsset` (resp. `.sharedSpaceAlbumAssetExif`) — use those. Do **not** target `sync-shared-space-album.spec.ts` (its `setup()` returns `{ auth, user, session, ctx }` and has none of that harness). Neither repo-level file defines a `drain` helper — either add a local `const drain = async (s) => { const o = []; for await (const r of s) o.push(r); return o; };` at the top of your new `describe`, or inline the `for await` collect as the file's existing tests do.

**Interfaces:**

- Consumes: `album_space_asset.{assetId, albumId, updateId}` (Task 1); `columns.syncAlbumAsset`, `columns.syncAssetExif`, `accessibleSpaceAlbums`, `spaceVisibilityGate` (already in file).
- Produces: contributed asset/exif rows in the identical output shape as the `album_asset` arm — no service/mobile change.

> **General rule for this task:** each method becomes a UNION of the **existing** `album_asset` arm (rewritten inline, unchanged predicates) and a **contributed** arm that is the same query with `album_asset` → `album_space_asset` and the membership watermark `album_asset.updateId` → `album_space_asset.updateId`. **Preserve every existing `select` (including `columns.syncAlbumAsset` / `columns.syncAssetExif` and the `isFavorite` CASE) verbatim and in the same order** so both arms produce matching UNION columns. Use `.union()` (dedup), matching `getDeletes`.

- [ ] **Step 1a: Write failing payload tests in `shared-space-album-asset-sync.spec.ts`**

Read the top of `server/test/medium/specs/sync/shared-space-album-asset-sync.spec.ts` and reuse its existing `setup()` (returns `{ ctx, db, sut }` with `sut = ctx.get(SyncRepository).sharedSpaceAlbumAsset`), `NOW_ID`, and `BEFORE_UPDATE_ID`. Append a `describe`. Add a local `drain` helper if the file has none:

```ts
const drain = async (stream: AsyncIterable<any>) => {
  const out: any[] = [];
  for await (const row of stream) out.push(row);
  return out;
};

describe('SharedSpaceAlbumAssetSync — contributions (album_space_asset)', () => {
  const seed = async (ctx: SyncTestContext) => {
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { user: carol } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { asset } = await ctx.newAsset({ ownerId: carol.id }); // owned by someone else
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
    await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: asset.id, spaceId: space.id });
    return { owner, member, carol, album, asset, space };
  };

  it('getCreates emits the contributed asset payload to a member', async () => {
    const { ctx, sut } = setup();
    const { member, asset } = await seed(ctx);
    const rows = await drain(sut.getCreates({ nowId: NOW_ID, userId: member.id }));
    expect(rows.some((r: any) => r.id === asset.id)).toBe(true);
  });

  it('getBackfill emits the contributed asset payload for the album', async () => {
    const { ctx, sut } = setup();
    const { member, album, asset } = await seed(ctx);
    const rows = await drain(sut.getBackfill({ nowId: NOW_ID, beforeUpdateId: BEFORE_UPDATE_ID }, album.id, member.id));
    expect(rows.some((r: any) => r.id === asset.id)).toBe(true);
  });
});
```

> **Match the file's real `setup()` shape.** If its `setup()` returns `{ ctx, sut }` (no `db`), use that; if it returns something else, adapt. The two facts that must hold: `sut` is `sharedSpaceAlbumAsset` and `NOW_ID`/`BEFORE_UPDATE_ID` are defined at file scope (they are).

- [ ] **Step 1b: Write the failing exif test in `shared-space-album-asset-exif-sync.spec.ts`**

Read the top of `server/test/medium/specs/sync/shared-space-album-asset-exif-sync.spec.ts` (its `setup()` returns `sut = ctx.get(SyncRepository).sharedSpaceAlbumAssetExif`). The contributed asset needs an `asset_exif` row — use the `newExif` helper (`test/medium.factory.ts:223`, `newExif({ assetId })`). Append:

```ts
describe('SharedSpaceAlbumAssetExifSync — contributions (album_space_asset)', () => {
  it('getCreates emits the contributed asset exif to a member', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { user: carol } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { asset } = await ctx.newAsset({ ownerId: carol.id });
    await ctx.newExif({ assetId: asset.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
    await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: asset.id, spaceId: space.id });

    const out: any[] = [];
    for await (const row of sut.getCreates({ nowId: NOW_ID, userId: member.id })) out.push(row);
    expect(out.some((r: any) => r.assetId === asset.id)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/sync/shared-space-album-asset-sync.spec.ts test/medium/specs/sync/shared-space-album-asset-exif-sync.spec.ts`
Expected: FAIL on the new contribution cases (only `album_asset` assets are streamed today).

- [ ] **Step 3: Rewrite `SharedSpaceAlbumAssetSync.getBackfill` as a union**

Replace the method (`:1691-1710`). Keep the `columns.syncAlbumAsset` + `isFavorite` CASE + `album.deletedAt IS NULL` + `spaceVisibilityGate` exactly; add the contributed arm:

```ts
  @GenerateSql({ params: [dummyBackfillOptions, DummyValue.UUID, DummyValue.UUID], stream: true })
  getBackfill(options: SyncBackfillOptions, albumId: string, userId: string) {
    const { nowId, beforeUpdateId, afterUpdateId } = options;
    const favorite = (eb: any) =>
      eb.case().when('asset.ownerId', '=', userId).then(eb.ref('asset.isFavorite')).else(eb.val(false)).end().as('isFavorite');

    const albumAssetArm = this.db
      .selectFrom('album_asset')
      .innerJoin('asset', 'asset.id', 'album_asset.assetId')
      .innerJoin('album', 'album.id', 'album_asset.albumId')
      .select(columns.syncAlbumAsset)
      .select(favorite)
      .select('album_asset.updateId')
      .where('album_asset.albumId', '=', albumId)
      .where('album.deletedAt', 'is', null)
      .where('album_asset.updateId', '<', nowId)
      .where('album_asset.updateId', '<=', beforeUpdateId)
      .$if(!!afterUpdateId, (qb) => qb.where('album_asset.updateId', '>', afterUpdateId!))
      .where((eb) => spaceVisibilityGate(eb));

    const contributedArm = this.db
      .selectFrom('album_space_asset')
      .innerJoin('asset', 'asset.id', 'album_space_asset.assetId')
      .innerJoin('album', 'album.id', 'album_space_asset.albumId')
      .select(columns.syncAlbumAsset)
      .select(favorite)
      .select('album_space_asset.updateId')
      .where('album_space_asset.albumId', '=', albumId)
      .where('album.deletedAt', 'is', null)
      .where('album_space_asset.updateId', '<', nowId)
      .where('album_space_asset.updateId', '<=', beforeUpdateId)
      .$if(!!afterUpdateId, (qb) => qb.where('album_space_asset.updateId', '>', afterUpdateId!))
      .where((eb) => spaceVisibilityGate(eb));

    return albumAssetArm.union(contributedArm).orderBy('updateId', 'asc').stream();
  }
```

> If TypeScript rejects the shared `favorite` lambda's `eb: any`, inline the CASE expression identically into both arms instead (copy the original `.select((eb) => eb.case()…)` into each arm). Behavior must be byte-identical to the original select.

- [ ] **Step 4: Rewrite `SharedSpaceAlbumAssetSync.getCreates` as a union**

Replace `:1737-1757`. Existing arm keys on `album_asset.updateId > ack`; contributed arm on `album_space_asset.updateId > ack`:

```ts
  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getCreates(options: SyncQueryOptions) {
    const { userId, nowId, ack } = options;
    const favorite = (eb: any) =>
      eb.case().when('asset.ownerId', '=', userId).then(eb.ref('asset.isFavorite')).else(eb.val(false)).end().as('isFavorite');

    const albumAssetArm = this.db
      .selectFrom('album_asset')
      .innerJoin('asset', 'asset.id', 'album_asset.assetId')
      .innerJoin('shared_space_album_user', 'shared_space_album_user.albumId', 'album_asset.albumId')
      .select(columns.syncAlbumAsset)
      .select(favorite)
      .select('album_asset.updateId')
      .where('shared_space_album_user.userId', '=', userId)
      .where('album_asset.albumId', 'in', (eb) => accessibleSpaceAlbums(eb, userId))
      .where('album_asset.updateId', '<', nowId)
      .$if(!!ack, (qb) => qb.where('album_asset.updateId', '>', ack!.updateId))
      .where((eb) => spaceVisibilityGate(eb));

    const contributedArm = this.db
      .selectFrom('album_space_asset')
      .innerJoin('asset', 'asset.id', 'album_space_asset.assetId')
      .innerJoin('shared_space_album_user', 'shared_space_album_user.albumId', 'album_space_asset.albumId')
      .select(columns.syncAlbumAsset)
      .select(favorite)
      .select('album_space_asset.updateId')
      .where('shared_space_album_user.userId', '=', userId)
      .where('album_space_asset.albumId', 'in', (eb) => accessibleSpaceAlbums(eb, userId))
      .where('album_space_asset.updateId', '<', nowId)
      .$if(!!ack, (qb) => qb.where('album_space_asset.updateId', '>', ack!.updateId))
      .where((eb) => spaceVisibilityGate(eb));

    return albumAssetArm.union(contributedArm).orderBy('updateId', 'asc').stream();
  }
```

- [ ] **Step 5: Rewrite `SharedSpaceAlbumAssetSync.getUpdates` as a union**

Replace `:1713-1734`. Both arms key on `asset.updateId > ack` (payload mutation); membership-coupling gate becomes `album_space_asset.updateId <= albumToAssetAck.updateId` for the contributed arm:

```ts
  @GenerateSql({ params: [dummyQueryOptions, { updateId: DummyValue.UUID }], stream: true })
  getUpdates(options: SyncQueryOptions, albumToAssetAck: SyncAck) {
    const { userId, nowId, ack } = options;
    const favorite = (eb: any) =>
      eb.case().when('asset.ownerId', '=', userId).then(eb.ref('asset.isFavorite')).else(eb.val(false)).end().as('isFavorite');

    const albumAssetArm = this.db
      .selectFrom('asset')
      .innerJoin('album_asset', 'album_asset.assetId', 'asset.id')
      .innerJoin('shared_space_album_user', 'shared_space_album_user.albumId', 'album_asset.albumId')
      .select(columns.syncAlbumAsset)
      .select(favorite)
      .select('asset.updateId')
      .where('asset.updateId', '<', nowId)
      .$if(!!ack, (qb) => qb.where('asset.updateId', '>', ack!.updateId))
      .where('album_asset.updateId', '<=', albumToAssetAck.updateId)
      .where('shared_space_album_user.userId', '=', userId)
      .where('album_asset.albumId', 'in', (eb) => accessibleSpaceAlbums(eb, userId))
      .where((eb) => spaceVisibilityGate(eb));

    const contributedArm = this.db
      .selectFrom('asset')
      .innerJoin('album_space_asset', 'album_space_asset.assetId', 'asset.id')
      .innerJoin('shared_space_album_user', 'shared_space_album_user.albumId', 'album_space_asset.albumId')
      .select(columns.syncAlbumAsset)
      .select(favorite)
      .select('asset.updateId')
      .where('asset.updateId', '<', nowId)
      .$if(!!ack, (qb) => qb.where('asset.updateId', '>', ack!.updateId))
      .where('album_space_asset.updateId', '<=', albumToAssetAck.updateId)
      .where('shared_space_album_user.userId', '=', userId)
      .where('album_space_asset.albumId', 'in', (eb) => accessibleSpaceAlbums(eb, userId))
      .where((eb) => spaceVisibilityGate(eb));

    return albumAssetArm.union(contributedArm).orderBy('updateId', 'asc').stream();
  }
```

> The original `getUpdates` used `upsertQuery('asset', options)`; the inline rewrite reproduces its `asset.updateId < nowId` / `> ack` window so the two arms can UNION. Confirm the `SyncAck` type is already imported (it is — used by the original signature).

- [ ] **Step 6: Apply the identical three-method union to `SharedSpaceAlbumAssetExifSync`**

Repeat Steps 3–5 for `SharedSpaceAlbumAssetExifSync` (`:1763-1808`), using `asset_exif` + `columns.syncAssetExif` (no `isFavorite` CASE — exif has none). For each of its `getBackfill` / `getUpdates` / `getCreates`, mirror the existing arm and add a contributed arm swapping `album_asset` → `album_space_asset` and its `updateId`. Preserve the exif joins exactly:

- `getBackfill`: `album_(space_)asset` ⋈ `asset_exif` ⋈ `album` (deletedAt null) ⋈ `asset`; select `columns.syncAssetExif` + `<table>.updateId`; window on the membership `updateId`.
- `getUpdates`: `asset_exif` ⋈ `album_(space_)asset` ⋈ `asset`; key on `asset_exif.updateId` window; coupling `<table>.updateId <= albumToAssetAck.updateId`; grant + accessibleSpaceAlbums + visGate.
- `getCreates`: `album_(space_)asset` ⋈ `asset_exif` ⋈ `asset`; window on membership `updateId > ack`; grant + accessibleSpaceAlbums + visGate.
  Each returns `albumAssetArm.union(contributedArm).orderBy('updateId', 'asc').stream()`.

- [ ] **Step 7: Run the tests to confirm green**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/sync/shared-space-album-asset-sync.spec.ts test/medium/specs/sync/shared-space-album-asset-exif-sync.spec.ts`
Expected: PASS — contributed payload + exif cases green, pre-existing cases green.

- [ ] **Step 8: Type-check**

Run: `cd server && pnpm check`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add server/src/repositories/sync.repository.ts server/test/medium/specs/sync/shared-space-album-asset-sync.spec.ts server/test/medium/specs/sync/shared-space-album-asset-exif-sync.spec.ts
git commit -m "feat(spaces): stream contributed asset payload + exif to members (#764 slice 5)"
```

---

## Task 4: Hidden/restore parity + audit cleanup for contributions

**Delivers.** When a contributed asset is marked Hidden, member devices drop it (no mobile Hidden leak — §10); when un-hidden, it re-appears via the `updateId` bump. The new audit table is pruned on the cleanup schedule.

**Files:**

- Modify: `server/src/repositories/shared-space.repository.ts` (`emitAlbumAssetVisibilityPurge` `:540`, `emitAlbumAssetVisibilityRestore` `:573`)
- Modify: `server/src/repositories/sync.repository.ts` (`SharedSpaceAlbumToAssetSync.cleanupAuditTable` `:1677`)
- Test: `server/test/medium/specs/sync/sync-shared-space-album-visibility-purge.spec.ts` (extend)

**Interfaces:**

- Consumes: `album_space_asset_audit` (Task 1), the delete arm (Task 2), the `updateId` bump path via the `album_space_asset_updatedAt` trigger (Task 1).
- Produces: no signature change — `asset.service.ts` call sites (`:425`, `:452`) already pass `purgeIds` / `restoreIds`.

- [ ] **Step 1: Write failing medium tests**

Read the top of `sync-shared-space-album-visibility-purge.spec.ts` for its `setup()`/helpers, then append:

```ts
describe('contribution visibility parity (album_space_asset)', () => {
  it('purge tombstones a contributed asset so getDeletes drops it for members', async () => {
    const ctx = new SyncTestContext(defaultDatabase);
    const sharedSpace = ctx.get(SharedSpaceRepository);
    const toAsset = ctx.get(SyncRepository).sharedSpaceAlbumToAsset;
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { user: carol } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { asset } = await ctx.newAsset({ ownerId: carol.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
    await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: asset.id, spaceId: space.id });

    await sharedSpace.emitAlbumAssetVisibilityPurge([asset.id]);

    const audit = await defaultDatabase
      .selectFrom('album_space_asset_audit')
      .selectAll()
      .where('assetId', '=', asset.id)
      .execute();
    expect(audit).toHaveLength(1);

    const deletes: any[] = [];
    for await (const row of toAsset.getDeletes({ nowId: NOW_ID, userId: member.id })) {
      deletes.push(row);
    }
    expect(deletes.some((r) => r.albumId === album.id && r.assetId === asset.id)).toBe(true);
  });

  it('restore bumps the contribution updateId so getUpserts re-emits it', async () => {
    const ctx = new SyncTestContext(defaultDatabase);
    const sharedSpace = ctx.get(SharedSpaceRepository);
    const { user: owner } = await ctx.newUser();
    const { user: carol } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { asset } = await ctx.newAsset({ ownerId: carol.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
    await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: asset.id, spaceId: space.id });

    const before = await defaultDatabase
      .selectFrom('album_space_asset')
      .select('updateId')
      .where('assetId', '=', asset.id)
      .executeTakeFirstOrThrow();

    await sharedSpace.emitAlbumAssetVisibilityRestore([asset.id]);

    const after = await defaultDatabase
      .selectFrom('album_space_asset')
      .select('updateId')
      .where('assetId', '=', asset.id)
      .executeTakeFirstOrThrow();
    expect(after.updateId).not.toBe(before.updateId);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/sync/sync-shared-space-album-visibility-purge.spec.ts`
Expected: FAIL — purge writes no `album_space_asset_audit` row; restore does not bump `album_space_asset.updateId`.

- [ ] **Step 3: Extend `emitAlbumAssetVisibilityPurge`**

In `server/src/repositories/shared-space.repository.ts`, after the existing `shared_space_album_asset_audit` insert in `emitAlbumAssetVisibilityPurge` (`:545-557`), add a second insert that tombstones contributed rows into `album_space_asset_audit`:

```ts
// #764: contributions live in album_space_asset (not album_asset); tombstone the contributed
// (albumId, assetId) pairs too so SharedSpaceAlbumToAssetSync.getDeletes drops a now-Hidden
// contribution on member devices. Only space-linked albums (the album_space_asset FK already
// guarantees that, but keep the space-link filter symmetric with the album_asset arm).
await this.db
  .insertInto('album_space_asset_audit')
  .columns(['albumId', 'assetId'])
  .expression(
    this.db
      .selectFrom('album_space_asset')
      .select(['album_space_asset.albumId', 'album_space_asset.assetId'])
      .where('album_space_asset.assetId', 'in', assetIds),
  )
  .execute();
```

- [ ] **Step 4: Extend `emitAlbumAssetVisibilityRestore`**

In the same file, after the existing `album_asset` `updatedAt` bump in `emitAlbumAssetVisibilityRestore` (`:578-583`), add a bump for contributed rows (the `album_space_asset_updatedAt` trigger turns the touch into a fresh `updateId`):

```ts
// #764: bump contributed rows too so getUpserts re-emits an un-hidden contribution to devices
// that purged it. The album_space_asset_updatedAt BEFORE-UPDATE trigger regenerates updateId.
await this.db
  .updateTable('album_space_asset')
  .set({ updatedAt: sql`clock_timestamp()` })
  .where('assetId', 'in', assetIds)
  .execute();
```

> `sql` is already imported in `shared-space.repository.ts` (used by the sibling methods).
>
> **Note:** the `cleanupAuditTable` wiring for `album_space_asset_audit` was moved to **Task 2 Step 6** (it must land in the same commit range that keeps the `should cleanup every table` medium test green). Do not re-add it here.

- [ ] **Step 5: Run the tests to confirm green**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/sync/sync-shared-space-album-visibility-purge.spec.ts`
Expected: PASS.

- [ ] **Step 6: Run the existing purge unit tests (guard against regressions)**

Run: `cd server && pnpm test -- --run src/services/asset.service.spec.ts`
Expected: PASS — the `emitAlbumAssetVisibilityPurge`/`Restore` mocks are unchanged (still called with the same asset-id arrays); the added inserts are inside the mocked repository method, invisible to the service unit test.

- [ ] **Step 7: Type-check**

Run: `cd server && pnpm check`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add server/src/repositories/shared-space.repository.ts server/src/repositories/sync.repository.ts server/test/medium/specs/sync/sync-shared-space-album-visibility-purge.spec.ts
git commit -m "feat(spaces): Hidden/restore parity + audit prune for contributions (#764 slice 5)"
```

---

## Task 5: Service-level convergence — backfill-on-join, monotonicity, no spurious asset deletion

**Delivers.** End-to-end proof through the real `SyncService` seam that: a member who joins a space with pre-existing contributions **backfills** them; the delete arm never causes a spurious **asset** deletion; and re-emitting after ack is monotonic (no duplicates).

**Files:**

- Test: `server/test/medium/specs/services/sync.service.spec.ts` (extend) — or a new `server/test/medium/specs/sync/album-space-asset-convergence.spec.ts` if the service spec's setup does not fit.

**Interfaces:**

- Consumes: the full `SyncService` (via `SyncTestContext`, whose generic is `SyncService`), Tasks 2–4.

- [ ] **Step 1: Inspect the existing service-level sync test**

Read `server/test/medium/specs/services/sync.service.spec.ts` (and `sync-shared-space-album.spec.ts`) to learn how they drive a full sync: they typically build a `newSyncAuthUser()`, request a set of `SyncRequestType`s, and collect the emitted `SyncItem`s. Mirror that harness. Identify the request types `SharedSpaceAlbumToAssetsV1`, `SharedSpaceAlbumAssetsV1`, `SharedSpaceAlbumAssetExifsV1` and the ack/checkpoint plumbing used there.

- [ ] **Step 2: Write the failing convergence test**

Add a `describe` that:

1. Creates space S (owner) + album L linked to S + a contribution `(L, X, S)` where X is owned by Carol, **before** `member` joins.
2. Adds `member` to S (Editor) — which fires the grant trigger.
3. Runs a full sync for `member` and asserts a `SharedSpaceAlbumToAssetV1` (or `…BackfillV1`) item for `(L, X)` **and** a `SharedSpaceAlbumAssetV1` payload item for X are emitted (backfill-on-join).
4. Acks, then re-syncs with the returned checkpoint and asserts **no** duplicate `(L, X)` membership item (monotonicity).
5. Removes the contribution (`db.deleteFrom('album_space_asset')…`), re-syncs, asserts a `SharedSpaceAlbumToAssetDeleteV1` for `(L, X)` is emitted, and asserts the **asset X row still exists** in the DB (`selectFrom('asset').where('id','=',X)` returns the row) — i.e. removing a contribution edge never deletes the underlying asset.

Encode each assertion concretely against the emitted `SyncItem[]` shape used by the existing service spec (match its field names — likely `item.type` and `item.data`). Use the existing spec's collect/ack helpers verbatim rather than inventing new ones.

> If the service spec exposes no reusable "run a full sync and return items" helper, prefer extending the repo-level assertions already covered in Tasks 2–4 and implement the **backfill-on-join** + **no-spurious-asset-deletion** as repo-level checks in `shared-space-album-to-asset-sync.spec.ts` instead (getBackfill returns X for the just-joined member's album; after `deleteFrom('album_space_asset')`, `getDeletes` yields the edge while `selectFrom('asset')` still returns X). Keep the monotonicity assertion at the repo level: run `getUpserts` with `ack = { updateId: <max emitted updateId> }` and assert the row is **not** re-emitted.

- [ ] **Step 3: Run to confirm failure (if any new production gap surfaces)**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/services/sync.service.spec.ts`
Expected: The backfill/monotonicity/no-spurious-deletion assertions should pass **given Tasks 2–4** — this task is a higher-level guard. If any fails, it reveals a real gap (e.g. a missed arm); fix the corresponding stream method from Task 2/3 and re-run. If all pass on first run, that is acceptable here because the behavior is delivered by Tasks 2–4 and this task's value is the end-to-end regression guard — note this explicitly in the commit body.

- [ ] **Step 4: Commit**

```bash
git add server/test/medium/specs
git commit -m "test(spaces): service-level convergence for contribution sync (#764 slice 5)"
```

---

## Task 6: Mobile Flutter convergence regression test

**Delivers.** A `flutter test` proving the mobile Drift layer converges for a contribution `(albumId, assetId)` membership: present after an insert event, absent after a delete event, with the remote asset blob retained. **No mobile production code changes** — mobile is origin-blind; this is a regression guard that locks in that a contribution (indistinguishable from an owner membership on the wire) converges through the existing handlers.

**Files:**

- Test: `mobile/test/domain/repositories/sync_stream_repository_test.dart` (extend the existing `SyncStreamRepository - SharedSpaceAlbum handlers` group, ~lines 1706-1996)

**Interfaces:**

- Consumes: existing handlers `SyncStreamRepository.updateSharedSpaceAlbumToAssetsV1` / `deleteSharedSpaceAlbumToAssetsV1` / `updateSharedSpaceAlbumAssetsV1`; Drift `db.sharedSpaceAlbumAssetEntity`, `db.remoteAssetEntity`; local builders `makeAlbumToAsset`, `makeAlbumV2` (already in the file).

- [ ] **Step 1: Regenerate localization/keys (once) so `flutter test` compiles**

Per CLAUDE.md, from `mobile/` with Flutter 3.41.7:

```bash
cd mobile && flutter pub get && dart run easy_localization:generate -S ../i18n && dart run bin/generate_keys.dart
```

- [ ] **Step 2: Write the convergence test**

In `mobile/test/domain/repositories/sync_stream_repository_test.dart`, inside the `SharedSpaceAlbum handlers` group, add:

```dart
group('cross-owner contribution convergence (#764)', () {
  test('a contributed (albumId, assetId) membership is present after insert, absent after delete, blob retained', () async {
    // Contribution rides the SAME SharedSpaceAlbumToAssetV1 membership + SharedSpaceAlbumAssetV1
    // payload events as an owner's album_asset — mobile is origin-blind (no owner column on the row).
    await sut.updateSharedSpaceAlbumAssetsV1([makeAssetV2(id: 'contrib-asset')]);
    await sut.updateSharedSpaceAlbumToAssetsV1([
      makeAlbumToAsset(albumId: 'album-1', assetId: 'contrib-asset'),
    ]);

    final present = await db.sharedSpaceAlbumAssetEntity.select().get();
    expect(present.any((r) => r.albumId == 'album-1' && r.assetId == 'contrib-asset'), isTrue);

    await sut.deleteSharedSpaceAlbumToAssetsV1([
      SyncAlbumToAssetDeleteV1(albumId: 'album-1', assetId: 'contrib-asset'),
    ]);

    final afterDelete = await db.sharedSpaceAlbumAssetEntity.select().get();
    expect(afterDelete.any((r) => r.assetId == 'contrib-asset'), isFalse);

    // Removing the membership edge must NOT delete the asset blob (only pruneAssets GCs it).
    final blob = await db.remoteAssetEntity.select().get();
    expect(blob.any((r) => r.id == 'contrib-asset'), isTrue);
  });
});
```

> Confirm the exact local builder names in the file: use `makeAlbumToAsset` (present ~line 1685). For the asset-payload event, use the same builder the existing `updateSharedSpaceAlbumAssetsV1` test uses (search the file for `updateSharedSpaceAlbumAssetsV1` / `makeAssetV2` / `SyncAssetV2` and match it). If the exif assertion is trivial to add with the file's existing exif builder, add a parallel `remoteExifEntity` check; otherwise the payload+membership convergence above is sufficient for the regression guard.

- [ ] **Step 3: Run the test**

Run: `cd mobile && flutter test test/domain/repositories/sync_stream_repository_test.dart`
Expected: PASS. (Because mobile is origin-blind, this test is green without production changes — it is a **characterization/regression guard**, not a red-first test. State this in the commit body so the absence of a red phase is intentional and documented.)

- [ ] **Step 4: Mobile analyze gate (CI parity)**

Run: `cd mobile && dart analyze --fatal-infos lib test` and `dart format --set-exit-if-changed test/domain/repositories/sync_stream_repository_test.dart`
Expected: clean / no reformat. (Per `feedback_mobile_dart_analyze_ci_fatal_infos`: analyze covers `test/` lints that `flutter analyze lib` misses, and format is a separate gate.)

- [ ] **Step 5: Commit**

```bash
git add mobile/test/domain/repositories/sync_stream_repository_test.dart
git commit -m "test(mobile): contribution sync convergence regression guard (#764 slice 5)"
```

---

## Task 7: SQL regeneration + full-suite validation + push

**Delivers.** Regenerated query docs, green full server medium + unit suites, green mobile test, and the branch pushed.

**Files:**

- Modify (generated): `server/src/queries/*.sql` (via `make sql`)

- [ ] **Step 1: Regenerate query SQL against a SCRATCH migrated DB**

⚠️ Per CLAUDE.md and `feedback_make_sql_no_db`: **never** run `make sql` without a running DB or against the dev-stack DB (it deletes/corrupts query files). Bring up a scratch DB, run migrations against it, then `make sql`. Follow the repo's documented scratch-DB procedure (the same one Slice 1's `chore(server): regenerate SQL` commit used). Confirm the diff is limited to the sync/shared-space query files touched by Tasks 2–4:

Run: `cd server && git status --short src/queries`
Expected: only `sync.repository.sql` and `shared.space.repository.sql` (and possibly `album.repository.sql`) changed; no unrelated deletions.

- [ ] **Step 2: Full server medium suite (sync + shared-space area)**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/sync test/medium/specs/services`
Expected: PASS (no regressions in #752 sync suites, trash-lifecycle, cross-path purge, visibility gate).

- [ ] **Step 3: Server unit suite for touched services**

Run: `cd server && pnpm test -- --run src/services/asset.service.spec.ts src/services/album.service.spec.ts`
Expected: PASS.

- [ ] **Step 4: Server type-check + lint**

Run: `cd server && pnpm check && pnpm lint`
Expected: clean, zero warnings.

- [ ] **Step 5: Mobile test (re-confirm)**

Run: `cd mobile && flutter test test/domain/repositories/sync_stream_repository_test.dart`
Expected: PASS.

- [ ] **Step 6: Commit regenerated SQL**

```bash
git add server/src/queries
git commit -m "chore(server): regenerate SQL for contribution sync streams (#764 slice 5)"
```

- [ ] **Step 7: Push**

```bash
git push
```

(Branch `feat/space-albums-collab-contrib` already has an upstream — plain `git push`. If not: `git push -u origin feat/space-albums-collab-contrib`.)

---

## Self-Review checklist (run before execution)

- **Spec §7.2 (mobile/sync):** ✅ union `album_space_asset` into `SharedSpaceAlbumToAssetSync` (Task 2), payload+exif into `SharedSpaceAlbumAssetSync`/`ExifSync` (Task 3), deletes via `album_space_asset_audit` (Tasks 1–2). New `SyncEntityType`/`RequestType`? **No** — decided not needed (mobile origin-blind); documented in Architecture.
- **Slice 5 BDD:** contribution create+payload+exif arrive (Tasks 2–3); removal → edge deleted via audit (Tasks 1–2); join → backfill (Task 5). ✅
- **Slice 5 edge cases:** leave/unlink handled by #752 album-level sweep (out of this slice's new code — noted); no spurious asset deletion (Task 5); re-link/re-join idempotent (getBackfill dedup + `onConflict` on device); ack monotonicity (Task 5). ✅
- **§10 no-Hidden-leak incl. Hidden-after-contribution (mobile):** purge tombstone (Task 4). Restore parity (Task 4, via `updateId`). ✅ (Design B, per user decision.)
- **Placeholder scan:** migration/decorator/stream code shown in full; test code shown; the two "read the file and match" notes (exif builder name, service-spec collect helper) are unavoidable local-lookup instructions, not deferred logic. ✅
- **Type consistency:** all arms select matching UNION columns (`{assetId, albumId, updateId}` for membership; `columns.syncAlbumAsset`+`isFavorite`+`updateId` for asset; `columns.syncAssetExif`+`updateId` for exif); watermark alias `updateId` used uniformly for `orderBy`. ✅
- **Not implementing future slices:** Slice 6 (web legibility) untouched. ✅

```

```
