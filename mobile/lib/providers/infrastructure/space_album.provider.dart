import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/space_album.model.dart';
import 'package:immich_mobile/infrastructure/repositories/space_album.repository.dart';
import 'package:immich_mobile/providers/infrastructure/db.provider.dart';

final spaceAlbumRepositoryProvider = Provider<SpaceAlbumRepository>(
  (ref) => SpaceAlbumRepository(ref.watch(driftProvider)),
);

/// Watches all albums linked to the given [spaceId].
///
/// Emits a reactive [List<SpaceAlbum>] ordered by album name. Each
/// [SpaceAlbum] carries the joined metadata (name, thumbnailAssetId) and the
/// per-space link fields (showInTimeline).
final spaceAlbumsProvider = StreamProvider.family<List<SpaceAlbum>, String>(
  (ref, spaceId) => ref.watch(spaceAlbumRepositoryProvider).watchLinkedAlbums(spaceId),
);
