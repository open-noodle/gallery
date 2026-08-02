import 'package:collection/collection.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/timeline_grouping.model.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';

class TimelineOverviewRepresentative {
  const TimelineOverviewRepresentative({required this.asset, required this.assetCount});

  final BaseAsset asset;
  final int assetCount;
}

class TimelineOverviewRepresentativeCacheNotifier extends Notifier<Map<String, TimelineOverviewRepresentative>> {
  final Set<String> _inFlight = <String>{};

  /// Bumped on every cache reset (service change). An in-flight [ensure] captures the generation
  /// it started under and drops its result if the cache was reset meanwhile, so a resolve started
  /// against a previous service can never write an entry under the new one.
  int _generation = 0;

  /// Cache key for a bucket. `mode` is part of the key so a year and a month bucket that share
  /// the same date (e.g. 2024-01-01) don't collide. Shared with the card and tests to avoid drift.
  static String keyFor(TimelineOverviewMode mode, DateTime date) => '${mode.name}:${date.toIso8601String()}';

  @override
  Map<String, TimelineOverviewRepresentative> build() {
    // Reset the cache whenever the service instance changes — filter / scope / grouping
    // change — so we never show a cover resolved under a previous service. A dependency-driven
    // rebuild (`watch` + fresh map) rather than `listen` + `state = {}` is what makes this safe
    // when the change lands mid-build: imperatively mutating the provider from a listener that
    // fires during a widget build throws ("modify a provider while building").
    ref.watch(timelineServiceProvider);
    _inFlight.clear();
    _generation++;
    return const {};
  }

  BaseAsset? assetFor(String key) => state[key]?.asset;

  /// Resolve and cache the representative for [key] (bucket's first asset at [index]).
  /// Deduped per key; no-op if already cached at the same [assetCount]. Call from a
  /// post-frame callback (never during build — it mutates provider state).
  Future<void> ensure(String key, int index, int assetCount) async {
    final existing = state[key];
    if (existing != null && existing.assetCount == assetCount) return; // fresh
    // Skip if a resolve is already running for this key. A count-change that arrives mid-resolve is
    // picked up by the next frame's re-scheduled ensure (the stale-but-plausible cover stays painted
    // meanwhile) rather than being applied immediately.
    if (_inFlight.contains(key)) return;
    _inFlight.add(key);
    final generation = _generation;
    try {
      final service = ref.read(timelineServiceProvider);
      final assets = service.hasRange(index, 1) ? service.getAssets(index, 1) : await service.loadAssets(index, 1);
      final asset = assets.firstOrNull;
      // Drop the result if the cache was reset (service changed) while resolving, so a cover
      // resolved under the previous service never lands under the new one. A null asset
      // (loadAssets returned nothing) is left uncached so a later rebuild retries.
      if (asset != null && _generation == generation) {
        state = {...state, key: TimelineOverviewRepresentative(asset: asset, assetCount: assetCount)};
      }
    } catch (_) {
      // leave uncached; a later rebuild retries
    } finally {
      _inFlight.remove(key);
    }
  }
}

final timelineOverviewRepresentativeCacheProvider =
    NotifierProvider<TimelineOverviewRepresentativeCacheNotifier, Map<String, TimelineOverviewRepresentative>>(
      TimelineOverviewRepresentativeCacheNotifier.new,
    );
