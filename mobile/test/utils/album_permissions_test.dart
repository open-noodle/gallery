import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/album/album.model.dart';
import 'package:immich_mobile/utils/album_permissions.dart';

import '../unit/factories/remote_album_factory.dart';

void main() {
  RemoteAlbum album(String name, AlbumUserRole? role) =>
      RemoteAlbumFactory.create(id: name, name: name, currentUserRole: role);

  group('canAddAssetsToAlbum', () {
    test('refuses a viewer-role album', () {
      // The server's AlbumAssetCreate is owner ∪ editor ∪ space-linked, so a viewer's add
      // is rejected on the album id before any asset is touched.
      expect(canAddAssetsToAlbum(album('Viewer', AlbumUserRole.viewer)), isFalse);
    });

    test('allows an editor-role album', () {
      expect(canAddAssetsToAlbum(album('Editor', AlbumUserRole.editor)), isTrue);
    });

    test('allows an owner-role album', () {
      expect(canAddAssetsToAlbum(album('Owner', AlbumUserRole.owner)), isTrue);
    });

    test('allows an album whose role is unknown, rather than hiding it', () {
      // Fails open on purpose: null means "not known", not "viewer". Hiding an album we are
      // unsure about would make a legitimate target vanish silently.
      expect(canAddAssetsToAlbum(album('Unknown', null)), isTrue);
    });
  });

  group('albumsUserCanAddTo', () {
    test('drops only the viewer-role albums and preserves order', () {
      final albums = [
        album('Owned', AlbumUserRole.owner),
        album('Viewer', AlbumUserRole.viewer),
        album('Editor', AlbumUserRole.editor),
        album('Unknown', null),
      ];

      expect(albumsUserCanAddTo(albums).map((a) => a.name), ['Owned', 'Editor', 'Unknown']);
    });

    test('returns an empty list when every album is viewer-role', () {
      final albums = [album('V1', AlbumUserRole.viewer), album('V2', AlbumUserRole.viewer)];

      expect(albumsUserCanAddTo(albums), isEmpty);
    });

    test('returns an empty list unchanged', () {
      expect(albumsUserCanAddTo(const []), isEmpty);
    });
  });
}
