import 'package:flutter/material.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep_content.widget.dart';
import 'package:immich_mobile/providers/photos_filter/filter_sheet.provider.dart';

import '../../../widget_tester_extensions.dart';

void main() {
  group('DeepContent', () {
    testWidgets('sections render in the §5.2 order', (tester) async {
      final controller = ScrollController();
      addTearDown(controller.dispose);

      await tester.pumpConsumerWidget(
        DeepContent(scrollController: controller),
        overrides: [photosFilterSheetProvider.overrideWith((ref) => FilterSheetSnap.deep)],
      );
      await tester.pumpAndSettle();

      final orderedKeys = [
        const Key('deep-header'),
        const Key('deep-search'),
        const Key('deep-section-people'),
        const Key('deep-section-places'),
        const Key('deep-section-tags'),
        const Key('deep-section-when'),
        const Key('deep-section-rating'),
        const Key('deep-section-media'),
        const Key('deep-section-toggles'),
        const Key('deep-done-bar'),
      ];

      // Positions must be strictly increasing in global Y.
      double prev = double.negativeInfinity;
      for (final key in orderedKeys) {
        expect(find.byKey(key), findsOneWidget, reason: '$key missing');
        final box = tester.getTopLeft(find.byKey(key));
        expect(box.dy, greaterThan(prev), reason: '$key not below previous');
        prev = box.dy;
      }
    });

    testWidgets('PageStorageKey is set on the scroll body (§6.5 retention)', (tester) async {
      final controller = ScrollController();
      addTearDown(controller.dispose);

      await tester.pumpConsumerWidget(DeepContent(scrollController: controller));
      await tester.pumpAndSettle();

      final storage = find.byKey(const PageStorageKey('filter-sheet-deep-scroll'));
      expect(storage, findsOneWidget);
    });
  });
}
