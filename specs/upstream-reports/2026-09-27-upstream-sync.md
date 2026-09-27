# Upstream Sync Report — 2026-09-27

## Summary

- **Cycle**: rolling, still targeting the next upstream release (expected **v3.3.0**, not yet tagged — the
  newest tag is `v3.2.2`)
- **Branch**: `rebase/upstream-rolling-v3.3.0`, continuing from the 2026-09-24 cycle
- **Upstream base**: `e598e108966` → **`6b978d0c0d3`** (level with `upstream/main`)
- **Upstream commits pulled**: **16**, in 6 batches (plan batches 34–39)
- **Fork commits synced from `main`**: #1138 (storage-migration tests on Chainguard's MinIO), #1141
  (`make upstream-review-pr`), #1143 (AUR install guide)
- **Conflicts resolved**: 33 replayed-commit stops (notable ones below)
- **Risk level**: MEDIUM — one ML refactor that broke both pet models with zero conflicts
- **Recommendation**: PROCEED. The branch stays off `main` because there is no upstream tag yet.
- **Pre-cycle tip**: `backup/rolling-pre-2026-09-27` (`3cf47503c0a`, after the fork sync)

**Character of the cycle: one silent ML break, the rest mechanical.** Upstream rewrote ML model loading
and inference (immich-31742, immich-31750). Every fork pet-model hook it relied on stopped being called
or changed signature, and git reported nothing: the pet files are fork-only, so they never conflicted.
Pierre chose to pull the rewrite and port the pet models in the same cycle rather than quarantine it.

## Product-Direction Gate

No commit needed a new product decision.

- **Birthday memory UI (immich-31798)** renders only `type='birthday'` memories, which the fork withholds
  from every read path since 2026-09-24
  ([design](../2026-09-24-birthday-memories-upstream-coexistence-design.md)). Pulled as dormant UI. The
  new `MemoryCard` component it introduces is live (it replaces the card on `/memories`, `/explore` and
  `/photos`), so the fork's subtitle moved into it.
- **Album editors can edit title/description (immich-31805)** is web-only and matches what the server
  already allowed: `Permission.AlbumUpdate` is owner ∪ `album_user` Editor, with no Space arm. The Space
  album page follows the same rule (below). A Space role alone still does not grant editing.
- **Leave album (immich-31768)** calls `removeUserFromAlbum(me)`. It only appears in the `/albums` list,
  which is upstream's owner ∪ `album_user` query; Space-linked albums never appear there.
- **ML rewrite (immich-31742, immich-31750)** is a technical refactor, but it was surfaced at Checkpoint 1
  because it breaks a fork feature silently. Decision: pull and port now.

## Incoming Upstream Changes

| SHA           | Summary                                            | Area      | Risk to fork | Notes                                                     |
| ------------- | -------------------------------------------------- | --------- | ------------ | --------------------------------------------------------- |
| `7622e95d6dc` | Activity log defaults to latest                    | web       | LOW          |                                                           |
| `520a70891b0` | Search filter scrollbar                            | web       | LOW          |                                                           |
| `fbff5f41bed` | Ask before deleting local-only photos (Android≤10) | mobile    | LOW          | Deletes private helpers in a file the fork doesn't touch  |
| `c0a9146023c` | Linear-light resampling                            | server    | MEDIUM       | Thumbnail API now takes a `Bitmap`; fork call sites moved |
| `253692f2793` | Leave album action                                 | web       | LOW          | See gate                                                  |
| `efb44b89136` | Remember selected search type                      | web       | LOW          |                                                           |
| `87e76d89126` | Face bounding box label alignment                  | web       | LOW          | `BoundingBox` gains `labelWidth`                          |
| `de13aab713f` | ML: improve model loading                          | ML        | **HIGH**     | Silent pet-model break, see below                         |
| `23f1f87dd05` | ML: optimized model inference                      | ML, docs  | **HIGH**     | New `OrtSession`/`ShapePolicy` contract                   |
| `c4f9e0fab62` | Editors can update album title & description       | web       | MEDIUM       | Fork relocated the components                             |
| `f8f4051a24f` | `.jfif` support                                    | server    | LOW          |                                                           |
| `9c06df378ce` | Birthday memory UI                                 | web, deps | MEDIUM       | `svelte-confetti`; `MemoryCard`                           |
| `d1faeb8199f` | Rotated video scaling when transcoding             | server    | LOW          |                                                           |
| `93f65b750e6` | Image provider cancellation                        | mobile    | LOW          |                                                           |
| `523c26e7230` | Keep cached initial image operation                | mobile    | LOW          |                                                           |
| `6b978d0c0d3` | hwaccel `device_cgroup_rules` cleanup              | docker    | LOW          |                                                           |

