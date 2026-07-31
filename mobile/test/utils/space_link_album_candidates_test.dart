import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/album/album.model.dart';
import 'package:immich_mobile/utils/space_link_album_candidates.dart';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

RemoteAlbum _album({
  required String id,
  required String ownerId,
  String? name,
  int assetCount = 0,
  AlbumUserRole? currentUserRole,
}) => RemoteAlbum(
  id: id,
  name: name ?? 'Album $id',
  ownerId: ownerId,
  description: '',
  createdAt: DateTime(2026, 1, 1),
  updatedAt: DateTime(2026, 1, 1),
  isActivityEnabled: false,
  order: AlbumAssetOrder.desc,
  assetCount: assetCount,
  ownerName: 'Test User',
  isShared: false,
  currentUserRole: currentUserRole,
);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  const me = 'user-me';
  const other = 'user-other';

  group('linkableAlbumCandidates', () {
    test('includes an album owned by currentUserId', () {
      final owned = _album(id: 'a1', ownerId: me, name: 'My Album');
      final result = linkableAlbumCandidates(albums: [owned], currentUserId: me, linkedAlbumIds: {});
      expect(result.map((a) => a.id), contains('a1'));
    });

    test('includes an album where the user is an editor (not owner)', () {
      final shared = _album(id: 'a2', ownerId: other, name: 'Shared Edit', currentUserRole: AlbumUserRole.editor);
      final result = linkableAlbumCandidates(albums: [shared], currentUserId: me, linkedAlbumIds: {});
      expect(result.map((a) => a.id), contains('a2'));
    });

    test('excludes an album where the user is only a viewer', () {
      final viewer = _album(id: 'a3', ownerId: other, name: 'View Only', currentUserRole: AlbumUserRole.viewer);
      final result = linkableAlbumCandidates(albums: [viewer], currentUserId: me, linkedAlbumIds: {});
      expect(result.map((a) => a.id), isNot(contains('a3')));
    });

    test('excludes an album whose id is in linkedAlbumIds', () {
      final owned = _album(id: 'a4', ownerId: me, name: 'Already Linked');
      final result = linkableAlbumCandidates(albums: [owned], currentUserId: me, linkedAlbumIds: {'a4'});
      expect(result, isEmpty);
    });

    test('filters by query (case-insensitive name contains)', () {
      final albums = [
        _album(id: 'a5', ownerId: me, name: 'Hawaii 2025'),
        _album(id: 'a6', ownerId: me, name: 'Sunsets'),
        _album(id: 'a7', ownerId: me, name: 'Beach hawaii'),
      ];
      final result = linkableAlbumCandidates(albums: albums, currentUserId: me, linkedAlbumIds: {}, query: 'HAWAII');
      expect(result.map((a) => a.id).toSet(), equals({'a5', 'a7'}));
    });

    test('empty query returns all own/editable candidates', () {
      final albums = [
        _album(id: 'a8', ownerId: me, name: 'Album A'),
        _album(id: 'a9', ownerId: other, currentUserRole: AlbumUserRole.editor, name: 'Album B'),
        _album(id: 'a10', ownerId: other, currentUserRole: AlbumUserRole.viewer, name: 'Album C'),
      ];
      final result = linkableAlbumCandidates(albums: albums, currentUserId: me, linkedAlbumIds: {});
      expect(result.map((a) => a.id).toSet(), equals({'a8', 'a9'}));
    });

    test('combination: exclude linked AND viewer AND query filter', () {
      final albums = [
        _album(id: 'b1', ownerId: me, name: 'Paris Trip'), // own — passes filter
        _album(id: 'b2', ownerId: me, name: 'Paris 2'), // own — already linked
        _album(id: 'b3', ownerId: other, currentUserRole: AlbumUserRole.viewer, name: 'Paris View'), // viewer
        _album(id: 'b4', ownerId: other, currentUserRole: AlbumUserRole.editor, name: 'Paris Edit'), // edit
      ];
      final result = linkableAlbumCandidates(albums: albums, currentUserId: me, linkedAlbumIds: {'b2'}, query: 'paris');
      expect(result.map((a) => a.id).toSet(), equals({'b1', 'b4'}));
    });
  });
}
