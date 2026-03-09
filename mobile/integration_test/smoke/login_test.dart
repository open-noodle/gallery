import 'package:flutter_test/flutter_test.dart';
import 'package:patrol/patrol.dart';

import '../common/patrol_config.dart';
import '../common/test_app.dart';
import '../fixtures/seed_data.dart';
import '../pages/login_page.dart';
import '../pages/timeline_page.dart';

void main() {
  final seeder = TestDataSeeder();

  patrolSetUp(() async {
    await seeder.seed();
  });

  patrolTest(
    'Login with valid credentials loads the timeline',
    config: patrolConfig,
    ($) async {
      await pumpImmichApp($);

      final loginPage = LoginPage($);
      final timelinePage = TimelinePage($);

      await loginPage.loginWithTestCredentials();
      await timelinePage.waitForLoaded();
      expect(timelinePage.isVisible, isTrue);
    },
  );

  patrolTest(
    'Login with wrong password shows error',
    config: patrolConfig,
    ($) async {
      await pumpImmichApp($);

      final loginPage = LoginPage($);

      await loginPage.waitForScreen();
      await loginPage.acknowledgeNewServerVersionIfPresent();
      await loginPage.enterCredentials(
        server: testServerUrl,
        email: testEmail,
        password: 'wrong-password',
      );
      await loginPage.tapLogin();
      await loginPage.waitForScreen();
    },
  );
}
