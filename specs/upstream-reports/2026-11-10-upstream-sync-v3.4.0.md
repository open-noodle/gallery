# Upstream Sync Report — 2026-11-10 (v3.4 rolling → v3.4.0)

## Summary

- **Upstream**: Immich tagged `v3.4.0` (`0715bcf8dab`, = `release/v3.4` head). 10 commits on top of `v3.4.0-rc.3`,
  all release fixes plus the version bump. One replay of 1868 fork commits onto the tag.
- **Fork sync**: none needed. `origin/main` is still `3983e438171`, which is `integratedForkHead`.
- **Base**: `upstream.version` → `3.4.0` (AGENTS.md, README, both switching guides, the revert-script notes, the
  branding-targets pin, the OpenAPI version). v3.4.0 adds no migrations, no Drift schema change and touches no key in
  the FK registry. `ghcr.io/immich-app/immich-server:v3.4.0` is published.
- **Product gate**: did not fire. The passkeys disable (immich-33133) switches off a feature Gallery already kept off
  on mobile, and Gallery has not shipped passkeys anywhere (v3.4 has not landed).
- **Risk**: LOW. Backup: `backup/rolling-v34-pre-final-1110` (pre-cycle tip `f16544edf3a`, pushed).

## Upstream changes

| SHA           | Summary                                           | Area         | Risk | Notes                                                                             |
| ------------- | ------------------------------------------------- | ------------ | ---- | --------------------------------------------------------------------------------- |
| `081e40db2db` | don't block startup when offline (immich-33101)   | mobile       | LOW  | splash + api service; merged clean with the fork's splash routing                 |
| `373d7c56301` | album users empty for shared links (immich-33127) | web          | LOW  | clean                                                                             |
| `6b289b954e2` | archive filename for edited assets (immich-33128) | server       | LOW  | conflict with the fork's disk/S3 branch, resolved below                           |
| `6a411ac8e62` | more `@const` reactivity fixes (immich-33129)     | web          | LOW  | clean                                                                             |
| `3d1e886a709` | truncate filename in detail panel (immich-33130)  | web          | LOW  | conflict with the fork's filename filter, resolved below                          |
| `aaab2889f6a` | sqlite_async 0.14.8 (immich-33132)                | mobile, deps | LOW  | taken; the app version in `pubspec.yaml` stays Gallery's                          |
| `f4801a67609` | disable passkeys (immich-33133)                   | server, web  | LOW  | taken; forced off in `buildConfig`, admin form removed                            |
| `0a02dae2f71` | stale caches (immich-33136)                       | web, tests   | LOW  | taken; new medium spec needed the Gallery logo locator                            |
| `0efee6ac936` | backups 1.14.0 (immich-33137)                     | deps         | LOW  | lockfile re-resolved; transitive `backups-api-client` pinned to upstream's 1.14.0 |
| `0715bcf8dab` | version v3.4.0                                    | all          | LOW  | version strings                                                                   |

Pre-rebase detectors (deleted literals vs fork tooling, deleted members still used by fork code, new version gates,
removed ids / test ids, i18n and migration paths): nothing. The deleted-member scan named `invalidateAlbums`, whose
body changed but which still exists.

## Decision: passkeys stay off

immich-33133 disables passkeys on `release/v3.4` only; upstream `main` still has them on by default, so Immich held
them back from 3.4.0 rather than dropping them (the PR gives no reason). Owner decision (2026-11-10): keep upstream's
disable, so Gallery matches Immich 3.4.0 and carries no revert in upstream files. Passkeys come back with the upstream
release that re-enables them; mobile also needs a Gallery associated domain first (`mobile/lib/gallery/passkeys.dart`).

## How the replay was driven

One `git rebase v3.4.0`, `rerere` off. The driver took the fork side only for UU conflicts in the 48 files v3.4.0
touches since rc.3 and would have stopped on anything else. It stopped 7 times, 8 files in all (`pubspec.yaml`, the
OpenAPI spec and SDK, `pnpm-lock.yaml`, the download service, the system-config spec, `DetailPanel.svelte`, the albums
page load). Every file outside the 48 came out byte-identical to the pre-replay tip.

