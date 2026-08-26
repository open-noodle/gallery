import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/data/db/main/database.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/settings.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/presentation/pages/dev/main_timeline.page.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/sort_icon_button.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_grouping_selector.widget.dart';

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
    test('carries only the compact grouping selector', () {
      // The filter/search entry point lives in the bottom-nav search button, and sort moved to
      // the filter subheader (#1030) because it appeared and disappeared with the search: as an
      // app-bar action it changed the width offered to the title slot and resized the logo.
      // What is left is permanent, which is what keeps the logo one size.
      expect(PhotosTimelineAppBar.actions, hasLength(1));
      expect(PhotosTimelineAppBar.actions.first, isA<TimelineGroupingSelector>());
      expect((PhotosTimelineAppBar.actions.first as TimelineGroupingSelector).compact, isTrue);
      expect(PhotosTimelineAppBar.actions.whereType<SortIconButton>(), isEmpty);
      expect(MainTimelinePage.timelineOverviewControlsEnabled, isTrue);
    });

    testWidgets('app bar renders the compact grouping selector, without sort or a filter icon', (tester) async {
      await tester.binding.setSurfaceSize(const Size(1024, 600));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      await tester.pumpConsumerWidget(
        const CustomScrollView(slivers: [SliverAppBar(actions: PhotosTimelineAppBar.actions)]),
      );
      await tester.pumpAndSettle();

      expect(find.byType(TimelineGroupingSelector), findsOneWidget);
      expect(find.byKey(const Key('timeline-grouping-compact-selector')), findsOneWidget);
      // The chip shows one localized initial, so it stays inside a single tap target's width
      // instead of the 98px the spelled-out label needed.
      expect(tester.getSize(find.byKey(const Key('timeline-grouping-compact-selector'))).width, lessThanOrEqualTo(48));
      expect(find.byType(SortIconButton), findsNothing);
    });
  });
}
