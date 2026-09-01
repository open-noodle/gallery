# Upstream Sync Report — 2026-09-01 (batches 204–213)

## Summary

- **Upstream commits pulled**: 10 (`5666d57f15a..1c7f9a4f24b`), one per batch, 204–213
- **Fork commits synced**: 0 — `origin/main` has not moved since #1037 (2026-08-29), so
  `integratedForkHead` stays `9c31bc01655` and no `upstream-sync-fork-main` ran
- **Conflicts resolved**: 46 hunks across 20 files, at 9 replayed fork commits
- **Risk level**: MEDIUM (dependency + CI churn, one server behaviour change)
- **Recommendation**: PROCEED
- **Product-direction gate**: did NOT fire
- **Position**: 1402 ahead / **0 behind** `upstream/main`
- **Backup**: `backup/rolling-pre-b204-20260901` (`41e776488e6`)
- **Upstream stable tag is still `v3.1.0`**, which `branding/config.json` already carries — no
  version bump, and the branch stays off `main`.

## Incoming Upstream Changes

| Batch | SHA           | Summary                                             | Area        | Risk     | Outcome                                                  |
| ----- | ------------- | --------------------------------------------------- | ----------- | -------- | -------------------------------------------------------- |
| 204   | `5fcfb639807` | update typescript-projects (immich-31183)           | toolchain   | MED-HIGH | 3 lockfile conflicts, all hand-resolved then regenerated |
| 205   | `d441795a0ec` | ghcr.io/jdx/mise → v2026.8.16 (immich-31177)        | Docker      | MED      | byte-exact to upstream                                   |
| 206   | `40e6abc4b8b` | update github-actions (immich-31182)                | CI          | MED      | 37 hunks + 5 fork-deleted files                          |
| 207   | `bca4bd6dd39` | deprecate outlook SMTP (immich-31139)               | docs        | LOW      | clean                                                    |
| 208   | `935c32e54a3` | workflows write perm on backport job (immich-31191) | CI          | LOW      | fork-deleted file → `git rm`                             |
| 209   | `1c2bee9986d` | remove stars chart from readme (immich-31175)       | docs        | LOW      | no-op for the fork (see below)                           |
| 210   | `9e1e5959394` | discussions perm on release token (immich-31167)    | CI          | LOW      | fork-deleted file → `git rm`                             |
| 211   | `c1f2756f62a` | never unlink a now-tracked path (immich-31074)      | server      | MED      | reconciled with the fork's S3 guard                      |
| 212   | `44f1c5ad3aa` | add backport label (immich-31195)                   | CI          | LOW      | fork-deleted file → `git rm`                             |
| 213   | `1c7f9a4f24b` | asset page zoom test overrides (immich-31201)       | mobile test | LOW      | clean                                                    |

### Pre-rebase detectors — all clear

| Detector                                                                     | Result                                               |
| ---------------------------------------------------------------------------- | ---------------------------------------------------- |
| Shape I — upstream **adds** a file at a fork-deleted path                    | clean                                                |
| Shape I — upstream **renames** onto a fork-touched path                      | clean                                                |
| Shape J — upstream enumerates a set the fork adds members to                 | clears, see below                                    |
| Silent-noop — deleted URL literals still literal-matched by branding tooling | clean                                                |
| i18n branding-override gap                                                   | clean (batch does not touch `i18n/en.json`)          |
| Shape L — unresolvable `package:immich_mobile/` imports                      | clean                                                |
| Zero-byte files (the `--theirs` trap)                                        | none new; the 3 empty tracked files are pre-existing |

### Shape J analysis — `getTrackedPaths` (batch 211)

immich-31074 adds `IntegrityRepository.getTrackedPaths`, which **enumerates a set**:
`asset.originalPath` ∪ `asset_file.path` ∪ `person.thumbnailPath`. Any fork-owned table holding a
live filesystem path would have to be a member, or the integrity job could unlink a file the fork
still references.

