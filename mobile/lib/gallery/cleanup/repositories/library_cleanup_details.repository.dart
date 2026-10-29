import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:openapi/api.dart';

/// What the details sheet loads when it opens, beyond what the card already has. Either half may be missing: a failed
/// call leaves the card's data on the sheet and shows no error (as the web photo window does).
class LibraryCleanupDetails {
  const LibraryCleanupDetails({this.asset, this.albums});

  /// `GET /assets/{id}`: camera, exposure, file name, place and people.
  final AssetResponseDto? asset;

  /// `GET /albums?assetId={id}`; null when the call failed (no albums row), empty when the photo is in none.
  final List<AlbumResponseDto>? albums;
}

/// The two calls the web photo window makes (`web/src/lib/gallery/asset-context/asset-context-details.svelte`). The
/// mobile viewer reads its details from local Drift, which may not hold every cleanup photo, so the sheet asks the
/// server.
class LibraryCleanupDetailsRepository {
  const LibraryCleanupDetailsRepository({required AssetsApi assetsApi, required AlbumsApi albumsApi})
    : _assets = assetsApi,
      _albums = albumsApi;

  final AssetsApi _assets;
  final AlbumsApi _albums;

  Future<LibraryCleanupDetails> load(String assetId) async {
    final (asset, albums) = await (
      _assets.getAssetInfo(assetId).then<AssetResponseDto?>((value) => value, onError: (_) => null),
      _albums.getAllAlbums(assetId: assetId).then<List<AlbumResponseDto>?>((value) => value, onError: (_) => null),
    ).wait;
    return LibraryCleanupDetails(asset: asset, albums: albums);
  }
}

final libraryCleanupDetailsRepositoryProvider = Provider<LibraryCleanupDetailsRepository>((ref) {
  final api = ref.watch(apiServiceProvider);
  return LibraryCleanupDetailsRepository(assetsApi: api.assetsApi, albumsApi: api.albumsApi);
});

/// One photo's details, loaded when its sheet opens and dropped when it closes.
final libraryCleanupDetailsProvider = FutureProvider.autoDispose.family<LibraryCleanupDetails, String>(
  (ref, assetId) => ref.read(libraryCleanupDetailsRepositoryProvider).load(assetId),
);
