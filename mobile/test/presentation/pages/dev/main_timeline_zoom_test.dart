import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/models/timeline_grouping.model.dart';
import 'package:immich_mobile/domain/models/timeline_temporal_scope.model.dart';
import 'package:immich_mobile/domain/models/timeline_zoom_anchor.model.dart';
import 'package:immich_mobile/domain/models/user.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/domain/services/user.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/settings.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_route_scope.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/infrastructure/user.provider.dart' as infra;
import 'package:immich_mobile/providers/photos_filter/timeline_query.provider.dart';
import 'package:immich_mobile/providers/timeline/temporal_scope.provider.dart';
import 'package:immich_mobile/providers/timeline/timeline_grouping.provider.dart';
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
    registerFallbackValue(GroupAssetsBy.day);
    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: StoreRepository(db), listenUpdates: false);
    await SettingsRepository.ensureInitialized(db);
  });

  setUp(() async {
    await Store.clear();
    await SettingsRepository.instance.clear(SettingsKey.values);
    await Store.put(StoreKey.serverEndpoint, 'http://test-server');
    await SettingsRepository.instance.write(SettingsKey.timelineTilesPerRow, 3);
  });

  tearDownAll(() async {
    await Store.clear();
    await db.close();
  });

  testWidgets('Photos year card tap switches to months and scrolls to the tapped year', (tester) async {
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
    await ref.read(timelineOverviewModeProvider.notifier).set(TimelineOverviewMode.years);
    await tester.pumpAndSettle();

    await tester.tap(find.bySemanticsLabel('2025, 8 photos, show months'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 600));
    await tester.pumpAndSettle();

    expect(ref.read(timelineOverviewModeProvider), TimelineOverviewMode.months);
    expect(ref.read(timelineTemporalScopeProvider), const TimelineTemporalScope.none());
    expect(ref.read(timelineZoomAnchorProvider), const TimelineZoomAnchor.none());
    expect(_scrollPixels(tester), greaterThan(0));
  });

  testWidgets('Photos month card tap switches to detailed mode and scrolls to the tapped month', (tester) async {
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
    await ref.read(timelineOverviewModeProvider.notifier).set(TimelineOverviewMode.months);
    await tester.pumpAndSettle();

    await tester.tap(find.bySemanticsLabel('March 2025, 9 photos, show days'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 600));
    await tester.pumpAndSettle();

    expect(ref.read(timelineOverviewModeProvider), TimelineOverviewMode.all);
    expect(ref.read(timelineTemporalScopeProvider), const TimelineTemporalScope.none());
    expect(ref.read(timelineZoomAnchorProvider), const TimelineZoomAnchor.none());
    expect(_scrollPixels(tester), greaterThan(0));
  });

  // Regression for Hagen bug 1: drilling Years -> Months must NOT lock the
  // months view to the tapped year. Months from the previous and following
  // years stay loaded so the user can keep scrolling across year boundaries.
  // The mock factory honours the temporal scope like the real DB query, so if
  // the year drilldown ever scopes the query again this test fails.
  testWidgets('Photos year card tap keeps months from other years reachable', (tester) async {
    final factory = _scopeAwareFactory(
      yearBuckets: [
        TimeBucket(date: DateTime(2026), assetCount: 8),
        TimeBucket(date: DateTime(2025), assetCount: 8),
        TimeBucket(date: DateTime(2024), assetCount: 8),
      ],
      monthBuckets: [
        TimeBucket(date: DateTime(2026, 2), assetCount: 8),
        TimeBucket(date: DateTime(2025, 6), assetCount: 8),
        TimeBucket(date: DateTime(2024, 12), assetCount: 8),
      ],
      dayBuckets: [TimeBucket(date: DateTime(2025, 6, 1), assetCount: 8)],
    );
    addTearDown(factory.disposeServices);

    await _pumpPhotosTimeline(tester, factory);
    final ref = ProviderScope.containerOf(tester.element(find.byType(Timeline)));
    await ref.read(timelineOverviewModeProvider.notifier).set(TimelineOverviewMode.years);
    await tester.pumpAndSettle();

    await tester.tap(find.bySemanticsLabel('2025, 8 photos, show months'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 600));
    await tester.pumpAndSettle();

    expect(ref.read(timelineOverviewModeProvider), TimelineOverviewMode.months);
    expect(find.bySemanticsLabel('December 2024, 8 photos, show days'), findsOneWidget);
    expect(find.bySemanticsLabel('June 2025, 8 photos, show days'), findsOneWidget);
    expect(find.bySemanticsLabel('February 2026, 8 photos, show days'), findsOneWidget);
  });

  // Regression for Hagen bug 2: switching grouping via the selector must keep the
  // current position instead of jumping to the most recent content at the top.
  testWidgets('Switching All -> Months keeps the scrolled position instead of resetting to the top', (tester) async {
    final factory = _factoryForServices(
      yearService: _service([
        TimeBucket(date: DateTime(2026), assetCount: 30),
        TimeBucket(date: DateTime(2025), assetCount: 30),
        TimeBucket(date: DateTime(2024), assetCount: 30),
      ]),
      monthService: _service([
        TimeBucket(date: DateTime(2026, 2), assetCount: 30),
        TimeBucket(date: DateTime(2026, 1), assetCount: 30),
        TimeBucket(date: DateTime(2025, 8), assetCount: 30),
        TimeBucket(date: DateTime(2025, 3), assetCount: 30),
        TimeBucket(date: DateTime(2024, 12), assetCount: 30),
        TimeBucket(date: DateTime(2024, 6), assetCount: 30),
      ]),
      dayService: _service([
        TimeBucket(date: DateTime(2026, 2, 10), assetCount: 30),
        TimeBucket(date: DateTime(2026, 1, 10), assetCount: 30),
        TimeBucket(date: DateTime(2025, 8, 10), assetCount: 30),
        TimeBucket(date: DateTime(2025, 3, 10), assetCount: 30),
        TimeBucket(date: DateTime(2024, 12, 10), assetCount: 30),
        TimeBucket(date: DateTime(2024, 6, 10), assetCount: 30),
      ]),
    );
    addTearDown(factory.disposeServices);

    await _pumpPhotosTimeline(tester, factory);
    final ref = ProviderScope.containerOf(tester.element(find.byType(Timeline)));

    // Scroll the All view down to old content (away from the most recent top).
    final scrollable = tester.state<ScrollableState>(find.byType(Scrollable).first);
    scrollable.position.jumpTo(scrollable.position.maxScrollExtent);
    await tester.pump();
    await tester.pumpAndSettle();
    final scrolledOffset = _scrollPixels(tester);
    expect(scrolledOffset, greaterThan(0));

    // Switch the zoom level the same way the selector does.
    await ref.read(timelineOverviewModeProvider.notifier).set(TimelineOverviewMode.months);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 600));
    await tester.pumpAndSettle();

    expect(ref.read(timelineOverviewModeProvider), TimelineOverviewMode.months);
    // Position preserved: not reset to the most recent content at the top.
    expect(_scrollPixels(tester), greaterThan(0));
    // Landed on the old content: the previously visible month is rendered while
    // the most recent month is scrolled out of view (the bug jumped here instead).
    expect(find.bySemanticsLabel('June 2024, 30 photos, show days'), findsOneWidget);
    expect(find.bySemanticsLabel('February 2026, 30 photos, show days'), findsNothing);
  });

  // Regression for Bug B: grouping round trip (All → Months → All) without
  // tapping any card must return to the same day, not truncate to the 1st of
  // the month.
  testWidgets('Round-trip All → Months → All without card tap returns to the same day (not 1st of month)', (
    tester,
  ) async {
    // Two day buckets for June: the 9th is the most-recent (top), the 1st is
    // further down. We put older content below so there is room to scroll.
    final factory = _factoryForServices(
      yearService: _service([
        TimeBucket(date: DateTime(2026), assetCount: 9),
        TimeBucket(date: DateTime(2025), assetCount: 9),
      ]),
      monthService: _service([
        TimeBucket(date: DateTime(2026, 6), assetCount: 9),
        TimeBucket(date: DateTime(2026, 5), assetCount: 9),
      ]),
      dayService: _service([
        TimeBucket(date: DateTime(2026, 6, 9), assetCount: 9),
        TimeBucket(date: DateTime(2026, 6, 1), assetCount: 9),
        TimeBucket(date: DateTime(2026, 5, 10), assetCount: 9),
      ]),
    );
    addTearDown(factory.disposeServices);

    await _pumpPhotosTimeline(tester, factory);
    final ref = ProviderScope.containerOf(tester.element(find.byType(Timeline)));

    // At this point the day timeline is loaded at the top — Jun 9 is visible.
    // Step 1: switch to Months (no card tap — simulates the grouping selector).
    await ref.read(timelineOverviewModeProvider.notifier).set(TimelineOverviewMode.months);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 600));
    await tester.pumpAndSettle();

    expect(ref.read(timelineOverviewModeProvider), TimelineOverviewMode.months);

    // Step 2: switch back to All without tapping any card.
    await ref.read(timelineOverviewModeProvider.notifier).set(TimelineOverviewMode.all);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 600));
    await tester.pumpAndSettle();

    expect(ref.read(timelineOverviewModeProvider), TimelineOverviewMode.all);

    // The timeline must have resolved back to the Jun 9 segment (not Jun 1).
    // Both segments are in the day timeline, so the anchor date drives which one
    // is scrolled to. Jun 9 is the first bucket (index 0, offset 0) so the
    // scroll position stays near the top — the anchor was Jun 9, NOT Jun 1.
    final notifier = ref.read(timelineZoomAnchorProvider.notifier);
    // After the anchor is consumed (clear) the lastPositionDate is Jun 9 (not Jun 1).
    expect(notifier.lastPositionDate, DateTime(2026, 6, 9));
  });

  // Scrolled-in-between variant: if the user actually scrolls while in Months
  // (so a different month is on top), round-tripping back to All anchors to
  // that other month's first day — not the original fine-grained date.
  // We need enough month cards to exceed the test viewport (~600px) so that
  // scrolling to maxScrollExtent actually moves the scroll position.
  // Each overview card is 144 + 12 vertical padding (6 top + 6 bottom) = 156px; 5 cards = 780px > 600px.
  testWidgets('Round-trip with scroll in month view uses the scrolled-to month', (tester) async {
    final factory = _factoryForServices(
      yearService: _service([
        TimeBucket(date: DateTime(2026), assetCount: 9),
        TimeBucket(date: DateTime(2025), assetCount: 9),
      ]),
      monthService: _service([
        TimeBucket(date: DateTime(2026, 6), assetCount: 9),
        TimeBucket(date: DateTime(2026, 5), assetCount: 9),
        TimeBucket(date: DateTime(2026, 4), assetCount: 9),
        TimeBucket(date: DateTime(2026, 3), assetCount: 9),
        TimeBucket(date: DateTime(2026, 2), assetCount: 9),
      ]),
      dayService: _service([
        TimeBucket(date: DateTime(2026, 6, 9), assetCount: 9),
        TimeBucket(date: DateTime(2026, 5, 10), assetCount: 9),
        TimeBucket(date: DateTime(2026, 4, 1), assetCount: 9),
        TimeBucket(date: DateTime(2026, 3, 1), assetCount: 9),
        TimeBucket(date: DateTime(2026, 2, 1), assetCount: 9),
      ]),
    );
    addTearDown(factory.disposeServices);

    await _pumpPhotosTimeline(tester, factory);
    final ref = ProviderScope.containerOf(tester.element(find.byType(Timeline)));

    // Switch to Months — Jun 9 remembered.
    await ref.read(timelineOverviewModeProvider.notifier).set(TimelineOverviewMode.months);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 600));
    await tester.pumpAndSettle();

    // Scroll to the bottom in month view — the top-visible month is no longer June.
    final scrollable = tester.state<ScrollableState>(find.byType(Scrollable).first);
    // Verify there is actually scroll room (5 cards × 156px = 780px > viewport).
    expect(scrollable.position.maxScrollExtent, greaterThan(0));
    scrollable.position.jumpTo(scrollable.position.maxScrollExtent);
    await tester.pump();
    await tester.pumpAndSettle();

    // Switch back to All. The top-visible month is no longer June (user scrolled
    // past it), so the remembered Jun 9 is outside the top bucket's period and
    // must be dropped in favour of the bucket's truncated date.
    await ref.read(timelineOverviewModeProvider.notifier).set(TimelineOverviewMode.all);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 600));
    await tester.pumpAndSettle();

    expect(ref.read(timelineOverviewModeProvider), TimelineOverviewMode.all);
    // lastPositionDate was overwritten with the top-visible month's bucket date
    // (NOT Jun 9, since the user scrolled away from June). A negative assertion is used
    // deliberately: the exact top-visible month depends on viewport/card-extent layout math,
    // so we assert only that the stale Jun 9 was dropped — the kept-vs-dropped logic itself is
    // pinned by the pure-function tests in timeline_grouping_anchor_test.dart.
    expect(ref.read(timelineZoomAnchorProvider.notifier).lastPositionDate, isNot(DateTime(2026, 6, 9)));
  });
}

