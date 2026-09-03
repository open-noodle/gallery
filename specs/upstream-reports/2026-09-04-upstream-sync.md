# Upstream Sync Report — 2026-09-04

## Summary

- **Upstream commits pulled**: 8 (`da8131d5c2e..2e7365f16b2`), batches 219–222
- **Fork commits synced from `origin/main`**: 7 (`d44f0d2dece..1f5e270bd14`)
- **Conflicts resolved**: 13 upstream-replay conflicts (26 hunks) + 20 fork-sync conflicts
- **CI rounds**: 2 (round 1 exposed five fork-sync/toolchain failures; all fixed)
- **Risk level**: MEDIUM — two zero-conflict semantic breaks and one rolling-only re-key collision, all found and fixed locally
- **Recommendation**: PROCEED — 10/10 CI green on `2be00fc43b7`
- **Landing on `main`**: NO. Upstream's latest final tag is still `v3.1.0`; `v3.2.0-rc.0/1/2` are pre-releases. The standing rule needs a real tag plus real-data validation, so the branch stays off `main`.

## Incoming Upstream Changes

| SHA           | Summary                                             | Area   | Risk to Fork | Notes                                                                              |
| ------------- | --------------------------------------------------- | ------ | ------------ | ---------------------------------------------------------------------------------- |
| `399217bf5fb` | fix: face detection of edited assets (immich-31240) | server | MEDIUM       | Re-shapes `getForDetectFacesJob` `files[]` → `previewFile`; fork extends this repo |
| `6d85f202f4e` | fix(mobile): new OpenAPI int in RotateParameters    | mobile | LOW          | Fork image-editing surface; mechanical                                             |
| `d77261e7422` | chore(ci): run mobile jobs when OpenAPI defs change | CI     | LOW          | Adds `open-api/**` path filter; all three fork-patched workflows took it           |
| `8e04e6e2c6a` | fix(mobile): prevent inner mutability on Freezed    | mobile | MEDIUM       | Touches two files the fork **deleted** (#654, #473) → delete/modify conflicts      |
| `040ae6bc0ee` | fix(web): partner sharing timeline (immich-31241)   | web    | **HIGH**     | Adds a scope-enumerating live-event guard that omits the fork's Space scopes       |
| `8fbddc8f3ae` | fix(mobile): timeline scroll velocity placeholders  | mobile | **HIGH**     | Deletes `TimelineState.isScrubbing`/`setScrubbing`, which fork-only code calls     |
| `743770c8ab9` | feat: new FAQ entries                               | docs   | NONE         | —                                                                                  |
| `2e7365f16b2` | fix(ml): openvino config devices/volumes            | ML     | NONE         | `docker/hwaccel.ml.yml` only                                                       |

### Product-direction gate

Applied per batch. **It did not fire.** `040ae6bc0ee` carries "partner sharing" in its subject, which is a
trigger word, but the diff is a websocket-scoping bugfix that _aligns with_ the fork's own scoping needs
rather than reworking a sharing model. No commit introduces a new access model, sync contract, or first-class
entity, and none duplicates a fork feature.

### Pre-rebase detectors

| Detector                                        | Result                                                      |
| ----------------------------------------------- | ----------------------------------------------------------- |
| Deleted-literal → fork literal-matching tooling | clean (no URL literals removed)                             |
| i18n branding-override gap                      | clean (batch touched no `i18n/`)                            |
| Shape I — upstream adds a file at a fork path   | clean (batch adds no files)                                 |
| Shape I — upstream renames onto a fork path     | clean (batch renames nothing)                               |
| Zero-byte tracked files                         | 3, all pre-existing and byte-identical at the pre-cycle tip |
| Duplicate-content (two `main()` in a Dart file) | clean                                                       |

## High-Risk Changes (detailed analysis)

### `8fbddc8f3ae` — `setScrubbing` deleted out from under fork-only code

Upstream replaced `TimelineState { isScrubbing, isScrolling }` with `{ isScrolling, recommendDeferredLoading }`
and deleted `setScrubbing`, moving programmatic-scroll deferral onto automatic velocity tracking
(`_onScrollVelocityNotification`). Upstream removed its own `setScrubbing` calls in the same commit.

The fork's timeline zoom-anchor path (`_scheduleZoomAnchorResolution`) and its scroll-drain rewrite (#886)
both call it. Some sites conflicted; **two did not** — they sit in fork-only code upstream never touched, so
they would have merged clean and failed only at `dart analyze`.

**Resolution**: mapped `setScrubbing` → `setRecommendDeferredLoading`, the direct replacement with identical
effect on `isInteracting`. Where upstream's own canonical form dropped the flag entirely (`_scrollToDate`,
`_scrollToTop`), the fork now matches it. Verified: zero `setScrubbing`/`isScrubbing` references remain in
tracked mobile sources.

