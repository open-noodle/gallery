# Duplicate Checksum Tombstone

## Problem

When visual duplicates are detected via CLIP and the user resolves them (keeping one, trashing others), the trashed asset's checksum is eventually hard-deleted from the `asset` table. The mobile app then sees no matching checksum on the server and re-uploads the file, creating an infinite dedup cycle:

1. Phone uploads photo A and photo B (visually similar, different SHA1 checksums)
2. CLIP duplicate detection groups them
3. User keeps A, trashes B
4. B goes to trash, eventually hard-deleted — **B's checksum removed from DB**
5. Phone's next backup: hashes local file B, calls `bulkUploadCheck()`, no match — re-uploads B
6. CLIP detects it as duplicate again — repeat forever

## Solution: `asset_duplicate_checksum` Table

A tombstone table that preserves checksums of duplicate-resolved assets, pointing to the kept asset:

```sql
CREATE TABLE asset_duplicate_checksum (
  assetId UUID NOT NULL REFERENCES asset(id) ON DELETE CASCADE,
  ownerId UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  checksum BYTEA NOT NULL,
  PRIMARY KEY (ownerId, checksum)
);
```

### Insert: During Duplicate Resolution

In `resolveGroup()` (in `DuplicateService`), after trashing assets, insert a tombstone for each trashed asset's checksum pointing to a kept asset. The checksums come from `duplicateGroup.assets` — `duplicateRepository.get()` must include `checksum` in its SELECT columns (currently loads `MapAsset` fields for merge logic but not `checksum`).

**Multi-keep**: When multiple assets are kept (`keepAssetIds.length > 1`), use `keepAssetIds[0]` deterministically as the tombstone target.

**Trash All**: When the user trashes every asset in a duplicate group (`keepAssetIds.length === 0`), no tombstones are created — there is no surviving asset to reference. This is a valid API request (the DTO allows empty `keepAssetIds` as long as every group member is in one of the two lists). The consequence is that the dedup re-upload cycle continues for those assets. This is acceptable: the user explicitly chose to discard everything, and re-upload followed by re-detection is the correct behavior since they didn't designate a keeper.

**Batch insert**: Use a single `INSERT INTO asset_duplicate_checksum (assetId, ownerId, checksum) VALUES ...` for all tombstones in a resolution group. For bulk resolution with many groups, each group's tombstones are inserted separately (one INSERT per group, not one per tombstone).

**Conflict handling**: Use `ON CONFLICT (ownerId, checksum) DO UPDATE SET assetId = EXCLUDED.assetId` to handle re-resolution of the same checksum (e.g., user resolves a group, then the same checksum appears in a new duplicate group later).

**Best-effort insert**: Wrap the tombstone INSERT in a try/catch. A failed tombstone insert (DB error, constraint violation) should NOT prevent duplicate resolution from succeeding. The worst case is the old re-upload behavior — the user's resolution still works, they just might see the file re-uploaded next backup cycle. Log the error for debugging.

**Timing safety**: Between `updateAll(idsToTrash, ...)` and the tombstone INSERT, a concurrent `emptyTrash` job could theoretically hard-delete the trashed asset. This is safe because the tombstone references the _kept_ asset (via `assetId`), not the trashed one. The trashed asset's checksum is copied into the tombstone row as data, not as a foreign key. The only FK is to the kept asset, which is still active.

**Checksum algorithm note**: The tombstone table does not store `checksumAlgorithm`. This is safe because duplicate detection excludes library assets (`libraryId IS NULL`), so tombstones only ever contain `sha1` (file content) checksums, never `sha1-path`. The upload check matches on raw bytes — no collision risk between algorithms.

### Query: During Upload Check

Extend two repository methods with application-level dedup:

1. **`AssetRepository.getUploadAssetIdByChecksum(ownerId, checksum)`** — called by `AssetMediaService.getUploadAssetIdByChecksum()`, used by the upload interceptor for single-file uploads. Query the `asset` table first; if no match, query `asset_duplicate_checksum`. Return the kept asset's ID. The service-layer method in `AssetMediaService` needs no changes — it passes through the repository result.

