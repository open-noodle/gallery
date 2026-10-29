import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/data/db/main/database.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/gallery/photos_view_menu.widget.dart';
import 'package:immich_mobile/infrastructure/repositories/settings.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/presentation/pages/dev/main_timeline.page.dart';

import '../../../test_utils.dart';
import '../../../widget_tester_extensions.dart';

void main() {
  late Drift db;

  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    TestUtils.init();
    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await SettingsRepository.ensureInitialized(db);
    await StoreService.init(storeRepository: StoreRepository(db), listenUpdates: false);
  });

  setUp(() async {
    await Store.clear();
    await SettingsRepository.instance.clear(SettingsKey.values);
  });

  tearDownAll(() async {
    await Store.clear();
    await SettingsRepository.instance.clear(SettingsKey.values);
    await db.close();
  });

  group('PhotosTimelineAppBar', () {
    test('carries only the display menu', () {
      // The search entry point lives in the bottom-nav search button, and sort lives in search
      // mode (#1030): as an app-bar action it appeared and disappeared with the search, changing
      // the width offered to the title slot and resizing the logo. What is left is permanent,
      // which is what keeps the logo one size.
      expect(PhotosTimelineAppBar.actions, hasLength(1));
      expect(PhotosTimelineAppBar.actions.first, isA<PhotosViewMenuButton>());
      expect(MainTimelinePage.timelineOverviewControlsEnabled, isTrue);
    });

    testWidgets('app bar renders the display menu button, without sort', (tester) async {
      await tester.binding.setSurfaceSize(const Size(1024, 600));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      await tester.pumpConsumerWidget(
        const CustomScrollView(slivers: [SliverAppBar(actions: PhotosTimelineAppBar.actions)]),
      );
      await tester.pumpAndSettle();

      final button = find.byKey(const Key('photos-view-menu-button'));
      expect(button, findsOneWidget);
      // Within one tap target's width, as the grouping chip it replaced.
      expect(tester.getSize(button).width, lessThanOrEqualTo(48));
      expect(find.byIcon(Icons.sort_rounded), findsNothing);
    });
  });
}
