# Upstream Sync Report — 2026-08-10 (batches 67–71 + fork sync)

## Summary

- **Upstream commits pulled**: 6 (`1c5770601dc..35c2a90fcac`, batches 67–71)
- **Fork commits synced**: 2 (#963, #967 — hand-applied, see below)
- **Conflicts resolved**: 3 (2 × `machine-learning/uv.lock`, 1 × `docs/fork/ownership.yml`)
- **Zero-conflict semantic breaks repaired**: 4 (all from the same two upstream refactors)
- **Risk level**: MEDIUM — one HIGH-risk commit (#30631), fully analysed and repaired
- **Recommendation**: PROCEED

The branch is level with `upstream/main` (0 behind) and stays **off `main`** — upstream's newest
tag is still `v3.1.0`, so the standing landing rule is not satisfied.

## Incoming Upstream Changes

| SHA           | Summary                                                                    | Area   | Risk to Fork | Notes                                                                                                                                                 |
| ------------- | -------------------------------------------------------------------------- | ------ | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `79e61c47c7c` | refactor(ml): remove insightface dependency (#30631)                       | ML     | **HIGH**     | Deleted `decode_cv2`, changed the `_predict` contract, deleted the `cv_image` test fixture. Three separate fork breaks, none conflicting.             |
| `e9eafc31614` | refactor: gallery permission notifier (#30477)                             | mobile | **HIGH**     | Renamed `IPermissionRepository`/`PermissionRepository` → `DevicePermissionRepository`. Broke two fork-only test files, no conflict.                   |
| `35c2a90fcac` | fix(mobile): video controls dead for backed-up videos from search (#30587) | mobile | LOW          | Adds abstract `String get id` to `BaseAsset`; both concrete subclasses are upstream-owned and implement it. No fork-only `BaseAsset` subclass exists. |
| `161e15ee2f1` | fix(deployment): huggingface cache dir in Dockerfile (#30357)              | infra  | LOW          | `machine-learning/Dockerfile` has zero fork divergence — clean take. `MPLCONFIGDIR` → `HF_HOME=/cache/hf-cache`.                                      |
| `2314330c78b` | fix: translation (#30549)                                                  | i18n   | LOW          | Single `en.json` key (`upload_errors`) shortened. No "Immich" mention, so no `branding/i18n/overrides-*.json` entry is required.                      |
| `8d086d61c48` | chore: good-first-issue llm rule in CONTRIBUTING.md (#30645)               | docs   | LOW          | Trivial.                                                                                                                                              |

### Product-direction gate

**Did not fire.** No commit changes _where_ a feature is going in a way that collides with a fork
product decision. #30631 is an implementation swap (insightface → in-repo SCRFD/ArcFace ops) that
leaves `FaceDetectionOutput` unchanged; #30477 is an internal mobile refactor. Nothing overlaps
Shared Spaces, the sync contract, or the fork's face-identity layer as a direction.

### High-risk analysis — #30631 (remove insightface)

**Face embedding compatibility — verified equivalent, existing fork embeddings are NOT invalidated.**
This was the one genuinely dangerous possibility, since the fork stores face identities and
statistics keyed on ArcFace embeddings.

|           | Old path                                                                    | New path                                  |
| --------- | --------------------------------------------------------------------------- | ----------------------------------------- |
| Decode    | `decode_cv2` → BGR                                                          | `decode_pil` → RGB                        |
| Align     | insightface `norm_crop`                                                     | in-repo `align_face` (`_ops.py`)          |
| Normalise | `ArcFaceONNX.get_feat` → `blobFromImages(1/127.5, mean 127.5, swapRB=True)` | `normalize(crops, mean=127.5, std=127.5)` |

The old path fed BGR and swapped to RGB inside `get_feat`; the new path feeds RGB directly and skips
the swap. Same tensor, same constants — so embeddings are stable across the upgrade.

`FaceDetectionOutput` keeps its `{boxes, scores, landmarks}` shape, so the fork's face-identity
repository, merge propagation and statistics need no change.

## Zero-conflict semantic breaks (the substance of this cycle)

Four fork breaks landed with **zero conflicts** — the merge was clean, every post-rebase audit was
green, and the damage sat in files upstream never touched. Consistent with the standing gate: assume
every batch contains one until you have looked.

| #   | Upstream change                                                                              | What broke, elsewhere                                                                                                             | Caught by                                |
| --- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| 1   | #30631 deleted `decode_cv2` from `models/transforms.py`                                      | `pet_detection/detection.py` imported it → the fork-only pet detector failed to import at all                                     | Checkpoint-1 diff read (before rebasing) |
| 2   | #30631 changed `InferenceModel.predict` to forward `**model_kwargs` into `_predict`          | `PetDetector._predict` took no kwargs; `MachineLearningRepository.detectPets` always sends `minScore` → `TypeError` on every call | Checkpoint-1 diff read                   |
| 3   | #30631 deleted the `cv_image` fixture and `import cv2` from the test harness                 | The fork's 4 pet-detection tests take `cv_image: cv2.Mat` → `NameError`, whole module failed collection                           | `uv run pytest`                          |
| 4   | #30477 renamed `IPermissionRepository`/`PermissionRepository` → `DevicePermissionRepository` | Two **fork-only** test files declare their own references → 26 analyzer errors                                                    | `dart analyze --fatal-infos`             |

Breaks 1 and 2 were found by reading the batch diff at Checkpoint 1 rather than by a gate — neither
the compiler nor any audit sees them, because Python resolves the import only at runtime and the
kwargs mismatch only on call. Breaks 3 and 4 were found by the local step-9 gates, which is exactly
why they run before CI.

**Break 4 is the mocktail blind spot in a new shape.** The standing note says hand-written fakes
break while `extends Mock` classes absorb signature changes via `noSuchMethod`. Here the mocks _were_
mocktail mocks, but they name the interface explicitly (`implements IPermissionRepository`), and a
**renamed** type is not something `noSuchMethod` can absorb. Upstream converted its own
`repository.mocks.dart`; the fork-only test files that declare their own mock were invisible to it.

### Repairs applied

| Commit                                                                                       | Fix                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fix(ml): keep pet detection working after upstream dropped insightface`                     | Restores `decode_cv2` semantics locally as `pil_to_cv2(decode_pil(...))` with an ndarray passthrough (so an already-decoded BGR array is not channel-swapped), and accepts `**model_kwargs` in `_predict`. `configure` still owns `min_score`. |
| `test(ml): restore the cv_image fixture the fork's pet tests rely on`                        | Re-adds the fixture to `conftest.py` as a fork-only helper and annotates the tests `NDArray[np.uint8]` — what the fixture actually returns and what `_predict` declares — rather than re-importing `cv2` for a type name.                      |
| `test(mobile): follow upstream's IPermissionRepository -> DevicePermissionRepository rename` | Pure rename in two fork-only test files. `DevicePermissionRepository` keeps the same constructor and every location / manage-media method these tests exercise.                                                                                |

Note on the decode repair: `main.py` hands `_predict` a **PIL Image**, not the `NDArray | bytes` the
annotation claims, so the replacement had to keep working for all three types. The `isinstance`
guard preserves the old `decode_cv2` behaviour exactly rather than adopting upstream's
`decode_pil`-only form, which would channel-swap an ndarray input.

## Conflict Resolutions

### Conflict: `machine-learning/uv.lock` (at fork #120, "path traversal protection and onnx update")

- **Fork side**: bumps `onnx` 1.19.1 → 1.20.1 (CVE-2026-28500; no patched version above 1.20.1 existed then).
- **Upstream side**: already at `onnx` 1.22.0, and #30631 regenerated the whole lock.
- **Resolution**: took upstream's lock. The fork's intent — an onnx newer than 1.19.1 — is satisfied
  and exceeded. `pyproject.toml` had auto-merged into a **duplicate** `onnx` entry (upstream's
  `>=1.22.0` in sorted position plus the fork's appended `>=1.20.1`), so the now-redundant weaker
  fork line was dropped. Verified no later fork commit touches it (`git log -S` → only #120).
- **Risk**: LOW. #120's server-side path-traversal fix is untouched; only its ML half became a no-op.
- **Verification**: `uv sync --locked` resolves 119 packages cleanly.

### Conflict: `machine-learning/uv.lock` (at fork #427, "phase 1 prometheus metrics")

- **Fork side**: adds the `prometheus-client` package block.
- **Upstream side**: **removed** `prettytable` (and its `wcwidth` dependency) — both were insightface
  transitive deps.
- **Resolution**: kept upstream's removal _and_ the fork's addition. Resolved the hunk to the
  `prometheus-client` block alone, alphabetically between `pluggy` and `protobuf`. Taking either side
  wholesale would have been wrong: `--ours` drops the fork's metrics dependency, `--theirs`
  resurrects two packages upstream deliberately deleted.
- **Risk**: LOW.
- **Verification**: `prettytable`/`wcwidth` refs = 0; `prometheus-client` present in all three
  required places (the `immich-ml` dependency list, the specifier list, and its own package block);
  `uv sync --locked` succeeds, which is what proves the hand-spliced lock is internally consistent.

### Conflict: `docs/fork/ownership.yml` (fork sync, at #967)

- **Fork side (`main`)**: #967 adds `Template/**` and bumps `last_verified_fork_head` to `99ce9f8b46e`.
- **Rolling side**: already carried `Template/**` from the 2026-08-08 cycle; cursor at `64f520e2da0`.
- **Resolution**: took #967's cursor value, keeping the file byte-identical to `main`. The
  `Template/**` half was already present, so #967 reduced to a one-line change here.
- **Risk**: LOW. `make fork-ownership-coverage-check` exits 0.

## Fork Sync — hand-applied

`make upstream-sync-fork-main` aborted on the `ownership.yml` conflict and its all-or-nothing
rollback fired cleanly (HEAD restored, cursor unchanged). The two commits were then cherry-picked by
hand and `rolling-state.json` was reconciled manually: `integratedForkHead` advanced to
`92e13b842bd`, with an `appendHistory` entry recording the resolution.

**`origin/main` moved mid-cycle.** The scan started with one pending fork commit (#963) and #967
landed while the upstream batches were being rebased. Worth re-checking `origin/main` late in a
cycle — here it changed the sync from one commit to two.

**#967 is `main` catching up with the rolling branch.** It fixes the same
`fork-ownership-coverage-check` failure this workflow already fixed here on 2026-08-08. That is why
its `Template/**` hunk applied as a no-op.

## Fork Feature Verification

| Feature              | Status | Notes                                                                         |
| -------------------- | ------ | ----------------------------------------------------------------------------- |
| Pet Detection        | OK     | Broke twice and was repaired; 6 pet tests pass.                               |
| Shared Spaces        | OK     | Post-rebase audit: all fork-owned files and expected symbols present.         |
| Storage Migration    | OK     | Untouched this cycle.                                                         |
| Image Editing        | OK     | Untouched.                                                                    |
| Branding             | OK     | Branding check green; no new Immich-bearing i18n key to override.             |
| Google Photos Import | OK     | Untouched.                                                                    |
| Prometheus Metrics   | OK     | `prometheus-client` survived the lock regeneration.                           |
| Mobile Spaces / sync | OK     | `sync_stream.service.dart` took a 1-line upstream edit; `dart analyze` clean. |

## CI and Infrastructure Verification

| Check                                   | Status | Notes                                                                                       |
| --------------------------------------- | ------ | ------------------------------------------------------------------------------------------- |
| Workflow files (no upstream collisions) | OK     | `ci-invariants-check` green.                                                                |
| Docker image references                 | OK     | Gallery release workflows publish Gallery images.                                           |
| Branding (no Immich leaks)              | OK     | `gallery-branding-check.sh` green.                                                          |
| Fork CI modifications intact            | OK     | `ci-invariants-check`: no `PUSH_O_MATIC` dependency, docs-deploy stays `workflow_dispatch`. |
| `@immich/ui` patch                      | OK     | `fork-patches-check` green.                                                                 |
| Fork ownership coverage                 | OK     | Exit 0 after the #967 cursor bump.                                                          |
| Branding literal silent-noop detector   | OK     | No removed URL literal is still `sed`-matched by `branding/scripts`.                        |

## Database Migration Analysis

**No migrations changed this cycle.** `git diff pre-batch..HEAD -- server/src/schema/migrations/
server/src/schema/migrations-gallery/` is empty.

- Gallery migration count: **49** (expected 49)
- Timestamp collisions: NONE
- `postbuild` sync intact: YES — build reports `Synced 49 Gallery migrations … wrote 1 compatibility aliases`
- `revert-to-immich.sql`: **no new entries required** (no post-tag upstream migration added)

## Mobile Drift Migration Analysis

`make mobile-drift-rebase-check` green for batches 69 and 71. Upstream added no Drift migration, so
no renumbering was needed and fork-owned snapshots are untouched.

## Pattern Propagation

No new broad architectural refactor. #30631 and #30477 are both self-contained rewrites rather than
patterns the fork should adopt; the fork's only obligation was to follow the renamed/removed symbols,
which the three repair commits do.

## Local CI Verification

| Check                                            | Status | Notes                                                                                                                                                                                                |
| ------------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server pnpm build` (+ postbuild migration sync) | PASS   | 49 migrations, 1 compatibility alias                                                                                                                                                                 |
| `server pnpm check` (tsc)                        | PASS   |                                                                                                                                                                                                      |
| `server pnpm lint`                               | PASS   |                                                                                                                                                                                                      |
| `server` unit tests                              | PASS   | 5270 passed, 14 skipped                                                                                                                                                                              |
| `web check:typescript`                           | PASS   |                                                                                                                                                                                                      |
| `web check:svelte`                               | PASS   | 585 files, 0 errors, 0 warnings                                                                                                                                                                      |
| `web` eslint (`tscompat` off)                    | PASS   | 0 errors. The 13 warnings are all `Unused eslint-disable directive` for `tscompat/tscompat`, an artifact of the local rule-off workaround — CI runs the rule enabled, where those disables are used. |
| `web` unit tests                                 | PASS   | 4345 passed, 2 skipped, 8 todo                                                                                                                                                                       |
| ML `uv sync --locked`                            | PASS   | 119 packages — validates the hand-resolved lock                                                                                                                                                      |
| ML `ruff format` / `ruff check`                  | PASS   | 29 files unchanged; all checks passed                                                                                                                                                                |
| ML `mypy --strict immich_ml/`                    | PASS   | no issues in 29 source files                                                                                                                                                                         |
| ML `pytest`                                      | PASS   | 117 passed, 3 skipped                                                                                                                                                                                |
| mobile `dart analyze --fatal-infos lib test`     | PASS   | No issues found                                                                                                                                                                                      |
| mobile `dart format` (lib, as CI does)           | PASS   | 828 files, 0 changed                                                                                                                                                                                 |
| mobile `flutter test`                            | PASS   | 3179 passed, 1 skipped                                                                                                                                                                               |
| `mise.lock` unmodified                           | PASS   | clean after every local `mise` invocation                                                                                                                                                            |

## Remote CI Verification

- **Test branch**: `rebase/upstream-rolling-v3.1.1`
- **Commit validated**: `81b22b1cf0e45958609972a919a8f5f7ce868440`
- **Result**: **10/10 GREEN** (`test.yml` 21/21 jobs, 0 skipped)

| Workflow                                  | Status | Run         | Notes                                     |
| ----------------------------------------- | ------ | ----------- | ----------------------------------------- |
| `test.yml`                                | GREEN  | 31367784588 | 21/21 jobs after one re-run (see below)   |
| `docker.yml`                              | GREEN  | 31367786594 | builds server/web/cli/ml images           |
| `static_analysis.yml`                     | GREEN  | 31367788426 | validates the mobile permission rename    |
| `gallery-build-mobile.yml`                | GREEN  | 31367800904 | iOS + Android compile                     |
| `gallery-rebase-smoke.yml`                | GREEN  | 31367790166 |                                           |
| `storage-migration-tests.yml`             | GREEN  | 31367791933 |                                           |
| `storage-migration-e2e.yml`               | GREEN  | 31367799061 |                                           |
| `gallery-revert-to-immich-validation.yml` | GREEN  | 31367793661 | confirms no new migration coverage owed   |
| `gallery-ml-smoke.yml`                    | GREEN  | 31367795547 | ML image boots with the repaired detector |
| `gallery-mobile-smoke.yml`                | GREEN  | 31367797498 |                                           |

**Confirmed environmental (not a code failure)**: on the first pass, `test.yml`'s
`E2E Tests (Server & CLI) (ubuntu-latest)` died in **Start Docker Compose** after 4 seconds with
`toomanyrequests: retry-after: 76.77µs, allowed: 44000/minute` — the container-registry rate limit
that dispatching all ten workflows at once provokes. No test had run yet; `e2e-tests-web` passed in
the same run, and the arm twin was cancelled by fail-fast (so it gave no control signal). Re-running
the failed jobs with nothing else in flight went green. Stagger re-dispatches to avoid this.

## Post-Rebase Verification

- Fork commits ahead of upstream: 1121
- Commits behind upstream: **0**
- Fork diff clean: YES
- Landing on `main`: **NO** — upstream's newest tag is still `v3.1.0`. Per the standing rule the
  branch stays off `main` until upstream tags a release _and_ that tagged state is validated on an RC.
