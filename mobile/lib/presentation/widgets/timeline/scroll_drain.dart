import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/timeline/segment.model.dart';

/// The segments a drain may act on, or null while the timeline is still swapping
/// to a different source.
///
/// `AsyncValue.valueOrNull` keeps serving the PREVIOUS segments while the stream
/// refreshes, which is exactly the window a "view in timeline" jump out of search
/// opens: clearing the Photos filter swaps `timelineServiceProvider`, but the
/// search segments — same dates, same matches — stay visible to the drain for a
/// few frames. Scrolling to one of those moves the timeline being left behind and
/// consumes the request, so the jump never lands (#898). Treat a refreshing stream
/// as not-loaded-yet and let the drain retry until the new segments arrive.
List<Segment>? drainableSegments(AsyncValue<List<Segment>> segments) =>
    segments.isLoading ? null : segments.valueOrNull;

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

  /// The timeline is rendering overview cards, so the target photo has no tile.
  /// Switch the grouping to day and keep retrying until the rebuilt segments arrive.
  switchToDayGrouping,
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
  required bool isOverviewTimeline,
  required int attempts,
  required int maxAttempts,
}) {
  if (!hasPending) {
    return ScrollDrainAction.idle;
  }
  // `scroll` stays ahead of the budget check so a request that becomes ready on the
  // very last frame still scrolls. `!isOverviewTimeline` gates it so an overview
  // timeline can never scroll to a year/month card — the #822 symptom.
  if (segmentsLoaded && laidOut && segmentMatched && !isOverviewTimeline) {
    return ScrollDrainAction.scroll;
  }
  // The budget sits AHEAD of the switch so a grouping write that never lands
  // (pinned by timelineArgs, or a dateless bucket source) cannot spin forever.
  if (attempts >= maxAttempts) {
    return ScrollDrainAction.giveUp;
  }
  if (isOverviewTimeline) {
    return ScrollDrainAction.switchToDayGrouping;
  }
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

/// True when the timeline is rendering year/month overview cards rather than
/// asset tiles — in which case the target photo has no tile to scroll to.
///
/// Deliberately derived from the segments that were actually built, NOT from
/// `timelineGroupingProvider`. `timeline.state.dart` picks the builder from
/// `timelineArgsProvider.groupBy ?? timelineGroupingProvider`, then overrides it
/// to `day` when the bucket source is dateless, and a `TimelineRouteScope` can
/// substitute a route-local grouping notifier. Reading the provider would
/// disagree with the screen in all three cases, and a "switch to day" that
/// changes nothing would spin until the attempt budget expired.
bool segmentsAreOverview(List<Segment>? segments) => segments != null && segments.any((segment) => segment.isOverview);

/// What to do with an in-flight scroll resolution once its async index lookup
/// has completed.
enum ScrollResolveOutcome {
  /// Everything is still valid — scroll.
  proceed,

  /// A newer "view in timeline" request replaced the target mid-flight. Drop this
  /// resolution and let the drain loop pick up the newer one.
  abandonStale,

  /// The timeline went away mid-flight. Touching the scroll controller now would
  /// throw, so do nothing.
  abandonUnmounted,
}

/// Decides whether a resolved scroll target is still safe to act on.
///
/// Unmounting dominates staleness: a dead controller must not be touched even
/// when the target also changed.
ScrollResolveOutcome decideScrollResolve({
  required bool stillMounted,
  required bool stillHasClients,
  required bool targetUnchanged,
}) {
  if (!stillMounted || !stillHasClients) {
    return ScrollResolveOutcome.abandonUnmounted;
  }
  if (!targetUnchanged) {
    return ScrollResolveOutcome.abandonStale;
  }
  return ScrollResolveOutcome.proceed;
}
