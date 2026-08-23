# Upstream Sync Report — 2026-07-24 (batches 48–50)

## Summary

- **Upstream commits pulled**: 4 (`f488a280187 .. 4a5f13d0e56`)
- **Fork commits synced from `origin/main`**: 1 (#837)
- **Conflicts resolved**: 1 (`server/src/services/media.service.ts`)
- **Risk level**: LOW–MEDIUM
- **Recommendation**: PROCEED — all 10 CI workflows GREEN (1 E2E infra flake, green on re-run)
- **Product-direction gate**: did NOT fire
- **Rolling branch**: `rebase/upstream-rolling-v3.0.3`
- **Backup**: `backup/rolling-pre-batch48-20260724` @ `8832cab8104`
- **Post-rebase tip** (before report commit): `1c9fcebaa34` — 0 behind `upstream/main` (`4a5f13d0e56`), 985 fork commits ahead

The rolling branch was 4 behind / 983 ahead when this batch started (batch 47 having landed
2026-07-23, not yet cut over to `main`). The 4 outstanding upstream commits were pulled in a
single `git rebase 4a5f13d0e56` (the plan re-chunked them as batches 47–50 after the target
bump — numbering shifted, ground truth was 4 commits via `git rev-list --count HEAD..upstream/main`).

## Incoming Upstream Changes

| SHA           | Summary                                                         | Area   | Risk to Fork | Notes                                                         |
| ------------- | --------------------------------------------------------------- | ------ | ------------ | ------------------------------------------------------------- |
| `4a5f13d0e56` | #30194 don't skip person thumbnail generation if ML is disabled | server | MEDIUM       | Conflicted on `media.service.ts` — resolved (see below)       |
| `acc7e6b2990` | #30177 min faces user preference (migration)                    | server | LOW          | Data-only backfill migration; needs revert-to-immich coverage |
| `5fa920a5f01` | #30182 use RTL transform origin in AdaptiveImage                | web    | LOW          | 1-line Svelte change, no fork overlap                         |
| `3af94a48053` | #30173 properly align iOS widget loading state                  | mobile | LOW          | Swift widget only, no fork overlap                            |

### Fork commits synced

| SHA           | Summary                                                            | Notes                                                                                                                               |
| ------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `652544fd2f6` | #837 ci(rc): auto-build RC images on labelled PRs + sticky comment | CI workflows + docs/plans only. Advanced `integratedForkHead` → `652544fd2f6` via `make upstream-sync-fork-main` (clean, 1 commit). |

## Product-Direction Gate

**Did not fire.** The only face/people-surface commit is #30177 (min-faces), an **additive
per-user preference**. The `preferences.people.minimumFaces` plumbing landed in an earlier batch
(`server/src/services/person.service.ts` resolves `preferences.people.minimumFaces ??
machineLearning.facialRecognition.minFaces`, with a fork-aware comment); this commit is only the
migration that backfills existing users from the old system-config `minFaces`. It touches no
fork-extended table and does not reshape the person/face data model, sync contract, or access
model — no collision with the fork's face-identity / statistics / review features.

## Conflict Resolutions

### Conflict: `server/src/services/media.service.ts`

- **Fork side**: the fork had extended the `handleGeneratePersonThumbnail` early-skip guard with
  `!isPetDetectionEnabled(machineLearning)` (so pet "person" thumbnails still generate when only
  pet detection is enabled), and added `isPetDetectionEnabled` to the `src/utils/misc` import.
- **Upstream side (#30194)**: removed the early-skip guard entirely (person thumbnails now
  generate **unconditionally**) and dropped `isFaceImportEnabled` / `isFacialRecognitionEnabled`
  from the import.
- **Resolution**: took **upstream fully** for both hunks. Upstream's unconditional generation is a
  superset that preserves the fork's pet intent (pets still get thumbnails — always). Verified the
  three helper functions were used **only** inside the deleted guard (no other usage in the file),
  so the import correctly collapses to `import { clamp } from 'src/utils/misc';` with no dangling
  references. Both `machineLearning` and `metadata` were destructured only for the guard and are
  no longer needed.
- **Risk**: LOW.
- **Verification**: `tsc --noEmit` clean (server + web); `media.service.spec.ts` all 227 tests pass,
  including upstream's new "should generate a thumbnail even if machine learning is disabled" test
  and the fork's "should not skip when only pet detection is enabled" test (which still passes —
  it asserts the method proceeds to the data fetch rather than early-skipping).

## Fork Feature Verification

Validated by `make upstream-postrebase-audit BATCH=50` (all OK):

| Check                                          | Status | Notes                                                                               |
| ---------------------------------------------- | ------ | ----------------------------------------------------------------------------------- |
| Fork-Owned File Survival                       | OK     | All literal fork-owned files present                                                |
| Fork Extension Symbol Survival                 | OK     | All manifest expected symbols present                                               |
| Gallery Migration Count                        | OK     | 49 (expected 49)                                                                    |
| Gallery Migration Filename / Manifest Coverage | OK     | All manifest migrations present, globs match                                        |
| Migration Timestamp Collision Check            | OK     | No upstream migration timestamp collides with Gallery migrations                    |
| Generated Artifact Review                      | OK     | No upstream generated-artifact changes require review (no OpenAPI/SQL regen needed) |

