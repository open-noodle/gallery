# Grouping Bottom Pill — Slice 4 Implementation Plan (remaining 9 pages + header deletion)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the remaining 9 timeline pages to `withGroupingPill: true` and **delete** `TimelineGroupingHeaderSliver` + `kTimelineGroupingHeaderSliverHeight` (+ retire its widget test). The deletion makes the migration compiler-enforced.

**Spec:** `docs/superpowers/specs/2026-06-10-timeline-grouping-bottom-pill-design.md` (Slice 4). Depends on Slices 1–3 (landed: `8cfcabd1b5`, `3af5c4d263`, `e08652ae8f`).

---

### Task 1: Migrate the 7 simple pages

**Files (each has the identical pattern: const at top, header-only `topSliverWidget`):**

- `mobile/lib/presentation/pages/drift_person.page.dart` (const ~22, Timeline ~90)
- `mobile/lib/presentation/pages/drift_video.page.dart` (~17, ~32)
- `mobile/lib/presentation/pages/drift_locked_folder.page.dart` (~19, ~65)
- `mobile/lib/presentation/pages/drift_recently_taken.page.dart` (~16, ~30)
- `mobile/lib/presentation/pages/drift_place_detail.page.dart` (~18, ~32)
- `mobile/lib/presentation/pages/drift_archive.page.dart` (~17, ~31)
- `mobile/lib/presentation/pages/local_timeline.page.dart` (~18, ~26)

- [ ] For each: delete the `static const timelineOverviewTopSliverHeight = kTimelineGroupingHeaderSliverHeight;` line, delete `topSliverWidget: const TimelineGroupingHeaderSliver(),` and `topSliverWidgetHeight: <Page>.timelineOverviewTopSliverHeight,`, add `withGroupingPill: true,` to the `Timeline(`, and remove the now-unused `timeline_grouping_header_sliver.widget.dart` import (and `constants` import if it becomes unused). Exactly the Slice 3 album-page pattern (`git show e08652ae8f -- mobile/lib/presentation/pages/drift_remote_album.page.dart` is the reference diff).

### Task 2: Migrate the 2 composed pages (keep their extra slivers)

- [ ] **`mobile/lib/presentation/pages/drift_partner_detail.page.dart`** (const ~24: `kTimelineGroupingHeaderSliverHeight + 110`; Timeline ~33: `SliverMainAxisGroup(slivers: [TimelineGroupingHeaderSliver(), <other sliver(s)>])`): remove the header from the group (if only ONE other sliver remains, unwrap the `SliverMainAxisGroup` to that sliver directly); const becomes `110` (rename to describe what it now measures, e.g. `partnerHeaderTopSliverHeight`, and update the call site + any test references); add `withGroupingPill: true`.
- [ ] **`mobile/lib/presentation/pages/drift_trash.page.dart`** (const ~19: `+ 24`; Timeline ~41): same treatment; const becomes `24` (rename appropriately).
- [ ] Read each page's remaining sliver to pick an accurate const name; keep behavior identical for the kept slivers.

### Task 3: Delete the header widget + retire its test

- [ ] Delete `mobile/lib/presentation/widgets/timeline/timeline_grouping_header_sliver.widget.dart`.
- [ ] Delete `mobile/test/presentation/widgets/timeline/timeline_grouping_header_sliver_test.dart` (its three behaviors are superseded: render → pill render tests, Slice 1; multiselect-hide → pill multiselect tests, Slice 1/2).
- [ ] `grep -rn "TimelineGroupingHeaderSliver\|kTimelineGroupingHeaderSliverHeight" mobile/` must return ZERO production/test hits afterward (compiler enforces production; grep catches comments/docs — clean those too).

### Task 4: Update `timeline_route_adoption_test.dart`

- [ ] `mobile/test/presentation/pages/timeline_route_adoption_test.dart` asserts the 9 pages' `timelineOverviewTopSliverHeight` consts (person, local, archive, locked, video, recently-taken, place, trash `+24`, partner `+110`). Update in the same style Slice 3 used for the migrated trio: drop the assertions for deleted consts; for partner/trash assert the renamed banner-only consts (`110`/`24`). If the adoption test asserts `topSliverWidget` wiring or pill adoption patterns, extend them consistently (read the whole file first; keep its 15-test structure meaningful, don't gut it).

### Task 5: Verify + gates + commit

- [ ] **TDD note (mechanical slice):** the deletion IS the red lever — after Task 3, any missed reference fails to compile. Run the full targeted set:
      `~/.local/share/mise/installs/flutter/3.41.7/bin/flutter test test/presentation/pages/ test/presentation/widgets/timeline/` → all pass.
- [ ] `~/.local/share/mise/installs/flutter/3.41.7/bin/dart analyze --fatal-infos lib test` → `No issues found!` (catches unused imports left by the migrations).
- [ ] `~/.local/share/mise/installs/flutter/3.41.7/bin/dart format --set-exit-if-changed <touched files>` → 0 changed.
- [ ] Commit: `git add -A mobile && git commit -m "feat(mobile): grouping bottom pill on all detail timelines; delete scrolls-away header"`

Report SHA, the zero-grep evidence, test/analyze/format output, files changed, deviations.
