// Adapter: builds a TimelineService whose asset buffer is fed by
// SearchService.search(filter, 1). Page-1 only — pagination deferred to
// PR 1.2.1 (design §10.3).

import 'dart:async';

import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/services/search.service.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';

/// Builds a [TimelineService] configured to render the first page of
/// `SearchService.search(filter, 1)` results.
///
/// The returned service:
///   * exposes the search-result buffer synchronously via a getter closure
///     (per `TimelineFactory.fromAssetStream` contract).
///   * emits on the count stream exactly once after the search future
///     resolves (or 0 if the future returns null/throws), then closes the
///     stream so no resources leak if the consumer never subscribes.
TimelineService buildPhotosFilterSearchTimeline({
  required TimelineFactory factory,
  required SearchService search,
  required SearchFilter filter,
}) {
  final buffer = <BaseAsset>[];
  final countCtrl = StreamController<int>.broadcast();

  // Fire the search asynchronously. Errors are already logged by SearchService;
  // we just end up with an empty buffer + zero emit.
  unawaited(() async {
    try {
      final result = await search.search(filter, 1);
      buffer
        ..clear()
        ..addAll(result?.assets ?? const <BaseAsset>[]);
    } catch (_) {
      // SearchService already logs; keep buffer empty.
    }
    if (!countCtrl.isClosed) {
      countCtrl.add(buffer.length);
      await countCtrl.close();
    }
  }());

  return factory.fromAssetStream(() => List<BaseAsset>.unmodifiable(buffer), countCtrl.stream, TimelineOrigin.search);
}
