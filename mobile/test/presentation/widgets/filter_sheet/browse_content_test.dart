import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/browse_content.widget.dart';
import 'package:immich_mobile/providers/photos_filter/filter_sheet.provider.dart';

import '../../../widget_tester_extensions.dart';

void main() {
  group('BrowseContent', () {
    testWidgets('"More filters" button sets snap to deep', (tester) async {
      final controller = ScrollController();
      addTearDown(controller.dispose);
      // Tall viewport so the bottom "More filters" button renders inside the
      // ListView's build window.
      await tester.binding.setSurfaceSize(const Size(400, 1600));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      await tester.pumpConsumerWidget(
        BrowseContent(scrollController: controller),
        overrides: [photosFilterSheetProvider.overrideWith((ref) => FilterSheetSnap.browse)],
      );
      final container = ProviderScope.containerOf(tester.element(find.byType(BrowseContent)));
      container.read(photosFilterSheetProvider.notifier).state = FilterSheetSnap.browse;
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('browse-see-all')));
      await tester.pumpAndSettle();

      expect(container.read(photosFilterSheetProvider), FilterSheetSnap.deep);
    });
  });
}
