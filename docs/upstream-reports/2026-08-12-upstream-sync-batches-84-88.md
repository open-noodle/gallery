# Upstream Sync Report — 2026-08-12 (batches 84–88)

## Summary

- **Upstream commits pulled**: 5 (`00d10dab639..610bcfa6d09`, batches 84–88)
- **Fork commits synced**: 0 — `origin/main` never moved during the cycle
- **Conflicts resolved**: 7 conflicted files across 6 rebase steps
- **Risk level**: MEDIUM
- **Recommendation**: PROCEED
- **Branch**: `rebase/upstream-rolling-v3.1.1`, level with `upstream/main` (0 behind)
- **On `main`?** No — the newest upstream tag is still `v3.1.0`, so the standing rule is unmet.

This is an **upstream-only** cycle. `git log 576fc26b6cc..origin/main` was empty at scan time and
still empty at the end, so the Skill Sync Anchor scan surfaced no new fork surface and the skill's
feature/CI tables are unchanged.

The batch includes `a55dc80a568` (#30718 strict equality), which the previous cycle deliberately left
behind so it could get its own `eqeqeq` sweep rather than invalidating that cycle's gate run.

## Incoming Upstream Changes

| SHA           | Summary                                                      | Area           | Risk to Fork | Notes                                                                                                               |
| ------------- | ------------------------------------------------------------ | -------------- | ------------ | ------------------------------------------------------------------------------------------------------------------- |
| `a55dc80a568` | chore: enforce strict equality checks (#30718)               | server + web   | MEDIUM       | Turns on `eqeqeq: 'error'` in both eslint configs and fixes upstream's own 33 files. Fork sweep: 10 sites           |
| `c7d7889ed01` | fix: pass secrets to build-mobile (#29031)                   | CI             | MEDIUM       | Adds `PUSH_O_MATIC_*` to a workflow the fork has deliberately de-PUSH_O_MATIC'd; also edits a file the fork deleted |
| `199723261c6` | fix: owner cascade delete album (#30692)                     | server schema  | HIGH         | New `album_user_delete` trigger + a migration whose `up()` starts with a destructive `DELETE FROM "album"`          |
| `0344c61e4ce` | feat: use version service for docs archive switcher (#30675) | docs / scripts | LOW          | Inert for the fork; touches two files the fork deleted                                                              |
| `610bcfa6d09` | chore(mobile): add Cocoapods to mise (#30722)                | mobile CI      | MEDIUM       | `mise //mobile:install:ci` now runs `pod install`, and the fork's own iOS workflow consumes that task               |

**Per-file fork divergence: 29 of 48 touched files (60%)** — the highest ratio recorded (previous high
36%, on the 12-step/31-conflict cycle). It over-predicted here, and the reason is worth keeping: the
ratio measures _how much fork content sits in the touched files_, not _how much upstream changed in
them_. This batch's edits are overwhelmingly one-line `==` → `===` swaps, so most landed in
auto-mergeable isolation. **Read the ratio together with the size of upstream's own delta**; a high
ratio over tiny edits is a different animal from a high ratio over a refactor.

### High-risk change in detail — `199723261c6` (album owner cascade delete)

Upstream added an `AFTER DELETE ... FOR EACH ROW` trigger on `album_user` that deletes the album once
its last `'owner'`-role row is gone, plus the `album_user_delete` function, the
`@AfterDeleteTrigger` decorator on `AlbumUserTable`, the `functions` array registration, and migration
`1786385711807-AlbumOwnerDeleteTrigger`. The migration's `up()` opens with
`DELETE FROM "album" WHERE NOT EXISTS (SELECT * FROM "album_user" WHERE ... role = 'owner')`.

Verified before pulling it in:

- **The fork cannot produce ownerless albums.** There is exactly one album insert path
  (`album.repository.ts` `createWithAssets`), and its CTE inserts the owner `album_user` row in the
  same statement. The destructive `DELETE` should therefore be a no-op on a Gallery database.
- **Space grants do not create `album_user` rows** (`shared-space.service.ts:744`: "AlbumUpdate =
  owner ∪ album_user-editor and is NOT extended by the space grant"), so space membership changes
  cannot fire the new trigger.
- **Album deletion already cascades into Space Albums correctly.**
  `shared_space_album.albumId` is `ON DELETE CASCADE`, and the fork's
  `shared_space_album_delete_audit` trigger explicitly documents that it handles "unlinking (direct or
  via cascade from album/shared_space deletion)". The new upstream path lands inside behaviour the
  fork already covers.
- **`functions.ts` is purely additive on the fork side** —
  `git diff upstream/main HEAD -- server/src/schema/functions.ts | grep '^-[^-]'` is empty — and
  upstream inserts at line ~136 while the fork appends from line 300, so the two never met.

Residual exposure is the interaction between the new row trigger and the fork's shared-space album
triggers under a real database, which only the Medium Tests job can exercise (Docker was unavailable
locally). That job is called out in the remote-CI section below.

## Conflict Resolutions

### Conflict: `server/src/services/metadata.service.ts` (batch 84, at the fork squash commit)

- **Fork side**: the S3 `ensureLocalFile` try/finally wrapping re-indents the whole `tasks.push(...)`
  block, so the fork's copy of the region sits at a deeper indent inside a larger structure.
- **Upstream side**: four `==` → `===` swaps (`val`, `asset.width`, `asset.height`, `timeZone`), two of
  which fall inside that region.
- **Resolution**: took the fork's file (`--theirs`) and re-applied all four one-line edits.
  `diff <(git show :3:<path>) <path>` afterwards printed **exactly those four lines and nothing else**,
  which is the objective check that no fork content was lost.
- **Risk**: LOW. **Verification**: the diff above; `pnpm check`; `pnpm lint`.

### Conflict: `server/src/repositories/user.repository.ts` (batch 84, at fork #492)

- **Fork side**: #492 ("count physical storage in quota sync") replaced upstream's `syncUsage(id?)`
  with `setUsage(id, usage)`, deleting the `.$if(id != undefined, …)` tail.
- **Upstream side**: one `==` → `===` swap on that exact line.
- **Resolution**: took the fork side. Upstream's fix is not _dropped_, it is _inapplicable_ — the line
  it targets no longer exists. Confirmed with `git show :3:<path> | grep 'id !== undefined\|syncUsage'`
  → no match, and `diff :1: :2:` showing upstream's delta is that single line.
- **Risk**: LOW. The resolved file came out byte-identical to the fork's pre-rebase copy (it is absent
  from the cycle's changed-file list).

### Conflict: `server/src/repositories/asset.repository.ts` (batch 84, at fork #761)

- **Fork side**: #761 refactors `getTimeBucket` into a two-stage query, **deleting** the hand-rolled
  `$if` filter chain in favour of the shared `withTimeBucketAssetFilters` helper.
- **Upstream side**: two `==` → `===` swaps — one on `options.visibility == undefined` _inside the
  deleted chain_, one on `options.orderBy == AssetOrderBy.CreatedAt` in the `.orderBy(...)` the fork
  keeps.
- **Resolution**: took the fork side, then re-applied **only** the surviving one. Skipping this second
  edit would have been the classic "fork replay silently reverts an upstream fix" failure — the file
  would have compiled, linted clean under the old config, and reddened Lint Server under the new one.
- **Risk**: LOW. **Verification**: `diff <(git show :3:<path>) <path>` = exactly one line.

### Conflict: `.github/workflows/prepare-release.yml` (batch 85, modify/delete at fork #207)

- **Fork side**: deleted wholesale by #207 ("unified release versioning from git tags").
- **Upstream side**: added two `PUSH_O_MATIC_APP_*` secret passes.
- **Resolution**: kept the fork's deletion. The dropped lines are exactly the pattern the fork's
  `no-push-o-matic` CI invariant forbids.
- **Risk**: LOW.

### Conflict: `packages/scripts/src/commands/release.{ts,spec.ts}` (batch 87, modify/delete)

- **Fork side**: the whole `packages/scripts` tree is deleted by the fork's "drop upstream #29331
  release-version tooling" commit.
- **Upstream side**: removed `resolveArchivedVersions` and its tests.
- **Resolution**: kept the fork's deletion.
- **Risk**: LOW.

### Conflict: `.github/workflows/build-mobile.yml` (batch 88, at the fork squash commit)

- **Fork side**: inserts `- uses: ./.github/actions/apply-branding` after Setup Mise.
- **Upstream side**: inserts a `Setup Ruby` step at the same anchor (moved up from later in the job so
  that `mise //mobile:install:ci` can run `pod install`).
- **Resolution**: kept **both**, branding first. `diff <(git show :2:<path>) <path>` afterwards showed
  only the fork's two `apply-branding` insertions, confirming upstream's reordering survived intact.
- **Risk**: LOW.

## Zero-conflict semantic breaks found

Two, both caught before CI:

| Upstream change                                                                                                    | What broke, elsewhere                                                                                                                                                     | Caught by                              |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| #29031 adds `PUSH_O_MATIC_APP_CLIENT_ID`/`_KEY` as `workflow_call` secrets in `build-mobile.yml`                   | Auto-merged cleanly into a file whose fork rule _forbids the pattern outright_ — `docs/fork/ownership.yml` `ci_invariants` `no-push-o-matic`                              | `make ci-invariants-check`             |
| #30722 makes `mise //mobile:install` depend on a new `install:ios` task that runs `cd ios && pod install` on macOS | The fork's own `gallery-build-mobile.yml` iOS job runs `mise //mobile:install:ci` **before** its Setup Ruby step, so CocoaPods would fire without the bundler-pinned Ruby | Reading the batch diff at Checkpoint 1 |

The second is the more interesting shape: the fork's workflow depends on the _semantics of an upstream
mise task_, not on any text in an upstream file. Nothing conflicts, no compiler or audit sees it, and
the failure would only appear in a release-time iOS build. **After any upstream change to
`mobile/mise.toml`'s task graph, re-read the fork's own mobile workflows for steps that call those
tasks.**

### Detectors run

- **URL-literal silent-noop detector** — fired on `https://docs.immich.app`, deleted from
  `docs/src/components/version-switcher.tsx` by #30675 and still literal-matched by
  `branding/scripts/apply-branding.sh`. **Investigated → benign, twice over**: that string is an entry
  in `UPSTREAM_IDENTIFIERS_JSON`, which is a _shield_ list (identifiers deliberately left unbranded),
  not a rewrite list; and the fork removed the `custom-versionSwitcher` navbar entry from
  `docs/docusaurus.config.js`, so the component is registered in `ComponentTypes.js` but never
  rendered. Upstream's whole change is dead code here.
- **Asset↔test coupling detector** — N/A: the batch touches no assets and no asset-consuming tests.
- **`revert-to-immich.sql` coverage detector** — clean before the batch, reported exactly one
  `MISSING` after it, clean again after the fix below.

## Fork-side follow-through

| Item                                                                         | Commit                                                           |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Remove upstream's `PUSH_O_MATIC_*` secrets from `build-mobile.yml`           | `ci(rebase): keep build-mobile.yml free of PUSH_O_MATIC secrets` |
| Reorder the fork's iOS job so Setup Ruby precedes `mise //mobile:install:ci` | `ci(mobile): set up Ruby before mise installs iOS dependencies`  |
| Cover `1786385711807-AlbumOwnerDeleteTrigger` in `revert-to-immich.sql`      | `chore(revert-to-immich): cover AlbumOwnerDeleteTrigger`         |
| `eqeqeq` sweep of fork-only code (10 sites)                                  | `chore(fork): satisfy eqeqeq in fork-only code`                  |

### The `eqeqeq` sweep is not a mechanical `===` substitution

Measured before the rebase and again after: **server 1 site, web 9 sites**, everything else fixed by
upstream's own commit.

- `server/src/services/metadata.service.ts:1166` (fork #608's timezone recovery) → `=== null`, on the
  same `string | null` variable upstream had already strictened 24 lines above.
- Nine `x != null` guards in three fork-only Spaces components (`space-list-item.svelte`,
  `space-card.svelte`, `space-hero.svelte`) → **`!== undefined`, not `!== null`**.
  `SharedSpaceResponseDto` declares `assetCount`/`memberCount` as `z.number().optional()`, so the
  absent value is `undefined` and the field is never `null`. A blind `!== null` rewrite would have let
  `undefined` through the guard and rendered the literal string `undefined` into the Spaces list, card
  and hero. **`!= null` is a two-value guard; check which of the two the type actually produces before
  strictening it.**

## Fork Feature Verification

| Feature                      | Status | Notes                                                                                                  |
| ---------------------------- | ------ | ------------------------------------------------------------------------------------------------------ |
| Shared Spaces                | OK     | `functions.ts` purely additive; space-album cascade path re-verified against the new album trigger     |
| Space Albums                 | OK     | `shared_space_album.albumId` CASCADE + `shared_space_album_delete_audit` already handle album deletion |
| Storage Migration            | OK     | Untouched                                                                                              |
| Pet Detection                | OK     | Untouched (`machine-learning/` delta empty)                                                            |
| Image Editing                | OK     | `metadata.service.ts` S3 try/finally + edited-dimension guard preserved verbatim                       |
| Branding                     | OK     | `apply-branding.sh` unaffected; the one detector hit is a shield entry on dead code                    |
| Google Photos Import         | OK     | Untouched                                                                                              |
| Timeline text filters (#761) | OK     | Two-stage `getTimeBucket` preserved; only the surviving upstream `===` re-applied                      |
| Quota sync (#492)            | OK     | `setUsage` preserved; resolved file byte-identical to pre-rebase                                       |

## CI and Infrastructure Verification

| Check                                     | Status | Notes                                                                                        |
| ----------------------------------------- | ------ | -------------------------------------------------------------------------------------------- |
| `make ci-invariants-check`                | OK     | Failed first on the imported `PUSH_O_MATIC`, green after the fix                             |
| `make fork-patches-check`                 | OK     | `@immich/ui` patch intact                                                                    |
| `make mobile-drift-rebase-check BATCH=88` | OK     | No Drift change in the batch                                                                 |
| `make upstream-postrebase-audit` (84–88)  | OK     | All 7 checks green on every batch                                                            |
| Docker image references                   | OK     | `docker.yml` untouched; the `mirror` job removed last cycle is still absent                  |
| Gallery migration count                   | OK     | 49, unchanged                                                                                |
| `mobile/mise.toml` fork rules             | OK     | Diff vs upstream is exactly the two fork divergences (DCM key gate, `checklist` → `codegen`) |
| `mise.lock` / `pnpm-lock.yaml` churn      | NONE   | No dependency manifest touched this cycle                                                    |

## Database Migration Analysis

### New Upstream Migrations

| Timestamp     | Migration               | Tables                                       | Risk to Fork | Notes                                                                                               |
| ------------- | ----------------------- | -------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------- |
| 1786385711807 | AlbumOwnerDeleteTrigger | `album`, `album_user`, `migration_overrides` | MEDIUM       | Additive trigger/function; destructive `DELETE FROM "album"` proven a no-op for fork-created albums |

- **Timestamp collisions**: none (`Migration Timestamp Collision Check` OK).
- **Gallery migrations**: 49, unchanged; `postbuild` synced 49 + 1 compatibility alias.
- **`revert-to-immich.sql`**: section 7 gains an idempotent reversal (`DROP TRIGGER IF EXISTS` /
  `DROP FUNCTION IF EXISTS` / delete both `migration_overrides` rows) and step 8 gains the
  `kysely_migrations` entry. `album_user` exists in the `v3.1.0` tree, so the guarded `DROP TRIGGER
… ON "album_user"` is safe against a tagged-release database. The migration's one-way `DELETE FROM
"album"` is documented as unrecoverable in the script comment.

## Mobile Drift Migration Analysis

No Drift change in this batch. `mobile/` delta is a single file, `mobile/mise.toml`.

## Pattern Propagation

| Refactor                     | Old → New                                             | Fork files affected            | Decision | Commit                                                          |
| ---------------------------- | ----------------------------------------------------- | ------------------------------ | -------- | --------------------------------------------------------------- |
| `eqeqeq: 'error'` (#30718)   | `== null` / `!= undefined` → strict                   | 4 (1 server, 3 web)            | Bundled  | `chore(fork): satisfy eqeqeq in fork-only code`                 |
| CocoaPods into mise (#30722) | explicit `pod install` step → `install:ios` mise task | 1 (`gallery-build-mobile.yml`) | Bundled  | `ci(mobile): set up Ruby before mise installs iOS dependencies` |

## Local CI Verification

| Check                             | Status          | Notes                                                                                 |
| --------------------------------- | --------------- | ------------------------------------------------------------------------------------- |
| `server pnpm build` (+ postbuild) | PASS            | Synced 49 Gallery migrations, 1 compatibility alias                                   |
| `server pnpm check` (tsc)         | PASS            |                                                                                       |
| `server pnpm lint`                | PASS            | `--max-warnings 0`                                                                    |
| `web check:typescript`            | PASS            |                                                                                       |
| `web check:svelte`                | PASS            | 586 files, 0 errors, 0 warnings                                                       |
| web eslint (`tscompat` off)       | PASS            | 9 `eqeqeq` errors found and fixed; 0 after                                            |
| OpenAPI regeneration              | PASS            | `sync-open-api` produced no diff — no DTO or controller changed                       |
| Server unit tests                 | PASS            | 5176 passed, 12 skipped (158 files)                                                   |
| Web unit tests                    | PASS            | 4350 passed, 2 skipped, 8 todo (313 files)                                            |
| ML gate                           | SKIPPED         | `machine-learning/` delta provably empty                                              |
| Mobile gate                       | SKIPPED         | `mobile/` delta is `mise.toml` only — no Dart source, no codegen input                |
| `make sql`                        | SKIPPED         | No `@GenerateSql` repository method changed; CI's `sql-schema-up-to-date` covers it   |
| Medium tests                      | NOT RUN LOCALLY | Docker daemon unavailable; this is the gate for the new album trigger — read it in CI |

## Remote CI Verification

- **Test branch**: `rebase/upstream-b88`
- **Commit validated**: `e80a648b8a8` — every run reports the same `headSha`, so there is no SHA skew
- **Result**: **10 / 10 GREEN, first pass.** Dispatched staggered 4 / 2 / 4; no GHCR rate limits.

| Workflow                                  | Status | Notes                                                                                                |
| ----------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------- |
| `test.yml`                                | GREEN  | **21 / 21 jobs, 0 skipped** — inspected job-by-job, not on the workflow conclusion                   |
| `docker.yml`                              | GREEN  |                                                                                                      |
| `static_analysis.yml`                     | GREEN  |                                                                                                      |
| `gallery-build-mobile.yml`                | GREEN  | **Both legs**: Build and sign Android ✓, Build and sign iOS ✓                                        |
| `gallery-rebase-smoke.yml`                | GREEN  |                                                                                                      |
| `gallery-revert-to-immich-validation.yml` | GREEN  | Read past the coverage grep to `Post-phase drift (0 item(s))` → `revert-to-immich validation PASSED` |
| `storage-migration-tests.yml`             | GREEN  |                                                                                                      |
| `storage-migration-e2e.yml`               | GREEN  |                                                                                                      |
| `gallery-ml-smoke.yml`                    | GREEN  |                                                                                                      |
| `gallery-mobile-smoke.yml`                | GREEN  |                                                                                                      |

Two results are worth calling out because they are the evidence for this cycle's two riskiest items:

- **`Medium Tests (Server)` passed.** This is the only gate that exercises upstream's new
  `album_user_delete` row trigger against the fork's shared-space album triggers on a real database —
  it could not be run locally (no Docker daemon), so it was the named residual exposure of the
  HIGH-risk change. `SQL Schema Checks` and `Test Branding` also passed.
- **The iOS/Android build empirically validated the CocoaPods reorder.** On the Linux Android runner
  `//mobile:install:ios` ran and short-circuited through its `uname != Darwin` guard; on the macOS iOS
  runner `Setup Ruby` executed _before_ `Install Flutter dependencies`, so `pod install` inside the
  mise task had the bundler-pinned Ruby. Without the reorder that step would have run first, with the
  runner's ambient Ruby.
- **`gallery-revert-to-immich-validation` proved the `IF EXISTS` guards are load-bearing**, not
  defensive padding: the log shows
  `NOTICE: trigger "album_user_delete" for relation "album_user" does not exist, skipping` and
  `NOTICE: function album_user_delete() does not exist, skipping` — the script runs against the tagged
  `:main` image where those objects were never created, so an unguarded `DROP` would have aborted it.

### Failures fixed / confirmed flakes

None. No re-runs were needed.

## Post-Rebase Verification

- Fork commits ahead of upstream: 1138
- Commits behind upstream: 0
- Fork diff clean: YES
