# Upstream Sync Report — 2026-08-26 (batches 162–166)

## Summary

- **Upstream commits pulled**: 9 (`fbd5dc2c618` → `0f821a7338d`)
- **Batches**: 162, 163, 164, 165, 166
- **Fork commits synced from `origin/main`**: 0 — `integratedForkHead` already equalled `origin/main` (`bcb635ae28f`)
- **Conflicts resolved**: 7 (across 6 files)
- **Zero-conflict semantic breaks found**: 2 (both fixed)
- **Risk level**: MEDIUM — a dependency/toolchain bump plus an ML refactor that deleted a symbol a fork test used
- **Recommendation**: PROCEED
- **Branch tip**: `fc97cc5b1f5` · 1341 fork commits ahead, **0 behind `upstream/main`**

## Incoming Upstream Changes

| SHA           | Summary                                               | Area                | Risk to Fork | Notes                                                                                                                                                                                                                                                           |
| ------------- | ----------------------------------------------------- | ------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `9e3d9a7770d` | thumbnail generation for specific SVGs (immich-30908) | server, e2e, docker | **HIGH**     | Despite the subject, it retypes `OAuthRepository.getProfilePicture` to return `ArrayBuffer` directly. Fork's S3 profile-picture branch sits on that call. Also bumps both base images and drops the `jellyfin-ffmpeg` `LD_LIBRARY_PATH` export from `start.sh`. |
| `5d84e16bc11` | mise docker tag → v2026.8.12 (immich-30985)           | docker              | LOW          | Fork Dockerfile is heavily diverged; only the `COPY --from=ghcr.io/jdx/mise` pin moved.                                                                                                                                                                         |
| `aa6e4d9173f` | update typescript-projects (immich-30990)             | deps                | **HIGH**     | pnpm 11.21.0 → 11.22.0, `nestjs-kysely` 3.1.2 → 3.1.3, 1471 lockfile lines. Touches the fork's `@immich/ui` patch and its faker pin.                                                                                                                            |
| `caa96dda4f8` | valkey:9 digest bump (immich-30980)                   | docker              | LOW          | Fork pulls e2e valkey from GHCR instead of Docker Hub.                                                                                                                                                                                                          |
| `290861e347c` | mobile aspect ratio change (immich-30939)             | mobile              | LOW          | `editor.provider.dart`; fork does not diverge there.                                                                                                                                                                                                            |
| `4ff7148f85d` | show asset owner in asset details (immich-29302)      | mobile              | MEDIUM       | Adds `UserService.watch(id)` + a `userRepository` constructor param; touches two fork-diverged test-harness files. See the product note below.                                                                                                                  |
| `6221e29c70f` | typed error on malformed api responses (immich-31006) | sdk, cli, web       | MEDIUM       | Adds `isMalformedResponseError`; narrows the CLI's connect guard, which the fork had deliberately broadened.                                                                                                                                                    |
| `dc688edb6f1` | direct ocr processing (immich-31016)                  | ML                  | **HIGH**     | Deletes `RapidTextRecognizer`, widens the `ModelSession` protocol (`Sequence`, new `get_metadata`). ML is invisible to `tsc`/`dart analyze`.                                                                                                                    |
| `0f821a7338d` | mobile map asset number (immich-28911)                | mobile, i18n        | MEDIUM       | Restructures the map bottom sheet the fork rewrote; adds an i18n key.                                                                                                                                                                                           |

## Product-Direction Gate

**Assessed per batch; the gate did NOT fire.** No commit introduces or reworks a
sharing / access / sync / album / person model that overlaps a fork flagship, and none
sets a product direction we would want to converge with or diverge from.

The one commit worth naming is `4ff7148f85d` (**show asset owner in asset details**),
because it lands on sharing-adjacent surface. It is **additive and complementary** to
Shared Spaces rather than a competing model — it displays the owner of an asset the
viewer does not own — so it is not a gate stop.

