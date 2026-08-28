import 'package:auto_route/auto_route.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/album/album.model.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/services/asset.service.dart' as beta_asset_service;
import 'package:immich_mobile/domain/services/memory.service.dart';
import 'package:immich_mobile/domain/services/people.service.dart';
import 'package:immich_mobile/domain/services/remote_album.service.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/providers/asset_viewer/asset_viewer.provider.dart';
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

class _MockDriftPeopleService extends Mock implements PeopleService {}

class _MockSharedSpaceApiRepository extends Mock implements SharedSpaceApiRepository {}

class _MockWidgetRef extends Mock implements WidgetRef {}

class _MockAssetViewerStateNotifier extends Mock implements AssetViewerStateNotifier {}

class _FakePlatformDeepLink extends Mock implements PlatformDeepLink {}

PlatformDeepLink _deepLinkFor(String raw) {
  final fake = _FakePlatformDeepLink();
  final uri = Uri.parse(raw);
  when(() => fake.uri).thenReturn(uri);
  return fake;
}

const _assetId = 'aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb';
const _albumId = 'cccccccc-4444-5555-6666-dddddddddddd';

final _asset = RemoteAsset(
  id: _assetId,
  name: 'photo.jpg',
  ownerId: 'user-1',
  checksum: 'checksum-1',
  type: AssetType.image,
  createdAt: DateTime(2026, 6, 12),
  updatedAt: DateTime(2026, 6, 12),
  isEdited: false,
);

final _album = RemoteAlbum(
  id: _albumId,
  name: 'Shared Album',
  ownerId: 'user-1',
  description: '',
  createdAt: DateTime(2026, 6, 12),
  updatedAt: DateTime(2026, 6, 12),
  isActivityEnabled: true,
  isShared: true,
  order: AlbumAssetOrder.asc,
  assetCount: 1,
  ownerName: 'Owner',
);

void main() {
  late DeepLinkService sut;
  late _MockTimelineFactory timelineFactory;
  late _MockBetaAssetService betaAssetService;
  late _MockRemoteAlbumService remoteAlbumService;
  late _MockSharedSpaceApiRepository sharedSpaceApiRepository;
  late _MockWidgetRef ref;
  late List<TimelineService> createdTimelineServices;

  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
  });

  tearDownAll(() async {
    debugDefaultTargetPlatformOverride = null;
  });

  setUp(() async {
    timelineFactory = _MockTimelineFactory();
    betaAssetService = _MockBetaAssetService();
    remoteAlbumService = _MockRemoteAlbumService();
    sharedSpaceApiRepository = _MockSharedSpaceApiRepository();
    ref = _MockWidgetRef();
    createdTimelineServices = [];

    when(() => timelineFactory.fromAssets(any(), TimelineOrigin.deepLink)).thenAnswer((invocation) {
      final assets = List<BaseAsset>.from(invocation.positionalArguments[0] as List<BaseAsset>);
      final timelineService = TimelineService((
        assetSource: (index, count) async => assets.skip(index).take(count).toList(),
        bucketSource: () => Stream.value([Bucket(assetCount: assets.length)]),
        origin: TimelineOrigin.deepLink,
      ));
      createdTimelineServices.add(timelineService);
      return timelineService;
    });

    when(() => ref.read(assetViewerProvider.notifier)).thenReturn(_MockAssetViewerStateNotifier());

    sut = DeepLinkService(
      timelineFactory,
      betaAssetService,
      remoteAlbumService,
      _MockDriftMemoryService(),
      _MockDriftPeopleService(),
      sharedSpaceApiRepository,
      UserStub.user1,
    );

    addTearDown(() async {
      for (final timelineService in createdTimelineServices) {
        await timelineService.dispose();
      }
    });
  });

  group('handleScheme - space intent', () {
    const spaceId = 'space-1';

    test('routes immich://space?id=<id> to a SpaceDetailRoute when the space exists', () async {
      when(() => sharedSpaceApiRepository.get(spaceId)).thenAnswer((_) async => SharedSpaceStub.space1);

      final result = await sut.handleScheme(_deepLinkFor('immich://space?id=$spaceId'), ref);

      expect(result?.routeName, SpaceDetailRoute.name);
      final args = result!.args! as SpaceDetailRouteArgs;
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
  });

  group('handleMyImmichApp - album photo links', () {
    test('album photo link carries the album into the viewer route', () async {
      when(() => betaAssetService.getRemoteAsset(_assetId)).thenAnswer((_) async => _asset);
      when(() => remoteAlbumService.get(_albumId)).thenAnswer((_) async => _album);

      final route = await sut.handleMyImmichApp(
        _deepLinkFor('https://my.immich.app/albums/$_albumId/photos/$_assetId'),
        ref,
      );

      expect(route, isA<AssetViewerRoute>());
      expect((route!.args! as AssetViewerRouteArgs).currentAlbum, _album);
    });

    test('still opens the viewer when the album cannot be resolved', () async {
      when(() => betaAssetService.getRemoteAsset(_assetId)).thenAnswer((_) async => _asset);
      when(() => remoteAlbumService.get(_albumId)).thenAnswer((_) async => null);

      final route = await sut.handleMyImmichApp(
        _deepLinkFor('https://my.immich.app/albums/$_albumId/photos/$_assetId'),
        ref,
      );

      expect(route, isA<AssetViewerRoute>());
      expect((route!.args! as AssetViewerRouteArgs).currentAlbum, isNull);
    });

    test('plain photo link has no album', () async {
      when(() => betaAssetService.getRemoteAsset(_assetId)).thenAnswer((_) async => _asset);

      final route = await sut.handleMyImmichApp(_deepLinkFor('https://my.immich.app/photos/$_assetId'), ref);

      expect(route, isA<AssetViewerRoute>());
      expect((route!.args! as AssetViewerRouteArgs).currentAlbum, isNull);
      verifyNever(() => remoteAlbumService.get(any()));
    });
  });
}
