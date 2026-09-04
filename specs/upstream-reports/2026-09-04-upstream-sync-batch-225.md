# Upstream Sync Report — 2026-09-04 (batch 225)

## Summary

- **Upstream commits pulled**: 2 (`b1a93688d3c..a6d43828f6c`)
- **Fork commits synced**: 3 (#1060, #931, #1065)
- **Conflicts resolved**: 1 upstream + 66 fork-sync (26 + 38 + 5, less the mechanically-deleted paths)
- **Risk level**: MEDIUM — the upstream half was trivial; the fork half hit every rolling-only rename at once
- **Recommendation**: PROCEED

The upstream batch was two mobile commits and applied almost verbatim. Effectively all the work
was the **fork sync**: three PRs authored against `main`, which does not carry rolling's Option-M
`personGroupId` re-key, the mobile Drift relocation, the typed-i18n accessor, or the `Drift*`
de-prefixing. Every one of those collided.

## Incoming Upstream Changes

| SHA           | Summary                                                                                | Area   | Risk to Fork | Notes                                                                                                                                                                                                                                                                                                                                                          |
| ------------- | -------------------------------------------------------------------------------------- | ------ | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `a6d43828f6c` | fix(mobile): rewrite slideshow controller system (immich-30771)                        | mobile | LOW          | 707-line rewrite of `slideshow.page.dart`, which has **zero** fork delta — adopted verbatim. Adds `SlideshowController` + 3 widgets + 2 test files. Touches the shared test infra (`mocks.dart`, `presentation_context.dart`), where the fork's `ActionServiceStub` / `foregroundUploadServiceProvider` entries had to survive alongside upstream's additions. |
| `31943fbe07b` | fix(mobile): make shared link download toggle depend on metadata toggle (immich-31264) | mobile | LOW          | 2-line UI fix inside upstream's own public-link editor. Not a sharing-model change.                                                                                                                                                                                                                                                                            |

### Per-batch product-direction gate

**Did not fire.** The slideshow is not a fork surface. immich-31264 touches _shared links_ — adjacent
to Shared Spaces by name — but it is a two-line toggle-dependency bug fix inside upstream's existing
public-link feature, not a rework of the sharing model, so it does not meet the gate's bar.

### Pre-rebase detectors

| Detector                                                                  | Result                                                                                                          |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Shape I — files ADDED by the batch vs fork history (`origin/main`-scoped) | clean                                                                                                           |
| Shape I — RENAMES onto fork-touched paths                                 | clean (no renames in this batch)                                                                                |
| SILENT-NOOP — literals upstream deletes vs fork literal-matching tooling  | clean                                                                                                           |
| i18n branding-override gap                                                | clean (batch touches no i18n)                                                                                   |
| Reduce-motion progress-bar fix (`AnimationBehavior.preserve`)             | **survives** — upstream's rewrite carries it into `SlideshowController` with its flutter/flutter#164287 comment |

## Conflict Resolutions

### Upstream half

#### Conflict: `mobile/lib/presentation/widgets/asset_viewer/video_viewer.widget.dart`

- **Fork side**: adds `forceAutoPlay` (memory viewer builds the player with `showControls: false`, so
  a user with autoplay off would otherwise get a frozen first frame).
- **Upstream side**: adds `loopOverride` at the same two locations (field, then ctor parameter).
- **Resolution**: keep **both**, upstream's first. Purely additive on both sides; base was empty.
- **Risk**: LOW. **Verified**: both symbols present (3 references each); `memory_card.widget.dart`
  and its dedicated fork test still compile and pass.

### Fork half — the three rolling-only renames

Every fork conflict fell into one of five mechanical classes plus a handful of genuine
reconciliations. The mechanical ones:

| Class                                                                                                                                                                 | Resolution                                                         | Count |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----- |
| **Shape Q** — retired `mobile/openapi/**` (rolling generates it at build time into the gitignored `mobile/generated/openapi/`)                                        | delete                                                             | 17    |
| Generated Drift artefacts at main's pre-relocation paths (`db.repository.{drift,steps}.dart`, `*.entity.drift.dart`) and `router.gr.dart` — all gitignored on rolling | delete                                                             | 6     |
| `mobile/test/drift/main/generated/schema.dart` — gitignored codegen                                                                                                   | delete                                                             | 2     |
| New Drift tables landing at main's path/naming                                                                                                                        | rename to `data/db/main/table/remote/<bare>.dart`, repoint imports | 2     |
| Import blocks where the PR adds exactly one import                                                                                                                    | rolling's block + that import, translated                          | 8     |

#### Conflict: `mobile/lib/data/db/main/table/remote/shared_space_album_{hidden,folder}.dart` (Shape L)

- **Fork side (rolling)**: tables live at `data/db/main/table/remote/`, bare names, importing
  `data/db/main/table/remote/shared_space.dart` and `data/db/util/defaults_mixin.dart`.
- **Upstream side (the PR)**: new tables importing `infrastructure/entities/shared_space.entity.dart`
  and `infrastructure/utils/drift_default.mixin.dart` — paths that no longer exist here.
- **Resolution**: renamed to rolling's convention and repointed both imports.
- **Risk**: **HIGH if missed.** This is Shape L exactly: Drift does not fail on an unresolved import,
  it silently drops the FK and the mixin-supplied defaults and generates a schema missing them.
- **Verification**: the dangling-import detector over `mobile/lib` + `mobile/test` reports zero
  MISSING; `make-migrations` regenerates the v37/v38 snapshots; `mobile-drift-rebase-check` green.

#### Conflict: the typed-i18n accessor (58 call sites, 6 files)

- **Fork side**: rolling has only `context.t.<key>`, a `BuildContext` extension generated from
  `i18n/`. It has **no** `String.t(context:)` extension — the one pre-existing match in
  `remove_from_space.action.dart` is a comment, not a call.
- **Upstream side**: all three PRs use main's `'key'.t(context: X)` idiom throughout.
- **Resolution**: converted 50 literal-key sites mechanically; the 5 dynamic-key sites have no typed
  equivalent, so `_folderErrorMessage` enumerates the three keys `spaceAlbumFolderErrorKey` can
  return and falls back to the caller's already-translated string, and the one ternary key became a
  ternary over two typed accessors.
- **Risk**: LOW once converted — `dart analyze` sees every miss.

#### Conflict: `mobile/lib/domain/models/feature_message.model.dart` (design collision)

- **Fork side**: upstream (immich-31038) made `FeatureHighlight` an **enum** with typed
  `title(Translations)` / `body(Translations)` accessors and six upstream members.
- **Upstream side (the PR)**: introduces the fork-owned seam — `feature_message_gallery.model.dart`
  holding the batch and the release constant — with the batch built from `FeatureHighlight(...)`
  const constructions carrying `titleKey`/`bodyKey`.
- **Resolution**: kept the PR's seam (batch + version stay fork-owned, upstream's file delegates) but
  expressed the batch as an enum **member**: added `FeatureHighlight.spacesInNav` with its
  title/body switch arms, and `galleryFeatureMessageHighlights = [FeatureHighlight.spacesInNav]`.
  `visibleFeatureMessageHighlights` now filters the **gallery** batch, not `FeatureHighlight.values`,
  which is what stops upstream's six Immich 3.0 cards re-showing.
