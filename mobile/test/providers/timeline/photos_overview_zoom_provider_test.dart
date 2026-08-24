import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/data/db/main/database.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/models/timeline_grouping.model.dart';
import 'package:immich_mobile/domain/models/timeline_temporal_scope.model.dart';
import 'package:immich_mobile/domain/models/timeline_zoom_anchor.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/settings.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
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
    container.read(photosFilterProvider.notifier)
      ..setText('paris')
      ..toggleTag('tag-1')
      ..setFavouritesOnly(true)
      ..setMediaType(AssetType.video);
    container.read(timelineTemporalScopeProvider.notifier).setMonth(year: 2024, month: 12);
    final beforeFilter = container.read(photosFilterProvider);

    await container.read(photosTimelineOverviewDrilldownProvider)(
      TimeBucket(date: DateTime(2025), assetCount: 4),
      TimelineOverviewMode.years,
    );

    expect(container.read(timelineOverviewModeProvider), TimelineOverviewMode.months);
    // Drilldown is view state: the "Group by" setting must not move with it.
    expect(SettingsRepository.instance.appConfig.timeline.groupAssetsBy, GroupAssetsBy.day);
    expect(container.read(timelineZoomAnchorProvider), const TimelineZoomAnchor.year(2025));
    expect(container.read(timelineTemporalScopeProvider), TimelineTemporalScope.month(year: 2024, month: 12));
    expect(container.read(photosFilterProvider), beforeFilter);
    expect(container.read(photosFilterProvider).context, 'paris');
    expect(container.read(photosFilterProvider).tagIds, ['tag-1']);
    expect(container.read(photosFilterProvider).display.isFavorite, isTrue);
    expect(container.read(photosFilterProvider).mediaType, AssetType.video);
  });

  test('Photos months activation changes the mode and anchor only', () async {
    container.read(photosFilterProvider.notifier)
      ..setLocation(const SearchLocationFilter(country: 'France'))
      ..setRating(4);
    final beforeFilter = container.read(photosFilterProvider);
    await container.read(timelineOverviewModeProvider.notifier).set(TimelineOverviewMode.months);

    await container.read(photosTimelineOverviewDrilldownProvider)(
      TimeBucket(date: DateTime(2025, 3), assetCount: 4),
      TimelineOverviewMode.months,
    );

    expect(container.read(timelineOverviewModeProvider), TimelineOverviewMode.all);
    expect(container.read(timelineZoomAnchorProvider), TimelineZoomAnchor.month(year: 2025, month: 3));
    expect(container.read(timelineTemporalScopeProvider), const TimelineTemporalScope.none());
    expect(container.read(photosFilterProvider), beforeFilter);
    expect(container.read(photosFilterProvider).location.country, 'France');
    expect(container.read(photosFilterProvider).rating.rating.unwrapOrNull, 4);
  });

  test('Photos all activation is ignored', () async {
    await container.read(timelineOverviewModeProvider.notifier).set(TimelineOverviewMode.years);
    container.read(photosFilterProvider.notifier).setText('paris');
    final beforeFilter = container.read(photosFilterProvider);

    await container.read(photosTimelineOverviewDrilldownProvider)(
      TimeBucket(date: DateTime(2025, 3), assetCount: 4),
      TimelineOverviewMode.all,
    );

    expect(container.read(timelineOverviewModeProvider), TimelineOverviewMode.years);
    expect(container.read(timelineZoomAnchorProvider), const TimelineZoomAnchor.none());
    expect(container.read(timelineTemporalScopeProvider), const TimelineTemporalScope.none());
    expect(container.read(photosFilterProvider), beforeFilter);
  });
}
