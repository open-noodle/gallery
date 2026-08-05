# Space Album Folders — Mobile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring nestable album folders to the Flutter app at full capability parity with web — browse, create, rename, move and delete folders inside a Shared Space, and move albums between them.

**Architecture:** Folders reach mobile by **sync**, not by API fetch, because the space albums page is local-first: it watches a Drift join fed by the `SharedSpaceAlbumLinkV1` stream. A new server sync entity plus a tombstone table feed a new Drift table; a pure Dart tree module (ported from the web module) turns two flat lists into levels; the existing page gains a folder grid and route-per-folder navigation.

**Tech Stack:** NestJS + Kysely + PostgreSQL 14 (server), Flutter + Drift + Riverpod + auto_route (mobile), Vitest (server), flutter_test + mocktail (mobile).

**Spec:** `docs/superpowers/specs/2026-08-05-space-album-folders-mobile-design.md`. Every task cites the scenario IDs it implements; all 53 are covered, and §11 is the coverage matrix.

**Predecessor:** `docs/superpowers/specs/2026-08-04-space-album-folders-design.md` (server + web), shipped on PR #931.

## Global Constraints

- **PostgreSQL 14** floor on the server. Fork migrations go in `server/src/schema/migrations-gallery/`, never `migrations/`, with a round timestamp above the current fork high-water mark.
- **Membership scoping is the privacy gate.** Every folder sync arm gates on `accessibleSpaces(eb, options.userId)`. A folder name is member-only information — the same rule the REST listing enforces. A missed gate is a leak, not a style issue.
- **Mobile mutations follow the established pattern**: call the API, fire `BackgroundSyncManager.syncRemote()`, let exceptions propagate to the page. **No nudge on failure** — that is deliberate and documented in `SpaceAlbumActions`.
- **`schemaVersion` 36 → 37** requires four artefacts moving together (migration step, `drift_schema_v37.json` snapshot, regenerated `test/drift/main/generated/`, all via `dart run drift_dev make-migrations`). `migration_test.dart` runs a `SchemaVerifier` over every version, so a missing snapshot fails CI.
- **Mobile has TWO separate lint gates**: `dart analyze --fatal-infos lib test` (analyzer _infos_ fail the build) and `dart format`. `dart analyze` is not a substitute for `flutter test` — generated-code compile errors only surface when tests actually compile.
- **Flutter is exact-pinned.** Read the pin from `mobile/mise.toml`; do not trust any documented version, it has gone stale before.
- **i18n lives in `i18n/en.json`**, shared by web and mobile. Several `space_album_folder_*` keys already exist from the web work — reuse them, do not duplicate.
- **The REST Dart client already exists.** All five folder endpoints were generated during the web work. `make open-api` is needed only for the new **sync** DTOs.
- Nothing in this plan changes web behaviour except the one follow-up noted in Task 9.

---

## File Structure

**Server — new**

| File                                                                                     | Responsibility                                 |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `server/src/schema/tables/shared-space-album-folder-audit.table.ts`                      | Tombstone table so clients learn about deletes |
| `server/src/schema/migrations-gallery/1786000000000-SharedSpaceAlbumFolderAuditTable.ts` | DDL for the audit table + delete trigger       |
| `server/test/medium/specs/sync/shared-space-album-folder-sync.spec.ts`                   | V-01–V-05, V-07                                |

**Server — modified**

`enum.ts` (1 request type, 3 entity types) · `functions.ts` (delete trigger) · `schema/tables/shared-space-album-folder.table.ts` (attach trigger) · `sync.repository.ts` (`SharedSpaceAlbumFolderSync`, `folderId` in `SHARED_SPACE_ALBUM_SYNC_COLUMNS`) · `dtos/sync.dto.ts` · `services/sync.service.ts` (wire the new type) · `shared-space-album-link-sync.spec.ts` (invert web S-01)

**Mobile — new**

| File                                                                           | Responsibility                          |
| ------------------------------------------------------------------------------ | --------------------------------------- |
| `mobile/lib/infrastructure/entities/shared_space_album_folder.entity.dart`     | Drift table                             |
| `mobile/lib/domain/models/space_album_folder.model.dart`                       | Domain model                            |
| `mobile/lib/utils/space_album_folders.dart`                                    | Pure tree module — no Drift, no widgets |
| `mobile/lib/presentation/widgets/spaces/space_album_folder_card.widget.dart`   | Folder tile                             |
| `mobile/lib/presentation/widgets/spaces/space_album_folder_picker.widget.dart` | Move-destination sheet                  |
| `mobile/test/utils/space_album_folders_test.dart`                              | T-01–T-14                               |
| `mobile/test/medium/repositories/sync_stream_folder_test.dart`                 | H-01–H-04, H-06                         |
| `mobile/test/presentation/widgets/spaces/space_album_folder_card_test.dart`    | U-06, U-07, U-08, U-12                  |
| `mobile/test/presentation/pages/space_albums_page_test.dart`                   | U-01–U-05, U-09–U-11, U-13              |

**Mobile — modified**

`shared_space_album_link.entity.dart` (`folderId`) · `db.repository.dart` (schema 37 + step) · `sync_stream.repository.dart` (2 handlers + companion field) · `space_album.repository.dart` (`watchFolders`, `folderId` projection) · `space_album_actions.dart` (5 operations) · `shared_space_api.repository.dart` (5 wrappers) · `space_albums.page.dart` · `router.dart` · `test/medium/repository_context.dart` (folder fixture helper) · `test/medium/repositories/space_album_repository_test.dart` · `test/providers/infrastructure/space_album_actions_test.dart`

---

## Task 1: Server — folder tombstone table and delete trigger

**Implements:** the infrastructure V-03 and V-04 depend on. No scenarios complete here; Task 2 consumes it.

**Files:**

- Create: `server/src/schema/tables/shared-space-album-folder-audit.table.ts`
- Create: `server/src/schema/migrations-gallery/1786000000000-SharedSpaceAlbumFolderAuditTable.ts`
- Modify: `server/src/schema/functions.ts`
- Modify: `server/src/schema/tables/shared-space-album-folder.table.ts`
- Modify: `server/src/schema/index.ts`

**Interfaces:**

- Produces: table `shared_space_album_folder_audit` with columns `id` (uuidv7 PK), `spaceId`, `folderId`, `deletedAt`; an after-delete statement trigger on `shared_space_album_folder` that populates it.

- [ ] **Step 1: Write the failing medium test**

Create `server/test/medium/specs/sync/shared-space-album-folder-sync.spec.ts` with just the tombstone test for now — the rest lands in Task 2:

```ts
import { Kysely } from 'kysely';
import { DB } from 'src/schema';
import { SyncTestContext } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = () => {
  const ctx = new SyncTestContext(defaultDatabase);
  return { ctx, db: defaultDatabase };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

/** Insert a folder directly — the repository helper is server-side and already exists. */
const newFolder = async (db: Kysely<DB>, spaceId: string, name: string, parentId: string | null = null) =>
  db
    .insertInto('shared_space_album_folder')
    .values({ spaceId, parentId, name, createdById: null })
    .returningAll()
    .executeTakeFirstOrThrow();

describe('shared_space_album_folder_audit', () => {
  // Without a tombstone a deleted folder simply stops being emitted, and a client that already
  // synced it has no way to learn it is gone — it would linger in the local tree forever.
  it('records a row carrying the deleted folder id and its space', async () => {
    const { ctx, db } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    const folder = await newFolder(db, space.id, 'Trips');

    await db.deleteFrom('shared_space_album_folder').where('id', '=', folder.id).execute();

    const audit = await db
      .selectFrom('shared_space_album_folder_audit')
      .selectAll()
      .where('folderId', '=', folder.id)
      .execute();

    expect(audit).toHaveLength(1);
    expect(audit[0].spaceId).toBe(space.id);
    // `id` is the audit row's OWN uuidv7 — it is the sync cursor, not the folder's id.
    expect(audit[0].id).not.toBe(folder.id);
  });

  it('records one row per folder when several are deleted at once', async () => {
    const { ctx, db } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    const a = await newFolder(db, space.id, 'A');
    const b = await newFolder(db, space.id, 'B');

    await db.deleteFrom('shared_space_album_folder').where('spaceId', '=', space.id).execute();

    const audit = await db
      .selectFrom('shared_space_album_folder_audit')
      .selectAll()
      .where('spaceId', '=', space.id)
      .execute();

    expect(audit.map((r) => r.folderId).sort()).toEqual([a.id, b.id].sort());
  });

  // Deleting a SPACE cascades its folders. Those deletes must still tombstone, or a client that
  // loses access keeps the folder rows locally.
  it('records tombstones when folders cascade from a space delete', async () => {
    const { ctx, db } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    const folder = await newFolder(db, space.id, 'Trips');

    await db.deleteFrom('shared_space').where('id', '=', space.id).execute();

    const audit = await db
      .selectFrom('shared_space_album_folder_audit')
      .selectAll()
      .where('folderId', '=', folder.id)
      .execute();
    expect(audit).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd server && pnpm exec vitest run --config test/vitest.config.medium.mjs shared-space-album-folder-sync.spec.ts
```

Expected: FAIL — `relation "shared_space_album_folder_audit" does not exist`.

- [ ] **Step 3: Create the audit table**

Create `server/src/schema/tables/shared-space-album-folder-audit.table.ts`, mirroring `shared-space-album-audit.table.ts` field for field:

```ts
import { Column, CreateDateColumn, Generated, Table, Timestamp } from '@immich/sql-tools';
import { PrimaryGeneratedUuidV7Column } from 'src/decorators';

// Ungated folder-removal audit: one row per deleted folder. Consumed by
// SharedSpaceAlbumFolderSync.getDeletes. FK-less append log, mirroring
// shared_space_album_audit.
//
// All three payload columns are load-bearing: `id` is the sync CURSOR (its own uuidv7, NOT the
// folder's id), `spaceId` is what getDeletes gates on via accessibleSpaces, and `folderId` tells
// the client which folder to drop.
@Table('shared_space_album_folder_audit')
export class SharedSpaceAlbumFolderAuditTable {
  @PrimaryGeneratedUuidV7Column()
  id!: Generated<string>;

  @Column({ type: 'uuid', index: true })
  spaceId!: string;

  @Column({ type: 'uuid', index: true })
  folderId!: string;

  @CreateDateColumn({ default: () => 'clock_timestamp()', index: true })
  deletedAt!: Generated<Timestamp>;
}
```

Register it in `server/src/schema/index.ts` exactly as `SharedSpaceAlbumAuditTable` is registered.

- [ ] **Step 4: Add the delete trigger function**

In `server/src/schema/functions.ts`, beside `shared_space_album_delete_audit`:

```ts
export const shared_space_album_folder_delete_audit = registerFunction({
  name: 'shared_space_album_folder_delete_audit',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    BEGIN
      INSERT INTO shared_space_album_folder_audit ("spaceId", "folderId")
      SELECT "spaceId", "id" FROM "old";
      RETURN NULL;
    END
  `,
});
```

Simpler than the album-link version, which also revokes per-member grants — folders carry no grants.

- [ ] **Step 5: Attach the trigger to the folder table**

In `server/src/schema/tables/shared-space-album-folder.table.ts`, add the decorator alongside the existing ones:

```ts
// Fan-out trigger: on delete (direct, or via cascade from shared_space) emits a tombstone row so
// synced clients drop the folder. Without it a deleted folder lingers in the local tree forever.
@AfterDeleteTrigger({
  scope: 'statement',
  function: shared_space_album_folder_delete_audit,
  referencingOldTableAs: 'old',
})
```

Import `AfterDeleteTrigger` from `@immich/sql-tools` and the function from `src/schema/functions`.

- [ ] **Step 6: Write the migration**

Create `server/src/schema/migrations-gallery/1786000000000-SharedSpaceAlbumFolderAuditTable.ts`. Model it on `1779309791424-SharedSpaceAlbumAssetAuditTable.ts` — read that file first and match its shape exactly, including the `migration_overrides` rows for the function and trigger, which the sql-tools drift check requires.

- [ ] **Step 7: Run the tests to verify they pass**

```bash
cd server && pnpm exec vitest run --config test/vitest.config.medium.mjs shared-space-album-folder-sync.spec.ts
```

Expected: PASS (3 tests).

- [ ] **Step 8: Verify no schema drift**

```bash
cd server && pnpm check
```

Expected: clean. If sql-tools reports drift between the decorated table and the migration DDL, fix the MIGRATION to match the decorators.

- [ ] **Step 9: Commit**

```bash
git add server/src/schema server/test/medium/specs/sync/shared-space-album-folder-sync.spec.ts
git commit -m "feat(server): add shared_space_album_folder audit table and delete trigger"
```

---

## Task 2: Server — the folder sync entity

**Implements:** V-01, V-02, V-03, V-04, V-05, V-07.

**Files:**

- Modify: `server/src/enum.ts`
- Modify: `server/src/repositories/sync.repository.ts`
- Modify: `server/src/dtos/sync.dto.ts`
- Modify: `server/src/services/sync.service.ts`
- Modify: `server/test/medium/specs/sync/shared-space-album-folder-sync.spec.ts`

**Interfaces:**

- Consumes: the audit table from Task 1.
- Produces: `SyncRepository.sharedSpaceAlbumFolder` with `getUpserts(options)`, `getBackfill(options, spaceId)`, `getDeletes(options)`, `cleanupAuditTable(daysAgo)`; `SyncRequestType.SharedSpaceAlbumFoldersV1`; entity types `SharedSpaceAlbumFolderV1` / `…DeleteV1` / `…BackfillV1`.

- [ ] **Step 1: Write the failing tests**

Append to `server/test/medium/specs/sync/shared-space-album-folder-sync.spec.ts`:

```ts
const NOW_ID = 'ffffffff-ffff-7fff-bfff-ffffffffffff';
const BEFORE_UPDATE_ID = 'ffffffff-ffff-7fff-bfff-ffffffffffff';

const syncSetup = () => {
  const ctx = new SyncTestContext(defaultDatabase);
  return { ctx, db: defaultDatabase, sut: ctx.get(SyncRepository).sharedSpaceAlbumFolder };
};

describe('SharedSpaceAlbumFolderSync', () => {
  // V-01
  it('V-01: streams a space folder to a member', async () => {
    const { ctx, db, sut } = syncSetup();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    const folder = await newFolder(db, space.id, 'Trips');

    const result: any[] = await Array.fromAsync(sut.getUpserts({ userId: owner.id, nowId: NOW_ID }));

    expect(result.map((r) => r.id)).toContain(folder.id);
    const row = result.find((r) => r.id === folder.id);
    expect(row.spaceId).toBe(space.id);
    expect(row.name).toBe('Trips');
    expect(row.parentId).toBeNull();
  });

  // V-02 — the privacy gate. A folder name is member-only information ("Divorce", "Medical"),
  // so a non-member must receive nothing, not an empty-but-present row.
  it('V-02: streams NOTHING to a non-member', async () => {
    const { ctx, db, sut } = syncSetup();
    const { user: owner } = await ctx.newUser();
    const { user: stranger } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    const folder = await newFolder(db, space.id, 'Divorce');

    const result: any[] = await Array.fromAsync(sut.getUpserts({ userId: stranger.id, nowId: NOW_ID }));

    expect(result.map((r) => r.id)).not.toContain(folder.id);
  });

  // V-03
  it('V-03: streams a tombstone to a member after a delete', async () => {
    const { ctx, db, sut } = syncSetup();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    const folder = await newFolder(db, space.id, 'Trips');
    await db.deleteFrom('shared_space_album_folder').where('id', '=', folder.id).execute();

    const result: any[] = await Array.fromAsync(sut.getDeletes({ userId: owner.id, nowId: NOW_ID }));

    const row = result.find((r) => r.folderId === folder.id);
    expect(row).toBeDefined();
    expect(row.spaceId).toBe(space.id);
  });

  // V-04 — the same privacy gate on the delete arm. Easy to miss when cloning getUpserts.
  it('V-04: streams NO tombstones to a non-member', async () => {
    const { ctx, db, sut } = syncSetup();
    const { user: owner } = await ctx.newUser();
    const { user: stranger } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    const folder = await newFolder(db, space.id, 'Trips');
    await db.deleteFrom('shared_space_album_folder').where('id', '=', folder.id).execute();

    const result: any[] = await Array.fromAsync(sut.getDeletes({ userId: stranger.id, nowId: NOW_ID }));

    expect(result.map((r) => r.folderId)).not.toContain(folder.id);
  });

  // V-05
  it('V-05: backfills a space folders for a member, and not another space', async () => {
    const { ctx, db, sut } = syncSetup();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    const { space: other } = await ctx.newSharedSpace({ createdById: owner.id });
    const mine = await newFolder(db, space.id, 'Trips');
    const theirs = await newFolder(db, other.id, 'Elsewhere');

    const result: any[] = await Array.fromAsync(
      sut.getBackfill({ nowId: NOW_ID, beforeUpdateId: BEFORE_UPDATE_ID }, space.id),
    );

    expect(result.map((r) => r.id)).toContain(mine.id);
    expect(result.map((r) => r.id)).not.toContain(theirs.id);
  });

  // V-07 — a user who LOSES access stops receiving both arms. Membership is evaluated per query,
  // so this is really a check that neither arm caches or short-circuits the gate.
  it('V-07: a revoked member receives neither folders nor tombstones', async () => {
    const { ctx, db, sut } = syncSetup();
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Viewer });
    const kept = await newFolder(db, space.id, 'Trips');
    const removed = await newFolder(db, space.id, 'Archive');
    await db.deleteFrom('shared_space_album_folder').where('id', '=', removed.id).execute();

    // Sanity: while a member, both arms deliver.
    expect(
      (await Array.fromAsync(sut.getUpserts({ userId: member.id, nowId: NOW_ID }))).map((r: any) => r.id),
    ).toContain(kept.id);

    await db
      .deleteFrom('shared_space_member')
      .where('spaceId', '=', space.id)
      .where('userId', '=', member.id)
      .execute();

    const upserts: any[] = await Array.fromAsync(sut.getUpserts({ userId: member.id, nowId: NOW_ID }));
    const deletes: any[] = await Array.fromAsync(sut.getDeletes({ userId: member.id, nowId: NOW_ID }));

    expect(upserts.map((r) => r.id)).not.toContain(kept.id);
    expect(deletes.map((r) => r.folderId)).not.toContain(removed.id);
  });
});
```

Add the imports the new tests need: `SharedSpaceRole` from `src/enum`, `SyncRepository` from `src/repositories/sync.repository`.

- [ ] **Step 2: Run and watch fail**

```bash
cd server && pnpm exec vitest run --config test/vitest.config.medium.mjs shared-space-album-folder-sync.spec.ts
```

Expected: FAIL — `Cannot read properties of undefined (reading 'getUpserts')`, because `sharedSpaceAlbumFolder` does not exist on `SyncRepository`.

- [ ] **Step 3: Add the enum entries**

In `server/src/enum.ts`, beside the existing `SharedSpaceAlbumLink*` entries:

```ts
// SyncRequestType
SharedSpaceAlbumFoldersV1 = 'SharedSpaceAlbumFoldersV1',

// SyncEntityType
SharedSpaceAlbumFolderV1 = 'SharedSpaceAlbumFolderV1',
SharedSpaceAlbumFolderDeleteV1 = 'SharedSpaceAlbumFolderDeleteV1',
SharedSpaceAlbumFolderBackfillV1 = 'SharedSpaceAlbumFolderBackfillV1',
```

- [ ] **Step 4: Add the sync class**

In `server/src/repositories/sync.repository.ts`, beside `SharedSpaceAlbumLinkSync`:

```ts
const SHARED_SPACE_ALBUM_FOLDER_SYNC_COLUMNS = [
  'shared_space_album_folder.id',
  'shared_space_album_folder.spaceId',
  'shared_space_album_folder.parentId',
  'shared_space_album_folder.name',
  'shared_space_album_folder.createdAt',
  'shared_space_album_folder.updatedAt',
  'shared_space_album_folder.updateId',
] as const;

// Streams a space's album folders. Structurally a clone of SharedSpaceAlbumLinkSync, minus the
// soft-delete join — folders have no deletedAt and no album to check.
//
// accessibleSpaces() on BOTH arms is the privacy gate: a folder NAME is member-only information,
// the same rule the REST listing enforces. Dropping it from either arm is a leak, not a style slip.
export class SharedSpaceAlbumFolderSync extends BaseSync {
  @GenerateSql({ params: [dummyBackfillOptions, DummyValue.UUID], stream: true })
  getBackfill(options: SyncBackfillOptions, spaceId: string) {
    return this.backfillQuery('shared_space_album_folder', options)
      .select(SHARED_SPACE_ALBUM_FOLDER_SYNC_COLUMNS)
      .where('shared_space_album_folder.spaceId', '=', spaceId)
      .stream();
  }

  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getDeletes(options: SyncQueryOptions) {
    return this.auditQuery('shared_space_album_folder_audit', options)
      .select(['id', 'spaceId', 'folderId'])
      .where('spaceId', 'in', (eb) => accessibleSpaces(eb, options.userId))
      .stream();
  }

  cleanupAuditTable(daysAgo: number) {
    return this.auditCleanup('shared_space_album_folder_audit', daysAgo);
  }

  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getUpserts(options: SyncQueryOptions) {
    return this.upsertQuery('shared_space_album_folder', options)
      .select(SHARED_SPACE_ALBUM_FOLDER_SYNC_COLUMNS)
      .where('shared_space_album_folder.spaceId', 'in', (eb) => accessibleSpaces(eb, options.userId))
      .stream();
  }
}
```

Register it on `SyncRepository` as `sharedSpaceAlbumFolder`, matching how `sharedSpaceAlbumLink` is declared and constructed.

- [ ] **Step 5: Add the DTOs and wire the service**

In `server/src/dtos/sync.dto.ts`, add `SyncSharedSpaceAlbumFolderV1` (`id`, `spaceId`, `parentId`, `name`, `createdAt`, `updatedAt`) and `SyncSharedSpaceAlbumFolderDeleteV1` (`folderId`), following the `SyncSharedSpaceAlbumLinkV1` pair exactly.

In `server/src/services/sync.service.ts`, wire `SharedSpaceAlbumFoldersV1` into the request→handler map the same way `SharedSpaceAlbumLinksV1` is wired, including its backfill.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd server && pnpm exec vitest run --config test/vitest.config.medium.mjs shared-space-album-folder-sync.spec.ts
```

Expected: PASS (9 tests: 3 from Task 1 + 6 here).

- [ ] **Step 7: Confirm the privacy gate has teeth**

Delete the `.where('shared_space_album_folder.spaceId', 'in', …)` line from `getUpserts`, re-run, and confirm **V-02 fails**. Restore it. Do the same for `getDeletes` and confirm **V-04 fails**. Report both observations — a gate with no failing test is the one defect this task cannot afford.

- [ ] **Step 8: Commit**

```bash
cd .. && git add server/src server/test
git commit -m "feat(server): add the space album folder sync entity"
```

---

## Task 3: Server — `folderId` in the album-link payload

**Implements:** V-06. Inverts the web spec's S-01.

**Files:**

- Modify: `server/src/repositories/sync.repository.ts`
- Modify: `server/src/dtos/sync.dto.ts`
- Modify: `server/test/medium/specs/sync/shared-space-album-link-sync.spec.ts`

