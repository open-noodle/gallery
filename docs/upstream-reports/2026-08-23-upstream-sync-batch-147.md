# Upstream Sync Report — 2026-08-23 (batch 147 + fork sync)

## Summary

- **Upstream commits pulled**: 2 (batch 147)
- **Fork commits synced from `origin/main`**: 2
- **Conflicts resolved**: 7 across one upstream-facing file, 10 hunks across four fork-sync files
- **Risk level**: MEDIUM — one upstream commit re-indented a file the fork has rewritten heavily
- **Recommendation**: PROCEED

Branch `rebase/upstream-rolling-v3.1.1` @ `45634b99869`, pushed to `rebase/upstream-batch-147`.
**Level with `upstream/main`** (`c98c20e9639`), 1305 fork commits ahead, 0 behind. Still **off
`main`**: newest upstream tag is still `v3.1.0`, so the standing landing rule is not met and
`branding/config.json` stays at `3.1.0`.

## Incoming Upstream Changes

| SHA           | Summary                                                             | Area   | Risk to Fork | Notes                                                                                                                                                             |
| ------------- | ------------------------------------------------------------------- | ------ | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `44a93847589` | do not exit search screen on back during multiselect (immich-30689) | mobile | MEDIUM       | Wraps the timeline in a `BackButtonListener`; 239 lines changed mostly because the widget body is re-indented two columns. The fork owns +562 lines in that file. |
| `c98c20e9639` | respect 24h system setting (immich-30792)                           | mobile | LOW          | `formatDateRange` drops its `locale` parameter; adds `formatTime({required bool alwaysUse24HourFormat})`.                                                         |

### Product-direction gate

**Not triggered.** Both are bugfixes — no new feature, no data-model reshape, no product direction.
The one worth checking was immich-30689: the fork removed upstream's mobile search page in #654, so
a commit about "search screen back behaviour" could have referenced a deleted surface. It does not —
no `DriftSearchRoute`, no `pages/search`, no `searchPreFilter`. It only changes back handling inside
the timeline widget.

### Detectors (run before the rebase)

| Detector                                                                           | Result                                                        |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Shape I — added path the fork once owned (scoped to `origin/main`)                 | none                                                          |
| Deleted literals still matched by branding/tooling                                 | none                                                          |
| Batch touches `i18n/`, `mise.toml`, `Makefile`, `.github/`, Dockerfile, migrations | none                                                          |
| Fork-only call sites of the narrowed `formatDateRange`                             | none — all 8 are in files upstream updates in the same commit |

## Conflict Resolutions — `timeline.widget.dart`

immich-30689's re-indent collided at **seven** separate fork commits. Resolved **per commit**, never
against the end state.

To keep that tractable without hand-merging 130-line regions seven times, conflicts whose fork delta
was provably formatter output were auto-resolved. The normaliser collapses whitespace, drops trailing
commas before a closer, and drops whitespace adjacent to brackets — exactly what `dart format`
changes when it splits or joins a call, and nothing else. It was **proven in both directions on five
cases** (split-vs-joined equal; changed value, added argument and removed line all unequal) before
being trusted. It refused four times; those were resolved by hand.

| Fork commit                        | Fork's real delta                                                                                                    | Resolution                                                                                   |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| #313 mobile Drift sync rewrite     | richer `onLoading` (app bar + centred indicator instead of `null`)                                                   | upstream's `BackButtonListener` + re-indent, with the fork's `onLoading` re-indented into it |
| `9628225e328` restore rebase gates | formatter reflow only                                                                                                | auto                                                                                         |
| #625 timeline grouping modes       | `_lastRenderedSegments`, grouping derivation, zoom-anchor scheduling, `groupBy:` on Scrubber, snapping-offset helper | ours + the six lines re-applied                                                              |
| #681 grouping bottom pill          | typed `activeGroupBy` off `timelineGroupingProvider`, `pillClearance`, padding                                       | ours + three edits                                                                           |
| #720 empty-state                   | zero-asset early return                                                                                              | ours + the block                                                                             |
| `57e98287812` v3.0.2 reconcile     | three lines upstream's side already had                                                                              | ours (verified each line present)                                                            |
| lint-rules batch                   | dropped a redundant `!`                                                                                              | ours + the lint fix                                                                          |
| #932 restore "Group by"            | spec-based grouping, `mode:` instead of `groupBy:`                                                                   | ours + two edits                                                                             |

### ★ "Take ours" silently dropped six fork lines

At #625 git aligned the conflict **asymmetrically**: upstream's `onData` body sat _outside_ the
region in the shared tail, while base/theirs' copy sat _inside_ it (26 lines vs 132). Taking `ours`
therefore looked structurally correct and quietly discarded `_lastRenderedSegments`, the grouping
derivation, the zoom-anchor call, `groupBy: activeGroupBy` and the scrubber snapping helper.

