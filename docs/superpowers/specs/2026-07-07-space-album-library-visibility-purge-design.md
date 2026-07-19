# Space album- & library-linked asset visibility purge (issue #753 follow-ups #1 + #2)

- **Date:** 2026-07-07
- **Branch base:** `space-albums-onto-main` (@ `c8377a587e`, PR #754)
- **Tracking issue:** [#753](https://github.com/open-noodle/gallery/issues/753) — follow-ups **#1 (album-path Hidden purge)** and **#2 (library-path purge)**
- **Predecessor:** Slice 4.B (`emitDirectAssetVisibilityPurge` — the **direct** shared-space asset path). This spec extends that pattern to the album and library paths.

---

## 1. Problem

A shared space can surface an asset to its members through three paths:

1. **Direct** — an asset added straight to the space (`shared_space_asset`).
2. **Album** — an album linked to the space (`shared_space_album`); the album's assets (`album_asset`) flow to members.
3. **Library** — a library linked to the space (`shared_space_library`); the library's assets (`asset.libraryId`) flow to members.

When an owner flips an asset **out** of the space-shareable visibility set (`Timeline`/`Archive`) to **`Hidden`** or **`Locked`**, it must disappear from every member device that already synced it.

- **Slice 4.A** already gates the sync **read** streams so a _new/full_ sync never receives a `Hidden`/`Locked` asset (via `spaceVisibilityGate`).
- **Slice 4.B** closed the **direct** path for **already-synced** devices: on a flip to `Hidden`/`Locked`, `emitDirectAssetVisibilityPurge` writes `shared_space_asset_audit` tombstones so `SharedSpaceToAssetSync.getDeletes` purges member devices; the reverse flip bumps `shared_space_asset.updateId` so `getUpserts` re-adds. Verified end-to-end on a real device (2026-07-07): the mobile client correctly drops the space→asset link on the delete event and re-adds it on restore, leaving no photo bytes cached.

**The gap (this spec):** the **album** and **library** paths have no already-synced purge. A member who synced an asset via a linked album or library while it was `Timeline`/`Archive` **keeps it** after the owner flips it to `Hidden`.

**Why 4.B's mechanism can't just be reused:** the delete streams for these two paths read audit tables that are **shared** with non-space behaviour, so writing tombstones there over-deletes for the wrong audience:

| Path    | Member delete stream                     | Audit table it reads       | Shared with                                                                     |
| ------- | ---------------------------------------- | -------------------------- | ------------------------------------------------------------------------------- |
| Direct  | `SharedSpaceToAssetSync.getDeletes`      | `shared_space_asset_audit` | **space-only** (safe — this is why 4.B works)                                   |
| Album   | `SharedSpaceAlbumToAssetSync.getDeletes` | `album_asset_audit`        | **normal (non-space) album sync** → tombstone would purge regular album members |
| Library | `LibraryAssetSync.getDeletes`            | `library_asset_audit`      | **the library owner's own sync** → tombstone would purge the owner              |

**`Locked` is partially handled already:**

- **Album + `Locked`:** `asset.service.updateAll` calls `albumRepository.removeAssetsFromAll(ids)` on `Locked`, which deletes the `album_asset` join rows → the existing `album_asset_delete_audit` trigger fires → both normal _and_ space members drop the asset. **Only album + `Hidden` (join row retained) is the gap.**
- **Library + `Locked`:** there is **no** removal analogue (library membership is intrinsic via `asset.libraryId`), so library needs purge on **both** `Hidden` and `Locked`.

---

## 2. Scope

**In scope (server-side only):**

- Album path: purge already-synced album-linked space assets on `Hidden`; re-add on restore.
- Library path: purge already-synced library-linked space assets on `Hidden`/`Locked`; re-add on restore.
- Retention/cleanup for the new audit tables.

**Explicitly out of scope:**

- **Mobile client changes.** We reuse the existing delete entity types (`SharedSpaceAlbumToAssetDeleteV1`, `LibraryAssetDeleteV1`) and the existing upsert streams, so the client needs no change. (Confirmed 4.B-style deletes are consumed correctly by the device.)
- **The lingering orphan `remote_asset_entity` row on the device** (metadata-only, no bytes) observed during 4.B QA — that is a separate mobile-GC concern, not this spec.
- New `SyncRequestType` / `SyncEntityType` values.

---

## 3. Design (Approach A — dedicated space-scoped audit tables)

Mirror 4.B exactly, once per path: a **space-only** audit table + an explicit `emit…` method called from `asset.service.updateAll`, with the existing space delete stream augmented to read the new table.

### 3.1 New schema (fork migrations in `server/src/schema/migrations-gallery/`)

Two append-only audit tables, **explicit-emit only (no triggers)** — visibility flips don't delete rows, so nothing fires a trigger; the emit methods write these tables directly. Shape mirrors `shared_space_asset_audit` (`server/src/schema/tables/shared-space-asset-audit.table.ts`).

`shared_space_album_asset_audit`:
| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid v7 | PK, generated (`@PrimaryGeneratedUuidV7Column`) — the sync checkpoint key |
| `albumId` | uuid | indexed |
| `assetId` | uuid | indexed |
| `deletedAt` | timestamptz | `clock_timestamp()`, indexed (retention prune key) |

`shared_space_library_asset_audit`:
| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid v7 | PK, generated |
| `libraryId` | uuid | indexed |
| `assetId` | uuid | indexed |
| `deletedAt` | timestamptz | `clock_timestamp()`, indexed |

Table classes live in `server/src/schema/tables/`. Fork migrations with spread-apart random timestamps (`1779309791424-…`, `1781181889688-…`) that don't collide with existing `migrations-gallery/` timestamps or in-flight migrations on other branches. Add both tables to the `scripts/revert-to-immich/` cleanup SQL (one `DROP TABLE` per new table).

### 3.2 New `SharedSpaceRepository` methods (`server/src/repositories/shared-space.repository.ts`)

Alongside `emitDirectAssetVisibilityPurge` / `emitDirectAssetVisibilityRestore`:

**`emitAlbumAssetVisibilityPurge(assetIds: string[])`** — `Hidden` only.

```
INSERT INTO shared_space_album_asset_audit ("albumId", "assetId")
SELECT album_asset."albumId", album_asset."assetId"
FROM album_asset
WHERE album_asset."assetId" IN (assetIds)
  AND album_asset."albumId" IN (SELECT "albumId" FROM shared_space_album)   -- space-linked albums only
```

Early-return on empty `assetIds`. Index path: `album_asset_assetId_idx` drives the `assetId IN` filter; the `shared_space_album` membership check uses `shared_space_album_albumId_idx`. Cost is **O(album memberships of the flipped assets)**, never O(album size).

**`emitAlbumAssetVisibilityRestore(assetIds: string[])`** — `Timeline`/`Archive`.

```
UPDATE album_asset SET "updatedAt" = clock_timestamp()
WHERE "assetId" IN (assetIds)
  AND "albumId" IN (SELECT "albumId" FROM shared_space_album)
```

The `@UpdatedAtTrigger('album_asset_updatedAt')` bumps `album_asset.updateId`, so `SharedSpaceAlbumToAssetSync.getUpserts` (membership) **and** `SharedSpaceAlbumAssetSync.getCreates` (asset metadata, now passing `spaceVisibilityGate`) both re-emit. Re-emitting to normal album members is idempotent (they already hold the row).

> **`Locked` → restore asymmetry (by design).** Restore only re-adds after a **`Hidden`** flip, where the `album_asset` row was retained. After **`Locked`**, `removeAssetsFromAll` has already _deleted_ the `album_asset` rows, so `emitAlbumAssetVisibilityRestore` finds nothing to bump and the asset does **not** return to the album — matching Immich's Locked semantics (Locking removes from albums permanently). This is intentional, not a gap; asserted by A8.

**`emitLibraryAssetVisibilityPurge(assetIds: string[])`** — `Hidden` **or** `Locked`.

```
INSERT INTO shared_space_library_asset_audit ("libraryId", "assetId")
SELECT asset."libraryId", asset."id"
FROM asset
WHERE asset."id" IN (assetIds)
  AND asset."libraryId" IS NOT NULL
  AND asset."libraryId" IN (SELECT "libraryId" FROM shared_space_library)   -- space-linked libraries only
```

Driven by `asset.id` PK; the space-link check uses `shared_space_library_libraryId_idx`. Cost **O(flipped assets)**.

**Library restore is automatic — no method.** The visibility `UPDATE` in `updateAll` already bumps `asset.updateId` via the asset table's `@UpdatedAtTrigger`. On `Hidden`→`Timeline`, `LibraryAssetSync.getUpserts` (gated by `eb.or([ownerId = userId, spaceVisibilityGate])`) re-emits the now-visible asset to members. This automaticity is an **explicit test assertion**, not an assumption (see §6, L3).

### 3.3 Read-stream augmentation (`server/src/repositories/sync.repository.ts`)

Reuse the existing delete entity types — the union carries the new tombstones through the same client checkpoint.

**`SharedSpaceAlbumToAssetSync.getDeletes`** (~`:1517`) — `UNION ALL` the current `album_asset_audit` read with a read of `shared_space_album_asset_audit`, both:

- checkpoint-gated by `id > ack AND id < nowId ORDER BY id` (the shared `auditQuery` helper), and
- scoped by `albumId IN accessibleSpaceAlbums(userId)`.

Emits `SharedSpaceAlbumToAssetDeleteV1` (existing).

**`LibraryAssetSync.getDeletes`** (`:1297`) — `UNION ALL` the current `library_asset_audit` read with a read of `shared_space_library_asset_audit`, the new arm scoped by:

- `libraryId IN accessibleLibraries(userId)`, **and**
- `asset.ownerId <> userId` (join `asset`) — so the **library owner is never purged**; only non-owner space members receive the visibility delete.

Emits `LibraryAssetDeleteV1` (existing).

> **Checkpoint invariant (§5.2):** the union is correct only because both audit tables use time-ordered uuid v7 ids, which are globally comparable — a single client checkpoint gates both arms with no skip/re-delivery.

### 3.4 `asset.service.updateAll` wiring (`server/src/services/asset.service.ts`)

Extend the existing visibility block (which already calls the direct emitters and `removeAssetsFromAll` on `Locked`):

```ts
// existing: removeAssetsFromAll on Locked; emitDirectAssetVisibility{Purge,Restore}

// Album path — Locked is already covered by removeAssetsFromAll above (join row deleted),
// so the album purge handles only Hidden (join row retained).
if (visibility === AssetVisibility.Hidden) {
  await this.sharedSpaceRepository.emitAlbumAssetVisibilityPurge(ids);
} else if (visibility === AssetVisibility.Timeline || visibility === AssetVisibility.Archive) {
  await this.sharedSpaceRepository.emitAlbumAssetVisibilityRestore(ids);
}

// Library path — no removal analogue, so purge on both Hidden and Locked.
// Restore is automatic via the asset.updateId bump from the visibility UPDATE.
if (visibility === AssetVisibility.Hidden || visibility === AssetVisibility.Locked) {
  await this.sharedSpaceRepository.emitLibraryAssetVisibilityPurge(ids);
}
```

### 3.5 Audit retention (`server/src/services/sync.service.ts`)

The new tables must be pruned by the same scheduled job that prunes every other audit table (`sync.service.ts:~274` loop calling `<class>.cleanupAuditTable(pruneThreshold)`).

- Add `auditCleanup('shared_space_album_asset_audit', daysAgo)` to `SharedSpaceAlbumToAssetSync.cleanupAuditTable` (which today owns `album_asset_audit` cleanup — it now owns both arms it reads).
- Add `auditCleanup('shared_space_library_asset_audit', daysAgo)` to `LibraryAssetSync.cleanupAuditTable` (`:1304`, which today owns `library_asset_audit`).
- Ensure both classes are present in the `sync.service.ts` prune loop (following how `SharedSpaceToAssetSync` cleanup is wired for `shared_space_asset_audit`).

---

## 4. Component summary

| Unit                                                   | Responsibility                                                 | Depends on                          |
| ------------------------------------------------------ | -------------------------------------------------------------- | ----------------------------------- |
| `shared_space_album_asset_audit` (table + migration)   | space-only album visibility tombstones                         | —                                   |
| `shared_space_library_asset_audit` (table + migration) | space-only library visibility tombstones                       | —                                   |
| `emitAlbumAssetVisibilityPurge`                        | write album tombstones for space-linked albums                 | `album_asset`, `shared_space_album` |
| `emitAlbumAssetVisibilityRestore`                      | bump `album_asset.updateId` for space-linked albums            | `album_asset`, `shared_space_album` |
| `emitLibraryAssetVisibilityPurge`                      | write library tombstones for space-linked libraries            | `asset`, `shared_space_library`     |
| `SharedSpaceAlbumToAssetSync.getDeletes` (aug.)        | stream album deletes from both audit sources                   | new album audit table               |
| `LibraryAssetSync.getDeletes` (aug.)                   | stream library deletes from both audit sources, owner-excluded | new library audit table             |
| `asset.service.updateAll` (aug.)                       | dispatch purge/restore on visibility transitions               | the three emit methods              |
| `*.cleanupAuditTable` (aug.)                           | prune the two new audit tables                                 | `auditCleanup`                      |

Each unit has one purpose and a testable interface; the emit methods and the stream augmentations can be tested independently.

---

## 5. Scalability analysis

### 5.1 Per-operation cost (verified against the live schema)

- **Purge writes** are indexed set-based `INSERT … SELECT`: album via `album_asset_assetId_idx` → `shared_space_album_albumId_idx`; library via `asset` PK → `shared_space_library_libraryId_idx`. Cost is **proportional to the assets being flipped**, not to the size of the space/album/library. Hiding one photo in a 200k-photo linked album touches a handful of rows.
- **Member sync** is checkpoint-gated (`id > ack`): a device only ever streams the **delta** since its last ack, so a large space never produces a large per-sync payload.
- **Bulk-hiding an entire large album** is inherently O(assets flipped) — one set-based INSERT plus an incremental delete fan-out. This lower bound is intrinsic to un-sharing N photos and is identical to how 4.B and normal album-delete already behave. No design avoids it.

### 5.2 Union checkpoint correctness

`getDeletes` unions the shared audit table with the new space audit table and streams both under the **one** client checkpoint of the existing delete entity type, reusing the standard `auditQuery` bounds (`id > ack AND id < nowId ORDER BY id`).

**Precise guarantee (do not overstate this).** `immich_uuid_v7` (`server/src/schema/functions.ts:9-22`) is a **millisecond timestamp + `gen_random_uuid()`** — ids are ordered _across_ milliseconds but **random within a millisecond**, so they are **not** strictly monotonic and two same-ms rows across the two tables order by their random suffix. The union therefore has **exactly the same** delivery guarantee — and the same well-known same-millisecond concurrent-commit tolerance — as **every existing single-table audit stream** (all of which already run on this id scheme). It introduces **no new** skip/re-delivery class: both arms share one `ack`/`nowId`, and `ORDER BY id` is applied to the unioned result, not per-arm.

> **Implementation caveat:** the only `.union(` in `sync.repository.ts` today (`accessibleLibraries`, `:1169`) is a **scoping-set** union, **not** a two-audit-stream union — so this is a genuinely new query shape. The `auditQuery` helper builds one table's bounded query; the implementation must bound each arm with the same `ack`/`nowId` and order the union as a whole. Verified by X4.

### 5.3 Retention

Both new tables are pruned by the scheduled `cleanupAuditTable` job (§3.5), bounding growth exactly as for every existing audit table. Covered by a test (§6, R1).

---

## 6. Behavioural contract (BDD) — the test scenarios

Written Given/When/Then; each becomes one `it()`. Medium sync specs use the existing harness (`ctx.newSharedSpace`, `newSharedSpaceMember`, `newAsset`, plus album/library seed helpers; `ctx.syncStream`, `ctx.syncAckAll`, `ctx.assertSyncIsComplete`), following `sync-shared-space-visibility-purge.spec.ts`.

### Album — `sync-shared-space-album-visibility-purge.spec.ts`

- **A1 — purge on Hidden.**
  Given an asset in a space-linked album, synced and acked by a member,
  When the owner sets the asset to `Hidden`,
  Then the member's next `SharedSpaceAlbumToAssetsV1` sync yields a `SharedSpaceAlbumToAssetDeleteV1` for `(albumId, assetId)`.

- **A2 — re-add on restore.**
  Given A1 has purged and the member acked the delete,
  When the owner sets the asset back to `Timeline`,
  Then the member's next sync yields `SharedSpaceAlbumToAssetV1` (membership) **and** the asset metadata re-emits via `SharedSpaceAlbumAssetsV1`.

- **A3 — Locked handled by removal (regression, no new tombstone).**
  Given an asset in a space-linked album,
  When the owner sets it to `Locked`,
  Then the delete reaches the member via `album_asset_audit` (from `removeAssetsFromAll`) and **no** `shared_space_album_asset_audit` row is written.

- **A4 — no bleed to normal albums.**
  Given an asset in a **normal album not linked to any space**,
  When the owner sets it to `Hidden`,
  Then **no** `shared_space_album_asset_audit` row is written and a normal (non-space) album member receives **no** delete.

- **A5 — multi-album fan-out.**
  Given an asset in **two** space-linked albums, both synced by the member,
  When the owner sets it `Hidden`,
  Then the member receives a delete for **each** `(albumId, assetId)` pair.

- **A6 — Viewer parity.**
  Given a **Viewer**-role member who synced a space-linked album asset,
  When the owner sets it `Hidden`,
  Then the Viewer receives the delete (parity with Editor).

- **A7 — non-member exclusion.**
  Given a user who is **not** a member of the space,
  When the owner sets the album asset `Hidden`,
  Then that user's sync yields no album delete for it.

- **A8 — no album re-add after Locked (asymmetry).**
  Given an asset that was `Locked` (its `album_asset` rows deleted by `removeAssetsFromAll`),
  When the owner sets it back to `Timeline`,
  Then the asset is **not** re-added to the album (no `album_asset` rows exist to re-emit) — matching Immich Locked semantics. (Contrast A2, which re-adds after `Hidden`.)

- **A9 — `showInTimeline = false` linked album.**
  Given an asset in a space-linked album whose link has `showInTimeline = false`, synced by a member,
  When the owner sets it `Hidden` (then restores),
  Then the member still receives the delete (and the re-add) — the album stays accessible; only its space-timeline projection differs.

### Library — `sync-shared-space-library-visibility-purge.spec.ts`

- **L1 — purge on Hidden.**
  Given a library asset synced and acked by a space member (non-owner),
  When the library owner sets it `Hidden`,
  Then the member's next `LibraryAssetsV1` sync yields a `LibraryAssetDeleteV1` for the asset.

- **L2 — owner never purged.**
  Given the same setup,
  When the owner sets it `Hidden`,
  Then the **library owner's own** sync yields **no** delete for it (owner keeps their asset).

- **L3 — restore is automatic.**
  Given L1 has purged and the member acked the delete,
  When the owner sets it back to `Timeline`,
  Then the member re-receives the asset via `LibraryAssetSync.getUpserts` (gate flips) with **no** explicit restore emit.

- **L4 — purge on Locked.**
  Given a library asset synced by a space member,
  When the owner sets it `Locked`,
  Then the member receives a `LibraryAssetDeleteV1` (library purge fires on `Locked` too).

- **L5 — no bleed to non-space libraries.**
  Given an asset in a library **not linked to any space**,
  When the owner sets it `Hidden`,
  Then **no** `shared_space_library_asset_audit` row is written and only normal (owner) library sync is affected — the owner keeps it.

- **L6 — Viewer parity.** As A6, for the library path.

- **L7 — non-member exclusion.** As A7, for the library path.

### Cross-path & invariants — folded into the two specs above (+ unit)

- **X1 — multi-path convergence.**
  Given an asset reachable by a member via **direct add** (space S1), a **space-linked album** (S2), **and** a **space-linked library** (S3), all synced,
  When the owner sets it `Hidden`,
  Then the member receives deletes on **all three** streams (direct 4.B + album + library).

- **X2 — empty id list.** Each `emit…` method is a no-op (writes nothing, throws nothing) on `[]`.

- **X3 — idempotent double-purge.** Calling a purge twice writes duplicate tombstones; the stream re-delivers, and the device still converges to "absent" (matches 4.B tolerance). Assert no error and eventual-consistency of the delete set.

- **X4 — union checkpoint correctness.** After a purge delivers deletes from **both** `album_asset_audit` (via a normal album unlink) **and** `shared_space_album_asset_audit` (via a Hidden flip) in one window, acking advances the checkpoint past both; the next sync is empty (no re-delivery) and no earlier tombstone is skipped.

- **R1 — retention prune.** Given tombstones older than the prune threshold in each new table, When `cleanupAuditTable(daysAgo)` runs, Then those rows are deleted and newer rows are retained.

### Unit — extend `server/src/services/asset.service.spec.ts`

Assert `updateAll` dispatches correctly (mock `sharedSpaceRepository`):

| Transition           |      `emitAlbumAssetVisibilityPurge`       | `emitAlbumAssetVisibilityRestore` | `emitLibraryAssetVisibilityPurge` |
| -------------------- | :----------------------------------------: | :-------------------------------: | :-------------------------------: |
| → `Hidden`           |                 ✅ called                  |                 —                 |             ✅ called             |
| → `Locked`           | ❌ **not** (removeAssetsFromAll covers it) |                 —                 |             ✅ called             |
| → `Timeline`         |                     —                      |             ✅ called             |              ❌ not               |
| → `Archive`          |                     —                      |             ✅ called             |              ❌ not               |
| no visibility change |                   ❌ not                   |              ❌ not               |              ❌ not               |

Also assert the existing direct emitters and `removeAssetsFromAll` calls are unchanged (regression).

### Regression

`sync-shared-space-visibility-purge.spec.ts` (direct path) and the existing album/library sync specs (`sync-shared-space-album.spec.ts`, `sync-shared-space-library.spec.ts`, `sync-shared-space-album-to-asset-sync.spec.ts`) must stay green.

---

## 7. Slices (impl-loop consumable)

Three numbered slices, each producing working, testable software and independently shippable. Every slice is strict TDD: write the failing test(s) first (expected red noted), add the minimum code to go green, refactor. `impl-loop` plans, reviews, and executes one slice at a time; treat earlier slices as completed baseline.

### Slice 1 — Album path (closes #753 follow-up #1)

**Goal:** hiding an album-linked space asset purges it from already-synced members; restoring (from `Hidden`) re-adds it.

**Tests first (red):** A1–A9 in a new `server/test/medium/specs/sync/sync-shared-space-album-visibility-purge.spec.ts`, plus the **album** rows of the `asset.service.spec.ts` dispatch table (→`Hidden` calls album purge; →`Locked` does **not**; →`Timeline`/`Archive` calls album restore).

- _Expected red:_ `emitAlbumAssetVisibilityPurge` / `…Restore` undefined; no `SharedSpaceAlbumToAssetDeleteV1` emitted after a `Hidden` flip.

**Implement (green):**

- `server/src/schema/tables/shared-space-album-asset-audit.table.ts` + fork migration in `migrations-gallery/`.
- `SharedSpaceRepository.emitAlbumAssetVisibilityPurge` / `emitAlbumAssetVisibilityRestore` (§3.2).
- `SharedSpaceAlbumToAssetSync.getDeletes` union arm (§3.3) + its `cleanupAuditTable` wiring for the new table (§3.5).
- `asset.service.updateAll` album block (§3.4) + its unit assertions.
- `scripts/revert-to-immich/` `DROP TABLE`.

**Edge cases in-slice:** A3 (Locked via `removeAssetsFromAll`, no new tombstone), A4 (no bleed to normal albums), A5 (multi-album fan-out), A6 (Viewer parity), A7 (non-member), A8 (no re-add after Locked), A9 (`showInTimeline = false`).

**Verify:** `cd server && pnpm test -- --run test/medium/specs/sync/sync-shared-space-album-visibility-purge.spec.ts` + `pnpm test -- --run src/services/asset.service.spec.ts`; `make check-server`; `make sql` (DB up) clean.

### Slice 2 — Library path (closes #753 follow-up #2)

**Goal:** hiding/locking a library-linked space asset purges it from already-synced members (never from the library owner); restoring re-adds it automatically.

**Tests first (red):** L1–L7 in a new `sync-shared-space-library-visibility-purge.spec.ts`, plus the **library** rows of the dispatch table (→`Hidden` **and** →`Locked` call library purge; owner-exclusion).

- _Expected red:_ `emitLibraryAssetVisibilityPurge` undefined; member keeps the asset after a `Hidden` flip.

**Implement (green):**

- `server/src/schema/tables/shared-space-library-asset-audit.table.ts` + fork migration.
- `SharedSpaceRepository.emitLibraryAssetVisibilityPurge` (§3.2). **No restore method** — L3 proves the automatic re-add via the `asset.updateId` bump.
- `LibraryAssetSync.getDeletes` **owner-gated** union arm (§3.3) + its `cleanupAuditTable` wiring.
- `asset.service.updateAll` library block (§3.4, `Hidden | Locked`) + its unit assertions.
- `scripts/revert-to-immich/` `DROP TABLE`.

**Edge cases in-slice:** L2 (owner never purged), L3 (automatic restore — assert **passes with no new code**), L4 (Locked purge), L5 (no bleed to non-space libraries), L6 (Viewer parity), L7 (non-member).

**Verify:** `pnpm test -- --run test/medium/specs/sync/sync-shared-space-library-visibility-purge.spec.ts` + the asset.service unit; `make check-server`; `make sql` clean.

### Slice 3 — Cross-path convergence, invariants & retention

**Goal:** the three purge paths converge on one member; the union checkpoint is race-safe; the new audit tables are pruned.

**Tests first (red):** X1 (multi-path), X2 (empty list no-op), X3 (idempotent double-purge), X4 (union checkpoint — ack advances past both sources, next sync empty, nothing skipped), R1 (retention prune) — in the two specs above (X4 in the album spec, R1 in both).

- _Expected red:_ R1 fails until both `cleanupAuditTable` calls are wired; X4 fails if the union bounds the checkpoint per-arm instead of over the whole union (§5.2).

**Implement (green):** finalise `cleanupAuditTable` wiring in the `sync.service.ts` prune loop; confirm the `getDeletes` union orders/bounds as one stream.

**Verify:** both new specs + regression set (`sync-shared-space-visibility-purge.spec.ts`, `sync-shared-space-album.spec.ts`, `sync-shared-space-library.spec.ts`); `make sql`; `make check-server` + `make lint-server`; full server unit suite.

> Slices 1 and 2 are each independently shippable (one follow-up each); Slice 3 hardens the seams. Run `make sql` **only** with a DB up — never without, it deletes the query files.

---

## 8. Migration, codegen & rebase notes

- **Migrations:** two fork migrations in `migrations-gallery/` with non-colliding round timestamps; `postbuild` copies them into `dist/schema/migrations/`. Add a `DROP TABLE` per new table to `scripts/revert-to-immich/`.
- **SQL docs:** the new `getDeletes` arms and emit queries are on decorated repository methods → regenerate with `make sql` (DB required) and commit the generated `.sql`.
- **Rebase surface:** new fork-only tables/methods carry no upstream-merge risk. The touch points on shared code are minimal and additive: two `getDeletes` unions and the `updateAll` block — all fork-owned already (they carry `spaceVisibilityGate` / 4.B edits). No new sync request/entity types → no OpenAPI/SDK/Dart regeneration and no mobile change.

---

## 9. Out of scope / future

- **Mobile orphan-metadata GC:** the direct-path QA showed a harmless orphaned `remote_asset_entity` (no bytes) lingering after the last link is removed. Housekeeping only; tracked separately.
- **Mobile end-to-end QA for these two paths:** server behaviour is fully covered by medium tests here; a device pass (as done for 4.B) can confirm the client drops album/library-linked assets, but is not required for merge.

---

## 10. Acceptance criteria

- All BDD scenarios A1–A9, L1–L7, X1–X4, R1 and the `asset.service` dispatch-table unit tests pass (Slice 1 → A1–A9 + album dispatch; Slice 2 → L1–L7 + library dispatch; Slice 3 → X1–X4, R1).
- Direct-path and existing album/library sync specs remain green.
- `make check-server`, `make lint-server`, and regenerated `make sql` output are clean.
- Hiding an album- or library-linked space asset removes it from an already-synced member device; restoring re-adds it; the owner and normal (non-space) album members are unaffected.
