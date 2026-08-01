# Upstream Sync Report — 2026-08-01 (action-model continuation)

## Summary

- **Upstream commits pulled**: 13 (`483b375c26c..cafd6c7c0f1`, batches 35–45)
- **Fork commits synced**: 1 (#892)
- **Conflicts resolved**: 9 (2 during the fork sync, 7 during the rebase)
- **Risk level**: MEDIUM — all changes are mobile-only, but they land squarely on fork Space surfaces
- **Recommendation**: PROCEED

Branch `rebase/upstream-rolling-v3.1.1` is **level with `upstream/main`** at `cafd6c7c0f1`
(`git rev-list --count HEAD..cafd6c7c0f1` = 0). Branch HEAD `8e9106a3b67`.

All 13 upstream commits are a single workstream: the continuation of the mobile action-model
migration (`refactor: base action (#29617)`) that arc 4 integrated on 2026-07-31. Upstream migrated
~20 of its own action buttons out of `presentation/widgets/action_buttons/*` into
`presentation/actions/*.action.dart`, and shrank `ActionService` from 26 methods to 4.

**Scope is unusually tight and was verified rather than assumed**: the entire session delta versus
the pre-session tip is **137 files — 136 under `mobile/` plus `docs/fork/ownership.yml`**. Server,
web, e2e, ML, CI workflows, migrations and dependency manifests are untouched.

## Incoming Upstream Changes

| SHA           | Summary                                                   | Area   | Risk to Fork | Notes                                                       |
| ------------- | --------------------------------------------------------- | ------ | ------------ | ----------------------------------------------------------- |
| `36f12ec805f` | mobile open in browser, **similar**, set profile (#29769) | mobile | **HIGH**     | add/add on `similar_photos.action.dart`; see gate below     |
| `0a97b4b099a` | mobile share actions (#29947)                             | mobile | MEDIUM       | sharing surface; asset share-sheet, not Shared Spaces       |
| `cafd6c7c0f1` | cleanup actions & action tests (#30265)                   | mobile | MEDIUM       | rewrites `presentation_context.dart` under arc-4 fork tests |
| `5b0a324b68e` | restore action (#29374)                                   | mobile | LOW          | upstream-owned button                                       |
| `208b7cf9cac` | stack action (#29370)                                     | mobile | LOW          | upstream-owned button                                       |
| `e6b5b0deb6a` | archive action (#29362)                                   | mobile | LOW          | upstream-owned button                                       |
| `47d34e3b4b1` | mobile lock action (#29767)                               | mobile | LOW          | upstream-owned button                                       |
| `3f3bc44258c` | mobile delete action (#29771)                             | mobile | LOW          | upstream-owned button                                       |
| `a048e86217b` | mobile cast and slideshow action (#29768)                 | mobile | LOW          | upstream-owned button                                       |
| `9fcbb6eefc8` | mobile edit asset actions (#30264)                        | mobile | LOW          | upstream-owned button                                       |
| `1fa985babb9` | album action (#29770)                                     | mobile | LOW          | upstream-owned button                                       |
| `bc84054cccb` | mobile tag and download actions (#29948)                  | mobile | LOW          | upstream-owned button                                       |
| `3d42c1424c2` | mobile upload action (#29949)                             | mobile | LOW          | upstream-owned button                                       |

## Product-direction gate — FIRED on `36f12ec805f` (#29769)

Upstream independently created **`mobile/lib/presentation/actions/similar_photos.action.dart`** at
the exact path, with the same class name, icon and i18n key as the fork's arc-4 port. Same feature,
different product destination:

| Aspect         | Fork (arc 4, originating in #654)                           | Upstream #29769                                |
| -------------- | ----------------------------------------------------------- | ---------------------------------------------- |
| Destination    | `photosFilterProvider.setSimilarTo()` → `MainTimelineRoute` | `searchPreFilterProvider` → `DriftSearchRoute` |
| Surface        | fork photos-filter sheet on the main timeline               | upstream's mobile search page                  |
| Compiles here? | yes                                                         | **no**                                         |

The last row is decisive and was verified, not assumed: the fork **removed upstream's mobile search
page** — `mobile/lib/presentation/pages/search/` (`drift_search.page.dart`,
`paginated_search.provider.dart`) exists at the upstream base, is absent from both this branch and
`origin/main`, and `mobile/lib` contains **zero** references to `DriftSearchRoute` or
`searchPreFilterProvider`.

The divergence is not new: fork commit **#654** ("infinite scroll + sort for live search") is where
"view similar photos" was deliberately switched off upstream's search page onto the fork's photos
filter, and arc 4 carried that logic into `similar_photos.action.dart`.

**Decision (maintainer, 2026-08-01): keep the fork's version; record upstream's as a divergence.**
Upstream's file is discarded on this branch.

## Conflict Resolutions

### 1. Fork sync of #892 — `mobile/**` generated code (3 × DU)

- **Fork side**: `main` still commits Pigeon output (`Network.g.kt`, `Network.g.swift`, `network_api.g.dart`).
- **Upstream side**: this branch de-commits them (upstream #30343, adopted via PR #888).
- **Resolution**: accept the deletions. Verified `mobile/pigeon/network_api.dart` declares all three
  as its `dartOut`/`swiftOut`/`kotlinOut`, so they are build-time outputs.
- **Risk**: LOW.

### 2. Fork sync of #892 — fork-only background-backup tests (3 × UD)

- **Resolution**: accept the deletions. All three test fork-only machinery that #892 deliberately
  removes; none exist at the upstream base.
- **Risk**: LOW.

### 3. Fork sync of #892 — `api.service.dart`, `service.mocks.dart`, `background_upload.service.dart`, `background_upload.service_test.dart`

- **Resolution**: combine, don't pick a side — take #892's removals, keep the rolling branch's Dart
  lint fixes. Verified by diffing each resolved file against #892's own version: the only remaining
  deltas are lint (`unawaited()`, `void`/`Future<void>` return types, import ordering,
  `unnecessary_breaks`), plus arc 4's `MockActionService`/`MockToastService` which were correctly retained.
- **Follow-up caught by `dart analyze`**: a dangling `background_backup_status.model.dart` import
  survived outside the conflict hunk and was removed.
- **Risk**: LOW.

### 4. Fork sync of #892 — `drift_backup.page.dart`, `drift_backup.provider.dart`

- **Resolution**: take #892's side wholesale, then re-apply lint mechanically. Justified by measuring
  the rolling branch's delta over #892's parent for both files: **purely lint churn**, no behaviour.
- **Risk**: LOW. The lint re-application was deferred and completed in `8e9106a3b67`.

### 5. Rebase — squashed fork base vs upstream's slimmed `ActionService` / `ActionNotifier`

Upstream removed 22 of the fork's 26 `ActionService` methods and 28 `ActionNotifier` methods.
Rather than resolve by eye, each removed method was diffed against **upstream's own base version**
to separate "upstream code the fork merely inherited" from "fork behaviour":

| File                   | Fork-only                                                                                          | Fork-modified     | Identical to upstream base |
| ---------------------- | -------------------------------------------------------------------------------------------------- | ----------------- | -------------------------- |
| `action.service.dart`  | `removeFromSpace`                                                                                  | —                 | 21                         |
| `action.provider.dart` | `removeFromSpace`, `addToSpace`, `addToSpaceAlbum`, `_addToSpaceTarget`, `_nudgeSpaceSyncIfLinked` | `removeFromAlbum` | 22                         |

- **Resolution**: adopt upstream's architecture for everything byte-identical to its base; re-add the
  fork-only and fork-modified methods on top.
- **Risk**: MEDIUM, mitigated. This audit is what caught item 6 below.

### 6. Rebase — `removeFromAlbum` carries fork Shared-Spaces behaviour

- **Fork side**: `ActionNotifier.removeFromAlbum` calls `_nudgeSpaceSyncIfLinked(albumId)` after a
  successful removal; the fork-only `SpaceAlbumBottomSheet` drives it through
  `RemoveFromAlbumActionButton(onComplete:)`.
- **Upstream side**: `RemoveFromAlbumAction` has **no completion hook** and no space nudge.
- **Resolution**: retain the fork's `RemoveFromAlbumActionButton` widget plus
  `ActionNotifier.removeFromAlbum` and `ActionService.removeFromAlbum` (which reintroduces the
  `DriftAlbumApiRepository` / `DriftRemoteAlbumRepository` constructor deps).
- **Why not adopt upstream's**: doing so would have silently dropped the Space sync nudge — a
  functional regression on Space Albums (#749/#752) that no test, type check or audit would flag.
- **Confirmation the call was right**: a later fork commit in the replay re-applied
  `_nudgeSpaceSyncIfLinked` onto the restored `removeFromAlbum` cleanly. Had it been dropped, that
  commit would have silently failed to add the nudge.
- **Risk**: MEDIUM — see follow-up 1.

### 7. Rebase — `action_button.utils.dart` (#643 commit, `ecff8775022`)

- **Instructed resolution** was "take upstream, drop the fork hunk". **This was overridden for this
  hunk, deliberately**: #643 also **deletes `ScrollToDateEvent`** from `events.model.dart`, so
  upstream's `EventStream.shared.emit(ScrollToDateEvent(...))` line does not compile on this branch.
  The fork's `scrollToDateNotifierProvider` handler was kept and its import restored.
- The instructed resolution **was** applied to arc 4's later `maybePop`/`mounted` hunk in
  `9fa6943782d`, where upstream's structure was taken.
- **Risk**: LOW. #643 is under active rework; the `viewInTimeline` handler on this branch is #643's
  own notifier-based version.

### 8. Rebase — import blocks (`action.provider.dart`, `general_bottom_sheet.widget.dart`)

- **Resolution**: HEAD plus the fork commit's own delta (and, for `general_bottom_sheet`, HEAD minus
  the fork's removals — #863 replaces upstream's album selector with the fork's `CollectionPicker`).
- **Defect this introduced, caught by `dart analyze`**: the rule dropped
  `package:openapi/api.dart`, which the fork's surviving `addToSpace(…, SharedSpaceResponseDto)`
  still needs. Restored in `8e9106a3b67`.
- **Risk**: LOW after the fix. Noted because the rule is otherwise sound and reusable — it just
  cannot see which upstream-removed imports the fork's _surviving_ code still depends on.

### 9. Rebase — `presentation_context.dart` (arc-4 port vs upstream #30265)

- Purely additive on both sides; kept both sets of provider overrides and imports.
- **Risk**: LOW.

## Fork Feature Verification

| Feature                          | Status | Notes                                                                             |
| -------------------------------- | ------ | --------------------------------------------------------------------------------- |
| Shared Spaces (mobile actions)   | OK     | all 6 fork methods present; `removeFromSpace` still uses `_getRemoteIdsForSource` |
| Space Albums (#749/#752)         | OK     | `_nudgeSpaceSyncIfLinked` retained on `removeFromAlbum`                           |
| Similar Photos (fork filter)     | OK     | fork's `similar_photos.action.dart` kept; upstream's discarded                    |
| Photos Filter sheet              | OK     | untouched                                                                         |
| Memory → timeline (#643)         | OK     | notifier-based handler retained; under separate rework                            |
| Mobile build-time codegen (#888) | OK     | Pigeon/OpenAPI/Drift regenerate cleanly                                           |
| Branding / CI invariants         | OK     | `ci-invariants-check`, `fork-patches-check` pass                                  |

**The load-bearing constraint is intact and re-verified**: `ActionNotifier.removeFromSpace` resolves
ids via `_getRemoteIdsForSource`, **not** `_getOwnedRemoteIdsForSource` — removing from a Space is
not owner-scoped, so an editor may remove another member's photo. The comment pinning this is now
carried in both `action.provider.dart` and `action.service.dart`.

## Database Migration Analysis

No migrations in this arc. `Gallery Migration Count` = 49 (expected 49); no timestamp collisions;
`revert-to-immich.sql` coverage unchanged.

## Mobile Drift Migration Analysis

No schema change. `mobile-drift-rebase-check` reports `schemaVersion`, snapshots and Gallery
callbacks consistent.

## Deliberate Divergences

| File                                                                              | Upstream wanted                              | Taken as     | Why                                                                      |
| --------------------------------------------------------------------------------- | -------------------------------------------- | ------------ | ------------------------------------------------------------------------ |
| `presentation/actions/similar_photos.action.dart`                                 | search-page destination (`DriftSearchRoute`) | **fork's**   | fork removed the mobile search page in #654; upstream's does not compile |
| `presentation/widgets/action_buttons/remove_from_album_action_button.widget.dart` | deleted                                      | **retained** | fork-only `SpaceAlbumBottomSheet` needs the `onComplete` sync-nudge hook |
| `services/action.service.dart` `removeFromAlbum`                                  | deleted                                      | **retained** | backs the fork's space-nudging notifier variant                          |
| `utils/action_button.utils.dart` `viewInTimeline`                                 | `EventStream` emit                           | **fork's**   | #643 deletes `ScrollToDateEvent`; upstream's line does not compile       |

## Local CI Verification

| Check                                            | Status | Notes                                  |
| ------------------------------------------------ | ------ | -------------------------------------- |
| `make upstream-postrebase-audit BATCH=45`        | PASS   | 7/7 OK incl. Generated Artifact Review |
| `make mobile-drift-rebase-check BATCH=45`        | PASS   |                                        |
| `make ci-invariants-check`                       | PASS   | 3/3                                    |
| `make fork-patches-check`                        | PASS   | `@immich/ui` patch consistent          |
| `make fork-ownership-coverage-check`             | PASS   | 3183 fork files covered                |
| `pnpm install --frozen-lockfile`                 | PASS   | 9 `link:` workspace deps, 0 `file:`    |
| `dart analyze --fatal-infos lib test`            | PASS   | No issues found                        |
| `dart format --set-exit-if-changed` (lib + test) | PASS   | 0 changed after fixes                  |
| `flutter test` (full mobile suite)               | PASS   | **3010 passed, 1 skipped, 0 failed**   |

Server/web/e2e suites were **not** run: the arc changed zero files outside `mobile/` and
`docs/fork/ownership.yml`, verified by `git diff --name-only`.

`mise.lock` and `mobile/mise.lock` were confirmed untouched after the local `mise`-backed `make`
runs (the known strip trap did not fire).

## Follow-up work

1. **Migrate `SpaceAlbumBottomSheet` onto upstream's `RemoveFromAlbumAction`.** The fork currently
   retains a parallel widget + notifier + service path solely to keep the Space sync nudge. Upstream's
   action needs a completion hook (or the nudge needs to move) before the fork can drop the duplicate.
   Until then this trio re-conflicts on every rebase that touches remove-from-album.
2. **#643 regression coverage** — still the highest-value gap; the `viewInTimeline` handler was
   resolved by hand this arc with no test asserting it. Being reworked separately.
3. **Non-idempotent e2e upload retry** (carried from arc 1) — `e2e/vitest.config.ts` `retry: 4`
   re-uploads identical bytes, so one slow upload is a guaranteed 5-attempt failure.
4. `'Remove from space'` and its success toast remain untranslated (pre-existing).
