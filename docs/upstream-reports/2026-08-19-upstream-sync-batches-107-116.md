# Upstream Sync Report — 2026-08-19 (arc B, batches 107–116)

Second and final arc of the v3.1.1 rolling cycle. Arc A (batches 102–106) landed at `7d4f2697914` and is
recorded in [`2026-08-18-upstream-sync-batches-102-106.md`](./2026-08-18-upstream-sync-batches-102-106.md).
Arc A ended with **13 commits quarantined at batch 107** — this arc released that quarantine and drove the
branch level with `upstream/main`.

## Summary

- **Upstream commits pulled**: 13 (batches 107–116)
- **Conflicts resolved**: ~15 manual, remainder auto-resolved
- **Risk level**: MEDIUM — one broad mobile refactor (`@DriftAccessor`) touching 67 fork-only files, one
  sync-contract change (`#30764` backpressure), one lint major (unicorn v73) and one comment-style sweep
- **Recommendation**: PROCEED (rolling branch stays off `main` — see "Landing" below)
- **Branch state**: 0 commits behind `upstream/main`, 1191 fork commits ahead, fork-synced through `#987`

## Incoming Upstream Changes

| SHA           | Summary                                                                    | Area          | Risk to Fork | Notes                                                                  |
| ------------- | -------------------------------------------------------------------------- | ------------- | ------------ | ---------------------------------------------------------------------- |
| `225ca9ab8df` | `chore(mobile)`: use Drift `@DriftAccessor()`, collapse providers (#30693) | mobile        | **HIGH**     | 92 files upstream; the quarantine trigger. Propagated to 79 fork files |
| `11755e5a53e` | `chore(deps)`: eslint-plugin-unicorn v73 (#30844)                          | web/e2e/tools | **MEDIUM**   | Lint major — the classic fork-sync drift vector                        |
| `20edf0051c1` | `fix(deps)`: update typescript-projects (#30839)                           | deps          | MEDIUM       | Lockfile churn; regenerated, 9 `link:` / 0 `file:`                     |
| `4d319cbd0d8` | `chore(deps)`: mise docker tag v2026.8.8 (#30834)                          | docker        | LOW          | Dockerfile pin only                                                    |
| `d00867d702a` | `fix`: freeze navigating back album description (#30781)                   | web           | LOW          | 4-line addition                                                        |
| `b0a9468da71` | `fix(server)`: guard `createAll` against empty values (#30837)             | server        | LOW          | Touches `asset.repository.ts` + its medium spec                        |
| `618dc0d397e` | `fix(server)`: respect backpressure in the sync stream (#30764)            | server        | **HIGH**     | Sync contract — fork owns extra sync streams                           |
| `3af2ba19ec8` | `feat`: iOS dynamic background ids (#30574)                                | mobile/iOS    | MEDIUM       | Collides with fork #627; deliberate divergence kept (below)            |
| `80a90fabf34` | `fix(server)`: update ocr & faces after asset edit (#29303)                | server        | **MEDIUM**   | Adds 2 migrations → `revert-to-immich.sql` coverage required           |
| `03da1ba1087` | `chore`: single line block comments (#30852)                               | web/server    | LOW          | Comment-style sweep, 34 files                                          |
| `1539ae8b07d` | `fix(mobile)`: resend an upload once on dead connection (#30843)           | mobile        | **HIGH**     | Creates a file at a fork-owned path — see Conflicts                    |
| `ea3fa927767` | `feat`: actions undo handling (#30481)                                     | mobile        | MEDIUM       | Fork has standing divergences in the action model                      |
| `65b4b9b8fbe` | `fix(mobile)`: cannot deep link to memory lane (#30787)                    | mobile        | LOW          | `deep_link.service.dart` one-liner + tests                             |

### High-risk changes — detailed

#### `#30693` — Drift `@DriftAccessor()` (the quarantined commit)

Upstream moved every Drift repository onto `@DriftAccessor()` and collapsed several providers, so
`ref.watch(<someRepository>)` became `ref.watch(driftProvider).<someRepository>`. Upstream converted 92 of
its own files; the fork owns 67 more that the commit cannot see.

**Decision: bundled** (see Pattern Propagation). `SpaceAlbumRepository` was converted and registered in
`daos:`, 79 fork files renamed, and the nudge test moved to a `MockDrift`. Deferring would have left the
fork the only consumer of a provider shape upstream had deleted.

#### `#30764` — sync-stream backpressure

Upstream reworked `sync.service.ts` so each stream `await`s the send before continuing. The fork adds its
own sync streams (Spaces, space assets, space libraries, space members) which upstream's commit does not
touch — a textbook **Shape H**: the contract changed, and only fork-only code carried the unguarded
pattern. All 53 un-awaited fork sync sites were converted (116 total, 0 remaining).

#### `#29303` — OCR & faces after asset edit

Adds two upstream migrations that post-date the `v3.1.0` tag in `branding/config.json`, so both need
entries in `scripts/revert-to-immich.sql` or the `gallery-revert-to-immich-validation` coverage job fails —
and that failure leaks to every branch based on rolling. Both are covered; the detector reports 0 gaps.

## Conflict Resolutions

### Conflict: `mobile/test/repositories/upload_repository_test.dart` — **found by this arc's mobile gate, not during the rebase**

- **Fork side**: the path is fork-owned. #627/#639 created the fork's own `UploadRepository` test
  (`UploadRepository.forTesting`, `kBackupGroup`, holding-queue and notification tests); **#892 deletes it**
  when the fork moved onto upstream's background-backup implementation. The file is absent on `origin/main`,
  and `forTesting` exists in no ref's `lib`.
- **Upstream side**: `#30843` newly _adds_ a 127-line file at that same path.
- **What went wrong**: replaying the fork commits over upstream's new file concatenated both bodies (241
  lines, two import blocks, two `main()`) **and silently lost #892's deletion**. The file no longer parsed.
- **Resolution**: restored upstream's version verbatim (`git checkout upstream/main -- <path>`); diff against
  `upstream/main` is now empty. The fork contributes nothing at this path any more.
- **Risk**: LOW after fix. This is the same shape as the `drift_backup_provider_test` reconcile already on
  this branch — the second instance of "fork #892 deletes a file upstream still owns".
- **Verification**: `dart analyze --fatal-infos` clean; `flutter test` 3354 pass / 1 skip.

### Conflict: `server/src/services/sync.service.spec.ts` and `server/test/medium/specs/repositories/asset.repository.spec.ts`

- **Cause**: a `--union` conflict-resolution fallback used during this arc dropped a `});` pair in each file.
- **Resolution**: repaired; both re-verified independently in this session — paren/brace/bracket deltas are
  all 0, `pnpm check` clean, and the sync spec's suite passes.
- **Risk**: MEDIUM as a _process_ finding. The union fallback is the one automation added during this arc
  that produced real defects, and it produced **three**, not two — the third (`upload_repository_test.dart`)
  was only caught by the mobile gate afterwards. **Do not reuse `--union` for conflict resolution.**
- **Follow-up**: a tightened zombie detector (duplicated import lines / two `main()` / late import block past
  25% depth) was run over the whole tree, proven red against the known-bad file first. It reports no further
  instances; the six remaining hits are barrel files and a generated-code string template, all verified benign.

### Divergence kept: `#30574` iOS dynamic background ids

Upstream's version force-unwraps (`as!` / `!`) when reading the background task id. The fork's #627 does the
same job with fallbacks. **Kept the fork's**, because a missing plist key would otherwise trap at launch on
branded builds, where the key name differs. Reversible if exact upstream tracking is preferred later.

## Fork Feature Verification

| Feature               | Status | Notes                                                              |
| --------------------- | ------ | ------------------------------------------------------------------ |
| Shared Spaces         | OK     | Fork sync streams converted to awaited sends; symbols audit green  |
| Storage Migration     | OK     | Untouched by this arc                                              |
| Pet Detection         | OK     | Untouched by this arc                                              |
| Image Editing         | OK     | `#29303` touches OCR/faces after edit; migrations covered          |
| Branding              | OK     | Literal no-op detector clean over the arc range                    |
| Google Photos Import  | OK     | Untouched by this arc                                              |
| Space Albums (mobile) | OK     | `SpaceAlbumRepository` converted to `@DriftAccessor`, nudge intact |

## CI and Infrastructure Verification

| Check                                     | Status | Notes                                                                    |
| ----------------------------------------- | ------ | ------------------------------------------------------------------------ |
| Workflow files (no upstream collisions)   | OK     | —                                                                        |
| Docker image references (`gallery-*`)     | OK     | `ci-invariants-check` green                                              |
| Branding (no Immich leaks in CI/config)   | OK     | Remaining hits are upstream-owned workflows + `devtools` actions         |
| Fork CI modifications intact              | OK     | `fork-patches-check` green (`@immich/ui` patch consistent)               |
| Silent-no-op literal detector (arc range) | OK     | No removed upstream literal is still literal-matched by fork tooling     |
| `revert-to-immich.sql` coverage           | OK     | Detector reports 0 gaps against the `v3.1.0` tree                        |
| Branding scripts wired into CI            | KNOWN  | 5 scripts still referenced by no workflow — pre-existing, settled (#928) |

## Database Migration Analysis

### New upstream migrations

| Migration                          | Tables                    | Risk to Fork | Notes                                                 |
| ---------------------------------- | ------------------------- | ------------ | ----------------------------------------------------- |
| `#29303` OCR/faces after edit (×2) | `asset_ocr`, `asset_face` | MEDIUM       | Post-`v3.1.0`; both covered in `revert-to-immich.sql` |

- **Gallery migration count**: 58 (expected 58)
- **Timestamp collisions**: NONE
- **Postbuild merge / `CompositeMigrationProvider`**: intact
- **Manifest coverage**: all globs match

## Mobile Drift Migration Analysis

`mobile-drift-rebase-check BATCH=116`: **OK** — `schemaVersion`, snapshots and Gallery callbacks consistent.
No renumbering was required this arc; `#30693` is a repository-access refactor, not a schema change.

## Pattern Propagation

| Refactor                            | Old → New Pattern                                                          | Fork Files                                    | Decision    | Commit              |
| ----------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------- | ----------- | ------------------- |
| Drift `@DriftAccessor` (#30693)     | `ref.watch(<repo>)` → `ref.watch(driftProvider).<repo>`; repos become DAOs | 79 renamed + `SpaceAlbumRepository` converted | **Bundled** | `f49f3b01ac3`       |
| Sync backpressure (#30764)          | fire-and-forget send → `await` each send                                   | 53 fork sync sites                            | **Bundled** | `0729e1a5ac4`       |
| eslint-plugin-unicorn v73           | new rules over web/e2e/tools                                               | 1 stale disable directive                     | **Bundled** | see Inconsistencies |
| Single-line block comments (#30852) | `/* … */` collapsed                                                        | none — server/web/e2e already clean           | **Bundled** | —                   |

Two propagation leftovers surfaced in this session's gates, both invisible to the rebase itself:

- `action.service.dart` still imported `album.provider.dart` after the `@DriftAccessor` rewrite removed its
  last use. Fixed in `3dd052d2215`; fork behaviour (`removeFromSpace` / `removeFromAlbum`, the
  `_remoteAlbumRepository` field) is unchanged.
- `GalleryViewer.spec.ts` (fork-only) kept an `eslint-disable-next-line unicorn/no-this-outside-of-class`
  that unicorn **v73** no longer needs — the rule now accepts a function with an explicit `this` parameter.
  Upstream removed its own copies of that directive as part of #30844; the fork-only file kept its stale one.
  Because `web`'s lint script is `--max-warnings 0`, one stale directive is enough to red Lint Web.

## Inconsistencies Found

1. **`upload_repository_test.dart` concatenation + lost #892 deletion** — fixed, `015ca3d5785`.
2. **`action.service.dart` unused `album.provider` import** — fixed, `3dd052d2215`.
3. **`GalleryViewer.spec.ts` stale unicorn disable directive** — fixed; would have failed Lint Web.
4. **`--union` conflict fallback produced three defects** — all three repaired; the technique is retired.

> **Local-gate caveat worth recording**: running web eslint with the documented
> `--rule '{"tscompat/tscompat":"off"}'` workaround makes every legitimate
> `eslint-disable … tscompat/tscompat` directive report as _unused_. That produced 13 phantom warnings
> alongside the 1 real one here. Filter them out by rule name, or re-run the real `pnpm lint` to confirm.

## Local CI Verification

| Check                                  | Status | Notes                                                |
| -------------------------------------- | ------ | ---------------------------------------------------- |
| `server pnpm build` (+ migration sync) | PASS   | —                                                    |
| `server pnpm check` (tsc)              | PASS   | —                                                    |
| `web check:typescript`                 | PASS   | —                                                    |
| `web check:svelte`                     | PASS   | 609 files, 0 errors, 0 warnings                      |
| `server pnpm lint`                     | PASS   | exit 0; no unicorn v73 or block-comment sweep needed |
| `web pnpm lint` (real, `tscompat` on)  | PASS   | exit 0 after the stale-directive fix                 |
| `e2e pnpm lint`                        | PASS   | exit 0                                               |
| Server unit tests                      | PASS\* | 5686/5699; see the contention note below             |
| Web unit tests                         | PASS   | 5694 pass, 363 files, 2 skip, 8 todo                 |
| `dart analyze --fatal-infos`           | PASS   | No issues found                                      |
| `dart format --set-exit-if-changed`    | PASS   | 851 files, 0 changed                                 |
| `flutter test`                         | PASS   | 3354 pass, 1 skip                                    |
| Mobile codegen freshness               | PASS   | `*.g/.gr/.drift.dart` clean after regen              |
| `mise.lock` / pubspec pollution        | PASS   | clean                                                |
| Lockfile workspace linking             | PASS   | 9 `link:` / 0 `file:`                                |
| `upstream-postrebase-audit BATCH=116`  | PASS   | 7/7 checks OK                                        |
| `fork-patches-check`                   | PASS   | —                                                    |
| `ci-invariants-check`                  | PASS   | —                                                    |
| `mobile-drift-rebase-check BATCH=116`  | PASS   | —                                                    |

### \* Server unit tests — local contention, not a regression

Three full local runs produced a **shifting failure set**, which is the signature of resource contention
rather than a code defect:

| Run | Mode                    | Result                                                                             |
| --- | ----------------------- | ---------------------------------------------------------------------------------- |
| 1   | parallel                | 1 failed — `search.controller.spec.ts` "rejects invalid queryAssetId" (401≠400)    |
| 2   | parallel                | 2 failed — a **different** file, `user-admin.controller.spec.ts`, `socket hang up` |
| 3   | `--no-file-parallelism` | **171 files / 5687 tests, 0 failures — fully green**                               |

Evidence it is not arc B's doing:

- `search.controller.spec.ts` passes **39/39 in isolation**.
- The spec is **byte-identical** between the arc A tip (`7d4f2697914`, 10/10 CI green) and this tip — arc B
  did not touch it.
- `auth.guard.ts` is **identical to `upstream/main`** and untouched by arc B's 13 commits.
- Run 2's failure was `socket hang up` in an unrelated controller spec — these specs each stand up a real
  Nest HTTP server via supertest, and the machine was concurrently running the Flutter and web suites.

**Run 3 settles it: serial execution is 100% green (5687/5687).** The two parallel runs were contended —
the Flutter suite and the full web Vitest suite were running on the same machine at the time. Per the
no-flake-allowance rule this is recorded rather than waved away, and the diagnosis was reached by the
prescribed route: re-run the file alone, then the suite with `--no-file-parallelism`, before believing any
failure.

Latent fragility worth noting even so: `rejects invalid queryAssetId values` is the one test in that file
that never sets `ctx.authenticate.mockResolvedValue({})`, so it passes only because `AuthGuard` assigns an
undefined `authenticate` result to `request.user` and returns `true`. That makes it the first test to
mis-report under contention. Adding the mock like its neighbours would remove the ambiguity; not done here
because it is unrelated to this arc and the file is unchanged since a 10/10-green tip.

## Remote CI Verification

- **Test branch**: `rebase/upstream-rolling-v3.1.1`
- **Commit validated**: _pending_

_To be filled in after dispatch._

## Landing

Per the standing rule, the rolling branch stays **off `main`**: landing requires an upstream **tag** plus
thorough validation of that tagged state. `branding/config.json` is at `v3.1.0` and `upstream/main` is a
moving HEAD, so neither condition holds. Green + level + fork-synced is the expected steady state.

## Post-Rebase Verification

- Fork commits ahead of upstream: 1191
- Commits behind upstream: 0 (at the arc's target `65b4b9b8fbe`)
- Fork diff clean: YES

> **Note for the next cycle**: `upstream/main` advanced to `7918ad9f792` (**10 new commits**) while this arc
> was being verified. They are deliberately _not_ included here — arc B was verified against
> `65b4b9b8fbe`. They form the next batch.
