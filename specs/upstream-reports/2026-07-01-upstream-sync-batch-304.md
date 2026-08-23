# Upstream Sync Report — 2026-07-01 (batch 304)

## Summary

- **Upstream commits pulled**: 2 (`05d838b560..4b54fef82e`)
- **Fork commits synced**: 1 (`#735` — `ca13ebb95..dc3bd92a3e`)
- **Conflicts resolved**: 2 (1 fork-sync import conflict, 1 upstream rebase conflict — the
  latter **removes a fork divergence**).
- **Risk level**: LOW.
- **Recommendation**: PROCEED (pending CI on the test branch).

Small batch on top of GA `v3.0.0`. `server/src` + `web/src` are **byte-identical** to the
batch-303 tip — the only code changes are mobile (`#735`) and the e2e spec (`#29412`). Fork
stays on tagged base `2.7.5`.

## Incoming Upstream Changes

| SHA          | PR     | Summary                         | Area | Risk to Fork | Notes                                                                                          |
| ------------ | ------ | ------------------------------- | ---- | ------------ | ---------------------------------------------------------------------------------------------- |
| `4b54fef82e` | #29410 | chore(web): update translations | i18n | LOW          | Only `sq.json` (+30). Fork doesn't modify it → clean; no disclosure keys.                      |
| `0050332391` | #29412 | fix: e2e version test           | e2e  | LOW          | **Supersedes the batch-303 fork adaptation of this exact test** — resolved by taking upstream. |

## Fork Commit Sync (#735)

`fix(mobile): show faces on Space-shared assets (#727)` — fixes open issue **#727** (iOS
empty faces on Space-shared assets). Touches the fork's mobile people/faces surface
(`people.service.dart`, `people_details.widget.dart`, `people.provider.dart`,
`person_api.repository.dart` + a new `people_service_test.dart`) and `AGENTS.md`.

`make upstream-sync-fork-main` threw on a cherry-pick conflict it couldn't auto-apply (its
all-or-nothing rollback), so per the skill this was **hand-applied**: resolved the one
conflict, `git cherry-pick --continue`, then **manually advanced `integratedForkHead` →
`dc3bd92a3e`** in `rolling-state.json` (with an `appendHistory` entry) and refreshed the
ownership baseline (`docs/fork/ownership.yml` `last_verified_fork_head`, commit
`0e0395ec95`).

### Conflict: `mobile/lib/providers/infrastructure/people.provider.dart` (fork-sync)

- **Fork side (HEAD)**: `import '…/providers/infrastructure/user_metadata.provider.dart'`.
- **#735 side**: `import '…/providers/user.provider.dart'`.
- **Resolution**: keep **both** imports (dart-sorted). Verified both are used —
  `userMetadataPreferencesProvider` (1×) and `#735`'s `currentUserProvider` (3×) — so no
  unused-import analyzer error.
- **Risk**: LOW.

## Conflict Resolutions (upstream rebase)

### `e2e/src/specs/server/api/server.e2e-spec.ts` (upstream #29412) — removes a fork divergence

- **Fork side (theirs = batch-303 commit `5d3c903856`)**: field-wise assertions accepting a
  null-or-numeric `prerelease` (the fork adaptation for GA builds).
- **Upstream side (HEAD = #29412)**: `expect.objectContaining({major, minor, patch})` +
  `expect(Object.keys(body)).toEqual(expect.arrayContaining([…,'prerelease']))` — asserts the
  `prerelease` key merely exists, accepting the GA-null case the same way.
- **Resolution**: took **upstream** (`--ours`). Upstream's fix supersedes the fork's, so the
  batch-303 adaptation commit rebased to **empty and was dropped** — the standing fork
  divergence on this file (flagged in the batch-303 report/memory) is now gone. The fork's
  _other_ e2e modifications in this file (OpenFreeMap tiles, `minFaces: 3`,
  `peopleStatistics: false`, etc. from Infrastructure Detachment) are preserved (they live in
  earlier fork commits, already on HEAD).
- **Risk**: LOW.

## Fork Feature Verification

| Feature                                | Status | Notes                                                              |
| -------------------------------------- | ------ | ------------------------------------------------------------------ |
| Mobile Spaces — faces on shared assets | OK     | `#735` synced; both `people.provider` imports used.                |
| Infrastructure Detachment (e2e)        | OK     | Fork's `/server/about` `/config` `/features` e2e values preserved. |
| Branding / version pins                | OK     | `example.env` `v4`, pubspec `1.0.0+1`, branding `2.7.5` intact.    |

## CI and Infrastructure Verification

| Check                          | Status | Notes                                                                              |
| ------------------------------ | ------ | ---------------------------------------------------------------------------------- |
| `ci-invariants-check`          | OK     | no PUSH_O_MATIC; Gallery images; docs-deploy dispatch-only.                        |
| `fork-patches-check`           | OK     | `@immich/ui` patch consistent.                                                     |
| `mobile-drift-rebase-check`    | OK     | schemaVersion / snapshots / callbacks consistent (`#735` adds no Drift migration). |
| `postrebase-audit` (BATCH=307) | OK     | fork files/symbols survive; 33 migrations; generated-artifact review clean.        |

## Database Migration Analysis

- **New upstream migrations**: NONE. Gallery migration count 33 (unchanged). No collisions.
  `revert-to-immich.sql` coverage intact (step-7i detector prints nothing). `#735` adds no
  Drift migration.

## Inconsistencies Found

None. `server/src` + `web/src` byte-identical to the batch-303 tip.

## Local CI Verification

| Check                                   | Status | Notes                                                                                                                  |
| --------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------- |
| `server`/`web` build + tsc              | N/A    | `server/src` + `web/src` byte-identical to batch-303 (0 changed files) → redundant.                                    |
| OpenAPI / SQL regeneration              | N/A    | no server change → no spec/SQL drift possible.                                                                         |
| Mobile (analyze / build / flutter test) | CI     | `#735` mobile — not runnable locally (flutter-pin); validated on CI static_analysis / build-mobile / Unit-Test-Mobile. |
| e2e `/server/version`                   | CI     | took upstream #29412; validated on the E2E job.                                                                        |

## Remote CI Verification

- **Test branch**: `rebase/upstream-batch-304`
- _CI dispatched after Checkpoint 3 approval; results recorded before force-push. `#735` is
  mobile → static_analysis / gallery-build-mobile / Unit-Test-Mobile are the load-bearing gates._

## Post-Rebase Verification

- Fork commits ahead of upstream: (batch replay) + this report
- Commits behind upstream: 0
- Both upstream commits (`4b54fef82e`, `0050332391`) are ancestors of HEAD.
- Fork diff looks clean: YES (and one fork divergence removed).
