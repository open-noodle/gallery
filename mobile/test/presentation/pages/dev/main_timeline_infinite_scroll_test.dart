import 'dart:io';

import 'package:drift/drift.dart' show DatabaseConnection;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/search_result.model.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/models/user.model.dart';
import 'package:immich_mobile/domain/services/feature_message.service.dart';
import 'package:immich_mobile/domain/services/search.service.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/domain/services/user.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/settings.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/presentation/pages/dev/main_timeline.page.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/providers/feature_message.provider.dart';
import 'package:immich_mobile/providers/infrastructure/db.provider.dart';
import 'package:immich_mobile/providers/infrastructure/search.provider.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/infrastructure/user.provider.dart' as infra;
import 'package:immich_mobile/providers/photos_filter/filter_count.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter_search.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:mocktail/mocktail.dart';

import '../../../mock_http_override.dart';
import '../../../test_utils.dart';
import '../../../widget_tester_extensions.dart';

class _MockSearch extends Mock implements SearchService {}

class _MockApiService extends Mock implements ApiService {}

class _MockUserService extends Mock implements UserService {}

class _FakeFilter extends Fake implements SearchFilter {}

// Upstream #29388 shows a "what's new" dialog from MainTimelinePage.initState when
// FeatureMessageService.shouldShow() is true. Stub it off so the dialog does not
// fire (and throw on unmocked deps) during these fork timeline widget tests.
class _StubFeatureMessageService implements FeatureMessageService {
  @override
  bool shouldShow() => false;

  @override
  Future<void> markSeen() async {}
}

class _StubUserNotifier extends CurrentUserProvider {
  _StubUserNotifier(super.service, UserDto? initial) {
    state = initial;
  }
}

final _testUser = UserDto(
  id: 'test-user-1',
  email: 'test@example.com',
  name: 'Test User',
  profileChangedAt: DateTime(2024, 1, 1),
);

List<BaseAsset> _assets(int n, String tag) =>
    List<BaseAsset>.generate(n, (i) => TestUtils.createRemoteAsset(id: '$tag-$i'));

ProviderContainer _makeContainer({required SearchService search, required Drift db, UserDto? user}) {
  final mockUserSvc = _MockUserService();
  when(() => mockUserSvc.tryGetMyUser()).thenReturn(user);
  when(() => mockUserSvc.watchMyUser()).thenAnswer((_) => const Stream.empty());
  return ProviderContainer(
    overrides: [
      driftProvider.overrideWithValue(db),
      searchServiceProvider.overrideWithValue(search),
      apiServiceProvider.overrideWithValue(_MockApiService()),
      infra.userServiceProvider.overrideWithValue(mockUserSvc),
      currentUserProvider.overrideWith((ref) => _StubUserNotifier(mockUserSvc, user)),
      timelineUsersProvider.overrideWith((_) => user == null ? const Stream.empty() : Stream.value([user.id])),
      photosFilterCountProvider.overrideWith((ref) => 0),
      featureMessageServiceProvider.overrideWithValue(_StubFeatureMessageService()),
    ],
  );
}

void main() {
  late Drift db;
  setUpAll(() async {
    HttpOverrides.global = MockHttpOverrides();
    registerFallbackValue(_FakeFilter());
    db = Drift(DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: StoreRepository(db));
    await SettingsRepository.ensureInitialized(db);
    await Store.put(StoreKey.serverEndpoint, 'http://localhost:0');
  });
  tearDownAll(() => db.close());

  testWidgets('scrolling the search results loads the next page', (tester) async {
    tester.view.physicalSize = const Size(1080, 2340);
    tester.view.devicePixelRatio = 2.75;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    // In tests without EasyLocalization the match-count label renders the
    // raw i18n key string which overflows the filter-subheader Row. Suppress
    // that known layout-overflow exception so the scroll assertion can run.
    final prevOnError = FlutterError.onError;
    FlutterError.onError = (details) {
      if (details.exception.toString().contains('overflowed')) {
        return;
      }
      prevOnError?.call(details);
    };
    addTearDown(() => FlutterError.onError = prevOnError);

    final search = _MockSearch();
    when(() => search.search(any(), 1)).thenAnswer((_) async => SearchResult(assets: _assets(100, 'p1'), nextPage: 2));
    when(() => search.search(any(), 2)).thenAnswer((_) async => SearchResult(assets: _assets(100, 'p2'), nextPage: 3));
    when(
      () => search.search(any(), 3),
    ).thenAnswer((_) async => SearchResult(assets: _assets(40, 'p3'), nextPage: null));

    final container = _makeContainer(search: search, db: db, user: _testUser);
    // NB: disposed explicitly at the end of the body (not via addTearDown) so the
    // memory provider's midnight-refresh Timer (upstream #28983) is cancelled before
    // testWidgets' pending-timer check, which runs before tearDowns.

    await tester.pumpWidget(
      localizedForTest(
        UncontrolledProviderScope(
          container: container,
          child: const MaterialApp(home: MainTimelinePage()),
        ),
      ),
    );
    await tester.pump();
    container.read(photosFilterProvider.notifier).setText('nature');
    for (var i = 0; i < 30; i++) {
      await tester.pump(const Duration(milliseconds: 40));
    }
    // The Photos timeline drives its live search through the route-scoped
    // photosFilterSearchProvider (TimelineRouteScope), so observe the same scoped
    // instance the page renders rather than the root container's.
    ProviderContainer scoped() =>
        ProviderScope.containerOf(tester.element(find.byType(CustomScrollView).last), listen: false);
    expect(scoped().read(photosFilterSearchProvider).assets.length, 100);

    for (var c = 0; c < 4; c++) {
      await tester.fling(find.byType(CustomScrollView).last, const Offset(0, -3000), 4000);
      for (var i = 0; i < 12; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }
    }
    expect(scoped().read(photosFilterSearchProvider).assets.length, greaterThan(100));
    verify(() => search.search(any(), 2)).called(greaterThanOrEqualTo(1));

    // Tear the tree down inside the test so the route ProviderScope's autoDispose
    // scheduler timer (the search lives in TimelineRouteScope now) fires here rather
    // than outliving the widget tree. Advance fake time so the 0-duration timer runs.
    await tester.pumpWidget(localizedForTest(const SizedBox.shrink()));
    await tester.pump(const Duration(seconds: 1));
    // Dispose the container so provider timers — incl. the memory provider's
    // midnight-refresh Timer (upstream #28983) — are cancelled before the
    // pending-timer check rather than outliving the test via addTearDown.
    container.dispose();
  });

  testWidgets('empty filter (library timeline) fires no search on scroll', (tester) async {
    tester.view.physicalSize = const Size(1080, 2340);
    tester.view.devicePixelRatio = 2.75;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final search = _MockSearch();
    final container = _makeContainer(search: search, db: db);
    addTearDown(container.dispose);

    await tester.pumpWidget(
      localizedForTest(
        UncontrolledProviderScope(
          container: container,
          child: const MaterialApp(home: MainTimelinePage()),
        ),
      ),
    );
    for (var c = 0; c < 3; c++) {
      await tester.fling(find.byType(CustomScrollView).last, const Offset(0, -3000), 4000);
      for (var i = 0; i < 8; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }
    }
    verifyNever(() => search.search(any(), any()));
  });
}