- [ ] **Step 1: Invert the existing guard**

In `shared-space-album-link-sync.spec.ts`, find the test asserting `folderId` is ABSENT from the link payload. Replace its body and rewrite its comment:

```ts
// V-06 (was web S-01, now inverted). Mobile needs an album's placement to render the folder tree,
// so folderId is deliberately part of this payload. The original test pinned its ABSENCE, on the
// grounds that adding it was a mobile-facing decision needing its own spec — that spec is
// docs/superpowers/specs/2026-08-05-space-album-folders-mobile-design.md. Inverted rather than
// deleted so that REMOVING the field fails just as loudly as adding it once did.
it('V-06: includes folderId in the album link sync payload', async () => {
  const { ctx, db, sut } = setup();
  const { user: owner } = await ctx.newUser();
  const { album } = await ctx.newAlbum({ ownerId: owner.id });
  const { space } = await ctx.newSharedSpace({ createdById: owner.id });
  await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });
  const folder = await db
    .insertInto('shared_space_album_folder')
    .values({ spaceId: space.id, parentId: null, name: 'Trips', createdById: null })
    .returningAll()
    .executeTakeFirstOrThrow();
  await db
    .updateTable('shared_space_album')
    .set({ folderId: folder.id })
    .where('spaceId', '=', space.id)
    .where('albumId', '=', album.id)
    .execute();

  const result: any[] = await Array.fromAsync(sut.getUpserts({ userId: owner.id, nowId: NOW_ID }));

  const row = result.find((r) => r.albumId === album.id);
  expect(row).toBeDefined();
  expect(row.folderId).toBe(folder.id);
});

it('V-06: reports a root-level album as folderId null, not missing', async () => {
  const { ctx, sut } = setup();
  const { user: owner } = await ctx.newUser();
  const { album } = await ctx.newAlbum({ ownerId: owner.id });
  const { space } = await ctx.newSharedSpace({ createdById: owner.id });
  await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

  const result: any[] = await Array.fromAsync(sut.getUpserts({ userId: owner.id, nowId: NOW_ID }));

  const row = result.find((r) => r.albumId === album.id);
  expect(row).toHaveProperty('folderId');
  expect(row.folderId).toBeNull();
});
```

The second case matters: a client that cannot distinguish "at the root" from "field absent" cannot tell a real placement from an old server.

- [ ] **Step 2: Run and watch fail**

```bash
cd server && pnpm exec vitest run --config test/vitest.config.medium.mjs shared-space-album-link-sync.spec.ts
```

Expected: FAIL — `folderId` is undefined on the returned rows.

- [ ] **Step 3: Add the column**

In `sync.repository.ts`, add one line to `SHARED_SPACE_ALBUM_SYNC_COLUMNS`, after `showInTimeline`:

```ts
  'shared_space_album.folderId',
```

Add `folderId: string | null` to `SyncSharedSpaceAlbumLinkV1` in `sync.dto.ts`.

- [ ] **Step 4: Run to verify pass, then regenerate**

```bash
cd server && pnpm exec vitest run --config test/vitest.config.medium.mjs shared-space-album-link-sync.spec.ts
pnpm build && mise run sync-open-api
cd .. && mise run open-api
```

- [ ] **Step 5: Commit**

```bash
git add server/src server/test open-api packages/sdk mobile/openapi
git commit -m "feat(server): include folderId in the album link sync payload"
```

---

## Task 4: Mobile — Drift schema and migration to v37

**Implements:** R-07, R-08.

**Files:**

- Create: `mobile/lib/infrastructure/entities/shared_space_album_folder.entity.dart`
- Create: `mobile/lib/domain/models/space_album_folder.model.dart`
- Modify: `mobile/lib/infrastructure/entities/shared_space_album_link.entity.dart`
- Modify: `mobile/lib/infrastructure/repositories/db.repository.dart`
- Generated: `mobile/drift_schemas/main/drift_schema_v37.json`, `mobile/test/drift/main/generated/`

**Interfaces:**

- Produces: Drift table `SharedSpaceAlbumFolderEntity` (`id` PK, `spaceId` cascade FK, `parentId` nullable no-FK, `name`, `createdAt`, `updatedAt`); `folderId` on `SharedSpaceAlbumLinkEntity`; `SpaceAlbumFolder` domain model with fields `id`, `spaceId`, `parentId`, `name`; **and `final String? folderId` on the existing `SpaceAlbum` model** — the model mirrors the row, and Task 6 needs it.

- [ ] **Step 1: Write the failing migration test**

Append to `mobile/test/drift/main/migration_test.dart`, inside the existing `main()`:

```dart
  // R-07: the migration failure that would be catastrophic and silent. Drift's TableMigration
  // REBUILDS the table; a wrong columnTransformer or a missed column drops rows. Every album in
  // every space is linked through shared_space_album_link, so getting this wrong unlinks every
  // album from every space on upgrade.
  //
  // Follows this file's established data-migration idiom exactly (see the from23To24 group):
  // seed the OLD schema with raw SQL, close it, migrate a fresh Drift over the same schema, close
  // that, then open the NEW schema class to assert. `migrateAndValidate` returns void — it does
  // NOT hand back a database.
  group('gallery-fork: from36To37 data migration', () {
    test('R-07: preserves existing album links, with a null folderId', () async {
      final schema = await verifier.schemaAt(36);
      final oldDb = v36.DatabaseAtV36(schema.newConnection());
      await oldDb.customStatement("""
        INSERT INTO shared_space_entity (id, name, created_by_id)
        VALUES ('space-1', 'Family', 'user-1')
      """);
      await oldDb.customStatement("""
        INSERT INTO shared_space_album_link_entity (space_id, album_id, show_in_timeline)
        VALUES ('space-1', 'album-1', 1)
      """);
      await oldDb.close();

      final dbForMigration = Drift(schema.newConnection());
      await verifier.migrateAndValidate(dbForMigration, 37);
      await dbForMigration.close();

      final migratedDb = v37.DatabaseAtV37(schema.newConnection());
      final row = await migratedDb
          .customSelect("SELECT * FROM shared_space_album_link_entity WHERE album_id = 'album-1'")
          .getSingle();

      expect(row.data['album_id'], 'album-1');
      expect(row.data['folder_id'], isNull);
      await migratedDb.close();
    });

    // R-08
    test('R-08: creates an empty folder table', () async {
      final schema = await verifier.schemaAt(36);
      final dbForMigration = Drift(schema.newConnection());
      await verifier.migrateAndValidate(dbForMigration, 37);
      await dbForMigration.close();

      final migratedDb = v37.DatabaseAtV37(schema.newConnection());
      final count = await migratedDb
          .customSelect('SELECT COUNT(*) AS c FROM shared_space_album_folder_entity')
          .getSingle();

      expect(count.data['c'], 0);
      await migratedDb.close();
    });
  });
```

Add `import 'generated/schema_v36.dart' as v36;` and `import 'generated/schema_v37.dart' as v37;` beside the existing versioned imports. Both are produced by the regeneration in Step 7 — write the test first anyway; it should fail on the missing import, which is the correct RED.

The raw-SQL seeding above is deliberate, not laziness: the `from23To24` group in this same file does exactly that, and it avoids depending on which columns a v36 companion happens to require.

- [ ] **Step 2: Run and watch fail**

```bash
cd mobile && flutter test test/drift/main/migration_test.dart
```

Expected: FAIL — no schema v37, and `schema_v36.dart` may not exist yet either.

- [ ] **Step 3: Define the folder entity**

Create `mobile/lib/infrastructure/entities/shared_space_album_folder.entity.dart`:

```dart
import 'package:drift/drift.dart';
import 'package:immich_mobile/infrastructure/entities/shared_space.entity.dart';
import 'package:immich_mobile/infrastructure/utils/drift_default.mixin.dart';

// Album folder inside a space (fed by SharedSpaceAlbumFolderV1). spaceId has a cascade FK to
// SharedSpaceEntity.
//
// parentId deliberately has NO foreign key. Sync makes no ordering guarantee, so a child folder
// can arrive before its parent — the same reason albumId on the link table has no FK. A
// self-referencing CASCADE would also be actively wrong: deleting a parent locally would destroy
// its children, while the server PROMOTES them one level and emits updated rows, so a local
// cascade would race those updates and destroy data the server meant to keep.
@TableIndex.sql(
  'CREATE INDEX IF NOT EXISTS idx_shared_space_album_folder_space ON shared_space_album_folder_entity (space_id)',
)
class SharedSpaceAlbumFolderEntity extends Table with DriftDefaultsMixin {
  const SharedSpaceAlbumFolderEntity();

  TextColumn get id => text()();

  TextColumn get spaceId => text().references(SharedSpaceEntity, #id, onDelete: KeyAction.cascade)();

  // No FK — the parent folder row may not be synced yet.
  TextColumn get parentId => text().nullable()();

  TextColumn get name => text()();

  DateTimeColumn get createdAt => dateTime().withDefault(currentDateAndTime)();
  DateTimeColumn get updatedAt => dateTime().withDefault(currentDateAndTime)();

  @override
  Set<Column> get primaryKey => {id};
}
```

- [ ] **Step 4: Add `folderId` to the link entity**

In `shared_space_album_link.entity.dart`, after `showInTimeline`:

```dart
  // Which folder this album sits in within the space; null = the space root. No FK — the folder
  // row may not be synced yet.
  TextColumn get folderId => text().nullable()();
```

- [ ] **Step 5: Create the domain model**

Create `mobile/lib/domain/models/space_album_folder.model.dart`, matching the style of `space_album.model.dart` (read it first):

```dart
class SpaceAlbumFolder {
  const SpaceAlbumFolder({
    required this.id,
    required this.spaceId,
    required this.parentId,
    required this.name,
  });

  final String id;
  final String spaceId;
  final String? parentId;
  final String name;
}
```

Include `==`/`hashCode`/`toString` if `space_album.model.dart` does; match it rather than inventing.

Also add `final String? folderId;` to the existing `SpaceAlbum` in `space_album.model.dart` — to the
class, its constructor, and its `==`/`hashCode`/`copyWith` if present, matching exactly what that
class already does for `showInTimeline`. Task 7 fills it from the query; Task 6 needs the field to
exist. For reference, `SpaceAlbum` currently carries `id`, `name`, `thumbnailAssetId`,
`showInTimeline`, `assetCount`, `linkedAt`, `updatedAt`.

- [ ] **Step 6: Bump the schema and add the migration step**

In `db.repository.dart`, change `int get schemaVersion => 36;` to `37`, and add to the `migrationSteps(...)` call:

```dart
              from36To37: (m, v37) async {
                // Album folders (Drift v37). Create the new table, then add the nullable
                // folderId column to the existing link table. The link table is rebuilt by
                // TableMigration, so every existing row must survive with folderId null —
                // see the R-07 migration test.
                await m.create(v37.sharedSpaceAlbumFolderEntity);
                await m.alterTable(
                  TableMigration(
                    v37.sharedSpaceAlbumLinkEntity,
                    newColumns: [v37.sharedSpaceAlbumLinkEntity.folderId],
                  ),
                );
              },
```

- [ ] **Step 7: Regenerate the schema artefacts**

```bash
cd mobile && dart run drift_dev make-migrations
```

This writes `drift_schemas/main/drift_schema_v37.json` and regenerates `test/drift/main/generated/`. Confirm both appeared:

```bash
ls drift_schemas/main/drift_schema_v37.json && ls test/drift/main/generated | tail -3
```

If the command needs the register step first, run `dart run build_runner build --delete-conflicting-outputs` and retry.

- [ ] **Step 8: Run the tests to verify they pass**

```bash
cd mobile && flutter test test/drift/main/migration_test.dart
```

Expected: PASS, including the `SchemaVerifier` cases that walk every version pair.

