# Timeline Zoom Navigation Slice 7 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove and, if necessary, complete the mobile main Photos zoom behavior on top of the shared mobile zoom-anchor plumbing from Slice 6.

**Architecture:** Main Photos already uses `TimelineRouteScope`, `buildPhotosTimelineRouteService`, `PhotosFilterSubheader`, `Timeline`, and the shared overview drilldown handler. This slice adds Photos-specific tests around the route-facing provider, filter subheader, and actual overview-card taps. Production code changes are expected only if those tests reveal that the shared Slice 6 behavior does not reach the Photos surface.

**Tech Stack:** Flutter widget tests, hooks_riverpod, Drift in-memory `StoreService`, mocktail for route-service factory wiring, existing mobile timeline/filter widgets.

---

## Files

- Create: `mobile/test/providers/timeline/photos_overview_zoom_provider_test.dart`
  - Photos-specific provider contract: year/month activation changes grouping plus anchor only, leaves Photos filters and temporal scope untouched, and ignores day/auto/none.
- Modify: `mobile/test/presentation/widgets/photos_filter/filter_subheader_test.dart`
  - Guards that Photos card activation does not create a temporal chip, preserves existing Photos chips, and leaves explicit Photos date chips clearable.
- Create: `mobile/test/presentation/pages/dev/main_timeline_zoom_test.dart`
  - End-to-end Photos route harness: tapping year/month overview cards changes grouping and scrolls via route-local anchors without temporal scope.
- Optional production changes only if tests fail:
  - `mobile/lib/providers/timeline/overview_drilldown.provider.dart`
  - `mobile/lib/presentation/pages/dev/main_timeline.page.dart`
  - `mobile/lib/presentation/widgets/photos_filter/filter_subheader.widget.dart`
  - `mobile/lib/providers/photos_filter/timeline_query.provider.dart`

## Acceptance Coverage

- Tapping a year card switches to month grouping and scrolls to that year: Task 3 route-card tap test.
- Tapping a month card switches to day grouping and scrolls to that month: Task 3 route-card tap test.
- No `2025 x` or `Mar 2025 x` chip appears from card activation: Task 2 subheader tests.
- Existing Photos filters remain active and unchanged: Task 1 provider test and Task 2 visible chip test.
- Explicit temporal filters, where exposed through Photos filter date range chips, still narrow/filter state and remain clearable: Task 2 explicit date chip test.
- Clearing explicit filters does not change grouping unless the route already did so: Task 2 asserts grouping remains at the zoomed value after clearing a date chip.

## TDD Notes For This Slice

Slice 6 intentionally moved the shared mobile activation path to zoom anchors, and Main Photos already consumes that shared path through `TimelineRouteScope`. Therefore some Slice 7 tests may pass before production edits. If a new test passes immediately, record that the behavior was already delivered by Slice 6, keep the test as Photos-specific regression coverage, and do not invent a production change just to make a red cycle. If a test fails, follow normal TDD: fix only the minimal production code needed, rerun the focused test green, then commit.

## Task 1: Photos Overview Activation Provider Contract

**Files:**

- Create: `mobile/test/providers/timeline/photos_overview_zoom_provider_test.dart`
- Modify only if the tests fail for a real product gap: `mobile/lib/providers/timeline/overview_drilldown.provider.dart`

- [ ] **Step 1: Write Photos-specific provider tests**

Create `mobile/test/providers/timeline/photos_overview_zoom_provider_test.dart`:

```dart
import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/models/timeline_temporal_scope.model.dart';
import 'package:immich_mobile/domain/models/timeline_zoom_anchor.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:immich_mobile/providers/timeline/overview_drilldown.provider.dart';
import 'package:immich_mobile/providers/timeline/temporal_scope.provider.dart';
import 'package:immich_mobile/providers/timeline/zoom_anchor.provider.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Drift db;
  late ProviderContainer container;

  setUpAll(() async {
    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: DriftStoreRepository(db), listenUpdates: false);
  });

  setUp(() async {
    await Store.clear();
    container = ProviderContainer();
    addTearDown(container.dispose);
  });

  tearDownAll(() async {
    await Store.clear();
    await db.close();
  });

  test('Photos year activation changes grouping and anchor only', () async {
    container.read(photosFilterProvider.notifier)
      ..setText('paris')
      ..toggleTag('tag-1')
      ..setFavouritesOnly(true)
      ..setMediaType(AssetType.video);
    container.read(timelineTemporalScopeProvider.notifier).setMonth(year: 2024, month: 12);
    final beforeFilter = container.read(photosFilterProvider);

    await container.read(photosTimelineOverviewDrilldownProvider)(
      TimeBucket(date: DateTime(2025), assetCount: 4),
      GroupAssetsBy.year,
    );

    expect(Store.get(StoreKey.groupAssetsBy), GroupAssetsBy.month.index);
    expect(container.read(timelineZoomAnchorProvider), const TimelineZoomAnchor.year(2025));
    expect(container.read(timelineTemporalScopeProvider), TimelineTemporalScope.month(year: 2024, month: 12));
    expect(container.read(photosFilterProvider), beforeFilter);
    expect(container.read(photosFilterProvider).context, 'paris');
    expect(container.read(photosFilterProvider).tagIds, ['tag-1']);
    expect(container.read(photosFilterProvider).display.isFavorite, isTrue);
    expect(container.read(photosFilterProvider).mediaType, AssetType.video);
  });

  test('Photos month activation changes grouping and anchor only', () async {
    container.read(photosFilterProvider.notifier)
      ..setLocation(SearchLocationFilter(country: 'France'))
      ..setRating(4);
    final beforeFilter = container.read(photosFilterProvider);

    await container.read(photosTimelineOverviewDrilldownProvider)(
      TimeBucket(date: DateTime(2025, 3), assetCount: 4),
      GroupAssetsBy.month,
    );

    expect(Store.get(StoreKey.groupAssetsBy), GroupAssetsBy.day.index);
    expect(container.read(timelineZoomAnchorProvider), TimelineZoomAnchor.month(year: 2025, month: 3));
    expect(container.read(timelineTemporalScopeProvider), const TimelineTemporalScope.none());
    expect(container.read(photosFilterProvider), beforeFilter);
    expect(container.read(photosFilterProvider).location.country, 'France');
    expect(container.read(photosFilterProvider).rating.rating, 4);
  });

  for (final groupBy in [GroupAssetsBy.day, GroupAssetsBy.auto, GroupAssetsBy.none]) {
    test('Photos $groupBy activation is ignored', () async {
      await Store.put(StoreKey.groupAssetsBy, GroupAssetsBy.year.index);
      container.read(photosFilterProvider.notifier).setText('paris');
      final beforeFilter = container.read(photosFilterProvider);

      await container.read(photosTimelineOverviewDrilldownProvider)(
        TimeBucket(date: DateTime(2025, 3), assetCount: 4),
        groupBy,
      );

      expect(Store.get(StoreKey.groupAssetsBy), GroupAssetsBy.year.index);
      expect(container.read(timelineZoomAnchorProvider), const TimelineZoomAnchor.none());
      expect(container.read(timelineTemporalScopeProvider), const TimelineTemporalScope.none());
      expect(container.read(photosFilterProvider), beforeFilter);
    });
  }
}
```

- [ ] **Step 2: Run the provider tests before production edits**

Run:

```bash
cd mobile && flutter test test/providers/timeline/photos_overview_zoom_provider_test.dart -r expanded
```

Expected result on the current Slice 6 baseline:

- These tests may pass because `photosTimelineOverviewDrilldownProvider` aliases the shared zoom handler.
- If they fail because the Photos provider still writes `TimelineTemporalScope`, emits scroll-to-top, changes `photosFilterProvider`, or fails to store an anchor, fix `mobile/lib/providers/timeline/overview_drilldown.provider.dart` minimally and rerun.

- [ ] **Step 3: Commit Task 1**

If no production code changed, commit only the new test:

```bash
git add mobile/test/providers/timeline/photos_overview_zoom_provider_test.dart
git commit -m "test(mobile): cover photos overview zoom provider contract"
```

