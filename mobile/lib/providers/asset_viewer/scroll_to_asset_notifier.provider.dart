import 'package:flutter/material.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';

/// A pending "view in timeline" request: which asset, and the local date the
/// timeline buckets it under.
@immutable
class TimelineScrollTarget {
  final BaseAsset asset;

  /// The asset's creation time in the viewer's local zone. The timeline buckets by
  /// local date, so a UTC instant would match the wrong segment (#28941).
  final DateTime date;

  /// The space whose timeline must honour this request, or null for the personal
  /// timeline. A Space timeline is pushed OVER the main one, which stays mounted and
  /// listening, so without a scope whichever is laid out first consumes the request —
  /// and for a Space photo that is the main timeline, which lands on the right day with
  /// nothing to show (#1047).
  final String? spaceId;

  const TimelineScrollTarget({required this.asset, required this.date, this.spaceId});

  @override
  bool operator ==(Object other) =>
      other is TimelineScrollTarget &&
      date == other.date &&
      spaceId == other.spaceId &&
      asset.refersToSameAsset(other.asset);

  // Only `date` participates: `==` compares assets by identity rather than by
  // field equality (two copies of one asset can differ in localId), and equal
  // targets always share a date — spaceId included, since equality only narrows
  // which targets match. Hashing on date alone keeps the contract intact.
  @override
  int get hashCode => date.hashCode;
}

final scrollToAssetNotifierProvider = ScrollToAssetNotifier(null);

/// Holds a pending request to scroll the timeline to a given asset.
///
/// Unlike a fire-and-forget broadcast event, the request is latched here until a
/// timeline is ready to act on it. This survives the window between requesting the
/// scroll (tapping "view in timeline" from a memory or a notification) and the
/// timeline mounting and loading its segments. The timeline drains the request
/// with [consume] once it can scroll.
class ScrollToAssetNotifier extends ValueNotifier<TimelineScrollTarget?> {
  ScrollToAssetNotifier(super.value);

  /// Requests a scroll to [asset] on the timeline of [spaceId] (or the personal
  /// timeline when it is null). Always notifies listeners, even when the same asset is
  /// requested twice in a row, so repeated taps re-trigger the scroll.
  void scrollToAsset(BaseAsset asset, {String? spaceId}) {
    final target = TimelineScrollTarget(asset: asset, date: asset.createdAt.toLocal(), spaceId: spaceId);
    if (value == target) {
      notifyListeners();
    } else {
      value = target;
    }
  }

  /// Returns the pending target (or null) and clears the latch so the request is
  /// applied at most once.
  TimelineScrollTarget? consume() {
    final pending = value;
    value = null;
    return pending;
  }
}
