# Space Albums Phase 2A — Slice A4: Wire Contract + Five Sync Repository Classes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Define the `SharedSpaceAlbum*V1` sync entity types + DTOs (Step 0, the wire contract) and implement the **five** sync repository classes that stream a space's linked albums + membership + assets + exif to members, keyed off the `shared_space_album_user` grant (A1–A3). This is the repository layer only; the service dispatch handlers, `SyncRequestType` wiring, OpenAPI regen, and sync E2E are **A5**.

**Architecture:** Clone the personal album sync (`AlbumSync`, `AlbumToAssetSync`, `AlbumAssetSync`, `AlbumAssetExifSync`) re-keyed from `album_user` → the `shared_space_album_user` grant, plus a link stream cloned from `SharedSpaceLibrarySync`. Reuse existing wire DTOs; emit under **distinct** `SharedSpaceAlbum*V1` entity types so the client routes them to space Drift tables (the "absorbed" invariant). Two families: grant-keyed **metadata** (`SharedSpaceAlbumSync`) and space-keyed **link** (`SharedSpaceAlbumLinkSync`).

**Tech Stack:** Kysely streaming queries, `@immich/sql-tools` `@GenerateSql`, Vitest medium tests.

**Spec:** §6 (wire contract), §7 (sync classes + the hybrid-clone gotcha), §11 (A4).

**Depends on:** A1 (grant + audit tables + the two cleanup-only stub classes `SharedSpaceAlbumSync`/`SharedSpaceAlbumLinkSync`), A2 (`user_has_album_path`, create-side grants), A3 (delete-side audit rows). **Scope guard:** NO `SyncRequestType` additions, NO `SYNC_TYPES_ORDER`/handlers in `sync.service.ts`, NO OpenAPI regen, NO E2E — all A5. A4 ends at the repository layer + the entity-type/DTO/SyncItem-map definitions (which compile standalone because `SyncItem` is a non-exhaustive interface and no handler references the new types yet).

---

## The wire contract (entity types — additions to `SyncEntityType`, `enum.ts`, in the gallery-fork section)

```
// metadata family (grant-keyed)          ← clone AlbumSync
SharedSpaceAlbumV1, SharedSpaceAlbumDeleteV1, SharedSpaceAlbumBackfillV1
// link family (space-keyed)              ← clone SharedSpaceLibrarySync
SharedSpaceAlbumLinkV1, SharedSpaceAlbumLinkDeleteV1, SharedSpaceAlbumLinkBackfillV1
// membership                             ← clone AlbumToAssetSync
SharedSpaceAlbumToAssetV1, SharedSpaceAlbumToAssetDeleteV1, SharedSpaceAlbumToAssetBackfillV1
// assets (current V2 asset shape)        ← clone AlbumAssetSync
SharedSpaceAlbumAssetCreateV1, SharedSpaceAlbumAssetUpdateV1, SharedSpaceAlbumAssetBackfillV1
// exif                                   ← clone AlbumAssetExifSync
SharedSpaceAlbumAssetExifCreateV1, SharedSpaceAlbumAssetExifUpdateV1, SharedSpaceAlbumAssetExifBackfillV1
```

## DTO reuse + the one new DTO (`sync.dto.ts`) + `SyncItem` map entries

| Entity type                                                     | DTO (in the `SyncItem` interface map ~lines 612–671)                                                         |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `SharedSpaceAlbumV1` / `…BackfillV1`                            | `SyncAlbumV1` (the metadata shape `AlbumSync.getUpserts` selects)                                            |
| `SharedSpaceAlbumDeleteV1`                                      | `SyncAlbumDeleteV1` (`{albumId}`)                                                                            |
| `SharedSpaceAlbumLinkV1` / `…BackfillV1`                        | **new** `SyncSharedSpaceAlbumLinkV1` (`{spaceId, albumId, showInTimeline, addedById, createdAt, updatedAt}`) |
| `SharedSpaceAlbumLinkDeleteV1`                                  | **new** `SyncSharedSpaceAlbumLinkDeleteV1` (`{spaceId, albumId}`)                                            |
| `SharedSpaceAlbumToAssetV1` / `…BackfillV1`                     | `SyncAlbumToAssetV1`                                                                                         |
| `SharedSpaceAlbumToAssetDeleteV1`                               | `SyncAlbumToAssetDeleteV1`                                                                                   |
| `SharedSpaceAlbumAssetCreateV1` / `UpdateV1` / `BackfillV1`     | `SyncAssetV2` (the current album-asset shape; matches `AlbumAssetCreateV2`)                                  |
| `SharedSpaceAlbumAssetExifCreateV1` / `UpdateV1` / `BackfillV1` | `SyncAssetExifV1`                                                                                            |

