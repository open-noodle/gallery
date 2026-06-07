# Timeline Zoom Navigation Slice 6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce the shared mobile zoom-anchor model, route-local provider plumbing, and anchor scroll resolution so overview card activation can navigate without temporal filtering.

**Architecture:** Add a route-local `TimelineZoomAnchor` provider parallel to the existing route-local `TimelineTemporalScope`, then update the shared overview drilldown handler to change grouping and store anchors instead of writing temporal scope or emitting scroll-to-top events. `Timeline` resolves pending anchors after segment rebuilds with exact year/month matching and clears the anchor only after a successful scroll.

**Tech Stack:** Flutter, Dart 3 sealed classes, hooks_riverpod `NotifierProvider`, existing mobile timeline segment builders, Flutter widget tests.

---

## Files

- Create: `mobile/lib/domain/models/timeline_zoom_anchor.model.dart`
  - Defines `TimelineZoomAnchor.none/year/month` and validates month range.
- Create: `mobile/lib/providers/timeline/zoom_anchor.provider.dart`
  - Owns route-local pending zoom anchor state with `setYear`, `setMonth`, and `clear`.
- Create: `mobile/test/domain/models/timeline_zoom_anchor_test.dart`
  - Covers model equality, empty state, month validation, and year/month payloads.
- Create: `mobile/test/providers/timeline/zoom_anchor_provider_test.dart`
  - Covers provider default state and state transitions.
- Modify: `mobile/lib/presentation/widgets/timeline/timeline_route_scope.dart`
  - Overrides `timelineZoomAnchorProvider` for each timeline route subtree.
- Modify: `mobile/test/presentation/widgets/timeline/timeline_route_scope_test.dart`
  - Adds sibling route anchor isolation and updates the drilldown test so temporal scope remains unchanged.
- Modify: `mobile/lib/providers/timeline/overview_drilldown.provider.dart`
  - Changes shared activation from temporal filtering plus scroll-to-top to grouping plus zoom anchor.
- Modify: `mobile/test/providers/timeline/overview_drilldown_provider_test.dart`
  - Replaces temporal-scope and scroll event expectations with zoom-anchor expectations.
- Modify: `mobile/test/presentation/pages/timeline_route_adoption_test.dart`
  - Updates the generic route adoption contract so shared drilldown no longer rebuilds services from temporal scope.
- Modify: `mobile/lib/presentation/widgets/timeline/timeline_scroll_target.dart`
  - Adds exact zoom-anchor segment lookup without nearest-period fallback.
- Modify: `mobile/test/presentation/widgets/timeline/timeline_scroll_target_test.dart`
  - Adds helper tests for year/month anchor matching, stale grouping, missing target, and non-time buckets.
- Create: `mobile/test/presentation/widgets/timeline/timeline_zoom_anchor_resolution_test.dart`
  - Covers successful year/month scroll resolution, pending absent targets, and anchor clearing.
- Modify: `mobile/lib/presentation/widgets/timeline/timeline.widget.dart`
  - Watches pending zoom anchors in `_SliverTimeline`, schedules post-frame resolution, scrolls to exact target segments, and clears only after success.

## Acceptance Coverage

- A year anchor can scroll a month-grouped timeline to that year: Task 3 helper and widget tests.
- A month anchor can scroll a day-grouped timeline to that month: Task 3 helper and widget tests.
- Anchor state is route-local and does not leak across sibling route scopes: Task 1 route scope widget test.
- Anchor state clears after successful scroll resolution: Task 3 widget tests.
- Existing `TimelineTemporalScope` tests continue to prove explicit scope behavior where still used: final verification runs `temporal_scope_provider_test.dart`; route service tests that intentionally mutate temporal scope remain unchanged.
- Mobile shared tests from the spec are covered in this slice: month validation, year/month activation, ignored groupings, sibling route isolation, exact anchor resolution, pending missing target, successful clear, and temporal scope not updated by card activation.

## Task 1: Add Route-Local Zoom Anchor Model And Provider

**Files:**

- Create: `mobile/test/domain/models/timeline_zoom_anchor_test.dart`
- Create: `mobile/test/providers/timeline/zoom_anchor_provider_test.dart`
- Modify: `mobile/test/presentation/widgets/timeline/timeline_route_scope_test.dart`
- Create: `mobile/lib/domain/models/timeline_zoom_anchor.model.dart`
- Create: `mobile/lib/providers/timeline/zoom_anchor.provider.dart`
- Modify: `mobile/lib/presentation/widgets/timeline/timeline_route_scope.dart`

- [ ] **Step 1: Write failing model tests**

Create `mobile/test/domain/models/timeline_zoom_anchor_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/timeline_zoom_anchor.model.dart';

void main() {
  test('none anchor is empty and value comparable', () {
    expect(const TimelineZoomAnchor.none().isEmpty, isTrue);
    expect(const TimelineZoomAnchor.none(), const TimelineZoomAnchor.none());
    expect(const TimelineZoomAnchor.none().toString(), 'TimelineZoomAnchor.none()');
  });

  test('year anchor stores the selected year', () {
    const anchor = TimelineZoomAnchor.year(2025);

    expect(anchor.isEmpty, isFalse);
    expect(anchor, isA<TimelineZoomYearAnchor>());
    expect((anchor as TimelineZoomYearAnchor).year, 2025);
    expect(anchor, const TimelineZoomAnchor.year(2025));
    expect(anchor.toString(), 'TimelineZoomAnchor.year(2025)');
  });

  test('month anchor stores year and month', () {
    final anchor = TimelineZoomAnchor.month(year: 2025, month: 3);

    expect(anchor.isEmpty, isFalse);
    expect(anchor, isA<TimelineZoomMonthAnchor>());
    expect((anchor as TimelineZoomMonthAnchor).year, 2025);
    expect(anchor.month, 3);
    expect(anchor, TimelineZoomAnchor.month(year: 2025, month: 3));
    expect(anchor.toString(), 'TimelineZoomAnchor.month(year: 2025, month: 3)');
  });

  test('month anchor validates month ranges', () {
    expect(() => TimelineZoomAnchor.month(year: 2025, month: 0), throwsRangeError);
    expect(() => TimelineZoomAnchor.month(year: 2025, month: 13), throwsRangeError);
    expect(TimelineZoomAnchor.month(year: 2025, month: 1), isA<TimelineZoomMonthAnchor>());
    expect(TimelineZoomAnchor.month(year: 2025, month: 12), isA<TimelineZoomMonthAnchor>());
  });
}
```