If production code changed, include the changed production file in the same commit and use:

```bash
git add mobile/lib/providers/timeline/overview_drilldown.provider.dart mobile/test/providers/timeline/photos_overview_zoom_provider_test.dart
git commit -m "feat(mobile): apply photos overview zoom provider contract"
```

## Task 2: Guard Photos Filter Subheader Against Card-Activation Chips

**Files:**

- Modify: `mobile/test/presentation/widgets/photos_filter/filter_subheader_test.dart`
- Modify only if tests fail for a real product gap: `mobile/lib/presentation/widgets/photos_filter/filter_subheader.widget.dart` or Photos filter helpers.

- [ ] **Step 1: Add Photos subheader tests**

In `mobile/test/presentation/widgets/photos_filter/filter_subheader_test.dart`, add imports:

```dart
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/models/timeline_zoom_anchor.model.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/providers/timeline/overview_drilldown.provider.dart';
import 'package:immich_mobile/providers/timeline/zoom_anchor.provider.dart';
```

Add these tests inside the `PhotosFilterSubheader` group:

```dart
testWidgets('does not render a temporal chip from Photos year activation', (tester) async {
  await tester.pumpConsumerWidget(_scroll(const PhotosFilterSubheader()));
  await tester.pumpAndSettle();
  final container = ProviderScope.containerOf(tester.element(find.byType(CustomScrollView)));

  await container.read(photosTimelineOverviewDrilldownProvider)(
    TimeBucket(date: DateTime(2025), assetCount: 4),
    GroupAssetsBy.year,
  );
  await tester.pumpAndSettle();

  expect(container.read(timelineTemporalScopeProvider), const TimelineTemporalScope.none());
  expect(container.read(timelineZoomAnchorProvider), const TimelineZoomAnchor.year(2025));
  expect(Store.get(StoreKey.groupAssetsBy), GroupAssetsBy.month.index);
  expect(find.byKey(const Key('photos-filter-subheader')), findsNothing);
  expect(find.text('2025'), findsNothing);
  expect(find.text('Mar 2025'), findsNothing);
});

testWidgets('keeps existing Photos filter chips without adding a temporal chip after activation', (tester) async {
  await tester.pumpConsumerWidget(_scroll(const PhotosFilterSubheader()));
  await tester.pumpAndSettle();
  final container = ProviderScope.containerOf(tester.element(find.byType(CustomScrollView)));
  container.read(photosFilterProvider.notifier).setText('paris');
  await tester.pumpAndSettle();

  await container.read(photosTimelineOverviewDrilldownProvider)(
    TimeBucket(date: DateTime(2025), assetCount: 4),
    GroupAssetsBy.year,
  );
  await tester.pumpAndSettle();

  expect(container.read(photosFilterProvider).context, 'paris');
  expect(container.read(timelineTemporalScopeProvider), const TimelineTemporalScope.none());
  expect(find.byKey(const Key('photos-filter-subheader')), findsOneWidget);
  expect(find.text('"paris"'), findsOneWidget);
  expect(find.text('2025'), findsNothing);
});

testWidgets('explicit Photos date chips remain clearable after card activation', (tester) async {
  await Store.put(StoreKey.groupAssetsBy, GroupAssetsBy.year.index);
  await tester.pumpConsumerWidget(_scroll(const PhotosFilterSubheader()));
  await tester.pumpAndSettle();
  final container = ProviderScope.containerOf(tester.element(find.byType(CustomScrollView)));
  container
      .read(photosFilterProvider.notifier)
      .setDateRange(start: DateTime(2025, 3), end: DateTime(2025, 3, 31, 23, 59, 59));
  await tester.pumpAndSettle();

  await container.read(photosTimelineOverviewDrilldownProvider)(
    TimeBucket(date: DateTime(2025), assetCount: 4),
    GroupAssetsBy.year,
  );
  await tester.pumpAndSettle();

  expect(find.text('Mar 2025'), findsOneWidget);
  expect(container.read(timelineTemporalScopeProvider), const TimelineTemporalScope.none());
  expect(container.read(photosFilterProvider).date.takenAfter, DateTime(2025, 3));
  expect(Store.get(StoreKey.groupAssetsBy), GroupAssetsBy.month.index);

  await tester.tap(find.byIcon(Icons.close_rounded).last);
  await tester.pumpAndSettle();

  expect(container.read(photosFilterProvider).date.takenAfter, isNull);
  expect(container.read(photosFilterProvider).date.takenBefore, isNull);
  expect(container.read(timelineTemporalScopeProvider), const TimelineTemporalScope.none());
  expect(Store.get(StoreKey.groupAssetsBy), GroupAssetsBy.month.index);
});
```