**Fork-relevant gap worth tracking (not a regression, and not a blocker):**
`AssetOwnerDetails` resolves the owner through `UserService.watch(ownerId)` →
`UserRepository.watch` → the **local Drift `user` table**, and renders
`SizedBox.shrink()` when the row is absent. Mobile sync is owner-scoped, so for an
asset shared through a Space by another member the local `user` row may not exist and
the owner chip will silently not appear. This **fails safe** (it renders nothing, exactly
as upstream does for a non-partner), so nothing breaks. It is the same family as the
faces/people gap in issue #727, where the fix was to fall back to a server-sourced
lookup. Logged as follow-up work below.

## Conflict Resolutions

### Conflict: `pnpm-lock.yaml` (batch 164, at fork commit `694a400f20e`)

- **Fork side**: faker specifier `^10.3.0`; `@immich/ui@0.85.0` keys carry the fork's
  `patch_hash=7c1238…` from `patchedDependencies`.
- **Upstream side**: faker resolved to `10.6.0`; transitive `@sveltejs/kit` 2.70.2 → 2.70.3
  and `vite` 8.2.1 → 8.2.2 rewrote the `@immich/ui` keys.
- **Resolution**: took upstream's lockfile, then regenerated with the fork's workspace.
  End state keeps the fork's `^10.3.0` specifier (matching `e2e/package.json`) resolved to
  upstream's `10.6.0`, and both `patch_hash` occurrences.
  **`injectWorkspacePackages` was temporarily set to `false` for the regen** so pnpm did not
  flip workspace deps from `version: link:` to `version: file:` (the injected-hard-copy trap
  that has previously killed ~14 cold-checkout CI jobs). `pnpm-workspace.yaml` ends
  byte-identical; a follow-up commit restores the matching `settings:` line in the lockfile.
- **Risk**: MEDIUM → verified.
- **Verification**: `version: link:` = 11 / `version: file:` = 0 (fork baseline 11);
  `patch_hash` count 2; `packages/plugin-gallery` importer present;
  `pnpm install --frozen-lockfile` succeeds with no tree drift.
  Note faker moved 10.5.0 → 10.6.0, which reshuffles `seed: 42` UUIDs — the e2e UI specs
  that hardcode them are the thing to watch in remote CI.

### Conflict: `e2e/docker-compose.yml` (batch 165, at fork commit `f87727e3a7e`)

- **Fork side**: `ghcr.io/valkey-io/valkey:9@sha256:3acc0687…` — the fork pulls e2e valkey
  from GHCR to avoid Docker Hub rate limits.
- **Upstream side**: bumped the Docker Hub digest to `sha256:70739f85…`.
- **Resolution**: fork's registry + upstream's new digest.
- **Risk**: LOW → verified. Queried the GHCR registry directly: `ghcr.io/valkey-io/valkey:9`
  resolves to exactly `sha256:70739f85…` (HTTP 200 by digest), so the pin is valid on the
  fork's registry. YAML re-parsed clean.

### Conflict: `machine-learning/test_main.py` (batch 166, twice)

- **Fork side**: imports `PetDetector`; a later fork commit re-sorts that import.
- **Upstream side**: deleted the now-unused `OcrOptions` import.
- **Resolution**: keep `PetDetector` (13 usages), drop `OcrOptions` (0 usages after the
  refactor). Import block re-sorted correctly.
- **Risk**: LOW → verified: `py_compile` clean, `ruff check` clean, suite green.

### Conflict: `mobile/lib/providers/infrastructure/user.provider.dart` (batch 166, twice)

- **Fork side**: `UserApiRepository` takes the whole `ApiService` (lazy `.usersApi`), a
  divergence introduced by fork #369 and finalised by the fork's manual-provider commit.
- **Upstream side**: added `userRepository: ref.watch(driftProvider).userRepository` to the
  `UserService` constructor.
- **Resolution**: resolved **per commit**. At the historical Isar-era #369 commit, took
  upstream's modern structure (the Isar form is long dead); at the fork's
  manual-declaration commit, kept upstream's new `userRepository:` line, since that
  commit's intent — dropping `@Riverpod` codegen — is already expressed by the surrounding
  manual `Provider(...)` form.