- [ ] **Step 2: Write failing provider tests**

Create `mobile/test/providers/timeline/zoom_anchor_provider_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/timeline_zoom_anchor.model.dart';
import 'package:immich_mobile/providers/timeline/zoom_anchor.provider.dart';

void main() {
  late ProviderContainer container;

  setUp(() {
    container = ProviderContainer();
    addTearDown(container.dispose);
  });

  test('defaults to no pending anchor', () {
    expect(container.read(timelineZoomAnchorProvider), const TimelineZoomAnchor.none());
  });

  test('stores year anchors', () {
    container.read(timelineZoomAnchorProvider.notifier).setYear(2025);

    expect(container.read(timelineZoomAnchorProvider), const TimelineZoomAnchor.year(2025));
  });

  test('stores month anchors', () {
    container.read(timelineZoomAnchorProvider.notifier).setMonth(year: 2025, month: 3);

    expect(container.read(timelineZoomAnchorProvider), TimelineZoomAnchor.month(year: 2025, month: 3));
  });

  test('clears pending anchors', () {
    container.read(timelineZoomAnchorProvider.notifier).setMonth(year: 2025, month: 3);

    container.read(timelineZoomAnchorProvider.notifier).clear();

    expect(container.read(timelineZoomAnchorProvider), const TimelineZoomAnchor.none());
  });
}
```

- [ ] **Step 3: Add failing route-local anchor isolation coverage**

In `mobile/test/presentation/widgets/timeline/timeline_route_scope_test.dart`, add these imports:

```dart
import 'package:immich_mobile/domain/models/timeline_zoom_anchor.model.dart';
import 'package:immich_mobile/providers/timeline/zoom_anchor.provider.dart';
```

Add this helper before `void main()`:

```dart
String _anchorLabel(TimelineZoomAnchor anchor) {
  return switch (anchor) {
    TimelineZoomAnchorNone() => 'none',
    TimelineZoomYearAnchor(:final year) => 'year:$year',
    TimelineZoomMonthAnchor(:final year, :final month) => 'month:$year-$month',
  };
}
```

Add this widget test after `isolates temporal scope across sibling route subtrees`:

```dart
testWidgets('isolates zoom anchors across sibling route subtrees', (tester) async {
  await tester.pumpWidget(
    ProviderScope(
      child: MaterialApp(
        home: Row(
          children: [
            TimelineRouteScope(
              child: Consumer(
                builder: (context, ref, child) => TextButton(
                  key: const Key('left-anchor'),
                  onPressed: () => ref.read(timelineZoomAnchorProvider.notifier).setYear(2025),
                  child: Text('left:${_anchorLabel(ref.watch(timelineZoomAnchorProvider))}'),
                ),
              ),
            ),
            TimelineRouteScope(
              child: Consumer(
                builder: (context, ref, child) => Text(
                  'right:${_anchorLabel(ref.watch(timelineZoomAnchorProvider))}',
                  key: const Key('right-anchor'),
                ),
              ),
            ),
          ],
        ),
      ),
    ),
  );

  expect(find.text('left:none'), findsOneWidget);
  expect(find.text('right:none'), findsOneWidget);

  await tester.tap(find.byKey(const Key('left-anchor')));
  await tester.pump();

  expect(find.text('left:year:2025'), findsOneWidget);
  expect(find.text('right:none'), findsOneWidget);
});
```

- [ ] **Step 4: Run tests and verify the failures are red**

Run:

```bash
cd mobile && flutter test test/domain/models/timeline_zoom_anchor_test.dart test/providers/timeline/zoom_anchor_provider_test.dart test/presentation/widgets/timeline/timeline_route_scope_test.dart -r expanded
```

Expected red failures before production changes:

- New tests fail to compile because `timeline_zoom_anchor.model.dart` and `zoom_anchor.provider.dart` do not exist.
- The route scope test cannot import `timelineZoomAnchorProvider`.

- [ ] **Step 5: Implement the zoom anchor model**

Create `mobile/lib/domain/models/timeline_zoom_anchor.model.dart`:

```dart
sealed class TimelineZoomAnchor {
  const TimelineZoomAnchor();

  const factory TimelineZoomAnchor.none() = TimelineZoomAnchorNone;

  const factory TimelineZoomAnchor.year(int year) = TimelineZoomYearAnchor;

  factory TimelineZoomAnchor.month({required int year, required int month}) {
    RangeError.checkValueInInterval(month, 1, 12, 'month');
    return TimelineZoomMonthAnchor._(year: year, month: month);
  }

  bool get isEmpty => this is TimelineZoomAnchorNone;
}

final class TimelineZoomAnchorNone extends TimelineZoomAnchor {
  const TimelineZoomAnchorNone();

  @override
  bool operator ==(Object other) => other is TimelineZoomAnchorNone;

  @override
  int get hashCode => TimelineZoomAnchorNone.hashCode;

  @override
  String toString() => 'TimelineZoomAnchor.none()';
}

final class TimelineZoomYearAnchor extends TimelineZoomAnchor {
  const TimelineZoomYearAnchor(this.year);

  final int year;

  @override
  bool operator ==(Object other) => other is TimelineZoomYearAnchor && other.year == year;

  @override
  int get hashCode => Object.hash(TimelineZoomYearAnchor, year);

  @override
  String toString() => 'TimelineZoomAnchor.year($year)';
}

final class TimelineZoomMonthAnchor extends TimelineZoomAnchor {
  const TimelineZoomMonthAnchor._({required this.year, required this.month});

  final int year;
  final int month;

  @override
  bool operator ==(Object other) =>
      other is TimelineZoomMonthAnchor && other.year == year && other.month == month;

  @override
  int get hashCode => Object.hash(TimelineZoomMonthAnchor, year, month);

  @override
  String toString() => 'TimelineZoomAnchor.month(year: $year, month: $month)';
}
```

- [ ] **Step 6: Implement the zoom anchor provider**

Create `mobile/lib/providers/timeline/zoom_anchor.provider.dart`:

```dart
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/timeline_zoom_anchor.model.dart';

class TimelineZoomAnchorNotifier extends Notifier<TimelineZoomAnchor> {
  @override
  TimelineZoomAnchor build() => const TimelineZoomAnchor.none();

  void setYear(int year) => state = TimelineZoomAnchor.year(year);

  void setMonth({required int year, required int month}) =>
      state = TimelineZoomAnchor.month(year: year, month: month);

  void clear() => state = const TimelineZoomAnchor.none();
}

final timelineZoomAnchorProvider = NotifierProvider<TimelineZoomAnchorNotifier, TimelineZoomAnchor>(
  TimelineZoomAnchorNotifier.new,
);
```

- [ ] **Step 7: Override zoom anchors per timeline route scope**

In `mobile/lib/presentation/widgets/timeline/timeline_route_scope.dart`, add this import:

```dart
import 'package:immich_mobile/providers/timeline/zoom_anchor.provider.dart';
```

Add the route-local override immediately after the temporal scope override:

```dart
timelineTemporalScopeProvider.overrideWith(TimelineTemporalScopeNotifier.new),
timelineZoomAnchorProvider.overrideWith(TimelineZoomAnchorNotifier.new),
timelineOverviewDrilldownProvider.overrideWith((ref) => ref.watch(sharedTimelineOverviewDrilldownProvider)),
```

Do not change the `timelineServiceProvider` builder yet; explicit temporal scope remains available for routes that still use it.

- [ ] **Step 8: Run route-local model/provider tests green**

Run:

```bash
cd mobile && flutter test test/domain/models/timeline_zoom_anchor_test.dart test/providers/timeline/zoom_anchor_provider_test.dart test/presentation/widgets/timeline/timeline_route_scope_test.dart -r expanded
```

Expected green result:

- New model and provider tests pass.
- Existing temporal scope route isolation still passes.
- New zoom anchor route isolation passes.

- [ ] **Step 9: Commit Task 1**

Run:

```bash
git add mobile/lib/domain/models/timeline_zoom_anchor.model.dart mobile/lib/providers/timeline/zoom_anchor.provider.dart mobile/lib/presentation/widgets/timeline/timeline_route_scope.dart mobile/test/domain/models/timeline_zoom_anchor_test.dart mobile/test/providers/timeline/zoom_anchor_provider_test.dart mobile/test/presentation/widgets/timeline/timeline_route_scope_test.dart
git commit -m "feat(mobile): add route-local timeline zoom anchors"
```

## Task 2: Change Shared Overview Activation To Store Zoom Anchors

**Files:**

- Modify: `mobile/test/providers/timeline/overview_drilldown_provider_test.dart`
- Modify: `mobile/test/presentation/widgets/timeline/timeline_route_scope_test.dart`
- Modify: `mobile/test/presentation/pages/timeline_route_adoption_test.dart`
- Modify: `mobile/lib/providers/timeline/overview_drilldown.provider.dart`

- [ ] **Step 1: Rewrite failing shared drilldown provider tests**

In `mobile/test/providers/timeline/overview_drilldown_provider_test.dart`, add this import:

```dart
import 'package:immich_mobile/domain/models/timeline_zoom_anchor.model.dart';
import 'package:immich_mobile/providers/timeline/zoom_anchor.provider.dart';
```

Replace `year drilldown sets year scope, groups by month, and preserves filter text` with:

```dart
test('year activation groups by month, stores a year anchor, and preserves filters without changing scope', () async {
  container.read(photosFilterProvider.notifier).setText('paris');
  container.read(timelineTemporalScopeProvider.notifier).setYear(2024);
  var scrollEvents = 0;
  final subscription = EventStream.shared.listen<ScrollToTopEvent>((_) => scrollEvents++);
  addTearDown(subscription.cancel);

  await container.read(sharedTimelineOverviewDrilldownProvider)(
    TimeBucket(date: DateTime(2025), assetCount: 4),
    GroupAssetsBy.year,
  );

  expect(container.read(timelineTemporalScopeProvider), const TimelineTemporalScope.year(2024));
  expect(container.read(timelineZoomAnchorProvider), const TimelineZoomAnchor.year(2025));
  expect(Store.get(StoreKey.groupAssetsBy), GroupAssetsBy.month.index);
  expect(container.read(photosFilterProvider).context, 'paris');
  await Future<void>.delayed(Duration.zero);
  expect(scrollEvents, 0);
});
```

