# Grouping Bottom Pill — Slice 3 Implementation Plan (album / space / favorites migration)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the three representative pages (remote album, space detail, favorites) from the scrolls-away `TimelineGroupingHeaderSliver` to `withGroupingPill: true`, guarded by the bug's RED regression test (selector still visible after deep scroll on the album page).

**Spec:** `docs/superpowers/specs/2026-06-10-timeline-grouping-bottom-pill-design.md` (Slice 3). Depends on Slices 1+2 (landed: `8cfcabd1b5`, `3af5c4d263`).

**Verified page facts (false alarm corrected):** each page has exactly ONE `Timeline(` constructor — earlier "3/4 call sites" were grep hits on `_toggleTimeline(`/`updateMemberTimeline(`. Current state:

- `mobile/lib/presentation/pages/drift_remote_album.page.dart`: const at line ~32 (`timelineOverviewTopSliverHeight = kTimelineGroupingHeaderSliverHeight`), `Timeline(topSliverWidget: const TimelineGroupingHeaderSliver(), topSliverWidgetHeight: ...)` at ~188.
- `mobile/lib/pages/library/spaces/space_detail.page.dart`: helper at ~34 (`kTimelineGroupingHeaderSliverHeight + (isRemoteSyncing ? kSyncStatusBannerSliverHeight : 0)`), `Timeline(topSliverWidget: const SliverMainAxisGroup(slivers: [TimelineGroupingHeaderSliver(), SyncStatusBannerSliver()]), ...)` at ~291. **The `SyncStatusBannerSliver` must stay.**
- `mobile/lib/presentation/pages/drift_favorite.page.dart`: const at ~17, `Timeline(topSliverWidget: const TimelineGroupingHeaderSliver(), ...)` at ~30.

---

### Task 1: RED — album-page scroll-persistence regression test

**Files:**

- Create: `mobile/test/presentation/pages/drift_remote_album_page_test.dart`

