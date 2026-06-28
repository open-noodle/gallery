# Upstream Sync Report — 2026-06-28 (batches 297–298)

## Summary

- **Upstream commits pulled**: 2 (`6e1143e799..ac74bca18b`)
- **Fork commits synced**: 0 (`origin/main` already integrated — `integratedForkHead == 7dbd29113`)
- **Conflicts resolved**: 1 (`mobile/pubspec.yaml`)
- **Risk level**: LOW
- **Recommendation**: PROCEED (pending CI on the test branch)

Upstream tagged **v3.0.0-rc.4**. The fork stays on its tagged base
`branding/config.json.upstream.version = 2.7.5` (unchanged; server/web/sdk/root
`package.json` carry `3.0.0-rc.4`, mobile keeps `1.0.0+1`). Collapsed the planner's
2 batches into a single `git rebase ac74bca18b`.

This is the lowest-risk batch shape: one upstream-owned mobile fix + a version bump.
No server source, no migration, no i18n, no dependency, no CI/workflow changes.

## Incoming Upstream Changes

| Batch | SHA          | PR     | Summary                               | Area    | Risk to Fork | Notes                                                                                                               |
| ----- | ------------ | ------ | ------------------------------------- | ------- | ------------ | ------------------------------------------------------------------------------------------------------------------- |
| 297   | `e9d1951858` | #29353 | fix: dispatch menu onPressed manually | mobile  | LOW          | `base_action_button.widget.dart` — upstream-owned (0 fork commits touch it), clean replay                           |
| 298   | `ac74bca18b` | —      | chore: version v3.0.0-rc.4            | version | LOW          | Version bumps across package.json + openapi spec + fetch-client + pubspec + fastlane + ml; mobile kept at `1.0.0+1` |

## Conflict Resolutions (1)

### `mobile/pubspec.yaml` (fork #121)

- **Fork side**: `1.0.0+1` (fork owns mobile versioning).
- **Upstream side**: `3.0.0-rc.4+3052`.
- **Resolution**: kept fork `1.0.0+1` (established rule).
- **Risk**: LOW.

## Fork-Policy Replays (verified re-applied)

The fork-only commits from the previous cycle replayed cleanly (rc.4 touches none of
these files), and the drops were verified present in the final tree:

- `packages/scripts/` absent; `mise.toml` has no `[tasks.release]`; `directories.md` has
  no packages/scripts row; `test.yml` has no `script-unit-tests` job/filter and retains
  the fork `upstream-preflight` job.

## Database Migration Analysis

- No new upstream migrations. Gallery migration count: 33 / 33. No `revert-to-immich.sql`
  work needed (no migration added).

## i18n / Dependencies

- No i18n changes. No dependency changes — `pnpm-lock.yaml` is **byte-identical to the
  last CI-green tip** (`55fed7c0ae`); version bumps don't affect the lockfile graph.

## Local Verification

| Check                                          | Status        | Notes                                                                                                                                                                                                                               |
| ---------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mise //:open-api` (build + spec + SDK + Dart) | PASS          | regen **no-op** (server/src byte-identical to last-green); server rebuilt                                                                                                                                                           |
| `server pnpm check` (tsc)                      | PASS          | —                                                                                                                                                                                                                                   |
| `web` type checks                              | REDUNDANT     | web source byte-identical to last-green (CI re-validates)                                                                                                                                                                           |
| `ci-invariants-check`                          | PASS          | —                                                                                                                                                                                                                                   |
| `fork-patches-check`                           | PASS          | `@immich/ui` patch consistent                                                                                                                                                                                                       |
| `mobile-drift-rebase-check` (298)              | PASS          | schemaVersion/snapshots/callbacks consistent                                                                                                                                                                                        |
| `upstream-postrebase-audit` (298)              | PASS\*        | fork files/symbols survive, migrations 33/33, no collisions. \*Generated Artifact Review flagged the openapi spec + dart README — confirmed **benign version-string-only** diffs (`3.0.0-rc.3` → `3.0.0-rc.4`), no API shape change |
| `mise //:sql`                                  | SKIPPED       | no `@GenerateSql` repo changed                                                                                                                                                                                                      |
| Server/web lint + unit tests                   | DEFERRED → CI | server/web source byte-identical to last-green                                                                                                                                                                                      |
| Mobile (`dart analyze`, build)                 | DEFERRED → CI | impossible locally (worktree flutter pin)                                                                                                                                                                                           |

## CI and Infrastructure Verification

| Check                      | Status                                 |
| -------------------------- | -------------------------------------- |
| Workflow files             | OK (no upstream changes to `.github/`) |
| Branding (2.7.5)           | OK (unchanged)                         |
| Conflict markers tree-wide | 0                                      |

## Post-Rebase Verification

- Fork commits ahead of upstream: 826
- Commits behind upstream: 0
- Rolling status: 298/298 upstream batches complete; 0 fork pending
