import 'dart:convert';

import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/config/app_config.dart';
import 'package:immich_mobile/domain/models/config/timeline_config.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/models/timeline_temporal_scope.model.dart';
import 'package:immich_mobile/domain/models/user.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/domain/services/user.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_empty_state.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_route_scope.dart';
import 'package:immich_mobile/providers/infrastructure/settings.provider.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/infrastructure/user.provider.dart' as infra;
import 'package:immich_mobile/providers/photos_filter/timeline_query.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:immich_mobile/widgets/common/immich_loading_indicator.dart';
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

/// 1×1 transparent PNG so the empty-state polaroid resolves under `flutter test`,
/// which does not bundle app assets.
final _transparentPng = base64Decode(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
);

class _FakeAssetBundle extends CachingAssetBundle {
  final ByteData _emptyManifest = const StandardMessageCodec().encodeMessage(<String, Object>{})!;

  @override
  Future<ByteData> load(String key) async {
    if (key.startsWith('AssetManifest')) return _emptyManifest;
    return ByteData.view(Uint8List.fromList(_transparentPng).buffer);
  }
}

TimelineService _service({required List<Bucket> buckets, required List<BaseAsset> assets}) {
  return TimelineService((
    bucketSource: () => Stream.value(buckets),
    assetSource: (offset, count) async {
      final end = (offset + count).clamp(0, assets.length);
      if (offset >= end) return const <BaseAsset>[];
      return assets.sublist(offset, end);
    },
    origin: TimelineOrigin.main,
  ));
}

Future<TimelineService> _pumpTimeline(
  WidgetTester tester, {
  required List<Bucket> buckets,
  required List<BaseAsset> assets,
}) async {
  final service = _service(buckets: buckets, assets: assets);
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
        appConfigProvider.overrideWithValue(const AppConfig(timeline: TimelineConfig(tilesPerRow: 3))),
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
          home: DefaultAssetBundle(
            bundle: _FakeAssetBundle(),
            child: const TimelineRouteScope(
              timelineServiceBuilder: buildPhotosTimelineRouteService,
              child: Timeline(appBar: null, bottomSheet: null, withScrubber: false, emptyWidget: TimelineEmptyState()),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();

  addTearDown(service.dispose);
  return service;
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
  });

  setUp(() async {
    await Store.clear();
    await Store.put(StoreKey.serverEndpoint, 'http://test-server');
  });

  tearDownAll(() async {
    await Store.clear();
    await db.close();
  });

  group('Timeline emptyWidget wiring', () {
    testWidgets('renders the empty state when the timeline resolves to zero buckets', (tester) async {
      await _pumpTimeline(tester, buckets: const <Bucket>[], assets: const <BaseAsset>[]);

      // onData resolved (not stuck loading) and the caller's empty state is shown,
      // including its Enable Backup CTA. (Asserting on widget types rather than
      // translated copy: `flutter test` does not bundle the root i18n files.)
      expect(find.byType(ImmichLoadingIndicator), findsNothing);
      expect(find.byType(TimelineEmptyState), findsOneWidget);
      expect(find.byType(FilledButton), findsOneWidget);
    });

    testWidgets('renders the grid, not the empty state, when the timeline has assets', (tester) async {
      final assets = [for (var i = 0; i < 4; i++) TestUtils.createRemoteAsset(id: 'asset-$i')];

      await _pumpTimeline(
        tester,
        buckets: <Bucket>[TimeBucket(date: DateTime(2025, 1), assetCount: 4)],
        assets: assets,
      );

      // onData resolved with a non-empty grid: neither the loader nor the empty state.
      expect(find.byType(ImmichLoadingIndicator), findsNothing);
      expect(find.byType(TimelineEmptyState), findsNothing);
    });
  });
}