Nothing would have caught this: it compiles, and no audit inspects it. It was found by grepping each
fork marker after the resolution. **Whole-file audit at the end: 0 fork-tip lines missing, and the
only additions are upstream's 9-line `BackButtonListener`.**

### ★ A wrong justification, corrected by the tool

One hunk was left split across four lines on the reasoning that the joined form would exceed 120
columns at the deeper indent. It is 118 and fits — `dart format` joins it, which is also the form the
fork had. Verified rather than argued (`--set-exit-if-changed` returns 1 before, 0 after) and
committed separately.

## Fork Sync (`0d357bd73df..07cd632f1ba`, 2 commits)

`make upstream-sync-fork-main` first refused on a malformed `rolling-state.json` — the previous
cycle's `appendHistory` entry used abbreviated SHAs where the validator requires 40 characters; every
entry has been normalised. It then threw on a real conflict and rolled the batch back, so both
commits were cherry-picked by hand with **rerere disabled on every git invocation** (it is enabled
repo-wide and had already begun recording preimages). Replayed file sets are identical to
`origin/main`'s for both.

#1020 applied clean. #981 conflicted in four files:

| File                                                | Resolution                                                                                                     |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `web/src/lib/types.ts`                              | union — upstream's `TagId` plus the fork's `SpaceId` / `SpaceAlbumName`                                        |
| `web/src/lib/components/SchemaConfiguration.svelte` | union — both imports, both `{:else if}` branches                                                               |
| `server/src/services/workflow-execution.service.ts` | union ×4 — both service imports, both `BaseService.create` lines, both host-function names, both dummy entries |
| `server/Dockerfile`                                 | see below                                                                                                      |

### ★★ The Dockerfile — Shape D corollary, and a silent empty-plugin image

Rolling had already relocated the plugins stage off `WORKDIR /app` onto the inherited
`/usr/src/app` (upstream immich-30874). `main`'s #981 adds `packages/plugin-gallery` using the **old**
`/app` paths. Taking `main`'s `COPY --from=plugins /app/packages/plugin-gallery/...` would have built
the plugin at one path and copied from another — an image shipping an **empty gallery plugin**, green
on every gate except a runtime plugin load.

Resolved to `/usr/src/app` throughout, and asserted that no `COPY --from=plugins` sources `/app`.
**The assertion has to be anchored**: `/app/packages/plugin-gallery` is a _substring_ of
`/usr/src/app/packages/plugin-gallery`, so a naive `not in` check false-fires. `mise //:plugins` now
builds `plugin-gallery` successfully.

## Zero-conflict semantic break — upstream's new widget contract

`BackButtonListener` resolves its dispatcher via `Router.of(context)` and **throws without a `Router`
ancestor**. The running app always has one through `MaterialApp.router`; the fork's widget tests use a
plain `MaterialApp`, so **34 tests across 11 files** failed with _"Router operation requested with a
context that does not include a Router"_.

Upstream hit exactly this in its own timeline test and added a stub `Router` delegate. The fork now
mirrors it: the helper lives in the shared test host (covering every `pumpConsumerWidget` caller) and
is exported as `withStubRouter` for the specs that build their own `MaterialApp`. No fork behaviour
changed — this is upstream's contract arriving and the harness catching up. All 3411 mobile tests
pass.

## Lockfile

#981 adds a workspace package, so `pnpm install --frozen-lockfile` — what CI runs — failed after the
sync. Regenerated with `injectWorkspacePackages` temporarily `false` and then restored, so workspace
deps stay symlinks: a plain regen activates that dormant flag and flips them to injected `file:`
copies snapshotted before the SDK is built, which takes out roughly fourteen jobs on a cold checkout.

Verified after: **11 `version: link:` entries as before, zero `version: file:`**, `pnpm-workspace.yaml`
byte-identical, and `--frozen-lockfile` passing. Net change is one line — `esbuild` 0.28.1 → 0.28.2
under its existing `^0.28.0` specifier, which is what upstream resolves, so this converges rather
than drifts. The `settings:` block was re-added by hand (regenerating with the flag off drops it) and
matches upstream's exactly.

## Fork Feature Verification

| Check                                              | Status                                  |
| -------------------------------------------------- | --------------------------------------- |
| `upstream-postrebase-audit BATCH=147` (7 checks)   | OK                                      |
| `fork-patches-check`                               | OK                                      |
| `ci-invariants-check`                              | OK                                      |
| `mobile-drift-rebase-check BATCH=147`              | OK                                      |
| `commit-autolink-check` (ceiling resolved to 1020) | OK                                      |
| `gallery-branding-check.sh`                        | OK                                      |
| `revert-to-immich.sql` migration coverage          | OK — no migrations added by either side |

## Local Verification

