import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/space_album.model.dart';
import 'package:immich_mobile/pages/library/spaces/space_album_detail.page.dart';
import 'package:immich_mobile/presentation/widgets/spaces/space_album_kebab.widget.dart';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/// Wraps a SliverAppBar widget in a proper sliver context for testing.
Widget _wrapSliver(Widget sliverWidget) => MaterialApp(
  home: Scaffold(
    body: CustomScrollView(
      slivers: [sliverWidget, const SliverToBoxAdapter(child: SizedBox(height: 800))],
    ),
  ),
);

SpaceAlbum _album({required String id, String? name, bool showInTimeline = true, int assetCount = 0}) => SpaceAlbum(
  id: id,
  name: name ?? 'Album $id',
  showInTimeline: showInTimeline,
  assetCount: assetCount,
);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  testWidgets('editor role (canEdit:true) — SpaceAlbumKebab is present and has menu button', (tester) async {
    await tester.pumpWidget(
      _wrapSliver(
        SpaceAlbumAppBar(
          canEdit: true,
          album: _album(id: 'a1', name: 'Hawaii'),
        ),
      ),
    );
    await tester.pump();

    expect(find.byType(SpaceAlbumKebab), findsOneWidget);
    // canEdit:true → SpaceAlbumKebab renders a PopupMenuButton (not SizedBox.shrink)
    // Use byWidgetPredicate since the type param is private (_KebabAction).
    expect(
      find.byWidgetPredicate((w) => w is PopupMenuButton),
      findsOneWidget,
    );
  });

  testWidgets('viewer role (canEdit:false) — SpaceAlbumKebab renders SizedBox.shrink', (tester) async {
    await tester.pumpWidget(
      _wrapSliver(
        SpaceAlbumAppBar(
          canEdit: false,
          album: _album(id: 'a1', name: 'Hawaii'),
        ),
      ),
    );
    await tester.pump();

    expect(find.byType(SpaceAlbumKebab), findsOneWidget);
    // canEdit:false → the kebab renders SizedBox.shrink, so no PopupMenuButton
    expect(
      find.byWidgetPredicate((w) => w is PopupMenuButton),
      findsNothing,
    );
  });

  testWidgets('subtitle "{count} photos · in {space}" renders when album and spaceName are provided', (tester) async {
    await tester.pumpWidget(
      _wrapSliver(
        SpaceAlbumAppBar(
          canEdit: false,
          album: _album(id: 'a2', name: 'Summer', assetCount: 7),
          spaceName: 'Trip 2024',
        ),
      ),
    );
    await tester.pump();

    expect(find.text('7 photos · in Trip 2024'), findsOneWidget);
  });

  testWidgets('subtitle is absent when spaceName is null (metadata not yet loaded)', (tester) async {
    await tester.pumpWidget(
      _wrapSliver(
        SpaceAlbumAppBar(
          canEdit: false,
          album: _album(id: 'a3', name: 'Summer', assetCount: 7),
          // spaceName omitted / null
        ),
      ),
    );
    await tester.pump();

    // No subtitle should be rendered before the space name is loaded.
    expect(find.textContaining('photos · in'), findsNothing);
  });
}
