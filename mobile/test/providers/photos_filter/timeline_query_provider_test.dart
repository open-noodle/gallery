import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/search_result.model.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/models/timeline_temporal_scope.model.dart';
import 'package:immich_mobile/domain/models/user.model.dart';
import 'package:immich_mobile/domain/services/search.service.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/domain/services/user.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/settings.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_route_scope.dart';
import 'package:immich_mobile/providers/infrastructure/search.provider.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/infrastructure/user.provider.dart' as infra;
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:immich_mobile/providers/photos_filter/timeline_query.provider.dart';
import 'package:immich_mobile/providers/sync_status.provider.dart';
import 'package:immich_mobile/providers/timeline/temporal_scope.provider.dart';
import 'package:immich_mobile/providers/timeline/timeline_grouping.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:mocktail/mocktail.dart';

class _MockFactory extends Mock implements TimelineFactory {}

class _MockSearch extends Mock implements SearchService {}

class _FakeService extends Fake implements TimelineService {
  @override
  TimelineOrigin get origin => TimelineOrigin.main;

  bool disposed = false;
  @override
  Future<void> dispose() async {
    disposed = true;
  }
}

class _FakeFilter extends Fake implements SearchFilter {}

class _MockUserService extends Mock implements UserService {}

UserDto _user(String id) => UserDto(id: id, email: '$id@example.com', name: id, profileChangedAt: DateTime(2024, 1, 1));

class _StubCurrentUserNotifier extends CurrentUserProvider {
  _StubCurrentUserNotifier(super.service, UserDto? initial) {
    state = initial;
  }
}

ProviderContainer _container({required TimelineFactory factory, required SearchService search, UserDto? user}) {
  final mockUserSvc = _MockUserService();
  when(() => mockUserSvc.tryGetMyUser()).thenReturn(user);
  when(() => mockUserSvc.watchMyUser()).thenAnswer((_) => const Stream<UserDto?>.empty());

  return ProviderContainer(
    overrides: [
      timelineFactoryProvider.overrideWithValue(factory),
      searchServiceProvider.overrideWithValue(search),
      infra.userServiceProvider.overrideWithValue(mockUserSvc),
      currentUserProvider.overrideWith((ref) => _StubCurrentUserNotifier(mockUserSvc, user)),
      timelineUsersProvider.overrideWith((_) => Stream<List<String>>.value(user == null ? <String>[] : [user.id])),
    ],
  );
}

