import 'package:easy_localization/easy_localization.dart' hide TextDirection;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/config/app_config.dart';
import 'package:immich_mobile/domain/models/config/timeline_config.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/models/timeline_temporal_scope.model.dart';
import 'package:immich_mobile/domain/models/user.model.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/domain/services/user.service.dart';
import 'package:immich_mobile/infrastructure/repositories/settings.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/timeline.repository.dart';
import 'package:immich_mobile/presentation/widgets/bottom_sheet/map_bottom_sheet.widget.dart';
import 'package:immich_mobile/presentation/widgets/map/map.state.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.widget.dart';
import 'package:immich_mobile/providers/infrastructure/readonly_mode.provider.dart';
import 'package:immich_mobile/providers/infrastructure/settings.provider.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:maplibre_gl/maplibre_gl.dart';
import 'package:mocktail/mocktail.dart';
// easy_localization initializes shared_preferences internally; tests need the mock initializer.
// ignore: depend_on_referenced_packages
import 'package:shared_preferences/shared_preferences.dart';

import '../../../test_utils.dart';
import '../../../widget_tester_extensions.dart';

class _MockTimelineFactory extends Mock implements TimelineFactory {}

class _MockSettingsRepository extends Mock implements SettingsRepository {}

class _MockUserService extends Mock implements UserService {}

class _StubReadOnlyModeNotifier extends ReadOnlyModeNotifier {
  @override
  bool build() => false;
}

class _StubCurrentUserNotifier extends CurrentUserProvider {
  _StubCurrentUserNotifier(super.service, UserDto user) {
    state = user;
  }
}

class _MutableMapStateNotifier extends MapStateNotifier {
  _MutableMapStateNotifier(this._initial);

  final MapState _initial;

  @override
  MapState build() => _initial;

  // NOTE: MapState.== compares bounds only; tests update with changed bounds
  // so the service rebuild is attributable to the simulated pan.
  void update(MapState next) => state = next;
}

UserDto _user(String id) => UserDto(id: id, email: '$id@example.com', name: id, profileChangedAt: DateTime(2024));

/// A real TimelineService over an empty bucket so the timeline renders without
/// Store/thumbnail plumbing while the grouping pill stays interactive.
TimelineService _mapService() => TimelineService((
  bucketSource: () => Stream.value([TimeBucket(date: DateTime(2024, 1), assetCount: 0)]),
  assetSource: (offset, count) async => const <BaseAsset>[],
  origin: TimelineOrigin.map,
));

typedef _Harness = ({
  _MockTimelineFactory factory,
  _MockSettingsRepository settings,
  _MutableMapStateNotifier mapNotifier,
});

Future<_Harness> _pumpMapTimeline(
  WidgetTester tester, {
  MapState? mapState,
  List<Override> extraOverrides = const [],
}) async {
  final user = _user('user-1');
  final userService = _MockUserService();
  final factory = _MockTimelineFactory();
  final settings = _MockSettingsRepository();
  final mapNotifier = _MutableMapStateNotifier(
    mapState ??
        MapState(
          bounds: LatLngBounds(northeast: const LatLng(1, 1), southwest: const LatLng(0, 0)),
        ),
  );

  when(() => userService.tryGetMyUser()).thenReturn(user);
  when(() => userService.watchMyUser()).thenAnswer((_) => const Stream<UserDto?>.empty());
  // A fresh service per call: TimelineRouteScope disposes the previous one on
  // every grouping/bounds rebuild.
  when(
    () => factory.map(
      any(),
      any(),
      any(),
      groupBy: any(named: 'groupBy'),
      temporalScope: any(named: 'temporalScope'),
    ),
  ).thenAnswer((_) => _mapService());

  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        currentUserProvider.overrideWith((ref) => _StubCurrentUserNotifier(userService, user)),
        readonlyModeProvider.overrideWith(() => _StubReadOnlyModeNotifier()),
        appConfigProvider.overrideWithValue(const AppConfig(timeline: TimelineConfig(tilesPerRow: 3))),
        settingsProvider.overrideWithValue(settings),
        timelineFactoryProvider.overrideWithValue(factory),
        mapStateProvider.overrideWith(() => mapNotifier),
        ...extraOverrides,
      ],
      // EasyLocalization must wrap the app: TimelineHeader reads context.locale,
      // which null-derefs without the widget in the tree.
      child: EasyLocalization(
        supportedLocales: const [Locale('en')],
        path: '../i18n',
        fallbackLocale: const Locale('en'),
        child: MaterialApp(home: withStubRouter(const MapBottomSheetTimeline())),
      ),
    ),
  );
  // Bounded pumps instead of pumpAndSettle: timeline loading indicators animate
  // indefinitely, so pumpAndSettle can time out.
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 600));
  return (factory: factory, settings: settings, mapNotifier: mapNotifier);
}

