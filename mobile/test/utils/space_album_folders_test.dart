import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/space_album.model.dart';
import 'package:immich_mobile/domain/models/space_album_folder.model.dart';
import 'package:immich_mobile/utils/space_album_folders.dart';

SpaceAlbumFolder folder(String id, String name, [String? parentId]) =>
    SpaceAlbumFolder(id: id, spaceId: 'space-1', parentId: parentId, name: name);

// SpaceAlbum carries id, name, thumbnailAssetId, showInTimeline, assetCount, linkedAt, updatedAt,
// plus the folderId Task 4 adds. Only id/name/folderId/updatedAt matter here; the rest are filled
// with inert defaults so the constructor is satisfied.
SpaceAlbum album(String id, String name, {String? folderId, DateTime? updatedAt}) => SpaceAlbum(
  id: id,
  name: name,
  thumbnailAssetId: null,
  showInTimeline: true,
  assetCount: 0,
  linkedAt: DateTime.utc(2026, 1, 1),
  updatedAt: updatedAt ?? DateTime.utc(2026, 1, 1),
  folderId: folderId,
);

// Trips > 2026 > Italy, plus a sibling Family at the root.
List<SpaceAlbumFolder> tripsTree() => [
  folder('trips', 'Trips'),
  folder('y2026', '2026', 'trips'),
  folder('italy', 'Italy', 'y2026'),
  folder('family', 'Family'),
];

void main() {
  group('buildFolderTree', () {
    test('T-01: nests folders under their parents, roots at the top', () {
      final tree = buildFolderTree(tripsTree());

      expect(tree.map((n) => n.folder.id), ['trips', 'family']);
      expect(tree.first.children.map((n) => n.folder.id), ['y2026']);
      expect(tree.first.children.first.children.map((n) => n.folder.id), ['italy']);
    });

    // T-02 — sync makes no ordering guarantee, so a dangling parentId is the NORMAL mid-sync
    // state, not corrupt data. It must show at the root, never vanish and never throw.
    test('T-02: a folder whose parent is absent is treated as a root', () {
      final tree = buildFolderTree([folder('trips', 'Trips'), folder('orphan', 'Orphan', 'gone')]);

      expect(tree.map((n) => n.folder.id).toList()..sort(), ['orphan', 'trips']);
    });

    test('T-03: a self-referencing folder is treated as a root and does not loop', () {
      final tree = buildFolderTree([folder('loop', 'Loop', 'loop')]);

      expect(tree.map((n) => n.folder.id), ['loop']);
    });

    test('T-04: a mutual A<->B cycle keeps both folders and does not loop', () {
      final tree = buildFolderTree([folder('a', 'A', 'b'), folder('b', 'B', 'a')]);

      expect(tree.map((n) => n.folder.id).toList()..sort(), ['a', 'b']);
    });
  });

  group('folderPath', () {
    test('T-05: returns the ancestor chain root-first', () {
      expect(folderPath(tripsTree(), 'italy').map((f) => f.name), ['Trips', '2026', 'Italy']);
    });

    test('T-06: returns empty for the space root and for an unknown id', () {
      expect(folderPath(tripsTree(), null), isEmpty);
      expect(folderPath(tripsTree(), 'gone'), isEmpty);
    });
  });

  group('folderContents', () {
    test('T-07: returns only the folders and albums at this level', () {
      final albums = [album('a1', 'Rome', folderId: 'y2026'), album('a2', 'Venice', folderId: 'italy')];

      final contents = folderContents(tripsTree(), albums, 'y2026');

      expect(contents.folders.map((f) => f.id), ['italy']);
      expect(contents.albums.map((a) => a.id), ['a1']);
    });

    // T-08 — THE mobile-specific case. On web this needs a fetch race and was deferred; here an
    // album row arriving before its folder row is routine, so hiding it would make albums blink
    // out of the grid mid-sync. It must fall back to the root.
    test('T-08: an album whose folder is missing appears at the ROOT, never hidden', () {
      final albums = [album('a1', 'Rome', folderId: 'not-synced-yet')];

      final atRoot = folderContents(tripsTree(), albums, null);

      expect(atRoot.albums.map((a) => a.id), ['a1']);
    });
  });

  group('recursiveAlbumCount', () {
    test('T-09: counts albums anywhere in the subtree', () {
      final albums = [
        album('a1', 'Rome', folderId: 'y2026'),
        album('a2', 'Venice', folderId: 'italy'),
        album('a3', 'Loose'),
      ];

      expect(recursiveAlbumCount(tripsTree(), albums, 'trips'), 2);
      expect(recursiveAlbumCount(tripsTree(), albums, 'italy'), 1);
      expect(recursiveAlbumCount(tripsTree(), albums, 'family'), 0);
    });
  });

  group('folderPreviewAlbums', () {
    test('T-10: returns at most four, newest first, even when the newest is last in the list', () {
      final albums = [
        album('a1', 'One', folderId: 'trips', updatedAt: DateTime.utc(2026, 1, 1)),
        album('a2', 'Two', folderId: 'trips', updatedAt: DateTime.utc(2026, 2, 1)),
        album('a3', 'Three', folderId: 'trips', updatedAt: DateTime.utc(2026, 3, 1)),
        album('a4', 'Four', folderId: 'trips', updatedAt: DateTime.utc(2026, 4, 1)),
        album('a5', 'Five', folderId: 'trips', updatedAt: DateTime.utc(2026, 5, 1)),
      ];

      // Sort-then-take, not take-then-sort: the latter returns an arbitrary subset. The web
      // implementation shipped that bug once, so this fixture puts the newest album LAST.
      expect(folderPreviewAlbums(tripsTree(), albums, 'trips').map((a) => a.id), ['a5', 'a4', 'a3', 'a2']);
    });

    test('T-11: returns empty for an empty folder', () {
      expect(folderPreviewAlbums(tripsTree(), const [], 'family'), isEmpty);
    });
  });

  group('isDescendant', () {
    test('T-12: true for descendants, false for ancestors, siblings, self and unknowns', () {
      expect(isDescendant(tripsTree(), 'italy', 'trips'), isTrue);
      expect(isDescendant(tripsTree(), 'trips', 'italy'), isFalse);
      expect(isDescendant(tripsTree(), 'family', 'trips'), isFalse);
      expect(isDescendant(tripsTree(), 'trips', 'trips'), isFalse);
      expect(isDescendant(tripsTree(), 'ghost', 'trips'), isFalse);
    });
  });

  group('flattenForSearch', () {
    test('T-13: matches space-wide and labels each hit with its path', () {
      final albums = [
        album('a1', 'Venice', folderId: 'y2026'),
        album('a2', 'Ventoux', folderId: 'italy'),
        album('a3', 'Rome'),
      ];

      final hits = flattenForSearch(tripsTree(), albums, 'ven');

      expect(hits.map((h) => h.album.id).toList()..sort(), ['a1', 'a2']);
      expect(hits.firstWhere((h) => h.album.id == 'a1').path, ['Trips', '2026']);
      expect(hits.firstWhere((h) => h.album.id == 'a2').path, ['Trips', '2026', 'Italy']);
    });

    test('T-13: gives a root-level album an empty path', () {
      final hits = flattenForSearch(tripsTree(), [album('a3', 'Rome')], 'rome');

      expect(hits.single.path, isEmpty);
    });

    test('T-14: a blank or whitespace-only query returns nothing, not everything', () {
      final albums = [album('a1', 'Rome')];

      expect(flattenForSearch(tripsTree(), albums, ''), isEmpty);
      expect(flattenForSearch(tripsTree(), albums, '   '), isEmpty);
    });
  });
}