### `040ae6bc0ee` — a scope guard that enumerates only upstream's scopes

Upstream added `canInsertAssetFromLiveEvent`, gating websocket inserts on
`albumId | personId | timelineAlbumId` plus an owner check. Gallery also scopes timelines by `spaceId` and
`timelineSpaceId`. The commit merged with **zero conflicts**, so nothing flagged that a Space album timeline
could still take live socket assets it should not show — the same bug upstream had just fixed for its own
album timelines.

**Resolution**: added both fork scopes to the guard, plus two cases in upstream's own
`live event asset insertion` describe. Both were **proved red** against upstream's unmodified guard before
being kept.

### `399217bf5fb` — generated artifact review

The post-rebase audit raised its usual `ISSUE: Generated Artifact Review` on
`server/src/queries/asset.job.repository.sql`. Reviewed rather than waved off: the regenerated
`getForDetectFacesJob` block is **byte-identical to upstream's**, so the artifact is correct and the ISSUE is
informational this time.

## Conflict Resolutions

### Batch 219 — 4 conflicts, all in `server/test/medium/specs/services/person.service.spec.ts`

| Fork commit                                                | Kind        | Resolution                                                                            |
| ---------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------- |
| `da86b8194bc` link merged person faces to identity         | import      | Union of the `src/enum` named imports                                                 |
| `7908a03e304` cover face detection identity safety (#601)  | import      | Fork side (a strict superset of HEAD)                                                 |
| `d5693151303` one merge policy for every merge path (#733) | DI list     | Union: upstream's `MachineLearningRepository` + the fork's `SystemMetadataRepository` |
| `4dc938291bb` three raw-SQL and RBAC bugs                  | **Shape K** | See below                                                                             |

**Shape K detail (risk: HIGH, caught)**: `ours` held upstream's _new_ `handleDetectFaces` describe **plus**
the two cluster-group tests the fork deliberately deletes; `theirs` replaced those tests with the Option-M
comment. Taking either side alone loses content — `ours` resurrects deleted tests, `theirs` drops upstream's
new one. Line-based alignment proved `ours = upstream's 32 new lines + base`, so the resolution is upstream's
addition followed by the fork's deletion. Verified: the new describe is present, the cluster-group tests are
gone, the Option-M comment stands.

### Batch 220 — 0 conflicts

CI paths change only. Verified all three fork-patched workflows carry the new `open-api/**` filter.

### Batch 221 — 9 conflicts

| File                                                         | Fork commit                      | Resolution                                                                                     |
| ------------------------------------------------------------ | -------------------------------- | ---------------------------------------------------------------------------------------------- |
| `timeline.widget.dart`                                       | `7e4216b1450` (#313)             | Import union; both imports confirmed used                                                      |
| `timeline.widget.dart`                                       | `f6bed2f5807` (#643)             | Fork's scroll-drain design kept, `setScrubbing` plumbing dropped per upstream's canonical form |
| `scrubber.widget.dart`                                       | `a8fbd5a5175` (#625)             | Union of deletions (upstream: `debounce`; fork: `intl`) + the fork's symbol renames            |
| `timeline.widget.dart`                                       | `85b55ac3d8b` (#681)             | Fork's deletions + upstream's new velocity handler                                             |
| `timeline.widget.dart`                                       | `293142ef714` (v3.0.2 reconcile) | Both methods kept; `setScrubbing` stripped                                                     |
| `timeline.widget.dart`                                       | `72b7d4562f1` (lint rules)       | Fork's `unawaited()` wrapper kept (safe under `discarded_futures`), `setScrubbing` dropped     |
| `timeline.widget.dart`                                       | `c58210503c6` (#886)             | Fork's rewrite (`ours` was stale — `targetOffset` is already computed above); flag re-mapped   |
| `mobile/lib/widgets/search/search_filter/people_picker.dart` | `60a11bd518e` (#473)             | modify/delete → **deletion kept** (`git rm`, never `checkout --theirs`)                        |
| `mobile/lib/presentation/pages/search/search.page.dart`      | `1db146e613e`                    | modify/delete → **deletion kept**; the fork removed its mobile search page in #654             |

Both deleted paths re-verified absent at the final tip.

### Batch 222 — 0 conflicts

### Fork sync — `d44f0d2dece..1f5e270bd14` (7 commits)

`make upstream-sync-fork-main` **threw on the first cherry-pick** and did not roll back, so the batch was
completed by hand commit-by-commit and `integratedForkHead` advanced manually, as the skill allows. The
throw is not a script fault: the fork commits were authored against `main`'s `asset_face.personId`, which
rolling re-keyed to `personGroupId` in batches 200–203.

| Commit            | Conflicts                                        | Resolution                                                                                        |
| ----------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| #1063             | 4 × `mobile/openapi/**` (DU), 3 × server content | openapi artifacts stay deleted (untracked on rolling); server = fork's photo-context + the re-key |
| #1054             | 9 deletions + 2 content                          | Deletions honoured (the commit removes BrowseContent, five strips, StripScaffold, DragHandle)     |
| #1058/#1055/#1057 | none                                             | clean                                                                                             |
| #1053             | 10 × i18n, 3 × mobile, 2 × server, 1 × web, 2 DU | See below                                                                                         |
| #1059             | 3 × server                                       | Import unions + the re-key                                                                        |

**#1053 detail.** It renames `recent_trip_*` → `memory_recent_trip_*` and adds ~30 memory keys across all ten
locales, and moves the title builders into new modules on both clients.

- **i18n (10 files)**: took the fork's keys, dropped `memory_filter_all`/`memory_filter_saved` (rolling
  removed that UI in an earlier cycle), and kept rolling's own translation values where they differed
  (`it.recently_added`). All ten validated as parseable and alphabetically sorted.
- **`memory-index-utils.{ts,spec.ts}`** (DU): kept deleted. Rolling replaced the fork's historic-memories
  index with upstream's newer `memoryManager`-based page in an earlier cycle; the module does not exist here.
- **Mobile**: the new `memory_card_text.dart` imports `extensions/translate_extensions.dart`, which
  **upstream deleted** (immich-30672, typed-accessor migration). The util needs a _dynamic_ key lookup that
  the typed accessor cannot express, so the deleted helper was inlined over `easy_localization`'s `tr()` +
  `intl`'s `MessageFormat`, **including its try/catch key fallback** — the fork's own test asserts that
  fallback with no localization in the tree. `DriftMemory` → `Memory` throughout (immich-31038 rename).
- **Web**: `getMemoryTitle`/`getMemorySubtitle` moved to `$lib/utils/memory-card` with a re-export left in
  `$lib/utils`, so rolling's importers keep working. Rolling's already-absent `downloadManager` import was
  not re-added.

## Fork Feature Verification

| Feature               | Status | Notes                                                                          |
| --------------------- | ------ | ------------------------------------------------------------------------------ |
| Shared Spaces         | OK     | Live-event guard now covers `spaceId`/`timelineSpaceId`; two new tests pin it  |
| Storage Migration     | OK     | Untouched                                                                      |
| Pet Detection         | OK     | `getForPetDetection` query block survived the `asset.job.repository.sql` regen |
| Image Editing         | OK     | `RotateParameters` int change absorbed; `dart analyze` clean                   |
| Branding              | OK     | i18n override gate clean; no upstream-name leaks                               |
| Google Photos Import  | OK     | Untouched                                                                      |
| Face repair / cleanup | OK     | Photo-context feature reconciled onto the `personGroupId` re-key               |
| Memories (rules)      | OK     | Overlap reservation + localized titles landed; medium spec re-keyed            |
| Mobile filter sheet   | OK     | Half-height snap removed as #1054 intends; strips and their tests deleted      |

## CI and Infrastructure Verification

| Check                                     | Status | Notes                                                 |
| ----------------------------------------- | ------ | ----------------------------------------------------- |
| Workflow files (no upstream collisions)   | OK     | Only the `open-api/**` path filter added              |
| Docker image references (`gallery-*`)     | OK     | `ci-invariants-check` green                           |
| Branding (no "Immich" leaks)              | OK     | i18n override detector clean                          |
| Fork CI modifications intact              | OK     | `fork-patches-check` green                            |
| `.github` prettier                        | OK     | Its own gate, run separately                          |
| Commit-message autolinks                  | OK     | 1426 messages scanned, none cross-repo                |
| `revert-to-immich.sql` migration coverage | OK     | No new migrations this cycle; detector prints nothing |

## Database Migration Analysis

No migrations were added or changed this cycle, by upstream or by the fork sync.

- Gallery migration count: **62 (expected 62)**
- Timestamp collisions: **NONE**
- `postbuild` sync intact: **YES** — "Synced 62 Gallery migrations … wrote 1 compatibility aliases"
- `CompositeMigrationProvider` intact: **YES**

## Mobile Drift Migration Analysis

No mobile schema change. `mobile-drift-rebase-check` green at batches 219 and 222: `schemaVersion`,
snapshots and Gallery callbacks all consistent. No renumbering was needed, so no release-safety question
arises.

## Inconsistencies Found

1. **`setScrubbing` deleted, fork-only callers left behind** — fixed (`bee92502d33`).
2. **Live-event guard missing the fork's Space scopes** — fixed with proved-red tests (`bee92502d33`).
3. **Fork sync vs the `personGroupId` re-key** — 20 sites across server sources, medium specs and one e2e
   spec; every one fixed to the established idiom of its own file (`286a9ddb1b8`).
4. **`memories-page.spec.ts` asserted a renamed i18n key** — a rolling-only spec that #1053's rename
   invalidated; updated to `memory_recent_trip_subtitle` (`286a9ddb1b8`).
5. **`filter_sheet.widget.dart` tripped rolling's stricter Dart lints** — four unbraced control bodies
   (`always_put_control_body_on_new_line`) and one discarded `sendAnnouncement` future
   (`discarded_futures`). `main` does not enable these, so #1054 came across clean. Fixed
   (`8da30d2c2da`), along with two infos the same sync surfaced: a now-noop `.round()` on
   immich-31246's `int` rotation, and a null-aware element in the new util's test.
6. **Two fork `handleDetectFaces` unit tests encoded the guard immich-31240 removed** — one asserted
   that two preview files FAIL detection (now the supported edited-asset case), the other fed the raw
   factory asset past the reshaped mapper. Fixed (`8a87a400dab`).
7. **`web/src/lib/utils.ts` kept an unused luxon `DateTime` import** after #1053 moved its only user to
   `$lib/utils/memory-card`. Lint Web runs `--max-warnings 0`, so this was a hard failure. Fixed
   (`2be00fc43b7`).
8. **A medium memory test disagreed with rolling's `isUpcoming` contract** — "keeps all three cards on a
   large library" expected 3 and got 6. Not a regression: `onMemoriesCreate` seeds `on_this_day` cards
   across a DAYS-wide window and three were still scheduled at the test's system time. `main`'s bare
   `{}` hid them implicitly; the fork adopted upstream's immich-28675 contract, where `GET /memories`
   scopes `showAt` only when asked. The test now asks for the shown cards (`2be00fc43b7`).
9. **`specs/2026-09-03-face-cleanup-photo-context-design.md` is not prettier-clean** — pre-existing: the same
   file fails identically on `origin/main`, and no CI job formats `specs/`. Left as-is rather than creating a
   pointless divergence from `main`.

## Pattern Propagation

No new broad architectural refactor arrived this cycle. The standing propagations (Search V3 dormant,
freezed deferred, mobile action model) are unchanged; `ci-invariants-check` confirms Search V3 is still
present and undispatched.

## Local CI Verification

**A process failure worth recording, because it cost a CI round.** Several gates were first run as
`<cmd> | tail -N`, so the exit code observed was `tail`'s, not the command's. `mise //mobile:analyze`
printed `ERROR task failed` and the server unit suite printed 2 failures, and both were read as green.
CI caught them. Every row below was subsequently re-run capturing the command's own exit status; that
is the only form worth trusting, and `| tail` must never be the last stage of a gate.

| Check                                                                      | Status | Notes                                                            |
| -------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------- |
| `server pnpm build` (+ postbuild sync)                                     | PASS   | 62 migrations synced, 1 compatibility alias                      |
| `server pnpm check` (tsc)                                                  | PASS   | 20 re-key errors found and fixed first                           |
| `server pnpm lint`                                                         | PASS   |                                                                  |
| web eslint (`tscompat` off)                                                | PASS   | 0 errors; 13 warnings, all the known false unused-directive ones |
| `server` medium tests (memory.service)                                     | PASS   | exit 0, 59/59 after the `isUpcoming` adaptation                  |
| `server prettier --check .`                                                | PASS   | 2 files reformatted after the fix                                |
| `server` unit tests                                                        | PASS   | exit 0, 6201 passed (2 obsolete detect-faces tests fixed first)  |
| `web check:typescript`                                                     | PASS   |                                                                  |
| `web check:svelte`                                                         | PASS   | 632 files, 0 errors (after the SDK rebuild)                      |
| `web` unit tests                                                           | PASS   | exit 0, 6108 passed; the stale i18n key was fixed first          |
| `e2e pnpm check`                                                           | PASS   | 2 re-key errors found and fixed first                            |
| `e2e pnpm lint` / prettier                                                 | PASS   |                                                                  |
| `mobile analyze` (`--fatal-infos`)                                         | PASS   | exit 0, "No issues found!" — 7 lint issues fixed first           |
| `mobile format`                                                            | PASS   | 862 files, 0 changed                                             |
| `mobile test`                                                              | PASS   | exit 0, 3476 passed                                              |
| `.github` prettier                                                         | PASS   |                                                                  |
| `i18n` prettier + JSON validity + sorting                                  | PASS   | all 10 locales                                                   |
| OpenAPI regeneration                                                       | PASS   | Spec already current; SDK rebuilt (stale build was the trap)     |
| SQL regeneration                                                           | PASS   | Only `memory`/`person` drifted, matching the two source edits    |
| `tools/upstream-preflight` vitest                                          | PASS   | 24 files, 257 tests                                              |
| Post-rebase audit / ci-invariants / fork-patches / mobile-drift / autolink | PASS   | all green                                                        |

## Remote CI Verification

- **Test branch**: `rebase/upstream-batch-222`
- **Round 1**: `5a9f56c9471` — 6/10 green. Five jobs failed, all of them the fork sync meeting rolling's
  newer toolchain: two Dart-analyze gates, Lint Web, the server unit suite and Medium Tests.
- **Round 2 (final)**: `2be00fc43b7`

| Workflow                         | Status | Notes                                                      |
| -------------------------------- | ------ | ---------------------------------------------------------- |
| `test.yml`                       | GREEN  | Medium Tests needed 2 re-runs — see the note below         |
| `docker.yml`                     | GREEN  | image builds                                               |
| `static_analysis.yml`            | GREEN  | was red in round 1 on the Dart lints                       |
| `gallery-build-mobile.yml`       | GREEN  | iOS + Android compile                                      |
| `gallery-mobile-smoke.yml`       | GREEN  | was red in round 1 on the same Dart lints                  |
| `gallery-ml-smoke.yml`           | GREEN  |                                                            |
| `gallery-rebase-smoke.yml`       | GREEN  |                                                            |
| `storage-migration-tests.yml`    | GREEN  |                                                            |
| `storage-migration-e2e.yml`      | GREEN  |                                                            |
| `gallery-revert-to-immich-*.yml` | GREEN  | including the Docker-boot half, not just the coverage grep |

**Failures fixed between rounds**: `8da30d2c2da` (Dart lints), `8a87a400dab` (obsolete detect-faces
tests), `2be00fc43b7` (unused import + the `isUpcoming` contract).

**Final state: 10/10 green** on `2be00fc43b7`.

### Medium Tests became intermittently red this cycle — worth a follow-up, not a shrug

After the one real Medium Tests defect was fixed, that job still failed **twice more, on a different set
each time**, and went green on the third:

| Attempt | Failed                                                                                                                        |
| ------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1       | `memory.service` › "keeps all three cards…" — **real**, the `isUpcoming` contract                                             |
| 2       | `face-repair.service` › "a declined face is not flagged on the next scan"                                                     |
| 3       | `shared-space-face-matching.spec.ts` (whole file, 47 skipped) + `memory.service` › "makes no further changes on a second run" |
| 4       | — green —                                                                                                                     |

Attempts 2–4 ran on **byte-identical code**. Every one of those specs passes locally in isolation
(`memory.service` 59/59 twice, `face-repair.service` 20/20, `shared-space-face-matching` 35/35), attempt
3's failure was a whole-file collection error rather than an assertion, and the logs carry
`duplicate key … face_repair_scan_in_flight_uq` contention noise. That is DB contention, not a
regression.

**But it is new, and this cycle plausibly caused it.** #1059 added an
`onMemoriesCreate — overlap reconciliation (end-to-end)` describe that did not exist at the pre-cycle tip
and seeds **750 assets across three tests** (30 / 600 / 120), running the whole memory pipeline — twice in
one of them. `main` at the same #1059 commit passed its own Test run, so this is rolling-specific: the
fork's medium suite is the larger one (169 files / 2894 tests), and the extra load tips it over on a
shared runner. Worth trimming those fixtures or isolating that describe before it costs another cycle.

## Post-Rebase Verification

- Fork commits ahead of upstream: **1427**
- Commits behind upstream: **0**
- Fork pending from `origin/main`: **0**
- Whole-tree diff vs the pre-cycle tip: 182 files, +8844/−2999. Every one of the 11 deletions is accounted
  for by fork #1054's removal of the half-height snap; the only other net deletion is upstream's own 34-line
  cut in `scrubber.widget.dart`.
- Fork diff looks clean: **YES**
