# Upstream Sync Report — 2026-09-08 (batches 226–228)

## Summary

- **Upstream commits pulled**: 11 (`4c7b30c18b5..df7494b49e3`), split into batches 226 / 227 / 228
- **Fork commits pulled**: 0 — `integratedForkHead` already equalled `origin/main` (`afe31a0c3a9`), so no fork sync ran
- **Conflicts resolved**: 18
- **Risk level**: MEDIUM — two mobile refactors (a dead-code sweep and a widget split) landed against heavily fork-diverged files
- **Recommendation**: PROCEED
- **Result**: 1472 commits ahead of `upstream/main`, **0 behind**

The cycle's one real defect was a **zero-conflict semantic break**: `immich-31280` deleted three
members that upstream no longer calls but the fork does. Nothing conflicted, all eight post-rebase
audits stayed green, and only `dart analyze --fatal-infos` saw it. Fixed in `0d6a6ff1668`.

## Incoming Upstream Changes

| SHA           | Summary                                                     | Area             | Risk to Fork | Notes                                                                                                    |
| ------------- | ----------------------------------------------------------- | ---------------- | ------------ | -------------------------------------------------------------------------------------------------------- |
| `bbd1e6d381a` | `x` → `×` in DetailPanel                                    | web              | LOW          | Fork does not diverge on that line                                                                       |
| `58fb1ed4a9d` | live photo transcode visibility (immich-31319)              | server           | LOW          | Drops the `visibility != Hidden` filter in `streamForVideoConversion`; no fork hunk overlaps that method |
| `3d3345fc18c` | mise docker tag → v2026.9.2                                 | docker           | LOW          | `server/Dockerfile*` only                                                                                |
| `cfa594717a8` | valkey digest → `c123e37`                                   | docker/e2e       | **MEDIUM**   | Collides with the fork's `ghcr.io` registry rewrite in `e2e/docker-compose.yml`                          |
| `4f503c4b6b7` | update typescript-projects (immich-30842)                   | deps             | LOW          | `server/package.json` + lockfile; auto-merged                                                            |
| `d7ae4ae1d04` | word-wrap long album names                                  | web              | LOW          | —                                                                                                        |
| `6b54cbff897` | docs: mobile dev setup step                                 | docs             | LOW          | —                                                                                                        |
| `95bfed15d2b` | RTL-friendly people panel buttons                           | web              | **MEDIUM**   | Same import block as the fork's branded-spinner swap                                                     |
| `1dedbe4c395` | pump Flutter to **3.47.2**                                  | mobile toolchain | **MEDIUM**   | Fork's `mobile/mise.toml` divergence is DCM/checklist tasks, not the version pin — no conflict           |
| `8d90cbeafc5` | **remove unused code** (immich-31280)                       | mobile           | **HIGH**     | −1195 lines across 65 files; deletes members only the fork still calls                                   |
| `df7494b49e3` | **split Timeline widget into smaller parts** (immich-31223) | mobile           | **HIGH**     | Splits a file the fork carries +286 fork-only lines in                                                   |

### Product-direction gate

**Not fired.** No commit reworks _where_ a feature is going: there is no sharing / access-model /
sync-contract / album-model change, and nothing overlaps Shared Spaces, RBAC, faces or the sync
streams. The two HIGH rows are technical risk (refactors against fork-diverged files), not product
collision, so all three batches were rebased without quarantine.

### Pre-rebase detectors (all clean)

| Detector                                                                               | Result                                                                           |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Deleted-literal / silent-noop (URLs vs `branding/scripts`, `tools`, `.github/actions`) | 4 deleted URLs, **0 hits**                                                       |
| Shape I — upstream _adds_ a path fork history touched                                  | 3 added files, **0 hits**                                                        |
| Shape I — upstream _renames_ onto a fork-touched path                                  | no renames in range                                                              |
| i18n branding-override gap                                                             | batch touches no `i18n/` file                                                    |
| New upstream migrations                                                                | none — `server/src/schema/` untouched, so `revert-to-immich.sql` needs no update |

`rerere` confirmed effectively **off** for the whole replay (`git config rerere.enabled` → `false`;
the repo-local `false` masks the global `true`).

## Conflict Resolutions

18 conflicts. The mechanical import-block ones are summarised at the end.

### Conflict: `web/src/lib/components/faces-page/PersonSidePanel.svelte` (batch 226)

- **Fork side**: drops `LoadingSpinner` from `@immich/ui` and imports the fork's branded spinner instead.
- **Upstream side**: adds `languageManager` and `mdiArrowRightThin` for the RTL back-arrow.
- **Resolution**: both — `@immich/ui` import without `LoadingSpinner`, `@mdi/js` with `mdiArrowRightThin`.
- **Risk**: LOW.
- **Verification**: `git diff <batch-tip> -- <file>` afterwards shows _only_ the branded-spinner swap, so every one of upstream's RTL/layout changes landed.

