import 'package:patrol/patrol.dart';

import '../common/patrol_config.dart';
import '../common/test_app.dart';
import '../fixtures/seed_data.dart';
import '../pages/asset_viewer_page.dart';
import '../pages/login_page.dart';
import '../pages/timeline_page.dart';

void main() {
  final seeder = TestDataSeeder();

  patrolSetUp(() async {
    await seeder.seed();
  });

  patrolTest(
    'Browse timeline and open asset viewer',
    config: patrolConfig,
    ($) async {
      await pumpImmichApp($);

      final loginPage = LoginPage($);
      final timelinePage = TimelinePage($);
      final viewerPage = AssetViewerPage($);

      await loginPage.loginWithTestCredentials();
      await timelinePage.waitForLoaded();

      await timelinePage.scrollDown();
      await timelinePage.tapFirstAsset();
      await viewerPage.waitForVisible();
      await viewerPage.swipeToNext();
      await viewerPage.goBack();
      await timelinePage.waitForLoaded();
    },
  );
}
