# Space Album Folders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Shared Space members organise a space's linked albums into arbitrarily-nested folders that are purely visual — no permissions, no timeline effect.

**Architecture:** A new fork table `shared_space_album_folder` (adjacency list, self-FK `parentId`) plus a nullable `folderId` on the existing `shared_space_album` join table. Placement lives on the _join_, so personal albums structurally cannot be nested and one album linked into two spaces has an independent placement in each. The server exposes a flat folder list; the web client builds the tree, and derives counts and collage previews from data it already holds.

**Tech Stack:** NestJS 11 + Kysely + PostgreSQL 14 (server), SvelteKit + Svelte 5 runes (web), Vitest everywhere, Playwright/supertest for e2e.

**Spec:** `docs/superpowers/specs/2026-08-04-space-album-folders-design.md`. Every task below cites the scenario IDs it implements. All 95 IDs are covered; §13 of this plan is the coverage matrix.

## Global Constraints

- **PostgreSQL 14 floor.** No `NULLS NOT DISTINCT`, no per-column `ON DELETE SET NULL`. Two partial unique indexes instead (spec §3.3), single-column FK instead of composite (spec §3.2.1).
- **Max folder depth 10**, root = depth 1, cap inclusive. Constant `SHARED_SPACE_ALBUM_FOLDER_MAX_DEPTH`.
- **Max 500 folders per space.** Constant `SHARED_SPACE_ALBUM_FOLDER_MAX_PER_SPACE`.
- **Folder names:** trimmed, 1–128 chars, case-insensitively unique among siblings. The database is authoritative on case folding.
- **All validation failures throw `BadRequestException` (400).** `shared-space.service.ts` never throws `ConflictException` — that is reserved codebase-wide for `merge-policy.ts`'s structured cross-owner conflict. Do not "improve" this to 409.
- **Never run `this.db` queries inside a Kysely `transaction()` callback** — use the `trx` handle. Doing otherwise deadlocks (issue #595).
- **No relative imports in server code** — use the `src/` alias.
- **Fork migrations go in `server/src/schema/migrations-gallery/`** with a round timestamp, never in `migrations/`.
- **i18n lives in `i18n/en.json`** (shared by web _and_ mobile). English only; translations arrive via Weblate.
- **Mobile is out of scope.** Do not add `folderId` to any sync payload.

---

## File Structure

**Server — new**

| File                                                                                   | Responsibility                                                     |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `server/src/schema/tables/shared-space-album-folder.table.ts`                          | Table definition + indexes + updatedAt trigger                     |
| `server/src/schema/migrations-gallery/1785000000000-AddSharedSpaceAlbumFolderTable.ts` | DDL for the table, the `folderId` column, and the trigger override |
| `server/test/medium/specs/repositories/shared-space-album-folder.repository.spec.ts`   | Repository primitives, constraints, cascades, concurrency          |
| `e2e/src/specs/server/api/shared-space-album-folder.e2e-spec.ts`                       | RBAC matrix end-to-end                                             |

**Server — modified**

`shared-space-album.table.ts` (add `folderId`) · `enum.ts` (3 `Permission` values) · `shared-space.dto.ts` (folder DTOs) · `shared-space.repository.ts` (folder primitives) · `shared-space.service.ts` (folder service methods + 2 constants) · `shared-space.controller.ts` (4 new routes + link query param) · `shared-space.service.spec.ts` · `shared-space.controller.spec.ts` · `queries/shared.space.repository.sql` (regenerated)

**Web — new**

| File                                                                 | Responsibility                                         |
| -------------------------------------------------------------------- | ------------------------------------------------------ |
| `web/src/lib/utils/space-album-folders.ts`                           | Pure tree functions — no DOM, no SDK calls             |
| `web/src/lib/utils/space-album-folders.spec.ts`                      | U-01–U-11                                              |
| `web/src/lib/components/spaces/space-album-folder-card.svelte`       | Folder tile: collage, badge, count, kebab, drop target |
| `web/src/lib/components/spaces/space-album-folder-breadcrumb.svelte` | Crumb trail, each crumb a drop target                  |
| `web/src/lib/modals/SpaceAlbumFolderPickerModal.svelte`              | Accessible move path                                   |
| Matching `.spec.ts` files for each of the three components           | W-01, W-08, W-11, W-17, W-20                           |

**Web — modified**

`space-albums-{controls,list,table,album-card}.svelte` · `SpaceLinkAlbumModal.svelte` · `route.ts` · `spaces/[spaceId]/albums/+page.svelte` · `space-albums-page.spec.ts`

---

## Task 1: Schema, migration, and the `folderId` column

**Implements:** X-01, X-02, X-03, and the index behaviour behind F-03 / F-04.

**Files:**

- Create: `server/src/schema/tables/shared-space-album-folder.table.ts`
- Create: `server/src/schema/migrations-gallery/1785000000000-AddSharedSpaceAlbumFolderTable.ts`
- Create: `server/test/medium/specs/repositories/shared-space-album-folder.repository.spec.ts`
- Modify: `server/src/schema/tables/shared-space-album.table.ts`
- Modify: `server/src/schema/index.ts` (register the table in the `DB` interface)

**Interfaces:**

- Produces: table `shared_space_album_folder` with columns `id, spaceId, parentId, name, createdById, createdAt, updatedAt, createId, updateId`; column `shared_space_album.folderId uuid NULL`.

- [ ] **Step 1: Write the failing medium test**

Create `server/test/medium/specs/repositories/shared-space-album-folder.repository.spec.ts`:

```ts
import { Kysely, sql } from 'kysely';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = () => {
  const { ctx } = newMediumService(BaseService, {
    database: defaultDatabase,
    real: [],
    mock: [LoggingRepository],
  });
  return { ctx, sut: ctx.get(SharedSpaceRepository) };
};

const seed = async (ctx: ReturnType<typeof setup>['ctx']) => {
  const { user } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: user.id });
  return { user, space };
};

/** Insert a folder with raw SQL — the repository does not exist yet in this task. */
const insertFolder = async (
  ctx: ReturnType<typeof setup>['ctx'],
  values: { spaceId: string; parentId?: string | null; name: string; createdById?: string | null },
) => {
  const row = await ctx.database
    .insertInto('shared_space_album_folder')
    .values({
      spaceId: values.spaceId,
      parentId: values.parentId ?? null,
      name: values.name,
      createdById: values.createdById ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return row;
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe('shared_space_album_folder schema', () => {
  // F-03 (index half): case-insensitive sibling uniqueness at the ROOT level.
  // PG14 has no NULLS NOT DISTINCT, so this is the partial index that had to be split out.
  it('rejects two root folders whose names differ only by case', async () => {
    const { ctx } = setup();
    const { space } = await seed(ctx);

    await insertFolder(ctx, { spaceId: space.id, name: 'Trips' });

    await expect(insertFolder(ctx, { spaceId: space.id, name: 'trips' })).rejects.toThrow(
      /shared_space_album_folder_root_name_key/,
    );
  });

  // F-03 (index half): the same rule one level down, via the other partial index.
  it('rejects two sibling folders whose names differ only by case', async () => {
    const { ctx } = setup();
    const { space } = await seed(ctx);
    const parent = await insertFolder(ctx, { spaceId: space.id, name: 'Trips' });

    await insertFolder(ctx, { spaceId: space.id, parentId: parent.id, name: '2026' });

    await expect(insertFolder(ctx, { spaceId: space.id, parentId: parent.id, name: '2026' })).rejects.toThrow(
      /shared_space_album_folder_nested_name_key/,
    );
  });

  // F-03: names are compared after trimming, so padding cannot smuggle a duplicate past the index.
  it('rejects a sibling whose name differs only by surrounding whitespace', async () => {
    const { ctx } = setup();
    const { space } = await seed(ctx);

    await insertFolder(ctx, { spaceId: space.id, name: 'Trips' });

    await expect(insertFolder(ctx, { spaceId: space.id, name: '  Trips  ' })).rejects.toThrow(
      /shared_space_album_folder_root_name_key/,
    );
  });

  // F-04: the same name under DIFFERENT parents is legal — this is what a single
  // (spaceId, parentId, lower(name)) index would have got wrong for root rows.
  it('allows the same name under different parents', async () => {
    const { ctx } = setup();
    const { space } = await seed(ctx);
    const parent = await insertFolder(ctx, { spaceId: space.id, name: 'Trips' });

    await insertFolder(ctx, { spaceId: space.id, parentId: parent.id, name: '2026' });
    const root2026 = await insertFolder(ctx, { spaceId: space.id, name: '2026' });

    expect(root2026.parentId).toBeNull();
  });

  // F-04: and the same name in a different SPACE is likewise legal.
  it('allows the same root name in a different space', async () => {
    const { ctx } = setup();
    const { user, space } = await seed(ctx);
    const { space: other } = await ctx.newSharedSpace({ createdById: user.id });

    await insertFolder(ctx, { spaceId: space.id, name: 'Trips' });
    const twin = await insertFolder(ctx, { spaceId: other.id, name: 'Trips' });

    expect(twin.spaceId).toBe(other.id);
  });

  // X-01: spaces are hard-deleted (shared_space has no deletedAt), so this exercises a real
  // cascade — including the self-FK, which must not error on a nested tree.
  it('X-01: deleting the space cascades the whole folder tree', async () => {
    const { ctx } = setup();
    const { space } = await seed(ctx);
    const a = await insertFolder(ctx, { spaceId: space.id, name: 'Trips' });
    const b = await insertFolder(ctx, { spaceId: space.id, parentId: a.id, name: '2026' });
    await insertFolder(ctx, { spaceId: space.id, parentId: b.id, name: 'Italy' });

    await ctx.database.deleteFrom('shared_space').where('id', '=', space.id).execute();

    const remaining = await ctx.database
      .selectFrom('shared_space_album_folder')
      .selectAll()
      .where('spaceId', '=', space.id)
      .execute();
    expect(remaining).toEqual([]);
  });

  // X-02: the existing album soft-delete trigger removes the link row; the folder survives.
  it('X-02: soft-deleting an album removes its link but leaves the folder', async () => {
    const { ctx } = setup();
    const { user, space } = await seed(ctx);
    const folder = await insertFolder(ctx, { spaceId: space.id, name: 'Trips' });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'Rome' });

    await ctx.database
      .insertInto('shared_space_album')
      .values({ spaceId: space.id, albumId: album.id, folderId: folder.id })
      .execute();

    await ctx.database.updateTable('album').set({ deletedAt: new Date() }).where('id', '=', album.id).execute();

    const links = await ctx.database
      .selectFrom('shared_space_album')
      .selectAll()
      .where('spaceId', '=', space.id)
      .execute();
    expect(links).toEqual([]);

    const folders = await ctx.database
      .selectFrom('shared_space_album_folder')
      .selectAll()
      .where('id', '=', folder.id)
      .execute();
    expect(folders).toHaveLength(1);
  });

  // X-03: hard-deleting the album cascades the link away; the folder remains, now empty.
  it('X-03: deleting the album cascades the link and leaves the folder empty', async () => {
    const { ctx } = setup();
    const { user, space } = await seed(ctx);
    const folder = await insertFolder(ctx, { spaceId: space.id, name: 'Trips' });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'Rome' });

    await ctx.database
      .insertInto('shared_space_album')
      .values({ spaceId: space.id, albumId: album.id, folderId: folder.id })
      .execute();

    await ctx.database.deleteFrom('album').where('id', '=', album.id).execute();

    const links = await ctx.database
      .selectFrom('shared_space_album')
      .selectAll()
      .where('folderId', '=', folder.id)
      .execute();
    expect(links).toEqual([]);

    const folders = await ctx.database
      .selectFrom('shared_space_album_folder')
      .selectAll()
      .where('id', '=', folder.id)
      .execute();
    expect(folders).toHaveLength(1);
  });

  // Guards the ON DELETE SET NULL on folderId. The service always promotes children first
  // (Task 3), so this path only fires on a direct SQL delete — but if it ever CASCADEd
  // instead, deleting a folder would silently unlink albums.
  it('nulls folderId rather than deleting the link when a folder row is deleted directly', async () => {
    const { ctx } = setup();
    const { user, space } = await seed(ctx);
    const folder = await insertFolder(ctx, { spaceId: space.id, name: 'Trips' });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'Rome' });

    await ctx.database
      .insertInto('shared_space_album')
      .values({ spaceId: space.id, albumId: album.id, folderId: folder.id })
      .execute();

    await ctx.database.deleteFrom('shared_space_album_folder').where('id', '=', folder.id).execute();

    const link = await ctx.database
      .selectFrom('shared_space_album')
      .selectAll()
      .where('spaceId', '=', space.id)
      .executeTakeFirstOrThrow();
    expect(link.folderId).toBeNull();
  });

  // The self-FK is CASCADE, so a subtree disappears with its root on a direct delete.
  it('cascades child folders when a parent folder row is deleted directly', async () => {
    const { ctx } = setup();
    const { space } = await seed(ctx);
    const parent = await insertFolder(ctx, { spaceId: space.id, name: 'Trips' });
    const child = await insertFolder(ctx, { spaceId: space.id, parentId: parent.id, name: '2026' });

    await ctx.database.deleteFrom('shared_space_album_folder').where('id', '=', parent.id).execute();

    const rows = await ctx.database
      .selectFrom('shared_space_album_folder')
      .selectAll()
      .where('id', '=', child.id)
      .execute();
    expect(rows).toEqual([]);
  });

  // createId/updateId are the mobile-parity hedge: they must default like every other
  // fork table, or a future sync entity needs a second migration.
  it('defaults createId and updateId to uuid v7 values', async () => {
    const { ctx } = setup();
    const { space } = await seed(ctx);

    const folder = await insertFolder(ctx, { spaceId: space.id, name: 'Trips' });

    expect(folder.createId).toEqual(expect.any(String));
    expect(folder.updateId).toEqual(expect.any(String));
  });

  // The updatedAt trigger must be registered, or PATCH would leave updatedAt stale.
  it('bumps updatedAt via the trigger on update', async () => {
    const { ctx } = setup();
    const { space } = await seed(ctx);
    const folder = await insertFolder(ctx, { spaceId: space.id, name: 'Trips' });

    await sql`SELECT pg_sleep(0.01)`.execute(ctx.database);
    const updated = await ctx.database
      .updateTable('shared_space_album_folder')
      .set({ name: 'Travel' })
      .where('id', '=', folder.id)
      .returningAll()
      .executeTakeFirstOrThrow();

    expect(updated.updatedAt.getTime()).toBeGreaterThan(folder.updatedAt.getTime());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd server && pnpm test:medium -- --run test/medium/specs/repositories/shared-space-album-folder.repository.spec.ts
```

Expected: every test FAILS — `relation "shared_space_album_folder" does not exist`.

> If the medium suite cannot start at all, this worktree is missing its prerequisites. Run `mise run plugins` from the repo root (medium tests need sdk + plugin-sdk + plugin-core), then retry.

- [ ] **Step 3: Create the table definition**

Create `server/src/schema/tables/shared-space-album-folder.table.ts`:

```ts
import {
  Column,
  CreateDateColumn,
  ForeignKeyColumn,
  Generated,
  Index,
  PrimaryGeneratedColumn,
  Table,
  Timestamp,
  UpdateDateColumn,
} from '@immich/sql-tools';
import { CreateIdColumn, UpdatedAtTrigger, UpdateIdColumn } from 'src/decorators';
import { SharedSpaceTable } from 'src/schema/tables/shared-space.table';
import { UserTable } from 'src/schema/tables/user.table';

@Table('shared_space_album_folder')
@UpdatedAtTrigger('shared_space_album_folder_updatedAt')
@Index({ name: 'shared_space_album_folder_spaceId_idx', columns: ['spaceId'] })
@Index({
  name: 'shared_space_album_folder_parentId_idx',
  columns: ['parentId'],
  where: '"parentId" IS NOT NULL',
})
// Sibling names are unique case-insensitively. This needs TWO partial indexes rather than one
// index over (spaceId, parentId, lower(name)): Postgres treats NULL parents as distinct, and
// NULLS NOT DISTINCT is PG15+ while Gallery targets PG14. Without the root-scoped index below,
// two root folders could both be called "Trips".
@Index({
  name: 'shared_space_album_folder_nested_name_key',
  unique: true,
  expression: `"spaceId", "parentId", LOWER(BTRIM("name"))`,
  where: '"parentId" IS NOT NULL',
})
@Index({
  name: 'shared_space_album_folder_root_name_key',
  unique: true,
  expression: `"spaceId", LOWER(BTRIM("name"))`,
  where: '"parentId" IS NULL',
})
export class SharedSpaceAlbumFolderTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @ForeignKeyColumn(() => SharedSpaceTable, { onDelete: 'CASCADE', index: false })
  spaceId!: string;

  // Self-referencing adjacency list, same shape as TagTable.parentId. CASCADE is only ever
  // exercised by a direct SQL delete or by space deletion — the service promotes children
  // one level up inside a transaction before deleting a folder (see deleteAlbumFolder).
  @ForeignKeyColumn(() => SharedSpaceAlbumFolderTable, {
    nullable: true,
    onDelete: 'CASCADE',
    index: false,
  })
  parentId!: string | null;

  @Column({ type: 'character varying' })
  name!: string;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'SET NULL', nullable: true })
  createdById!: string | null;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @UpdateDateColumn()
  updatedAt!: Generated<Timestamp>;

  // Unused by web. Deliberate hedge so the mobile-parity spec can add a sync entity
  // without a second migration.
  @CreateIdColumn({ index: true })
  createId!: Generated<string>;

  @UpdateIdColumn({ index: true })
  updateId!: Generated<string>;
}
```

- [ ] **Step 4: Add `folderId` to the album link table**

In `server/src/schema/tables/shared-space-album.table.ts`, add the import and the column. Place the column immediately after `showInTimeline` so the source order matches the migration:

```ts
import { SharedSpaceAlbumFolderTable } from 'src/schema/tables/shared-space-album-folder.table';
```

```ts
  // Visual placement inside the space. NULL = space root. Lives on the JOIN table, not on
  // `album`, so personal albums structurally cannot be nested and one album linked into two
  // spaces has an independent placement in each.
  //
  // SET NULL rather than CASCADE: deleting a folder must never unlink an album. The service
  // promotes children before deleting, so this is a backstop for direct SQL deletes.
  @ForeignKeyColumn(() => SharedSpaceAlbumFolderTable, { nullable: true, onDelete: 'SET NULL' })
  folderId!: string | null;
```

- [ ] **Step 5: Register the table in the schema index**

In `server/src/schema/index.ts`, import `SharedSpaceAlbumFolderTable` and add it to the table list exactly as `SharedSpaceAlbumTable` is registered (both the `@Database({ tables: [...] })` array and the `DB` interface entry, following whatever shape the file already uses for `shared_space_album`).

- [ ] **Step 6: Write the migration**

Create `server/src/schema/migrations-gallery/1785000000000-AddSharedSpaceAlbumFolderTable.ts`:

```ts
import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE TABLE "shared_space_album_folder" (
  "id" uuid NOT NULL DEFAULT immich_uuid_v7(),
  "spaceId" uuid NOT NULL,
  "parentId" uuid,
  "name" character varying NOT NULL,
  "createdById" uuid,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "createId" uuid NOT NULL DEFAULT immich_uuid_v7(),
  "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
  CONSTRAINT "shared_space_album_folder_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "shared_space" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "shared_space_album_folder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "shared_space_album_folder" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "shared_space_album_folder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user" ("id") ON UPDATE NO ACTION ON DELETE SET NULL,
  CONSTRAINT "shared_space_album_folder_pkey" PRIMARY KEY ("id")
);`.execute(db);

  await sql`CREATE INDEX "shared_space_album_folder_spaceId_idx" ON "shared_space_album_folder" ("spaceId");`.execute(
    db,
  );
  await sql`CREATE INDEX "shared_space_album_folder_parentId_idx" ON "shared_space_album_folder" ("parentId") WHERE "parentId" IS NOT NULL;`.execute(
    db,
  );
  await sql`CREATE INDEX "shared_space_album_folder_createdById_idx" ON "shared_space_album_folder" ("createdById");`.execute(
    db,
  );
  await sql`CREATE INDEX "shared_space_album_folder_createId_idx" ON "shared_space_album_folder" ("createId");`.execute(
    db,
  );
  await sql`CREATE INDEX "shared_space_album_folder_updateId_idx" ON "shared_space_album_folder" ("updateId");`.execute(
    db,
  );

  // Two partial unique indexes, not one: PG14 has no NULLS NOT DISTINCT, so a single index
  // over (spaceId, parentId, lower(name)) would let two ROOT folders share a name.
  await sql`CREATE UNIQUE INDEX "shared_space_album_folder_nested_name_key" ON "shared_space_album_folder" ("spaceId", "parentId", LOWER(BTRIM("name"))) WHERE "parentId" IS NOT NULL;`.execute(
    db,
  );
  await sql`CREATE UNIQUE INDEX "shared_space_album_folder_root_name_key" ON "shared_space_album_folder" ("spaceId", LOWER(BTRIM("name"))) WHERE "parentId" IS NULL;`.execute(
    db,
  );

  await sql`CREATE OR REPLACE TRIGGER "shared_space_album_folder_updatedAt"
  BEFORE UPDATE ON "shared_space_album_folder"
  FOR EACH ROW
  EXECUTE FUNCTION updated_at();`.execute(db);

  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_shared_space_album_folder_updatedAt', '{"type":"trigger","name":"shared_space_album_folder_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"shared_space_album_folder_updatedAt\\"\\n  BEFORE UPDATE ON \\"shared_space_album_folder\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(
    db,
  );

  await sql`ALTER TABLE "shared_space_album" ADD "folderId" uuid;`.execute(db);
  await sql`ALTER TABLE "shared_space_album" ADD CONSTRAINT "shared_space_album_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "shared_space_album_folder" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;`.execute(
    db,
  );
  await sql`CREATE INDEX "shared_space_album_folderId_idx" ON "shared_space_album" ("folderId") WHERE "folderId" IS NOT NULL;`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS "shared_space_album_folderId_idx";`.execute(db);
  await sql`ALTER TABLE "shared_space_album" DROP CONSTRAINT IF EXISTS "shared_space_album_folderId_fkey";`.execute(db);
  await sql`ALTER TABLE "shared_space_album" DROP COLUMN IF EXISTS "folderId";`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_shared_space_album_folder_updatedAt';`.execute(
    db,
  );
  await sql`DROP TRIGGER IF EXISTS "shared_space_album_folder_updatedAt" ON "shared_space_album_folder";`.execute(db);
  await sql`DROP TABLE "shared_space_album_folder";`.execute(db);
}
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
cd server && pnpm test:medium -- --run test/medium/specs/repositories/shared-space-album-folder.repository.spec.ts
```

Expected: PASS (12 tests).

- [ ] **Step 8: Verify the schema definition matches the migration**

```bash
cd server && pnpm check
```

Expected: clean. If `sql-tools` reports drift between the decorated table and the migration DDL, the decorators and the raw SQL disagree — fix the migration to match the decorators, not the other way round.

- [ ] **Step 9: Commit**

```bash
git add server/src/schema server/test/medium/specs/repositories/shared-space-album-folder.repository.spec.ts
git commit -m "feat(server): add shared_space_album_folder table and folderId column"
```

---

## Task 2: Repository primitives

**Implements:** P-01–P-07, plus the transactional machinery C-01 and C-03 rely on.

**Files:**

- Modify: `server/src/repositories/shared-space.repository.ts`
- Modify: `server/test/medium/specs/repositories/shared-space-album-folder.repository.spec.ts`
- Modify: `server/src/queries/shared.space.repository.sql` (regenerated, not hand-edited)

**Interfaces:**

- Consumes: the table from Task 1.
- Produces, on `SharedSpaceRepository`:

```ts
type AlbumFolderRow = {
  id: string; spaceId: string; parentId: string | null; name: string;
  createdById: string | null; createdAt: Date; updatedAt: Date;
  createId: string; updateId: string;
};

createAlbumFolder(dto: { spaceId: string; parentId: string | null; name: string; createdById: string | null }): Promise<AlbumFolderRow>
getAlbumFolderById(spaceId: string, folderId: string): Promise<AlbumFolderRow | undefined>
getAlbumFoldersBySpace(spaceId: string): Promise<AlbumFolderRow[]>
countAlbumFoldersBySpace(spaceId: string): Promise<number>
getAlbumFolderAncestors(folderId: string): Promise<{ id: string; parentId: string | null; name: string }[]>  // self first, then up to root
getAlbumFolderSubtree(folderId: string): Promise<{ id: string; depth: number }[]>                            // self is depth 0
hasSiblingAlbumFolderName(spaceId: string, parentId: string | null, name: string, excludeId: string | null): Promise<boolean>
updateAlbumFolder(spaceId: string, folderId: string, dto: { name?: string; parentId?: string | null }): Promise<boolean>
deleteAlbumFolderPromotingChildren(spaceId: string, folderId: string): Promise<boolean>
setAlbumLinkFolder(spaceId: string, albumId: string, folderId: string | null): Promise<boolean>
```

- [ ] **Step 1: Write the failing tests**

Append to `server/test/medium/specs/repositories/shared-space-album-folder.repository.spec.ts`:

```ts
describe('SharedSpaceRepository — album folder primitives', () => {
  // P-01
  it('P-01: createAlbumFolder persists the row and getAlbumFolderById round-trips it', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);

    const created = await sut.createAlbumFolder({
      spaceId: space.id,
      parentId: null,
      name: 'Trips',
      createdById: user.id,
    });

    expect(created).toMatchObject({ spaceId: space.id, parentId: null, name: 'Trips', createdById: user.id });
    await expect(sut.getAlbumFolderById(space.id, created.id)).resolves.toMatchObject({ id: created.id });
  });

  // P-01: getAlbumFolderById is space-scoped, so a folder id from another space reads as absent
  // rather than leaking. This is the read-side half of the same-space invariant.
  it('P-01: getAlbumFolderById does not return a folder from another space', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const { space: other } = await ctx.newSharedSpace({ createdById: user.id });
    const folder = await sut.createAlbumFolder({
      spaceId: other.id,
      parentId: null,
      name: 'Trips',
      createdById: user.id,
    });

    await expect(sut.getAlbumFolderById(space.id, folder.id)).resolves.toBeUndefined();
  });

  // P-02 — this is the repository half of R-08, the cross-space read-leak test.
  it('P-02: getAlbumFoldersBySpace returns every folder of the space and none from another', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const { space: other } = await ctx.newSharedSpace({ createdById: user.id });

    const a = await sut.createAlbumFolder({ spaceId: space.id, parentId: null, name: 'Trips', createdById: user.id });
    const b = await sut.createAlbumFolder({ spaceId: space.id, parentId: a.id, name: '2026', createdById: user.id });
    await sut.createAlbumFolder({ spaceId: other.id, parentId: null, name: 'Secret', createdById: user.id });

    const rows = await sut.getAlbumFoldersBySpace(space.id);

    expect(rows.map((r) => r.id).sort()).toEqual([a.id, b.id].sort());
  });

  // P-03
  it('P-03: getAlbumFolderAncestors returns the chain self-first up to the root', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const trips = await sut.createAlbumFolder({
      spaceId: space.id,
      parentId: null,
      name: 'Trips',
      createdById: user.id,
    });
    const y2026 = await sut.createAlbumFolder({
      spaceId: space.id,
      parentId: trips.id,
      name: '2026',
      createdById: user.id,
    });
    const italy = await sut.createAlbumFolder({
      spaceId: space.id,
      parentId: y2026.id,
      name: 'Italy',
      createdById: user.id,
    });

    const chain = await sut.getAlbumFolderAncestors(italy.id);

    expect(chain.map((c) => c.id)).toEqual([italy.id, y2026.id, trips.id]);
  });

  // P-03: a root folder is its own single-element chain — depth 1, per the spec's convention.
  it('P-03: getAlbumFolderAncestors returns a single element for a root folder', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const trips = await sut.createAlbumFolder({
      spaceId: space.id,
      parentId: null,
      name: 'Trips',
      createdById: user.id,
    });

    await expect(sut.getAlbumFolderAncestors(trips.id)).resolves.toHaveLength(1);
  });

  // P-04
  it('P-04: getAlbumFolderSubtree returns the folder and all descendants with relative depth', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const trips = await sut.createAlbumFolder({
      spaceId: space.id,
      parentId: null,
      name: 'Trips',
      createdById: user.id,
    });
    const y2026 = await sut.createAlbumFolder({
      spaceId: space.id,
      parentId: trips.id,
      name: '2026',
      createdById: user.id,
    });
    const italy = await sut.createAlbumFolder({
      spaceId: space.id,
      parentId: y2026.id,
      name: 'Italy',
      createdById: user.id,
    });

    const subtree = await sut.getAlbumFolderSubtree(trips.id);

    expect(subtree.sort((x, y) => x.depth - y.depth)).toEqual([
      { id: trips.id, depth: 0 },
      { id: y2026.id, depth: 1 },
      { id: italy.id, depth: 2 },
    ]);
  });

  // P-04: a leaf is depth 0 and alone — this is what makes height() zero for a leaf, which
  // the move depth formula (depth(target) + 1 + height) depends on.
  it('P-04: getAlbumFolderSubtree returns only self for a leaf', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const trips = await sut.createAlbumFolder({
      spaceId: space.id,
      parentId: null,
      name: 'Trips',
      createdById: user.id,
    });

    await expect(sut.getAlbumFolderSubtree(trips.id)).resolves.toEqual([{ id: trips.id, depth: 0 }]);
  });

  // P-05: promotion is ONE LEVEL and SHALLOW. Grandchildren keep their parents.
  it('P-05: deleteAlbumFolderPromotingChildren promotes direct children one level only', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const trips = await sut.createAlbumFolder({
      spaceId: space.id,
      parentId: null,
      name: 'Trips',
      createdById: user.id,
    });
    const y2026 = await sut.createAlbumFolder({
      spaceId: space.id,
      parentId: trips.id,
      name: '2026',
      createdById: user.id,
    });
    const italy = await sut.createAlbumFolder({
      spaceId: space.id,
      parentId: y2026.id,
      name: 'Italy',
      createdById: user.id,
    });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'Rome' });
    await ctx.database
      .insertInto('shared_space_album')
      .values({ spaceId: space.id, albumId: album.id, folderId: italy.id })
      .execute();

    const deleted = await sut.deleteAlbumFolderPromotingChildren(space.id, y2026.id);

    expect(deleted).toBe(true);
    // 2026's direct child Italy moves up to Trips…
    await expect(sut.getAlbumFolderById(space.id, italy.id)).resolves.toMatchObject({ parentId: trips.id });
    // …but the album inside Italy is untouched.
    const link = await ctx.database
      .selectFrom('shared_space_album')
      .selectAll()
      .where('albumId', '=', album.id)
      .executeTakeFirstOrThrow();
    expect(link.folderId).toBe(italy.id);
  });

  // P-05: album links directly inside the deleted folder are repointed, never unlinked.
  it('P-05: deleteAlbumFolderPromotingChildren repoints album links and never unlinks', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const archive = await sut.createAlbumFolder({
      spaceId: space.id,
      parentId: null,
      name: 'Archive',
      createdById: user.id,
    });
    const trips = await sut.createAlbumFolder({
      spaceId: space.id,
      parentId: archive.id,
      name: 'Trips',
      createdById: user.id,
    });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'Rome' });
    await ctx.database
      .insertInto('shared_space_album')
      .values({ spaceId: space.id, albumId: album.id, folderId: trips.id })
      .execute();

    await sut.deleteAlbumFolderPromotingChildren(space.id, trips.id);

    const link = await ctx.database
      .selectFrom('shared_space_album')
      .selectAll()
      .where('albumId', '=', album.id)
      .executeTakeFirstOrThrow();
    expect(link.folderId).toBe(archive.id);
  });

  it('P-05: deleteAlbumFolderPromotingChildren returns false for an unknown folder', async () => {
    const { ctx, sut } = setup();
    const { space } = await seed(ctx);

    await expect(
      sut.deleteAlbumFolderPromotingChildren(space.id, '00000000-0000-4000-8000-000000000000'),
    ).resolves.toBe(false);
  });

  // P-06
  it('P-06: countAlbumFoldersBySpace counts only this space', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const { space: other } = await ctx.newSharedSpace({ createdById: user.id });
    await sut.createAlbumFolder({ spaceId: space.id, parentId: null, name: 'A', createdById: user.id });
    await sut.createAlbumFolder({ spaceId: space.id, parentId: null, name: 'B', createdById: user.id });
    await sut.createAlbumFolder({ spaceId: other.id, parentId: null, name: 'C', createdById: user.id });

    await expect(sut.countAlbumFoldersBySpace(space.id)).resolves.toBe(2);
  });

  // P-07
  it('P-07: setAlbumLinkFolder writes folderId on the link', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const trips = await sut.createAlbumFolder({
      spaceId: space.id,
      parentId: null,
      name: 'Trips',
      createdById: user.id,
    });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'Rome' });
    await ctx.database.insertInto('shared_space_album').values({ spaceId: space.id, albumId: album.id }).execute();

    await expect(sut.setAlbumLinkFolder(space.id, album.id, trips.id)).resolves.toBe(true);

    const link = await ctx.database
      .selectFrom('shared_space_album')
      .selectAll()
      .where('albumId', '=', album.id)
      .executeTakeFirstOrThrow();
    expect(link.folderId).toBe(trips.id);
  });

  // P-07: no link row -> nothing updated. This is what turns A-06 into a 400 rather than a
  // silent success.
  it('P-07: setAlbumLinkFolder returns false when the album is not linked to the space', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const trips = await sut.createAlbumFolder({
      spaceId: space.id,
      parentId: null,
      name: 'Trips',
      createdById: user.id,
    });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'Unlinked' });

    await expect(sut.setAlbumLinkFolder(space.id, album.id, trips.id)).resolves.toBe(false);
  });

  it('P-07: setAlbumLinkFolder clears the placement when given null', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const trips = await sut.createAlbumFolder({
      spaceId: space.id,
      parentId: null,
      name: 'Trips',
      createdById: user.id,
    });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'Rome' });
    await ctx.database
      .insertInto('shared_space_album')
      .values({ spaceId: space.id, albumId: album.id, folderId: trips.id })
      .execute();

    await sut.setAlbumLinkFolder(space.id, album.id, null);

    const link = await ctx.database
      .selectFrom('shared_space_album')
      .selectAll()
      .where('albumId', '=', album.id)
      .executeTakeFirstOrThrow();
    expect(link.folderId).toBeNull();
  });

  it('hasSiblingAlbumFolderName detects a case-insensitive collision and honours excludeId', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const trips = await sut.createAlbumFolder({
      spaceId: space.id,
      parentId: null,
      name: 'Trips',
      createdById: user.id,
    });

    await expect(sut.hasSiblingAlbumFolderName(space.id, null, 'trips', null)).resolves.toBe(true);
    // Excluding the row itself is what makes rename-to-same-name (N-03) a no-op instead of a 400.
    await expect(sut.hasSiblingAlbumFolderName(space.id, null, 'trips', trips.id)).resolves.toBe(false);
    await expect(sut.hasSiblingAlbumFolderName(space.id, null, 'Family', null)).resolves.toBe(false);
  });

  it('updateAlbumFolder renames and reparents, and returns false for an unknown folder', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const archive = await sut.createAlbumFolder({
      spaceId: space.id,
      parentId: null,
      name: 'Archive',
      createdById: user.id,
    });
    const trips = await sut.createAlbumFolder({
      spaceId: space.id,
      parentId: null,
      name: 'Trips',
      createdById: user.id,
    });

    await expect(sut.updateAlbumFolder(space.id, trips.id, { name: 'Travel', parentId: archive.id })).resolves.toBe(
      true,
    );
    await expect(sut.getAlbumFolderById(space.id, trips.id)).resolves.toMatchObject({
      name: 'Travel',
      parentId: archive.id,
    });

    await expect(sut.updateAlbumFolder(space.id, '00000000-0000-4000-8000-000000000000', { name: 'X' })).resolves.toBe(
      false,
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd server && pnpm test:medium -- --run test/medium/specs/repositories/shared-space-album-folder.repository.spec.ts
```

Expected: the new tests FAIL with `sut.createAlbumFolder is not a function`. The Task 1 schema tests still PASS.

- [ ] **Step 3: Implement the repository methods**

Add to `server/src/repositories/shared-space.repository.ts`. Place them next to the existing album-link methods (`addAlbum`, `getLinkedAlbums`, `setAlbumShowInTimeline`).

```ts
  @GenerateSql({ params: [{ spaceId: DummyValue.UUID, parentId: null, name: 'Trips', createdById: DummyValue.UUID }] })
  createAlbumFolder(dto: {
    spaceId: string;
    parentId: string | null;
    name: string;
    createdById: string | null;
  }) {
    return this.db
      .insertInto('shared_space_album_folder')
      .values(dto)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  getAlbumFolderById(spaceId: string, folderId: string) {
    return this.db
      .selectFrom('shared_space_album_folder')
      .selectAll()
      .where('spaceId', '=', spaceId)
      .where('id', '=', folderId)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getAlbumFoldersBySpace(spaceId: string) {
    return this.db
      .selectFrom('shared_space_album_folder')
      .selectAll()
      .where('spaceId', '=', spaceId)
      .orderBy('name', 'asc')
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async countAlbumFoldersBySpace(spaceId: string): Promise<number> {
    const row = await this.db
      .selectFrom('shared_space_album_folder')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('spaceId', '=', spaceId)
      .executeTakeFirstOrThrow();
    return Number(row.count);
  }

  // Self first, then each parent up to the root. The service uses `.length` as the folder's
  // depth (root = 1) and reverses the array for the breadcrumb.
  @GenerateSql({ params: [DummyValue.UUID] })
  getAlbumFolderAncestors(folderId: string) {
    return this.db
      .withRecursive('ancestors', (qb) =>
        qb
          .selectFrom('shared_space_album_folder')
          .select(['id', 'parentId', 'name'])
          .where('id', '=', folderId)
          .unionAll(
            qb
              .selectFrom('shared_space_album_folder as f')
              .innerJoin('ancestors as a', 'a.parentId', 'f.id')
              .select(['f.id', 'f.parentId', 'f.name']),
          ),
      )
      .selectFrom('ancestors')
      .selectAll()
      .execute();
  }

  // Self at depth 0, descendants at increasing depth. max(depth) is the subtree's height,
  // which the move guard adds to the target's depth.
  @GenerateSql({ params: [DummyValue.UUID] })
  getAlbumFolderSubtree(folderId: string) {
    return this.db
      .withRecursive('subtree', (qb) =>
        qb
          .selectFrom('shared_space_album_folder')
          .select(['id', sql<number>`0`.as('depth')])
          .where('id', '=', folderId)
          .unionAll(
            qb
              .selectFrom('shared_space_album_folder as f')
              .innerJoin('subtree as s', 's.id', 'f.parentId')
              .select(['f.id', sql<number>`s.depth + 1`.as('depth')]),
          ),
      )
      .selectFrom('subtree')
      .selectAll()
      .execute();
  }

  // excludeId keeps a rename-to-itself (N-03) and a move-to-current-parent (M-09) from
  // colliding with the row being modified.
  @GenerateSql({ params: [DummyValue.UUID, null, 'Trips', null] })
  async hasSiblingAlbumFolderName(
    spaceId: string,
    parentId: string | null,
    name: string,
    excludeId: string | null,
  ): Promise<boolean> {
    let query = this.db
      .selectFrom('shared_space_album_folder')
      .select('id')
      .where('spaceId', '=', spaceId)
      .where(sql<boolean>`LOWER(BTRIM("name")) = LOWER(BTRIM(${name}))`);

    query = parentId === null ? query.where('parentId', 'is', null) : query.where('parentId', '=', parentId);

    if (excludeId) {
      query = query.where('id', '!=', excludeId);
    }

    const row = await query.executeTakeFirst();
    return !!row;
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID, { name: 'Travel' }] })
  async updateAlbumFolder(
    spaceId: string,
    folderId: string,
    dto: { name?: string; parentId?: string | null },
  ): Promise<boolean> {
    const result = await this.db
      .updateTable('shared_space_album_folder')
      .set(dto)
      .where('spaceId', '=', spaceId)
      .where('id', '=', folderId)
      .executeTakeFirst();
    return Number(result.numUpdatedRows) > 0;
  }

  // Promote-then-delete, in ONE transaction. Direct child folders and direct album links move
  // to the deleted folder's parent; grandchildren keep their parents. Because children are
  // cleared first, the CASCADE self-FK never fires here — it only ever runs on space deletion.
  //
  // Everything inside the callback uses `trx`. Running a `this.db` query inside a Kysely
  // transaction callback deadlocks (issue #595).
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  deleteAlbumFolderPromotingChildren(spaceId: string, folderId: string): Promise<boolean> {
    return this.db.transaction().execute(async (trx) => {
      const folder = await trx
        .selectFrom('shared_space_album_folder')
        .select(['id', 'parentId'])
        .where('spaceId', '=', spaceId)
        .where('id', '=', folderId)
        .forUpdate()
        .executeTakeFirst();

      if (!folder) {
        return false;
      }

      await trx
        .updateTable('shared_space_album_folder')
        .set({ parentId: folder.parentId })
        .where('parentId', '=', folderId)
        .execute();

      await trx
        .updateTable('shared_space_album')
        .set({ folderId: folder.parentId })
        .where('folderId', '=', folderId)
        .execute();

      await trx.deleteFrom('shared_space_album_folder').where('id', '=', folderId).execute();

      return true;
    });
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID, DummyValue.UUID] })
  async setAlbumLinkFolder(spaceId: string, albumId: string, folderId: string | null): Promise<boolean> {
    const result = await this.db
      .updateTable('shared_space_album')
      .set({ folderId })
      .where('spaceId', '=', spaceId)
      .where('albumId', '=', albumId)
      .executeTakeFirst();
    return Number(result.numUpdatedRows) > 0;
  }
```

Add `sql` to the `kysely` import at the top of the file if it is not already imported.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd server && pnpm test:medium -- --run test/medium/specs/repositories/shared-space-album-folder.repository.spec.ts
```

Expected: PASS (28 tests).

- [ ] **Step 5: Regenerate the SQL documentation**

The dev database must be running first — `make sql` **deletes every query file** when it cannot connect.

```bash
make dev          # in another terminal, if not already up
make sql
git diff --stat server/src/queries/shared.space.repository.sql
```

Expected: the file gains the new `SharedSpaceRepository.<method>` blocks and loses nothing.

- [ ] **Step 6: Commit**

```bash
git add server/src/repositories/shared-space.repository.ts server/src/queries/shared.space.repository.sql server/test/medium/specs/repositories/shared-space-album-folder.repository.spec.ts
git commit -m "feat(server): add album folder repository primitives"
```

---

## Task 3: Service — list, create, rename, delete-with-promotion

**Implements:** F-01–F-12, N-01–N-04, D-01–D-06.

Move (`parentId` on update) is deliberately **not** in this task — it arrives in Task 4 with its own guards. This task's update DTO carries `name` only.

**Files:**

- Modify: `server/src/services/shared-space.service.ts`
- Modify: `server/src/dtos/shared-space.dto.ts`
- Modify: `server/src/services/shared-space.service.spec.ts`

**Interfaces:**

- Consumes: every repository method from Task 2.
- Produces:

```ts
// exported from src/services/shared-space.service.ts
export const SHARED_SPACE_ALBUM_FOLDER_MAX_DEPTH = 10;
export const SHARED_SPACE_ALBUM_FOLDER_MAX_PER_SPACE = 500;

// on SharedSpaceService
getAlbumFolders(auth: AuthDto, spaceId: string): Promise<SharedSpaceAlbumFolderDto[]>
createAlbumFolder(auth: AuthDto, spaceId: string, dto: SharedSpaceAlbumFolderCreateDto): Promise<SharedSpaceAlbumFolderDto>
updateAlbumFolder(auth: AuthDto, spaceId: string, folderId: string, dto: SharedSpaceAlbumFolderUpdateDto): Promise<void>
deleteAlbumFolder(auth: AuthDto, spaceId: string, folderId: string): Promise<void>

// exported from src/dtos/shared-space.dto.ts
class SharedSpaceAlbumFolderDto        // id, spaceId, parentId, name, createdById, createdAt, updatedAt
class SharedSpaceAlbumFolderCreateDto  // { name: string; parentId?: string | null }
class SharedSpaceAlbumFolderUpdateDto  // { name?: string }  — Task 4 adds parentId
```

- [ ] **Step 1: Add the DTOs**

In `server/src/dtos/shared-space.dto.ts`, beside the existing `SharedSpaceAlbumLinkUpdateSchema`:

```ts
export const SHARED_SPACE_ALBUM_FOLDER_NAME_MAX = 128;

const SharedSpaceAlbumFolderSchema = z
  .object({
    id: z.string().describe('Folder ID'),
    spaceId: z.string().describe('Shared space ID'),
    parentId: z.string().nullable().describe('Parent folder ID, or null when at the space root'),
    name: z.string().describe('Folder name'),
    createdById: z.string().nullable().describe('User who created the folder'),
    createdAt: z.string().meta({ format: 'date-time' }),
    updatedAt: z.string().meta({ format: 'date-time' }),
  })
  .meta({ id: 'SharedSpaceAlbumFolderDto' });

// .trim() documents the constraint in the OpenAPI schema; the service re-validates so that
// the rules are testable at the service layer and enforced for any non-HTTP caller.
const SharedSpaceAlbumFolderCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(SHARED_SPACE_ALBUM_FOLDER_NAME_MAX).describe('Folder name'),
    parentId: z.uuidv4().nullable().optional().describe('Parent folder ID; omit or null for the space root'),
  })
  .meta({ id: 'SharedSpaceAlbumFolderCreateDto' });

const SharedSpaceAlbumFolderUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(SHARED_SPACE_ALBUM_FOLDER_NAME_MAX).optional().describe('New folder name'),
  })
  .meta({ id: 'SharedSpaceAlbumFolderUpdateDto' });

export class SharedSpaceAlbumFolderDto extends createZodDto(SharedSpaceAlbumFolderSchema) {}
export class SharedSpaceAlbumFolderCreateDto extends createZodDto(SharedSpaceAlbumFolderCreateSchema) {}
export class SharedSpaceAlbumFolderUpdateDto extends createZodDto(SharedSpaceAlbumFolderUpdateSchema) {}
```

- [ ] **Step 2: Write the failing tests**

Append to `server/src/services/shared-space.service.spec.ts`. `makeMemberResult` and `factory` already exist in this file.

```ts
describe('album folders', () => {
  const setupEditor = (role: SharedSpaceRole = SharedSpaceRole.Editor) => {
    const auth = factory.auth({ user: { isAdmin: false } });
    const space = factory.sharedSpace({ faceRecognitionEnabled: false });
    mocks.sharedSpace.getMember.mockResolvedValue(makeMemberResult({ spaceId: space.id, userId: auth.user.id, role }));
    return { auth, space };
  };

  const folderRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: newUuid(),
    spaceId: newUuid(),
    parentId: null,
    name: 'Trips',
    createdById: newUuid(),
    createdAt: newDate(),
    updatedAt: newDate(),
    createId: newUuid(),
    updateId: newUuid(),
    ...overrides,
  });

  beforeEach(() => {
    mocks.sharedSpace.countAlbumFoldersBySpace.mockResolvedValue(0);
    mocks.sharedSpace.hasSiblingAlbumFolderName.mockResolvedValue(false);
    mocks.sharedSpace.getAlbumFolderAncestors.mockResolvedValue([]);
  });

  describe('getAlbumFolders', () => {
    it('returns the space folders for a member', async () => {
      const { auth, space } = setupEditor(SharedSpaceRole.Viewer);
      const row = folderRow({ spaceId: space.id });
      mocks.sharedSpace.getAlbumFoldersBySpace.mockResolvedValue([row]);

      const result = await sut.getAlbumFolders(auth, space.id);

      expect(result).toEqual([
        expect.objectContaining({ id: row.id, spaceId: space.id, parentId: null, name: 'Trips' }),
      ]);
    });

    // R-06: a folder name is itself information ("Divorce", "Medical"), so a non-member must be
    // refused outright rather than handed an empty list that confirms the space exists.
    it('R-06: throws for a non-member instead of returning an empty list', async () => {
      const auth = factory.auth({ user: { isAdmin: false } });
      const space = factory.sharedSpace({ faceRecognitionEnabled: false });
      mocks.sharedSpace.getMember.mockResolvedValue(void 0 as any);

      await expect(sut.getAlbumFolders(auth, space.id)).rejects.toBeInstanceOf(ForbiddenException);
      expect(mocks.sharedSpace.getAlbumFoldersBySpace).not.toHaveBeenCalled();
    });
  });

  describe('createAlbumFolder', () => {
    // F-01
    it('F-01: creates a root folder', async () => {
      const { auth, space } = setupEditor();
      const created = folderRow({ spaceId: space.id });
      mocks.sharedSpace.createAlbumFolder.mockResolvedValue(created);

      const result = await sut.createAlbumFolder(auth, space.id, { name: 'Trips' } as any);

      expect(mocks.sharedSpace.createAlbumFolder).toHaveBeenCalledWith({
        spaceId: space.id,
        parentId: null,
        name: 'Trips',
        createdById: auth.user.id,
      });
      expect(result).toEqual(expect.objectContaining({ id: created.id, parentId: null }));
    });

    // F-02
    it('F-02: creates a nested folder under an existing parent', async () => {
      const { auth, space } = setupEditor();
      const parent = folderRow({ spaceId: space.id });
      mocks.sharedSpace.getAlbumFolderById.mockResolvedValue(parent);
      mocks.sharedSpace.getAlbumFolderAncestors.mockResolvedValue([{ id: parent.id, parentId: null, name: 'Trips' }]);
      mocks.sharedSpace.createAlbumFolder.mockResolvedValue(
        folderRow({ spaceId: space.id, parentId: parent.id, name: '2026' }),
      );

      await sut.createAlbumFolder(auth, space.id, { name: '2026', parentId: parent.id } as any);

      expect(mocks.sharedSpace.createAlbumFolder).toHaveBeenCalledWith(
        expect.objectContaining({ parentId: parent.id, name: '2026' }),
      );
    });

    // F-03 — 400, not 409. shared-space.service.ts never throws ConflictException; that is
    // reserved codebase-wide for merge-policy's structured cross-owner conflict.
    it('F-03: rejects a case-insensitive sibling collision', async () => {
      const { auth, space } = setupEditor();
      mocks.sharedSpace.hasSiblingAlbumFolderName.mockResolvedValue(true);

      await expect(sut.createAlbumFolder(auth, space.id, { name: 'trips' } as any)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mocks.sharedSpace.createAlbumFolder).not.toHaveBeenCalled();
    });

    // F-04: the collision check is scoped to the destination parent, so the same name may
    // legitimately exist elsewhere in the tree.
    it('F-04: scopes the collision check to the target parent', async () => {
      const { auth, space } = setupEditor();
      mocks.sharedSpace.createAlbumFolder.mockResolvedValue(folderRow({ spaceId: space.id, name: '2026' }));

      await sut.createAlbumFolder(auth, space.id, { name: '2026' } as any);

      expect(mocks.sharedSpace.hasSiblingAlbumFolderName).toHaveBeenCalledWith(space.id, null, '2026', null);
    });

    // F-05
    it('F-05: trims the stored name', async () => {
      const { auth, space } = setupEditor();
      mocks.sharedSpace.createAlbumFolder.mockResolvedValue(folderRow({ spaceId: space.id }));

      await sut.createAlbumFolder(auth, space.id, { name: '  Trips  ' } as any);

      expect(mocks.sharedSpace.createAlbumFolder).toHaveBeenCalledWith(expect.objectContaining({ name: 'Trips' }));
    });

    // F-06 / F-07 — the service re-validates rather than trusting zod, so these hold for any
    // caller and are provable at this layer.
    it.each([
      ['F-06', '   '],
      ['F-06', ''],
      ['F-07', 'x'.repeat(129)],
    ])('%s: rejects an invalid name', async (_id, name) => {
      const { auth, space } = setupEditor();

      await expect(sut.createAlbumFolder(auth, space.id, { name } as any)).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.sharedSpace.createAlbumFolder).not.toHaveBeenCalled();
    });

    it('F-07: accepts a name of exactly the maximum length', async () => {
      const { auth, space } = setupEditor();
      mocks.sharedSpace.createAlbumFolder.mockResolvedValue(folderRow({ spaceId: space.id }));

      await sut.createAlbumFolder(auth, space.id, { name: 'x'.repeat(128) } as any);

      expect(mocks.sharedSpace.createAlbumFolder).toHaveBeenCalled();
    });

    // F-08 / F-10 — getAlbumFolderById is space-scoped, so a parent from another space and a
    // parent that does not exist are indistinguishable, and both are a 400.
    it.each([
      ['F-08', 'a parent belonging to another space'],
      ['F-10', 'a parent that does not exist'],
    ])('%s: rejects %s', async () => {
      const { auth, space } = setupEditor();
      mocks.sharedSpace.getAlbumFolderById.mockResolvedValue(void 0 as any);

      await expect(
        sut.createAlbumFolder(auth, space.id, { name: '2026', parentId: newUuid() } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.sharedSpace.createAlbumFolder).not.toHaveBeenCalled();
    });

    // F-09: root is depth 1, so a parent with a 10-element ancestor chain is at depth 10 and
    // cannot take a child.
    it('F-09: rejects a create that would exceed the depth cap', async () => {
      const { auth, space } = setupEditor();
      const parent = folderRow({ spaceId: space.id });
      mocks.sharedSpace.getAlbumFolderById.mockResolvedValue(parent);
      mocks.sharedSpace.getAlbumFolderAncestors.mockResolvedValue(
        Array.from({ length: 10 }, () => ({ id: newUuid(), parentId: null, name: 'x' })),
      );

      await expect(
        sut.createAlbumFolder(auth, space.id, { name: 'too deep', parentId: parent.id } as any),
      ).rejects.toThrow(/11/);
      expect(mocks.sharedSpace.createAlbumFolder).not.toHaveBeenCalled();
    });

    // F-11: the cap is inclusive — depth 10 itself is allowed.
    it('F-11: allows a create that lands exactly at the depth cap', async () => {
      const { auth, space } = setupEditor();
      const parent = folderRow({ spaceId: space.id });
      mocks.sharedSpace.getAlbumFolderById.mockResolvedValue(parent);
      mocks.sharedSpace.getAlbumFolderAncestors.mockResolvedValue(
        Array.from({ length: 9 }, () => ({ id: newUuid(), parentId: null, name: 'x' })),
      );
      mocks.sharedSpace.createAlbumFolder.mockResolvedValue(folderRow({ spaceId: space.id, parentId: parent.id }));

      await sut.createAlbumFolder(auth, space.id, { name: 'depth ten', parentId: parent.id } as any);

      expect(mocks.sharedSpace.createAlbumFolder).toHaveBeenCalled();
    });

    // F-12: the cap is what makes the web client's whole-space folder fetch safe.
    it('F-12: rejects a create beyond the per-space folder cap', async () => {
      const { auth, space } = setupEditor();
      mocks.sharedSpace.countAlbumFoldersBySpace.mockResolvedValue(500);

      await expect(sut.createAlbumFolder(auth, space.id, { name: 'one too many' } as any)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mocks.sharedSpace.createAlbumFolder).not.toHaveBeenCalled();
    });

    it('F-12: allows a create at one below the cap', async () => {
      const { auth, space } = setupEditor();
      mocks.sharedSpace.countAlbumFoldersBySpace.mockResolvedValue(499);
      mocks.sharedSpace.createAlbumFolder.mockResolvedValue(folderRow({ spaceId: space.id }));

      await sut.createAlbumFolder(auth, space.id, { name: 'last one' } as any);

      expect(mocks.sharedSpace.createAlbumFolder).toHaveBeenCalled();
    });

    // R-03 / R-09: the role gate runs FIRST, so an unauthorised actor learns nothing about
    // whether their payload was otherwise valid.
    it('R-09: refuses a viewer before validating the payload', async () => {
      const { auth, space } = setupEditor(SharedSpaceRole.Viewer);

      await expect(
        sut.createAlbumFolder(auth, space.id, { name: '', parentId: newUuid() } as any),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(mocks.sharedSpace.getAlbumFolderById).not.toHaveBeenCalled();
      expect(mocks.sharedSpace.countAlbumFoldersBySpace).not.toHaveBeenCalled();
    });
  });

  describe('updateAlbumFolder (rename)', () => {
    // N-01
    it('N-01: renames a folder', async () => {
      const { auth, space } = setupEditor();
      const folder = folderRow({ spaceId: space.id });
      mocks.sharedSpace.getAlbumFolderById.mockResolvedValue(folder);
      mocks.sharedSpace.updateAlbumFolder.mockResolvedValue(true);

      await sut.updateAlbumFolder(auth, space.id, folder.id, { name: 'Travel' } as any);

      expect(mocks.sharedSpace.updateAlbumFolder).toHaveBeenCalledWith(space.id, folder.id, { name: 'Travel' });
    });

    // N-02
    it('N-02: rejects renaming onto a sibling name', async () => {
      const { auth, space } = setupEditor();
      const folder = folderRow({ spaceId: space.id, name: 'Family' });
      mocks.sharedSpace.getAlbumFolderById.mockResolvedValue(folder);
      mocks.sharedSpace.hasSiblingAlbumFolderName.mockResolvedValue(true);

      await expect(sut.updateAlbumFolder(auth, space.id, folder.id, { name: 'trips' } as any)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mocks.sharedSpace.updateAlbumFolder).not.toHaveBeenCalled();
    });

    // N-03: the collision pre-check must exclude the row being renamed, or renaming a folder
    // to its own name would find itself and 400.
    it('N-03: renaming to the same name is a no-op, not a collision', async () => {
      const { auth, space } = setupEditor();
      const folder = folderRow({ spaceId: space.id, name: 'Trips' });
      mocks.sharedSpace.getAlbumFolderById.mockResolvedValue(folder);
      mocks.sharedSpace.updateAlbumFolder.mockResolvedValue(true);

      await sut.updateAlbumFolder(auth, space.id, folder.id, { name: 'Trips' } as any);

      expect(mocks.sharedSpace.hasSiblingAlbumFolderName).toHaveBeenCalledWith(
        space.id,
        folder.parentId,
        'Trips',
        folder.id,
      );
      expect(mocks.sharedSpace.updateAlbumFolder).toHaveBeenCalled();
    });

    // N-04
    it('N-04: trims the new name', async () => {
      const { auth, space } = setupEditor();
      const folder = folderRow({ spaceId: space.id });
      mocks.sharedSpace.getAlbumFolderById.mockResolvedValue(folder);
      mocks.sharedSpace.updateAlbumFolder.mockResolvedValue(true);

      await sut.updateAlbumFolder(auth, space.id, folder.id, { name: '  Travel  ' } as any);

      expect(mocks.sharedSpace.updateAlbumFolder).toHaveBeenCalledWith(space.id, folder.id, { name: 'Travel' });
    });

    it('rejects renaming a folder that does not exist in this space', async () => {
      const { auth, space } = setupEditor();
      mocks.sharedSpace.getAlbumFolderById.mockResolvedValue(void 0 as any);

      await expect(sut.updateAlbumFolder(auth, space.id, newUuid(), { name: 'Travel' } as any)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects an empty update payload', async () => {
      const { auth, space } = setupEditor();
      const folder = folderRow({ spaceId: space.id });
      mocks.sharedSpace.getAlbumFolderById.mockResolvedValue(folder);

      await expect(sut.updateAlbumFolder(auth, space.id, folder.id, {} as any)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('deleteAlbumFolder', () => {
    // D-01 through D-05 all funnel into the same transactional repository call; the promotion
    // semantics themselves are proven against a real database in P-05.
    it.each([
      ['D-01', 'a root folder holding albums'],
      ['D-02', 'a nested folder holding an album'],
      ['D-03', 'a middle folder with a grandchild'],
      ['D-04', 'a folder holding both folders and albums'],
      ['D-05', 'an empty folder'],
    ])('%s: deletes %s by promoting its children', async () => {
      const { auth, space } = setupEditor();
      const folder = folderRow({ spaceId: space.id });
      mocks.sharedSpace.deleteAlbumFolderPromotingChildren.mockResolvedValue(true);

      await sut.deleteAlbumFolder(auth, space.id, folder.id);

      expect(mocks.sharedSpace.deleteAlbumFolderPromotingChildren).toHaveBeenCalledWith(space.id, folder.id);
    });

    // D-06
    it('D-06: rejects deleting a folder that is already gone', async () => {
      const { auth, space } = setupEditor();
      mocks.sharedSpace.deleteAlbumFolderPromotingChildren.mockResolvedValue(false);

      await expect(sut.deleteAlbumFolder(auth, space.id, newUuid())).rejects.toBeInstanceOf(BadRequestException);
    });

    it('R-03: refuses a viewer', async () => {
      const { auth, space } = setupEditor(SharedSpaceRole.Viewer);

      await expect(sut.deleteAlbumFolder(auth, space.id, newUuid())).rejects.toBeInstanceOf(ForbiddenException);
      expect(mocks.sharedSpace.deleteAlbumFolderPromotingChildren).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd server && pnpm vitest --run src/services/shared-space.service.spec.ts -t "album folders"
```

Expected: FAIL — `sut.getAlbumFolders is not a function`.

> Note: `pnpm test -- --run <path>` silently drops the path filter in this repo. Invoke `pnpm vitest --run <path>` directly, as above.

- [ ] **Step 4: Implement the service methods**

Add to `server/src/services/shared-space.service.ts`, near the existing album-link methods. Export the constants at module scope beside `SHARED_SPACE_DEDUP_MAX_PASSES`:

```ts
export const SHARED_SPACE_ALBUM_FOLDER_MAX_DEPTH = 10;
export const SHARED_SPACE_ALBUM_FOLDER_MAX_PER_SPACE = 500;
```

```ts
  async getAlbumFolders(auth: AuthDto, spaceId: string): Promise<SharedSpaceAlbumFolderDto[]> {
    // Membership first: a folder name is itself information, so a non-member gets 403 rather
    // than an empty list that would confirm the space exists.
    await this.requireMembership(auth, spaceId);
    const rows = await this.sharedSpaceRepository.getAlbumFoldersBySpace(spaceId);
    return rows.map((row) => this.mapAlbumFolder(row));
  }

  async createAlbumFolder(
    auth: AuthDto,
    spaceId: string,
    dto: SharedSpaceAlbumFolderCreateDto,
  ): Promise<SharedSpaceAlbumFolderDto> {
    await this.requireRole(auth, spaceId, SharedSpaceRole.Editor);

    const name = this.normalizeAlbumFolderName(dto.name);
    const parentId = dto.parentId ?? null;

    if (parentId) {
      // getAlbumFolderById is space-scoped, so a cross-space parent and a missing parent are
      // the same 400 — deliberately, so neither confirms the other space's contents.
      const parent = await this.sharedSpaceRepository.getAlbumFolderById(spaceId, parentId);
      if (!parent) {
        throw new BadRequestException('Parent folder not found');
      }
      const ancestors = await this.sharedSpaceRepository.getAlbumFolderAncestors(parentId);
      const depth = ancestors.length + 1;
      if (depth > SHARED_SPACE_ALBUM_FOLDER_MAX_DEPTH) {
        throw new BadRequestException(
          `Folder nesting is limited to ${SHARED_SPACE_ALBUM_FOLDER_MAX_DEPTH} levels (this would be ${depth})`,
        );
      }
    }

    const count = await this.sharedSpaceRepository.countAlbumFoldersBySpace(spaceId);
    if (count >= SHARED_SPACE_ALBUM_FOLDER_MAX_PER_SPACE) {
      throw new BadRequestException(
        `A space is limited to ${SHARED_SPACE_ALBUM_FOLDER_MAX_PER_SPACE} folders`,
      );
    }

    await this.assertNoAlbumFolderNameConflict(spaceId, parentId, name, null);

    const created = await this.sharedSpaceRepository.createAlbumFolder({
      spaceId,
      parentId,
      name,
      createdById: auth.user.id,
    });
    return this.mapAlbumFolder(created);
  }

  async updateAlbumFolder(
    auth: AuthDto,
    spaceId: string,
    folderId: string,
    dto: SharedSpaceAlbumFolderUpdateDto,
  ): Promise<void> {
    await this.requireRole(auth, spaceId, SharedSpaceRole.Editor);

    const folder = await this.sharedSpaceRepository.getAlbumFolderById(spaceId, folderId);
    if (!folder) {
      throw new BadRequestException('Folder not found');
    }

    if (dto.name === undefined) {
      throw new BadRequestException('Nothing to update');
    }

    const name = this.normalizeAlbumFolderName(dto.name);
    // excludeId = folderId, so renaming a folder to the name it already has is a no-op
    // rather than a collision with itself.
    await this.assertNoAlbumFolderNameConflict(spaceId, folder.parentId, name, folderId);

    await this.sharedSpaceRepository.updateAlbumFolder(spaceId, folderId, { name });
  }

  async deleteAlbumFolder(auth: AuthDto, spaceId: string, folderId: string): Promise<void> {
    await this.requireRole(auth, spaceId, SharedSpaceRole.Editor);

    // Promotion happens inside the repository transaction: direct children move up one level,
    // then the row is deleted. Grandchildren keep their parents, and no album is ever unlinked.
    const deleted = await this.sharedSpaceRepository.deleteAlbumFolderPromotingChildren(spaceId, folderId);
    if (!deleted) {
      throw new BadRequestException('Folder not found');
    }
  }

  private normalizeAlbumFolderName(rawName: string): string {
    const name = (rawName ?? '').trim();
    if (!name) {
      throw new BadRequestException('Folder name cannot be empty');
    }
    if (name.length > SHARED_SPACE_ALBUM_FOLDER_NAME_MAX) {
      throw new BadRequestException(
        `Folder name cannot exceed ${SHARED_SPACE_ALBUM_FOLDER_NAME_MAX} characters`,
      );
    }
    return name;
  }

  private async assertNoAlbumFolderNameConflict(
    spaceId: string,
    parentId: string | null,
    name: string,
    excludeId: string | null,
  ): Promise<void> {
    const conflict = await this.sharedSpaceRepository.hasSiblingAlbumFolderName(
      spaceId,
      parentId,
      name,
      excludeId,
    );
    if (conflict) {
      throw new BadRequestException('A folder with that name already exists here');
    }
  }

  private mapAlbumFolder(row: {
    id: string;
    spaceId: string;
    parentId: string | null;
    name: string;
    createdById: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): SharedSpaceAlbumFolderDto {
    return {
      id: row.id,
      spaceId: row.spaceId,
      parentId: row.parentId,
      name: row.name,
      createdById: row.createdById,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
```

Import `SHARED_SPACE_ALBUM_FOLDER_NAME_MAX`, `SharedSpaceAlbumFolderCreateDto`, `SharedSpaceAlbumFolderDto` and `SharedSpaceAlbumFolderUpdateDto` from `src/dtos/shared-space.dto`.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd server && pnpm vitest --run src/services/shared-space.service.spec.ts -t "album folders"
```

Expected: PASS (26 tests).

- [ ] **Step 6: Commit**

```bash
git add server/src/services/shared-space.service.ts server/src/dtos/shared-space.dto.ts server/src/services/shared-space.service.spec.ts
git commit -m "feat(server): add space album folder create, rename, and delete"
```

---

## Task 4: Service — move a folder, with cycle and depth guards

**Implements:** M-01–M-09, C-01.

> **Spec correction, applied here.** Spec §5.7 proposes `FOR UPDATE` on _the moved folder's ancestor chain_ as the C-01 mitigation. That is insufficient: in the mutual race X→Y / Y→X, X's chain is `[X]` and Y's chain is `[Y]`, so the two transactions lock disjoint rows and neither blocks. This task uses a **per-space transaction-scoped advisory lock** instead, which serialises all folder moves within a space. Moves are rare, so the contention cost is nil. Update spec §5.7 to match after this task lands.

**Files:**

- Modify: `server/src/repositories/shared-space.repository.ts`
- Modify: `server/src/services/shared-space.service.ts`
- Modify: `server/src/dtos/shared-space.dto.ts`
- Modify: `server/src/services/shared-space.service.spec.ts`
- Modify: `server/test/medium/specs/repositories/shared-space-album-folder.repository.spec.ts`

**Interfaces:**

- Produces:

```ts
// repository
moveAlbumFolderChecked(spaceId: string, folderId: string, newParentId: string | null): Promise<'ok' | 'cycle' | 'notfound'>

// dto — SharedSpaceAlbumFolderUpdateSchema gains:
parentId?: string | null
```

- [ ] **Step 1: Extend the update DTO**

In `server/src/dtos/shared-space.dto.ts`, replace `SharedSpaceAlbumFolderUpdateSchema`:

```ts
const SharedSpaceAlbumFolderUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(SHARED_SPACE_ALBUM_FOLDER_NAME_MAX).optional().describe('New folder name'),
    parentId: z
      .uuidv4()
      .nullable()
      .optional()
      .describe('New parent folder ID; null moves the folder to the space root'),
  })
  .refine((dto) => dto.name !== undefined || dto.parentId !== undefined, {
    message: 'Provide at least one of name or parentId',
  })
  .meta({ id: 'SharedSpaceAlbumFolderUpdateDto' });
