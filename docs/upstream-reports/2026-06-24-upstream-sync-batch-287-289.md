# Upstream Sync Report — 2026-06-24 (batches 287–289)

## Summary

- **Branch**: `rebase/upstream-rolling-20260509-active` (rolling v3-cutover branch)
- **Upstream commits pulled**: 3 (`9d6c219..0931a19`)
- **Conflicts resolved**: 2 (`docker/example.env`, `docs/docs/install/upgrading.md`)
- **Risk level**: LOW
- **Recommendation**: PROCEED

This batch advances the rolling branch's integrated upstream head from `9d6c21927` to
`0931a19c5c` (current `upstream/main`). The fork side was already fully synced
(`integratedForkHead` == `origin/main` == `7dbd29113`, batch 287 fork-sync earlier the
same day), so no `upstream-sync-fork-main` was required.

The three incoming commits were planned as upstream batches 287/288/289 by
`make upstream-batch-plan` (the plan renumbers from the fork↔upstream merge-base on each
run). Because all three are tiny and touch disjoint files, the three incremental rebases
were consolidated into a single `git rebase 0931a19c5c` (batch 289's own listed tip,
identical end state), and all three batches' scoped audits were run afterward.

## Incoming Upstream Changes

| SHA          | Summary                                                       | Area          | Risk to Fork | Notes                                                                                                 |
| ------------ | ------------------------------------------------------------- | ------------- | ------------ | ----------------------------------------------------------------------------------------------------- |
| `e5b50a55a4` | fix(mobile): blank notifications page after enabling (#29232) | mobile + i18n | LOW          | Adds an `else` status tile to `notification_setting.dart` + 3 `i18n/en.json` keys. Runtime `.tr()`.   |
| `08b2e2c0b5` | fix(docs): Revert v3 bump (#29310)                            | docs + env    | LOW          | Reverts `IMMICH_VERSION` / `:v3` metatag → `v2` in `docker/example.env` + 2 install docs.             |
| `0931a19c5c` | fix: run test suite for plugin changes (#29311)               | CI            | LOW          | Adds `packages/plugin-core/**` + `packages/plugin-sdk/**` to the `server` paths-filter in `test.yml`. |

No migrations (server or mobile Drift), no schema/DTO/enum/API changes, no dependency
bumps, no broad architectural refactors, no test-infra/factory changes, and no overlap
with any fork feature surface.

## Conflict Resolutions

### Conflict: `docker/example.env`

- **Fork side (squashed fork commit `ccf8725333`)**: `IMMICH_VERSION=v3` (comment "v3.0.1") — the fork pins its own version metatag here; a later fork commit bumps it to `v4`.
- **Upstream side (`08b2e2c`)**: reverted the value `v3` → `v2`.
- **Resolution**: took the **fork side** (`v3`). The fork owns this deploy-config version pin; upstream's revert is irrelevant to it. A subsequent fork commit in the replay correctly rebranded + bumped it to **`IMMICH_VERSION=v4`** (final state verified).
- **Risk**: LOW. **Verification**: final `docker/example.env` reads `IMMICH_VERSION=v4` with the Gallery-branded comment, and nets to **zero diff** vs the pre-rebase rolling tip.

### Conflict: `docs/docs/install/upgrading.md`

- **Fork side (rebrand commit `769eba2d32`, #167)**: rebranded "Immich follows…" → "Gallery follows…"; metatag value `:v3` was inherited from upstream at the time (not a deliberate fork choice).
- **Upstream side (`08b2e2c`)**: reverted the metatag value `:v3` → `:v2`.
- **Resolution**: **combined both** — kept the fork's deliberate rebrand ("Gallery follows…") and accepted upstream's value correction (`:v2`). This honours the rolling-rebase rule (absorb upstream-owned corrections, preserve deliberate fork divergence).
- **Risk**: LOW. **Verification**: the sibling `docs/docs/install/environment-variables.md` auto-merged to a consistent `v2`, and `docker/example.env`'s table is unaffected. (Pre-existing, unrelated prettier drift exists in this file's `MACHINE_LEARNING_*` table — see below — but is untouched by this resolution.)

## Fork Feature Verification

| Feature           | Status | Notes                                                                                            |
| ----------------- | ------ | ------------------------------------------------------------------------------------------------ |
| Shared Spaces     | OK     | `server/web/cli/machine-learning/e2e/open-api` byte-identical to pre-rebase tip.                 |
| Storage Migration | OK     | (same — no server/web change in this batch)                                                      |
| Pet Detection     | OK     | (same)                                                                                           |
| User Groups       | OK     | (same)                                                                                           |
| Image Editing     | OK     | (same)                                                                                           |
| Branding          | OK     | Post-rebase audit "Fork-Owned File Survival" + CI-invariants `gallery-release-image-names` PASS. |
| Google Photos     | OK     | (same)                                                                                           |

The full changed surface vs the pre-rebase rolling tip (`c9770619a0`) is exactly **5 files**:
`docs/docs/install/{environment-variables,upgrading}.md`, `mobile/lib/widgets/settings/notification_setting.dart`,
`i18n/en.json`, `.github/workflows/test.yml`. All of `server/`, `web/`, `cli/`,
`machine-learning/`, `e2e/`, and `open-api/` are byte-identical to the previously-green tip.

## CI and Infrastructure Verification

| Check                                  | Status | Notes                                                                               |
| -------------------------------------- | ------ | ----------------------------------------------------------------------------------- |
| `make ci-invariants-check`             | OK     | no-PUSH_O_MATIC, gallery-release-image-names, docs-deploy-disabled all PASS.        |
| `make fork-patches-check`              | OK     | `@immich/ui` patch metadata consistent.                                             |
| `test.yml` fork mods intact            | OK     | New plugin paths present; fork `upstream-preflight` group intact; 0 `PUSH_O_MATIC`. |
| Upstream content not lost (`test.yml`) | OK     | Plugin paths present; fork diff does not remove them.                               |

## Database Migration Analysis

No upstream migrations in this batch. Post-rebase audit (batches 287/288/289):

- Gallery Migration Count: **33** (expected 33) — OK
- Gallery Migration Filename Survival / Manifest Coverage — OK
- Migration Timestamp Collision Check — OK (no collision with Gallery migrations)
- `postbuild` merge / `CompositeMigrationProvider` — unchanged (no migration touched)

## Mobile Drift Migration Analysis

`make mobile-drift-rebase-check BATCH=287` → **OK** — schemaVersion, snapshots, and Gallery
callbacks consistent. The mobile change (`e5b50a55a4`) is a widget + i18n addition only; it
does not touch Drift entities, `db.repository.dart`, or `drift_schemas/`.

### Mobile i18n note

The 3 new `notification_enabled_list_tile_*` keys are consumed via runtime
`'<key>'.tr()` string literals (not `LocaleKeys` constants), and the easy-localization
outputs `mobile/lib/generated/codegen_loader.g.dart` + `translations.g.dart` are
**gitignored** (regenerated in CI/build). No tracked `*.g.dart` depends on `i18n/en.json`,
so `static_analysis.yml`'s `verify-changed-files` over `mobile/**/*.g.dart` is unaffected.

## Inconsistencies Found

None introduced by this rebase.

**Pre-existing (out of scope):** `docs/docs/install/environment-variables.md` has a prettier
formatting drift in its `MACHINE_LEARNING_*` table (lines ~164–191) that predates this batch
(the pre-rebase rolling tip fails the same check). It is in a region untouched by this batch's
conflict resolution and is not exercised by the routine rebase CI set (`docs-build` is
PR-only). Left as-is to avoid scope creep.

## Pattern Propagation

No broad upstream refactors in this batch.

## Local Verification

| Check                                              | Status                       | Notes                                                                                                           |
| -------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `make upstream-postrebase-audit BATCH=287/288/289` | PASS                         | All fork-file/symbol/migration audits OK for all three batches.                                                 |
| `make mobile-drift-rebase-check BATCH=287`         | PASS                         | Drift consistent.                                                                                               |
| `make ci-invariants-check`                         | PASS                         | All CI invariants OK.                                                                                           |
| `make fork-patches-check`                          | PASS                         | `@immich/ui` patch consistent.                                                                                  |
| `i18n/en.json` JSON validity                       | PASS                         | `jq` valid.                                                                                                     |
| `.github/workflows/test.yml` YAML validity         | PASS                         | Parses.                                                                                                         |
| `docs/.../upgrading.md` prettier                   | PASS                         | Clean.                                                                                                          |
| Server/Web/SDK/CLI/ML local gate                   | SKIPPED (provably redundant) | Those trees are byte-identical to the previously-green pre-rebase tip.                                          |
| Mobile `dart analyze` / `flutter test`             | DEFERRED to CI               | Worktree toolchain mismatch (known); covered by remote `static_analysis` / `build-mobile` / `Unit-Test-Mobile`. |

## Post-Rebase Verification

- New HEAD: `5592b796aa`
- Fork commits ahead of `upstream/main`: 817
- Commits behind `upstream/main`: **0**
- Working tree: clean
- Rolling-state `upstreamTargetHead`: advanced to `0931a19c5c` (== `upstream/main`)
- Fork diff vs upstream looks clean: YES
