# Storage Usage Opt-In for Cached Derivatives — Design

**Status:** implemented. This document describes the design as shipped, after the two-toggle draft was collapsed to one.

**Goal:** Revert user storage usage to upstream Immich semantics (originals only) by default, and put the fork's derivative-inclusive accounting behind a single admin opt-in.

## Background

A May fork change made storage usage count physical bytes — originals **plus** thumbnails and transcoded videos — by reusing the existing `quotaUsageInBytes` column and changing what got written into it. It needed no migration and no new column. Users found the resulting number misleading, because it counts server-generated files they never uploaded and cannot delete.

An intermediate draft of this change offered two independent opt-ins — one for the displayed figure, one for quota enforcement. Supporting them independently means holding two numbers at once, which forced a second `physicalUsageInBytes` column, a migration, a new field on `AuthUser`/`UserAdmin` and both user DTOs, a `ServerConfigDto` flag so clients knew which number to render, and a matching read-site change in every surface that shows storage. That draft was abandoned: the two toggles can disagree, and a user shown "10 GB of 20 GB" right up to a rejected upload is worse off than before.

## Architecture

**One config key: `storageUsage.includeDerivatives`, default `false`.** One stored number, `quotaUsageInBytes`, which always already means whatever the admin asked for:

- **Off (default):** the column holds originals only, written by upstream's restored `UserRepository.syncUsage` — a single SQL statement summing `asset_exif.fileSizeInByte` where `libraryId is null`. This is byte-for-byte upstream behaviour, including the cost: no filesystem walk runs.
- **On:** the nightly job walks disk and S3 per user, computing originals + profile images + thumbnails + transcodes (excluding external-library assets), and writes the result into the same column via the fork's `UserRepository.setUsage`.

The two paths are deliberately either/or. Running upstream's statement as well would immediately overwrite the walked figure with the originals-only one.

**Nothing downstream knows about the setting.** Display, quota enforcement, the admin user page and mobile all read `quotaUsageInBytes` exactly as upstream does. That is the whole point: no `ServerConfigDto` flag, no second DTO field, no migration, no column, and no read-site changes anywhere in web or mobile. The two surfaces can never disagree, because there is only one number.

**Changing the setting queues a resync.** Both directions leave the column stale — switching on leaves an originals-only figure, switching off leaves a derivative-inclusive one — so `StorageUsageService` queues `UserSyncUsage` on any change of the flag.

## Fork ownership

`docs/fork/ownership.yml` requires every file differing from `upstream/main` to be declared, so real logic lives in the fork namespace (`server/src/gallery/**`) and what remains in upstream files is a thin call carrying a `// Gallery-fork:` marker.

### Fork-owned files

| File                                                                  | Responsibility                                                      |
| --------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `server/src/gallery/storage-usage.ts`                                 | All physical-usage logic: derivative filename parsing + the walk    |
| `server/src/gallery/storage-usage.service.ts`                         | Queues a resync when the toggle changes, in either direction        |
| `web/src/routes/admin/system-settings/StorageUsageSettings.svelte`    | Admin panel section — one switch plus the refresh hint              |
| `server/src/backends/*-storage.backend.ts`, storage-backend interface | Fork-created (S3 support). `getPrefixUsage` gains a filename filter |
| `server/test/medium/specs/repositories/user-usage.repository.spec.ts` | `syncUsage` / `updateUsage` / `setUsage` coverage against a real DB |

### Upstream files touched

| File                                                | Fork footprint                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------------- |
| `server/src/services/base.service.ts`               | `syncUsage` branches on the flag: upstream statement, or the walk         |
| `server/src/repositories/user.repository.ts`        | Restores upstream `syncUsage` **verbatim**; appends the fork's `setUsage` |
| `server/src/repositories/storage.repository.ts`     | `getFolderSize` (already fork-added) gains a filename filter              |
| `server/src/repositories/asset.repository.ts`       | One appended method, `getExternalAssetIds`                                |
| `server/src/config.ts`, `dtos/system-config.dto.ts` | One config group, following the existing `classification` precedent       |
| `server/src/services/index.ts`                      | Two additive lines registering the fork service                           |
| `web/src/routes/admin/system-settings/+page.svelte` | Import + one list entry                                                   |
| `server/test/repositories/asset.repository.mock.ts` | One method                                                                |

