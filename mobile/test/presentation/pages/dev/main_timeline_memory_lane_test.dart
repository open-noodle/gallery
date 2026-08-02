import 'dart:io';

import 'package:drift/drift.dart' show DatabaseConnection;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/memory.model.dart';
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
import 'package:immich_mobile/presentation/widgets/memory/memory_lane.widget.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/providers/feature_message.provider.dart';
import 'package:immich_mobile/providers/infrastructure/db.provider.dart';
import 'package:immich_mobile/providers/infrastructure/memory.provider.dart';
import 'package:immich_mobile/providers/infrastructure/search.provider.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/infrastructure/user.provider.dart' as infra;
import 'package:immich_mobile/providers/photos_filter/filter_count.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:mocktail/mocktail.dart';

import '../../../mock_http_override.dart';
import '../../../test_utils.dart';

class _MockSearch extends Mock implements SearchService {}

class _MockApiService extends Mock implements ApiService {}

class _MockUserService extends Mock implements UserService {}

class _FakeFilter extends Fake implements SearchFilter {}

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

DriftMemory _memory() => DriftMemory(
  id: 'memory-1',
  createdAt: DateTime(2024),
  updatedAt: DateTime(2024),
  ownerId: _testUser.id,
  type: MemoryTypeEnum.onThisDay,
  data: const MemoryData({'year': 2019}),
  isSaved: false,
  memoryAt: DateTime(2019, 8, 1),
  assets: [TestUtils.createRemoteAsset(id: 'memory-asset-1')],
);

ProviderContainer _makeContainer({required SearchService search, required Drift db}) {
  final mockUserSvc = _MockUserService();
  when(() => mockUserSvc.tryGetMyUser()).thenReturn(_testUser);
  when(() => mockUserSvc.watchMyUser()).thenAnswer((_) => const Stream.empty());
  return ProviderContainer(
    overrides: [
      driftProvider.overrideWithValue(db),
      searchServiceProvider.overrideWithValue(search),
      apiServiceProvider.overrideWithValue(_MockApiService()),
      infra.userServiceProvider.overrideWithValue(mockUserSvc),
      currentUserProvider.overrideWith((ref) => _StubUserNotifier(mockUserSvc, _testUser)),
      timelineUsersProvider.overrideWith((_) => Stream.value([_testUser.id])),
      photosFilterCountProvider.overrideWith((ref) => 0),
      featureMessageServiceProvider.overrideWithValue(_StubFeatureMessageService()),
      driftMemoryFutureProvider.overrideWith((ref) async => [_memory()]),
    ],
  );
}

void main() {
  late Drift db;

  setUpAll(() async {
    HttpOverrides.global = MockHttpOverrides();
    registerFallbackValue(_FakeFilter());
    db = Drift(DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: DriftStoreRepository(db));
    await SettingsRepository.ensureInitialized(db);
    await Store.put(StoreKey.serverEndpoint, 'http://localhost:0');
  });
  tearDownAll(() => db.close());

  // #902 — web's photos page renders the memories carousel only while browsing
  // (`!hasActiveFilters`), so search results start at the top of the viewport
  // instead of being pushed down by a strip that is irrelevant to the query.
  testWidgets('the memories strip drops out of the timeline while a search is active', (tester) async {
    tester.view.physicalSize = const Size(1080, 2340);
    tester.view.devicePixelRatio = 2.75;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    // Without EasyLocalization the filter subheader renders raw i18n keys, which
    // overflow its Row. Suppress that known layout overflow (same as the
    // infinite-scroll test) so the widget assertions can run.
    final prevOnError = FlutterError.onError;
    FlutterError.onError = (details) {
      if (details.exception.toString().contains('overflowed')) return;
      prevOnError?.call(details);
    };
    addTearDown(() => FlutterError.onError = prevOnError);

    final search = _MockSearch();
    when(() => search.search(any(), any())).thenAnswer((_) async => const SearchResult(assets: [], nextPage: null));

    final container = _makeContainer(search: search, db: db);

    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: const MaterialApp(home: MainTimelinePage()),
      ),
    );
    for (var i = 0; i < 10; i++) {
      await tester.pump(const Duration(milliseconds: 40));
    }
    expect(find.byType(DriftMemoryLane), findsOneWidget, reason: 'browsing an unfiltered timeline shows memories');

    container.read(photosFilterProvider.notifier).setText('beach');
    for (var i = 0; i < 30; i++) {
      await tester.pump(const Duration(milliseconds: 40));
    }
    expect(find.byType(DriftMemoryLane), findsNothing, reason: 'a search result set is not a place for memories');

    container.read(photosFilterProvider.notifier).reset();
    for (var i = 0; i < 30; i++) {
      await tester.pump(const Duration(milliseconds: 40));
    }
    expect(find.byType(DriftMemoryLane), findsOneWidget, reason: 'clearing the search restores the strip');

    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump(const Duration(seconds: 1));
    container.dispose();
  });
}