- **Risk**: MEDIUM → verified. End state is the fork tip's file **plus** upstream's new
  parameter, i.e. the fork comment and lazy `UserApiRepository(ref.watch(apiServiceProvider))`
  both survive. `dart analyze --fatal-infos` clean.
- **Note (Shape K)**: `theirs` redefined `userApiRepositoryProvider` _inside_ the conflict
  while a copy of that line sat _outside_ it — the asymmetric-alignment trap. Checked
  explicitly that the fork's form was re-established by the later commit rather than lost.

### Conflict: `packages/cli/src/utils.ts` (batch 166, at fork commit `4e4f8109ffe`)

- **Fork side**: `if (error)` — broadened from `isHttpError(error)` because the fork's
  `.well-known/immich` discovery in `connect()` can raise non-HTTP errors.
- **Upstream side**: narrowed to `isHttpError(error) || isMalformedResponseError(error)`.
- **Resolution**: kept the fork's `if (error)`, which is a strict superset of upstream's
  condition. Upstream's new `isMalformedResponseError` branch in `logError` applied outside
  the conflict and is retained.
- **Risk**: LOW → verified: the import is still used (`logError`), so no unused-import lint;
  `e2e`/`cli` type checks clean.

### Conflict: `mobile/.../map_bottom_sheet.widget.dart` (batch 166, twice — 4 regions)

- **Fork side**: replaced upstream's private `_ScopedMapTimeline` with a public
  `MapBottomSheetTimeline` built on `TimelineRouteScope`, and added the grouping pill
  (`withGroupingPill: true`, `groupBy`/`temporalScope` from the scope builder).
- **Upstream side**: wrapped the timeline in a `Column` with a new `_MapAssetCount()`
  header showing `map_assets_in_bounds`.
- **Resolution**: merged — the fork's `TimelineRouteScope` builder **plus** upstream's
  `_MapAssetCount()` header, i.e.
  `Column(children: [_MapAssetCount(), Expanded(child: Timeline(…, withGroupingPill: true))])`.
- **Risk**: MEDIUM → verified. `directives_ordering: true` is enforced and fatal under
  `--fatal-infos`, so the imports were placed in sorted position rather than at the conflict
  site; the obsolete `timeline.model.dart` import was dropped once `forcedTimelineGroupBy`
  was gone. `dart analyze --fatal-infos` clean.

## Zero-Conflict Semantic Breaks

Both merged cleanly, passed every post-rebase audit, and broke in a file upstream never
touched. Fixed in `fc97cc5b1f5`.

| Upstream change                                                   | What broke, elsewhere                                                                                                                       | Caught by                                               |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| immich-30908 retyped `getProfilePicture` to return `ArrayBuffer`  | Upstream converted its own 2 mocks; the **fork's 6** S3 profile-picture mocks in `auth.service.spec.ts` still built `{ data, contentType }` | `server pnpm check` (TS2353 ×6)                         |
| immich-31016 deleted `models.ocr.recognition.RapidTextRecognizer` | Fork-only `test_passes_model_root_dir_to_rapidocr` patched that symbol                                                                      | `uv run pytest` — **not** `tsc`, **not** `dart analyze` |

The OCR test was **removed rather than re-pointed**: `recognition.py` is byte-identical to
upstream here, and the property the test guarded (OCR models resolving from the local cache
dir, not the network) is now structural in `_load()`, which builds an `OrtSession` from
`self.model_path` and reads `self.model_dir / "charset.txt"`. Re-pointing it would have
meant asserting on a private of upstream's new implementation.

The two surviving `contentType` literals in `auth.service.spec.ts` are the fork's
`mockS3Backend.put` assertions (`image/webp`), which are unrelated and deliberately kept.

## Detectors Run (all clean)

