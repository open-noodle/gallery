# Space Albums — Phase 1 (Server + Web) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a space Editor/Owner link an album into a shared space so its photos appear in the space timeline and a new in-space Albums section, visible to all members and add/removable by Editors — all by live reference, no copying — for **web** users.

**Architecture:** Mirror the existing `shared_space_library` link feature, but for albums and **without** its admin gate (albums are user-owned). A new `shared_space_album` link table drives: (1) a **read** branch added to the per-asset space-access predicates, (2) a **write** branch (`checkSpaceLinkedAlbumAccess`) wired into `AlbumAssetCreate`/`AlbumAssetDelete`, (3) a **timeline** branch in the asset time-bucket query gated on `showInTimeline`, and (4) an album **face-sync** job. No sync subsystem, no grant table, no mobile (those are Phase 2). Phase 1 is purely additive and reverts cleanly.

**Tech Stack:** NestJS 11 + Kysely (server), Zod DTOs, BullMQ jobs, Vitest unit + medium (testcontainers Postgres/vchord) + Playwright/Vitest e2e, SvelteKit + Svelte 5 (web), `@immich/sdk` (generated).

**Spec:** `docs/superpowers/specs/2026-06-09-space-albums-design.md`. This plan implements **Phase 1 only**. Phase 2 (offline sync + mobile: `shared_space_album_user` grant table, triggers, `SharedSpaceAlbum*V1` sync entity types, Drift, mobile UI) gets its own plan after this lands and a mobile consult.