Replace `month drilldown sets month scope and groups by day` with:

```dart
test('month activation groups by day, stores a month anchor, and leaves temporal scope unchanged', () async {
  container.read(timelineTemporalScopeProvider.notifier).setYear(2024);
  var scrollEvents = 0;
  final subscription = EventStream.shared.listen<ScrollToTopEvent>((_) => scrollEvents++);
  addTearDown(subscription.cancel);

  await container.read(sharedTimelineOverviewDrilldownProvider)(
    TimeBucket(date: DateTime(2025, 3), assetCount: 4),
    GroupAssetsBy.month,
  );

  expect(container.read(timelineTemporalScopeProvider), const TimelineTemporalScope.year(2024));
  expect(container.read(timelineZoomAnchorProvider), TimelineZoomAnchor.month(year: 2025, month: 3));
  expect(Store.get(StoreKey.groupAssetsBy), GroupAssetsBy.day.index);
  await Future<void>.delayed(Duration.zero);
  expect(scrollEvents, 0);
});
```

Replace the ignored grouping loop test body with:

```dart
test('$groupBy grouping is ignored and leaves anchors, scope, and settings unchanged', () async {
  await Store.put(StoreKey.groupAssetsBy, GroupAssetsBy.year.index);
  container.read(timelineTemporalScopeProvider.notifier).setYear(2024);

  await container.read(sharedTimelineOverviewDrilldownProvider)(
    TimeBucket(date: DateTime(2025, 3), assetCount: 4),
    groupBy,
  );

  expect(container.read(timelineTemporalScopeProvider), const TimelineTemporalScope.year(2024));
  expect(container.read(timelineZoomAnchorProvider), const TimelineZoomAnchor.none());
  expect(Store.get(StoreKey.groupAssetsBy), GroupAssetsBy.year.index);
});
```

- [ ] **Step 2: Update the route-scope drilldown contract test to fail red**

In `mobile/test/presentation/widgets/timeline/timeline_route_scope_test.dart`, replace `overview drilldown updates only the invoking route scope` with:

```dart
testWidgets('overview drilldown updates only the invoking route zoom anchor', (tester) async {
  await tester.pumpWidget(
    ProviderScope(
      child: MaterialApp(
        home: Row(
          children: [
            TimelineRouteScope(
              child: Consumer(
                builder: (context, ref, child) => TextButton(
                  key: const Key('left-drilldown'),
                  onPressed: () {
                    final handler = ref.read(timelineOverviewDrilldownProvider);
                    handler?.call(TimeBucket(date: DateTime(2025), assetCount: 4), GroupAssetsBy.year);
                  },
                  child: Text(
                    'left:${ref.watch(timelineTemporalScopeProvider).kind.name}:${_anchorLabel(ref.watch(timelineZoomAnchorProvider))}',
                  ),
                ),
              ),
            ),
            TimelineRouteScope(
              child: Consumer(
                builder: (context, ref, child) => Text(
                  'right:${ref.watch(timelineTemporalScopeProvider).kind.name}:${_anchorLabel(ref.watch(timelineZoomAnchorProvider))}',
                  key: const Key('right-drilldown'),
                ),
              ),
            ),
          ],
        ),
      ),
    ),
  );

  expect(find.text('left:none:none'), findsOneWidget);
  expect(find.text('right:none:none'), findsOneWidget);

  await tester.tap(find.byKey(const Key('left-drilldown')));
  await tester.pumpAndSettle();

  expect(find.text('left:none:year:2025'), findsOneWidget);
  expect(find.text('right:none:none'), findsOneWidget);
  expect(Store.get(StoreKey.groupAssetsBy), GroupAssetsBy.month.index);
});
```

- [ ] **Step 3: Update generic route adoption test to fail red**

In `mobile/test/presentation/pages/timeline_route_adoption_test.dart`, add these imports:

```dart
import 'package:immich_mobile/domain/models/timeline_zoom_anchor.model.dart';
import 'package:immich_mobile/providers/timeline/zoom_anchor.provider.dart';
```

Rename the test:

```dart
testWidgets('non-Photos route scope renders selector and rebuilds service with drilldown scope', (tester) async {
```

to:

```dart
testWidgets('non-Photos route scope renders selector and keeps temporal scope unchanged after zoom activation', (tester) async {
```

Replace the final expectation:

```dart
expect(seenScopes.last, const TimelineTemporalScope.year(2025));
```

with:

```dart
expect(seenScopes.last, const TimelineTemporalScope.none());
expect(ref.read(timelineZoomAnchorProvider), const TimelineZoomAnchor.year(2025));
```

This keeps route-owned service construction tied to explicit `TimelineTemporalScope` only, not bucket-card zoom activation.

- [ ] **Step 4: Run tests and verify red behavior**

Run:

```bash
cd mobile && flutter test test/providers/timeline/overview_drilldown_provider_test.dart test/presentation/widgets/timeline/timeline_route_scope_test.dart test/presentation/pages/timeline_route_adoption_test.dart -r expanded
```

Expected red failures before production changes:

- Shared drilldown tests fail because activation still writes `TimelineTemporalScope`.
- Shared drilldown tests fail because `timelineZoomAnchorProvider` remains `none`.
- Scroll event expectations fail because the legacy handler still emits `ScrollToTopEvent`.
- Route scope and route adoption tests fail because the old shared handler still updates temporal scope.

- [ ] **Step 5: Implement shared zoom activation**

In `mobile/lib/providers/timeline/overview_drilldown.provider.dart`, remove these imports:

