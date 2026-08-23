# Upstream Sync Report — 2026-08-05

## Summary

- **Cycle type**: BOTH — 6 upstream commits and 7 fork commits
- **Upstream commits pulled**: 6 (`cbd2d8a6bda..1c7c28bb0d5`), batches 53–57
- **Fork commits synced**: 7 (`53f414ab79f..f88830aee40`) — #923, #883, #925, #929, #919, #928, #927
- **Conflicts resolved**: 10 (6 during the upstream rebase, 3 in the fork sync, 1 auto-resolved deletion)
- **Risk level**: MEDIUM
- **Recommendation**: PROCEED

The branch is **level with `upstream/main`** (0 behind, 1094 fork commits ahead) and fork-synced to
`origin/main` (`f88830aee40`, 0 pending). Upstream's newest tag is still **v3.1.0**, so per the standing
rule the branch stays off `main` and `branding/config.json` / `README.md` keep `v3.1.0`.

## Incoming Upstream Changes

| SHA           | Summary                                                 | Area         | Risk to Fork | Notes                                                 |
| ------------- | ------------------------------------------------------- | ------------ | ------------ | ----------------------------------------------------- |
| `8d2fdd6b8fa` | stop websocket reconnect loop draining battery (#29901) | mobile       | MEDIUM       | Only commit landing on fork-modified files; see below |
| `1c7c28bb0d5` | more riverpod lints from dcm (#30447)                   | mobile       | LOW          | DCM-only — fork does not run DCM; no propagation      |
| `8450687db7b` | riverpod lints from dcm (#30446)                        | mobile       | LOW          | DCM-only — same                                       |
| `d8e1ead6f4b` | stale local renders after editing (#30415)              | mobile       | LOW          | Zero fork delta in those files                        |
| `00e813ba84b` | stop long images squishing on iOS (#29367)              | mobile / iOS | LOW          | Zero fork delta                                       |
| `099cb25ce09` | update mise docker tag to v2026.8.1 (#30542)            | infra        | LOW          | Two Dockerfile lines                                  |

### The lint commits are NOT the quarantine class

Two commits adding 14 lint rules reads exactly like the batch-15/20/24 Dart-lint quarantines, which each
cost a measured fork-side sweep. They are not. Every rule lands under the **`dart_code_metrics:`** section
of `mobile/analysis_options.yaml`, and the fork's `static_analysis.yml` has `dcm analyze` **commented out**
(it needs a license key the fork does not have). The enforced gate is `dart analyze --fatal-infos`, which
ignores that section. **No fork propagation was required** — recorded explicitly because the subject lines
suggest the opposite and the next reader will meet this again.

### Per-batch product-direction gate

**Did not fire.** No commit changes where a feature is going — a reconnect-behaviour fix, two rendering
fixes, DCM-only lint rules, and a Docker tag bump.

### Zero-conflict semantic break gate

- **Literal-drift detector: clean.** No literal removed upstream is matched by fork tooling this batch.
- **Hand-written mobile fakes**: enumerated; none override a signature this batch changes. (The
  `MockBackgroundSyncManager` classes are mocktail `extends Mock`, which absorb signature changes silently —
  the blind spot recorded last cycle.)

## Conflict Resolutions

### 1. `mobile/test/service.mocks.dart` (×2, upstream rebase)

- **Fork side**: #639 added `MockBackgroundBackupStatusService`; #892 later removed it again
- **Upstream side**: #29901 appended 5 new mocks (Auth, SecureStorage, Widget, BackgroundUpload, BackgroundWorkerLock)
- **Resolution**: union at the first collision (both merely append); at the second, applied #892's removal of
  `BackgroundBackupStatusService` while keeping upstream's 5
- **Risk**: LOW — independent declarations
- **Verification**: `dart analyze --fatal-infos` clean; `flutter test` green

### 2. `mobile/test/providers/app_life_cycle_provider_test.dart` — the consequential one

- **Fork side**: #663 created a 59-line suite for `refreshConnectionAfterResume` (iOS foreground URLSession)
- **Upstream side**: #29901 **also created this file**, 180 lines, testing websocket reconnect/pause semantics.
  Both sides created it independently, so the merge base was empty.
- **Resolution**: **upstream's version only.**
- **Risk**: was HIGH, now LOW
- **Verification**: `refreshConnection` is absent from `mobile/lib/`; analyze + full test suite green.

**This one was resolved wrongly first, and the rebase itself caught it.** The initial resolution merged both
suites as two `group()`s, which looks obviously right: two valid test suites, different concerns, no textual
overlap. The next conflict revealed that fork commit **#892** explicitly reverted #663 — its body lists
"Removed: … #663 NetworkRepository.refresh + ApiService.refreshConnection" — and deletes that test file. The
merged group called `sut.refreshConnectionAfterResume(...)`, an API that no longer exists, so it would not
have compiled.

Generalisable lesson: when replaying a long fork history, **a commit's correct resolution is the one that is
right at _its_ point in history**, and a later commit may revert it entirely. Do not reach for the end state,
and treat "both sides are valid, keep both" as a hypothesis the next few commits will test.

### 3. `mobile/lib/widgets/forms/login/login_form.dart` (×3)

- **Fork side**: #378 added an `isBeta` branch routing to `GalleryTabShellRoute`; later `bc3f279a358`
  ("resolve 144 analyzer errors after upstream timeline yeet") **removed the split**; later still #572
  extracted the whole block into `completeLogin()`
- **Upstream side**: reshaped the same block and added two `context.mounted` guards
- **Resolution**: at #378, preserved the `isBeta` branch (declaring `isBeta` locally, since it is scoped to the
  password path — taking the fork side verbatim would not have compiled, and `TabControllerRoute` no longer
  exists). At `bc3f279a358`, took its removal of the split. At #572, took the `completeLogin` extraction.
- **Risk**: LOW after verification
- **Verification**: the #378 resolution was superseded two commits later, exactly as the replay should work.
  A flagged concern — that `completeLogin` drops upstream's two `context.mounted` guards — was checked at the
  end: `dart analyze --fatal-infos` reports no `use_build_context_synchronously` issue, so the later fork
  sweep already handles it.

### 4. `ConsumerWidget` → `StatelessWidget` conversions (×3)

Upstream is converting widgets off `ConsumerWidget`; three fork additions collided with it.

| File                                       | Resolution                                                                                                                                                                                                      |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `drift_library.page.dart`                  | Restored `ConsumerWidget` — the fork genuinely needs `ref.watch(bottomNavHeightProvider)` (used twice)                                                                                                          |
| `memory_lane.widget.dart`                  | Kept upstream's `StatelessWidget` + the fork's `getMemoryTitle(context, memory)` — the conflict is in `DriftMemoryCard`, which uses no `ref` (the `ref` uses in that file belong to `DriftMemoryLane` above it) |
| `drift_asset_selection_timeline.page.dart` | Kept upstream's `StatelessWidget` + the fork's `static const forcedGroupBy` — the `ref` uses there are the `overrideWith((ref) {...})` callback parameter, not the widget's                                     |

The distinction that matters: **`ref` appearing in the file does not mean the widget needs it.** Each case was
resolved by reading where `ref` actually comes from.

### 5. `mobile/lib/presentation/widgets/timeline/fixed/segment.model.dart`

- **Fork side**: #886 added a `select`-scoped `isHighlighted` watch
- **Upstream side**: changed `ref.read` → `ref.watch` (a riverpod-lint fix upstream applied at source)
- **Resolution**: union, taking upstream's `watch`
- **Risk**: LOW

### 6. `mobile/lib/presentation/pages/search/drift_search.page.dart`

- Fork deletes it (#654 removed upstream's mobile search page). Kept the deletion.

### Fork-sync conflicts (#929)

`make upstream-sync-fork-main` threw on #929 and its all-or-nothing rollback fired cleanly (HEAD restored,
cursor unchanged). The 7 commits were then cherry-picked by hand; **range-diff shows 5 of 6 byte-identical**
and only #929 differing, by exactly the documented resolutions.

- `mobile/lib/utils/action_button.utils.dart` — resolved per the skill's **standing divergence #3**:
  rolling's **minimal** import set plus the commit's real delta (swap `scroll_to_asset_notifier.provider.dart`
  → `view_in_timeline_action.dart`), never `main`'s 16-import block, which upstream's action migration removed
  here. Verified the two surviving `action_buttons/` imports (`base_action_button`, `like_activity_action_button`)
  both still resolve to existing files.
- `memory_bottom_info.widget.dart` and `drift_backup_asset_detail.page.dart` — took #929's synchronous
  `viewAssetInTimeline(...)` form, which structurally removes the async gap the `context.mounted` guards existed for.

## Fork Feature Verification

| Feature                        | Status | Notes                                                                       |
| ------------------------------ | ------ | --------------------------------------------------------------------------- |
| Shared Spaces                  | OK     | Fork-Owned File + Symbol Survival green on all 5 batches                    |
| Storage Migration              | OK     | Untouched                                                                   |
| Pet Detection                  | OK     | Untouched                                                                   |
| Image Editing                  | OK     | Untouched                                                                   |
| Branding                       | OK     | #928's `Test Branding` job + ImageMagick step survived the sync intact      |
| Google Photos Import           | OK     | Untouched                                                                   |
| Mobile bottom nav (#378)       | OK     | `GalleryTabShellRoute` + `bottomNavHeightProvider` preserved                |
| Mobile view-in-timeline (#929) | OK     | New fork module `view_in_timeline_action.dart`; standing divergence #3 held |
| Fork Memories                  | OK     | `getMemoryTitle` retained through the StatelessWidget conversion            |

## CI and Infrastructure Verification

| Check                                     | Status | Notes                                                     |
| ----------------------------------------- | ------ | --------------------------------------------------------- |
| No upstream `PUSH_O_MATIC` dependency     | OK     | `ci-invariants-check`                                     |
| Gallery release workflows publish Gallery | OK     | `ci-invariants-check`                                     |
| Upstream docs deploy stays dispatch-only  | OK     | `ci-invariants-check`                                     |
| `@immich/ui` patch applies                | OK     | `fork-patches-check`                                      |
| `#928` branding gate intact after sync    | OK     | `branding-tests` job + `Install ImageMagick` step present |
| `mise.lock` integrity                     | OK     | Rewritten by local `mise`; **restored** — see below       |

**`mise.lock` was rewritten by running `mise` locally** (17 insertions / 17 deletions), the documented trap
that makes every CI job fail at `mise install --locked`. Caught by an explicit `git status -- '*mise.lock'`
after the mobile gate and restored with `git checkout HEAD -- mise.lock`. `mobile/mise.lock` was untouched.

## Database Migration Analysis

**No new upstream migrations** — no commit in this range touched `server/src/schema/`.

- Gallery migration count: **49** (unchanged)
- Timestamp collisions: NONE (checked on all 5 batches)
- `postbuild` merge intact: YES — `Synced 49 Gallery migrations … wrote 1 compatibility aliases.`
- `revert-to-immich.sql` coverage (step 7i): **complete**, no missing entries against the tagged v3.1.0 tree

## Mobile Drift Migration Analysis

- New upstream mobile migrations: **NONE**
- `schemaVersion`: **36** (unchanged); fork still owns v32–v36
- `mobile-drift-rebase-check`: green on every batch
- No renumbering required

## Inconsistencies Found

None surviving. Two were found and fixed during the rebase, both described above: the
`app_life_cycle_provider_test.dart` merge that referenced an API #892 had removed, and the `login_form.dart`
`isBeta` branch that referenced an out-of-scope variable and a deleted route.

## Pattern Propagation

| Refactor                                  | Old → New Pattern                    | Fork Files Affected | Decision | Notes                                                  |
| ----------------------------------------- | ------------------------------------ | ------------------- | -------- | ------------------------------------------------------ |
| Widgets converted off `ConsumerWidget`    | `ConsumerWidget` → `StatelessWidget` | 3 (see conflict 4)  | Bundled  | Resolved per-file by whether `ref` is genuinely needed |
| DCM riverpod lint rules (#30446 / #30447) | 14 new `dart_code_metrics:` rules    | **0**               | N/A      | DCM is disabled in fork CI; nothing to propagate       |

### Follow-up work

- **Local `main` still carries the unpushed commit `eccf522a801`** (clears pre-existing web lint warnings).
  Not on `origin/main`, so not in this branch. Unchanged from last cycle.
- **`branding/scripts/verify-branding.sh` absent-only assertion** — still outstanding from 2026-08-04; #928
  wired the umbrella gate but did not fix this weaker check.

## Local CI Verification

| Check                                    | Status | Notes                                                 |
| ---------------------------------------- | ------ | ----------------------------------------------------- |
| `server pnpm build` (+ postbuild sync)   | PASS   | 49 migrations synced, 1 compatibility alias           |
| `server pnpm check` (tsc)                | PASS   | exit 0                                                |
| `web check:typescript`                   | PASS   | exit 0                                                |
| `web check:svelte`                       | PASS   | 575 files, 0 errors, 0 warnings                       |
| **`dart analyze --fatal-infos`**         | PASS   | **No issues found** — validates every Dart resolution |
| **`dart format --set-exit-if-changed`**  | PASS   | 0 files needing format                                |
| **`flutter test`**                       | PASS   | **3152 passed, 1 skipped**                            |
| Server unit tests                        | PASS   | 157 files; 5266 tests passed, 14 skipped              |
| Web unit tests                           | PASS   | 300 files; 4171 tests passed, 2 skipped, 8 todo       |
| Post-rebase audits (batches 53–57)       | PASS   | all 7 checks green per batch                          |
| `ci-invariants` / `fork-patches` / drift | PASS   | green                                                 |
| `revert-to-immich.sql` coverage detector | PASS   | no missing entries                                    |

**The mobile gate needed the pinned toolchain.** `mise //mobile:*` resolved Flutter **3.41.9** while the pin
(`mobile/mise.toml`, corroborated by `pubspec.yaml`) is **3.44.8**, and `mise` ignores a `PATH` override, so
`flutter pub get --enforce-lockfile` failed with `requires SDK >=3.12.0`. Worked around by invoking
`~/.local/share/mise/installs/aqua-flutter-flutter/3.44.8/flutter/bin/{flutter,dart}` directly and running the
underlying commands (`pub get`, `build_runner build`, `easy_localization:generate`, `generate_keys`,
`drift_dev schema generate`, `dart analyze`, `dart format`, `flutter test`) rather than the mise tasks.

`make sql` and `make open-api` were not run: no controller, DTO or repository changed, and the audit's
"Generated Artifact Review" reported nothing needing attention.

## Remote CI Verification

- **Test branch**: `rebase/upstream-b57`
- **Commit validated**: `02357618d33`

**10/10 green, first pass.**

| Workflow                                  | Status | Notes                                             |
| ----------------------------------------- | ------ | ------------------------------------------------- |
| `test.yml`                                | GREEN  | 21/21 jobs success, 0 skipped                     |
| `docker.yml`                              | GREEN  |                                                   |
| `static_analysis.yml`                     | GREEN  | dart analyze + format + generated-file freshness  |
| `gallery-build-mobile.yml`                | GREEN  | iOS + Android compile                             |
| `gallery-mobile-smoke.yml`                | GREEN  |                                                   |
| `gallery-ml-smoke.yml`                    | GREEN  |                                                   |
| `gallery-rebase-smoke.yml`                | GREEN  |                                                   |
| `storage-migration-tests.yml`             | GREEN  |                                                   |
| `storage-migration-e2e.yml`               | GREEN  |                                                   |
| `gallery-revert-to-immich-validation.yml` | GREEN  | read to `Post-phase drift (0 item(s))` / `PASSED` |

No failures, no re-dispatches, no flakes.

**First run of the `Test Branding` job on the rolling branch** — the umbrella branding gate arrived via the
#928 fork sync and passed here, so the branding pipeline is now gated on the branch that carries upstream's
`web/` changes, which is where it has the most value.

## Post-Rebase Verification

- Fork commits ahead of upstream: **1094**
- Commits behind upstream: **0**
- Fork commits pending from `origin/main`: **0**
- Upstream newest tag: **v3.1.0** — unchanged, so the branch stays off `main`
- Fork diff looks clean: YES
