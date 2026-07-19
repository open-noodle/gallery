# Slice 1 — Album-linked asset visibility purge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. This is **Slice 1** of the spec `docs/superpowers/specs/2026-07-07-space-album-library-visibility-purge-design.md`. Slice 2 (library) and Slice 3 (cross-path/invariants) are separate plans — **do not implement them here.**

**Goal:** When an owner flips an album-linked space asset to `Hidden`, purge it from already-synced member devices; on restore to `Timeline`/`Archive`, re-add it. Server-side only, mirroring Slice 4.B's direct-path mechanism, via a dedicated space-only audit table `shared_space_album_asset_audit`.

**Architecture:** New append-only audit table (explicit-emit, no trigger). `SharedSpaceRepository.emitAlbumAssetVisibilityPurge/Restore` write/bump it. `SharedSpaceAlbumToAssetSync.getDeletes` is augmented to `UNION` the new table with the existing `album_asset_audit` under the same checkpoint. `asset.service.updateAll` dispatches purge on `Hidden`, restore on `Timeline`/`Archive` (`Locked` is already covered by `removeAssetsFromAll`).

**Tech Stack:** NestJS + Kysely, Vitest medium tests (testcontainers Postgres), fork migrations in `migrations-gallery/`.

## Global Constraints

- Server imports use the `src/` path alias — **no relative imports**.
- Fork migrations go in `server/src/schema/migrations-gallery/` with round timestamps; the newest existing is `1779300000000`, so use **`1779309791424`** for this slice's table. (Slice 2 uses `1781181889688`.)
- Prettier: 120-col, single quotes, trailing commas, semicolons. ESLint zero-warnings.
- Medium tests require Docker (testcontainers). Run from `server/`.
- `make sql` regenerates decorated-query docs and **requires a running DB** — never run it without one (it deletes query files).
- Reuse existing entity types — **no new `SyncRequestType`/`SyncEntityType`, no mobile change.**

---

## File map

- **Create:** `server/src/schema/tables/shared-space-album-asset-audit.table.ts` — the audit table class.
- **Create:** `server/src/schema/migrations-gallery/1779309791424-SharedSpaceAlbumAssetAuditTable.ts` — the migration.
- **Modify:** `server/src/schema/index.ts` (or wherever table classes are registered) — register the new table so the `DB` type includes it.
- **Modify:** `server/src/repositories/shared-space.repository.ts` — add `emitAlbumAssetVisibilityPurge` + `emitAlbumAssetVisibilityRestore`.
- **Modify:** `server/src/repositories/sync.repository.ts` — augment `SharedSpaceAlbumToAssetSync.getDeletes` (union) + add `cleanupAuditTable`.
- **Modify:** `server/src/services/sync.service.ts` — add `sharedSpaceAlbumToAsset.cleanupAuditTable` to the prune loop.
- **Modify:** `server/src/services/asset.service.ts` — album dispatch in `updateAll`.
- **Modify:** `scripts/revert-to-immich/` — `DROP TABLE shared_space_album_asset_audit`.
- **Create:** `server/test/medium/specs/sync/sync-shared-space-album-visibility-purge.spec.ts` — A1–A9.
- **Modify:** `server/src/services/asset.service.spec.ts` — album dispatch unit rows.

---

### Task 1: Audit table + migration + registration

**Files:**

- Create: `server/src/schema/tables/shared-space-album-asset-audit.table.ts`
- Create: `server/src/schema/migrations-gallery/1779309791424-SharedSpaceAlbumAssetAuditTable.ts`
- Modify: schema registration (find where `SharedSpaceAssetAuditTable` is imported/listed and add the new class next to it)

**Interfaces:**

- Produces: DB table `shared_space_album_asset_audit(id uuidv7 PK, albumId uuid, assetId uuid, deletedAt timestamptz)`; Kysely type `DB['shared_space_album_asset_audit']`.

- [ ] **Step 1: Create the table class** (mirror `shared-space-asset-audit.table.ts`)

