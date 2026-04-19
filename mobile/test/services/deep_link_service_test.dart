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
import 'package:immich_mobile/repositories/shared_space_api.repository.dart';
import 'package:immich_mobile/routing/router.dart';
import 'package:immich_mobile/services/deep_link.service.dart';
import 'package:mocktail/mocktail.dart';

import '../fixtures/shared_space.stub.dart';
import '../fixtures/user.stub.dart';

class _MockTimelineFactory extends Mock implements TimelineFactory {}

class _MockBetaAssetService extends Mock implements beta_asset_service.AssetService {}

class _MockRemoteAlbumService extends Mock implements RemoteAlbumService {}

class _MockDriftMemoryService extends Mock implements MemoryService {}

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
      _MockTimelineFactory(),
      _MockBetaAssetService(),
      _MockRemoteAlbumService(),
      _MockDriftMemoryService(),
      _MockDriftPeopleService(),
      sharedSpaceApiRepository,
      UserStub.user1,
    );

    // Spaces require beta; make sure tests run with beta enabled.
    await Store.put(StoreKey.betaTimeline, true);
  });

  tearDown(() async {
    await Store.clear();
  });

  group('handleScheme - space intent', () {
    const spaceId = 'space-1';

    test('routes immich://space?id=<id> to a SpaceDetailRoute when the space exists', () async {
      when(() => sharedSpaceApiRepository.get(spaceId)).thenAnswer((_) async => SharedSpaceStub.space1);

      final result = await sut.handleScheme(_deepLinkFor('immich://space?id=$spaceId'), ref);

      expect(result?.routeName, SpaceDetailRoute.name);
      final args = result!.args as SpaceDetailRouteArgs;
      expect(args.spaceId, spaceId);
      verify(() => sharedSpaceApiRepository.get(spaceId)).called(1);
    });

    test('also handles the noodle-gallery:// scheme because intent parsing is scheme-agnostic', () async {
      when(() => sharedSpaceApiRepository.get(spaceId)).thenAnswer((_) async => SharedSpaceStub.space1);

      final result = await sut.handleScheme(_deepLinkFor('noodle-gallery://space?id=$spaceId'), ref);

      expect(result?.routeName, SpaceDetailRoute.name);
      verify(() => sharedSpaceApiRepository.get(spaceId)).called(1);
    });

    test('returns null when space lookup fails', () async {
      when(() => sharedSpaceApiRepository.get(spaceId)).thenThrow(Exception('not found'));

      final result = await sut.handleScheme(_deepLinkFor('immich://space?id=$spaceId'), ref);

      expect(result, isNull);
    });

    test('returns null when id query parameter is missing', () async {
      final result = await sut.handleScheme(_deepLinkFor('immich://space'), ref);

      expect(result, isNull);
      verifyNever(() => sharedSpaceApiRepository.get(any()));
    });

    test('returns null when beta timeline is disabled', () async {
      await Store.put(StoreKey.betaTimeline, false);

      final result = await sut.handleScheme(_deepLinkFor('immich://space?id=$spaceId'), ref);

      expect(result, isNull);
      verifyNever(() => sharedSpaceApiRepository.get(any()));
    });
  });

}
