# Upstream Sync Report — 2026-08-02 (second cycle, fork-only)

## Summary

- **Upstream commits pulled**: 0 — `upstream/main` unchanged at `cafd6c7c0f1`
- **Fork commits synced**: 6 (`78d1223a289..53f414ab79f`, PRs #920 #911 #905 #904 #886 #906)
- **Conflicts resolved**: 2 commits (#911, #886), 5 hunks total
- **Risk level**: LOW as landed — the branch is green; the break it briefly carried is fixed both here and on `main`
- **Recommendation**: PROCEED

This is the second fork-sync-only cycle in a row. `make upstream-rolling-status` reported
`Completed upstream batches: 45 / 45` and `Fork commits pending: 5`, so there was no batch plan, no
rebase, and the per-batch product-direction gate had nothing to weigh.

**#906 landed on `origin/main` mid-cycle** (after the first five were already applied here) and was
cherry-picked on top, so the branch ends level with `origin/main` @ `53f414ab79f`.

## ★★ Headline finding — `origin/main` briefly did not compile (pre-existing, not caused by this sync)

Two fork PRs merged to `main` in sequence collide semantically without overlapping textually, so git
merged both cleanly and the result does not build:

- **#911** (`fix(mobile): restore the Photo Grid "Group by" setting`) renamed
  `timelineGroupingProvider` → `timelineOverviewModeProvider` and retyped
  `TimelineOverviewSegment.groupBy: GroupAssetsBy` → `.mode: TimelineOverviewMode`.
- **#886** (`fix(mobile): land memory "view in timeline" on the actual photo`) added new
  scroll-drain code written against the **old** names.

`#886` touches lines `#911` never touched, so there was no conflict to resolve and nothing flagged it.

Confirmed on `origin/main` @ `546022c4de6`, not inferred:

| Workflow                              | Conclusion  |
| ------------------------------------- | ----------- |
| Static Code Analysis                  | **failure** |
| Gallery Build Mobile                  | **failure** |
| Docker / CodeQL / Zizmor / Docs build | success     |

`main`'s own failure log lists exactly three errors:

```
error - lib/presentation/widgets/timeline/timeline.widget.dart:480:30 - Undefined name 'timelineGroupingProvider'
error - test/.../scroll_drain_test.dart:208:47 - The named parameter 'mode' is required, but there's no corresponding argument
error - test/.../scroll_drain_test.dart:215:3 - The named parameter 'groupBy' isn't defined
```

The same three reproduced here after the cherry-picks (at line 482 rather than 480 — a two-line
offset from this branch's extra content), and were reconciled here in `7f93dc18808`.

### ★ Resolved on `main` by #906 — and the two fixes converged independently

While this cycle was running, **#906** landed on `origin/main` carrying the fork's own fix for the
same collision. It is **character-identical** to the reconciliation already applied here:

| Site                     | #906                                                                                        | `7f93dc18808` (this branch) |
| ------------------------ | ------------------------------------------------------------------------------------------- | --------------------------- |
| `timeline.widget.dart`   | `unawaited(ref.read(timelineOverviewModeProvider.notifier).set(TimelineOverviewMode.all));` | identical                   |
| `scroll_drain_test.dart` | `mode: TimelineOverviewMode.years,`                                                         | identical                   |
| `scroll_drain_test.dart` | `import '.../timeline_grouping.model.dart';`                                                | identical                   |

Because both sides made the same edit, cherry-picking #906 onto this branch produced **no conflict**.
That convergence is also the strongest available evidence that the resolution matched the
maintainer's intent rather than merely compiling: it was derived here from
`overview_drilldown.provider.dart`'s canonical drill-to-grid step, and #906 chose the same form
independently.

`main` is therefore no longer red for this reason, and **no port from this branch is needed**. #906
does not include the `cast_nullable_to_non_nullable` fix, which remains rolling-only because the rule
is not enabled on `main`.

## Incoming Fork Changes

| SHA (origin)  | Summary                                                                        | Area   | Conflicts   | Notes                                                |
| ------------- | ------------------------------------------------------------------------------ | ------ | ----------- | ---------------------------------------------------- |
| `1bf400817cf` | keep the bottom nav inside the screen on narrow phones (#909) (#920)           | mobile | none        | clean                                                |
| `49c647f15af` | restore the Photo Grid "Group by" setting (#903) (#911)                        | mobile | **3 hunks** | import ordering + `unawaited()`                      |
| `c7662d5ae33` | show a loader while a filtered search is in flight (#901) (#905)               | mobile | none        | clean                                                |
| `cea1ddb6910` | restore iOS swipe-back on the Spaces page (#899) (#904)                        | mobile | none        | clean                                                |
| `546022c4de6` | land memory "view in timeline" on the actual photo (#822) (#886)               | mobile | **2 hunks** | action-model + scroll rewrite                        |
| `53f414ab79f` | start each search at Relevance and hide memories while filtering (#902) (#906) | mobile | none        | landed mid-cycle; carries `main`'s own collision fix |

Whole-cycle scope: **mobile + docs only**. No server, web, e2e, ML, CI, or migration surface — so
those suites carry no risk from this delta.

## The sync script rolled back; commits were hand-applied

`make upstream-sync-fork-main` is all-or-nothing: it hit the #911 conflict, `reset --hard`ed the
whole batch and threw. The rollback completed cleanly this time (HEAD restored to `09ff7b845c9`, no
cherry-pick state, `integratedForkHead` untouched) — unlike arc 5, where a stale `MERGE_RR.lock`
blocked it.

The 5 commits were then cherry-picked individually. `git range-diff 78d1223a289..546022c4de6
09ff7b845c9..HEAD` reports **3 of 5 byte-identical (`=`)** and 2 differing (`!`) — exactly the two
with conflicts, and the diffs contain only the documented resolutions.

`integratedForkHead` was advanced by hand to `546022c4de6` and an `appendHistory` entry recording
the hand-application was appended, since the script never reached its finalize step.

## Conflict Resolutions

### #911 — `timeline_grouping_bottom_pill_test.dart` (imports)

- **Fork side (main)**: adds `hooks_riverpod`, `timeline_grouping.model.dart`,
  `timeline_grouping.provider.dart` in unsorted positions.
- **Rolling side**: the same import block, alphabetically sorted.
- **Resolution**: take #911's imports, placed in sorted order; dedupe `timeline.model.dart`.
- **Why**: this branch enables `directives_ordering: true` (from an upstream Dart lint batch);
  `origin/main` does **not**. Unsorted imports fail `dart analyze --fatal-infos` here.
- **Risk**: LOW — verified by `dart analyze` clean.

### #911 — `timeline_route_scope_test.dart` (`unawaited` + retype)

- **Fork side**: `handler?.call(..., TimelineOverviewMode.years)` — the retype.
- **Rolling side**: `unawaited(handler?.call(..., GroupAssetsBy.year))` — the `discarded_futures` sweep.
- **Resolution**: **combined both** — `unawaited(handler?.call(..., TimelineOverviewMode.years))`.
- **Risk**: LOW. Taking either side alone would have silently dropped the other's work.

### #911 — `asset_list_group_settings_test.dart` (imports)

Both sides added a different import at the same position (`easy_localization` vs `flutter/material`).
Resolved as the **union**, sorted. Risk: LOW.

### #886 — `action_button.utils.dart` (imports)

- **Rolling side**: only `scroll_to_date_notifier.provider.dart` — upstream's action-model migration
  removed the 16 `action_buttons/*.widget.dart` imports that `main` still carries.
- **Fork side**: those 16 imports, with `scroll_to_date` → `scroll_to_asset`.
- **Resolution**: keep the rolling branch's minimal import set and apply #886's real delta only
  (`scroll_to_date` → `scroll_to_asset`). Net effect on this branch is **2 lines**.
- **Verification**: the fork's `viewInTimeline` still routes to `MainTimelineRoute()` — arc 5's
  standing divergence #3 is preserved, now upgraded from date-based to asset-based scrolling.
- **Risk**: LOW — `dart analyze` confirms no import was dropped that surviving code still needs.

### #886 — `timeline.widget.dart` (scroll animation)

- **Rolling side**: `unawaited(_scrollController.animateTo(...).whenComplete(...))` — the lint sweep.
- **Fork side**: a full rewrite to `await` inside `try/catch/finally` with a generation guard and a
  highlight call.
- **Resolution**: took **#886's side wholesale**.
- **Why this is safe rather than a lint regression**: the enclosing method is
  `Future<void> _beginScrollToAsset(...) async` (so `await` is legal) and its only caller is
  `unawaited(_beginScrollToAsset(target!, segments!))` at line 467. #886's own comment states it
  runs under `unawaited()`. The outer `unawaited` already satisfies `discarded_futures`, so the
  inner wrapper is superseded, not lost. Verified by `dart analyze --fatal-infos` clean.
- **Risk**: LOW.

## Fixes applied on top (`7f93dc18808`)

| Fix                                                                                                              | Origin                          | Present on `main`?                     |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------- | -------------------------------------- |
| `timelineGroupingProvider.set(GroupAssetsBy.day)` → `timelineOverviewModeProvider.set(TimelineOverviewMode.all)` | #886×#911 collision             | was red; **fixed by #906 identically** |
| `TimelineOverviewSegment(groupBy:)` → `(mode:)` in `scroll_drain_test.dart`                                      | #886×#911 collision             | was red; **fixed by #906 identically** |
| `notifier.value?.asset as RemoteAsset` → `value!`                                                                | `cast_nullable_to_non_nullable` | No — rule not enabled on `main`        |

The first fix follows #911's own design vocabulary rather than a guess: `overview_drilldown.provider.dart`
performs the equivalent drill-to-grid step as
`await ref.read(timelineOverviewModeProvider.notifier).set(TimelineOverviewMode.all)`.

## Toolchain drift confirmed again

Both #911 conflicts and one of the three fixes come from the documented class: **the rolling branch's
toolchain is ahead of `main`'s**. Rules enabled here and not on `main`:

- `directives_ordering: true` — caused the import conflicts
- `cast_nullable_to_non_nullable: true` — caused the third fix

This is the fourth occurrence (after #826/unicorn-v72, #810/`prefer-string-repeat`, and the arc-1
`discarded_futures` sweep). It remains the reason a clean fork sync still needs a full re-dispatch.

## Local Verification

| Check                                     | Status   | Notes                                               |
| ----------------------------------------- | -------- | --------------------------------------------------- |
| `dart analyze --fatal-infos lib test`     | **PASS** | `No issues found!` (re-run after #906)              |
| `dart format` gate (lib, excl. generated) | **PASS** | `Formatted 792 files (0 changed)`                   |
| `flutter test` (full mobile suite)        | **PASS** | **3122 passed, 1 skipped** (after #906)             |
| `make fork-ownership-coverage-check`      | **PASS** | covers 3223 fork files                              |
| `make ci-invariants-check`                | **PASS** | no-push-o-matic, image names, docs-deploy           |
| `make fork-patches-check`                 | **PASS** | `@immich/ui` patch consistent                       |
| `pubspec.yaml` churn (arc-1 trap)         | CLEAN    | no stray `shared_preferences: any`                  |
| Server / web suites                       | not run  | zero server/web files in the delta (evidence above) |

Codegen was re-run before analyzing (`flutter pub get` + `build_runner`), because #904 changes
`router.dart`, which carries `part 'router.gr.dart'` and is gitignored on this branch since #888.

## Migrations

No migration files changed. `migrations-gallery/` count unchanged at **49**; the
`revert-to-immich.sql` coverage detector reports zero `MISSING`. No mobile Drift schema change —
`schemaVersion` and `drift_schemas/main/` untouched.

## Remote CI Verification

- **Test branch**: `rebase/upstream-forksync-20260802b`
- **Commit validated**: final tip (post-#906)

A first wave was dispatched on `7f93dc18808` before #906 landed. It returned
**Static Code Analysis: success** — the gate that had been red on `main`, confirming the
reconciliation — plus **Gallery Rebase Smoke: success**, and one **Docker: failure** that was the
documented unauthenticated-GitHub-API transient (`mise install github:extism/js-pdk@1.6.0` →
`403 API rate limit exceeded for <runner IP>` in the server plugins stage; unrelated to a
mobile-only delta — see the three-rate-limits table in the rolling memory). Since #906 moved the
branch, the full suite was re-dispatched on the new tip and that run is the gate of record.

| Workflow                                  | Status    |
| ----------------------------------------- | --------- |
| `test.yml`                                | see below |
| `docker.yml`                              | see below |
| `static_analysis.yml`                     | see below |
| `gallery-build-mobile.yml`                | see below |
| `gallery-rebase-smoke.yml`                | see below |
| `gallery-mobile-smoke.yml`                | see below |
| `gallery-ml-smoke.yml`                    | see below |
| `storage-migration-tests.yml`             | see below |
| `storage-migration-e2e.yml`               | see below |
| `gallery-revert-to-immich-validation.yml` | see below |

(Results recorded in the follow-up commit once the suite completes.)

## Branch state

- Level with `upstream/main` at `cafd6c7c0f1` (batches 45/45); **0 commits behind**
- Fork-synced through `53f414ab79f` (#906); **0 fork commits pending**
- **Still off `main`** — upstream has not tagged v3.1.1, so the standing rule applies
- Backup: `backup/rolling-pre-forksync-20260802b` @ `09ff7b845c9`
- `branding/config.json` `upstream.version` stays at **3.1.0** (v3.1.1 is not tagged)

## Follow-ups

1. **No port to `main` needed** — #906 already fixed the collision there, identically. Worth
   confirming `main`'s CI went green at `53f414ab79f`.
2. Consider why the #886/#911 collision reached `main` at all: both PRs were green individually, and
   neither was rebased onto the other before merge, so no gate ever compiled the combination. A
   required up-to-date-branch check, or making `Gallery Build Mobile` run on `pull_request` (its
   jobs are currently `if:`-gated false there), would have caught it. This is a **repeatable** hole,
   not a one-off: any two mobile PRs that rename/retype in one and consume in the other will do it
   again.
3. Carried over: the non-idempotent e2e upload retry (`e2e/vitest.config.ts` `retry: 4`).
