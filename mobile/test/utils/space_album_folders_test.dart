import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/space_album.model.dart';
import 'package:immich_mobile/domain/models/space_album_folder.model.dart';
import 'package:immich_mobile/utils/space_album_folders.dart';

SpaceAlbumFolder folder(String id, String name, [String? parentId]) =>
    SpaceAlbumFolder(id: id, spaceId: 'space-1', parentId: parentId, name: name);

// SpaceAlbum carries id, name, thumbnailAssetId, showInTimeline, assetCount, linkedAt, updatedAt, createdAt,
// plus the folderId Task 4 adds. Only id/name/folderId/updatedAt/thumbnailAssetId matter here; the
// rest are filled with inert defaults so the constructor is satisfied.
//
// `hasCover` defaults to true (a synthetic non-null thumbnailAssetId) so most fixtures behave like
// a normal album with a cover; pass `hasCover: false` for the folderPreviewAlbums cover-filter
// cases, which need a genuinely null thumbnailAssetId.
SpaceAlbum album(
  String id,
  String name, {
  String? folderId,
  DateTime? updatedAt,
  DateTime? endDate,
  bool hasCover = true,
  String? description,
}) => SpaceAlbum(
  id: id,
  name: name,
  description: description,
  thumbnailAssetId: hasCover ? 'thumb-$id' : null,
  showInTimeline: true,
  assetCount: 0,
  linkedAt: DateTime.utc(2026, 1, 1),
  updatedAt: updatedAt ?? DateTime.utc(2026, 1, 1),
  createdAt: DateTime.utc(2026, 1, 1),
  folderId: folderId,
  endDate: endDate,
);

