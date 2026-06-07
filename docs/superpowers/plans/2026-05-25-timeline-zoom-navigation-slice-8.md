# Timeline Zoom Navigation Slice 8 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove and, if necessary, complete zoom activation for every non-Photos mobile timeline route.

**Architecture:** Slice 6 introduced route-local zoom anchors through `TimelineRouteScope`, and Slice 7 made route-local timeline services rebuild when grouping changes. This slice adds a route-family matrix that verifies album, space, person, favorites, archive, locked, trash, video, place, partner, recently taken, and local timelines keep their route-owned constraints while card activation changes grouping and anchors only. Existing selection/read-only route tests remain the guard for timelines that intentionally force detailed/day mode and do not expose overview activation.

**Tech Stack:** Flutter widget tests, hooks_riverpod, Drift in-memory `StoreService`, existing mobile timeline route widgets and providers.

---

## Files

- Modify: `mobile/test/presentation/pages/timeline_route_adoption_test.dart`
  - Add a route-family matrix that simulates every adopted non-Photos route through `TimelineRouteScope`.
  - Assert route constraints are unchanged after year and month bucket activation.
  - Assert activation updates grouping and zoom anchors without writing `TimelineTemporalScope`.
  - Assert the grouping header does not render year/month temporal chips from activation.
- Modify only if tests fail for a real product gap:
  - `mobile/lib/presentation/widgets/timeline/timeline_route_scope.dart`
  - One or more route pages under `mobile/lib/presentation/pages/` or `mobile/lib/pages/library/spaces/space_detail.page.dart`
- Existing selection/read-only coverage to run:
  - `mobile/test/presentation/pages/drift_asset_selection_timeline_page_test.dart`
  - `mobile/test/presentation/widgets/bottom_sheet/map_bottom_sheet_timeline_test.dart`
  - `mobile/test/presentation/pages/cleanup_preview_page_test.dart`

## Acceptance Coverage

- Albums: route matrix case `remote album`.
- Spaces: route matrix case `space`.
- People: route matrix case `person`.
- Favorites: route matrix case `favorites`.
- Archive: route matrix case `archive`.
- Locked: route matrix case `locked folder`.
- Trash: route matrix case `trash`.
- Videos: route matrix case `videos`.
- Places: route matrix case `place`.
- Partners: route matrix case `partner`.
- Recently taken: route matrix case `recently taken`.
- Local timelines: route matrix case `local album`.
- Route-owned constraints remain intact: every route matrix case records the same constraint string before and after year/month activation.
- Route-local temporal chips created solely by activation are removed: the matrix checks `TimelineTemporalScope.none()` and no `2025` or `Mar 2025` chip text in `TimelineGroupingHeaderSliver`.
- Selection/read-only routes prevent accidental overview activation: existing forced-day/read-only tests stay in the final verification command.

## TDD Notes For This Slice

The implementation may already pass because Slice 6 migrated routes to `TimelineRouteScope` and Slice 7 made grouping changes rebuild route-local services. If a new test passes immediately, keep it as regression coverage and do not invent production changes. If a test fails, first identify whether the route is missing `TimelineRouteScope`, missing `TimelineGroupingHeaderSliver`, mutating `TimelineTemporalScope`, or failing to rebuild on grouping changes; then make only that minimal production change.

## Task 1: Shared Route Family Matrix

**Files:**

- Modify: `mobile/test/presentation/pages/timeline_route_adoption_test.dart`
- Modify only on test failure: `mobile/lib/presentation/widgets/timeline/timeline_route_scope.dart` or the specific missing route page.

- [ ] **Step 1: Add route matrix helpers**

In `mobile/test/presentation/pages/timeline_route_adoption_test.dart`, add the missing store-model import:

```dart
import 'package:immich_mobile/domain/models/store.model.dart';
```

Then add these helpers above `void main()`:

```dart
TimelineService _emptyService(TimelineOrigin origin) {
  return TimelineService((
    bucketSource: () => const Stream<List<Bucket>>.empty(),
    assetSource: (offset, count) async => const <BaseAsset>[],
    origin: origin,
  ));
}

class _AdoptedRouteCase {
  const _AdoptedRouteCase({
    required this.label,
    required this.constraint,
    required this.origin,
  });

  final String label;
  final String constraint;
  final TimelineOrigin origin;
}

class _ObservedRouteCall {
  const _ObservedRouteCall({
    required this.constraint,
    required this.scope,
    required this.groupBy,
  });

  final String constraint;
  final TimelineTemporalScope scope;
  final GroupAssetsBy groupBy;
}

const _adoptedRouteCases = [
  _AdoptedRouteCase(label: 'remote album', constraint: 'album:album-1', origin: TimelineOrigin.remoteAlbum),
  _AdoptedRouteCase(label: 'space', constraint: 'space:space-1', origin: TimelineOrigin.remoteSpace),
  _AdoptedRouteCase(label: 'person', constraint: 'person:person-1', origin: TimelineOrigin.person),
  _AdoptedRouteCase(label: 'favorites', constraint: 'favorite:true', origin: TimelineOrigin.favorite),
  _AdoptedRouteCase(label: 'archive', constraint: 'archive:true', origin: TimelineOrigin.archive),
  _AdoptedRouteCase(label: 'locked folder', constraint: 'locked:true', origin: TimelineOrigin.lockedFolder),
  _AdoptedRouteCase(label: 'trash', constraint: 'trash:true', origin: TimelineOrigin.trash),
  _AdoptedRouteCase(label: 'videos', constraint: 'media:video', origin: TimelineOrigin.video),
  _AdoptedRouteCase(label: 'place', constraint: 'place:Paris', origin: TimelineOrigin.place),
  _AdoptedRouteCase(label: 'partner', constraint: 'partner:user-2', origin: TimelineOrigin.remoteAssets),
  _AdoptedRouteCase(label: 'recently taken', constraint: 'remote-assets:user-1', origin: TimelineOrigin.remoteAssets),
  _AdoptedRouteCase(label: 'local album', constraint: 'local-album:local-1', origin: TimelineOrigin.localAlbum),
];

GroupAssetsBy _storedGroupBy() {
  return GroupAssetsBy.values[Store.get(StoreKey.groupAssetsBy, GroupAssetsBy.day.index)];
}
```

- [ ] **Step 2: Add the route-family zoom test**

Inside the existing `group('adopted timeline route contracts', () { ... })`, add this test loop after the current top-sliver height assertions:

```dart
for (final route in _adoptedRouteCases) {
  testWidgets('${route.label} keeps route constraints during year and month zoom', (tester) async {
    await Store.put(StoreKey.groupAssetsBy, GroupAssetsBy.year.index);
    final calls = <_ObservedRouteCall>[];

    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          home: TimelineRouteScope(
            timelineServiceBuilder: (ref, scope) {
              calls.add(
                _ObservedRouteCall(
                  constraint: route.constraint,
                  scope: scope,
                  groupBy: _storedGroupBy(),
                ),
              );
              return _emptyService(route.origin);
            },
            child: const CustomScrollView(slivers: [TimelineGroupingHeaderSliver()]),
          ),
        ),
      ),
    );

    final ref = ProviderScope.containerOf(tester.element(find.byType(TimelineGroupingHeaderSliver)));
    ref.read(timelineServiceProvider);

    expect(calls.single.constraint, route.constraint);
    expect(calls.single.scope, const TimelineTemporalScope.none());
    expect(calls.single.groupBy, GroupAssetsBy.year);
    expect(find.byType(TimelineGroupingSelector), findsOneWidget);

    calls.clear();
    await tester.runAsync(
      () async => ref
          .read(timelineOverviewDrilldownProvider)
          ?.call(TimeBucket(date: DateTime(2025), assetCount: 3), GroupAssetsBy.year),
    );
    ref.read(timelineServiceProvider);
    await tester.pump();

    expect(Store.get(StoreKey.groupAssetsBy), GroupAssetsBy.month.index);
    expect(calls.single.constraint, route.constraint);
    expect(calls.single.scope, const TimelineTemporalScope.none());
    expect(calls.single.groupBy, GroupAssetsBy.month);
    expect(ref.read(timelineZoomAnchorProvider), const TimelineZoomAnchor.year(2025));
    expect(find.text('2025'), findsNothing);

    calls.clear();
    await tester.runAsync(
      () async => ref
          .read(timelineOverviewDrilldownProvider)
          ?.call(TimeBucket(date: DateTime(2025, 3), assetCount: 3), GroupAssetsBy.month),
    );
    ref.read(timelineServiceProvider);
    await tester.pump();

    expect(Store.get(StoreKey.groupAssetsBy), GroupAssetsBy.day.index);
    expect(calls.single.constraint, route.constraint);
    expect(calls.single.scope, const TimelineTemporalScope.none());
    expect(calls.single.groupBy, GroupAssetsBy.day);
    expect(ref.read(timelineZoomAnchorProvider), TimelineZoomAnchor.month(year: 2025, month: 3));
    expect(find.text('Mar 2025'), findsNothing);
  });
}
```

- [ ] **Step 3: Run the route adoption test before production edits**

Run:

```bash
cd mobile && flutter test test/presentation/pages/timeline_route_adoption_test.dart -r expanded
```

Expected result on the current Slice 7 baseline:

- The new route matrix may pass immediately because every listed route already uses `TimelineRouteScope` and route-local anchors.
- If a route matrix case fails because `calls` is empty or not rebuilt after grouping changes, fix `TimelineRouteScope` to watch the grouping setting.
- If a real route is missing `TimelineRouteScope` or `TimelineGroupingHeaderSliver`, update that route page and rerun.
- If any case records a non-empty `TimelineTemporalScope`, remove the activation path that writes temporal scope.

## Task 2: Selection And Read-Only Regression Guard

**Files:**

- No new production files expected.
- Existing tests:
  - `mobile/test/presentation/pages/drift_asset_selection_timeline_page_test.dart`
  - `mobile/test/presentation/widgets/bottom_sheet/map_bottom_sheet_timeline_test.dart`
  - `mobile/test/presentation/pages/cleanup_preview_page_test.dart`

- [ ] **Step 1: Run forced detailed/read-only tests**

Run:

```bash
cd mobile && flutter test test/presentation/pages/drift_asset_selection_timeline_page_test.dart test/presentation/widgets/bottom_sheet/map_bottom_sheet_timeline_test.dart test/presentation/pages/cleanup_preview_page_test.dart -r expanded
```

Expected result:

- `DriftAssetSelectionTimelinePage` still calls `TimelineFactory.remoteAssets(..., groupBy: GroupAssetsBy.day)` and renders `Timeline(groupBy: GroupAssetsBy.day)`.
- `MapBottomSheetTimeline` still calls `TimelineFactory.map(..., groupBy: GroupAssetsBy.day)` and renders `Timeline(groupBy: GroupAssetsBy.day)`.
- `CleanupPreviewPage` still renders a read-only `Timeline(groupBy: GroupAssetsBy.day)` without `TimelineGroupingHeaderSliver`.

- [ ] **Step 2: Fix only if a regression is exposed**

If any forced detailed/read-only test fails:

- Restore the forced `GroupAssetsBy.day` value in the affected route.
- Keep `TimelineGroupingHeaderSliver` out of read-only/selection-only flows.
- Do not add overview drilldown handlers to forced detailed/read-only flows.

## Task 3: Commit Slice 8

- [ ] **Step 1: Format and run focused tests**

Run:

```bash
cd mobile && dart format test/presentation/pages/timeline_route_adoption_test.dart
cd mobile && flutter test test/presentation/pages/timeline_route_adoption_test.dart test/presentation/widgets/timeline/timeline_route_scope_test.dart test/presentation/pages/drift_asset_selection_timeline_page_test.dart test/presentation/widgets/bottom_sheet/map_bottom_sheet_timeline_test.dart test/presentation/pages/cleanup_preview_page_test.dart -r expanded
```

Expected result:

- Route matrix tests pass for every adopted non-Photos route.
- Route scope tests still pass, including route-local scope and anchor isolation.
- Forced detailed/read-only route tests pass.

- [ ] **Step 2: Analyze changed tests and shared route code**

Run:

```bash
cd mobile && flutter analyze test/presentation/pages/timeline_route_adoption_test.dart test/presentation/widgets/timeline/timeline_route_scope_test.dart lib/presentation/widgets/timeline/timeline_route_scope.dart
```

Expected result:

- No analyzer issues.

- [ ] **Step 3: Commit and push**

If this slice is test-only:

```bash
git add mobile/test/presentation/pages/timeline_route_adoption_test.dart
git commit -m "test(mobile): cover shared route zoom contracts"
git push
```

If production changes were required:

```bash
git add mobile/lib/presentation/widgets/timeline/timeline_route_scope.dart mobile/lib/presentation/pages mobile/lib/pages/library/spaces/space_detail.page.dart mobile/test/presentation/pages/timeline_route_adoption_test.dart
git commit -m "feat(mobile): apply shared route zoom contracts"
git push
```

## Self-Review

- Spec coverage: every Slice 8 named route family is represented in `_adoptedRouteCases`; selection/read-only surfaces are covered by existing forced-day/read-only tests in Task 2.
- TDD coverage: Task 1 adds the focused route-family test before production edits; Task 2 reruns existing regression tests for forced detailed/read-only routes.
- Placeholder scan: no TODO/TBD/fill-in language remains in executable steps.
- Type consistency: helper types use existing `TimelineOrigin`, `TimelineService`, `Bucket`, `BaseAsset`, `TimelineTemporalScope`, `GroupAssetsBy`, `TimelineZoomAnchor`, `Store`, and the newly imported `StoreKey`.
