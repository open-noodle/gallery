import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/models/timeline_grouping.model.dart';
import 'package:immich_mobile/domain/models/timeline_temporal_scope.model.dart';
import 'package:immich_mobile/domain/models/timeline_zoom_anchor.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/settings.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/active_filter_chip.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/match_count_label.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/sort_icon_button.widget.dart';
import 'package:immich_mobile/presentation/widgets/photos_filter/filter_subheader.widget.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:immich_mobile/providers/timeline/overview_drilldown.provider.dart';
import 'package:immich_mobile/providers/timeline/temporal_scope.provider.dart';
import 'package:immich_mobile/providers/timeline/timeline_grouping.provider.dart';
import 'package:immich_mobile/providers/timeline/zoom_anchor.provider.dart';

import '../../../widget_tester_extensions.dart';

Widget _scroll(Widget sliver) => CustomScrollView(slivers: [sliver]);

void main() {
  late Drift db;

  setUpAll(() async {
    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: DriftStoreRepository(db), listenUpdates: false);
    await SettingsRepository.ensureInitialized(db);
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

  group('PhotosFilterSubheader', () {
    testWidgets('renders nothing when filter is empty', (tester) async {
      await tester.pumpConsumerWidget(_scroll(const PhotosFilterSubheader()));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('photos-filter-subheader')), findsNothing);
    });

    testWidgets('renders clear-all + at least one chip when a filter is active', (tester) async {
      await tester.pumpConsumerWidget(_scroll(const PhotosFilterSubheader()));
      await tester.pumpAndSettle();
      final container = ProviderScope.containerOf(tester.element(find.byType(CustomScrollView)));
      container.read(photosFilterProvider.notifier).setText('paris');
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('photos-filter-subheader')), findsOneWidget);
      expect(find.byKey(const Key('photos-filter-subheader-clear-all')), findsOneWidget);
      expect(find.byType(ActiveFilterChip), findsOneWidget);
    });

    // #1030: sort used to be an app-bar action. It appears and disappears with the filter, so it
    // kept changing how much width the app bar's title slot was offered, and the logo — fitted
    // with BoxFit.contain — resized to match. It belongs next to the chips it orders anyway.
    testWidgets('carries the sort control, so the app bar does not have to', (tester) async {
      await tester.pumpConsumerWidget(_scroll(const PhotosFilterSubheader()));
      await tester.pumpAndSettle();
      expect(find.byType(SortIconButton), findsNothing, reason: 'no filter yet, so nothing to sort');

      final container = ProviderScope.containerOf(tester.element(find.byType(CustomScrollView)));
      container.read(photosFilterProvider.notifier).setText('paris');
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('photos-filter-sort-button')), findsOneWidget);
      expect(
        find.descendant(
          of: find.byKey(const Key('photos-filter-subheader')),
          matching: find.byKey(const Key('photos-filter-sort-button')),
        ),
        findsOneWidget,
        reason: 'sort must live inside the subheader strip, not somewhere else in the tree',
      );
    });

    testWidgets('tapping Clear all resets the filter', (tester) async {
      await tester.pumpConsumerWidget(_scroll(const PhotosFilterSubheader()));
      await tester.pumpAndSettle();
      final container = ProviderScope.containerOf(tester.element(find.byType(CustomScrollView)));
      container.read(photosFilterProvider.notifier).setText('paris');
      await tester.pumpAndSettle();
      expect(container.read(photosFilterProvider).isEmpty, isFalse);

      await tester.tap(find.byKey(const Key('photos-filter-subheader-clear-all')));
      await tester.pumpAndSettle();

      expect(container.read(photosFilterProvider).isEmpty, isTrue);
      expect(find.byKey(const Key('photos-filter-subheader')), findsNothing);
    });

    testWidgets('strip pins Clear all only — sort moved to the app bar, count to the sheet footer', (tester) async {
      await tester.pumpConsumerWidget(_scroll(const PhotosFilterSubheader()));
      await tester.pumpAndSettle();
      final container = ProviderScope.containerOf(tester.element(find.byType(CustomScrollView)));
      container.read(photosFilterProvider.notifier).setText('paris');
      await tester.pumpAndSettle();

      // The crowding fix: the strip no longer hosts the sort control or the
      // match count, freeing the full width for the scrollable filter chips.
      expect(find.byKey(const Key('photos-filter-sort-chip')), findsNothing);
      expect(find.byType(MatchCountLabel), findsNothing);
    });

    testWidgets('clear-all label uses existing clear_all i18n key', (tester) async {
      await tester.pumpConsumerWidget(_scroll(const PhotosFilterSubheader()));
      await tester.pumpAndSettle();
      final container = ProviderScope.containerOf(tester.element(find.byType(CustomScrollView)));
      container.read(photosFilterProvider.notifier).setText('paris');
      await tester.pumpAndSettle();

      expect(find.text('clear_all'.tr()), findsOneWidget);
    });

    testWidgets('does not render a temporal chip from Photos years activation', (tester) async {
      await tester.pumpConsumerWidget(_scroll(const PhotosFilterSubheader()));
      await tester.pumpAndSettle();
      final container = ProviderScope.containerOf(tester.element(find.byType(CustomScrollView)));

      await container.read(photosTimelineOverviewDrilldownProvider)(
        TimeBucket(date: DateTime(2025), assetCount: 4),
        TimelineOverviewMode.years,
      );
      await tester.pumpAndSettle();

      expect(container.read(timelineTemporalScopeProvider), const TimelineTemporalScope.none());
      expect(container.read(timelineZoomAnchorProvider), const TimelineZoomAnchor.year(2025));
      expect(container.read(timelineOverviewModeProvider), TimelineOverviewMode.months);
      expect(find.byKey(const Key('photos-filter-subheader')), findsNothing);
      expect(find.text('2025'), findsNothing);
      expect(find.text('Mar 2025'), findsNothing);
    });

    testWidgets('keeps existing Photos filter chips without adding a temporal chip after activation', (tester) async {
      await tester.pumpConsumerWidget(_scroll(const PhotosFilterSubheader()));
      await tester.pumpAndSettle();
      final container = ProviderScope.containerOf(tester.element(find.byType(CustomScrollView)));
      container.read(photosFilterProvider.notifier).setText('paris');
      await tester.pumpAndSettle();

      await container.read(photosTimelineOverviewDrilldownProvider)(
        TimeBucket(date: DateTime(2025), assetCount: 4),
        TimelineOverviewMode.years,
      );
      await tester.pumpAndSettle();

      expect(container.read(photosFilterProvider).context, 'paris');
      expect(container.read(timelineTemporalScopeProvider), const TimelineTemporalScope.none());
      expect(find.byKey(const Key('photos-filter-subheader')), findsOneWidget);
      expect(find.text('"paris"'), findsOneWidget);
      expect(find.text('2025'), findsNothing);
    });

    testWidgets('explicit Photos date chips remain clearable after card activation', (tester) async {
      await tester.pumpConsumerWidget(_scroll(const PhotosFilterSubheader()));
      await tester.pumpAndSettle();
      final container = ProviderScope.containerOf(tester.element(find.byType(CustomScrollView)));
      container
          .read(photosFilterProvider.notifier)
          .setDateRange(start: DateTime(2025, 3), end: DateTime(2025, 3, 31, 23, 59, 59));
      await tester.pumpAndSettle();

      await container.read(photosTimelineOverviewDrilldownProvider)(
        TimeBucket(date: DateTime(2025), assetCount: 4),
        TimelineOverviewMode.years,
      );
      await tester.pumpAndSettle();

      expect(find.text('Mar 2025'), findsOneWidget);
      expect(container.read(timelineTemporalScopeProvider), const TimelineTemporalScope.none());
      expect(container.read(photosFilterProvider).date.takenAfter, DateTime(2025, 3));
      expect(container.read(timelineOverviewModeProvider), TimelineOverviewMode.months);

      await tester.drag(find.byType(Scrollable).last, const Offset(-120, 0));
      await tester.pumpAndSettle();
      final dateChip = find.ancestor(of: find.text('Mar 2025'), matching: find.byType(ActiveFilterChip));
      await tester.tap(find.descendant(of: dateChip, matching: find.byIcon(Icons.close_rounded)));
      await tester.pumpAndSettle();

      expect(container.read(photosFilterProvider).date.takenAfter, isNull);
      expect(container.read(photosFilterProvider).date.takenBefore, isNull);
      expect(container.read(timelineTemporalScopeProvider), const TimelineTemporalScope.none());
      expect(container.read(timelineOverviewModeProvider), TimelineOverviewMode.months);
    });

    testWidgets('temporal scope alone does not render as a filter chip', (tester) async {
      await tester.pumpConsumerWidget(_scroll(const PhotosFilterSubheader()));
      await tester.pumpAndSettle();
      final container = ProviderScope.containerOf(tester.element(find.byType(CustomScrollView)));
      container.read(timelineTemporalScopeProvider.notifier).setMonth(year: 2025, month: 3);
      await tester.pumpAndSettle();

      expect(container.read(timelineTemporalScopeProvider), TimelineTemporalScope.month(year: 2025, month: 3));
      expect(find.byKey(const Key('photos-filter-subheader')), findsNothing);
      expect(find.text('Mar 2025'), findsNothing);
    });

    testWidgets('Clear all resets normal filters without treating temporal scope as a chip', (tester) async {
      await tester.pumpConsumerWidget(_scroll(const PhotosFilterSubheader()));
      await tester.pumpAndSettle();
      final container = ProviderScope.containerOf(tester.element(find.byType(CustomScrollView)));
      container.read(photosFilterProvider.notifier).setText('paris');
      container.read(timelineTemporalScopeProvider.notifier).setYear(2025);
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('photos-filter-subheader-clear-all')));
      await tester.pumpAndSettle();

      expect(container.read(photosFilterProvider).isEmpty, isTrue);
      expect(container.read(timelineTemporalScopeProvider), const TimelineTemporalScope.year(2025));
      expect(find.byKey(const Key('photos-filter-subheader')), findsNothing);
    });
  });
}
