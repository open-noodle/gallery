import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/gallery/location_disclosure.dart';

void main() {
  Future<Future<bool>> open(WidgetTester tester) async {
    late Future<bool> result;
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => TextButton(
            onPressed: () => result = confirmLocationDisclosure(
              context,
              (context) => Center(
                child: TextButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('ok')),
              ),
            ),
            child: const Text('open'),
          ),
        ),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    return result;
  }

  testWidgets('agreeing to the disclosure returns true', (tester) async {
    final result = await open(tester);
    await tester.tap(find.text('ok'));
    await tester.pumpAndSettle();
    expect(await result, isTrue);
  });

  testWidgets('dismissing the disclosure counts as no', (tester) async {
    final result = await open(tester);
    await tester.tapAt(const Offset(5, 5));
    await tester.pumpAndSettle();
    expect(await result, isFalse);
  });
}
