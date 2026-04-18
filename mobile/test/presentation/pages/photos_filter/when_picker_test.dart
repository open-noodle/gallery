import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/presentation/pages/photos_filter/when_picker.page.dart';
import '../../../widget_tester_extensions.dart';

void main() {
  group('WhenPickerPage', () {
    testWidgets('renders AppBar with back icon, title key, and Done button', (tester) async {
      await tester.pumpConsumerWidget(const WhenPickerPage());
      expect(find.byIcon(Icons.arrow_back_rounded), findsOneWidget);
      expect(find.text('filter_sheet_picker_when_title'), findsOneWidget);
      expect(find.byKey(const Key('when-picker-done')), findsOneWidget);
    });

    testWidgets('Done button meets 48pt tap target', (tester) async {
      await tester.pumpConsumerWidget(const WhenPickerPage());
      expectTapTargetMin(tester, find.byKey(const Key('when-picker-done')));
    });

    testWidgets('Done button pops the navigator stack', (tester) async {
      await tester.pumpConsumerWidget(
        Builder(
          builder: (context) => Scaffold(
            body: Center(
              child: TextButton(
                key: const Key('open-when-picker'),
                onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const WhenPickerPage())),
                child: const Text('open'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.byKey(const Key('open-when-picker')));
      await tester.pumpAndSettle();
      expect(find.byType(WhenPickerPage), findsOneWidget);

      await tester.tap(find.byKey(const Key('when-picker-done')));
      await tester.pumpAndSettle();
      expect(find.byType(WhenPickerPage), findsNothing);
    });

    testWidgets('renders correctly in dark theme', (tester) async {
      await tester.pumpConsumerWidgetDark(const WhenPickerPage());
      expect(find.byType(WhenPickerPage), findsOneWidget);
    });
  });
}
