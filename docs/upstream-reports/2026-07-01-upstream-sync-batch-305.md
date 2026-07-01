# Upstream Sync Report — 2026-07-01 (batch 305)

## Summary

- **Upstream commits pulled**: 0 (`upstream/main` is still `4b54fef82e`, already integrated in
  batch 304 — this is a **fork-only** batch).
- **Fork commits synced**: 1 (`#737` — `dc3bd92a3e..b147bd8af5`).
- **Conflicts resolved**: 2 rebase conflicts + 1 "added by them" test file, plus a proactive
  **v3 openapi-drift adaptation** and one **missing-import** fix (both mobile-only, caught
  locally by scoped `dart analyze`).
- **Risk level**: LOW.
- **Recommendation**: PROCEED (pending CI on the test branch).

`server/src` + `web/src` + `cli` + `machine-learning` + `e2e` + `open-api` are **byte-identical**
to the batch-304 tip (`2ebf70717e`) — the only changes are mobile (`#737`) and the
`AGENTS.md`→`CLAUDE.md` symlink doc bullet. Fork stays on tagged base `2.7.5`.

## Fork Commit Sync (#737)

`fix(mobile): show shared-space people on the global People page (#737)` — the **People-page
sibling of #735/#727** (which shipped in batch 304). The mobile global People page
(`DriftPeopleCollectionPage`) read only the owner-scoped local Drift `person` table, which never
receives shared-space people, so it was empty for a viewer whose people come only through shared
Spaces. #737 sources it from the server's shared-space-inclusive, RBAC-projected list
(`GET /api/people?withSharedSpaces=true` — the same call the web People page makes), paging every
page and re-sorting client-side; gates/routes space-person edits like web
(`driftSpaceEditableProvider` → `isSpaceEditor`); and routes space-person thumbnails to the
membership-gated space endpoint. Touches 12 mobile lib files + 5 test files + a doc bullet.

`make upstream-sync-fork-main` threw on the cherry-pick (its all-or-nothing path), so per the
skill this was **hand-applied**: resolved the conflicts, `git cherry-pick --continue`, then
**manually advanced `integratedForkHead` → `b147bd8af5`** in `rolling-state.json` (with an
`appendHistory` entry) and refreshed the ownership baseline (`docs/fork/ownership.yml`
`last_verified_fork_head`, commit `71f0a24693`). (The failed run also required repairing a
malformed `appendHistory[38]` from batch 304's hand-edit — it was missing the required
`checks`/`lastCompletedBatch` fields.)

## Conflict Resolutions (fork-sync)

### `mobile/lib/presentation/pages/drift_people_collection.page.dart`

- **Fork side (HEAD)**: rolling migrated the People-page `sortBy` to the v3 `appConfigProvider`
  (`config.people.sortBy`); still watched `driftGetAllPeopleProvider`.
- **#737 side**: kept the v2.7.5 `settingsProvider`/`Setting.peopleSortBy` read; swapped the
  provider to `driftGetAllPeopleWithSharedSpacesProvider`.
- **Resolution**: keep rolling's v3 `appConfigProvider` sortBy line **and** apply #737's intent
  (the provider swap). Classic "take theirs' intent + preserve rolling's v3 API migration".
- **Risk**: LOW.

### `mobile/test/modules/spaces/shared_space_api_repository_test.dart`

- **Fork side (HEAD)**: rolling wrapped `SharedSpaceMemberCreateDto.role` in
  `const Optional.present(...)` (v3 openapi optional field).
- **#737 side**: added `registerFallbackValue(SharedSpacePersonUpdateDto())` (for the new
  `updateSpacePerson` mock) + reformatted the fallback block.
- **Resolution**: keep rolling's v3 `Optional.present` line **and** add #737's new fallback.
- **Risk**: LOW.

### `mobile/test/unit/utils/image_url_builder_test.dart` ("added by them")

- New URL-builder test file from #737; no openapi, pure string assertions. Accepted as-is.
- **Risk**: LOW.

## v3 OpenAPI-Drift Adaptation (proactive)

#737 was written against `origin/main` (still v2.7.5-based), so it carried the same
**v2.7.5→v3 openapi drift class that only CI `static_analysis` catches** as #735 did in batch 304. Every `PersonResponseDto`/`PeopleResponseDto`/`ScopedPrimaryProfile` optional field is
`Optional<...?>` on v3 while #737 used v2.7.5-style `?? `/direct access. Fixed **proactively**
(folded into the `#737` replay commit) rather than eating a CI round:

- **`person_api.repository.dart`** (`getAllPeopleWithSharedSpaces`/`_comparePeople`/
  `_personToDriftPerson`): unwrap `response.hasNextPage`, `dto.isFavorite`, `dto.numberOfAssets`,
  `dto.updatedAt`, `dto.color`, `dto.primaryProfile`, `profile.spaceId` with `.orElse(null)`.
  (`birthDate`/`isHidden`/`name`/`id` are plain → unchanged; `getAllPeople(withSharedSpaces:…)`
  signature and `ScopedPrimaryProfileTypeEnum.spacePerson` exist on v3 → unchanged.)
- **`shared_space_api.repository.dart`** (`updateSpacePerson`): wrap `SharedSpacePersonUpdateDto`
  `name`/`birthDate` in `Optional.present`/`const Optional.absent()` (mirror
  `PersonApiRepository.update`). `isSpaceEditor`'s `member.userId`/`role` are plain required →
  unchanged.
- **`person_api_repository_test.dart`** (new file): wrap the `personDto`/`peopleResponse` helper
  DTOs (`isFavorite`/`numberOfAssets`/`primaryProfile`/`hasNextPage`) and the inline
  `ScopedPrimaryProfile.spaceId` in `Optional`.

The `member()` helper, `PersonDto` (local model), and `drift_people_collection_test.dart`
(builds only `DriftPerson`) needed no change — verified against the v3 openapi.

## Missing-Import Fix

`drift_people_collection.page.dart` — #737's new `_PersonName` widget names `DriftPerson`
explicitly (`final DriftPerson person;`), but the page never imported `person.model.dart` (it
resolved via a transitive path on v2.7.5 `origin/main` that the rolling v3 tree doesn't provide).
Scoped `dart analyze` flagged `undefined_class 'DriftPerson'`; added the direct
`import 'package:immich_mobile/domain/models/person.model.dart';` in dart-sorted position. This
is exactly the class only `static_analysis` catches — caught locally here.

## Fork Feature Verification

| Feature                                 | Status | Notes                                                                |
| --------------------------------------- | ------ | -------------------------------------------------------------------- |
| Mobile Spaces — people on shared assets | OK     | `#737` synced; People page now server-sourced, edits gated like web. |
| Mobile Spaces — per-photo people strip  | OK     | `#735`/#727 (batch 304) intact; `#737` is the People-page sibling.   |
| Branding / version pins                 | OK     | `example.env` `v4`, pubspec `1.0.0+1`, branding `2.7.5` intact.      |

## CI and Infrastructure Verification

| Check                           | Status | Notes                                                                                 |
| ------------------------------- | ------ | ------------------------------------------------------------------------------------- |
| `fork-ownership-coverage-check` | OK     | 2590 files; `last_verified_fork_head` bumped to `b147bd8af5` (all under `mobile/**`). |
| `ci-invariants-check`           | OK     | no PUSH_O_MATIC; Gallery images; docs-deploy dispatch-only.                           |
| `fork-patches-check`            | OK     | `@immich/ui` patch consistent.                                                        |
| `mobile-drift-rebase-check`     | OK     | schemaVersion 34 unchanged; `#737` adds no Drift migration.                           |

## Database Migration Analysis

- **New migrations**: NONE (server or mobile Drift). Gallery server migration count 33 unchanged;
  mobile `schemaVersion` stays 34. `revert-to-immich.sql` coverage intact.

## Inconsistencies Found

None. `server/src` + `web/src` + `cli` + `machine-learning` + `e2e` + `open-api` byte-identical
to the batch-304 tip.

## Local CI Verification

| Check                                      | Status | Notes                                                                                                  |
| ------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------ |
| `server`/`web`/`e2e` build + tsc           | N/A    | byte-identical to batch-304 (0 changed files in those trees) → redundant.                              |
| OpenAPI / SQL regeneration                 | N/A    | no server change → no spec/SQL drift possible.                                                         |
| Mobile `dart analyze` (scoped)             | PASS   | all 18 changed lib+test files → "No issues found!" (mise 3.12.1; files have no private-named-params).  |
| Mobile `dart format --set-exit-if-changed` | PASS   | all 18 changed files formatted (0 changed), mise 3.12.1.                                               |
| Mobile build / flutter test                | CI     | not runnable locally (flutter-pin); validated on CI static_analysis / build-mobile / Unit-Test-Mobile. |

## Remote CI Verification

- **Test branch**: `rebase/upstream-batch-305`
- _CI dispatched after Checkpoint 3 approval; results recorded before force-push. `#737` is
  mobile → static_analysis / gallery-build-mobile / Unit-Test-Mobile are the load-bearing gates;
  `test.yml`'s full matrix re-runs the (byte-identical) server/web/e2e suites too._

## Post-Rebase Verification

- Fork commits ahead of upstream: (batch replay) + `#737` + ownership bump + this report
- Commits behind upstream: 0
- `upstream/main` (`4b54fef82e`) is an ancestor of HEAD.
- Fork diff looks clean: YES.
