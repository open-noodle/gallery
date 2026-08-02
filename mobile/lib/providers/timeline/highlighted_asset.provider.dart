import 'dart:async';

import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';

/// How long the arrival highlight stays on the tile after a "view in timeline" jump.
const Duration kTimelineHighlightDuration = Duration(milliseconds: 1500);

/// Whether [candidate] is the currently highlighted asset.
///
/// Uses `refersToSameAsset` rather than `==`: the grid's copy of an asset and the
/// copy that requested the jump can differ in `localId`, which `RemoteAsset`
/// includes in `hashCode` but not in `==`.
bool isHighlightedAsset(BaseAsset? highlighted, BaseAsset candidate) =>
    highlighted != null && highlighted.refersToSameAsset(candidate);

/// The asset to briefly outline after the timeline jumps to it, or null.
class TimelineHighlightedAssetNotifier extends Notifier<BaseAsset?> {
  Timer? _timer;

  @override
  BaseAsset? build() {
    ref.onDispose(() {
      _timer?.cancel();
      _timer = null;
    });
    return null;
  }

  void highlight(BaseAsset asset, {Duration duration = kTimelineHighlightDuration}) {
    _timer?.cancel();
    state = asset;
    _timer = Timer(duration, () {
      _timer = null;
      state = null;
    });
  }

  void clear() {
    _timer?.cancel();
    _timer = null;
    state = null;
  }
}

final timelineHighlightedAssetProvider = NotifierProvider<TimelineHighlightedAssetNotifier, BaseAsset?>(
  TimelineHighlightedAssetNotifier.new,
);
