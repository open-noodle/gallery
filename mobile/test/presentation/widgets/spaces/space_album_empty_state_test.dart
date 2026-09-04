import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/presentation/widgets/common/polaroid_hero.widget.dart';
import 'package:immich_mobile/presentation/widgets/spaces/space_album_empty_state.widget.dart';

import '../../../unit/presentation/presentation_context.dart';
import '../../../widget_tester_extensions.dart';

void main() {
  setUpAll(() async {
    await PresentationContext.create();
  });

  Future<void> pumpState(WidgetTester tester, {VoidCallback? onAddPhotos}) =>
      tester.pumpConsumerWidget(SpaceAlbumEmptyState(onAddPhotos: onAddPhotos));

  testWidgets('an editor sees the illustration and an Add photos call to action', (tester) async {
    await pumpState(tester, onAddPhotos: () {});
    await tester.pumpAndSettle();

    expect(find.byType(PolaroidHero), findsOneWidget);
    expect(find.text('No photos yet'), findsOneWidget);
    expect(find.text('Add photos to this album so everyone in the space can see them.'), findsOneWidget);
    expect(find.byKey(const Key('space-album-empty-add-photos')), findsOneWidget);
  });

  testWidgets('tapping Add photos invokes the callback', (tester) async {
    var taps = 0;
    await pumpState(tester, onAddPhotos: () => taps++);
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('space-album-empty-add-photos')));
    await tester.pump();

    expect(taps, 1);
  });

  // A viewer cannot add photos to a space album, so offering the button would be a dead end.
  // The `findsNothing` below is meaningful precisely because the editor test above finds that
  // exact key — the finder is proven to match when the button is present.
  testWidgets('a viewer gets the illustration but no Add photos button', (tester) async {
    await pumpState(tester);
    await tester.pumpAndSettle();

    expect(find.byType(PolaroidHero), findsOneWidget);
    expect(find.text('No photos yet'), findsOneWidget);
    expect(find.byKey(const Key('space-album-empty-add-photos')), findsNothing);
    // ...and the copy does not invite an action they cannot take.
    expect(find.text('Photos added to this album will show up here.'), findsOneWidget);
    expect(find.text('Add photos to this album so everyone in the space can see them.'), findsNothing);
  });
}
