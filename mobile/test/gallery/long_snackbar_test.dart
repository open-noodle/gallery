import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/gallery/utils/long_snackbar.dart';
import 'package:immich_ui/immich_ui.dart';

void main() {
  const message =
      'This photo is in the album "A rather long album name from the summer trip", which is linked to this space. '
      'Remove it from the album instead.';

  Future<void> pumpHost(WidgetTester tester) async {
    // The test font draws every glyph as a full square, about twice a phone font's width: 800 logical pixels here
    // hold roughly the line a 360-dp phone does.
    tester.view.physicalSize = const Size(800, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      MaterialApp(
        scaffoldMessengerKey: scaffoldMessengerKey,
        theme: ThemeData(extensions: [ImmichColors.harmonized(const ColorScheme.light())]),
        home: const Scaffold(body: SizedBox.shrink()),
      ),
    );
  }

  testWidgets('the shared error snackbar cuts the explanation at two lines', (tester) async {
    await pumpHost(tester);

    snackbar.error(message);
    await tester.pumpAndSettle();

    expect(tester.renderObject<RenderParagraph>(find.text(message)).didExceedMaxLines, isTrue);
  });

  testWidgets('shows the whole explanation on a narrow phone, where the shared snackbar stops at two lines', (
    tester,
  ) async {
    await pumpHost(tester);

    showLongErrorSnackbar(message);
    await tester.pumpAndSettle();

    final text = tester.widget<Text>(find.text(message));
    expect(text.maxLines, greaterThanOrEqualTo(5));
    final paragraph = tester.renderObject<RenderParagraph>(find.text(message));
    expect(paragraph.didExceedMaxLines, isFalse);
  });

  testWidgets('replaces the snackbar on screen and goes away after its duration', (tester) async {
    await pumpHost(tester);

    snackbar.success('Removed 1 asset');
    await tester.pump();
    showLongErrorSnackbar(message, duration: const Duration(seconds: 2));
    await tester.pumpAndSettle();
    expect(find.text('Removed 1 asset'), findsNothing);
    expect(find.text(message), findsOneWidget);

    await tester.pump(const Duration(seconds: 3));
    await tester.pumpAndSettle();
    expect(find.text(message), findsNothing);
  });
}
