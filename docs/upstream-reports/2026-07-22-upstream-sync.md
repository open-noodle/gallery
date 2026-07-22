# Upstream Sync Report — 2026-07-22 (batches 24–35)

## Summary

- **Branch**: `rebase/upstream-rolling-v3.0.3` (held off `main`)
- **Upstream commits pulled**: 27 (batches 24–35, up to `73329a8ce`)
- **Fork commits synced from `origin/main`**: 2 (#824, #813)
- **Conflicts resolved**: 16 across 11 files
- **Batches complete**: 35 / 35 — **0 commits behind `upstream/main`**; the batch-33
  quarantine was reviewed and released (see below)
- **Risk level**: MEDIUM (TypeScript 7, eslint-unicorn v72, GitHub Actions major)
- **Recommendation**: PROCEED — **all 10 CI workflows green**

Three toolchain majors landed in this run — TypeScript 6→7, eslint-plugin-unicorn
v70→v72 and the GitHub Actions major. All three needed fork-side propagation that
upstream's own sweeps did not cover.

## Incoming Upstream Changes

| Batch | Tip         | Commits | Area                | Risk to Fork | Notes                                                         |
| ----- | ----------- | ------: | ------------------- | ------------ | ------------------------------------------------------------- |
| 24    | `2e587fc7e` |       1 | docs                | LOW          | Bulgarian readme; fork README kept its own NOTE block         |
| 25    | `e918658cc` |       1 | docker              | LOW          | mise image tag 2026.7.7 → 2026.7.11                           |
| 26    | `1b4d41324` |       4 | deps, server, web   | **HIGH**     | **TypeScript v7**, pnpm 11.13.1, upload-filename fix          |
| 27    | `ce022233a` |       1 | docker              | LOW          | base-image → v202607211135                                    |
| 28    | `aa08dad1f` |       1 | lint                | **HIGH**     | **eslint-plugin-unicorn v72**                                 |
| 29    | `ae8398ffe` |       1 | docker              | LOW          | valkey digest bump                                            |
| 30    | `e6fff3b15` |       6 | mobile, web, server | MEDIUM       | Android startup refactor, web palette entry, lens-model fix   |
| 31    | `59bc81423` |       1 | ci                  | **HIGH**     | **github-actions major** across 15 workflows                  |
| 32    | `7a7303ace` |       5 | mobile              | MEDIUM       | album picker, photo_manager pin, maplibre SwiftPM lock        |
| 33    | `ee4bd3f83` |       1 | server, mobile      | **HIGH**     | album asset events (#29008) — quarantined, reviewed, released |
| 34    | `d5adfb97d` |       3 | mobile, web         | MEDIUM       | album add-error surfacing, slideshow controls, iOS ethernet   |
| 35    | `73329a8ce` |       1 | server              | **HIGH**     | OIDC logout id_token_hint (#29720) + session migration        |

### High-risk changes — detailed analysis

#### Batch 26 — TypeScript v7 (#29903)

Upstream did **not** simply bump the compiler. It installed both majors side by side:

- `typescript` is aliased to `npm:@typescript/typescript6` — ships its binary as **`tsc6`**
- `@typescript/native` is aliased to `npm:typescript@7` — ships **`tsc`**

Every `tsc --noEmit` script in the repo (server, web, e2e, cli) therefore now runs
**TypeScript 7**, while TS 6 stays available for the editor, `svelte-check` and
`typescript-eslint`. This is the opposite of the initial reading — the migration is
not opt-in, and the fork's ~3,100 changed files were type-checked by TS 7 for the
first time here.

Fork breakage was narrow but real: **2 errors** in `server/src/utils/database.ts`.
`hasPeople` and `hasFaceIdentities` early-return the untouched builder when their id
list is empty, so each has a union return type (joined vs not joined). `hasAllPeople`
chained them directly, passing that union where `SelectQueryBuilder<DB, 'asset', O>`
is expected. TS 6 accepted it; TS 7 does not. Upstream never hits this because its
`hasPeople` has no early return and every caller guards with `$if`.

Fixed by rewriting `hasAllPeople` with the `$if` idiom already used at every other
fork call site (`asset.repository`, `search.repository`) — identical behaviour, no
casts. `packages/sdk`, `plugin-sdk` and `plugin-core` compile under TS 7.0.2, which
matters because `packages/sdk/src/fetch-client.ts` carries ~2,400 lines of
fork-generated endpoints.

The same commit moved pnpm to **11.13.1**. Two historical fork commits pinning pnpm
(11.5.2, then 11.6.0) are now fully superseded by the build-before-inject reorder in
`server/Dockerfile`, which survives intact; both were resolved to upstream's version.

#### Batch 28 — eslint-plugin-unicorn v72 (#30092)

Far smaller than the v70 sweep (27 files vs ~900). Upstream disabled the noisy new
`unicorn/prefer-simple-condition-first` in its server, web and cli configs.

Fork-only propagation needed:

- `web` — 5 errors: `prefer-split-limit` in `timeline-bucket`, `prefer-string-repeat`
  in the #813 Recently Added specs
- `server` — 1 leftover: the `extname` import orphaned by #30024 (see below)
- `e2e` — 52 errors; see "Pre-existing debt" below

#### Batch 31 — GitHub Actions major (#30095)

`actions/checkout` v6→v7, `actions/setup-node` v6→v7, `actions/cache` v5→v6 across
15 upstream workflows. Four conflicts, all cases where the fork had deleted the job
or step upstream was bumping. Each was resolved by keeping the fork's removal **and**
adopting upstream's new pin on the surviving steps, so no workflow silently stayed on
an old action.

The fork's own workflows are still on older pins (12× checkout v4.2.2, 8× v6.0.2, 2×
setup-node v6.2.0, 2× cache v5.0.4). This is **pre-existing** drift, not caused by
this batch — see "Follow-up work".

## Conflict Resolutions

| #   | File                                                       | Fork side                                                   | Upstream side                 | Resolution                                                                                               | Risk |
| --- | ---------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------- | ---- |
| 1   | `e2e/package.json`                                         | adds `tsx`                                                  | dual TS install               | kept both                                                                                                | LOW  |
| 2   | `server/src/services/asset-media.service.ts`               | `createReadStream`, `extname`, `isAbsolute`                 | dropped `extname`             | kept the fork import line so the ~948 downstream commits replayed cleanly; removed the orphan at the tip | LOW  |
| 3–5 | `mise.toml`, `mise.lock`, `package.json` (×3 commits)      | pnpm 11.5.2 / 11.6.0 / 11.11.0 pins                         | 11.13.1                       | took upstream; the pins are superseded by the Dockerfile reorder, which applied cleanly                  | LOW  |
| 6   | `packages/scripts/package.json`                            | deleted (#29331 tooling dropped)                            | modified                      | kept the deletion                                                                                        | LOW  |
| 7   | `pnpm-lock.yaml` (×2)                                      | fork lock w/ `@immich/ui` patch, axe-core, faker pin        | upstream TS7 lock             | kept fork side mid-replay, regenerated with `pnpm install` at the end                                    | LOW  |
| 8   | `MemoryViewer.svelte`                                      | `isHistorySource` conditional promise                       | `.then().catch()` restructure | combined both                                                                                            | LOW  |
| 9   | `e2e/docker-compose.yml`                                   | valkey from ghcr (Docker Hub rate limits)                   | new docker.io digest          | fork registry + upstream digest, after confirming both digests resolve on ghcr (HTTP 200)                | LOW  |
| 10  | `.github/workflows/auto-close.yml`                         | template-enforcement jobs removed                           | checkout bump inside them     | kept the deletion; only `close_llm` remains                                                              | LOW  |
| 11  | `docs-destroy.yml`, `prepare-release.yml`, `test.yml` (×4) | deleted / token steps removed / `script-unit-tests` dropped | action bumps                  | kept every fork removal, adopted upstream's pins on surviving steps                                      | LOW  |

## Verification

### Local gate — all green

| Check                                                     | Result                                  |
| --------------------------------------------------------- | --------------------------------------- |
| server prettier / eslint / `tsc` (TS 7) / `tsc6` (TS 6)   | PASS (0/0/0/0)                          |
| server unit tests                                         | PASS — 5099 passed, 9 skipped           |
| web prettier / eslint / `tsc`                             | PASS — 0 errors                         |
| web `svelte-check`                                        | PASS — 568 files, 0 errors, 0 warnings  |
| web unit tests                                            | PASS — 3752 passed, 2 skipped, 8 todo   |
| mobile `dart analyze --fatal-infos`                       | PASS — no issues                        |
| mobile `dart format`                                      | PASS — 791 files, 0 changed             |
| mobile tests                                              | PASS — 2819 passed, 1 skipped           |
| mobile codegen freshness (`build_runner`)                 | PASS — 190 outputs, **0 files changed** |
| e2e prettier / eslint / `tsc`                             | PASS (0/0/0)                            |
| cli + `.github` gates                                     | PASS                                    |
| `@immich/sdk`, `plugin-sdk`, `plugin-core` under TS 7.0.2 | PASS                                    |

Toolchain note: mobile must be driven through `mise exec` from `mobile/`
(Flutter 3.44.6 / Dart 3.12.2). `mise run codegen:dart` resolved Flutter **3.44.0**
against a pubspec requiring 3.44.6 and failed; `mise exec -- dart run build_runner`
is the working path.

### Remote CI

All ten workflows were dispatched. First round: `docker`,
`storage-migration-tests`, `storage-migration-e2e`, `gallery-ml-smoke`,
`gallery-revert-to-immich-validation` and `gallery-build-mobile` passed; three
failed, from two causes — both fixed and re-dispatched.

**1. Lockfiles clobbered by a local `mise` run (the big one).** Every job that
runs `Setup Mise` died at `mise install --locked` with
`<tool>@<ver> is not in the lockfile`, naming `jellyfin/jellyfin-ffmpeg` (root
`mise.toml`) and `java` / `CQLabs/homebrew-dcm` (`mobile/mise.toml`). That is
all 12 `test.yml` jobs plus `static_analysis` and `gallery-mobile-smoke` — one
root cause presenting as fourteen failures.

The cause was **not** the batch-26 `mise.lock` conflict resolution, which was
correct. Driving the mobile gates through `mise exec` / `mise run` from
`mobile/` — required, per the Flutter-version note above — **rewrites the
lockfiles in place, keeping only the host machine's platforms**. A `git add -A`
in an unrelated e2e-lint commit then committed both: `mise.lock` −55 lines (the
fork's per-platform `jellyfin-ffmpeg` blocks) and `mobile/mise.lock` −124 lines
(every non-macOS `homebrew-dcm` and `java` block).

Repaired by restoring `mobile/mise.lock` from the batch-23 checkpoint (upstream
never touched it in 24–32; it is byte-identical to upstream's copy at the batch-32
tip) and restoring the fork's root lock with only upstream's pnpm 11.13.1 blocks
spliced back. Verified: `mobile/mise.lock` md5 matches the checkpoint exactly,
and root `mise.lock` differs from the checkpoint in pnpm fields and nothing else.

**Rules this earns: never `git add -A` during a rebase, and run
`git status -- '*mise.lock'` after any local `mise` invocation.**

**2. The lockfile regen silently switched workspace linking from symlink to
injected copy — the single cause behind `Test` and `gallery-rebase-smoke`.**

`pnpm-workspace.yaml` has carried `injectWorkspacePackages: true` since
upstream's npm→pnpm migration (#19752), but the committed lockfile predates the
flag and every install runs `--frozen-lockfile`, so it was **never actually
applied**: upstream's lockfile resolves workspace deps as `link:` (symlink) and
so did ours. Regenerating with `pnpm install --no-frozen-lockfile` in batch 26
re-resolved them and applied the dormant flag, flipping 5 of 9 workspace deps
from `link:` to `file:`.

An injected dep is a **snapshot** taken when the consumer installs; pnpm does
not re-sync it after the dependency is built later. On a cold CI checkout
`packages/sdk/build` does not exist yet, so every consumer received an SDK with
no build output — `Could not resolve "@immich/sdk"` from plugin-sdk's esbuild,
and TS2307 across web. That is `SQL Schema Checks`, `Test Web`,
`End-to-End Lint`, `Unit Test CLI`, the E2E suites, and `gallery-rebase-smoke`.

Three wrong diagnoses were discarded on the way, each disproved by experiment:
that the fork's `[tasks.plugins]` reorder was at fault (upstream's ordering
fails identically on the fork tree), that pnpm 11.13.1 was at fault (pinning
11.11.0 does fix the symptom, but a **pristine upstream worktree at the same
commit builds fine cold on 11.13.1**), and that `injectWorkspacePackages` was a
fork-only setting (it is upstream's, with the same value). The discriminator was
the lockfile: `version: link:../sdk` upstream versus `version: file:packages/sdk`
here.

Fixed by regenerating from the batch-23 lockfile with the flag temporarily off,
preserving the `link:` shape, then restoring the flag — `pnpm-workspace.yaml` is
unchanged and still matches upstream, and the lock is back to `link:9 / file:0`.
Verified cold (`rm -rf node_modules packages/sdk/build`, pnpm 11.13.1): the full
`[tasks.plugins]` sequence builds plugin-sdk and plugin-core. No pnpm pin was
needed, and no fork divergence was added.

**The rule this earns: never run `pnpm install --no-frozen-lockfile` casually on
this repo.** It does not merely refresh versions — it re-resolves workspace
linking and can activate dormant `pnpm-workspace.yaml` settings the committed
lockfile never had. After any regen, check
`grep -c 'version: link:' pnpm-lock.yaml` against the previous value.

`gallery-rebase-smoke.yml` was separately reordered to build the SDK before the
full install, matching `test.yml`'s "Run setup @immich/sdk" step and
`server/Dockerfile`. With `link:` restored that ordering is no longer
load-bearing, but it is kept as defence in depth.

### Rebase audits — all green

Post-rebase audit (7 checks) ran per batch; `ci-invariants-check`,
`fork-patches-check` and `mobile-drift-rebase-check` all pass at the tip. Fork
migration count steady at 48. No upstream migration timestamp collisions.
`revert-to-immich.sql` coverage detector reports **0 missing** — no migration
entered the tree in batches 24–32, so batch 35's `AddOAuthBearerTokenToSession`
will be the next one to need an entry.

A full-tree conflict-marker scan was run after **every** batch, not only at the end.

### Repo integrity

During batch 30 a concurrent `git gc`/repack removed a packfile mid-rebase, producing
`packfile ... index unavailable` errors. The rebase still reported success and was
verified sound afterwards: pack/index counts match (5/5), `git archive HEAD` reads
every object in the tree, and a full `git rev-list --objects` walk exits 0.

## Pre-existing debt found and fixed

Two classes of debt predating this run were surfaced by the full gate and closed:

1. **Formatting** — 24 server files and 2 web files failed `prettier --check`, which
   CI runs over the whole package (`mise //server:ci-unit` → `:format`). All were
   fork-touched. The batch 18–23 run checked only the files it modified, so this had
   been red since then. Formatting-only fix; no import removal, no semantic change.

2. **e2e lint** — 52 eslint-unicorn errors across 20 fork-touched files. The v70
   propagation covered server and web but skipped e2e, which CI does gate
   (`mise //e2e:ci-unit` → `:lint`). Verified pre-existing by running today's config
   against the pre-batch-24 file contents (identical error counts). Closed as:
   23 autofixed, 24 hand-fixed (all behaviour-preserving — see the commit message for
   the per-rule reasoning, notably that `parseInt(s, 10)` → `Number(s)` was checked
   per site rather than applied blindly), and 3 harness-hostile rules disabled for
   e2e only — `no-top-level-side-effects`, `no-top-level-assignment-in-function`,
   `no-break-in-nested-loop`. That mirrors the precedent upstream set in this very
   batch, and `e2e/src/utils.ts` already carried file-level suppressions for two of
   them, which are now redundant and removed.

## Product-direction gate

Applied per batch. It did **not** fire as a blocker, but one finding is worth
recording.

**Upstream continues to develop its own command palette.** `e6fff3b15` adds a
Maintenance entry to `getPagesProvider` in `web/src/lib/commands.ts`. In the fork
that provider is **dead code** — `commands.ts` is imported only for
`getMyImmichLink`, and the live palette is the fork's cmdk implementation driven by
`web/src/lib/managers/command-items.ts`. The commit is therefore inert here.

The divergence is deliberate and long-standing, so quarantining would have been
wrong. But it now has a concrete user-visible cost: the fork **has** `/admin/maintenance`
(route and page both exist) and its palette has **no** entry for it, so fork admins
cannot jump there from cmd+K. Every future entry upstream adds will miss fork users
the same way. Logged as follow-up.

Also checked and dismissed: `899f54705` fixes an empty-string `lensModel` bug in
`SearchFilterModal.svelte`, a component the fork deleted with the legacy SearchBar
flow (#416). The fork's filter panel builds typed filter state rather than a
free-text form, and `lensModel` appears only in display/deep-link paths with real
values, so the bug does not apply.

## Quarantine review — batch 33 released

Batch 33 (`ee4bd3f83`, "add album asset event handling", #29008) was held by the
2026-07-21 product-direction gate on the concern that upstream was building the
thing the fork already built, leaving two parallel album-event models.

**Reviewed 2026-07-22 and released.** The two models are complementary, not
competing:

|                                     | payload                   | purpose                                       |
| ----------------------------------- | ------------------------- | --------------------------------------------- |
| upstream `AlbumUpdate`              | `userIds`, `recipientIds` | who to notify — notification/websocket fanout |
| fork `AlbumAssetsAdd/Remove/Delete` | `assetIds`                | what changed — space-album sync               |

Upstream's reshaped event carries no asset-level granularity, so it cannot replace
the fork's three events even if convergence were wanted. The only genuine overlap is
that both touch `album.service.ts`, which makes it a conflict-resolution job rather
than a product fork. Pierre approved pulling 33–35 on that basis; the decision and
its reasoning are recorded in `rolling-state.json` under `quarantineHistory`.

### Batches 33–35 — what it took

Five conflicts, all in the album surface and all resolved as unions:

- `album.service.ts` ×3 — the fork's #749, its revert, and the #752 re-land each
  collide with upstream's collapse of the per-recipient `AlbumUpdate` loop. Each was
  resolved as upstream's single reshaped emit **plus** the fork's `AlbumAssetsAdd`
  (and the revert correctly drops only the fork half).
- `workflow-core-plugin.spec.ts` — upstream added the same `emit` stub the fork had;
  kept the fork's comment explaining why it exists.
- `drift_album_api_repository_test.dart` — add/add: upstream and the fork each created
  this file. Merged both suites; upstream's cases were adapted to the fork's
  constructor, which takes an `ApiService` rather than an `AlbumsApi`.

Three follow-on fixes were needed that no conflict surfaced:

1. **An inherited upstream bug.** #29008 reshaped the `AlbumUpdate` payload but did
   not update `asset-media.service.ts`'s `addToSharedLink`, which still emits the
   pre-#29008 `recipientId` shape. `upstream/main` carries the same stale call site
   and does not type-check there — no commit between `ee4bd3f83` and `73329a8ce`
   fixes it. **Worth reporting upstream.**
2. `server/test/small.factory.ts`'s `sessionFactory` is fork-added, so it never got
   the `oauthBearerToken` column from batch 35 — 16 tsc errors.
3. The fork-only `drift_remote_album_page_test` still stubbed `getDateRange`, which
   #29008 renamed to `watchDateRange` and changed from a Future to a Stream.

`revert-to-immich.sql` gained both halves for batch 35's
`1784647658615-AddOAuthBearerTokenToSession`: an idempotent
`DROP COLUMN IF EXISTS` in step 7 (the script also runs against a tagged `:main`
image whose DB never had the column, where the migration's own `down()` would throw)
and the load-bearing `kysely_migrations` row deletion in step 8. Detector back to
0 missing.

The batch-35 audit flagged `server/src/queries/session.repository.sql` for review;
it is byte-identical to upstream's own regenerated file, so there was nothing to
reconcile.

## Follow-up work

1. **Command-palette Maintenance entry** — add `/admin/maintenance` to the fork's
   `command-items.ts` to match upstream's `getPagesProvider`, and decide whether the
   two palettes should be reconciled or the dead `getPagesProvider` dropped.
2. **Fork workflow action pins** — bump the fork's own workflows to checkout v7 /
   setup-node v7 / cache v6. Pre-existing drift; the v4.2.2 pins are old enough to be
   worth attention. Deliberately deferred: these workflows push images, sign mobile
   builds and deploy docs, and bumping 24 pins mid-rebase adds risk without benefit.
3. **Report the `addToSharedLink` bug upstream** — `upstream/main` emits the
   pre-#29008 `AlbumUpdate` payload in `asset-media.service.ts` and does not
   type-check there; the fork carries a local fix.

## Post-Rebase Verification

- Upstream base in HEAD: `73329a8ce` (batch 35 tip = `upstream/main`)
- Fork commits ahead of that base: 951
- Commits behind `upstream/main`: **0**
- Working tree clean; no conflict markers anywhere in the tree

## Remote CI — final result

All ten workflows green: `test`, `docker`, `static_analysis`, `gallery-rebase-smoke`,
`storage-migration-tests`, `storage-migration-e2e`, `gallery-revert-to-immich-validation`,
`gallery-ml-smoke`, `gallery-mobile-smoke`, `gallery-build-mobile`.

Nine passed on `6e952c8855`; `Test` passed on `cd39912b71`, whose only delta is the
six-line medium-spec fix below, so the other nine carry forward.

Failures seen along the way, each with a proven cause rather than an assumed one:

| Workflow                      | Cause                                 | Evidence                                                                                                       |
| ----------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Storage Migration Tests / E2E | registry rate limit                   | `toomanyrequests ... allowed: 44000/minute` in both logs; passed on re-run                                     |
| Gallery Rebase Smoke          | environmental                         | no rate-limit line in its log, so left unproven at the time; passed on re-run with no change                   |
| Gallery Mobile Smoke          | D8 `OutOfMemoryError` (heap pressure) | passed on re-run with no config change; `gallery-build-mobile` — the heavier build — passed on the same commit |
| **Test**                      | **real, and self-inflicted**          | the medium spec still asserted the pre-#29008 two-property `AlbumUpdate` payload                               |

Dispatching all ten workflows simultaneously is what tripped the registry limit;
staggered re-dispatches cleared it.

The one real failure is worth recording: fixing the inherited upstream
`addToSharedLink` bug meant the medium spec asserting the old payload had to move
with it. Upstream left both on the pre-#29008 shape. Verified locally against a real
database before pushing — the spec passes (12 tests) and the run applies
`1784647658615-AddOAuthBearerTokenToSession` cleanly.

**Trap worth remembering:** `pnpm test:medium -- --run <path>` silently drops the path
filter and runs all 136 medium files, which exhausts Postgres connections and yields
unrelated failures. Pass the file to vitest directly:
`npx vitest --config test/vitest.config.medium.mjs --run <path>`.

## Cutover to `main` — fork sync + staging validation (2026-07-22, evening)

The branch had been sitting complete-but-held-off-`main`. This section records what
it took to actually land it.

### Fork sync — #826, #827

`make upstream-sync-fork-main` cherry-picked the two fork commits that landed on
`origin/main` after the batch-35 run, advancing `integratedForkHead` to `d27c457f3c`
(= `origin/main` HEAD). Both applied clean; all three gate checks green.

| Commit       | PR   | What it carries                                                                                                                            |
| ------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `cddc3c5481` | #827 | Declarative-schema realignment + new fork migration `1784800000000-RepairSharedSpaceAlbumGrantDrift`, and its `revert-to-immich.sql` entry |
| `02445dacb3` | #826 | cmdk "the"-hijacks-search fix (`cmdk-match.ts` almost-exact gate)                                                                          |

Fork migration count is now **49** (was 48).

### One real failure — a fork commit meeting a newer toolchain

`Test` failed on **Lint Web**:

```
web/src/lib/managers/cmdk-match.ts
  55:17  error  Prefer `Array#every()` with a negated predicate over negating `Array#some()`
                unicorn/no-negated-array-predicate
```

#826 was authored against `main`'s **eslint-plugin-unicorn v70** and is clean there.
This branch carries **v72** (batch 28), which added that rule. Nothing about the
commit is wrong — it simply never met v72 before being replayed here. This is the
same drift class as the TypeScript 7 / GHA-major propagations above, arriving from
the _fork_ side instead of the upstream side, and it is the reason a fork sync onto
a toolchain-advanced rolling branch cannot be assumed safe just because the
cherry-pick was clean.

Fixed in `fa932c2f97` by hoisting the predicate to a local rather than rewriting to
`.every()` — the naive rewrite nests `!labelWords.some(...)` inside the callback and
re-triggers the identical rule one level down. Pure refactor; the four cmdk /
global-search / navigation-items / command-items specs pass (234 tests).

**Local-gate blind spot worth recording:** `pnpm lint` in `web/` cannot catch this
on this machine — `@koddsson/eslint-plugin-tscompat@0.2.0` crashes with
`TypeError: Cannot read properties of undefined (reading 'Class')` while linting
`web/src/lib/__mocks__/animate.mock.ts`, aborting the whole run before it reaches
`cmdk-match.ts`. CI is unaffected (it lints all 3 700+ files and reported the error
normally). Verified pre-existing: the file and eslint config are byte-identical to
the CI-green tip `cd39912b71`, and the crash reproduces on that single unchanged
file. Until it is fixed, lint individual files locally and treat CI's Lint Web as
the authority.

### Remote CI

Nine workflows green on `02445dacb3`; `Test` and `Docker` re-dispatched and green on
`fa932c2f97` (Docker re-run because it builds the shipped web bundle).

Two environmental failures, each diagnosed from its log rather than assumed:

| Workflow                | Cause                                     | Evidence                                                                                                                           |
| ----------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Storage Migration Tests | runner disk exhaustion                    | `No space left on device (os error 28)` in the plugin-core wasm build; passed on re-run                                            |
| Test — E2E (arm)        | **unauthenticated** GitHub API rate limit | `mise WARN GitHub rate limit exceeded`, `github auth: no`, `0/60 (core)`, 403 on `extism/js-pdk` releases → `extism-js: not found` |

The rate-limit one is worth internalising: the Docker plugin stage resolves
`github:extism/js-pdk@1.6.0` through `mise` with **no** GitHub token, so it shares a
60-req/hour unauthenticated budget across whatever else is running on that runner
IP. Dispatching ~13 workflows at once is enough to exhaust it. Stagger dispatches,
or give that step a token.

### Staging RC validation

Built `rolling-v303-cutover-rc1` (**server-only**: `machine-learning/` is byte-identical
to the `v5.1.1` tree staging's ml pin already tracks — tree hash `87e6953c6b` on both
sides, so 35 batches of upstream touched zero ML files). infra-gitops `f0cd817`.

Verified by **pod image**, not by `rollout status`:
`gallery-server-678d499fbb-c5n29` → `gallery-server:rolling-v303-cutover-rc1`, ready.

The migration path is the headline result — this ran on a real, populated database:

```
Migration "1784647658615-AddOAuthBearerTokenToSession" succeeded
Migration "1784800000000-RepairSharedSpaceAlbumGrantDrift" succeeded
Finished running migrations
Checking for schema drift
No schema drift detected          <- on BOTH Api and Microservices workers
```

That is exactly what #827 set out to achieve, now confirmed against the rebased tree
rather than a synthetic DB.

Fork surfaces smoke-tested via a temporary API key (since deleted):

| Endpoint                           | Result                                    |
| ---------------------------------- | ----------------------------------------- |
| `/server/ml-health`                | `{"smartSearchHealthy":true}`             |
| `/shared-spaces`                   | 200 — spaces returned                     |
| `/people?withSharedSpaces=true`    | 200 — 362 people                          |
| `/gallery/map/markers` (fork-only) | 200 — markers with coordinates            |
| `/albums`, `/timeline/buckets`     | 200 — real data                           |
| `POST /search/smart` `"beach"`     | 200 — 2 assets (CLIP + vector end-to-end) |
| `GET /` (web bundle)               | 200, 9 787 bytes                          |