| Detector                                                                          | Result                                                                  |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Silent-noop literal (upstream-deleted URLs still literal-matched by fork tooling) | clean                                                                   |
| i18n branding-override gap (new `map_assets_in_bounds` key)                       | clean — no upstream product name; simulated branded merge surfaces none |
| Shape I (upstream adds a file fork history once owned)                            | clean                                                                   |
| Shape L (unresolvable mobile imports, run before **and** after codegen)           | clean                                                                   |
| Shape D anchored (`^COPY --from=plugins /app/` stale paths)                       | clean                                                                   |
| Shape J (enumerated sets: `mocks.dart`, `presentation_context.dart`)              | both sides preserved — see below                                        |
| `revert-to-immich.sql` migration coverage (step 7i)                               | clean — no new migrations this batch                                    |
| `.github/` prettier                                                               | batch touched no workflow files                                         |

**Shape J detail** — these two fork-diverged test-harness files merged with _no_ conflict,
which is exactly the silent-drop risk. Verified by grep that each kept both sides:
`mocks.dart` has upstream's `user.watch` stub **and** the fork's `ActionServiceStub` /
`removeFromSpace`; `presentation_context.dart` has upstream's `userServiceProvider`
override **and** the fork's `actionServiceProvider` / `foregroundUploadServiceProvider`.

## Fork Feature Verification

| Feature                           | Status | Notes                                                                                            |
| --------------------------------- | ------ | ------------------------------------------------------------------------------------------------ |
| Shared Spaces                     | OK     | Fork-owned file + symbol survival audits green on every batch                                    |
| S3 / Storage Migration            | OK     | `auth.service.ts` S3 branch intact on top of upstream's retyped call; `storage.core` specs green |
| Pet Detection                     | OK     | `PetDetector` import restored, 13 usages, `schemas.py` diverges only by the pet additions        |
| Image Editing                     | OK     | `editing.dto` / `utils/editor` untouched by the spec deletion                                    |
| Branding                          | OK     | i18n override scan clean; Dockerfile fork stages intact                                          |
| Google Photos Import              | OK     | untouched                                                                                        |
| Gallery plugin (`plugin-gallery`) | OK     | importer present in the final lockfile; Dockerfile COPY paths anchored at `/usr/src/app`         |

## Migration Analysis

- **Server**: no new upstream migrations in this range. Gallery migration count 61
  (expected 61); no timestamp collisions; `postbuild` synced 61 migrations + 1 compatibility
  alias; `revert-to-immich.sql` coverage complete.
- **Mobile Drift**: `mobile-drift-rebase-check` green. `dart run drift_dev make-migrations`
  completed **without** the "a schema for version N already exists and differs" refusal and
  rewrote no snapshot — the only reliable Shape L signal.

## Local CI Verification

| Check                                                                    | Status                | Notes                                                                      |
| ------------------------------------------------------------------------ | --------------------- | -------------------------------------------------------------------------- |
| `server pnpm build` (+ postbuild migration sync)                         | PASS                  | 61 migrations, 1 compatibility alias                                       |
| `server pnpm check` (tsc)                                                | PASS                  | after the `getProfilePicture` mock fix                                     |
| `server pnpm lint`                                                       | PASS                  |                                                                            |
| `web check:typescript`                                                   | PASS                  |                                                                            |
| `web check:svelte`                                                       | PASS                  | 627 files, 0 errors (not 0 files)                                          |
| `e2e pnpm check`                                                         | PASS                  | run because upstream touched `e2e/src/`                                    |
| prettier — server, web, e2e, docs, packages/cli, `.github`, i18n         | PASS                  | all seven gated packages                                                   |
| Server unit tests                                                        | PASS                  | 6061 passed, 12 skipped (incl. the reflective `controllers/index.spec.ts`) |
| Web unit tests                                                           | PASS                  | 5953 passed, 2 skipped, 8 todo                                             |
| ML `ruff format` / `ruff check` / `mypy --strict` (CI scope `immich_ml`) | PASS                  | 31 files, no issues                                                        |
| ML `pytest`                                                              | PASS                  | 116 passed, 3 skipped (after removing the obsolete OCR test)               |
| `dart analyze --fatal-infos lib test`                                    | PASS                  | No issues found                                                            |
| `dart format` (CI scope)                                                 | PASS                  | 870 lib files, 0 changed                                                   |
| `flutter test` (3.47.1)                                                  | PASS                  | 3462 passed, 1 skipped                                                     |
| `drift_dev make-migrations`                                              | PASS                  | no snapshot drift                                                          |
| OpenAPI `sync-open-api`                                                  | PASS                  | run visibly; **zero** spec drift (no controller/DTO changed)               |
| `pnpm install --frozen-lockfile`                                         | PASS                  | no lockfile drift                                                          |
| `make upstream-postrebase-audit` ×5 (162–166)                            | PASS                  | 7 checks green per batch                                                   |
| `make fork-patches-check`                                                | PASS                  | `@immich/ui` patch metadata consistent                                     |
| `make ci-invariants-check`                                               | PASS                  | 4 invariants                                                               |
| `make mobile-drift-rebase-check`                                         | PASS                  |                                                                            |
| `make commit-autolink-check`                                             | PASS                  | 1340 messages scanned, fork PR ceiling 1029                                |
| `web eslint` (`tscompat` off)                                            | see Remote CI section | still running locally at report time                                       |

