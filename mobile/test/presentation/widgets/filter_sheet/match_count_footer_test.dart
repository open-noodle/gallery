import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/match_count_footer.widget.dart';

import '../../../widget_tester_extensions.dart';

void main() {
  group('MatchCountFooter', () {
    testWidgets('keeps the Done button clear of the system bottom inset', (tester) async {
      const dpr = 3.0;
      const bottomInset = 48.0; // logical px — simulates the Android 3-button nav bar
      tester.view.physicalSize = const Size(1080, 2400);
      tester.view.devicePixelRatio = dpr;
      tester.view.padding = const FakeViewPadding(bottom: bottomInset * dpr);
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(tester.view.resetPadding);

      await tester.pumpConsumerWidget(const Align(alignment: Alignment.bottomCenter, child: MatchCountFooter()));

      final screenHeight = tester.view.physicalSize.height / tester.view.devicePixelRatio;
      final buttonBottom = tester.getBottomLeft(find.byKey(const Key('match-count-footer-done'))).dy;

      // The system nav bar occupies [screenHeight - bottomInset, screenHeight]. The
      // Done button must not extend into that zone, or it becomes unreachable.
      expect(buttonBottom, lessThanOrEqualTo(screenHeight - bottomInset));
    });
  });
}
