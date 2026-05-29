import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/widgets/search/search_filter/display_option_picker.dart';

void main() {
  group('DisplayOptionPicker', () {
    testWidgets('renders and selects untagged display option', (tester) async {
      Map<DisplayOption, bool>? selectedOptions;

      await tester.pumpWidget(
        MaterialApp(
          home: Material(
            child: DisplayOptionPicker(
              onSelect: (options) {
                selectedOptions = options;
              },
            ),
          ),
        ),
      );

      expect(find.text('untagged'), findsOneWidget);

      await tester.tap(find.text('untagged'));
      await tester.pump();

      expect(selectedOptions?[DisplayOption.untagged], isTrue);
    });
  });
}