void main() {
  setUpAll(() async {
    TestUtils.init();
    SharedPreferences.setMockInitialValues({});
    await EasyLocalization.ensureInitialized();
    await initializeDateFormatting('en');
    registerFallbackValue(
      TimelineMapOptions(
        bounds: LatLngBounds(northeast: const LatLng(0, 0), southwest: const LatLng(0, 0)),
      ),
    );
    registerFallbackValue(const TimelineTemporalScope.none());
    registerFallbackValue(GroupAssetsBy.day);
  });

  testWidgets('opens at All grouping with the grouping pill and no forced groupBy', (tester) async {
    final harness = await _pumpMapTimeline(tester);

    verify(
      () => harness.factory.map(
        ['user-1'],
        'user-1',
        any(),
        groupBy: GroupAssetsBy.day,
        temporalScope: const TimelineTemporalScope.none(),
      ),
    ).called(1);
    // Grouping must come from the route-scoped provider, not a Timeline override.
    expect(tester.widget<Timeline>(find.byType(Timeline)).groupBy, isNull);
    expect(find.byKey(const Key('timeline-grouping-bottom-pill')), findsOneWidget);
  });

  testWidgets('tapping Months regroups the map timeline without persisting the setting', (tester) async {
    final harness = await _pumpMapTimeline(tester);

    await tester.tap(find.byKey(const Key('timeline-grouping-months')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 600));

    verify(
      () => harness.factory.map(
        ['user-1'],
        'user-1',
        any(),
        groupBy: GroupAssetsBy.month,
        temporalScope: any(named: 'temporalScope'),
      ),
    ).called(1);
    // Route-local grouping: the map sheet must never persist the grouping setting.
    verifyNever(() => harness.settings.write(SettingsKey.timelineGroupAssetsBy, any<GroupAssetsBy>()));
  });

  testWidgets('withPartners includes partner ids in the map service users', (tester) async {
    final harness = await _pumpMapTimeline(
      tester,
      mapState: MapState(
        bounds: LatLngBounds(northeast: const LatLng(1, 1), southwest: const LatLng(0, 0)),
        withPartners: true,
      ),
      extraOverrides: [
        timelineUsersProvider.overrideWith((_) => Stream<List<String>>.value(['user-1', 'partner-1'])),
      ],
    );

    // The first build may run before the users stream emits (falls back to
    // [user.id]); once it emits, the service must rebuild with both ids.
    verify(
      () => harness.factory.map(
        ['user-1', 'partner-1'],
        'user-1',
        any(),
        groupBy: GroupAssetsBy.day,
        temporalScope: any(named: 'temporalScope'),
      ),
    ).called(1);
  });

  testWidgets('grouping selection survives a map move', (tester) async {
    final harness = await _pumpMapTimeline(tester);

    await tester.tap(find.byKey(const Key('timeline-grouping-months')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 600));
    verify(
      () => harness.factory.map(
        any(),
        any(),
        any(),
        groupBy: GroupAssetsBy.month,
        temporalScope: any(named: 'temporalScope'),
      ),
    ).called(1);

    // Pan the map: new bounds rebuild the service, but the route-local grouping
    // must stay at month — a bounds change must not tear down the route scope.
    harness.mapNotifier.update(
      MapState(
        bounds: LatLngBounds(northeast: const LatLng(2, 2), southwest: const LatLng(1, 1)),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 600));

    // The verify above consumed the tap-triggered call, so this counts only the
    // bounds-triggered rebuild.
    verify(
      () => harness.factory.map(
        any(),
        any(),
        any(),
        groupBy: GroupAssetsBy.month,
        temporalScope: any(named: 'temporalScope'),
      ),
    ).called(1);
  });
}
