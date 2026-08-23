# Upstream Sync Report — 2026-06-16

## Summary

- **Mode**: rolling-upstream-rebase on `rebase/upstream-rolling-20260509-active` (v3-cutover branch, held off `main`, deployed to staging)
- **Fork commits synced** (origin/main `3e783c3b..ca3c09c2`): 1 (#700)
- **Upstream commits pulled** (`622a330d8..0f49bcbd27`): 17 (batches 247–255)
- **Conflicts resolved**: 8 distinct sites (duplicate metadata, system-config zod/cron, 3× lockfile, package.json, SearchFilterModal delete, 2× mobile)
- **Post-rebase fixes**: #700 adapted to v3 schema (album_user owner, nullable timestamps); `@immich/ui` 0.80.0→0.81.1 patch re-pin; OpenAPI + lockfile + SQL regen
- **New migrations this batch**: 0 (server and mobile) — Gallery migration count steady at 33
- **Risk level**: MEDIUM (two genuine reconciliations: duplicate-resolution metadata gating, `@immich/ui` patch bump)
- **Recommendation**: PROCEED — 0 behind upstream; server (4650) unit suite + web type-check green; all structural audits green

> **Scope note (held rolling branch):** Not force-pushed to `main`; pushed to its own remote (`origin/rebase/upstream-rolling-20260509-active`, the staging-deployed branch). The skill's force-push-to-main and `branding.upstream.version` bump steps are intentionally skipped — the revert-to-immich baseline stays at the tagged `v2.7.5`, and the v3 version story is handled at cutover/release time.

## Part A — Fork sync (origin/main → rolling branch)

`make upstream-sync-fork-main` is all-or-nothing and threw when the only commit (#700) conflicted on two **generated SDK files** (`packages/sdk/src/fetch-client.ts`, `mobile/openapi/lib/api/users_admin_api.dart`) — #700 was generated against `origin/main`'s API while the rolling branch carries extra upstream surface. Resolved by hand per the skill escape hatch: took the incoming generated files (regenerated wholesale later), completed the cherry-pick, and **manually advanced `integratedForkHead` to `ca3c09c2`** in `rolling-state.json`.

| Source SHA | PR                                          | Result     | Notes                                                                                                           |
| ---------- | ------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------- |
| `ca3c09c2` | #700 admin library-manifest export endpoint | `5e9f2a65` | Source applied clean; generated SDK conflicts resolved + regenerated. New fork admin endpoint + service + DTOs. |

## Part B — Upstream rebase (17 commits, batches 247–255)

| SHA        | PR                                              | Area       | Risk   | Outcome                                  |
| ---------- | ----------------------------------------------- | ---------- | ------ | ---------------------------------------- |
| `cc8d3b41` | #29035 don't merge metadata w/ multiple keepers | server     | MED-HI | **reconciled** (duplicate.service)       |
| `f21a753a` | #29136 integrity report checksum query          | server     | LOW    | clean (fork doesn't extend integrity)    |
| `a23a7c69` | #29134 map settings (+@immich/ui 0.81.1)        | web/deps   | MED-HI | **reconciled** (lockfile + patch bump)   |
| `e70a1163` | #29138 too strict cron validation               | server     | MED    | **reconciled** (system-config zod/cron)  |
| `54895fb1` | #29129 node ^24.13.2                            | deps/build | MED    | **reconciled** (package.json + lockfile) |
| `8036dc4b` | #29128 search date timezone                     | web        | LOW    | clean (modal)                            |
| `1fa03412` | #29065 language selector                        | web/mobile | LOW    | clean                                    |
| `ce59cc92` | #29141 AssetBulkUploadCheckItem doc             | server/sdk | LOW    | clean (OpenAPI regen)                    |
| `d307ab60` | #29137 datetimeRelative doc minutes             | server/sdk | LOW    | clean (OpenAPI regen)                    |
| `10fddf2d` | #29112 resize map after scroll                  | mobile     | LOW    | **reconciled** (map_bottom_sheet)        |
| `010220d5` | #29104 video thumbnail quality sharing          | mobile     | LOW    | clean                                    |
| `9ee41211` | #29133 sync albums isolate crash                | mobile     | LOW    | clean                                    |
| `805ca1a2` | #29087 maintenance page tweaks                  | web        | LOW    | clean                                    |
| `3c2296b8` | #29143 use ui's Badge                           | web        | LOW    | clean (no fork import of removed Badge)  |
| `34f78e3f` | #29124 update github-actions                    | CI         | LOW    | clean                                    |
| `df4a708a` | #29145 remove vite-tsconfig-paths               | e2e        | LOW    | clean                                    |
| `0f49bcbd` | #29118 don't optimize on cleanup                | mobile     | LOW    | **reconciled** (background_worker)       |

### Conflict 1 — `duplicate.service.ts` + `.spec.ts` (#29035 vs fork #317)

Upstream #29035 gates the album/tag/exif metadata merge behind `idsToKeep.length === 1 && idsToTrash.length > 0` (don't merge when multiple keepers). Fork #317 ("sync shared space membership when resolving duplicates") added a space-membership sync block.

- **Resolution**: keep the fork's space-sync block running for **all** keepers (gated `idsToKeep.length > 0`, independent and placed first), and apply upstream's new `=== 1` gate to **only** the metadata-merge block that follows. The fork's checksum-tombstone block below was untouched. Spec: kept both upstream's new "multiple keepers" test and the fork's `describe('shared space sync')` block (a global `beforeEach` defaults `getEditableByAssetIds → ∅`, so the upstream test passes under fork code).
- **Risk**: MEDIUM. Server unit suite green (incl. both test blocks).

### Conflict 2 — `system-config.dto.ts` (#29138 cron vs fork #246/#955935e/#433)

Upstream migrated `system-config.dto.ts` to **zod** (`createZodDto`) and #29138 added `validateCronExpression`-based cron validation. Three fork commits replayed across the drift: #246 (classification config, then class-validator), `955935e` (zod conversion of fork DTO extensions), #433 (fork cron-wildcard fix).

- **Resolution**: union imports through the transitional commit, then zod-only once `955935e` converts the classification section (final body is pure zod, matching `dec14c9370`). For the cron schema, took upstream's `.superRefine(validateCronExpression)` — it subsumes the fork's #433 "accept wildcard steps" intent (same cron parser).
- **Risk**: MEDIUM. tsc + server unit suite green.

### Conflict 3 — `pnpm-lock.yaml` (×3, fork squash base)

The fork squash base conflicted on the lockfile against upstream's @immich/ui-0.81.1 / node-bump / ffmpeg-arm64 lock churn. Resolved to the fork side each time to keep later fork commits applying, then regenerated authoritatively with one `pnpm install --no-frozen-lockfile` at the end (node ^24.13.2 + @immich/ui 0.81.1 + fork S3 deps). `@faker-js/faker` stayed `10.3.0` (matches `dec14c9370`) — UI Playwright fixtures safe.

### Conflict 4 — `package.json` (#29129 node vs fork #28922)

Upstream bumped `@types/node` to `^24.13.2`; the fork (#28922 "drop upstream pump-version refactor") removed `@types/node` from the root `devDependencies` (confirmed absent in `dec14c9370`). Took the fork side (line removed).

### Conflict 5 — `SearchFilterModal.svelte` (modify/delete: #29128 vs fork #416)

Upstream #29128 tweaked the modal's date-range timezone; fork #416 ("remove the legacy SearchBar flow") **deletes** the file. Honored the fork deletion (`git rm`) — confirmed absent in `dec14c9370`.

### Conflict 6 — `background_worker.service.dart` (#29118 vs fork #639)

Upstream #29118 added `await _optimizeDB()` to `onAndroidUpload`; fork #639 added `await _backupEventRecorder?.recordAndroidWake()`. Both are independent additions — kept both, with `recordAndroidWake()` first (matching the iOS path's record-wake-first convention), then `_optimizeDB()`.

### Conflict 7 — `map_bottom_sheet.widget.dart` (#29112 vs fork #625)

Upstream #29112 fixed map resize after scroll (`hasScrollBody: false` + `SizedBox(height: 0)`); fork #625 renamed the timeline widget `_ScopedMapTimeline` → `MapBottomSheetTimeline`. Combined: upstream's resize-fix structure wrapping the fork's `MapBottomSheetTimeline()`.

### Conflict 8 — generated SDK files (fork sync)

`fetch-client.ts`, `users_admin_api.dart`, `asset_bulk_update_dto.dart` — resolved to incoming during the #700 cherry-pick, then fully regenerated from the synced server spec.

## Post-Rebase Fixes (committed on the branch)

| Commit    | Change                                                                                   | Why                                                                                                                            |
| --------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `8fe2458` | `album.repository.getOwnedAlbumIdsForAssets` → `album_user` (role=Owner) exists-subquery | v3 upstream dropped the `album.ownerId` column; #700 used it                                                                   |
| `8fe2458` | `LibraryManifestAssetDto.fileCreatedAt/fileModifiedAt` → nullable                        | asset timestamps are nullable in v3 upstream                                                                                   |
| `8fe2458` | `@immich/ui` patch 0.80.0→0.81.1 (rename + `patchedDependencies` pin)                    | upstream #29134 bumped the dep; cmdk/ImageCarousel patch applies cleanly to 0.81.1                                             |
| `0c1d91b` | `docs/fork/ownership.yml` `expected_patch` → 0.81.1                                      | keep `fork-patches-check` green after the patch rename                                                                         |
| `fb57d9f` | regen `pnpm-lock` + OpenAPI TS SDK + Dart client                                         | node bump + @immich/ui + #700 endpoint over full v3 API + nullable manifest timestamps + #29137/#29141 doc text                |
| `8fe2458` | hand-updated `album.repository.sql` for the new owner query                              | no local DB for `mise sql`; format mirrors `getOwnedNames` exists-subquery (CI `test.yml` sql-sync job validates exact output) |

## Fork Feature Verification

| Feature                                 | Status | Evidence                                                             |
| --------------------------------------- | ------ | -------------------------------------------------------------------- |
| Shared Spaces (incl. dedup→space sync)  | OK     | duplicate.service reconciliation unit-tested; postrebase audit green |
| Library Manifest Export (#700)          | OK     | new endpoint builds + OpenAPI regenerated; adapted to v3 schema      |
| Auto-Classification (SystemConfig)      | OK     | system-config zod reconciliation; server unit suite green            |
| Gallery Map (shared-space on personal)  | OK     | Map.svelte UTC merge + `withSharedSpaces` intact; web check green    |
| Mobile background backup (#639)         | OK     | background_worker reconciliation (wake-record + optimizeDB)          |
| Mobile timeline grouping (#625)         | OK     | map_bottom_sheet widget reconciled                                   |
| cmdk / Global Search (@immich/ui patch) | OK     | patch applies to 0.81.1; fork-patches-check green                    |
| Branding / revert-to-immich             | OK     | coverage detector: 0 missing (0 new migrations)                      |

## CI / Infrastructure Verification

| Check                           | Status | Notes                                                               |
| ------------------------------- | ------ | ------------------------------------------------------------------- |
| `ci-invariants-check`           | OK     | no PUSH_O_MATIC; gallery release images; docs-deploy dispatch-only  |
| `fork-patches-check`            | OK     | @immich/ui patch metadata consistent (0.81.1)                       |
| `mobile-drift-rebase-check`     | OK     | schemaVersion/snapshots/callbacks consistent (no change)            |
| `upstream-postrebase-audit` 255 | OK     | 33 migrations, no timestamp collisions, manifest symbols present    |
| `34f78e3f` gh-actions bump      | OK     | fork CI mods (PUSH_O_MATIC removal / check-openapi disabled) intact |

## Database Migration Analysis

- **New upstream migrations in batch**: 0 (none of the 17 commits touch `server/src/schema/migrations/`).
- **Gallery migration count**: 33 (expected 33) — postrebase audit green, no collisions.
- **Mobile Drift**: no `schemaVersion` change; snapshots + Gallery callbacks consistent.
- **revert-to-immich.sql**: coverage detector run against `v2.7.5` tree (68 migrations) — 0 missing.

## Local Verification

| Check                                   | Status                                  |
| --------------------------------------- | --------------------------------------- |
| `pnpm --filter immich build`            | PASS (postbuild synced 33 migrations)   |
| server unit suite                       | PASS (4650 passed, 9 skipped)           |
| web `check:svelte` + `check:typescript` | PASS                                    |
| web unit suite                          | PASS (3164 passed, 2 skipped, 8 todo)   |
| OpenAPI regen (TS SDK + Dart)           | PASS (synced from server, builds clean) |
| `@immich/ui` patch applies to 0.81.1    | PASS (node_modules patched variant)     |

## Post-Rebase Verification

- Commits behind upstream: **0**
- All 17 upstream commits confirmed ancestors of HEAD; final tip `0f49bcbd27`
- No leftover conflict markers anywhere in the tree
- `rolling-state.json`: `integratedForkHead` → `ca3c09c2`, `upstreamTargetHead` → `0f49bcbd27`, completed batches → 255
