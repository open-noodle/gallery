import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/presentation/widgets/timeline/scroll_drain.dart';

void main() {
  group('decideScrollDrain', () {
    const maxAttempts = 180;

    ScrollDrainAction decide({
      bool hasPending = true,
      bool segmentsLoaded = true,
      bool laidOut = true,
      bool segmentMatched = true,
      int attempts = 0,
    }) {
      return decideScrollDrain(
        hasPending: hasPending,
        segmentsLoaded: segmentsLoaded,
        laidOut: laidOut,
        segmentMatched: segmentMatched,
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
}