- [ ] **Step 9: Commit**

```bash
cd .. && git add mobile/lib mobile/drift_schemas mobile/test
git commit -m "feat(mobile): add the space album folder Drift table and migrate to v37"
```

---

## Task 5: Mobile — sync handlers

**Implements:** H-01, H-02, H-03, H-04, H-06.

**Files:**

- Modify: `mobile/lib/infrastructure/repositories/sync_stream.repository.dart`
- Modify: `mobile/test/medium/repository_context.dart`
- Create: `mobile/test/medium/repositories/sync_stream_folder_test.dart`

**Interfaces:**

- Consumes: the Drift table from Task 4, the sync DTOs from Tasks 2–3.
- Produces: `SyncStreamRepository.updateSharedSpaceAlbumFoldersV1(Iterable<SyncSharedSpaceAlbumFolderV1>)` and `deleteSharedSpaceAlbumFoldersV1(Iterable<SyncSharedSpaceAlbumFolderDeleteV1>)`; a `insertSharedSpaceAlbumFolder({required String spaceId, required String id, String? parentId, String name})` fixture helper on `MediumRepositoryContext`.

- [ ] **Step 1: Add the fixture helper**

In `mobile/test/medium/repository_context.dart`, beside `insertSharedSpaceAlbumLink`:

```dart
  Future<void> insertSharedSpaceAlbumFolder({
    required String spaceId,
    required String id,
    String? parentId,
    String name = 'Folder',
  }) {
    return db
        .into(db.sharedSpaceAlbumFolderEntity)
        .insert(
          SharedSpaceAlbumFolderEntityCompanion.insert(
            id: id,
            spaceId: spaceId,
            parentId: Value(parentId),
            name: name,
          ),
        );
  }
```

Also extend `insertSharedSpaceAlbumLink` with an optional `String? folderId` parameter, defaulting to null, so later tasks can seed placements.

- [ ] **Step 2: Write the failing tests**

Create `mobile/test/medium/repositories/sync_stream_folder_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/infrastructure/repositories/sync_stream.repository.dart';
import 'package:openapi/api.dart';

import '../repository_context.dart';

void main() {
  late MediumRepositoryContext ctx;
  late SyncStreamRepository repo;

  setUp(() {
    ctx = MediumRepositoryContext();
    repo = SyncStreamRepository(ctx.db);
  });
  tearDown(() => ctx.dispose());

  Future<List<Map<String, Object?>>> folderRows() async {
    final rows = await ctx.db.customSelect('SELECT * FROM shared_space_album_folder_entity').get();
    return rows.map((r) => r.data).toList();
  }

  group('updateSharedSpaceAlbumFoldersV1', () {
    // H-01
    test('H-01: inserts folder rows, and re-delivery updates rather than duplicating', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);

      await repo.updateSharedSpaceAlbumFoldersV1([
        SyncSharedSpaceAlbumFolderV1(
          id: 'f1',
          spaceId: space.id,
          parentId: null,
          name: 'Trips',
          createdAt: DateTime.utc(2026, 1, 1),
          updatedAt: DateTime.utc(2026, 1, 1),
        ),
      ]);
      expect(await folderRows(), hasLength(1));

      await repo.updateSharedSpaceAlbumFoldersV1([
        SyncSharedSpaceAlbumFolderV1(
          id: 'f1',
          spaceId: space.id,
          parentId: null,
          name: 'Travel',
          createdAt: DateTime.utc(2026, 1, 1),
          updatedAt: DateTime.utc(2026, 1, 2),
        ),
      ]);

      final rows = await folderRows();
      expect(rows, hasLength(1));
      expect(rows.single['name'], 'Travel');
    });

    // H-03 — sync makes no ordering guarantee, so this is the NORMAL case, not an exotic one.
    // The row must persist with its dangling parentId; the tree module treats it as a root until
    // the parent lands.
    test('H-03: a child arriving before its parent is stored with its parentId intact', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);

      await repo.updateSharedSpaceAlbumFoldersV1([
        SyncSharedSpaceAlbumFolderV1(
          id: 'child',
          spaceId: space.id,
          parentId: 'parent-not-here-yet',
          name: '2026',
          createdAt: DateTime.utc(2026, 1, 1),
          updatedAt: DateTime.utc(2026, 1, 1),
        ),
      ]);

      final rows = await folderRows();
      expect(rows, hasLength(1));
      expect(rows.single['parent_id'], 'parent-not-here-yet');
    });
  });

  group('deleteSharedSpaceAlbumFoldersV1', () {
    // H-02
    test('H-02: removes the named folder rows', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);
      await ctx.insertSharedSpaceAlbumFolder(spaceId: space.id, id: 'f1', name: 'Trips');
      await ctx.insertSharedSpaceAlbumFolder(spaceId: space.id, id: 'f2', name: 'Family');

      await repo.deleteSharedSpaceAlbumFoldersV1([SyncSharedSpaceAlbumFolderDeleteV1(folderId: 'f1')]);

      final rows = await folderRows();
      expect(rows.map((r) => r['id']), ['f2']);
    });
  });

  group('link placement', () {
    // H-04
    test('H-04: a link upsert carrying folderId writes the column', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);
      final album = await ctx.newSharedSpaceAlbum(name: 'Rome');

      await repo.updateSharedSpaceAlbumLinksV1([
        SyncSharedSpaceAlbumLinkV1(
          spaceId: space.id,
          albumId: album.id,
          showInTimeline: true,
          addedById: null,
          folderId: 'f1',
          createdAt: DateTime.utc(2026, 1, 1),
          updatedAt: DateTime.utc(2026, 1, 1),
        ),
      ]);

      final rows = await ctx.db.customSelect('SELECT * FROM shared_space_album_link_entity').get();
      expect(rows.single.data['folder_id'], 'f1');
    });
  });

  group('space cascade', () {
    // H-06 — losing access to a space must not leave its folder names behind on the device.
    test('H-06: deleting the space removes its folders via the cascade FK', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);
      await ctx.insertSharedSpaceAlbumFolder(spaceId: space.id, id: 'f1', name: 'Divorce');

      await ctx.db.customStatement('DELETE FROM shared_space_entity WHERE id = ?', [space.id]);

      expect(await folderRows(), isEmpty);
    });
  });
}
```

Match the exact generated DTO constructor names and required/optional parameters — read `mobile/openapi/lib/model/sync_shared_space_album_link_v1.dart` first; if a field is non-nullable in the generated Dart, the fixture must supply it.

- [ ] **Step 3: Run and watch fail**

```bash
cd mobile && flutter test test/medium/repositories/sync_stream_folder_test.dart
```

Expected: FAIL — `updateSharedSpaceAlbumFoldersV1` is not defined.

- [ ] **Step 4: Implement the handlers**

In `sync_stream.repository.dart`, beside the album-link pair:

```dart
  // Folders (SharedSpaceAlbumFolderV1). Clone of updateSharedSpaceAlbumLinksV1.
  Future<void> updateSharedSpaceAlbumFoldersV1(Iterable<SyncSharedSpaceAlbumFolderV1> data) async {
    try {
      await _db.batch((batch) {
        for (final folder in data) {
          final companion = SharedSpaceAlbumFolderEntityCompanion(
            id: Value(folder.id),
            spaceId: Value(folder.spaceId),
            parentId: Value(folder.parentId),
            name: Value(folder.name),
            createdAt: Value(folder.createdAt),
            updatedAt: Value(folder.updatedAt),
          );
          batch.insert(_db.sharedSpaceAlbumFolderEntity, companion, onConflict: DoUpdate((_) => companion));
        }
      });
    } catch (error, stack) {
      _logger.severe('Error: updateSharedSpaceAlbumFoldersV1', error, stack);
      rethrow;
    }
  }

  Future<void> deleteSharedSpaceAlbumFoldersV1(Iterable<SyncSharedSpaceAlbumFolderDeleteV1> data) async {
    try {
      await _db.batch((batch) {
        for (final folder in data) {
          batch.deleteWhere(_db.sharedSpaceAlbumFolderEntity, (t) => t.id.equals(folder.folderId));
        }
      });
    } catch (error, stack) {
      _logger.severe('Error: deleteSharedSpaceAlbumFoldersV1', error, stack);
      rethrow;
    }
  }
```

Add `folderId: Value(join.folderId)` to the companion inside `updateSharedSpaceAlbumLinksV1`.

Wire both handlers into the sync-stream dispatch the same way the album-link handlers are wired, and add `SharedSpaceAlbumFoldersV1` to the requested types **behind the existing `serverVersion` gate** that already guards the space-album streams.

- [ ] **Step 5: Run to verify pass**

```bash
cd mobile && flutter test test/medium/repositories/sync_stream_folder_test.dart
```

Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
cd .. && git add mobile/lib mobile/test
git commit -m "feat(mobile): handle the space album folder sync stream"
```

---

## Task 6: Mobile — the pure tree module

**Implements:** T-01–T-14.

This task depends only on the domain model from Task 4, so it can run in parallel with Task 5.

**Files:**

- Create: `mobile/lib/utils/space_album_folders.dart`
- Create: `mobile/test/utils/space_album_folders_test.dart`

**Interfaces:**

- Consumes: `SpaceAlbumFolder` (Task 4), `SpaceAlbum` (existing, gains `folderId` in Task 7).
- Produces:

```dart
class FolderNode { final SpaceAlbumFolder folder; final List<FolderNode> children; }
class FolderSearchHit { final SpaceAlbum album; final List<String> path; }

List<FolderNode> buildFolderTree(List<SpaceAlbumFolder> folders);
List<SpaceAlbumFolder> folderPath(List<SpaceAlbumFolder> folders, String? folderId);
({List<SpaceAlbumFolder> folders, List<SpaceAlbum> albums}) folderContents(
    List<SpaceAlbumFolder> folders, List<SpaceAlbum> albums, String? folderId);
