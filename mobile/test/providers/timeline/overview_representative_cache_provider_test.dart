import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/timeline/overview_representative_cache.provider.dart';

import '../../test_utils.dart';

// A tiny indexed asset list for use as the fake asset source. Returns up to [count]
// assets starting at [offset], where asset-N has id 'asset-N'. Silently clamps to
// the provided pool size so tests don't need to worry about exact batch sizes.
List<BaseAsset> _indexedAssets(List<BaseAsset> pool, int offset, int count) {
  final end = (offset + count).clamp(0, pool.length);
  final start = offset.clamp(0, end);
  return pool.sublist(start, end);
}

/// Lets the Dart event loop process pending microtasks and timer callbacks so that the
/// TimelineService's bucket-stream subscription (which fires as a microtask from
/// Stream.value.listen) and its initial assetSource load complete before the caller
/// interacts with the cache notifier. In production this is never an issue because
/// addPostFrameCallback fires after the first frame, by which time the subscription
/// has already settled.
Future<void> _pumpBucketStream() async {
  await Future<void>.delayed(Duration.zero);
  await Future<void>.delayed(Duration.zero);
}

/// Builds a ProviderContainer with a fake TimelineService backed by [pool].
/// The pool is indexed: asset at position N can be fetched at index N.
ProviderContainer _containerFor(List<BaseAsset> pool, {List<TimeBucket>? buckets}) {
  final service = TimelineService((
    assetSource: (offset, count) async => _indexedAssets(pool, offset, count),
    bucketSource: () => Stream.value(buckets ?? [TimeBucket(date: DateTime(2025), assetCount: pool.length)]),
    origin: TimelineOrigin.main,
  ));
  final container = ProviderContainer(
    overrides: [
      timelineServiceProvider.overrideWithValue(service),
      timelineOverviewRepresentativeCacheProvider.overrideWith(TimelineOverviewRepresentativeCacheNotifier.new),
    ],
  );
  addTearDown(() async {
    container.dispose();
    await service.dispose();
  });
  return container;
}

