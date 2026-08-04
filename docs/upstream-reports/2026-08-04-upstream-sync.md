# Upstream Sync Report — 2026-08-04

## Summary

- **Cycle type**: UPSTREAM-ONLY (fork side had 0 pending commits — `origin/main` was already equal to `integratedForkHead`)
- **Upstream commits pulled**: 5 (`0d7147dceca..cbd2d8a6bda`), batches 50–53
- **Conflicts resolved**: 3
- **Risk level**: LOW–MEDIUM
- **Recommendation**: PROCEED

The branch is now **level with `upstream/main`** (0 behind, 1084 fork commits ahead). Upstream has **not** tagged a new
release — the newest tag is still `v3.1.0` — so per the standing rule the branch stays off `main`, and
`branding/config.json` / `README.md` keep `v3.1.0`.

The one substantive finding this cycle is a **zero-conflict, silently-breaking branding regression** introduced by
upstream #30527. It is described in full below because the rebase, the audits, and the type checks were all green while
it was live.

## Incoming Upstream Changes

| SHA           | Summary                                                | Area             | Risk to Fork | Notes                                                                |
| ------------- | ------------------------------------------------------ | ---------------- | ------------ | -------------------------------------------------------------------- |
| `29e7ea5302b` | chore(web): use FUTO F-Droid repo in utilities         | web              | HIGH         | Silently breaks `apply-branding` store-link rewriting — see below    |
| `79d485c759f` | chore(deps): update github-actions (#30543)            | CI               | MEDIUM       | 13 workflows; 3 conflicts against fork CI modifications              |
| `7121e0a75ca` | fix(mobile): run one more sync round mid-sync (#30478) | mobile           | MEDIUM       | Fork has 41 lines of delta in both touched files; merged cleanly     |
| `cbd2d8a6bda` | feat(widget): add toggle to match icon theme (#30428)  | mobile / iOS     | LOW          | Fork's only widget delta is in `ImmichAPI.swift`, untouched upstream |
| `29512081db4` | fix: use setRequireOriginal on SDK 29 and above        | mobile / Android | LOW          | No fork ownership of either file                                     |

### Per-batch product-direction gate

**Did not fire.** None of the five commits changes _where_ a feature is going in a way that collides with a fork product
decision. The sync commit is a scheduler bugfix that adds an opt-in flag (it does not reshape the sync contract); the
widget toggle is upstream's own iOS surface; the F-Droid change is a chore whose collision with the fork is mechanical,
not directional. No quarantine was needed.

### High-risk change: `29e7ea5302b` — silent branding regression

**What upstream changed.** `AppDownloadModal.svelte` previously hardcoded three store URLs. #30527 replaced all three
with `Constants.Get.Android` / `Constants.Get.iOS` / `Constants.Get.FDroid`, imported from `@immich/ui`. The URLs now
live inside the npm package (`@immich/ui@0.83.0` → `dist/site/constants.js`, e.g.
`Android: 'https://get.immich.app/android'`).

**Why it was dangerous.** The fork does **not** modify this file in source — branding is applied at Docker build time.
So the rebase produced **no conflict at all**, and the breakage landed in a different file entirely:
`branding/scripts/apply-branding.sh` → `patch_app_download_modal()` rewrites the modal by `sed`-ing the two **literal**
URLs. With the literals gone, both `sed` calls became silent no-ops, and a branded Gallery web build would have shipped
**upstream's** Play Store and App Store links. The F-Droid awk block-rewrite was unaffected (it keys on
`id="fdroid-link"`, which survives).

**How it surfaced.** Only `branding/scripts/test-app-download-branding.sh` catches it — its two `present` assertions
failed. Notably `branding/scripts/verify-branding.sh` reports **OK**: it only greps for the literal Immich strings,
which are now absent from source, so its `absent`-style check passes vacuously. That false-OK is left as-is this cycle
and flagged under Follow-up work.

**Resolution.** `patch_app_download_modal()` now rewrites the `Constants.Get.Android` / `Constants.Get.iOS` expressions
to the fork's literal URLs, and drops the `Constants` import once every href is a literal (leaving it would trip the
branded build's zero-warning lint). The literal-URL rewrites are retained so the patch still works if upstream moves
back. The regression test gained an assertion for the dropped import. Commit `3c05755cef2`.

Verified by running the real patch against a throwaway copy: Play Store →
`https://play.google.com/store/apps/details?id=de.opennoodle.gallery`, App Store →
`https://apps.apple.com/us/app/noodle-gallery/id6761776289`, F-Droid badge → GitHub releases link. Test: 10/10
assertions pass (was 8/10 failing 2 before the fix).

## Conflict Resolutions

### Conflict: `.github/workflows/docs-destroy.yml` (batch 51)

- **Fork side**: file deleted by `b9894484e7e` ("chore: remove docs-destroy.yml from upstream rebase (#187)")
- **Upstream side**: bumped `use-mise` v3.2.0 → v3.2.1 inside it
- **Resolution**: kept the fork's deletion (`git rm`). The fork deliberately does not carry this workflow.
- **Risk**: LOW
- **Verification**: `ci-invariants-check` green; file absent from the final tree.

### Conflict: `.github/workflows/prepare-release.yml` (batch 51)

- **Fork side**: file deleted by `23880863d80` ("chore: unified release versioning from git tags (#207)"), which
  replaced upstream's release machinery with `gallery-release.yml`
- **Upstream side**: bumped one action version inside it
- **Resolution**: kept the fork's deletion. Confirmed from the commit body that removing upstream release machinery was
  the explicit intent.
- **Risk**: LOW
- **Verification**: `ci-invariants-check` green ("Gallery release workflows publish Gallery images").

### Conflict: `.github/workflows/test.yml` (batch 51)

- **Fork side**: `feb066ad12c` (#516) swapped `Setup Mise` for `Setup pnpm` + `Setup Node` in the job at that position,
  and appended the fork-only `upstream-preflight` ("Upstream Rebase Tooling") job
- **Upstream side**: bumped `use-mise` v3.2.0 → v3.2.1 in the same step
- **Resolution**: took the fork side for that hunk only, editing the conflict in place rather than
  `checkout --theirs`, so upstream's other 12 `use-mise` bumps elsewhere in the file survived. diff3 had mis-aligned the
  hunk because the fork replaces upstream's `script-unit-tests` job with `upstream-preflight` at the same position.
- **Risk**: LOW
- **Verification**: `git diff 67178158e9a..HEAD -- .github/workflows/test.yml` reduces to exactly **13 `use-mise`
  v3.2.0 → v3.2.1 bumps and nothing else** — no fork job lost, no upstream bump dropped.

## Fork Feature Verification

| Feature                        | Status | Notes                                                                                     |
| ------------------------------ | ------ | ----------------------------------------------------------------------------------------- |
| Shared Spaces                  | OK     | Fork-Owned File Survival + Fork Extension Symbol Survival green on all 4 batches          |
| Storage Migration              | OK     | Audit green; no upstream commit touched the backends                                      |
| Pet Detection                  | OK     | Untouched this cycle                                                                      |
| Image Editing                  | OK     | Untouched this cycle                                                                      |
| Branding                       | FIXED  | Regression from #30527 found and repaired — see above; branding test 10/10                |
| Google Photos Import           | OK     | Untouched this cycle                                                                      |
| Fork Memories (iOS widget)     | OK     | Fork's `ImmichAPI.swift` delta (`type=on_this_day` query param, #418) survived intact     |
| Mobile Space-album sync nudges | OK     | `syncRemote()` call sites keep the default `enqueue: false`, preserving current behaviour |

## CI and Infrastructure Verification

| Check                                       | Status | Notes                                                                   |
| ------------------------------------------- | ------ | ----------------------------------------------------------------------- |
| Workflow files (no upstream collisions)     | OK     | 3 conflicts resolved in favour of fork intent                           |
| Docker image references (`gallery-*`)       | OK     | `ci-invariants-check`: Gallery release workflows publish Gallery images |
| No upstream `PUSH_O_MATIC` token dependency | OK     | `ci-invariants-check` green                                             |
| Upstream docs deploy stays dispatch-only    | OK     | `ci-invariants-check` green                                             |
| Fork CI modifications intact                | OK     | fork-only workflows all present; deletions preserved                    |
| `@immich/ui` patch applies                  | OK     | `fork-patches-check` green (patch pinned at `0.83.0`)                   |

## Database Migration Analysis

### New Upstream Migrations

**None.** No commit in this range touched `server/src/schema/`.

### Ordering, collisions and merge

- Gallery migration count: **49** (unchanged, matches manifest)
- Timestamp collisions: NONE (`Migration Timestamp Collision Check` green on all 4 batches)
- `postbuild` merge intact: YES — `pnpm build` printed
  `Synced 49 Gallery migrations into dist/schema/migrations; removed 0 stale files; wrote 1 compatibility aliases.`
- `CompositeMigrationProvider` intact: YES
- `revert-to-immich.sql` coverage (step 7i): **complete** — the detector reported no `MISSING` entries against the
  tagged `v3.1.0` upstream tree.

## Mobile Drift Migration Analysis

- New upstream mobile migrations: **NONE**
- `schemaVersion`: **36** (unchanged); fork continues to own snapshots v32–v36
- Collision check: `mobile-drift-rebase-check` green for batches 52 and 53
- No renumbering required

## Inconsistencies Found

One, described in full above: upstream #30527 moving store URLs into `@immich/ui` `Constants` broke the fork's
branding rewrite with **no conflict, no type error, and no audit failure**. This is the same class as the
`getLensModel` `String()` regression from the 2026-08-03 cycle — an upstream change that silently invalidates a
fork-side assumption living in a _different file_. The generalisable lesson: when upstream moves a hardcoded value
behind a shared constant or helper, grep the branding scripts and any fork tooling that rewrites that value by literal
match.

## Pattern Propagation

| Refactor                                                    | Old → New Pattern                                             | Fork Files Affected                                                   | Decision | Commit        |
| ----------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------- | -------- | ------------- |
| Store/social URLs centralised into `@immich/ui` `Constants` | literal URL in component → `Constants.Get.*` from the package | `branding/scripts/apply-branding.sh`, `test-app-download-branding.sh` | Bundled  | `3c05755cef2` |

Scope note: only the app-download modal is affected today. `Constants.Socials.*` / `Constants.Sites.*` are not yet used
by any file the branding scripts rewrite, but the same trap applies if upstream migrates more hardcoded URLs — the
branding rewrites are all literal-match.

### Follow-up work

- **`branding/scripts/verify-branding.sh` reports a false OK for this class.** Its `AppDownloadModal.svelte` check only
  asserts that Immich strings are _absent_; once upstream moved the URLs into the package, that passed vacuously while
  the modal was in fact unbranded. It should additionally assert the Noodle URLs are _present_. Not changed this cycle
  (scope was limited to `apply-branding.sh`); worth a small follow-up PR.
- **Local `main` carries one unpushed commit** (`eccf522a801`, "chore(web): clear pre-existing lint warnings") that is
  not on `origin/main` and therefore not part of this rolling branch. Flagged for awareness only — no action taken.

## Local CI Verification

| Check                                        | Status | Notes                                                         |
| -------------------------------------------- | ------ | ------------------------------------------------------------- |
| `server pnpm build` (+ postbuild sync)       | PASS   | 49 migrations synced, 1 compatibility alias                   |
| `server pnpm check` (tsc)                    | PASS   | exit 0                                                        |
| `web check:typescript`                       | PASS   | exit 0                                                        |
| `web check:svelte`                           | PASS   | exit 0 — 575 files, 0 errors, 0 warnings (not a 0-file no-op) |
| Server unit tests                            | PASS   | 157 files passed / 1 skipped; 5265 tests passed               |
| Web unit tests                               | PASS   | 300 files passed / 1 skipped; 4096 tests passed               |
| Branding regression test                     | PASS   | 10/10 assertions (was failing 2/10 before the fix)            |
| `revert-to-immich.sql` coverage detector     | PASS   | no missing entries                                            |
| Post-rebase audits (batches 50–53)           | PASS   | all 7 checks green per batch                                  |
| `ci-invariants-check` / `fork-patches-check` | PASS   | green                                                         |
| `mobile-drift-rebase-check` (52, 53)         | PASS   | green                                                         |

`make sql` and `make open-api` were **not** run: no controller, DTO or repository changed in this range, and the
audit's "Generated Artifact Review" reported no generated artifact needing attention. Running `make sql` without a live
database would delete every file under `server/src/queries/`.

## Remote CI Verification

See the follow-up commit recording the dispatched run results.

## Post-Rebase Verification

- Fork commits ahead of upstream: 1084
- Commits behind upstream: **0** (level with `upstream/main`)
- Upstream newest tag: `v3.1.0` — **unchanged**, so the branch stays off `main` and version references are not bumped
- Fork diff looks clean: YES
