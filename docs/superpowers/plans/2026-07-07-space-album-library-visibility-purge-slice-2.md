# Slice 2 — Library-linked asset visibility purge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. This is **Slice 2** of spec `docs/superpowers/specs/2026-07-07-space-album-library-visibility-purge-design.md`. **Slice 1 (album) is completed baseline** — mirror its committed patterns (`emitAlbumAssetVisibilityPurge`, the unioned `getDeletes`, the prune wiring). Do **not** touch the album path or Slice 3 invariants.

**Goal:** When a library owner flips a library-linked space asset to `Hidden` or `Locked`, purge it from already-synced member devices — but **never** from the library owner. Restore is **automatic** (the visibility `UPDATE` bumps `asset.updateId` and `LibraryAssetSync.getUpserts`'s gate flips), so there is no restore method.

**Architecture:** New space-only audit table `shared_space_library_asset_audit(id, libraryId, assetId, deletedAt)`. `SharedSpaceRepository.emitLibraryAssetVisibilityPurge` writes it. `LibraryAssetSync.getDeletes` is augmented to `UNION` it under one checkpoint, with the new arm **owner-gated** (`asset.ownerId <> userId`) so the owner is never purged. `asset.service.updateAll` calls the purge on `Hidden | Locked`.

**Tech Stack:** NestJS + Kysely, Vitest medium tests (testcontainers), fork migrations.

## Global Constraints

- `src/` alias imports only. Migration timestamp **`1781181889688`** (album used `1779309791424`). Prettier 120-col; ESLint zero-warnings. Medium tests need Docker. **Do NOT run `make sql`** (orchestrator handles it). Reuse existing entity types (`LibraryAssetDeleteV1`, `LibraryAssetCreateV1`) — no new sync types, no mobile change.

## File map

- **Create:** `server/src/schema/tables/shared-space-library-asset-audit.table.ts`
- **Create:** `server/src/schema/migrations-gallery/1781181889688-SharedSpaceLibraryAssetAuditTable.ts`
- **Modify:** `server/src/schema/index.ts` — register the new table (next to the album audit table added in Slice 1).
- **Modify:** `server/src/repositories/shared-space.repository.ts` — add `emitLibraryAssetVisibilityPurge`.
- **Modify:** `server/src/repositories/sync.repository.ts` — augment `LibraryAssetSync.getDeletes` (owner-gated union) + extend `LibraryAssetSync.cleanupAuditTable` to prune both tables.
- **Modify:** `server/src/services/asset.service.ts` — library dispatch in `updateAll`.
- **Modify:** `server/src/services/asset.service.spec.ts` — library dispatch unit rows.
- **Modify:** `server/src/utils/shared-space-album-scope.guard.spec.ts` — allowlist `emitLibraryAssetVisibilityPurge` (write-infra), mirroring the album entries.
- **Modify:** `scripts/revert-to-immich.sql` — `DROP TABLE ... shared_space_library_asset_audit`.
- **Create:** `server/test/medium/specs/sync/sync-shared-space-library-visibility-purge.spec.ts` — L1–L7.

---

### Task 1: Audit table + migration + registration

**Files:** create table class + migration; register in `schema/index.ts`.

- [ ] **Step 1: Table class** `shared-space-library-asset-audit.table.ts` (mirror the album audit table from Slice 1; `libraryId` instead of `albumId`):

```typescript
import { Column, CreateDateColumn, Generated, Table, Timestamp } from '@immich/sql-tools';
import { PrimaryGeneratedUuidV7Column } from 'src/decorators';

@Table('shared_space_library_asset_audit')
export class SharedSpaceLibraryAssetAuditTable {
  @PrimaryGeneratedUuidV7Column()
  id!: Generated<string>;

  @Column({ type: 'uuid', index: true })
  libraryId!: string;

  @Column({ type: 'uuid', index: true })
  assetId!: string;

  @CreateDateColumn({ default: () => 'clock_timestamp()', index: true })
  deletedAt!: Generated<Timestamp>;
}
```

- [ ] **Step 2: Register** the class in `server/src/schema/index.ts` next to `SharedSpaceAlbumAssetAuditTable`.
- [ ] **Step 3: Migration** `1781181889688-SharedSpaceLibraryAssetAuditTable.ts`:

```typescript
import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE "shared_space_library_asset_audit" (
      "id" uuid NOT NULL DEFAULT immich_uuid_v7(),
      "libraryId" uuid NOT NULL,
      "assetId" uuid NOT NULL,
      "deletedAt" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT "shared_space_library_asset_audit_pkey" PRIMARY KEY ("id")
    );
  `.execute(db);
  await sql`CREATE INDEX "shared_space_library_asset_audit_libraryId_idx" ON "shared_space_library_asset_audit" ("libraryId")`.execute(
    db,
  );
  await sql`CREATE INDEX "shared_space_library_asset_audit_assetId_idx" ON "shared_space_library_asset_audit" ("assetId")`.execute(
    db,
  );
  await sql`CREATE INDEX "shared_space_library_asset_audit_deletedAt_idx" ON "shared_space_library_asset_audit" ("deletedAt")`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS "shared_space_library_asset_audit"`.execute(db);
}
```

- [ ] **Step 4:** `pnpm run check` clean (DB type includes the new table).
- [ ] **Step 5: Commit** — `git commit -am "feat(spaces): add shared_space_library_asset_audit table + migration"`

---

### Task 2: `emitLibraryAssetVisibilityPurge` + owner-gated `getDeletes` + L1/L2

**Files:** modify `shared-space.repository.ts`, `sync.repository.ts`; create the medium spec; allowlist in guard spec.

**Interfaces:** Produces `SharedSpaceRepository.emitLibraryAssetVisibilityPurge(assetIds: string[]): Promise<void>` — inserts `shared_space_library_asset_audit` rows for space-linked-library assets. `LibraryAssetSync.getDeletes` streams `LibraryAssetDeleteV1` for members (owner excluded).

- [ ] **Step 1: Write L1 + L2** in `sync-shared-space-library-visibility-purge.spec.ts`. Seed: owner creates a library + an asset in it (Timeline), a space, adds owner (Owner) + a second user as member (Editor), links the library to the space. Member syncs `LibraryAssetsV1` (backfill), acks. Then purge and assert member gets a delete but the owner does not.

```typescript
// Slice 2 (#753 follow-up #2): purge already-synced LIBRARY-linked space assets
// from member devices on Hidden/Locked — but never from the library OWNER, who
// keeps their asset. Restore is automatic (the visibility UPDATE bumps
// asset.updateId; LibraryAssetSync.getUpserts re-emits when the gate flips), so
// there is no restore emit (asserted by L3). Space-only tombstones live in
// shared_space_library_asset_audit, unioned (owner-gated) into LibraryAssetSync.
import { Kysely } from 'kysely';
import { AssetVisibility, SharedSpaceRole, SyncEntityType, SyncRequestType } from 'src/enum';
import { AssetRepository } from 'src/repositories/asset.repository';
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

// owner owns the library + asset; `member` is a separate synced Editor. Returns
// the space, library, asset, and the member's auth for its own sync stream.
const seedSpaceWithLibraryAsset = async (
  ctx: SyncTestContext,
  ownerId: string,
  memberAuth: Awaited<ReturnType<SyncTestContext['newSyncAuthUser']>>,
  role: SharedSpaceRole = SharedSpaceRole.Editor,
) => {
  const { space } = await ctx.newSharedSpace({ createdById: ownerId });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: ownerId, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: memberAuth.user.id, role });
  const { library } = await ctx.newLibrary({ ownerId });
  const { asset } = await ctx.newAsset({ ownerId, libraryId: library.id, visibility: AssetVisibility.Timeline });
  await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id });
  return { space, library, asset };
};

describe('LibraryAssetSync — library visibility purge (space members, not owner)', () => {
  it('L1/L2: purges a Hidden library asset from the member but not the owner', async () => {
    const owner = await setup();
    const member = await owner.ctx.newSyncAuthUser();
    const { asset } = await seedSpaceWithLibraryAsset(owner.ctx, owner.auth.user.id, member);

    // member syncs + acks the library asset while visible
    const initial = await owner.ctx.syncStream(member.auth, [SyncRequestType.LibraryAssetsV1]);
    await owner.ctx.syncAckAll(member.auth, initial);

    await owner.ctx.get(SharedSpaceRepository).emitLibraryAssetVisibilityPurge([asset.id]);

    // member: delete delivered
    const memberNext = await owner.ctx.syncStream(member.auth, [SyncRequestType.LibraryAssetsV1]);
    const memberDeletes = memberNext.filter((r: { type: string }) => r.type === SyncEntityType.LibraryAssetDeleteV1);
    expect(memberDeletes.some((e) => (e as { data: { assetId: string } }).data.assetId === asset.id)).toBe(true);

    // owner: NO delete (owner keeps their own asset)
    const ownerNext = await owner.ctx.syncStream(owner.auth, [SyncRequestType.LibraryAssetsV1]);
    const ownerDeletes = ownerNext.filter((r: { type: string }) => r.type === SyncEntityType.LibraryAssetDeleteV1);
    expect(ownerDeletes.some((e) => (e as { data: { assetId: string } }).data.assetId === asset.id)).toBe(false);
  });
});
```

- [ ] **Step 2: Run L1/L2 → red** (`pnpm test:medium -- --run test/medium/specs/sync/sync-shared-space-library-visibility-purge.spec.ts`). Expected: FAIL — `emitLibraryAssetVisibilityPurge is not a function`.

- [ ] **Step 3: Add `emitLibraryAssetVisibilityPurge`** to `shared-space.repository.ts`:

```typescript
@GenerateSql({ params: [[DummyValue.UUID]] })
async emitLibraryAssetVisibilityPurge(assetIds: string[]) {
  if (assetIds.length === 0) {
    return;
  }

  await this.db
    .insertInto('shared_space_library_asset_audit')
    .columns(['libraryId', 'assetId'])
    .expression(
      this.db
        .selectFrom('asset')
        .select(['asset.libraryId', 'asset.id as assetId'])
        .where('asset.id', 'in', assetIds)
        .where('asset.libraryId', 'is not', null)
        .where('asset.libraryId', 'in', (eb) =>
          eb.selectFrom('shared_space_library').select('shared_space_library.libraryId'),
        ),
    )
    .$narrowType<{ libraryId: string }>()
    .execute();
}
```

(`asset.libraryId` is nullable; the `is not null` filter guarantees non-null. If Kysely still complains about the insert column type, use `sql`-cast or `.$narrowType`; if `$narrowType` isn't the right helper here, cast the select expression — the constraint is that a non-null `libraryId` is inserted.)

- [ ] **Step 4: Augment `LibraryAssetSync.getDeletes`** — union the space audit, **owner-gated**, one checkpoint, single `ORDER BY id` (mirror the Slice 1 album union shape; the space arm joins `asset` to read `ownerId`):

```typescript
@GenerateSql({ params: [dummyQueryOptions], stream: true })
getDeletes(options: SyncQueryOptions) {
  const { userId, nowId, ack } = options;

  const libraryAssetArm = this.db
    .selectFrom('library_asset_audit')
    .select(['library_asset_audit.id as id', 'library_asset_audit.assetId as assetId'])
    .where('library_asset_audit.id', '<', nowId)
    .$if(!!ack, (qb) => qb.where('library_asset_audit.id', '>', ack!.updateId))
    .where('library_asset_audit.libraryId', 'in', (eb) => accessibleLibraries(eb, userId));

  // Space visibility purge: owner is NEVER purged (they keep their own asset).
  const spaceLibraryAssetArm = this.db
    .selectFrom('shared_space_library_asset_audit')
    .innerJoin('asset', 'asset.id', 'shared_space_library_asset_audit.assetId')
    .select(['shared_space_library_asset_audit.id as id', 'shared_space_library_asset_audit.assetId as assetId'])
    .where('shared_space_library_asset_audit.id', '<', nowId)
    .$if(!!ack, (qb) => qb.where('shared_space_library_asset_audit.id', '>', ack!.updateId))
    .where('shared_space_library_asset_audit.libraryId', 'in', (eb) => accessibleLibraries(eb, userId))
    .where('asset.ownerId', '!=', userId);

  return libraryAssetArm.union(spaceLibraryAssetArm).orderBy('id', 'asc').stream();
}
```

- [ ] **Step 5: Allowlist** `emitLibraryAssetVisibilityPurge` in `shared-space-album-scope.guard.spec.ts` `VIS_ALLOWLIST` (write-infra, mirroring the album entries): `'shared-space.repository.ts::emitLibraryAssetVisibilityPurge': 'reads asset library ids into audit tombstone (purge write-infra); no asset content returned'`.
- [ ] **Step 6: Run L1/L2 → green.**
- [ ] **Step 7: `pnpm run check`** clean.
- [ ] **Step 8: Commit** — `git commit -am "feat(spaces): purge library-linked space assets on Hidden, owner-excluded (L1/L2)"`

---

### Task 3: L3 (automatic restore) + L4 (Locked purge)

**Files:** add tests. No new production code expected for L3 (that is the point). L4 needs the `asset.service` wiring (Task 4) OR can call the emit directly — write L4 to call `emitLibraryAssetVisibilityPurge` directly (Locked path emits the same tombstone).

- [ ] **Step 1: Write L3** — prove restore needs no emit. Change real visibility via `AssetRepository.updateAll` (bumps `asset.updateId`):

```typescript
it('L3: restores a library asset to the member automatically on un-hide (no restore emit)', async () => {
  const owner = await setup();
  const member = await owner.ctx.newSyncAuthUser();
  const { asset } = await seedSpaceWithLibraryAsset(owner.ctx, owner.auth.user.id, member);

  const initial = await owner.ctx.syncStream(member.auth, [SyncRequestType.LibraryAssetsV1]);
  await owner.ctx.syncAckAll(member.auth, initial);

  // Hide for real (bumps asset.updateId, gate now excludes) + emit the purge tombstone.
  await owner.ctx.get(AssetRepository).updateAll([asset.id], { visibility: AssetVisibility.Hidden });
  await owner.ctx.get(SharedSpaceRepository).emitLibraryAssetVisibilityPurge([asset.id]);
  const afterHide = await owner.ctx.syncStream(member.auth, [SyncRequestType.LibraryAssetsV1]);
  await owner.ctx.syncAckAll(member.auth, afterHide);

  // Un-hide for real — NO restore emit is called. getUpserts must re-emit.
  await owner.ctx.get(AssetRepository).updateAll([asset.id], { visibility: AssetVisibility.Timeline });

  const restored = await owner.ctx.syncStream(member.auth, [SyncRequestType.LibraryAssetsV1]);
  const creates = restored.filter((r: { type: string }) => r.type === SyncEntityType.LibraryAssetCreateV1);
  expect(creates.some((e) => (e as { data: { id: string } }).data.id === asset.id)).toBe(true);
});
```

- [ ] **Step 2: Run L3 → should PASS with no new code** (proves the automatic re-add). If it fails, do NOT add a restore method without checking with the orchestrator — a failure means an assumption in §3.2/L3 is wrong.
- [ ] **Step 3: Write L4 (Locked purge)** — same as L1 but flip to `Locked`; call `emitLibraryAssetVisibilityPurge` (the service wires it on `Locked` too, Task 4); assert the member receives a `LibraryAssetDeleteV1`.
- [ ] **Step 4: Run L4 → green.**
- [ ] **Step 5: Commit** — `git commit -am "test(spaces): library automatic restore + Locked purge (L3, L4)"`

---

### Task 4: `asset.service.updateAll` library dispatch + unit

**Files:** modify `asset.service.ts`, `asset.service.spec.ts`.

- [ ] **Step 1: Write unit assertions** in `asset.service.spec.ts`: on `updateAll` with `Hidden` → `emitLibraryAssetVisibilityPurge` called; with `Locked` → **also** called; with `Timeline`/`Archive`/no-change → **not** called. Mock `sharedSpaceRepository` (extend the existing mock).
- [ ] **Step 2: Run → red.**
- [ ] **Step 3: Add dispatch** after the album block in `updateAll`:

```typescript
// Slice 2: LIBRARY-path purge. No removal analogue for libraries, so purge on
// both Hidden and Locked. Restore is automatic (the visibility UPDATE above bumps
// asset.updateId; LibraryAssetSync.getUpserts re-emits when the gate flips).
if (visibility === AssetVisibility.Hidden || visibility === AssetVisibility.Locked) {
  await this.sharedSpaceRepository.emitLibraryAssetVisibilityPurge(ids);
}
```

- [ ] **Step 4: Run unit → green.**
- [ ] **Step 5: Commit** — `git commit -am "feat(spaces): wire library visibility purge into asset updateAll"`

---

### Task 5: L5 (no-bleed), L6 (Viewer parity), L7 (non-member) + retention wiring

**Files:** add tests; modify `LibraryAssetSync.cleanupAuditTable`.

- [ ] **Step 1: Write L5** — asset in a library NOT linked to any space; `emitLibraryAssetVisibilityPurge([id])`; assert `shared_space_library_asset_audit` has 0 rows for it AND the owner (only accessor) still gets no delete (owner-gate) — i.e. no spurious purge.
- [ ] **Step 2: Write L6** — the member from L1 with role `SharedSpaceRole.Viewer`; assert the Viewer receives the delete (parity).
- [ ] **Step 3: Write L7** — a user not in the space; assert no library delete for the asset.
- [ ] **Step 4: Run L5–L7 → green** (adjust scoping only if red).
- [ ] **Step 5: Extend `LibraryAssetSync.cleanupAuditTable`** to prune BOTH tables (make it async):

```typescript
async cleanupAuditTable(daysAgo: number) {
  await this.auditCleanup('library_asset_audit', daysAgo);
  await this.auditCleanup('shared_space_library_asset_audit', daysAgo);
}
```

(The prune loop in `sync.service.ts` already `await`s `libraryAsset.cleanupAuditTable` — no new loop line needed.)

- [ ] **Step 6: Run the full spec + `pnpm run check` + `pnpm lint`** clean.
- [ ] **Step 7: Commit** — `git commit -am "test(spaces): library purge no-bleed/parity edges + prune shared_space_library_asset_audit (L5-L7)"`

---

### Task 6: revert-to-immich + slice gate

- [ ] **Step 1:** add `DROP TABLE IF EXISTS "shared_space_library_asset_audit" CASCADE;` to `scripts/revert-to-immich.sql` (next to the album one).
- [ ] **Step 2: Slice gate** — run:
  - `pnpm test:medium -- --run test/medium/specs/sync/sync-shared-space-library-visibility-purge.spec.ts` (L1–L7 green)
  - `pnpm test -- --run src/services/asset.service.spec.ts` (dispatch unit green)
  - regression: `pnpm test:medium -- --run test/medium/specs/sync/sync-shared-space-library.spec.ts test/medium/specs/sync/sync-shared-space-album-visibility-purge.spec.ts` (green)
  - `pnpm run check` + `pnpm lint` clean.
- [ ] **Step 3: Commit** — `git commit -am "chore(spaces): revert-to-immich for library visibility purge"`

---

## Self-review checklist

- **Spec coverage:** L1 (T2), L2 (T2), L3 (T3), L4 (T3), L5 (T5), L6 (T5), L7 (T5); library dispatch unit (T4); retention wiring (T5, tested Slice 3 R1). ✅
- **No placeholders:** real code in every step; the `$narrowType`/cast note is a concrete typing instruction, not a TODO.
- **Type/name consistency:** `emitLibraryAssetVisibilityPurge`, `shared_space_library_asset_audit`, `LibraryAssetDeleteV1`, `LibraryAssetCreateV1`, `accessibleLibraries`, owner-gate `asset.ownerId != userId`, `libraryAsset.cleanupAuditTable` (async, two tables).
- **Scope:** library only; no album or cross-path changes.
- **Key correctness:** owner-gate is on the SPACE arm only (existing `library_asset_audit` arm unchanged); restore has NO emit (L3 proves automatic); union has one trailing `ORDER BY id`.
