import 'package:flutter/material.dart';
import 'package:patrol/patrol.dart';

/// Page object for shared spaces screens.
class SharedSpacePage {
  final PatrolIntegrationTester $;

  const SharedSpacePage(this.$);

  /// Navigate to shared spaces from the library tab.
  Future<void> openFromLibrary() async {
    await $('Spaces').tap();
    await $.pump(const Duration(seconds: 1));
  }

  /// Create a new shared space via the FAB and dialog.
  Future<void> createSpace(String name) async {
    await $(FloatingActionButton).tap();
    await $(TextField).first.enterText(name);
    await $('Create').tap();
    await $.pump(const Duration(seconds: 2));
  }

  /// Open a shared space by name.
  Future<void> openSpace(String name) async {
    await $(name).tap();
    await $.pump(const Duration(seconds: 1));
  }

  /// Toggle "show in timeline" for the current space.
  Future<void> toggleShowInTimeline() async {
    await $(Icons.visibility).tap();
    await $.pump(const Duration(seconds: 1));
  }
}
