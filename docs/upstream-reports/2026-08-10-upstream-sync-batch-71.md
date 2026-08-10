# Upstream Sync Report — 2026-08-10 (batch 71, second cycle of the day)

## Summary

- **Upstream commits pulled**: 3 (`35c2a90fcac..0ff47f41785`, batch 71) — all mobile-only
- **Fork commits synced**: 1 (#968)
- **Conflicts resolved**: 1
- **Fork-side repairs**: 1 (a zero-conflict semantic break, new shape — see below)
- **Risk level**: LOW
- **Recommendation**: PROCEED

Second cycle on 2026-08-10. The earlier cycle landed batches 67–71 up to `35c2a90fcac`; upstream
added three more commits during the day. The branch is again **level with `upstream/main`** and
remains **off `main`** (newest upstream tag is still `v3.1.0`, so the standing landing rule is unmet).

## Incoming Upstream Changes

| SHA           | Summary                                                               | Area      | Risk to Fork | Notes                                                                                                                                       |
| ------------- | --------------------------------------------------------------------- | --------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `c52bf9995bf` | chore: pump flutter to 3.44.9 (#30658)                                | toolchain | MEDIUM       | Pin 3.44.8 → 3.44.9 in `mobile/mise.toml`, `pubspec.yaml`, `pubspec.lock`, `mise.lock`. Conflicts with the fork's own `pubspec.yaml` region |
| `9862e50aab9` | fix(mobile): decode remote thumbnails at displayed size (#29965)      | mobile    | MEDIUM       | Threads a decode-size hint through the image pipeline; renames `Thumbnail.remote(size:)` → `decodeSize:`                                    |
| `0ff47f41785` | fix(mobile): don't let a frozen sync block syncing on resume (#29870) | mobile    | MEDIUM       | Adds `cancelResumeSyncs()`; inserts into `_handleAppResume`, which the fork restructured in #513                                            |

### Per-file fork divergence (computed before judging risk)

Of the **27** files the batch touches, only **6** carry any fork divergence:

| Lines diverged | File                                                                |
| -------------- | ------------------------------------------------------------------- |
| 77             | `mobile/lib/providers/app_life_cycle.provider.dart`                 |
| 54             | `mobile/lib/presentation/widgets/timeline/fixed/segment.model.dart` |
| 44             | `mobile/lib/domain/utils/background_sync.dart`                      |
| 24             | `mobile/mise.toml`                                                  |
| 22             | `mobile/pubspec.yaml`                                               |
| 17             | `mobile/pubspec.lock`                                               |

The remaining 21 — every Kotlin/Swift/pigeon file, all the image-loader internals, `mise.lock`,
`constants.dart`, `asset_viewer.provider.dart` — have **zero** divergence and therefore could not
conflict. This is the fourth consecutive cycle where computing divergence per touched file turned a
scary-looking batch ("27 files, native code, an image-pipeline refactor") into an accurate, small one.

### Product-direction gate

**Did not fire.** #30658 is toolchain. #29965 is a performance fix to upstream's own image pipeline.
#29870 is the only one adjacent to a fork product surface (the fork owns a deferred-sync restructure
in `_handleAppResume` from #513, plus the #663/#892 iOS-resume history), but it introduces no new sync
contract or competing model — it adds a cancellation safety net on upstream's own task slots that
composes with the fork's wrapper. Verified semantically rather than assumed; see below.

### Zero-conflict semantic-break sweep (pre-rebase)

| Candidate                                                                   | Verdict                                                                                                                                                                                                              |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Thumbnail.remote()` renames `size:` → `decodeSize:` (and `Size` → `Size?`) | **Inert.** All 8 call sites checked (3 fork-only: Space albums page, space link-album page, space albums shelf); **none** passes `size:`                                                                             |
| `syncRemote()` / `syncLocal()` signatures                                   | **Unchanged**, so the fork-only hand-written `_FakeBackgroundSyncManager extends BackgroundSyncManager` still compiles. `cancelResumeSyncs()` is additive on a _concrete_ class, so subclasses need not implement it |
| URL-literal silent-no-op detector (branding `sed` rewrites)                 | **Clean** — no removed literal is still literal-matched by fork tooling                                                                                                                                              |
| Renamed types (the mocktail blind spot)                                     | None in this batch                                                                                                                                                                                                   |

One break was **not** caught by this sweep and only surfaced at `flutter test` — a new shape, documented
under Inconsistencies.

## Conflict Resolutions

### Conflict: `mobile/lib/presentation/widgets/timeline/fixed/segment.model.dart`

- **Fork side** (#886, view-in-timeline landing): wraps `ThumbnailTile` in a `Stack` with an
  `AnimatedOpacity` highlight border, and adds the `highlighted_asset.provider` import.
- **Upstream side** (#29965): adds a **required** `size` field to `_AssetTileWidget`, moves the
  `children` list _below_ the `widths` computation so it can read `widths[i]`, computes
  `remoteSize = size * devicePixelRatio`, and threads it into both `_handleOnTap(...)` and
  `ThumbnailTile(remoteSize:)`.
- **Resolution**: reconstructed from `git show HEAD:<path>` — first verified byte-identical to
  upstream's tip — then applied #886's two edits on top. Conflict markers were **not** parsed.
- **Verification**: `diff <upstream tip> <resolved>` returns _exactly_ #886's two edits, with
  upstream's `remoteSize: remoteSize` preserved inside the new `Stack`; brace/paren/bracket counts
  balanced; zero markers. `dart analyze --fatal-infos` clean afterwards.
- **Risk**: LOW. The failure mode avoided here is real: keeping the fork's side wholesale would have
  left `_AssetTileWidget` constructed without its now-required `size:`.

### Clean merges whose _both halves_ were verified

- `mobile/lib/providers/app_life_cycle.provider.dart` — upstream's `unawaited(backgroundManager.cancelResumeSyncs())`
  landed in the right place (after `backgroundManager`, before `isAlbumLinkedSyncEnable`) **and** the
  fork's #513 `syncRemoteThenLocal` / `deferredLocalSync` restructure is intact.
- `mobile/lib/domain/utils/background_sync.dart` — upstream's `cancelResumeSyncs` / `_cancelAll` /
  `_resumeSyncTasks` landed **and** the fork's `RemoteThenLocalSync` class, `SyncDelay` typedef and
  `syncRemoteThenLocal()` survive.
- `mobile/pubspec.yaml` — took upstream's `flutter: 3.44.9` while keeping the fork's `version: 1.0.0+1`
  and `background_downloader: ^9.5.7`.

**Semantic verification of the #29870 / #513 composition.** Upstream's inline comment asserts
"cancelResumeSyncs clears the task refs synchronously, so the syncs below see a clean slate". The
fork calls it via `unawaited(...)`, so that claim is load-bearing here. Reading the implementation
confirms `cancelResumeSyncs()` nulls `_syncTask`, `_deviceAlbumSyncTask`, `_hashTask` and
`_linkedAlbumSyncTask` **before its first `await`**, so the fork's `syncRemoteThenLocal()` on the very
next line does start from a clean slate. The four cancelled slots also cover both halves of the fork's
wrapper (`syncRemote` → `_syncTask`, `syncLocal` → `_deviceAlbumSyncTask`). The fix composes correctly.

## Fork Feature Verification

| Feature                                                           | Status | Notes                                                                                                                                                                                     |
| ----------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared Spaces                                                     | OK     | Audit's fork-owned-file and symbol survival checks pass                                                                                                                                   |
| Storage Migration                                                 | OK     | Untouched — server delta this cycle is empty                                                                                                                                              |
| Pet Detection                                                     | OK     | Untouched — ML delta this cycle is empty                                                                                                                                                  |
| Image Editing                                                     | OK     | Untouched                                                                                                                                                                                 |
| Branding                                                          | OK     | All fork logo assets intact; no i18n keys added or reworded, so no new `branding/i18n/overrides-*.json` entry needed                                                                      |
| Google Photos Import                                              | OK     | Untouched                                                                                                                                                                                 |
| Search V3 coexistence                                             | OK     | The only two `searchAssetBuilder(` sites are inside the dormant `searchMetadataV3` / `searchStatisticsV3`, under the `UPSTREAM SEARCH V3 — DORMANT` banner. No fork call site was rebound |
| Mobile action-model divergence #1 (`similar_photos.action.dart`)  | OK     | Still routes to `photosFilterProvider` + `MainTimelineRoute`                                                                                                                              |
| Mobile action-model divergence #2 (remove-from-album space nudge) | OK     | See skill-staleness note below                                                                                                                                                            |
| Mobile action-model divergence #3 (`viewAssetInTimeline`)         | OK     | `view_in_timeline_action.dart` present; `removeFromSpace` still resolves via `_getRemoteIdsForSource`                                                                                     |

## CI and Infrastructure Verification

| Check                                          | Status | Notes                                                     |
| ---------------------------------------------- | ------ | --------------------------------------------------------- |
| Fork-only workflows present (15 checked)       | OK     | None missing                                              |
| `PUSH_O_MATIC` / `create-workflow-token` leaks | OK     | None outside `merge-translations.yml`                     |
| Docker image references                        | OK     | `ci-invariants-check`: gallery-release-image-names passed |
| Upstream docs deploy stays dispatch-only       | OK     | `ci-invariants-check` passed                              |
| `@immich/ui` patch metadata                    | OK     | `fork-patches-check` passed                               |
| `mise.lock` / `mobile/mise.lock` churn         | OK     | Clean at commit time — see the trap note below            |

## Database Migration Analysis

No new upstream migrations in this batch (mobile-only).

- Gallery migration count: **49** (expected 49)
- Timestamp collisions: **NONE**
- Postbuild merge + `CompositeMigrationProvider`: intact
- `revert-to-immich.sql` coverage detector: **no `MISSING` entries** (88 tagged-upstream migrations at `v3.1.0` compared)

## Mobile Drift Migration Analysis

`make mobile-drift-rebase-check BATCH=71` → OK: schemaVersion, snapshots and Gallery callbacks
consistent. No upstream Drift migration in this batch, so no renumbering was required.

## Inconsistencies Found

### A zero-conflict semantic break of a NEW shape: an upstream test hard-coding a value derived from a fork-owned asset

Upstream's #29965 added `mobile/test/infrastructure/loaders/remote_image_request_test.dart`, whose
`preserves cover quality for extreme aspect ratios` case asserts:

```dart
final image = await loadEncoded('assets/immich-logo-inline-light.png', const ui.Size.square(320));
expect(image.width, 1311);
```

`loadEncoded` cover-fits the source to the box, so the decoded width is `320 × aspectRatio` — a value
derived entirely from **whichever artwork ships at that path**:

|                                       | Dimensions | Aspect  | Width at height 320 |
| ------------------------------------- | ---------- | ------- | ------------------- |
| upstream                              | 3038 × 742 | ~4.09:1 | 1311                |
| fork (Gallery camera mark, #327/#494) | 984 × 328  | 3.0:1   | **960**             |

The test failed with `Expected: <1311> Actual: <960>`.

**This is neither a bad resolution nor an upstream bug.** `remote_image_request_test.dart`,
`remote_image_request.dart` and `image_request.dart` are all **byte-identical to `upstream/main`**
(verified with `git diff upstream/main HEAD -- <path>` → 0 lines each). The coupling runs the other
way from the usual case: normally the fork depends on an upstream value by literal reference; here
**upstream depends on an asset the fork owns**. Nothing conflicts, no compiler or analyzer sees it,
and no audit covers it — only running the suite does.

**Fix**: `e105294c490` sets the expectation to 960 with a comment recording the cause, upstream's
value, and how to re-derive it (`320 * width / height`) if branding swaps the logo again.

**Generalised detector** (run per batch, alongside the URL-literal one): take the assets the fork
replaces and grep them against test files.

```bash
git diff --name-only upstream/main HEAD -- 'mobile/assets/**' 'web/static/**' 'web/src/lib/assets/**' \
| while read -r a; do
    base=${a##*/}
    hits=$(grep -rl "$base" mobile/test web/src \
      --include='*_test.dart' --include='*.spec.ts' --include='*.spec.svelte.ts' 2>/dev/null)
    [ -n "$hits" ] && { echo "COUPLED: $a"; echo "$hits" | sed 's/^/    /'; }
  done
```

Run against this tree it reports exactly three couplings: the logo above, plus
`web/static/gallery-loader{,-dark}.svg` → `LoadingSpinner.spec.ts`. The latter is **fork-internal**
(both the asset and the spec are fork-only), so the fork controls both sides and it is not a hazard.
Only cross-ownership pairs — an upstream-owned test reading a fork-replaced asset — matter.

### Skill/table staleness corrected

The skill's mobile standing-divergence #2 says `ActionNotifier.removeFromAlbum` "fires
`_nudgeSpaceSyncIfLinked`" in `action.provider.dart`. Grepping that private name now returns only a
_comment_, which reads like a lost fork behaviour. It is not: the nudge was extracted into a shared
helper `mobile/lib/providers/infrastructure/space_album_sync_nudge.dart` and made **public**
(`nudgeSpaceSyncIfLinked`), still invoked at two sites in `action.provider.dart`. The behaviour is
intact; only the documented symbol name is stale. `action.provider.dart` / `action.service.dart` were
untouched by this cycle, confirming this is pre-existing state rather than a rebase casualty.

## Pattern Propagation

No broad architectural refactor in this batch. The Flutter 3.44.8 → 3.44.9 bump is a patch-level
toolchain move requiring no fork-side propagation: `dart analyze --fatal-infos` is clean and the
format gate reports 0 changed files across 828.

`AGENTS.md` (symlinked as `CLAUDE.md`) documented the pin as 3.44.8 in three places on one line; it
has been updated to 3.44.9 in the same commit as the report, since a stale pin there sends the next
session to the wrong local toolchain.

## Local CI Verification

Server, machine-learning, CLI and e2e were **provably untouched** this cycle —
`git diff --stat pre-batch71-backup HEAD -- . ':(exclude)mobile' ':(exclude)web'` is empty — so their
suites were not run, and the gate was scoped to web (for #968) and mobile (for the batch).

| Check                                | Status  | Notes                                                                                                                                          |
| ------------------------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `web check:typescript`               | PASS    |                                                                                                                                                |
| `web check:svelte`                   | PASS    | 586 files, 0 errors, 0 warnings (585 last cycle; #968 adds a stub)                                                                             |
| web eslint (`tscompat` off)          | PASS    | 0 errors. 13 warnings, all "unused eslint-disable directive (tscompat)" — an artifact of the local `--rule` override; CI runs the rule enabled |
| Web unit tests                       | PASS    | 4350 passed, 2 skipped, 8 todo (4345 last cycle; #968 adds map-page specs)                                                                     |
| Mobile codegen                       | PASS    | build_runner (222 outputs) + pigeon + translations + drift schema (37 files)                                                                   |
| `dart analyze --fatal-infos`         | PASS    | No issues found                                                                                                                                |
| `dart format` (CI's lib-only scope)  | PASS    | 828 files, 0 changed                                                                                                                           |
| Mobile unit tests                    | PASS    | 3188 passed, 1 skipped (3179 last cycle; upstream added tests in #29965/#29870)                                                                |
| `upstream-postrebase-audit BATCH=71` | PASS    | 7/7 checks OK                                                                                                                                  |
| `mobile-drift-rebase-check BATCH=71` | PASS    |                                                                                                                                                |
| `fork-patches-check`                 | PASS    |                                                                                                                                                |
| `ci-invariants-check`                | PASS    | 3/3                                                                                                                                            |
| `make sql` / `make open-api`         | SKIPPED | No repository, controller or DTO changed; audit's Generated Artifact Review reports nothing to review                                          |

### Toolchain trap hit again this cycle

Running `mise install` for the new Flutter pin **rewrote both lockfiles in place**, stripping
platform blocks (`mise.lock` −46, `mobile/mise.lock` −58). It surfaced as
`error: cannot rebase: You have unstaged changes` rather than as a CI failure, which is the lucky
outcome — left in, every job dies at `mise install --locked`. Restored with
`git checkout HEAD -- mise.lock mobile/mise.lock`. All subsequent mobile work invoked the pinned
binaries directly (`~/.local/share/mise/installs/aqua-flutter-flutter/3.44.9/flutter/bin/{flutter,dart}`)
rather than `mise run`, and the tree stayed clean.

## Remote CI Verification

- **Test branch**: `rebase/upstream-batch-71`
- **Commit validated**: _(filled in after dispatch)_

| Workflow                                  | Status | Notes |
| ----------------------------------------- | ------ | ----- |
| `test.yml`                                |        |       |
| `docker.yml`                              |        |       |
| `static_analysis.yml`                     |        |       |
| `gallery-build-mobile.yml`                |        |       |
| `gallery-rebase-smoke.yml`                |        |       |
| `storage-migration-tests.yml`             |        |       |
| `storage-migration-e2e.yml`               |        |       |
| `gallery-revert-to-immich-validation.yml` |        |       |
| `gallery-ml-smoke.yml`                    |        |       |
| `gallery-mobile-smoke.yml`                |        |       |

Dispatched in staggered waves (4 / 2 / 4) — dispatching all ten at once has twice produced GHCR
`toomanyrequests` failures during image pulls.

## Post-Rebase Verification

- Fork commits ahead of upstream: 1129
- Commits behind upstream: **0**
- Fork diff looks clean: YES
- On `main`: **NO** — newest upstream tag is still `v3.1.0`, so the standing landing rule
  (tagged release **and** a thoroughly tested tagged state) remains unmet. The branch stays off `main`.
