import 'package:auto_route/auto_route.dart';
import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/services/asset.service.dart' as beta_asset_service;
import 'package:immich_mobile/domain/services/memory.service.dart';
import 'package:immich_mobile/domain/services/people.service.dart';
import 'package:immich_mobile/domain/services/remote_album.service.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/providers/album/current_album.provider.dart';
import 'package:immich_mobile/providers/asset_viewer/current_asset.provider.dart';
import 'package:immich_mobile/repositories/shared_space_api.repository.dart';
import 'package:immich_mobile/routing/router.dart';
import 'package:immich_mobile/services/album.service.dart';
import 'package:immich_mobile/services/asset.service.dart';
import 'package:immich_mobile/services/deep_link.service.dart';
import 'package:immich_mobile/services/memory.service.dart';
import 'package:mocktail/mocktail.dart';

import '../fixtures/shared_space.stub.dart';
import '../fixtures/user.stub.dart';

class _MockMemoryService extends Mock implements MemoryService {}

class _MockAssetService extends Mock implements AssetService {}

class _MockAlbumService extends Mock implements AlbumService {}

class _MockCurrentAsset extends Mock implements CurrentAsset {}

class _MockCurrentAlbum extends Mock implements CurrentAlbum {}

class _MockTimelineFactory extends Mock implements TimelineFactory {}

class _MockBetaAssetService extends Mock implements beta_asset_service.AssetService {}

class _MockRemoteAlbumService extends Mock implements RemoteAlbumService {}

class _MockDriftMemoryService extends Mock implements DriftMemoryService {}

class _MockDriftPeopleService extends Mock implements DriftPeopleService {}

class _MockSharedSpaceApiRepository extends Mock implements SharedSpaceApiRepository {}

class _MockWidgetRef extends Mock implements WidgetRef {}

class _FakePlatformDeepLink extends Mock implements PlatformDeepLink {}

PlatformDeepLink _deepLinkFor(String raw) {
  final fake = _FakePlatformDeepLink();
  final uri = Uri.parse(raw);
  when(() => fake.uri).thenReturn(uri);
  return fake;
}

/// Pulls the underlying [PageRouteInfo] list out of a `_RoutesDeepLink`. The
/// concrete `_RoutesDeepLink` type is private inside auto_route, but it does
/// expose a `routes` field, so `(deepLink as dynamic).routes` works fine.
List<PageRouteInfo> _routesOf(DeepLink link) {
  return List<PageRouteInfo>.from((link as dynamic).routes as Iterable);
}

void main() {
  late DeepLinkService sut;
  late _MockSharedSpaceApiRepository sharedSpaceApiRepository;
  late _MockWidgetRef ref;
  late Drift db;

  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    debugDefaultTargetPlatformOverride = TargetPlatform.android;

    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: DriftStoreRepository(db));
  });

  tearDownAll(() async {
    debugDefaultTargetPlatformOverride = null;
    await Store.clear();
    await db.close();
  });

  setUp(() async {
    sharedSpaceApiRepository = _MockSharedSpaceApiRepository();
    ref = _MockWidgetRef();

    sut = DeepLinkService(
      _MockMemoryService(),
      _MockAssetService(),
      _MockAlbumService(),
      _MockCurrentAsset(),
      _MockCurrentAlbum(),
      _MockTimelineFactory(),
      _MockBetaAssetService(),
      _MockRemoteAlbumService(),
      _MockDriftMemoryService(),
      _MockDriftPeopleService(),
      sharedSpaceApiRepository,
      UserStub.user1,
    );

    // Spaces require beta — make sure tests run with beta enabled.
    await Store.put(StoreKey.betaTimeline, true);
  });

  tearDown(() async {
    await Store.clear();
  });

  group('handleScheme — space intent', () {
    const spaceId = 'space-1';

    test('routes immich://space?id=<id> to a SpaceDetailRoute when the space exists', () async {
      when(() => sharedSpaceApiRepository.get(spaceId)).thenAnswer((_) async => SharedSpaceStub.space1);

      final result = await sut.handleScheme(_deepLinkFor('immich://space?id=$spaceId'), ref, false);

      // Successful resolution returns a navigable DeepLink that is neither the
      // catch-all defaultPath nor the no-op none sentinel.
      expect(result.isValid, isTrue);
      expect(result, isNot(same(DeepLink.defaultPath)));
      expect(result, isNot(same(DeepLink.none)));

      // Warm start: the only route in the link is the space detail itself.
      final routes = _routesOf(result);
      expect(routes.map((r) => r.routeName), [SpaceDetailRoute.name]);
      final args = routes.single.args as SpaceDetailRouteArgs;
      expect(args.spaceId, spaceId);
      verify(() => sharedSpaceApiRepository.get(spaceId)).called(1);
    });

    test('also handles the noodle-gallery:// scheme — handler is scheme-agnostic', () async {
      when(() => sharedSpaceApiRepository.get(spaceId)).thenAnswer((_) async => SharedSpaceStub.space1);

      final result = await sut.handleScheme(_deepLinkFor('noodle-gallery://space?id=$spaceId'), ref, false);

      final routes = _routesOf(result);
      expect(routes.map((r) => r.routeName), [SpaceDetailRoute.name]);
      verify(() => sharedSpaceApiRepository.get(spaceId)).called(1);
    });

    test('cold start prepends TabShellRoute alongside the resolved space', () async {
      when(() => sharedSpaceApiRepository.get(spaceId)).thenAnswer((_) async => SharedSpaceStub.space1);

      final result = await sut.handleScheme(_deepLinkFor('immich://space?id=$spaceId'), ref, true);

      final routes = _routesOf(result);
      expect(routes.map((r) => r.routeName), [TabShellRoute.name, SpaceDetailRoute.name]);
    });

    test('falls back to defaultPath on cold start when space lookup fails', () async {
      when(() => sharedSpaceApiRepository.get(spaceId)).thenThrow(Exception('not found'));

      final result = await sut.handleScheme(_deepLinkFor('immich://space?id=$spaceId'), ref, true);

      expect(result, same(DeepLink.defaultPath));
    });

    test('returns DeepLink.none on warm start when space lookup fails', () async {
      when(() => sharedSpaceApiRepository.get(spaceId)).thenThrow(Exception('not found'));

      final result = await sut.handleScheme(_deepLinkFor('immich://space?id=$spaceId'), ref, false);

      expect(result, same(DeepLink.none));
    });

    test('returns DeepLink.none when id query parameter is missing', () async {
      final result = await sut.handleScheme(_deepLinkFor('immich://space'), ref, false);

      expect(result, same(DeepLink.none));
      verifyNever(() => sharedSpaceApiRepository.get(any()));
    });

    test('falls back to defaultPath on cold start when beta timeline is disabled', () async {
      await Store.put(StoreKey.betaTimeline, false);

      final result = await sut.handleScheme(_deepLinkFor('immich://space?id=$spaceId'), ref, true);

      expect(result, same(DeepLink.defaultPath));
      verifyNever(() => sharedSpaceApiRepository.get(any()));
    });
  });
}
