// Grouping of Photos search results, end to end through the real page:
//   MainTimelinePage → TimelineRouteScope(search:) → searchTimelineServiceBuilder
//   → SearchTimelineSource (lib/gallery/search/search_timeline.dart) → TimelineService
//   → timelineSegmentProvider (real)
//
// The Years / Months / All selector and the "Group by" setting must group the results the way they group the normal
// timeline: dated buckets at the chosen granularity, counts that add up to the results, overview cards for Years and
// Months, and a grid with month headers for All + Month (#903).

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/models/timeline_grouping.model.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/gallery/search/search.providers.dart';
import 'package:immich_mobile/gallery/search/search_mode.provider.dart';
import 'package:immich_mobile/gallery/search/search_state.model.dart';
import 'package:immich_mobile/infrastructure/repositories/settings.repository.dart';
import 'package:immich_mobile/presentation/widgets/timeline/overview/overview_segment.model.dart';
import 'package:immich_mobile/presentation/widgets/timeline/segment.model.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.state.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.widget.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/timeline/timeline_grouping.provider.dart';

import '../../../gallery/search/search_mode_harness.dart';

const _anna = SearchPersonRef(filterId: 'person:anna', name: 'Anna', profileId: 'anna');

void main() {
  final database = SearchModeDatabase();

  setUpAll(database.setUpAll);
  tearDownAll(database.tearDownAll);

  /// The Photos page searching Anna's photos: 2024-06-03 and 2024-06-02 in Kyoto, 2023-09-10 in Lisbon.
  Future<ProviderContainer> searchAnna(WidgetTester tester, {GroupAssetsBy? groupBy}) async {
    await database.setUp(timelineAssets: 5);
    if (groupBy != null) {
      await SettingsRepository.instance.write(SettingsKey.timelineGroupAssetsBy, groupBy);
    }
    final container = searchModeContainer(db: database.db, repository: FakeSearchRepository(FakeLibrary.standard));
    await pumpPhotosPage(tester, container);
    container.read(searchModeProvider.notifier).enter();
    container.read(searchStateProvider.notifier).togglePerson(_anna);
    await settleFrames(tester);
    return container;
  }

  ProviderContainer timeline(WidgetTester tester) => ProviderScope.containerOf(tester.element(find.byType(Timeline)));

  Future<List<Bucket>> buckets(WidgetTester tester) async {
    final service = timeline(tester).read(timelineServiceProvider);
    expect(service.origin, TimelineOrigin.search);
    return (await tester.runAsync(() => service.watchBuckets().first))!;
  }

  Future<void> zoom(WidgetTester tester, TimelineOverviewMode mode) async {
    await timeline(tester).read(timelineOverviewModeProvider.notifier).set(mode);
    await settleFrames(tester);
  }

  /// The segments the grid lays out, read from inside the Timeline (its layout arguments live there).
  Future<List<Segment>> layout(WidgetTester tester) async {
    final grid = ProviderScope.containerOf(
      tester.element(find.descendant(of: find.byType(Timeline), matching: find.byType(CustomScrollView)).first),
    );
    final subscription = grid.listen(timelineSegmentProvider, (_, _) {});
    try {
      return (await tester.runAsync(() => grid.read(timelineSegmentProvider.future)))!;
    } finally {
      subscription.close();
    }
  }

  int sum(List<Bucket> buckets) => buckets.fold<int>(0, (acc, b) => acc + b.assetCount);

  testWidgets('Months: one dated overview card per month, counts adding up to the results', (tester) async {
    final container = await searchAnna(tester);
    await zoom(tester, TimelineOverviewMode.months);

    final months = await buckets(tester);
    expect(months, everyElement(isA<TimeBucket>()));
    expect([for (final b in months) (b as TimeBucket).date], [DateTime(2024, 6), DateTime(2023, 9)]);
    expect(sum(months), 3, reason: 'no result dropped by grouping');

    final segments = await layout(tester);
    expect(segments, everyElement(isA<TimelineOverviewSegment>()));
    expect(segments, hasLength(2));

    await zoom(tester, TimelineOverviewMode.all);
    await disposePhotosPage(tester, container);
  });

  testWidgets('changing the grouping while searching regroups the results: Months, Years, then All by day', (
    tester,
  ) async {
    final container = await searchAnna(tester);

    await zoom(tester, TimelineOverviewMode.years);
    final years = await buckets(tester);
    expect([for (final b in years) (b as TimeBucket).date], [DateTime(2024), DateTime(2023)]);
    expect([for (final b in years) b.assetCount], [2, 1]);

    await zoom(tester, TimelineOverviewMode.all);
    // Day headers need each month's assets; the grid loads the months it shows, then the days are known.
    final days = await buckets(tester);
    expect(days, everyElement(isA<TimeBucket>()));
    expect(
      [for (final b in days) (b as TimeBucket).date],
      [DateTime(2024, 6, 3), DateTime(2024, 6, 2), DateTime(2023, 9, 10)],
    );
    expect(sum(days), 3);
    final segments = await layout(tester);
    expect(segments, everyElement(isNot(isA<TimelineOverviewSegment>())), reason: 'All is a grid, not cards');

    await disposePhotosPage(tester, container);
  });

  testWidgets('All with the month "Group by" setting is a grid with month headers (#903)', (tester) async {
    // The test font is wider than any real one, so a month header's row overflows its 392 px. Not what this checks.
    final previous = FlutterError.onError;
    FlutterError.onError = (details) {
      if (!details.exception.toString().contains('overflowed')) {
        previous?.call(details);
      }
    };
    addTearDown(() => FlutterError.onError = previous);
    final container = await searchAnna(tester, groupBy: GroupAssetsBy.month);
    expect(timeline(tester).read(timelineOverviewModeProvider), TimelineOverviewMode.all);

    final months = await buckets(tester);
    expect([for (final b in months) (b as TimeBucket).date], [DateTime(2024, 6), DateTime(2023, 9)]);
    final segments = await layout(tester);
    expect(segments, everyElement(isNot(isA<TimelineOverviewSegment>())), reason: 'still a grid, not cards');
    expect(segments.map((segment) => segment.header), everyElement(HeaderType.month));

    await disposePhotosPage(tester, container);
  });
}