2. **`AssetRepository.getByChecksums(ownerId, checksums)`** — called by `AssetMediaService.bulkUploadCheck()` for batch upload checks. Currently returns `{ id, checksum, deletedAt }`. Query both tables separately and merge in TypeScript — asset-table results win for the same checksum:

```typescript
async getByChecksums(userId: string, checksums: Buffer[]) {
  const [assetResults, tombstoneResults] = await Promise.all([
    this.db.selectFrom('asset')
      .select(['id', 'checksum', 'deletedAt'])
      .where('ownerId', '=', asUuid(userId))
      .where('checksum', 'in', checksums)
      .execute(),
    this.db.selectFrom('asset_duplicate_checksum')
      .select(['assetId as id', 'checksum'])
      .where('ownerId', '=', asUuid(userId))
      .where('checksum', 'in', checksums)
      .execute(),
  ]);

  // Asset-table results take priority (have deletedAt for isTrashed flag)
  const seen = new Set(assetResults.map(r => r.checksum.toString('hex')));
  const merged = [
    ...assetResults,
    ...tombstoneResults
      .filter(r => !seen.has(r.checksum.toString('hex')))
      .map(r => ({ ...r, deletedAt: null })),  // not trashed — kept asset is active
  ];
  return merged;
}
```

**Tombstone `deletedAt` value**: Tombstone rows return `null` for `deletedAt`. The caller (`bulkUploadCheck`) interprets `deletedAt` to set `isTrashed`. Since the tombstone points to an active kept asset, `isTrashed: false` is correct — the upload is rejected because the content already exists on the server (as the kept asset).

**Query priority during overlap window**: While a trashed asset is still in the DB (soft-deleted, not yet hard-deleted), both the asset row AND the tombstone row exist for the same `(ownerId, checksum)`. The application-level dedup ensures the asset-table row wins, returning the trashed asset's ID with `isTrashed: true`. After hard deletion removes the asset row, the tombstone row takes over.

### Cleanup: CASCADE on Delete

`ON DELETE CASCADE` on `assetId` means:

- If the kept asset is later deleted, all its tombstones are removed — the checksums can be re-uploaded. This is correct: no surviving asset means no deduplication target.

**Limitation**: If the user kept A and C, trashed B (tombstone B->A), then later deletes A — the tombstone for B is removed even though C still exists. B could be re-uploaded. This is an acceptable trade-off: the next CLIP pass would catch it again, and this time the user might keep it. Implementing tombstone failover (re-pointing to C) adds complexity for a rare edge case.

### Cleanup: On Trash Restore

When trashed assets are restored, delete any tombstones whose checksums now conflict with active assets. Use a single post-restore SQL statement — no pre-fetch of checksums needed:

```sql
-- For restoreAssets(ids) — specific assets restored:
DELETE FROM asset_duplicate_checksum t
WHERE t."ownerId" = $1
AND t.checksum IN (
  SELECT a.checksum FROM asset a WHERE a.id = ANY($2)
)

-- For restore(userId) — all trashed assets for a user restored:
DELETE FROM asset_duplicate_checksum t
WHERE t."ownerId" = $1
AND t.checksum IN (
  SELECT a.checksum FROM asset a
  WHERE a."ownerId" = $1 AND a.status = 'active'
)
```

**Where to hook**: In `TrashService` (not `TrashRepository` — the repository is pure data access). After `trashRepository.restoreAll(ids)` or `trashRepository.restore(userId)` completes, call `duplicateRepository.deleteConflictingTombstones(ownerId, assetIds)` or `duplicateRepository.deleteConflictingTombstonesForUser(ownerId)` respectively. No extra checksum query needed — the DELETE subqueries fetch checksums inline.

### Concurrent Access

**Concurrent resolution of overlapping groups**: Two duplicate groups could share an asset being resolved simultaneously. The `ON CONFLICT DO UPDATE` clause on the tombstone INSERT handles this — whichever resolution commits last wins the tombstone target. Both resolutions succeed.

**Concurrent resolution + trash empty**: As noted in the timing safety section, the tombstone FK points to the kept asset, so concurrent trash emptying of the trashed asset is safe.

## Scope

### What creates tombstones

