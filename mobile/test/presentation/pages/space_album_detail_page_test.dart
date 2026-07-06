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
      slivers: [
        sliverWidget,
        const SliverToBoxAdapter(child: SizedBox(height: 800)),
      ],
    ),
  ),
);

SpaceAlbum _album({required String id, String? name, bool showInTimeline = true, int assetCount = 0}) =>
    SpaceAlbum(id: id, name: name ?? 'Album $id', showInTimeline: showInTimeline, assetCount: assetCount);

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
    expect(find.byWidgetPredicate((w) => w is PopupMenuButton), findsOneWidget);
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
    expect(find.byWidgetPredicate((w) => w is PopupMenuButton), findsNothing);
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

  // ---------------------------------------------------------------------------
  // Slice 14 — toggle disabled when album stream is unresolved
  // ---------------------------------------------------------------------------

  testWidgets('toggle menu item is DISABLED when album is null (stream unresolved)', (tester) async {
    bool toggled = false;
    await tester.pumpWidget(
      _wrapSliver(
        SpaceAlbumAppBar(
          canEdit: true,
          album: null, // stream not yet resolved
          onToggleTimeline: () => toggled = true,
        ),
      ),
    );
    await tester.pump();

    // Open the popup menu
    await tester.tap(find.byWidgetPredicate((w) => w is PopupMenuButton));
    await tester.pumpAndSettle();

    // The toggle item must exist and be disabled
    final toggleItem = tester.widget<PopupMenuItem<dynamic>>(find.byKey(const Key('space-album-kebab-toggle')));
    expect(toggleItem.enabled, isFalse, reason: 'toggle item should be disabled when album is null');

    // Tapping a disabled item must NOT fire the callback
    await tester.tap(find.byKey(const Key('space-album-kebab-toggle')));
    await tester.pumpAndSettle();
    expect(toggled, isFalse, reason: 'onToggleTimeline must not be called when item is disabled');
  });

  testWidgets('toggle menu item is ENABLED when album is non-null and invokes callback', (tester) async {
    bool toggled = false;
    await tester.pumpWidget(
      _wrapSliver(
        SpaceAlbumAppBar(
          canEdit: true,
          album: _album(id: 'a4', name: 'Loaded Album'),
          onToggleTimeline: () => toggled = true,
        ),
      ),
    );
    await tester.pump();

    // Open the popup menu
    await tester.tap(find.byWidgetPredicate((w) => w is PopupMenuButton));
    await tester.pumpAndSettle();

    // The toggle item must exist and be enabled
    final toggleItem = tester.widget<PopupMenuItem<dynamic>>(find.byKey(const Key('space-album-kebab-toggle')));
    expect(toggleItem.enabled, isTrue, reason: 'toggle item should be enabled when album is non-null');

    // Tapping an enabled item MUST fire the callback
    await tester.tap(find.byKey(const Key('space-album-kebab-toggle')));
    await tester.pumpAndSettle();
    expect(toggled, isTrue, reason: 'onToggleTimeline must be called when item is enabled and tapped');
  });
}
