import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/space_album.model.dart';
import 'package:immich_mobile/domain/models/space_album_folder.model.dart';
import 'package:immich_mobile/domain/services/asset.service.dart';
import 'package:immich_mobile/presentation/widgets/images/thumbnail.widget.dart';
import 'package:immich_mobile/presentation/widgets/spaces/space_album_folder_card.widget.dart';
import 'package:immich_mobile/presentation/widgets/spaces/space_album_folder_picker.widget.dart';
import 'package:immich_mobile/providers/infrastructure/asset.provider.dart';
import 'package:mocktail/mocktail.dart';

import '../../../unit/presentation/presentation_context.dart';
import '../../../widget_tester_extensions.dart';

class _MockAssetService extends Mock implements AssetService {}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

SpaceAlbumFolder _folder(String id, String name, {String? parentId}) =>
    SpaceAlbumFolder(id: id, spaceId: 'space-1', parentId: parentId, name: name);

/// trips (root) -> y2026 -> italy, plus an unrelated root: family.
List<SpaceAlbumFolder> tripsTree() => [
  _folder('trips', 'Trips'),
  _folder('y2026', '2026', parentId: 'trips'),
  _folder('italy', 'Italy', parentId: 'y2026'),
  _folder('family', 'Family'),
];

SpaceAlbum _album({required String id, String? thumbnailAssetId, DateTime? updatedAt}) => SpaceAlbum(
  id: id,
  name: 'Album $id',
  thumbnailAssetId: thumbnailAssetId,
  showInTimeline: true,
  linkedAt: DateTime.utc(2026, 1, 1),
  updatedAt: updatedAt ?? DateTime.utc(2026, 1, 1),
  createdAt: DateTime.utc(2026, 1, 1),
);