`chore(fork): reconcile the fork with v3.4.0` then set each of the 48 files to a three-way merge (fork tip, rc.3,
v3.4.0): 22 took v3.4.0 outright (the fork has no lines there), 18 merged clean (identical to the replay's own result),
7 resolved by hand, 1 new upstream file. A line-level audit then checked every v3.4.0 line is present, every line it
removed is gone and every fork line survives, except the deliberate choices below.

## Resolutions

- **Download archive** (immich-33128): the fork's disk/S3 branch (`isDiskPath` → realpath, else a lazy S3 stream)
  keeps its shape and takes upstream's `editedPath || originalPath` and the resolved-path log. Upstream's new filename
  handling (name from the original, extension from the served file) merged clean above it. `parse` import dropped.
- **Detail panel filename** (immich-33130): upstream's `truncateMiddle` and its `div` wrapper, inside the fork's
  `FilterValue`. It is a `span` with the full name as `title`, not upstream's `Text`, because `FilterValue` renders a
  `button`. The fork's `{#if asset.originalPath}` path toggle stays.
- **Albums page load** (immich-33136): `staleTime: 0` inside the fork's `Promise.all`.
- **System config spec** (immich-33133): upstream's two passkey tests sit after the fork's ffmpeg audio-codec test.
- **`pubspec.yaml`**: Gallery's app version, upstream's `sqlite_async` 0.14.8.
- **Lockfile**: the fork's lockfile, re-resolved for backups 1.14.0. `@futo-org/backups-api-client` resolved to 1.15.0
  (published after upstream locked it) and was pinned to upstream's 1.14.0, so the lockfile change matches upstream's
  line for line apart from the fork's `@immich/ui` patch hash. No `version: file:` entries.
- **Medium spec** (found by running it): immich-33136's `fresh-data.spec.ts` leaves each page through the navbar logo,
  located by the alt text "Immich logo". Gallery's navbar shows its own `Logo.svelte` ("Gallery logo"); the page
  object `test/medium/app.ts` follows it, with a `// Gallery:` comment. All six cases then pass, so the cache fixes
  hold on Gallery's album, sharing, shared-link, duplicates and user-admin pages too.

## Layering

- Upstream files whose fork diff grew: `test/medium/app.ts` (one locator line), `DetailPanel.svelte` (the `FilterValue`
  wrap is now around upstream's truncation). Everything else kept its fork delta size or moved toward v3.4.0.
- `i18n/*.json` identical to upstream; `merge.mjs --check` passes.
- No access or RBAC surface changed (no oracle input touched).

## Local CI verification

| Check                                                   | Status | Notes                                                   |
| ------------------------------------------------------- | ------ | ------------------------------------------------------- |
| server build, `tsc`, lint                               | PASS   |                                                         |
| server unit                                             | PASS   | 7742                                                    |
| web `tsc`, svelte-check, eslint on changed files        | PASS   | svelte-check did not flag the unused import; eslint did |
| web unit: asset viewer, Gallery asset viewer, albums    | PASS   | 25 files, 360 tests                                     |
| web medium: fresh-data, detail panel, album             | PASS   | after the logo locator fix                              |
| OpenAPI + SDK + Dart regeneration                       | PASS   | version string only                                     |
| mobile codegen, analyze, format, tests                  | PASS   | 4300; local Flutter must be the 3.47.2 pin              |
| e2e `tsc`                                               | PASS   |                                                         |
| i18n overlay check and merge tests                      | PASS   |                                                         |
| preflight suite (26 files), CI invariants, fork patches | PASS   |                                                         |
| post-rebase audit, mobile drift check                   | PASS   | artifact review informational (version strings)         |
| commit autolink check                                   | PASS   | 1870 messages                                           |

Not run locally: the full web unit and medium suites, server medium (no server change reaches an oracle), SQL
regeneration (no repository changed), ML (version string only).

## Remote CI verification

Code commit `66fbb3abe2e`; `bc7db3f5f3b` adds only the passkey note to this report.

| Workflow                                         | Run                           | Commit        | Result                                    |
| ------------------------------------------------ | ----------------------------- | ------------- | ----------------------------------------- |
| Test                                             | `42883913442`                 | `66fbb3abe2e` | PASS                                      |
| Static Code Analysis                             | `42884004094`                 | `66fbb3abe2e` | PASS                                      |
| Docker                                           | `42884185474`                 | `66fbb3abe2e` | PASS                                      |
| Gallery Rebase Smoke                             | `42884095690`                 | `66fbb3abe2e` | PASS                                      |
| Storage Migration Tests / E2E                    | `42884278714` / `42884557965` | `66fbb3abe2e` | PASS                                      |
| Gallery ML Smoke / Mobile Smoke                  | `42884373325` / `42884463086` | `66fbb3abe2e` | PASS                                      |
| Gallery Build Mobile: Android                    | `42884648064`                 | `66fbb3abe2e` | PASS                                      |
| Gallery Build Mobile: iOS                        | `42884648064`                 | `66fbb3abe2e` | not run: no macOS runner (twice, 0 steps) |
| Release Candidate Build `rolling-v34-rc13` (+ML) | `42891921152`                 | `bc7db3f5f3b` | PASS                                      |
| Revert-to-Immich (rc13 + stock `v3.4.0`)         | `42893915052`                 | `bc7db3f5f3b` | PASS                                      |

**RC tag reuse**: `rolling-v34-rc13` already existed (the rc.3 build of 2026-11-09, which staging ran), and
`gallery-rc-build.yml` accepted the reused tag, so the v3.4.0 build replaced it. The rc.3 image is still in GHCR by
digest (`gallery-server@sha256:c053c0b22913b84b06a74436774078cff272dfde91ae59bdfb7fc26d40b1c2d9`,
`gallery-ml@sha256:5a5d697bd0b9a678461875cf72d8847d10dfd671240a1c7b6871dd5f7448c9a1`). The same code was rebuilt as
`rolling-v34-rc14` (run `42903173583`, from `a23bdd74e7e`, which differs from the revert-gate image only in this
report) and that is what staging runs. Worth a guard in the RC workflow: refuse a tag that already exists.

## Staging

`rolling-v34-rc14` server and ML (infra-gitops `c54e904` ML, `325cdd2` server), replacing rc13 (rc.3). Live-DB
migration parity: 0 orphans, 0 pending, so nothing ran. Boot: `No schema drift detected` on both workers, 0 restarts,
only the known LegacyRouteConverter warning. `/server/version` is 3.4.0 for a stock client and 5.10.0-rc.1 for a
Gallery client; `/public/config` reports `passkey.enabled: false`; ML answers from the server pod. Pre-deploy dump
`~/gallery-backups/staging-pre-rolling-v34-rc14-2026-11-10.dump` (63 MB, sha256 matched the in-pod copy); rollback is
restoring it and pinning the rc.3 digests above.

No CI-only breaks this cycle. iOS last compiled on CI at `2a68a9f2247` (rc.3 cycle); this cycle's only iOS-relevant
change is `sqlite_async` 0.14.8, which the local mobile suite and the Android build cover on the Dart side.