No migrations (server or mobile Drift), no DTO/OpenAPI change, no workflow change. The pre-rebase
detectors (removed literals, i18n branding gaps, added/renamed paths vs fork history) were all clean.

## Zero-Conflict Semantic Break: the ML rewrite

Found by reading the diff at Checkpoint 1, confirmed by `mypy --strict`, fixed in
`chore(rebase): port the pet models onto upstream's ML loading and inference contract`.

| Fork dependency                                         | What upstream changed                                            | Effect if pulled blind                                                 |
| ------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `PetDetector/PetRecognizer._download()` → `open-noodle` | `download()` inlines `snapshot_download(model_organization/...)` | Fresh installs fetch `immich-app/rfdetr-nano` → RepositoryNotFound     |
| `PetDetector.configure(minScore)`                       | `configure()` deleted; `ModelCache` builds each model once       | Admin `minScore` changes ignored until eviction/restart — **no error** |
| `model_cache.cache._cache` in `/metrics`                | Cache is a plain `_models` dict                                  | `/metrics` 500s; the metrics refresh task dies on its first loop       |
| `_make_session(path)`, `session.run/get_inputs`         | No-arg `_make_session`; graphs via `session.for_shape(Shape)`    | TypeError on first load                                                |
| `pil_to_cv2`                                            | Removed                                                          | ImportError; `test_main.py` fails to import                            |
| `settings.max_batch_size.pet_recognition: int \| None`  | `MaxBatchSize` fields are non-optional ints                      | `batches(None)` TypeError                                              |

The fork's own tests would have stayed green on the first three: they called `_download()` and
`configure()` directly and monkeypatched the old cache shape. The port:

- **`GalleryHostedModel`** (`machine-learning/immich_ml/models/gallery_hosted.py`) overrides `download()`
  the way upstream's own `TextModel` does: always `open-noodle/<name>` at `main`, the unversioned cache
  folder (our repositories carry none of upstream's revisions), and the `FileNotFoundError` that sends a
  model back to ONNX.
- **`minScore` is a per-request `_predict` argument**, as `FaceDetector` takes it.
- **`PetRecognizer`** declares its batches through `ShapePolicy` and runs them with `runs()`, copying
  `FaceRecognizer`; on a dynamic (CPU) provider every run is batch 1. It now reads RGB throughout — the
  old PIL→BGR→resize→BGR2RGB path was a lossless channel swap, so embeddings are unchanged. Outputs pass
  through `widen()`.
- **Load metrics** are timed per `model.load()` call (`timed_load`), outside `attempt()`, which now also
  wraps `predict`/`build`. This keeps #427's "error then success" count for a corrupt-cache retry.
- `MaxBatchSize.pet_recognition` defaults to `4`, matching facial recognition.

Tests: four regression tests (per-request `minScore`, download through `download()`, the Gallery org
pin, the metrics refresh against a real `ModelCache`) were each **proven red** against the pre-port code.
The fork-only `cv_image` fixture is gone; `conftest.py` is byte-identical to upstream again.

**A replay artefact caught on the way:** re-inserting fork #427's `TestPrometheusMetrics` class during a
Shape-K conflict anchored on the `class TestPredictionEndpoints:` line, which put the class between that
suite's `@pytest.mark.skipif(not settings.test_full)` decorator and its class. That silently skipped the
fork's metrics tests and un-skipped the model-downloading endpoint tests (which then failed against the
stale local model cache). Restored in the port commit. **When re-inserting a block before a class or
function, anchor above its decorators.**

## Conflict Resolutions

### Batch 34 — linear-light resampling (4 stops)

- **`media.service.ts` (fork squash)**: kept the fork's S3 try/finally in the edit-thumbnail path and moved
  its thumbhash call to the `Bitmap` form; took the fork's side of the person-thumbnail hunk (the fork
  moved that body inside its S3 try block). The remaining fork call sites outside the markers
  (`base.service.ts` personal face crop, the S3 person thumbnail) moved in
  `chore(rebase): port fork media call sites onto upstream's Bitmap thumbnail API`.
- **`profile-image.ts`**: at #557 kept the HEIC `extractHeifFrame` wrapper around upstream's
  `decodeImage` → `generateThumbnail`; at the later fork commit that reverts #557 the file resolved to
  upstream's form byte-for-byte.