- **Risk**: MEDIUM — this is a **judgment call on user-facing content**, see Decisions below.
- **Verification**: the PR's own guard test survives, adapted to derive the i18n keys from the enum
  member name (the same convention the enum's switch follows), so every locale guarantee it had is
  intact. All 10 locales carry `spaces_in_nav_title` / `_body`; the webp asset is present.

#### Conflict: `server/src/repositories/asset.repository.ts` (Shape K)

- The second diff3 region was **asymmetrically aligned**: `ours` (44 lines) and `theirs` (18) covered
  _different spans_ of `withTimeBucketAssetFilters` — `theirs` was a reindented copy of the
  `isNotInAlbum`/`isInAlbum`/`spaceId` branches, which git had already emitted above.
- **Resolution**: rather than splice, the whole function was rebuilt from the PR's version (which
  carries the `return (…)` reindent, `ownerArmWithHiddenSubtraction`, and the
  `requireShowInTimeline` → `albumTimelineGate` rename), then rolling's two deltas re-applied: the
  `viewerId` parameter and the person-scoped `inSharedAlbum` widening at both owner arms.
- **Risk**: MEDIUM — RBAC-critical. See Decisions below for the composition choice.
- **Verification**: a whitespace-normalised whole-file audit lists 13 rolling lines absent from the
  result, and **all 13 are accounted for** by intentional PR changes (the expanded scope import, the
  `return (` reindent, 3× `requireShowInTimeline`, the 2 owner arms, the trailing-paren change).
  `tsc` clean.

