import 'package:immich_mobile/domain/models/album/album.model.dart';

/// Returns the subset of [albums] that the current user can link to a space:
/// albums they **own** or can **edit**, excluding any id already in
/// [linkedAlbumIds], optionally filtered by [query] (case-insensitive name
/// contains).
///
/// Ownership is determined by `album.ownerId == currentUserId`.
/// Edit access is determined by `album.currentUserRole == AlbumUserRole.editor`.
/// Albums without a role and not owned by the current user are excluded.
List<RemoteAlbum> linkableAlbumCandidates({
  required List<RemoteAlbum> albums,
  required String currentUserId,
  required Set<String> linkedAlbumIds,
  String query = '',
}) {
  final lowerQuery = query.toLowerCase();

  return albums.where((album) {
    // Must be owner or editor.
    final isOwner = album.ownerId == currentUserId;
    final isEditor = album.currentUserRole == AlbumUserRole.editor;
    if (!isOwner && !isEditor) return false;

    // Must not already be linked.
    if (linkedAlbumIds.contains(album.id)) return false;

    // Optional name-contains filter.
    if (lowerQuery.isNotEmpty && !album.name.toLowerCase().contains(lowerQuery)) return false;

    return true;
  }).toList();
}