```typescript
import { Column, CreateDateColumn, Generated, Table, Timestamp } from '@immich/sql-tools';
import { PrimaryGeneratedUuidV7Column } from 'src/decorators';

@Table('shared_space_album_asset_audit')
export class SharedSpaceAlbumAssetAuditTable {
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

- [ ] **Step 2: Register the table** — grep for `SharedSpaceAssetAuditTable` in `server/src/schema/` (it is imported into the schema table list). Add `SharedSpaceAlbumAssetAuditTable` to the same import + array so the `DB` type and schema include it.

- [ ] **Step 3: Create the migration** (mirror an existing `migrations-gallery` CREATE-TABLE migration)

```typescript
import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE "shared_space_album_asset_audit" (
      "id" uuid NOT NULL DEFAULT immich_uuid_v7(),
      "albumId" uuid NOT NULL,
      "assetId" uuid NOT NULL,
      "deletedAt" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT "shared_space_album_asset_audit_pkey" PRIMARY KEY ("id")
    );
  `.execute(db);
  await sql`CREATE INDEX "shared_space_album_asset_audit_albumId_idx" ON "shared_space_album_asset_audit" ("albumId")`.execute(
    db,
  );
  await sql`CREATE INDEX "shared_space_album_asset_audit_assetId_idx" ON "shared_space_album_asset_audit" ("assetId")`.execute(
    db,
  );
  await sql`CREATE INDEX "shared_space_album_asset_audit_deletedAt_idx" ON "shared_space_album_asset_audit" ("deletedAt")`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS "shared_space_album_asset_audit"`.execute(db);
}
```

- [ ] **Step 4: Verify build + type** — `cd server && pnpm build` (or `make check-server`). Expected: compiles; `DB` type now has `shared_space_album_asset_audit`.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(spaces): add shared_space_album_asset_audit table + migration"`

---

### Task 2: `emitAlbumAssetVisibilityPurge` + A1 (purge on Hidden)

**Files:**

- Modify: `server/src/repositories/shared-space.repository.ts`
- Modify: `server/src/repositories/sync.repository.ts` (`SharedSpaceAlbumToAssetSync.getDeletes` union)
- Test: `server/test/medium/specs/sync/sync-shared-space-album-visibility-purge.spec.ts`

**Interfaces:**

- Produces: `SharedSpaceRepository.emitAlbumAssetVisibilityPurge(assetIds: string[]): Promise<void>` — inserts one `shared_space_album_asset_audit` row per `(albumId, assetId)` where the album is space-linked.
- Consumes: `accessibleSpaceAlbums(eb, userId)` (from `src/utils/shared-space-album-scope`); `SyncEntityType.SharedSpaceAlbumToAssetDeleteV1`; `SyncRequestType.SharedSpaceAlbumToAssetsV1`.

- [ ] **Step 1: Write the failing test A1** — new file `sync-shared-space-album-visibility-purge.spec.ts`. Seed a space owned by `auth`, `auth` as Owner, an album owned by `auth`, an asset in that album, and link the album to the space. Sync `SharedSpaceAlbumToAssetsV1`, ack, then purge and assert a delete.

```typescript
// Slice 1 (#753 follow-up #1): purge already-synced ALBUM-linked space assets
// from member devices when the owner flips an asset OUT of the space-shareable
// set (Timeline/Archive) to Hidden, and re-add it on restore. Locked is already
// covered by asset.service.updateAll -> albumRepository.removeAssetsFromAll,
// which deletes the album_asset row and fires the shared album_asset_audit.
// This slice closes only the Hidden gap, via a space-only audit table
// (shared_space_album_asset_audit) unioned into SharedSpaceAlbumToAssetSync.
import { Kysely } from 'kysely';
import { SharedSpaceRole, SyncEntityType, SyncRequestType } from 'src/enum';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { DB } from 'src/schema';
import { SyncTestContext } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = async (db?: Kysely<DB>) => {
  const ctx = new SyncTestContext(db || defaultDatabase);
  const { auth, user, session } = await ctx.newSyncAuthUser();
  return { auth, user, session, ctx };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

// Seed a space owned by `ownerId`, a linked album containing one asset. `member`
// (defaults to owner) is added to the space so it can sync the album asset.
const seedSpaceWithAlbumAsset = async (
  ctx: SyncTestContext,
  ownerId: string,
  opts: { memberId?: string; role?: SharedSpaceRole; showInTimeline?: boolean } = {},
) => {
  const { space } = await ctx.newSharedSpace({ createdById: ownerId });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: ownerId, role: SharedSpaceRole.Owner });
  if (opts.memberId && opts.memberId !== ownerId) {
    await ctx.newSharedSpaceMember({
      spaceId: space.id,
      userId: opts.memberId,
      role: opts.role ?? SharedSpaceRole.Editor,
    });
  }
  const { album } = await ctx.newAlbum({ ownerId });
  const { asset } = await ctx.newAsset({ ownerId });
  await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
  await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, showInTimeline: opts.showInTimeline ?? true });
  return { space, album, asset };
};

describe('SharedSpaceAlbumToAssetSync — album visibility purge/restore', () => {
  it('A1: emits a delete for an album-linked asset flipped to Hidden after it was acked', async () => {
    const { auth, ctx } = await setup();
    const { album, asset } = await seedSpaceWithAlbumAsset(ctx, auth.user.id);

    const initial = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
    await ctx.syncAckAll(auth, initial);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);

    await ctx.get(SharedSpaceRepository).emitAlbumAssetVisibilityPurge([asset.id]);

    const next = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
    const deletes = next.filter((r: { type: string }) => r.type === SyncEntityType.SharedSpaceAlbumToAssetDeleteV1);
    expect(deletes).toHaveLength(1);
    expect((deletes[0] as { data: { albumId: string; assetId: string } }).data).toMatchObject({
      albumId: album.id,
      assetId: asset.id,
    });
  });
});
```

