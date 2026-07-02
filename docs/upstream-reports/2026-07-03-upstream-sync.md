# Upstream Sync Report — 2026-07-03 (v3.0.0 → v3.0.1)

## Summary

- **Upstream commits pulled**: 3 (Immich v3.0.0 base `237734bb26` → v3.0.1 `f77c8a4699`)
- **Conflicts resolved**: 2 (both version-file, mechanical)
- **Risk level**: LOW
- **Recommendation**: PROCEED
- **Batches**: 310 (`bf4b020856`, clean) + 311 (`f77c8a4699`, 2 conflicts)
- **Context**: this rebase is the base-bump step of the **v3 cutover to `main`** — after it lands green, `upstream.version` becomes `3.0.1` and `scripts/revert-to-immich.sql` is reworked to the v3.0.1 base (see the cutover prep commit).

## Incoming Upstream Changes

| SHA          | Summary                                                   | Area   | Risk to Fork | Notes                                                                                                                |
| ------------ | --------------------------------------------------------- | ------ | ------------ | -------------------------------------------------------------------------------------------------------------------- |
| `f73796597c` | fix: albums broken on v2 mobile clients (#29446)          | mobile | LOW (merged) | +7 lines to `mobile/lib/domain/services/sync_stream.service.dart` (fork-modified) — 3-way merged clean, no conflict. |
| `bf4b020856` | fix: setting input field spacing for description (#29433) | web    | LOW          | 4-line CSS tweak to `SettingInputField.svelte` (not fork-modified) — clean.                                          |
| `f77c8a4699` | chore: version v3.0.1                                     | config | LOW          | Mechanical `3.0.0 → 3.0.1` bumps; conflicted only on the two fork version files below.                               |

No migrations, no schema/DTO/enum/API changes, no CI/dependency changes, no broad refactors.

## Conflict Resolutions

### Conflict: `mobile/pubspec.yaml`

- **Fork side**: `version: 1.0.0+1` (fork commit #121 — fork's own Play Store versioning; real version stamped at build time from `FORK_VERSION`).
- **Upstream side**: `version: 3.0.1+3054`.
- **Resolution**: kept fork's `1.0.0+1`. **Risk**: LOW — source version is a placeholder; the release workflow stamps the real version.

### Conflict: `mobile/ios/Runner/Info.plist`

- **Fork side**: tab-indented plist (fork branding — "keep-TABS" per rolling gotchas).
- **Upstream side**: space-indented + v3.0.1 version.
- **Resolution**: took fork side (`--theirs`) — 43 tab-indented keys preserved. Version stamped at build time. **Risk**: LOW.

## Fork Feature Verification (from `make upstream-postrebase-audit BATCH=311`)

| Check                               | Status | Notes                                                                                                                             |
| ----------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Fork-Owned File Survival            | OK     | All literal fork-owned files present                                                                                              |
| Fork Extension Symbol Survival      | OK     | All manifest expected symbols present                                                                                             |
| Gallery Migration Count             | OK     | 33 (expected 33)                                                                                                                  |
| Gallery Migration Filename/Coverage | OK     | All manifest migrations present + globs match                                                                                     |
| Migration Timestamp Collision       | OK     | No upstream/gallery collision                                                                                                     |
| Generated Artifact Review           | REVIEW | openapi specs + mobile README = benign v3.0.1 bump (fork endpoints intact: `/gallery/map/markers`, `/shared-spaces/*`; 224 paths) |

## CI and Infrastructure Verification (`make ci-invariants-check`, `make fork-patches-check`)

| Check                                            | Status | Notes |
| ------------------------------------------------ | ------ | ----- |
| No upstream PUSH_O_MATIC token dependency        | OK     |       |
| Gallery release workflows publish Gallery images | OK     |       |
| Upstream docs deploy stays workflow_dispatch     | OK     |       |
| `@immich/ui` patch metadata consistent           | OK     |       |

## Database Migration Analysis

- **New upstream migrations**: NONE (v3.0.0 → v3.0.1 adds no migrations). `immich@v3.0.1` migration set == `immich@v3.0.0` (85 files) == rolling `server/src/schema/migrations/`.
- **Gallery migrations**: 33, all intact, no timestamp collisions.
- **Postbuild / CompositeMigrationProvider**: intact (audit passed).

## Mobile Drift Migration Analysis (`make mobile-drift-rebase-check BATCH=311`)

- **New upstream mobile migrations**: NONE.
- Mobile Drift `schemaVersion`, snapshots, and Gallery callbacks consistent (fork v23/v24 intact).

## Local Verification

| Check                                                          | Status | Notes                                             |
| -------------------------------------------------------------- | ------ | ------------------------------------------------- |
| `server` `tsc --noEmit`                                        | PASS   | exit 0, 0 errors                                  |
| `web` `tsc --noEmit`                                           | PASS   | 0 `error TS`                                      |
| postrebase-audit / ci-invariants / fork-patches / mobile-drift | PASS   | (Generated-artifact review = benign version bump) |

## Post-Rebase Verification

- Fork commits ahead of upstream: 885
- Commits behind upstream: 0
- Base: `f77c8a4699` (Immich v3.0.1)
- Fork diff clean: YES

## Remote CI

Dispatched against the rolling branch after the cutover-prep commit — see the babysit round (test.yml + docker + static_analysis + gallery-build-mobile + rebase-smoke + storage-migration-{tests,e2e} + revert-to-immich-validation).
