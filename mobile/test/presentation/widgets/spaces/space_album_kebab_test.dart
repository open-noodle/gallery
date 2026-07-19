import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/presentation/widgets/spaces/space_album_kebab.widget.dart';

import '../../../widget_tester_extensions.dart';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

Widget _wrap(Widget widget) => Scaffold(appBar: AppBar(actions: [widget]));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  testWidgets('canEdit:true showInTimeline:true — shows 3 items with correct keys after tap', (tester) async {
    await tester.pumpConsumerWidget(
      _wrap(
        SpaceAlbumKebab(
          canEdit: true,
          showInTimeline: true,
          onAddPhotos: () {},
          onToggleTimeline: () {},
          onUnlink: () {},
        ),
      ),
    );

    // Tap the popup menu button to open the menu
    await tester.tap(find.byType(SpaceAlbumKebab));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('space-album-kebab-add')), findsOneWidget);
    expect(find.byKey(const Key('space-album-kebab-toggle')), findsOneWidget);
    expect(find.byKey(const Key('space-album-kebab-unlink')), findsOneWidget);

    // Must NOT contain forbidden menu items
    expect(find.text('Delete'), findsNothing);
    expect(find.text('Add users'), findsNothing);
    expect(find.text('Shared link'), findsNothing);
    expect(find.text('Set cover'), findsNothing);
  });

  testWidgets('canEdit:false — renders SizedBox.shrink (no popup menu button)', (tester) async {
    await tester.pumpConsumerWidget(
      _wrap(
        SpaceAlbumKebab(
          canEdit: false,
          showInTimeline: true,
          onAddPhotos: () {},
          onToggleTimeline: () {},
          onUnlink: () {},
        ),
      ),
    );

    // canEdit:false → SpaceAlbumKebab renders SizedBox.shrink, no PopupMenuButton
    expect(find.byType(PopupMenuButton<dynamic>), findsNothing);
  });

  testWidgets('canEdit:true showInTimeline:false — toggle item shows "Show in timeline"', (tester) async {
    await tester.pumpConsumerWidget(
      _wrap(
        SpaceAlbumKebab(
          canEdit: true,
          showInTimeline: false,
          onAddPhotos: () {},
          onToggleTimeline: () {},
          onUnlink: () {},
        ),
      ),
    );

    await tester.tap(find.byType(SpaceAlbumKebab));
    await tester.pumpAndSettle();

    expect(find.text('Show in timeline'), findsOneWidget);
    expect(find.text('Hide from timeline'), findsNothing);
  });
}
