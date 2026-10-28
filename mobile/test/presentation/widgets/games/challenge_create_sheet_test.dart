import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/presentation/widgets/games/challenge_create_sheet.widget.dart';
import 'package:openapi/api.dart';

import '../../../widget_tester_extensions.dart';

void main() {
  // ChallengeCreateSheet.show pushes a modal route via Navigator, so the test needs a stable
  // BuildContext under a real Navigator (the MaterialApp pumpConsumerWidget wraps in) rather than a
  // bare widget under test. The Builder below captures that context once and keeps it mounted for
  // the whole test, so `.show()` can be called directly instead of through a tap that opens it.
  Future<({int roundCount, GameChallengeType type})?> showAndInteract(
    WidgetTester tester,
    Future<void> Function() interact,
  ) async {
    late BuildContext context;
    await tester.pumpConsumerWidget(
      Builder(
        builder: (ctx) {
          context = ctx;
          return const SizedBox();
        },
      ),
    );

    final future = ChallengeCreateSheet.show(context);
    await tester.pumpAndSettle();

    await interact();
    await tester.pumpAndSettle();

    return future;
  }

  testWidgets('the default submit returns 5 rounds, mixed', (tester) async {
    final result = await showAndInteract(tester, () async {
      await tester.tap(find.byKey(const Key('create-submit')));
    });

    expect(result, (roundCount: 5, type: GameChallengeType.mixed));
  });

  testWidgets('selecting 10 rounds and Places, then submitting, returns (10, location)', (tester) async {
    final result = await showAndInteract(tester, () async {
      await tester.tap(find.byKey(const Key('create-round-count-10')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('create-type-location')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('create-submit')));
    });

    expect(result, (roundCount: 10, type: GameChallengeType.location));
  });

  testWidgets('dismissing without submitting returns null', (tester) async {
    final result = await showAndInteract(tester, () async {
      // Tap the modal barrier, well above the bottom sheet's own bounds, to dismiss it.
      await tester.tapAt(const Offset(10, 10));
    });

    expect(result, isNull);
  });
}