- **`presentation_context.dart`**: union of two imports.
- Fork S3 branches in `syncProfilePicture` / `createProfileImage` verified present.

### Batch 35 (2 stops)

- **`people-utils.ts`**: upstream's `BoundingBox` with `labelWidth` + fork #567's sort helpers.
- **`album.service.ts`**: union of upstream's `Leave` action and fork #990's `isAlbumEditor` gate on `Edit`.
- Tree delta for the batch is line-for-line identical to upstream's own diff.

### Batches 36–37 — ML (8 stops)

- **`main.py`** (#427 metrics): union of imports; `ModelCache()` with no arguments; metrics task next to
  `allocator.release()`; `ACTIVE_REQUESTS` inc/dec inside the new async `update_state`; load metrics moved
  out of `attempt()` (see above).
- **`schemas.py`**: kept `NotRequired`, dropped `orjson`/`JSONResponse` (upstream moved `ORJSONResponse`).
- **`config.py`**: upstream's non-optional ints + `pet_recognition: int = 4`.
- **`test_main.py`**: the import-only hunks resolved by three-way set merge (`ModelPrecision` is gone
  upstream); one Shape-K stop (the metrics class, above).
- **`environment-variables.md`**: took upstream's table and re-added the fork's
  `IMMICH_MACHINE_LEARNING_CLOSE_CONNECTIONS` row (#463), twice.

### Batch 38 — album editors, `.jfif`, birthday UI (19 stops)

- **Photos page** (#179, #230, #250, #309, #456, #752, #921, #1060): took the fork's page and re-applied
  upstream's three-line delta (`MemoryCard` import, `type: memory.type`, carousel snippet). #921's
  `class="mt-0"` on the carousel is preserved. A resolver asserted every line upstream added was present.
- **Album page** (#414): fork's filter-panel layout + upstream's `{isEditor}` on the title/description.
- **`utils.ts` / `utils.spec.ts`** (#418, #502, #1012, #1053): kept the fork's `getMemoryTitle` (its
  `typeof personName === 'string'` guard already satisfies upstream's new "no name → Unknown" test);
  kept upstream's three `memoryLaneTitle` birthday tests next to the fork's, then let #1053 move the fork's
  tests out. At #1053 the removed block was verified equal to the base.
- **Memories page** (fork `8243f7bdf65`, "restore three fork deltas"): adopted upstream's `MemoryCard` and
  moved the fork's rule-engine subtitle into it as an optional `subtitle` inside a bottom-anchored wrapper.
  Only `/memories` passes one, as before. The branded `LoadingSpinner` swap and `enableGrouping` survived.
- **`MemoryViewer.svelte`**: upstream and fork #1029 both switched the date to the current asset; kept the
  fork's explanatory comment. Import union at #1056.
- **`pnpm-lock.yaml`**: two stops where a fork lockfile refresh met upstream's new `svelte-confetti`
  snapshot. At the tip the importer entry pointed at a svelte build the fork does not resolve
  (`@typescript-eslint/types@8.70.0`); aligned with the other 82 references. `pnpm install
--frozen-lockfile` passes and no workspace package is injected.

**Album title/description on the Space album page.** Git's rename detection carried immich-31805's prop
rename into the fork's relocated `$lib/components/album-page/` copies (the route-local copies stay
deleted). The Space album page passed `{isOwned}` "mirroring the regular album page"; it now passes
`isEditor={isAlbumEditor}` (owner or album editor), which mirrors the regular page again and matches
`Permission.AlbumUpdate` exactly.

### Batch 39

Replayed cleanly.

## Code Review Findings

An independent review of the reconcile commits and conflict resolutions returned no Critical or
Important findings. Its four minors were fixed in `fix(rebase): address review of the ML port and the
leave-album action`:

1. `test_legacy_model_path_is_onnx_only` could not fail; now proven red without the guard.
2. Leave album is gated on "non-owner album user". The reviewer's Space-reader scenario does not reach
   the menu in practice (security-8 strips `albumUsers` to the owner for Space-only readers, so the
   `albumUsers.length > 1` block never renders), but the guard now states the real precondition. Spec
   proven red against upstream's `!isOwned`.
3. `GalleryHostedModel` docstring: `MACHINE_LEARNING_MODEL_REVISION` still applies upstream's
   accelerator fp16 conversion and graph rewrites to the pet graphs (global `settings.legacy_models`).
   Opt-in and undocumented upstream; noted rather than hooked.
4. `/metrics` snapshots `ModelCache._models` before iterating (it runs off the event loop).

Also documented `MACHINE_LEARNING_MAX_BATCH_SIZE__PET_RECOGNITION` (now `4`; previously unbounded on CPU,
now always batch 1 there because upstream pins dynamic providers).

## Whole-tree accounting

Every file in `git diff backup/rolling-pre-2026-09-27..HEAD` is either in upstream's own diff or explained:

- Cycle-only: the four reconcile commits, the ownership manifest, and the fork's relocated
  `AlbumTitle`/`AlbumDescription` (+spec), which received upstream's change by rename detection.
- Upstream-only: the three route-local album files the fork deleted, and `web/src/lib/utils.ts`, where
  the fork's `getMemoryTitle` supersedes upstream's one-line guard change.

No new zero-byte files, no resurrected retired directories, no duplicated file bodies.

## Fork sync note

`make upstream-sync-fork-main` cherry-picked #1138/#1141/#1143 cleanly but its ownership check refused:
#1141 added `scripts/upstream-review-pr.sh` with no manifest entry. Added it and advanced
`last_verified_fork_head` to `f0f2c2ef8f1`; `main` needs the same entry. `gallery_hosted.py` and
`models/pet_recognition/**` were also added to the pet feature's owned paths.

## Verification

| Gate                                                   | Result                                                      |
| ------------------------------------------------------ | ----------------------------------------------------------- |
| Server build / `tsc` / lint / prettier                 | Clean                                                       |
| Server unit                                            | 6,456 passed                                                |
| Web `tsc` / `svelte-check` (634 files) / eslint        | Clean (eslint: 25 changed files, 0 problems)                |
| Web unit                                               | 391 files, 6,401 passed (+3 Leave-album specs after review) |
| ML ruff format/check, `mypy --strict`, pytest, uv lock | Clean, 223 passed                                           |
| Mobile codegen, `dart analyze --fatal-infos`, format   | Clean; Drift snapshots regenerate byte-identical            |
| Mobile tests                                           | 4,015 passed                                                |
| Upstream-preflight tool                                | 293 passed                                                  |
| OpenAPI regen                                          | No diff                                                     |
| Docs / i18n prettier                                   | Clean                                                       |
| Post-rebase audits, invariants, patches, drift (34–39) | Green                                                       |
| `make commit-autolink-check`                           | OK (1,580 messages)                                         |
| `pnpm install --frozen-lockfile`                       | Passes                                                      |

**Local toolchain trap:** `mise //mobile:codegen` in this worktree resolved Flutter 3.44.0 (and a Homebrew
Dart for build hooks) instead of the pinned 3.47.2, failing with `Invalid kernel binary format version`
and "requires Flutter SDK version 3.47.2". Running the task's steps directly with
`~/.local/share/mise/installs/aqua-flutter-flutter/3.47.2/flutter/bin` first on `PATH`, after deleting
`.dart_tool/hooks_runner`, works. Not a CI issue.

## CI results

All on `2f87a00bbb8`:

| Workflow                    | Result                                                               |
| --------------------------- | -------------------------------------------------------------------- |
| Test                        | GREEN                                                                |
| Static Code Analysis        | GREEN                                                                |
| Gallery Build Mobile        | GREEN                                                                |
| Gallery Mobile Smoke        | GREEN                                                                |
| Gallery Rebase Smoke        | GREEN                                                                |
| Docker                      | GREEN                                                                |
| Gallery ML Smoke            | GREEN                                                                |
| Storage Migration Tests     | GREEN — first green since the MinIO withdrawal, via #1138            |
| Revert-to-Immich Validation | GREEN                                                                |
| Storage Migration E2E       | GREEN on attempt 2; attempt 1 died on GHCR `toomanyrequests` at pull |

The two waves were dispatched ~2 minutes apart, with 20–30 s between dispatches; one registry rate
limit still hit, before any test ran, and cleared on re-run.

## Follow-up work

1. `main`'s ownership manifest needs the `scripts/upstream-review-pr.sh` entry (above).
2. The fork's rule-engine birthday memories could reuse `MemoryCard`'s birthday styling (cake icon,
   confetti) by mapping `ruleId='birthday'` onto it — a product choice, not done here.
3. `pet-recognition-training/` has four files `ruff format` would rewrite; that project is outside
   `immich_ml`'s lint scope and untouched this cycle.
4. Still open from earlier cycles: see the 2026-09-24 report's follow-ups.
