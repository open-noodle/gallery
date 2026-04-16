import 'package:auto_route/auto_route.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/memory.model.dart';
import 'package:immich_mobile/domain/models/user.model.dart';
import 'package:immich_mobile/domain/services/asset.service.dart' as beta_asset_service;
import 'package:immich_mobile/domain/services/memory.service.dart';
import 'package:immich_mobile/domain/services/people.service.dart';
import 'package:immich_mobile/domain/services/remote_album.service.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/presentation/widgets/asset_viewer/asset_viewer.page.dart';
import 'package:immich_mobile/providers/infrastructure/album.provider.dart';
import 'package:immich_mobile/providers/infrastructure/asset.provider.dart' as beta_asset_provider;
import 'package:immich_mobile/providers/infrastructure/memory.provider.dart';
import 'package:immich_mobile/providers/infrastructure/people.provider.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:immich_mobile/repositories/shared_space_api.repository.dart';
import 'package:immich_mobile/routing/router.dart';
import 'package:immich_mobile/services/album.service.dart';
import 'package:immich_mobile/services/asset.service.dart';
import 'package:immich_mobile/services/memory.service.dart';
import 'package:immich_mobile/widgets/asset_grid/asset_grid_data_structure.dart';
import 'package:logging/logging.dart';

final deepLinkServiceProvider = Provider(
  (ref) => DeepLinkService(
    ref.watch(timelineFactoryProvider),
    ref.watch(beta_asset_provider.assetServiceProvider),
    ref.watch(remoteAlbumServiceProvider),
    ref.watch(driftMemoryServiceProvider),
    ref.watch(driftPeopleServiceProvider),
    ref.watch(sharedSpaceApiRepositoryProvider),
    ref.watch(currentUserProvider),
  ),
);

class DeepLinkService {
  static final Logger _log = Logger('DeepLinkService');

  /// TODO: Remove this when beta is default
  final MemoryService _memoryService;
  final AssetService _assetService;
  final AlbumService _albumService;
  final CurrentAsset _currentAsset;
  final CurrentAlbum _currentAlbum;

  /// Used for beta timeline
  final TimelineFactory _betaTimelineFactory;
  final beta_asset_service.AssetService _betaAssetService;
  final RemoteAlbumService _betaRemoteAlbumService;
  final DriftMemoryService _betaMemoryService;
  final DriftPeopleService _betaPeopleService;

  /// Fork-only: shared spaces are a Gallery feature with no Immich equivalent.
  final SharedSpaceApiRepository _sharedSpaceApiRepository;

  final UserDto? _currentUser;

  const DeepLinkService(
    this._betaTimelineFactory,
    this._betaAssetService,
    this._betaRemoteAlbumService,
    this._betaMemoryService,
    this._betaPeopleService,
    this._sharedSpaceApiRepository,
    this._currentUser,
  );

  Future<PageRouteInfo?> handleScheme(PlatformDeepLink link, WidgetRef ref) async {
    // get everything after the scheme, since Uri cannot parse path
    final intent = link.uri.host;
    final queryParams = link.uri.queryParameters;

    return switch (intent) {
      "memory" => await _buildMemoryDeepLink(queryParams['id'] ?? ''),
      "asset" => await _buildAssetDeepLink(queryParams['id'] ?? '', ref),
      "album" => await _buildAlbumDeepLink(queryParams['id'] ?? ''),
      "space" => await _buildSpaceDeepLink(queryParams['id'] ?? ''),
      "people" => await _buildPeopleDeepLink(queryParams['id'] ?? ''),
      "activity" => await _buildActivityDeepLink(queryParams['albumId'] ?? ''),
      _ => null,
    };
  }

  Future<PageRouteInfo?> handleMyImmichApp(PlatformDeepLink link, WidgetRef ref) async {
    final path = link.uri.path;

    const uuidRegex = r'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
    final assetRegex = RegExp('/photos/($uuidRegex)');
    final albumRegex = RegExp('/albums/($uuidRegex)');
    final peopleRegex = RegExp('/people/($uuidRegex)');

    if (assetRegex.hasMatch(path)) {
      final assetId = assetRegex.firstMatch(path)?.group(1) ?? '';
      return _buildAssetDeepLink(assetId, ref);
    }
    if (albumRegex.hasMatch(path)) {
      final albumId = albumRegex.firstMatch(path)?.group(1) ?? '';
      return _buildAlbumDeepLink(albumId);
    }
    if (peopleRegex.hasMatch(path)) {
      final peopleId = peopleRegex.firstMatch(path)?.group(1) ?? '';
      return _buildPeopleDeepLink(peopleId);
    }

    return null;
  }