Only **two** new DTO schemas: `SyncSharedSpaceAlbumLinkV1Schema` + `SyncSharedSpaceAlbumLinkDeleteV1Schema` (clone `SyncSharedSpaceLibraryV1Schema` + add `showInTimeline: z.boolean()`), each with an `@ExtraModel()` `createZodDto` class. Everything else reuses existing DTO classes already in the map.

## The five classes (`sync.repository.ts`) — clone source + re-key

| Class                                              | Clone of                 | Key transformation                                                                                                                                                                                                     |
| -------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SharedSpaceAlbumSync` (flesh out the A1 stub)     | `AlbumSync`              | `getCreatedAfter`/`getUpserts` join `album_user`→**`shared_space_album_user`** grant; **`getDeletes` reads `shared_space_album_user_audit`** (the gated grant audit), NOT `album_audit` — the hybrid-clone gotcha (§7) |
| `SharedSpaceAlbumLinkSync` (flesh out the A1 stub) | `SharedSpaceLibrarySync` | `shared_space_library`→`shared_space_album`; carry `showInTimeline`; `getDeletes` reads `shared_space_album_audit`; scope by `accessibleSpaces`                                                                        |
| `SharedSpaceAlbumToAssetSync` (new)                | `AlbumToAssetSync`       | `album_user`→grant; `getDeletes` reads `album_asset_audit` scoped to album ∈ `accessibleSpaceAlbums`                                                                                                                   |
| `SharedSpaceAlbumAssetSync` (new)                  | `AlbumAssetSync`         | `album_user`→grant; keep the split `getCreates`/`getUpdates`/`getBackfill` + `isFavorite` masking + the `album_asset.updateId <= albumToAssetAck.updateId` coupling                                                    |
| `SharedSpaceAlbumAssetExifSync` (new)              | `AlbumAssetExifSync`     | `album_user`→grant; same split + ack coupling                                                                                                                                                                          |

Plus the helper `accessibleSpaceAlbums(eb, userId)` (spec §7): albums linked to spaces the user belongs to, excluding soft-deleted albums (`album.deletedAt IS NULL`).

The grant-keyed `getCreatedAfter` lives on `SharedSpaceAlbumSync` (reads `shared_space_album_user` keyed `(userId, createId)`) and drives the per-album asset/membership/exif backfill loops (used by the A5 handlers). The link stream backfills per-space (`shared_space.createId`).

> **Run-command note:** scope medium tests with `pnpm test:medium <path>`.

---

### Task 1: Wire contract — entity types + DTOs + `SyncItem` map (compiles, no behavior)

**Files:** `server/src/enum.ts`; `server/src/dtos/sync.dto.ts`.

- [ ] **Step 1: Add the 15 `SyncEntityType` values** in the gallery-fork section of `enum.ts` (after the `SharedSpaceLibrary*` block), grouped exactly as listed in "The wire contract" above.

- [ ] **Step 2: Add the two new DTO schemas + classes to `sync.dto.ts`** (clone `SyncSharedSpaceLibraryV1Schema` at line 542 + its delete at 552):

```ts
const SyncSharedSpaceAlbumLinkV1Schema = z
  .object({
    spaceId: z.string().describe('Shared space ID'),
    albumId: z.string().describe('Album ID'),
    showInTimeline: z.boolean().describe('Whether this album appears in the space timeline'),
    addedById: z.string().nullable().describe('User who linked the album to the space'),
    createdAt: isoDatetimeToDate.describe('Created at'),
    updatedAt: isoDatetimeToDate.describe('Updated at'),
  })
  .meta({ id: 'SyncSharedSpaceAlbumLinkV1' });

const SyncSharedSpaceAlbumLinkDeleteV1Schema = z
  .object({
    spaceId: z.string().describe('Shared space ID'),
    albumId: z.string().describe('Album ID'),
  })
  .meta({ id: 'SyncSharedSpaceAlbumLinkDeleteV1' });
