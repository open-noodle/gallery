import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:patrol/patrol.dart';

/// Page object for the asset detail/viewer screen.
class AssetViewerPage {
  final PatrolIntegrationTester $;

  const AssetViewerPage(this.$);

  /// Wait for the viewer to be visible.
  Future<void> waitForVisible() async {
    await $.pump(const Duration(seconds: 2));
  }

  /// Swipe left to next asset.
  Future<void> swipeToNext() async {
    await $.tester.drag(
      find.byType(PageView).first,
      const Offset(-300, 0),
    );
    await $.tester.pumpAndSettle();
  }

  /// Swipe right to previous asset.
  Future<void> swipeToPrevious() async {
    await $.tester.drag(
      find.byType(PageView).first,
      const Offset(300, 0),
    );
    await $.tester.pumpAndSettle();
  }

  /// Go back to timeline.
  Future<void> goBack() async {
    await $.native.pressBack();
  }
}