- [ ] **Step 2: Run A1 → red.** `cd server && pnpm test -- --run test/medium/specs/sync/sync-shared-space-album-visibility-purge.spec.ts -t A1`. Expected: FAIL — `emitAlbumAssetVisibilityPurge is not a function`.

- [ ] **Step 3: Add `emitAlbumAssetVisibilityPurge`** to `shared-space.repository.ts` (mirror `emitDirectAssetVisibilityPurge`; scope to space-linked albums):

```typescript
@GenerateSql({ params: [[DummyValue.UUID]] })
async emitAlbumAssetVisibilityPurge(assetIds: string[]) {
  if (assetIds.length === 0) {
    return;
  }

  await this.db
    .insertInto('shared_space_album_asset_audit')
    .columns(['albumId', 'assetId'])
    .expression(
      this.db
        .selectFrom('album_asset')
        .select(['album_asset.albumId', 'album_asset.assetId'])
        .where('album_asset.assetId', 'in', assetIds)
        .where('album_asset.albumId', 'in', (eb) =>
          eb.selectFrom('shared_space_album').select('shared_space_album.albumId'),
        ),
    )
    .execute();
}
```

(Ensure `DummyValue` and `GenerateSql` are already imported in this file — they are used elsewhere; if not, add from `src/decorators`.)

- [ ] **Step 4: Augment `SharedSpaceAlbumToAssetSync.getDeletes`** to union the new table under one checkpoint. Both audit tables have identical `(id, assetId, albumId)` columns. **Order by `id` over the whole union, not per-arm** (per spec §5.2 / X4):

```typescript
@GenerateSql({ params: [dummyQueryOptions], stream: true })
getDeletes(options: SyncQueryOptions) {
  const { userId, nowId, ack } = options;
  const arm = (t: 'album_asset_audit' | 'shared_space_album_asset_audit') =>
    this.db
      .selectFrom(t)
      .select(['id', 'assetId', 'albumId'])
      .where('id', '<', nowId)
      .$if(!!ack, (qb) => qb.where('id', '>', ack!.updateId))
      .where('albumId', 'in', (eb) => accessibleSpaceAlbums(eb, userId));
  return arm('album_asset_audit').union(arm('shared_space_album_asset_audit')).orderBy('id', 'asc').stream();
}
```

If Kysely's typing rejects the shared `arm` helper across two table literals, inline the two arms explicitly with the same bounds and union them — the SQL shape (two checkpoint-bounded, scope-filtered selects, unioned, single trailing `ORDER BY id ASC`) is what matters. Do **not** leave a per-arm `ORDER BY` that would make the union SQL invalid.

- [ ] **Step 5: Run A1 → green.** Same command. Expected: PASS.
- [ ] **Step 6: `make check-server`** clean.
- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat(spaces): purge album-linked space assets on Hidden (A1)"`

---

### Task 3: `emitAlbumAssetVisibilityRestore` + A2 (re-add on restore)

**Files:** Modify `shared-space.repository.ts`; add test A2 to the spec.

**Interfaces:** Produces `SharedSpaceRepository.emitAlbumAssetVisibilityRestore(assetIds: string[]): Promise<void>` — bumps `album_asset.updateId` for space-linked albums so `getUpserts` (membership) + `SharedSpaceAlbumAssetSync.getCreates` (metadata) re-emit.

- [ ] **Step 1: Write A2** — after A1's setup, sync + ack, purge + ack the delete, then restore and assert the membership upsert returns.

