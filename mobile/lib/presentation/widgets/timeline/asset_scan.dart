import 'dart:math' as math;

import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';

/// How many assets are pulled from the timeline service per scan read.
const int kAssetScanChunkSize = 250;

/// Hard ceiling on how many assets a single scroll request will scan before
/// giving up and falling back to the segment top.
///
/// `TimelineService.loadAssets` replaces the service's shared buffer, and
/// `_FixedSegmentRow.build` checks `hasRange()` synchronously and falls back to
/// placeholders on a miss. An unbounded scan therefore walks the buffer away from
/// the rows on screen and the timeline visibly flashes placeholders — during
/// exactly the huge-day case this fix is for. The cap bounds that to ~8 reads.
const int kAssetScanCap = 2000;

/// Contiguous `(index, count)` windows covering a segment's assets.
///
/// Yields nothing when [assetCount] is zero or negative. A [chunkSize] below 1 is
/// clamped to 1 rather than trusted — otherwise the sequence would be empty (a
/// silent "not found") or infinite.
Iterable<({int index, int count})> assetScanChunks({
  required int firstAssetIndex,
  required int assetCount,
  int chunkSize = kAssetScanChunkSize,
}) sync* {
  if (assetCount <= 0) {
    return;
  }
  final size = math.max(1, chunkSize);
  for (var scanned = 0; scanned < assetCount; scanned += size) {
    yield (index: firstAssetIndex + scanned, count: math.min(size, assetCount - scanned));
  }
}

/// Loads `count` assets starting at absolute timeline index `index`.
/// Matches `TimelineService.loadAssets`, but injectable so the scan is testable
/// without a service or a database.
typedef AssetRangeLoader = Future<List<BaseAsset>> Function(int index, int count);

/// The absolute timeline index of [target] within a segment, or null when it is
/// absent, beyond [cap], or a read failed.
///
/// Returning null rather than throwing means a transient read error degrades to
/// the caller's fallback scroll instead of breaking the gesture.
Future<int?> findAssetIndex({
  required AssetRangeLoader loadAssets,
  required int firstAssetIndex,
  required int assetCount,
  required BaseAsset target,
  int chunkSize = kAssetScanChunkSize,
  int cap = kAssetScanCap,
}) async {
  final scannable = math.min(assetCount, cap);
  for (final chunk in assetScanChunks(firstAssetIndex: firstAssetIndex, assetCount: scannable, chunkSize: chunkSize)) {
    final List<BaseAsset> assets;
    try {
      assets = await loadAssets(chunk.index, chunk.count);
    } catch (_) {
      return null;
    }
    for (var i = 0; i < assets.length; i++) {
      // Identity, not equality: RemoteAsset.hashCode includes localId while == does
      // not, so the same server asset can compare unequal across two load paths.
      if (assets[i].refersToSameAsset(target)) {
        // Offset from the REQUESTED window, so a short page cannot shift the result.
        return chunk.index + i;
      }
    }
  }
  return null;
}
