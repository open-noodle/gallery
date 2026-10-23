import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/data/db/main/database.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/models/timeline_grouping.model.dart';
import 'package:immich_mobile/domain/models/timeline_temporal_scope.model.dart';
import 'package:immich_mobile/domain/models/timeline_zoom_anchor.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/gallery/search/search.providers.dart';
import 'package:immich_mobile/gallery/search/search_state.model.dart';
import 'package:immich_mobile/infrastructure/repositories/settings.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
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
    await SettingsRepository.ensureInitialized(db);
    await StoreService.init(storeRepository: StoreRepository(db), listenUpdates: false);
  });

  setUp(() async {
    await Store.clear();
    await SettingsRepository.instance.clear(SettingsKey.values);
    container = ProviderContainer();
    addTearDown(container.dispose);
  });

  tearDownAll(() async {
    await Store.clear();
    await SettingsRepository.instance.clear(SettingsKey.values);
    await db.close();
  });

  test('Photos years activation changes the mode and anchor only', () async {
    container.read(searchStateProvider.notifier)
      ..submitText('paris')
      ..toggleTag(const SearchTagRef(id: 'tag-1', value: 'beach'))
      ..setFavoritesOnly(true)
      ..setMediaType(SearchMediaType.video);
    container.read(timelineTemporalScopeProvider.notifier).setMonth(year: 2024, month: 12);
    final beforeFilter = container.read(searchStateProvider);

    await container.read(photosTimelineOverviewDrilldownProvider)(
      TimeBucket(date: DateTime(2025), assetCount: 4),
      TimelineOverviewMode.years,
    );

    expect(container.read(timelineOverviewModeProvider), TimelineOverviewMode.months);
    // Drilldown is view state: the "Group by" setting must not move with it.
    expect(SettingsRepository.instance.appConfig.timeline.groupAssetsBy, GroupAssetsBy.day);
    expect(container.read(timelineZoomAnchorProvider), const TimelineZoomAnchor.year(2025));
    expect(container.read(timelineTemporalScopeProvider), TimelineTemporalScope.month(year: 2024, month: 12));
    expect(container.read(searchStateProvider), beforeFilter);
    expect(container.read(searchStateProvider).query, const SearchQuery.text('paris'));
    expect(container.read(searchStateProvider).filters.tags.map((t) => t.id), ['tag-1']);
    expect(container.read(searchStateProvider).filters.favoritesOnly, isTrue);
    expect(container.read(searchStateProvider).filters.mediaType, SearchMediaType.video);
  });

  test('Photos months activation changes the mode and anchor only', () async {
    container.read(searchStateProvider.notifier)
      ..setPlace(const SearchPlace(country: 'France'))
      ..setMinRating(4);
    final beforeFilter = container.read(searchStateProvider);
    await container.read(timelineOverviewModeProvider.notifier).set(TimelineOverviewMode.months);

    await container.read(photosTimelineOverviewDrilldownProvider)(
      TimeBucket(date: DateTime(2025, 3), assetCount: 4),
      TimelineOverviewMode.months,
    );

    expect(container.read(timelineOverviewModeProvider), TimelineOverviewMode.all);
    expect(container.read(timelineZoomAnchorProvider), TimelineZoomAnchor.month(year: 2025, month: 3));
    expect(container.read(timelineTemporalScopeProvider), const TimelineTemporalScope.none());
    expect(container.read(searchStateProvider), beforeFilter);
    expect(container.read(searchStateProvider).filters.place?.country, 'France');
    expect(container.read(searchStateProvider).filters.minRating, 4);
  });

  test('Photos all activation is ignored', () async {
    await container.read(timelineOverviewModeProvider.notifier).set(TimelineOverviewMode.years);
    container.read(searchStateProvider.notifier).submitText('paris');
    final beforeFilter = container.read(searchStateProvider);

    await container.read(photosTimelineOverviewDrilldownProvider)(
      TimeBucket(date: DateTime(2025, 3), assetCount: 4),
      TimelineOverviewMode.all,
    );

    expect(container.read(timelineOverviewModeProvider), TimelineOverviewMode.years);
    expect(container.read(timelineZoomAnchorProvider), const TimelineZoomAnchor.none());
    expect(container.read(timelineTemporalScopeProvider), const TimelineTemporalScope.none());
    expect(container.read(searchStateProvider), beforeFilter);
  });
}