## Pre-existing Issues (NOT caused by this rebase)

Both were confirmed by a control run against the pre-rebase tip `24aa551e750`, and neither
is gated by CI:

1. `machine-learning/test_main.py` fails `ruff format --check` when the check is run over the
   whole directory. CI's `mise //ml:format` scopes to `immich_ml`, so `test_main.py` is not
   gated. Fails identically at the pre-rebase tip.
2. `mobile/test/domain/services/memory_service_test.dart` fails `dart format` when `test/` is
   included. CI's `mise //mobile:format` scopes to `lib` (excluding `*.g.dart` /
   `*.drift.dart` / `*.gr.dart`), so `test/` is not gated. Fails identically at the
   pre-rebase tip.

## Toolchain Traps Hit This Cycle

- **`mise.lock` rewriting fired twice** — once from `mise run //:sdk:build` and once from the
  mobile gates. Both times it stripped this machine's non-matching platform blocks
  (including the fork's `jellyfin-ffmpeg` macOS entries). Restored with
  `git checkout -- mise.lock mobile/mise.lock`; both verified clean before committing.
- **Stale `.dart_tool` kernel error** — `dart run bin/generate_keys.dart` died with
  `Invalid kernel binary format version (expected 138, found 130)` from a `hook.dill`
  compiled by an older Dart SDK. Fixed by `rm -rf mobile/.dart_tool/hooks_runner`. Without
  this, `translations.g.dart` stays stale and lacks the new `map_assets_in_bounds` key.
- **`mise run install` resolved the wrong Flutter** from the worktree and failed version
  solving; invoking the pinned binary directly at
  `~/.local/share/mise/installs/aqua-flutter-flutter/3.47.1/flutter/bin/{flutter,dart}` worked.
- `mobile/pubspec.lock` was rewritten by `pub get` (Dart SDK constraint `>=3.12.0` →
  `>=3.13.0`); reverted as unrelated local drift.

## Follow-up Work

1. **Mobile asset-owner chip is blank for Space-shared assets.** `AssetOwnerDetails` reads
   the owner from the owner-scoped local Drift `user` table and renders nothing when the row
   is missing. Mirror the #727 fix: fall back to a server-sourced lookup for assets owned by
   a Space member. Fails safe today, so this is an enhancement, not a bug fix.
2. **Faker 10.5.0 → 10.6.0** reshuffles `seed: 42` UUIDs. The e2e UI specs under
   `e2e/src/ui/specs/timeline/` hardcode those UUIDs — watch that suite in remote CI.
3. Optionally fold the two pre-existing format misses above into a small housekeeping PR, or
   widen the CI format scope to `test/` so they stop being invisible.

## Remote CI Verification

- **Test branch**: `rebase/upstream-batch-166`
- **Commit validated**: `fc97cc5b1f5`

_To be filled in once the dispatched workflows report._