RemoteAsset _remoteAsset({required String id}) => RemoteAsset(
  id: id,
  checksum: 'checksum-$id',
  ownerId: 'owner-1',
  name: '$id.jpg',
  type: AssetType.image,
  createdAt: DateTime(2024, 1, 1),
  updatedAt: DateTime(2024, 1, 1),
  isEdited: false,
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Pumps [SpaceAlbumFolderCard] inside a bounded, grid-cell-sized box (mirrors
/// the `childAspectRatio: 0.75` cell `_AlbumGrid` uses) so the `Expanded` cover
/// area lays out exactly as it would inside the real grid.
Future<void> pumpCard(
  WidgetTester tester, {
  required SpaceAlbumFolder folder,
  required int albumCount,
  List<SpaceAlbum> previewAlbums = const [],
  bool canEdit = true,
  VoidCallback? onTap,
  VoidCallback? onRename,
  VoidCallback? onMove,
  VoidCallback? onDelete,
  AssetService? assetService,
}) async {
  await tester.pumpConsumerWidget(
    SizedBox(
      width: 180,
      height: 240,
      child: SpaceAlbumFolderCard(
        folder: folder,
        albumCount: albumCount,
        previewAlbums: previewAlbums,
        canEdit: canEdit,
        onTap: onTap,
        onRename: onRename,
        onMove: onMove,
        onDelete: onDelete,
      ),
    ),
    overrides: [if (assetService != null) assetServiceProvider.overrideWithValue(assetService)],
  );
}

Finder menuFinder() => find.byKey(const Key('space-album-folder-card-menu'));

/// Pumps the picker sheet directly (not through `showSpaceAlbumFolderPicker`),
/// mirroring how `SpaceEditSheet` is tested -- a bare callback instead of a
/// real `Navigator` round trip.
Future<void> pumpPickerSheet(
  WidgetTester tester, {
  required List<SpaceAlbumFolder> folders,
  String? excludeFolderId,
  String? currentFolderId,
  void Function(String? folderId)? onSelect,
}) async {
  await tester.pumpConsumerWidget(
    SpaceAlbumFolderPickerSheet(
      folders: folders,
      excludeFolderId: excludeFolderId,
      currentFolderId: currentFolderId,
      onSelect: onSelect ?? (_) {},
    ),
  );
}

/// Finds the picker row for [id] and reports whether it is tappable, per its
/// `onTap == null` state -- not its visual styling, which would pass either
/// way.
bool tileEnabled(WidgetTester tester, String id) {
  final key = id == 'root' ? const Key('folder-option-root') : Key('folder-option-$id');
  return tester.widget<ListTile>(find.byKey(key)).onTap != null;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  setUpAll(() async {
    // Initializes StoreService, needed by Thumbnail.remote's RemoteImageProvider
    // for the collage tests that resolve a real thumbnail.
    await PresentationContext.create();
  });

  group('SpaceAlbumFolderCard', () {
    // U-12 — a folder holding only subfolders must never read "0 albums"; the
    // count passed in is the RECURSIVE count, not a per-folder tally.
    testWidgets('U-12: shows the recursive album count', (tester) async {
      await pumpCard(tester, folder: _folder('trips', 'Trips'), albumCount: 12, previewAlbums: const []);

      expect(find.textContaining('12'), findsOneWidget);
    });

    // Not a U-12 case (U-12 is the folder-with-subfolders-but-nonzero-recursive-
    // count scenario, covered above) -- this is the plain complement: a folder
    // that is genuinely empty renders its zero count as-is, with no special-cased
    // "0 albums" text swapped in for it.
    testWidgets('a genuinely empty folder renders its zero recursive count as-is', (tester) async {
      await pumpCard(tester, folder: _folder('empty', 'Empty'), albumCount: 0, previewAlbums: const []);

      expect(find.textContaining('0'), findsOneWidget);
    });

    // U-06 — viewers get no management affordances at all.
    testWidgets('U-06: a viewer sees no overflow menu', (tester) async {
      await pumpCard(tester, folder: _folder('trips', 'Trips'), albumCount: 1, canEdit: false);

      expect(menuFinder(), findsNothing);
    });

    testWidgets('U-06: an editor sees the overflow menu', (tester) async {
      await pumpCard(tester, folder: _folder('trips', 'Trips'), albumCount: 1, canEdit: true);

      expect(menuFinder(), findsOneWidget);
    });

    testWidgets('tapping the card fires onTap', (tester) async {
      var tapped = false;
      await pumpCard(tester, folder: _folder('trips', 'Trips'), albumCount: 1, onTap: () => tapped = true);

      await tester.tap(find.byType(SpaceAlbumFolderCard));
      await tester.pump();

      expect(tapped, isTrue);
    });

    testWidgets('the overflow menu forwards Rename / Move / Delete to their callbacks', (tester) async {
      var renamed = false;
      var moved = false;
      var deleted = false;

      await pumpCard(
        tester,
        folder: _folder('trips', 'Trips'),
        albumCount: 1,
        onRename: () => renamed = true,
        onMove: () => moved = true,
        onDelete: () => deleted = true,
      );

      await tester.tap(menuFinder());
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('space-album-folder-card-rename')));
      await tester.pumpAndSettle();
      expect(renamed, isTrue);

      await tester.tap(menuFinder());
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('space-album-folder-card-move')));
      await tester.pumpAndSettle();
      expect(moved, isTrue);

      await tester.tap(menuFinder());
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('space-album-folder-card-delete')));
      await tester.pumpAndSettle();
      expect(deleted, isTrue);
    });

    testWidgets('an empty previewAlbums list falls back to a folder glyph, not a broken tile', (tester) async {
      await pumpCard(tester, folder: _folder('trips', 'Trips'), albumCount: 0, previewAlbums: const []);

      expect(find.byIcon(Icons.folder_outlined), findsOneWidget);
      expect(find.byType(Thumbnail), findsNothing);
    });

    for (final count in [1, 2, 3, 4]) {
      testWidgets('a $count-cover previewAlbums list renders each cover in its own slot, in order', (tester) async {
        final mockService = _MockAssetService();
        final albums = [for (var i = 0; i < count; i++) _album(id: 'a$i', thumbnailAssetId: 'thumb-$i')];
        for (var i = 0; i < count; i++) {
          when(() => mockService.getRemoteAsset('thumb-$i')).thenAnswer((_) async => _remoteAsset(id: 'thumb-$i'));
        }

        await pumpCard(
          tester,
          folder: _folder('trips', 'Trips'),
          albumCount: count,
          previewAlbums: albums,
          assetService: mockService,
        );
        // The FutureBuilder resolves the mocked (already-completed) Future
        // asynchronously; a follow-up pump lets it rebuild with the Thumbnail.
        await tester.pump();

        expect(find.byType(Thumbnail), findsNWidgets(count));
        // No leftover empty-folder glyph once at least one real cover renders.
        expect(find.byIcon(Icons.folder_outlined), findsNothing);

        // Order-sensitive: pins WHICH album lands in WHICH slot, not merely
        // that `count` Thumbnails exist somewhere. `_buildTile` calls
        // `getRemoteAsset` synchronously while the collage's Row/Column
        // children lists are being built, in the exact left-to-right /
        // top-to-bottom order the tiles are declared (slot 0, 1, 2, 3). So
        // asserting the mock's call order pins per-tile content: duplicating
        // one album into another tile's slot leaves an expected id never
        // called, and swapping two tiles reverses the call order -- either
        // mutation breaks this `verifyInOrder`, unlike a presence-only check
        // (each id called exactly once, any order) which a swap would still
        // pass.
        verifyInOrder([for (var i = 0; i < count; i++) () => mockService.getRemoteAsset('thumb-$i')]);
      });
    }
  });

  group('SpaceAlbumFolderPickerSheet', () {
    // U-07 — offering a folder's own subtree as a destination would guarantee
    // a server 400. Disabling it means the illegal choice is never tappable.
    testWidgets('U-07: disables the moved folder and its descendants', (tester) async {
      await pumpPickerSheet(tester, folders: tripsTree(), excludeFolderId: 'trips');

      expect(tileEnabled(tester, 'trips'), isFalse, reason: 'the moved folder itself');
      expect(tileEnabled(tester, 'y2026'), isFalse, reason: 'a direct child');
      expect(tileEnabled(tester, 'italy'), isFalse, reason: 'a grandchild');
      expect(tileEnabled(tester, 'family'), isTrue, reason: 'an unrelated root folder');
      expect(tileEnabled(tester, 'root'), isTrue, reason: 'moving to the space root is always legal');
    });

    // U-08 — moving an ALBUM has no subtree to exclude, so everything stays
    // selectable.
    testWidgets('U-08: leaves every folder selectable when nothing is excluded', (tester) async {
      await pumpPickerSheet(tester, folders: tripsTree(), excludeFolderId: null);

      for (final id in ['trips', 'y2026', 'italy', 'family']) {
        expect(tileEnabled(tester, id), isTrue);
      }
    });

    testWidgets('renders a root option plus one row per folder', (tester) async {
      await pumpPickerSheet(tester, folders: tripsTree(), excludeFolderId: null);

      expect(find.byKey(const Key('folder-option-root')), findsOneWidget);
      for (final id in ['trips', 'y2026', 'italy', 'family']) {
        expect(find.byKey(Key('folder-option-$id')), findsOneWidget);
      }
    });

    testWidgets('tapping an enabled row calls onSelect with that folder id', (tester) async {
      String? selected = 'unset';
      await pumpPickerSheet(tester, folders: tripsTree(), excludeFolderId: null, onSelect: (id) => selected = id);

      await tester.tap(find.byKey(const Key('folder-option-family')));
      await tester.pump();

      expect(selected, 'family');
    });

    testWidgets('tapping the root option calls onSelect with null', (tester) async {
      String? selected = 'unset';
      await pumpPickerSheet(tester, folders: tripsTree(), excludeFolderId: 'trips', onSelect: (id) => selected = id);

      await tester.tap(find.byKey(const Key('folder-option-root')));
      await tester.pump();

      expect(selected, isNull);
    });

    testWidgets('tapping a disabled row does nothing', (tester) async {
      var called = false;
      await pumpPickerSheet(tester, folders: tripsTree(), excludeFolderId: 'trips', onSelect: (_) => called = true);

      await tester.tap(find.byKey(const Key('folder-option-y2026')), warnIfMissed: false);
      await tester.pump();

      expect(called, isFalse);
    });
  });

  group('showSpaceAlbumFolderPicker', () {
    testWidgets('resolves picked=true with the tapped folder id', (tester) async {
      ({bool picked, String? folderId})? result;
      await tester.pumpConsumerWidget(
        Builder(
          builder: (context) => ElevatedButton(
            onPressed: () async {
              result = await showSpaceAlbumFolderPicker(context, folders: tripsTree(), excludeFolderId: null);
            },
            child: const Text('open'),
          ),
        ),
      );

      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('folder-option-family')));
      await tester.pumpAndSettle();

      expect(result, (picked: true, folderId: 'family'));
    });

    testWidgets('resolves picked=true with a null folderId for the root option', (tester) async {
      ({bool picked, String? folderId})? result;
      await tester.pumpConsumerWidget(
        Builder(
          builder: (context) => ElevatedButton(
            onPressed: () async {
              result = await showSpaceAlbumFolderPicker(context, folders: tripsTree(), excludeFolderId: 'trips');
            },
            child: const Text('open'),
          ),
        ),
      );

      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('folder-option-root')));
      await tester.pumpAndSettle();

      expect(result, (picked: true, folderId: null));
    });

    testWidgets('resolves picked=false when dismissed without a selection', (tester) async {
      ({bool picked, String? folderId})? result;
      await tester.pumpConsumerWidget(
        Builder(
          builder: (context) => ElevatedButton(
            onPressed: () async {
              result = await showSpaceAlbumFolderPicker(context, folders: tripsTree(), excludeFolderId: null);
            },
            child: const Text('open'),
          ),
        ),
      );

      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();

      // Tap the modal barrier (outside the sheet) to dismiss without picking.
      await tester.tapAt(const Offset(10, 10));
      await tester.pumpAndSettle();

      expect(result, (picked: false, folderId: null));
    });
  });
}
