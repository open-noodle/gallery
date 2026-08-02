import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/models/timeline_grouping.model.dart';
import 'package:immich_mobile/presentation/widgets/timeline/fixed/segment.model.dart';
import 'package:immich_mobile/presentation/widgets/timeline/overview/overview_segment.model.dart';
import 'package:immich_mobile/presentation/widgets/timeline/scroll_drain.dart';

void main() {
  group('decideScrollDrain', () {
    const maxAttempts = 180;

    ScrollDrainAction decide({
      bool hasPending = true,
      bool segmentsLoaded = true,
      bool laidOut = true,
      bool segmentMatched = true,
      bool isOverviewTimeline = false,
      int attempts = 0,
    }) {
      return decideScrollDrain(
        hasPending: hasPending,
        segmentsLoaded: segmentsLoaded,
        laidOut: laidOut,
        segmentMatched: segmentMatched,
        isOverviewTimeline: isOverviewTimeline,
        attempts: attempts,
        maxAttempts: maxAttempts,
      );
    }

    test('does nothing when there is no pending request', () {
      expect(decide(hasPending: false), ScrollDrainAction.idle);
    });

    test('scrolls only when segments are loaded, laid out, and a segment matches', () {
      expect(decide(), ScrollDrainAction.scroll);
    });

    test('retries instead of scrolling while the scroll view is not laid out yet', () {
      // The regression: a freshly reloaded timeline has its segments loaded but an
      // un-laid-out scroll view for several frames. Scrolling now would clamp the
      // target to maxScrollExtent ~= 0 (the top) and consume the request, so the
      // user lands at the top. The fix waits until the view is laid out.
      expect(decide(laidOut: false), ScrollDrainAction.retry);
    });

    test('retries while segments are still loading', () {
      expect(decide(segmentsLoaded: false), ScrollDrainAction.retry);
    });

    test('retries while no matching segment has appeared yet', () {
      expect(decide(segmentMatched: false), ScrollDrainAction.retry);
    });

    test('keeps retrying right up to the attempt budget', () {
      expect(decide(laidOut: false, attempts: maxAttempts - 1), ScrollDrainAction.retry);
    });

    test('gives up once the attempt budget is exhausted so a stale request cannot leak', () {
      expect(decide(laidOut: false, attempts: maxAttempts), ScrollDrainAction.giveUp);
      expect(decide(segmentMatched: false, attempts: maxAttempts + 5), ScrollDrainAction.giveUp);
    });

    test('a ready request still scrolls even past the budget (never needed to give up)', () {
      expect(decide(attempts: maxAttempts + 5), ScrollDrainAction.scroll);
    });

    test('is idle with no pending request regardless of grouping or attempts', () {
      expect(decide(hasPending: false, isOverviewTimeline: true), ScrollDrainAction.idle);
      expect(
        decide(hasPending: false, isOverviewTimeline: true, laidOut: false, attempts: maxAttempts + 1),
        ScrollDrainAction.idle,
      );
    });

    test('never scrolls while the timeline renders overview cards', () {
      // #822: in Year/Month grouping findTimelineScrollTargetSegment happily matches
      // the year/month CARD, so "ready" is true — scrolling here is exactly the bug.
      expect(decide(isOverviewTimeline: true), ScrollDrainAction.switchToDayGrouping);
    });

    test('switches to day grouping while an overview timeline is still loading', () {
      expect(decide(isOverviewTimeline: true, segmentsLoaded: false), ScrollDrainAction.switchToDayGrouping);
      expect(decide(isOverviewTimeline: true, laidOut: false), ScrollDrainAction.switchToDayGrouping);
    });

    test('keeps switching right up to the attempt budget', () {
      expect(decide(isOverviewTimeline: true, attempts: maxAttempts - 1), ScrollDrainAction.switchToDayGrouping);
    });

    test('gives up rather than switching forever when the grouping write never lands', () {
      // If the grouping is pinned by timelineArgs or a dateless bucket source, set(day)
      // is a no-op. The budget is the only thing stopping an infinite loop, so the
      // widget must increment attempts on this branch too.
      expect(decide(isOverviewTimeline: true, attempts: maxAttempts), ScrollDrainAction.giveUp);
      expect(decide(isOverviewTimeline: true, attempts: maxAttempts + 5), ScrollDrainAction.giveUp);
    });
  });

  group('findMatchingSegmentIndex', () {
    test('returns null for an empty timeline', () {
      expect(findMatchingSegmentIndex(const [], DateTime(2026, 5, 30)), isNull);
    });

    test('returns null when no segment shares the target month', () {
      final dates = [DateTime(2026, 4, 1), DateTime(2026, 6, 1)];
      expect(findMatchingSegmentIndex(dates, DateTime(2026, 5, 30)), isNull);
    });

    test('matches a monthly bucket via the month fallback for a mid-month asset', () {
      // Monthly buckets are dated the first of the month; the asset is the 30th.
      // Exact-day never matches, so the month fallback must find it. This is the
      // common case for "view in timeline" and the one most likely to regress.
      final dates = [DateTime(2026, 6, 1), DateTime(2026, 5, 1), DateTime(2026, 4, 1)];
      expect(findMatchingSegmentIndex(dates, DateTime(2026, 5, 30, 14, 22)), 1);
    });

    test('prefers an exact day match over a same-month bucket', () {
      // Daily buckets: an exact day match should win over an earlier same-month one.
      final dates = [DateTime(2026, 5, 1), DateTime(2026, 5, 30)];
      expect(findMatchingSegmentIndex(dates, DateTime(2026, 5, 30)), 1);
    });

    test('returns the first matching segment when several share the month', () {
      final dates = [DateTime(2026, 5, 1), DateTime(2026, 5, 1)];
      expect(findMatchingSegmentIndex(dates, DateTime(2026, 5, 15)), 0);
    });

    test('skips non-time-bucket segments (null dates)', () {
      final dates = [null, DateTime(2026, 5, 1), null];
      expect(findMatchingSegmentIndex(dates, DateTime(2026, 5, 30)), 1);
    });

    test('matches the same month across day/time but not across year', () {
      final dates = [DateTime(2025, 5, 1), DateTime(2026, 5, 1)];
      expect(findMatchingSegmentIndex(dates, DateTime(2026, 5, 9)), 1);
    });
  });

  group('segmentsAreOverview', () {
    test('null segments are not an overview', () {
      expect(segmentsAreOverview(null), isFalse);
    });

    test('an empty segment list is not an overview', () {
      expect(segmentsAreOverview(const []), isFalse);
    });

    test('fixed segments only are not an overview', () {
      expect(segmentsAreOverview([_fixedSegment(), _fixedSegment()]), isFalse);
    });

    test('a list of overview segments is an overview', () {
      expect(segmentsAreOverview([_overviewSegment(), _overviewSegment()]), isTrue);
    });

    test('a mixed list containing one overview segment is an overview', () {
      // Defensive: the builder never mixes them today, but treating "any overview
      // card present" as overview keeps the scroll from targeting a card.
      expect(segmentsAreOverview([_fixedSegment(), _overviewSegment()]), isTrue);
    });
  });

  group('decideScrollResolve', () {
    ScrollResolveOutcome decide({bool stillMounted = true, bool stillHasClients = true, bool targetUnchanged = true}) =>
        decideScrollResolve(
          stillMounted: stillMounted,
          stillHasClients: stillHasClients,
          targetUnchanged: targetUnchanged,
        );

    test('proceeds when nothing changed during the await', () {
      expect(decide(), ScrollResolveOutcome.proceed);
    });

    test('abandons when the widget unmounted during the await', () {
      expect(decide(stillMounted: false), ScrollResolveOutcome.abandonUnmounted);
    });

    test('abandons when the scroll controller lost its clients during the await', () {
      expect(decide(stillHasClients: false), ScrollResolveOutcome.abandonUnmounted);
    });

    test('abandons a stale resolution when a newer request replaced the target', () {
      expect(decide(targetUnchanged: false), ScrollResolveOutcome.abandonStale);
    });

    test('unmounting dominates staleness so nothing touches a dead controller', () {
      expect(decide(stillMounted: false, targetUnchanged: false), ScrollResolveOutcome.abandonUnmounted);
      expect(decide(stillHasClients: false, targetUnchanged: false), ScrollResolveOutcome.abandonUnmounted);
    });
  });
}

FixedSegment _fixedSegment() => FixedSegment(
  firstIndex: 0,
  lastIndex: 1,
  startOffset: 0,
  endOffset: 100,
  firstAssetIndex: 0,
  bucket: TimeBucket(date: DateTime(2026, 4, 3), assetCount: 1),
  tileHeight: 100,
  columnCount: 4,
  headerExtent: 40,
  spacing: 2,
  header: HeaderType.day,
);

TimelineOverviewSegment _overviewSegment() => TimelineOverviewSegment(
  firstIndex: 0,
  lastIndex: 0,
  startOffset: 0,
  endOffset: 100,
  firstAssetIndex: 0,
  bucket: TimeBucket(date: DateTime(2026, 1), assetCount: 12),
  mode: TimelineOverviewMode.years,
  header: HeaderType.none,
);
