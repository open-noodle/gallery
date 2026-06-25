# Upstream Sync Report — 2026-06-25 (batch 290)

> **Update (same day):** batch 290 was extended with two further mobile-test-only upstream
> commits (`#29296`, `#29325`) that landed after this report was first written. See the
> [Addendum](#addendum--batch-290-extended-29296-29325) at the end. Batch 290 now spans
> `0931a19c5c..49a821b0d0` (4 commits). The Summary below describes the initial pair.

## Summary

- **Branch**: `rebase/upstream-rolling-20260509-active` (rolling v3-cutover branch)
- **Upstream commits pulled**: 2 (`0931a19c5c..4099fa6b4a`)
- **Fork commits synced**: 0 (`integratedForkHead` == `origin/main` == `7dbd29113`)
- **Conflicts resolved**: 0 (clean 818-commit replay)
- **Risk level**: LOW
- **Recommendation**: PROCEED

This batch advances the rolling branch's integrated upstream head from `0931a19c5c` to
`4099fa6b4a` (current `upstream/main`). The fork side was already fully synced
(`integratedForkHead` == `origin/main` == `7dbd29113`), so no `upstream-sync-fork-main`
was required.

`make upstream-batch-plan` / `make upstream-next-batch` planned both incoming commits as a
single batch **290** (tip `4099fa6b4a`, risk MEDIUM, reasons: none). The `git rebase
4099fa6b4a` replayed all 818 fork commits with **zero conflicts**.

## Incoming Upstream Changes

| SHA          | Summary                                                 | Area              | Risk to Fork | Notes                                                                                                                                                                                             |
| ------------ | ------------------------------------------------------- | ----------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `9751530af8` | feat: plugin wrapper type safety (#29300)               | server / packages | LOW          | Renames the `@immich/plugin-sdk` export `wrapper` → `getWrapper` and re-types the plugin-core filters; adds `enableWasiOutput: true` (+1 line) to `server/src/repositories/plugin.repository.ts`. |
| `4099fa6b4a` | fix(mobile): app doesn't exit full-screen mode (#29301) | mobile            | LOW          | New `mobile/lib/utils/system_ui.utils.dart` (`restoreEdgeToEdge()`); swaps inline `setEnabledSystemUIMode(edgeToEdge)` calls for it in `drift_memory`, `drift_slideshow`, `asset_viewer` pages.   |

No migrations (server or mobile Drift), no schema/DTO/enum/OpenAPI changes, no dependency
bumps, no CI/workflow/Dockerfile changes, no broad architectural refactors, no
test-infra/factory changes.

### `#29300` — plugin-sdk export change is server-safe

The server consumes `@immich/plugin-sdk` widely (`WorkflowTrigger`, `WorkflowStepConfig`
in `enum.ts`, `types.ts`, `utils/workflow.ts`, `schema/tables/workflow*.table.ts`,
`dtos/workflow.dto.ts`, `dtos/plugin.dto.ts`, …). The **only** export `#29300` renamed is
`wrapper` → `getWrapper`, which is consumed exclusively by `packages/plugin-core/src/index.ts`
(updated in lockstep in the same commit). `WorkflowTrigger` (enum) and `WorkflowStepConfig`
(type) are defined in `packages/plugin-sdk/src/types.ts` and were **not** touched. The fork
references neither `wrapper` nor `getWrapper`. Verified server `tsc --noEmit` clean against
the freshly-built plugin-sdk (see Local Verification).

### `#29301` — additive mobile helper

The fix is purely additive: a new `restoreEdgeToEdge()` helper (force all overlays, then
return to edge-to-edge — works around Android 15/API 36 enforced edge-to-edge) plus
call-site swaps. The fork references `restoreSystemUI`/`restoreEdgeToEdge` nowhere.

## Conflict Resolutions

None. The single fork-touched file in this batch's blast radius —
`mobile/lib/presentation/pages/drift_memory.page.dart` (fork added a `getMemoryTitle()`
helper just below the top import block) — merged cleanly: git's 3-way merge kept both
upstream's new `system_ui.utils.dart` import (line 15) and the fork's `getMemoryTitle()`
helper (line 19), with the upstream `restoreEdgeToEdge()` call-site swaps applied.

## Fork Feature Verification

`make upstream-postrebase-audit BATCH=290` — all checks **OK**:

- Fork-Owned File Survival — all literal fork-owned files present
- Fork Extension Symbol Survival — all manifest expected symbols present
- Gallery Migration Count: **33** (expected 33)
- Gallery Migration Filename Survival / Manifest Coverage — OK
- Migration Timestamp Collision Check — no collision with Gallery migrations
- Generated Artifact Review — no upstream generated-artifact changes require review

## CI and Infrastructure Verification

| Check                           | Status | Notes                                                                       |
| ------------------------------- | ------ | --------------------------------------------------------------------------- |
| `make ci-invariants-check`      | OK     | no-PUSH_O_MATIC, gallery-release-image-names, docs-deploy-disabled all PASS |
| `make fork-patches-check`       | OK     | `@immich/ui` patch metadata consistent                                      |
| Workflow / Docker / image names | OK     | Batch touches no `.github/`, Dockerfile, or compose files                   |

## Database Migration Analysis

No upstream migrations in this batch. `postbuild` merge / `CompositeMigrationProvider`
unchanged (no migration file touched). `revert-to-immich.sql` coverage unaffected (no new
`server/src/schema/migrations/` file; `migrations-gallery/` count unchanged at 33).

## Mobile Drift Migration Analysis

`make mobile-drift-rebase-check BATCH=290` → **OK** — schemaVersion, snapshots, and Gallery
callbacks consistent. `#29301` adds a util + swaps `SystemChrome` calls; it does not touch
Drift entities, `db.repository.dart`, or `drift_schemas/`.

## Inconsistencies Found

None introduced by this rebase.

## Pattern Propagation

No broad upstream refactors in this batch.

## Local Verification

| Check                                                  | Status                       | Notes                                                                                                                                                |
| ------------------------------------------------------ | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `make upstream-postrebase-audit BATCH=290`             | PASS                         | All fork-file/symbol/migration audits OK                                                                                                             |
| `make mobile-drift-rebase-check BATCH=290`             | PASS                         | Drift consistent                                                                                                                                     |
| `make ci-invariants-check`                             | PASS                         | All CI invariants OK                                                                                                                                 |
| `make fork-patches-check`                              | PASS                         | `@immich/ui` patch consistent                                                                                                                        |
| `mise //:plugins` (sdk + plugin-sdk + plugin-core)     | PASS                         | `@immich/sdk` tsc, `@immich/plugin-sdk` esbuild+tsc, `@immich/plugin-core` tsc + **wasm** (`extism-js`) all build clean — validates `#29300`         |
| `pnpm --filter immich check` (server `tsc --noEmit`)   | PASS                         | Clean against freshly-built plugin-sdk — validates the +1-line `plugin.repository.ts` change and all server plugin-sdk consumers                     |
| `cd server && pnpm lint` (`eslint … --max-warnings 0`) | PASS                         | exit 0 — the one fork-side eslint gate; covers the `plugin.repository.ts` change (web byte-identical; plugin packages have no eslint script)         |
| Web / CLI / ML / E2E / docs / open-api local gate      | SKIPPED (provably redundant) | Those trees are **byte-identical** to the previously-green rolling tip `986188dea3` (`git diff --stat 986188dea3 f76b114c00` = 0 files in each area) |
| Mobile `dart analyze` / `flutter test`                 | DEFERRED to CI               | Worktree toolchain mismatch (known); covered by remote `static_analysis` / `gallery-build-mobile` / `Unit-Test-Mobile`                               |

The batch diff vs the last CI-green rolling tip is **exactly** the two upstream commits' 10
files (mobile ×4, packages ×5, server ×1) — no other file in any area moved, so web/cli/ml/
e2e/docs/open-api cannot regress and OpenAPI/SQL regen is a verified no-op.

## Remote CI Verification

- **Test branch**: `rebase/upstream-batch-290`
- **Dispatched**: `test.yml`, `docker.yml`, `static_analysis.yml`, `gallery-build-mobile.yml`,
  `gallery-rebase-smoke.yml`, `storage-migration-tests.yml`, `gallery-revert-to-immich-validation.yml`
- `gallery-ml-smoke.yml` / `gallery-mobile-smoke.yml`: NOT on `main`'s default branch yet →
  not dispatchable against the rolling branch (run locally / pending v3 cutover).

All 7 dispatched workflows passed **first-pass, zero flakes** (~17 min), all against test-branch
head `41696862fa`:

| Workflow                                  | Status | Run         | Notes                                                              |
| ----------------------------------------- | ------ | ----------- | ------------------------------------------------------------------ |
| `test.yml`                                | GREEN  | 28157357470 | 20-job suite (server/web unit, medium, e2e, mobile, lint, OpenAPI) |
| `docker.yml`                              | GREEN  | 28157359501 | server/web/cli/ml images — validates `#29300` plugin-sdk build     |
| `static_analysis.yml`                     | GREEN  | 28157360997 | dart analyze + format + `*.g.dart` freshness (mobile `#29301`)     |
| `gallery-build-mobile.yml`                | GREEN  | 28157367282 | iOS + Android compile (mobile `#29301`)                            |
| `gallery-rebase-smoke.yml`                | GREEN  | 28157362474 |                                                                    |
| `storage-migration-tests.yml`             | GREEN  | 28157364130 | (batch touches no storage code)                                    |
| `gallery-revert-to-immich-validation.yml` | GREEN  | 28157365704 | migration coverage grep (no new migration this batch)              |

## Post-Rebase Verification

- New HEAD (pre-report): `f76b114c00`
- Fork commits ahead of `upstream/main`: 818
- Commits behind `upstream/main`: **0**
- Working tree: clean
- Rolling-state `upstreamTargetHead`: advanced to `4099fa6b4a` (== `upstream/main`)
- Fork diff vs upstream looks clean: YES

## Addendum — batch 290 extended (#29296, #29325)

Two further upstream commits landed on `upstream/main` the same day, after the batch-290
report above was written. `make upstream-batch-plan` (re-run after bumping
`upstreamTargetHead` → `49a821b0d0`) folded both into the **same batch 290** (tip
`49a821b0d0`). They are **mobile-test-only** and replayed with **zero conflicts** on top of
the already-validated tip.

- **Upstream commits added**: 2 (`4099fa6b4a..49a821b0d0`) — batch 290 now spans
  `0931a19c5c..49a821b0d0` (4 commits total)
- **Fork commits synced**: 0 (`integratedForkHead` still `7dbd29113`)
- **Conflicts resolved**: 0 (clean 819-commit replay)
- **Risk level**: LOW

### Incoming Upstream Changes (addendum)

| SHA          | Summary                                     | Area            | Risk to Fork | Notes                                                                                                                                                                                                          |
| ------------ | ------------------------------------------- | --------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `3a7034d25e` | chore: cleanup partner action test (#29296) | mobile **test** | LOW          | Refactors the shared `PresentationContext` test helper (`dispose()` → `void`, was `async`; adds `setup()`) and updates its only two consumers (`partner_page_test`, `partner_action_test`) in the same commit. |
| `49a821b0d0` | chore: fix mobile test flakiness (#29325)   | mobile **test** | LOW          | Bumps `randInt(999) + 1` → `+ 2` for `imageWidth`/`imageHeight` in `MediumRepositoryContext.newFace` — fixes the known degenerate `randInt(0)` flake the fork was hitting at `repository_context.dart`.        |

No server/web/cli/ml/docs/CI/dependency/migration/schema/DTO/OpenAPI changes. The tree diff
between the previously-CI-green tip `283237b361` (== code tree of test head `41696862fa`)
and the new HEAD is **exactly these two commits' 4 mobile/test files** — every other tree
is byte-identical to the green tip.

### Conflict Resolutions (addendum)

None. `#29325` touches the `newFace` helper in `repository_context.dart`; the fork's
additions to that file (shared-space/library imports + helper methods at the class tail, and
a `MemoryData` constructor fix) sit in **disjoint hunks**, so git's 3-way merge applied
upstream's `+2` change cleanly while preserving every fork helper. `#29296`'s three files
carried zero fork modifications → applied verbatim. Post-rebase content verified: `newFace`
now reads `+ 2`; the four `newSharedSpace`/`newLibrary`/… helpers and shared-space imports
are intact; the three upstream-owned `presentation*` test files are byte-identical to
`upstream/main`.

### Verification (addendum)

| Check                                          | Status                       | Notes                                                                                                           |
| ---------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `make upstream-postrebase-audit BATCH=290`     | PASS                         | Fork file/symbol survival, migration count 33/33, no timestamp collision, no artifact drift                     |
| `make mobile-drift-rebase-check BATCH=290`     | PASS                         | schemaVersion / snapshots / Gallery callbacks consistent (no Drift entity touched)                              |
| `make ci-invariants-check`                     | PASS                         | no-PUSH_O_MATIC, gallery-release-image-names, docs-deploy-disabled                                              |
| `make fork-patches-check`                      | PASS                         | `@immich/ui` patch metadata consistent                                                                          |
| Server/web/cli/ml/e2e/docs/open-api local gate | SKIPPED (provably redundant) | Byte-identical to CI-green tip `283237b361` (only 4 mobile/test files differ)                                   |
| Mobile `dart analyze` / `flutter test`         | DEFERRED to CI               | Worktree toolchain mismatch (known); covered by `static_analysis` / `Unit-Test-Mobile` / `gallery-build-mobile` |

### Remote CI Verification (addendum)

- **Test branch**: `rebase/upstream-batch-290` (re-pushed at the extended tip)

All 7 dispatched workflows passed **first-pass, zero flakes**:

| Workflow                                  | Status | Run         | Notes                                                             |
| ----------------------------------------- | ------ | ----------- | ----------------------------------------------------------------- |
| `test.yml`                                | GREEN  | 28192560740 | 20-job suite incl. Unit Test Mobile (`flutter test` medium tests) |
| `docker.yml`                              | GREEN  | 28192562757 | server/web/cli/ml images (code byte-identical to prior green)     |
| `static_analysis.yml`                     | GREEN  | 28192564123 | dart analyze + format + `*.g.dart` freshness (mobile test files)  |
| `gallery-rebase-smoke.yml`                | GREEN  | 28192565420 | rebase-targeted e2e smoke                                         |
| `storage-migration-tests.yml`             | GREEN  | 28192567061 | (batch touches no storage code)                                   |
| `gallery-revert-to-immich-validation.yml` | GREEN  | 28192568376 | migration coverage grep (no new migration this batch)             |
| `gallery-build-mobile.yml`                | GREEN  | 28192569774 | iOS + Android compile                                             |

`gallery-ml-smoke.yml` / `gallery-mobile-smoke.yml`: still not on `main`'s default branch →
not dispatchable against the rolling branch (pending v3 cutover).

### Post-Rebase Verification (addendum)

- New HEAD (pre-report-amend): `7ff5b0a722` → re-stamped on amend
- Fork commits ahead of `upstream/main`: 819
- Commits behind `upstream/main`: **0**
- Rolling-state `upstreamTargetHead`: advanced to `49a821b0d0` (== `upstream/main`)