  Future<PageRouteInfo?> _buildMemoryDeepLink(String? memoryId) async {
    List<DriftMemory> memories = [];

    if (memoryId == null) {
      if (_currentUser == null) {
        return null;
      }

      memories = await _betaMemoryService.getMemoryLane(_currentUser.id);
    } else {
      final memory = await _betaMemoryService.get(memoryId);
      if (memory != null) {
        memories = [memory];
      }
    }

  Future<PageRouteInfo?> _buildAssetDeepLink(String assetId, WidgetRef ref) async {
    if (Store.isBetaTimelineEnabled) {
      final asset = await _betaAssetService.getRemoteAsset(assetId);
      if (asset == null) {
        return null;
      }

      AssetViewer.setAsset(ref, asset);
      return AssetViewerRoute(
        initialIndex: 0,
        timelineService: _betaTimelineFactory.fromAssets([asset], TimelineOrigin.deepLink),
      );
    } else {
      // TODO: Remove this when beta is default
      final asset = await _assetService.getAssetByRemoteId(assetId);
      if (asset == null) {
        return null;
      }

      _currentAsset.set(asset);
      final renderList = await RenderList.fromAssets([asset], GroupAssetsBy.auto);

      return GalleryViewerRoute(renderList: renderList, initialIndex: 0, heroOffset: 0, showStack: true);
    }
  }

  Future<PageRouteInfo?> _buildAlbumDeepLink(String albumId) async {
    if (Store.isBetaTimelineEnabled) {
      final album = await _betaRemoteAlbumService.get(albumId);

      if (album == null) {
        return null;
      }

      return RemoteAlbumRoute(album: album);
    } else {
      // TODO: Remove this when beta is default
      final album = await _albumService.getAlbumByRemoteId(albumId);

      if (album == null) {
        return null;
      }

      _currentAlbum.set(album);
      return AlbumViewerRoute(albumId: album.id);
    }
  }

  Future<PageRouteInfo?> _buildSpaceDeepLink(String spaceId) async {
    // Shared spaces are a fork-only feature wired into the Drift-backed
    // beta timeline navigation. Outside of beta we have no surface to land on,
    // so return null and let the caller fall back to the default route.
    if (Store.isBetaTimelineEnabled == false) {
      return null;
    }

    if (spaceId.isEmpty) {
      return null;
    }

    try {
      // Verifies the space exists and is accessible to the current user before
      // we attempt to navigate. The space detail page only needs the id.
      await _sharedSpaceApiRepository.get(spaceId);
    } catch (error, stackTrace) {
      _log.warning('Failed to resolve space deep link for $spaceId', error, stackTrace);
      return null;
    }

    return SpaceDetailRoute(spaceId: spaceId);
  }

  Future<PageRouteInfo?> _buildActivityDeepLink(String albumId) async {
    if (Store.isBetaTimelineEnabled == false) {
      return null;
    }

    return DriftMemoryRoute(memories: memories, memoryIndex: 0);
  }

  Future<PageRouteInfo?> _buildAssetDeepLink(String assetId, WidgetRef ref) async {
    final asset = await _betaAssetService.getRemoteAsset(assetId);
    if (asset == null) {
      return null;
    }

    AssetViewer.setAsset(ref, asset);
    return AssetViewerRoute(
      initialIndex: 0,
      timelineService: _betaTimelineFactory.fromAssets([asset], TimelineOrigin.deepLink),
    );
  }

  Future<PageRouteInfo?> _buildAlbumDeepLink(String albumId) async {
    final album = await _betaRemoteAlbumService.get(albumId);

    if (album == null) {
      return null;
    }

    return RemoteAlbumRoute(album: album);
  }

  Future<PageRouteInfo?> _buildActivityDeepLink(String albumId) async {
    final album = await _betaRemoteAlbumService.get(albumId);

    if (album == null || album.isActivityEnabled == false) {
      return null;
    }

    return DriftActivitiesRoute(album: album);
  }

  Future<PageRouteInfo?> _buildPeopleDeepLink(String personId) async {
    final person = await _betaPeopleService.get(personId);

    if (person == null) {
      return null;
    }

    return DriftPersonRoute(person: person);
  }
}