**The fork adds no member.** `shared_space_person` has no path column at all — space-person
thumbnails are either generated on the fly from the representative `asset_face`, or resolved to the
**personal** `person.thumbnailPath` (already in upstream's union) via
`getPersonalThumbnailForSpacePerson`. The other fork tables carrying paths
(`storage_migration_log`, `integrity_report`) are log/report rows, not live references.

## Conflict Resolutions

### 1. `pnpm-lock.yaml` — fork-only `bits-ui` inside an asymmetric diff3 region (batch 204)

- **Fork side**: adds the fork-only `bits-ui` importer entry (declared in `web/package.json`,
  absent from upstream's).
- **Upstream side**: bumps the adjacent `@zoom-image/svelte` resolution to svelte 5.56.10.
- **Shape**: `ours=1 / base=1 / theirs=4` — a **Shape K** asymmetric alignment. Taking `ours`
  compiles and silently drops `bits-ui`.
- **Resolution**: kept upstream's version line **and** the fork's `bits-ui` block, then regenerated.
- **Risk**: LOW after regen. **Verification**: `bits-ui` present and re-resolved onto svelte 5.56.10.

### 2. `packages/scripts` — a Renovate commit resurrected a fork-deleted path (batch 204)

- **Fork side**: `0f0015f6687` exists precisely to undo this resurrection (Shape I "hardest form").
- **Upstream side**: the deps bump edited `packages/scripts/package.json`, re-creating the path.
- **Resolution**: `git rm` the file and deleted the orphan `packages/scripts:` importer from the
  lockfile. **This is the second occurrence of the identical event**, by the same mechanism
  (a Renovate bump touching a package the fork dropped).
- **Risk**: LOW. **Verification**: `grep -c 'packages/scripts' pnpm-lock.yaml` = 0, and the
  fork's own `fork-deletions.spec.ts` guard passes.

### 3. `pnpm-lock.yaml` — `@immich/ui` `patch_hash` vs upstream's resolution bump (batch 204)

- **Fork side**: the `patch_hash=8bc0a024…` segment that keeps the fork's command-palette patch
  applied (the patch deliberately does not register Ctrl+K / Cmd+K / `/`, which Gallery owns).
- **Upstream side**: svelte 5.56.9 → 5.56.10 inside the same resolution strings.
- **Resolution**: took upstream's line and re-inserted the fork's `patch_hash`, in both hunks.
- **Risk**: LOW. **Verification**: `pnpm install` emitted `patch_hash` entries, which it only does
  when the patch actually applies — stronger evidence than `fork-patches-check`, which per its own
  history only checks that the declared file exists.

### 4. Five fork-deleted workflows, modified by the actions bump (batches 206, 208, 210, 212)

`docs-destroy.yml`, `prepare-release.yml`, `backport.yml` (×2), `draft-release.yml`.

- **Resolution**: `git rm` in every case — never `git checkout --theirs`, which writes a **zero-byte**
  workflow that Actions reads as invalid and no gate greps for.
- Each was verified absent from the pre-cycle tip before removal, and a post-batch scan confirmed no
  new zero-byte tracked file exists.

### 5. 37 workflow hunks — the fork's `github.token` migration vs upstream's action pins (batch 206)

- **Fork side**: deletes upstream's `create-workflow-token` step (the fork has no `PUSH_O_MATIC`
  GitHub App) and, in `preview-label.yaml`, replaces a 50-line job body with a disabled stub.
- **Upstream side**: inside those same regions, changes **only** the pinned action SHA and its
  trailing version comment.
- **Resolution**: took the fork's side, under a machine-checked assertion that upstream's delta
  within each region normalises to nothing but the pin. The resolver **refused** the one hunk that
  did not match that shape (README, below) rather than guessing.
- **Risk**: LOW. **Verification**: the whole-file diff of `.github/` against the pre-cycle tip is
  **9 lines, every one of them a pinned-action bump** — `test.yml`, which had 18 hunks, is otherwise
  byte-identical to the pre-cycle tip.

### 6. `README.md` — star-history removal vs the fork's branded README (batch 209)

- **Shape**: `ours=1 / base=11 / theirs=9`, another Shape K asymmetry.
- **Resolution**: took the fork's side, asserting that upstream's delta was the star-chart removal
  and that the fork's side contains no star chart.
- **Verification**: the resulting `README.md` is **byte-identical to the pre-cycle tip** — upstream's
  change was a genuine no-op here, because the fork's README never carried the chart.

### 7. `integrity.service.spec.ts` — add/add union (batch 211)

- **Shape**: `base=0` — upstream adds a 60-line `handleUntrackedRefresh` describe, the fork adds an
  18-line `S3 backend guard` describe, at the same location.
- **The trap**: both sides end mid-block and rely on the _shared tail_ to close them, so a naive
  union yields +4 unclosed braces. A previous cycle shipped exactly this bug.
- **Resolution**: emitted upstream's block, an explicit `});` / `});` closer, then the fork's block.
- **Verification**: whole-file brace and paren balance is 0/0; both describes present; the suite runs.

### 8. `integrity.service.ts` — auto-merged, verified by hand (batch 211)

This file **did not conflict**, which is exactly when fork behaviour goes missing. Verified
explicitly:

- the fork's `skipIfS3Configured` definition + **8 guards** — count identical to the pre-cycle tip;
- upstream's three new `getTrackedPaths` call sites all present;
- and in `handleUntrackedRefresh` the fork's S3 skip **precedes** upstream's new lookup, so an
  S3-configured instance still returns `JobStatus.Skipped` before any path work happens.

## Fork Feature Verification

| Feature                            | Status | Notes                                                           |
| ---------------------------------- | ------ | --------------------------------------------------------------- |
| Shared Spaces                      | OK     | `ci-invariants-check` person-join and Search-V3 invariants pass |
| Storage Migration / S3             | OK     | integrity S3 guard intact at 8 call sites (gallery#685)         |
| Pet Detection                      | OK     | untouched                                                       |
| Image Editing                      | OK     | untouched                                                       |
| Branding                           | OK     | no upstream-name leak; i18n override detector clean             |
| Google Photos Import               | OK     | untouched                                                       |
| `@immich/ui` command-palette patch | OK     | `patch_hash` applied by pnpm                                    |
| Search V3 coexistence              | OK     | `search-v3-not-dispatched` invariant passes                     |

## CI and Infrastructure Verification

| Check                                         | Status | Notes                                                                |
| --------------------------------------------- | ------ | -------------------------------------------------------------------- |
| Fork-deleted workflows stay deleted           | OK     | 5 modify/delete conflicts resolved with `git rm`                     |
| No zero-byte workflow introduced              | OK     | full tracked-file scan; 3 empty files all pre-existing               |
| Docker image references                       | OK     | `ci-invariants-check`: Gallery workflows publish Gallery images      |
| No upstream `PUSH_O_MATIC` dependency         | OK     | `ci-invariants-check`                                                |
| Upstream docs deploy stays dispatch-only      | OK     | `ci-invariants-check`                                                |
| `.github` prettier (separate gate)            | OK     |                                                                      |
| Dockerfile stage paths (Shape D)              | OK     | no `/app` override; all 4 `COPY --from=plugins` at `/usr/src/app`    |
| `mise.lock` fork tool blocks                  | OK     | 39 jellyfin-ffmpeg lines; diff identical to upstream's own change    |
| Workspace linking (`injectWorkspacePackages`) | OK     | 11 `version: link:` / 0 `version: file:`, matching the pre-cycle tip |
| `@faker-js/faker` pin                         | OK     | identical to upstream                                                |
| Commit autolinks                              | OK     | 1402 messages scanned, fork PR ceiling 1044                          |

## Database Migration Analysis

**No migration files changed this cycle** (`git diff --name-only -- server/src/schema/migrations
server/src/schema/migrations-gallery` is empty).

- Gallery migration count: 62 (expected 62); manifest coverage OK; no timestamp collision
- `postbuild` sync intact: "Synced 62 Gallery migrations … wrote 1 compatibility aliases" — the
  load-bearing `ChangeDurationToInteger` alias is present
- `revert-to-immich.sql` coverage: **0 missing entries** against upstream tag `v3.1.0`

## Mobile Drift Migration Analysis

`mobile-drift-rebase-check BATCH=213`: schemaVersion, snapshots and Gallery callbacks consistent.
No mobile migration changed; `mobile/mise.toml` (Flutter **3.47.1**) and `pubspec.yaml` untouched.

## Generated Artifacts

`server/src/queries/integrity.repository.sql` changed (+22). The post-rebase audit flags it as an
informational `Generated Artifact Review` ISSUE; reviewed and cleared:

- `server/src/repositories/integrity.repository.ts` and `server/src/queries/integrity.repository.sql`
  are both **byte-identical to `upstream/main`** — the fork contributes nothing to that repository,
  so the generated SQL is exactly upstream's and no fork block can have been lost.
- `Generated Query Block Survival` (the gate added after the last cycle's lossy `.sql` conflict)
  reports no block lost. No `.sql` conflict occurred this cycle, so no regeneration was required.

## Inconsistencies Found

None outstanding. Two recurrences worth noting, both mechanically repaired in-cycle:

1. **`packages/scripts` resurrection (2nd occurrence)** — a Renovate deps bump is the reliable
   trigger, because it edits `package.json` in every workspace member including ones the fork
   deleted. The fork's `fork-deletions.spec.ts` guard now covers it.
2. **The local web-lint workaround reports false warnings.** Running
   `npx eslint . --rule '{"tscompat/tscompat":"off"}'` (needed because the plugin crashes locally)
   orphans every `eslint-disable … tscompat/tscompat` comment, producing exactly one
   `Unused eslint-disable directive` warning per directive — 13 here, matching the 13 directives in
   `web/src`, unchanged from the pre-cycle tip. **Local reading: 0 errors is clean**; the warning
   count is an artifact and does not indicate a `--max-warnings 0` failure in CI.

## Local CI Verification

| Check                                            | Status | Notes                                                         |
| ------------------------------------------------ | ------ | ------------------------------------------------------------- |
| `server pnpm build` (+ postbuild migration sync) | PASS   | 62 migrations, 1 compatibility alias                          |
| `server pnpm check` (tsc)                        | PASS   |                                                               |
| `server pnpm lint`                               | PASS   |                                                               |
| `server prettier --check`                        | PASS   |                                                               |
| Server unit tests                                | PASS   | 6130 passed, 12 skipped, 199 files                            |
| `mise //:sdk:build`                              | PASS   |                                                               |
| `web check:typescript`                           | PASS   |                                                               |
| `web check:svelte`                               | PASS   | 627 files, 0 errors, 0 warnings                               |
| web eslint (`tscompat` off)                      | PASS   | 0 errors (13 artifact warnings, see above)                    |
| `web prettier --check`                           | PASS   |                                                               |
| Web unit tests                                   | PASS   | 5970 passed, 2 skipped, 8 todo, 374 files                     |
| `docs prettier --check`                          | PASS   |                                                               |
| `.github prettier --check`                       | PASS   |                                                               |
| mobile `dart analyze --fatal-infos`              | PASS   | No issues found                                               |
| mobile `dart format`                             | PASS   | 869 files, 0 changed                                          |
| mobile `flutter test`                            | PASS   | 3494 passed, 1 skipped                                        |
| `upstream-postrebase-audit` 204–213              | PASS   | 8 OK per batch; batch 211's informational ISSUE cleared above |
| `ci-invariants-check`                            | PASS   | 5/5                                                           |
| `fork-patches-check`                             | PASS   |                                                               |
| `commit-autolink-check`                          | PASS   |                                                               |
| `mobile-drift-rebase-check`                      | PASS   |                                                               |

## Remote CI Verification

- **Test branch**: `rebase/upstream-batch-213`
- **Commit validated**: _(filled in after dispatch)_

## Post-Rebase Verification

- Fork commits ahead of upstream: **1402**
- Commits behind upstream: **0**
- Whole-tree diff vs the pre-cycle tip: **24 files**, each attributable to exactly one batch, with
  `packages/scripts/package.json` correctly absent from upstream's 10-file change
- Fork diff looks clean: YES
