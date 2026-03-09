import 'package:patrol/patrol.dart';

import '../common/patrol_config.dart';
import '../common/test_app.dart';
import '../fixtures/seed_data.dart';
import '../pages/login_page.dart';
import '../pages/shared_space_page.dart';
import '../pages/timeline_page.dart';

void main() {
  final seeder = TestDataSeeder();

  patrolSetUp(() async {
    await seeder.seed();
  });

  patrolTest(
    'Create shared space and toggle timeline visibility',
    config: patrolConfig,
    ($) async {
      await pumpImmichApp($);

      final loginPage = LoginPage($);
      final timelinePage = TimelinePage($);
      final spacePage = SharedSpacePage($);

      await loginPage.loginWithTestCredentials();
      await timelinePage.waitForLoaded();
      await timelinePage.goToLibrary();
      await spacePage.openFromLibrary();
      await spacePage.createSpace('Test Space');
      await spacePage.openSpace('Test Space');
      await spacePage.toggleShowInTimeline();
    },
  );
}
