# Upstream Sync Report — 2026-11-05 (v3.4 rolling → v3.4.0-rc.2)

## Summary

- **Upstream**: Immich tagged `v3.4.0-rc.2` (`954e8de6a17`), the tip of `release/v3.4`. The branch moves
  from `e56c8eef292` (past rc.1) to exactly that tag.
- **Upstream commits pulled**: 15 (`e56c8eef292..954e8de6a17`), one replay of 1831 fork commits onto the tag.
- **Fork sync**: nothing new on `main` since `3b3f35f85b7`; `integratedForkHead` unchanged.
- **Base**: `branding/config.json` `upstream.version` → `3.4.0-rc.2` (with AGENTS.md, README, the two
  switching guides, the revert-script notes and the branding-targets pin). rc.2 adds no migrations, and
  `ghcr.io/immich-app/immich-server:v3.4.0-rc.2` is published.
- **Product gate**: did not fire. Every commit is a fix, a CI change or the version bump.
- **Risk**: LOW. **Recommendation**: PROCEED to remote CI.
- Backup of the pre-cycle tip: `backup/rolling-pre-rc2-20261105` (`3a9439b144e`, pushed).

## Upstream changes

| SHA           | Summary                                           | Area        | Risk   | Notes                                                                                     |
| ------------- | ------------------------------------------------- | ----------- | ------ | ----------------------------------------------------------------------------------------- |
| `a9de9b5402a` | OAuth claim regressions (immich-32937)            | server      | LOW    | clean; fork's auth.service changes are elsewhere                                          |
| `d035c20d85c` | FUTO Backups excluded from OpenAPI (immich-32936) | server, sdk | LOW    | fits the dormant decision; spec and SDK regenerated; only upstream e2e specs used the API |
| `a2f90f39071` | web error handler (immich-32941)                  | web         | LOW    | merged under the fork's `init` hook                                                       |
| `d208b736a73` | people page websockets (immich-32942)             | web         | LOW    | fork's People page already registered the handler in `onMount`                            |
| `e63d89f19c6` | CI rate limits (immich-32945)                     | CI, e2e     | MEDIUM | GHCR logins rewired to `github.token`, see below                                          |
| `e5f4c1afb8e` | sync-partner medium flake (immich-32950)          | server test | LOW    | clean                                                                                     |
| `87929bb40a1` | onnxruntime telemetry off (immich-32959)          | ML          | LOW    | clean                                                                                     |
| `912cbb8b99d` | only valid ISO values (immich-32971)              | server      | LOW    | reapplied in reconcile                                                                    |
| `2db9d676ee4` | motion photo video range guard (immich-32972)     | server      | LOW    | supersedes the fork's narrower guard, see below                                           |
| `2cea12d70cd` | scroll memory as an attachment (immich-32975)     | web         | MEDIUM | `UserPageLayout` loses `use`; two fork files ported, see below                            |
| `d98b5e946a9` | help and support modal refactor (immich-32976)    | web, i18n   | MEDIUM | **zero-conflict branding break**, see below                                               |
| `ea26566f596` | asset viewer gradients (immich-32977)             | web         | LOW    | clean                                                                                     |
| `d9e7f0e2c8a` | asset viewer reactivity (immich-32979)            | web         | LOW    | `$derived` reapplied in DetailPanel; GalleryViewer already level                          |
| `e704eec136e` | mobile: log out before DB reset (immich-32982)    | mobile      | LOW    | imports unioned; fork's memory API override added to upstream's new tests                 |
| `954e8de6a17` | version v3.4.0-rc.2                               | all         | LOW    | `mobile/pubspec.yaml` keeps the fork's version                                            |

No upstream migrations, no Drift schema change, no FK-registry key touched.

## How the replay was driven

One `git rebase 954e8de6a17` over 1831 commits, `rerere` off. The driver auto-resolved only the
regenerated artifacts and, for the 54 files rc.2 touches, took the fork side at the 22 commits where they
conflicted (the first was the original fork squash, whose `metadata.service.ts` region aligned
asymmetrically). Every other conflict, and every markerless one, would have stopped the replay; none
occurred. `chore(rolling): reconcile fork files with v3.4.0-rc.2` then three-way-merged each rc.2 file
(base `e56c8eef292`, theirs rc.2) onto the replayed tip: 33 already level, 3 merged clean, 17 resolved by
hand. A line-level audit then confirmed every line rc.2 adds is present and every line it removes is
gone, except the intentional divergences below.