**Branch:** `feat/space-albums` (already created on the rolling tip; this plan's tasks add commits on top).

---

## TDD discipline for this plan

The **permission matrix (Grids 1–7 in the spec)** is the load-bearing correctness contract. Per the spec it is written **test-first**. In this plan that contract lives in one authoritative parameterized medium spec, `server/test/medium/specs/shared-space-album-permissions.spec.ts`, which is **accreted grid-by-grid as the RED step of the task that implements that capability** (Grid 1 read → Task 4, Grid 2 write → Task 5, Grid 3 link → Task 6, Grid 4 unlink/toggle → Tasks 7–8, Grids 5/7 → Task 11) and **consolidated with the cross-layer set-equality guard in Task 12**. Every capability task: write its grid cells → run → confirm RED for the right reason → implement minimal code → GREEN → commit. No production code before a failing test.

> **Deviation note (intentional):** the spec says the matrix file is written "FIRST" as one file. Writing all 7 grids before any code would produce a spec referencing dozens of not-yet-existing methods (one giant compile failure, so "fails for the right reason" is meaningless per cell). Instead each grid is RED-before-green within its capability task, in the same file, and Task 12 consolidates + adds the set-equality guard. Same contract, meaningful RED at every step.

## Phase 1 deviation from the design spec (schema scope)

The spec's data model lists a companion `shared_space_album_audit` table "created in Phase 1 for schema stability." This plan **defers the audit table to Phase 2**, where its writer (the delete-side fan-out trigger) and reader (`shared_space_album_user` consumer) actually live. Rationale: an audit table with no writer/reader is dead schema; creating it next to its trigger in Phase 2 keeps each migration self-contained and reversible (YAGNI). Phase 1 creates only the `shared_space_album` link table.

## File map (Phase 1)

**Create:**

- `server/src/schema/tables/shared-space-album.table.ts` — the link table decorator
- `server/src/schema/migrations-gallery/1775300000000-AddSharedSpaceAlbumTable.ts` — migration
- `server/test/medium/specs/shared-space-album-permissions.spec.ts` — authoritative permission matrix (Grids 1–7)
- `server/test/medium/specs/shared-space-album.spec.ts` — repo/service/timeline/face medium tests
- `web/src/lib/components/spaces/space-linked-albums.svelte` — link/unlink/toggle management UI
- `web/src/lib/components/spaces/space-albums-section.svelte` — in-space Albums grid (members browse)
- `web/src/lib/components/spaces/space-linked-albums.spec.ts` — web component test

**Modify:**

- `server/src/schema/index.ts` — register the new table
- `server/src/enum.ts` — `Permission.SharedSpaceAlbumCreate/Delete/Update`; `JobName.SharedSpaceAlbumFaceSync`
- `server/src/dtos/shared-space.dto.ts` — link/update/response DTOs + `linkedAlbums` on the space response (optional)
- `server/src/repositories/shared-space.repository.ts` — album link CRUD + `getAlbumAssetIdsWithoutOtherSpacePath`
- `server/src/repositories/access.repository.ts` — `shared_space_album` read branch (×2) + `AlbumAccess.checkSpaceLinkedAlbumAccess`
- `server/src/utils/access.ts` — wire `checkSpaceLinkedAlbumAccess` into `AlbumAssetCreate`/`AlbumAssetDelete`
- `server/src/repositories/asset.repository.ts` — `shared_space_album` timeline branch (×2) + `getByAlbumIdWithFaces`
- `server/src/services/shared-space.service.ts` — `linkAlbum`/`unlinkAlbum`/`updateAlbumLink`/`getLinkedAlbums` + `handleSharedSpaceAlbumFaceSync`
- `server/src/controllers/shared-space.controller.ts` — `PUT/PATCH/DELETE/GET /shared-spaces/:id/albums`
- `e2e/src/specs/server/api/shared-space.e2e-spec.ts` (or new `shared-space-album.e2e-spec.ts`) — API role matrix
- `web/src/lib/components/spaces/space-panel.svelte` (or the spaces `+page.svelte`) — surface the Albums section/modal
- `open-api/**` + `mobile/openapi/**` — regenerated clients (Task 13)

---

## Reference snippets (real current code being mirrored)

Keep these open while implementing — every new method mirrors one of these.

**Link table to mirror** — `server/src/schema/tables/shared-space-library.table.ts` (drop the two Phase-2 triggers `@AfterInsertTrigger`/`@AfterDeleteTrigger`; keep `@UpdatedAtTrigger`, columns, `createId`/`updateId`):

```ts
@Table('shared_space_library')
@UpdatedAtTrigger('shared_space_library_updatedAt')
export class SharedSpaceLibraryTable {
  @ForeignKeyColumn(() => SharedSpaceTable, { onDelete: 'CASCADE', primary: true, index: false })
  spaceId!: string;
  @ForeignKeyColumn(() => LibraryTable, { onDelete: 'CASCADE', primary: true })
  libraryId!: string;
  @ForeignKeyColumn(() => UserTable, { onDelete: 'SET NULL', nullable: true })
  addedById!: string | null;
  @CreateDateColumn() createdAt!: Generated<Timestamp>;
  @UpdateDateColumn() updatedAt!: Generated<Timestamp>;
  @CreateIdColumn({ index: true }) createId!: Generated<string>;
  @UpdateIdColumn({ index: true }) updateId!: Generated<string>;
}
```

**Read predicate branch to mirror** — `access.repository.ts` `checkSpaceAccess` (the `shared_space_library` `.union(...)` at ~246–261) and `checkSpaceAccessForSpace` (~301–317).

**Write cases to extend** — `utils/access.ts` `AlbumAssetCreate` (191–199) and `AlbumAssetDelete` (235–243).

**Service link method to mirror** — `shared-space.service.ts` `linkLibrary` (602–630) and `unlinkLibrary` (632–643); `requireRole` (2533–2539).

**Repo link CRUD to mirror** — `shared-space.repository.ts` `addLibrary`/`removeLibrary`/`getLinkedLibraries`/`hasLibraryLink` (345–388); face cleanup `removePersonFacesByAssetIds` (1761) / `deleteOrphanedPersons` (1824).

**Timeline branches to mirror** — `asset.repository.ts` getTimeBuckets (334–352) and getTimeBucket (1337–1355) `eb.exists(... shared_space_library ...)`.

**Face job to mirror** — `shared-space.service.ts` `handleSharedSpaceLibraryFaceSync` (1617–1665); asset query `getByLibraryIdWithFaces` (846–859).

---

## Task 1: `shared_space_album` link table + migration

**Files:**

- Create: `server/src/schema/tables/shared-space-album.table.ts`
- Create: `server/src/schema/migrations-gallery/1775300000000-AddSharedSpaceAlbumTable.ts`
- Modify: `server/src/schema/index.ts` (register table import, mirroring line 83 `SharedSpaceLibraryTable`)

- [ ] **Step 1: Write the table decorator**

`server/src/schema/tables/shared-space-album.table.ts`:

```ts
import {
  Column,
  CreateDateColumn,
  ForeignKeyColumn,
  Generated,
  Table,
  Timestamp,
  UpdateDateColumn,
} from '@immich/sql-tools';
import { CreateIdColumn, UpdatedAtTrigger, UpdateIdColumn } from 'src/decorators';
import { AlbumTable } from 'src/schema/tables/album.table';
import { SharedSpaceTable } from 'src/schema/tables/shared-space.table';
import { UserTable } from 'src/schema/tables/user.table';

@Table('shared_space_album')
@UpdatedAtTrigger('shared_space_album_updatedAt')
export class SharedSpaceAlbumTable {
  @ForeignKeyColumn(() => SharedSpaceTable, { onDelete: 'CASCADE', primary: true, index: false })
  spaceId!: string;

  @ForeignKeyColumn(() => AlbumTable, { onDelete: 'CASCADE', primary: true })
  albumId!: string;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'SET NULL', nullable: true })
  addedById!: string | null;

  // Whether this album's photos appear in the aggregated space timeline.
  @Column({ type: 'boolean', default: true })
  showInTimeline!: Generated<boolean>;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @UpdateDateColumn()
  updatedAt!: Generated<Timestamp>;

  @CreateIdColumn({ index: true })
  createId!: Generated<string>;

  @UpdateIdColumn({ index: true })
  updateId!: Generated<string>;
}
```

> Decorator form verified against `shared-space-member.table.ts:74` (`@Column({ type: 'boolean', default: true }) showInTimeline!: Generated<boolean>;`) — exact match.

- [ ] **Step 2: Register the table in `server/src/schema/index.ts` — THREE edits.** `SharedSpaceLibraryTable` appears in three places; the new table must mirror all three or downstream code won't type-check.

1. **Import** (alphabetically near line 83):

```ts
import { SharedSpaceAlbumTable } from 'src/schema/tables/shared-space-album.table';
```

2. **Tables array** (the schema's table list, near line 171 where `SharedSpaceLibraryTable,` is listed) — add `SharedSpaceAlbumTable,`.

3. **Kysely `DB` interface map** (near line 310 where `shared_space_library: SharedSpaceLibraryTable;` is declared) — add:

```ts
shared_space_album: SharedSpaceAlbumTable;
```

> ⚠️ Edit 3 is **load-bearing**: without it the `DB` type has no `shared_space_album` key, so every `selectFrom('shared_space_album')` in Tasks 3–10 fails to compile. Verify with `grep -n "SharedSpaceLibraryTable\|shared_space_library:" server/src/schema/index.ts` → mirror each hit.

- [ ] **Step 3: Write the migration** `server/src/schema/migrations-gallery/1775300000000-AddSharedSpaceAlbumTable.ts` (mirrors `1774215658876-AddSharedSpaceLibraryTable.ts` + the sync-columns/trigger/override pattern from `1778210000000-AddLibrarySyncColumns.ts`):

```ts
import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE TABLE "shared_space_album" (
  "spaceId" uuid NOT NULL,
  "albumId" uuid NOT NULL,
  "addedById" uuid,
  "showInTimeline" boolean NOT NULL DEFAULT true,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "createId" uuid NOT NULL DEFAULT immich_uuid_v7(),
  "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
  CONSTRAINT "shared_space_album_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "shared_space" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "shared_space_album_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "album" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "shared_space_album_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "user" ("id") ON UPDATE NO ACTION ON DELETE SET NULL,
  CONSTRAINT "shared_space_album_pkey" PRIMARY KEY ("spaceId", "albumId")
);`.execute(db);
  await sql`CREATE INDEX "shared_space_album_albumId_idx" ON "shared_space_album" ("albumId");`.execute(db);
  await sql`CREATE INDEX "shared_space_album_addedById_idx" ON "shared_space_album" ("addedById");`.execute(db);
  await sql`CREATE INDEX "shared_space_album_createId_idx" ON "shared_space_album" ("createId");`.execute(db);
  await sql`CREATE INDEX "shared_space_album_updateId_idx" ON "shared_space_album" ("updateId");`.execute(db);

  await sql`CREATE OR REPLACE TRIGGER "shared_space_album_updatedAt"
  BEFORE UPDATE ON "shared_space_album"
  FOR EACH ROW
  EXECUTE FUNCTION updated_at();`.execute(db);

  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_shared_space_album_updatedAt', '{"type":"trigger","name":"shared_space_album_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"shared_space_album_updatedAt\\"\\n  BEFORE UPDATE ON \\"shared_space_album\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_shared_space_album_updatedAt';`.execute(db);
  await sql`DROP TRIGGER IF EXISTS "shared_space_album_updatedAt" ON "shared_space_album";`.execute(db);
  await sql`DROP TABLE "shared_space_album";`.execute(db);
}
```

- [ ] **Step 4: Verify the schema decorator ↔ migration parity** (the CI `sql` gate). Build, then run the schema diff:

Run:

```bash
cd server && pnpm build && pnpm sync:sql 2>&1 | tail -20   # or: make sql  (from repo root)
git diff --stat
```

Expected: the generated SQL docs reflect the new table and **no unexpected drift** (if `make sql` rewrites files, commit those too). If the diff shows the decorator and migration disagree (e.g. a missing index or the trigger), fix the decorator/migration to match. The `migration_overrides` row for the `updatedAt` trigger is what keeps the trigger from showing as drift — confirm none reported.

- [ ] **Step 5: Verify the migration applies + reverts on a real DB.**

Run:

```bash
cd server && pnpm test:medium -- --run test/medium/specs/shared-space-album.spec.ts 2>&1 | tail -5 || true
```

(The spec file doesn't exist yet — this step just confirms the harness picks up the new migration once Task 3 adds the spec. For now, confirm `pnpm build` is clean: `cd server && pnpm exec tsc --noEmit` → no errors.)

- [ ] **Step 6: Commit**

```bash
git add server/src/schema/tables/shared-space-album.table.ts \
        server/src/schema/migrations-gallery/1775300000000-AddSharedSpaceAlbumTable.ts \
        server/src/schema/index.ts server/src/schema/  # include any make sql output
git commit -m "feat(server): add shared_space_album link table (space albums phase 1)"
```

---

## Task 2: Permissions + DTOs

**Files:**

- Modify: `server/src/enum.ts` (Permission enum near line 255–256; JobName enum near line 983)
- Modify: `server/src/dtos/shared-space.dto.ts`

- [ ] **Step 1: Add permissions + job name to `server/src/enum.ts`.** After `SharedSpaceLibraryDelete = 'sharedSpaceLibrary.delete',` (line 256):

```ts
  SharedSpaceAlbumCreate = 'sharedSpaceAlbum.create',
  SharedSpaceAlbumUpdate = 'sharedSpaceAlbum.update',
  SharedSpaceAlbumDelete = 'sharedSpaceAlbum.delete',
```

In the `JobName` enum, after `SharedSpaceLibraryFaceSync = 'SharedSpaceLibraryFaceSync',` (line ~983):

```ts
  SharedSpaceAlbumFaceSync = 'SharedSpaceAlbumFaceSync',
```

> **Verified:** `Permission.SharedSpaceLibraryCreate` is referenced **only** in `enum.ts` (definition) and `shared-space.controller.ts` — there is **no** separate "all permissions" grant list or API-key scope catalog to update. Adding the three enum values is sufficient. (Confirm with `grep -rln "SharedSpaceLibraryCreate" server/src | grep -v spec` → expect only those two files.)

- [ ] **Step 2: Wire the job-data type.** The `JobOf<JobName.SharedSpaceAlbumFaceSync>` type must resolve to `{ spaceId: string; albumId: string }`. Find the job-data interface map and the queue registration with `grep -rln "SharedSpaceLibraryFaceSync" server/src | grep -v spec` (the library job declares `SharedSpaceLibraryFaceSync: { spaceId: string; libraryId: string }`). Add `SharedSpaceAlbumFaceSync: { spaceId: string; albumId: string }` in the **same** interface, and register the job in the **same** queue/concurrency map as the library face-sync job. Type-check after (`pnpm exec tsc --noEmit`) — a missing entry surfaces as a `JobOf` resolution error in Task 9.

- [ ] **Step 3: Add DTOs to `server/src/dtos/shared-space.dto.ts`.** Only the **update** and **response** DTOs are needed — the link endpoint takes `albumId` from the **path** (per the spec's API surface `PUT /shared-spaces/:id/albums/:albumId`), so there is no link body DTO. After `SharedSpaceLibraryLinkSchema` (124–128):

```ts
const SharedSpaceAlbumLinkUpdateSchema = z
  .object({
    showInTimeline: z.boolean().describe('Include this album in the space timeline'),
  })
  .meta({ id: 'SharedSpaceAlbumLinkUpdateDto' });

const SharedSpaceLinkedAlbumSchema = z
  .object({
    albumId: z.string(),
    albumName: z.string(),
    addedById: z.string().nullable(),
    showInTimeline: z.boolean(),
    assetCount: z.number(),
    albumThumbnailAssetId: z.string().nullable(),
    createdAt: z.string().meta({ format: 'date-time' }).describe('Link creation timestamp'),
  })
  .meta({ id: 'SharedSpaceLinkedAlbumDto' });
```

At the bottom export block (near 177):

```ts
export class SharedSpaceAlbumLinkUpdateDto extends createZodDto(SharedSpaceAlbumLinkUpdateSchema) {}
export class SharedSpaceLinkedAlbumDto extends createZodDto(SharedSpaceLinkedAlbumSchema) {}
```

- [ ] **Step 4: Type-check.** Run: `cd server && pnpm exec tsc --noEmit` → Expected: PASS (DTOs unused yet is fine; enum additions compile).

- [ ] **Step 5: Commit**

```bash
git add server/src/enum.ts server/src/dtos/shared-space.dto.ts
git commit -m "feat(server): space-album permissions, job name, and DTOs"
```

---

## Task 3: Repository — album link CRUD

**Files:**

- Modify: `server/src/repositories/shared-space.repository.ts` (after the Library Link CRUD block, ~388)
- Test: `server/test/medium/specs/shared-space-album.spec.ts` (new)

- [ ] **Step 1: Write the failing medium test** `server/test/medium/specs/shared-space-album.spec.ts`. Use the medium factory + context helpers (mirror `test/medium/specs/sync/library-sync-created-after.spec.ts`: `ctx.newUser`, `ctx.newSharedSpace`, `ctx.newSharedSpaceMember`, `ctx.newAlbum` — confirm an album helper exists; if not, insert via the repo). Register `SharedSpaceRepository` in the test context.

```ts
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { MediumTestContext, newMediumService } from 'test/medium.factory'; // match the file's existing imports
import { beforeAll, describe, expect, it } from 'vitest';

// follow the existing medium spec bootstrapping in this repo (testcontainers DB).
describe('SharedSpaceRepository — album links', () => {
  // ctx setup mirrors library-sync-created-after.spec.ts

  it('addAlbum inserts a link and is idempotent on (spaceId, albumId)', async () => {
    const { space, album } = await seedSpaceAndAlbum(); // helper defined in this file
    const repo = ctx.get(SharedSpaceRepository);

    const first = await repo.addAlbum({ spaceId: space.id, albumId: album.id, addedById: space.createdById });
    expect(first).toBeDefined();

    const second = await repo.addAlbum({ spaceId: space.id, albumId: album.id, addedById: space.createdById });
    expect(second).toBeUndefined(); // onConflict doNothing → returningAll yields no row

    const links = await repo.getLinkedAlbums(space.id);
    expect(links).toHaveLength(1);
    expect(links[0].showInTimeline).toBe(true);
  });

  it('hasAlbumLink reflects presence; removeAlbum deletes it', async () => {
    const { space, album } = await seedSpaceAndAlbum();
    const repo = ctx.get(SharedSpaceRepository);
    await repo.addAlbum({ spaceId: space.id, albumId: album.id, addedById: null });
    expect(await repo.hasAlbumLink(space.id, album.id)).toBe(true);
    await repo.removeAlbum(space.id, album.id);
    expect(await repo.hasAlbumLink(space.id, album.id)).toBe(false);
  });

  it('setAlbumShowInTimeline toggles the flag', async () => {
    const { space, album } = await seedSpaceAndAlbum();
    const repo = ctx.get(SharedSpaceRepository);
    await repo.addAlbum({ spaceId: space.id, albumId: album.id, addedById: null });
    await repo.setAlbumShowInTimeline(space.id, album.id, false);
    const [link] = await repo.getLinkedAlbums(space.id);
    expect(link.showInTimeline).toBe(false);
  });
});
```

- [ ] **Step 2: Run → confirm RED.** Run: `cd server && pnpm test:medium -- --run test/medium/specs/shared-space-album.spec.ts` → Expected: FAIL (`repo.addAlbum is not a function`).

- [ ] **Step 3: Implement the repo methods** in `shared-space.repository.ts` after `hasLibraryLink` (388). Mirror the library CRUD verbatim:

```ts
  // ==========================================
  // Shared Space Album Link CRUD
  // ==========================================

  addAlbum(values: Insertable<SharedSpaceAlbumTable>) {
    return this.db
      .insertInto('shared_space_album')
      .values(values)
      .onConflict((oc) => oc.doNothing())
      .returningAll()
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  removeAlbum(spaceId: string, albumId: string) {
    return this.db
      .deleteFrom('shared_space_album')
      .where('spaceId', '=', spaceId)
      .where('albumId', '=', albumId)
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getLinkedAlbums(spaceId: string) {
    return this.db
      .selectFrom('shared_space_album')
      .innerJoin('album', 'album.id', 'shared_space_album.albumId')
      .select([
        'shared_space_album.albumId',
        'shared_space_album.addedById',
        'shared_space_album.showInTimeline',
        'shared_space_album.createdAt',
        'album.albumName',
        'album.albumThumbnailAssetId',
      ])
      .where('shared_space_album.spaceId', '=', spaceId)
      .where('album.deletedAt', 'is', null)
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getSpacesLinkedToAlbum(albumId: string) {
    return this.db
      .selectFrom('shared_space_album')
      .innerJoin('shared_space', 'shared_space.id', 'shared_space_album.spaceId')
      .selectAll('shared_space_album')
      .select('shared_space.faceRecognitionEnabled')
      .where('shared_space_album.albumId', '=', albumId)
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  hasAlbumLink(spaceId: string, albumId: string) {
    return this.db
      .selectFrom('shared_space_album')
      .where('spaceId', '=', spaceId)
      .where('albumId', '=', albumId)
      .select('spaceId')
      .executeTakeFirst()
      .then((row) => !!row);
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID, true] })
  setAlbumShowInTimeline(spaceId: string, albumId: string, showInTimeline: boolean) {
    return this.db
      .updateTable('shared_space_album')
      .set({ showInTimeline })
      .where('spaceId', '=', spaceId)
      .where('albumId', '=', albumId)
      .execute();
  }
```

Add `import { SharedSpaceAlbumTable } from 'src/schema/tables/shared-space-album.table';` near the top (mirror the existing `SharedSpaceLibraryTable` import at line 11).

> `album.albumName` / `album.albumThumbnailAssetId` — verify these exact column names against `album.table.ts`. Adjust the `select` if they differ.

- [ ] **Step 4: Run → GREEN.** Run: `cd server && pnpm test:medium -- --run test/medium/specs/shared-space-album.spec.ts` → Expected: PASS. Also `pnpm exec tsc --noEmit` → PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/repositories/shared-space.repository.ts server/test/medium/specs/shared-space-album.spec.ts
git commit -m "feat(server): shared_space_album link CRUD repo methods"
```

---

## Task 4: READ access predicate (Grid 1 + Grid 6 read cells)

A space member can read an album-linked asset. Add a `shared_space_album` `.union(...)` branch (joining through `album_asset`) to **both** `checkSpaceAccess` (gates `AssetRead`/`AssetView`/`AssetDownload` per `utils/access.ts` 116–154) and `checkSpaceAccessForSpace`.

**Files:**

- Test: `server/test/medium/specs/shared-space-album-permissions.spec.ts` (new — **authoritative matrix**, Grid 1 first)
- Modify: `server/src/repositories/access.repository.ts` (`checkSpaceAccess` ~246; `checkSpaceAccessForSpace` ~301)

- [ ] **Step 1: Scaffold the matrix spec + the fixture world, then write Grid 1 (READ) cells as failing tests.** Create `server/test/medium/specs/shared-space-album-permissions.spec.ts`. In `beforeAll`, bootstrap with `SharedSpaceService` as the **primary** service: `const { sut: svc, ctx } = newMediumService(SharedSpaceService, { ... })` (model: `server/test/medium/specs/repositories/shared-space-face-matching.spec.ts`, which uses `newMediumService(BaseService, {...})` then `ctx.get(...)`). `svc` (the `sut`) gives `linkAlbum`/`unlinkAlbum`/`updateAlbumLink`; `ctx.get(AccessRepository)` / `ctx.get(SharedSpaceRepository)` give the repos. Build the spec's fixture world once: space `S` links album `A`; space `S2` links album `C`; album `B` linked to nothing; actors `spaceOwner`, `spaceEditor` (**non-admin**), `spaceViewer`, `nonMember`, `albumOwner`, `albumEditor` (album_user editor), `albumViewer` (album_user viewer), `crossEditor` (Editor of `S2`, owns `B`), `admin`; plus albums `ownedByOwner`/`ownedByEditor`/`ownedByViewer`/`viewerOnlyAlbum` for Grid 3. Each album has ≥1 asset. Provide module-scope `svc`, `ctx`, `world`, and helpers `authOf(actor)` (→ `AuthDto`) + seed accessors on `world`.

```ts
import { Permission } from 'src/enum';
import { AccessRepository } from 'src/repositories/access.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { SharedSpaceService } from 'src/services/shared-space.service';
import { checkAccess } from 'src/utils/access';
import { newMediumService } from 'test/medium.factory';
import { beforeAll, describe, expect, it } from 'vitest';

describe('Space albums — permission matrix (Grids 1–7)', () => {
  // world: built in beforeAll → { S, S2, A, B, C, assetInA, actors{...} }

  describe('Grid 1 — READ asset in album A linked to space S (full AssetRead authorization)', () => {
    // checkAccess is the real entrypoint backing BaseService.requireAccess — it unions
    // ownership ∪ album_user ∪ partner ∪ space (asset/library/NEW album) paths, so it gives
    // the TRUE allow/deny for every actor, including the album-path actors.
    it.each([
      ['spaceOwner', true], // space membership → A linked to S
      ['spaceEditor', true], // space membership
      ['spaceViewer', true], // space membership (the absorbed read)
      ['nonMember', false], // no path
      ['albumOwner', true], // album ownership (independent of S)
      ['albumEditor', true], // manual album_user editor (independent)
      ['albumViewer', true], // manual album_user viewer (independent)
      ['crossEditor', false], // edits S2; A not linked to S2
    ])('%s read A.asset → allowed=%s', async (actor, allowed) => {
      const allowedIds = await checkAccess(ctx.get(AccessRepository), {
        auth: authOf(actor),
        permission: Permission.AssetRead,
        ids: new Set([world.assetInA]),
      });
      expect(allowedIds.has(world.assetInA)).toBe(allowed);
    });

    // Supplementary raw-predicate assertion: the NEW space-album branch in isolation
    // (proves the branch — not just an album_user path — grants the space actors).
    it('checkSpaceAccess (space-album branch) grants space members, denies non/cross', async () => {
      const access = ctx.get(AccessRepository);
      for (const [actor, expected] of [
        ['spaceOwner', true],
        ['spaceEditor', true],
        ['spaceViewer', true],
        ['nonMember', false],
        ['crossEditor', false],
      ] as const) {
        const r = await access.asset.checkSpaceAccess(world.actors[actor].id, new Set([world.assetInA]));
        expect(r.has(world.assetInA)).toBe(expected);
      }
    });
  });
});
```

> Import `checkAccess` from `src/utils/access` and `Permission` from `src/enum`. `checkAccess(repos, { auth, permission, ids })` returns the allowed `Set<string>` (it's what `requireAccess` calls before throwing). `authOf(actor)` builds an `AuthDto` for the fixture user. This authorization-level assertion is the authoritative contract; the raw-predicate `it` is a supplement that pins the new branch specifically.

- [ ] **Step 2: Run → confirm RED.** Run: `cd server && pnpm test:medium -- --run test/medium/specs/shared-space-album-permissions.spec.ts` → Expected: FAIL (space members denied — no album branch yet; `spaceOwner read A.asset` returns `allowed=false`).

- [ ] **Step 3: Add the album branch to `checkSpaceAccess`** in `access.repository.ts`. Inside the `.union(...)` chain (after the existing `shared_space_library` union, before `.as('combined')` at ~262), add a second `.union(...)`:

```ts
          .union(
            this.db
              .selectFrom('shared_space_album')
              .innerJoin('shared_space_member', 'shared_space_member.spaceId', 'shared_space_album.spaceId')
              .innerJoin('album_asset', 'album_asset.albumId', 'shared_space_album.albumId')
              .innerJoin('asset', (join) =>
                join.onRef('asset.id', '=', 'album_asset.assetId').on('asset.deletedAt', 'is', null),
              )
              .select(['asset.id', 'asset.livePhotoVideoId'])
              .where('shared_space_member.userId', '=', userId)
              .where((eb) =>
                eb.or([eb('asset.id', 'in', [...assetIds]), eb('asset.livePhotoVideoId', 'in', [...assetIds])]),
              ),
          )
```

- [ ] **Step 4: Add the same branch to `checkSpaceAccessForSpace`** (scoped variant, ~317), adding `.where('shared_space_album.spaceId', '=', spaceId)` like the library branch does.

- [ ] **Step 5: Run → GREEN.** Run: `cd server && pnpm test:medium -- --run test/medium/specs/shared-space-album-permissions.spec.ts` → Expected: PASS for all Grid 1 space-actor cells.

- [ ] **Step 6: Add Grid 6 (multi-path read) cells** to the same describe block and confirm they pass with no extra code:

```ts
describe('Grid 6 — multi-path read holds; unlink one path keeps others', () => {
  it('asset in A AND direct-added to S stays readable after unlink A', async () => {
    // seed assetX in album A and shared_space_asset(S, assetX)
    // unlink A from S → checkSpaceAccess still returns assetX (direct path)
  });
  it('A linked to S and S2; member of only S → readable; unlink from S → still readable iff in S2', async () => {
    /* ... */
  });
});
```

Run the spec → Expected: PASS.

- [ ] **Step 7: Regenerate SQL docs** (the `@GenerateSql` decorators changed query shape only on existing methods — no new decorated method here, but run to be safe): `cd server && pnpm build && make -C .. sql 2>&1 | tail -3 || (cd .. && make sql)`. Commit any doc churn.

- [ ] **Step 8: Commit**

```bash
git add server/src/repositories/access.repository.ts \
        server/test/medium/specs/shared-space-album-permissions.spec.ts server/src
git commit -m "feat(server): space-album read access predicate + Grid 1/6 read matrix"
```

---

## Task 5: WRITE access predicate (Grid 2 + Grid 6 write cell)

Space Editors/Owners may add/remove assets in a linked album. Add `AlbumAccess.checkSpaceLinkedAlbumAccess` and union it into `AlbumAssetCreate`/`AlbumAssetDelete`.

**Files:**

- Modify: `server/src/repositories/access.repository.ts` (`AlbumAccess` class, after `checkSharedAlbumAccess` ~117)
- Modify: `server/src/utils/access.ts` (`AlbumAssetCreate` 191–199; `AlbumAssetDelete` 235–243)
- Test: `server/test/medium/specs/shared-space-album-permissions.spec.ts` (Grid 2)

- [ ] **Step 1: Write Grid 2 (WRITE) cells.** In the matrix spec, drive the write predicate directly via the access repo, then the full union via `requireAccess`:

```ts
describe('Grid 2 — WRITE add/remove assets in album A (space-linked write)', () => {
  it.each([
    ['spaceOwner', true],
    ['spaceEditor', true],
    ['spaceViewer', false], // THE key constraint
    ['nonMember', false],
    ['crossEditor', false], // edits S2; A not linked there
  ])('%s space-linked write to A → allowed=%s', async (actor, allowed) => {
    const access = ctx.get(AccessRepository);
    const result = await access.album.checkSpaceLinkedAlbumAccess(world.actors[actor].id, new Set([world.A]));
    expect(result.has(world.A)).toBe(allowed);
  });

  it('spaceEditor cannot write to unlinked album B (bounded to linked albums)', async () => {
    const access = ctx.get(AccessRepository);
    const result = await access.album.checkSpaceLinkedAlbumAccess(world.actors.spaceEditor.id, new Set([world.B]));
    expect(result.has(world.B)).toBe(false);
  });
});
```

- [ ] **Step 2: Run → confirm RED.** Run the spec → Expected: FAIL (`access.album.checkSpaceLinkedAlbumAccess is not a function`).

- [ ] **Step 3: Implement `checkSpaceLinkedAlbumAccess`** in `AlbumAccess` (after `checkSharedAlbumAccess`, ~117). Mirror `checkOwnerAccess`'s shape:

```ts
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID_SET] })
  @ChunkedSet({ paramIndex: 1 })
  async checkSpaceLinkedAlbumAccess(userId: string, albumIds: Set<string>) {
    if (albumIds.size === 0) {
      return new Set<string>();
    }

    return this.db
      .selectFrom('album')
      .select('album.id')
      .innerJoin('shared_space_album', 'shared_space_album.albumId', 'album.id')
      .innerJoin('shared_space_member', 'shared_space_member.spaceId', 'shared_space_album.spaceId')
      .where('album.id', 'in', [...albumIds])
      .where('album.deletedAt', 'is', null)
      .where('shared_space_member.userId', '=', userId)
      .where('shared_space_member.role', 'in', [SharedSpaceRole.Owner, SharedSpaceRole.Editor])
      .execute()
      .then((albums) => new Set(albums.map((album) => album.id)));
  }
```

Confirm `SharedSpaceRole` is imported in `access.repository.ts` (add `import { ... SharedSpaceRole } from 'src/enum';` if missing).

- [ ] **Step 4: Wire it into `utils/access.ts`.** Replace the `AlbumAssetCreate` case (191–199) so it unions the space grant:

```ts
    case Permission.AlbumAssetCreate: {
      const isOwner = await access.album.checkOwnerAccess(auth.user.id, ids);
      const isShared = await access.album.checkSharedAlbumAccess(
        auth.user.id,
        setDifference(ids, isOwner),
        AlbumUserRole.Editor,
      );
      const granted = setUnion(isOwner, isShared);
      const isSpaceLinked = await access.album.checkSpaceLinkedAlbumAccess(
        auth.user.id,
        setDifference(ids, granted),
      );
      return setUnion(granted, isSpaceLinked);
    }
```

Apply the identical change to `AlbumAssetDelete` (235–243).

- [ ] **Step 5: Run → GREEN.** Run the matrix spec → Expected: PASS (Grid 2). `pnpm exec tsc --noEmit` → PASS.

- [ ] **Step 6: Add Grid 6 write-wins cell** (`albumEditor` who is also `spaceViewer` → WRITE ALLOW via the album-editor path; space-viewer doesn't subtract):

```ts
it('actor that is album_user-editor AND spaceViewer can write (album path wins)', async () => {
  // requireAccess(AlbumAssetCreate) for that actor on A → granted (album-editor branch)
});
```

Assert via the access util/`requireAccess` (the union includes `checkSharedAlbumAccess`). Run → PASS.

- [ ] **Step 7: Regenerate SQL** (`checkSpaceLinkedAlbumAccess` is `@GenerateSql`-decorated → new documented query): `cd server && pnpm build && (cd .. && make sql)`. Commit doc output.

- [ ] **Step 8: Commit**

```bash
git add server/src/repositories/access.repository.ts server/src/utils/access.ts \
        server/test/medium/specs/shared-space-album-permissions.spec.ts server/src
git commit -m "feat(server): space-linked album write predicate + Grid 2/6 matrix"
```

---

## Task 6: Service — `linkAlbum` (Grid 3)

Linking requires **space role ≥ Editor** (non-admin — the divergence from `linkLibrary`) **AND** the actor owns or can edit the album (enforced via `Permission.AlbumUpdate`, which is `owner ∪ album_user-editor` and is **not** modified by this feature, so no circularity with the new space grant).

**Files:**

- Modify: `server/src/services/shared-space.service.ts` (after `unlinkLibrary`, ~643)
- Test: `server/test/medium/specs/shared-space-album-permissions.spec.ts` (Grid 3) + a unit test in `server/src/services/shared-space.service.spec.ts`

- [ ] **Step 1: Write Grid 3 (LINK) cells** (HTTP-free, via the service against the real DB):

```ts
describe('Grid 3 — LINK album into S (Editor+ AND owns/edits album; NOT admin-gated)', () => {
  // service signature: linkAlbum(auth, spaceId, albumId) — albumId is a string (path param)
  it('spaceOwner who owns the album → ALLOW', async () => {
    await expect(svc.linkAlbum(authOf('spaceOwner'), world.S, world.ownedByOwner)).resolves.toBeUndefined();
  });
  it('non-admin spaceEditor who owns the album → ALLOW (divergence from libraries)', async () => {
    expect(world.actors.spaceEditor.isAdmin).toBe(false);
    await expect(svc.linkAlbum(authOf('spaceEditor'), world.S, world.ownedByEditor)).resolves.toBeUndefined();
  });
  it('spaceEditor who is only album_user-VIEWER on the album → DENY (cannot re-share read-only)', async () => {
    await expect(svc.linkAlbum(authOf('spaceEditor'), world.S, world.viewerOnlyAlbum)).rejects.toThrow();
  });
  it('spaceViewer who owns the album → DENY (Viewer cannot manage links)', async () => {
    await expect(svc.linkAlbum(authOf('spaceViewer'), world.S, world.ownedByViewer)).rejects.toThrow();
  });
  it('re-link already-linked A → idempotent no-op (no throw, no duplicate row)', async () => {
    await svc.linkAlbum(authOf('spaceOwner'), world.S, world.A);
    await svc.linkAlbum(authOf('spaceOwner'), world.S, world.A); // second call: no throw, no dup
    const repo = ctx.get(SharedSpaceRepository);
    const links = await repo.getLinkedAlbums(world.S);
    expect(links.filter((l) => l.albumId === world.A)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run → confirm RED.** Run the matrix spec → Expected: FAIL (`svc.linkAlbum is not a function`).

- [ ] **Step 3: Implement `linkAlbum`** in `shared-space.service.ts` after `unlinkLibrary` (643). Mirror `linkLibrary` **minus the admin gate**, plus the album-edit-rights check:

```ts
  async linkAlbum(auth: AuthDto, spaceId: string, albumId: string): Promise<void> {
    await this.requireRole(auth, spaceId, SharedSpaceRole.Editor);
    // Actor must own or be an editor of the album (cannot re-share a read-only album).
    // AlbumUpdate = owner ∪ album_user-editor and is NOT extended by the space grant → no circularity.
    await this.requireAccess({ auth, permission: Permission.AlbumUpdate, ids: [albumId] });

    const result = await this.sharedSpaceRepository.addAlbum({
      spaceId,
      albumId,
      addedById: auth.user.id,
    });

    // Only queue face sync for newly created links (not idempotent re-links).
    if (result) {
      const space = await this.sharedSpaceRepository.getById(spaceId);
      if (space?.faceRecognitionEnabled) {
        await this.jobRepository.queue({
          name: JobName.SharedSpaceAlbumFaceSync,
          data: { spaceId, albumId },
        });
      }
    }
  }
```

`Permission`, `JobName`, `SharedSpaceRole` are already imported in this file (used by `linkLibrary`). No new DTO import needed — `albumId` is a plain string from the path param.

- [ ] **Step 4: Run → GREEN.** Run the matrix spec → Expected: PASS (Grid 3). `pnpm exec tsc --noEmit` → PASS.

- [ ] **Step 5: Add a unit test** in `server/src/services/shared-space.service.spec.ts` (mocked repos via `newTestService`) asserting: Editor+ required (Viewer → throws `ForbiddenException`); `requireAccess(AlbumUpdate)` invoked; face-sync queued **only** when `result` truthy AND `faceRecognitionEnabled`; **no** `auth.user.isAdmin` check (a non-admin editor passes the admin-free path). Mirror existing `linkLibrary` unit tests in that file.

```ts
it('linkAlbum does not require admin and queues face sync only for new links with recognition on', async () => {
  // mocks: requireRole resolves; access mocked allow; repo.addAlbum → returns a row; getById → { faceRecognitionEnabled: true }
  await sut.linkAlbum(editorAuth, 'space-1', 'album-1');
  expect(mocks.job.queue).toHaveBeenCalledWith({
    name: JobName.SharedSpaceAlbumFaceSync,
    data: { spaceId: 'space-1', albumId: 'album-1' },
  });
});
```

Run: `cd server && pnpm test -- --run src/services/shared-space.service.spec.ts` → Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/shared-space.service.ts \
        server/src/services/shared-space.service.spec.ts \
        server/test/medium/specs/shared-space-album-permissions.spec.ts
git commit -m "feat(server): linkAlbum service (Editor+, non-admin) + Grid 3 matrix"
```

---

## Task 7: Service — `unlinkAlbum` + multi-path-aware face cleanup (Grid 4 unlink + face overlap)

Unlink requires only space role ≥ Editor. Face cleanup is the **high-risk** part: remove space-person faces only for the album's assets that retain **no other space path** (unlike libraries' bulk `removePersonFacesByLibrary`).

**Files:**

- Modify: `server/src/repositories/shared-space.repository.ts` (new `getAlbumAssetIdsWithoutOtherSpacePath`)
- Modify: `server/src/services/shared-space.service.ts` (`unlinkAlbum`)
- Test: matrix spec (Grid 4 unlink) + `shared-space-album.spec.ts` (face overlap, repo method)

- [ ] **Step 1: Write the failing repo medium test** for `getAlbumAssetIdsWithoutOtherSpacePath` in `shared-space-album.spec.ts`:

```ts
describe('getAlbumAssetIdsWithoutOtherSpacePath', () => {
  it('returns album assets that have no other path in the space', async () => {
    // album A has assets [a1, a2, a3]; A linked to S.
    // a2 also direct-added to S (shared_space_asset). a3 also in album D which is also linked to S.
    // expect → [a1] only (a2 has direct path, a3 has another-album path)
    const repo = ctx.get(SharedSpaceRepository);
    const result = await repo.getAlbumAssetIdsWithoutOtherSpacePath(S, A);
    expect(new Set(result)).toEqual(new Set([a1]));
  });
});
```

- [ ] **Step 2: Run → confirm RED.** Run the album spec → Expected: FAIL (method missing).

- [ ] **Step 3: Implement `getAlbumAssetIdsWithoutOtherSpacePath`** in the repo. It returns asset ids in the album that are **not** reachable in the space via: direct add (`shared_space_asset`), another linked album (excluding this one), or a linked library:

```ts
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async getAlbumAssetIdsWithoutOtherSpacePath(spaceId: string, albumId: string): Promise<string[]> {
    const rows = await this.db
      .selectFrom('album_asset')
      .select('album_asset.assetId')
      .where('album_asset.albumId', '=', albumId)
      // not directly added to the space
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('shared_space_asset')
              .whereRef('shared_space_asset.assetId', '=', 'album_asset.assetId')
              .where('shared_space_asset.spaceId', '=', spaceId),
          ),
        ),
      )
      // not in any OTHER album linked to the space
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('shared_space_album')
              .innerJoin('album_asset as other', 'other.albumId', 'shared_space_album.albumId')
              .whereRef('other.assetId', '=', 'album_asset.assetId')
              .where('shared_space_album.spaceId', '=', spaceId)
              .where('shared_space_album.albumId', '!=', albumId),
          ),
        ),
      )
      // not in a library linked to the space
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('shared_space_library')
              .innerJoin('asset', 'asset.libraryId', 'shared_space_library.libraryId')
              .whereRef('asset.id', '=', 'album_asset.assetId')
              .where('shared_space_library.spaceId', '=', spaceId),
          ),
        ),
      )
      .execute();
    return rows.map((r) => r.assetId);
  }
```

- [ ] **Step 4: Run → GREEN** on the repo test. Run the album spec → Expected: PASS.

- [ ] **Step 5: Write Grid 4 (unlink) + face-overlap service cells** in the matrix spec / album spec:

```ts
describe('Grid 4 — UNLINK album from S', () => {
  it.each([
    ['spaceOwner', true],
    ['spaceEditor', true],
    ['spaceViewer', false],
    ['nonMember', false],
  ])('%s unlink A → allowed=%s', async (actor, allowed) => {
    const svc = ctx.get(SharedSpaceService);
    const call = svc.unlinkAlbum(authOf(actor), world.S, world.A);
    if (allowed) {
      await expect(call).resolves.toBeUndefined();
    } else {
      await expect(call).rejects.toThrow();
    }
  });
});
```

Face overlap (in `shared-space-album.spec.ts`, recognition-on space):

```ts
it('unlinkAlbum removes faces only for album-only assets; multi-path assets keep faces', async () => {
  // seed faces for a1 (album-only) and a2 (album + direct-add to S)
  await svc.unlinkAlbum(ownerAuth, S, A);
  expect(await spacePersonFaceExistsForAsset(S, a1)).toBe(false);
  expect(await spacePersonFaceExistsForAsset(S, a2)).toBe(true); // direct path retained
});
```

- [ ] **Step 6: Run → confirm RED** (`svc.unlinkAlbum` missing).

- [ ] **Step 7: Implement `unlinkAlbum`** after `linkAlbum`. Mirror `unlinkLibrary` minus the admin gate, using the multi-path-aware asset set:

```ts
  async unlinkAlbum(auth: AuthDto, spaceId: string, albumId: string): Promise<void> {
    await this.requireRole(auth, spaceId, SharedSpaceRole.Editor);

    const orphanedAssetIds = await this.sharedSpaceRepository.getAlbumAssetIdsWithoutOtherSpacePath(spaceId, albumId);
    await this.sharedSpaceRepository.removeAlbum(spaceId, albumId);
    if (orphanedAssetIds.length > 0) {
      await this.sharedSpaceRepository.removePersonFacesByAssetIds(spaceId, orphanedAssetIds);
      await this.sharedSpaceRepository.deleteOrphanedPersons(spaceId);
      await this.queueSpacePersonMetadataBackfill();
    }
  }
```

> Order matters: compute `orphanedAssetIds` **before** `removeAlbum` (so the "other linked album" exclusion doesn't accidentally include the album being removed — it already excludes `albumId`, but computing pre-delete is clearest and matches the data the assertions expect).

- [ ] **Step 8: Run → GREEN.** Run the matrix + album specs → Expected: PASS. `pnpm exec tsc --noEmit` → PASS.

- [ ] **Step 9: Commit**

```bash
git add server/src/repositories/shared-space.repository.ts server/src/services/shared-space.service.ts \
        server/test/medium/specs/shared-space-album.spec.ts server/test/medium/specs/shared-space-album-permissions.spec.ts
git commit -m "feat(server): unlinkAlbum + multi-path-aware face cleanup + Grid 4 unlink"
```

---

## Task 8: Service — `updateAlbumLink` (toggle) + `getLinkedAlbums` (Grid 4 toggle + Grid 1 list)

**Files:**

- Modify: `server/src/services/shared-space.service.ts`
- Test: matrix spec (Grid 4 toggle) + album spec (list)

- [ ] **Step 1: Write the failing tests.** Toggle requires Editor+; list available to any member; absorbed invariant (list returns the album, but it never appears in the member's personal album list — that personal-list assertion is Grid 7, Task 11/E2E):

```ts
it('updateAlbumLink toggles showInTimeline (Editor+); Viewer denied', async () => {
  const svc = ctx.get(SharedSpaceService);
  await svc.updateAlbumLink(authOf('spaceEditor'), world.S, world.A, { showInTimeline: false });
  const [link] = await ctx.get(SharedSpaceRepository).getLinkedAlbums(world.S);
  expect(link.showInTimeline).toBe(false);
  await expect(
    svc.updateAlbumLink(authOf('spaceViewer'), world.S, world.A, { showInTimeline: true }),
  ).rejects.toThrow();
});

it('getLinkedAlbums returns linked albums for any member', async () => {
  const svc = ctx.get(SharedSpaceService);
  const albums = await svc.getLinkedAlbums(authOf('spaceViewer'), world.S);
  expect(albums.map((a) => a.albumId)).toContain(world.A);
});
```

- [ ] **Step 2: Run → confirm RED.**

- [ ] **Step 3: Implement** in `shared-space.service.ts`:

```ts
  async updateAlbumLink(
    auth: AuthDto,
    spaceId: string,
    albumId: string,
    dto: SharedSpaceAlbumLinkUpdateDto,
  ): Promise<void> {
    await this.requireRole(auth, spaceId, SharedSpaceRole.Editor);
    await this.sharedSpaceRepository.setAlbumShowInTimeline(spaceId, albumId, dto.showInTimeline);
  }

  async getLinkedAlbums(auth: AuthDto, spaceId: string): Promise<SharedSpaceLinkedAlbumDto[]> {
    await this.requireMembership(auth, spaceId);
    const links = await this.sharedSpaceRepository.getLinkedAlbums(spaceId);
    const result: SharedSpaceLinkedAlbumDto[] = [];
    for (const link of links) {
      result.push({
        albumId: link.albumId,
        albumName: link.albumName,
        addedById: link.addedById,
        showInTimeline: link.showInTimeline,
        albumThumbnailAssetId: link.albumThumbnailAssetId,
        assetCount: await this.sharedSpaceRepository.getAlbumAssetCount(link.albumId), // see step 4
        createdAt: (link.createdAt as unknown as Date).toISOString(),
      });
    }
    return result;
  }
```

Add imports `SharedSpaceAlbumLinkUpdateDto`, `SharedSpaceLinkedAlbumDto`.

- [ ] **Step 4: Add `getAlbumAssetCount`** to the repo (or reuse an existing album-count query — check `album.repository.ts` for `getAssetCount`/`getMetadataForIds`; if one exists, call it instead of adding a method). If adding:

```ts
  @GenerateSql({ params: [DummyValue.UUID] })
  async getAlbumAssetCount(albumId: string): Promise<number> {
    const row = await this.db
      .selectFrom('album_asset')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('album_asset.albumId', '=', albumId)
      .executeTakeFirst();
    return Number(row?.count ?? 0);
  }
```

- [ ] **Step 5: Run → GREEN.** Run matrix + album specs → PASS. `pnpm exec tsc --noEmit` → PASS. Regen SQL (`make sql`) for the new decorated method.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/shared-space.service.ts server/src/repositories/shared-space.repository.ts \
        server/test/medium/specs/*.spec.ts server/src
git commit -m "feat(server): album link toggle + list service + Grid 4 toggle / Grid 1 list"
```

---

## Task 9: Face-sync job `SharedSpaceAlbumFaceSync`

**Files:**

- Modify: `server/src/repositories/asset.repository.ts` (new `getByAlbumIdWithFaces`)
- Modify: `server/src/services/shared-space.service.ts` (handler)
- Test: `server/test/medium/specs/shared-space-album.spec.ts` (face sync)

- [ ] **Step 1: Write the failing medium test** (recognition-on space, link album → handler creates/matches space persons for the album's faces; recognition-off → `Skipped`; concurrent unlink → stops):

```ts
it('handleSharedSpaceAlbumFaceSync matches album faces into space persons when recognition enabled', async () => {
  // seed space S (faceRecognitionEnabled), album A with assets having asset_face rows, link A
  const svc = ctx.get(SharedSpaceService);
  const status = await svc.handleSharedSpaceAlbumFaceSync({ spaceId: S, albumId: A });
  expect(status).toBe(JobStatus.Success);
  expect(await spacePersonCount(S)).toBeGreaterThan(0);
});

it('returns Skipped when the space has recognition disabled', async () => {
  const svc = ctx.get(SharedSpaceService);
  expect(await svc.handleSharedSpaceAlbumFaceSync({ spaceId: noRecogSpace, albumId: A })).toBe(JobStatus.Skipped);
});
```

- [ ] **Step 2: Run → confirm RED.**

- [ ] **Step 3: Implement `getByAlbumIdWithFaces`** in `asset.repository.ts` (mirror `getByLibraryIdWithFaces`, 846):

```ts
  @GenerateSql({ params: [DummyValue.UUID, 1000, 0] })
  getByAlbumIdWithFaces(albumId: string, limit = 1000, offset = 0) {
    return this.db
      .selectFrom('asset')
      .innerJoin('album_asset', 'album_asset.assetId', 'asset.id')
      .innerJoin('asset_face', 'asset_face.assetId', 'asset.id')
      .select('asset.id')
      .where('album_asset.albumId', '=', albumId)
      .where('asset.deletedAt', 'is', null)
      .where('asset.isOffline', '=', false)
      .groupBy('asset.id')
      .orderBy('asset.id')
      .limit(limit)
      .offset(offset)
      .execute();
  }
```

- [ ] **Step 4: Implement the handler** in `shared-space.service.ts` (mirror `handleSharedSpaceLibraryFaceSync`, 1617–1665, swapping library→album):

```ts
  @OnJob({ name: JobName.SharedSpaceAlbumFaceSync, queue: QueueName.FacialRecognition })
  async handleSharedSpaceAlbumFaceSync(job: JobOf<JobName.SharedSpaceAlbumFaceSync>): Promise<JobStatus> {
    const space = await this.sharedSpaceRepository.getById(job.spaceId);
    if (!space || !space.faceRecognitionEnabled) {
      return JobStatus.Skipped;
    }

    const linkExists = await this.sharedSpaceRepository.hasAlbumLink(job.spaceId, job.albumId);
    if (!linkExists) {
      return JobStatus.Skipped;
    }

    const batchSize = 1000;
    let offset = 0;
    let affectedAny = false;

    while (true) {
      const stillLinked = await this.sharedSpaceRepository.hasAlbumLink(job.spaceId, job.albumId);
      if (!stillLinked) {
        this.logger.log(`Album ${job.albumId} was unlinked from space ${job.spaceId} during sync, stopping`);
        break;
      }

      const assets = await this.assetRepository.getByAlbumIdWithFaces(job.albumId, batchSize, offset);
      if (assets.length === 0) {
        break;
      }

      for (const asset of assets) {
        const affectedPersonIds = await this.processSpaceFaceMatch(job.spaceId, asset.id);
        affectedAny ||= affectedPersonIds.length > 0;
      }

      offset += assets.length;
    }

    if (affectedAny) {
      await this.queueSpaceIdentityReconciliation({ spaceId: job.spaceId });
    }

    await this.jobRepository.queue({
      name: JobName.SharedSpacePersonDedup,
      data: { spaceId: job.spaceId },
    });

    return JobStatus.Success;
  }
```

- [ ] **Step 5: Run → GREEN.** Run the album spec → PASS. `pnpm exec tsc --noEmit` → PASS. Regen SQL.

- [ ] **Step 6: Commit**

```bash
git add server/src/repositories/asset.repository.ts server/src/services/shared-space.service.ts \
        server/test/medium/specs/shared-space-album.spec.ts server/src
git commit -m "feat(server): SharedSpaceAlbumFaceSync job + getByAlbumIdWithFaces"
```

---

## Task 10: Timeline composition

Album assets appear in the space timeline iff `showInTimeline = true`. Add a third `eb.exists(...)` branch (gated on `showInTimeline`) next to the `shared_space_library` branch in **both** time-bucket builders.

**Files:**

- Modify: `server/src/repositories/asset.repository.ts` (getTimeBuckets 344–349; getTimeBucket 1347–1352)
- Test: `server/test/medium/specs/shared-space-album.spec.ts` (timeline)

- [ ] **Step 1: Write the failing timeline test** (against the timeline service or asset repo time-bucket query with `timelineSpaceIds = [S]`):

```ts
it('space timeline includes album asset when showInTimeline=true and excludes when false', async () => {
  // link A (showInTimeline default true) to S; assetInA present
  const before = await fetchSpaceTimelineAssetIds(S, viewer); // helper around timeline service
  expect(before).toContain(assetInA);
  await ctx.get(SharedSpaceRepository).setAlbumShowInTimeline(S, A, false);
  const after = await fetchSpaceTimelineAssetIds(S, viewer);
  expect(after).not.toContain(assetInA);
});
```

- [ ] **Step 2: Run → confirm RED** (asset present even when toggled off — no album branch yet).

- [ ] **Step 3: Add the album branch in getTimeBuckets** (`asset.repository.ts`, inside the `eb.or([...])` after the `shared_space_library` exists, ~349):

```ts
          eb.exists(
            eb
              .selectFrom('shared_space_album')
              .innerJoin('album_asset', 'album_asset.albumId', 'shared_space_album.albumId')
              .whereRef('album_asset.assetId', '=', 'asset.id')
              .where('shared_space_album.spaceId', '=', anyUuid(options.timelineSpaceIds!))
              .where('shared_space_album.showInTimeline', '=', true),
          ),
```

- [ ] **Step 4: Add the identical branch in getTimeBucket** (~1352).

- [ ] **Step 5: Run → GREEN.** Run the album spec → PASS. `pnpm exec tsc --noEmit` → PASS. Regen SQL.

- [ ] **Step 6: Commit**

```bash
git add server/src/repositories/asset.repository.ts server/test/medium/specs/shared-space-album.spec.ts server/src
git commit -m "feat(server): compose linked-album assets into space timeline (showInTimeline)"
```

---

## Task 11: Controller endpoints + E2E API role matrix (Grids 3/4/5/7 at HTTP)

**Files:**

- Modify: `server/src/controllers/shared-space.controller.ts` (after the library endpoints, ~590)
- Test: `e2e/src/specs/server/api/shared-space-album.e2e-spec.ts` (new) — mirror `sync-library.e2e-spec.ts` / existing shared-space e2e

- [ ] **Step 1: Write the failing E2E** asserting the HTTP role matrix end-to-end (real server). Cover: link (Grid 3) — Editor-owner 204, Editor-with-viewer-only-album 403, Viewer 403, **non-admin editor succeeds**; unlink/toggle (Grid 4) — Editor 204, Viewer 403; add/remove album assets via the **existing** `POST/DELETE /albums/:id/assets` (Grid 2) — space Editor 200/204, space Viewer 403; delete album (Grid 5) — space Editor (not album owner) 403, album owner 200; absorbed invariant (Grid 7) — after linking A to S, `GET /albums` as each member does **not** list A; read (Grid 1) — Viewer can `GET /assets/:id` and thumbnail for an album asset. Assert the **actual** status codes returned (per the spec's status-realism note — record what the endpoints return; do not hard-assume 403 vs 400 for no-access).

```ts
// pattern: utils.setupServer / loginAs from existing e2e helpers
it('non-admin space editor who owns the album can link it (204)', async () => {
  const { status } = await request(app)
    .put(`/shared-spaces/${space.id}/albums/${album.id}`)
    .set('Authorization', `Bearer ${editorToken}`)
    .send({});
  expect(status).toBe(204);
});

it('space viewer cannot add assets to the linked album', async () => {
  const { status } = await request(app)
    .put(`/albums/${album.id}/assets`)
    .set('Authorization', `Bearer ${viewerToken}`)
    .send({ ids: [assetId] });
  expect([400, 403]).toContain(status); // record actual; viewer is read-only
});

it('linking A to S does not surface A in any member’s personal album list (absorbed)', async () => {
  const { body } = await request(app).get('/albums').set('Authorization', `Bearer ${viewerToken}`);
  expect(body.map((a: { id: string }) => a.id)).not.toContain(album.id);
});
```

- [ ] **Step 2: Run → confirm RED.** Run: `cd e2e && pnpm test -- --run src/specs/server/api/shared-space-album.e2e-spec.ts` → Expected: FAIL (404 — endpoints don't exist).

- [ ] **Step 3: Implement the controller endpoints** in `shared-space.controller.ts` after `unlinkLibrary` (~590). Mirror the library endpoints + add GET/PATCH:

```ts
  @Get(':id/albums')
  @Authenticated({ permission: Permission.SharedSpaceRead })
  @Endpoint({
    summary: 'List albums linked to a shared space',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  getSharedSpaceAlbums(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<SharedSpaceLinkedAlbumDto[]> {
    return this.service.getLinkedAlbums(auth, id);
  }

  @Put(':id/albums/:albumId')
  @Authenticated({ permission: Permission.SharedSpaceAlbumCreate })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Link an album to a shared space',
    description: 'Link an album so its photos appear in the space. Requires space editor/owner and album owner/editor.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  linkAlbum(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Param('albumId') albumId: string,
  ): Promise<void> {
    return this.service.linkAlbum(auth, id, albumId);
  }

  @Patch(':id/albums/:albumId')
  @Authenticated({ permission: Permission.SharedSpaceAlbumUpdate })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({ summary: 'Update a space-album link (showInTimeline)', history: new HistoryBuilder().added('v1').beta('v1') })
  updateSharedSpaceAlbum(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Param('albumId') albumId: string,
    @Body() dto: SharedSpaceAlbumLinkUpdateDto,
  ): Promise<void> {
    return this.service.updateAlbumLink(auth, id, albumId, dto);
  }

  @Delete(':id/albums/:albumId')
  @Authenticated({ permission: Permission.SharedSpaceAlbumDelete })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({ summary: 'Unlink an album from a shared space', history: new HistoryBuilder().added('v1').beta('v1') })
  unlinkAlbum(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto, @Param('albumId') albumId: string): Promise<void> {
    return this.service.unlinkAlbum(auth, id, albumId);
  }
```

> `albumId` is a **path** param on all of `PUT`/`PATCH`/`DELETE` (per the spec's API surface) — there is **no** link body DTO. `PUT` is the idempotent "create-or-ensure the link resource at this path" verb (re-link → 204, no dup). Add the permission + `SharedSpaceAlbumLinkUpdateDto`/`SharedSpaceLinkedAlbumDto` imports at the top of the controller (no `SharedSpaceAlbumLinkDto` — it doesn't exist).

- [ ] **Step 4: Run → GREEN.** Run the e2e spec → Expected: PASS. Record any status-code assertions to the actual returned codes.

- [ ] **Step 5: Add Grid 5 (delete album) + Grid 7 cells** to the e2e if not already: space Editor (non album owner) `DELETE /albums/:id` → 403; album owner → 200. Run → PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/controllers/shared-space.controller.ts e2e/src/specs/server/api/shared-space-album.e2e-spec.ts
git commit -m "feat(server): space-album endpoints (PUT/PATCH/DELETE/GET) + e2e role matrix"
```

---

## Task 11.5: Lifecycle & visibility edge-case medium tests

Pins the spec's [Lifecycle & edge cases] rows not covered by the grids — TDD each (write → confirm RED/GREEN). All in `server/test/medium/specs/shared-space-album.spec.ts`. Most pass with **no** new production code (they verify existing behavior — FK cascade, `deletedAt` filters, the read/timeline predicates) — for those, the test IS the deliverable; if one fails, that's a real bug to fix before moving on.

**Files:**

- Modify: `server/test/medium/specs/shared-space-album.spec.ts`
- (only if a test fails) Modify the relevant predicate/repo from earlier tasks.

- [ ] **Step 1: Remove single asset from album → leaves the space (unless another path).** Distinct from unlinking the whole album:

```ts
it('removing an asset from a linked album removes it from the space (no other path)', async () => {
  // album A linked to S; asset a1 only-in-A. remove a1 from album_asset.
  const access = ctx.get(AccessRepository);
  expect((await access.asset.checkSpaceAccess(viewer.id, new Set([a1]))).has(a1)).toBe(true);
  await removeAlbumAsset(A, a1); // album.repository / direct delete from album_asset
  expect((await access.asset.checkSpaceAccess(viewer.id, new Set([a1]))).has(a1)).toBe(false);
});
it('removing an asset that is also direct-added keeps it in the space', async () => {
  // a2 in A and shared_space_asset(S). remove from A → still readable via direct path.
});
```

- [ ] **Step 2: Delete the whole album → link cascades, photos leave the space.** Verifies the `ON DELETE CASCADE` FK + read predicate:

```ts
it('hard-deleting the album cascades the link and removes its assets from the space', async () => {
  const repo = ctx.get(SharedSpaceRepository);
  const access = ctx.get(AccessRepository);
  await hardDeleteAlbum(A); // deleteFrom('album') — FK cascade drops shared_space_album row
  expect(await repo.hasAlbumLink(S, A)).toBe(false);
  expect((await access.asset.checkSpaceAccess(viewer.id, new Set([assetInA]))).has(assetInA)).toBe(false);
});
```

- [ ] **Step 3: Soft-deleted album asset is excluded from read + timeline.** The read branch and timeline branch both filter `asset.deletedAt is null`:

```ts
it('a soft-deleted (trashed) album asset is not readable via the space and not in its timeline', async () => {
  await trashAsset(assetInA); // set asset.deletedAt
  const access = ctx.get(AccessRepository);
  expect((await access.asset.checkSpaceAccess(viewer.id, new Set([assetInA]))).has(assetInA)).toBe(false);
  expect(await fetchSpaceTimelineAssetIds(S, viewer)).not.toContain(assetInA);
});
```

- [ ] **Step 4: Live-photo / stacked assets.** The read branch selects `livePhotoVideoId`, so the motion part of a live photo in a linked album is reachable when its still is requested:

```ts
it('live-photo video part of a linked-album asset is readable via the space', async () => {
  // assetInA has livePhotoVideoId = motionId; query for motionId → allowed via the album branch
  const access = ctx.get(AccessRepository);
  expect((await access.asset.checkSpaceAccess(viewer.id, new Set([motionId]))).has(motionId)).toBe(true);
});
```

- [ ] **Step 5: Visibility (archived/hidden/locked) — document + pin actual behavior.** `checkSpaceAccess` (album, library, AND direct branches) does **not** filter `asset.visibility`; the timeline query applies its own visibility filters. Assert what the code actually does and **flag** the boundary:

```ts
it('visibility of album assets in the space follows the same rules as direct/library space assets', async () => {
  // archived asset in A: assert checkSpaceAccess result == the result for the SAME asset direct-added (parity, not a new rule).
  // locked asset (AssetVisibility.Locked): NOTE — checkSpaceAccess does not gate Locked for ANY space path today.
  //   This is pre-existing behavior inherited from libraries/direct, NOT introduced by albums.
  //   If locked-asset exclusion is desired it is a separate cross-cutting change (out of scope here) — record the
  //   current behavior so a future change is a deliberate, test-visible decision.
});
```

> ⚠️ **Surface to reviewers:** linking an album whose owner placed a **Locked** asset in it would expose that asset to space members via `checkSpaceAccess`, exactly as direct-adding or library-linking a locked asset does today. Not a regression and not introduced by this feature, but call it out in the PR description so the team can decide whether locked-asset exclusion across all space paths is wanted.

- [ ] **Step 6: Empty album link is a clean no-op.** Linking an album with zero assets: link succeeds, timeline unchanged, face-sync (if recognition on) processes nothing and returns `Success`. Assert no throw + no rows.

- [ ] **Step 7: Run → all GREEN** (fix any real bug a failing test exposes). Run: `cd server && pnpm test:medium -- --run test/medium/specs/shared-space-album.spec.ts` → PASS.

- [ ] **Step 8: Commit**

```bash
git add server/test/medium/specs/shared-space-album.spec.ts server/src
git commit -m "test(server): lifecycle + visibility edge cases for space albums"
```

---

## Task 12: Consolidate the authoritative permission matrix + set-equality guard

**Files:**

- Modify: `server/test/medium/specs/shared-space-album-permissions.spec.ts`

- [ ] **Step 1: Review the matrix spec against the spec's Grids 1–7.** Confirm every cell from the design spec is present (Grid 1 read incl. `crossEditor` DENY; Grid 2 write incl. `spaceViewer` DENY 403 and unlinked-`B` DENY; Grid 3 link incl. viewer-only-album DENY + idempotent re-link; Grid 4 unlink + toggle; Grid 5 delete-album; Grid 6 multi-path; Grid 7 absorbed). Add any missing cell as a test. The album-path actors (`albumOwner`/`albumEditor`/`albumViewer`) read/write cells that exercise the full `requireAccess` union live here if expressible at the medium layer, else are covered by Task 11's e2e — annotate which layer owns each.

- [ ] **Step 2: Add the cross-layer set-equality guard** (mirrors PR #646/#651): assert the read predicate's allowed-set for a fixed asset/actor matrix **equals** the timeline-visible set ∩ readable, i.e. the unit/predicate output agrees with the medium results — no drift between `checkSpaceAccess` and the timeline composition for the same fixtures.

```ts
it('set-equality: checkSpaceAccess readable set == timeline-eligible ∪ direct/library/album paths (no drift)', async () => {
  const access = ctx.get(AccessRepository);
  const predicate = await access.asset.checkSpaceAccess(viewer.id, new Set(allFixtureAssetIds));
  const expected = computeExpectedReadableSetFromFixtures(); // derived from the seeded world, not from the predicate
  expect([...predicate].sort()).toEqual([...expected].sort());
});
```

- [ ] **Step 3: Run the full matrix.** Run: `cd server && pnpm test:medium -- --run test/medium/specs/shared-space-album-permissions.spec.ts` → Expected: PASS (all 7 grids).

- [ ] **Step 4: Commit**

```bash
git add server/test/medium/specs/shared-space-album-permissions.spec.ts
git commit -m "test(server): consolidate space-album permission matrix + set-equality guard"
```

---

## Task 13: Regenerate OpenAPI clients (TS SDK + Dart)

**Files:** `open-api/**`, `mobile/openapi/**` (generated)

- [ ] **Step 1: Build + sync the spec.** Run:

```bash
cd server && pnpm build && pnpm sync:open-api
```

Expected: `open-api/immich-openapi-specs.json` gains the new paths (`/shared-spaces/{id}/albums...`) and DTOs (`SharedSpaceAlbumLinkUpdateDto`, `SharedSpaceLinkedAlbumDto`).

- [ ] **Step 2: Regenerate both clients.** Run (Java required for Dart):

```bash
cd .. && make open-api
```

Expected: TS SDK (`@immich/sdk`) gets `linkAlbum`/`unlinkAlbum`/`updateSharedSpaceAlbum`/`getSharedSpaceAlbums`; Dart client regenerates. The CI "OpenAPI Clients" job runs `open-api/bin/generate-open-api.sh` + git-diff — **git-clean ≠ regen-clean**, so regenerate, don't hand-edit.

- [ ] **Step 3: Verify no stale diff.** Run: `git status --porcelain open-api mobile/openapi` → review; ensure both TS and Dart changed (a TS-only diff means Dart wasn't regenerated).

- [ ] **Step 4: Commit**

```bash
git add open-api mobile/openapi
git commit -m "chore: regenerate OpenAPI clients for space-album endpoints"
```

---

## Task 14: Web — in-space Albums section + link/unlink/toggle management

Mirror `space-linked-libraries.svelte` (link/unlink modal) and reuse `AlbumCard.svelte` for rendering. Members see a read-only grid; Editors/Owners get link/unlink/toggle + (existing) add/remove via the album view.

**Files:**

- Create: `web/src/lib/components/spaces/space-albums-section.svelte` (grid of linked albums; members browse)
- Create: `web/src/lib/components/spaces/space-linked-albums.svelte` (Editor management: picker + unlink + toggle)
- Create: `web/src/lib/components/spaces/space-linked-albums.spec.ts`
- Modify: `web/src/lib/components/spaces/space-panel.svelte` (or the spaces `+page.svelte` context menu, ~line 1001) to surface the section/modal

- [ ] **Step 1: Write the failing component test** `space-linked-albums.spec.ts` (mirror `space-hero.spec.ts`): renders linked albums; Editor sees link/unlink/toggle controls; Viewer sees read-only; the `showInTimeline` toggle calls the SDK.

```ts
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import SpaceLinkedAlbums from './space-linked-albums.svelte';
import { vi } from 'vitest';

vi.mock('@immich/sdk', async (orig) => ({ ...(await orig()), unlinkAlbum: vi.fn(), updateSharedSpaceAlbum: vi.fn() }));

it('editor sees unlink + timeline toggle; viewer does not', async () => {
  render(SpaceLinkedAlbums, {
    space: makeSpace(),
    canManage: true,
    linkedAlbums: [makeLinkedAlbum({ albumName: 'Trip' })],
  });
  expect(screen.getByText('Trip')).toBeInTheDocument();
  expect(screen.getByTestId('unlink-album')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run → confirm RED.** Run: `cd web && pnpm test -- --run src/lib/components/spaces/space-linked-albums.spec.ts` → FAIL (component missing).

- [ ] **Step 3: Implement `space-linked-albums.svelte`** mirroring `space-linked-libraries.svelte` (state via Svelte 5 runes; `$props` for `space`, `canManage`, `linkedAlbums`). SDK calls: `getSharedSpaceAlbums({ id })`, `linkAlbum({ id, albumId })`, `unlinkAlbum({ id, albumId })`, `updateSharedSpaceAlbum({ id, albumId, sharedSpaceAlbumLinkUpdateDto: { showInTimeline } })`. The album picker lists `getAllAlbums()` filtered to albums the user owns/can edit (owner or `album_user`-editor). Use `AlbumCard.svelte` for display. Prefix async `$effect` IIFEs with `void` (Lint Web: no-floating-promises).

- [ ] **Step 4: Implement `space-albums-section.svelte`** — a grid (reuse `AlbumCard`/`AlbumCover`) of the space's linked albums for all members; clicking an album opens it scoped to the space (Phase 1: open the existing album view; absorbed-only is enforced server-side). Wire it into the space view (new sub-section or panel tab in `space-panel.svelte`; for management, surface `space-linked-albums.svelte` via a modal from the context menu like `SpaceLinkedLibrariesModal`).

- [ ] **Step 5: Run → GREEN.** Run: `cd web && pnpm test -- --run src/lib/components/spaces/space-linked-albums.spec.ts` → PASS.

- [ ] **Step 6: Web checks.** Run: `cd web && pnpm check && pnpm build` (the `pnpm --filter immich-web build` is the real gate — `check:svelte` is a local no-op for some files; tsc skips `.svelte`). Expected: clean. Run `pnpm lint` (eslint `--max-warnings 0`) → clean (watch floating-promises / `void 0`).

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/components/spaces/space-linked-albums.svelte \
        web/src/lib/components/spaces/space-albums-section.svelte \
        web/src/lib/components/spaces/space-linked-albums.spec.ts \
        web/src/lib/components/spaces/space-panel.svelte
git commit -m "feat(web): in-space Albums section + link/unlink/toggle management"
```

---

## Task 15: Final CI gate pass

Run the real gates (per `feedback_impl_loop_subagent_gaps_vs_gates`) — local subset green ≠ CI green.

- [ ] **Step 1: Server type + unit + medium.** Run:

```bash
cd server && pnpm exec tsc --noEmit && pnpm test -- --run && pnpm test:medium -- --run 2>&1 | tail -30
```

Expected: PASS. (`tsc --noEmit` direct — the `make check-server` cache can mask spec breaks.)

- [ ] **Step 2: Web build + lint.** Run: `cd web && pnpm build && pnpm lint && pnpm test -- --run 2>&1 | tail -20` → PASS.

- [ ] **Step 3: E2E.** Run: `cd e2e && pnpm test -- --run src/specs/server/api/shared-space-album.e2e-spec.ts 2>&1 | tail -20` → PASS.

- [ ] **Step 4: SQL + OpenAPI clean.** Run: `cd .. && make sql && make open-api && git status --porcelain` → Expected: **no** diff (everything already regenerated/committed). Any diff means a regen step was skipped — commit it.

- [ ] **Step 5: Dispatch the authoritative CI** (not just `test.yml`). Push the branch and run:

```bash
git push --force-with-lease origin feat/space-albums
gh --repo open-noodle/gallery workflow run test.yml --ref feat/space-albums
gh --repo open-noodle/gallery workflow run static_analysis.yml --ref feat/space-albums
```

Read the run results (`gh --repo open-noodle/gallery run list`); fix any **real** failures (re-dispatch only known flakes per memory). `test.yml` alone is insufficient — also confirm static analysis (Lint Web/Server eslint `--max-warnings 0`) is green.

- [ ] **Step 6: Manual smoke (web).** On a `make dev` stack: create a space, add a member as Viewer and another as Editor; as Editor link an album; confirm photos appear in the space timeline + Albums section; toggle `showInTimeline` off → photos leave the timeline but album still browsable; as Viewer confirm read-only (no link/unlink/add/remove) and the album is **not** in the Viewer's personal `/albums`; remove a photo from the album (as Editor) → it leaves the space; unlink → album leaves the space.

- [ ] **Step 7: Final commit** (if any regen/fix): `git commit -am "chore: space-albums phase 1 CI fixes"` and push.

---

## Self-review checklist (run before handing off)

- **Spec coverage:** Goals → Tasks: link/unlink (6,7,11), read all-members (4), write Editor-only (5), absorbed/no-`album_user` (11 Grid 7), removal propagates (4 Grid 6 + 11.5 remove-asset/delete-album), clean revocation Phase-2 (N/A here), face recognition (9) + unlink cleanup (7), timeline `showInTimeline` (10), Albums section (14). **Lifecycle/edge rows** (soft-delete, album hard-delete cascade, remove-single-asset, live-photo, visibility/locked, empty-link) → Task 11.5. Non-goals respected (no grant table, no triggers, no mobile, no admin-gate, no album-delete-via-space — Grid 5). ✅
- **Permission matrix:** Grids 1–7 mapped to Tasks 4,5,6,7,8,11,12; lifecycle edges to 11.5. ✅
- **TDD:** every task RED→GREEN→commit; matrix accreted grid-by-grid, consolidated in 12; edge cases pinned in 11.5. ✅
- **Type consistency:** method names stable across tasks — `addAlbum`/`removeAlbum`/`getLinkedAlbums`/`hasAlbumLink`/`setAlbumShowInTimeline`/`getAlbumAssetIdsWithoutOtherSpacePath`/`getAlbumAssetCount` (repo); `linkAlbum(auth, spaceId, albumId)`/`unlinkAlbum`/`updateAlbumLink`/`getLinkedAlbums`/`handleSharedSpaceAlbumFaceSync` (service); `checkSpaceLinkedAlbumAccess` (access); `getByAlbumIdWithFaces` (asset repo). DTOs: `SharedSpaceAlbumLinkUpdateDto`/`SharedSpaceLinkedAlbumDto` (no link DTO — link is path-only). ✅
- **Schema registration:** `schema/index.ts` requires 3 edits (import + tables array + `DB` interface map) — the `DB` map is load-bearing for type-checking. ✅
- **Verify-before-implement anchors:** the remaining "confirm against sibling" notes (album column names ✓ verified, boolean decorator ✓ verified, job-data type map) are real lookups with fully-specified surrounding code — not placeholders.