This is the bug's guard. Pump the REAL `RemoteAlbumPage` (constructor takes `required RemoteAlbum album`). Harness: reuse `main_timeline_zoom_test.dart` patterns — `setUpAll` (TestUtils.init, SharedPreferences mock, EasyLocalization.ensureInitialized, in-memory Drift + StoreService.init), `Store.put(StoreKey.tilesPerRow, 3)`, `_StubCurrentUserNotifier` for `currentUserProvider`, a mocktail `TimelineFactory` whose `remoteAlbum(albumId: any, groupBy: any?, temporalScope: any)` returns a fake `TimelineService` (use the zoom test's `_service(...)` helper style; give it day buckets with enough assets to scroll, e.g. 6 × `TimeBucket(date: DateTime(2026, 6, X), assetCount: 12)`). Size the fixture so content height comfortably exceeds the fling distance (more buckets/assets if needed — verify `maxScrollExtent > 0` after the fling, or scroll with `scrollUntilVisible`/`jumpTo(maxScrollExtent)` instead of a fixed fling). Build a `RemoteAlbum` fixture (find the model's constructor under `mobile/lib/domain/models/album/` and fill required fields). Page is pumped inside `ProviderScope(overrides: [...]) > MaterialApp/EasyLocalization wrapper > RemoteAlbumPage(album: fixture)`.

The page's `RemoteAlbumSliverAppBar` may demand additional providers — stub each one it throws about (the error names the provider). If it proves genuinely intractable after a real attempt, STOP and report BLOCKED with the provider list (do not fake the page with a bare Timeline).

- [ ] **Step 1: Write the test** with these cases:

```dart
testWidgets('grouping selector stays visible after scrolling deep (bottom pill)', (tester) async {
  await pumpAlbumPage(tester);
  // Selector visible at top.
  expect(find.byKey(const Key('timeline-grouping-selector')), findsOneWidget);

  // Scroll far down.
  final scrollable = find.byType(Scrollable).first;
  await tester.fling(scrollable, const Offset(0, -3000), 4000);
  await tester.pumpAndSettle();

  // THE regression guard: still visible (was RED with the scrolls-away header).
  expect(find.byKey(const Key('timeline-grouping-selector')), findsOneWidget);
  expect(find.byKey(const Key('timeline-grouping-bottom-pill')), findsOneWidget);
});

testWidgets('header sliver is gone from the album page', (tester) async {
  await pumpAlbumPage(tester);
  expect(find.byKey(const Key('timeline-grouping-header-sliver')), findsNothing);
});
```

- [ ] **Step 2: Run to verify RED**

`~/.local/share/mise/installs/flutter/3.41.7/bin/flutter test test/presentation/pages/drift_remote_album_page_test.dart` (from `mobile/`).
Expected: test 1 FAILS at the post-scroll assertion (header scrolled away → selector unmounted) and test 2 FAILS (header sliver present). Capture output as RED evidence. (If test 1 also finds the selector before migration at the top — that's fine, the post-scroll assert is the RED.)

### Task 2: GREEN — migrate the album page

**Files:**

- Modify: `mobile/lib/presentation/pages/drift_remote_album.page.dart`

- [ ] Remove the `timelineOverviewTopSliverHeight` static const and the `TimelineGroupingHeaderSliver`/`kTimelineGroupingHeaderSliverHeight` imports; change the Timeline construction:

```dart
      child: Timeline(
        withGroupingPill: true,
        appBar: RemoteAlbumSliverAppBar(
        ...
```

(`topSliverWidget`/`topSliverWidgetHeight` dropped entirely.)

- [ ] Re-run Task 1's file → both tests GREEN.

### Task 3: migrate favorites + space detail

**Files:**

- Modify: `mobile/lib/presentation/pages/drift_favorite.page.dart` — same mechanical change as the album page.
- Modify: `mobile/lib/pages/library/spaces/space_detail.page.dart` — **keep the sync banner**:

```dart
      child: Timeline(
        withGroupingPill: true,
        topSliverWidget: const SyncStatusBannerSliver(),
        topSliverWidgetHeight: SpaceDetailPage.timelineOverviewTopSliverHeight(isRemoteSyncing: isRemoteSyncing),
```

and the helper becomes banner-only:

```dart
  static double timelineOverviewTopSliverHeight({required bool isRemoteSyncing}) =>
      isRemoteSyncing ? kSyncStatusBannerSliverHeight : 0;
```

(If the name now reads oddly, rename to `syncBannerTopSliverHeight` and update the call site — keep it a pure rename.)

- [ ] **Favorites page test** — create `mobile/test/presentation/pages/drift_favorite_page_test.dart` (the page is tiny: `TimelineRouteScope(timelineServiceBuilder: factory.favorite(...))` + Timeline): pump the real page with the mock factory; assert pill present, header-sliver key absent, and **grouping switch regroups**: tap `Key('timeline-grouping-month')` in the pill → `Store.get(StoreKey.groupAssetsBy) == GroupAssetsBy.month.index` and overview cards render (model the factory on the zoom test's `_factoryForServices`, which returns day/month/year services per the current Store value — month service buckets → expect `find.byType(TimelineOverviewCard)` non-empty after settle).
- [ ] **Space detail**: attempt a minimal pump test (pill present + `SyncStatusBannerSliver` still in the tree + header key absent). The space page has a heavier provider graph (space membership, sync status); stub what it names. If genuinely intractable after a real attempt, document the blocker in the report and rely on: compile (header deletion in Slice 4), the migrated code, and Slice 5's full-suite run — but say so explicitly (DONE_WITH_CONCERNS).
- [ ] **Last-row reachability (album test, add to Task 1's file):** scroll to `maxScrollExtent`, then assert the bottom-most asset tile's rect bottom ≤ the pill container's rect top (`tester.getRect(...)`); tolerance ±1.

### Task 4: Gates + commit

- [ ] `~/.local/share/mise/installs/flutter/3.41.7/bin/flutter test test/presentation/pages/drift_remote_album_page_test.dart test/presentation/pages/drift_favorite_page_test.dart <space test if created> test/presentation/widgets/timeline/` → all pass.
- [ ] `~/.local/share/mise/installs/flutter/3.41.7/bin/dart analyze --fatal-infos lib test` → `No issues found!`; format check on touched files → 0 changed.
- [ ] Commit: `git add -A mobile && git commit -m "feat(mobile): always-visible grouping pill on album, space, and favorites timelines"`

Report SHA + RED/GREEN evidence (the Task 1 RED output is mandatory).
