import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/album/album.model.dart';
import 'package:immich_mobile/domain/models/album/local_album.model.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/services/local_album.service.dart';
import 'package:immich_mobile/domain/services/remote_album.service.dart';
import 'package:immich_mobile/domain/services/space_sync_remote_album.service.dart';
import 'package:immich_mobile/infrastructure/repositories/local_album.repository.dart';
import 'package:immich_mobile/providers/infrastructure/db.provider.dart';
import 'package:immich_mobile/providers/infrastructure/remote_album.provider.dart';
import 'package:immich_mobile/providers/infrastructure/space_album_sync_nudge.dart';
import 'package:immich_mobile/repositories/album_api_repository.dart';
import 'package:immich_mobile/services/foreground_upload.service.dart';
// ignore: import_rule_openapi
import 'package:openapi/api.dart' show AlbumSharedSpaceLinkResponseDto;

final localAlbumProvider = FutureProvider<List<LocalAlbum>>(
  (ref) => LocalAlbumService(ref.watch(driftProvider).localAlbumRepository)
      .getAll(sortBy: {SortLocalAlbumsBy.newestAsset})
      .then((albums) => albums.where((album) => album.assetCount > 0).toList()),
);

final localAlbumThumbnailProvider = FutureProvider.family<LocalAsset?, String>(
  (ref, albumId) => LocalAlbumService(ref.watch(driftProvider).localAlbumRepository).getThumbnail(albumId),
);

// Fork: constructs the SpaceSync subclass so every remove-from-album path — all three
// surfaces route through this provider — nudges the Space sync. See the class doc.
final remoteAlbumServiceProvider = Provider<RemoteAlbumService>(
  (ref) => SpaceSyncRemoteAlbumService(
    ref.watch(driftProvider).remoteAlbumRepository,
    ref.watch(albumApiRepositoryProvider),
    ref.watch(foregroundUploadServiceProvider),
    onAlbumMutated: (albumId) => nudgeSpaceSyncIfLinked(ref, albumId),
  ),
);

final remoteAlbumProvider = NotifierProvider<RemoteAlbumNotifier, RemoteAlbumState>(
  RemoteAlbumNotifier.new,
  dependencies: [remoteAlbumServiceProvider],
);

final albumsContainingAssetProvider = FutureProvider.family<List<RemoteAlbum>, String>(
  (ref, assetId) => ref.watch(remoteAlbumServiceProvider).getAlbumsContainingAsset(assetId),
);

/// M8: the shared spaces an OWNED album is linked into, fetched on demand (owner-only field,
/// not in the Drift sync stream). Callers should only watch this for albums the current user
/// owns — see [DriftAlbumApiRepository.getSharedSpaceLinks].
final albumSharedSpaceLinksProvider = FutureProvider.autoDispose.family<List<AlbumSharedSpaceLinkResponseDto>, String>(
  (ref, albumId) => ref.watch(driftAlbumApiRepositoryProvider).getSharedSpaceLinks(albumId),
);
