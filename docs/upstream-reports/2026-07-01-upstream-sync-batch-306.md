# Upstream Sync Report — 2026-07-01 (batch 306)

## Summary

- **Upstream commits pulled**: 0 (`upstream/main` still `4b54fef82e` — **fork-only** batch).
- **Fork commits synced**: 1 (`#738` — `b147bd8af5..31e7c05bcc`).
- **Conflicts resolved**: 1 file (`person_api.repository.dart`, 3 hunks) + a proactive
  **v3 openapi-drift adaptation** in one test file. All mobile-only, **verified locally with
  mise flutter 3.44.1** (113 tests across the 6 affected test files green).
- **Risk level**: LOW.
- **Recommendation**: PROCEED (pending CI on the test branch).

`server` + `web` + `cli` + `machine-learning` + `e2e` + `open-api` are **byte-identical** to the
batch-305 tip (`a0404d854b`) — the only changes are mobile (`#738`). Fork stays on tagged base
`2.7.5`.

## Fork Commit Sync (#738)

`fix(mobile): load a shared-space person's photos on the person-detail page (both entry points)`
— third in the shared-space-person series (**#735 → #737 → #738**), the person-**detail** sibling
of #727/#737. The mobile person-detail timeline was owner-scoped local Drift (empty "0 items" for
a person the viewer doesn't own). #738 routes the detail timeline on `DriftPerson.spaceId`: a
Space person fetches its photo ids from the membership-gated
`GET /shared-spaces/{id}/people/{id}/assets` and renders them from locally-synced Space assets
(`DriftTimelineRepository.sharedSpacePerson`, no ownerId filter / no `asset_face` join). Fixes
**both** entry points — the People-page tap (#737) and tapping a face in a photo (the asset-info
mapper now carries the space-person id + space id). 14 mobile files (8 lib + 6 test, ~626 lines);
no server/RBAC change (endpoints already membership-gated, web already exposes these photos).

`make upstream-sync-fork-main` threw on the one cherry-pick conflict (all-or-nothing), so per the
skill this was **hand-applied**: resolved the conflict, `git cherry-pick --continue`, then
**manually advanced `integratedForkHead` → `31e7c05bcc`** in `rolling-state.json` (with an
`appendHistory` entry incl. `checks`/`lastCompletedBatch`) and refreshed the ownership baseline
(`docs/fork/ownership.yml`, commit `c47d42bf6c`).

## Conflict Resolution (fork-sync)

### `mobile/lib/repositories/person_api.repository.dart` (3 hunks)

The file's `getAssetPeople`/`_toDriftPerson` was **v3-adapted on the rolling branch in batch 304**
(renamed `PersonWithFacesResponseDto` → `PersonResponseDto`, `Optional.orElse(null)` unwraps),
while #738 edited the **v2.7.5** version on `origin/main` (adds `resolvedSpaceId`/`spacePersonId`
space-person mapping). Resolution = **keep rolling's v3 base + graft #738's space-person intent**,
with v3 unwrapping:

- `getAssetPeople`: keep `info.people.orElse(null) ?? const []`, pass
  `info.resolvedSpaceId.orElse(null)` as the new `_toDriftPerson` arg.
- `_toDriftPerson(PersonResponseDto dto, String ownerId, String? resolvedSpaceId)` — rolling's
  `PersonResponseDto` + #738's `resolvedSpaceId` param.
- Body: keep rolling's `dto.updatedAt.orElse(null)` / `isFavorite.orElse(null)` / `color.orElse(null)`;
  add #738's `final spacePersonId = dto.spacePersonId.orElse(null);` (Optional on v3) +
  `id: isSpacePerson ? spacePersonId : dto.id` / `spaceId: isSpacePerson ? resolvedSpaceId : null`.

The `return DriftPerson(...)` block auto-merged correctly (rolling's `.orElse` unwraps + #738's
id/spaceId logic on disjoint lines). **Risk**: LOW (verified: 113 tests green locally).

## v3 OpenAPI-Drift Adaptation (proactive)