int recursiveAlbumCount(List<SpaceAlbumFolder> folders, List<SpaceAlbum> albums, String folderId);
List<SpaceAlbum> folderPreviewAlbums(List<SpaceAlbumFolder> folders, List<SpaceAlbum> albums, String folderId);
bool isDescendant(List<SpaceAlbumFolder> folders, String candidateId, String ancestorId);
List<FolderSearchHit> flattenForSearch(List<SpaceAlbumFolder> folders, List<SpaceAlbum> albums, String query);
```

- [ ] **Step 1: Write the failing tests**

Create `mobile/test/utils/space_album_folders_test.dart`. The web module's suite ports across nearly case-for-case; these are the Dart equivalents:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/space_album.model.dart';
import 'package:immich_mobile/domain/models/space_album_folder.model.dart';
import 'package:immich_mobile/utils/space_album_folders.dart';

SpaceAlbumFolder folder(String id, String name, [String? parentId]) =>
    SpaceAlbumFolder(id: id, spaceId: 'space-1', parentId: parentId, name: name);

// SpaceAlbum carries id, name, thumbnailAssetId, showInTimeline, assetCount, linkedAt, updatedAt,
// plus the folderId Task 4 adds. Only id/name/folderId/updatedAt matter here; the rest are filled
// with inert defaults so the constructor is satisfied.
SpaceAlbum album(String id, String name, {String? folderId, DateTime? updatedAt}) => SpaceAlbum(
      id: id,
      name: name,
      thumbnailAssetId: null,
      showInTimeline: true,
      assetCount: 0,
      linkedAt: DateTime.utc(2026, 1, 1),
      updatedAt: updatedAt ?? DateTime.utc(2026, 1, 1),
      folderId: folderId,
    );

// Trips > 2026 > Italy, plus a sibling Family at the root.
List<SpaceAlbumFolder> tripsTree() => [
      folder('trips', 'Trips'),
      folder('y2026', '2026', 'trips'),
      folder('italy', 'Italy', 'y2026'),
      folder('family', 'Family'),
    ];

void main() {
  group('buildFolderTree', () {
    test('T-01: nests folders under their parents, roots at the top', () {
      final tree = buildFolderTree(tripsTree());

      expect(tree.map((n) => n.folder.id), ['trips', 'family']);
      expect(tree.first.children.map((n) => n.folder.id), ['y2026']);
      expect(tree.first.children.first.children.map((n) => n.folder.id), ['italy']);
    });

    // T-02 — sync makes no ordering guarantee, so a dangling parentId is the NORMAL mid-sync
    // state, not corrupt data. It must show at the root, never vanish and never throw.
    test('T-02: a folder whose parent is absent is treated as a root', () {
      final tree = buildFolderTree([folder('trips', 'Trips'), folder('orphan', 'Orphan', 'gone')]);

      expect(tree.map((n) => n.folder.id)..sort(), ['orphan', 'trips']);
    });

    test('T-03: a self-referencing folder is treated as a root and does not loop', () {
      final tree = buildFolderTree([folder('loop', 'Loop', 'loop')]);

      expect(tree.map((n) => n.folder.id), ['loop']);
    });

    test('T-04: a mutual A<->B cycle keeps both folders and does not loop', () {
      final tree = buildFolderTree([folder('a', 'A', 'b'), folder('b', 'B', 'a')]);

      expect(tree.map((n) => n.folder.id)..sort(), ['a', 'b']);
    });
  });

  group('folderPath', () {
    test('T-05: returns the ancestor chain root-first', () {
      expect(folderPath(tripsTree(), 'italy').map((f) => f.name), ['Trips', '2026', 'Italy']);
    });

    test('T-06: returns empty for the space root and for an unknown id', () {
      expect(folderPath(tripsTree(), null), isEmpty);
      expect(folderPath(tripsTree(), 'gone'), isEmpty);
    });
  });

  group('folderContents', () {
    test('T-07: returns only the folders and albums at this level', () {
      final albums = [album('a1', 'Rome', folderId: 'y2026'), album('a2', 'Venice', folderId: 'italy')];

      final contents = folderContents(tripsTree(), albums, 'y2026');

      expect(contents.folders.map((f) => f.id), ['italy']);
      expect(contents.albums.map((a) => a.id), ['a1']);
    });

    // T-08 — THE mobile-specific case. On web this needs a fetch race and was deferred; here an
    // album row arriving before its folder row is routine, so hiding it would make albums blink
    // out of the grid mid-sync. It must fall back to the root.
    test('T-08: an album whose folder is missing appears at the ROOT, never hidden', () {
      final albums = [album('a1', 'Rome', folderId: 'not-synced-yet')];

      final atRoot = folderContents(tripsTree(), albums, null);

      expect(atRoot.albums.map((a) => a.id), ['a1']);
    });
  });

  group('recursiveAlbumCount', () {
    test('T-09: counts albums anywhere in the subtree', () {
      final albums = [
        album('a1', 'Rome', folderId: 'y2026'),
        album('a2', 'Venice', folderId: 'italy'),
        album('a3', 'Loose'),
      ];

      expect(recursiveAlbumCount(tripsTree(), albums, 'trips'), 2);
      expect(recursiveAlbumCount(tripsTree(), albums, 'italy'), 1);
      expect(recursiveAlbumCount(tripsTree(), albums, 'family'), 0);
    });
  });

  group('folderPreviewAlbums', () {
    test('T-10: returns at most four, newest first, even when the newest is last in the list', () {
      final albums = [
        album('a1', 'One', folderId: 'trips', updatedAt: DateTime.utc(2026, 1, 1)),
        album('a2', 'Two', folderId: 'trips', updatedAt: DateTime.utc(2026, 2, 1)),
        album('a3', 'Three', folderId: 'trips', updatedAt: DateTime.utc(2026, 3, 1)),
        album('a4', 'Four', folderId: 'trips', updatedAt: DateTime.utc(2026, 4, 1)),
        album('a5', 'Five', folderId: 'trips', updatedAt: DateTime.utc(2026, 5, 1)),
      ];

      // Sort-then-take, not take-then-sort: the latter returns an arbitrary subset. The web
      // implementation shipped that bug once, so this fixture puts the newest album LAST.
      expect(folderPreviewAlbums(tripsTree(), albums, 'trips').map((a) => a.id), ['a5', 'a4', 'a3', 'a2']);
    });

    test('T-11: returns empty for an empty folder', () {
      expect(folderPreviewAlbums(tripsTree(), const [], 'family'), isEmpty);
    });
  });

  group('isDescendant', () {
    test('T-12: true for descendants, false for ancestors, siblings, self and unknowns', () {
      expect(isDescendant(tripsTree(), 'italy', 'trips'), isTrue);
      expect(isDescendant(tripsTree(), 'trips', 'italy'), isFalse);
      expect(isDescendant(tripsTree(), 'family', 'trips'), isFalse);
      expect(isDescendant(tripsTree(), 'trips', 'trips'), isFalse);
      expect(isDescendant(tripsTree(), 'ghost', 'trips'), isFalse);
    });
  });

  group('flattenForSearch', () {
    test('T-13: matches space-wide and labels each hit with its path', () {
      final albums = [
        album('a1', 'Venice', folderId: 'y2026'),
        album('a2', 'Ventoux', folderId: 'italy'),
        album('a3', 'Rome'),
      ];

      final hits = flattenForSearch(tripsTree(), albums, 'ven');

      expect(hits.map((h) => h.album.id)..sort(), ['a1', 'a2']);
      expect(hits.firstWhere((h) => h.album.id == 'a1').path, ['Trips', '2026']);
      expect(hits.firstWhere((h) => h.album.id == 'a2').path, ['Trips', '2026', 'Italy']);
    });

    test('T-13: gives a root-level album an empty path', () {
      final hits = flattenForSearch(tripsTree(), [album('a3', 'Rome')], 'rome');

      expect(hits.single.path, isEmpty);
    });

    test('T-14: a blank or whitespace-only query returns nothing, not everything', () {
      final albums = [album('a1', 'Rome')];

      expect(flattenForSearch(tripsTree(), albums, ''), isEmpty);
      expect(flattenForSearch(tripsTree(), albums, '   '), isEmpty);
    });
  });
}
```

- [ ] **Step 2: Run and watch fail**

```bash
cd mobile && flutter test test/utils/space_album_folders_test.dart
```

Expected: FAIL — target of URI doesn't exist.

- [ ] **Step 3: Implement the module**

Create `mobile/lib/utils/space_album_folders.dart`. Port the web module's logic; the properties that matter are documented there and re-stated here:

```dart
import 'package:immich_mobile/domain/models/space_album.model.dart';
import 'package:immich_mobile/domain/models/space_album_folder.model.dart';

class FolderNode {
  FolderNode(this.folder) : children = [];
  final SpaceAlbumFolder folder;
  final List<FolderNode> children;
}

class FolderSearchHit {
  const FolderSearchHit(this.album, this.path);
  final SpaceAlbum album;
  final List<String> path;
}

const _previewLimit = 4;

/// Every function here is TOTAL: it must never throw and never loop, on a dangling parentId, a
/// self-reference, or a cycle. Sync makes no ordering guarantee, so those are normal mid-sync
/// states, not corrupt input.
Map<String, SpaceAlbumFolder> _byId(List<SpaceAlbumFolder> folders) => {for (final f in folders) f.id: f};

/// Walks parent links upward with a visited guard, so any cycle terminates.
List<SpaceAlbumFolder> _ancestors(Map<String, SpaceAlbumFolder> index, String folderId) {
  final chain = <SpaceAlbumFolder>[];
  final seen = <String>{};
  var current = index[folderId];
  while (current != null && seen.add(current.id)) {
    chain.add(current);
    final parentId = current.parentId;
    current = parentId == null ? null : index[parentId];
  }
  return chain;
}

bool _isRoot(Map<String, SpaceAlbumFolder> index, SpaceAlbumFolder f) =>
    f.parentId == null || f.parentId == f.id || !index.containsKey(f.parentId);

List<FolderNode> buildFolderTree(List<SpaceAlbumFolder> folders) {
  final index = _byId(folders);
  final nodes = {for (final f in folders) f.id: FolderNode(f)};
  final roots = <FolderNode>[];

  for (final f in folders) {
    final node = nodes[f.id]!;
    if (_isRoot(index, f)) {
      roots.add(node);
    } else {
      nodes[f.parentId]!.children.add(node);
    }
  }

  // A mutual cycle leaves nodes that are neither roots nor reachable from one. Promote them, or
  // they vanish from the tree entirely — worse than showing them at the wrong level.
  final reached = <String>{};
  final stack = [...roots];
  while (stack.isNotEmpty) {
    final node = stack.removeLast();
    if (!reached.add(node.folder.id)) continue;
    stack.addAll(node.children);
  }
  for (final f in folders) {
    if (!reached.contains(f.id)) {
      roots.add(nodes[f.id]!);
      reached.add(f.id);
    }
  }

  return roots;
}

List<SpaceAlbumFolder> folderPath(List<SpaceAlbumFolder> folders, String? folderId) {
  if (folderId == null) return const [];
  return _ancestors(_byId(folders), folderId).reversed.toList();
}

({List<SpaceAlbumFolder> folders, List<SpaceAlbum> albums}) folderContents(
  List<SpaceAlbumFolder> folders,
  List<SpaceAlbum> albums,
  String? folderId,
) {
  final index = _byId(folders);
  if (folderId != null && !index.containsKey(folderId)) {
    return (folders: const [], albums: const []);
  }

  // T-08: an album whose folderId names a folder we have not synced yet falls back to the ROOT,
  // rather than being hidden at every level. On mobile this is routine, not exotic.
  String? effectiveFolder(SpaceAlbum a) =>
      a.folderId != null && index.containsKey(a.folderId) ? a.folderId : null;

  return (
    folders: folders
        .where((f) => folderId == null ? _isRoot(index, f) : f.parentId == folderId && f.id != folderId)
        .toList(),
    albums: albums.where((a) => effectiveFolder(a) == folderId).toList(),
  );
}

Set<String> _subtreeIds(List<SpaceAlbumFolder> folders, String folderId) {
  final childrenByParent = <String, List<String>>{};
  for (final f in folders) {
    if (f.parentId != null && f.parentId != f.id) {
      childrenByParent.putIfAbsent(f.parentId!, () => []).add(f.id);
    }
  }
  final ids = <String>{};
  final stack = [folderId];
  while (stack.isNotEmpty) {
    final current = stack.removeLast();
    if (!ids.add(current)) continue;
    stack.addAll(childrenByParent[current] ?? const []);
  }
  return ids;
}

List<SpaceAlbum> _albumsInSubtree(List<SpaceAlbumFolder> folders, List<SpaceAlbum> albums, String folderId) {
  final ids = _subtreeIds(folders, folderId);
  return albums.where((a) => a.folderId != null && ids.contains(a.folderId)).toList();
}

int recursiveAlbumCount(List<SpaceAlbumFolder> folders, List<SpaceAlbum> albums, String folderId) =>
    _albumsInSubtree(folders, albums, folderId).length;

List<SpaceAlbum> folderPreviewAlbums(List<SpaceAlbumFolder> folders, List<SpaceAlbum> albums, String folderId) {
  // Sort FIRST, then take. Take-then-sort returns an arbitrary subset — the web implementation
  // shipped that bug once and it is invisible unless the newest album sits late in the list.
  final inSubtree = _albumsInSubtree(folders, albums, folderId)
    ..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
  return inSubtree.take(_previewLimit).toList();
}

bool isDescendant(List<SpaceAlbumFolder> folders, String candidateId, String ancestorId) {
  final index = _byId(folders);
  if (!index.containsKey(candidateId) || !index.containsKey(ancestorId) || candidateId == ancestorId) {
    return false;
  }
  return _ancestors(index, candidateId).skip(1).any((f) => f.id == ancestorId);
}

List<FolderSearchHit> flattenForSearch(
  List<SpaceAlbumFolder> folders,
  List<SpaceAlbum> albums,
  String query,
) {
  final needle = query.trim().toLowerCase();
  // A blank query means "search is inactive", not "match everything" — the caller uses a non-empty
  // query as the signal to switch into flattened mode at all.
  if (needle.isEmpty) return const [];

  final index = _byId(folders);
  return albums.where((a) => a.name.toLowerCase().contains(needle)).map((a) {
    final path = a.folderId == null
        ? <String>[]
        : _ancestors(index, a.folderId!).reversed.map((f) => f.name).toList();
    return FolderSearchHit(a, path);
  }).toList();
}
```

