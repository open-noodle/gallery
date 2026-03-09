import 'package:flutter/material.dart';
import 'package:patrol/patrol.dart';

/// Page object for the search screen.
class SearchPage {
  final PatrolIntegrationTester $;

  const SearchPage(this.$);

  /// Enter a search query.
  Future<void> search(String query) async {
    await $(TextField).first.tap();
    await $(TextField).first.enterText(query);
    await $.tester.testTextInput.receiveAction(TextInputAction.search);
    await $.pump(const Duration(seconds: 3));
  }

  /// Check if results contain items.
  bool get hasResults => $(Image).exists;
}