/// Walks [nodes] depth-first, counting every visited node. Throws if the count ever exceeds
/// [budget] (the known total folder count) — the only way that can happen is a cycle in
/// `.children`. A plain recursive walk over a genuinely cyclic tree would recurse forever; this
/// bounds it so a regression fails the test instead of hanging the run.
int countTreeNodes(List<FolderNode> nodes, int budget, [int soFar = 0]) {
  var count = soFar;
  for (final node in nodes) {
    count++;
    if (count > budget) {
      throw StateError('walked more than $budget nodes — the tree contains a cycle');
    }
    count = countTreeNodes(node.children, budget, count);
  }
  return count;
}

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
      final folders = [folder('a', 'A', 'b'), folder('b', 'B', 'a')];
      final tree = buildFolderTree(folders);

      expect(tree.map((n) => n.folder.id).toList()..sort(), ['a', 'b']);
      // The flat top-level check above passes even if `.children` is cyclic (e.g. A.children ==
      // [B] and B.children == [A], same object identities) — it says nothing about the shape
      // below the top. This bounded walk is the assertion with teeth: it throws if the node count
      // ever exceeds the known total, which is the only way a cycle in `.children` can happen.
      expect(countTreeNodes(tree, folders.length), folders.length);
      expect(tree.every((n) => n.children.isEmpty), isTrue);
    });

    test('T-04: a 3-cycle A->B->C->A keeps all three folders at the root and does not loop', () {
      final folders = [folder('a', 'A', 'b'), folder('b', 'B', 'c'), folder('c', 'C', 'a')];
      final tree = buildFolderTree(folders);

      expect(tree.map((n) => n.folder.id).toList()..sort(), ['a', 'b', 'c']);
      expect(countTreeNodes(tree, folders.length), folders.length);
      expect(tree.every((n) => n.children.isEmpty), isTrue);
    });

    test('T-04: a folder hanging off a cycle member stays nested, not flattened to root', () {
      // A->B->C->A, plus D whose parent is B (a cycle member, not the cycle itself).
      final folders = [folder('a', 'A', 'b'), folder('b', 'B', 'c'), folder('c', 'C', 'a'), folder('d', 'D', 'b')];
      final tree = buildFolderTree(folders);

      expect(tree.map((n) => n.folder.id).toList()..sort(), ['a', 'b', 'c']);
      expect(countTreeNodes(tree, folders.length), folders.length);

      final nodeA = tree.firstWhere((n) => n.folder.id == 'a');
      final nodeB = tree.firstWhere((n) => n.folder.id == 'b');
      final nodeC = tree.firstWhere((n) => n.folder.id == 'c');
      expect(nodeA.children, isEmpty);
      expect(nodeB.children.map((n) => n.folder.id), ['d']);
      expect(nodeC.children, isEmpty);
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

    test('T-10: drops cover-less albums before sorting and taking, keeping only ones with a cover', () {
      final albums = [
        // Cover-less, but the most recent — without the filter these would win the take instead
        // of the covered albums below, and the folder would render an all-blank collage.
        album('nc1', 'NoCover1', folderId: 'trips', hasCover: false, updatedAt: DateTime.utc(2026, 9, 1)),
        album('nc2', 'NoCover2', folderId: 'trips', hasCover: false, updatedAt: DateTime.utc(2026, 8, 1)),
        album('nc3', 'NoCover3', folderId: 'trips', hasCover: false, updatedAt: DateTime.utc(2026, 7, 1)),
        album('nc4', 'NoCover4', folderId: 'trips', hasCover: false, updatedAt: DateTime.utc(2026, 6, 1)),
        // Covered, older than the cover-less albums above, but these are the only valid preview
        // candidates — a folder full of photos must never render a blank collage.
        album('c1', 'Cover1', folderId: 'trips', updatedAt: DateTime.utc(2026, 1, 1)),
        album('c2', 'Cover2', folderId: 'trips', updatedAt: DateTime.utc(2026, 2, 1)),
        album('c3', 'Cover3', folderId: 'trips', updatedAt: DateTime.utc(2026, 3, 1)),
        album('c4', 'Cover4', folderId: 'trips', updatedAt: DateTime.utc(2026, 4, 1)),
      ];

      expect(folderPreviewAlbums(tripsTree(), albums, 'trips').map((a) => a.id), ['c4', 'c3', 'c2', 'c1']);
    });

    test('T-10: ties on updatedAt break deterministically by id', () {
      final tied = DateTime.utc(2026, 6, 1);
      final albums = [
        album('c', 'C', folderId: 'trips', updatedAt: tied),
        album('a', 'A', folderId: 'trips', updatedAt: tied),
        album('b', 'B', folderId: 'trips', updatedAt: tied),
      ];

      expect(folderPreviewAlbums(tripsTree(), albums, 'trips').map((a) => a.id), ['a', 'b', 'c']);
    });

    test('T-10: with many albums tied on updatedAt, the tiebreaker keeps the result deterministic', () {
      // Comparator-defined ties (as opposed to relying on List.sort()'s stability) are correct
      // regardless of list size, but this exercises the exact shape the reviewer flagged: a bulk
      // import landing many albums with an identical updatedAt. Input order is deliberately the
      // reverse of the expected output.
      final tied = DateTime.utc(2026, 6, 1);
      final albums = List.generate(
        40,
        (i) => album('id-${(39 - i).toString().padLeft(2, '0')}', 'Album $i', folderId: 'trips', updatedAt: tied),
      );

      final result = folderPreviewAlbums(tripsTree(), albums, 'trips').map((a) => a.id).toList();

      expect(result, ['id-00', 'id-01', 'id-02', 'id-03']);
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

    // Name OR description, matching web's flattenForSearch and the flat filterAndSortSpaceAlbums
    // this path replaced when a query is active. Dropping the description silently narrowed search
    // the moment folders shipped: an album named "2026" described "Iceland road trip" stopped
    // matching "iceland", on mobile only. SpaceAlbum.description exists on the model for this and
    // nothing else.
    test('matches on description as well as name', () {
      final albums = [
        album('a1', '2026', folderId: 'y2026', description: 'Iceland road trip'),
        album('a2', 'Rome', description: 'City break'),
      ];

      final hits = flattenForSearch(tripsTree(), albums, 'iceland');

      expect(hits.map((h) => h.album.id).toList(), ['a1']);
      expect(hits.single.path, ['Trips', '2026']);
    });

    test('a null description does not match, and does not throw', () {
      final albums = [album('a1', 'Rome')];

      expect(flattenForSearch(tripsTree(), albums, 'iceland'), isEmpty);
    });

    test('T-14: a blank or whitespace-only query returns nothing, not everything', () {
      final albums = [album('a1', 'Rome')];

      expect(flattenForSearch(tripsTree(), albums, ''), isEmpty);
      expect(flattenForSearch(tripsTree(), albums, '   '), isEmpty);
    });
  });

  group('buildFolderSummaries', () {
    // The batch pass and the single-folder functions are two implementations of one definition:
    // the grid needs the batch one, the tests above pin the readable one. This is what stops
    // them drifting — for EVERY folder in each fixture, both must agree. The pathological shapes
    // are included because a shared-index rewrite is exactly where they diverge.
    final fixtures = <String, ({List<SpaceAlbumFolder> folders, List<SpaceAlbum> albums})>{
      'an empty space': (folders: <SpaceAlbumFolder>[], albums: <SpaceAlbum>[]),
      'a nested tree with albums at several depths': (
        folders: tripsTree(),
        albums: [
          album('a1', 'Rome', folderId: 'italy'),
          album('a2', 'Venice', folderId: 'y2026'),
          album('a3', 'Skiing', folderId: 'trips'),
          album('a4', 'Reunion', folderId: 'family'),
          album('a5', 'Unfiled'),
        ],
      ),
      'a dangling parentId': (
        folders: [folder('trips', 'Trips'), folder('orphan', 'Orphan', 'gone')],
        albums: [
          album('a1', 'Rome', folderId: 'orphan'),
          album('a2', 'Milan', folderId: 'trips'),
        ],
      ),
      'a self-referencing folder': (
        folders: [folder('loop', 'Loop', 'loop')],
        albums: [album('a1', 'Rome', folderId: 'loop')],
      ),
      'a two-folder cycle': (
        folders: [folder('a', 'A', 'b'), folder('b', 'B', 'a')],
        albums: [
          album('a1', 'Rome', folderId: 'a'),
          album('a2', 'Milan', folderId: 'b'),
        ],
      ),
      'albums whose cover is null': (
        folders: [folder('trips', 'Trips')],
        albums: [
          album('a1', 'Rome', folderId: 'trips', hasCover: false),
          album('a2', 'Milan', folderId: 'trips', hasCover: false),
        ],
      ),
      'more than four albums in one subtree': (
        folders: tripsTree(),
        albums: [
          for (var i = 0; i < 9; i++)
            album('a$i', 'Album $i', folderId: 'italy', endDate: DateTime.utc(2026, (i % 9) + 1, 1)),
        ],
      ),
    };

    fixtures.forEach((name, fixture) {
      test('agrees with the single-folder functions for $name', () {
        final summaries = buildFolderSummaries(fixture.folders, fixture.albums);

        expect(summaries.keys.toSet(), fixture.folders.map((f) => f.id).toSet());
        for (final f in fixture.folders) {
          expect(
            summaries[f.id]!.albumCount,
            recursiveAlbumCount(fixture.folders, fixture.albums, f.id),
            reason: 'albumCount for ${f.id}',
          );
          expect(
            summaries[f.id]!.previewAlbums.map((a) => a.id).toList(),
            folderPreviewAlbums(fixture.folders, fixture.albums, f.id).map((a) => a.id).toList(),
            reason: 'previewAlbums for ${f.id}',
          );
        }
      });
    });

    // Recency is the album's newest PHOTO, matching web's `endDate ?? updatedAt`. Sorting by
    // updatedAt alone made a stale album that merely re-synced recently outrank a genuinely
    // newer one, and made the two clients disagree about the same folder's collage.
    test('ranks previews by the newest photo, not by when the row was last touched', () {
      final folders = [folder('trips', 'Trips')];
      final albums = [
        // Touched most recently, but its photos are the oldest.
        album(
          'stale',
          'Old holiday',
          folderId: 'trips',
          updatedAt: DateTime.utc(2026, 12, 1),
          endDate: DateTime.utc(2020, 1, 1),
        ),
        album(
          'fresh',
          'Last week',
          folderId: 'trips',
          updatedAt: DateTime.utc(2026, 1, 1),
          endDate: DateTime.utc(2026, 6, 1),
        ),
      ];

      expect(folderPreviewAlbums(folders, albums, 'trips').map((a) => a.id).toList(), ['fresh', 'stale']);
      expect(buildFolderSummaries(folders, albums)['trips']!.previewAlbums.map((a) => a.id).toList(), [
        'fresh',
        'stale',
      ]);
    });
  });
}
