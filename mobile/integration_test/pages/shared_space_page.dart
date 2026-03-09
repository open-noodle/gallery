import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:patrol/patrol.dart';

/// Page object for shared spaces screens.
class SharedSpacePage {
  final PatrolIntegrationTester $;

  const SharedSpacePage(this.$);

  /// Navigate to shared spaces from the library tab.
  Future<void> openFromLibrary() async {
    // "Spaces" is in a QuickAccessButtonList at the bottom of the Library page's
    // CustomScrollView — it's often below the fold, so we must scroll to it.
    final spacesText = find.text('Spaces');
    for (var i = 0; i < 10; i++) {
      await $.pump(const Duration(milliseconds: 500));
      if ($.tester.any(spacesText)) break;
    }
    await $.tester.ensureVisible(spacesText);
    await $.pump();
    await $.tester.tap(spacesText);
    await $.pump(const Duration(seconds: 2));
  }

  /// Create a new shared space via the FAB and dialog.
  Future<void> createSpace(String name) async {
    await $(FloatingActionButton).waitUntilVisible(
      timeout: const Duration(seconds: 10),
    );
    await $(FloatingActionButton).tap();
    await $.pump(const Duration(seconds: 1));

    // Enter space name in the dialog TextField using ensureVisible
    final textField = find.byType(TextField).first;
    await $.tester.ensureVisible(textField);
    await $.pump();
    await $.tester.enterText(textField, name);
    await $.pump(const Duration(milliseconds: 500));

    // Tap Create button in the dialog
    await $.tester.ensureVisible(find.text('Create'));
    await $.pump();
    await $.tester.tap(find.text('Create'));
    await $.pump(const Duration(seconds: 2));
  }

  /// Open a shared space by name.
  Future<void> openSpace(String name) async {
    await $(name).waitUntilVisible(
      timeout: const Duration(seconds: 10),
    );
    await $(name).tap();
    await $.pump(const Duration(seconds: 2));
  }

  /// Toggle "show in timeline" for the current space.
  Future<void> toggleShowInTimeline() async {
    // New spaces default to showInTimeline=true, so icon is Icons.visibility
    await $(Icons.visibility).waitUntilVisible(
      timeout: const Duration(seconds: 10),
    );
    await $(Icons.visibility).tap();
    await $.pump(const Duration(seconds: 1));
  }
}
