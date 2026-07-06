/// B6 mutation-wiring tests.
///
/// Asserts:
///  1. SpaceAlbumsPage: onToggle/onUnlink callbacks are invoked with the
///     correct albumId (the test supplies them as explicit callbacks — the real
///     wiring lives in SpaceDetailPage which is harder to pump in isolation).
///  2. SpaceAlbumKebab (via SpaceAlbumAppBar): each action fires the supplied
///     callback; canEdit:false → no kebab affordance (viewer-denied gate).
///  3. SpaceAlbumsPage: canEdit:false → no ⋮ menu and no ＋ Link (viewer gate
///     re-assertion per plan §10.4 role matrix).
///
/// The SpaceDetailPage._onAlbumsPicked real implementation (spaceAlbumActionsProvider
/// wiring) is tested via the SpaceAlbumActions unit tests in Task 2 (the
/// provider path). Integration is confirmed by the on-device verify.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/space_album.model.dart';
import 'package:immich_mobile/pages/library/spaces/space_album_detail.page.dart';
import 'package:immich_mobile/pages/library/spaces/space_albums.page.dart';
import 'package:immich_mobile/providers/infrastructure/space_album.provider.dart';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

SpaceAlbum _album({
  required String id,
  String name = 'Album',
  int assetCount = 0,
  bool showInTimeline = true,
}) =>
    SpaceAlbum(
      id: id,
      name: name,
      assetCount: assetCount,
      showInTimeline: showInTimeline,
    );

Widget _wrapPage(
  Widget widget, {
  required String spaceId,
  required List<SpaceAlbum> albums,
}) {
  return ProviderScope(
    overrides: [
      spaceAlbumsProvider(spaceId).overrideWith((_) => Stream.value(albums)),
    ],
    child: MaterialApp(home: widget),
  );
}

/// Wraps a SliverAppBar in a scrollable context so it renders.
Widget _wrapSliver(Widget sliver) => MaterialApp(
      home: Scaffold(
        body: CustomScrollView(
          slivers: [sliver, const SliverToBoxAdapter(child: SizedBox(height: 800))],
        ),
      ),
    );

// ---------------------------------------------------------------------------
// SpaceAlbumsPage callback tests (wiring contract)
// ---------------------------------------------------------------------------

