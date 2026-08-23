# Upstream Sync Report — 2026-07-23 (batch 47 + fork sync)

## Summary

- **Upstream commits pulled**: 8 (`f24a1283195..f488a280187`) — batch 47
- **Fork commits synced from `origin/main`**: 3 (#818, #810, #809)
- **Conflicts resolved**: 2 (both mobile, both in batch 47)
- **Risk level**: LOW–MEDIUM
- **Recommendation**: PROCEED
- **Branch**: `rebase/upstream-rolling-v3.0.3` → tip `635d158242e`
- **Cutover**: NOT attempted — ruleset `13531204` (`non_fast_forward`, zero bypass actors) still blocks the force-push to `main`. Branch stays ready-and-unpushed by maintainer decision.

### Scope note — batches 36–46

Batches 36–46 (up to upstream `f24a128319`) landed earlier on 2026-07-23 in a prior session and are **not** written up here. Their post-rebase audits are recorded in
`upstream-preflight/batches/batch-{38..46}-postrebase-audit.{md,json}`. This report covers batch 47 and the fork sync only.

## Incoming Upstream Changes (batch 47)

| SHA           | Summary                                                                      | Area   | Risk to Fork | Notes                                                                                                           |
| ------------- | ---------------------------------------------------------------------------- | ------ | ------------ | --------------------------------------------------------------------------------------------------------------- |
| `20ae07e228a` | run background tasks in root isolate (#30101)                                | mobile | **MED-HIGH** | Touches `background_worker.service.dart`, fork-modified by #657/#639/#627. Conflicted — resolved.               |
| `792d88961a8` | custom date range for map (#26205)                                           | mobile | **MED**      | Map feature; fork owns mobile map markers / shared-space map (#364). Conflicted in `map.state.dart` — resolved. |
| `a0a0aa3f3c1` | allow URL validation to pass when scheme is not provided (#30142)            | mobile | MED          | Touches `url_helper.dart` + `login_form.dart` (fork-modified by #572 demo-login). Applied cleanly.              |
| `f488a280187` | force swift-structured-queries lock to 0.34.0 (#30166)                       | mobile | LOW          | iOS SPM `Package.resolved` pin.                                                                                 |
| `3bd580e37d6` | restore correct back route when opening person asset via direct URL (#30129) | web    | LOW          | Person asset route + Next/Prev actions.                                                                         |
| `29605f710e6` | mirror onboarding navigation icons in RTL (#30158)                           | web    | LOW          | Icon mirroring only.                                                                                            |
| `cbb565b7b7a` | mirror asset viewer navigation icons in RTL (#30151)                         | web    | LOW          | Icon mirroring only.                                                                                            |
| `ceef4037f13` | hypertext link to example docker-compose.rootless.yml (#30155)               | docs   | TRIVIAL      | Doc link.                                                                                                       |

**No new upstream migrations in this batch** — `git diff --name-only f24a1283195..f488a280187 -- server/src/schema/migrations/` is empty, so `scripts/revert-to-immich.sql` needs no new entries (step 7i).

## Product-Direction Gate

**Did NOT fire.** None of the 8 commits introduces or reworks a feature overlapping a fork product surface, reshapes an architecture/data model the fork extends, or sets a divergent product direction:

- The one feature (#26205, map custom date range) is **additive UX** on upstream's own map settings sheet. The fork's map work (#364, shared-space markers) lives in separate provider/service files (`providers/map/map_marker.provider.dart`, `services/map.service.dart`) and is not displaced by it.
- #30101 is a **bugfix** to isolate lifecycle, not a new background-work model.
- The remainder are icon-mirroring, routing, docs, and a lockfile pin.

Recorded here per the per-batch gate requirement so the "clean rebase ≠ cleared gate" decision is auditable.

## Conflict Resolutions

### Conflict 1: `mobile/lib/presentation/widgets/map/map.state.dart`

- **Fork side** (`d671d78e4dd`, "refresh snapshot views after remote updates"): adds `import .../providers/sync_status.provider.dart`, consumed at the `ref.watch(syncStatusProvider.select(...))` call that drives snapshot refresh.
- **Upstream side** (#26205): adds `import .../utils/option.dart` for the new `Option<DateTime>` date-range parsing.
- **Resolution**: kept **both** imports, alphabetically ordered. Pure import-block collision — neither side's body was in conflict.
- **Risk**: LOW.
- **Verification**: confirmed 0 conflict markers remain; fork's `syncStatusProvider` watch still present (line 150); upstream's `Option` genuinely used (lines 121–128), so neither import is unused — relevant because `dart analyze --fatal-infos` fails on `unused_import`.

### Conflict 2: `mobile/lib/domain/services/background_worker.service.dart`

Two hunks, from fork commit `6b15669c78a` ("reliable & honest background backup (#639)") meeting upstream #30101.

- **Hunk 1 (imports)** — fork adds `background_backup_event_recorder.dart` + `background_backup_loop.dart`; upstream adds `hash.service.dart` + `local_sync.service.dart`. **Resolution**: kept all four, alphabetically ordered. Risk LOW.
- **Hunk 2 (`_syncAssets`)** — the substantive one:
  - **Fork side**: `final isSuccess = await _ref?.read(backgroundSyncProvider).syncRemote() ?? false;` followed by fork's failure recording `if (!isSuccess) { await _backupEventRecorder?.recordRemoteSyncResult(false); }`.
  - **Upstream side**: refactored the call itself to `final isSuccess = await _remoteSyncService.sync();` — part of #30101 moving background work into the root isolate and off the `ProviderContainer`/`ref` indirection.
  - **Resolution**: took **upstream's call** and **layered the fork's failure recording on top**:
    ```dart
    final isSuccess = await _remoteSyncService.sync();
    if (!isSuccess) {
      await _backupEventRecorder?.recordRemoteSyncResult(false);
    }
    ```
    Upstream owns _how_ remote sync is invoked; the fork owns the honest-backup event recording. Taking either side wholesale would have lost one of the two.
  - **Risk**: MEDIUM — this is the fork/upstream seam in the iOS background-backup path.
  - **Verification**: both symbols confirmed to exist as real members after the rebase — `_remoteSyncService` is upstream's field (declared line 74, constructed line 92, and used identically by upstream itself at line 186), and `_backupEventRecorder` is the fork's getter (line 116) whose other fork call-sites (lines 157, 170, 291) all survived. Server/mobile analysis gates re-run in CI.

## Fork Sync (`make upstream-sync-fork-main`)

Cherry-picked 3 commits, `2ca40ee6fde..6232a027eae`; `integratedForkHead` advanced to `6232a027eae`.

| Commit (on branch) | Origin                                                                          | Area       |
| ------------------ | ------------------------------------------------------------------------------- | ---------- |
| `bf54a8b6d9a`      | #818 — show People, Tags & album membership to viewers in the info panel (#796) | web        |
| `107445fd5fb`      | #810 — align filter panel sections across every view (#802)                     | web        |
| `635d158242e`      | #809 — resolve shared-space birthdays on the asset faces endpoint (#808)        | **server** |

Clean cherry-picks; all three fork gate checks reported `ok: true`. Per the standing rule that **a clean fork sync is not CI-safe** (the rolling branch's toolchain is ahead of `main`'s), `test.yml` and `docker.yml` were re-dispatched regardless — and #809 touching `server/` makes that mandatory rather than precautionary.

## Verification

### Rebase audits — batch 47

All seven checks OK (`upstream-preflight/batches/batch-47-postrebase-audit.md`):
Fork-Owned File Survival · Fork Extension Symbol Survival · Gallery Migration Count (49, expected 49) · Gallery Migration Filename Survival · Gallery Migration Manifest Coverage · Migration Timestamp Collision Check · Generated Artifact Review.

`make fork-patches-check` → OK (`@immich/ui` patch metadata consistent).
`make mobile-drift-rebase-check BATCH=47` → OK (schemaVersion, snapshots and Gallery callbacks consistent).

### Repo integrity

- Working tree clean; branch 0 behind `upstream/main` (`f488a280187`).
- `mise.lock` and `mobile/mise.lock` byte-identical to pre-batch (`shasum` compared before/after) — the local-`mise`-rewrites-the-lockfile trap did not fire.
- Search V3 coexistence invariant **intact**: the only non-Legacy `searchAssetBuilder(` call-sites are upstream's dormant `searchMetadataV3` / `searchStatisticsV3`; every fork path — `search.repository.ts`, the RBAC-gated `shared-space.repository.ts`, and the specs — is on `searchAssetBuilderLegacy`.

### Local gate

- `cd server && pnpm check` (`tsc --noEmit`) → **PASS**, clean.
- Web lint was not run locally: `@koddsson/eslint-plugin-tscompat` aborts the whole run with a `TypeError` before reaching real violations, so CI's Lint Web is the only authority.

### Remote CI

Dispatched against `rebase/upstream-rolling-v3.0.3`, staggered in two waves to avoid the container-registry rate limit that has previously killed the storage-migration suites.

**Round 1 — 9 green, 1 red.**

| Workflow                                  | Run         | Status                      |
| ----------------------------------------- | ----------- | --------------------------- |
| `test.yml`                                | 30045372567 | **FAIL** — Lint Web (fixed) |
| `docker.yml`                              | 30045374856 | GREEN                       |
| `static_analysis.yml`                     | 30045376418 | GREEN                       |
| `gallery-build-mobile.yml`                | 30045377975 | GREEN                       |
| `gallery-rebase-smoke.yml`                | 30045411129 | GREEN                       |
| `storage-migration-tests.yml`             | 30045412718 | GREEN                       |
| `gallery-revert-to-immich-validation.yml` | 30045414022 | GREEN                       |
| `gallery-ml-smoke.yml`                    | 30045415436 | GREEN                       |
| `gallery-mobile-smoke.yml`                | 30045416981 | GREEN                       |
| `storage-migration-e2e.yml`               | 30045418901 | GREEN                       |

`static_analysis.yml` and `gallery-build-mobile.yml` are the load-bearing gates for this batch — both conflicts were mobile Dart, and neither `dart analyze --fatal-infos` nor the iOS/Android compile is reproducible from the local gate. Both passed, which is the strongest available evidence that the `background_worker.service.dart` resolution is correct: a wrong symbol or signature there fails the native build, not merely analysis.

### The one real failure — a fork commit meeting a newer toolchain (again)

`test.yml` → **Lint Web** failed with 3 errors, all `unicorn/prefer-string-repeat`:

- `web/src/lib/utils/__tests__/album-filter-options.spec.ts:159`
- `web/src/lib/utils/__tests__/map-filter-options.spec.ts:298` and `:377`

All three are in specs introduced by fork commit **#810**, which was CI-green on `origin/main` under that branch's older `eslint-plugin-unicorn` and first met **v72** here. This is the same class as #826 on 2026-07-22 and is exactly why a clean fork sync still warrants a full CI re-dispatch. Nothing about the upstream batch caused it.

The 8 accompanying warnings (unused `eslint-disable` directives in `transform-manager.svelte.ts` / `keyboard-manager.svelte.ts`, one unused var in the search route) are **pre-existing and non-fatal** — the branch was previously all-green carrying them; only the 3 errors failed the job.

**Fix**: rewrote the three whitespace-only fixtures `'   '` → `' '.repeat(3)`. Semantically identical, and the affected specs still pass (44/44 via `npx vitest --run`).

Two local-tooling notes worth recording, both of which shaped how this was fixed:

- `eslint --fix` could **not** be used: `@koddsson/eslint-plugin-tscompat@0.2.0` crashes with `TypeError: Cannot read properties of undefined (reading 'Class')` on `map-filter-options.spec.ts`, aborting the run before any fix is written. The three sites were therefore hand-edited.
- To verify the fix locally, lint the files with the crashing rule disabled: `npx eslint --rule '{"tscompat/tscompat":"off"}' <files>` → exit 0.

### Round 2 — all green

`test.yml` re-dispatched on `56a5d172c23` → run **30047048512**, conclusion **success**, 20/20 jobs green (0 non-green).

Only `test.yml` was re-run. The fix touches two `.spec.ts` files and this report — none of which enter the shipped bundle — so the other nine workflows remain valid as green on `635d158242e`, per the "re-run only what your fix can affect" rule.

**Final: all 10 workflows green.**

## Post-Rebase Verification

- Fork commits ahead of upstream: 977
- Commits behind upstream: 0
- Backup branch: `backup/rolling-pre-batch47-20260723` (at `59049764ad5`)
- Cutover to `main`: still blocked by ruleset `13531204`; not attempted.