```typescript
it('A2: re-emits the album membership when the asset is restored to Timeline after a purge', async () => {
  const { auth, ctx } = await setup();
  const { album, asset } = await seedSpaceWithAlbumAsset(ctx, auth.user.id);

  const initial = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
  await ctx.syncAckAll(auth, initial);

  await ctx.get(SharedSpaceRepository).emitAlbumAssetVisibilityPurge([asset.id]);
  const afterPurge = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
  await ctx.syncAckAll(auth, afterPurge);
  await ctx.assertSyncIsComplete(auth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);

  await ctx.get(SharedSpaceRepository).emitAlbumAssetVisibilityRestore([asset.id]);

  const next = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
  const upserts = next.filter((r: { type: string }) => r.type === SyncEntityType.SharedSpaceAlbumToAssetV1);
  const emitted = upserts.map((e) => (e as { data: { albumId: string; assetId: string } }).data);
  expect(emitted).toContainEqual(expect.objectContaining({ albumId: album.id, assetId: asset.id }));
});
```

- [ ] **Step 2: Run A2 → red** (`-t A2`). Expected: FAIL — `emitAlbumAssetVisibilityRestore is not a function`.
- [ ] **Step 3: Add the method** (mirror `emitDirectAssetVisibilityRestore`):

```typescript
@GenerateSql({ params: [[DummyValue.UUID]] })
async emitAlbumAssetVisibilityRestore(assetIds: string[]) {
  if (assetIds.length === 0) {
    return;
  }

  await this.db
    .updateTable('album_asset')
    .set({ updatedAt: sql`clock_timestamp()` })
    .where('assetId', 'in', assetIds)
    .where('albumId', 'in', (eb) => eb.selectFrom('shared_space_album').select('shared_space_album.albumId'))
    .execute();
}
```

- [ ] **Step 4: Run A2 → green.** PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(spaces): re-add album-linked space assets on restore (A2)"`

---

### Task 4: Scoping + parity edges — A4, A5, A6, A7, A9

**Files:** add tests to the spec. These mostly exercise the already-written scoping (`accessibleSpaceAlbums`, the space-linked `WHERE`); implement fixes only if a test goes red.

