# Upstream Sync Report — 2026-04-13

## Summary

- **Upstream version**: Immich v2.7.4 → **v2.7.5**
- **Upstream commits pulled**: 3
- **Fork commits replayed**: 242
- **Conflicts resolved**: 3 (all trivial)
- **Risk level**: **LOW**
- **Recommendation**: **PROCEED**

This is a minimal upstream release (v2.7.5) with no schema changes, no DTO changes, no CI changes, no mobile changes, and one small server-side behavioral fix to the version-check job. Fork features are all intact.

## Incoming Upstream Changes

| SHA         | Summary                                               | Area   | Risk to Fork | Notes                                                                                                                                                                                                                                                                              |
| ----------- | ----------------------------------------------------- | ------ | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `95e57a24c` | chore: version v2.7.5                                 | infra  | MEDIUM       | 16-file version bump. Conflicts expected on `mobile/pubspec.yaml` (fork uses `1.0.0+1`), with auto-merges on `cli/`, `e2e/`, `server/`, `web/`, `i18n/`, `package.json`, `machine-learning/pyproject.toml`, `mobile/android/fastlane/Fastfile`. `open-api/` spec regenerated.      |
| `eada66298` | chore(web): update translations (#27589)              | i18n   | LOW          | Translation updates for 17 locales (ar, da, de_CH, eo, hr, id, ko, lt, lv, nl, pl, th, uk, vi, yue_Hant, zh_Hans, zh_Hant). Fork doesn't touch `en.json` so no conflict on base. Auto-merged cleanly into all touched locale files.                                                |
| `352f6ecc2` | fix(server): rate limit + deduplication version check | server | LOW-MEDIUM   | Adds `DatabaseLock.VersionCheck = 800` to `enum.ts`, adds `VersionCheck` case in `job.repository.ts`, wraps `onBootstrap` in `tryLock(VersionCheck)` scoped to `Microservices` worker, adds 50-second dedup in `handleVersionCheck`. Conflicts with fork additions in same switch. |

### High-Risk Changes

None. The version-check fix (`352f6ecc2`) touches files fork also modifies but only in additive spots (new enum value, new switch case, new `onBootstrap` guard). Fork has its own version-check detachment (PRs #315/#316/#320) pointing at `version.opennoodle.de/gallery` and that continues to work because fork does not override `version.service.ts` itself — only the repository + config layers.

## Conflict Resolutions

### Conflict: `mobile/pubspec.yaml`

- **Fork side**: `version: 1.0.0+1` (Gallery's independent Play Store versioning from PR #121)
- **Upstream side**: `version: 2.7.5+3046`
- **Resolution**: Kept fork's `1.0.0+1`. Noodle Gallery ships as a separate app under `de.opennoodle.gallery` with its own version trajectory.
- **Risk**: LOW
- **Verification needed**: None. Matches current Play Store internal track.

### Conflict: `server/src/repositories/job.repository.ts`

- **Fork side**: Fork added `SharedSpaceBulkAddAssets` case (returns `jobId: bulk-add-${item.data.spaceId}-${item.data.userId}`) and `SharedSpacePersonDedup` case (returns `jobId: space-dedup-${item.data.spaceId}`) in the `getJobArgs` switch.
- **Upstream side**: Added `VersionCheck` case returning `jobId: JobName.VersionCheck`.
- **Resolution**: Kept all three cases. Each case handles a different `JobName`; no semantic overlap.
- **Risk**: LOW
- **Verification needed**: Type-check confirms JobName enum has `VersionCheck`, `SharedSpaceBulkAddAssets`, and `SharedSpacePersonDedup`.

### Conflict: `mobile/openapi/README.md`

- **Fork side**: Binary blob from a prior post-rebase regeneration commit.
- **Upstream side**: Binary blob from upstream v2.7.5.
- **Resolution**: Took theirs (upstream's). Then regenerated via `make open-api` after the rebase completed, which produced a fresh hash-stamped README matching the new OpenAPI spec.
- **Risk**: NONE
- **Verification needed**: None (regenerated).

## Fork Feature Verification

| Feature                                  | Status | Notes                                                                                                                                                                                              |
| ---------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared Spaces (server + web + mobile)    | OK     | Enums, permissions, sync types, tables, routes, mobile pages all intact. `SharedSpaceBulkAddAssets` + `SharedSpacePersonDedup` cases preserved in `job.repository.ts`.                             |
| Storage Migration                        | OK     | Queue + job enums intact in `enum.ts`, admin routes intact in `web/src/routes/admin/storage-migration/`.                                                                                           |
| Pet Detection                            | OK     | `PetDetection` queue + job name entries present.                                                                                                                                                   |
| User Groups                              | OK     | `UserGroup*` permission entries in `enum.ts`.                                                                                                                                                      |
| Classification                           | OK     | `Classification` queue, job names, `ClassificationConfigState` SystemMetadataKey, admin UI all intact.                                                                                             |
| Upstream Infrastructure Detachment       | OK     | `newVersionCheck` default `true`; URL points at `version.opennoodle.de/gallery`; User-Agent `gallery-server/{version}` in `fetch.ts`. Compatible with upstream's new `onBootstrap` worker-scoping. |
| Image Editing                            | OK     | `web/src/lib/managers/edit/`, `RotateAction.svelte` intact.                                                                                                                                        |
| Google Photos Import                     | OK     | `web/src/lib/components/import/`, `import-manager.svelte.ts`, `google-takeout-*.ts` all present.                                                                                                   |
| Discord/GitHub Support UI                | OK     | `purchase-info.svelte` + `purchase-content.svelte` intact.                                                                                                                                         |
| Filter Panel                             | OK     | `web/src/lib/components/filter-panel/` intact with all sub-components.                                                                                                                             |
| Branding                                 | OK     | `branding/config.json` updated to `"version": "2.7.5"`, scripts and assets intact.                                                                                                                 |
| Library User Access Grant (PR #329)      | OK     | Migration `1778300000000-AddLibraryUserTable.ts` present in `migrations-gallery/`, triggers in `functions.ts`.                                                                                     |
| Dedup → Space Membership Sync            | OK     | `syncSpaceMembershipOnDuplicateResolve` intact.                                                                                                                                                    |
| Mobile Shared-Space Drift Sync (PR #313) | OK     | `schemaVersion = 24`; `from22To23` + `from23To24` callbacks intact; snapshots `drift_schema_v23.json` + `drift_schema_v24.json` present.                                                           |

## CI and Infrastructure Verification

| Check                                                                 | Status | Notes                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fork-only `gallery-release.yml`                                       | OK     | OpenVINO variant present, `ghcr.io/open-noodle/gallery-*` registry refs intact.                                                                                                                                                                                     |
| Fork-only `gallery-docs-deploy.yml`                                   | OK     | `workflow_run` trigger + S3/CloudFront deploy intact.                                                                                                                                                                                                               |
| Fork-only `gallery-rc-build.yml`                                      | OK     | RC build workflow intact.                                                                                                                                                                                                                                           |
| Fork-only `gallery-mobile-scale-test.yml`                             | OK     | Mobile Drift scale test intact.                                                                                                                                                                                                                                     |
| Fork-only `storage-migration-e2e.yml` + `storage-migration-tests.yml` | OK     | Both present.                                                                                                                                                                                                                                                       |
| `static_analysis.yml` — DCM commented out                             | OK     | DCM step remains commented out.                                                                                                                                                                                                                                     |
| `auto-close.yml` — template enforcement removed                       | OK     | Only `close_llm` job remains.                                                                                                                                                                                                                                       |
| `docs-build.yml` — uses `github.token`                                | OK     | No `create-workflow-token` / `PUSH_O_MATIC` refs.                                                                                                                                                                                                                   |
| `docs-deploy.yml` — `workflow_dispatch` only                          | OK     | Upstream trigger change not re-introduced.                                                                                                                                                                                                                          |
| `pull_request_template.md` deleted                                    | OK     | File absent; upstream now uses `PULL_REQUEST_TEMPLATE/config.yml` instead.                                                                                                                                                                                          |
| `DISCUSSION_TEMPLATE/feature-request.yaml` — "Gallery"                | OK     | Reference to "Gallery" intact.                                                                                                                                                                                                                                      |
| `PUSH_O_MATIC` fork patches                                           | OK     | Only `merge-translations.yml` uses `PUSH_O_MATIC` (allowed exception). No other regressions.                                                                                                                                                                        |
| No `ghcr.io/immich-app/immich-*` leaks                                | OK     | Only expected `immich-app/base-images` references in Dockerfiles.                                                                                                                                                                                                   |
| Pre-existing `docker.yml` coexistence                                 | INFO   | `.github/workflows/docker.yml` exists alongside `gallery-release.yml`. This is **pre-existing fork state** (present on origin/main before rebase) — not a rebase regression. Both have fork patches (no DockerHub push, no ROCm, no `PUSH_O_MATIC`). Leaving as-is. |

## Database Migration Analysis

### New Upstream Migrations

None. Upstream v2.7.5 introduces no new server migrations.

### Timestamp Ordering

- Gallery migration interleaving: **OK** (no new upstream migrations to interleave with)
- Timestamp collisions: **NONE**

### Table Conflict Check

- Tables shared with gallery migrations: **NONE** (no upstream migration changes)
- Column/constraint conflicts: **NONE**

### Schema File Changes

- Fork-extended schema tables modified by upstream: **NONE**

### Postbuild Merge

- `postbuild` script intact: **YES** (confirmed during `make build-server`)
- Filename collisions: **NONE**
- `CompositeMigrationProvider` intact: **YES**

## Mobile Drift Migration Analysis

### New Upstream Mobile Migrations

None. Upstream v2.7.5 did not bump `mobile/lib/infrastructure/repositories/db.repository.dart` schemaVersion and added no new snapshots.

### Fork-Owned Mobile Migrations

| Schema Version (pre-rebase) | Schema Version (post-rebase) | Feature                          | Renumbered? | Notes                                      |
| --------------------------- | ---------------------------- | -------------------------------- | ----------- | ------------------------------------------ |
| v23                         | v23                          | PR #313 — shared*space*\* tables | NO          | Fork's `from22To23` migration step intact. |
| v24                         | v24                          | PR #313 — library_entity etc.    | NO          | Fork's `from23To24` migration step intact. |

### Collision Check

- Duplicate `drift_schema_vN.json` files: **NONE**
- Gaps in migration chain: **NONE**
- `schemaVersion` matches highest snapshot: **YES** (`24` ↔ `drift_schema_v24.json`)
- `fromXToY` callback chain contiguous: **YES**

### Release Safety

- Any fork build with pre-rebase schemaVersion shipped to users? Not applicable — no renumbering needed this rebase.

## Inconsistencies Found

None.

## Code Review Findings

Parallel review agents confirmed:

- **Server**: All fork version-check detachment features continue to work with upstream's new `onBootstrap` worker-scoping. Fork enum additions and job repository additions survive cleanly alongside upstream's `DatabaseLock.VersionCheck` / `JobName.VersionCheck` / `VersionCheck` job case.
- **Web + Mobile + Branding**: All fork feature entry points exist post-rebase; mobile Drift migration chain is contiguous; branding scripts + assets intact.
- **CI**: All fork-only workflows present and all fork modifications to upstream workflows are retained. No `PUSH_O_MATIC` regressions, no Docker image name regressions. Pre-existing `docker.yml` coexistence noted but not a rebase issue.

## Local CI Verification

_To be run in step 9 of the skill after report approval._

## Remote CI Verification

_To be run in step 10 of the skill after local verification._

## Post-Rebase Verification

- Fork commits ahead of upstream: 243 (242 rebased + 1 OpenAPI regen commit + 1 report commit)
- Commits behind upstream: 0
- Fork diff looks clean: **YES**