```dart
import 'package:immich_mobile/domain/models/events.model.dart';
import 'package:immich_mobile/domain/utils/event_stream.dart';
import 'package:immich_mobile/providers/timeline/temporal_scope.provider.dart';
```

Add this import:

```dart
import 'package:immich_mobile/providers/timeline/zoom_anchor.provider.dart';
```

Replace the shared provider with:

```dart
final sharedTimelineOverviewDrilldownProvider = Provider<TimelineOverviewDrilldownHandler>((ref) {
  return (bucket, groupBy) async {
    switch (groupBy) {
      case GroupAssetsBy.year:
        await ref.read(settingsProvider.notifier).set(Setting.groupAssetsBy, GroupAssetsBy.month.index);
        ref.read(timelineZoomAnchorProvider.notifier).setYear(bucket.date.year);
      case GroupAssetsBy.month:
        await ref.read(settingsProvider.notifier).set(Setting.groupAssetsBy, GroupAssetsBy.day.index);
        ref.read(timelineZoomAnchorProvider.notifier).setMonth(year: bucket.date.year, month: bucket.date.month);
      case GroupAssetsBy.day:
      case GroupAssetsBy.auto:
      case GroupAssetsBy.none:
        return;
    }
  };
}, dependencies: [timelineZoomAnchorProvider]);
```

Do not emit `ScrollToTopEvent`. The timeline widget resolves the pending anchor after segment rebuild in Task 3.

- [ ] **Step 6: Run shared activation tests green**

Run:

```bash
cd mobile && flutter test test/providers/timeline/overview_drilldown_provider_test.dart test/presentation/widgets/timeline/timeline_route_scope_test.dart test/presentation/pages/timeline_route_adoption_test.dart -r expanded
```

Expected green result:

- Year activation stores `TimelineZoomAnchor.year(2025)`, sets `Setting.groupAssetsBy` to month, preserves photos filter text, and leaves the existing temporal scope unchanged.
- Month activation stores `TimelineZoomAnchor.month(year: 2025, month: 3)`, sets grouping to day, and leaves temporal scope unchanged.
- Day, auto, and none groupings leave anchor, scope, and setting unchanged.
- Route-local drilldown only affects the invoking route scope's anchor.

- [ ] **Step 7: Commit Task 2**

Run:

```bash
git add mobile/lib/providers/timeline/overview_drilldown.provider.dart mobile/test/providers/timeline/overview_drilldown_provider_test.dart mobile/test/presentation/widgets/timeline/timeline_route_scope_test.dart mobile/test/presentation/pages/timeline_route_adoption_test.dart
git commit -m "feat(mobile): zoom timeline overview cards without temporal scope"
```

## Task 3: Resolve Zoom Anchors In The Timeline After Segment Rebuilds

**Files:**

- Modify: `mobile/test/presentation/widgets/timeline/timeline_scroll_target_test.dart`
- Create: `mobile/test/presentation/widgets/timeline/timeline_zoom_anchor_resolution_test.dart`
- Modify: `mobile/lib/presentation/widgets/timeline/timeline_scroll_target.dart`
- Modify: `mobile/lib/presentation/widgets/timeline/timeline.widget.dart`

- [ ] **Step 1: Add failing exact anchor target helper tests**

In `mobile/test/presentation/widgets/timeline/timeline_scroll_target_test.dart`, add this import:

```dart
import 'package:immich_mobile/domain/models/timeline_zoom_anchor.model.dart';
```

Add these tests before the closing `}` of `main()`:

```dart
test('findTimelineZoomAnchorSegment resolves a year anchor in month grouping', () {
  final segments = [
    _segment(DateTime(2026, 1), 0, 100),
    _segment(DateTime(2025, 12), 100, 200),
    _segment(DateTime(2025, 3), 200, 300),
  ];

  expect(
    findTimelineZoomAnchorSegment(segments, const TimelineZoomAnchor.year(2025), GroupAssetsBy.month),
    segments[1],
  );
});

test('findTimelineZoomAnchorSegment resolves a month anchor in day grouping', () {
  final segments = [
    _segment(DateTime(2025, 4, 1), 0, 100),
    _segment(DateTime(2025, 3, 20), 100, 200),
    _segment(DateTime(2025, 3, 1), 200, 300),
  ];

  expect(
    findTimelineZoomAnchorSegment(
      segments,
      TimelineZoomAnchor.month(year: 2025, month: 3),
      GroupAssetsBy.day,
    ),
    segments[1],
  );
});

test('findTimelineZoomAnchorSegment does not fall back to nearby years or months', () {
  final segments = [_segment(DateTime(2026, 1), 0, 100), _segment(DateTime(2024, 12), 100, 200)];

  expect(findTimelineZoomAnchorSegment(segments, const TimelineZoomAnchor.year(2025), GroupAssetsBy.month), isNull);
  expect(
    findTimelineZoomAnchorSegment(
      [_segment(DateTime(2025, 2), 0, 100), _segment(DateTime(2025, 4), 100, 200)],
      TimelineZoomAnchor.month(year: 2025, month: 3),
      GroupAssetsBy.day,
    ),
    isNull,
  );
});

test('findTimelineZoomAnchorSegment ignores anchors in stale grouping modes', () {
  final segments = [_segment(DateTime(2025, 3), 0, 100)];

  expect(findTimelineZoomAnchorSegment(segments, const TimelineZoomAnchor.year(2025), GroupAssetsBy.day), isNull);
  expect(
    findTimelineZoomAnchorSegment(
      segments,
      TimelineZoomAnchor.month(year: 2025, month: 3),
      GroupAssetsBy.month,
    ),
    isNull,
  );
});

test('findTimelineZoomAnchorSegment ignores non-time bucket segments', () {
  final segments = [_nonTimeSegment(0, 100), _segment(DateTime(2025, 3), 100, 200)];

  expect(
    findTimelineZoomAnchorSegment(segments, TimelineZoomAnchor.month(year: 2025, month: 3), GroupAssetsBy.day),
    segments[1],
  );
  expect(
    findTimelineZoomAnchorSegment([_nonTimeSegment(0, 100)], const TimelineZoomAnchor.year(2025), GroupAssetsBy.month),
    isNull,
  );
});
```

