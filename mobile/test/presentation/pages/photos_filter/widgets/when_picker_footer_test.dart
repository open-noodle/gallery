import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/pages/photos_filter/widgets/when_picker_footer.widget.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';

import '../../../../widget_tester_extensions.dart';

void main() {
  group('WhenPickerFooter', () {
    testWidgets('renders Done button + label', (tester) async {
      await tester.pumpConsumerWidget(const WhenPickerFooter());
      expect(find.byKey(const Key('when-picker-footer-done')), findsOneWidget);
      expect(find.byKey(const Key('when-picker-footer-label')), findsOneWidget);
    });

    testWidgets('label shows all-time key when no selection', (tester) async {
      await tester.pumpConsumerWidget(const WhenPickerFooter());
      final labelWidget = tester.widget<Text>(find.byKey(const Key('when-picker-footer-label')));
      expect(labelWidget.data, 'filter_sheet_picker_all_time');
    });

    testWidgets('label shows "MONTH YEAR" for single-month selection', (tester) async {
      await tester.pumpConsumerWidget(const WhenPickerFooter());
      final container = ProviderScope.containerOf(tester.element(find.byType(WhenPickerFooter)));
      container
          .read(photosFilterProvider.notifier)
          .setDateRange(start: DateTime(2024, 11, 1), end: DateTime(2024, 11, 30, 23, 59, 59));
      await tester.pumpAndSettle();
      final labelWidget = tester.widget<Text>(find.byKey(const Key('when-picker-footer-label')));
      expect(labelWidget.data, contains('filter_sheet_deep_when_month_nov'));
      expect(labelWidget.data, contains('2024'));
    });

    testWidgets('label shows "M1 – M2 YEAR" for same-year multi-month range', (tester) async {
      await tester.pumpConsumerWidget(const WhenPickerFooter());
      final container = ProviderScope.containerOf(tester.element(find.byType(WhenPickerFooter)));
      container
          .read(photosFilterProvider.notifier)
          .setDateRange(start: DateTime(2024, 1, 1), end: DateTime(2024, 3, 31));
      await tester.pumpAndSettle();
      final labelWidget = tester.widget<Text>(find.byKey(const Key('when-picker-footer-label')));
      expect(labelWidget.data, contains('filter_sheet_deep_when_month_jan'));
      expect(labelWidget.data, contains('filter_sheet_deep_when_month_mar'));
      expect(labelWidget.data, contains('2024'));
      expect(labelWidget.data, contains('–'));
    });

    testWidgets('label shows "M1 Y1 – M2 Y2" for cross-year range', (tester) async {
      await tester.pumpConsumerWidget(const WhenPickerFooter());
      final container = ProviderScope.containerOf(tester.element(find.byType(WhenPickerFooter)));
      container
          .read(photosFilterProvider.notifier)
          .setDateRange(start: DateTime(2023, 3, 1), end: DateTime(2024, 5, 31));
      await tester.pumpAndSettle();
      final labelWidget = tester.widget<Text>(find.byKey(const Key('when-picker-footer-label')));
      expect(labelWidget.data, contains('2023'));
      expect(labelWidget.data, contains('2024'));
    });

    testWidgets('Done button pops the navigator stack', (tester) async {
      await tester.pumpConsumerWidget(
        Builder(
          builder: (context) => Scaffold(
            body: Center(
              child: TextButton(
                key: const Key('open-test'),
                onPressed: () => Navigator.of(
                  context,
                ).push(MaterialPageRoute(builder: (_) => const Scaffold(body: WhenPickerFooter()))),
                child: const Text('open'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.byKey(const Key('open-test')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('when-picker-footer-done')), findsOneWidget);

      await tester.tap(find.byKey(const Key('when-picker-footer-done')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('when-picker-footer-done')), findsNothing);
    });

    testWidgets('renders correctly in dark theme', (tester) async {
      await tester.pumpConsumerWidgetDark(const WhenPickerFooter());
      expect(find.byKey(const Key('when-picker-footer-done')), findsOneWidget);
    });
  });
}