- [ ] **Step 1: Write the tests.**
  - **A4 (no bleed to normal albums):** seed an album with an asset but **do not** link it to any space; call `emitAlbumAssetVisibilityPurge([asset.id])`; assert `shared_space_album_asset_audit` has **0** rows for that asset (query the DB via `ctx` db) and a non-space album user's sync yields no delete.
  - **A5 (multi-album fan-out):** put the asset in **two** space-linked albums; purge; assert **two** delete events, one per `(albumId, assetId)`.
  - **A6 (Viewer parity):** seed with a second user as `SharedSpaceRole.Viewer` member who syncs the album asset; purge; assert the Viewer receives the delete. (Use `ctx.newSyncAuthUser()` for the second user, or the harness's multi-user pattern from `sync-shared-space-album.spec.ts`.)
  - **A7 (non-member exclusion):** a user who is not a member of the space syncs; purge; assert they receive **no** album delete for the asset.
  - **A9 (`showInTimeline = false`):** seed the linked album with `showInTimeline: false`; run the A1 purge + A2 restore assertions — both must still fire (album accessibility is independent of `showInTimeline`).
- [ ] **Step 2: Run all → observe red/green.** Any red indicates a scoping bug; fix in `getDeletes`/the emit query, keeping A1–A3 green.
- [ ] **Step 3: Full-file run** — `pnpm test -- --run test/medium/specs/sync/sync-shared-space-album-visibility-purge.spec.ts`. All green.
- [ ] **Step 4: Commit** — `git commit -am "test(spaces): album purge scoping + parity edges (A4-A7, A9)"`

---

### Task 5: `cleanupAuditTable` wiring (retention for the album table)

**Files:** Modify `sync.repository.ts` (add method to `SharedSpaceAlbumToAssetSync`) + `sync.service.ts` (prune loop).

- [ ] **Step 1: Add the method** to `SharedSpaceAlbumToAssetSync`:

```typescript
cleanupAuditTable(daysAgo: number) {
  return this.auditCleanup('shared_space_album_asset_audit', daysAgo);
}
```

- [ ] **Step 2: Wire into the prune loop** in `sync.service.ts` `onAuditTableCleanup()`, next to the other shared-space entries:

```typescript
await this.syncRepository.sharedSpaceAlbumToAsset.cleanupAuditTable(pruneThreshold);
```

(Confirm `syncRepository.sharedSpaceAlbumToAsset` exists — it is constructed in `SyncRepository`.)

- [ ] **Step 3: `make check-server`** clean. (Retention behaviour is tested in Slice 3 R1; here just wire + typecheck.)
- [ ] **Step 4: Commit** — `git commit -am "feat(spaces): prune shared_space_album_asset_audit on schedule"`

---

### Task 6: `asset.service.updateAll` album dispatch + unit + A3/A8

**Files:** Modify `asset.service.ts`; modify `asset.service.spec.ts`; add A3/A8 to the medium spec.

**Interfaces:** Consumes `sharedSpaceRepository.emitAlbumAssetVisibility{Purge,Restore}`.

- [ ] **Step 1: Write the unit assertions** in `asset.service.spec.ts` (mock `sharedSpaceRepository`): on `updateAll` with `visibility: Hidden` → `emitAlbumAssetVisibilityPurge` called with the ids and `emitAlbumAssetVisibilityRestore` **not** called; with `Locked` → album purge **not** called (and `albumRepository.removeAssetsFromAll` **is** called, existing); with `Timeline` and with `Archive` → `emitAlbumAssetVisibilityRestore` called, purge not; with no visibility change → neither called. Mirror the existing direct-emitter assertions already in this spec.
- [ ] **Step 2: Run → red** (methods not wired).
- [ ] **Step 3: Add the album dispatch** in `updateAll`, immediately after the existing direct-path block:

```typescript
if (visibility === AssetVisibility.Hidden) {
  await this.sharedSpaceRepository.emitAlbumAssetVisibilityPurge(ids);
} else if (visibility === AssetVisibility.Timeline || visibility === AssetVisibility.Archive) {
  await this.sharedSpaceRepository.emitAlbumAssetVisibilityRestore(ids);
}
```

- [ ] **Step 4: Run unit → green.**
- [ ] **Step 5: Write medium A3 + A8.**
  - **A3 (Locked via removal, no new tombstone):** seed space + linked album + asset + synced member; call `ctx.get(AlbumRepository).removeAssetsFromAll([asset.id])` (the Locked path) **without** calling `emitAlbumAssetVisibilityPurge`; assert `shared_space_album_asset_audit` has **0** rows for the asset AND the member's sync yields a `SharedSpaceAlbumToAssetDeleteV1` (delivered via the existing `album_asset_audit` arm from the delete trigger).
  - **A8 (no re-add after Locked):** after A3's removal, call `emitAlbumAssetVisibilityRestore([asset.id])`; assert the member's sync yields **no** `SharedSpaceAlbumToAssetV1` for the asset (no `album_asset` row exists to bump).
- [ ] **Step 6: Run A3/A8 → green** (they assert existing semantics; adjust only if red).
- [ ] **Step 7: `make check-server` + `make lint-server`** clean.
- [ ] **Step 8: Commit** — `git commit -am "feat(spaces): wire album visibility purge/restore into asset updateAll (A3, A8, unit)"`

---

### Task 7: revert-to-immich + `make sql` + slice gate

**Files:** Modify `scripts/revert-to-immich/`; regenerate SQL docs.

- [ ] **Step 1: Add cleanup** — grep `scripts/revert-to-immich/` for where fork audit tables are dropped (e.g. `shared_space_asset_audit`); add `DROP TABLE IF EXISTS "shared_space_album_asset_audit";` alongside.
- [ ] **Step 2: Regenerate SQL docs** — with the dev DB up: `make sql`. Commit the regenerated `.sql` for the changed decorated methods (`emitAlbumAssetVisibility*`, `SharedSpaceAlbumToAssetSync.getDeletes`).
- [ ] **Step 3: Slice gate** — run:
  - `cd server && pnpm test -- --run test/medium/specs/sync/sync-shared-space-album-visibility-purge.spec.ts` (A1–A9 green)
  - `pnpm test -- --run src/services/asset.service.spec.ts` (dispatch unit green)
  - regression: `pnpm test -- --run test/medium/specs/sync/sync-shared-space-visibility-purge.spec.ts` and `test/medium/specs/sync/sync-shared-space-album.spec.ts` (green)
  - `make check-server` + `make lint-server` clean.
- [ ] **Step 4: Commit** — `git commit -am "chore(spaces): revert-to-immich + regen SQL for album visibility purge"`

---

## Self-review checklist (run before handing to executor)

- **Spec coverage:** A1 (T2), A2 (T3), A3 (T6), A4/A5/A6/A7/A9 (T4), A8 (T6); album dispatch unit (T6); retention wiring (T5, tested Slice 3 R1). ✅ all Slice-1 scenarios mapped.
- **No placeholders:** every code step has real code; edge tests name exact scenarios and assertions.
- **Type/name consistency:** `emitAlbumAssetVisibilityPurge`/`emitAlbumAssetVisibilityRestore`, `shared_space_album_asset_audit`, `SharedSpaceAlbumToAssetDeleteV1`, `SharedSpaceAlbumToAssetV1`, `accessibleSpaceAlbums`, `syncRepository.sharedSpaceAlbumToAsset` — used consistently.
- **Scope:** no library or cross-path work here (Slices 2/3).
