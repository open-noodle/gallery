# Upstream Sync Report — 2026-08-02 (fork-sync only)

## Summary

- **Upstream commits pulled**: **0** — `upstream/main` has not moved since 2026-08-01
- **Fork commits synced**: 7 (`88e715507c6..78d1223a289`, #897 → #887)
- **Conflicts resolved**: 0
- **Risk level**: LOW
- **Recommendation**: PROCEED

Branch `rebase/upstream-rolling-v3.1.1` remains **level with `upstream/main`** at `cafd6c7c0f1`
(`git rev-list --count HEAD..upstream/main` = 0). Branch HEAD after this sync: `d84e734bc3d`.

This cycle contains **no upstream work at all**. `git fetch upstream main` left
`refs/remotes/upstream/main` unchanged at `cafd6c7c0f12add9b2c0f06a0cc1c26ef26e2756`, the tip arc 5
integrated the day before. The only outstanding work was the fork side: seven PRs merged to
`origin/main` while the rolling branch was off main.

Because there are no incoming upstream commits, the **per-batch product-direction gate does not
apply** — there is no upstream product decision to weigh against a fork surface this cycle.

## Incoming Fork Changes

Applied by `make upstream-sync-fork-main` (cherry-pick of `integratedForkHead..origin/main` onto the
rolling tip). Listed in application order; the SHA column is the replayed SHA on this branch.

| Replayed SHA  | Origin SHA    | Summary                                                                                        | Area              | Risk |
| ------------- | ------------- | ---------------------------------------------------------------------------------------------- | ----------------- | ---- |
| `f07a0e30046` | `52c9e451aaa` | apply locked-folder visibility to person search, thumbnails, and the face picker (#869) (#897) | server            | LOW  |
| `57cacd8dc41` | `70714160f92` | use the justified, selectable gallery for search results (#908) (#914)                         | web               | LOW  |
| `845749cb5c0` | `3318da16a00` | animate the branded loading spinner (#900) (#907)                                              | web + `mise.toml` | LOW  |
| `8593507912d` | `a2c01be16cc` | apply search-palette tag picks as a filter, not a `/search` jump (#894) (#895)                 | web               | LOW  |
| `45c5f870e25` | `11bc164d225` | include shared-space assets in palette filename/description/OCR search (#894) (#896)           | web               | LOW  |
| `6bb09a195aa` | `d4ba3ffc740` | touch-friendly search palette entry and `/` shortcut (#885)                                    | web               | LOW  |
| `d84e734bc3d` | `78d1223a289` | wrap long tag names in the Filter panel (#881) (#887)                                          | web               | LOW  |

Whole-sync delta: **50 files, +4657 / −333**, distributed as 35 × `web/src`, 7 × `server/src`,
3 × `server/test`, 4 × `docs/superpowers`, 1 × `mise.toml`. Not touched: **no migrations, no DTOs,
no controllers, no `open-api/`, no `i18n/`, no `pnpm-lock.yaml`, no mobile code, no CI workflows.**
That file-class evidence is what bounds the risk of this sync, and it was derived rather than
assumed (`git diff --name-only 88e715507c6..origin/main`).

### The one file that could have collided: `mise.toml`

`845749cb5c0` (#907) rewrites 16 internal task references from `//:<task>` to `:<task>` — the fix
for `mise run` resolving against the outermost checkout instead of the current worktree. The rolling
branch had independently diverged in the same file (pnpm `11.13.1`→`11.17.0`, opentofu
`1.12.4`→`1.12.5`, and `open-api-dart`'s `outputs` retargeted to `../mobile/generated/openapi/` by
the #888 build-time-codegen adoption).

The cherry-pick merged both cleanly. Verified post-sync rather than trusted:

- `grep -c '//:' mise.toml` → **0** (the fork's fix landed in full)
- `git diff origin/main HEAD -- mise.toml` → shows **only** the three rolling-branch divergences
  above, i.e. nothing of the fork's change was lost and nothing of the branch's was reverted

`.github/workflows/test.yml` still invokes `mise run //:sdk:install` / `//:sdk:build`; that is
correct and unaffected — CI runs from a plain checkout where `//:` and `:` resolve identically. The
`//:`→`:` change only matters inside nested worktrees.

## Conflict Resolutions

**None.** `make upstream-sync-fork-main` reported `Synced 7 fork commits from origin/main` with no
conflict stops and no rollback. The command is all-or-nothing (any conflict `reset --hard`s the whole
batch), so a clean completion is itself evidence that all 7 applied without manual intervention.

State advanced automatically: `integratedForkHead` `88e715507c6` → `78d1223a289`,
`lastForkSyncAt` `2026-08-02T08:26:08Z`, plus an `appendHistory` entry listing all 7 commits.

## Gate Checks

Run by the sync command itself, recorded in `checkHistory` with `ok: true`:

| Check                                | Status |
| ------------------------------------ | ------ |
| `make fork-ownership-coverage-check` | PASS   |
| `make ci-invariants-check`           | PASS   |
| `make fork-patches-check`            | PASS   |

The ownership cursor (`docs/fork/ownership.yml` `last_verified_fork_head`) was already current at
`88e715507c6` going in — the orphaned-cursor failure mode from the batch 12–14 delta did not recur.

## Fork Feature Verification

No fork feature surface was modified by upstream this cycle (there was no upstream cycle). The seven
fork commits extend existing fork features rather than altering their contracts.

| Feature                                                                  | Status | Notes                                                                                                                                                |
| ------------------------------------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Global Search / Command Palette                                          | OK     | extended by #895/#896/#885 — tag picks apply as filters, shared-space assets included in filename/description/OCR search, touch entry + `/` shortcut |
| Filter Panel                                                             | OK     | extended by #887 — new `tag-filter-row.svelte` with long-name wrapping                                                                               |
| Smart Search (results surface)                                           | OK     | #914 moves search results onto the justified, selectable gallery                                                                                     |
| Shared Spaces                                                            | OK     | `space-search-results.svelte` refactored with the shared gallery viewer                                                                              |
| Locked-folder visibility                                                 | OK     | #897 threads elevated permission through person search / thumbnail / face picker                                                                     |
| Branding                                                                 | OK     | #907 spinner animation; branding config untouched                                                                                                    |
| Storage Migration / Pet Detection / Image Editing / Google Photos Import | OK     | untouched                                                                                                                                            |

## Database Migration Analysis

**No migrations were added or modified by this sync.**

- Gallery migration count: **49** — unchanged, matches the documented count
- `pnpm build` postbuild: `Synced 49 Gallery migrations into dist/schema/migrations; removed 0 stale
files; wrote 1 compatibility aliases.` — the `ChangeDurationToInteger` alias is intact
- `revert-to-immich.sql` coverage detector (same grep logic as the CI gate, run against the
  `v3.1.0` upstream tree): **zero `MISSING` entries**

## Mobile Drift Migration Analysis

**Not applicable** — no file under `mobile/` was touched by this sync
(`git diff --name-only 88e715507c6..origin/main | grep '^mobile/'` → empty). `schemaVersion` and the
`drift_schemas/main/` snapshot set are unchanged from the arc-5 state.

## Inconsistencies Found

None introduced by the sync. One pre-existing item observed while linting, recorded because it is
dead code rather than because it blocks anything:

- `web/src/routes/(user)/search/[[photos=photos]]/[[assetId=id]]/+page.svelte:65` —
  `searchResultTotal` is assigned (lines 168, 195) but never read, reported as an
  `@typescript-eslint/no-unused-vars` **warning**. The file is **byte-identical to `origin/main`**
  (`git diff origin/main HEAD -- <path>` is empty), so this is pre-existing on `main` and not a
  product of the sync or of the rolling branch's newer toolchain. `web`'s lint script carries no
  `--max-warnings`, so it does not fail CI. Presumably a leftover of #914's rework of that page.

## Pattern Propagation

No broad upstream refactor arrived this cycle. The standing propagations recorded in the skill
(TypeScript 6→7, unicorn v70→v72, mobile action model, Search V3 dormant coexistence) are unchanged
and were not re-exercised.

## Local CI Verification

Run against branch HEAD `d84e734bc3d`.

| Check                                            | Status | Notes                                                        |
| ------------------------------------------------ | ------ | ------------------------------------------------------------ |
| `pnpm install --frozen-lockfile`                 | PASS   | `Already up to date` — reproduces the CI lockfile gate       |
| `server pnpm build` (+ postbuild migration sync) | PASS   | 49 migrations + 1 compatibility alias                        |
| `server pnpm check` (tsc)                        | PASS   | clean                                                        |
| `server pnpm lint`                               | PASS   | `--max-warnings 0`                                           |
| `server` unit tests (`npx vitest --run`)         | PASS   | **157 files / 5264 tests**, 1 file + 14 tests skipped        |
| `web check:typescript`                           | PASS   | clean                                                        |
| `web check:svelte`                               | PASS   | **575 files, 0 errors, 0 warnings** (not the 0-file no-op)   |
| `web` eslint (`--concurrency 6`, `tscompat` off) | PASS   | **exit 0, 0 errors**, 21 warnings (see below)                |
| `web` unit tests (`npx vitest --run`)            | PASS   | **299 files / 4092 tests**, 1 file + 2 tests skipped, 8 todo |
| `revert-to-immich.sql` coverage detector         | PASS   | zero `MISSING`                                               |
| `mise.lock` / `mobile/mise.lock` untouched       | PASS   | `git status -- '*mise.lock'` empty                           |

The `--frozen-lockfile` run is deliberate: arc 4 lost a full CI round to an `ERR_PNPM_OUTDATED_LOCKFILE`
that every non-frozen local gate had hidden. No dependency manifest changed in this sync, and the
frozen install confirms it.

Of the 21 web lint warnings, 13 are `Unused eslint-disable directive` for `tscompat/tscompat` —
artifacts of the `--rule '{"tscompat/tscompat":"off"}'` override that is required locally, since
`@koddsson/eslint-plugin-tscompat@0.2.0` crashes the run outright otherwise. Those directives are
legitimate in CI. The remaining 8 (7 × unused disable for `unicorn/no-unnecessary-global-this`, 1 ×
`searchResultTotal`) are pre-existing and non-failing.

**Not run locally**: server **medium** tests. The `#897` commit adds 285 lines of them
(`person.service.spec.ts`, `search.service.spec.ts`) and they require a real database via
testcontainers; `test.yml`'s Medium Tests job is the gate for these. Called out explicitly rather
than silently skipped.

## Remote CI Verification

- **Test branch**: `rebase/upstream-forksync-20260802`
- **Commit validated**: `d84e734bc3d`

Dispatched in staggered waves (4 / 2 / 4) — a simultaneous 10-workflow dispatch reliably trips the
GHCR `toomanyrequests: … allowed: 44000/minute` limit during image pulls, and reducing concurrency
is what fixes it, not sleeping between dispatches.

**Result: 10 / 10 GREEN on the first pass**, every run on `headSha d84e734bc3d`. No re-runs, no
confirmed flakes, no GHCR or GitHub-API rate-limit hits — the 4 / 2 / 4 stagger held.

| Workflow                                  | Status | Run           | Notes                                                                                             |
| ----------------------------------------- | ------ | ------------- | ------------------------------------------------------------------------------------------------- |
| `test.yml`                                | GREEN  | `30740560858` | **21 / 21 jobs success** — incl. Lint Web, Medium Tests, OpenAPI Clients, `sql-schema-up-to-date` |
| `docker.yml`                              | GREEN  | `30740562151` | server / web / cli / ml image builds                                                              |
| `static_analysis.yml`                     | GREEN  | `30740562925` | dart analyze + format                                                                             |
| `gallery-rebase-smoke.yml`                | GREEN  | `30740563800` |                                                                                                   |
| `gallery-build-mobile.yml`                | GREEN  | `30740613424` | iOS + Android compile                                                                             |
| `gallery-mobile-smoke.yml`                | GREEN  | `30740614442` |                                                                                                   |
| `gallery-ml-smoke.yml`                    | GREEN  | `30741037890` |                                                                                                   |
| `storage-migration-tests.yml`             | GREEN  | `30741038737` |                                                                                                   |
| `storage-migration-e2e.yml`               | GREEN  | `30741040177` |                                                                                                   |
| `gallery-revert-to-immich-validation.yml` | GREEN  | `30741039515` | reached `Post-phase drift (0 item(s))` → `revert-to-immich validation PASSED`                     |

- **Failures fixed**: none — nothing failed.
- **Confirmed flakes**: none.

Two results are worth calling out because a green coverage grep or a green summary line is not
normally sufficient evidence for them:

- **`gallery-revert-to-immich-validation`** was checked past its coverage job into the Docker-boot
  half, which is the part that actually detects schema drift. The log reaches
  `Post-phase drift (0 item(s))` and `##[notice]revert-to-immich validation PASSED`.
- **`test.yml`** was inspected job-by-job rather than trusted on the workflow-level conclusion:
  21 jobs, 21 `success`, 0 skipped-but-required. This is where `sql-schema-up-to-date` lives, which
  is the gate that would have caught `server/src/queries/*.sql` cherry-picked from `main` going stale
  against the rolling branch's repositories.

Even though this sync was "already CI-green on `main`", re-dispatching was mandatory rather than
ceremonial: the rolling branch's toolchain is **ahead** of `main`'s, and a clean fork sync has twice
produced a red Lint Web here on rules `main` did not yet have (#826 / unicorn v72 on 2026-07-22,
#810 / `unicorn/prefer-string-repeat` on 2026-07-23). This sync carried ~20 new web spec files —
exactly the shape that triggered both. It came back clean this time, which is a result, not a
reason to stop dispatching.

## Post-Rebase Verification

- Fork commits ahead of upstream: **1068**
- Commits behind upstream: **0**
- Fork diff looks clean: **YES**

## Version References

`branding/config.json` `upstream.version` stays at **3.1.0** and `README.md` stays at
**Immich v3.1.0**. Upstream has still not tagged v3.1.1; the branch name is an expectation, and the
version string must not advance until the fork lands on a tagged upstream release.
