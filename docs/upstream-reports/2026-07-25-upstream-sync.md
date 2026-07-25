# Upstream Sync Report — 2026-07-25

## Summary

- **Upstream commits pulled**: 5 (`4a5f13d0e56..409734e1db3`, batch 51 of the rolling v3.0.3 rebase)
- **Fork commits synced from main**: 0 (`integratedForkHead` `652544fd2f6` already matches `origin/main`)
- **Conflicts resolved**: 1
- **Risk level**: LOW
- **Recommendation**: PROCEED

Rolling branch `rebase/upstream-rolling-v3.0.3`, previous tip `8e7148095af` (backup
`backup/rolling-pre-batch51-20260725`), new tip `b64cc4705ef`. 987 fork commits ahead,
0 behind `upstream/main`.

## Incoming Upstream Changes

| SHA           | Summary                                     | Area              | Risk to Fork | Notes                                                                                                                            |
| ------------- | ------------------------------------------- | ----------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `829b4e748e5` | feat: button longpress handler (#30200)     | mobile UI pkg     | LOW          | Additive optional `onLongPress` in `mobile/packages/ui` buttons; fork untouched                                                  |
| `9abe72aced7` | fix(mobile): iOS widget text box (#30176)   | mobile iOS        | LOW          | WidgetExtension Swift; fork's `ImmichAPI.swift` memory-params change is ~180 lines away, auto-merged                             |
| `7b023d9a712` | chore: flutter 3.44.6 → 3.44.8 (#30205)     | mobile toolchain  | LOW          | `mobile/mise.lock` + `pubspec.lock` end byte-identical to upstream; fork's DCM-skip task and `version: 1.0.0+1` stamp preserved  |
| `b08f6b9c507` | chore: medium tests config helpers (#30174) | server test infra | LOW          | Additive `getConfig`/`updateConfig` on `MediumTestContext` — same insertion anchor as fork helpers (conflict, resolved by union) |
| `409734e1db3` | fix: shared by user detail panel (#30187)   | web               | LOW          | One-line render-condition fix (`albumUsers.length > 0` → `> 1`) on upstream's album-sharing UI                                   |

### Product-direction gate

Did **not** fire. #30187 is a display bugfix on upstream's existing album `shared by`
section, not a sharing-model change — no overlap with Shared Spaces. No commit reshapes
an architecture or data model the fork extends.

## Conflict Resolutions

### Conflict: `server/test/medium.factory.ts`

- **Fork side**: fork's squash-base commit appends `newSharedSpace` / `newSharedSpaceMember` /
  `newSharedSpaceAsset` (and further fork helpers) to `MediumTestContext` at the end of the class.
- **Upstream side**: #30174 appends `getConfig` / `updateConfig` helpers at the same anchor
  (after `newEdits`, before the class close).
- **Resolution**: union — upstream's two new methods kept first, fork's helpers follow. Both
  import additions (`SystemConfig`, `src/utils/config`) auto-merged.
- **Risk**: LOW — purely additive on both sides, no overlapping symbols.
- **Verification**: `tsc --noEmit` clean; prettier clean; both `getConfig`/`updateConfig` and all
  fork `newShared*` helpers present in the final file after the full 987-commit replay.

## Fork Feature Verification

Post-rebase audit (`make upstream-postrebase-audit BATCH=51`) — all checks OK:

| Check                          | Status | Notes                                                  |
| ------------------------------ | ------ | ------------------------------------------------------ |
| Fork-owned file survival       | OK     | All literal fork-owned files present                   |
| Fork extension symbol survival | OK     | All manifest symbols present                           |
| Gallery migration count        | OK     | 49 (expected 49)                                       |
| Migration filename survival    | OK     |                                                        |
| Migration timestamp collisions | OK     | None                                                   |
| Generated artifact review      | OK     | No upstream generated-artifact changes                 |
| `fork-patches-check`           | OK     | `@immich/ui` patch metadata consistent                 |
| `ci-invariants-check`          | OK     | No PUSH_O_MATIC, gallery image names, docs-deploy      |
| `mobile-drift-rebase-check`    | OK     | schemaVersion, snapshots, Gallery callbacks consistent |

Diff `backup/rolling-pre-batch51-20260725..HEAD` contains exactly the 5 upstream commits'
11 files — no fork content dropped, nothing else changed.

## Database Migration Analysis

No new server migrations in this batch (`server/src/schema/migrations/` untouched).
`revert-to-immich.sql` requires no update. `MinFacePreferenceMigration` coverage from
batch 48–50 remains the latest entry.

## Mobile Drift Migration Analysis

No mobile Drift migration changes. The Flutter 3.44.6→3.44.8 bump touches only
`mise.toml` / `mise.lock` / `pubspec.{yaml,lock}`; fork's `pubspec.yaml` version stamp
(`1.0.0+1`) and DCM-skip task in `mise.toml` preserved, lockfiles byte-identical to upstream.

## Local CI Verification

| Check                               | Status | Notes          |
| ----------------------------------- | ------ | -------------- |
| `server` `tsc --noEmit`             | PASS   |                |
| prettier (`test/medium.factory.ts`) | PASS   |                |
| `mobile/mise.lock` == upstream      | PASS   | byte-identical |
| `mobile/pubspec.lock` == upstream   | PASS   | byte-identical |

Web and mobile deltas are upstream-only files; validation deferred to the remote CI set.

## Remote CI Verification

- **Branch**: `rebase/upstream-rolling-v3.0.3`
- **Commit validated**: `b64cc4705ef`

All 10 `workflow_dispatch` workflows dispatched (staggered) and **all 10 GREEN on the
first run** — no flakes, no re-dispatches:

| Workflow                                  | Conclusion |
| ----------------------------------------- | ---------- |
| `test.yml` (20-job suite)                 | GREEN      |
| `docker.yml`                              | GREEN      |
| `static_analysis.yml`                     | GREEN      |
| `gallery-rebase-smoke.yml`                | GREEN      |
| `storage-migration-tests.yml`             | GREEN      |
| `gallery-revert-to-immich-validation.yml` | GREEN      |
| `gallery-ml-smoke.yml`                    | GREEN      |
| `gallery-mobile-smoke.yml`                | GREEN      |
| `storage-migration-e2e.yml`               | GREEN      |
| `gallery-build-mobile.yml`                | GREEN      |

## Post-Rebase Verification

- Fork commits ahead of upstream: 987
- Commits behind upstream: 0
- Fork diff clean: YES

## Fork Sync — later the same day (#840, #842)

Two fork PRs landed on `origin/main` after the batch-51 run above, advancing
`integratedForkHead` `652544fd2f6` → `b19653e2829`. Upstream did not move
(`upstream/main` still `409734e1db3`), so this is a fork-only append — no new batch.

| SHA           | Summary                                                                    | Area         | Result                      |
| ------------- | -------------------------------------------------------------------------- | ------------ | --------------------------- |
| `8aaac5b22a8` | fix(shared-space): idempotent space-person creation (#840, carries #841)   | server + gen | 1 conflict (see below)      |
| `b19653e2829` | fix(web): unify the multi-select toolbar across Space surfaces (#839/#842) | web + e2e    | clean (auto-merged 5 files) |

### Applied by hand — `make upstream-sync-fork-main` aborted

The script threw on the first commit and left the cherry-pick in progress rather than
rolling back. The remaining commit was cherry-picked by hand, the gate checks were run
manually, and `integratedForkHead` + `appendHistory` were advanced by hand to match what
the script would have written.

### Conflict: `mobile/openapi/lib/model/job_name.dart`

- **Why it conflicted**: `.gitattributes` sets `merge: unset` (and `diff: unset`) for
  `mobile/openapi/**`, so git cannot text-merge this generated file — **any** concurrent
  change to it conflicts wholesale. Upstream regenerated the Dart client with a newer
  generator during the rolling batches (`class JobName` with `static const` members →
  `enum JobName` with `._(r'…')` members), while #840 was authored against `main`'s older
  `class` form.
- **Fork side (`main`/#840)**: old `class` form + `SharedSpaceIdentityReconciliationSweep`.
- **Branch side**: new `enum` form, without the new job name.
- **Resolution**: took the branch's newer generator output and inserted
  `sharedSpaceIdentityReconciliationSweep` plus its decoder `case` in spec order (directly
  after `SharedSpaceAlbumGrantReconcileSweep`).
- **Risk**: LOW.
- **Verification**: the file's 87 enum members and 87 decoder cases now match
  `open-api/immich-openapi-specs.json`'s `JobName` enum exactly, element-for-element and
  in order. `grep -rn JobName mobile/lib/` returns nothing — the app code never switches
  on this enum, so the added value is inert for the Flutter app.

### Local verification (toolchain-drift check)

A clean fork sync is not CI-safe on this branch — these commits were CI-verified against
`main`'s toolchain, which is 51 batches behind the branch's. #842 lands ~2 800 lines of web
and e2e specs, the exact shape that tripped `unicorn` rules on the #826 and #810 syncs.
All gates re-run here on the branch toolchain:

| Check                                                       | Status                     |
| ----------------------------------------------------------- | -------------------------- |
| `server` `tsc --noEmit`                                     | PASS                       |
| `web` `tsc --noEmit`                                        | PASS                       |
| `web` `check:svelte`                                        | PASS (569 files, 0 errors) |
| `e2e` `tsc --noEmit`                                        | PASS                       |
| eslint — changed web files (`tscompat` rule off, see skill) | PASS                       |
| eslint — changed e2e specs                                  | PASS                       |
| eslint — changed server files                               | PASS                       |
| prettier — all changed files (server / web / e2e / docs)    | PASS                       |
| server unit tests (shared-space, queue, job repository)     | PASS (647)                 |
| web unit tests (toolbar, capabilities, managers)            | PASS (515)                 |
| web unit tests (`routes/(user)/spaces`)                     | PASS (233)                 |
| `fork-ownership-coverage-check`                             | OK                         |
| `ci-invariants-check`                                       | OK                         |
| `fork-patches-check`                                        | OK                         |

No migrations (gallery count still 49), no Drift changes → `revert-to-immich.sql`
unchanged.

`packages/sdk/src/fetch-client.ts` fails `prettier --check`, but it fails identically on
the pre-sync tip `0f2cce28e5b` — pre-existing on this generated file, not introduced here.

## Not done — deliberately

No cutover to `main`: ruleset 13531204 (`non_fast_forward`, zero bypass actors) still
blocks the force-push — unchanged standing decision since 2026-07-22.
