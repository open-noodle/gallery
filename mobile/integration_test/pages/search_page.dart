import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:patrol/patrol.dart';

/// Page object for the search screen.
class SearchPage {
  final PatrolIntegrationTester $;

  const SearchPage(this.$);

  /// Enter a search query using ensureVisible + tester methods.
  Future<void> search(String query) async {
    final textField = find.byType(TextField).first;
    await $.tester.ensureVisible(textField);
    await $.pump();
    await $.tester.tap(textField);
    await $.pump(const Duration(milliseconds: 500));
    await $.tester.enterText(textField, query);
    await $.pump();
    await $.tester.testTextInput.receiveAction(TextInputAction.search);
    await $.pump(const Duration(seconds: 3));
  }

  /// Check if results contain items.
  bool get hasResults => $(Image).exists;
}