| Check                                              | Status | Notes                                                                                                        |
| -------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------ |
| `server pnpm build` (+ postbuild)                  | PASS   | 60 migrations, 1 alias                                                                                       |
| `server pnpm check` / `lint` / `prettier`          | PASS   |                                                                                                              |
| `mise //:plugins`                                  | PASS   | includes the new `plugin-gallery`                                                                            |
| `web check:typescript`                             | PASS   |                                                                                                              |
| `web check:svelte`                                 | PASS   | 626 files, 0 errors                                                                                          |
| `web eslint`                                       | PASS   | 0 errors; 13 warnings are the known `tscompat` unused-disable artifacts of the local `--rule off` workaround |
| `web prettier` / `.github` / `e2e` prettier + lint | PASS   |                                                                                                              |
| `e2e pnpm check` (tsc)                             | PASS   |                                                                                                              |
| Server unit tests                                  | PASS   | 6039 passed, 12 skipped                                                                                      |
| Web unit tests                                     | PASS   | 5884 passed — see the flake below                                                                            |
| `dart analyze --fatal-infos lib test`              | PASS   |                                                                                                              |
| `dart format` (gate: `lib`, generated excluded)    | PASS   | 866 files, 0 changed                                                                                         |
| `dart format` over `test/`                         | PASS   | 379 files, 0 changed                                                                                         |
| `flutter test`                                     | PASS   | 3411 passed                                                                                                  |
| `pnpm install --frozen-lockfile`                   | PASS   |                                                                                                              |

### Confirmed flake — pre-existing, not from this cycle

`web/src/lib/managers/global-search-manager.svelte.spec.ts > clears stale status when the active live
token changes` failed once with _expected "vi.fn()" to be called once, but got 2 times_.

- the spec and its subject are **untouched** by this cycle (`git diff` over `web/src/lib/managers/`
  is empty);
- it **passes in isolation** — 418 tests, exit 0;
- a **second full run passed**, 5884 tests, zero failures.

So it is order/parallelism dependent, the cross-file variant of the known "web vitest does not clear
mocks" hazard. **Logged, not absolved** — a green re-run proves non-determinism, not correctness.

## Remote CI Verification

Dispatched on `45634b99869`. **9 of 10 green**; the tenth is a `main`-side regression this branch
inherits rather than causes.

| Workflow                                  | Result                                          |
| ----------------------------------------- | ----------------------------------------------- |
| `test.yml`                                | GREEN                                           |
| `docker.yml`                              | GREEN                                           |
| `static_analysis.yml`                     | GREEN                                           |
| `gallery-build-mobile.yml`                | GREEN                                           |
| `gallery-mobile-smoke.yml`                | GREEN                                           |
| `gallery-ml-smoke.yml`                    | GREEN                                           |
| `gallery-rebase-smoke.yml`                | GREEN                                           |
| `storage-migration-tests.yml`             | GREEN                                           |
| `storage-migration-e2e.yml`               | GREEN on re-run — see below                     |
| `gallery-revert-to-immich-validation.yml` | RED — pre-existing `main` regression, see below |

### `storage-migration-e2e` — environmental, confirmed by re-run

The plugins build step failed with:

```
mise WARN  Failed to resolve tool version list for github:extism/js-pdk:
HTTP timed out after 3.00s for https://api.github.com/repos/extism/js-pdk/releases
  -> extism-js: not found
```

Two facts rule out the Dockerfile resolution: it failed for **`plugin-core`** as well — upstream's
plugin, untouched here — and **`docker.yml` succeeded on the identical SHA**, building the same
plugins stage including `plugin-gallery`. Re-running the failed job on the unchanged commit went
green. This is the known `mise`/GitHub-API timeout class.

### ★★ `gallery-revert-to-immich-validation` — a `main` regression from #981, NOT this branch

This job boots **`ghcr.io/open-noodle/immich-server:main`**, not the branch, so it reports on `main`'s
image. It fails with a plugin host-function mismatch:

```
microservices worker error: cannot resolve import "extism:host/user" "gallery"
("extism:host/user" is a host module, but does not contain "gallery")
  -> server did not respond to /api/server/ping within 180s
```

`main`'s `:main` image is internally inconsistent: its `plugin-gallery.wasm` imports a `gallery` host
function that the server in that image does not register.

Evidence it is not ours:

- the workflow is failing on **unrelated branches too** — `feat/space-editor-asset-permissions`, three
  separate runs at 15:55, 16:16 and 17:04;
- it **passed at 14:44**, and **#981 merged to `main` at 15:43Z**; failures begin twelve minutes later;
- the gate's actual subject — schema drift — was **clean**: "Pre-phase baseline drift (0 item(s))" and
  "No schema drift detected". The local coverage detector also reports complete.

**This needs its own fix on `main`, and it currently reds every branch that runs this workflow.**

## Follow-up

- `global-search-manager.svelte.spec.ts` "clears stale status…" is order-dependent and should reset
  its mock rather than rely on suite ordering.
- `gallery-map.e2e-spec.ts` "albumId visibility … (D4)" remains flaky from the previous cycle.
- **`main` ships a `plugin-gallery` whose `gallery` host import the server does not register**, so the
  `:main` image fails to boot its microservices worker. Introduced by #981; needs a fix on `main`.
