# Slice 3 — Cross-path convergence, invariants & retention — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. **Slice 3** of spec `docs/superpowers/specs/2026-07-07-space-album-library-visibility-purge-design.md`. **Slices 1 (album) and 2 (library) are completed baseline** — this slice is almost entirely TEST-ONLY, verifying invariants across the mechanisms they built. Add production code ONLY if a test reveals a real gap; if an invariant genuinely fails, STOP and report rather than papering over it.

**Goal:** Prove the three purge paths converge on one member (X1), the emit methods are safe on empty input (X2) and idempotent (X3), the unioned delete streams gate correctly under one checkpoint (X4), and the new audit tables are pruned (R1).

**Architecture:** No new tables/methods expected. Tests exercise `emitDirectAssetVisibilityPurge` (Slice 4.B), `emitAlbumAssetVisibilityPurge`/`Restore` (Slice 1), `emitLibraryAssetVisibilityPurge` (Slice 2), the two unioned `getDeletes`, and the `cleanupAuditTable` wirings.

## Global Constraints

- `src/` alias imports only. Prettier 120-col; ESLint zero-warnings. Medium tests need Docker. **Do NOT run `make sql`.**
- **Correct medium-test command** (the `--run <substring>` filter does NOT restrict): `cd server && pnpm exec vitest run --config test/vitest.config.medium.mjs <filepath>`.
- **IGNORE `workflow-core-plugin.spec.ts` failures** (`Plugin method not found: immich-plugin-core#...` — `packages/plugin-core` unbuilt in this worktree; pre-existing/environmental).

## File map

- **Modify:** `server/test/medium/specs/sync/sync-shared-space-album-visibility-purge.spec.ts` — add X2 (album empty), X3 (album idempotent), X4 (union checkpoint).
- **Modify:** `server/test/medium/specs/sync/sync-shared-space-library-visibility-purge.spec.ts` — add X2 (library empty), R1 (library retention).
- **Create:** `server/test/medium/specs/sync/sync-space-visibility-purge-cross-path.spec.ts` — X1 (multi-path) + R1 (album retention).

---

### Task 1: X1 — multi-path convergence

**Files:** create `sync-space-visibility-purge-cross-path.spec.ts`.

**Interfaces:** consumes `SharedSpaceRepository.emitDirectAssetVisibilityPurge`, `emitAlbumAssetVisibilityPurge`, `emitLibraryAssetVisibilityPurge`.

- [ ] **Step 1: Write X1.** Seed ONE asset (owned by `owner`) reachable by a member via all three paths: (a) directly added to space S1 (`newSharedSpaceAsset`), (b) in an album linked to space S2 (`newSharedSpaceAlbum`), (c) in a library linked to space S3 (`newSharedSpaceLibrary`). Member is in all three spaces and has synced the asset on all three streams (ack). Then call all three purge emitters (as `asset.service.updateAll` would on `Hidden`). Assert the member receives a delete on ALL three streams:
  - `SharedSpaceToAssetsV1` → `SharedSpaceToAssetDeleteV1`
  - `SharedSpaceAlbumToAssetsV1` → `SharedSpaceAlbumToAssetDeleteV1`
  - `LibraryAssetsV1` → `LibraryAssetDeleteV1`

```typescript
// Cross-path (X1): an asset reachable via direct add, a space-linked album, and
// a space-linked library must be purged from an already-synced member on ALL
// three streams when the owner flips it to Hidden. Verifies the three Slice-4.B/
// Slice-1/Slice-2 mechanisms converge on one device.
```

- [ ] **Step 2: Run X1 → green** (all three emitters + streams exist from Slices 4.B/1/2). If any stream fails to deliver, investigate the corresponding path — do not weaken the assertion.
- [ ] **Step 3: Commit** — `git commit -am "test(spaces): cross-path visibility purge convergence (X1)"`

---

### Task 2: X2 — empty-id no-op; X3 — idempotent double-purge

**Files:** modify the album spec (X2 album, X3), the library spec (X2 library). (The direct-path empty-list case already exists in `sync-shared-space-visibility-purge.spec.ts`.)

- [ ] **Step 1: Write X2 (album + library).** Assert `emitAlbumAssetVisibilityPurge([])`, `emitAlbumAssetVisibilityRestore([])`, and `emitLibraryAssetVisibilityPurge([])` each resolve without throwing and write no audit rows.

```typescript
it('X2: album emit methods are a no-op on an empty id list', async () => {
  const { ctx } = await setup();
  await expect(ctx.get(SharedSpaceRepository).emitAlbumAssetVisibilityPurge([])).resolves.not.toThrow();
  await expect(ctx.get(SharedSpaceRepository).emitAlbumAssetVisibilityRestore([])).resolves.not.toThrow();
});
```

- [ ] **Step 2: Write X3 (idempotent double-purge).** In the album spec: seed A1's scenario, sync+ack; call `emitAlbumAssetVisibilityPurge([asset.id])` TWICE; sync; assert the member's device converges to "asset absent" — i.e. at least one `SharedSpaceAlbumToAssetDeleteV1` for the asset is delivered and the emitter did not throw. Ack; then `assertSyncIsComplete`. (Duplicate tombstones are tolerated, matching 4.B.)
- [ ] **Step 3: Run X2/X3 → green.**
- [ ] **Step 4: Commit** — `git commit -am "test(spaces): empty-list no-op + idempotent double-purge (X2, X3)"`

