# Upstream Sync Report — 2026-11-18 (Immich v3.4.2)

## Summary

- **Branch**: `rebase/upstream-rolling-v3.4.2`, started fresh from `origin/main` `b6bd0b3b9ac` (#1324); no rolling branch was open.
- **Upstream target**: tag `v3.4.2` `b6b4b80df11` (= `upstream/release/v3.4` head).
- **Upstream commits pulled**: 11 (all `release/v3.4` cherry-picks over `v3.4.1`).
- **Fork commits replayed**: 1892; backup of the pre-replay branch `backup/rolling-v342-pre-1118` (= `origin/main`).
- **Conflicts**: 12 during the replay, all in files the tag touches, resolved by the strict driver and reconciled afterwards (below).
- **Migrations**: none (server or mobile Drift).
- **Risk level**: LOW. One Shape E break found and fixed (iOS Ruby, see Inconsistencies).
- **Recommendation**: PROCEED.

## Incoming Upstream Changes

| SHA           | Summary                                                                       | Area          | Risk to Fork | Notes                                                                    |
| ------------- | ----------------------------------------------------------------------------- | ------------- | ------------ | ------------------------------------------------------------------------ |
| `d055613430e` | hide slideshow play/pause without autoplay (immich-33220)                     | web           | LOW          | `SlideshowBar` not fork-modified                                         |
| `647079522d0` | prevent duplicate combobox keys on unknown camera make (immich-33214)         | web           | LOW          | adds upstream `Combobox.spec.ts`; the fork had its own file there (#963) |
| `cce271e9644` | filename alignment in detail panel (immich-33256)                             | web           | LOW          | two class changes, restored in reconcile                                 |
| `994e92b6b27` | credit additional users in release notes (immich-33412)                       | scripts       | NONE         | `packages/scripts` is deleted in the fork; deletion kept                 |
| `c1bfbdd79e9` | hash external styles for CSP (immich-33411)                                   | web build     | LOW          | coexists with the fork's i18n plugin; build verified                     |
| `374f9331992` | integrity report downloads via `ApiRoute` (immich-33420)                      | web           | LOW          | no fork reference to `Route.integrityReport*`                            |
| `97a413383c0` | Android Play upload in release CI; Ruby via `mobile/mise.toml` (immich-33422) | CI / mobile   | MEDIUM       | Shape E: fork iOS job had to move off setup-ruby                         |
| `a9342aa4701` | backups 1.18.1, futo restic 0.19.1-futo.2 (immich-33448)                      | deps / Docker | LOW          | lockfile delta identical to upstream's                                   |
| `ed2aebb8366` | Prometheus exporter listens on `IMMICH_HOST` (immich-33457)                   | server        | LOW          | fork telemetry hunks (`observeGauge`, `app` group) untouched             |
| `c1b35c13a99` | drop `out_range=pc` on VAAPI (immich-33458)                                   | server        | LOW          | `media.ts` not fork-modified                                             |
| `b6b4b80df11` | `chore: version v3.4.2`                                                       | release       | LOW          | mobile `pubspec.yaml` / `Info.plist` keep the fork's own version         |

No commit fired the per-batch product-direction gate: none touches sharing, sync, people, albums, search, access or a data model.

## Method

`make upstream-batch-plan` split the range into 9 batches. All 11 commits passed Checkpoint 1, so the branch was replayed once onto the tag (`make upstream-rolling-start`, then one `git rebase v3.4.2`) with a strict driver, as in the v3.4.0 and v3.4.1 cycles. The driver:

- took the fork side (`--theirs`) only for marker-bearing UU/AA conflicts in files the tag touches;
- followed the fork's deletion (UD) for touched files and `packages/scripts/**`;
- stopped on anything else, and on a commit that would not advance.

Then, per touched file, it built the expected result as `merge-file(old fork tip, v3.4.1, v3.4.2)` and compared it to HEAD, followed by a line-level audit: every upstream `+` line is present and every `-` line gone.

Driver log: 7 + 2 auto-theirs, 1 AA stop (`Combobox.spec.ts`), 1 UD stop (`draft-release.yml` + `packages/scripts` notes, deleted by the fork's v3.4.0-rc.1 reconcile and `draft-release.yml` re-added by #1214).

## Conflict Resolutions

### Conflict: `.github/workflows/build-mobile.yml`

- **Fork side**: removes push-o-matic tokens, uses `github.token`, adds `apply-branding` before the keystore (Android) and before Setup Ruby (iOS).
- **Upstream side**: `rc` input, `PLAY_STORE_JSON_KEY` secret, Play Store key file and fastlane deploy (production only), and `bundle install` on mise's Ruby replacing `setup-ruby` in the iOS job.
- **Resolution**: upstream's file plus the fork's patches; `apply-branding` placed before upstream's new `Install Ruby gems` step in both jobs.
- **Risk**: LOW. The fork does not run this workflow's production path (the Play/fastlane step only runs for `environment: production`, i.e. upstream's `draft-release`).
- **Verification needed**: none beyond `.github` prettier (green).

### Conflict: `web/src/lib/components/shared-components/Combobox.spec.ts` (add/add)

- **Fork side**: #963's iPad on-screen-keyboard placement tests, in upstream's spec path.
- **Upstream side**: a new 18-line spec (labels colliding without ids).
- **Resolution**: `Combobox.spec.ts` is upstream verbatim; the fork's tests move to `Combobox.gallery.spec.ts` (AGENTS.md rule 8: fork tests leave an upstream spec when it next conflicts). Both run: 6/6 pass.
- **Risk**: LOW.

### Conflict: `.github/workflows/draft-release.yml` (fork delete vs upstream modify)

- **Fork side**: the v3.4.0-rc.1 reconcile deleted it; #1214 later re-added it as upstream's v3.4.1 file.
- **Resolution**: deletion followed at that commit; #1214 re-adds it; reconcile applies upstream's two v3.4.2 lines (Play Store key, `rc`). File is now upstream verbatim, as on `main`.
- **Risk**: LOW.

### Reconciled after the replay (clean 3-way merge, HEAD had the fork side only)

`server/src/repositories/telemetry.repository.ts`, `web/src/lib/components/asset-viewer/DetailPanel.svelte`, `web/vite.config.ts`: each diff from HEAD to the expected result was exactly upstream's hunk, and those hunks were applied.

### Generated / lockfile

- `open-api/immich-openapi-specs.json`, `packages/sdk/src/fetch-client.ts`: regenerated from a server build; diff is the version line only.
- `pnpm-lock.yaml`: regenerated with `injectWorkspacePackages` temporarily off, then the `settings: injectWorkspacePackages: true` line restored (the regen omits it). Package delta identical to upstream's (backups 1.16.0→1.18.1, restic-wrapper 1.7.0→1.9.0, `yup` and four transitives dropped). `version: file:` count 0; `pnpm install --frozen-lockfile` accepts it.
- `mobile/pubspec.yaml`, `mobile/ios/Runner/Info.plist`: keep the fork's version (`3.3.3`, set at release).

## Fork Feature Verification

| Feature                             | Status | Notes                                                                 |
| ----------------------------------- | ------ | --------------------------------------------------------------------- |
| Shared Spaces / people / search     | OK     | no upstream change in these areas; server unit suite green            |
| Storage (S3) / Video trim / editing | OK     | VAAPI filter change is upstream-only code; `media.service.spec` green |
| Pet detection / ML                  | OK     | ML change is the version string only                                  |
| Branding                            | OK     | no removed literal is matched by fork tooling; no i18n change         |
| Google Photos import                | OK     | untouched                                                             |

## CI and Infrastructure Verification

| Check                                       | Status | Notes                                                                                       |
| ------------------------------------------- | ------ | ------------------------------------------------------------------------------------------- |
| Workflow files (no upstream collisions)     | OK     | `build-mobile.yml` / `draft-release.yml` are upstream's (fork does not use their prod path) |
| Docker image references                     | OK     | `server/Dockerfile` takes upstream's restic image bump only                                 |
| Fork CI modifications intact                | OK     | `make fork-patches-check`, `make ci-invariants-check` green                                 |
| Shape E: Ruby moved into `mobile/mise.toml` | FIXED  | see Inconsistencies                                                                         |

## Database Migration Analysis

No upstream migration in `v3.4.1..v3.4.2`; fork migrations unchanged. Revert-coverage detector against `v3.4.2` prints nothing. FK-key audit, ledger and `renamedMigrations`: unchanged, Gallery migration checks in the post-rebase audit OK.

## Mobile Drift Migration Analysis

No `schemaVersion` or snapshot change upstream; nothing to renumber.

## Layering

- Upstream files whose fork diff grew: `.github/workflows/gallery-build-mobile.yml` is fork-only. `Combobox.spec.ts` shrank to upstream verbatim (fork tests moved to a `.gallery.spec.ts`). No other growth.
- `i18n/*.json` identical to upstream (no upstream i18n change); `merge.mjs --check`: PASS.
- Access / RBAC oracles: not run locally (no access, scope or favorite change); CI Medium Tests run them.

## Inconsistencies Found

- **Shape E, fixed (`8d20a6888ab`)**: immich-33422 declares Ruby 3.4.12 in `mobile/mise.toml`. mise puts it first on PATH inside `mise //mobile:*` tasks, so `install:ios`'s `pod install` in the fork's `gallery-build-mobile.yml` iOS job would have run on a Ruby without the gems the fork's `setup-ruby` 3.3 step bundled. The iOS job now runs `bundle install` on mise's Ruby after Setup Mise, as upstream's job does. The Android Play upload keeps its `setup-ruby` (own Gemfile in `mobile/android/gallery-release`, called outside mise tasks). Verified only by the `gallery-build-mobile` dispatch.

## Local CI Verification

| Check                                                     | Status | Notes                                                                                  |
| --------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------- |
| `server pnpm build`                                       | PASS   | after `mise run //:plugins` (fresh worktree)                                           |
| `server pnpm check`                                       | PASS   |                                                                                        |
| server lint                                               | PASS   | changed files; the full run aborted with a V8 crash while the unit suite ran alongside |
| server unit tests                                         | PASS   | 263 files, 7906 tests (incl. favorite gate, FK registry, revert spec)                  |
| `web check:typescript` / `check:svelte`                   | PASS   | 720 files, 0 errors                                                                    |
| web eslint (`tscompat` off), changed files                | PASS   |                                                                                        |
| web unit: `Combobox.spec.ts` + `Combobox.gallery.spec.ts` | PASS   | 6 tests                                                                                |
| web build + CSP manifest                                  | PASS   | 23 style hashes, single `__sveltekit_` hash                                            |
| e2e `pnpm check`                                          | PASS   |                                                                                        |
| `tools/upstream-preflight` vitest                         | PASS   | 26 files, 350 tests (M8 spec bumped to 3.4.2)                                          |
| post-rebase audit / fork-patches / ci-invariants / drift  | PASS   | audit's Generated Artifact Review = the spec's version line                            |
| `make commit-autolink-check RANGE=v3.4.2..HEAD`           | PASS   |                                                                                        |
| `merge.mjs --check` + `merge.test.mjs`                    | PASS   |                                                                                        |
| `.github` prettier                                        | PASS   |                                                                                        |
| mobile analyze/test, ML gates                             | SKIP   | no Dart change; ML change is the version string only                                   |

## Remote CI Verification

- **Test branch**: `rebase/upstream-rolling-v3.4.2`
- **Commits validated**: `63b9cdd054b` (all workflows), `64ab7fad8d2` (`test.yml` re-run after the web test fix; nothing else changed)

| Workflow                                  | Status | Run         | Notes                                                                                                       |
| ----------------------------------------- | ------ | ----------- | ----------------------------------------------------------------------------------------------------------- |
| `test.yml`                                | GREEN  | 44406320528 | on `64ab7fad8d2`; first run 44399191648 red, see below                                                      |
| `docker.yml`                              | GREEN  | 44399467758 |                                                                                                             |
| `static_analysis.yml`                     | GREEN  | 44399257530 |                                                                                                             |
| `gallery-build-mobile.yml`                | GREEN  | 44399322510 | Android green on attempt 1; iOS green on attempt 2 (attempt 1 got no macOS runner): validates `8d20a6888ab` |
| `gallery-mobile-smoke.yml`                | GREEN  | 44399387456 |                                                                                                             |
| `gallery-rebase-smoke.yml`                | GREEN  | 44399452043 |                                                                                                             |
| `storage-migration-tests.yml`             | GREEN  | 44399612323 |                                                                                                             |
| `storage-migration-e2e.yml`               | GREEN  | 44399749512 |                                                                                                             |
| `gallery-ml-smoke.yml`                    | GREEN  | 44399886199 |                                                                                                             |
| `gallery-revert-to-immich-validation.yml` | GREEN  | 44405440562 | `gallery_image=gallery-server:rolling-v342-rc1`, `upstream_image=immich-server:v3.4.2`                      |
| `gallery-rc-build.yml`                    | GREEN  | 44399123596 | `rolling-v342-rc1`, server only (ML unchanged but for its version)                                          |

- **Failures fixed**: Test Web, `date-time.spec.ts` got `enero de 2022`. The `locale` store is persisted to localStorage, shared by every spec iframe in one browser session; upstream's `timeline-util.spec.ts` ends on `es`, and the new spec files reshuffled which files share a worker. Fixed in the Gallery unit setup (`web/test/unit/gallery-setup.ts` clears the key before a spec's imports), reproduced red and proved green by forcing both files onto one worker (`64ab7fad8d2`).
- **Confirmed infrastructure**: OpenAPI Clients on the first run died downloading the generator jar (Maven Central 429) before any check; green on the re-run.

### Staging

`rolling-v342-rc1` deployed to staging (infra-gitops `35a255b`; ML stays `rolling-v34-rc14`). Live-DB parity: 0 orphans, one pending fork migration (`1800100000000-AddVideoPetsSampledAt`, from #1316), which ran; no schema drift on either worker; no restarts. `/server/version` reports `3.4.2` to a stock client and `5.11.0-rc.1` to a Gallery client. Pre-deploy dump `~/gallery-backups/staging-pre-rolling-v342-rc1-2026-11-18.dump` (sha256 `c7148785…`); rollback = re-pin `rolling-v34-rc15` and restore it.

## Post-Rebase Verification

- Fork commits ahead of `v3.4.2`: 1895 (1892 replayed + reconcile, base bump, iOS Ruby fix) + this report.
- Commits behind `upstream/release/v3.4`: 0.
- Every file differing from `origin/main` is a tag-touched file or a deliberate edit (base bump, guides, M8 spec, `Combobox.gallery.spec.ts`).
