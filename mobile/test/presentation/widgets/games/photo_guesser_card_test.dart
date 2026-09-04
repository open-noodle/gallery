import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/presentation/widgets/games/photo_guesser_card.widget.dart';

import '../../../test_utils.dart';
import '../../../widget_tester_extensions.dart';

void main() {
  setUpAll(() {
    TestWidgetsFlutterBinding.ensureInitialized();
    TestUtils.init();
  });

  /// Inside a [Wrap], as the Library page mounts it. Pumped bare it is handed the whole 800x600
  /// viewport as its constraints, so its gesture box covers the screen while the artwork sits in
  /// one corner — and a tap at the centre lands on nothing.
  Future<void> pump(WidgetTester tester, {required VoidCallback onTap}) =>
      tester.pumpConsumerWidget(Wrap(children: [PhotoGuesserCard(onTap: onTap)]));

  testWidgets('carries the product name rather than a generic label', (tester) async {
    await pump(tester, onTap: () {});

    // Proves the 'photoguesser' key resolved rather than `.t()` falling back to the raw key.
    expect(find.text('PhotoGuesser'), findsOneWidget);
  });

  testWidgets('a tap on the artwork opens the game, not just a tap on the label', (tester) async {
    var taps = 0;
    await pump(tester, onTap: () => taps++);

    // The centre of the card is artwork, not text: the sibling collection cards are tappable
    // across their whole face and this one has to match, or it reads as decoration.
    await tester.tap(find.byKey(const Key('library-photoguesser-card')));
    await tester.pump();

    expect(taps, 1);
  });

  // NOT covered here: the route the Library page pushes on that tap. `context.pushRoute` needs an
  // auto_route Router, which no widget test has, so the one line wiring this card to
  // PhotoGuesserRoute (drift_library.page.dart's `_CollectionCards`) is verified by inspection.
}
