import 'package:immich_mobile/domain/models/album/album.model.dart';
import 'package:immich_mobile/domain/models/space_album.model.dart';
import 'package:openapi/api.dart';

/// Where a multi-selection can be sent.
///
/// Sealed so the dispatch table in `ActionNotifier` is exhaustive and checked by the
/// compiler: adding a destination without wiring it up becomes a build error.
sealed class CollectionTarget {
  const CollectionTarget();
}

/// A personal or shared album. Dispatches through the existing `addToAlbum`.
final class AlbumTarget extends CollectionTarget {
  const AlbumTarget(this.album);
  final RemoteAlbum album;
}

/// A space's own asset pool.
final class SpacePoolTarget extends CollectionTarget {
  const SpacePoolTarget(this.space);
  final SharedSpaceResponseDto space;
}

/// An album linked to a space.
///
/// [spaceId] is carried even though the add call does not need it: it identifies which
/// `spaceAlbumsProvider` to invalidate afterwards, and lets a space surface exclude its
/// own albums. It must NEVER be dispatched through `addToAlbum` — a linked album can be
/// "absorbed" (present only in `shared_space_album`, with no local `remote_album` row),
/// and `addToAlbum` also writes the local junction, which would hit a foreign-key
/// violation. See `SpaceAlbumActions.addAssets`.
final class SpaceAlbumTarget extends CollectionTarget {
  const SpaceAlbumTarget({required this.spaceId, required this.album});
  final String spaceId;
  final SpaceAlbum album;
}
