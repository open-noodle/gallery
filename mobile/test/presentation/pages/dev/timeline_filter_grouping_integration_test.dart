// Integration / acceptance tests for the filter × grouping fix.
//
// These wire the REAL provider chain:
//   SearchService (mocked) → photosFilterSearchProvider (real) →
//   TimelineFactory (real) → TimelineRepository (real, in-memory Drift) →
//   fromAssetStream (real, with GroupAssetsBy) → TimelineService →
//   timelineSegmentProvider (real)
//
// Before the fix, `fromAssetStream` emitted date-less `Bucket`s regardless of
// the grouping setting, causing `TimelineOverviewSegment` to render an empty
// `SizedBox.shrink()` for every month/year tile.  These tests catch that
// regression (they would have produced FixedSegments or an empty segment list
// before the fix, not `TimelineOverviewSegment`s with correct counts).

import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/data/db/main/database.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/search_result.model.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/models/timeline_grouping.model.dart';
import 'package:immich_mobile/domain/models/user.model.dart';
import 'package:immich_mobile/domain/services/search.service.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/domain/services/user.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/settings.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/presentation/widgets/timeline/overview/overview_segment.model.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.state.dart';
import 'package:immich_mobile/providers/infrastructure/db.provider.dart';
import 'package:immich_mobile/providers/infrastructure/search.provider.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/infrastructure/user.provider.dart' as infra;
import 'package:immich_mobile/providers/photos_filter/filter_count.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter_search.provider.dart';
import 'package:immich_mobile/providers/photos_filter/timeline_query.provider.dart';
import 'package:immich_mobile/providers/timeline/temporal_scope.provider.dart';
import 'package:immich_mobile/providers/timeline/timeline_grouping.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:mocktail/mocktail.dart';

class _MockSearch extends Mock implements SearchService {}

class _MockUserService extends Mock implements UserService {}

class _FakeFilter extends Fake implements SearchFilter {}

class _StubCurrentUserNotifier extends CurrentUserProvider {
  _StubCurrentUserNotifier(super.service, UserDto? initial) {
    state = initial;
  }
}

final _testUser = UserDto(id: 'user-1', email: 'test@example.com', name: 'Test User', profileChangedAt: DateTime(2024));

/// Build a `RemoteAsset` with a specific `createdAt`.
RemoteAsset _asset(String id, DateTime createdAt) => RemoteAsset(
  id: id,
  checksum: 'cs-$id',
  ownerId: 'user-1',
  name: '$id.jpg',
  type: AssetType.image,
  createdAt: createdAt,
  updatedAt: createdAt,
  durationMs: 0,
  isFavorite: false,
  isEdited: false,
);

/// Assets spanning 2024-03 (×2) and 2024-01 (×1), newest-first.
///
/// Local `DateTime`s so `createdAt.toLocal()` is identity and the day/month/year
/// bucket assertions are stable on any test-machine timezone (mirrors the repo unit tests).
List<BaseAsset> _assets() => [
  _asset('a1', DateTime(2024, 3, 15, 12)),
  _asset('a2', DateTime(2024, 3, 15, 10)),
  _asset('a3', DateTime(2024, 1, 10, 8)),
];