- [ ] **Step 4: Run to verify pass**

```bash
cd mobile && flutter test test/utils/space_album_folders_test.dart
```

Expected: PASS (14 tests).

- [ ] **Step 5: Teeth-check the two subtle ones**

Change `folderPreviewAlbums` to take-then-sort and confirm **T-10 fails**. Restore. Then make `folderContents` drop albums whose folder is missing (remove the `effectiveFolder` fallback) and confirm **T-08 fails**. Restore. Report both observations — these two are the cases most likely to be "simplified" later by someone who does not know why they are there.

- [ ] **Step 6: Commit**

```bash
cd .. && git add mobile/lib/utils mobile/test/utils
git commit -m "feat(mobile): add the space album folder tree module"
```

---

## Task 7: Mobile — repository queries

**Implements:** R-01–R-06.

**Files:**

- Modify: `mobile/lib/infrastructure/repositories/space_album.repository.dart`
- Modify: `mobile/lib/domain/models/space_album.model.dart`
- Modify: `mobile/test/medium/repositories/space_album_repository_test.dart`

**Interfaces:**

- Produces: `SpaceAlbumRepository.watchFolders(String spaceId) → Stream<List<SpaceAlbumFolder>>`; `SpaceAlbum` gains `final String? folderId`.

- [ ] **Step 1: Write the failing tests**

Append to `mobile/test/medium/repositories/space_album_repository_test.dart`:

```dart
  group('watchFolders', () {
    // R-01 — folder names are member-only information, so leaking another space's folders into
    // this stream would surface names the user should not see.
    test('R-01: emits only the requested space folders', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);
      final other = await ctx.newSharedSpace(createdById: user.id);
      await ctx.insertSharedSpaceAlbumFolder(spaceId: space.id, id: 'f1', name: 'Trips');
      await ctx.insertSharedSpaceAlbumFolder(spaceId: other.id, id: 'f2', name: 'Secret');

      final folders = await repo.watchFolders(space.id).first;

      expect(folders.map((f) => f.id), ['f1']);
    });

    // R-02
    test('R-02: re-emits when a folder is inserted', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);
      final stream = repo.watchFolders(space.id);
      expect(await stream.first, isEmpty);

      await ctx.insertSharedSpaceAlbumFolder(spaceId: space.id, id: 'f1', name: 'Trips');

      expect(await stream.first, hasLength(1));
    });

    // R-03
    test('R-03: re-emits without a folder after it is deleted', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);
      await ctx.insertSharedSpaceAlbumFolder(spaceId: space.id, id: 'f1', name: 'Trips');
      expect(await repo.watchFolders(space.id).first, hasLength(1));

      await ctx.db.customStatement('DELETE FROM shared_space_album_folder_entity WHERE id = ?', ['f1']);

      expect(await repo.watchFolders(space.id).first, isEmpty);
    });

    // R-06
    test('R-06: folders cascade away when the space is deleted', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);
      await ctx.insertSharedSpaceAlbumFolder(spaceId: space.id, id: 'f1', name: 'Trips');

      await ctx.db.customStatement('DELETE FROM shared_space_entity WHERE id = ?', [space.id]);

      expect(await repo.watchFolders(space.id).first, isEmpty);
    });

    test('R-01: preserves parentId so the tree can be rebuilt', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);
      await ctx.insertSharedSpaceAlbumFolder(spaceId: space.id, id: 'parent', name: 'Trips');
      await ctx.insertSharedSpaceAlbumFolder(spaceId: space.id, id: 'child', parentId: 'parent', name: '2026');

      final folders = await repo.watchFolders(space.id).first;

      expect(folders.firstWhere((f) => f.id == 'child').parentId, 'parent');
    });
  });

  group('watchLinkedAlbums placement', () {
    // R-04
    test('R-04: projects folderId onto the album', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);
      final a1 = await ctx.newSharedSpaceAlbum(name: 'Rome');
      await ctx.insertSharedSpaceAlbumLink(spaceId: space.id, albumId: a1.id, folderId: 'trips');

      final albums = await repo.watchLinkedAlbums(space.id).first;

      expect(albums.single.folderId, 'trips');
    });

    // R-05 — a root album must be null, NOT dropped. Dropping it would empty the root level.
    test('R-05: an album with no placement is projected with a null folderId, not dropped', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);
      final a1 = await ctx.newSharedSpaceAlbum(name: 'Rome');
      await ctx.insertSharedSpaceAlbumLink(spaceId: space.id, albumId: a1.id);

      final albums = await repo.watchLinkedAlbums(space.id).first;

      expect(albums, hasLength(1));
      expect(albums.single.folderId, isNull);
    });
  });
```

- [ ] **Step 2: Run and watch fail**

```bash
cd mobile && flutter test test/medium/repositories/space_album_repository_test.dart
```

Expected: FAIL — `watchFolders` is not defined and `SpaceAlbum` has no `folderId`.

- [ ] **Step 3: Implement `watchFolders` and extend the projection**

`SpaceAlbum.folderId` already exists — Task 4 added it. This task only fills it.

In `space_album.repository.dart`:

```dart
  /// Watches the album folders of [spaceId]. Ordered by name so the UI has a stable default;
  /// level filtering happens in the Dart tree module, not here, so one stream serves every level.
  Stream<List<SpaceAlbumFolder>> watchFolders(String spaceId) {
    final folder = _db.sharedSpaceAlbumFolderEntity;
    final query = _db.select(folder)
      ..where((f) => f.spaceId.equals(spaceId))
      ..orderBy([(f) => OrderingTerm.asc(f.name)]);

    return query.watch().map(
          (rows) => rows
              .map((r) => SpaceAlbumFolder(id: r.id, spaceId: r.spaceId, parentId: r.parentId, name: r.name))
              .toList(),
        );
  }
```

In `watchLinkedAlbums`, add `link.folderId` to the selected columns and pass it into the `SpaceAlbum` construction. Do not add a WHERE on it — every level is served from one stream.

- [ ] **Step 4: Run to verify pass**

```bash
cd mobile && flutter test test/medium/repositories/space_album_repository_test.dart
```

Expected: PASS, with the pre-existing tests in the file still green.

- [ ] **Step 5: Commit**

```bash
cd .. && git add mobile/lib mobile/test
git commit -m "feat(mobile): query space album folders and album placements"
```

---

## Task 8: Mobile — folder actions

**Implements:** A-01–A-06, H-05.

**Files:**

- Modify: `mobile/lib/repositories/shared_space_api.repository.dart`
- Modify: `mobile/lib/providers/infrastructure/space_album_actions.dart`
- Modify: `mobile/test/providers/infrastructure/space_album_actions_test.dart`

**Interfaces:**

- Produces on `SpaceAlbumActions`:

```dart
Future<void> createFolder(String spaceId, String name, {String? parentId});
Future<void> renameFolder(String spaceId, String folderId, String name);
Future<void> moveFolder(String spaceId, String folderId, String? parentId);
Future<void> deleteFolder(String spaceId, String folderId);
Future<void> moveAlbumToFolder(String spaceId, String albumId, String? folderId);
```

- [ ] **Step 1: Write the failing tests**

Append to `space_album_actions_test.dart`, following the file's existing mocktail idiom:

```dart
  group('folder actions', () {
    // A-01–A-05: each operation calls its endpoint, then fires exactly one sync-nudge.
    test('A-01: createFolder calls the API then nudges sync', () async {
      final repo = MockSharedSpaceApiRepository();
      final syncMgr = MockBackgroundSyncManager();
      when(() => repo.createAlbumFolder(any(), any(), parentId: any(named: 'parentId')))
          .thenAnswer((_) async {});
      when(() => syncMgr.syncRemote()).thenAnswer((_) async => true);
      final actions = _makeActions(repo: repo, syncMgr: syncMgr);

      await actions.createFolder(_spaceId, 'Trips', parentId: null);

      verify(() => repo.createAlbumFolder(_spaceId, 'Trips', parentId: null)).called(1);
      verify(() => syncMgr.syncRemote()).called(1);
    });

    test('A-02: renameFolder calls the API then nudges sync', () async {
      final repo = MockSharedSpaceApiRepository();
      final syncMgr = MockBackgroundSyncManager();
      when(() => repo.renameAlbumFolder(any(), any(), any())).thenAnswer((_) async {});
      when(() => syncMgr.syncRemote()).thenAnswer((_) async => true);
      final actions = _makeActions(repo: repo, syncMgr: syncMgr);

      await actions.renameFolder(_spaceId, 'f1', 'Travel');

      verify(() => repo.renameAlbumFolder(_spaceId, 'f1', 'Travel')).called(1);
      verify(() => syncMgr.syncRemote()).called(1);
    });

    test('A-03: moveFolder calls the API then nudges sync', () async {
      final repo = MockSharedSpaceApiRepository();
      final syncMgr = MockBackgroundSyncManager();
      when(() => repo.moveAlbumFolder(any(), any(), any())).thenAnswer((_) async {});
      when(() => syncMgr.syncRemote()).thenAnswer((_) async => true);
      final actions = _makeActions(repo: repo, syncMgr: syncMgr);

      await actions.moveFolder(_spaceId, 'f1', 'f2');

      verify(() => repo.moveAlbumFolder(_spaceId, 'f1', 'f2')).called(1);
      verify(() => syncMgr.syncRemote()).called(1);
    });

    test('A-04: deleteFolder calls the API then nudges sync', () async {
      final repo = MockSharedSpaceApiRepository();
      final syncMgr = MockBackgroundSyncManager();
      when(() => repo.deleteAlbumFolder(any(), any())).thenAnswer((_) async {});
      when(() => syncMgr.syncRemote()).thenAnswer((_) async => true);
      final actions = _makeActions(repo: repo, syncMgr: syncMgr);

      await actions.deleteFolder(_spaceId, 'f1');

      verify(() => repo.deleteAlbumFolder(_spaceId, 'f1')).called(1);
      verify(() => syncMgr.syncRemote()).called(1);
    });

    test('A-05: moveAlbumToFolder calls the API then nudges sync', () async {
      final repo = MockSharedSpaceApiRepository();
      final syncMgr = MockBackgroundSyncManager();
      when(() => repo.setAlbumFolder(any(), any(), any())).thenAnswer((_) async {});
      when(() => syncMgr.syncRemote()).thenAnswer((_) async => true);
      final actions = _makeActions(repo: repo, syncMgr: syncMgr);

      await actions.moveAlbumToFolder(_spaceId, _albumId, 'f1');

      verify(() => repo.setAlbumFolder(_spaceId, _albumId, 'f1')).called(1);
      verify(() => syncMgr.syncRemote()).called(1);
    });

    // A-07 — the invisible one. Moving a folder to the ROOT must send parentId EXPLICITLY null.
    // If the wrapper used the repo's usual `null ? absent : present` idiom the key would be
    // omitted, the server would leave the folder where it was, and nothing else would notice.
    test('A-07: moveFolder to the root sends an explicitly-null parentId', () async {
      final repo = MockSharedSpaceApiRepository();
      final syncMgr = MockBackgroundSyncManager();
      when(() => repo.moveAlbumFolder(any(), any(), any())).thenAnswer((_) async {});
      when(() => syncMgr.syncRemote()).thenAnswer((_) async => true);
      final actions = _makeActions(repo: repo, syncMgr: syncMgr);

      await actions.moveFolder(_spaceId, 'f1', null);

      verify(() => repo.moveAlbumFolder(_spaceId, 'f1', null)).called(1);
      verify(() => syncMgr.syncRemote()).called(1);
    });

    // A-08
    test('A-08: moveAlbumToFolder to the root sends a null folderId', () async {
      final repo = MockSharedSpaceApiRepository();
      final syncMgr = MockBackgroundSyncManager();
      when(() => repo.setAlbumFolder(any(), any(), any())).thenAnswer((_) async {});
      when(() => syncMgr.syncRemote()).thenAnswer((_) async => true);
      final actions = _makeActions(repo: repo, syncMgr: syncMgr);

      await actions.moveAlbumToFolder(_spaceId, _albumId, null);

      verify(() => repo.setAlbumFolder(_spaceId, _albumId, null)).called(1);
      verify(() => syncMgr.syncRemote()).called(1);
    });

    // A-06 — the nudge is deliberately NOT fired on failure; the next regular cycle reconciles.
    // The existing SpaceAlbumActions comment states this, so it is a documented contract, not an
    // implementation detail.
    test('A-06: a failed call propagates and fires NO sync-nudge', () async {
      final repo = MockSharedSpaceApiRepository();
      final syncMgr = MockBackgroundSyncManager();
      when(() => repo.createAlbumFolder(any(), any(), parentId: any(named: 'parentId')))
          .thenThrow(Exception('boom'));
      when(() => syncMgr.syncRemote()).thenAnswer((_) async => true);
      final actions = _makeActions(repo: repo, syncMgr: syncMgr);

      await expectLater(actions.createFolder(_spaceId, 'Trips'), throwsException);

      verifyNever(() => syncMgr.syncRemote());
    });
  });
```