Only duplicate resolution (`POST /duplicates/resolve`). Manual deletion, bulk deletion, and other trash flows do **not** create tombstones. If a user manually deletes an asset, they intended to remove it — re-upload should be allowed.

### What does NOT change

- **Mobile app**: No changes needed. The existing `bulkUploadCheck()` call gets REJECT from the server, preventing the upload. The mobile makes the API call but doesn't upload the file. Note: the mobile may still pick the file as an upload candidate each backup cycle (local `remote_asset_entity` check passes since the asset was synced away), but the server rejects it — no data is transferred. This is the same behavior as regular duplicate rejection and is pre-existing.
- **OpenAPI / SDK**: No DTO changes. `bulkUploadCheck` response shape is unchanged — it still returns `{ action: REJECT, reason: DUPLICATE, assetId, isTrashed }`.
- **Library assets**: Duplicate detection already excludes library assets (`libraryId IS NULL` in the search). Tombstones inherit this scope — they only apply to user-uploaded assets.
- **Stacked assets**: Duplicate search already excludes stacks (`asset.stackId IS NULL`). No tombstone impact.

### Table growth

Tombstones are bounded by the number of duplicate resolutions. Each resolution creates at most `trashAssetIds.length` rows. CASCADE handles cleanup when the kept asset is deleted. No periodic cleanup job is needed — the table is self-managing.

## Files Changed

### New files

| File                                                                              | Purpose             |
| --------------------------------------------------------------------------------- | ------------------- |
| `server/src/schema/tables/asset-duplicate-checksum.table.ts`                      | Kysely table schema |
| `server/src/schema/migrations-gallery/1775100000000-AddAssetDuplicateChecksum.ts` | Fork migration      |

### Modified files