#### Conflict: `server/src/repositories/person.repository.ts` (Option-M)

- **Fork side**: rolling consolidated two `spaceAssetPathBranches` calls into one and is re-keyed to
  `personGroupId`.
- **Upstream side**: the PR adds `albumTimelineGate: 'none'` to the call rolling had **deleted**.
- **Resolution**: kept rolling's re-keyed line and applied the PR's _intent_ to rolling's surviving
  call site. Taking `ours` alone would have silently dropped the gate — and because
  `albumTimelineGate` is a REQUIRED union, `tsc` catches it, which is exactly why upstream typed it
  that way.

## Fork Feature Verification

| Feature                     | Status | Notes                                                                                               |
| --------------------------- | ------ | --------------------------------------------------------------------------------------------------- |
| Shared Spaces               | OK     | Space albums, folders (#931), per-member hide (#1060) all land; sync streams awaited correctly      |
| Storage Migration           | OK     | untouched                                                                                           |
| Pet Detection / Recognition | OK     | #1065's pet filter re-keyed to Option-M columns; `pet_search` join verified against the live schema |
| Image Editing               | OK     | untouched                                                                                           |
| Branding                    | OK     | `branding/` byte-identical to the last green tip                                                    |
| Google Photos Import        | OK     | untouched                                                                                           |
| Search V3 dormancy          | OK     | `ci-invariants-check` — still present, still not dispatched                                         |
| Memories                    | OK     | `searchAccessible` gained the hidden-scope subtraction on rolling's parenthesised, re-keyed form    |

## Database Migration Analysis

### New fork migrations

| Timestamp     | Migration                        | Tables                      | Notes                                        |
| ------------- | -------------------------------- | --------------------------- | -------------------------------------------- |
| 1793000000000 | AddSharedSpaceAlbumHidden        | `shared_space_album_hidden` | from #1060                                   |
| 1793100000000 | AddSharedSpaceAlbumFolderTable   | `shared_space_album_folder` | from #931                                    |
| 1793200000000 | SharedSpaceAlbumFolderAuditTable | folder audit                | from #931                                    |
| 1793300000000 | ClearPreOptionMFaceRepairScans   | `face_repair_scan`          | **renumbered this cycle** from 1793000000000 |

### Timestamp collision — resolved by renumbering the rolling-only side

#1060 landed `1793000000000-AddSharedSpaceAlbumHidden`, colliding with the rolling-only
`1793000000000-ClearPreOptionMFaceRepairScans`. Three same-timestamp pairs are grandfathered in
`tools/upstream-preflight/src/migration-timestamps.spec.ts`, but that spec fails on any **new** one —
and it did.

`ClearPreOptionMFaceRepairScans` moved to `1793300000000`, not the other:

- `AddSharedSpaceAlbumHidden` is already on `main` under that name, so a deployed DB has recorded it;
  renaming it would leave Kysely with a recorded migration whose file is gone — a hard boot failure.
- The cleanup migration is rolling-only and documents itself as safe to re-run (its predicate targets
  only pre-M blobs), so a re-run under the new name is a no-op on any RC that already applied it.

Manifest follow-through: `docs/fork/ownership.yml` and `scripts/revert-to-immich.sql` updated and
re-sorted. The audit also caught that **#843's two pet-search migrations were never added to the
manifest last cycle** (count 64 vs expected 62) — fixed in its own commit.

- Migration count: **67** (`Gallery Migration Count` green)
- Upstream/gallery timestamp collisions: NONE
- Postbuild merge: intact — "Synced 67 Gallery migrations … 1 compatibility aliases"
- `revert-to-immich.sql` coverage: complete (detector reports no MISSING)
- Migrations applied cleanly against a real PG14+vchord container, including both `1793000000000`
  entries under their distinct names

## Mobile Drift Migration Analysis

| Schema Version | Source       | Tables                                                            | Notes                                                                 |
| -------------- | ------------ | ----------------------------------------------------------------- | --------------------------------------------------------------------- |
| v37            | fork (#1060) | `shared_space_album_hidden_entity`                                | `from36To37`                                                          |
| v38            | fork (#931)  | `shared_space_album_folder_entity` + `folderId` on the link table | `from37To38`, via `TableMigration` so existing rows survive with null |

- `schemaVersion` = 38, snapshots v37/v38 present, callback chain contiguous
- `database.steps.dart` regenerated via `make-migrations` (it was stale, which is what surfaced the
  `from36To37` / `from37To38` "undefined named parameter" errors)
- `mobile-drift-rebase-check`: OK
- No renumbering of upstream mobile migrations was needed (upstream is far below the fork here)

## Inconsistencies Found

Beyond the conflicts above, these landed with **zero conflict** and were caught only by a gate:

1. **`sync.service.ts` — 8 un-awaited `send()` / `sendEntityBackfillCompleteAck()` calls.** Upstream
   made `send` async to honour writable backpressure (`await once(response, 'drain')`); both fork PRs
   were written against main, where it was synchronous. Not merely lint: an un-awaited send skips the
   drain, so a large backfill can outrun the socket buffer. All 98 pre-existing sites await; these now
   do too. **Caught by `server pnpm lint`, nothing else.**
2. **`person.repository.ts:789` — a second `pet_face.personId` correlation** in a Kysely builder
   (distinct from the raw-SQL block that conflicted). `person.id` does not exist on rolling. **Caught
   by `tsc`.**
3. **32 medium-spec assertions** in the two person/face-identity specs using main's `person.id` /
   `personId:` vocabulary. **Caught by `tsc`.**
4. **`AppRouter` lost its permission-notifier parameter** (immich-30665 — a lint rule that removes
   unused parameters is a signature-changing rule). The PR's new tab-shell test passed 5 arguments.
   **Caught by `dart analyze`.**
5. **`space-albums-list.svelte` missing from the branded-spinner swapped set**, and the three new fork
   migrations missing from the ownership manifest. **Caught by `tools/upstream-preflight`** — the
   fork-only suite the skill flags as load-bearing, and it earned that description again.
6. **Ten generated Dart models resurrected into the retired `mobile/openapi/`** (Shape Q). #931 and
   #1060 predate the move to build-time codegen, so they carry committed client files. The fork
   deleted that tree, which is precisely why they slipped in: git sees a clean **ADD** against a
   deleted directory, so there is no conflict, the post-rebase audit passes (the path is not
   fork-owned) and the fork-owned-file check passes too. They are stale duplicates — the real client
   generates into the gitignored `mobile/generated/openapi/`, which already declares both models.
   **Caught only by the retired-directory detector**, run as the final sweep. `mobile/openapi/` is now
   gitignored so the next main-authored PR cannot re-add it.
7. **The PR's new bottom-nav tests pump without `localizedForTest`**, which rolling's `context.t`
   requires. **Caught by `flutter test` (8 failures), not by analyze.**

### Two local-tooling traps worth recording

- **`mise //mobile:*` resolves `//` against the MAIN checkout, not the worktree.** The main checkout
  is on a branch pinning Flutter **3.44.8**; the worktree pins **3.47.1**. Every mobile mise task
  therefore ran the wrong SDK and failed at `pub get`. Running bare tasks from `mobile/`, or invoking
  `~/.local/share/mise/installs/aqua-flutter-flutter/3.47.1/flutter/bin/{flutter,dart}` directly,
  is the workaround.
- **`dart fix --apply` edits `pubspec.yaml`.** It "fixed" `depend_on_referenced_packages` by adding
  `stack_trace: any`, `meta: any` and `shared_preferences: any` to the manifest, which then produced
  15 phantom `unnecessary_ignore` findings. Reverted; same family as the `mise.lock` trap — check
  `git status -- '*pubspec*' '*mise.lock'` after any local tooling run.

## Local CI Verification

Scoped by tree identity against the last 10/10-green tip: `machine-learning` and `.github` are
**byte-identical**, so their gates were not run.

| Check                                            | Status        | Notes                                                                                      |
| ------------------------------------------------ | ------------- | ------------------------------------------------------------------------------------------ |
| `server pnpm build` (+ postbuild migration sync) | PASS          | 67 migrations, 1 compatibility alias                                                       |
| `server pnpm check` (tsc)                        | PASS          | after 33 Option-M fixes                                                                    |
| `server pnpm lint`                               | PASS          | after the 8 `await` fixes                                                                  |
| Server unit tests                                | PASS          | 6393 passed; 1 known flake (`oauth.controller.spec.ts`, issue #1042 — passes in isolation) |
| `web check:typescript`                           | PASS          | needed a `packages/sdk` rebuild first (stale build artefact)                               |
| `web check:svelte`                               | PASS          | 639 files, 0 errors, 0 warnings                                                            |
| Web unit tests                                   | PASS          | 6320 passed, 389 files                                                                     |
| `e2e pnpm check`                                 | PASS          |                                                                                            |
| `tools/upstream-preflight` vitest                | PASS          | 257 tests, after 2 manifest fixes                                                          |
| `dart analyze --fatal-infos` (lib+test)          | PASS          | No issues found                                                                            |
| `dart format --set-exit-if-changed`              | PASS          | 1353 files, 0 changed                                                                      |
| `flutter test`                                   | PASS          | 3827 passed, 1 skipped                                                                     |
| `make upstream-postrebase-audit`                 | PASS          | all 8 checks OK                                                                            |
| `make ci-invariants-check`                       | PASS          | incl. Search V3 dormancy                                                                   |
| `make fork-patches-check`                        | PASS          |                                                                                            |
| `make mobile-drift-rebase-check`                 | PASS          |                                                                                            |
| `make commit-autolink-check`                     | PASS          | 1446 messages, no cross-repo autolink                                                      |
| SQL regeneration (`mise run //:sql`)             | PASS          | 63 files / 722 queries; only the 2 conflicted files drifted                                |
| i18n + docs prettier                             | PASS          |                                                                                            |
| web eslint                                       | see Remote CI |                                                                                            |

## Decisions Requiring Judgment

Two resolutions were not mechanical. Both are flagged for review:

1. **The owner-arm composition in `asset.repository.ts`.** Rolling widens the person-scoped owner
   check with `inSharedAlbum` (immich-30739); #1060 narrows the caller's own arm with the
   hide-from-timeline subtraction. They are composed as `OR` — an asset reaching the viewer through a
   shared album is _not_ withheld by the caller's own hidden-space scope, while the caller's own rows
   still carry the subtraction. This matches #1060's own `TimelineRescue` design ("another visible
   path re-admits this photo"), but it is a semantic choice, not a forced one.

2. **The What's-New batch on rolling's enum.** The PR's fork-owned batch could not be expressed as
   written (an enum member cannot be const-constructed, and there is no `titleKey`/`bodyKey`). The
   translation preserves the seam and the user-visible result — one "Spaces in nav" card at
   `SemVer(5,6,0)` — but a reviewer should confirm that reading of the intent.

## Post-Rebase Verification

- Fork commits ahead of upstream: **1446**
- Commits behind `upstream/main`: **0**
- Fork commits pending from `origin/main`: **0**
- Whole-tree diff for the upstream half matched the two commits' stats **exactly** (1239+/481− over
  10 files), so no fork content was lost in the rebase

## Rolling State

- `upstreamTargetHead`: `a6d43828f6cc23e7b0c58f5ece8fa44335889bfb`
- `integratedForkHead`: `9ef3f0a66a4289d69ae9b2a6884cb37d86c084de` (= `origin/main`)
- The fork sync was **hand-applied**: `upstream-sync-fork-main` threw at each of the three commits
  (it cannot auto-apply across the rolling-only renames) and `integratedForkHead` was advanced
  manually per commit, with an `appendHistory` entry recording it.

## Landing

Not a cutover cycle: upstream has released no new tag. The branch stays off `main`.
