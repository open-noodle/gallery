# Upstream Sync Report — 2026-09-05 (batch 226)

## Summary

- **Upstream commits pulled**: 1 (`a6d43828f6c..4c7b30c18b5`)
- **Fork commits synced from `origin/main`**: 4 (#1066, #1067, #1068, #1070)
- **Conflicts resolved**: 1 upstream + 13 fork-sync (across 10 files)
- **Zero-conflict defects found and fixed**: 3 (Shape L ×2, Shape J ×1) plus one Shape Q recurrence
- **Risk level**: MEDIUM — the upstream commit was a mechanical relocation, but it and the fork sync
  between them broke six files that never conflicted
- **Recommendation**: PROCEED
- **Landing on `main`**: NO. Upstream's latest final tag is still `v3.1.0`, so the standing rule keeps
  the branch off `main`.

The upstream half was one `chore` commit. Effectively all the work was (a) the relocation fallout it
caused in fork-only code and (b) the fork sync, whose four PRs were authored against `main` and so
knew nothing of rolling's config-endpoints port, Drift relocation, `Drift*` de-prefixing, unified
`Person` model, typed-i18n accessor, or the retired `mobile/openapi/` tree.

## Incoming Upstream Changes

| SHA           | Summary                                                              | Area   | Risk to Fork | Notes                                                                                                                                                                                                                                                                    |
| ------------- | -------------------------------------------------------------------- | ------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `4c7b30c18b5` | chore(mobile): move settings components to UI package (immich-31272) | mobile | MEDIUM       | Relocates 9 shared settings widgets from `mobile/lib/widgets/settings/` into `mobile/packages/ui/lib/src/components/settings/`, and splits `build_context_extensions` / `theme_extensions` into the UI package. Fork-only settings widgets kept importing the old paths. |

### Per-batch product-direction gate

**Did not fire.** immich-31272 is a mechanical relocation into upstream's own UI package — it moves
no feature, changes no data model, and sets no product direction. It touches the mobile settings
surface, where the fork adds two widgets, but that is a code-location question, not a product one.

### Pre-rebase detectors

| Detector                                                                         | Result |
| -------------------------------------------------------------------------------- | ------ |
| Silent-noop literal (URLs upstream deletes, still `sed`-matched by fork tooling) | clean  |
| Shape I — upstream **adds** onto a path fork history touched                     | clean  |
| Shape I — upstream **renames** onto a path fork history touched                  | clean  |

## Conflict Resolutions

### Upstream batch

#### Conflict: `mobile/lib/widgets/settings/asset_list_settings/asset_list_group_settings.dart`

- **Fork side**: the #903/#911 commit adds `import '.../providers/timeline/timeline_grouping.provider.dart'`.
- **Upstream side**: replaces the two moved widget imports with `package:immich_ui/immich_ui.dart`.
- **Resolution**: both — the deltas are orthogonal. Verified `timeline_grouping.provider.dart` exists
  at this replay point and exports `timelineGridGroupingProvider`, and that `immich_ui.dart` re-exports
  `src/components/settings/settings.dart`.
- **Risk**: LOW. **Verification**: `dart analyze --fatal-infos` clean.

### Fork sync

`make upstream-sync-fork-main` threw twice. The first time it left the cherry-pick **in progress**
(`CHERRY_PICK_HEAD` set) rather than rolling back; the second time it rolled back cleanly. Both
halves were then hand-applied and `integratedForkHead` advanced manually, recorded in
`rolling-state.json` `appendHistory` with notes.

#### #1066 — RF-DETR pet detector

| File                                                           | Fork (rolling) side                                           | Incoming (#1066) side                          | Resolution                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/src/config.ts`                                         | **deleted** by rolling's config-endpoints port (immich-30881) | edits the `petDetection` defaults              | Dropped the file; applied the `rfdetr-nano` / `0.3` defaults to rolling's location, `server/src/gallery/config.dto.ts`.                                                                                                                                                                                                                                                         |
| `machine-learning/.../pet_detection/detection.py` (import)     | `decode_pil, pil_to_cv2`                                      | `decode_pil`                                   | Took `decode_pil` alone — `pil_to_cv2` is unused after the RF-DETR rewrite, and leaving it would fail `ruff` F401.                                                                                                                                                                                                                                                              |
| `machine-learning/.../pet_detection/detection.py` (`_predict`) | YOLO body **plus `**model_kwargs: Any`**                      | RF-DETR body, no kwargs                        | **Composed.** RF-DETR is the surviving design, but the kwargs are load-bearing: `455d7ca51a9` added them because upstream immich-30631 made `InferenceModel.predict` forward kwargs and `MachineLearningRepository.detectPets` always sends `minScore`. Taking #1066 verbatim would raise `TypeError` on every detection — with no conflict, no type error and no lint failure. |
| `machine-learning/test_main.py` (×4)                           | `cv2.Mat` → `NDArray[np.uint8]` annotation only               | replaces the YOLO tests with the RF-DETR suite | Took the incoming side. Verified per block that `len(ours) == len(base)` with a 1-line fork delta (Shape K check), and that `_make_yolo_output` has 0 remaining references while `cv2` / `NDArray` / `cv_image` all stay used.                                                                                                                                                  |
| `e2e/.../pet-detection.e2e-spec.ts`                            | `systemConfigDto` → `adminConfigDto`                          | `yolo11n` → `rfdetr-small`                     | Both. Confirmed no `systemConfigDto` remains.                                                                                                                                                                                                                                                                                                                                   |

#### #1070 — space People All/People/Pets filter

Eight conflicts. The PR adds a `filterBy` dimension to two provider families and the API repositories;
rolling had independently renamed most of the identifiers involved.

| File                                                                        | Resolution                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mobile/openapi/lib/api/shared_spaces_api.dart`                             | **Deleted (Shape Q).** The PR modified the generated Dart client tree that rolling retired and gitignores; the client is generated at build time into `mobile/generated/openapi/`.                                                                                     |
| `mobile/lib/data/server/person.dart`                                        | Rolling's `DriftPerson` → `Person` plus #1070's `filterBy` param and `toTypeParam()` call.                                                                                                                                                                             |
| `mobile/lib/pages/library/spaces/space_people.page.dart` (×2)               | Rolling's typed-i18n import (`generated/translations.g.dart`, not `translate_extensions.dart`) plus #1070's filter-button import; and rolling's scoped-invalidation comment plus #1070's `filterBy` in the provider key (comment updated to name the third key field). |
| `mobile/lib/presentation/pages/people_collection.page.dart`                 | Both imports.                                                                                                                                                                                                                                                          |
| `mobile/lib/providers/infrastructure/people.provider.dart` (×2)             | #1070's record-keyed family and doc comment, with rolling's `Person` / `peopleServiceProvider` names.                                                                                                                                                                  |
| `mobile/lib/providers/photos_filter/people_picker.provider.dart`            | #1070's record key and comment, with rolling's `FilterPerson` / `_toFilterPerson` and **without** `!p.isHidden` — rolling's unified `Person` has no `isHidden` field, so the incoming predicate would not compile.                                                     |
| `mobile/test/modules/spaces/shared_space_api_repository_test.dart`          | #1070's `type: null`, collapsed to rolling's single-line form (118 cols).                                                                                                                                                                                              |
| `mobile/test/providers/infrastructure/space_people_provider_test.dart` (×3) | Incoming side; fork delta was formatting only. A whole-file audit confirmed the 14 "lost" fork lines were all pre-`filterBy` signatures the PR deliberately replaces, and that rolling's `Person(...)` helper survived.                                                |

## Zero-Conflict Semantic Breaks

Four, none of which conflicted and three of which no audit or type check would have caught.

| #   | Shape | What broke                                                                                                                                                                           | Caught by                                                  |
| --- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| 1   | **L** | immich-31272 relocated the settings widgets; the fork-only `NavSetting` (#931) kept importing `widgets/settings/setting_group_title.dart` and `settings_switch_list_tile.dart`.      | the Shape L import-resolution detector, before any compile |
| 2   | **L** | #1070's new `people_filter_button_test.dart` imported the pre-relocation `infrastructure/repositories/db.repository.dart` and constructed `DriftStoreRepository`.                    | the same detector, then `dart analyze`                     |
| 3   | **J** | `server/src/gallery/config.dto.spec.ts` — a **rolling-only** spec — asserts the fork's composed ML config and still named `yolo11s` / `0.6`. `tsc`, lint and every audit were green. | the server unit suite only                                 |
| 4   | **Q** | #1070 added a file into `mobile/openapi/`, the directory rolling retired.                                                                                                            | the retired-directory detector                             |

Two further fixes were needed for the same reason: `server/src/utils/config.spec.ts` imported
`defaults` from the deleted `src/config` (caught by `tsc`), and two rolling-only mobile tests watched
`driftGetAllPeopleWithSharedSpacesProvider` with a bare `PeopleSortBy` after it became record-keyed
(caught by `dart analyze`).

**Shape Q's detector fired correctly this cycle** — the gitignore added at batch 225 did not prevent
the file arriving via cherry-pick, but the tracked-file check caught it immediately.

## Fork Feature Verification

| Feature                | Status | Notes                                                                                                              |
| ---------------------- | ------ | ------------------------------------------------------------------------------------------------------------------ |
| Shared Spaces          | OK     | #1070 extends the space People page; `shared-space.repository.ts` regenerated SQL matches rolling's schema exactly |
| Pet Detection          | OK     | detector swapped to RF-DETR; defaults relocated to the fork config DTO; `**model_kwargs` preserved                 |
| Pet Recognition        | OK     | separate class untouched; standalone training project 63 passed                                                    |
| Storage Migration      | OK     | untouched                                                                                                          |
| Image Editing          | OK     | untouched                                                                                                          |
| Branding               | OK     | `branding/` byte-identical to the last green tip; i18n override detector clean                                     |
| Google Photos Import   | OK     | untouched                                                                                                          |
| Mobile nav slot (#931) | OK     | import repaired after the settings relocation                                                                      |

## CI and Infrastructure Verification

| Check                           | Status | Notes                                                                                              |
| ------------------------------- | ------ | -------------------------------------------------------------------------------------------------- |
| Workflow files                  | OK     | `.github/` byte-identical to the last green tip                                                    |
| Docker image references         | OK     | unchanged                                                                                          |
| Branding leaks                  | OK     | i18n branding-override detector clean; merged-branding simulation finds no surviving upstream name |
| Fork CI modifications intact    | OK     | `make ci-invariants-check` 5/5                                                                     |
| `revert-to-immich.sql` coverage | OK     | no missing migration entries (67 gallery + post-v3.1.0 upstream)                                   |
| Commit autolinks                | OK     | 1455 messages scanned, fork PR ceiling 1072                                                        |

## Database Migration Analysis

No new upstream migrations. Gallery migration count unchanged at **67**; no timestamp collisions.
`pnpm migrations:run` against a clean CI-pinned Postgres applied everything, including both names of
the aliased `ClearPreOptionMFaceRepairScans` — the compatibility alias introduced by the tip commit
`46a5984fe9e`, working as designed.

## Mobile Drift Migration Analysis

No change. `make mobile-drift-rebase-check` reports schemaVersion, snapshots and Gallery callbacks
consistent, and `drift_dev make-migrations` regenerated without refusing — the signal that would
indicate a Shape L break in the Drift layer.

## Pattern Propagation

None. immich-31272 relocates existing widgets rather than introducing a new pattern; the fork's two
settings widgets now import `package:immich_ui/immich_ui.dart` exactly as upstream's siblings do.

## Local CI Verification

Scoped by tree identity against the last 10/10-green tip (`2dcf6365318`). `.github/`, `docker/`,
`deployment/`, `branding/` and `tools/` are byte-identical and their gates were not re-run.

| Check                                      | Status | Notes                                                               |
| ------------------------------------------ | ------ | ------------------------------------------------------------------- |
| `server pnpm build` (+ migration sync)     | PASS   | 67 migrations, 2 compatibility aliases                              |
| `server pnpm check` (tsc)                  | PASS   | after repointing the `defaults` import                              |
| `server pnpm lint`                         | PASS   |                                                                     |
| `server prettier --check`                  | PASS   |                                                                     |
| Server unit tests                          | PASS   | 6414 passed / 12 skipped, after fixing the rolling-only config spec |
| `web check:typescript`                     | PASS   |                                                                     |
| `web check:svelte`                         | PASS   | 639 files, 0 errors, 0 warnings                                     |
| Web unit tests                             | PASS   | 6334 passed / 2 skipped / 4 todo                                    |
| web eslint (changed files, `tscompat` off) | PASS   | full-tree run exceeds 9 min locally; CI Lint Web covers the rest    |
| web prettier (changed files)               | PASS   |                                                                     |
| `e2e pnpm check`                           | PASS   |                                                                     |
| ML ruff format / check                     | PASS   | 33 files                                                            |
| ML mypy --strict                           | PASS   | 33 source files                                                     |
| ML pytest                                  | PASS   | 157 passed / 3 skipped                                              |
| pet-recognition-training pytest            | PASS   | 63 passed                                                           |
| mobile `dart analyze --fatal-infos`        | PASS   | lib + test, no issues                                               |
| mobile `dart format` (CI gate scope)       | PASS   | 872 files, 0 changed                                                |
| mobile `flutter test`                      | PASS   | 3847 passed / 1 skipped                                             |
| `tools/upstream-preflight` vitest          | PASS   | 24 files / 257 tests                                                |
| OpenAPI regeneration                       | PASS   | no drift                                                            |
| SQL regeneration                           | PASS   | no drift, regenerated against rolling's schema                      |
| i18n prettier                              | PASS   |                                                                     |

**i18n:** #1068 edited two existing `en.json` values and updated all nine required locales in the
same commit, per the repo rule. No new keys were added, so no coverage gap.

## Post-Rebase Verification

- Fork commits ahead of upstream: **1457**
- Commits behind upstream: **0**
- Fork commits pending from `origin/main`: **0**
- Post-rebase audit: **8/8 OK**

## Remote CI Verification

- **Test branch**: `rebase/upstream-batch-226`
- **Commit validated**: `77711f5dade`
- **Result**: **10/10 green.** Dispatched in two waves (3 then 7, ~30s apart) per the registry
  rate-limit lesson — zero registry failures.

| Workflow                                  | Status | Notes                                                    |
| ----------------------------------------- | ------ | -------------------------------------------------------- |
| `test.yml`                                | GREEN  | green after re-running Medium Tests (Server) — see below |
| `docker.yml`                              | GREEN  |                                                          |
| `static_analysis.yml`                     | GREEN  | green on re-run; see below                               |
| `gallery-build-mobile.yml`                | GREEN  | iOS + Android compile                                    |
| `gallery-rebase-smoke.yml`                | GREEN  |                                                          |
| `gallery-ml-smoke.yml`                    | GREEN  | boots the RF-DETR ML image                               |
| `gallery-mobile-smoke.yml`                | GREEN  |                                                          |
| `gallery-revert-to-immich-validation.yml` | GREEN  | both halves, incl. the Docker boot against `:main`       |
| `storage-migration-tests.yml`             | GREEN  |                                                          |
| `storage-migration-e2e.yml`               | GREEN  |                                                          |

### Confirmed non-regressions (2)

1. **Static Code Analysis — `Setup Mise`**, first pass. `curl: (35) Recv failure: Connection reset by
peer` while downloading the **mise binary itself** from GitHub releases, before any repo code ran.
   Pure network flake, same family as the ShellCheck `curl exit 35` seen on 2026-09-03. Ruled out the
   lockfile variant of this failure first: both `mise.lock` and `mobile/mise.lock` are byte-identical
   to the last green tip and the working tree was clean of lock edits. Green on re-run.

2. **Medium Tests (Server)** — the known rolling-only connection-pool exhaustion.
   `PostgresError: sorry, too many clients already` (53300), **179 of 180 files passed**, and all four
   failing cases are in `face-repair.service.spec.ts` failing with the connection error rather than an
   assertion. Proved a non-regression by tree identity rather than by pattern-matching the symptom:
   both `test/medium/specs/services/face-repair.service.spec.ts` and
   `src/services/face-repair.service.ts` are **byte-identical to `2dcf6365318`**, the last 10/10-green
   tip, so nothing this cycle changed could have caused it. Green on re-run.

   (The other `PostgresError` lines in that log — duplicate key, foreign key, `avg(vector)`,
   `expected 512 dimensions` — are negative-path assertions, not failures.)
