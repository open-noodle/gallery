import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/data/db/main/database.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/models/timeline_temporal_scope.model.dart';
import 'package:immich_mobile/domain/models/user.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/domain/services/user.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/settings.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/presentation/widgets/timeline/segment.model.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.state.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_route_scope.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/infrastructure/user.provider.dart' as infra;
import 'package:immich_mobile/providers/photos_filter/timeline_query.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:mocktail/mocktail.dart';
// easy_localization initializes shared_preferences internally; tests need the mock initializer.
// ignore: depend_on_referenced_packages
import 'package:shared_preferences/shared_preferences.dart';

import '../../../test_utils.dart';
import '../../../widget_tester_extensions.dart';

class _MockTimelineFactory extends Mock implements TimelineFactory {}

class _MockUserService extends Mock implements UserService {}

class _StubCurrentUserNotifier extends CurrentUserProvider {
  _StubCurrentUserNotifier(super.service, UserDto user) {
    state = user;
  }
}

UserDto _user(String id) => UserDto(id: id, email: '$id@example.com', name: id, profileChangedAt: DateTime(2024));

const _portrait = Size(400, 800);
const _landscape = Size(800, 400);

/// Twelve equally sized days, newest first — the order the timeline renders them in.
final _days = <Bucket>[for (var day = 12; day >= 1; day--) TimeBucket(date: DateTime(2025, 3, day), assetCount: 9)];

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

  testWidgets('rotating the device keeps the day the user had scrolled to', (tester) async {
    tester.view.physicalSize = _portrait;
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    final harness = _dayTimeline(_days);
    addTearDown(harness.disposeServices);
    await _pumpPhotosTimeline(tester, harness);

    // Park the viewport on the first row of a day well down the timeline.
    final scrolledToDay = DateTime(2025, 3, 8);
    await _scrollToDay(tester, scrolledToDay);
    expect(_topVisibleDay(tester), scrolledToDay);

    await _rotate(tester, _landscape);

    expect(_scrollPixels(tester), greaterThan(0), reason: 'a rotation must not send the timeline back to the top');
    expect(_topVisibleDay(tester), scrolledToDay);
  });

  testWidgets('rotating back to portrait keeps the day the user had scrolled to', (tester) async {
    tester.view.physicalSize = _landscape;
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    final harness = _dayTimeline(_days);
    addTearDown(harness.disposeServices);
    await _pumpPhotosTimeline(tester, harness);

    final scrolledToDay = DateTime(2025, 3, 8);
    await _scrollToDay(tester, scrolledToDay);
    expect(_topVisibleDay(tester), scrolledToDay);

    await _rotate(tester, _portrait);

    expect(_scrollPixels(tester), greaterThan(0), reason: 'a rotation must not send the timeline back to the top');
    expect(_topVisibleDay(tester), scrolledToDay);
  });
}

/// A factory whose every `main(...)` call serves the same set of day buckets, so a
/// rotation re-reads the same timeline the user was already looking at.
({TimelineFactory factory, Future<void> Function() disposeServices}) _dayTimeline(List<Bucket> buckets) {
  final factory = _MockTimelineFactory();
  final created = <TimelineService>[];

  when(
    () => factory.main(
      any(),
      any(),
      groupBy: any(named: 'groupBy'),
      temporalScope: any(named: 'temporalScope'),
    ),
  ).thenAnswer((_) {
    final service = _service(buckets);
    created.add(service);
    return service;
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

TimelineService _service(List<Bucket> buckets) {
  final assets = <BaseAsset>[
    for (var i = 0; i < buckets.fold<int>(0, (total, bucket) => total + bucket.assetCount); i++)
      TestUtils.createRemoteAsset(id: 'asset-$i'),
  ];

  return TimelineService((
    // The real bucket source is a Drift query, so it never resolves within the frame that
    // asked for it and the timeline shows its loading placeholder for at least one frame
    // every time the buckets are re-read. A synchronous `Stream.value` would land the data
    // before the next frame, skip that placeholder entirely, and hide the regression these
    // tests cover.
    bucketSource: () => Stream.fromFuture(Future.delayed(Duration.zero, () => buckets)),
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
        child: withStubRouter(
          const MaterialApp(
            home: TimelineRouteScope(
              timelineServiceBuilder: buildPhotosTimelineRouteService,
              sharedGrouping: true,
              child: Timeline(appBar: null, bottomSheet: null, withScrubber: false),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _rotate(WidgetTester tester, Size size) async {
  tester.view.physicalSize = size;
  await tester.pumpAndSettle();
}

/// Scrolls so the first row of [day] sits at the top of the viewport.
Future<void> _scrollToDay(WidgetTester tester, DateTime day) async {
  final segment = _segments(tester).firstWhere((segment) => (segment.bucket as TimeBucket).date == day);
  final position = _position(tester);
  expect(
    segment.gridOffset,
    lessThanOrEqualTo(position.maxScrollExtent),
    reason: 'the fixture must be tall enough to scroll $day into view',
  );
  position.jumpTo(segment.gridOffset);
  await tester.pumpAndSettle();
}

/// The day of the bucket the viewport currently starts in — what the user sees.
DateTime? _topVisibleDay(WidgetTester tester) {
  final position = _position(tester);
  final bucket = _segments(tester).findByOffset(position.pixels.clamp(0.0, position.maxScrollExtent))?.bucket;
  return bucket is TimeBucket ? bucket.date : null;
}

List<Segment> _segments(WidgetTester tester) {
  // The segments live in the scope `Timeline` builds around its own constraints, so read
  // them from inside it rather than from the root container.
  final container = ProviderScope.containerOf(tester.element(find.byType(CustomScrollView).first), listen: false);
  return container.read(timelineSegmentProvider).requireValue;
}

ScrollPosition _position(WidgetTester tester) => tester.state<ScrollableState>(find.byType(Scrollable).first).position;

double _scrollPixels(WidgetTester tester) => _position(tester).pixels;