Whole-tree check against the pre-cycle tip: 62 files differ, 51 from rc.2 and 11 edited on purpose (base
bump, branding, People page, preflight lists). No zero-byte files, no retired directory refilled.

## Resolutions worth knowing

- **Motion photo guard** (`metadata.service.ts`): upstream's `length <= 0 || padding < 0 || position < 0`
  replaces the fork's `position < 0` guard. The read keeps the fork's `effectiveOriginalPath` (local
  staging for S3 originals). The fork's negative-position spec case stays (upstream's covers negative
  padding) and now expects upstream's warning text.
- **Scroll memory** (immich-32975): `UserPageLayout` swapped its `use` action array for forwarded
  attachments. The fork's People page lives in `web/src/lib/gallery/people/PeoplePage.svelte` behind a
  12-line route wrapper, so upstream's route edit never reached it: ported by hand to
  `{@attach scrollMemory(...)}`. Doing so also fixed a latent bug upstream fixed in its own copy: the
  restore hook was passed as `beforeLoad`, an option `scrollMemory` never read, so returning to the People
  page did not reload its infinite-scroll pages. It is now `beforeScroll`.
  `FilteredTimelinePage.svelte` forwarded `use` to the layout with no caller setting it; svelte-check
  caught it, and the forward is dropped.
- **test.yml** (immich-32945): the fork has no `create-workflow-token` step, so the token-action bumps and
  `permission-packages` lines do not apply. The three new GHCR logins would have read
  `steps.token.outputs.token` (empty); they use `github.token`. The `script-unit-tests` job stays
  dropped.
- **pnpm-lock.yaml**: regenerated for e2e's new `@futo-org/backups-orchestrator-ui` devDependency with
  `injectWorkspacePackages` temporarily off; zero `version: file:` entries, frozen install passes.
- **e2e/docker-compose.yml**: upstream's GHCR valkey image and digest (the fork's copy had the GHCR name
  with Docker Hub's digest).

## Zero-conflict break: help modal branding (immich-32976)

`apply-branding.sh` rewrote the modal's docs link by literal `sed` on
`` `https://docs.${info.version}.archive.immich.app/overview/introduction` ``. rc.2 moved the link into
`ExternalRoute.docs()` in `route.ts` (`https://docs.immich.app/overview/quick-start`), so the rewrite
matched nothing. `verify-branding.sh` would have failed Test Branding (it requires the Gallery docs URL),
so this was a CI round, not a shipped leak. rc.2 also added a "latest version" link to Immich's releases
and a `support_ensure_latest` string naming Immich.

Fixed in `fix(branding): rebrand the v3.4.0-rc.2 help modal links`: the docs URL is rewritten in `route.ts`,
the releases link in the modal (ordered before the source-URL rewrite, whose pattern is a prefix of it),
`verify-branding.sh` checks both, and `branding/i18n/overrides-en.json` gains `support_ensure_latest`.
`gallery-branding-check.sh` passes.

## Fork feature verification

| Feature                    | Status | Notes                                                   |
| -------------------------- | ------ | ------------------------------------------------------- |
| Shared Spaces / RBAC       | OK     | access oracle 197, RBAC oracle 15, snapshots unchanged  |
| S3 storage                 | OK     | motion-photo read keeps local staging                   |
| People (Spaces)            | OK     | People page scroll restore ported                       |
| Branding                   | OK     | help modal fixed, branding check passes                 |
| Migration ledger           | OK     | ledger medium spec 18; no migrations in rc.2            |
| FUTO Backups (dormant)     | OK     | now also excluded from OpenAPI by upstream              |
| Mobile memory lane / reset | OK     | upstream's reset flow plus the fork's memory API wiring |

## Layering

- Upstream files whose fork diff grew: `FilteredTimelinePage.svelte` and `PeoplePage.svelte` are fork
  files. DetailPanel (169 lines) and GalleryViewer (280) are unchanged in size; `metadata.service.ts`
  shrank (the fork guard is gone).
- `i18n/*.json` untouched by the fork; `merge.mjs --check` passes.
- Access / RBAC oracle snapshots unchanged.

## Gates fixed this cycle

