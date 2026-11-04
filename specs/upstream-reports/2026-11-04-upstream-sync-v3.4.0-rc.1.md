# Upstream Sync Report — 2026-11-04 (v3.4 rolling → v3.4.0-rc.1)

## Summary

- **Upstream**: Immich tagged `v3.4.0-rc.1` (`72fa79c0001`) on `release/v3.4`. The branch moves from rc.0
  (`81778c8c4a9`) to exactly that tag, per the "RC content only" policy (Pierre, this cycle). The 12
  `release/v3.4` commits past rc.1 (oauth regressions, people-page websockets, OCR search text, fonts, web
  worker import, backups codegen, CI rate limits, ML telemetry, and immich-32879) wait for rc.2.
- **Upstream commits pulled**: 8 (`81778c8c4a9..72fa79c0001`), one replay onto the tag.
- **Fork sync**: `main` `390b52a3ef6` → `0c5bff615d4`, 11 commits (#1134, #1254, #1241, #1256, #1257, #1258,
  #1260, #1262, #1263, #1264, #1272). `upstream-sync-fork-main` threw on #1134; the rest were
  cherry-picked `--ff` by hand and `integratedForkHead` advanced by hand.
- **Base**: `branding/config.json` `upstream.version` → `3.4.0-rc.1` (with AGENTS.md, README, two guides,
  the revert-script notes and the branding-targets pin).
- **Product gate**: did not fire. No sharing, sync, access or person-model change in rc.1.
- **Risk**: LOW for upstream, MEDIUM for the fork sync (four large features written against `main`'s
  toolchain). **Recommendation**: PROCEED to remote CI.
- Backup of the pre-cycle tip: `backup/rolling-v34-pre-rc1-1104` (`521b7d83b09`, pushed).

## Upstream changes

| SHA           | Summary                                                                       | Area        | Risk   | Notes                                                                                                           |
| ------------- | ----------------------------------------------------------------------------- | ----------- | ------ | --------------------------------------------------------------------------------------------------------------- |
| `711dcbbc024` | breaking changes: `UserUpdateMe.password`, `paused` job status (immich-32826) | server      | MEDIUM | `searchJobs` conflict: fork's dangling-active cleanup and `filter(Boolean)` kept with upstream's paused→waiting |
| `5becf1ae242` | backup compression on 75% of cores (immich-32828)                             | server      | LOW    | clean                                                                                                           |
| `0ba9837b4dd` | live photo match scoped to library (immich-32832)                             | server      | LOW    | clean                                                                                                           |
| `226f82091a5` | keep user motion files on embedded replace (immich-32833)                     | server      | MEDIUM | **zero-conflict break on S3**, see below                                                                        |
| `6f91e3ffe21` | single library exclusion matcher (immich-32834)                               | server      | MEDIUM | `detectOfflineExternalAssets` now upstream verbatim; fork spec mock updated to the new `number` return          |
| `f3258b7e9bb` | release-notes script (immich-32837)                                           | CI, scripts | LOW    | `draft-release.yml` and `packages/scripts` stay fork-deleted (the replay had re-added them, see below)          |
| `4aba1dff037` | FUTO Backups 1.12.1 (immich-32836)                                            | server, web | LOW    | Backups stays dormant; lockfile keeps the fork's `@immich/ui` `patch_hash`                                      |
| `72fa79c0001` | version v3.4.0-rc.1                                                           | all         | LOW    | `mobile/pubspec.yaml` keeps the fork's `1.0.0+1`                                                                |

No upstream migrations, no Drift schema change, no FK-registry key touched.

## Zero-conflict break: S3 motion videos (immich-32833)

Upstream now deletes the old motion file only when `StorageCore.isAndroidMotionPath` says Immich
extracted it, which checks for the absolute `encoded-video` folder. Gallery's S3 backend writes extracted
motion videos under a relative `encoded-video/<owner>/…` key (`metadata.service.ts`,
`getRelativeNestedPath`), so on S3 every replaced motion video would have been left in the bucket. Fixed
in `server/src/gallery/utils/motion-path.ts` (`isExtractedMotionPath`), one call in `metadata.service.ts`,
with two S3 cases added to upstream's own `it.each` (proved red first).

The three older upstream call sites of `isAndroidMotionPath` (`onBeforeUnlink`, download
`includeEmbeddedVideos`, storage template) have the same S3 blind spot already; not changed here.

## How the replay was driven

One `git rebase 72fa79c0001` over 1797 commits, `rerere` off, with a driver that took the fork side for
the regenerated artifacts (OpenAPI spec, TS SDK) and ran a 3-way import-line resolver (fork side plus
upstream's base→ours delta) on pure import regions. Hand resolutions: `.gitignore`, `misc.spec.ts`
(`globToPostgresRegex` → `createLibraryMatcher`), `mobile/pubspec.yaml`, `metadata.service.spec.ts`
(fork's negative-read-position test kept beside upstream's new `it.each`), the medium
`asset.repository.spec.ts` (both new describe blocks), `job.repository.ts` (`searchJobs`) and
`pnpm-lock.yaml` (1.12.1 plus the fork `patch_hash`).

**Driver bug, caught by the per-file audit**: the import resolver reported success on files with no
conflict markers, which a modify/delete conflict produces, so the replay re-added four files the fork
deletes (`.github/workflows/draft-release.yml`, `packages/scripts/src/{cli,commands/notes,commands/notes.spec}.ts`).
They are removed again in `chore(rolling): reconcile fork files with v3.4.0-rc.1`. The audit that found
them compares each file's old-tip→new delta with upstream's own rc.0→rc.1 delta; every remaining
difference is explained (fork `patch_hash`, fork job cleanup, import merges, regenerated artifacts).

## Fork sync

The 11 commits were written against `main`'s vocabulary (`$lib/...`, `{@const}`, `*`-prefixed doc
comments, per-file `src/params` matchers). Conflicts were normalised by rewriting the base and fork sides
to rolling's `#lib/....<ext>` form, prettier on all three sides, then `git merge-file`; the rest of the
sync was left in `main`'s form and carried in one commit afterwards:

- `fix(rolling): carry the fork-synced web code onto SvelteKit 3`: 115 files to `#lib` subpath imports,
  20 `{@const}` → `{const … = $derived(…)}`, doc comments, three unicorn v78 findings, one duplicated
  `onNavigate` import from the `motion/index.ts` merge.
- `fix(rolling): fork-synced code on SvelteKit 3 route APIs and rc.1 signatures`: the `cleanupQueue`
  matcher moves to `#lib/gallery/cleanup/cleanup-queue-param.ts`, registered in `src/params.ts`
  (`defineParams`); `BeforeNavigate` from `$app/navigation`, `delta` read on the `popstate` variant only,
  `goto` `replaceState` → `replace`.
- `fix(rolling): fork-synced server code on rolling's lint rules`: doc comments and three
  `no-unnecessary-parameters` findings.
- Kept rolling's side: `test.yml` Lint Web `--concurrency 2` (main's #1257 changed the same step to 4).
- `DatabaseLock.CleanupQualityRerun = 870` sits between 860 and 900; the access-oracle snapshot gains
  `cleanup.read`/`cleanup.update` (empty grants, as on `main`).
- Audit: every line the 11 commits added is present on rolling, except the lines the carry commits
  changed on purpose.

The manifest's `expected_migrations` gains the three fork migrations `main` had not listed
(`1799100000000`, `1799500000000`, `1799600000000`), and `expected_patch` moves to the
`@immich/ui@0.91.1` patch that has been on the branch since rc.0 (the check was red before this cycle).

## Revert script

No post-tag upstream migrations (rc.1 adds none). The four new fork migrations and the new `cleanup.*`
permission values are covered (they arrived with their revert entries from `main`); the coverage
detector and the fork enum check print nothing; `revert-to-immich.spec.ts` passes.

## Layering

Fork diff vs upstream, before → after: `metadata.service.ts` 253 → 256 (the motion-path hook),
`src/params.ts` 0 → 2 (one import, one registration line), `job.repository.ts` 388 → 388,
`asset.repository.ts` 1064 → 1064. `i18n/*.json` identical to the tag; `merge.mjs --check` passes.

## Local verification

| Check                                                    | Status  | Notes                                       |
| -------------------------------------------------------- | ------- | ------------------------------------------- |
| `server pnpm build` / `pnpm check`                       | PASS    |                                             |
| `server pnpm lint`                                       | PASS    | after the carry commit                      |
| Server unit tests                                        | PASS    | 7300 passed                                 |
| `web check:typescript` / `check:svelte`                  | PASS    | 698 files, 0 errors                         |
| web eslint (synced files)                                | PASS    | full Lint Web left to CI                    |
| Web unit tests                                           | PASS    | 7063 passed                                 |
| OpenAPI spec + TS SDK regenerated                        | PASS    | committed                                   |
| `mise //mobile:analyze` / `:format`                      | PASS    | `--fatal-infos`, no issues                  |
| Mobile unit tests                                        | PASS    | 4215 passed                                 |
| ML ruff / mypy --strict / pytest                         | PASS    | 284 passed                                  |
| `tools/upstream-preflight` vitest                        | PASS    | 305 (branding-targets pin bumped)           |
| post-rebase audit, fork-patches, ci-invariants, autolink | PASS    |                                             |
| i18n `merge.test.mjs` / `merge.mjs --check`              | PASS    |                                             |
| `mise sql`, medium tests, access/RBAC oracles            | NOT RUN | Docker Desktop down locally; CI covers them |

## Follow-ups

- The older `isAndroidMotionPath` call sites ignore S3 keys (unlink guard, download of embedded videos,
  storage template). Same hook would fix them; out of scope for an rc sync.
- `main`'s `docs/fork/ownership.yml` lacks the three migrations listed above.
- ~~rc.2 brings immich-32879~~: pulled ahead of rc.2 the same day, see below.

## Remote CI

Branch `rebase/upstream-rolling-v3.4`, dispatched in two staggered waves.

| Workflow                            | Status | Commit        | Run           | Notes                                                         |
| ----------------------------------- | ------ | ------------- | ------------- | ------------------------------------------------------------- |
| Test                                | GREEN  | `25eb9ace987` | `41852034383` | third run, see below                                          |
| Docker                              | GREEN  | `2730dc550a2` | `41842049284` | later commits touch only e2e specs                            |
| Static Code Analysis                | GREEN  | `2730dc550a2` | `41841776332` |                                                               |
| Gallery Build Mobile                | GREEN  | `2730dc550a2` | `41841944413` |                                                               |
| Gallery Mobile Smoke                | GREEN  | `2730dc550a2` | `41841887695` |                                                               |
| Gallery Rebase Smoke                | GREEN  | `2730dc550a2` | `41841831665` |                                                               |
| Gallery ML Smoke                    | GREEN  | `2730dc550a2` | `41842211669` |                                                               |
| Storage Migration Tests             | GREEN  | `2730dc550a2` | `41842130238` |                                                               |
| Storage Migration E2E               | GREEN  | `2730dc550a2` | `41842375652` |                                                               |
| Gallery Revert-to-Immich Validation | RED    | `2730dc550a2` | `41842294197` | tested `gallery-server:main` (3.3.5), needs a branch RC image |

Fixes found by CI:

- End-to-End Lint: the synced e2e specs on rolling's unicorn rules (`d1a9376dcac`).
- `database-backups` "rollback to restore point": the rollback is a second full restore, and on Gallery's
  schema it stood at the same statement (progress 0.7476) when upstream's 30 s poll ended, on both runs.
  The poll now has the 60 s the restore test above it already uses (`25eb9ace987`). This is a test-only
  hunk in an upstream e2e file.

Failed once, passed on re-run: the medium `gallery-search-options` cache `stale` case (its result depends on
when Postgres's write counters land) and the web maintenance enter/exit test.

## Follow-on: immich-32879 pulled ahead of rc.2 (web medium tests)

Pierre chose to port the fork to upstream's new web test suite now, on the rolling branch, rather than wait
for rc.2. The rc.1 tip above (`a7fc29d578d`, 10/10 green, on staging as `rolling-v34-rc7`) is kept as
`backup/rolling-v34-pre-32879-1104`. The branch was rebased onto `e56c8eef292` (immich-32879), which also
brings the five `release/v3.4` fixes before it: immich-32841 (iOS 10-bit HEIC/AVIF), immich-32842 (OCR search
text after edits), immich-32874 (fonts), immich-32875 (album asset removal resizes the timeline),
immich-32877 (web worker import). No migrations; `upstream.version` stays `3.4.0-rc.1`.

Replay (1820 commits, driver v2, which keeps upstream's deletions of the old test infra and refuses to
resolve a file without conflict markers): the replayed fork commits are left on the old API where they meet
upstream's converted specs, then two port commits on top:

- `test(web): move Gallery's web specs onto upstream's test layout`: ~430 old-factory calls in ~100 fork
  specs to `factory.*`; the 23 specs upstream converted re-derived by a 3-way merge (upstream new, upstream
  old, fork tip); fork builders in `web/test/unit/gallery-factories.ts` (one spread in `factories.ts`); the
  real-server album-filter and detail-panel tests to `gallery-*` e2e specs.
- `test(web): run upstream's web medium suite against Gallery ...`: default handlers for the fork endpoints,
  per-user favorites and bucket sizes in `web/test/medium/gallery/`, the filter panel collapsed by an init
  script, four fork UI specs ported to `web/test/medium/specs/gallery/`, svelte stubs to
  `web/src/lib/gallery/__mocks__/`.

Upstream-file hunks this adds: one line each in `test/unit/factories.ts`, `test/medium/mock/mock.ts`,
`test/medium/fixtures.ts`, `test/medium/mock/factories.ts` (`memories.types`), three assertion edits in
upstream medium specs (favorites, shared-link navbar), `e2e/package.json` keeps `sharp`, and the new CI job
uses `github.token`.

Local: web unit 7064, web medium 61/64 (the three that type a date into `datetime-local` fail on this Mac's
German region, which orders the field day/month/year; CI's Linux runner is en-US), web/server/e2e lint and
type checks, server unit 7302, audits all OK. The two `e2e/src/ui` Gallery-only specs that only tested the
deleted generator are gone with it.

### Remote CI for the immich-32879 tip

Branch tip `ce1a9f463ab` (= `bc65b0cb02e` plus a two-line format fix in one web spec).

| Workflow                    | Status                        | Commit        | Run           | Notes                                                                                                |
| --------------------------- | ----------------------------- | ------------- | ------------- | ---------------------------------------------------------------------------------------------------- |
| Test                        | GREEN                         | `ce1a9f463ab` | `41871539863` | e2e server arm re-run once (user-admin hard delete timed out; the same tree passed on `bc65b0cb02e`) |
| Test Web (Medium)           | GREEN                         | `ce1a9f463ab` | `41871539863` | 70 passed; 3 passed on retry (see follow-ups); the 3 locale-only date tests pass on Linux            |
| Docker                      | GREEN                         | `bc65b0cb02e` | `41867101138` |                                                                                                      |
| Static Code Analysis        | GREEN                         | `bc65b0cb02e` | `41866793875` |                                                                                                      |
| Gallery Mobile Smoke        | GREEN                         | `bc65b0cb02e` | `41866916247` |                                                                                                      |
| Gallery Rebase Smoke        | GREEN                         | `bc65b0cb02e` | `41866854689` |                                                                                                      |
| Gallery ML Smoke            | GREEN                         | `bc65b0cb02e` | `41867274267` |                                                                                                      |
| Storage Migration Tests     | GREEN                         | `bc65b0cb02e` | `41867187273` |                                                                                                      |
| Storage Migration E2E       | GREEN                         | `bc65b0cb02e` | `41867361683` |                                                                                                      |
| Revert-to-Immich Validation | GREEN                         | `bc65b0cb02e` | `41871371665` | `gallery-server:rolling-v34-rc8` + `immich-server:v3.4.0-rc.1`                                       |
| Gallery Build Mobile        | Android GREEN, iOS UNVERIFIED | `bc65b0cb02e` | `41866975366` | iOS never got a macOS runner on 3 attempts (0 steps); iOS last built on `a7fc29d578d`                |

The rc.1 tip itself (`a7fc29d578d`) went 10/10, the revert gate with `rolling-v34-rc7` (run `41859527208`).
Staging runs `rolling-v34-rc7` (server + ML); dump `~/gallery-backups/staging-pre-rolling-v34-rc7-2026-11-04.dump`.

Follow-ups from this run: three upstream medium specs passed only on retry in CI (`detail-panel` shared link
with hidden metadata, `search-gallery` delete advances, `timeline` arrow keys and tab); check whether they
are flaky upstream too or only against Gallery's web.

## Follow-on: fork sync of #1195, #1214 and #1239

`main` moved from `0c5bff615d4` to `3b3f35f85b7`: #1195 (layering wave 4), #1214 (waves 5 to 11, 663 files)
and #1239 (storage template on S3). `make upstream-sync-fork-main` stopped on conflicts each time, so the three
were cherry-picked by hand and `integratedForkHead` advanced to `3b3f35f85b7`. Rolling copies: `16155a70a7f`,
`b06c5d0ab45`, `a548fd18fc6`.

How #1214 was replayed (195 conflicted files):

- Base and fork sides were normalised to rolling's style before `git merge-file`: `$lib/x` to `#lib/x.<ext>`
  (`.js` in `vi.mock`), `{@const}` to `{const … = $derived(…)}`, doc comments without `*`, prettier. That settled
  98 of 174 files outright.
- An upstream file that #1214 left as pure upstream v3.3.5 became upstream v3.4 here (41 files, among them the
  four restored release workflows and `test_main.py`). Where rolling's fork lines in a file matched `main`'s,
  the result is upstream v3.4 plus `main`'s post-#1214 fork delta.
- Where rolling had its own fork lines (bullmq 6, SvelteKit 3, upstream v3.4 reworks), they were kept and
  carried into the module #1214 moved the code to: the bullmq 6 queue handling into
  `queue-maintenance.repository.ts`; `new URL(page.url.href)`, `refreshAll` and `goto({ replace, reset })` into
  `PersonTile`, `PersonSuggestions`, `map-filter-controller`, `detail-panel-filters`, `FilterValue`,
  `AppearsInAlbum`; the archive animation and per-user bulk favorite into `asset.service.ts`; the HLS element in
  `VideoNativeViewer`; partners in the mobile person timeline (`extraWhere`); the locale date format in
  `remote_album_gallery.dart`.
- Rolling already had its own layering for two areas, so #1214's duplicates were dropped:
  `gallery/stores/spaces-cache.ts` (rolling reads spaces through `gallery/spaces/space.query.ts`) and
  `gallery/album-actions.ts` (rolling has `gallery/album/album-add.ts` and `link-album-to-space.ts`). Both are out
  of `docs/fork/ownership.yml`.
- One deliberate divergence from `main`: `notifyAddToAlbum` keeps the fork's #764 toast severity. On `main` #1214
  switched it to upstream's (immich-30976) because that function is upstream's there; upstream v3.4 no longer has
  it, so rolling's `gallery/album/notify-add-to-album.ts` is the only implementation.
- `person.service.ts` (replay-owned) took #1214's moves into `FaceIdentityMaintenanceService` and its switch of
  recognition to upstream's cluster-group `searchFaces`; the moved helpers were byte-identical on both branches.
- Upstream-file diffs against v3.4 shrank, for example `asset.service.ts` (web) +212/−30 to +23/−7,
  `timeline.service.ts` to +37/−10, `DetailPanel.svelte` +298/−85 to +88/−81, `person.service.ts` by ~130 lines.

#1239: rolling already had #1239's e2e retry helper as `fetchGet`, so the duplicate `fetchAfterSyncChecks` went.
Upstream v3.4 sanitizes `make` in storage templates, so the EXIF sibling-folder test asserts the asset stays in
its own library folder instead of expecting the path-guard warning; two log expectations follow v3.4's wording.

Audit: every line rolling had that `main` lacked, in every file #1214 touched, is present on rolling, except
lines moved or replaced on purpose (listed above).

Local: server build, `tsc`, lint and unit (7617 passed); web `tsc`, svelte-check, lint and unit (7072 passed);
access oracle (197), RBAC oracle, migration ledger and jit migration medium specs; `dart analyze --fatal-infos`
clean and 1197 mobile tests over the touched areas; ML ruff, mypy and pytest (287); preflight (350), i18n overlay,
SQL regeneration (no diff), revert coverage, autolink check.

CI found four zero-conflict breaks the local gates did not, all fixed on the branch:

- `apply-branding.sh` (moved there by #1214) listed `main`'s `OauthSettings.svelte`; upstream renamed it
  `OAuthSettings.svelte`. macOS's case-insensitive filesystem hid it locally. The swapped-in import now uses
  `#lib`, and the `sed` expressions take `|` as delimiter. Proved in a Linux container: 21 files swapped,
  idempotent on a second run.
- `gallery-test.yml` (the jobs #1214 moved out of `test.yml`) carried `main`'s `use-mise` v3.1.0/v3.2.1 pins,
  whose mise resolves java outside rolling's lockfile; it now uses rolling's `test.yml` pins.
- The revert gate's guide check (from #1195) matched `vX.Y.Z` only, so `v3.4.0-rc.1` read as `v3.4.0`; it now
  accepts a prerelease suffix.
- The camera contextual filter label went back to upstream's `getCameraName` (in `detail-panel-filters.ts`),
  `stock-client.e2e-spec.ts` compares `/server/version` with the base's core version, and #1195's files got the
  prettier and doc-comment fixes the earlier lint pass (scoped to #1214 and #1239) missed.

Remote CI for the fork sync. Later commits on the branch only touched `.github/`, `branding/`, web/e2e/server
fixes and this report, so each row names the newest commit its inputs changed at.

| Workflow                    | Status | Commit        | Run           | Notes                                                                       |
| --------------------------- | ------ | ------------- | ------------- | --------------------------------------------------------------------------- |
| Test                        | GREEN  | `f1f418adeba` | `41927772938` | 21/21 jobs, first attempt                                                   |
| Gallery Test                | GREEN  | `f1f418adeba` | `41927850826` |                                                                             |
| Docker                      | GREEN  | `f1f418adeba` | `41927927021` |                                                                             |
| Static Code Analysis        | GREEN  | `a548fd18fc6` | `41916450387` | mobile unchanged since                                                      |
| Gallery Build Mobile        | GREEN  | `51fd7a21349` | `41917980905` | Android re-run once (runner disk full); iOS built on the first attempt      |
| Gallery Mobile Smoke        | GREEN  | `51fd7a21349` | `41917846589` |                                                                             |
| Gallery ML Smoke            | GREEN  | `51fd7a21349` | `41917913580` |                                                                             |
| Gallery Rebase Smoke        | GREEN  | `a548fd18fc6` | `41916839993` |                                                                             |
| Storage Migration Tests     | GREEN  | `a548fd18fc6` | `41916923421` |                                                                             |
| Storage Migration E2E       | GREEN  | `a548fd18fc6` | `41917007644` |                                                                             |
| Revert-to-Immich Validation | GREEN  | `f19c2be64e6` | `41922233233` | `gallery-server:rolling-v34-rc9` (built from `51fd7a21349`) + `v3.4.0-rc.1` |

`rolling-v34-rc9` is built (run `41918049263`) and not deployed; staging still runs `rolling-v34-rc7`.
