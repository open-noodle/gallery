import 'package:immich_mobile/domain/models/album/album.model.dart';

/// Role predicates for albums, shared by every surface that gates on them.
///
/// Companion to `space_permissions.dart`, which does the same job for shared spaces.

/// Whether the current user can add assets to [album].
///
/// Mirrors the server's `Permission.AlbumAssetCreate`, which grants
/// owner ∪ shared-with-[AlbumUserRole.editor] ∪ space-linked (`server/src/utils/access.ts`).
/// That check runs on the album id *before* any asset is touched, so a viewer's request is
/// rejected wholesale rather than per-asset — the client cannot report anything more useful
/// than a generic error. A viewer-role album offered as a target is therefore a dead end.
///
/// **Deliberately fails open.** A null [RemoteAlbum.currentUserRole] means "not known" — the
/// album is not in the role table, or the row has not synced — and is treated as usable. Only
/// a role we positively know to be [AlbumUserRole.viewer] is refused. Hiding an album we are
/// merely unsure about would make a legitimate target vanish with no explanation, which is a
/// worse failure than offering one the server then declines; the server is the real enforcer
/// either way. Same posture as `driftSpaceEditableProvider` for space people.
///
/// Space-linked albums are not a concern here: they carry no `album_user` row for the caller,
/// so they never appear in the personal album list to begin with — which is exactly why they
/// need their own section in the picker.
bool canAddAssetsToAlbum(RemoteAlbum album) => album.currentUserRole != AlbumUserRole.viewer;

/// [albums] with the ones the current user cannot add to removed.
///
/// Used by the add-to-collection pickers. Album *browsers* must not use this — a viewer-role
/// album is perfectly valid to open and look at; it is only invalid as an add target.
List<RemoteAlbum> albumsUserCanAddTo(List<RemoteAlbum> albums) => albums.where(canAddAssetsToAlbum).toList();