Add a `_makeActions({required repo, required syncMgr})` helper beside the existing `_makeContainer`, or reuse `_makeContainer` and read the actions provider from it — match whichever the file already does.

- [ ] **Step 2: Run and watch fail**

```bash
cd mobile && flutter test test/providers/infrastructure/space_album_actions_test.dart
```

Expected: FAIL — the repository methods and actions do not exist.

- [ ] **Step 3: Add the API wrappers**

In `shared_space_api.repository.dart`, beside `linkAlbum`/`unlinkAlbum`. The generated Dart methods **already exist** — these are thin wrappers:

```dart
  Future<void> createAlbumFolder(String spaceId, String name, {String? parentId}) =>
      checkNull(_api.sharedSpacesApi.createSharedSpaceAlbumFolder(
        spaceId,
        SharedSpaceAlbumFolderCreateDto(name: name, parentId: parentId),
      ));

  Future<void> renameAlbumFolder(String spaceId, String folderId, String name) =>
      _api.sharedSpacesApi.updateSharedSpaceAlbumFolder(
        folderId,
        spaceId,
        SharedSpaceAlbumFolderUpdateDto(name: Optional.present(name)),
      );

  // parentId is Optional.present(...) UNCONDITIONALLY, including when it is null.
  //
  // This is the one place where copying the prevailing repo idiom would introduce a bug. Elsewhere
  // (activity_api.repository.dart:27, drift_album_api_repository.dart:89) the pattern is
  // `x == null ? const Optional.absent() : Optional.present(x)` — but for parentId, null MEANS
  // "move to the space root" and must be SENT. toJson only writes a key when isPresent, so
  // absent() would omit parentId entirely and the server would leave the folder where it was —
  // a silent no-op. The field is Optional<String?>, so present(null) is valid and serialises
  // `parentId: null`. A-07 is the test that catches this.
  Future<void> moveAlbumFolder(String spaceId, String folderId, String? parentId) =>
      _api.sharedSpacesApi.updateSharedSpaceAlbumFolder(
        folderId,
        spaceId,
        SharedSpaceAlbumFolderUpdateDto(parentId: Optional.present(parentId)),
      );

  Future<void> deleteAlbumFolder(String spaceId, String folderId) =>
      _api.sharedSpacesApi.deleteSharedSpaceAlbumFolder(folderId, spaceId);

  Future<void> setAlbumFolder(String spaceId, String albumId, String? folderId) =>
      _api.sharedSpacesApi.setSharedSpaceAlbumFolder(
        albumId,
        spaceId,
        SharedSpaceAlbumFolderMoveAlbumDto(folderId: folderId),
      );
```

Parameter order is already verified against the generated client: `createSharedSpaceAlbumFolder(id, dto)`, `updateSharedSpaceAlbumFolder(folderId, id, dto)`, `deleteSharedSpaceAlbumFolder(folderId, id)`, `setSharedSpaceAlbumFolder(albumId, id, dto)` — the generator orders path params alphabetically, not as the URL reads. `checkNull` is the file's existing null-check helper and `createSharedSpaceAlbumFolder` returns a nullable DTO, so it is the right wrapper there.

`SharedSpaceAlbumFolderMoveAlbumDto({required this.folderId})` is a PLAIN required nullable, not an Optional — so `setAlbumFolder` passes `folderId` directly, with no wrapper. Only the UPDATE dto is three-state.

- [ ] **Step 4: Add the actions**

In `space_album_actions.dart`, extend the doc comment's operation list and add the five methods, each following the existing shape exactly — API call, then `await _syncManager.syncRemote()`, with no try/catch so the exception propagates and the nudge is skipped:

```dart
  /// Create a folder in [spaceId], optionally nested under [parentId].
  Future<void> createFolder(String spaceId, String name, {String? parentId}) async {
    await _repo.createAlbumFolder(spaceId, name, parentId: parentId);
    await _syncManager.syncRemote();
  }
```

and the same shape for `renameFolder`, `moveFolder`, `deleteFolder`, `moveAlbumToFolder`.

- [ ] **Step 4b: Assert the DTO the wrapper actually builds**

The A-07 test above verifies `SpaceAlbumActions` passes null through, but it mocks the repository,
so it cannot see the `Optional` decision. Add one test in the same file that exercises the REAL
`SharedSpaceApiRepository` against a mocked generated api, asserting the DTO it constructs:

```dart
    test('A-07: the move wrapper sends parentId as present-null, not absent', () {
      // Optional<String?> — present(null) serialises `parentId: null`; absent() omits the key.
      final dto = SharedSpaceAlbumFolderUpdateDto(parentId: const Optional.present(null));

      expect(dto.parentId.isPresent, isTrue);
      expect(dto.toJson().containsKey('parentId'), isTrue);
      expect(dto.toJson()['parentId'], isNull);

      final absent = SharedSpaceAlbumFolderUpdateDto();
      expect(absent.toJson().containsKey('parentId'), isFalse);
    });
```

This is the assertion that actually pins the fix: it fails the moment someone "tidies" the wrapper
to the `null ? absent : present` idiom used elsewhere in this repo.

- [ ] **Step 5: Run to verify pass, then teeth-check A-06**

```bash
cd mobile && flutter test test/providers/infrastructure/space_album_actions_test.dart
```

Expected: PASS. Then wrap `createFolder`'s body in a try/catch that swallows and still nudges, confirm **A-06 fails**, and restore. Report the observation.

- [ ] **Step 6: Confirm the version gate (H-05)**

Add one test asserting that when the server version predates folder support, the sync service does not request `SharedSpaceAlbumFoldersV1` while still requesting the album streams. Model it on however the existing space-album version gate is tested; if no such test exists, put it in `space_album_actions_test.dart`'s file only if the gate is reachable from there — otherwise place it beside the existing `serverVersion` gate logic and say where you put it.

- [ ] **Step 7: Commit**

```bash
cd .. && git add mobile/lib mobile/test
git commit -m "feat(mobile): add space album folder mutations"
```

---

## Task 9: Mobile — folder card and picker sheet

**Implements:** U-06, U-07, U-08, U-12.

**Files:**

- Create: `mobile/lib/presentation/widgets/spaces/space_album_folder_card.widget.dart`
- Create: `mobile/lib/presentation/widgets/spaces/space_album_folder_picker.widget.dart`
- Create: `mobile/test/presentation/widgets/spaces/space_album_folder_card_test.dart`
- Modify: `i18n/en.json`

**Interfaces:**

- Produces:

```dart
class SpaceAlbumFolderCard extends StatelessWidget {
  const SpaceAlbumFolderCard({
    required this.folder,
    required this.albumCount,
    required this.previewAlbums,
    required this.canEdit,
    this.onTap, this.onRename, this.onMove, this.onDelete,
  });
}

/// Shows a folder tree; returns the chosen destination id, or null for the space root.
/// Returns `(picked: false, folderId: null)` when dismissed.
Future<({bool picked, String? folderId})> showSpaceAlbumFolderPicker(
  BuildContext context, {
  required List<SpaceAlbumFolder> folders,
  String? excludeFolderId,
  String? currentFolderId,
});
```

- [ ] **Step 1: Add the i18n keys**

Several `space_album_folder_*` keys already exist in `i18n/en.json` from the web work — reuse them. Add only what is missing for mobile, in alphabetical position. Check first:

```bash
grep -o '"space_album_folder_[a-z_]*"' i18n/en.json | sort -u
```

- [ ] **Step 2: Write the failing widget tests**

Create `mobile/test/presentation/widgets/spaces/space_album_folder_card_test.dart`, following the idiom of `mobile/test/widgets/spaces/space_card_test.dart` — read it first for the pump/wrapper helper this repo uses:

```dart
    // U-12 — a folder holding only subfolders must never read "0 albums"; the count is recursive.
    testWidgets('U-12: shows the recursive album count', (tester) async {
      await tester.pumpWidget(wrap(SpaceAlbumFolderCard(
        folder: folder('trips', 'Trips'),
        albumCount: 12,
        previewAlbums: const [],
        canEdit: true,
      )));

      expect(find.textContaining('12'), findsOneWidget);
    });

    // U-06 — viewers get no management affordances at all.
    testWidgets('U-06: a viewer sees no overflow menu', (tester) async {
      await tester.pumpWidget(wrap(SpaceAlbumFolderCard(
        folder: folder('trips', 'Trips'),
        albumCount: 1,
        previewAlbums: const [],
        canEdit: false,
      )));

      expect(find.byKey(const Key('space-album-folder-card-menu')), findsNothing);
    });

    testWidgets('U-06: an editor sees the overflow menu', (tester) async {
      await tester.pumpWidget(wrap(SpaceAlbumFolderCard(
        folder: folder('trips', 'Trips'),
        albumCount: 1,
        previewAlbums: const [],
        canEdit: true,
      )));

      expect(find.byKey(const Key('space-album-folder-card-menu')), findsOneWidget);
    });
```

and for the picker:

```dart
    // U-07 — offering a folder's own subtree as a destination would guarantee a server 400.
    // Disabling it means the illegal choice is never tappable in the first place.
    testWidgets('U-07: disables the moved folder and its descendants', (tester) async {
      await tester.pumpWidget(wrapPicker(folders: tripsTree(), excludeFolderId: 'trips'));
      await tester.pumpAndSettle();

      expect(tileEnabled(tester, 'trips'), isFalse);
      expect(tileEnabled(tester, 'y2026'), isFalse);
      expect(tileEnabled(tester, 'italy'), isFalse);
      expect(tileEnabled(tester, 'family'), isTrue);
    });

    // U-08 — moving an ALBUM has no subtree to exclude, so everything stays selectable.
    testWidgets('U-08: leaves every folder selectable when nothing is excluded', (tester) async {
      await tester.pumpWidget(wrapPicker(folders: tripsTree(), excludeFolderId: null));
      await tester.pumpAndSettle();

      for (final id in ['trips', 'y2026', 'italy', 'family']) {
        expect(tileEnabled(tester, id), isTrue);
      }
    });
```