void main() {
  late Drift db;

  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    registerFallbackValue(_FakeFilter());
    registerFallbackValue(TimelineOrigin.main);
    registerFallbackValue(const TimelineTemporalScope.none());
    registerFallbackValue(() => const <BaseAsset>[]);
    registerFallbackValue(const Stream<int>.empty());
    registerFallbackValue(GroupAssetsBy.day);
    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await SettingsRepository.ensureInitialized(db);
    await StoreService.init(storeRepository: DriftStoreRepository(db), listenUpdates: false);
  });

  setUp(() async {
    await Store.clear();
    await SettingsRepository.instance.clear(SettingsKey.values);
  });

  tearDownAll(() async {
    await Store.clear();
    await SettingsRepository.instance.clear(SettingsKey.values);
    await db.close();
  });

  group('photosTimelineQueryProvider', () {
    test('empty filter → delegates to main-library service', () async {
      final factory = _MockFactory();
      final search = _MockSearch();
      final fake = _FakeService();
      when(() => factory.main(any(), any())).thenReturn(fake);

      final container = _container(factory: factory, search: search, user: _user('u1'));
      addTearDown(container.dispose);

      final svc = container.read(photosTimelineQueryProvider);
      expect(svc, same(fake));
      verify(() => factory.main(any(), 'u1')).called(1);
      verifyNever(() => search.search(any(), any()));
    });

    test('pre-login (no user) + non-empty filter → delegates to main-library service (no search)', () async {
      final factory = _MockFactory();
      final search = _MockSearch();
      final fake = _FakeService();
      when(() => factory.main(any(), any())).thenReturn(fake);

      final container = _container(factory: factory, search: search, user: null);
      container.read(photosFilterProvider.notifier).setText('paris');
      addTearDown(container.dispose);

      final svc = container.read(photosTimelineQueryProvider);
      expect(svc, same(fake));
      verifyNever(() => search.search(any(), any()));
    });

    test('non-empty filter + logged-in → builds search-backed service via fromAssetStream', () async {
      final factory = _MockFactory();
      final search = _MockSearch();
      final fake = _FakeService();
      when(() => search.search(any(), 1)).thenAnswer((_) async => const SearchResult(assets: []));
      when(
        () => factory.fromAssetStream(
          any(),
          any(),
          TimelineOrigin.search,
          groupBy: any(named: 'groupBy'),
          descending: any(named: 'descending'),
        ),
      ).thenReturn(fake);

      final container = _container(factory: factory, search: search, user: _user('u1'));
      container.read(photosFilterProvider.notifier).setText('paris');
      addTearDown(container.dispose);

      final svc = container.read(photosTimelineQueryProvider);
      expect(svc, same(fake));
      await Future<void>.delayed(const Duration(milliseconds: 5));
      verify(() => search.search(any(), 1)).called(1);
      verify(
        () => factory.fromAssetStream(
          any(),
          any(),
          TimelineOrigin.search,
          groupBy: any(named: 'groupBy'),
          descending: any(named: 'descending'),
        ),
      ).called(1);
    });

    test('remote content change does NOT re-fire the search-backed timeline', () async {
      final factory = _MockFactory();
      final search = _MockSearch();
      final fake = _FakeService();
      when(() => search.search(any(), 1)).thenAnswer((_) async => const SearchResult(assets: []));
      when(() => factory.groupBy).thenReturn(GroupAssetsBy.month);
      when(
        () => factory.fromAssetStream(
          any(),
          any(),
          TimelineOrigin.search,
          groupBy: any(named: 'groupBy'),
          descending: any(named: 'descending'),
        ),
      ).thenReturn(fake);

      final container = _container(factory: factory, search: search, user: _user('u1'));
      await container.read(timelineUsersProvider.future);
      container.read(photosFilterProvider.notifier).setNotInAlbum(true);
      addTearDown(container.dispose);

      container.read(photosTimelineQueryProvider);
      await Future<void>.delayed(const Duration(milliseconds: 5));
      // Exactly one search call for the initial query.
      verify(() => search.search(any(), 1)).called(1);

      // Remote-content changes must NOT rebuild/reset the search-backed timeline
      // (search results are a server snapshot; they refresh only when the query changes).
      container.read(syncStatusProvider.notifier).markRemoteContentChanged();
      container.read(photosTimelineQueryProvider);
      await Future<void>.delayed(const Duration(milliseconds: 5));

      verifyNever(() => search.search(any(), any()));
    });

    test('temporal scope alone makes the Photos timeline search-backed with date bounds', () async {
      final factory = _MockFactory();
      final search = _MockSearch();
      final fake = _FakeService();
      SearchFilter? captured;
      when(() => search.search(any(), 1)).thenAnswer((invocation) async {
        captured = invocation.positionalArguments.first as SearchFilter;
        return const SearchResult(assets: []);
      });
      when(() => factory.groupBy).thenReturn(GroupAssetsBy.month);
      when(
        () => factory.fromAssetStream(
          any(),
          any(),
          TimelineOrigin.search,
          groupBy: any(named: 'groupBy'),
          descending: any(named: 'descending'),
        ),
      ).thenReturn(fake);

      final container = _container(factory: factory, search: search, user: _user('u1'));
      container.read(timelineTemporalScopeProvider.notifier).setYear(2025);
      addTearDown(container.dispose);

      final svc = container.read(photosTimelineQueryProvider);
      expect(svc, same(fake));
      await Future<void>.delayed(const Duration(milliseconds: 5));

      expect(captured, isNotNull);
      expect(captured!.date.takenAfter, DateTime(2025));
      expect(captured!.date.takenBefore, DateTime(2025, 12, 31, 23, 59, 59));
      verify(
        () => factory.fromAssetStream(
          any(),
          any(),
          TimelineOrigin.search,
          groupBy: any(named: 'groupBy'),
          descending: any(named: 'descending'),
        ),
      ).called(1);
    });

    test('temporal scope composes with active text filter for search-backed timeline', () async {
      final factory = _MockFactory();
      final search = _MockSearch();
      final fake = _FakeService();
      SearchFilter? captured;
      when(() => search.search(any(), 1)).thenAnswer((invocation) async {
        captured = invocation.positionalArguments.first as SearchFilter;
        return const SearchResult(assets: []);
      });
      when(
        () => factory.fromAssetStream(
          any(),
          any(),
          TimelineOrigin.search,
          groupBy: any(named: 'groupBy'),
          descending: any(named: 'descending'),
        ),
      ).thenReturn(fake);

      final container = _container(factory: factory, search: search, user: _user('u1'));
      container.read(photosFilterProvider.notifier).setText('paris');
      container.read(timelineTemporalScopeProvider.notifier).setMonth(year: 2025, month: 3);
      addTearDown(container.dispose);

      final svc = container.read(photosTimelineQueryProvider);
      expect(svc, same(fake));
      await Future<void>.delayed(const Duration(milliseconds: 5));

      expect(captured, isNotNull);
      expect(captured!.context, 'paris');
      expect(captured!.date.takenAfter, DateTime(2025, 3));
      expect(captured!.date.takenBefore, DateTime(2025, 3, 31, 23, 59, 59));
    });

    test('cleared temporal scope returns empty Photos filter to main-library service', () {
      final factory = _MockFactory();
      final search = _MockSearch();
      final fake = _FakeService();
      when(() => factory.main(any(), any())).thenReturn(fake);

      final container = _container(factory: factory, search: search, user: _user('u1'));
      final temporal = container.read(timelineTemporalScopeProvider.notifier);
      temporal.setYear(2025);
      temporal.clear();
      addTearDown(container.dispose);

      final svc = container.read(photosTimelineQueryProvider);
      expect(svc, same(fake));
      verify(() => factory.main(any(), 'u1')).called(1);
      verifyNever(() => search.search(any(), any()));
    });

    test('temporal-only Photos timeline builder delegates to main timeline with route scope', () {
      final factory = _MockFactory();
      final search = _MockSearch();
      final fake = _FakeService();
      when(
        () => factory.main(
          any(),
          any(),
          groupBy: any(named: 'groupBy'),
          temporalScope: any(named: 'temporalScope'),
        ),
      ).thenReturn(fake);

      final parent = _container(factory: factory, search: search, user: _user('u1'));
      addTearDown(parent.dispose);
      final route = ProviderContainer(
        parent: parent,
        overrides: [
          timelineTemporalScopeProvider.overrideWith(TimelineTemporalScopeNotifier.new),
          timelineServiceProvider.overrideWith((ref) {
            final temporalScope = ref.watch(timelineTemporalScopeProvider);
            return buildPhotosTimelineRouteService(ref, temporalScope, ref.watch(timelineGroupingSpecProvider).groupBy);
          }),
        ],
      );
      addTearDown(route.dispose);

      route.read(timelineTemporalScopeProvider.notifier).setYear(2025);

      expect(route.read(timelineServiceProvider), same(fake));
      verify(
        () => factory.main(
          any(),
          'u1',
          groupBy: any(named: 'groupBy'),
          temporalScope: const TimelineTemporalScope.year(2025),
        ),
      ).called(1);
      verifyNever(() => search.search(any(), any()));
    });

    test('filtered Photos timeline builder composes route scope into search filter', () async {
      final factory = _MockFactory();
      final search = _MockSearch();
      final fake = _FakeService();
      SearchFilter? captured;
      when(() => search.search(any(), 1)).thenAnswer((invocation) async {
        captured = invocation.positionalArguments.first as SearchFilter;
        return const SearchResult(assets: []);
      });
      when(
        () => factory.fromAssetStream(
          any(),
          any(),
          TimelineOrigin.search,
          groupBy: any(named: 'groupBy'),
          descending: any(named: 'descending'),
        ),
      ).thenReturn(fake);

      final parent = _container(factory: factory, search: search, user: _user('u1'));
      parent.read(photosFilterProvider.notifier).setText('paris');
      addTearDown(parent.dispose);
      final route = ProviderContainer(
        parent: parent,
        overrides: [
          timelineTemporalScopeProvider.overrideWith(TimelineTemporalScopeNotifier.new),
          timelineServiceProvider.overrideWith((ref) {
            final temporalScope = ref.watch(timelineTemporalScopeProvider);
            return buildPhotosTimelineRouteService(ref, temporalScope, ref.watch(timelineGroupingSpecProvider).groupBy);
          }),
        ],
      );
      addTearDown(route.dispose);

      route.read(timelineTemporalScopeProvider.notifier).setMonth(year: 2025, month: 3);

      expect(route.read(timelineServiceProvider), same(fake));
      await Future<void>.delayed(const Duration(milliseconds: 5));
      expect(captured, isNotNull);
      expect(captured!.context, 'paris');
      expect(captured!.date.takenAfter, DateTime(2025, 3));
      expect(captured!.date.takenBefore, DateTime(2025, 3, 31, 23, 59, 59));
    });

    testWidgets('TimelineRouteScope can host the temporal-only Photos timeline builder', (tester) async {
      final factory = _MockFactory();
      final search = _MockSearch();
      final fake = _FakeService();
      final user = _user('u1');
      final mockUserSvc = _MockUserService();
      when(
        () => factory.main(
          any(),
          any(),
          groupBy: any(named: 'groupBy'),
          temporalScope: any(named: 'temporalScope'),
        ),
      ).thenReturn(fake);
      when(() => mockUserSvc.tryGetMyUser()).thenReturn(user);
      when(() => mockUserSvc.watchMyUser()).thenAnswer((_) => const Stream<UserDto?>.empty());

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            timelineFactoryProvider.overrideWithValue(factory),
            searchServiceProvider.overrideWithValue(search),
            infra.userServiceProvider.overrideWithValue(mockUserSvc),
            currentUserProvider.overrideWith((ref) => _StubCurrentUserNotifier(mockUserSvc, user)),
            timelineUsersProvider.overrideWith((_) => Stream<List<String>>.value([user.id])),
          ],
          child: TimelineRouteScope(
            timelineServiceBuilder: buildPhotosTimelineRouteService,
            // Mirrors MainTimelinePage: the Photos route follows the persisted grouping.
            sharedGrouping: true,
            child: Directionality(
              textDirection: TextDirection.ltr,
              child: Consumer(builder: (context, ref, child) => Text(ref.watch(timelineServiceProvider).origin.name)),
            ),
          ),
        ),
      );

      expect(find.text(fake.origin.name), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    test('disposes the created service when the container disposes', () async {
      final factory = _MockFactory();
      final search = _MockSearch();
      final fake = _FakeService();
      when(() => factory.main(any(), any())).thenReturn(fake);

      final container = _container(factory: factory, search: search, user: _user('u1'));
      container.read(photosTimelineQueryProvider);
      container.dispose();

      // Dispose is async; allow microtask drain.
      await Future<void>.delayed(const Duration(milliseconds: 5));
      expect(fake.disposed, isTrue);
    });

    // Grouping/direction decision tests (Slice 2)

    test('non-smart filter uses active grouping setting and defaults to descending', () async {
      final factory = _MockFactory();
      final search = _MockSearch();
      final fake = _FakeService();
      when(() => search.search(any(), 1)).thenAnswer((_) async => const SearchResult(assets: []));
      when(() => factory.groupBy).thenReturn(GroupAssetsBy.month);
      GroupAssetsBy? capturedGroupBy;
      bool? capturedDescending;
      when(
        () => factory.fromAssetStream(
          any(),
          any(),
          TimelineOrigin.search,
          groupBy: any(named: 'groupBy'),
          descending: any(named: 'descending'),
        ),
      ).thenAnswer((inv) {
        capturedGroupBy = inv.namedArguments[const Symbol('groupBy')] as GroupAssetsBy;
        capturedDescending = inv.namedArguments[const Symbol('descending')] as bool;
        return fake;
      });

      final container = _container(factory: factory, search: search, user: _user('u1'));
      // People-only filter: context is null → non-smart
      container.read(photosFilterProvider.notifier).setNotInAlbum(true);
      addTearDown(container.dispose);

      container.read(photosTimelineQueryProvider);
      await Future<void>.delayed(const Duration(milliseconds: 5));

      expect(capturedGroupBy, GroupAssetsBy.month);
      expect(capturedDescending, isTrue);
    });

    test('non-smart filter with oldest sort uses descending=false', () async {
      final factory = _MockFactory();
      final search = _MockSearch();
      final fake = _FakeService();
      when(() => search.search(any(), 1)).thenAnswer((_) async => const SearchResult(assets: []));
      when(() => factory.groupBy).thenReturn(GroupAssetsBy.month);
      GroupAssetsBy? capturedGroupBy;
      bool? capturedDescending;
      when(
        () => factory.fromAssetStream(
          any(),
          any(),
          TimelineOrigin.search,
          groupBy: any(named: 'groupBy'),
          descending: any(named: 'descending'),
        ),
      ).thenAnswer((inv) {
        capturedGroupBy = inv.namedArguments[const Symbol('groupBy')] as GroupAssetsBy;
        capturedDescending = inv.namedArguments[const Symbol('descending')] as bool;
        return fake;
      });

      final container = _container(factory: factory, search: search, user: _user('u1'));
      container.read(photosFilterProvider.notifier).setNotInAlbum(true);
      container.read(photosFilterProvider.notifier).setSort(SearchSortOrder.oldest);
      addTearDown(container.dispose);

      container.read(photosTimelineQueryProvider);
      await Future<void>.delayed(const Duration(milliseconds: 5));

      expect(capturedGroupBy, GroupAssetsBy.month);
      expect(capturedDescending, isFalse);
    });

    test('smart filter with relevance sort uses groupBy=none (flat)', () async {
      final factory = _MockFactory();
      final search = _MockSearch();
      final fake = _FakeService();
      when(() => search.search(any(), 1)).thenAnswer((_) async => const SearchResult(assets: []));
      // factory.groupBy must NOT be evaluated on the relevance path (groupBy short-circuits to none);
      // stub it so an accidental access wouldn't throw, and assert below that it stays untouched.
      when(() => factory.groupBy).thenReturn(GroupAssetsBy.month);
      GroupAssetsBy? capturedGroupBy;
      when(
        () => factory.fromAssetStream(
          any(),
          any(),
          TimelineOrigin.search,
          groupBy: any(named: 'groupBy'),
          descending: any(named: 'descending'),
        ),
      ).thenAnswer((inv) {
        capturedGroupBy = inv.namedArguments[const Symbol('groupBy')] as GroupAssetsBy;
        return fake;
      });

      final container = _container(factory: factory, search: search, user: _user('u1'));
      // setText sets context=non-empty + keeps sort=relevance (smart search default)
      container.read(photosFilterProvider.notifier).setText('paris');
      addTearDown(container.dispose);

      container.read(photosTimelineQueryProvider);
      await Future<void>.delayed(const Duration(milliseconds: 5));

      expect(capturedGroupBy, GroupAssetsBy.none);
      verifyNever(() => factory.groupBy);
    });

    test('smart filter with newest sort uses active grouping setting (not none)', () async {
      final factory = _MockFactory();
      final search = _MockSearch();
      final fake = _FakeService();
      when(() => search.search(any(), 1)).thenAnswer((_) async => const SearchResult(assets: []));
      when(() => factory.groupBy).thenReturn(GroupAssetsBy.month);
      GroupAssetsBy? capturedGroupBy;
      bool? capturedDescending;
      when(
        () => factory.fromAssetStream(
          any(),
          any(),
          TimelineOrigin.search,
          groupBy: any(named: 'groupBy'),
          descending: any(named: 'descending'),
        ),
      ).thenAnswer((inv) {
        capturedGroupBy = inv.namedArguments[const Symbol('groupBy')] as GroupAssetsBy;
        capturedDescending = inv.namedArguments[const Symbol('descending')] as bool;
        return fake;
      });

      final container = _container(factory: factory, search: search, user: _user('u1'));
      // setText keeps context='paris'; then switch to newest sort
      container.read(photosFilterProvider.notifier).setText('paris');
      container.read(photosFilterProvider.notifier).setSort(SearchSortOrder.newest);
      addTearDown(container.dispose);

      container.read(photosTimelineQueryProvider);
      await Future<void>.delayed(const Duration(milliseconds: 5));

      // Smart + newest → not relevance, so groupBy = factory.groupBy (month)
      expect(capturedGroupBy, GroupAssetsBy.month);
      expect(capturedDescending, isTrue);
    });
  });
}
