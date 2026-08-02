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
import 'package:immich_mobile/domain/models/timeline_temporal_scope.model.dart';
import 'package:immich_mobile/domain/models/user.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/domain/services/user.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/settings.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/presentation/pages/drift_favorite.page.dart';
import 'package:immich_mobile/presentation/widgets/timeline/overview/overview_card.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_grouping_bottom_pill.widget.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/infrastructure/user.provider.dart' as infra;
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:mocktail/mocktail.dart';
// easy_localization initializes shared_preferences internally; tests need the mock initializer.
// ignore: depend_on_referenced_packages
import 'package:shared_preferences/shared_preferences.dart';

import '../../test_utils.dart';

class _MockTimelineFactory extends Mock implements TimelineFactory {}

class _MockUserService extends Mock implements UserService {}

class _StubCurrentUserNotifier extends CurrentUserProvider {
  _StubCurrentUserNotifier(super.service, UserDto user) {
    state = user;
  }
}

UserDto _user(String id) => UserDto(id: id, email: '$id@example.com', name: id, profileChangedAt: DateTime(2024));

TimelineService _service(List<Bucket> buckets) {
  final assets = <BaseAsset>[
    for (var i = 0; i < buckets.fold<int>(0, (total, bucket) => total + bucket.assetCount); i++)
      TestUtils.createRemoteAsset(id: 'asset-$i'),
  ];

  return TimelineService((
    bucketSource: () => Stream.value(buckets),
    assetSource: (offset, count) async {
      final end = (offset + count).clamp(0, assets.length);
      if (offset >= end) return const <BaseAsset>[];
      return assets.sublist(offset, end);
    },
    origin: TimelineOrigin.favorite,
  ));
}

({TimelineFactory factory, Future<void> Function() disposeServices}) _factoryForServices({
  required TimelineService yearService,
  required TimelineService monthService,
  required TimelineService dayService,
}) {
  final factory = _MockTimelineFactory();
  // Favorites page uses factory.favorite(userId, groupBy: groupBy, temporalScope: scope);
  // the grouping is now an explicit route-local parameter, so pick the service from it.
  when(
    () => factory.favorite(
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
    await StoreService.init(storeRepository: DriftStoreRepository(db), listenUpdates: false);
    await SettingsRepository.ensureInitialized(db);
  });

  setUp(() async {
    await Store.clear();
    await Store.put(StoreKey.serverEndpoint, 'http://test-server');
    await SettingsRepository.instance.write(SettingsKey.timelineTilesPerRow, 3);
  });

  tearDownAll(() async {
    await Store.clear();
    await db.close();
  });

  Future<void> pumpFavoritePage(
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
          child: const MaterialApp(home: DriftFavoritePage()),
        ),
      ),
    );
    // MesmerizingSliverAppBar has a parallax animation; pump explicit frames instead of
    // pumpAndSettle to avoid timeout.
    await tester.pump();
    await tester.pump();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));
  }

  testWidgets('pill is present on the favorites page', (tester) async {
    final dayBuckets = [
      TimeBucket(date: DateTime(2026, 6, 1), assetCount: 9),
      TimeBucket(date: DateTime(2026, 5, 1), assetCount: 9),
    ];
    final factoryHarness = _factoryForServices(
      yearService: _service([TimeBucket(date: DateTime(2026), assetCount: 9)]),
      monthService: _service([TimeBucket(date: DateTime(2026, 6), assetCount: 9)]),
      dayService: _service(dayBuckets),
    );
    addTearDown(factoryHarness.disposeServices);

    await pumpFavoritePage(tester, factoryHarness);

    expect(find.byKey(const Key('timeline-grouping-bottom-pill')), findsOneWidget);
    expect(find.byType(TimelineGroupingBottomPill), findsOneWidget);

    // Scroll-persistence guard at the page level (mirrors the album test): the pill
    // stays visible after scrolling to the end of the timeline.
    final scrollable = tester.state<ScrollableState>(find.byType(Scrollable).first);
    scrollable.position.jumpTo(scrollable.position.maxScrollExtent);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.byKey(const Key('timeline-grouping-bottom-pill')), findsOneWidget);
  });

  testWidgets('header sliver is absent from the favorites page', (tester) async {
    final factoryHarness = _factoryForServices(
      yearService: _service([TimeBucket(date: DateTime(2026), assetCount: 9)]),
      monthService: _service([TimeBucket(date: DateTime(2026, 6), assetCount: 9)]),
      dayService: _service([TimeBucket(date: DateTime(2026, 6, 1), assetCount: 9)]),
    );
    addTearDown(factoryHarness.disposeServices);

    await pumpFavoritePage(tester, factoryHarness);

    expect(find.byKey(const Key('timeline-grouping-header-sliver')), findsNothing);
  });

  testWidgets('switching grouping to month renders overview cards', (tester) async {
    await SettingsRepository.instance.write(SettingsKey.timelineGroupAssetsBy, GroupAssetsBy.day);

    // 5 month buckets — enough to populate overview cards once Months is selected.
    final monthBuckets = [
      TimeBucket(date: DateTime(2026, 6), assetCount: 9),
      TimeBucket(date: DateTime(2026, 5), assetCount: 9),
      TimeBucket(date: DateTime(2026, 4), assetCount: 9),
      TimeBucket(date: DateTime(2026, 3), assetCount: 9),
      TimeBucket(date: DateTime(2026, 2), assetCount: 9),
    ];
    final factoryHarness = _factoryForServices(
      yearService: _service([TimeBucket(date: DateTime(2026), assetCount: 9)]),
      monthService: _service(monthBuckets),
      dayService: _service([TimeBucket(date: DateTime(2026, 6, 1), assetCount: 9)]),
    );
    addTearDown(factoryHarness.disposeServices);

    await pumpFavoritePage(tester, factoryHarness);

    // Switch to Months THROUGH THE PILL (the user-facing path, not the provider shortcut).
    await tester.tap(find.byKey(const Key('timeline-grouping-months')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 600));
    await tester.pump(const Duration(milliseconds: 600));

    // Grouping is route-local on detail timelines: the persisted setting is untouched.
    expect(SettingsRepository.instance.appConfig.timeline.groupAssetsBy, GroupAssetsBy.day);
    // The timeline actually regroups: month overview cards render from the month service.
    expect(find.byType(TimelineOverviewCard), findsWidgets);
  });
}