```

Add the `@ExtraModel()` `createZodDto` classes next to `SyncSharedSpaceLibraryV1`/`DeleteV1`.

- [ ] **Step 3: Add the `SyncItem` map entries** (the interface around lines 612–671) per the DTO table above — e.g. `[SyncEntityType.SharedSpaceAlbumV1]: SyncAlbumV1;`, `[SyncEntityType.SharedSpaceAlbumLinkV1]: SyncSharedSpaceAlbumLinkV1;`, `[SyncEntityType.SharedSpaceAlbumAssetCreateV1]: SyncAssetV2;`, etc. (all 15).

- [ ] **Step 4: tsc** — `cd server && pnpm check` → PASS (enum + interface additions compile; no handler references them yet). Commit: `git commit -am "feat(spaces): add SharedSpaceAlbum* sync entity types + link DTOs (Phase 2A slice A4)"`

---

### Task 2: `accessibleSpaceAlbums` + `SharedSpaceAlbumSync` (metadata)

**Files:** test `server/test/medium/specs/sync/shared-space-album-sync.spec.ts`; `server/src/repositories/sync.repository.ts`.

Read first: the `AlbumSync` class (clone source), `LibrarySync.getCreatedAfter` (the grant-keyed pattern), `accessibleLibraries`/`accessibleSpaces` (helper pattern), and `library-sync-created-after.spec.ts` (the repo-level test template — call the repo method directly via `ctx.syncRepository` / a SyncTestContext accessor).

- [ ] **Step 1: Write the failing repo-level test** covering: `getCreatedAfter` returns the album for a member granted via the create-side trigger, ordered by `createId`, filtered by `afterCreateId`, empty for a non-member; `getUpserts` returns the album metadata scoped to `accessibleSpaceAlbums` and excludes soft-deleted albums; `getDeletes` returns rows from `shared_space_album_user_audit` for the user (the gated grant audit). Mirror `library-sync-created-after.spec.ts` for the direct-call style.

- [ ] **Step 2: Run, verify RED** — `cd server && pnpm test:medium test/medium/specs/sync/shared-space-album-sync.spec.ts` → FAIL (methods are cleanup-only stubs; `getCreatedAfter`/`getUpserts`/`getDeletes` don't exist or return nothing).

- [ ] **Step 3: Add `accessibleSpaceAlbums`** (exported helper, near `accessibleLibraries`):

```ts
export function accessibleSpaceAlbums(eb: ExpressionBuilder<DB, keyof DB>, userId: string) {
  return eb
    .selectFrom('shared_space_album')
    .innerJoin('album', 'album.id', 'shared_space_album.albumId')
    .select('shared_space_album.albumId as id')
    .where('album.deletedAt', 'is', null)
    .where('shared_space_album.spaceId', 'in', (e) => accessibleSpaces(e, userId));
}
```

- [ ] **Step 4: Flesh out `SharedSpaceAlbumSync`** (keep its A1 `cleanupAuditTable('shared_space_album_user_audit')`). Clone `AlbumSync`'s `getCreatedAfter` (read `shared_space_album_user`), `getUpserts` (select the same `album` columns as `AlbumSync.getUpserts`: id, name, description, createdAt, updatedAt, thumbnailAssetId, isActivityEnabled, order, updateId — scoped by `accessibleSpaceAlbums`), and `getDeletes` (read **`shared_space_album_user_audit`**, select `['id','albumId']`, where `userId = options.userId`). Add `@GenerateSql` decorators as in the source.

- [ ] **Step 5: Run, verify GREEN** — same command → tests pass. Commit: `git commit -am "feat(spaces): SharedSpaceAlbumSync metadata stream (Phase 2A slice A4)"`

---

### Task 3: `SharedSpaceAlbumLinkSync` (link)

**Files:** test `shared-space-album-link-sync.spec.ts`; `sync.repository.ts`. Clone source: `SharedSpaceLibrarySync`.

- [ ] **Step 1: Write the failing repo test** — `getBackfill(spaceId)` returns the space's links incl. `showInTimeline`; `getUpserts` scoped by `accessibleSpaces`; `getDeletes` reads `shared_space_album_audit` (the link audit) scoped by `accessibleSpaces`. Mirror `sync-shared-space-library.spec.ts` patterns but call the repo method directly.
- [ ] **Step 2: RED** — `pnpm test:medium test/medium/specs/sync/shared-space-album-link-sync.spec.ts`.
- [ ] **Step 3: Flesh out `SharedSpaceAlbumLinkSync`** (keep its A1 `cleanupAuditTable('shared_space_album_audit')`). Clone `SharedSpaceLibrarySync`: define a `SHARED_SPACE_ALBUM_SYNC_COLUMNS` const (spaceId, albumId, showInTimeline, addedById, createdAt, updatedAt, updateId) mirroring `SHARED_SPACE_LIBRARY_SYNC_COLUMNS`; `getBackfill`/`getUpserts` over `shared_space_album` scoped by `accessibleSpaces`; `getDeletes` over `shared_space_album_audit` (`['id','spaceId','albumId']`).
- [ ] **Step 4: GREEN** + commit `feat(spaces): SharedSpaceAlbumLinkSync link stream (Phase 2A slice A4)`.

---

### Task 4: `SharedSpaceAlbumToAssetSync` (membership)

**Files:** test `shared-space-album-to-asset-sync.spec.ts`; `sync.repository.ts`. Clone source: `AlbumToAssetSync`.

- [ ] **Step 1: Failing repo test** — `getBackfill(albumId)` returns `(albumId, assetId)` rows; `getUpserts` scoped by the grant; `getDeletes` reads `album_asset_audit` scoped to album ∈ `accessibleSpaceAlbums`. Mirror `sync-album-to-asset.spec.ts`.
- [ ] **Step 2: RED.**
- [ ] **Step 3: Implement** — clone `AlbumToAssetSync` exactly, replacing the `album_user`-join scoping with the grant (`shared_space_album_user` for `getUpserts`; `accessibleSpaceAlbums` for `getDeletes`' albumId filter). New class instantiated in `SyncRepository` (prop `sharedSpaceAlbumToAsset`).
- [ ] **Step 4: GREEN** + commit `feat(spaces): SharedSpaceAlbumToAssetSync membership stream (Phase 2A slice A4)`.

---

### Task 5: `SharedSpaceAlbumAssetSync` + `SharedSpaceAlbumAssetExifSync` (assets + exif)

**Files:** tests `shared-space-album-asset-sync.spec.ts`, `shared-space-album-asset-exif-sync.spec.ts`; `sync.repository.ts`. Clone sources: `AlbumAssetSync`, `AlbumAssetExifSync`.

- [ ] **Step 1: Failing repo tests** — `getBackfill(albumId, userId)` returns the album's assets/exif; `getCreates` scoped by the grant; `getUpdates` honors the `album_asset.updateId <= albumToAssetAck.updateId` coupling; `isFavorite` is masked to `false` for a non-owner member. Mirror `sync-album-asset.spec.ts` / `sync-album-asset-exif.spec.ts`.
- [ ] **Step 2: RED.**
- [ ] **Step 3: Implement** — clone `AlbumAssetSync` (getCreates/getUpdates/getBackfill, preserving `columns.syncAlbumAsset` + the `isFavorite` CASE masking + the `albumToAssetAck` coupling) and `AlbumAssetExifSync`, swapping the `album_user`-join scoping for the grant (`shared_space_album_user`). New classes in `SyncRepository` (`sharedSpaceAlbumAsset`, `sharedSpaceAlbumAssetExif`).
- [ ] **Step 4: GREEN** + commit `feat(spaces): SharedSpaceAlbumAsset(+Exif)Sync streams (Phase 2A slice A4)`.

---

### Task 6: Gates — tsc, set-equality guard, regression

- [ ] **Step 1: tsc** — `cd server && pnpm check` → clean.
- [ ] **Step 2: Set-equality guard** — add a medium test asserting the **union of assets the five streams would deliver to a member equals the assets the Phase-1 read predicate makes readable via space-linked albums** (mirror the library set-equality guard if one exists; otherwise assert `getUpserts`/`getBackfill` asset ids == the access-predicate readable set for a fixture member). This pins "sync delivers exactly what's readable, no drift."
- [ ] **Step 3: Regression** — `cd server && pnpm test:medium test/medium/specs/sync/sync-album.spec.ts test/medium/specs/sync/sync-album-to-asset.spec.ts test/medium/specs/sync/sync-album-asset.spec.ts test/medium/specs/sync/sync-shared-space-library.spec.ts` → PASS (the personal album sync + library sync are untouched; the new classes don't interfere). Also `pnpm test -- --run src/services/sync.service.spec.ts`.
- [ ] **Step 4: Commit** any fixes.

---

## Self-Review (completed by plan author)

- **Spec coverage:** §6 entity types + DTO reuse + the one new link DTO → Task 1. §7 five classes (metadata grant-keyed w/ the getDeletes hybrid-clone gotcha; link space-keyed; membership; asset split + isFavorite + ack coupling; exif) + `accessibleSpaceAlbums` → Tasks 2–5. §11 A4 RED repo-stream tests + set-equality → Tasks 2–6. ✓
- **Scope:** No SyncRequestType / SYNC_TYPES_ORDER / handlers / OpenAPI / E2E (A5). Compiles standalone (SyncItem is a non-exhaustive interface; no handler references the new types). ✓
- **No placeholders:** entity-type list, DTO schemas, map entries, helper, and per-class clone-source + re-key + getDeletes-source are all explicit. Class bodies are "clone X, swap album_user→grant" against named, read-confirmed source classes — a precise mechanical transform, not a TODO. ✓
- **Type/name consistency:** the 15 entity types, two new DTOs, five class names (`SharedSpaceAlbumSync`/`…LinkSync`/`…ToAssetSync`/`…AssetSync`/`…AssetExifSync`), the helper `accessibleSpaceAlbums`, and the audit sources (`shared_space_album_user_audit` for metadata getDeletes; `shared_space_album_audit` for link getDeletes; `album_asset_audit` for membership/asset) are consistent with A1–A3 + §7. ✓
- **The hybrid-clone gotcha (§7) is explicit** in Task 2 Step 4: `SharedSpaceAlbumSync.getDeletes` reads the grant audit, NOT `album_audit` — do not blind-copy `AlbumSync.getDeletes`. ✓