- `tools/upstream-preflight/src/fork-deletions.ts`: upstream's `mobile/test/presentation/pages/search_page_test.dart`
  (immich-31800, added on `release/v3.4` after rc.1) is listed as a fork deletion with the mobile search
  page (#654). The gate diffs against the base tag, so the bump surfaced it.
- `docs/fork/ownership.yml`: the `s3Storage` symbol check points at `server/src/gallery/dtos/server.dto.ts`,
  where #1214 moved it.

## Local CI verification

| Check                                           | Status | Notes                                                  |
| ----------------------------------------------- | ------ | ------------------------------------------------------ |
| server `pnpm build`, `pnpm check`               | PASS   |                                                        |
| server unit                                     | PASS   | 7624                                                   |
| web `check:typescript`, `check:svelte`          | PASS   | 707 files, after the `FilteredTimelinePage` fix        |
| web unit                                        | PASS   | 7076                                                   |
| web / server eslint + prettier on changed files | PASS   | `tscompat` off                                         |
| e2e `pnpm check`                                | PASS   |                                                        |
| mobile `dart analyze --fatal-infos`             | PASS\* | \*5 errors only in stale gitignored drift test schemas |
| mobile reset-flow tests                         | PASS   | 3                                                      |
| ML ruff, mypy, pytest                           | PASS   | 287                                                    |
| preflight suite                                 | PASS   | 352                                                    |
| post-rebase audit, fork patches, CI invariants  | PASS   | Generated Artifact Review informational (FUTO removal) |
| mobile drift rebase check                       | PASS   |                                                        |
| access / RBAC oracles, ledger, sync-partner     | PASS   | 197 / 15 / 18 / 6                                      |
| branding check, i18n overlay check, autolinks   | PASS   |                                                        |
| OpenAPI spec + TS SDK regenerated               | PASS   | FUTO paths removed, as upstream                        |

## Remote CI verification

All 12 workflows green on `135335a4aeb`:

| Workflow                    | Run           | Result                                                                                 |
| --------------------------- | ------------- | -------------------------------------------------------------------------------------- |
| Test                        | `41986588525` | green on attempt 2, see below                                                          |
| Gallery Test                | `41987238650` | green                                                                                  |
| Docker                      | `41986847359` | green                                                                                  |
| Static Code Analysis        | `41986650020` | green                                                                                  |
| Gallery Build Mobile        | `41986711576` | green (iOS + Android)                                                                  |
| Gallery Mobile Smoke        | `41987143971` | green on attempt 2, see below                                                          |
| Gallery ML Smoke            | `41987068911` | green                                                                                  |
| Gallery Rebase Smoke        | `41986919401` | green                                                                                  |
| Storage Migration Tests     | `41986994228` | green                                                                                  |
| Storage Migration E2E       | `41987212539` | green                                                                                  |
| Revert-to-Immich Validation | `41988630726` | green with `gallery-server:rolling-v34-rc10` against stock `immich-server:v3.4.0-rc.2` |
| Release Candidate Build     | `41988933123` | `rolling-v34-rc11`, server and ML                                                      |

Attempt-1 failures, all on code rc.2 does not touch, all green on rerun with no change:

- **E2E Server & CLI (arm)**: the e2e server exited with code 135 (SIGBUS) mid-suite while generating
  thumbnails; every later request was `ECONNREFUSED`. Same signature as the untraced SIGBUS seen on two
  fork PRs in October. The amd64 job was cancelled with it.
- **E2E Web, maintenance**: `enter and exit maintenance mode` stayed on "Server is restarting" past its
  10 s window; the retries then 404ed because the server was left in maintenance mode.
- **Mobile Smoke**: two timing-based celebration cases in `rewind_page_test.dart` (Library Cleanup). The
  same file passed in Test's Unit Test Mobile on the same commit and locally (21/21).

## Staging

`rolling-v34-rc11` (server and ML) deployed to staging; gitops `056d117` (ML) and `5e4603f` (server).
Live-DB parity before the deploy: 0 orphans, 1 pending (`1799800000000-ScopeJitOffToDatabase`, from the
#1214 fork sync). Dump: `~/gallery-backups/staging-pre-rolling-v34-rc11-2026-11-05.dump`, checksum
matched the pod copy (the plain `kubectl exec cat` stream truncated twice; copied in 8 MiB chunks).

On boot the jit migration ran (`jit=off` now on the database, role setting reset) and both workers
report no schema drift; 0 restarts, no ERROR lines. `/server/version` reports `3.4.0-rc.2` to a stock
client and `5.10.0-rc.1` to a Gallery client. CLIP text inference from the server pod returns 200. The
deployed web bundle has no Immich docs or releases link, carries Gallery's, and the branded
`support_ensure_latest` string. Authenticated API checks were not run (no test key minted on staging).
