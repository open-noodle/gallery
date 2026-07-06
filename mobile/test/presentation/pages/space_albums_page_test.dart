import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/space_album.model.dart';
import 'package:immich_mobile/pages/library/spaces/space_albums.page.dart';
import 'package:immich_mobile/providers/infrastructure/space_album.provider.dart';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

SpaceAlbum _album({
  required String id,
  String? name,
  int assetCount = 0,
  bool showInTimeline = true,
}) =>
    SpaceAlbum(
      id: id,
      name: name ?? 'Album $id',
      assetCount: assetCount,
      showInTimeline: showInTimeline,
    );

/// Wraps [widget] in a [ProviderScope] that overrides [spaceAlbumsProvider]
/// with a fixed list, and a minimal [MaterialApp] for theme/directionality.
Widget _wrap(
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  const spaceId = 'space-1';

  testWidgets('editor + 2 albums: shows 2 cards with ⋮ menu and ＋ Link action', (tester) async {
    final albums = [
      _album(id: 'a1', name: 'Hawaii', assetCount: 142),
      _album(id: 'a2', name: 'Sunsets', assetCount: 38),
    ];

    await tester.pumpWidget(
      _wrap(
        const SpaceAlbumsPage(spaceId: spaceId, canEdit: true),
        spaceId: spaceId,
        albums: albums,
      ),
    );
    await tester.pump(); // let StreamProvider emit

    // 2 cards
    expect(find.byKey(const Key('space-album-card-a1')), findsOneWidget);
    expect(find.byKey(const Key('space-album-card-a2')), findsOneWidget);
    // ⋮ overflow menu on each card (editor)
    expect(find.byKey(const Key('space-album-card-menu-a1')), findsOneWidget);
    expect(find.byKey(const Key('space-album-card-menu-a2')), findsOneWidget);
    // ＋ Link action in app-bar (editor)
    expect(find.byKey(const Key('space-albums-link-action')), findsOneWidget);
  });

  testWidgets('viewer + 2 albums: shows 2 cards but NO ⋮ menu and NO ＋ Link action', (tester) async {
    final albums = [
      _album(id: 'a1', name: 'Hawaii'),
      _album(id: 'a2', name: 'Sunsets'),
    ];

    await tester.pumpWidget(
      _wrap(
        const SpaceAlbumsPage(spaceId: spaceId, canEdit: false),
        spaceId: spaceId,
        albums: albums,
      ),
    );
    await tester.pump();

    // 2 cards visible
    expect(find.byKey(const Key('space-album-card-a1')), findsOneWidget);
    expect(find.byKey(const Key('space-album-card-a2')), findsOneWidget);
    // No ⋮ menus for viewer
    expect(find.byKey(const Key('space-album-card-menu-a1')), findsNothing);
    expect(find.byKey(const Key('space-album-card-menu-a2')), findsNothing);
    // No ＋ Link action
    expect(find.byKey(const Key('space-albums-link-action')), findsNothing);
  });

  testWidgets('empty + editor: shows empty state', (tester) async {
    await tester.pumpWidget(
      _wrap(
        const SpaceAlbumsPage(spaceId: spaceId, canEdit: true),
        spaceId: spaceId,
        albums: [],
      ),
    );
    await tester.pump();

    expect(find.byKey(const Key('space-albums-empty')), findsOneWidget);
    // No album cards
    expect(find.byWidgetPredicate(
      (w) => w.key is ValueKey<String> && (w.key as ValueKey<String>).value.startsWith('space-album-card-'),
    ), findsNothing);
  });

  testWidgets('off-timeline album card shows visibility_off icon', (tester) async {
    final albums = [
      _album(id: 'a1', name: 'Hawaii', showInTimeline: true),
      _album(id: 'a2', name: 'Reef dives', showInTimeline: false, assetCount: 12),
    ];

    await tester.pumpWidget(
      _wrap(
        const SpaceAlbumsPage(spaceId: spaceId, canEdit: true),
        spaceId: spaceId,
        albums: albums,
      ),
    );
    await tester.pump();

    expect(find.byIcon(Icons.visibility_off), findsOneWidget);
    // The off-timeline card should show the "Hidden" label
    expect(find.text('· Hidden'), findsOneWidget);
  });
}
