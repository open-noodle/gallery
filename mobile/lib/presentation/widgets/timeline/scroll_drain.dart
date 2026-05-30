/// What the timeline should do this frame with a pending "view in timeline"
/// scroll request.
enum ScrollDrainAction {
  /// No pending request.
  idle,

  /// Ready: a matching segment exists and the scroll view is laid out — scroll
  /// to it and consume the request.
  scroll,

  /// Not ready yet (segments still loading, scroll view not laid out, or no
  /// matching segment) — try again next frame.
  retry,

  /// The attempt budget is exhausted — consume the request and stop, so a stale
  /// request cannot leak into a later timeline.
  giveUp,
}

/// Decides what to do with a latched scroll-to-date request on a single frame.
///
/// The request is only applied (and consumed) once the timeline can actually
/// honour it: its segments are loaded, its scroll view is attached and laid out
/// (so `maxScrollExtent` is real rather than ~0), and a segment matches the
/// target date. Until then it keeps retrying — this is what makes the scroll
/// survive the timeline being reloaded fresh by the navigation, where the scroll
/// view is not laid out for several frames after the segments arrive.
ScrollDrainAction decideScrollDrain({
  required bool hasPending,
  required bool segmentsLoaded,
  required bool laidOut,
  required bool segmentMatched,
  required int attempts,
  required int maxAttempts,
}) {
  if (!hasPending) return ScrollDrainAction.idle;
  if (segmentsLoaded && laidOut && segmentMatched) return ScrollDrainAction.scroll;
  if (attempts >= maxAttempts) return ScrollDrainAction.giveUp;
  return ScrollDrainAction.retry;
}

/// Finds the index of the timeline segment to scroll to for [target].
///
/// [segmentDates] holds each segment's bucket date (or null for segments that
/// are not time buckets). Prefers an exact day match; falls back to the first
/// segment in the same month — timeline buckets are typically monthly (their
/// date is the first of the month), so the month fallback is what usually
/// matches an asset taken mid-month. Returns null when nothing matches.
int? findMatchingSegmentIndex(List<DateTime?> segmentDates, DateTime target) {
  for (var i = 0; i < segmentDates.length; i++) {
    final d = segmentDates[i];
    if (d != null && d.year == target.year && d.month == target.month && d.day == target.day) {
      return i;
    }
  }
  for (var i = 0; i < segmentDates.length; i++) {
    final d = segmentDates[i];
    if (d != null && d.year == target.year && d.month == target.month) {
      return i;
    }
  }
  return null;
}