`person_api_repository_test.dart` auto-merged (batch-305 Optional helpers + #738's new
`getAssetPeople` space-person tests), but #738's additions were v2.7.5-style:

- `personWithFaces` helper built `api.PersonWithFacesResponseDto` (gone on v3 — merged into
  `PersonResponseDto`; `getAssetInfo().people` are `PersonResponseDto`) with a plain
  `spacePersonId` → rewrote to build `PersonResponseDto` with
  `spacePersonId: Optional.present(...)`.
- `stubAssetInfo` mocked `info.people` / `info.resolvedSpaceId` as plain values → both are
  `Optional<...?>` on v3, so `thenReturn(Optional.present(...))` / `Optional.absent()`.
  (`info.ownerId` is plain `String` on v3 — no change; confirmed by scoped analyze.)

All other #738 files needed no v3 change: `getSpacePersonAssets` returns `Future<List<String>?>`
(plain nullable, `checkNull` handles it), the new timeline/provider code and the other new/modified
test files use only Drift queries + `DriftPerson` (local model) + mocks.

## Fork Feature Verification

| Feature                                       | Status | Notes                                                             |
| --------------------------------------------- | ------ | ----------------------------------------------------------------- |
| Mobile Spaces — person-detail photos          | OK     | `#738` synced; detail timeline routes on `spaceId`, both entries. |
| Mobile Spaces — People page / per-photo strip | OK     | `#737` (b305) / `#735` (b304) intact; #738 is the detail sibling. |
| Branding / version pins                       | OK     | `example.env` `v4`, pubspec `1.0.0+1`, branding `2.7.5` intact.   |

## CI and Infrastructure Verification

| Check                           | Status | Notes                                                                |
| ------------------------------- | ------ | -------------------------------------------------------------------- |
| `fork-ownership-coverage-check` | OK     | 2593 files; baseline bumped to `31e7c05bcc` (all under `mobile/**`). |
| `ci-invariants-check`           | OK     | no PUSH_O_MATIC; Gallery images; docs-deploy dispatch-only.          |
| `fork-patches-check`            | OK     | `@immich/ui` patch consistent.                                       |
| `mobile-drift-rebase-check`     | OK     | schemaVersion 34 unchanged; `#738` adds no Drift migration.          |

## Database Migration Analysis

- **New migrations**: NONE (server or mobile Drift). Gallery server count 33; mobile
  `schemaVersion` 34. `revert-to-immich.sql` coverage intact.

## Inconsistencies Found

None. `server`/`web`/`cli`/`machine-learning`/`e2e`/`open-api` byte-identical to the batch-305 tip.

## Local CI Verification

| Check                                      | Status | Notes                                                                                                                                                                                                                |
| ------------------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server`/`web`/`e2e` build + tsc           | N/A    | byte-identical to batch-305 → redundant.                                                                                                                                                                             |
| OpenAPI / SQL regeneration                 | N/A    | no server change → no drift possible.                                                                                                                                                                                |
| Mobile `dart analyze` (scoped, 3.44.1)     | PASS   | all 14 changed lib+test files → "No issues found!".                                                                                                                                                                  |
| Mobile `dart format --set-exit-if-changed` | PASS   | all 14 changed files formatted.                                                                                                                                                                                      |
| Mobile `flutter test` (mise 3.44.1)        | PASS   | **113 tests across the 6 affected test files green** — incl. `getAssetPeople` space-person mapping (verifies the conflict resolution), `sharedSpacePerson` Drift, `buildPersonTimelineRouteService`, avatar routing. |

## Remote CI Verification

- **Test branch**: `rebase/upstream-batch-306`
- _CI dispatched after Checkpoint 3 approval. `#738` is mobile → static_analysis /
  gallery-build-mobile / Unit-Test-Mobile are the load-bearing gates; `test.yml`'s full matrix
  re-runs the (byte-identical) server/web/e2e suites too._

## Post-Rebase Verification

- Fork commits ahead of upstream: (batch replay) + `#738` + ownership bump + this report
- Commits behind upstream: 0
- `upstream/main` (`4b54fef82e`) is an ancestor of HEAD.
- Fork diff looks clean: YES.