### Conflict: `e2e/docker-compose.yml` (batch 226)

- **Fork side**: `ghcr.io/valkey-io/valkey:9@sha256:70739f85…` (fork pulls e2e valkey from GHCR to dodge Docker Hub rate limits).
- **Upstream side**: bumps the digest to `c123e37…` on `docker.io/valkey/valkey:9`.
- **Resolution**: fork's registry **+** upstream's new digest.
- **Risk**: LOW — but only after verification, since a digest need not exist on both registries.
- **Verification**: authenticated HEAD against the GHCR manifest for that digest returned **HTTP 200**, so the mirror carries it. Confirmed the fork's rewrite stays e2e-scoped: the four `docker/docker-compose*.yml` files correctly keep `docker.io`.

### Conflict: `mobile/lib/infrastructure/repositories/sync_stream.repository.dart` (batch 227) — the important one

- **Fork side**: `#752` extends `pruneAssets()` with the shared-space, space-album and library-reachable keep-arms (mobile-3/gaps-1 — without them a member's Drift DB keeps `remote_asset` + `remote_exif` forever after a purge, defeating the purge's privacy goal).
- **Upstream side**: **deletes `pruneAssets()` entirely** as unused.
- **Resolution**: **keep the fork's version.**
- **Risk**: HIGH if resolved the other way — a silent privacy regression with no test or audit to catch it.
- **Verification**: upstream's own call site is _commented out_ (`// return _syncStreamRepository.pruneAssets();`), which is why they consider it dead; the fork **un-commented it** — `sync_stream.service.dart:314` calls it live, and there is a fork test suite (`SyncStreamRepository - pruneAssets`, plus `syncCompleteV1 triggers pruneAssets (mobile-3)`). Re-verified post-rebase: method present, live caller intact, 12 shared-space arm references.

### Conflict: `mobile/lib/providers/asset_viewer/scroll_to_date_notifier.provider.dart` (batch 227) — modify/delete

- **Fork side**: `#643` modifies the file (+25 lines).
- **Upstream side**: deletes it.
- **Resolution**: **keep the fork's version at this commit.** The fork's own `#886` deletes the file later in the replay, so keeping it here leaves every intermediate commit coherent and still reaches the correct end state.
- **Risk**: MEDIUM — `git checkout --theirs` on a delete/modify writes a **zero-byte** file; explicitly checked the retained file was 1194 bytes with real content.
- **Verification**: at the final tip the file is **absent** and `scroll_to_date_notifier` / `scrollToDateNotifier` have **0** references anywhere in `mobile/` — the deferred deletion did replay.

### Conflict: `mobile/test/providers/app_life_cycle_provider_test.dart` (batch 227, twice)

- First at `#663` (which wraps the file in a `group(...)` and re-indents ~173 lines), then again at `#892` (which reverts that wrapper).
- **Upstream side** both times: a pure mechanical rename, `lifeCycle.getAppState()` → `lifeCycle.state` (3 sites).
- **Resolution**: **reconstructed rather than hand-merged** — took each fork commit's own version of the file and applied the rename with `sed`. Hand-merging the hunks was unsafe: the re-indentation made git align upstream's assertion tails against the fork's new test bodies (Shape K).
- **Risk**: LOW after reconstruction; HIGH if the misaligned hunks had been merged by eye.
- **Verification**: `#892`'s substantive delta over the pre-`#663` state is exactly one line (`backupProvider` → `driftBackupProvider`, correct since the test overrides it with a `TestDriftBackupNotifier`); a later replayed commit re-renames it to `backupProvider`, matching the fork tip.

### Conflict: `mobile/test/modules/extensions/builtin_extensions_test.dart` (batch 227)

- **Fork side**: a lint commit collapsing a multi-line `expect(...)` onto one line.
- **Upstream side**: **the identical collapse**, plus deletion of the `uniqueConsecutive` group whose extension methods it removed from `collection_extensions.dart`.
- **Resolution**: take **upstream's** file — the fork's intended line is byte-identical in it, and upstream's deletion must survive.
- **Risk**: LOW. **Verification**: the fork's exact `+` line is present; `uniqueConsecutive` count is 0.

### Conflict: `mobile/lib/data/db/main/database.dart` (batch 227, two regions)

- **Fork side**: adds `SpaceAlbumRepository` (import + `@DriftAccessor` registry entry).
- **Upstream side**: removes `StackRepository` (import + registry) — it deleted `stack.repository.dart` outright.
- **Resolution**: keep the fork's addition, take upstream's removal.
- **Verification**: `StackRepository` has **no fork consumer** — at the fork tip the only references were the two registry lines themselves.

### Conflict: `mobile/test/utils_legacy/action_button_utils_test.dart` (batch 227)

