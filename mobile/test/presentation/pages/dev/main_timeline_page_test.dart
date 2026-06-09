import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/settings.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/presentation/pages/dev/main_timeline.page.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_icon_button.widget.dart';
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
    await StoreService.init(storeRepository: DriftStoreRepository(db), listenUpdates: false);
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
    test('leads with a compact grouping selector and keeps the live-search sort and filter actions', () {
      // The main photos timeline also hosts live-search (#654), so the grouping
      // selector (#625) sits alongside the sort and filter actions rather than
      // replacing them.
      expect(PhotosTimelineAppBar.actions, hasLength(3));
      expect(PhotosTimelineAppBar.actions.first, isA<TimelineGroupingSelector>());
      expect((PhotosTimelineAppBar.actions.first as TimelineGroupingSelector).compact, isTrue);
      expect(PhotosTimelineAppBar.actions.whereType<SortIconButton>(), hasLength(1));
      expect(PhotosTimelineAppBar.actions.whereType<FilterIconButton>(), hasLength(1));
      expect(MainTimelinePage.timelineOverviewControlsEnabled, isTrue);
    });

    testWidgets('app bar renders the compact grouping selector beside sort and filter', (tester) async {
      await tester.binding.setSurfaceSize(const Size(1024, 600));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      await tester.pumpConsumerWidget(
        const CustomScrollView(slivers: [SliverAppBar(actions: PhotosTimelineAppBar.actions)]),
      );
      await tester.pumpAndSettle();

      expect(find.byType(TimelineGroupingSelector), findsOneWidget);
      expect(find.byKey(const Key('timeline-grouping-compact-selector')), findsOneWidget);
      // The chip is sized to fit its widest label ("Months") without truncating, yet stays a
      // compact app-bar action rather than sprawling across the bar.
      expect(tester.getSize(find.byKey(const Key('timeline-grouping-compact-selector'))).width, lessThanOrEqualTo(120));
      expect(find.byType(SortIconButton), findsOneWidget);
      expect(find.byType(FilterIconButton), findsOneWidget);
    });
  });
}