`updateUsage` reverts to upstream exactly — a single unclamped column delta. `server/src/database.ts`, both user DTOs, `dtos/server.dto.ts`, `services/server.service.ts`, `services/asset-media.service.ts`, `schema/tables/user.table.ts`, `scripts/revert-to-immich.sql`, `StorageSpace.svelte`, `rail-storage.svelte` and the admin user page are all **untouched**, as are the generated API artifacts except for the new `SystemConfigStorageUsageDto`.

## Excluding external-library assets

Upstream's originals-only sum excludes external-library assets (`libraryId is null`). Derivative files, however, are laid out by owner with no library dimension, so a plain folder walk cannot tell an external asset's thumbnail from an uploaded one's.

Every asset-derived filename starts with the asset UUID (see `StorageCore.getImagePath` / `getEncodedVideoPath`), so `getDerivativeAssetId` recovers the id from the filename and the walk filters it against the owner's external asset ids. Files not keyed on an asset id (HLS segments, Android motion sidecars) return `null` and are counted. Person thumbnails also match the `<uuid>.` shape and are returned, but they are naturally excluded by the set-membership test.

## Cost

The walk is expensive — hundreds of thousands of stat calls on a large install — so it only runs when the toggle is on. A default install's nightly quota sync is exactly as cheap as upstream's single statement: the change reverts the cost, not just the number.

Both `StorageUsageService` handlers are pinned to `workers: [ImmichWorker.Microservices]`. The API worker emits `ConfigUpdate` locally **and** relays it over the redis adapter, and `UserSyncUsage` has no `jobId`, so an unpinned handler would enqueue one full walk per worker and once more per extra API replica.

The `ConfigInit` handler exists for config-file installs, which never emit `ConfigUpdate` — `SystemConfigService.updateSystemConfig` rejects outright while `IMMICH_CONFIG_FILE` is set. Restart is the only signal those installs give us, so the resync repeats on every boot while the toggle is on. That is bounded by restart frequency, which is far below the nightly job's.

## Verification

- `cd server && pnpm check && pnpm lint && pnpm test --run`
- `cd server && npx vitest --config test/vitest.config.medium.mjs run test/medium/specs/repositories/user-usage.repository.spec.ts test/medium/specs/repositories/asset.repository.spec.ts` — needs Docker.
- `cd web && pnpm check:typescript && pnpm check:svelte && pnpm lint && pnpm test --run`
- `npx prettier --check "i18n/*.json" "docs/**/*.md"`
- `make fork-ownership-coverage-check`
- Manual: with the toggle off, a user's sidebar figure matches `sum(fileSizeInByte)` for their non-external assets, **and** the nightly sync performs no filesystem walk.
- Manual: turn the toggle on — the resync is queued immediately, and afterwards the figure rises to include thumbnails and transcodes. A user with an external library does not see that library's derivatives counted. Uploads are then rejected against the same larger figure.
- Manual: turn it back off — the resync is queued again and the figure returns to originals only.
- Manual: a user with no quota still sees whole-server disk figures in the sidebar either way — unchanged upstream behaviour.

Known pre-existing flake: `server/src/controllers/search.controller.spec.ts` can fail with `socket hang up` under full-suite parallelism; re-run it alone to confirm.

## Known limitations

- **Derivative bytes lag between nightly runs.** Live deltas (`updateUsage`) track original file sizes only, so with the toggle on, deleting an asset leaves its thumbnail/transcode bytes counted until the next scan reconciles. Bounded and self-correcting.
- **A nightly scan racing an upload can clobber a delta.** `setUsage` absolute-sets, so an upload completing mid-scan may have its delta overwritten. Corrects itself on the next run, and is pre-existing in the same shape.
- **HLS segments, Android motion sidecars and person thumbnails are always counted**, even when they belong to an external-library asset, because they are not keyed on an asset id. They are small and transient relative to previews and transcodes.

## Out of scope

- **Reconciling the admin server-status page.** `usageByUser[].usage` is computed from exif sums and so remains originals-only regardless of the toggle. With the toggle on it therefore disagrees with the storage card on the admin user page. Reconciling that view is a separate change.