- [ ] **Step 2: Add failing widget tests for anchor resolution and pending state**

Create `mobile/test/presentation/widgets/timeline/timeline_zoom_anchor_resolution_test.dart`:

```dart
import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/models/timeline_zoom_anchor.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.widget.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/timeline/zoom_anchor.provider.dart';
import 'package:intl/date_symbol_data_local.dart';
// easy_localization initializes shared_preferences internally; tests need the mock initializer.
// ignore: depend_on_referenced_packages
import 'package:shared_preferences/shared_preferences.dart';

import '../../../test_utils.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Drift db;

  setUpAll(() async {
    TestUtils.init();
    SharedPreferences.setMockInitialValues({});
    await EasyLocalization.ensureInitialized();
    await initializeDateFormatting('en');
    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: DriftStoreRepository(db), listenUpdates: false);
  });

  setUp(() async {
    await Store.clear();
    await Store.put(StoreKey.serverEndpoint, 'http://test-server');
    await Store.put(StoreKey.tilesPerRow, 3);
  });

  tearDownAll(() async {
    await Store.clear();
    await db.close();
  });

  testWidgets('resolves a year anchor in month grouping and clears it after scrolling', (tester) async {
    await Store.put(StoreKey.groupAssetsBy, GroupAssetsBy.month.index);
    final service = _service([
      TimeBucket(date: DateTime(2026, 4), assetCount: 8),
      TimeBucket(date: DateTime(2026, 3), assetCount: 8),
      TimeBucket(date: DateTime(2026, 2), assetCount: 8),
      TimeBucket(date: DateTime(2026, 1), assetCount: 8),
      TimeBucket(date: DateTime(2025, 12), assetCount: 8),
      TimeBucket(date: DateTime(2025, 11), assetCount: 8),
      TimeBucket(date: DateTime(2024, 12), assetCount: 8),
      TimeBucket(date: DateTime(2024, 11), assetCount: 8),
    ]);
    addTearDown(service.dispose);

    await _pumpTimeline(tester, service);
    final ref = ProviderScope.containerOf(tester.element(find.byType(Timeline)));

    ref.read(timelineZoomAnchorProvider.notifier).setYear(2025);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 600));
    await tester.pumpAndSettle();

    expect(ref.read(timelineZoomAnchorProvider), const TimelineZoomAnchor.none());
    expect(_scrollPixels(tester), greaterThan(0));
  });

  testWidgets('resolves a month anchor in day grouping and clears it after scrolling', (tester) async {
    await Store.put(StoreKey.groupAssetsBy, GroupAssetsBy.day.index);
    final service = _service([
      TimeBucket(date: DateTime(2025, 5, 2), assetCount: 9),
      TimeBucket(date: DateTime(2025, 4, 2), assetCount: 9),
      TimeBucket(date: DateTime(2025, 3, 20), assetCount: 9),
      TimeBucket(date: DateTime(2025, 3, 1), assetCount: 9),
      TimeBucket(date: DateTime(2025, 2, 1), assetCount: 9),
      TimeBucket(date: DateTime(2025, 1, 1), assetCount: 9),
    ]);
    addTearDown(service.dispose);

    await _pumpTimeline(tester, service);
    final ref = ProviderScope.containerOf(tester.element(find.byType(Timeline)));

    ref.read(timelineZoomAnchorProvider.notifier).setMonth(year: 2025, month: 3);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 600));
    await tester.pumpAndSettle();

    expect(ref.read(timelineZoomAnchorProvider), const TimelineZoomAnchor.none());
    expect(_scrollPixels(tester), greaterThan(0));
  });

  testWidgets('keeps a missing year anchor pending without scrolling', (tester) async {
    await Store.put(StoreKey.groupAssetsBy, GroupAssetsBy.month.index);
    final service = _service([
      TimeBucket(date: DateTime(2026, 4), assetCount: 8),
      TimeBucket(date: DateTime(2026, 3), assetCount: 8),
      TimeBucket(date: DateTime(2024, 12), assetCount: 8),
      TimeBucket(date: DateTime(2024, 11), assetCount: 8),
    ]);
    addTearDown(service.dispose);

    await _pumpTimeline(tester, service);
    final ref = ProviderScope.containerOf(tester.element(find.byType(Timeline)));

    ref.read(timelineZoomAnchorProvider.notifier).setYear(2025);
    await tester.pump();
    await tester.pumpAndSettle();

    expect(ref.read(timelineZoomAnchorProvider), const TimelineZoomAnchor.year(2025));
    expect(_scrollPixels(tester), 0);
  });
}

TimelineService _service(List<Bucket> buckets) {
  final assets = <BaseAsset>[
    for (var i = 0; i < buckets.fold<int>(0, (total, bucket) => total + bucket.assetCount); i++)
      TestUtils.createRemoteAsset(id: 'asset-$i'),
  ];

  return TimelineService((
    bucketSource: () => Stream.value(buckets),
    assetSource: (offset, count) async {
      final end = (offset + count).clamp(0, assets.length).toInt();
      if (offset >= end) {
        return const <BaseAsset>[];
      }
      return assets.sublist(offset, end);
    },
    origin: TimelineOrigin.main,
  ));
}

Future<void> _pumpTimeline(WidgetTester tester, TimelineService service) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        timelineServiceProvider.overrideWithValue(service),
        timelineZoomAnchorProvider.overrideWith(TimelineZoomAnchorNotifier.new),
      ],
      child: EasyLocalization(
        supportedLocales: const [Locale('en')],
        path: '../i18n',
        fallbackLocale: const Locale('en'),
        child: const MaterialApp(
          home: Timeline(appBar: null, bottomSheet: null, withScrubber: false),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

double _scrollPixels(WidgetTester tester) {
  return tester.state<ScrollableState>(find.byType(Scrollable).first).position.pixels;
}
```