- [ ] **Step 2: Run the subheader tests before production edits**

Run:

```bash
cd mobile && flutter test test/presentation/widgets/photos_filter/filter_subheader_test.dart -r expanded
```

Expected result on the current Slice 6 baseline:

- The new card-activation tests should pass if activation does not write `TimelineTemporalScope`.
- Existing explicit temporal-scope tests should still pass, proving explicit scope chips remain supported where still used.
- If card activation produces `2025` or `Mar 2025` through `TimelineTemporalScope`, fix only the activation/subheader path responsible for that chip.

- [ ] **Step 3: Commit Task 2**

If no production code changed:

```bash
git add mobile/test/presentation/widgets/photos_filter/filter_subheader_test.dart
git commit -m "test(mobile): guard photos filters from zoom chips"
```

If production code changed, include it and use:

```bash
git add mobile/lib/presentation/widgets/photos_filter/filter_subheader.widget.dart mobile/test/presentation/widgets/photos_filter/filter_subheader_test.dart
git commit -m "feat(mobile): keep photos zoom activation out of filter chips"
```

## Task 3: Main Photos Route Card-Tap Zoom Flow

**Files:**

- Create: `mobile/test/presentation/pages/dev/main_timeline_zoom_test.dart`
- Modify only if tests fail for a real product gap: `mobile/lib/presentation/pages/dev/main_timeline.page.dart`, `mobile/lib/providers/photos_filter/timeline_query.provider.dart`, or shared timeline zoom files.

- [ ] **Step 1: Write Photos route-card tap tests**

Create `mobile/test/presentation/pages/dev/main_timeline_zoom_test.dart`:

```dart
import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/setting.model.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/models/timeline_temporal_scope.model.dart';
import 'package:immich_mobile/domain/models/timeline_zoom_anchor.model.dart';
import 'package:immich_mobile/domain/models/user.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/domain/services/user.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_route_scope.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/infrastructure/user.provider.dart' as infra;
import 'package:immich_mobile/providers/photos_filter/timeline_query.provider.dart';
import 'package:immich_mobile/providers/timeline/temporal_scope.provider.dart';
import 'package:immich_mobile/providers/timeline/zoom_anchor.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:mocktail/mocktail.dart';
// easy_localization initializes shared_preferences internally; tests need the mock initializer.
// ignore: depend_on_referenced_packages
import 'package:shared_preferences/shared_preferences.dart';

import '../../../test_utils.dart';

class _MockTimelineFactory extends Mock implements TimelineFactory {}

class _MockUserService extends Mock implements UserService {}

class _StubCurrentUserNotifier extends CurrentUserProvider {
  _StubCurrentUserNotifier(super.service, UserDto user) {
    state = user;
  }
}

UserDto _user(String id) => UserDto(id: id, email: '$id@example.com', name: id, profileChangedAt: DateTime(2024));

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Drift db;

  setUpAll(() async {
    TestUtils.init();
    SharedPreferences.setMockInitialValues({});
    await EasyLocalization.ensureInitialized();
    await initializeDateFormatting('en');
    registerFallbackValue(const TimelineTemporalScope.none());
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

  testWidgets('Photos year card tap switches to months and scrolls to the tapped year', (tester) async {
    await Store.put(StoreKey.groupAssetsBy, GroupAssetsBy.year.index);
    final factory = _factoryForServices(
      yearService: _service([
        TimeBucket(date: DateTime(2026), assetCount: 8),
        TimeBucket(date: DateTime(2025), assetCount: 8),
        TimeBucket(date: DateTime(2024), assetCount: 8),
      ]),
      monthService: _service([
        TimeBucket(date: DateTime(2026, 2), assetCount: 8),
        TimeBucket(date: DateTime(2026, 1), assetCount: 8),
        TimeBucket(date: DateTime(2025, 12), assetCount: 8),
        TimeBucket(date: DateTime(2025, 3), assetCount: 8),
        TimeBucket(date: DateTime(2024, 12), assetCount: 8),
      ]),
      dayService: _service([TimeBucket(date: DateTime(2025, 3, 1), assetCount: 8)]),
    );
    addTearDown(factory.disposeServices);

    await _pumpPhotosTimeline(tester, factory);
    final ref = ProviderScope.containerOf(tester.element(find.byType(Timeline)));

    await tester.tap(find.bySemanticsLabel('2025, 8 photos, show months'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 600));
    await tester.pumpAndSettle();

    expect(Store.get(StoreKey.groupAssetsBy), GroupAssetsBy.month.index);
    expect(ref.read(timelineTemporalScopeProvider), const TimelineTemporalScope.none());
    expect(ref.read(timelineZoomAnchorProvider), const TimelineZoomAnchor.none());
    expect(_scrollPixels(tester), greaterThan(0));
  });

  testWidgets('Photos month card tap switches to detailed mode and scrolls to the tapped month', (tester) async {
    await Store.put(StoreKey.groupAssetsBy, GroupAssetsBy.month.index);
    final factory = _factoryForServices(
      yearService: _service([TimeBucket(date: DateTime(2025), assetCount: 9)]),
      monthService: _service([
        TimeBucket(date: DateTime(2025, 5), assetCount: 9),
        TimeBucket(date: DateTime(2025, 4), assetCount: 9),
        TimeBucket(date: DateTime(2025, 3), assetCount: 9),
        TimeBucket(date: DateTime(2025, 2), assetCount: 9),
      ]),
      dayService: _service([
        TimeBucket(date: DateTime(2025, 5, 1), assetCount: 9),
        TimeBucket(date: DateTime(2025, 4, 1), assetCount: 9),
        TimeBucket(date: DateTime(2025, 3, 20), assetCount: 9),
        TimeBucket(date: DateTime(2025, 3, 1), assetCount: 9),
      ]),
    );
    addTearDown(factory.disposeServices);

    await _pumpPhotosTimeline(tester, factory);
    final ref = ProviderScope.containerOf(tester.element(find.byType(Timeline)));

    await tester.tap(find.bySemanticsLabel('March 2025, 9 photos, show days'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 600));
    await tester.pumpAndSettle();

    expect(Store.get(StoreKey.groupAssetsBy), GroupAssetsBy.day.index);
    expect(ref.read(timelineTemporalScopeProvider), const TimelineTemporalScope.none());
    expect(ref.read(timelineZoomAnchorProvider), const TimelineZoomAnchor.none());
    expect(_scrollPixels(tester), greaterThan(0));
  });
}

({TimelineFactory factory, Future<void> Function() disposeServices}) _factoryForServices({
  required TimelineService yearService,
  required TimelineService monthService,
  required TimelineService dayService,
}) {
  final factory = _MockTimelineFactory();
  when(() => factory.main(any(), any(), temporalScope: any(named: 'temporalScope'))).thenAnswer((_) {
    final groupBy = GroupAssetsBy.values[Store.get(StoreKey.groupAssetsBy, Setting.groupAssetsBy.defaultValue)];
    return switch (groupBy) {
      GroupAssetsBy.year => yearService,
      GroupAssetsBy.month => monthService,
      GroupAssetsBy.day || GroupAssetsBy.auto || GroupAssetsBy.none => dayService,
    };
  });

  return (
    factory: factory,
    disposeServices: () async {
      await yearService.dispose();
      await monthService.dispose();
      await dayService.dispose();
    },
  );
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

Future<void> _pumpPhotosTimeline(
  WidgetTester tester,
  ({TimelineFactory factory, Future<void> Function() disposeServices}) factoryHarness,
) async {
  final user = _user('user-1');
  final userService = _MockUserService();
  when(() => userService.tryGetMyUser()).thenReturn(user);
  when(() => userService.watchMyUser()).thenAnswer((_) => const Stream<UserDto?>.empty());

  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        timelineFactoryProvider.overrideWithValue(factoryHarness.factory),
        infra.userServiceProvider.overrideWithValue(userService),
        currentUserProvider.overrideWith((ref) => _StubCurrentUserNotifier(userService, user)),
        timelineUsersProvider.overrideWith((_) => Stream<List<String>>.value([user.id])),
      ],
      child: EasyLocalization(
        supportedLocales: const [Locale('en')],
        path: '../i18n',
        fallbackLocale: const Locale('en'),
        child: const MaterialApp(
          home: TimelineRouteScope(
            timelineServiceBuilder: buildPhotosTimelineRouteService,
            child: Timeline(appBar: null, bottomSheet: null, withScrubber: false),
          ),
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

- [ ] **Step 2: Run the Photos route-card tests before production edits**

Run:

```bash
cd mobile && flutter test test/presentation/pages/dev/main_timeline_zoom_test.dart -r expanded
```

Expected result on the current Slice 6 baseline:

- The tests may pass because the Photos route already uses `TimelineRouteScope` and shared zoom anchors.
- If they fail because `MainTimelinePage` or `buildPhotosTimelineRouteService` does not use route-local shared activation, make the minimal production change to the Photos route wiring.
- If they fail because the anchor does not clear after scroll, fix the shared Timeline anchor resolution from Slice 6 rather than adding Photos-only scroll logic.

- [ ] **Step 3: Commit Task 3**

If no production code changed:

```bash
git add mobile/test/presentation/pages/dev/main_timeline_zoom_test.dart
git commit -m "test(mobile): cover photos timeline zoom flow"
```

If production code changed, include it and use:

```bash
git add mobile/lib/presentation/pages/dev/main_timeline.page.dart mobile/lib/providers/photos_filter/timeline_query.provider.dart mobile/lib/presentation/widgets/timeline/timeline.widget.dart mobile/test/presentation/pages/dev/main_timeline_zoom_test.dart
git commit -m "feat(mobile): apply photos timeline zoom flow"
```

## Final Verification

- [ ] **Step 1: Format changed files**

Run:

```bash
cd mobile && dart format test/providers/timeline/photos_overview_zoom_provider_test.dart test/presentation/widgets/photos_filter/filter_subheader_test.dart test/presentation/pages/dev/main_timeline_zoom_test.dart
```

Add any production files to the command if they changed.

- [ ] **Step 2: Run focused Slice 7 tests**

Run:

```bash
cd mobile && flutter test test/providers/timeline/photos_overview_zoom_provider_test.dart test/presentation/widgets/photos_filter/filter_subheader_test.dart test/presentation/pages/dev/main_timeline_page_test.dart test/presentation/pages/dev/main_timeline_zoom_test.dart test/providers/timeline/overview_drilldown_provider_test.dart test/presentation/widgets/timeline/timeline_zoom_anchor_resolution_test.dart -r expanded
```

Expected green result:

- Photos provider tests pass.
- Photos subheader tests pass, including existing explicit temporal scope behavior and new no-chip activation guards.
- Main Photos app bar and route-card zoom tests pass.
- Shared overview drilldown and anchor resolution tests remain green.

- [ ] **Step 3: Analyze changed Slice 7 files**

Run:

```bash
cd mobile && flutter analyze test/providers/timeline/photos_overview_zoom_provider_test.dart test/presentation/widgets/photos_filter/filter_subheader_test.dart test/presentation/pages/dev/main_timeline_page_test.dart test/presentation/pages/dev/main_timeline_zoom_test.dart
```

Add any production files to the command if they changed. The broad `flutter analyze` command currently fails on unrelated `packages/ui/showcase` missing dependencies; use targeted analysis for Slice 7 files.

- [ ] **Step 4: Push after Slice 7 completes**

Run:

```bash
git status --short --branch
git push
```

Expected result:

- Working tree is clean.
- Branch `brainstorm/pr625` is pushed to `origin`.
