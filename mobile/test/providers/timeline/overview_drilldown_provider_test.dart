import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/events.model.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/models/timeline_grouping.model.dart';
import 'package:immich_mobile/domain/models/timeline_temporal_scope.model.dart';
import 'package:immich_mobile/domain/models/timeline_zoom_anchor.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/domain/utils/event_stream.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/settings.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:immich_mobile/providers/timeline/overview_drilldown.provider.dart';
import 'package:immich_mobile/providers/timeline/temporal_scope.provider.dart';
import 'package:immich_mobile/providers/timeline/timeline_grouping.provider.dart';
import 'package:immich_mobile/providers/timeline/zoom_anchor.provider.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Drift db;
  late ProviderContainer container;

  setUpAll(() async {
    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: DriftStoreRepository(db), listenUpdates: false);
    await SettingsRepository.ensureInitialized(db);
  });

  setUp(() async {
    await Store.clear();
    await SettingsRepository.instance.clear(SettingsKey.values);
    container = ProviderContainer();
    addTearDown(container.dispose);
  });

  tearDownAll(() async {
    await Store.clear();
    await db.close();
  });

  test('years activation zooms to months, stores a year anchor, and preserves filters without changing scope', () async {
    container.read(photosFilterProvider.notifier).setText('paris');
    container.read(timelineTemporalScopeProvider.notifier).setYear(2024);
    var scrollEvents = 0;
    final subscription = EventStream.shared.listen<ScrollToTopEvent>((_) => scrollEvents++);
    addTearDown(subscription.cancel);

    await container.read(sharedTimelineOverviewDrilldownProvider)(
      TimeBucket(date: DateTime(2025), assetCount: 4),
      TimelineOverviewMode.years,
    );

    expect(container.read(timelineTemporalScopeProvider), const TimelineTemporalScope.year(2024));
    expect(container.read(timelineZoomAnchorProvider), const TimelineZoomAnchor.year(2025));
    expect(container.read(timelineOverviewModeProvider), TimelineOverviewMode.months);
    // Drilldown is view state: the "Group by" setting must not move with it.
    expect(SettingsRepository.instance.appConfig.timeline.groupAssetsBy, GroupAssetsBy.day);
    expect(container.read(photosFilterProvider).context, 'paris');
    await Future<void>.delayed(Duration.zero);
    expect(scrollEvents, 0);
  });

  test('months activation zooms to all, stores a month anchor, and leaves temporal scope unchanged', () async {
    await container.read(timelineOverviewModeProvider.notifier).set(TimelineOverviewMode.months);
    container.read(timelineTemporalScopeProvider.notifier).setYear(2024);
    var scrollEvents = 0;
    final subscription = EventStream.shared.listen<ScrollToTopEvent>((_) => scrollEvents++);
    addTearDown(subscription.cancel);

    await container.read(sharedTimelineOverviewDrilldownProvider)(
      TimeBucket(date: DateTime(2025, 3), assetCount: 4),
      TimelineOverviewMode.months,
    );

    expect(container.read(timelineTemporalScopeProvider), const TimelineTemporalScope.year(2024));
    expect(container.read(timelineZoomAnchorProvider), TimelineZoomAnchor.month(year: 2025, month: 3));
    expect(container.read(timelineOverviewModeProvider), TimelineOverviewMode.all);
    expect(SettingsRepository.instance.appConfig.timeline.groupAssetsBy, GroupAssetsBy.day);
    await Future<void>.delayed(Duration.zero);
    expect(scrollEvents, 0);
  });

  test('years activation stores the anchor before publishing the mode change', () async {
    final anchorsSeenAtGroupingChange = <TimelineZoomAnchor>[];
    // The drilldown sets the zoom anchor before changing the mode; capture the anchor at
    // the moment the mode flips to months.
    final subscription = container.listen(timelineOverviewModeProvider, (previous, next) {
      if (next == TimelineOverviewMode.months) {
        anchorsSeenAtGroupingChange.add(container.read(timelineZoomAnchorProvider));
      }
    });
    addTearDown(subscription.close);

    await container.read(sharedTimelineOverviewDrilldownProvider)(
      TimeBucket(date: DateTime(2025), assetCount: 4),
      TimelineOverviewMode.years,
    );
    await Future<void>.delayed(Duration.zero);

    expect(anchorsSeenAtGroupingChange, [const TimelineZoomAnchor.year(2025)]);
  });

  test('all mode is ignored and leaves anchors, scope, and mode unchanged', () async {
    await container.read(timelineOverviewModeProvider.notifier).set(TimelineOverviewMode.years);
    container.read(timelineTemporalScopeProvider.notifier).setYear(2024);

    await container.read(sharedTimelineOverviewDrilldownProvider)(
      TimeBucket(date: DateTime(2025, 3), assetCount: 4),
      TimelineOverviewMode.all,
    );

    expect(container.read(timelineTemporalScopeProvider), const TimelineTemporalScope.year(2024));
    expect(container.read(timelineZoomAnchorProvider), const TimelineZoomAnchor.none());
    expect(container.read(timelineOverviewModeProvider), TimelineOverviewMode.years);
  });

  test('photos drilldown provider aliases shared drilldown handler', () {
    expect(
      container.read(photosTimelineOverviewDrilldownProvider),
      same(container.read(sharedTimelineOverviewDrilldownProvider)),
    );
  });
}