## CI and Infrastructure Verification

| Check                                                | Status | Notes                                               |
| ---------------------------------------------------- | ------ | --------------------------------------------------- |
| `@immich/ui` patch consistent (`fork-patches-check`) | OK     | Patch metadata consistent                           |
| No PUSH_O_MATIC dependency (`ci-invariants-check`)   | OK     |                                                     |
| Gallery release workflows publish Gallery images     | OK     |                                                     |
| Upstream docs-deploy stays `workflow_dispatch`-only  | OK     |                                                     |
| Fork-ownership coverage (`fork-sync`)                | OK     | Recorded `ok:true` during `upstream-sync-fork-main` |

## Database Migration Analysis

### New Upstream Migrations

| Timestamp     | Migration Name                      | Tables Modified             | Risk to Fork | Notes                                                                                                                                                                  |
| ------------- | ----------------------------------- | --------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1784836013770 | MinFacePreferenceMigration (#30177) | `user_metadata` (data only) | LOW          | Pure INSERT/UPDATE backfill of `preferences.people.minimumFaces` from system-config `minFaces`. No schema change; `down()` is a no-op. Touches no fork-extended table. |

- **Timestamp ordering**: `1784836013770` > latest Gallery migration `1784800000000` → interleaves
  cleanly after it. No collision (confirmed by audit + timestamp check).
- **Mobile Drift**: no upstream commit touched `db.repository.dart` or `drift_schemas/` —
  `mobile-drift-rebase-check BATCH=50` OK (schemaVersion/snapshots/callbacks consistent).

### `revert-to-immich.sql` maintenance (step 7i)

`MinFacePreferenceMigration` is a new **post-tag** upstream migration (tagged upstream =
v3.0.3 per `branding/config.json`), so it required coverage in `scripts/revert-to-immich.sql`:

- **Section 8** (`DELETE FROM "kysely_migrations"`): added `'1784836013770-MinFacePreferenceMigration'`
  to the post-tag upstream group (timestamp-sorted, after `AddOAuthBearerTokenToSession`).
- **Section 7** (schema reversal): a data-only comment only — no schema to reverse (`down()` is a
  no-op, and the extra JSONB key is inert for the tagged release's schema-check and boot).
- Coverage detector (the same grep the CI gate runs) reports no `MISSING` entries.
- Committed as `1c9fcebaa34`.

## Inconsistencies Found

None.

## Pattern Propagation

No broad upstream refactors in this batch. (Search V3 coexistence invariant unaffected — no commit
touched `searchAssetBuilder*`.)

## Version References

No change. Upstream has not tagged a release beyond v3.0.3; the 4 commits are `upstream/main`
commits ahead of the tag. `branding/config.json` (`upstream.version` = 3.0.3) and README stay as-is.

## Remote CI Verification

- **Branch**: `rebase/upstream-rolling-v3.0.3`
- **Commit validated**: `e55905c64f0`
- **Result**: all 10 dispatched workflows GREEN.

| Workflow                                  | Status | Notes                                                             |
| ----------------------------------------- | ------ | ----------------------------------------------------------------- |
| `test.yml`                                | GREEN  | 20/20 jobs (after 1 E2E-stack re-run — infra flake, see below)    |
| `docker.yml`                              | GREEN  | server/web/cli/ml images build (validates media.service change)   |
| `static_analysis.yml`                     | GREEN  | dart analyze + format + generated-file freshness                  |
| `gallery-build-mobile.yml`                | GREEN  | iOS + Android compile (validates #30173 widget)                   |
| `gallery-rebase-smoke.yml`                | GREEN  |                                                                   |
| `storage-migration-tests.yml`             | GREEN  |                                                                   |
| `storage-migration-e2e.yml`               | GREEN  |                                                                   |
| `gallery-revert-to-immich-validation.yml` | GREEN  | validates the new revert-to-immich coverage for MinFacePreference |
| `gallery-ml-smoke.yml`                    | GREEN  | ML image boots                                                    |
| `gallery-mobile-smoke.yml`                | GREEN  | Android codegen/analyze                                           |

- **Confirmed flake**: `test.yml`'s "End-to-End Tests (Server & CLI) (ubuntu-latest)" failed on the
  first run at the **Start Docker Compose** step — buildkit `target immich-server: failed to receive
status: rpc error: code = Unavailable ... connection reset by peer`, preceded by npm-registry
  requests taking 10–12s each. Environmental (slow registry + buildkit RPC reset), not code:
  `docker.yml` and `storage-migration-e2e.yml` built the same images successfully in the same run
  set. Re-run of the failed jobs (`gh run rerun --failed`) went 20/20 green.

## Post-Rebase Verification

- Fork commits ahead of upstream: 985
- Commits behind upstream: 0
- Fork diff clean: YES
- `lastCompletedBatch`: 50; `integratedForkHead`: `652544fd2f6`
- Cutover to `main`: NOT performed (ruleset `13531204` `non_fast_forward`, zero bypass actors —
  Pierre's call, same standing block as batch 47).
