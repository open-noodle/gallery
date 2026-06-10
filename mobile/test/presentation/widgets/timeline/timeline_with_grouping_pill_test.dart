import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/models/timeline_temporal_scope.model.dart';
import 'package:immich_mobile/domain/models/user.model.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
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
import 'package:immich_mobile/providers/timeline/multiselect.provider.dart';
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

UserDto _testUser() =>
    UserDto(id: 'user-1', email: 'user-1@example.com', name: 'user-1', profileChangedAt: DateTime(2024));

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

  group('Timeline.withGroupingPill', () {
    testWidgets('withGroupingPill renders the pill overlay', (tester) async {
      await _pumpTimeline(tester, withGroupingPill: true);

      expect(find.byKey(const Key('timeline-grouping-bottom-pill')), findsOneWidget);
    });

    testWidgets('withGroupingPill adds pill clearance to the content bottom padding', (tester) async {
      await _pumpTimeline(tester, withGroupingPill: false);
      final extentWithout = tester.state<ScrollableState>(find.byType(Scrollable).first).position.maxScrollExtent;

      await _pumpTimeline(tester, withGroupingPill: true);
      final extentWith = tester.state<ScrollableState>(find.byType(Scrollable).first).position.maxScrollExtent;

      // pillHeight(58) + bottomFloat(26) = 84 extra clearance when the flag is on.
      expect(extentWith - extentWithout, closeTo(84, 0.5));
    });

    testWidgets('default (false) renders no pill and no clearance — existing callers unchanged', (tester) async {
      // Pump the flag-on timeline first to get a baseline extent with 84 padding.
      await _pumpTimeline(tester, withGroupingPill: true);
      final extentWith = tester.state<ScrollableState>(find.byType(Scrollable).first).position.maxScrollExtent;

      // Now pump flag-off: no pill visible, no extra clearance.
      await _pumpTimeline(tester, withGroupingPill: false);
      expect(find.byKey(const Key('timeline-grouping-bottom-pill')), findsNothing);
      final extentWithout = tester.state<ScrollableState>(find.byType(Scrollable).first).position.maxScrollExtent;

      // The scroll extent must be 84 less with the flag off (exactly the pill clearance removed).
      expect(extentWith - extentWithout, closeTo(84, 0.5));
    });

    testWidgets('multiselect with the flag on: pill hides, clearance stays constant (+120 modifier), '
        'then reset restores pill and clearance', (tester) async {
      // Pass bottomSheet: null so the GeneralBottomSheet (which needs extra providers)
      // is not rendered — assertions are about the pill and the SliverPadding only.
      await _pumpTimeline(tester, withGroupingPill: true, bottomSheet: null);

      // Capture the baseline scroll extent (pill clearance only, no multiselect).
      final extentBase = tester.state<ScrollableState>(find.byType(Scrollable).first).position.maxScrollExtent;

      // Enable multiselect by selecting an asset via the scoped container.
      final container = ProviderScope.containerOf(tester.element(find.byType(Timeline)));
      final asset = TestUtils.createRemoteAsset(id: 'test-asset');
      container.read(multiSelectProvider.notifier).selectAsset(asset);
      await tester.pumpAndSettle();

      // Pill is hidden while multiselect is active.
      expect(tester.widget<AnimatedOpacity>(find.byKey(const Key('timeline-grouping-bottom-pill-opacity'))).opacity, 0);
      // 84 clearance + 120 bottomSheetOpenModifier = 204 → scroll extent grows by 120 vs baseline.
      final extentMultiselect = tester.state<ScrollableState>(find.byType(Scrollable).first).position.maxScrollExtent;
      // extentMultiselect = content + 84 + 120 = extentWith + 120
      expect(extentMultiselect - extentBase, closeTo(120, 0.5));

      // Exit multiselect → pill returns, clearance back to 84.
      container.read(multiSelectProvider.notifier).reset();
      await tester.pumpAndSettle();

      expect(tester.widget<AnimatedOpacity>(find.byKey(const Key('timeline-grouping-bottom-pill-opacity'))).opacity, 1);
      final extentAfterReset = tester.state<ScrollableState>(find.byType(Scrollable).first).position.maxScrollExtent;
      expect(extentAfterReset, closeTo(extentBase, 0.5));
    });
  });
}

TimelineService _service() {
  final assets = <BaseAsset>[for (var i = 0; i < 4; i++) TestUtils.createRemoteAsset(id: 'asset-$i')];

  return TimelineService((
    bucketSource: () => Stream.value([TimeBucket(date: DateTime(2025, 1), assetCount: 4)]),
    assetSource: (offset, count) async {
      final end = (offset + count).clamp(0, assets.length).toInt();
      if (offset >= end) return const <BaseAsset>[];
      return assets.sublist(offset, end);
    },
    origin: TimelineOrigin.main,
  ));
}

/// Pumps a real [Timeline]. NOTE: [bottomSheet] defaults to null (NO sheet) — unlike
/// [Timeline]'s own default GeneralBottomSheet — so tests stay free of the sheet's providers.
Future<void> _pumpTimeline(WidgetTester tester, {required bool withGroupingPill, Widget? bottomSheet}) async {
  final service = _service();
  final factory = _MockTimelineFactory();
  when(
    () => factory.main(
      any(),
      any(),
      groupBy: any(named: 'groupBy'),
      temporalScope: any(named: 'temporalScope'),
    ),
  ).thenReturn(service);

  final user = _testUser();
  final userService = _MockUserService();
  when(() => userService.tryGetMyUser()).thenReturn(user);
  when(() => userService.watchMyUser()).thenAnswer((_) => const Stream<UserDto?>.empty());

  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        timelineFactoryProvider.overrideWithValue(factory),
        infra.userServiceProvider.overrideWithValue(userService),
        currentUserProvider.overrideWith((ref) => _StubCurrentUserNotifier(userService, user)),
        timelineUsersProvider.overrideWith((_) => Stream<List<String>>.value([user.id])),
      ],
      child: EasyLocalization(
        supportedLocales: const [Locale('en')],
        path: '../i18n',
        fallbackLocale: const Locale('en'),
        child: MaterialApp(
          home: TimelineRouteScope(
            timelineServiceBuilder: buildPhotosTimelineRouteService,
            child: Timeline(
              appBar: null,
              bottomSheet: bottomSheet,
              withScrubber: false,
              withGroupingPill: withGroupingPill,
            ),
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();

  addTearDown(service.dispose);
}