- **Fork side**: `#929` inserts a `group('view in timeline button', …)` immediately before the `group('ActionButtonBuilder', …)` that **upstream deletes** in the same batch.
- **Resolution**: applied the fork's 25-line block onto upstream's shortened file at the equivalent anchor (end of `main()`), preserving blank-line style.
- **Risk**: MEDIUM — the naive resolution would have re-introduced upstream's deleted group.

### Conflict: `mobile/lib/presentation/widgets/timeline/timeline.widget.dart` (batch 228, ×5)

All five were **import-block only**; upstream's split of the file body auto-merged with the fork's additions.

- **Resolution**: union of both sides at each region, keeping strict alphabetical order (which also pre-satisfied a later fork `directives_ordering` commit, whose only remaining delta — `widget.emptyWidget!` → `widget.emptyWidget` — applied cleanly).
- **Risk**: **HIGH, because the body merged silently** — exactly the Shape K shape.
- **Verification**: whole-file survival audit — of **286** fork-only lines present at the fork tip (fork tip vs pre-batch upstream), **0 are missing** from the rebased file.

### Mechanical import-block conflicts (upstream removed a now-unused import beside a fork addition)

`mobile/lib/presentation/widgets/map/map.state.dart`, `mobile/lib/providers/infrastructure/action.provider.dart`,
and `mobile/lib/repositories/asset_api.repository.dart` (where the fork's edit was a cosmetic
`return` → `await` on a method upstream deleted; **0 callers** in `mobile/lib` or `mobile/test` at the
fork tip, so upstream's deletion was taken). In each case the fork's new import was kept and
upstream's removal honoured, after confirming the dropped symbol is genuinely unused in the resolved file.

## Zero-conflict semantic break — `immich-31280` (the cycle's real finding)

`8d90cbeafc5` ("remove unused code") deleted three members with **zero conflicts**. Every post-rebase
audit, `pnpm build`, `tsc`, both web checks, server lint and both unit suites were green.
**Only `dart analyze --fatal-infos` saw it** (4 errors + 2 warnings).

| Deleted by upstream                           | Fork consumer                                                                                                                                                               | Resolution                                                                                                     |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `UserApiRepository.getAll()`                  | `space_member_selection.page.dart` (Space member picker fetches candidates straight from the API so a fresh login can add members before Drift is populated) + 2 fork tests | **Restored** as fork-owned, with a `gallery-fork:` comment                                                     |
| `PartnerApiRepository.getAll(Direction)`      | only `api_repository_lazy_resolution_test.dart`, which used it merely as _a method that touches `_api`_                                                                     | **Not restored** — retargeted the test to the surviving `delete()`; the lazy-resolution invariant is unchanged |
| `HapticNotifier.lightImpact()` / `.vibrate()` | the fork's hand-written `_NoOpHaptic` stub in `gallery_bottom_nav_test.dart`                                                                                                | **Dropped** the two dead `@override`s                                                                          |

Note the blind spot this confirms again: mocktail `Mock` classes absorb removals via `noSuchMethod`;
**only hand-written fakes break**, and only at compile time.

Fixed in `0d6a6ff1668`.

## Fork Feature Verification

| Feature                             | Status | Notes                                                                                                                           |
| ----------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Shared Spaces                       | OK     | `pruneAssets` space/album/library arms intact with live caller; `SpaceAlbumRepository` still registered; member picker restored |
| Storage Migration                   | OK     | tree byte-identical to the last CI-validated tip                                                                                |
| Pet Detection                       | OK     | `machine-learning/` byte-identical                                                                                              |
| Image Editing                       | OK     | no overlap in batch                                                                                                             |
| Branding                            | OK     | `branding/` byte-identical; branded spinner swap preserved in `PersonSidePanel`                                                 |
| Google Photos Import                | OK     | no overlap in batch                                                                                                             |
| Timeline grouping / overview (fork) | OK     | 286/286 fork-only lines survived upstream's widget split                                                                        |

## CI and Infrastructure Verification

| Check                                   | Status | Notes                                             |
| --------------------------------------- | ------ | ------------------------------------------------- |
| Workflow files (no upstream collisions) | OK     | `.github/` byte-identical to last validated tip   |
| Docker image references                 | OK     | e2e valkey stays on the fork's `ghcr.io` mirror   |
| Branding leaks                          | OK     | `branding/` unchanged; no i18n changes in batch   |
| Fork CI modifications intact            | OK     | `fork-patches-check`, `ci-invariants-check` green |
| Search V3 stays dormant                 | OK     | `search-v3-not-dispatched` invariant green        |

## Database Migration Analysis

No upstream migrations in this range — `git diff 4c7b30c18b5..df7494b49e3 -- server/src/schema/` is
empty. Gallery migration count **67 (expected 67)** at every batch; no timestamp collisions;
`revert-to-immich.sql` needs no new entries.

**Generated SQL was verified, not assumed.** Although no conflict touched `server/src/repositories/`,
upstream edited `asset-job.repository.ts` (a file the fork diverges in by +60/−20) and shipped a
regenerated `asset.job.repository.sql` that auto-merged. Regenerating against the CI-pinned Postgres
(`ghcr.io/immich-app/postgres:14-vectorchord0.4.3`, migrations applied via an explicit `DB_URL`, all
4 sentinel tables present) wrote 63 files / 724 queries and left
`git status -- server/src/queries/` **empty** — the merged SQL is exactly what the generator emits.

## Mobile Drift Migration Analysis

`mobile-drift-check` OK at batches 226, 227 and 228 — `schemaVersion`, snapshots and Gallery
callbacks consistent. `dart run drift_dev make-migrations` regenerated without refusing, and left
`mobile/drift_schemas/` and `mobile/lib/data/db/` clean (the Shape L detector).

## Inconsistencies Found

1. The `immich-31280` removals above (fixed).
2. `mobile/lib/data/db/main/database.drift.dart` still imported the deleted `stack.repository.dart` —
   **not a finding**: it is gitignored local codegen, regenerated by `build_runner`.
3. Three zero-byte tracked files (`CODEOWNERS`, `docs/static/.nojekyll`, `docs/static/CNAME`) —
   **pre-existing**, all three are 0 bytes at the pre-cycle tip too, so not a delete/modify artefact.

## Housekeeping

- **`(#1022)` subject suffix restored.** The rolling copy of `fix(revert): delete Gallery's own workflow plugin…` had lost its `(#1022)` suffix, which defeated both arms of `rolling-final-check`'s matcher. Reworded (patch-id `0beede5422b` unchanged on both sides; the resulting tree is byte-identical to the pre-reword tip). **`rolling-final-check` now passes** — the first fully clean gate chain in four cycles.
- `mise install` (needed for Flutter 3.47.2) rewrote **both** `mise.lock` files, stripping non-macOS platform blocks — the documented trap. Detected via `git status -- '*mise.lock'` and restored with `git checkout`; both files hash-verified back to their committed state.

## Local CI Verification

Scoped by tree identity against the last CI-validated tip (`0b3a04a9fc3`). **IDENTICAL** and therefore
not re-gated: `machine-learning`, `open-api`, `packages`, `i18n`, `.github`, `deployment`, `branding`.
**CHANGED** and gated: `server`, `web`, `docker`, `e2e`, `mobile`, `docs`.

| Check                                        | Status | Notes                                                               |
| -------------------------------------------- | ------ | ------------------------------------------------------------------- |
| `server pnpm build` (+ migration sync)       | PASS   | Synced 67 migrations, 2 compatibility aliases                       |
| `server pnpm check` (tsc)                    | PASS   |                                                                     |
| `server pnpm lint`                           | PASS   |                                                                     |
| Server unit tests                            | PASS   | 200 files, **6416 passed**, 12 skipped                              |
| `web check:typescript`                       | PASS   |                                                                     |
| `web check:svelte`                           | PASS   | 640 files, 0 errors, 0 warnings                                     |
| web eslint (`tscompat` off)                  | PASS   | 0 errors; 13 warnings are the known artefact of the override itself |
| Web unit tests                               | PASS   | 390 files, **6385 passed**                                          |
| `dart analyze --fatal-infos`                 | PASS   | after `0d6a6ff1668`; 6 issues before it                             |
| `dart format --set-exit-if-changed`          | PASS   |                                                                     |
| `flutter test` (Flutter **3.47.2**)          | PASS   | **3820 passed**, 1 skipped                                          |
| `tools/upstream-preflight` suite             | PASS   | 24 files, 257 tests                                                 |
| SQL regeneration drift                       | PASS   | 63 files / 724 queries, zero drift                                  |
| `docs` prettier                              | PASS   |                                                                     |
| `upstream-postrebase-audit` (226/227/228)    | PASS   | 8/8 checks each                                                     |
| `mobile-drift-rebase-check` (226/227/228)    | PASS   |                                                                     |
| `fork-patches-check` / `ci-invariants-check` | PASS   |                                                                     |
| `fork-ownership-coverage-check`              | PASS   | 3542 fork files covered                                             |
| `commit-autolink-check`                      | PASS   | 1472 messages, fork PR ceiling 1080                                 |
| `rolling-final-check`                        | PASS   |                                                                     |

E2E `pnpm check` not run: the only `e2e/` change is `docker-compose.yml`; no `e2e/src/` file changed.

## Remote CI Verification

_(filled in after dispatch — see the follow-up commit)_

## Post-Rebase Verification

- Fork commits ahead of upstream: **1472**
- Commits behind upstream: **0**
- Fork diff clean: YES
