import 'dart:async';
import 'dart:convert';

import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/data/db/main/database.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/config/app_config.dart';
import 'package:immich_mobile/domain/models/config/timeline_config.dart';
import 'package:immich_mobile/domain/models/search_result.model.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/models/timeline_temporal_scope.model.dart';
import 'package:immich_mobile/domain/models/user.model.dart';
import 'package:immich_mobile/domain/services/search.service.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/domain/services/user.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/settings.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_empty_state.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_route_scope.dart';
import 'package:immich_mobile/providers/infrastructure/db.provider.dart';
import 'package:immich_mobile/providers/infrastructure/search.provider.dart';
import 'package:immich_mobile/providers/infrastructure/settings.provider.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/infrastructure/user.provider.dart' as infra;
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:immich_mobile/providers/photos_filter/timeline_query.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:immich_mobile/widgets/common/immich_loading_indicator.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:mocktail/mocktail.dart';
// easy_localization initializes shared_preferences internally; tests need the mock initializer.
// ignore: depend_on_referenced_packages
import 'package:shared_preferences/shared_preferences.dart';

import '../../../test_utils.dart';
import '../../../widget_tester_extensions.dart';

class _MockTimelineFactory extends Mock implements TimelineFactory {}

class _MockUserService extends Mock implements UserService {}

class _MockSearchService extends Mock implements SearchService {}

class _FakeSearchFilter extends Fake implements SearchFilter {}

/// Yields a fixed [SearchFilter] from build() so the 800 ms timeline debounce
/// picks it up on its first read instead of a timer later.
class _FixedFilter extends PhotosFilterNotifier {
  _FixedFilter(this._initial);

  final SearchFilter _initial;

  @override
  SearchFilter build() => _initial;
}

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
    if (key.startsWith('AssetManifest')) {
      return _emptyManifest;
    }
    return ByteData.view(Uint8List.fromList(_transparentPng).buffer);
  }
}

TimelineService _service({required List<Bucket> buckets, required List<BaseAsset> assets}) {
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
        child: withStubRouter(
          MaterialApp(
            home: DefaultAssetBundle(
              bundle: _FakeAssetBundle(),
              child: const TimelineRouteScope(
                timelineServiceBuilder: buildPhotosTimelineRouteService,
                child: Timeline(
                  appBar: null,
                  bottomSheet: null,
                  withScrubber: false,
                  emptyWidget: TimelineEmptyState(),
                ),
              ),
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

/// Wires the REAL search chain behind an active photos filter:
///   SearchService (mocked at the network boundary) → photosFilterSearchProvider
///   (real, scoped by TimelineRouteScope) → TimelineFactory.fromAssetStream
///   (real) → TimelineService → Timeline → TimelineEmptyState.
///
/// `fromAssetStream` emits an empty bucket list immediately, so the empty state is
/// built while page 1 is still in flight — the #901 window. Returns the completer
/// that lets the test decide when (and with what) the search answers.
Future<Completer<SearchResult?>> _pumpSearchingTimeline(WidgetTester tester, Drift db) async {
  final completer = Completer<SearchResult?>();
  final search = _MockSearchService();
  when(() => search.search(any(), any())).thenAnswer((_) => completer.future);

  final user = _testUser();
  final userService = _MockUserService();
  when(() => userService.tryGetMyUser()).thenReturn(user);
  when(() => userService.watchMyUser()).thenAnswer((_) => const Stream<UserDto?>.empty());

  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        appConfigProvider.overrideWithValue(const AppConfig(timeline: TimelineConfig(tilesPerRow: 3))),
        driftProvider.overrideWithValue(db),
        searchServiceProvider.overrideWithValue(search),
        infra.userServiceProvider.overrideWithValue(userService),
        currentUserProvider.overrideWith((ref) => _StubCurrentUserNotifier(userService, user)),
        timelineUsersProvider.overrideWith((_) => Stream<List<String>>.value([user.id])),
        photosFilterProvider.overrideWith(() => _FixedFilter(SearchFilter.empty().copyWith(context: 'mountain'))),
      ],
      child: EasyLocalization(
        supportedLocales: const [Locale('en')],
        path: '../i18n',
        fallbackLocale: const Locale('en'),
        child: withStubRouter(
          MaterialApp(
            home: DefaultAssetBundle(
              bundle: _FakeAssetBundle(),
              child: const TimelineRouteScope(
                timelineServiceBuilder: buildPhotosTimelineRouteService,
                child: Timeline(
                  appBar: null,
                  bottomSheet: null,
                  withScrubber: false,
                  emptyWidget: TimelineEmptyState(),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
  // Not pumpAndSettle: the loading indicator animates forever.
  for (var i = 0; i < 5; i++) {
    await tester.pump(const Duration(milliseconds: 50));
  }
  return completer;
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
    registerFallbackValue(_FakeSearchFilter());
    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: StoreRepository(db), listenUpdates: false);
    await SettingsRepository.ensureInitialized(db);
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

  group('filtered search empty state (#901)', () {
    testWidgets('holds a loader while page 1 is in flight, then falls back to the no-results state', (tester) async {
      final completer = await _pumpSearchingTimeline(tester, db);

      // The search-backed service already emitted its (empty) bucket list, so the
      // empty state is on screen — but the server has not answered yet, so it must
      // not claim there is nothing to find.
      expect(find.byType(TimelineEmptyState), findsOneWidget);
      expect(find.byType(ImmichLoadingIndicator), findsOneWidget);
      expect(find.byIcon(Icons.search_off_rounded), findsNothing);

      // Server answers with no matches: now the no-results state is the truth.
      completer.complete(null);
      await tester.pump();
      await tester.pump();

      expect(find.byType(ImmichLoadingIndicator), findsNothing);
      expect(find.byIcon(Icons.search_off_rounded), findsOneWidget);

      // Tear the tree down inside the test so Riverpod's autoDispose scheduler
      // timer fires here rather than tripping the "timer still pending" invariant.
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
    });
  });
}
