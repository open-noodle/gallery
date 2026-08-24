import 'dart:async';

import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/constants/constants.dart';
import 'package:immich_mobile/data/db/main/database.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/models/timeline_grouping.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/presentation/widgets/images/thumbnail.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/overview/overview_card.dart';
import 'package:immich_mobile/presentation/widgets/timeline/overview/overview_segment.model.dart';
import 'package:immich_mobile/presentation/widgets/timeline/overview/overview_segment_builder.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/timeline/overview_drilldown.provider.dart';
import 'package:immich_mobile/providers/timeline/overview_representative_cache.provider.dart';
import 'package:intl/date_symbol_data_local.dart';
// easy_localization initializes shared_preferences internally; tests need the mock initializer.
// ignore: depend_on_referenced_packages
import 'package:shared_preferences/shared_preferences.dart';

import '../../../../test_utils.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Drift db;

  setUpAll(() async {
    TestUtils.init();
    SharedPreferences.setMockInitialValues({});
    await EasyLocalization.ensureInitialized();
    await initializeDateFormatting('en');
    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: StoreRepository(db), listenUpdates: false);
  });

  setUp(() async {
    await Store.clear();
    await Store.put(StoreKey.serverEndpoint, 'http://test-server');
  });

  tearDownAll(() async {
    await Store.clear();
    await db.close();
  });

  test('year overview maps each bucket to one compact segment with cumulative representative offsets', () {
    final segments = TimelineOverviewSegmentBuilder(
      buckets: [
        TimeBucket(date: DateTime(2025), assetCount: 5),
        TimeBucket(date: DateTime(2024), assetCount: 2),
      ],
      mode: TimelineOverviewMode.years,
    ).generate();

    expect(segments, hasLength(2));
    expect(segments, everyElement(isA<TimelineOverviewSegment>()));
    expect(segments[0].firstIndex, 0);
    expect(segments[0].lastIndex, 0);
    expect(segments[0].firstAssetIndex, 0);
    expect(segments[0].startOffset, 0);
    expect(segments[0].endOffset, kTimelineOverviewSegmentExtent);
    expect(segments[0].header, HeaderType.year);
    expect(segments[1].firstIndex, 1);
    expect(segments[1].firstAssetIndex, 5);
    expect(segments[1].startOffset, kTimelineOverviewSegmentExtent);
    expect(segments[1].endOffset, kTimelineOverviewSegmentExtent * 2);
    expect(segments.last.indexToLayoutOffset(segments.last.lastIndex + 1), segments.last.endOffset);
  });

  test('month overview uses month headers and keeps one child per bucket', () {
    final segments = TimelineOverviewSegmentBuilder(
      buckets: [TimeBucket(date: DateTime(2025, 3), assetCount: 4)],
      mode: TimelineOverviewMode.months,
    ).generate();

    expect(segments.single.firstIndex, 0);
    expect(segments.single.lastIndex, 0);
    expect(segments.single.header, HeaderType.month);
    expect(segments.single.getMinChildIndexForScrollOffset(20), 0);
    expect(segments.single.getMaxChildIndexForScrollOffset(120), 0);
    expect(segments.single.indexToLayoutOffset(0), 0);
    expect(segments.single.indexToLayoutOffset(segments.single.lastIndex + 1), segments.single.endOffset);
  });

  test('builder rejects the all mode', () {
    expect(
      () => TimelineOverviewSegmentBuilder(
        buckets: [TimeBucket(date: DateTime(2025), assetCount: 1)],
        mode: TimelineOverviewMode.all,
      ).generate(),
      throwsArgumentError,
    );
  });

  testWidgets('segment builder loads and renders a representative thumbnail from the timeline service', (tester) async {
    final requestedLoads = <({int offset, int count})>[];
    final initialLoad = Completer<List<BaseAsset>>();
    final representativeAsset = TestUtils.createRemoteAsset(id: 'asset-5', width: 200, height: 100);
    final timelineService = TimelineService((
      bucketSource: () => Stream.value([
        TimeBucket(date: DateTime(2025), assetCount: 5),
        TimeBucket(date: DateTime(2024), assetCount: 1),
      ]),
      assetSource: (offset, count) {
        requestedLoads.add((offset: offset, count: count));
        return initialLoad.future;
      },
      origin: TimelineOrigin.main,
    ));
    addTearDown(timelineService.dispose);

    final segment = TimelineOverviewSegment(
      firstIndex: 1,
      lastIndex: 1,
      startOffset: kTimelineOverviewSegmentExtent,
      endOffset: kTimelineOverviewSegmentExtent * 2,
      firstAssetIndex: 5,
      bucket: TimeBucket(date: DateTime(2024), assetCount: 1),
      mode: TimelineOverviewMode.years,
      header: HeaderType.year,
    );

    await tester.pumpWidget(
      EasyLocalization(
        supportedLocales: const [Locale('en')],
        path: '../i18n',
        fallbackLocale: const Locale('en'),
        child: ProviderScope(
          overrides: [timelineServiceProvider.overrideWithValue(timelineService)],
          child: MaterialApp(
            home: Scaffold(body: Builder(builder: (context) => segment.builder(context, segment.firstIndex))),
          ),
        ),
      ),
    );

    await tester.pump();

    expect(find.byKey(const ValueKey('timeline-overview-card-fallback')), findsOneWidget);
    expect(find.text('2024'), findsOneWidget);
    expect(find.text('1 photo'), findsOneWidget);

    initialLoad.complete([
      for (var index = 0; index < 5; index++) TestUtils.createRemoteAsset(id: 'asset-$index'),
      representativeAsset,
    ]);
    await tester.pumpAndSettle();

    expect(requestedLoads, [(offset: 0, count: kTimelineAssetLoadBatchSize)]);
    expect(find.byType(Thumbnail), findsOneWidget);
    expect(find.text('2024'), findsOneWidget);
    expect(find.text('1 photo'), findsOneWidget);
  });

  testWidgets('passes overview drilldown handler to rendered card when override exists', (tester) async {
    final tapped = <({DateTime date, TimelineOverviewMode mode})>[];
    final representativeAsset = TestUtils.createRemoteAsset(id: 'asset-0');
    final timelineService = TimelineService((
      bucketSource: () => Stream.value([TimeBucket(date: DateTime(2025), assetCount: 1)]),
      assetSource: (_, _) async => [representativeAsset],
      origin: TimelineOrigin.main,
    ));
    addTearDown(timelineService.dispose);

    final segment = TimelineOverviewSegment(
      firstIndex: 0,
      lastIndex: 0,
      startOffset: 0,
      endOffset: kTimelineOverviewSegmentExtent,
      firstAssetIndex: 0,
      bucket: TimeBucket(date: DateTime(2025), assetCount: 1),
      mode: TimelineOverviewMode.years,
      header: HeaderType.year,
    );

    await tester.pumpWidget(
      EasyLocalization(
        supportedLocales: const [Locale('en')],
        path: '../i18n',
        fallbackLocale: const Locale('en'),
        child: ProviderScope(
          overrides: [
            timelineServiceProvider.overrideWithValue(timelineService),
            timelineOverviewDrilldownProvider.overrideWithValue((bucket, mode) async {
              tapped.add((date: bucket.date, mode: mode));
            }),
          ],
          child: MaterialApp(
            home: Scaffold(body: Builder(builder: (context) => segment.builder(context, segment.firstIndex))),
          ),
        ),
      ),
    );

    await tester.pumpAndSettle();
    await tester.tap(find.byType(TimelineOverviewCard));
    await tester.pump();

    expect(tapped, [(date: DateTime(2025), mode: TimelineOverviewMode.years)]);
  });

  testWidgets('leaves rendered card onTap null without overview drilldown handler', (tester) async {
    final representativeAsset = TestUtils.createRemoteAsset(id: 'asset-0');
    final timelineService = TimelineService((
      bucketSource: () => Stream.value([TimeBucket(date: DateTime(2025), assetCount: 1)]),
      assetSource: (_, _) async => [representativeAsset],
      origin: TimelineOrigin.main,
    ));
    addTearDown(timelineService.dispose);

    final segment = TimelineOverviewSegment(
      firstIndex: 0,
      lastIndex: 0,
      startOffset: 0,
      endOffset: kTimelineOverviewSegmentExtent,
      firstAssetIndex: 0,
      bucket: TimeBucket(date: DateTime(2025), assetCount: 1),
      mode: TimelineOverviewMode.years,
      header: HeaderType.year,
    );

    await tester.pumpWidget(
      EasyLocalization(
        supportedLocales: const [Locale('en')],
        path: '../i18n',
        fallbackLocale: const Locale('en'),
        child: ProviderScope(
          overrides: [timelineServiceProvider.overrideWithValue(timelineService)],
          child: MaterialApp(
            home: Scaffold(body: Builder(builder: (context) => segment.builder(context, segment.firstIndex))),
          ),
        ),
      ),
    );

    await tester.pumpAndSettle();

    final card = tester.widget<TimelineOverviewCard>(find.byType(TimelineOverviewCard));
    expect(card.onTap, isNull);
  });

  testWidgets('leaves zero-count overview card onTap null even with drilldown handler override', (tester) async {
    final tapped = <({DateTime date, TimelineOverviewMode mode})>[];
    final timelineService = TimelineService((
      bucketSource: () => Stream.value([TimeBucket(date: DateTime(2025), assetCount: 0)]),
      assetSource: (_, _) async => const <BaseAsset>[],
      origin: TimelineOrigin.main,
    ));
    addTearDown(timelineService.dispose);

    final segment = TimelineOverviewSegment(
      firstIndex: 0,
      lastIndex: 0,
      startOffset: 0,
      endOffset: kTimelineOverviewSegmentExtent,
      firstAssetIndex: 0,
      bucket: TimeBucket(date: DateTime(2025), assetCount: 0),
      mode: TimelineOverviewMode.years,
      header: HeaderType.year,
    );

    await tester.pumpWidget(
      EasyLocalization(
        supportedLocales: const [Locale('en')],
        path: '../i18n',
        fallbackLocale: const Locale('en'),
        child: ProviderScope(
          overrides: [
            timelineServiceProvider.overrideWithValue(timelineService),
            timelineOverviewDrilldownProvider.overrideWithValue((bucket, mode) async {
              tapped.add((date: bucket.date, mode: mode));
            }),
          ],
          child: MaterialApp(
            home: Scaffold(body: Builder(builder: (context) => segment.builder(context, segment.firstIndex))),
          ),
        ),
      ),
    );

    await tester.pumpAndSettle();

    final card = tester.widget<TimelineOverviewCard>(find.byType(TimelineOverviewCard));
    expect(card.onTap, isNull);

    await tester.tap(find.byType(TimelineOverviewCard));
    await tester.pump();

    expect(tapped, isEmpty);
  });

  // ---------------------------------------------------------------------------
  // Cache-based tests (Bug A regression guards)
  // ---------------------------------------------------------------------------

  Widget wrapWithScope(Widget child, {required TimelineService timelineService, List<Override> overrides = const []}) {
    return EasyLocalization(
      supportedLocales: const [Locale('en')],
      path: '../i18n',
      fallbackLocale: const Locale('en'),
      child: ProviderScope(
        overrides: [
          timelineServiceProvider.overrideWithValue(timelineService),
          timelineOverviewRepresentativeCacheProvider.overrideWith(TimelineOverviewRepresentativeCacheNotifier.new),
          ...overrides,
        ],
        child: MaterialApp(
          home: Scaffold(body: Center(child: child)),
        ),
      ),
    );
  }

  testWidgets('card shows Thumbnail from cache even when buffer no longer covers firstAssetIndex', (tester) async {
    // Bug A regression guard:
    // 1. Pre-populate the cache with a representative for index 0.
    // 2. Move the buffer far away (evicts index 0).
    // 3. Replace the asset source with one that never resolves (so a FutureBuilder fallback
    //    would stay gray forever).
    // 4. Force a widget rebuild via setState — with the cache it shows the Thumbnail
    //    immediately; without the cache it shows the gray fallback.
    final representativeAsset = TestUtils.createRemoteAsset(id: 'representative', width: 200, height: 100);
    final neverCompleter = Completer<List<BaseAsset>>();
    var useNeverCompleter = false;

    final pool = List.generate(2000, (i) => i == 0 ? representativeAsset : TestUtils.createRemoteAsset(id: 'asset-$i'));
    final timelineService = TimelineService((
      bucketSource: () => Stream.value([TimeBucket(date: DateTime(2025), assetCount: pool.length)]),
      assetSource: (offset, count) async {
        if (useNeverCompleter) {
          return neverCompleter.future;
        }
        final end = (offset + count).clamp(0, pool.length);
        final start = offset.clamp(0, end);
        return pool.sublist(start, end);
      },
      origin: TimelineOrigin.main,
    ));
    addTearDown(timelineService.dispose);

    final segment = TimelineOverviewSegment(
      firstIndex: 0,
      lastIndex: 0,
      startOffset: 0,
      endOffset: kTimelineOverviewSegmentExtent,
      firstAssetIndex: 0,
      bucket: TimeBucket(date: DateTime(2025), assetCount: pool.length),
      mode: TimelineOverviewMode.years,
      header: HeaderType.year,
    );

    // Use a StatefulBuilder so we can force a rebuild.
    late StateSetter forceRebuild;
    await tester.pumpWidget(
      wrapWithScope(
        StatefulBuilder(
          builder: (ctx, setState) {
            forceRebuild = setState;
            return segment.builder(ctx, segment.firstIndex);
          },
        ),
        timelineService: timelineService,
      ),
    );
    // Let the post-frame callback fire and ensure() resolve.
    await tester.pumpAndSettle();

    // Cache populated: card must show the thumbnail.
    expect(find.byType(Thumbnail), findsOneWidget);

    // Move the buffer far away (evicts index 0 — index 1500 is beyond the initial 1024-asset
    // buffer window so this forces a reload that evicts index 0) and switch to the
    // never-resolving source for subsequent loads.
    await timelineService.loadAssets(1500, 1);
    useNeverCompleter = true;

    // Trigger a rebuild (simulates a TimelineReloadEvent → setState).
    forceRebuild(() {});
    await tester.pump();

    // Must still show the thumbnail — cache hit, not the gray fallback from a FutureBuilder.
    expect(find.byType(Thumbnail), findsOneWidget);
    expect(find.byKey(const ValueKey('timeline-overview-card-fallback')), findsNothing);
  });

  testWidgets('uncached bucket shows fallback and schedules ensure on first build', (tester) async {
    final asset = TestUtils.createRemoteAsset(id: 'asset-0', width: 200, height: 100);
    // Delay the asset source resolution so we can observe the fallback state.
    final assetCompleter = Completer<List<BaseAsset>>();
    final timelineService = TimelineService((
      bucketSource: () => Stream.value([TimeBucket(date: DateTime(2025), assetCount: 1)]),
      assetSource: (_, _) async => assetCompleter.future,
      origin: TimelineOrigin.main,
    ));
    addTearDown(timelineService.dispose);

    final segment = TimelineOverviewSegment(
      firstIndex: 0,
      lastIndex: 0,
      startOffset: 0,
      endOffset: kTimelineOverviewSegmentExtent,
      firstAssetIndex: 0,
      bucket: TimeBucket(date: DateTime(2025), assetCount: 1),
      mode: TimelineOverviewMode.years,
      header: HeaderType.year,
    );

    await tester.pumpWidget(
      wrapWithScope(
        Builder(builder: (ctx) => segment.builder(ctx, segment.firstIndex)),
        timelineService: timelineService,
      ),
    );
    await tester.pump(); // first frame + post-frame callback

    // While loading: fallback is shown.
    expect(find.byKey(const ValueKey('timeline-overview-card-fallback')), findsOneWidget);
    expect(find.byType(Thumbnail), findsNothing);

    // Complete the load — cache is populated, card rebuilds to show thumbnail.
    assetCompleter.complete([asset]);
    await tester.pumpAndSettle();

    expect(find.byType(Thumbnail), findsOneWidget);
    expect(find.byKey(const ValueKey('timeline-overview-card-fallback')), findsNothing);
  });

  testWidgets('zero-count bucket shows fallback and does not schedule ensure', (tester) async {
    var assetSourceCallCount = 0;
    final timelineService = TimelineService((
      bucketSource: () => Stream.value([TimeBucket(date: DateTime(2025), assetCount: 0)]),
      assetSource: (_, _) async {
        assetSourceCallCount++;
        return const <BaseAsset>[];
      },
      origin: TimelineOrigin.main,
    ));
    addTearDown(timelineService.dispose);

    final segment = TimelineOverviewSegment(
      firstIndex: 0,
      lastIndex: 0,
      startOffset: 0,
      endOffset: kTimelineOverviewSegmentExtent,
      firstAssetIndex: 0,
      bucket: TimeBucket(date: DateTime(2025), assetCount: 0),
      mode: TimelineOverviewMode.years,
      header: HeaderType.year,
    );

    await tester.pumpWidget(
      wrapWithScope(
        Builder(builder: (ctx) => segment.builder(ctx, segment.firstIndex)),
        timelineService: timelineService,
      ),
    );
    await tester.pumpAndSettle();

    // Zero-count bucket: fallback shown, no ensure scheduled (assetSourceCallCount stays at 0
    // since the bucket stream also has assetCount:0 so the service loads no assets).
    expect(find.byKey(const ValueKey('timeline-overview-card-fallback')), findsOneWidget);
    expect(find.byType(Thumbnail), findsNothing);
    // The cache should have no entry for this bucket.
    expect(assetSourceCallCount, 0);
  });
}