void main() {
  const spaceId = 'space-1';

  group('SpaceAlbumsPage — onToggle callback wiring', () {
    testWidgets('editor taps Show/Hide in timeline — onToggle invoked with correct albumId',
        (tester) async {
      String? toggledId;
      final albums = [
        _album(id: 'a1', name: 'Hawaii', showInTimeline: true),
        _album(id: 'a2', name: 'Reef', showInTimeline: false),
      ];

      await tester.pumpWidget(
        _wrapPage(
          SpaceAlbumsPage(
            spaceId: spaceId,
            canEdit: true,
            onToggle: (id) => toggledId = id,
            onUnlink: (_) {},
          ),
          spaceId: spaceId,
          albums: albums,
        ),
      );
      await tester.pump();

      // Open the ⋮ menu for album a1
      await tester.tap(find.byKey(const Key('space-album-card-menu-a1')));
      await tester.pumpAndSettle();

      // Tap the "Hide in timeline" option
      await tester.tap(find.text('Hide in timeline'));
      await tester.pumpAndSettle();

      expect(toggledId, 'a1');
    });

    testWidgets('viewer (canEdit:false) — no ⋮ menu, onToggle never invoked',
        (tester) async {
      String? toggledId;
      final albums = [_album(id: 'a1', name: 'Hawaii')];

      await tester.pumpWidget(
        _wrapPage(
          SpaceAlbumsPage(
            spaceId: spaceId,
            canEdit: false,
            onToggle: (id) => toggledId = id,
            onUnlink: (_) {},
          ),
          spaceId: spaceId,
          albums: albums,
        ),
      );
      await tester.pump();

      expect(find.byKey(const Key('space-album-card-menu-a1')), findsNothing);
      expect(toggledId, isNull);
    });
  });

  group('SpaceAlbumsPage — onUnlink callback wiring', () {
    testWidgets('editor taps Unlink — onUnlink invoked with correct albumId',
        (tester) async {
      String? unlinkedId;
      final albums = [_album(id: 'a1', name: 'Hawaii')];

      await tester.pumpWidget(
        _wrapPage(
          SpaceAlbumsPage(
            spaceId: spaceId,
            canEdit: true,
            onToggle: (_) {},
            onUnlink: (id) => unlinkedId = id,
          ),
          spaceId: spaceId,
          albums: albums,
        ),
      );
      await tester.pump();

      await tester.tap(find.byKey(const Key('space-album-card-menu-a1')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Unlink from space'));
      await tester.pumpAndSettle();

      expect(unlinkedId, 'a1');
    });

    testWidgets('viewer (canEdit:false) — no ＋ Link action in app-bar',
        (tester) async {
      await tester.pumpWidget(
        _wrapPage(
          const SpaceAlbumsPage(spaceId: spaceId, canEdit: false),
          spaceId: spaceId,
          albums: [_album(id: 'a1')],
        ),
      );
      await tester.pump();

      expect(find.byKey(const Key('space-albums-link-action')), findsNothing);
    });
  });

  // ---------------------------------------------------------------------------
  // SpaceAlbumKebab / SpaceAlbumAppBar tests
  // ---------------------------------------------------------------------------

  group('SpaceAlbumKebab callbacks', () {
    testWidgets('canEdit:true — Add photos fires onAddPhotos', (tester) async {
      var addCount = 0;

      await tester.pumpWidget(
        _wrapSliver(
          SpaceAlbumAppBar(
            canEdit: true,
            album: _album(id: 'a1', name: 'Hawaii'),
            onAddPhotos: () => addCount++,
            onToggleTimeline: () {},
            onUnlink: () {},
          ),
        ),
      );
      await tester.pump();

      await tester.tap(find.byWidgetPredicate((w) => w is PopupMenuButton));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Add photos'));
      await tester.pumpAndSettle();

      expect(addCount, 1);
    });

    testWidgets('canEdit:true — Toggle timeline fires onToggleTimeline', (tester) async {
      var toggleCount = 0;

      await tester.pumpWidget(
        _wrapSliver(
          SpaceAlbumAppBar(
            canEdit: true,
            album: _album(id: 'a1', showInTimeline: true),
            onAddPhotos: () {},
            onToggleTimeline: () => toggleCount++,
            onUnlink: () {},
          ),
        ),
      );
      await tester.pump();

      await tester.tap(find.byWidgetPredicate((w) => w is PopupMenuButton));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Hide from timeline'));
      await tester.pumpAndSettle();

      expect(toggleCount, 1);
    });

    testWidgets('canEdit:true — Unlink fires onUnlink', (tester) async {
      var unlinkCount = 0;

      await tester.pumpWidget(
        _wrapSliver(
          SpaceAlbumAppBar(
            canEdit: true,
            album: _album(id: 'a1'),
            onAddPhotos: () {},
            onToggleTimeline: () {},
            onUnlink: () => unlinkCount++,
          ),
        ),
      );
      await tester.pump();

      await tester.tap(find.byWidgetPredicate((w) => w is PopupMenuButton));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Unlink from space'));
      await tester.pumpAndSettle();

      expect(unlinkCount, 1);
    });

    testWidgets('canEdit:false — no kebab affordance (viewer-denied)', (tester) async {
      await tester.pumpWidget(
        _wrapSliver(
          SpaceAlbumAppBar(
            canEdit: false,
            album: _album(id: 'a1'),
            onAddPhotos: () {},
            onToggleTimeline: () {},
            onUnlink: () {},
          ),
        ),
      );
      await tester.pump();

      expect(find.byWidgetPredicate((w) => w is PopupMenuButton), findsNothing);
    });
  });
}
