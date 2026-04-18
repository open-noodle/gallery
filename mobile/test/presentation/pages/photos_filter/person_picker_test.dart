import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/presentation/pages/photos_filter/person_picker.page.dart';

import '../../../widget_tester_extensions.dart';

void main() {
  group('PersonPickerPage', () {
    testWidgets('renders AppBar with back icon, title key, and Done button', (tester) async {
      await tester.pumpConsumerWidget(const PersonPickerPage());
      expect(find.byIcon(Icons.arrow_back_rounded), findsOneWidget);
      expect(find.text('filter_sheet_picker_people_title'), findsOneWidget);
      expect(find.byKey(const Key('person-picker-done')), findsOneWidget);
    });

    testWidgets('Done button meets 48pt tap target', (tester) async {
      await tester.pumpConsumerWidget(const PersonPickerPage());
      expectTapTargetMin(tester, find.byKey(const Key('person-picker-done')));
    });

    testWidgets('Done button pops the navigator stack', (tester) async {
      // Tiny router harness — plain MaterialApp + Navigator, independent of auto_route.
      await tester.pumpConsumerWidget(
        Builder(
          builder: (context) => Scaffold(
            body: Center(
              child: TextButton(
                key: const Key('open-person-picker'),
                onPressed: () =>
                    Navigator.of(context).push(MaterialPageRoute(builder: (_) => const PersonPickerPage())),
                child: const Text('open'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.byKey(const Key('open-person-picker')));
      await tester.pumpAndSettle();
      expect(find.byType(PersonPickerPage), findsOneWidget);

      await tester.tap(find.byKey(const Key('person-picker-done')));
      await tester.pumpAndSettle();
      expect(find.byType(PersonPickerPage), findsNothing);
    });

    testWidgets('renders correctly in dark theme', (tester) async {
      await tester.pumpConsumerWidgetDark(const PersonPickerPage());
      expect(find.byType(PersonPickerPage), findsOneWidget);
    });
  });
}