({TimelineFactory factory, Future<void> Function() disposeServices}) _factoryForServices({
  required TimelineService yearService,
  required TimelineService monthService,
  required TimelineService dayService,
}) {
  final factory = _MockTimelineFactory();
  when(
    () => factory.main(
      any(),
      any(),
      groupBy: any(named: 'groupBy'),
      temporalScope: any(named: 'temporalScope'),
    ),
  ).thenAnswer((invocation) {
    final groupBy = invocation.namedArguments[const Symbol('groupBy')] as GroupAssetsBy? ?? GroupAssetsBy.day;
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

/// Builds a factory whose `main` honours the temporal scope, mirroring the real
/// DB query: an empty scope returns the full archive, a year/month scope filters
/// the buckets. This lets a widget test detect if the timeline zoom ever scopes
/// the query (Hagen bug 1) instead of just anchoring the scroll.
({TimelineFactory factory, Future<void> Function() disposeServices}) _scopeAwareFactory({
  required List<Bucket> yearBuckets,
  required List<Bucket> monthBuckets,
  required List<Bucket> dayBuckets,
}) {
  final factory = _MockTimelineFactory();
  final created = <TimelineService>[];

  TimelineService build(List<Bucket> buckets) {
    final service = _service(buckets);
    created.add(service);
    return service;
  }

  when(
    () => factory.main(
      any(),
      any(),
      groupBy: any(named: 'groupBy'),
      temporalScope: any(named: 'temporalScope'),
    ),
  ).thenAnswer((invocation) {
    final scope =
        invocation.namedArguments[const Symbol('temporalScope')] as TimelineTemporalScope? ??
        const TimelineTemporalScope.none();
    final groupBy = invocation.namedArguments[const Symbol('groupBy')] as GroupAssetsBy? ?? GroupAssetsBy.day;
    return switch (groupBy) {
      GroupAssetsBy.year => build(yearBuckets),
      GroupAssetsBy.month => build(_filterBucketsByScope(monthBuckets, scope)),
      GroupAssetsBy.day || GroupAssetsBy.auto || GroupAssetsBy.none => build(dayBuckets),
    };
  });

  return (
    factory: factory,
    disposeServices: () async {
      for (final service in created) {
        await service.dispose();
      }
    },
  );
}

List<Bucket> _filterBucketsByScope(List<Bucket> buckets, TimelineTemporalScope scope) {
  return switch (scope.kind) {
    TimelineTemporalScopeKind.none => buckets,
    TimelineTemporalScopeKind.year => [
      for (final bucket in buckets.whereType<TimeBucket>())
        if (bucket.date.year == scope.year) bucket,
    ],
    TimelineTemporalScopeKind.month => [
      for (final bucket in buckets.whereType<TimeBucket>())
        if (bucket.date.year == scope.year && bucket.date.month == scope.month) bucket,
    ],
  };
}

TimelineService _service(List<Bucket> buckets) {
  final assets = <BaseAsset>[
    for (var i = 0; i < buckets.fold<int>(0, (total, bucket) => total + bucket.assetCount); i++)
      TestUtils.createRemoteAsset(id: 'asset-$i'),
  ];

  return TimelineService((
    bucketSource: () => Stream.value(buckets),
    assetSource: (offset, count) async {
      final end = (offset + count).clamp(0, assets.length);
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
            // These tests pin the MAIN Photos page contract: the app-level grouping,
            // shared across the page rather than scoped per route.
            sharedGrouping: true,
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
