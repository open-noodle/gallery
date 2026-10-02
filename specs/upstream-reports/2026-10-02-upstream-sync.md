# Upstream Sync Report — 2026-10-02

## Summary

- **Branch**: `rebase/upstream-rolling-v3.3.0` (continued; pre-cycle backup `backup/rolling-pre-2026-10-02` = `38f3e0336d0`)
- **Upstream source**: `upstream/release/v3.3` (unchanged since 2026-10-01)
- **Upstream commits pulled**: 18 (batches 75–81), `3af49d9b4fa` → **`20f103c4b99`** = `v3.3.0-rc.2`. 0 behind.
- **Fork synced**: nothing — `origin/main` (`da5480ae42b`) is still the integrated fork head.
- **Product-direction gate**: nothing quarantined. All 18 are fixes, two small web features, an OpenVINO upgrade,
  two dependency bumps and the rc.2 version bump. None reshapes a sharing, sync, person, album or access model.
- **Conflicts resolved**: 11 stops across 9 replayed fork commits (detail below)
- **Zero-conflict breaks found and fixed**: 2 (Shape D runner mapping, filename-sanitize fix missing from the
  fork's own definition) plus one self-inflicted dropped test, fixed forward
- **Risk level**: LOW-MEDIUM
- **Recommendation**: PROCEED — full local gates green; SQL docs and the base-image check rely on CI (no local Docker)

## Incoming Upstream Changes

| SHA           | Summary                                                        | Area    | Risk   | Notes                                                                                   |
| ------------- | -------------------------------------------------------------- | ------- | ------ | --------------------------------------------------------------------------------------- |
| `112c5e190f7` | alt names (immich-31987)                                       | web     | LOW    | fork does not render "also known as" — upstream delta inert, conflicts at #522/#625     |
| `882da7cab8b` | stale memory thumbnail (immich-31977)                          | web     | LOW    | clean                                                                                   |
| `843051f0f5b` | include album owner for album shared links (immich-31990)      | server  | MEDIUM | `owner` → `albumUsers`; merged into the fork's #1018 query, import conflict only        |
| `234cb6d19b1` | face thumbnail blank after renaming a person (immich-32001)    | mobile  | LOW    | clean                                                                                   |
| `cb5ea762272` | iOS background batch waits for its remote sync (immich-32003)  | mobile  | MEDIUM | clean; touches the backup provider the fork aligned with upstream in #892               |
| `20472b34dcc` | no foreground backup in iOS background launches (immich-32002) | mobile  | MEDIUM | conflicts at #513, #627, #892, #663 — see resolutions                                   |
| `b9b7ddb5695` | don't re-upload a photo the server already has (immich-32004)  | mobile  | LOW    | clean                                                                                   |
| `fcc5400e36c` | image jump during pinch/zoom (immich-32011)                    | mobile  | LOW    | clean                                                                                   |
| `3866cc91e85` | shortcut to remove assets from an album (immich-32015)         | web     | LOW    | clean; on upstream's `ActionItem`s, the fork's `RemoveFromAlbumAction` unaffected       |
| `70b19326928` | date storage template during onboarding (immich-32018)         | web     | LOW    | clean                                                                                   |
| `2bb3d0807fd` | OpenVINO 2026.4.1 (immich-32020)                               | ML / CI | HIGH   | **Shape D** — self-hosted runner mapping; onnxruntime now built from source             |
| `f5839105a77` | CLI sidecar precedence (immich-32021)                          | cli     | LOW    | clean                                                                                   |
| `643e606a5bc` | metadata extraction, unknown stream profile (immich-32023)     | server  | LOW    | clean                                                                                   |
| `6e5a4fdf009` | assetTagFilter any matching (immich-32027)                     | plugins | LOW    | clean; `plugin-gallery` does not use the tag filter                                     |
| `6fbb4d96422` | improper filename sanitizing (immich-32028)                    | server  | MEDIUM | **zero-conflict miss** in the fork's own `sanitizeFilename` — ported                    |
| `3d0e8e1b208` | base-image v202610021601 (immich-32031)                        | server  | LOW    | Shape H check deferred to CI (no local Docker) — `docker.yml` builds the image          |
| `6a7f943b91e` | sharp 0.35.4 [security] (immich-32032)                         | deps    | LOW    | lockfile conflict at the fork's rc.1 regen commit; resolves `sharp@0.35.5`, as upstream |
| `20f103c4b99` | version v3.3.0-rc.2                                            | release | LOW    | `mobile/pubspec.yaml` keeps the fork's `1.0.0+1`                                        |

### High-risk change: immich-32020 (OpenVINO)

1. **Runner mapping (Shape D, zero conflict).** Upstream mapped the OpenVINO matrix entry onto its own self-hosted
   `pokedex-large` runner. The line merged cleanly into the fork's `docker.yml`, where it would queue that job forever.
   The fork had already dropped upstream's earlier `pokedex-large` mapping (with the ROCm entry, #217). Removed again,
   and a new CI invariant `no-upstream-self-hosted-runners` forbids `pokedex-` under `.github/workflows/` — proved red
   on the leaked line before the fix, green after.
2. **onnxruntime source build.** `builder-openvino` now compiles onnxruntime from source (`--parallel 16`, "uses a
   substantial amount of RAM"). The fork builds this variant on GitHub-hosted `ubuntu-latest` in `docker.yml`,
   `gallery-release-server-only.yml` and `gallery-prerelease-server.yml`. Whether it fits that runner's time and memory
   is settled by this cycle's `docker.yml` run — see Remote CI.

### immich-32028 (filename sanitizing)

Upstream stopped stripping dots before `sanitize()` in three places. Two (`auth.service.ts`, `base.service.ts`) merged
cleanly. The third, `sanitizeFilename` in `validation.ts`, lives in the fork at a different position with its own doc
comment; the replayed #191 deletes upstream's copy, so the replay kept the fork's **dot-stripping** form. Storage
labels set through the user DTOs would still have lost their dots. Ported in its own commit.

## Conflict Resolutions

### `mobile/lib/pages/common/splash_screen.page.dart` (×3: #513, #627, #892)

- **Fork side**: #513 wraps the post-sync backup work in `sync.deferredLocalSync.then(...)`; #627 renamed
  `startForegroundBackup` → `startBackup`; #892 renamed it back.
- **Upstream side**: immich-32002 passes `lifeCycle` to `_resumeBackup` and adds an iOS guard that defers the backup
  to the first resume.
- **Resolution**: fork's deferred wrapper with upstream's `lifeCycle` argument in both calls; upstream's guard kept at
  every stop, with whichever method name that fork commit used. End state equals upstream's delta exactly.
- **Risk**: LOW. **Verification**: `dart analyze`, `flutter test`.

### `mobile/test/providers/app_life_cycle_provider_test.dart` (#663)

- **Fork side**: #663 re-indents the whole file inside a `group`.
- **Upstream side**: immich-32002 adds "first resume runs when the splash requested a full resume".
- **Resolution**: intended as the fork file plus upstream's test. My resolver's anchor did not match, and `git add`
  was chained with `;` rather than `&&`, so the replayed #663 commit staged the fork file **without** upstream's test.
  Fixed forward in a dedicated commit at upstream's position. The test is also adapted: the fork's #513 routes the
  local sync through `syncRemoteThenLocal(fullLocalSync:)`, so it asserts that flag (as the neighbouring
  background-launch case already does) instead of upstream's `syncLocal(full: true)`.
- **Risk**: LOW (caught by the per-file whole-tree audit). **Verification**: `flutter test` on the file.

### `web/src/routes/(user)/people/[personId]/…/+page.svelte` (×2: #522, #625)

- **Fork side**: removes the "also known as" list and rewrites the header block.
- **Upstream side**: immich-31987 dedupes the alt names (`altItems` → `altNames`).
- **Resolution**: fork side, after asserting each region's ours == base modulo exactly upstream's delta. The file is
  byte-identical to the pre-cycle tip.
- **Risk**: LOW.

### `server/src/repositories/shared-link.repository.ts` (×2: #1018, ESM codemod)

- Import-only: upstream adds `dummy` from `src/utils/database.js`; the fork adds the #1018 tether/visibility imports.
  Union. Upstream's `withAlbumOwner` → `albumUsers` rewrite auto-merged into both of the fork's album laterals.

### `server/src/validation.ts` (#191)

- The fork's #191 deletes upstream's `sanitizeFilename`/`uniqueIds` copies (it defines both elsewhere). Took the fork
  side; see immich-32028 above for the port this made necessary.

### `pnpm-lock.yaml` (fork rc.1 lockfile regen)

- One region: both sides set `@types/node 24.19.0`; the fork side also carries a `buffer@5.6.0` block. Took the fork
  side; upstream's sharp bump outside the region intact. No `version: file:` entries (injection invariant holds).

### `mobile/pubspec.yaml` (#121)

- Kept the fork's `version: 1.0.0+1`; release workflows supply the real version.

## Whole-tree audit

`backup/rolling-pre-2026-10-02..HEAD`: 50 files. Every file either carries exactly upstream's delta or is one of:
`docs/fork/ownership.yml` (new invariant), `.github/workflows/docker.yml` (runner mapping dropped),
`server/src/validation.ts` (sanitize port), `mobile/test/providers/app_life_cycle_provider_test.dart` (adapted
test), `mobile/pubspec.yaml` (fork version), the person page (upstream delta inert), `pnpm-lock.yaml` (fork already
had `@types/node 24.19.0`), and `splash_screen.page.dart` (identical to upstream's delta, reordered by the fork's
wrapper).

Structural checks: no conflict markers, no resurrected `mobile/openapi/`, no new zero-byte files (the three present
predate the cycle), upstream's two added test files have no fork history (Shape I clear), no renames in the range.

## Fork Feature Verification

| Feature              | Status | Notes                                                                      |
| -------------------- | ------ | -------------------------------------------------------------------------- |
| Shared Spaces        | OK     | #1018 shared-link contents intact on upstream's new owner shape            |
| Storage Migration    | OK     | untouched                                                                  |
| Pet Detection        | OK     | `ort.py` change is Intel-GPU blob keying only                              |
| Image Editing        | OK     | untouched                                                                  |
| Branding             | OK     | no deleted literals matched by branding tooling; no new `Immich` i18n keys |
| Google Photos Import | OK     | untouched                                                                  |
| Mobile backup        | OK     | upstream's iOS background fixes adopted on the #892-aligned implementation |

## CI and Infrastructure Verification

| Check                                   | Status | Notes                                            |
| --------------------------------------- | ------ | ------------------------------------------------ |
| Workflow files (no upstream collisions) | OK     | `docker.yml` runner mapping removed              |
| Docker image references                 | OK     | invariant `gallery-release-image-names` green    |
| Fork CI modifications intact            | OK     | `make ci-invariants-check` green (11 invariants) |
| New upstream workflows                  | OK     | none                                             |

## Database Migration Analysis

No server migrations and no mobile Drift changes in the range. `mobile-drift-rebase-check` green at every batch.
`revert-to-immich.sql` needs no new entries.

## Inconsistencies Found

1. **Shape D** — `pokedex-large` runner mapping (fixed + invariant).
2. **Fork-relocated definition misses an upstream fix** — `sanitizeFilename` (fixed). Same family as Shape S: the
   fork keeps its own copy of an upstream symbol, so an upstream edit to upstream's copy is deleted on replay
   rather than conflicting.

## Local CI Verification

| Check                                         | Status  | Notes                                                                                                                                                                                                     |
| --------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile` + SDK        | PASS    | no `version: file:` entries                                                                                                                                                                               |
| `server pnpm build` / `pnpm check`            | PASS    |                                                                                                                                                                                                           |
| `web check:typescript` / `check:svelte`       | PASS    | 630 files, 0 errors                                                                                                                                                                                       |
| `server pnpm lint`                            | PASS    |                                                                                                                                                                                                           |
| web eslint (`tscompat` off)                   | PASS    | the 5 web files changed this cycle; the full-tree run was too slow without `--concurrency`                                                                                                                |
| prettier (server, web, `.github`, i18n)       | PASS    |                                                                                                                                                                                                           |
| server unit                                   | PASS    | 6484/6485 in the full run; the one failure was the known supertest `socket hang up` flake in `library.controller.spec.ts` (untouched; 14/14 isolated)                                                     |
| web unit                                      | PASS    | 6413/6414 in the full run; `global-search-manager` timer cases failed only under a 1-min load average of ~84 from other sessions — unchanged file, 3/3 green at HEAD and at the pre-cycle tip once idle   |
| CLI unit                                      | PASS    |                                                                                                                                                                                                           |
| `tools/upstream-preflight`                    | PASS    | 301/301 (4 timeouts under the same load, green on re-run)                                                                                                                                                 |
| ML ruff format / check, mypy --strict, pytest | PASS    |                                                                                                                                                                                                           |
| OpenAPI spec + TS SDK regeneration            | PASS    | no diff                                                                                                                                                                                                   |
| mobile codegen (build_runner, drift, pigeon)  | PASS    | Flutter 3.47.2; `make-migrations` regenerated without refusal                                                                                                                                             |
| `dart analyze --fatal-infos` / `dart format`  | PASS    | no issues                                                                                                                                                                                                 |
| `flutter test`                                | PASS    | 4024 passed, including the restored immich-32002 case                                                                                                                                                     |
| `make commit-autolink-check`                  | PASS    | 1607 messages                                                                                                                                                                                             |
| `server/src/queries/` regeneration            | SKIPPED | no local Docker; `shared.link.repository.sql` hand-checked against the TS (owner lateral gone, `albumUsers` before `assets`, #1018 union intact, parameters unshifted) — CI SQL Schema Checks is the gate |

Local environment note: `mise run` inside `mobile/` resolved a global `flutter` tool (`~/.config/mise/config.toml`,
self-reports 3.44.0) ahead of the project's `aqua:flutter` 3.47.2 pin, even with `MISE_DISABLE_TOOLS=flutter`. The
mobile gates were run as the tasks' underlying commands with the 3.47.2 binary first on `PATH`.

## Remote CI Verification

- **Branch**: `rebase/upstream-rolling-v3.3.0`
- **Commit validated**: `19a3768321b` (this report's CI section was added afterwards; no code change)

| Workflow                              | Status | Run           | Notes                                                                                                                                                          |
| ------------------------------------- | ------ | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test.yml`                            | GREEN  | `37064079693` | 22/22 on attempt 2 — attempt 1 lost Medium (postgres image pull), E2E arm (GHCR `toomanyrequests`) and Lint Web (runner killed, exit 137) before any assertion |
| `docker.yml`                          | GREEN  | `37064519974` | OpenVINO onnxruntime source build fits `ubuntu-latest`: 44.5 min                                                                                               |
| `static_analysis.yml`                 | GREEN  | `37064115511` |                                                                                                                                                                |
| `gallery-build-mobile.yml`            | GREEN  | `37064156200` |                                                                                                                                                                |
| `gallery-mobile-smoke.yml`            | GREEN  | `37064198259` |                                                                                                                                                                |
| `gallery-rebase-smoke.yml`            | GREEN  | `37064594005` |                                                                                                                                                                |
| `storage-migration-tests.yml`         | GREEN  | `37064664234` |                                                                                                                                                                |
| `gallery-revert-to-immich-validation` | GREEN  | `37064740101` |                                                                                                                                                                |
| `gallery-ml-smoke.yml`                | GREEN  | `37064813967` |                                                                                                                                                                |
| `storage-migration-e2e.yml`           | GREEN  | `37064889043` |                                                                                                                                                                |

SQL Schema Checks (inside `test.yml`) green, so the hand-checked `shared.link.repository.sql` matches generation.
The base-image bump is covered by `docker.yml`'s server build, which installs `binaryen` in the plugins stage.

The OpenVINO build now takes ~45 min of the fork's release runs (`gallery-release-server-only.yml`,
`gallery-prerelease-server.yml` build it on the same runner class). Not a blocker; worth knowing when timing a release.

**Landing**: not applicable — `v3.3.0` is still at RC. The branch stays off `main`.