- [ ] **Step 3: Run helper and widget tests and verify red failures**

Run:

```bash
cd mobile && flutter test test/presentation/widgets/timeline/timeline_scroll_target_test.dart test/presentation/widgets/timeline/timeline_zoom_anchor_resolution_test.dart -r expanded
```

Expected red failures before production changes:

- Helper tests fail to compile because `findTimelineZoomAnchorSegment()` does not exist.
- Widget tests fail because pending anchors are never resolved or cleared by `Timeline`.

- [ ] **Step 4: Implement exact zoom-anchor segment lookup**

In `mobile/lib/presentation/widgets/timeline/timeline_scroll_target.dart`, add this import:

```dart
import 'package:immich_mobile/domain/models/timeline_zoom_anchor.model.dart';
```

Extract the time bucket predicate helper to file scope and add `findTimelineZoomAnchorSegment`:

```dart
bool _matchesDate(Segment segment, bool Function(DateTime segmentDate) predicate) {
  if (segment.bucket is! TimeBucket) {
    return false;
  }

  return predicate((segment.bucket as TimeBucket).date);
}

Segment? findTimelineScrollTargetSegment(List<Segment> segments, DateTime date) {
  return segments.firstWhereOrNull(
        (segment) => _matchesDate(
          segment,
          (segmentDate) =>
              segmentDate.year == date.year && segmentDate.month == date.month && segmentDate.day == date.day,
        ),
      ) ??
      segments.firstWhereOrNull(
        (segment) =>
            _matchesDate(segment, (segmentDate) => segmentDate.year == date.year && segmentDate.month == date.month),
      ) ??
      segments.firstWhereOrNull((segment) => _matchesDate(segment, (segmentDate) => segmentDate.year == date.year));
}

Segment? findTimelineZoomAnchorSegment(List<Segment> segments, TimelineZoomAnchor anchor, GroupAssetsBy groupBy) {
  return switch (anchor) {
    TimelineZoomAnchorNone() => null,
    TimelineZoomYearAnchor(:final year) when groupBy == GroupAssetsBy.month => segments.firstWhereOrNull(
      (segment) => _matchesDate(segment, (segmentDate) => segmentDate.year == year),
    ),
    TimelineZoomMonthAnchor(:final year, :final month) when groupBy == GroupAssetsBy.day => segments.firstWhereOrNull(
      (segment) => _matchesDate(
        segment,
        (segmentDate) => segmentDate.year == year && segmentDate.month == month,
      ),
    ),
    _ => null,
  };
}
```

This helper must not reuse `findTimelineScrollTargetSegment()` because zoom anchors require exact year/month matches and no nearest-period fallback.

- [ ] **Step 5: Integrate zoom-anchor resolution into Timeline**

In `mobile/lib/presentation/widgets/timeline/timeline.widget.dart`, add these imports:

```dart
import 'package:immich_mobile/domain/models/timeline_zoom_anchor.model.dart';
import 'package:immich_mobile/providers/timeline/zoom_anchor.provider.dart';
```

Add these fields to `_SliverTimelineState`:

```dart
TimelineZoomAnchor? _scheduledZoomAnchor;
TimelineZoomAnchor? _resolvingZoomAnchor;
```

Add these methods near `_scrollToDate`:

```dart
void _scheduleZoomAnchorResolution({
  required TimelineZoomAnchor anchor,
  required GroupAssetsBy groupBy,
  required List<Segment> segments,
}) {
  if (anchor.isEmpty || _scheduledZoomAnchor == anchor || _resolvingZoomAnchor == anchor) {
    return;
  }

  _scheduledZoomAnchor = anchor;
  WidgetsBinding.instance.addPostFrameCallback((_) {
    if (!mounted) {
      return;
    }

    _scheduledZoomAnchor = null;
    _resolveZoomAnchor(anchor: anchor, groupBy: groupBy, segments: segments);
  });
}

void _resolveZoomAnchor({
  required TimelineZoomAnchor anchor,
  required GroupAssetsBy groupBy,
  required List<Segment> segments,
}) {
  if (ref.read(timelineZoomAnchorProvider) != anchor || !_scrollController.hasClients) {
    return;
  }

  final activeGroupBy =
      ref.read(timelineArgsProvider).groupBy ?? GroupAssetsBy.values[ref.read(settingsProvider).get(Setting.groupAssetsBy)];
  if (activeGroupBy != groupBy) {
    return;
  }

  final targetSegment = findTimelineZoomAnchorSegment(segments, anchor, groupBy);
  if (targetSegment == null) {
    return;
  }

  final targetOffset = targetSegment.startOffset - 50;
  _resolvingZoomAnchor = anchor;
  ref.read(timelineStateProvider.notifier).setScrubbing(true);
  _scrollController
      .animateTo(
        targetOffset.clamp(0.0, _scrollController.position.maxScrollExtent),
        duration: const Duration(milliseconds: 500),
        curve: Curves.easeInOut,
      )
      .whenComplete(() {
        if (!mounted) {
          return;
        }

        if (ref.read(timelineZoomAnchorProvider) == anchor) {
          ref.read(timelineZoomAnchorProvider.notifier).clear();
        }
        if (_resolvingZoomAnchor == anchor) {
          _resolvingZoomAnchor = null;
        }
        ref.read(timelineStateProvider.notifier).setScrubbing(false);
      });
}
```

