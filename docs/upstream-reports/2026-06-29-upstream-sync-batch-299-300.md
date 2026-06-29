# Upstream Sync Report — 2026-06-29 (batches 299–300)

## Summary

- **Upstream commits pulled**: 4 (`ac74bca18b..df383c1ead`)
- **Fork commits synced**: 0 (`origin/main` already integrated — `integratedForkHead == 7dbd29113`)
- **Conflicts resolved**: 0 (clean rebase — git 3-way absorbed all overlaps)
- **Post-rebase fork fix**: 1 — adapted 22 fork mobile widget tests to upstream
  #29360's localized `pumpConsumerWidget` helper (commit `7745ec3405`)
- **Risk level**: LOW
- **Recommendation**: PROCEED (pending CI on the test branch)

Upstream is untagged post-`v3.0.0-rc.4` dev. The fork stays on its tagged base
`branding/config.json.upstream.version = 2.7.5` (unchanged). Collapsed the planner's
two batches (299 → `af2efda310`, 300 → `df383c1ead`) into a single
`git rebase df383c1ead`.

Low-risk batch: one server bug fix (face-region coordinate parsing) plus one
mobile native fix and two mobile test-only cleanups. No migration, no OpenAPI
surface, no SQL, no i18n, no dependency, no CI/workflow changes.

## Incoming Upstream Changes

| Batch | SHA          | PR     | Summary                                                   | Area          | Risk to Fork | Notes                                                                                                                                                                                                                                                                    |
| ----- | ------------ | ------ | --------------------------------------------------------- | ------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 299   | `56eb69b328` | #29357 | chore: cleanup unit tests                                 | mobile test   | LOW          | Wraps `unit/mocks.dart` mocks in typed `Stub`s, moves `presentation_context.dart` → `presentation/`. No fork-added test imports `unit/mocks.dart` → zero fork impact.                                                                                                    |
| 299   | `5164feb5b4` | #29360 | chore: disable logs in tests                              | mobile test   | LOW\*        | Rewrites `widget_tester_extensions.dart` (`pumpConsumerWidget` now localizes + auto-`pumpAndSettle()`) + adds `flutter_test_config.dart`. Rebase merged cleanly, but the helper behaviour change broke 22 fork widget tests — see Fork Mobile Test Reconciliation below. |
| 299   | `af2efda310` | #29337 | fix(mobile): apply exif orientation to android raw photos | mobile native | LOW          | New `native_image.c` + `NativeImage.kt` + `LocalImagesImpl.kt` under `app/alextran/immich/`. Fork keeps that package namespace (only `applicationId` differs) → clean.                                                                                                   |
| 300   | `df383c1ead` | #29333 | fix(server): face region coordinates parsing              | server        | LOW          | Coerces EXIF region `X/Y/W/H` to `Number()` (>16-decimal floats serialize as strings) + widens internal `ImmichTags.RegionList.Area` type. Fork benefits from the fix.                                                                                                   |

## Conflict Resolutions (0)

The rebase completed with **zero conflicts** (824 fork commits replayed). Three
fork-touched files overlapped upstream changes but git's 3-way merge handled them:

- `server/src/services/metadata.service.ts` — upstream's `Number()` coercions land at
  L979 & L1056; fork's S3/`ensureLocalFile` edits are in disjoint hunks. Both present.
- `server/src/services/metadata.service.spec.ts` — upstream's new region test merged
  alongside the fork's 894 added lines. (The single `-1` line vs upstream is a
  pre-existing fork divergence — `toHaveBeenCalledWith()` → `toHaveBeenCalled()` — not
  touched by #29333; verified present in the old tip's `ac74bca18b..00de60691e` diff.)
- `mobile/test/widget_tester_extensions.dart` — upstream's #29360 top rewrite is fully
  present; fork's two helpers re-anchor as a trailing append at L49+. No upstream lines
  dropped.

### Lost-upstream-content check

`git diff df383c1ead..HEAD` over the three files shows **only fork additions**, no
upstream `-` content removed (the lone spec `-` is the pre-existing fork divergence
above). `git diff 00de60691e HEAD --stat` is **exactly the 4 commits' 18 files**.

## Fork Mobile Test Reconciliation (#29360 — commit `7745ec3405`)

The rebase merged cleanly, but #29360 changed the **behaviour** of the shared
`pumpConsumerWidget` test helper — it now wraps widgets in `EasyLocalization` (so
`.tr()` resolves keys to real text) and auto-calls `pumpAndSettle()`. The fork's
widget tests were written against the old non-localized helper, so the first CI run's
**Unit Test Mobile** job failed with 22 failures (2189 passed). The other 7 dispatched
workflows — including the mobile **build** and **static analysis** jobs — were green,
confirming this is a test-expectation mismatch, not an app/code break. Two fix modes:

- **Text-mismatch (20 tests, 9 files)** — assertions compared a `Text` widget's data
  against the raw i18n key (e.g. `find.text('filter_sheet_picker_all_time')`), which now
  renders the resolved translation (`All time`). Wrapped each asserted key in `.tr()`
  (e.g. `find.text('filter_sheet_picker_all_time'.tr())`) so the test resolves
  identically to the widget — the same pattern 8 fork test files already use and pass
  under the new helper. Plurals use `.tr(namedArgs: …)` (person count label).
  Section titles render through `DeepSectionScaffold` as `.tr().toUpperCase()`, so
  `people_section`/`tags_section` assert `…'.tr().toUpperCase()`. The
  `easy_localization` import uses `hide TextDirection` (it re-exports `intl`'s
  `TextDirection`, which otherwise shadows Flutter's and breaks
  `timeline_grouping_selector`'s `TextDirection.rtl`) — matching the fork's existing
  `.tr()` test files. (Took two Unit-Test-Mobile rounds: `.tr()` fixed 19/22, then the
  uppercase + `hide TextDirection` nuances cleared the last 3.)
- **Hang (1 test)** — `timeline_empty_state` "shows a loader" pumps a widget with an
  infinite `ImmichLoadingIndicator`; the helper's new auto-`pumpAndSettle()` never
  returns (`pumpAndSettle timed out` inside the helper). Added a fork-only
  `pumpConsumerWidgetRaw` extension (pre-#29360 behaviour: no localization, no
  auto-settle) in `widget_tester_extensions.dart` and pointed that one test at it.

This is the lowest-divergence fix: the shared upstream helper is untouched (no future
rebase friction), 9 files adopt upstream's localized direction via `.tr()`, and only a
single test that genuinely cannot run under an auto-settling helper uses the fork
helper. `asset_list_group_settings`' `tearDownAll` 12-min timeout on the first run was a
cascade from its failed `tap(find.text('year'))` (proven harmless: `GroupSettings`
renders fine under the new helper in `timeline_grouping_selector_test`).

## Fork Feature Verification

| Feature                  | Status | Notes                                                                        |
| ------------------------ | ------ | ---------------------------------------------------------------------------- |
| All fork-owned files     | OK     | `upstream-postrebase-audit` 299 + 300: Fork-Owned File Survival OK           |
| Fork extension symbols   | OK     | Fork Extension Symbol Survival OK                                            |
| Shared-space face import | OK     | Upstream #29333 face-region code is upstream-owned; disjoint from fork edits |

## Database Migration Analysis

- No new upstream migrations. Gallery migration count: **33 / 33**. No
  `revert-to-immich.sql` work needed (no migration added). No timestamp collisions.

## Mobile Drift Migration Analysis

- `mobile-drift-rebase-check` (300): **PASS** — schemaVersion, snapshots, and Gallery
  callbacks consistent. No upstream mobile migration in this batch.

## i18n / Dependencies / OpenAPI / SQL

- No i18n changes. No dependency changes — `pnpm-lock.yaml` byte-identical to last-green.
- No controller/DTO/OpenAPI change → spec regen not required (`#29333` widens an internal
  `exiftool-vendored` interface, not an HTTP surface). `Generated Artifact Review`: OK.
- No `@GenerateSql` repo change (`metadata.repository.ts` edit is the `ImmichTags`
  interface, not a query) → `mise //:sql` not needed.

## Local Verification

| Check                                 | Status        | Notes                                                                         |
| ------------------------------------- | ------------- | ----------------------------------------------------------------------------- |
| `server pnpm check` (tsc)             | PASS          | fork code compiles against `ImmichTags.Area.X: number \| string` widening     |
| `metadata.service.spec.ts`            | PASS          | 159 / 159 (fork additions + upstream #29333 region test)                      |
| `upstream-postrebase-audit` (299/300) | PASS          | fork files/symbols survive, migrations 33/33, no collisions, no artifact diff |
| `ci-invariants-check`                 | PASS          | no PUSH_O_MATIC, gallery release images, docs-deploy disabled                 |
| `fork-patches-check`                  | PASS          | `@immich/ui` patch consistent                                                 |
| `mobile-drift-rebase-check` (300)     | PASS          | schemaVersion/snapshots/callbacks consistent                                  |
| `mise //:open-api` / `mise //:sql`    | SKIPPED       | no API/spec/SQL surface changed (audit confirmed no artifact diff)            |
| web / cli / ml / e2e / open-api       | REDUNDANT     | byte-identical to last-green tip `00de60691e` (CI re-validates)               |
| Mobile (`dart analyze`, build)        | DEFERRED → CI | impossible locally (worktree flutter pin) — native + test changes             |

## CI and Infrastructure Verification

| Check                      | Status                                 |
| -------------------------- | -------------------------------------- |
| Workflow files             | OK (no upstream changes to `.github/`) |
| Branding (2.7.5)           | OK (unchanged)                         |
| Conflict markers tree-wide | 0                                      |

## Remote CI Verification

_Pending — dispatched against the test branch; results appended after the run._

## Post-Rebase Verification

- Commits behind upstream: 0
- Rolling status: 300 / 300 upstream batches complete; 0 fork pending
