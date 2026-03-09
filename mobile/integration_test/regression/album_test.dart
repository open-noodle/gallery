import 'package:patrol/patrol.dart';

import '../common/patrol_config.dart';
import '../common/test_app.dart';
import '../fixtures/seed_data.dart';
import '../pages/album_page.dart';
import '../pages/login_page.dart';
import '../pages/timeline_page.dart';

void main() {
  final seeder = TestDataSeeder();

  patrolSetUp(() async {
    await seeder.seed();
  });

  patrolTest(
    'Create, open, and delete an album',
    config: patrolConfig,
    ($) async {
      await pumpImmichApp($);

      final loginPage = LoginPage($);
      final timelinePage = TimelinePage($);
      final albumPage = AlbumPage($);

      await loginPage.loginWithTestCredentials();
      await timelinePage.waitForLoaded();
      await timelinePage.goToLibrary();
      await albumPage.createAlbum('Test Album');
      await albumPage.openAlbum('Test Album');
      await albumPage.deleteCurrentAlbum();
    },
  );
}