void main() {
  // ---------------------------------------------------------------------------
  // 1. ensure() stores the representative and assetFor() returns it
  // ---------------------------------------------------------------------------
  test('ensure stores the representative and assetFor returns it', () async {
    final asset0 = TestUtils.createRemoteAsset(id: 'asset-0');
    final pool = [asset0, TestUtils.createRemoteAsset(id: 'asset-1'), TestUtils.createRemoteAsset(id: 'asset-2')];
    final container = _containerFor(pool);
    await _pumpBucketStream(); // let bucket subscription settle

    final notifier = container.read(timelineOverviewRepresentativeCacheProvider.notifier);
    await notifier.ensure('year:2025-01-01T00:00:00.000', 0, pool.length);

    expect(notifier.assetFor('year:2025-01-01T00:00:00.000'), same(asset0));
  });

  // ---------------------------------------------------------------------------
  // 2. Bug guard: cached asset survives buffer movement
  //    After caching index 0, load far-away index 1000 (slides the buffer away).
  //    assetFor() must still return the cached asset — it does not re-fetch from
  //    the current buffer state.
  // ---------------------------------------------------------------------------
  test('cached representative survives buffer movement', () async {
    // Create a large enough pool so both index 0 and index 1000 are valid.
    final pool = List.generate(1500, (i) => TestUtils.createRemoteAsset(id: 'asset-$i'));
    final container = _containerFor(pool);
    await _pumpBucketStream();

    final service = container.read(timelineServiceProvider);
    final notifier = container.read(timelineOverviewRepresentativeCacheProvider.notifier);
    final asset0 = pool[0];

    // Resolve representative for index 0.
    await notifier.ensure('year:2025-01-01T00:00:00.000', 0, pool.length);
    expect(notifier.assetFor('year:2025-01-01T00:00:00.000'), same(asset0));

    // Move the buffer far away (slides the window off index 0).
    await service.loadAssets(1000, 1);

    // Cache must still hold the previously resolved asset — independent of buffer state.
    expect(notifier.assetFor('year:2025-01-01T00:00:00.000'), same(asset0));
  });

  // ---------------------------------------------------------------------------
  // 3. Dedupe: two concurrent ensure() calls issue only one resolve
  // ---------------------------------------------------------------------------
  test('concurrent ensure calls deduplicate the resolve', () async {
    var callCount = 0;
    final asset = TestUtils.createRemoteAsset(id: 'asset-0');
    final pool = [asset];
    final service = TimelineService((
      assetSource: (offset, count) async {
        callCount++;
        return _indexedAssets(pool, offset, count);
      },
      bucketSource: () => Stream.value([TimeBucket(date: DateTime(2025), assetCount: pool.length)]),
      origin: TimelineOrigin.main,
    ));
    final container = ProviderContainer(
      overrides: [
        timelineServiceProvider.overrideWithValue(service),
        timelineOverviewRepresentativeCacheProvider.overrideWith(TimelineOverviewRepresentativeCacheNotifier.new),
      ],
    );
    addTearDown(() async {
      container.dispose();
      await service.dispose();
    });
    await _pumpBucketStream(); // let the initial bucket load complete (callCount=1)

    final countAfterBucketLoad = callCount; // 1 from the initial bucket subscription load

    final notifier = container.read(timelineOverviewRepresentativeCacheProvider.notifier);
    // First call: key is not in-flight yet → starts resolving.
    final f1 = notifier.ensure('year:2025-01-01T00:00:00.000', 0, pool.length);
    // Second call: key is already in-flight → no-op (deduped).
    final f2 = notifier.ensure('year:2025-01-01T00:00:00.000', 0, pool.length);

    await f1;
    await f2;

    // Only the original bucket-load callCount plus ONE ensure resolve (not two).
    // hasRange is true (bucket already loaded), so no extra assetSource call.
    expect(callCount, countAfterBucketLoad);
    expect(notifier.assetFor('year:2025-01-01T00:00:00.000'), same(asset));
  });

  // ---------------------------------------------------------------------------
  // 4. Count-change: re-resolves and updates stored assetCount
  //    (The representative may be the same if the buffer hasn't moved, but the
  //    assetCount in the stored entry must be updated and the call must not be a no-op.)
  // ---------------------------------------------------------------------------
  test('count change triggers re-resolve and updates stored assetCount', () async {
    var resolveCount = 0;
    final asset = TestUtils.createRemoteAsset(id: 'the-asset');
    final pool = [asset];
    final service = TimelineService((
      assetSource: (offset, count) async {
        resolveCount++;
        return _indexedAssets(pool, offset, count);
      },
      bucketSource: () => Stream.value([TimeBucket(date: DateTime(2025), assetCount: pool.length)]),
      origin: TimelineOrigin.main,
    ));
    final container = ProviderContainer(
      overrides: [
        timelineServiceProvider.overrideWithValue(service),
        timelineOverviewRepresentativeCacheProvider.overrideWith(TimelineOverviewRepresentativeCacheNotifier.new),
      ],
    );
    addTearDown(() async {
      container.dispose();
      await service.dispose();
    });
    await _pumpBucketStream(); // initial bucket load fires (resolveCount=1)

    final notifier = container.read(timelineOverviewRepresentativeCacheProvider.notifier);
    const key = 'year:2025-01-01T00:00:00.000';

    // Initial resolve with count 9. Buffer is hot so no extra assetSource call.
    await notifier.ensure(key, 0, 9);
    final entry9 = container.read(timelineOverviewRepresentativeCacheProvider)[key];
    expect(entry9?.assetCount, 9);
    expect(entry9?.asset, same(asset));

    // Same count → no-op.
    final countBeforeNoOp = resolveCount;
    await notifier.ensure(key, 0, 9);
    expect(resolveCount, countBeforeNoOp);

    // Different count → re-resolve; assetCount must be updated.
    await notifier.ensure(key, 0, 12);
    final entry12 = container.read(timelineOverviewRepresentativeCacheProvider)[key];
    expect(entry12?.assetCount, 12);
    expect(entry12?.asset, same(asset)); // same asset (buffer still has it)
  });

  // ---------------------------------------------------------------------------
  // 5. Key isolation: year:2024 vs month:2024 don't collide
  // ---------------------------------------------------------------------------
  test('year and month keys for the same date do not collide', () async {
    final yearAsset = TestUtils.createRemoteAsset(id: 'year-asset');
    final monthAsset = TestUtils.createRemoteAsset(id: 'month-asset');

    // Two buckets: year bucket has 1 asset (index 0), month bucket has 1 asset (index 1).
    final pool = [yearAsset, monthAsset];
    final container = _containerFor(
      pool,
      buckets: [
        TimeBucket(date: DateTime(2024), assetCount: 1),
        TimeBucket(date: DateTime(2024, 1), assetCount: 1),
      ],
    );
    await _pumpBucketStream();

    final notifier = container.read(timelineOverviewRepresentativeCacheProvider.notifier);
    await notifier.ensure('year:2024-01-01T00:00:00.000', 0, 1);
    await notifier.ensure('month:2024-01-01T00:00:00.000', 1, 1);

    expect(notifier.assetFor('year:2024-01-01T00:00:00.000'), same(yearAsset));
    expect(notifier.assetFor('month:2024-01-01T00:00:00.000'), same(monthAsset));
  });

  // ---------------------------------------------------------------------------
  // 6. Invalidation: swapping timelineServiceProvider clears the cache
  // ---------------------------------------------------------------------------
  test('cache clears when the service instance changes', () async {
    final asset = TestUtils.createRemoteAsset(id: 'cached-asset');

    // Use a StateProvider to make the "current service" swappable at runtime.
    final serviceSwitch = StateProvider<TimelineService?>((ref) => null);

    final service1 = TimelineService((
      assetSource: (_, _) async => [asset],
      bucketSource: () => Stream.value([TimeBucket(date: DateTime(2025), assetCount: 1)]),
      origin: TimelineOrigin.main,
    ));
    final service2 = TimelineService((
      assetSource: (_, _) async => [],
      bucketSource: () => Stream.value([TimeBucket(date: DateTime(2025), assetCount: 0)]),
      origin: TimelineOrigin.main,
    ));
    addTearDown(() async {
      await service1.dispose();
      await service2.dispose();
    });

    final container = ProviderContainer(
      overrides: [
        timelineServiceProvider.overrideWith((ref) {
          final s = ref.watch(serviceSwitch);
          if (s == null) throw StateError('no service');
          return s;
        }),
        timelineOverviewRepresentativeCacheProvider.overrideWith(TimelineOverviewRepresentativeCacheNotifier.new),
      ],
    );
    addTearDown(container.dispose);

    // Initialise with service1 and force the provider graph to evaluate.
    container.read(serviceSwitch.notifier).state = service1;
    await _pumpBucketStream();
    container.read(timelineServiceProvider);

    final notifier = container.read(timelineOverviewRepresentativeCacheProvider.notifier);
    await notifier.ensure('year:2025-01-01T00:00:00.000', 0, 1);
    expect(notifier.assetFor('year:2025-01-01T00:00:00.000'), same(asset));

    // Swap to a different service instance (simulates a filter change).
    container.read(serviceSwitch.notifier).state = service2;
    // Pump microtasks so the Riverpod scheduler re-runs build() (it watches timelineServiceProvider)
    // and returns the cleared map.
    await Future<void>.delayed(Duration.zero);

    expect(notifier.assetFor('year:2025-01-01T00:00:00.000'), isNull);
  });

  // ---------------------------------------------------------------------------
  // 7. same count does NOT re-resolve (no-op)
  // ---------------------------------------------------------------------------
  test('ensure with unchanged assetCount does not re-resolve', () async {
    var callCount = 0;
    final pool = [TestUtils.createRemoteAsset(id: 'once')];
    final service = TimelineService((
      assetSource: (offset, count) async {
        callCount++;
        return _indexedAssets(pool, offset, count);
      },
      bucketSource: () => Stream.value([TimeBucket(date: DateTime(2025), assetCount: pool.length)]),
      origin: TimelineOrigin.main,
    ));
    final container = ProviderContainer(
      overrides: [
        timelineServiceProvider.overrideWithValue(service),
        timelineOverviewRepresentativeCacheProvider.overrideWith(TimelineOverviewRepresentativeCacheNotifier.new),
      ],
    );
    addTearDown(() async {
      container.dispose();
      await service.dispose();
    });
    await _pumpBucketStream(); // callCount=1 from bucket subscription

    final notifier = container.read(timelineOverviewRepresentativeCacheProvider.notifier);
    // First ensure: buffer is hot (hasRange=true), no extra assetSource call.
    await notifier.ensure('year:2025-01-01T00:00:00.000', 0, pool.length);
    final countAfterFirst = callCount;
    // Second ensure with same count → no-op.
    await notifier.ensure('year:2025-01-01T00:00:00.000', 0, pool.length);

    expect(callCount, countAfterFirst); // no extra call
  });
}