ProviderContainer _makeContainer({required SearchService search, required Drift db}) {
  final mockUserSvc = _MockUserService();
  when(() => mockUserSvc.tryGetMyUser()).thenReturn(_testUser);
  when(() => mockUserSvc.watchMyUser()).thenAnswer((_) => const Stream.empty());

  return ProviderContainer(
    overrides: [
      driftProvider.overrideWithValue(db),
      searchServiceProvider.overrideWithValue(search),
      infra.userServiceProvider.overrideWithValue(mockUserSvc),
      currentUserProvider.overrideWith((ref) => _StubCurrentUserNotifier(mockUserSvc, _testUser)),
      timelineUsersProvider.overrideWith((_) => Stream.value([_testUser.id])),
      photosFilterCountProvider.overrideWith((ref) => 0),
      // Override timelineArgsProvider so timelineSegmentProvider (autoDispose)
      // can be read without a widget tree.
      timelineArgsProvider.overrideWith((_) => const TimelineArgs(maxWidth: 375, maxHeight: 812, columnCount: 3)),
      // Mirrors the Photos page's TimelineRouteScope wiring: the service is rebuilt from the
      // temporal scope and the bucket granularity (the zoom level, or the persisted
      // "Group by" setting while the selector is on All).
      timelineServiceProvider.overrideWith((ref) {
        final service = buildPhotosTimelineRouteService(
          ref,
          ref.watch(timelineTemporalScopeProvider),
          ref.watch(timelineGroupingSpecProvider).groupBy,
        );
        ref.onDispose(service.dispose);
        return service;
      }),
    ],
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Drift db;

  setUpAll(() async {
    registerFallbackValue(_FakeFilter());
    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: StoreRepository(db), listenUpdates: false);
    await SettingsRepository.ensureInitialized(db);
    await Store.put(StoreKey.serverEndpoint, 'http://localhost:0');
  });

  setUp(() async {
    await Store.clear();
    await SettingsRepository.instance.clear(SettingsKey.values);
    await Store.put(StoreKey.serverEndpoint, 'http://localhost:0');
  });

  tearDownAll(() async {
    await Store.clear();
    await db.close();
  });

  // ---------------------------------------------------------------------------
  // Test 1 — Filtered + Months → month overview segments, counts sum correctly.
  //
  // Real guard: before the fix `fromAssetStream` emitted date-less Bucket(n)
  // segments; `timelineSegmentProvider` would have fallen back to FixedSegments
  // (the isDateless guard) — or, in an older build, would have emitted empty
  // TimelineOverviewSegments. After the fix it emits TimeBuckets → the segment
  // provider produces TimelineOverviewSegments with correct counts.
  // ---------------------------------------------------------------------------
  test('Filtered + Months → month TimelineOverviewSegments, asset counts sum to total', () async {
    final search = _MockSearch();
    final assets = _assets();
    when(() => search.search(any(), 1)).thenAnswer((_) async => SearchResult(assets: assets, nextPage: null));

    final container = _makeContainer(search: search, db: db);
    addTearDown(container.dispose);

    // Set a non-smart, non-empty filter (notInAlbum=true → no context → non-smart).
    container.read(photosFilterProvider.notifier).setNotInAlbum(true);
    await container.read(timelineOverviewModeProvider.notifier).set(TimelineOverviewMode.months);

    // Keep `photosFilterSearchProvider` (autoDispose) alive for the duration of
    // this test by subscribing a listener.  Without a listener the autoDispose
    // machinery would collect it between the `await` and the bucket read,
    // causing PhotosFilterSearchNotifier.getAssets to throw "after dispose".
    final sub = container.listen(photosFilterSearchProvider, (_, _) {});
    addTearDown(sub.close);

    // Read the photos timeline query provider — this builds the search-backed
    // TimelineService backed by the REAL TimelineFactory / TimelineRepository.
    final svc = container.read(timelineServiceProvider);
    expect(svc.origin, TimelineOrigin.search);

    // Wait for the page-1 search load to settle deterministically.
    await container.read(photosFilterSearchProvider.notifier).firstLoad;

    // Read buckets from the REAL service (no mock factory — genuine end-to-end).
    final buckets = await svc.watchBuckets().first;

    // All buckets must be TimeBuckets (dated), not plain Buckets.
    // REGRESSION: before the fix this would be [Bucket(assetCount: 3)] — one
    // plain date-less bucket — and every month tile would render SizedBox.shrink().
    expect(buckets, everyElement(isA<TimeBucket>()));

    // Two distinct months.
    expect(buckets.length, 2);
    expect(buckets[0], isA<TimeBucket>());
    expect((buckets[0] as TimeBucket).date.month, 3); // 2024-03, newest-first
    expect((buckets[0] as TimeBucket).date.year, 2024);
    expect(buckets[1], isA<TimeBucket>());
    expect((buckets[1] as TimeBucket).date.month, 1); // 2024-01
    expect((buckets[1] as TimeBucket).date.year, 2024);

    // The sum of bucket counts must equal the loaded asset total — no assets dropped.
    final countSum = buckets.fold<int>(0, (acc, b) => acc + b.assetCount);
    expect(countSum, assets.length, reason: 'No assets should be dropped during month-grouping');

    // Verify the segment provider too: TimelineOverviewSegments, not FixedSegments.
    final segments = await container.read(timelineSegmentProvider.future);

    expect(segments, everyElement(isA<TimelineOverviewSegment>()));
    expect(segments.length, 2, reason: 'One overview card per month');

    final segCountSum = segments.fold<int>(0, (acc, s) => acc + s.bucket.assetCount);
    expect(segCountSum, assets.length, reason: 'Segment counts must match loaded asset count');
  });

  // ---------------------------------------------------------------------------
  // Test 2 — Reactivity: changing GroupAssetsBy while a filter is active
  // rebuilds the service and re-emits buckets at the new granularity.
  //
  // month → day:  TimeBuckets (still dated) grouped at day granularity.
  // month → year: TimeBuckets grouped at year granularity (1 bucket).
  // ---------------------------------------------------------------------------
  test('Changing the grouping while a filter is active rebuilds service buckets at new granularity', () async {
    final search = _MockSearch();
    final assets = _assets();
    when(() => search.search(any(), 1)).thenAnswer((_) async => SearchResult(assets: assets, nextPage: null));

    final container = _makeContainer(search: search, db: db);
    addTearDown(container.dispose);

    container.read(photosFilterProvider.notifier).setNotInAlbum(true);

    // Keep `photosFilterSearchProvider` alive across the awaits.
    final sub = container.listen(photosFilterSearchProvider, (_, _) {});
    addTearDown(sub.close);

    // Selecting Months groups the filtered results by month.
    await container.read(timelineOverviewModeProvider.notifier).set(TimelineOverviewMode.months);
    await container.read(photosFilterSearchProvider.notifier).firstLoad;

    final monthBuckets = await container.read(timelineServiceProvider).watchBuckets().first;
    expect(monthBuckets, everyElement(isA<TimeBucket>()));
    expect(monthBuckets.length, 2, reason: 'Month grouping: 2024-03 + 2024-01');

    // Back to All: with the default "Month + day" setting the service regroups by day.
    await container.read(timelineOverviewModeProvider.notifier).set(TimelineOverviewMode.all);
    await container.read(photosFilterSearchProvider.notifier).firstLoad;

    final dayBuckets = await container.read(timelineServiceProvider).watchBuckets().first;
    // Day grouping: the 2 March assets share the same date (2024-03-15), so
    // there are 2 distinct day buckets: 2024-03-15 and 2024-01-10.
    expect(dayBuckets, everyElement(isA<TimeBucket>()));
    expect(dayBuckets.length, 2, reason: 'Day grouping: 2024-03-15 (×2) + 2024-01-10 (×1)');
    // Bucket dates are `DateTime(year, month, day)` in local time (no UTC offset).
    // Compare year/month/day fields to avoid timezone-conversion mismatches.
    expect((dayBuckets[0] as TimeBucket).date.year, 2024);
    expect((dayBuckets[0] as TimeBucket).date.month, 3);
    expect((dayBuckets[0] as TimeBucket).date.day, 15);
    expect((dayBuckets[1] as TimeBucket).date.year, 2024);
    expect((dayBuckets[1] as TimeBucket).date.month, 1);
    expect((dayBuckets[1] as TimeBucket).date.day, 10);

    final dayCountSum = dayBuckets.fold<int>(0, (acc, b) => acc + b.assetCount);
    expect(dayCountSum, assets.length, reason: 'No assets dropped after regrouping to day');

    // Segment provider emits FixedSegments for the day service.
    final daySegments = await container.read(timelineSegmentProvider.future);
    for (final seg in daySegments) {
      expect(
        seg,
        isNot(isA<TimelineOverviewSegment>()),
        reason: 'Day grouping produces FixedSegments, not overview cards',
      );
    }

    // Selecting Years groups the filtered results by year.
    await container.read(timelineOverviewModeProvider.notifier).set(TimelineOverviewMode.years);
    await container.read(photosFilterSearchProvider.notifier).firstLoad;

    final yearBuckets = await container.read(timelineServiceProvider).watchBuckets().first;
    expect(yearBuckets, everyElement(isA<TimeBucket>()));
    expect(yearBuckets.length, 1, reason: 'Year grouping: all 3 assets are in 2024');
    expect((yearBuckets[0] as TimeBucket).date.year, 2024);
    expect(yearBuckets[0].assetCount, assets.length);
  });

  // ---------------------------------------------------------------------------
  // Test 2b (#903) — the "Group by" setting is a header granularity, so under an
  // active filter "All" + Month must still be a photo grid, just with month buckets.
  // ---------------------------------------------------------------------------
  test('Filtered + All with the month Group by setting produces month buckets on the grid', () async {
    final search = _MockSearch();
    final assets = _assets();
    when(() => search.search(any(), 1)).thenAnswer((_) async => SearchResult(assets: assets, nextPage: null));

    await SettingsRepository.instance.write(SettingsKey.timelineGroupAssetsBy, GroupAssetsBy.month);

    final container = _makeContainer(search: search, db: db);
    addTearDown(container.dispose);

    container.read(photosFilterProvider.notifier).setNotInAlbum(true);

    final sub = container.listen(photosFilterSearchProvider, (_, _) {});
    addTearDown(sub.close);

    expect(container.read(timelineOverviewModeProvider), TimelineOverviewMode.all, reason: 'Selector opens on All');
    await container.read(photosFilterSearchProvider.notifier).firstLoad;

    final buckets = await container.read(timelineServiceProvider).watchBuckets().first;
    expect(buckets.length, 2, reason: 'Month granularity: 2024-03 + 2024-01');
    expect((buckets[0] as TimeBucket).date.month, 3);
    expect((buckets[0] as TimeBucket).date.day, 1, reason: 'Month buckets are truncated to the 1st');

    final segments = await container.read(timelineSegmentProvider.future);
    expect(segments, everyElement(isNot(isA<TimelineOverviewSegment>())), reason: 'Still a grid, not cards');
    expect(segments.map((segment) => segment.header), everyElement(HeaderType.month));
  });

  // ---------------------------------------------------------------------------
  // Test 3 — Drill-down: DESCOPED.
  //
  // The drill-down handler lives in `sharedTimelineOverviewDrilldownProvider`
  // and is fully tested by `overview_drilldown_provider_test.dart`.  The handler
  // calls `timelineOverviewModeProvider.notifier.set(...)` (the root notifier on the
  // Photos page; route-local elsewhere) and sets a
  // zoom anchor — it does NOT inspect the timeline service at all, so the
  // filtered vs unfiltered distinction makes no difference to the handler logic.
  //
  // Wiring a filtered widget test faithful enough to find and tap a rendered
  // `TimelineOverviewCard` would require a full `EasyLocalization` + Flutter
  // widget tree (the card uses `Semantics` labels via localized month names), and
  // the value added would be duplicating what the zoom test already covers (it
  // exercises the exact same tap → TimelineOverviewMode.all + anchor path on the same
  // handler).  The load-bearing acceptance is fully covered by tests 1 and 2.
  // ---------------------------------------------------------------------------
}