---

### Task 3: X4 — union checkpoint correctness

**Files:** modify the album spec.

- [ ] **Step 1: Write X4.** Verify that when deletes arrive from BOTH union arms in one window, a single ack gates both with no re-delivery and no skip. Seed a member in a space with TWO linked albums (A, B), the same asset in both. Produce one tombstone from EACH source in one window:
  - `album_asset_audit` arm: remove the asset from album A via `ctx.get(AlbumRepository).removeAssets(...)`/`removeAssetsFromAll` → fires `album_asset_delete_audit`.
  - `shared_space_album_asset_audit` arm: `emitAlbumAssetVisibilityPurge([asset.id])` → tombstone for album B (still linked).

  Sync `SharedSpaceAlbumToAssetsV1`; assert the response contains delete events from **both** sources (≥2 deletes, covering album A and album B). `syncAckAll`. Then `assertSyncIsComplete` — the next sync must be **empty** (single checkpoint advanced past both audit tables; nothing re-delivered, nothing skipped).

```typescript
// X4: the unioned getDeletes (album_asset_audit + shared_space_album_asset_audit)
// runs under ONE client checkpoint. Deletes from both sources in one window must
// all deliver, and a single ack must advance past both (next sync empty).
```

- [ ] **Step 2: Run X4 → green.** If the next sync is NOT empty after ack (re-delivery) or a delete is missing (skip), the union is bounding/ordering per-arm instead of over the whole union — fix `SharedSpaceAlbumToAssetSync.getDeletes` so `id`-bounds and `ORDER BY id` apply to the union as one stream (per spec §5.2). Keep A1–A9 green.
- [ ] **Step 3: Commit** — `git commit -am "test(spaces): union checkpoint correctness across audit sources (X4)"`

---

### Task 4: R1 — audit retention prune

**Files:** modify the album spec (album table) + library spec (library table).

**Interfaces:** consumes `syncRepository.sharedSpaceAlbumToAsset.cleanupAuditTable(daysAgo)` (Slice 1) and `syncRepository.libraryAsset.cleanupAuditTable(daysAgo)` (Slice 2, prunes both library audit tables).

- [ ] **Step 1: Write R1 (album).** Insert two `shared_space_album_asset_audit` rows — one with `deletedAt` older than the threshold (e.g. `now() - interval '40 days'`), one recent. Run `ctx.get(SyncRepository).sharedSpaceAlbumToAsset.cleanupAuditTable(31)`. Assert the old row is deleted and the recent row remains. (Insert directly via the ctx db; set `deletedAt` explicitly to bypass the `clock_timestamp()` default.)
- [ ] **Step 2: Write R1 (library).** Same for `shared_space_library_asset_audit` via `syncRepository.libraryAsset.cleanupAuditTable(31)`; also assert a stale `library_asset_audit` row is still pruned (the method now cleans both — no regression to the existing behaviour).
- [ ] **Step 3: Run R1 → green.** (Cleanup was wired in Slices 1/2; this proves it.)
- [ ] **Step 4: Commit** — `git commit -am "test(spaces): audit retention prune for new space audit tables (R1)"`

---

### Task 5: Full slice gate

- [ ] **Step 1: Run every new + regression spec** via direct vitest file paths:
  - `sync-shared-space-album-visibility-purge.spec.ts` (A1–A9, X2, X3, X4, R1-album)
  - `sync-shared-space-library-visibility-purge.spec.ts` (L1–L7, X2, R1-library)
  - `sync-space-visibility-purge-cross-path.spec.ts` (X1)
  - regressions: `sync-shared-space-visibility-purge.spec.ts`, `sync-shared-space-album.spec.ts`, `sync-shared-space-library.spec.ts`
- [ ] **Step 2:** `pnpm test -- --run src/services/asset.service.spec.ts` (dispatch unit, both paths).
- [ ] **Step 3:** `pnpm run check` + `pnpm lint` clean.
- [ ] **Step 4: Commit** any final touch-ups — `git commit -am "test(spaces): slice 3 gate green"` (skip if nothing to commit).

---

## Self-review checklist

- **Spec coverage:** X1 (T1), X2 (T2), X3 (T2), X4 (T3), R1 (T4). ✅ all Slice-3 invariants mapped.
- **No placeholders:** each test names concrete seeds + assertions.
- **Type/name consistency:** `emitDirectAssetVisibilityPurge`, `emitAlbumAssetVisibilityPurge/Restore`, `emitLibraryAssetVisibilityPurge`, `SharedSpaceToAssetDeleteV1`/`SharedSpaceAlbumToAssetDeleteV1`/`LibraryAssetDeleteV1`, `sharedSpaceAlbumToAsset.cleanupAuditTable`, `libraryAsset.cleanupAuditTable`.
- **Scope:** test-only verification; production changes only if an invariant fails (then STOP + report).
