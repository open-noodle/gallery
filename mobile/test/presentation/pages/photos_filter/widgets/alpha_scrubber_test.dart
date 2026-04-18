import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/presentation/pages/photos_filter/widgets/alpha_scrubber.widget.dart';
import '../../../../widget_tester_extensions.dart';

void main() {
  group('AlphaScrubber', () {
    testWidgets('renders A-Z + #, 27 letters total', (tester) async {
      await tester.pumpConsumerWidget(
        SizedBox(
          width: 24,
          height: 540,
          child: AlphaScrubber(letterToIndex: const {'A': 0, 'B': 3, '#': 10}, onLetter: (_) {}),
        ),
      );
      for (final l in AlphaScrubber.letters) {
        expect(find.byKey(Key('alpha-scrubber-$l')), findsOneWidget);
      }
      expect(AlphaScrubber.letters, hasLength(27));
    });

    testWidgets('tapping a populated letter fires onLetter callback', (tester) async {
      String? tapped;
      await tester.pumpConsumerWidget(
        SizedBox(
          width: 24,
          height: 540,
          child: AlphaScrubber(letterToIndex: const {'A': 0, 'B': 3, 'C': 5}, onLetter: (l) => tapped = l),
        ),
      );
      await tester.tapAt(tester.getCenter(find.byKey(const Key('alpha-scrubber-B'))));
      await tester.pumpAndSettle();
      expect(tapped, 'B');
    });

    testWidgets('tapping an empty-bucket letter does NOT fire onLetter', (tester) async {
      String? tapped;
      await tester.pumpConsumerWidget(
        SizedBox(
          width: 24,
          height: 540,
          child: AlphaScrubber(letterToIndex: const {'A': 0}, onLetter: (l) => tapped = l),
        ),
      );
      await tester.tapAt(tester.getCenter(find.byKey(const Key('alpha-scrubber-Z'))));
      await tester.pumpAndSettle();
      expect(tapped, isNull);
    });

    testWidgets('drag surfaces the preview bubble, releases on end', (tester) async {
      await tester.pumpConsumerWidget(
        SizedBox(
          width: 24,
          height: 540,
          child: AlphaScrubber(letterToIndex: const {'A': 0, 'B': 3}, onLetter: (_) {}),
        ),
      );
      final gesture = await tester.startGesture(tester.getCenter(find.byKey(const Key('alpha-scrubber-A'))));
      await tester.pump();
      await gesture.moveTo(tester.getCenter(find.byKey(const Key('alpha-scrubber-B'))));
      await tester.pump();
      expect(find.byKey(const Key('alpha-scrubber-preview')), findsOneWidget);

      await gesture.up();
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('alpha-scrubber-preview')), findsNothing);
    });

    testWidgets('renders correctly in dark theme', (tester) async {
      await tester.pumpConsumerWidgetDark(
        SizedBox(
          width: 24,
          height: 540,
          child: AlphaScrubber(letterToIndex: const {'A': 0}, onLetter: (_) {}),
        ),
      );
      expect(find.byKey(const Key('alpha-scrubber-A')), findsOneWidget);
    });
  });
}