| File                                              | Change                                                                                                                                      |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/src/services/duplicate.service.ts`        | Insert tombstones (best-effort, try/catch) in `resolveGroup()` after trashing                                                               |
| `server/src/repositories/asset.repository.ts`     | Extend `getUploadAssetIdByChecksum()` and `getByChecksums()` with tombstone fallback (app-level dedup)                                      |
| `server/src/repositories/duplicate.repository.ts` | Add `checksum` to `get()` SELECT; add `createChecksumTombstones()`, `deleteConflictingTombstones()`, `deleteConflictingTombstonesForUser()` |
| `server/src/services/trash.service.ts`            | Call tombstone cleanup after restore/restoreAll                                                                                             |
| `server/src/schema/index.ts`                      | Add `AssetDuplicateChecksumTable` to `tables` array and DB interface                                                                        |

## Tests

### Unit tests (`duplicate.service.spec.ts`)

- Tombstone inserted when resolving duplicates (single keep, single trash)
- Tombstone inserted for multi-trash (keep A, trash B and C — two tombstones pointing to A)
- Multi-keep uses `keepAssetIds[0]` as tombstone target
- Trash All (no kept assets) creates no tombstones — resolution still succeeds
- Tombstone conflict updates `assetId` (re-resolution of same checksum)
- Tombstone INSERT failure does not fail resolution (best-effort, logs error)
- Re-resolution: resolve group, then same checksum appears in new group — tombstone updated via ON CONFLICT

### Unit tests (`asset.repository.spec.ts` or `asset-media.service.spec.ts`)

- `getUploadAssetIdByChecksum()` returns tombstone match when no asset match
- `getUploadAssetIdByChecksum()` prefers asset table over tombstone (overlap window)
- `bulkUploadCheck()` rejects checksums found in tombstone table with `isTrashed: false`
- `bulkUploadCheck()` prefers trashed asset row over tombstone row (overlap window returns `isTrashed: true`)
- `bulkUploadCheck()` with mixed results: some checksums in asset table, some in tombstone, some not found

### Unit tests (`trash.service.spec.ts`)

- Restoring a trashed asset deletes its tombstone
- Bulk restore deletes tombstones for all restored assets
- Restore with no matching tombstone — no error (DELETE WHERE finds nothing)

### Medium tests (DB required)

- Full flow: upload A+B, detect duplicate, resolve (keep A, trash B), empty trash, re-upload B — rejected via `bulkUploadCheck`
- Overlap window: resolve duplicate (B trashed, tombstone created), call `bulkUploadCheck` for B's checksum — returns trashed asset row, not tombstone
- Post-hard-delete: after trash emptied, `bulkUploadCheck` returns tombstone row with `isTrashed: false`
- Restore cycle: upload A+B → resolve → restore B from trash → tombstone cleaned up → B is active with its own checksum
- Delete kept asset: tombstone CASCADE'd, re-upload of trashed asset's checksum is now allowed
- Concurrent inserts: two tombstones for same `(ownerId, checksum)` — ON CONFLICT resolves without error

### E2E tests

- Upload two similar images, wait for duplicate detection, resolve, empty trash, attempt re-upload — verify REJECT response from `bulkUploadCheck()`

## Implementation Plan

### Step 1: Table schema and migration

Create the Kysely table definition and fork migration.

1. Create `server/src/schema/tables/asset-duplicate-checksum.table.ts` — define `AssetDuplicateChecksumTable` with columns `assetId`, `ownerId`, `checksum`, primary key `(ownerId, checksum)`, foreign keys with CASCADE
2. Register in `server/src/schema/index.ts` — add to `tables` array and `DB` interface
3. Create `server/src/schema/migrations-gallery/1775100000000-AddAssetDuplicateChecksum.ts` — CREATE TABLE with constraints and indexes

### Step 2: Repository methods

Add tombstone CRUD to `DuplicateRepository` and extend `AssetRepository` queries.

1. Extend `DuplicateRepository.get()` — add `checksum` to the asset SELECT columns so `resolveGroup()` has access to trashed assets' checksums
2. Add `DuplicateRepository.createChecksumTombstones(items: { assetId, ownerId, checksum }[])` — batch INSERT with ON CONFLICT DO UPDATE. Decorate with `@GenerateSql` and appropriate `DummyValue` params
3. Add `DuplicateRepository.deleteConflictingTombstones(ownerId, assetIds)` — deletes tombstones whose checksums conflict with the given (now-restored) assets. Uses a subquery to look up checksums from the asset table by ID, then deletes matching tombstone rows. Decorate with `@GenerateSql`
4. Add `DuplicateRepository.deleteConflictingTombstonesForUser(ownerId)` — deletes tombstones whose checksums conflict with any active asset for the user. Used after bulk restore where individual asset IDs aren't available. Decorate with `@GenerateSql`
5. Extend `AssetRepository.getUploadAssetIdByChecksum()` — add tombstone fallback query when asset table returns no match
6. Extend `AssetRepository.getByChecksums()` — parallel query both tables, app-level dedup with asset-table priority

All new and modified repository methods must have `@GenerateSql({ params: [...] })` decorators for `make sql` documentation generation.

### Step 3: Service logic

Wire tombstone insert into duplicate resolution and cleanup into trash restore.

1. `DuplicateService.resolveGroup()` — after the trash `updateAll` block, add best-effort tombstone insert: collect trashed assets' checksums, batch insert pointing to `keepAssetIds[0]`, skip if `keepAssetIds` is empty, wrap in try/catch with `this.logger.error()`
2. `TrashService.restoreAssets()` — after `trashRepository.restoreAll(ids)`, call `duplicateRepository.deleteConflictingTombstones(auth.user.id, ids)`
3. `TrashService.restore()` — after `trashRepository.restore(auth.user.id)`, call `duplicateRepository.deleteConflictingTombstonesForUser(auth.user.id)`

### Step 4: Unit tests

Add tests for all new and modified methods.

1. `duplicate.service.spec.ts` — 7 test cases listed in the Tests section above
2. `asset-media.service.spec.ts` — 5 test cases for upload check with tombstone fallback
3. `trash.service.spec.ts` — 3 test cases for tombstone cleanup on restore

### Step 5: Build, lint, generate

Verify everything compiles and passes CI checks.

1. Build server: `cd server && pnpm build`
2. Type check: `cd server && pnpm check`
3. Regenerate SQL query files: `make sql` (for `@GenerateSql` decorated methods)
4. Run unit tests: `cd server && pnpm test`