Inside the `onData: (segments) { ... }` block, before `childCount` is computed, add:

```dart
final activeGroupBy =
    ref.watch(timelineArgsProvider).groupBy ?? GroupAssetsBy.values[ref.watch(settingsProvider).get(Setting.groupAssetsBy)];
final zoomAnchor = ref.watch(timelineZoomAnchorProvider);
_scheduleZoomAnchorResolution(anchor: zoomAnchor, groupBy: activeGroupBy, segments: segments);
```

Then replace the scrubber `groupBy` expression:

```dart
groupBy:
    ref.watch(timelineArgsProvider).groupBy ??
    GroupAssetsBy.values[ref.watch(settingsProvider).get(Setting.groupAssetsBy)],
```

with:

```dart
groupBy: activeGroupBy,
```

Do not clear anchors when no target is present, when the scroll controller has no clients, or when the active grouping no longer matches the anchor's expected grouping. Those cases represent pending data or stale UI frames and should leave the anchor available for the next segment rebuild.

- [ ] **Step 6: Run helper and widget tests green**

Run:

```bash
cd mobile && flutter test test/presentation/widgets/timeline/timeline_scroll_target_test.dart test/presentation/widgets/timeline/timeline_zoom_anchor_resolution_test.dart -r expanded
```

Expected green result:

- Exact helper tests pass.
- Year anchor scrolls a month-grouped timeline, clears the anchor, and leaves scroll position greater than zero.
- Month anchor scrolls a day-grouped timeline, clears the anchor, and leaves scroll position greater than zero.
- Missing year target leaves the anchor pending and scroll position unchanged.

- [ ] **Step 7: Commit Task 3**

Run:

```bash
git add mobile/lib/presentation/widgets/timeline/timeline_scroll_target.dart mobile/lib/presentation/widgets/timeline/timeline.widget.dart mobile/test/presentation/widgets/timeline/timeline_scroll_target_test.dart mobile/test/presentation/widgets/timeline/timeline_zoom_anchor_resolution_test.dart
git commit -m "feat(mobile): resolve timeline zoom anchors after rebuild"
```

## Final Verification

- [ ] **Step 1: Format changed Dart files**

Run:

```bash
cd mobile && dart format lib/domain/models/timeline_zoom_anchor.model.dart lib/providers/timeline/zoom_anchor.provider.dart lib/providers/timeline/overview_drilldown.provider.dart lib/presentation/widgets/timeline/timeline_route_scope.dart lib/presentation/widgets/timeline/timeline_scroll_target.dart lib/presentation/widgets/timeline/timeline.widget.dart test/domain/models/timeline_zoom_anchor_test.dart test/providers/timeline/zoom_anchor_provider_test.dart test/providers/timeline/overview_drilldown_provider_test.dart test/presentation/widgets/timeline/timeline_route_scope_test.dart test/presentation/pages/timeline_route_adoption_test.dart test/presentation/widgets/timeline/timeline_scroll_target_test.dart test/presentation/widgets/timeline/timeline_zoom_anchor_resolution_test.dart
```

- [ ] **Step 2: Run focused mobile regression suite**

Run:

```bash
cd mobile && flutter test test/domain/models/timeline_zoom_anchor_test.dart test/providers/timeline/zoom_anchor_provider_test.dart test/providers/timeline/overview_drilldown_provider_test.dart test/providers/timeline/temporal_scope_provider_test.dart test/presentation/widgets/timeline/timeline_route_scope_test.dart test/presentation/pages/timeline_route_adoption_test.dart test/presentation/widgets/timeline/timeline_scroll_target_test.dart test/presentation/widgets/timeline/timeline_zoom_anchor_resolution_test.dart test/presentation/widgets/timeline/timeline_segment_provider_test.dart -r expanded
```

Expected green result:

- All focused tests pass.
- `temporal_scope_provider_test.dart` remains green, proving explicit temporal scope behavior still exists independently of card activation.

- [ ] **Step 3: Run static checks**

Run:

```bash
cd mobile && flutter analyze
```

Expected green result:

- No new analyzer errors.
- Existing unrelated warnings, if any, must be recorded in the worker report with exact output; do not ignore new warnings in changed files.

- [ ] **Step 4: Confirm no mobile shared activation code still writes temporal scope**

Run:

```bash
rg -n "timelineTemporalScopeProvider\\.notifier\\)\\.set|ScrollToTopEvent|EventStream\\.shared\\.emit" lib/providers/timeline/overview_drilldown.provider.dart lib/presentation/widgets/timeline -g "*.dart"
```

Expected result:

- No match in `mobile/lib/providers/timeline/overview_drilldown.provider.dart`.
- Existing `ScrollToTopEvent` handling in `mobile/lib/presentation/widgets/timeline/timeline.widget.dart` may still appear because explicit event-based scrolling remains supported for other flows.

- [ ] **Step 5: Push after Slice 6 completes**

Run:

```bash
git status --short --branch
git push
```

Expected result:

- Working tree is clean.
- Branch `brainstorm/pr625` is pushed to `origin`.