Write `tileEnabled` as a helper that finds the tile by key `Key('folder-option-$id')` and reads its `onTap == null` state — do not assert on visual styling, which would pass regardless.

- [ ] **Step 3: Run and watch fail**

```bash
cd mobile && flutter test test/presentation/widgets/spaces/space_album_folder_card_test.dart
```

Expected: FAIL — widgets do not exist.

- [ ] **Step 4: Build the folder card**

Create the card widget, mirroring the album card's structure in `space_albums.page.dart` (cover area, name, count) so the two line up in one grid. Give the overflow menu `Key('space-album-folder-card-menu')` and render it only when `canEdit`. The cover is a small collage of up to four `previewAlbums` thumbnails, falling back to a folder glyph when the list is empty — reuse `thumbnail.widget.dart` for each tile.

- [ ] **Step 5: Build the picker sheet**

Create the picker, rendering `buildFolderTree` output as an indented list, each row keyed `Key('folder-option-$id')`, plus a root option keyed `Key('folder-option-root')`. A row is disabled when `excludeFolderId != null && (id == excludeFolderId || isDescendant(folders, id, excludeFolderId))` — use the Task 6 module rather than reimplementing the walk.

- [ ] **Step 6: Run to verify pass, then teeth-check U-07**

```bash
cd mobile && flutter test test/presentation/widgets/spaces/space_album_folder_card_test.dart
```

Expected: PASS. Then change `isDisabled` to always return false, confirm **U-07 fails** while U-08 stays green, and restore. Report the observation.

- [ ] **Step 7: Commit**

```bash
cd .. && git add mobile/lib/presentation mobile/test/widgets i18n/en.json
git commit -m "feat(mobile): add the space album folder card and picker"
```

---

## Task 10: Mobile — page integration and navigation

**Implements:** U-01, U-02, U-03, U-04, U-05, U-09, U-10, U-11, U-13.

**Files:**

- Modify: `mobile/lib/pages/library/spaces/space_albums.page.dart`
- Modify: `mobile/lib/routing/router.dart`
- Modify: `mobile/lib/providers/infrastructure/space_album.provider.dart`
- Modify: `mobile/test/presentation/pages/space_albums_page_test.dart` _(EXISTS — extend, do not overwrite)_

- [ ] **Step 1: Write the failing tests**

Create `mobile/test/presentation/pages/space_albums_page_test.dart`. Build a pump helper that overrides the folder and album providers with fixed lists so the page renders without a database:

```dart
    // U-01
    testWidgets('U-01: renders folders before albums', (tester) async {
      await pumpPage(tester, folders: [folder('trips', 'Trips')], albums: [album('a1', 'Rome')]);

      final folderY = tester.getTopLeft(find.byType(SpaceAlbumFolderCard)).dy;
      final albumY = tester.getTopLeft(find.byKey(const Key('space-album-card-a1'))).dy;
      expect(folderY, lessThan(albumY));
    });

    // U-04 — a space with no folders must look exactly as it did before this feature.
    testWidgets('U-04: a space with no folders renders the flat list unchanged', (tester) async {
      await pumpPage(tester, folders: const [], albums: [album('a1', 'Rome')]);

      expect(find.byType(SpaceAlbumFolderCard), findsNothing);
      expect(find.text('Rome'), findsOneWidget);
    });

    // U-05 — reusing the space-level empty state here would wrongly claim the space has no albums.
    testWidgets('U-05: an empty folder shows the folder-specific empty state', (tester) async {
      await pumpPage(tester, folders: [folder('trips', 'Trips')], albums: const [], folderId: 'trips');

      expect(find.byKey(const Key('space-album-folder-empty')), findsOneWidget);
      expect(find.byKey(const Key('space-albums-empty')), findsNothing);
    });

    // U-09
    testWidgets('U-09: a query hides folders and shows space-wide hits with paths', (tester) async {
      await pumpPage(
        tester,
        folders: [folder('trips', 'Trips')],
        albums: [album('a1', 'Venice', folderId: 'trips'), album('a2', 'Rome')],
      );

      await tester.enterText(find.byKey(const Key('space-albums-search-field')), 'ven');
      await tester.pumpAndSettle();

      expect(find.byType(SpaceAlbumFolderCard), findsNothing);
      expect(find.text('Venice'), findsOneWidget);
      expect(find.textContaining('Trips'), findsWidgets);
    });

    // U-13 — the page ALREADY renders a no-match state (Key('space-albums-no-match')) when a
    // query filters everything out. Switching search to tree-wide flattening must PRESERVE it;
    // replacing it with a blank grid would silently regress existing behaviour.
    testWidgets('U-13: a tree-wide search matching nothing shows the no-match state', (tester) async {
      await pumpPage(tester, folders: [folder('trips', 'Trips')], albums: [album('a1', 'Rome')]);

      await tester.enterText(find.byKey(const Key('space-albums-search-field')), 'zzzz');
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('space-albums-no-match')), findsOneWidget);
      expect(find.byType(SpaceAlbumFolderCard), findsNothing);
    });

    // U-10
    testWidgets('U-10: clearing the query returns to the current level', (tester) async {
      await pumpPage(tester, folders: [folder('trips', 'Trips')], albums: [album('a1', 'Rome')]);

      await tester.enterText(find.byKey(const Key('space-albums-search-field')), 'zzz');
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('space-albums-search-field')), '');
      await tester.pumpAndSettle();

      expect(find.byType(SpaceAlbumFolderCard), findsOneWidget);
      expect(find.text('Rome'), findsOneWidget);
    });

    // U-11 — the local-first difference from web: the screen can be invalidated underneath the
    // user by an incoming sync at any moment, not only on navigation. If the folder we are inside
    // disappears from the stream, we must pop rather than sit on a folder that no longer exists.
    testWidgets('U-11: pops when the folder you are inside disappears from the stream', (tester) async {
      final controller = StreamController<List<SpaceAlbumFolder>>();
      await pumpPageWithFolderStream(tester, controller.stream, folderId: 'trips');
      controller.add([folder('trips', 'Trips')]);
      await tester.pumpAndSettle();

      controller.add(const []);
      await tester.pumpAndSettle();

      expect(find.byType(SpaceAlbumsPage), findsNothing);
    });
```

U-02 and U-03 are navigation; assert them with a mock `StackRouter` or by observing the route stack, matching whatever the repo's existing route tests do — search `mobile/test` for an existing `auto_route` navigation assertion and follow it.

- [ ] **Step 2: Run and watch fail**

```bash
cd mobile && flutter test test/presentation/pages/space_albums_page_test.dart
```

Expected: FAIL.

- [ ] **Step 3: Add the optional route parameter**

In `space_albums.page.dart`, add `final String? folderId;` to the page constructor. Regenerate the router:

```bash
cd mobile && dart run build_runner build --delete-conflicting-outputs
```

`SpaceAlbumsRoute` then accepts `folderId`.

- [ ] **Step 4: Wire folders into the page**

Add a folders provider (mirroring the existing album provider in `space_album.provider.dart`, backed by `watchFolders`). In the page:

- derive `contents = folderContents(folders, albums, widget.folderId)`
- render `contents.folders` as `SpaceAlbumFolderCard`s above the album cards, sorted by name honouring the existing sort direction
- app-bar title: the folder's name when `folderId != null`, else the space name
- tapping a folder pushes `SpaceAlbumsRoute(spaceId: spaceId, canEdit: canEdit, folderId: folder.id)`
- when `searchQuery` is non-empty, render `flattenForSearch(...)` hits instead, each with its path line, and hide the folder cards. **Keep the existing `_NoMatch` widget** (`Key('space-albums-no-match')`) for the zero-hit case — pre-existing behaviour that tree-wide search must preserve, not replace with an empty grid (U-13)
- an empty folder renders a folder-specific empty state keyed `space-album-folder-empty`
- U-11: watch the folder stream; if `folderId != null` and no folder with that id is present **after the stream has emitted at least once**, pop the route

The "after at least once" guard matters: popping on the initial empty emission would bounce the user out before the first sync completes.

- [ ] **Step 5: Run to verify pass, then teeth-check U-11 and U-05**

```bash
cd mobile && flutter test test/presentation/pages/space_albums_page_test.dart
```

Expected: PASS. Then remove the pop-on-missing-folder logic, confirm **U-11 fails**, restore. Then point the empty state at the space-level widget, confirm **U-05 fails**, restore. Report both.

- [ ] **Step 6: Commit**

```bash
cd .. && git add mobile/lib mobile/test
git commit -m "feat(mobile): browse space album folders on the albums page"
```

---

## Task 11: Final gates and the web follow-up

- [ ] **Step 1: Run every gate**

```bash
cd mobile
flutter pub get
dart run easy_localization:generate -S ../i18n && dart run bin/generate_keys.dart
flutter test
dart analyze --fatal-infos lib test
dart format --set-exit-if-changed lib test

cd ../server
pnpm check && pnpm lint && pnpm exec prettier --check "src/**/*.ts"
pnpm vitest --run --config test/vitest.config.mjs
pnpm exec vitest run --config test/vitest.config.medium.mjs shared-space-album-folder-sync.spec.ts
pnpm exec vitest run --config test/vitest.config.medium.mjs shared-space-album-link-sync.spec.ts

cd .. && make sql          # requires a running dev DB; verify the diff is ADDITIVE only
```

Report the actual output of each. `dart analyze --fatal-infos` and `dart format` are two separate CI gates — an analyzer _info_ fails the build.

- [ ] **Step 2: Fix the web divergence found by T-08**

The web `getFolderContents` hides an album whose `folderId` names a folder absent from the list; mobile now falls it back to the root. The behaviour must not differ by platform, and "album vanishes" is the worse failure on either.

In `web/src/lib/utils/space-album-folders.ts`, apply the same fallback in `getFolderContents`, and add a web unit test mirroring T-08. Run `cd web && pnpm vitest --run src/lib/utils/space-album-folders.spec.ts` plus the full web suite.

- [ ] **Step 3: Commit**

```bash
git add web/src mobile server
git commit -m "fix(web): show an album at the root when its folder is not loaded"
```

---

## Scenario coverage matrix

All 53 spec scenario IDs. Verify mechanically with
`grep -oE '\b[THRVAU]-[0-9]{2}\b'` over the spec and over this plan — the sets must match.

| Group                | IDs                        | Task |
| -------------------- | -------------------------- | ---- |
| Tree module          | T-01–T-14                  | 6    |
| Repository           | R-01–R-06                  | 7    |
| Migration            | R-07, R-08                 | 4    |
| Mobile sync handlers | H-01–H-04, H-06            | 5    |
| Version gate         | H-05                       | 8    |
| Server sync          | V-01–V-05, V-07            | 2    |
| Link payload         | V-06                       | 3    |
| Actions              | A-01–A-08                  | 8    |
| Folder card + picker | U-06, U-07, U-08, U-12     | 9    |
| Page integration     | U-01–U-05, U-09–U-11, U-13 | 10   |

**Teeth checks required** (break the line, watch the named test fail, restore, report):
V-02 and V-04 (Task 2), T-08 and T-10 (Task 6), A-06 and A-07 (Task 8), U-07 (Task 9), U-05 and
U-11 (Task 10).

These are the nine assertions whose failure mode is silent: a missing privacy gate, an album that
vanishes, a preview showing the wrong four, a nudge fired on failure, a move-to-root that silently does nothing, an illegal destination offered,
the wrong empty state, and a screen stranded on a deleted folder.