```

- [ ] **Step 2: Write the failing service tests**

Append inside the existing `describe('album folders')` block in `server/src/services/shared-space.service.spec.ts`:

```ts
describe('updateAlbumFolder (move)', () => {
  const setupMove = (folderOverrides = {}, targetOverrides = {}) => {
    const { auth, space } = setupEditor();
    const folder = folderRow({ spaceId: space.id, name: 'Trips', ...folderOverrides });
    const target = folderRow({ spaceId: space.id, name: 'Archive', ...targetOverrides });
    mocks.sharedSpace.getAlbumFolderById.mockImplementation(async (_s: string, id: string) =>
      id === folder.id ? folder : id === target.id ? target : undefined,
    );
    mocks.sharedSpace.getAlbumFolderAncestors.mockResolvedValue([{ id: target.id, parentId: null, name: 'Archive' }]);
    mocks.sharedSpace.getAlbumFolderSubtree.mockResolvedValue([{ id: folder.id, depth: 0 }]);
    mocks.sharedSpace.moveAlbumFolderChecked.mockResolvedValue('ok');
    return { auth, space, folder, target };
  };

  // M-01
  it('M-01: moves a folder under another folder', async () => {
    const { auth, space, folder, target } = setupMove();

    await sut.updateAlbumFolder(auth, space.id, folder.id, { parentId: target.id } as any);

    expect(mocks.sharedSpace.moveAlbumFolderChecked).toHaveBeenCalledWith(space.id, folder.id, target.id);
  });

  // M-02
  it('M-02: moves a folder back to the space root', async () => {
    const { auth, space, folder } = setupMove({ parentId: newUuid() });

    await sut.updateAlbumFolder(auth, space.id, folder.id, { parentId: null } as any);

    expect(mocks.sharedSpace.moveAlbumFolderChecked).toHaveBeenCalledWith(space.id, folder.id, null);
  });

  // M-03: caught before any query — a folder is trivially its own descendant.
  it('M-03: rejects moving a folder into itself', async () => {
    const { auth, space, folder } = setupMove();

    await expect(
      sut.updateAlbumFolder(auth, space.id, folder.id, { parentId: folder.id } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mocks.sharedSpace.moveAlbumFolderChecked).not.toHaveBeenCalled();
  });

  // M-04 / M-05: the target's ancestor chain contains the moved folder, at any depth.
  it.each([
    ['M-04', 'a direct child'],
    ['M-05', 'a deep descendant'],
  ])('%s: rejects moving a folder into %s', async () => {
    const { auth, space, folder, target } = setupMove();
    mocks.sharedSpace.getAlbumFolderAncestors.mockResolvedValue([
      { id: target.id, parentId: folder.id, name: 'Archive' },
      { id: folder.id, parentId: null, name: 'Trips' },
    ]);

    await expect(
      sut.updateAlbumFolder(auth, space.id, folder.id, { parentId: target.id } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mocks.sharedSpace.moveAlbumFolderChecked).not.toHaveBeenCalled();
  });

  // M-06: depth(target) + 1 + height(subtree) = 7 + 1 + 4 = 12 > 10.
  it('M-06: rejects a move whose combined depth exceeds the cap', async () => {
    const { auth, space, folder, target } = setupMove();
    mocks.sharedSpace.getAlbumFolderAncestors.mockResolvedValue(
      Array.from({ length: 7 }, () => ({ id: newUuid(), parentId: null, name: 'x' })),
    );
    mocks.sharedSpace.getAlbumFolderSubtree.mockResolvedValue([
      { id: folder.id, depth: 0 },
      { id: newUuid(), depth: 1 },
      { id: newUuid(), depth: 2 },
      { id: newUuid(), depth: 3 },
      { id: newUuid(), depth: 4 },
    ]);

    await expect(sut.updateAlbumFolder(auth, space.id, folder.id, { parentId: target.id } as any)).rejects.toThrow(
      /12/,
    );
    expect(mocks.sharedSpace.moveAlbumFolderChecked).not.toHaveBeenCalled();
  });

  it('M-06: allows a move that lands exactly at the depth cap', async () => {
    const { auth, space, folder, target } = setupMove();
    mocks.sharedSpace.getAlbumFolderAncestors.mockResolvedValue(
      Array.from({ length: 7 }, () => ({ id: newUuid(), parentId: null, name: 'x' })),
    );
    mocks.sharedSpace.getAlbumFolderSubtree.mockResolvedValue([
      { id: folder.id, depth: 0 },
      { id: newUuid(), depth: 1 },
      { id: newUuid(), depth: 2 },
    ]);

    await sut.updateAlbumFolder(auth, space.id, folder.id, { parentId: target.id } as any);

    expect(mocks.sharedSpace.moveAlbumFolderChecked).toHaveBeenCalled();
  });

  // M-07: the collision check runs against the DESTINATION parent, not the current one.
  it('M-07: rejects a move that collides with a name at the destination', async () => {
    const { auth, space, folder, target } = setupMove();
    mocks.sharedSpace.hasSiblingAlbumFolderName.mockResolvedValue(true);

    await expect(
      sut.updateAlbumFolder(auth, space.id, folder.id, { parentId: target.id } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mocks.sharedSpace.hasSiblingAlbumFolderName).toHaveBeenCalledWith(
      space.id,
      target.id,
      folder.name,
      folder.id,
    );
  });

  // M-08: getAlbumFolderById is space-scoped, so a target in another space reads as absent.
  it('M-08: rejects a move to a folder in another space', async () => {
    const { auth, space, folder } = setupMove();
    mocks.sharedSpace.getAlbumFolderById.mockImplementation(async (_s: string, id: string) =>
      id === folder.id ? folder : undefined,
    );

    await expect(
      sut.updateAlbumFolder(auth, space.id, folder.id, { parentId: newUuid() } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mocks.sharedSpace.moveAlbumFolderChecked).not.toHaveBeenCalled();
  });

  // M-09: moving into the parent it already has must be a no-op, which only works because
  // the name pre-check excludes the row itself.
  it('M-09: moving into the current parent is idempotent', async () => {
    const { auth, space, target } = setupMove();
    const folder = folderRow({ spaceId: space.id, name: 'Trips', parentId: target.id });
    mocks.sharedSpace.getAlbumFolderById.mockImplementation(async (_s: string, id: string) =>
      id === folder.id ? folder : id === target.id ? target : undefined,
    );
    mocks.sharedSpace.getAlbumFolderSubtree.mockResolvedValue([{ id: folder.id, depth: 0 }]);

    await sut.updateAlbumFolder(auth, space.id, folder.id, { parentId: target.id } as any);

    expect(mocks.sharedSpace.hasSiblingAlbumFolderName).toHaveBeenCalledWith(
      space.id,
      target.id,
      folder.name,
      folder.id,
    );
    expect(mocks.sharedSpace.moveAlbumFolderChecked).toHaveBeenCalled();
  });

  // C-01, service half: the repository re-checks under lock and can still report a cycle
  // that the optimistic pre-check missed. That verdict must surface as a 400.
  it('C-01: surfaces a cycle detected inside the repository transaction', async () => {
    const { auth, space, folder, target } = setupMove();
    mocks.sharedSpace.moveAlbumFolderChecked.mockResolvedValue('cycle');

    await expect(
      sut.updateAlbumFolder(auth, space.id, folder.id, { parentId: target.id } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('renames and moves in a single call', async () => {
    const { auth, space, folder, target } = setupMove();
    mocks.sharedSpace.updateAlbumFolder.mockResolvedValue(true);

    await sut.updateAlbumFolder(auth, space.id, folder.id, { name: 'Travel', parentId: target.id } as any);

    expect(mocks.sharedSpace.moveAlbumFolderChecked).toHaveBeenCalledWith(space.id, folder.id, target.id);
    expect(mocks.sharedSpace.updateAlbumFolder).toHaveBeenCalledWith(space.id, folder.id, { name: 'Travel' });
  });
});
```

- [ ] **Step 3: Write the failing medium test for the concurrency guard**

Append to `server/test/medium/specs/repositories/shared-space-album-folder.repository.spec.ts`:

```ts
describe('SharedSpaceRepository — album folder moves', () => {
  it('moveAlbumFolderChecked reparents a folder', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const archive = await sut.createAlbumFolder({
      spaceId: space.id,
      parentId: null,
      name: 'Archive',
      createdById: user.id,
    });
    const trips = await sut.createAlbumFolder({
      spaceId: space.id,
      parentId: null,
      name: 'Trips',
      createdById: user.id,
    });

    await expect(sut.moveAlbumFolderChecked(space.id, trips.id, archive.id)).resolves.toBe('ok');
    await expect(sut.getAlbumFolderById(space.id, trips.id)).resolves.toMatchObject({ parentId: archive.id });
  });

  it('moveAlbumFolderChecked reports a cycle when the target is a descendant', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const trips = await sut.createAlbumFolder({
      spaceId: space.id,
      parentId: null,
      name: 'Trips',
      createdById: user.id,
    });
    const y2026 = await sut.createAlbumFolder({
      spaceId: space.id,
      parentId: trips.id,
      name: '2026',
      createdById: user.id,
    });

    await expect(sut.moveAlbumFolderChecked(space.id, trips.id, y2026.id)).resolves.toBe('cycle');
    await expect(sut.getAlbumFolderById(space.id, trips.id)).resolves.toMatchObject({ parentId: null });
  });

  it('moveAlbumFolderChecked reports notfound for a folder in another space', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const { space: other } = await ctx.newSharedSpace({ createdById: user.id });
    const foreign = await sut.createAlbumFolder({
      spaceId: other.id,
      parentId: null,
      name: 'Trips',
      createdById: user.id,
    });

    await expect(sut.moveAlbumFolderChecked(space.id, foreign.id, null)).resolves.toBe('notfound');
  });

  // C-01: the mutual race. Both pre-checks pass before either write lands, so correctness
  // depends entirely on the per-space advisory lock serialising the two transactions —
  // locking only the moved row would leave them touching disjoint rows and both would commit,
  // producing a detached cycle.
  it('C-01: concurrent X->Y and Y->X moves cannot both succeed', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const x = await sut.createAlbumFolder({ spaceId: space.id, parentId: null, name: 'X', createdById: user.id });
    const y = await sut.createAlbumFolder({ spaceId: space.id, parentId: null, name: 'Y', createdById: user.id });

    const results = await Promise.all([
      sut.moveAlbumFolderChecked(space.id, x.id, y.id),
      sut.moveAlbumFolderChecked(space.id, y.id, x.id),
    ]);

    expect(results.filter((r) => r === 'ok')).toHaveLength(1);
    expect(results.filter((r) => r === 'cycle')).toHaveLength(1);

    // And the tree is still a tree: exactly one of them still sits at the root.
    const rows = await sut.getAlbumFoldersBySpace(space.id);
    expect(rows.filter((r) => r.parentId === null)).toHaveLength(1);
  });
});
```

- [ ] **Step 4: Run both test files to verify they fail**

```bash
cd server && pnpm vitest --run src/services/shared-space.service.spec.ts -t "updateAlbumFolder (move)"
pnpm test:medium -- --run test/medium/specs/repositories/shared-space-album-folder.repository.spec.ts -t "album folder moves"
```

Expected: FAIL — `moveAlbumFolderChecked is not a function`.

- [ ] **Step 5: Implement the repository move**

Add to `server/src/repositories/shared-space.repository.ts`:

```ts
  // Serialised per space by a transaction-scoped advisory lock. A row lock on the moved folder
  // alone is NOT enough: in the mutual race (move X into Y while moving Y into X) the two
  // transactions touch disjoint rows, both ancestor checks pass, and the result is a detached
  // cycle. Folder moves are rare, so serialising them per space costs nothing.
  //
  // Everything below uses `trx` — a `this.db` query inside a transaction callback deadlocks (#595).
  moveAlbumFolderChecked(
    spaceId: string,
    folderId: string,
    newParentId: string | null,
  ): Promise<'ok' | 'cycle' | 'notfound'> {
    return this.db.transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${spaceId}))`.execute(trx);

      const folder = await trx
        .selectFrom('shared_space_album_folder')
        .select(['id'])
        .where('spaceId', '=', spaceId)
        .where('id', '=', folderId)
        .executeTakeFirst();

      if (!folder) {
        return 'notfound' as const;
      }

      if (newParentId) {
        const target = await trx
          .selectFrom('shared_space_album_folder')
          .select(['id'])
          .where('spaceId', '=', spaceId)
          .where('id', '=', newParentId)
          .executeTakeFirst();

        if (!target) {
          return 'notfound' as const;
        }

        // Re-read the target's ancestor chain under the lock, so a concurrently-committed move
        // is visible here even though it was not when the service ran its optimistic check.
        const ancestors = await trx
          .withRecursive('ancestors', (qb) =>
            qb
              .selectFrom('shared_space_album_folder')
              .select(['id', 'parentId'])
              .where('id', '=', newParentId)
              .unionAll(
                qb
                  .selectFrom('shared_space_album_folder as f')
                  .innerJoin('ancestors as a', 'a.parentId', 'f.id')
                  .select(['f.id', 'f.parentId']),
              ),
          )
          .selectFrom('ancestors')
          .select('id')
          .execute();

        if (ancestors.some((a) => a.id === folderId)) {
          return 'cycle' as const;
        }
      }

      await trx
        .updateTable('shared_space_album_folder')
        .set({ parentId: newParentId })
        .where('id', '=', folderId)
        .execute();

      return 'ok' as const;
    });
  }
```

- [ ] **Step 6: Implement the service move branch**

Replace the body of `updateAlbumFolder` in `server/src/services/shared-space.service.ts`:

```ts
  async updateAlbumFolder(
    auth: AuthDto,
    spaceId: string,
    folderId: string,
    dto: SharedSpaceAlbumFolderUpdateDto,
  ): Promise<void> {
    await this.requireRole(auth, spaceId, SharedSpaceRole.Editor);

    const folder = await this.sharedSpaceRepository.getAlbumFolderById(spaceId, folderId);
    if (!folder) {
      throw new BadRequestException('Folder not found');
    }

    if (dto.name === undefined && dto.parentId === undefined) {
      throw new BadRequestException('Nothing to update');
    }

    const isMove = dto.parentId !== undefined;
    const destinationParentId = isMove ? (dto.parentId ?? null) : folder.parentId;
    const name = dto.name === undefined ? folder.name : this.normalizeAlbumFolderName(dto.name);

    if (isMove && destinationParentId !== null) {
      if (destinationParentId === folderId) {
        throw new BadRequestException('A folder cannot be moved into itself');
      }

      const target = await this.sharedSpaceRepository.getAlbumFolderById(spaceId, destinationParentId);
      if (!target) {
        throw new BadRequestException('Destination folder not found');
      }

      const targetAncestors = await this.sharedSpaceRepository.getAlbumFolderAncestors(destinationParentId);
      if (targetAncestors.some((ancestor) => ancestor.id === folderId)) {
        throw new BadRequestException('A folder cannot be moved into one of its own descendants');
      }

      const subtree = await this.sharedSpaceRepository.getAlbumFolderSubtree(folderId);
      const height = Math.max(...subtree.map((node) => node.depth));
      const resultingDepth = targetAncestors.length + 1 + height;
      if (resultingDepth > SHARED_SPACE_ALBUM_FOLDER_MAX_DEPTH) {
        throw new BadRequestException(
          `Folder nesting is limited to ${SHARED_SPACE_ALBUM_FOLDER_MAX_DEPTH} levels (this would be ${resultingDepth})`,
        );
      }
    }

    // excludeId = folderId: renaming to the current name, or moving into the current parent,
    // must not collide with the row being modified.
    await this.assertNoAlbumFolderNameConflict(spaceId, destinationParentId, name, folderId);

    if (isMove) {
      const outcome = await this.sharedSpaceRepository.moveAlbumFolderChecked(
        spaceId,
        folderId,
        destinationParentId,
      );
      if (outcome === 'cycle') {
        throw new BadRequestException('A folder cannot be moved into one of its own descendants');
      }
      if (outcome === 'notfound') {
        throw new BadRequestException('Folder not found');
      }
    }

    if (dto.name !== undefined) {
      await this.sharedSpaceRepository.updateAlbumFolder(spaceId, folderId, { name });
    }
  }
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
cd server && pnpm vitest --run src/services/shared-space.service.spec.ts -t "album folders"
pnpm test:medium -- --run test/medium/specs/repositories/shared-space-album-folder.repository.spec.ts
```

Expected: PASS.

- [ ] **Step 8: Regenerate SQL docs and commit**

```bash
make sql          # dev DB must be running
git add server/src server/test
git commit -m "feat(server): add space album folder move with cycle and depth guards"
```

---

## Task 5: Service — move an album between folders

**Implements:** A-01–A-08, C-02, C-03, S-01. Also adds `folderId` to the linked-album listing.

**Files:**

- Modify: `server/src/services/shared-space.service.ts`
- Modify: `server/src/dtos/shared-space.dto.ts`
- Modify: `server/src/repositories/shared-space.repository.ts` (`getLinkedAlbums` selects `folderId`)
- Modify: `server/src/services/shared-space.service.spec.ts`
- Modify: `server/test/medium/specs/sync/shared-space-album-link-sync.spec.ts`

**Interfaces:**

- Produces:

```ts
setAlbumFolder(auth: AuthDto, spaceId: string, albumId: string, dto: SharedSpaceAlbumFolderMoveAlbumDto): Promise<void>
class SharedSpaceAlbumFolderMoveAlbumDto  // { folderId: string | null }
// SharedSpaceLinkedAlbumDto gains: folderId: string | null
```

- [ ] **Step 1: Add the DTO and extend the listing schema**

In `server/src/dtos/shared-space.dto.ts`:

```ts
const SharedSpaceAlbumFolderMoveAlbumSchema = z
  .object({
    folderId: z.uuidv4().nullable().describe('Destination folder ID; null moves the album to the space root'),
  })
  .meta({ id: 'SharedSpaceAlbumFolderMoveAlbumDto' });

export class SharedSpaceAlbumFolderMoveAlbumDto extends createZodDto(SharedSpaceAlbumFolderMoveAlbumSchema) {}
```

And extend `SharedSpaceLinkedAlbumSchema`'s `.extend({ … })` block with:

```ts
    folderId: z.string().nullable().describe('Folder this album sits in within the space, or null for the root'),
```

- [ ] **Step 2: Write the failing tests**

Append inside `describe('album folders')` in `server/src/services/shared-space.service.spec.ts`:

```ts
describe('setAlbumFolder', () => {
  // A-01
  it('A-01: moves an album into a folder', async () => {
    const { auth, space } = setupEditor();
    const folder = folderRow({ spaceId: space.id });
    const albumId = newUuid();
    mocks.sharedSpace.getAlbumFolderById.mockResolvedValue(folder);
    mocks.sharedSpace.setAlbumLinkFolder.mockResolvedValue(true);

    await sut.setAlbumFolder(auth, space.id, albumId, { folderId: folder.id } as any);

    expect(mocks.sharedSpace.setAlbumLinkFolder).toHaveBeenCalledWith(space.id, albumId, folder.id);
  });

  // A-02 — moving to the root needs no folder lookup at all.
  it('A-02: moves an album to the space root', async () => {
    const { auth, space } = setupEditor();
    const albumId = newUuid();
    mocks.sharedSpace.setAlbumLinkFolder.mockResolvedValue(true);

    await sut.setAlbumFolder(auth, space.id, albumId, { folderId: null } as any);

    expect(mocks.sharedSpace.setAlbumLinkFolder).toHaveBeenCalledWith(space.id, albumId, null);
    expect(mocks.sharedSpace.getAlbumFolderById).not.toHaveBeenCalled();
  });

  // A-03 / C-02: the write is an unconditional UPDATE, so repeating it or racing it is
  // last-write-wins with no conflict detection. That is deliberate for placement metadata.
  it('A-03: moving into the same folder again is idempotent', async () => {
    const { auth, space } = setupEditor();
    const folder = folderRow({ spaceId: space.id });
    const albumId = newUuid();
    mocks.sharedSpace.getAlbumFolderById.mockResolvedValue(folder);
    mocks.sharedSpace.setAlbumLinkFolder.mockResolvedValue(true);

    await sut.setAlbumFolder(auth, space.id, albumId, { folderId: folder.id } as any);
    await sut.setAlbumFolder(auth, space.id, albumId, { folderId: folder.id } as any);

    expect(mocks.sharedSpace.setAlbumLinkFolder).toHaveBeenCalledTimes(2);
  });

  // A-04: placement lives on the (spaceId, albumId) join row, so the update is scoped to
  // this space and an album linked elsewhere keeps its other placement untouched.
  it('A-04: scopes the write to this space only', async () => {
    const { auth, space } = setupEditor();
    const folder = folderRow({ spaceId: space.id });
    const albumId = newUuid();
    mocks.sharedSpace.getAlbumFolderById.mockResolvedValue(folder);
    mocks.sharedSpace.setAlbumLinkFolder.mockResolvedValue(true);

    await sut.setAlbumFolder(auth, space.id, albumId, { folderId: folder.id } as any);

    expect(mocks.sharedSpace.setAlbumLinkFolder).toHaveBeenCalledWith(space.id, albumId, folder.id);
  });

  // A-05: the cross-space invariant that PG14 cannot express as a composite FK. This test
  // and the medium test P-07 are the only things enforcing it.
  it('A-05: rejects a folder belonging to another space', async () => {
    const { auth, space } = setupEditor();
    mocks.sharedSpace.getAlbumFolderById.mockResolvedValue(void 0 as any);

    await expect(sut.setAlbumFolder(auth, space.id, newUuid(), { folderId: newUuid() } as any)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(mocks.sharedSpace.setAlbumLinkFolder).not.toHaveBeenCalled();
  });

  // A-06: no link row means nothing to place. The repository returning false is what makes
  // this a 400 rather than a silent success.
  it('A-06: rejects an album that is not linked to the space', async () => {
    const { auth, space } = setupEditor();
    const folder = folderRow({ spaceId: space.id });
    mocks.sharedSpace.getAlbumFolderById.mockResolvedValue(folder);
    mocks.sharedSpace.setAlbumLinkFolder.mockResolvedValue(false);

    await expect(sut.setAlbumFolder(auth, space.id, newUuid(), { folderId: folder.id } as any)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  // A-08
  it('A-08: rejects a folder id that does not exist', async () => {
    const { auth, space } = setupEditor();
    mocks.sharedSpace.getAlbumFolderById.mockResolvedValue(void 0 as any);

    await expect(sut.setAlbumFolder(auth, space.id, newUuid(), { folderId: newUuid() } as any)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  // R-07: space Editor alone is sufficient — album ownership is deliberately NOT required,
  // matching updateAlbumLink. Folders are space-scoped metadata.
  it('R-07: allows an editor to move an album they do not own', async () => {
    const { auth, space } = setupEditor();
    const folder = folderRow({ spaceId: space.id });
    mocks.sharedSpace.getAlbumFolderById.mockResolvedValue(folder);
    mocks.sharedSpace.setAlbumLinkFolder.mockResolvedValue(true);

    await sut.setAlbumFolder(auth, space.id, newUuid(), { folderId: folder.id } as any);

    expect(mocks.access.album.checkOwnerAccess).not.toHaveBeenCalled();
    expect(mocks.sharedSpace.setAlbumLinkFolder).toHaveBeenCalled();
  });

  it('R-03: refuses a viewer', async () => {
    const { auth, space } = setupEditor(SharedSpaceRole.Viewer);

    await expect(sut.setAlbumFolder(auth, space.id, newUuid(), { folderId: null } as any)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(mocks.sharedSpace.setAlbumLinkFolder).not.toHaveBeenCalled();
  });
});
```

A-07 and C-03 are database-level; append them to `server/test/medium/specs/repositories/shared-space-album-folder.repository.spec.ts`:

```ts
describe('album placement lifecycle', () => {
  // A-07: unlinking drops the link row entirely, so no orphan placement survives, and a
  // re-link starts at the root.
  it('A-07: unlinking removes the placement and re-linking lands at the root', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const folder = await sut.createAlbumFolder({
      spaceId: space.id,
      parentId: null,
      name: 'Trips',
      createdById: user.id,
    });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'Rome' });
    await ctx.database
      .insertInto('shared_space_album')
      .values({ spaceId: space.id, albumId: album.id, folderId: folder.id })
      .execute();

    await ctx.database
      .deleteFrom('shared_space_album')
      .where('spaceId', '=', space.id)
      .where('albumId', '=', album.id)
      .execute();

    await ctx.database.insertInto('shared_space_album').values({ spaceId: space.id, albumId: album.id }).execute();

    const link = await ctx.database
      .selectFrom('shared_space_album')
      .selectAll()
      .where('albumId', '=', album.id)
      .executeTakeFirstOrThrow();
    expect(link.folderId).toBeNull();
  });

  // C-03: delete-during-move. Whichever order the two land in, the album must never end up
  // pointing at a folder row that no longer exists.
  it('C-03: an album is never orphaned into a deleted folder', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const folder = await sut.createAlbumFolder({
      spaceId: space.id,
      parentId: null,
      name: 'Trips',
      createdById: user.id,
    });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'Rome' });
    await ctx.database.insertInto('shared_space_album').values({ spaceId: space.id, albumId: album.id }).execute();

    await Promise.allSettled([
      sut.deleteAlbumFolderPromotingChildren(space.id, folder.id),
      sut.setAlbumLinkFolder(space.id, album.id, folder.id),
    ]);

    const link = await ctx.database
      .selectFrom('shared_space_album')
      .selectAll()
      .where('albumId', '=', album.id)
      .executeTakeFirstOrThrow();

    if (link.folderId !== null) {
      // If the placement survived, the folder it points at must still exist.
      await expect(sut.getAlbumFolderById(space.id, link.folderId)).resolves.toBeDefined();
    }
  });
});
```

- [ ] **Step 3: Write the S-01 sync regression test**

Append to `server/test/medium/specs/sync/shared-space-album-link-sync.spec.ts`, following the file's existing setup helpers:

```ts
// S-01: writing folderId bumps updateId (the table has @UpdatedAtTrigger + @UpdateIdColumn),
// so reorganising re-emits every touched link row to mobile. That is acceptable ONLY because
// folderId is absent from the payload, making the re-emit an idempotent no-op upsert.
// If this test fails, someone added folderId to the sync payload — that is a mobile-facing
// decision and needs the mobile-parity spec, not a drive-by change.
it('S-01: does not leak folderId into the album link sync payload', async () => {
  const { auth, ctx, space, album } = await setupLinkedAlbum();
  const folder = await ctx
    .get(SharedSpaceRepository)
    .createAlbumFolder({ spaceId: space.id, parentId: null, name: 'Trips', createdById: auth.user.id });

  await ctx.get(SharedSpaceRepository).setAlbumLinkFolder(space.id, album.id, folder.id);

  const response = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAlbumLinksV1]);

  expect(response.length).toBeGreaterThan(0);
  for (const item of response) {
    expect(item.data).not.toHaveProperty('folderId');
  }
});
```

Adapt `setupLinkedAlbum` / `ctx.syncStream` to the helper names the file already uses — do not invent new ones.

- [ ] **Step 4: Run the tests to verify they fail**

```bash
cd server && pnpm vitest --run src/services/shared-space.service.spec.ts -t "setAlbumFolder"
```

Expected: FAIL — `sut.setAlbumFolder is not a function`.

- [ ] **Step 5: Implement the service method**

Add to `server/src/services/shared-space.service.ts`:

```ts
  async setAlbumFolder(
    auth: AuthDto,
    spaceId: string,
    albumId: string,
    dto: SharedSpaceAlbumFolderMoveAlbumDto,
  ): Promise<void> {
    // Space Editor only — album ownership is deliberately not required. Folders are
    // space-scoped metadata, so any editor may reorganise any linked album. Matches
    // updateAlbumLink, which gates on space Editor alone.
    await this.requireRole(auth, spaceId, SharedSpaceRole.Editor);

    const folderId = dto.folderId ?? null;

    if (folderId !== null) {
      // Space-scoped lookup: this is the only thing preventing a cross-space placement,
      // since PG14 cannot express the composite FK that would enforce it in the schema.
      const folder = await this.sharedSpaceRepository.getAlbumFolderById(spaceId, folderId);
      if (!folder) {
        throw new BadRequestException('Folder not found');
      }
    }

    const updated = await this.sharedSpaceRepository.setAlbumLinkFolder(spaceId, albumId, folderId);
    if (!updated) {
      throw new BadRequestException('Album is not linked to this space');
    }
  }
```

- [ ] **Step 6: Surface `folderId` on the linked-album listing**

In `server/src/repositories/shared-space.repository.ts`, extend the existing select list in `getLinkedAlbums`:

```ts
        .select([
          'shared_space_album.addedById',
          'shared_space_album.showInTimeline',
          'shared_space_album.folderId',
          'shared_space_album.createdAt as linkedAt',
        ])
```

The service's linked-album mapper passes `folderId` straight through — no transformation.

- [ ] **Step 7: Run the tests to verify they pass**

```bash
cd server && pnpm vitest --run src/services/shared-space.service.spec.ts -t "album folders"
pnpm test:medium -- --run test/medium/specs/repositories/shared-space-album-folder.repository.spec.ts
pnpm test:medium -- --run test/medium/specs/sync/shared-space-album-link-sync.spec.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
make sql          # dev DB must be running
git add server/src server/test
git commit -m "feat(server): move albums between space folders"
```

---

## Task 6: Controller routes, permissions, and SDK regeneration

**Implements:** R-01–R-09 at the controller-spec level; produces the SDK the web tasks consume.

**Files:**

- Modify: `server/src/enum.ts`
- Modify: `server/src/dtos/shared-space.dto.ts`
- Modify: `server/src/controllers/shared-space.controller.ts`
- Modify: `server/src/controllers/shared-space.controller.spec.ts`
- Regenerate: `open-api/`, `packages/sdk/`

**Interfaces:**

- Produces the five SDK functions the web consumes:

```ts
getSharedSpaceAlbumFolders({ id }): Promise<SharedSpaceAlbumFolderDto[]>
createSharedSpaceAlbumFolder({ id, sharedSpaceAlbumFolderCreateDto }): Promise<SharedSpaceAlbumFolderDto>
updateSharedSpaceAlbumFolder({ id, folderId, sharedSpaceAlbumFolderUpdateDto }): Promise<void>
deleteSharedSpaceAlbumFolder({ id, folderId }): Promise<void>
setSharedSpaceAlbumFolder({ id, albumId, sharedSpaceAlbumFolderMoveAlbumDto }): Promise<void>
```

- [ ] **Step 1: Add the Permission values**

In `server/src/enum.ts`, immediately after the `SharedSpaceAlbumDelete` line:

```ts
  SharedSpaceAlbumFolderCreate = 'sharedSpaceAlbumFolder.create',
  SharedSpaceAlbumFolderUpdate = 'sharedSpaceAlbumFolder.update',
  SharedSpaceAlbumFolderDelete = 'sharedSpaceAlbumFolder.delete',
```

- [ ] **Step 2: Add the param schema**

In `server/src/dtos/shared-space.dto.ts`, beside `SharedSpaceAlbumParamSchema`:

```ts
// security-9: every path param is a uuidv4, so a non-UUID segment becomes a 400 rather than a
// raw Postgres 22P02 -> 500.
const SharedSpaceAlbumFolderParamSchema = z.object({
  id: z.uuidv4(),
  folderId: z.uuidv4(),
});

export class SharedSpaceAlbumFolderParamDto extends createZodDto(SharedSpaceAlbumFolderParamSchema) {}
```

- [ ] **Step 3: Write the failing controller tests**

Append to `server/src/controllers/shared-space.controller.spec.ts`, following the file's existing `describe` shape:

```ts
describe('album folders', () => {
  it.each([
    ['GET', '/shared-spaces/:id/album-folders'],
    ['POST', '/shared-spaces/:id/album-folders'],
    ['PATCH', '/shared-spaces/:id/album-folders/:folderId'],
    ['DELETE', '/shared-spaces/:id/album-folders/:folderId'],
    ['PUT', '/shared-spaces/:id/albums/:albumId/folder'],
  ])('%s %s requires authentication', async (method, route) => {
    const path = route
      .replace(':id', uuidStub.notFound)
      .replace(':folderId', uuidStub.notFound)
      .replace(':albumId', uuidStub.notFound);
    const { status, body } = await request(ctx.getHttpServer())[method.toLowerCase()](path);
    expect(status).toBe(401);
    expect(body).toEqual(errorDto.unauthorized);
  });

  // A malformed uuid must surface as a 400 from zod, never as a Postgres 22P02 -> 500.
  it.each([['/shared-spaces/invalid/album-folders'], [`/shared-spaces/${uuidStub.notFound}/album-folders/invalid`]])(
    'rejects a malformed uuid in %s with 400',
    async (path) => {
      const { status } = await request(ctx.getHttpServer())
        .get(path)
        .set('Authorization', `Bearer ${authStub.admin.token}`);
      expect(status).toBe(400);
    },
  );
});
```

Match `uuidStub` / `errorDto` / `authStub` / `ctx` to whatever the existing spec file already imports and uses — do not introduce new helpers.

- [ ] **Step 4: Run the tests to verify they fail**

```bash
cd server && pnpm vitest --run src/controllers/shared-space.controller.spec.ts -t "album folders"
```

Expected: FAIL with 404 instead of 401 — the routes do not exist.

- [ ] **Step 5: Add the routes**

Append to `SharedSpaceController` in `server/src/controllers/shared-space.controller.ts`, after `unlinkAlbum`:

```ts
  @Get(':id/album-folders')
  @Authenticated({ permission: Permission.SharedSpaceRead })
  @Endpoint({
    summary: 'List the album folders of a shared space',
    description:
      'Returns every folder in the space as a flat list; the client builds the tree. Folder names are member-only information, so non-members are refused rather than given an empty list.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  getSharedSpaceAlbumFolders(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
  ): Promise<SharedSpaceAlbumFolderDto[]> {
    return this.service.getAlbumFolders(auth, id);
  }

  @Post(':id/album-folders')
  @Authenticated({ permission: Permission.SharedSpaceAlbumFolderCreate })
  @Endpoint({
    summary: 'Create an album folder in a shared space',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  createSharedSpaceAlbumFolder(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Body() dto: SharedSpaceAlbumFolderCreateDto,
  ): Promise<SharedSpaceAlbumFolderDto> {
    return this.service.createAlbumFolder(auth, id, dto);
  }

  @Patch(':id/album-folders/:folderId')
  @Authenticated({ permission: Permission.SharedSpaceAlbumFolderUpdate })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Rename or move an album folder',
    description: 'Pass parentId: null to move the folder to the space root.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  updateSharedSpaceAlbumFolder(
    @Auth() auth: AuthDto,
    @Param() { id, folderId }: SharedSpaceAlbumFolderParamDto,
    @Body() dto: SharedSpaceAlbumFolderUpdateDto,
  ): Promise<void> {
    return this.service.updateAlbumFolder(auth, id, folderId, dto);
  }

  @Delete(':id/album-folders/:folderId')
  @Authenticated({ permission: Permission.SharedSpaceAlbumFolderDelete })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Delete an album folder',
    description:
      'Direct children are promoted one level up. Albums are never unlinked, and structure below the deleted folder is preserved.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  deleteSharedSpaceAlbumFolder(
    @Auth() auth: AuthDto,
    @Param() { id, folderId }: SharedSpaceAlbumFolderParamDto,
  ): Promise<void> {
    return this.service.deleteAlbumFolder(auth, id, folderId);
  }

  @Put(':id/albums/:albumId/folder')
  @Authenticated({ permission: Permission.SharedSpaceAlbumUpdate })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Move a linked album into a folder',
    description:
      'Separate from PATCH :id/albums/:albumId so that endpoint\'s required showInTimeline stays required — making it optional would regenerate the Dart client into three-state territory.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  setSharedSpaceAlbumFolder(
    @Auth() auth: AuthDto,
    @Param() { id, albumId }: SharedSpaceAlbumParamDto,
    @Body() dto: SharedSpaceAlbumFolderMoveAlbumDto,
  ): Promise<void> {
    return this.service.setAlbumFolder(auth, id, albumId, dto);
  }
```

Add `Post` to the `@nestjs/common` import if it is not already there, and import the four new DTO classes.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd server && pnpm vitest --run src/controllers/shared-space.controller.spec.ts -t "album folders"
```

Expected: PASS.

- [ ] **Step 7: Regenerate the OpenAPI spec and clients**

```bash
cd server && pnpm build
pnpm sync:open-api
cd .. && make open-api
```

- [ ] **Step 8: Verify the Dart client did not change shape for existing calls**

```bash
git diff --stat mobile/openapi
git diff mobile/openapi | grep -E "^[-+].*(linkAlbum|showInTimeline)" | head -40
```

Expected: **additive only.** `showInTimeline` must remain required on `SharedSpaceAlbumLinkUpdateDto`, and the existing `linkAlbum` call signature must be unchanged. If either moved, stop — that is the three-state Dart regression the design specifically avoids.

- [ ] **Step 9: Commit**

```bash
git add server/src open-api packages/sdk mobile/openapi
git commit -m "feat(api): add space album folder endpoints"
```

---

## Task 7: Folder-aware album linking

**Implements:** A-09, A-10.

**Files:**

- Modify: `server/src/dtos/shared-space.dto.ts`
- Modify: `server/src/controllers/shared-space.controller.ts`
- Modify: `server/src/services/shared-space.service.ts`
- Modify: `server/src/services/shared-space.service.spec.ts`

**Interfaces:**

- Produces: `linkAlbum(auth, spaceId, albumId, folderId?: string | null)` — the SDK gains an optional `folderId` query param on `linkAlbum`.

- [ ] **Step 1: Add the query schema**

In `server/src/dtos/shared-space.dto.ts`:

```ts
// A QUERY param, not a body. A NestJS `@Body() dto` emits `required: true` in the OpenAPI
// document even when every field is optional, which would change the generated Dart
// `linkAlbum` signature and break mobile's existing no-argument call.
const SharedSpaceAlbumLinkQuerySchema = z.object({
  folderId: z.uuidv4().optional().describe('Place the newly linked album in this folder'),
});

export class SharedSpaceAlbumLinkQueryDto extends createZodDto(SharedSpaceAlbumLinkQuerySchema) {}
```

- [ ] **Step 2: Write the failing tests**

Append inside `describe('album folders')` in `server/src/services/shared-space.service.spec.ts`:

```ts
describe('linkAlbum with a folder', () => {
  const setupLink = () => {
    const auth = factory.auth({ user: { isAdmin: false } });
    const space = factory.sharedSpace({ faceRecognitionEnabled: false });
    const albumId = newUuid();
    mocks.sharedSpace.getMember.mockResolvedValue(
      makeMemberResult({ spaceId: space.id, userId: auth.user.id, role: SharedSpaceRole.Owner }),
    );
    mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
    mocks.access.album.checkSharedAlbumAccess.mockResolvedValue(new Set());
    mocks.sharedSpace.addAlbum.mockResolvedValue({ spaceId: space.id, albumId } as any);
    mocks.sharedSpace.getById.mockResolvedValue(space);
    mocks.sharedSpace.update.mockResolvedValue(space);
    mocks.album.getById.mockResolvedValue({ albumName: 'Rome' } as any);
    mocks.sharedSpace.logActivity.mockResolvedValue(void 0);
    return { auth, space, albumId };
  };

  // A-10: one request, not link-then-move — otherwise a bulk link doubles its round-trips
  // and every album visibly flashes at the root first.
  it('A-10: links and places the album in a single call', async () => {
    const { auth, space, albumId } = setupLink();
    const folder = folderRow({ spaceId: space.id });
    mocks.sharedSpace.getAlbumFolderById.mockResolvedValue(folder);
    mocks.sharedSpace.setAlbumLinkFolder.mockResolvedValue(true);

    await sut.linkAlbum(auth, space.id, albumId, folder.id);

    expect(mocks.sharedSpace.addAlbum).toHaveBeenCalled();
    expect(mocks.sharedSpace.setAlbumLinkFolder).toHaveBeenCalledWith(space.id, albumId, folder.id);
  });

  // A-09: the folder is validated BEFORE the link is created, so a bad folderId never
  // leaves a half-finished link behind.
  it('A-09: rejects an invalid folderId without creating the link', async () => {
    const { auth, space, albumId } = setupLink();
    mocks.sharedSpace.getAlbumFolderById.mockResolvedValue(void 0 as any);

    await expect(sut.linkAlbum(auth, space.id, albumId, newUuid())).rejects.toBeInstanceOf(BadRequestException);
    expect(mocks.sharedSpace.addAlbum).not.toHaveBeenCalled();
  });

  it('links to the space root when no folder is given, exactly as before', async () => {
    const { auth, space, albumId } = setupLink();

    await sut.linkAlbum(auth, space.id, albumId);

    expect(mocks.sharedSpace.addAlbum).toHaveBeenCalled();
    expect(mocks.sharedSpace.getAlbumFolderById).not.toHaveBeenCalled();
    expect(mocks.sharedSpace.setAlbumLinkFolder).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd server && pnpm vitest --run src/services/shared-space.service.spec.ts -t "linkAlbum with a folder"
```

Expected: FAIL — `setAlbumLinkFolder` never called; `linkAlbum` takes three arguments.

- [ ] **Step 4: Extend `linkAlbum`**

In `server/src/services/shared-space.service.ts`, change the signature and add the two blocks. Everything between them is unchanged:

```ts
  async linkAlbum(auth: AuthDto, spaceId: string, albumId: string, folderId?: string | null): Promise<void> {
    await this.requireRole(auth, spaceId, SharedSpaceRole.Editor);
    await this.requireAccess({ auth, permission: Permission.AlbumUpdate, ids: [albumId] });

    // Validate the destination BEFORE creating the link, so a bad folderId cannot leave a
    // half-finished link behind.
    if (folderId) {
      const folder = await this.sharedSpaceRepository.getAlbumFolderById(spaceId, folderId);
      if (!folder) {
        throw new BadRequestException('Folder not found');
      }
    }

    const result = await this.sharedSpaceRepository.addAlbum({ spaceId, albumId, addedById: auth.user.id });

    // ... existing body unchanged ...

    if (folderId) {
      await this.sharedSpaceRepository.setAlbumLinkFolder(spaceId, albumId, folderId);
    }
  }
```

Place the final `setAlbumLinkFolder` call at the very end of the method, after the existing activity logging, so a re-link of an already-linked album still lands in the requested folder.

- [ ] **Step 5: Wire the query param**

In `server/src/controllers/shared-space.controller.ts`, change `linkAlbum`:

```ts
  linkAlbum(
    @Auth() auth: AuthDto,
    @Param() { id, albumId }: SharedSpaceAlbumParamDto,
    @Query() { folderId }: SharedSpaceAlbumLinkQueryDto,
  ): Promise<void> {
    return this.service.linkAlbum(auth, id, albumId, folderId ?? null);
  }
```

- [ ] **Step 6: Run the tests and regenerate**

```bash
cd server && pnpm vitest --run src/services/shared-space.service.spec.ts -t "album folders"
pnpm build && pnpm sync:open-api
cd .. && make open-api
```

Expected: tests PASS. Then confirm the Dart `linkAlbum` gained an **optional** named parameter and did not become body-required:

```bash
git diff mobile/openapi | grep -B3 -A12 "linkAlbum"
```

- [ ] **Step 7: Commit**

```bash
git add server/src open-api packages/sdk mobile/openapi
git commit -m "feat(api): allow linking an album directly into a space folder"
```

---

## Task 8: Web — the pure tree module

**Implements:** U-01–U-11.

This task depends only on the **generated types** from Task 6, so it can run in parallel with Task 7.

**Files:**

- Create: `web/src/lib/utils/space-album-folders.ts`
- Create: `web/src/lib/utils/space-album-folders.spec.ts`

**Interfaces:**

- Produces:

```ts
export type FolderNode = { folder: SharedSpaceAlbumFolderDto; children: FolderNode[] };
export type SearchHit = { album: SharedSpaceLinkedAlbumDto; path: string[] };

buildFolderTree(folders: SharedSpaceAlbumFolderDto[]): FolderNode[]
getFolderPath(folders: SharedSpaceAlbumFolderDto[], folderId: string | null): SharedSpaceAlbumFolderDto[]   // root-first
getFolderContents(folders, albums, folderId: string | null): { folders: SharedSpaceAlbumFolderDto[]; albums: SharedSpaceLinkedAlbumDto[] }
getRecursiveAlbumCount(folders, albums, folderId: string): number
getFolderPreviewAssetIds(folders, albums, folderId: string): string[]   // up to 4
isDescendant(folders, candidateId: string, ancestorId: string): boolean
flattenForSearch(folders, albums, query: string): SearchHit[]
```

- [ ] **Step 1: Write the failing tests**

Create `web/src/lib/utils/space-album-folders.spec.ts`:

```ts
import {
  buildFolderTree,
  flattenForSearch,
  getFolderContents,
  getFolderPath,
  getFolderPreviewAssetIds,
  getRecursiveAlbumCount,
  isDescendant,
} from '$lib/utils/space-album-folders';
import type { SharedSpaceAlbumFolderDto, SharedSpaceLinkedAlbumDto } from '@immich/sdk';

const folder = (id: string, name: string, parentId: string | null = null): SharedSpaceAlbumFolderDto =>
  ({
    id,
    spaceId: 'space-1',
    parentId,
    name,
    createdById: 'user-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }) as SharedSpaceAlbumFolderDto;

const album = (
  id: string,
  albumName: string,
  folderId: string | null = null,
  overrides: Partial<SharedSpaceLinkedAlbumDto> = {},
): SharedSpaceLinkedAlbumDto =>
  ({
    id,
    albumName,
    folderId,
    description: '',
    assetCount: 1,
    albumThumbnailAssetId: `asset-${id}`,
    endDate: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }) as SharedSpaceLinkedAlbumDto;

// Trips > 2026 > Italy, plus a sibling Family at the root.
const tripsTree = () => [
  folder('trips', 'Trips'),
  folder('y2026', '2026', 'trips'),
  folder('italy', 'Italy', 'y2026'),
  folder('family', 'Family'),
];

describe('space-album-folders', () => {
  describe('buildFolderTree', () => {
    // U-01
    it('U-01: nests folders under their parents and returns roots only at the top', () => {
      const tree = buildFolderTree(tripsTree());

      expect(tree.map((n) => n.folder.id)).toEqual(['trips', 'family']);
      expect(tree[0].children.map((n) => n.folder.id)).toEqual(['y2026']);
      expect(tree[0].children[0].children.map((n) => n.folder.id)).toEqual(['italy']);
    });

    // U-02: the mid-flight-delete case. Another editor can delete a folder between our folder
    // fetch and our album fetch, leaving a child pointing at a parent we never received.
    // Treating it as a root keeps the page rendering instead of throwing.
    it('U-02: treats a folder with an unknown parent as a root and does not throw', () => {
      const orphan = folder('orphan', 'Orphan', 'deleted-folder');

      const tree = buildFolderTree([folder('trips', 'Trips'), orphan]);

      expect(tree.map((n) => n.folder.id).sort()).toEqual(['orphan', 'trips']);
    });

    it('U-02: does not loop forever on a self-referencing folder', () => {
      const cyclic = folder('loop', 'Loop', 'loop');

      expect(() => buildFolderTree([cyclic])).not.toThrow();
    });

    it('returns an empty array for no folders', () => {
      expect(buildFolderTree([])).toEqual([]);
    });
  });

  describe('getFolderPath', () => {
    // U-03
    it('U-03: returns the ancestor chain root-first', () => {
      const path = getFolderPath(tripsTree(), 'italy');

      expect(path.map((f) => f.name)).toEqual(['Trips', '2026', 'Italy']);
    });

    it('U-03: returns a single entry for a root folder', () => {
      expect(getFolderPath(tripsTree(), 'trips').map((f) => f.name)).toEqual(['Trips']);
    });

    it('U-03: returns an empty path for the space root', () => {
      expect(getFolderPath(tripsTree(), null)).toEqual([]);
    });

    // Deleting the folder you have open must degrade to the root, not throw — this is what
    // W-06's fallback relies on.
    it('U-03: returns an empty path for an unknown folder id', () => {
      expect(getFolderPath(tripsTree(), 'deleted')).toEqual([]);
    });
  });

  describe('getFolderContents', () => {
    // U-04
    it('U-04: returns only the folders and albums at this level', () => {
      const albums = [album('a1', 'Rome', 'y2026'), album('a2', 'Venice', 'italy'), album('a3', 'Loose')];

      const contents = getFolderContents(tripsTree(), albums, 'y2026');

      expect(contents.folders.map((f) => f.id)).toEqual(['italy']);
      expect(contents.albums.map((a) => a.id)).toEqual(['a1']);
    });

    it('U-04: returns root folders and unfiled albums for the space root', () => {
      const albums = [album('a1', 'Rome', 'y2026'), album('a3', 'Loose')];

      const contents = getFolderContents(tripsTree(), albums, null);

      expect(contents.folders.map((f) => f.id)).toEqual(['trips', 'family']);
      expect(contents.albums.map((a) => a.id)).toEqual(['a3']);
    });

    it('U-04: returns empty lists for an unknown folder id', () => {
      expect(getFolderContents(tripsTree(), [album('a1', 'Rome')], 'deleted')).toEqual({
        folders: [],
        albums: [],
      });
    });
  });

  describe('getRecursiveAlbumCount', () => {
    // U-05: a folder holding only subfolders would read "0 albums" under a direct count,
    // which is why the tile shows the recursive number.
    it('U-05: counts albums anywhere in the subtree', () => {
      const albums = [album('a1', 'Rome', 'y2026'), album('a2', 'Venice', 'italy'), album('a3', 'Loose')];

      expect(getRecursiveAlbumCount(tripsTree(), albums, 'trips')).toBe(2);
      expect(getRecursiveAlbumCount(tripsTree(), albums, 'y2026')).toBe(2);
      expect(getRecursiveAlbumCount(tripsTree(), albums, 'italy')).toBe(1);
      expect(getRecursiveAlbumCount(tripsTree(), albums, 'family')).toBe(0);
    });
  });

  describe('getFolderPreviewAssetIds', () => {
    // U-06
    it('U-06: returns at most four covers, newest first', () => {
      const albums = [
        album('a1', 'One', 'trips', { endDate: '2026-01-01T00:00:00.000Z' }),
        album('a2', 'Two', 'trips', { endDate: '2026-05-01T00:00:00.000Z' }),
        album('a3', 'Three', 'trips', { endDate: '2026-03-01T00:00:00.000Z' }),
        album('a4', 'Four', 'trips', { endDate: '2026-04-01T00:00:00.000Z' }),
        album('a5', 'Five', 'trips', { endDate: '2026-02-01T00:00:00.000Z' }),
      ];

      expect(getFolderPreviewAssetIds(tripsTree(), albums, 'trips')).toEqual([
        'asset-a2',
        'asset-a4',
        'asset-a3',
        'asset-a1',
      ]);
    });

    it('U-06: draws covers from anywhere in the subtree', () => {
      const albums = [album('a1', 'Rome', 'italy')];

      expect(getFolderPreviewAssetIds(tripsTree(), albums, 'trips')).toEqual(['asset-a1']);
    });

    // U-07 — SpaceCollage already renders its own "empty" layout for this.
    it('U-07: returns an empty array for an empty folder', () => {
      expect(getFolderPreviewAssetIds(tripsTree(), [], 'family')).toEqual([]);
    });

    // U-08: getLinkedAlbums resolves the cover to null when no space-visible asset remains.
    // Emitting that null would render a broken tile — exactly the L17 bug the server-side
    // COALESCE exists to prevent.
    it('U-08: skips albums whose resolved cover is null', () => {
      const albums = [
        album('a1', 'No cover', 'trips', { albumThumbnailAssetId: null }),
        album('a2', 'Has cover', 'trips'),
      ];

      expect(getFolderPreviewAssetIds(tripsTree(), albums, 'trips')).toEqual(['asset-a2']);
    });
  });

  describe('isDescendant', () => {
    // U-09 — this is the client-side drop guard, so a bad drop fires no request at all.
    it('U-09: is true for descendants at any depth', () => {
      expect(isDescendant(tripsTree(), 'y2026', 'trips')).toBe(true);
      expect(isDescendant(tripsTree(), 'italy', 'trips')).toBe(true);
    });

    it('U-09: is false for ancestors, siblings, and self', () => {
      expect(isDescendant(tripsTree(), 'trips', 'italy')).toBe(false);
      expect(isDescendant(tripsTree(), 'family', 'trips')).toBe(false);
      expect(isDescendant(tripsTree(), 'trips', 'trips')).toBe(false);
    });

    it('U-09: is false when either id is unknown', () => {
      expect(isDescendant(tripsTree(), 'ghost', 'trips')).toBe(false);
      expect(isDescendant(tripsTree(), 'trips', 'ghost')).toBe(false);
    });
  });

  describe('flattenForSearch', () => {
    // U-10
    it('U-10: matches albums space-wide and labels each with its folder path', () => {
      const albums = [album('a1', 'Venice', 'y2026'), album('a2', 'Ventoux', 'italy'), album('a3', 'Rome')];

      const hits = flattenForSearch(tripsTree(), albums, 'ven');

      expect(hits.map((h) => h.album.id).sort()).toEqual(['a1', 'a2']);
      expect(hits.find((h) => h.album.id === 'a1')?.path).toEqual(['Trips', '2026']);
      expect(hits.find((h) => h.album.id === 'a2')?.path).toEqual(['Trips', '2026', 'Italy']);
    });

    it('U-10: gives a root album an empty path', () => {
      const hits = flattenForSearch(tripsTree(), [album('a3', 'Rome')], 'rome');

      expect(hits[0].path).toEqual([]);
    });

    it('U-10: matches case-insensitively and searches the description too', () => {
      const albums = [album('a1', 'Trip', null, { description: 'Amazing VENICE holiday' })];

      expect(flattenForSearch(tripsTree(), albums, 'venice')).toHaveLength(1);
    });

    // U-11: an empty query means "search is inactive", not "match everything". The caller
    // uses a non-empty query as the signal to switch into flattened mode at all.
    it.each([['', '   ']])('U-11: returns nothing for a blank query (%p)', (query) => {
      expect(flattenForSearch(tripsTree(), [album('a1', 'Rome')], query)).toEqual([]);
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd web && pnpm vitest --run src/lib/utils/space-album-folders.spec.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

Create `web/src/lib/utils/space-album-folders.ts`:

```ts
import type { SharedSpaceAlbumFolderDto, SharedSpaceLinkedAlbumDto } from '@immich/sdk';

export type FolderNode = {
  folder: SharedSpaceAlbumFolderDto;
  children: FolderNode[];
};

export type SearchHit = {
  album: SharedSpaceLinkedAlbumDto;
  path: string[];
};

const FOLDER_PREVIEW_LIMIT = 4;

/**
 * Every function here is total over the two arrays the albums page already holds. They must
 * never throw on inconsistent input: another editor can delete a folder between our folder
 * fetch and our album fetch, so a `parentId` pointing at a folder we never received is normal,
 * not exceptional. Such a folder is treated as a root.
 */
const byId = (folders: SharedSpaceAlbumFolderDto[]) => new Map(folders.map((f) => [f.id, f]));

/** Walks parent links upward, guarding against a cycle in malformed data. */
const ancestorsOf = (index: Map<string, SharedSpaceAlbumFolderDto>, folderId: string): SharedSpaceAlbumFolderDto[] => {
  const chain: SharedSpaceAlbumFolderDto[] = [];
  const seen = new Set<string>();
  let current = index.get(folderId);

  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.push(current);
    current = current.parentId ? index.get(current.parentId) : undefined;
  }

  return chain;
};

export const buildFolderTree = (folders: SharedSpaceAlbumFolderDto[]): FolderNode[] => {
  const index = byId(folders);
  const nodes = new Map<string, FolderNode>(folders.map((f) => [f.id, { folder: f, children: [] }]));
  const roots: FolderNode[] = [];

  for (const folder of folders) {
    const node = nodes.get(folder.id)!;
    // A self-referencing parentId, or one we never received, both resolve to "root".
    const parent =
      folder.parentId && folder.parentId !== folder.id && index.has(folder.parentId)
        ? nodes.get(folder.parentId)
        : undefined;

    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
};

export const getFolderPath = (
  folders: SharedSpaceAlbumFolderDto[],
  folderId: string | null,
): SharedSpaceAlbumFolderDto[] => {
  if (!folderId) {
    return [];
  }
  return ancestorsOf(byId(folders), folderId).reverse();
};

export const getFolderContents = (
  folders: SharedSpaceAlbumFolderDto[],
  albums: SharedSpaceLinkedAlbumDto[],
  folderId: string | null,
): { folders: SharedSpaceAlbumFolderDto[]; albums: SharedSpaceLinkedAlbumDto[] } => {
  const index = byId(folders);

  if (folderId !== null && !index.has(folderId)) {
    return { folders: [], albums: [] };
  }

  const isRoot = (folder: SharedSpaceAlbumFolderDto) =>
    !folder.parentId || folder.parentId === folder.id || !index.has(folder.parentId);

  return {
    folders: folders.filter((f) => (folderId === null ? isRoot(f) : f.parentId === folderId)),
    albums: albums.filter((a) => (a.folderId ?? null) === folderId),
  };
};

const subtreeIds = (folders: SharedSpaceAlbumFolderDto[], folderId: string): Set<string> => {
  const childrenByParent = new Map<string, string[]>();
  for (const folder of folders) {
    if (folder.parentId && folder.parentId !== folder.id) {
      childrenByParent.set(folder.parentId, [...(childrenByParent.get(folder.parentId) ?? []), folder.id]);
    }
  }

  const ids = new Set<string>();
  const queue = [folderId];
  while (queue.length > 0) {
    const current = queue.pop()!;
    if (ids.has(current)) {
      continue;
    }
    ids.add(current);
    queue.push(...(childrenByParent.get(current) ?? []));
  }
  return ids;
};

const albumsInSubtree = (
  folders: SharedSpaceAlbumFolderDto[],
  albums: SharedSpaceLinkedAlbumDto[],
  folderId: string,
): SharedSpaceLinkedAlbumDto[] => {
  const ids = subtreeIds(folders, folderId);
  return albums.filter((a) => a.folderId && ids.has(a.folderId));
};

export const getRecursiveAlbumCount = (
  folders: SharedSpaceAlbumFolderDto[],
  albums: SharedSpaceLinkedAlbumDto[],
  folderId: string,
): number => albumsInSubtree(folders, albums, folderId).length;

/** Recency key: an album's newest photo, falling back to its own updatedAt when undated. */
const recencyOf = (album: SharedSpaceLinkedAlbumDto): number =>
  new Date(album.endDate ?? album.updatedAt ?? 0).getTime();

export const getFolderPreviewAssetIds = (
  folders: SharedSpaceAlbumFolderDto[],
  albums: SharedSpaceLinkedAlbumDto[],
  folderId: string,
): string[] =>
  albumsInSubtree(folders, albums, folderId)
    .slice()
    .sort((a, b) => recencyOf(b) - recencyOf(a))
    // A null cover means getLinkedAlbums found no space-visible asset. Emitting it would
    // render a broken tile, which is the exact bug the server-side COALESCE prevents.
    .map((a) => a.albumThumbnailAssetId)
    .filter((id): id is string => !!id)
    .slice(0, FOLDER_PREVIEW_LIMIT);

export const isDescendant = (
  folders: SharedSpaceAlbumFolderDto[],
  candidateId: string,
  ancestorId: string,
): boolean => {
  const index = byId(folders);
  if (!index.has(candidateId) || !index.has(ancestorId) || candidateId === ancestorId) {
    return false;
  }
  return ancestorsOf(index, candidateId)
    .slice(1)
    .some((f) => f.id === ancestorId);
};

export const flattenForSearch = (
  folders: SharedSpaceAlbumFolderDto[],
  albums: SharedSpaceLinkedAlbumDto[],
  query: string,
): SearchHit[] => {
  const needle = (query ?? '').trim().toLowerCase();
  // A blank query means "search is inactive", not "match everything" — the caller uses a
  // non-empty query as the signal to switch into flattened mode at all.
  if (!needle) {
    return [];
  }

  const index = byId(folders);

  return albums
    .filter((a) => a.albumName.toLowerCase().includes(needle) || (a.description ?? '').toLowerCase().includes(needle))
    .map((album) => ({
      album,
      path: album.folderId
        ? ancestorsOf(index, album.folderId)
            .reverse()
            .map((f) => f.name)
        : [],
    }));
};
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd web && pnpm vitest --run src/lib/utils/space-album-folders.spec.ts
```

Expected: PASS (24 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/utils/space-album-folders.ts web/src/lib/utils/space-album-folders.spec.ts
git commit -m "feat(web): add space album folder tree utilities"
```

---

## Task 9: Web — folder card, breadcrumb, and picker modal

**Implements:** W-11, W-17, W-20.

> **Plan note:** spec §9 assigns W-01 and W-08 to "component spec and siblings". Both are asserted in the **list** component spec, which Task 10 builds — that is where the folders-before-albums ordering and the empty-folder state actually render. Coverage is unchanged; only the owning task moved.

**Files:**

- Create: `web/src/lib/components/spaces/space-album-folder-card.svelte` + `.spec.ts`
- Create: `web/src/lib/components/spaces/space-album-folder-breadcrumb.svelte` + `.spec.ts`
- Create: `web/src/lib/modals/SpaceAlbumFolderPickerModal.svelte` + `.spec.ts`
- Create: `web/src/lib/modals/SpaceAlbumFolderNameModal.svelte`
- Modify: `i18n/en.json`

**Interfaces:**

- Consumes: `space-album-folders.ts` (Task 8), `SpaceCollage`, the SDK types from Task 6.
- Produces:

```svelte
<SpaceAlbumFolderCard
  folder={SharedSpaceAlbumFolderDto}
  albumCount={number}
  previewAssetIds={string[]}
  canManage={boolean}
  onOpen={(folder) => void}
  onRename={(folder) => void}
  onMove={(folder) => void}
  onDelete={(folder) => void}
/>

<SpaceAlbumFolderBreadcrumb path={SharedSpaceAlbumFolderDto[]} onNavigate={(folderId: string | null) => void} />

// modalManager.show(SpaceAlbumFolderPickerModal, { folders, excludeFolderId, currentFolderId })
//   resolves to { folderId: string | null } on Move, or undefined on Cancel
```

- [ ] **Step 1: Add the i18n keys**

Add to `i18n/en.json`, in alphabetical position. English only — Weblate supplies the rest.

```json
  "space_album_folder_albums_count": "{count, plural, one {# album} other {# albums}}",
  "space_album_folder_delete": "Delete folder",
  "space_album_folder_delete_confirm": "Delete \"{name}\"? Albums inside it will move up one level. Nothing is unlinked.",
  "space_album_folder_depth_exceeded": "Folders can only be nested 10 levels deep",
  "space_album_folder_empty": "No albums in this folder yet",
  "space_album_folder_error_create": "Unable to create folder",
  "space_album_folder_error_delete": "Unable to delete folder",
  "space_album_folder_error_move": "Unable to move",
  "space_album_folder_error_rename": "Unable to rename folder",
  "space_album_folder_limit_reached": "This space has reached its folder limit",
  "space_album_folder_move": "Move to folder…",
  "space_album_folder_move_here": "Move here",
  "space_album_folder_name_label": "Folder name",
  "space_album_folder_name_taken": "A folder with that name already exists here",
  "space_album_folder_new": "New folder",
  "space_album_folder_rename": "Rename folder",
  "space_album_folder_root": "Albums",
```

- [ ] **Step 2: Write the failing component tests**

Create `web/src/lib/components/spaces/space-album-folder-card.spec.ts`:

```ts
import SpaceAlbumFolderCard from '$lib/components/spaces/space-album-folder-card.svelte';
import type { SharedSpaceAlbumFolderDto } from '@immich/sdk';
import { render, screen } from '@testing-library/svelte';

const folder = {
  id: 'trips',
  spaceId: 'space-1',
  parentId: null,
  name: 'Trips',
  createdById: 'user-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} as SharedSpaceAlbumFolderDto;

const defaults = {
  folder,
  albumCount: 12,
  previewAssetIds: ['a1', 'a2', 'a3', 'a4'],
  canManage: true,
};

describe('SpaceAlbumFolderCard', () => {
  // $t() returns RAW KEYS in web unit tests — assert on keys, never on English.
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the folder name', () => {
    render(SpaceAlbumFolderCard, defaults);

    expect(screen.getByText('Trips')).toBeInTheDocument();
  });

  // SpaceCollage renders alt="" images, so queryByRole('img') against it can never fail.
  // Count the elements directly, exactly as space-collage.spec.ts does.
  it('renders one collage image per preview asset', () => {
    const { container } = render(SpaceAlbumFolderCard, defaults);

    expect(container.querySelectorAll('img')).toHaveLength(4);
  });

  it('renders the collage empty state for a folder with no previews', () => {
    const { container } = render(SpaceAlbumFolderCard, { ...defaults, previewAssetIds: [], albumCount: 0 });

    expect(container.querySelectorAll('img')).toHaveLength(0);
    expect(container.querySelector('[data-testid="collage-empty"]')).toBeInTheDocument();
  });

  // W-11: viewers get no management affordances at all.
  it('W-11: renders no kebab menu and is not draggable for a viewer', () => {
    const { container } = render(SpaceAlbumFolderCard, { ...defaults, canManage: false });

    expect(container.querySelector('[data-testid="space-album-folder-card-menu"]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-testid="space-album-folder-card"]')).toHaveAttribute('draggable', 'false');
  });

  it('W-11: renders the kebab menu and is draggable for an editor', () => {
    const { container } = render(SpaceAlbumFolderCard, defaults);

    expect(container.querySelector('[data-testid="space-album-folder-card-menu"]')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="space-album-folder-card"]')).toHaveAttribute('draggable', 'true');
  });

  // W-20: no hardcoded English anywhere. $t() returns the raw key, so the key IS the
  // rendered text — if a literal string were used instead, this assertion would fail.
  it('W-20: renders the album count through i18n rather than a hardcoded string', () => {
    render(SpaceAlbumFolderCard, defaults);

    expect(screen.getByTestId('space-album-folder-card-count')).toHaveTextContent('space_album_folder_albums_count');
  });
});
```

Create `web/src/lib/components/spaces/space-album-folder-breadcrumb.spec.ts`:

```ts
import SpaceAlbumFolderBreadcrumb from '$lib/components/spaces/space-album-folder-breadcrumb.svelte';
import type { SharedSpaceAlbumFolderDto } from '@immich/sdk';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';

const crumb = (id: string, name: string, parentId: string | null = null) =>
  ({
    id,
    spaceId: 'space-1',
    parentId,
    name,
    createdById: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }) as SharedSpaceAlbumFolderDto;

describe('SpaceAlbumFolderBreadcrumb', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a root crumb plus one crumb per path entry', () => {
    render(SpaceAlbumFolderBreadcrumb, {
      path: [crumb('trips', 'Trips'), crumb('y2026', '2026', 'trips')],
      onNavigate: vi.fn(),
    });

    expect(screen.getByText('space_album_folder_root')).toBeInTheDocument();
    expect(screen.getByText('Trips')).toBeInTheDocument();
    expect(screen.getByText('2026')).toBeInTheDocument();
  });

  it('navigates to the space root when the root crumb is clicked', async () => {
    const onNavigate = vi.fn();
    render(SpaceAlbumFolderBreadcrumb, { path: [crumb('trips', 'Trips')], onNavigate });

    await userEvent.click(screen.getByText('space_album_folder_root'));

    expect(onNavigate).toHaveBeenCalledWith(null);
  });

  it('navigates to an ancestor when its crumb is clicked', async () => {
    const onNavigate = vi.fn();
    render(SpaceAlbumFolderBreadcrumb, {
      path: [crumb('trips', 'Trips'), crumb('y2026', '2026', 'trips')],
      onNavigate,
    });

    await userEvent.click(screen.getByText('Trips'));

    expect(onNavigate).toHaveBeenCalledWith('trips');
  });

  // A deep tree must not push the toolbar off-screen on a narrow viewport.
  it('collapses middle crumbs past four levels', () => {
    render(SpaceAlbumFolderBreadcrumb, {
      path: [crumb('a', 'A'), crumb('b', 'B', 'a'), crumb('c', 'C', 'b'), crumb('d', 'D', 'c'), crumb('e', 'E', 'd')],
      onNavigate: vi.fn(),
    });

    expect(screen.getByText('…')).toBeInTheDocument();
    expect(screen.queryByText('C')).not.toBeInTheDocument();
    // First and last are always kept so the trail stays meaningful.
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('E')).toBeInTheDocument();
  });
});
```

Create `web/src/lib/modals/SpaceAlbumFolderPickerModal.spec.ts`:

```ts
import SpaceAlbumFolderNameModal from '$lib/modals/SpaceAlbumFolderNameModal.svelte';
import SpaceAlbumFolderPickerModal from '$lib/modals/SpaceAlbumFolderPickerModal.svelte';
import type { SharedSpaceAlbumFolderDto } from '@immich/sdk';
import { render, screen } from '@testing-library/svelte';

const folder = (id: string, name: string, parentId: string | null = null) =>
  ({
    id,
    spaceId: 'space-1',
    parentId,
    name,
    createdById: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }) as SharedSpaceAlbumFolderDto;

const folders = [
  folder('trips', 'Trips'),
  folder('y2026', '2026', 'trips'),
  folder('italy', 'Italy', 'y2026'),
  folder('family', 'Family'),
];

describe('SpaceAlbumFolderPickerModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // W-17: offering a folder's own subtree as a destination would guarantee a 400. Disabling
  // it client-side means the illegal option is never selectable in the first place.
  it('W-17: disables the moved folder and all of its descendants', () => {
    render(SpaceAlbumFolderPickerModal, {
      folders,
      excludeFolderId: 'trips',
      currentFolderId: null,
      onClose: vi.fn(),
    });

    expect(screen.getByTestId('folder-option-trips')).toBeDisabled();
    expect(screen.getByTestId('folder-option-y2026')).toBeDisabled();
    expect(screen.getByTestId('folder-option-italy')).toBeDisabled();
    expect(screen.getByTestId('folder-option-family')).toBeEnabled();
  });

  // Moving an ALBUM has no subtree to exclude, so every folder stays selectable.
  it('W-17: leaves every folder selectable when no folder is excluded', () => {
    render(SpaceAlbumFolderPickerModal, {
      folders,
      excludeFolderId: null,
      currentFolderId: null,
      onClose: vi.fn(),
    });

    for (const id of ['trips', 'y2026', 'italy', 'family']) {
      expect(screen.getByTestId(`folder-option-${id}`)).toBeEnabled();
    }
  });

  it('offers the space root as a destination', () => {
    render(SpaceAlbumFolderPickerModal, {
      folders,
      excludeFolderId: null,
      currentFolderId: 'trips',
      onClose: vi.fn(),
    });

    expect(screen.getByTestId('folder-option-root')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd web && pnpm vitest --run src/lib/components/spaces/space-album-folder-card.spec.ts src/lib/components/spaces/space-album-folder-breadcrumb.spec.ts src/lib/modals/SpaceAlbumFolderPickerModal.spec.ts
```

Expected: FAIL — components not found.

- [ ] **Step 4: Build the folder card**

Create `web/src/lib/components/spaces/space-album-folder-card.svelte`. It mirrors `space-album-card.svelte`'s structure — a hover-revealed kebab as a **sibling** of the clickable surface, not nested inside it:

```svelte
<script lang="ts">
  import ButtonContextMenu from '$lib/components/shared-components/context-menu/ButtonContextMenu.svelte';
  import MenuOption from '$lib/components/shared-components/context-menu/MenuOption.svelte';
  import SpaceCollage from '$lib/components/spaces/space-collage.svelte';
  import type { SharedSpaceAlbumFolderDto } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { mdiDotsVertical, mdiFolder } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    folder: SharedSpaceAlbumFolderDto;
    albumCount: number;
    previewAssetIds: string[];
    canManage: boolean;
    onOpen?: (folder: SharedSpaceAlbumFolderDto) => void;
    onRename?: (folder: SharedSpaceAlbumFolderDto) => void;
    onMove?: (folder: SharedSpaceAlbumFolderDto) => void;
    onDelete?: (folder: SharedSpaceAlbumFolderDto) => void;
  }

  let { folder, albumCount, previewAssetIds, canManage, onOpen, onRename, onMove, onDelete }: Props = $props();

  // SpaceCollage takes {id, thumbhash}; folder previews are resolved album covers, which the
  // server has already cleared through spaceVisibilityGate, so no thumbhash is available.
  const collageAssets = $derived(previewAssetIds.map((id) => ({ id, thumbhash: null })));
</script>

<div
  data-testid="space-album-folder-card"
  draggable={canManage}
  class="group relative rounded-2xl border border-transparent p-5 hover:border-gray-200 hover:bg-gray-100 dark:hover:border-gray-800 dark:hover:bg-gray-900"
>
  {#if canManage}
    <div
      class="absolute inset-e-6 top-6 z-10 opacity-0 group-hover:opacity-100 focus-within:opacity-100"
      data-testid="space-album-folder-card-menu"
    >
      <ButtonContextMenu
        icon={mdiDotsVertical}
        title={$t('more')}
        color="secondary"
        variant="filled"
        size="medium"
        align="top-right"
        direction="left"
        buttonClass="icon-white-drop-shadow"
      >
        <MenuOption text={$t('space_album_folder_rename')} onClick={() => onRename?.(folder)} />
        <MenuOption text={$t('space_album_folder_move')} onClick={() => onMove?.(folder)} />
        <MenuOption text={$t('space_album_folder_delete')} onClick={() => onDelete?.(folder)} />
      </ButtonContextMenu>
    </div>
  {/if}

  <button type="button" class="w-full text-start" onclick={() => onOpen?.(folder)} data-testid="space-album-folder-card-open">
    <div class="relative aspect-square w-full overflow-hidden rounded-xl">
      <SpaceCollage assets={collageAssets} />
      <!-- Badge, so a folder is never mistaken for an album at a glance. -->
      <div class="absolute bottom-2 start-2 rounded-lg bg-black/55 p-1.5 text-white">
        <Icon icon={mdiFolder} size="20" />
      </div>
    </div>

    <div class="mt-4">
      <p class="line-clamp-2 w-full text-lg/6 font-semibold text-black group-hover:text-primary dark:text-white" title={folder.name}>
        {folder.name}
      </p>
      <p class="text-sm dark:text-immich-dark-fg" data-testid="space-album-folder-card-count">
        {$t('space_album_folder_albums_count', { values: { count: albumCount } })}
      </p>
    </div>
  </button>
</div>
```

- [ ] **Step 5: Build the breadcrumb**

Create `web/src/lib/components/spaces/space-album-folder-breadcrumb.svelte`:

```svelte
<script lang="ts">
  import type { SharedSpaceAlbumFolderDto } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { mdiChevronRight } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    path: SharedSpaceAlbumFolderDto[];
    onNavigate?: (folderId: string | null) => void;
  }

  let { path, onNavigate }: Props = $props();

  const MAX_VISIBLE = 4;

  // Past four levels, keep the first and the last two and elide the middle, so a deep tree
  // cannot push the toolbar off a narrow viewport.
  const visible = $derived.by(() => {
    if (path.length <= MAX_VISIBLE) {
      return path.map((folder) => ({ kind: 'crumb' as const, folder }));
    }
    return [
      { kind: 'crumb' as const, folder: path[0] },
      { kind: 'ellipsis' as const },
      ...path.slice(-2).map((folder) => ({ kind: 'crumb' as const, folder })),
    ];
  });
</script>

<nav class="flex flex-wrap items-center gap-1 px-4 pt-3 text-sm" data-testid="space-album-folder-breadcrumb">
  <button
    type="button"
    class="rounded-md px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-800"
    data-testid="breadcrumb-root"
    onclick={() => onNavigate?.(null)}
  >
    {$t('space_album_folder_root')}
  </button>

  {#each visible as entry, index (entry.kind === 'crumb' ? entry.folder.id : `ellipsis-${index}`)}
    <Icon icon={mdiChevronRight} size="16" class="opacity-60" />
    {#if entry.kind === 'ellipsis'}
      <span class="px-1 opacity-60">…</span>
    {:else}
      <button
        type="button"
        class="rounded-md px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-800"
        data-testid="breadcrumb-{entry.folder.id}"
        onclick={() => onNavigate?.(entry.folder.id)}
      >
        {entry.folder.name}
      </button>
    {/if}
  {/each}
</nav>
```

- [ ] **Step 6: Build the picker modal**

Create `web/src/lib/modals/SpaceAlbumFolderPickerModal.svelte`. Follow `SpaceLinkAlbumModal.svelte`'s `FormModal` shape:

```svelte
<script lang="ts">
  import { buildFolderTree, isDescendant, type FolderNode } from '$lib/utils/space-album-folders';
  import type { SharedSpaceAlbumFolderDto } from '@immich/sdk';
  import { FormModal, Icon } from '@immich/ui';
  import { mdiFolder } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    folders: SharedSpaceAlbumFolderDto[];
    /** When moving a FOLDER, its own subtree is not a legal destination. Null when moving an album. */
    excludeFolderId: string | null;
    currentFolderId: string | null;
    onClose: (result?: { folderId: string | null }) => void;
  }

  let { folders, excludeFolderId, currentFolderId, onClose }: Props = $props();

  let selected = $state<string | null>(currentFolderId);

  const tree = $derived(buildFolderTree(folders));

  // Disabling the moved folder and its descendants means the illegal choice is never
  // selectable — the user cannot produce a request the server would have to reject.
  const isDisabled = (id: string) =>
    !!excludeFolderId && (id === excludeFolderId || isDescendant(folders, id, excludeFolderId));

  const flatten = (nodes: FolderNode[], depth = 0): { folder: SharedSpaceAlbumFolderDto; depth: number }[] =>
    nodes.flatMap((node) => [{ folder: node.folder, depth }, ...flatten(node.children, depth + 1)]);

  const rows = $derived(flatten(tree));
</script>

<FormModal title={$t('space_album_folder_move')} onClose={() => onClose()} onSubmit={() => onClose({ folderId: selected })} submitText={$t('space_album_folder_move_here')}>
  <div class="flex max-h-80 flex-col overflow-y-auto">
    <button
      type="button"
      class="flex items-center gap-2 rounded-md px-2 py-2 text-start hover:bg-gray-100 disabled:opacity-40 dark:hover:bg-gray-800"
      class:font-semibold={selected === null}
      data-testid="folder-option-root"
      onclick={() => (selected = null)}
    >
      {$t('space_album_folder_root')}
    </button>

    {#each rows as row (row.folder.id)}
      <button
        type="button"
        class="flex items-center gap-2 rounded-md px-2 py-2 text-start hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-gray-800"
        class:font-semibold={selected === row.folder.id}
        style="padding-inline-start: {row.depth * 1.25 + 0.5}rem"
        disabled={isDisabled(row.folder.id)}
        data-testid="folder-option-{row.folder.id}"
        onclick={() => (selected = row.folder.id)}
      >
        <Icon icon={mdiFolder} size="18" />
        {row.folder.name}
      </button>
    {/each}
  </div>
</FormModal>
```

- [ ] **Step 7: Build the folder-name modal**

`modalManager.showDialog` resolves to a **boolean** — every call site in this codebase uses it as a confirm (`const confirmed = await modalManager.showDialog(...)`), and the modal specs mock it as `mockResolvedValue(true)`. It cannot collect a folder name. Create a single-field modal instead, on the `LibraryFolderAddModal` pattern.

Create `web/src/lib/modals/SpaceAlbumFolderNameModal.svelte`:

```svelte
<script lang="ts">
  import { Field, FormModal, Input } from '@immich/ui';
  import { mdiFolderPlusOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  type Props = {
    title: string;
    /** Pre-filled when renaming; empty when creating. */
    initialName?: string;
    onClose: (name?: string) => void;
  };

  const { title, initialName = '', onClose }: Props = $props();

  let value = $state(initialName);

  // Trim here as well as on the server: it keeps "  " from arriving as a submittable name,
  // and the server re-validates regardless.
  const onSubmit = () => {
    const name = value.trim();
    onClose(name || undefined);
  };
</script>

<FormModal {title} icon={mdiFolderPlusOutline} {onClose} {onSubmit} size="small" submitText={$t('save')}>
  <Field label={$t('space_album_folder_name_label')}>
    <Input bind:value />
  </Field>
</FormModal>
```

- [ ] **Step 8: Run the tests to verify they pass**

```bash
cd web && pnpm vitest --run src/lib/components/spaces/space-album-folder-card.spec.ts src/lib/components/spaces/space-album-folder-breadcrumb.spec.ts src/lib/modals/SpaceAlbumFolderPickerModal.spec.ts
```

Expected: PASS (13 tests).

- [ ] **Step 9: Commit**

```bash
git add web/src/lib/components/spaces web/src/lib/modals/SpaceAlbumFolderPickerModal.svelte web/src/lib/modals/SpaceAlbumFolderNameModal.svelte i18n/en.json
git commit -m "feat(web): add space album folder card, breadcrumb, and picker"
```

---

## Task 10: Web — list, controls, and page integration

**Implements:** W-01–W-10, W-16, W-18.

**Files:**

- Modify: `web/src/lib/route.ts`
- Modify: `web/src/lib/components/spaces/space-albums-list.svelte`
- Modify: `web/src/lib/components/spaces/space-albums-table.svelte`
- Modify: `web/src/lib/components/spaces/space-albums-controls.svelte`
- Modify: `web/src/lib/modals/SpaceLinkAlbumModal.svelte`
- Modify: `web/src/routes/(user)/spaces/[spaceId]/albums/+page.svelte`
- Modify: `web/src/routes/(user)/spaces/[spaceId]/albums/space-albums-page.spec.ts`
- Modify: `web/src/lib/components/spaces/space-albums-list.spec.ts` _(exists, 228 lines — extend, do not overwrite)_

**Interfaces:**

- Consumes: everything from Tasks 8 and 9, plus the SDK from Task 6.
- Produces: `Route.viewSpaceAlbums({ id, folderId? })`; `SpaceAlbumsList` gains `folders`, `currentFolderId`, `searchHits`, and folder callbacks.

- [ ] **Step 1: Extend the route helper**

In `web/src/lib/route.ts`:

```ts
  viewSpaceAlbums: ({ id, folderId }: { id: string; folderId?: string | null }) =>
    `/spaces/${id}/albums` + asQueryString({ folder: folderId ?? undefined }),
```

`asQueryString` already drops `undefined` and null values, so the root URL stays exactly `/spaces/<id>/albums`.

- [ ] **Step 2: Write the failing list tests**

Create `web/src/lib/components/spaces/space-albums-list.spec.ts`:

```ts
// Appended to the EXISTING space-albums-list.spec.ts — reuse its mocks and imports rather
// than re-declaring them. These are the only additions the folder tests need:
import SpaceAlbumsList from '$lib/components/spaces/space-albums-list.svelte';
import { SpaceAlbumGroupBy, spaceAlbumViewSettings } from '$lib/stores/space-album-view-settings.store';
import type { SharedSpaceAlbumFolderDto, SharedSpaceLinkedAlbumDto } from '@immich/sdk';
import { render, screen } from '@testing-library/svelte';

const folder = (id: string, name: string, parentId: string | null = null) =>
  ({
    id,
    spaceId: 's',
    parentId,
    name,
    createdById: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }) as SharedSpaceAlbumFolderDto;

const album = (id: string, albumName: string, folderId: string | null = null) =>
  ({
    id,
    albumName,
    folderId,
    description: '',
    assetCount: 1,
    albumThumbnailAssetId: `asset-${id}`,
    endDate: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    showInTimeline: true,
  }) as SharedSpaceLinkedAlbumDto;

const defaults = {
  spaceId: 's',
  folders: [folder('trips', 'Trips'), folder('family', 'Family')],
  albums: [album('a1', 'Rome'), album('a2', 'Venice', 'trips')],
  currentFolderId: null,
  searchQuery: '',
  canManage: true,
  members: [],
};

describe('SpaceAlbumsList with folders', () => {
  // The view settings STORE persists across tests in this file just as mock history does
  // (web vitest has no clearMocks), so both need resetting. The existing suite in this file
  // already does exactly this — match it rather than inventing a second convention.
  beforeEach(() => {
    vi.clearAllMocks();
    spaceAlbumViewSettings.reset();
  });

  // W-01: folders are the primary organisational layer, so they always come first.
  it('W-01: renders folders before albums', () => {
    const { container } = render(SpaceAlbumsList, defaults);

    const rendered = [
      ...container.querySelectorAll('[data-testid="space-album-folder-card"],[data-testid="space-album-card"]'),
    ];
    expect(rendered[0]).toHaveAttribute('data-testid', 'space-album-folder-card');
    expect(rendered.at(-1)).toHaveAttribute('data-testid', 'space-album-card');
  });

  it('W-01: shows only this level — the album inside Trips is not at the root', () => {
    render(SpaceAlbumsList, defaults);

    expect(screen.getByText('Rome')).toBeInTheDocument();
    expect(screen.queryByText('Venice')).not.toBeInTheDocument();
  });

  // W-08: reusing the space-level empty state here would wrongly claim the space has no
  // albums at all, when it only means THIS folder is empty.
  it('W-08: renders the folder-specific empty state for an empty folder', () => {
    render(SpaceAlbumsList, { ...defaults, currentFolderId: 'family' });

    expect(screen.getByTestId('space-album-folder-empty')).toHaveTextContent('space_album_folder_empty');
    expect(screen.queryByTestId('empty-state-message')).not.toBeInTheDocument();
  });

  // W-07: group-by regroups the ALBUMS at this level; folders are never grouped.
  // Grouping comes from the spaceAlbumViewSettings STORE, not from a prop.
  it('W-07: leaves folders ungrouped above the grouped album list', () => {
    spaceAlbumViewSettings.update((settings) => ({ ...settings, groupBy: SpaceAlbumGroupBy.Year }));

    const { container } = render(SpaceAlbumsList, defaults);

    const folders = container.querySelectorAll('[data-testid="space-album-folder-card"]');
    expect(folders).toHaveLength(2);
    for (const el of folders) {
      expect(el.closest('[data-testid^="space-album-group-"]')).toBeNull();
    }
  });

  // W-18: while searching, the path subtitle is already the organising signal — grouping the
  // space-wide hits on top of it would bury it.
  it('W-18: renders flattened hits ungrouped even when group-by is active', () => {
    spaceAlbumViewSettings.update((settings) => ({ ...settings, groupBy: SpaceAlbumGroupBy.Year }));

    const { container } = render(SpaceAlbumsList, { ...defaults, searchQuery: 'ven' });

    expect(container.querySelectorAll('[data-testid^="space-album-group-"]')).toHaveLength(0);
    expect(screen.getByText('Venice')).toBeInTheDocument();
  });

  // W-09: search escapes the current folder entirely and labels each hit with its path.
  it('W-09: hides folders and the breadcrumb while searching, and shows paths', () => {
    const { container } = render(SpaceAlbumsList, { ...defaults, searchQuery: 'ven' });

    expect(container.querySelectorAll('[data-testid="space-album-folder-card"]')).toHaveLength(0);
    expect(screen.getByTestId('space-album-search-path-a2')).toHaveTextContent('Trips');
  });
});
```

- [ ] **Step 3: Write the failing page tests**

Append to `web/src/routes/(user)/spaces/[spaceId]/albums/space-albums-page.spec.ts`, following the mocks the file already sets up for `$app/navigation` and `@immich/sdk`:

```ts
describe('space albums page — folders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // W-02
  it('W-02: opening a folder pushes ?folder= onto the URL', async () => {
    const { user } = await renderPage({ folders: [makeFolder('trips', 'Trips')], albums: [] });

    await user.click(screen.getByTestId('space-album-folder-card-open'));

    expect(goto).toHaveBeenCalledWith(expect.stringContaining('folder=trips'));
  });

  // W-03
  it('W-03: a breadcrumb crumb navigates up one level', async () => {
    const { user } = await renderPage({
      folders: [makeFolder('trips', 'Trips'), makeFolder('y2026', '2026', 'trips')],
      albums: [],
      folderParam: 'y2026',
    });

    await user.click(screen.getByTestId('breadcrumb-trips'));

    expect(goto).toHaveBeenCalledWith(expect.stringContaining('folder=trips'));
  });

  // W-04: the drill-in is a real navigation, so browser back is free — this asserts we use
  // goto() with history rather than mutating local state.
  it('W-04: drill-in uses history navigation so browser back works', async () => {
    const { user } = await renderPage({ folders: [makeFolder('trips', 'Trips')], albums: [] });

    await user.click(screen.getByTestId('space-album-folder-card-open'));

    expect(goto).toHaveBeenCalledWith(expect.any(String), expect.not.objectContaining({ replaceState: true }));
  });

  // W-05: a space with no folders must be pixel-identical to today.
  it('W-05: renders no breadcrumb when the space has no folders', async () => {
    await renderPage({ folders: [], albums: [makeAlbum('a1', 'Rome')] });

    expect(screen.queryByTestId('space-album-folder-breadcrumb')).not.toBeInTheDocument();
  });

  // W-06: another editor deleting the folder you have open must not break your page.
  it('W-06: falls back to the root and strips an unknown ?folder=', async () => {
    await renderPage({
      folders: [makeFolder('trips', 'Trips')],
      albums: [makeAlbum('a1', 'Rome')],
      folderParam: 'deleted',
    });

    expect(screen.getByText('Rome')).toBeInTheDocument();
    expect(goto).toHaveBeenCalledWith(expect.not.stringContaining('folder='), { replaceState: true });
  });

  // W-10: search is not folder state — clearing it must restore where you were.
  it('W-10: clearing the search returns to the folder you were in', async () => {
    const { user } = await renderPage({
      folders: [makeFolder('trips', 'Trips')],
      albums: [makeAlbum('a1', 'Rome', 'trips')],
      folderParam: 'trips',
    });

    const search = screen.getByTestId('space-albums-search');
    await user.type(search, 'zzz');
    await user.clear(search);

    expect(screen.getByText('Rome')).toBeInTheDocument();
    expect(screen.getByTestId('space-album-folder-breadcrumb')).toBeInTheDocument();
  });

  // W-16: one request, not link-then-move.
  it('W-16: creating an album inside a folder links it straight into that folder', async () => {
    const { user } = await renderPage({ folders: [makeFolder('trips', 'Trips')], albums: [], folderParam: 'trips' });

    await user.click(screen.getByTestId('create-album-button'));

    expect(linkAlbum).toHaveBeenCalledWith(expect.objectContaining({ folderId: 'trips' }));
  });
});
```

Add `makeFolder` / `makeAlbum` / `renderPage` helpers next to the file's existing fixtures, extending `renderPage` to accept `folders` and `folderParam` and to stub `getSharedSpaceAlbumFolders`.

- [ ] **Step 4: Run both suites to verify they fail**

```bash
cd web && pnpm vitest --run src/lib/components/spaces/space-albums-list.spec.ts "src/routes/(user)/spaces/[spaceId]/albums/space-albums-page.spec.ts"
```

Expected: FAIL.

- [ ] **Step 5: Extend the list component**

In `web/src/lib/components/spaces/space-albums-list.svelte`, add the folder props and render folders above the albums. The existing `filtered` / `sorted` / `groups` derivations stay; they now operate on **this level's** albums.

```svelte
  import SpaceAlbumFolderCard from '$lib/components/spaces/space-album-folder-card.svelte';
  import {
    flattenForSearch,
    getFolderContents,
    getFolderPreviewAssetIds,
    getRecursiveAlbumCount,
  } from '$lib/utils/space-album-folders';
  import type { SharedSpaceAlbumFolderDto } from '@immich/sdk';
```

```ts
interface Props {
  // ...existing props...
  folders?: SharedSpaceAlbumFolderDto[];
  currentFolderId?: string | null;
  onOpenFolder?: (folder: SharedSpaceAlbumFolderDto) => void;
  onRenameFolder?: (folder: SharedSpaceAlbumFolderDto) => void;
  onMoveFolder?: (folder: SharedSpaceAlbumFolderDto) => void;
  onDeleteFolder?: (folder: SharedSpaceAlbumFolderDto) => void;
}
```

```ts
const isSearching = $derived((searchQuery ?? '').trim().length > 0);

// While searching we leave the folder tree entirely: hits come from the whole space, each
// labelled with its path. `?folder=` is untouched, so clearing the box restores this level.
const searchHits = $derived(isSearching ? flattenForSearch(folders, albums, searchQuery) : []);

const contents = $derived(getFolderContents(folders, albums, currentFolderId ?? null));

// Folders sort by NAME, honouring the sort direction but ignoring the sort key: assetCount
// and mostRecentPhoto do not map onto a folder, and reshuffling them under "sort by item
// count" is noise.
const sortedFolders = $derived(
  isSearching
    ? []
    : contents.folders
        .slice()
        .sort((a, b) =>
          $spaceAlbumViewSettings.sortOrder === SortOrder.Desc
            ? b.name.localeCompare(a.name)
            : a.name.localeCompare(b.name),
        ),
);

// Everything downstream — filter, sort, group — now sees only THIS level's albums.
const levelAlbums = $derived(isSearching ? [] : contents.albums);
```

Change the existing `filtered` derivation's source from `albums` to `levelAlbums`, then render, above the existing grid:

```svelte
{#if sortedFolders.length > 0}
  <div class="grid grid-auto-fill-56 gap-y-4" data-testid="space-album-folders-grid">
    {#each sortedFolders as folder (folder.id)}
      <SpaceAlbumFolderCard
        {folder}
        albumCount={getRecursiveAlbumCount(folders, albums, folder.id)}
        previewAssetIds={getFolderPreviewAssetIds(folders, albums, folder.id)}
        {canManage}
        onOpen={onOpenFolder}
        onRename={onRenameFolder}
        onMove={onMoveFolder}
        onDelete={onDeleteFolder}
      />
    {/each}
  </div>
{/if}

{#if isSearching}
  <!-- Flattened, deliberately UNGROUPED: the path subtitle is the organising signal. -->
  <div class="grid grid-auto-fill-56 gap-y-4">
    {#each searchHits as hit (hit.album.id)}
      <div>
        <SpaceAlbumCard {spaceId} album={hit.album} {canManage} {onUnlink} {onToggleTimeline} />
        {#if hit.path.length > 0}
          <p class="px-5 text-xs opacity-70" data-testid="space-album-search-path-{hit.album.id}">
            {hit.path.join(' › ')}
          </p>
        {/if}
      </div>
    {/each}
  </div>
{:else if currentFolderId && levelAlbums.length === 0 && sortedFolders.length === 0}
  <p class="p-8 text-center text-gray-500" data-testid="space-album-folder-empty">
    {$t('space_album_folder_empty')}
  </p>
{/if}
```

Guard the existing grouped/ungrouped album rendering with `{#if !isSearching}` so it does not double-render during a search.

Where the list renders `<SpaceAlbumsTable …>`, pass the folder props through, including
`allAlbums={albums}` alongside the existing `albums={sorted}` — the first is every album in the
space, the second is this level's.

- [ ] **Step 6: Add folder rows to the table view**

`space-albums-table.svelte` is **not** a plain `<table>` grid. Its rows are flex containers
(`<tr class="flex w-full place-items-center …">`) with explicit per-cell width classes, and albums
render through a `{#snippet albumRow(album)}`. Folder rows must be a sibling snippet using the same
width classes, or the two row types will not line up.

It also needs `allAlbums` as a **separate prop**: the existing `albums` prop is already the
current level's sorted list (the list passes `albums={sorted}`), so computing a recursive count
from it would make every folder row read "0 albums".

```svelte
<script lang="ts">
  import { getFolderContents, getRecursiveAlbumCount } from '$lib/utils/space-album-folders';
  import type { SharedSpaceAlbumFolderDto } from '@immich/sdk';
  import { mdiFolder } from '@mdi/js';
  import { SortOrder } from '$lib/stores/preferences.store';

  interface Props {
    // ...existing props (spaceId, albums, canManage, groups, grouped, onUnlink, onToggleTimeline)...
    folders?: SharedSpaceAlbumFolderDto[];
    /** EVERY linked album in the space, not just this level — recursive counts need the lot. */
    allAlbums?: SharedSpaceLinkedAlbumDto[];
    currentFolderId?: string | null;
    onOpenFolder?: (folder: SharedSpaceAlbumFolderDto) => void;
  }

  let {
    // ...existing destructured props...
    folders = [],
    allAlbums = [],
    currentFolderId = null,
    onOpenFolder,
  }: Props = $props();

  // Same rule as the cover grid: sort by name, honour the sort DIRECTION, ignore the sort key.
  // Switching view modes must never reorder the folder list.
  const levelFolders = $derived(
    getFolderContents(folders, [], currentFolderId)
      .folders.slice()
      .sort((a, b) =>
        $spaceAlbumViewSettings.sortOrder === SortOrder.Desc
          ? b.name.localeCompare(a.name)
          : a.name.localeCompare(b.name),
      ),
  );
</script>
```

Add a `folderRow` snippet beside the existing `albumRow`, copying its `<tr>` and `<td>` classes
verbatim so the columns align. Only the leading cell differs:

```svelte
{#snippet folderRow(folder: SharedSpaceAlbumFolderDto)}
  <tr
    class="flex w-full cursor-pointer place-items-center border-3 border-transparent p-2 text-center odd:bg-subtle/80 even:bg-subtle/20 hover:border-immich-primary/75 md:px-5 md:py-2 odd:dark:bg-immich-dark-gray/75 even:dark:bg-immich-dark-gray/50 dark:hover:border-immich-dark-primary/75"
    data-testid="space-album-folder-row"
    onclick={() => onOpenFolder?.(folder)}
  >
    <td class="text-md flex w-8/12 items-center gap-2 text-start text-ellipsis sm:w-4/12 md:w-4/12 xl:w-[30%] 2xl:w-[40%]">
      <Icon icon={mdiFolder} size="20" />
      {folder.name}
    </td>
    <td class="text-md w-4/12 text-ellipsis sm:w-2/12 md:w-2/12 xl:w-[15%]">
      {$t('space_album_folder_albums_count', {
        values: { count: getRecursiveAlbumCount(folders, allAlbums, folder.id) },
      })}
    </td>
    <!-- One empty cell per REMAINING column in albumRow, with that column's exact width
         classes copied across. Read albumRow and mirror it — the counts must match. -->
  </tr>
{/snippet}
```

Render the folder rows before the album rows, inside the existing `<tbody>` and **outside** any
group wrapper, so folders stay ungrouped even when group-by is active (W-07):

```svelte
    {#each levelFolders as folder (folder.id)}
      {@render folderRow(folder)}
    {/each}
```

- [ ] **Step 7: Add the New folder button**

In `space-albums-controls.svelte`, add a prop `onCreateFolder?: () => void` and, inside the existing `{#if canManage}` block, before the Create album button:

```svelte
      <Button
        size="small"
        variant="ghost"
        leadingIcon={mdiFolderPlusOutline}
        onclick={() => onCreateFolder?.()}
        data-testid="create-folder-button"
      >
        {$t('space_album_folder_new')}
      </Button>
```

Import `mdiFolderPlusOutline` from `@mdi/js`.

- [ ] **Step 8: Wire the page**

In `web/src/routes/(user)/spaces/[spaceId]/albums/+page.svelte`:

```ts
import { page } from '$app/state';
import SpaceAlbumFolderBreadcrumb from '$lib/components/spaces/space-album-folder-breadcrumb.svelte';
import SpaceAlbumFolderPickerModal from '$lib/modals/SpaceAlbumFolderPickerModal.svelte';
import { getFolderPath } from '$lib/utils/space-album-folders';
import {
  createSharedSpaceAlbumFolder,
  deleteSharedSpaceAlbumFolder,
  getSharedSpaceAlbumFolders,
  updateSharedSpaceAlbumFolder,
  type SharedSpaceAlbumFolderDto,
} from '@immich/sdk';

let folders = $state<SharedSpaceAlbumFolderDto[]>([]);

const requestedFolderId = $derived(page.url.searchParams.get('folder'));

// A folder another editor deleted must degrade to the root rather than 404 the page.
const currentFolderId = $derived(
  requestedFolderId && folders.some((f) => f.id === requestedFolderId) ? requestedFolderId : null,
);

const folderPath = $derived(getFolderPath(folders, currentFolderId));

$effect(() => {
  // Strip a stale ?folder= so a refresh or a share of this URL does not keep resolving to
  // a folder that no longer exists. replaceState: the fallback is not a history entry.
  if (requestedFolderId && folders.length > 0 && currentFolderId === null) {
    void goto(Route.viewSpaceAlbums({ id: space.id }), { replaceState: true });
  }
});

async function reload() {
  try {
    [albums, folders] = await Promise.all([
      getSharedSpaceAlbums({ id: space.id }),
      getSharedSpaceAlbumFolders({ id: space.id }),
    ]);
  } catch (error) {
    handleError(error, $t('spaces_linked_albums_error_load'));
  }
}

const navigateToFolder = (folderId: string | null) => goto(Route.viewSpaceAlbums({ id: space.id, folderId }));

// showDialog resolves to a BOOLEAN, so it cannot collect a name — this uses the dedicated
// single-field modal from Task 9.
async function handleCreateFolder() {
  const name = await modalManager.show(SpaceAlbumFolderNameModal, {
    title: $t('space_album_folder_new'),
  });
  if (!name) {
    return;
  }
  try {
    await createSharedSpaceAlbumFolder({
      id: space.id,
      sharedSpaceAlbumFolderCreateDto: { name, parentId: currentFolderId },
    });
    await reload();
  } catch (error) {
    handleError(error, $t('space_album_folder_error_create'));
  }
}

async function handleRenameFolder(folder: SharedSpaceAlbumFolderDto) {
  const name = await modalManager.show(SpaceAlbumFolderNameModal, {
    title: $t('space_album_folder_rename'),
    initialName: folder.name,
  });
  if (!name || name === folder.name) {
    return;
  }
  try {
    await updateSharedSpaceAlbumFolder({
      id: space.id,
      folderId: folder.id,
      sharedSpaceAlbumFolderUpdateDto: { name },
    });
    await reload();
  } catch (error) {
    handleError(error, $t('space_album_folder_error_rename'));
  }
}

async function handleMoveFolder(folder: SharedSpaceAlbumFolderDto) {
  const result = await modalManager.show(SpaceAlbumFolderPickerModal, {
    folders,
    excludeFolderId: folder.id,
    currentFolderId: folder.parentId,
  });
  if (!result) {
    return;
  }
  await moveFolder(folder.id, result.folderId);
}

async function moveFolder(folderId: string, parentId: string | null) {
  try {
    await updateSharedSpaceAlbumFolder({
      id: space.id,
      folderId,
      sharedSpaceAlbumFolderUpdateDto: { parentId },
    });
    await reload();
  } catch (error) {
    handleError(error, $t('space_album_folder_error_move'));
  }
}

async function handleDeleteFolder(folder: SharedSpaceAlbumFolderDto) {
  const confirmed = await modalManager.showDialog({
    title: $t('space_album_folder_delete'),
    prompt: $t('space_album_folder_delete_confirm', { values: { name: folder.name } }),
  });
  if (!confirmed) {
    return;
  }
  try {
    await deleteSharedSpaceAlbumFolder({ id: space.id, folderId: folder.id });
    // If we were standing inside it, the fallback effect returns us to the root.
    await reload();
  } catch (error) {
    handleError(error, $t('space_album_folder_error_delete'));
  }
}
```

Change `handleCreateAlbum` to place the new album immediately:

```ts
await linkAlbum({ id: space.id, albumId: newAlbum.id, folderId: currentFolderId ?? undefined });
```

and pass `currentFolderId` into `SpaceLinkAlbumModal`, which forwards it on each `linkAlbum` call in its loop:

```ts
await linkAlbum({ id: spaceId, albumId, folderId: folderId ?? undefined });
```

Render the breadcrumb above the controls, only when the space actually has folders:

```svelte
    {#if folders.length > 0}
      <SpaceAlbumFolderBreadcrumb path={folderPath} onNavigate={(id) => void navigateToFolder(id)} />
    {/if}
```

and pass the new props through to `SpaceAlbumsControls` (`onCreateFolder={handleCreateFolder}`) and `SpaceAlbumsList` (`{folders}`, `{currentFolderId}`, `onOpenFolder={(f) => void navigateToFolder(f.id)}`, `onRenameFolder`, `onMoveFolder`, `onDeleteFolder`).

**The empty-state branch must change too.** Today it is `{#if albums.length === 0}`; it must become `{#if albums.length === 0 && folders.length === 0}`, or a space whose albums all live in folders would show "no albums linked yet" and hide the whole tree.

- [ ] **Step 9: Run the tests to verify they pass**

```bash
cd web && pnpm vitest --run src/lib/components/spaces/space-albums-list.spec.ts "src/routes/(user)/spaces/[spaceId]/albums/space-albums-page.spec.ts"
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add web/src i18n/en.json
git commit -m "feat(web): drill into space album folders from the albums tab"
```

---

## Task 11: Web — drag and drop

**Implements:** W-12–W-15, W-19.

**Files:**

- Create: `web/src/lib/utils/space-album-folder-dnd.ts` + `.spec.ts`
- Modify: `web/src/lib/components/spaces/space-album-folder-card.svelte`
- Modify: `web/src/lib/components/spaces/space-album-folder-breadcrumb.svelte`
- Modify: `web/src/lib/components/spaces/space-album-card.svelte`
- Modify: `web/src/routes/(user)/spaces/[spaceId]/albums/+page.svelte`
- Modify: `web/src/routes/(user)/spaces/[spaceId]/albums/space-albums-page.spec.ts`

**Interfaces:**

- Produces:

```ts
export const SPACE_ITEM_MIME = 'application/x-gallery-space-item';
export type DragPayload = { kind: 'album' | 'folder'; id: string };

writeDragPayload(dataTransfer: DataTransfer, payload: DragPayload): void
readDragPayload(dataTransfer: DataTransfer): DragPayload | null
canDrop(folders: SharedSpaceAlbumFolderDto[], albums: SharedSpaceLinkedAlbumDto[], payload: DragPayload, targetFolderId: string | null): boolean
```

- [ ] **Step 1: Write the failing tests**

Create `web/src/lib/utils/space-album-folder-dnd.spec.ts`:

```ts
import { canDrop, readDragPayload, SPACE_ITEM_MIME, writeDragPayload } from '$lib/utils/space-album-folder-dnd';
import type { SharedSpaceAlbumFolderDto, SharedSpaceLinkedAlbumDto } from '@immich/sdk';

const folder = (id: string, name: string, parentId: string | null = null) =>
  ({ id, spaceId: 's', parentId, name, createdById: null, createdAt: '', updatedAt: '' }) as SharedSpaceAlbumFolderDto;
const album = (id: string, folderId: string | null = null) =>
  ({ id, albumName: id, folderId }) as SharedSpaceLinkedAlbumDto;

const folders = [folder('trips', 'Trips'), folder('y2026', '2026', 'trips'), folder('family', 'Family')];
const albums = [album('a1', 'trips'), album('a2')];

const makeDataTransfer = () => {
  const store = new Map<string, string>();
  return {
    setData: (type: string, value: string) => store.set(type, value),
    getData: (type: string) => store.get(type) ?? '',
    types: [...store.keys()],
  } as unknown as DataTransfer;
};

describe('space-album-folder-dnd', () => {
  // The custom MIME type is load-bearing: DragAndDropUploadOverlay watches for FILE drags,
  // and a generic payload would light the upload overlay up mid-drag.
  it('round-trips a payload under the gallery-specific MIME type', () => {
    const dt = makeDataTransfer();

    writeDragPayload(dt, { kind: 'album', id: 'a1' });

    expect(dt.getData(SPACE_ITEM_MIME)).toContain('a1');
    expect(readDragPayload(dt)).toEqual({ kind: 'album', id: 'a1' });
  });

  it('returns null for a drag carrying no gallery payload', () => {
    expect(readDragPayload(makeDataTransfer())).toBeNull();
  });

  it('returns null rather than throwing on a malformed payload', () => {
    const dt = makeDataTransfer();
    dt.setData(SPACE_ITEM_MIME, 'not json');

    expect(readDragPayload(dt)).toBeNull();
  });

  // W-13: a folder cannot be dropped into itself or its own subtree.
  it.each([
    ['itself', 'trips', 'trips'],
    ['its descendant', 'trips', 'y2026'],
  ])('W-13: refuses dropping a folder onto %s', (_label, dragged, target) => {
    expect(canDrop(folders, albums, { kind: 'folder', id: dragged }, target)).toBe(false);
  });

  it('W-13: allows dropping a folder onto an unrelated folder or the root', () => {
    expect(canDrop(folders, albums, { kind: 'folder', id: 'trips' }, 'family')).toBe(true);
    expect(canDrop(folders, albums, { kind: 'folder', id: 'y2026' }, null)).toBe(true);
  });

  // W-14: dropping onto the parent it already has is a no-op, so no request should fire.
  it('W-14: refuses dropping an item onto the folder it already sits in', () => {
    expect(canDrop(folders, albums, { kind: 'album', id: 'a1' }, 'trips')).toBe(false);
    expect(canDrop(folders, albums, { kind: 'album', id: 'a2' }, null)).toBe(false);
    expect(canDrop(folders, albums, { kind: 'folder', id: 'y2026' }, 'trips')).toBe(false);
  });

  it('allows dropping an album into a different folder', () => {
    expect(canDrop(folders, albums, { kind: 'album', id: 'a1' }, 'family')).toBe(true);
    expect(canDrop(folders, albums, { kind: 'album', id: 'a1' }, null)).toBe(true);
  });

  it('refuses an unknown item or an unknown target', () => {
    expect(canDrop(folders, albums, { kind: 'album', id: 'ghost' }, 'trips')).toBe(false);
    expect(canDrop(folders, albums, { kind: 'folder', id: 'trips' }, 'ghost')).toBe(false);
  });
});
```

- [ ] **Step 2: Write the failing page tests**

Append to `space-albums-page.spec.ts`:

```ts
describe('space albums page — drag and drop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // W-12
  it('W-12: dropping an album on a folder calls the move endpoint', async () => {
    await renderPage({ folders: [makeFolder('trips', 'Trips')], albums: [makeAlbum('a1', 'Rome')] });

    await dropOnFolder({ kind: 'album', id: 'a1' }, 'trips');

    expect(setSharedSpaceAlbumFolder).toHaveBeenCalledWith(
      expect.objectContaining({ albumId: 'a1', sharedSpaceAlbumFolderMoveAlbumDto: { folderId: 'trips' } }),
    );
  });

  // W-13 / W-14: an illegal or pointless drop must fire NO request, so the user never sees a
  // spinner followed by an error for something the client already knew was invalid.
  it.each([
    ['W-13', { kind: 'folder', id: 'trips' } as const, 'y2026'],
    ['W-14', { kind: 'album', id: 'a1' } as const, 'trips'],
  ])('%s: fires no request for an invalid drop', async (_id, payload, target) => {
    await renderPage({
      folders: [makeFolder('trips', 'Trips'), makeFolder('y2026', '2026', 'trips')],
      albums: [makeAlbum('a1', 'Rome', 'trips')],
    });

    await dropOnFolder(payload, target);

    expect(setSharedSpaceAlbumFolder).not.toHaveBeenCalled();
    expect(updateSharedSpaceAlbumFolder).not.toHaveBeenCalled();
  });

  // W-15
  it('W-15: rolls the optimistic move back and toasts when the request fails', async () => {
    vi.mocked(setSharedSpaceAlbumFolder).mockRejectedValueOnce(new Error('boom'));
    await renderPage({ folders: [makeFolder('trips', 'Trips')], albums: [makeAlbum('a1', 'Rome')] });

    await dropOnFolder({ kind: 'album', id: 'a1' }, 'trips');

    expect(handleError).toHaveBeenCalled();
    // Rolled back: the album is still at the root, where it started.
    expect(screen.getByText('Rome')).toBeInTheDocument();
  });

  // W-19: the folder was deleted by another editor between our render and this drop. Same
  // failure path as any other rejection — rollback plus toast, then it vanishes on reload.
  it('W-19: handles a drop onto a folder deleted server-side', async () => {
    vi.mocked(setSharedSpaceAlbumFolder).mockRejectedValueOnce(new Error('Folder not found'));
    vi.mocked(getSharedSpaceAlbumFolders).mockResolvedValue([]);
    await renderPage({ folders: [makeFolder('trips', 'Trips')], albums: [makeAlbum('a1', 'Rome')] });

    await dropOnFolder({ kind: 'album', id: 'a1' }, 'trips');

    expect(handleError).toHaveBeenCalled();
    expect(screen.getByText('Rome')).toBeInTheDocument();
  });
});
```

Add a `dropOnFolder(payload, targetFolderId)` helper beside the other page-spec helpers: it builds a fake `DataTransfer`, writes the payload, and fires `dragover` then `drop` on `[data-testid="space-album-folder-card"]` for the target.

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd web && pnpm vitest --run src/lib/utils/space-album-folder-dnd.spec.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement the DnD helper**

Create `web/src/lib/utils/space-album-folder-dnd.ts`:

```ts
import { isDescendant } from '$lib/utils/space-album-folders';
import type { SharedSpaceAlbumFolderDto, SharedSpaceLinkedAlbumDto } from '@immich/sdk';

/**
 * A gallery-specific MIME type, not text/plain. DragAndDropUploadOverlay listens for file
 * drags; a generic payload would open the upload overlay in the middle of a folder drag.
 */
export const SPACE_ITEM_MIME = 'application/x-gallery-space-item';

export type DragPayload = { kind: 'album' | 'folder'; id: string };

export const writeDragPayload = (dataTransfer: DataTransfer, payload: DragPayload): void => {
  dataTransfer.setData(SPACE_ITEM_MIME, JSON.stringify(payload));
};

export const readDragPayload = (dataTransfer: DataTransfer): DragPayload | null => {
  const raw = dataTransfer.getData(SPACE_ITEM_MIME);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as DragPayload;
    return parsed?.id && (parsed.kind === 'album' || parsed.kind === 'folder') ? parsed : null;
  } catch {
    // A foreign drag that happens to claim our MIME type must not throw mid-drop.
    return null;
  }
};

/**
 * Decided entirely client-side, so an illegal drop fires no request at all — the user never
 * sees a spinner followed by an error the client could have predicted.
 */
export const canDrop = (
  folders: SharedSpaceAlbumFolderDto[],
  albums: SharedSpaceLinkedAlbumDto[],
  payload: DragPayload,
  targetFolderId: string | null,
): boolean => {
  if (targetFolderId !== null && !folders.some((f) => f.id === targetFolderId)) {
    return false;
  }

  if (payload.kind === 'album') {
    const album = albums.find((a) => a.id === payload.id);
    return !!album && (album.folderId ?? null) !== targetFolderId;
  }

  const folder = folders.find((f) => f.id === payload.id);
  if (!folder) {
    return false;
  }
  if (folder.id === targetFolderId) {
    return false;
  }
  if ((folder.parentId ?? null) === targetFolderId) {
    return false;
  }
  return !(targetFolderId !== null && isDescendant(folders, targetFolderId, folder.id));
};
```

- [ ] **Step 5: Make the cards draggable and droppable**

In `space-album-card.svelte`, add `draggable={canManage}` and:

```svelte
  ondragstart={(event) => event.dataTransfer && writeDragPayload(event.dataTransfer, { kind: 'album', id: album.id })}
```

In `space-album-folder-card.svelte`, add the same for `{ kind: 'folder', id: folder.id }`, plus the drop handlers:

```svelte
  ondragover={(event) => {
    // A drop only fires if dragover calls preventDefault. Doing it *only* for valid targets
    // is also what makes the cursor show "no drop" on an illegal one.
    if (canAccept(event)) {
      event.preventDefault();
      isDropTarget = true;
    }
  }}
  ondragleave={() => (isDropTarget = false)}
  ondrop={(event) => {
    event.preventDefault();
    isDropTarget = false;
    const payload = event.dataTransfer && readDragPayload(event.dataTransfer);
    if (payload) {
      onDropItem?.(payload, folder.id);
    }
  }}
  class:ring-2={isDropTarget}
```

Add matching handlers to each breadcrumb crumb (target = that crumb's folder id, or `null` for the root crumb). Add `folders`, `albums`, and `onDropItem` props to both components so `canAccept` can call `canDrop`.

- [ ] **Step 6: Wire the optimistic move on the page**

```ts
async function handleDropItem(payload: DragPayload, targetFolderId: string | null) {
  if (!canDrop(folders, albums, payload, targetFolderId)) {
    return;
  }

  if (payload.kind === 'folder') {
    const previous = folders;
    folders = folders.map((f) => (f.id === payload.id ? { ...f, parentId: targetFolderId } : f));
    try {
      await updateSharedSpaceAlbumFolder({
        id: space.id,
        folderId: payload.id,
        sharedSpaceAlbumFolderUpdateDto: { parentId: targetFolderId },
      });
      await reload();
    } catch (error) {
      folders = previous; // rollback
      handleError(error, $t('space_album_folder_error_move'));
      await reload();
    }
    return;
  }

  const previous = albums;
  albums = albums.map((a) => (a.id === payload.id ? { ...a, folderId: targetFolderId } : a));
  try {
    await setSharedSpaceAlbumFolder({
      id: space.id,
      albumId: payload.id,
      sharedSpaceAlbumFolderMoveAlbumDto: { folderId: targetFolderId },
    });
    await reload();
  } catch (error) {
    albums = previous; // rollback
    handleError(error, $t('space_album_folder_error_move'));
    // Reload regardless: a "folder not found" failure means someone else deleted the target,
    // and the stale folder must disappear from the grid (W-19).
    await reload();
  }
}
```

Also route the kebab's "Move to folder…" for albums through `SpaceAlbumFolderPickerModal` with `excludeFolderId: null`, calling the same `setSharedSpaceAlbumFolder` path.

- [ ] **Step 7: Run the tests to verify they pass**

```bash
cd web && pnpm vitest --run src/lib/utils/space-album-folder-dnd.spec.ts "src/routes/(user)/spaces/[spaceId]/albums/space-albums-page.spec.ts"
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add web/src
git commit -m "feat(web): drag albums and folders between space folders"
```

---

## Task 12: e2e RBAC matrix

**Implements:** R-01–R-09 end-to-end.

**Files:**

- Create: `e2e/src/specs/server/api/shared-space-album-folder.e2e-spec.ts`

- [ ] **Step 1: Write the failing e2e spec**

Model the file on the existing `shared-space-album.e2e-spec.ts`, including its header comment documenting the deny codes.

```ts
import { LoginResponseDto, SharedSpaceResponseDto, SharedSpaceRole } from '@immich/sdk';
import { createUserDto } from 'src/fixtures';
import { app, asBearerAuth, utils } from 'src/utils';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

// Space album folder endpoints role matrix.
//
// GET    /shared-spaces/:id/album-folders            — list       (SharedSpaceRead)
// POST   /shared-spaces/:id/album-folders            — create     (SharedSpaceAlbumFolderCreate)
// PATCH  /shared-spaces/:id/album-folders/:folderId  — rename/move(SharedSpaceAlbumFolderUpdate)
// DELETE /shared-spaces/:id/album-folders/:folderId  — delete     (SharedSpaceAlbumFolderDelete)
// PUT    /shared-spaces/:id/albums/:albumId/folder   — place album(SharedSpaceAlbumUpdate)
//
// Every route runs requireRole/requireMembership FIRST, so an unauthorised actor gets 403
// before any payload validation. Validation failures are 400 — this service never throws
// ConflictException; that is reserved for merge-policy's structured cross-owner conflict.

describe('/shared-spaces/:id/album-folders', () => {
  let admin: LoginResponseDto;
  let owner: LoginResponseDto;
  let editor: LoginResponseDto;
  let viewer: LoginResponseDto;
  let stranger: LoginResponseDto;
  let space: SharedSpaceResponseDto;
  let otherSpace: SharedSpaceResponseDto;
  let folderId: string;

  beforeAll(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup();
    [owner, editor, viewer, stranger] = await Promise.all([
      utils.userSetup(admin.accessToken, createUserDto.user1),
      utils.userSetup(admin.accessToken, createUserDto.user2),
      utils.userSetup(admin.accessToken, createUserDto.user3),
      utils.userSetup(admin.accessToken, createUserDto.user4),
    ]);

    space = await utils.createSharedSpace(owner.accessToken, { name: 'Folders' });
    otherSpace = await utils.createSharedSpace(stranger.accessToken, { name: 'Elsewhere' });
    await utils.addSharedSpaceMember(owner.accessToken, space.id, editor.userId, SharedSpaceRole.Editor);
    await utils.addSharedSpaceMember(owner.accessToken, space.id, viewer.userId, SharedSpaceRole.Viewer);

    const { body } = await request(app)
      .post(`/shared-spaces/${space.id}/album-folders`)
      .set('Authorization', asBearerAuth(owner.accessToken))
      .send({ name: 'Trips' });
    folderId = body.id;
  });

  // R-01 / R-02
  it.each([
    ['R-01', 'owner'],
    ['R-02', 'editor'],
  ])('%s: a space %s may create, rename, and delete a folder', async (_id, role) => {
    const token = role === 'owner' ? owner.accessToken : editor.accessToken;

    const created = await request(app)
      .post(`/shared-spaces/${space.id}/album-folders`)
      .set('Authorization', asBearerAuth(token))
      .send({ name: `Scratch-${role}` });
    expect(created.status).toBe(201);

    const renamed = await request(app)
      .patch(`/shared-spaces/${space.id}/album-folders/${created.body.id}`)
      .set('Authorization', asBearerAuth(token))
      .send({ name: `Scratch-${role}-renamed` });
    expect(renamed.status).toBe(204);

    const removed = await request(app)
      .delete(`/shared-spaces/${space.id}/album-folders/${created.body.id}`)
      .set('Authorization', asBearerAuth(token));
    expect(removed.status).toBe(204);
  });

  // R-03 / R-04: every write is refused for a viewer and for a non-member alike.
  it.each([
    ['R-03', 'viewer'],
    ['R-04', 'non-member'],
  ])('%s: a %s is refused every folder write', async (_id, role) => {
    const token = role === 'viewer' ? viewer.accessToken : stranger.accessToken;

    const create = await request(app)
      .post(`/shared-spaces/${space.id}/album-folders`)
      .set('Authorization', asBearerAuth(token))
      .send({ name: 'Nope' });
    expect(create.status).toBe(403);

    const patch = await request(app)
      .patch(`/shared-spaces/${space.id}/album-folders/${folderId}`)
      .set('Authorization', asBearerAuth(token))
      .send({ name: 'Nope' });
    expect(patch.status).toBe(403);

    const del = await request(app)
      .delete(`/shared-spaces/${space.id}/album-folders/${folderId}`)
      .set('Authorization', asBearerAuth(token));
    expect(del.status).toBe(403);
  });

  // R-05
  it('R-05: a viewer may list the folders', async () => {
    const { status, body } = await request(app)
      .get(`/shared-spaces/${space.id}/album-folders`)
      .set('Authorization', asBearerAuth(viewer.accessToken));

    expect(status).toBe(200);
    expect(body.map((f: { id: string }) => f.id)).toContain(folderId);
  });

  // R-06: a folder name is itself information, so a non-member must be refused rather than
  // handed an empty list that confirms the space exists.
  it('R-06: a non-member gets 403, not an empty list', async () => {
    const { status, body } = await request(app)
      .get(`/shared-spaces/${space.id}/album-folders`)
      .set('Authorization', asBearerAuth(stranger.accessToken));

    expect(status).toBe(403);
    expect(body).not.toEqual([]);
  });

  // R-08: the listing is space-scoped — the read-side counterpart to the cross-space write guard.
  it('R-08: the listing contains this space and no other', async () => {
    await request(app)
      .post(`/shared-spaces/${otherSpace.id}/album-folders`)
      .set('Authorization', asBearerAuth(stranger.accessToken))
      .send({ name: 'Secret' });

    const { body } = await request(app)
      .get(`/shared-spaces/${space.id}/album-folders`)
      .set('Authorization', asBearerAuth(owner.accessToken));

    expect(body.every((f: { spaceId: string }) => f.spaceId === space.id)).toBe(true);
    expect(body.map((f: { name: string }) => f.name)).not.toContain('Secret');
  });

  // R-09: the role gate runs BEFORE validation, so an unauthorised actor learns nothing about
  // whether their payload would otherwise have been accepted.
  it('R-09: a viewer sending an invalid payload still gets 403, not 400', async () => {
    const { status } = await request(app)
      .post(`/shared-spaces/${space.id}/album-folders`)
      .set('Authorization', asBearerAuth(viewer.accessToken))
      .send({ name: '', parentId: '00000000-0000-4000-8000-000000000000' });

    expect(status).toBe(403);
  });

  // R-07: space Editor alone is enough — album ownership is deliberately not required.
  it('R-07: an editor may place an album owned by someone else', async () => {
    const album = await utils.createAlbum(owner.accessToken, { albumName: 'Owner Album' });
    await request(app)
      .put(`/shared-spaces/${space.id}/albums/${album.id}`)
      .set('Authorization', asBearerAuth(owner.accessToken));

    const { status } = await request(app)
      .put(`/shared-spaces/${space.id}/albums/${album.id}/folder`)
      .set('Authorization', asBearerAuth(editor.accessToken))
      .send({ folderId });

    expect(status).toBe(204);
  });

  it('rejects a cross-space folder placement with 400', async () => {
    const album = await utils.createAlbum(owner.accessToken, { albumName: 'Cross Space' });
    await request(app)
      .put(`/shared-spaces/${space.id}/albums/${album.id}`)
      .set('Authorization', asBearerAuth(owner.accessToken));

    const { status } = await request(app)
      .put(`/shared-spaces/${space.id}/albums/${album.id}/folder`)
      .set('Authorization', asBearerAuth(owner.accessToken))
      .send({ folderId: '00000000-0000-4000-8000-000000000000' });

    expect(status).toBe(400);
  });
});
```

Adapt `utils.createSharedSpace` / `utils.addSharedSpaceMember` / `utils.createAlbum` to the helper names `e2e/src/utils.ts` actually exports.

- [ ] **Step 2: Run to verify it fails, then passes**

```bash
cd e2e && pnpm test -- --run src/specs/server/api/shared-space-album-folder.e2e-spec.ts
```

Expected: FAIL before the server image is rebuilt with Tasks 1–7, PASS after.

- [ ] **Step 3: Commit**

```bash
git add e2e/src/specs/server/api/shared-space-album-folder.e2e-spec.ts
git commit -m "test(e2e): cover the space album folder role matrix"
```

---

## Task 13: Final gates

- [ ] **Step 1: Run every gate**

```bash
make check-server && make check-web
make lint-server && make lint-web
make format-server && make format-web     # prettier is a SEPARATE CI gate from eslint
cd server && pnpm vitest --run && pnpm test:medium
cd ../web && pnpm vitest --run
cd ../e2e && pnpm test
```

- [ ] **Step 2: Update spec §5.7 with the advisory-lock correction**

Task 4 replaced the spec's proposed `FOR UPDATE`-on-ancestor-chain mitigation with a per-space advisory lock, because the original does not serialise the mutual X→Y / Y→X race. Edit `docs/superpowers/specs/2026-08-04-space-album-folders-design.md` §5.7 to describe what was actually built, then re-run prettier over it.

```bash
npx prettier --write docs/superpowers/specs/2026-08-04-space-album-folders-design.md
git add docs/superpowers/specs
git commit -m "docs: correct the C-01 concurrency mitigation to a per-space advisory lock"
```

- [ ] **Step 3: Confirm nothing leaked to mobile**

```bash
git diff --stat main -- mobile/
```

Expected: **only** `mobile/openapi/` regeneration. Any change under `mobile/lib/` means folder support leaked into a scope this spec explicitly excludes.

---

## Scenario coverage matrix

All 95 spec scenario IDs, and the task that implements each. Verified mechanically:
`grep -oE '\b[FNMDARCXPUWS]-[0-9]{2}\b'` over the spec and over this plan yields identical sets.

| Group                 | IDs                   | Task                                                                            |
| --------------------- | --------------------- | ------------------------------------------------------------------------------- |
| Create                | F-01–F-12             | 3 (F-03/F-04 index behaviour also in 1)                                         |
| Rename                | N-01–N-04             | 3                                                                               |
| Move folder           | M-01–M-09             | 4                                                                               |
| Delete/promote        | D-01–D-06             | 3 (promotion semantics proven in 2 via P-05)                                    |
| Album move            | A-01–A-08             | 5                                                                               |
| Folder-aware link     | A-09, A-10            | 7                                                                               |
| RBAC                  | R-01–R-09             | 6 (controller) + 12 (e2e); R-03/R-06/R-07/R-09 also at service level in 3 and 5 |
| Concurrency           | C-01                  | 4                                                                               |
| Concurrency           | C-02, C-03            | 5                                                                               |
| Cascade               | X-01–X-03             | 1                                                                               |
| Repository primitives | P-01–P-07             | 2                                                                               |
| Web pure module       | U-01–U-11             | 8                                                                               |
| Web components        | W-11, W-17, W-20      | 9                                                                               |
| Web integration       | W-01–W-10, W-16, W-18 | 10                                                                              |
| Web DnD               | W-12–W-15, W-19       | 11                                                                              |
| Sync regression       | S-01                  | 5                                                                               |

**Deviations from the spec, both deliberate:**

1. **§5.7's C-01 mitigation is wrong and is replaced.** `FOR UPDATE` on the moved folder's ancestor chain does not serialise the mutual X→Y / Y→X race — the two transactions lock disjoint rows. Task 4 uses a per-space transaction-scoped advisory lock. Task 13 Step 2 updates the spec.
2. **W-01 and W-08 move from Task 9 to Task 10**, where the list component that renders them is built. Spec §9 assigns both to "component spec and siblings"; the list spec satisfies that.
