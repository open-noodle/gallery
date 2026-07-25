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

## Not done — deliberately

No cutover to `main`: ruleset 13531204 (`non_fast_forward`, zero bypass actors) still
blocks the force-push — unchanged standing decision since 2026-07-22.
