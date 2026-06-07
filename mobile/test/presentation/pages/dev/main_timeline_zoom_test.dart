import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
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
import 'package:immich_mobile/providers/infrastructure/settings.provider.dart';
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
    await SettingsRepository.instance.write(SettingsKey.timelineGroupAssetsBy, GroupAssetsBy.year);
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

    expect(SettingsRepository.instance.appConfig.timeline.groupAssetsBy, GroupAssetsBy.month);
    expect(ref.read(timelineTemporalScopeProvider), const TimelineTemporalScope.none());
    expect(ref.read(timelineZoomAnchorProvider), const TimelineZoomAnchor.none());
    expect(_scrollPixels(tester), greaterThan(0));
  });

  testWidgets('Photos month card tap switches to detailed mode and scrolls to the tapped month', (tester) async {
    await SettingsRepository.instance.write(SettingsKey.timelineGroupAssetsBy, GroupAssetsBy.month);
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

    expect(SettingsRepository.instance.appConfig.timeline.groupAssetsBy, GroupAssetsBy.day);
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
    await SettingsRepository.instance.write(SettingsKey.timelineGroupAssetsBy, GroupAssetsBy.year);
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

    await tester.tap(find.bySemanticsLabel('2025, 8 photos, show months'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 600));
    await tester.pumpAndSettle();

    expect(SettingsRepository.instance.appConfig.timeline.groupAssetsBy, GroupAssetsBy.month);
    expect(find.bySemanticsLabel('December 2024, 8 photos, show days'), findsOneWidget);
    expect(find.bySemanticsLabel('June 2025, 8 photos, show days'), findsOneWidget);
    expect(find.bySemanticsLabel('February 2026, 8 photos, show days'), findsOneWidget);
  });

  // Regression for Hagen bug 2: switching grouping via the selector must keep the
  // current position instead of jumping to the most recent content at the top.
  testWidgets('Switching All -> Months keeps the scrolled position instead of resetting to the top', (tester) async {
    await SettingsRepository.instance.write(SettingsKey.timelineGroupAssetsBy, GroupAssetsBy.day);
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

    // Switch grouping the same way the selector does.
    await ref.read(settingsProvider).write(.timelineGroupAssetsBy, GroupAssetsBy.month);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 600));
    await tester.pumpAndSettle();

    expect(SettingsRepository.instance.appConfig.timeline.groupAssetsBy, GroupAssetsBy.month);
    // Position preserved: not reset to the most recent content at the top.
    expect(_scrollPixels(tester), greaterThan(0));
    // Landed on the old content: the previously visible month is rendered while
    // the most recent month is scrolled out of view (the bug jumped here instead).
    expect(find.bySemanticsLabel('June 2024, 30 photos, show days'), findsOneWidget);
    expect(find.bySemanticsLabel('February 2026, 30 photos, show days'), findsNothing);
  });
}

({TimelineFactory factory, Future<void> Function() disposeServices}) _factoryForServices({
  required TimelineService yearService,
  required TimelineService monthService,
  required TimelineService dayService,
}) {
  final factory = _MockTimelineFactory();
  when(() => factory.main(any(), any(), temporalScope: any(named: 'temporalScope'))).thenAnswer((_) {
    final groupBy = SettingsRepository.instance.appConfig.timeline.groupAssetsBy;
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

  when(() => factory.main(any(), any(), temporalScope: any(named: 'temporalScope'))).thenAnswer((invocation) {
    final scope =
        invocation.namedArguments[const Symbol('temporalScope')] as TimelineTemporalScope? ??
        const TimelineTemporalScope.none();
    final groupBy = SettingsRepository.instance.appConfig.timeline.groupAssetsBy;
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
