import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/deep_header.widget.dart';
import 'package:immich_mobile/providers/photos_filter/filter_sheet.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';

import '../../../../widget_tester_extensions.dart';

void main() {
  group('DeepHeader', () {
    testWidgets('renders Close icon, title, and Reset button when filter non-empty', (tester) async {
      await tester.pumpConsumerWidget(const Material(child: DeepHeader()));
      final container = ProviderScope.containerOf(tester.element(find.byType(DeepHeader)));
      container.read(photosFilterProvider.notifier).setText('paris');
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('deep-header-close')), findsOneWidget);
      expect(find.text('filter_sheet_title'), findsOneWidget);
      expect(find.byKey(const Key('deep-header-reset')), findsOneWidget);
    });

    testWidgets('Reset button is hidden when filter is empty', (tester) async {
      await tester.pumpConsumerWidget(const Material(child: DeepHeader()));
      expect(find.byKey(const Key('deep-header-reset')), findsNothing);
    });

    testWidgets('Close button sets sheet snap to browse', (tester) async {
      await tester.pumpConsumerWidget(const Material(child: DeepHeader()));
      final container = ProviderScope.containerOf(tester.element(find.byType(DeepHeader)));
      container.read(photosFilterSheetProvider.notifier).state = FilterSheetSnap.deep;
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('deep-header-close')));
      await tester.pumpAndSettle();

      expect(container.read(photosFilterSheetProvider), FilterSheetSnap.browse);
    });

    testWidgets('Reset calls reset() on notifier and filter becomes empty', (tester) async {
      await tester.pumpConsumerWidget(const Material(child: DeepHeader()));
      final container = ProviderScope.containerOf(tester.element(find.byType(DeepHeader)));
      container.read(photosFilterProvider.notifier).setText('paris');
      container.read(photosFilterProvider.notifier).setRating(4);
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('deep-header-reset')));
      await tester.pumpAndSettle();

      expect(container.read(photosFilterProvider).isEmpty, isTrue);
    });

    testWidgets('Reset does not dismiss the sheet', (tester) async {
      await tester.pumpConsumerWidget(const Material(child: DeepHeader()));
      final container = ProviderScope.containerOf(tester.element(find.byType(DeepHeader)));
      container.read(photosFilterSheetProvider.notifier).state = FilterSheetSnap.deep;
      container.read(photosFilterProvider.notifier).setText('paris');
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('deep-header-reset')));
      await tester.pumpAndSettle();

      expect(container.read(photosFilterSheetProvider), FilterSheetSnap.deep);
    });

    testWidgets('close + reset buttons meet kMinInteractiveDimension tap targets (a11y)', (tester) async {
      await tester.pumpConsumerWidget(const Material(child: DeepHeader()));
      final container = ProviderScope.containerOf(tester.element(find.byType(DeepHeader)));
      container.read(photosFilterProvider.notifier).setText('paris');
      await tester.pumpAndSettle();
      expectTapTargetMin(tester, find.byKey(const Key('deep-header-close')));
      expectTapTargetMin(tester, find.byKey(const Key('deep-header-reset')));
    });

    testWidgets('renders correctly in dark theme', (tester) async {
      await tester.pumpConsumerWidgetDark(const Material(child: DeepHeader()));
      expect(find.byKey(const Key('deep-header-close')), findsOneWidget);
    });
  });
}
