import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/timeline_grouping.model.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_grouping_anchor.dart';

void main() {
  // ---- month-granularity cases ----

  test('months: remembered date within same month is kept', () {
    // All view at 9 Jun → switch to Months → bucket is 1 Jun → should keep 9 Jun
    final remembered = DateTime(2026, 6, 9);
    final topBucketDate = DateTime(2026, 6, 1);
    expect(
      resolveGroupingChangeAnchorDate(
        topBucketDate: topBucketDate,
        previousMode: TimelineOverviewMode.months,
        remembered: remembered,
      ),
      remembered,
    );
  });

  test('months: remembered date in a different month is dropped', () {
    // User scrolled to March while in month view → should use March 1st
    final remembered = DateTime(2026, 6, 9);
    final topBucketDate = DateTime(2026, 3, 1);
    expect(
      resolveGroupingChangeAnchorDate(
        topBucketDate: topBucketDate,
        previousMode: TimelineOverviewMode.months,
        remembered: remembered,
      ),
      topBucketDate,
    );
  });

  // ---- year-granularity cases ----

  test('years: remembered date within same year is kept', () {
    final remembered = DateTime(2026, 6, 9);
    final topBucketDate = DateTime(2026, 1, 1);
    expect(
      resolveGroupingChangeAnchorDate(
        topBucketDate: topBucketDate,
        previousMode: TimelineOverviewMode.years,
        remembered: remembered,
      ),
      remembered,
    );
  });

  test('years: remembered date in a different year is dropped', () {
    final remembered = DateTime(2025, 6, 9);
    final topBucketDate = DateTime(2026, 1, 1);
    expect(
      resolveGroupingChangeAnchorDate(
        topBucketDate: topBucketDate,
        previousMode: TimelineOverviewMode.years,
        remembered: remembered,
      ),
      topBucketDate,
    );
  });

  // ---- all: always return bucket date (already full precision) ----

  test('all: always returns bucket date even when remembered is present', () {
    final remembered = DateTime(2026, 6, 9);
    final topBucketDate = DateTime(2026, 6, 9);
    expect(
      resolveGroupingChangeAnchorDate(
        topBucketDate: topBucketDate,
        previousMode: TimelineOverviewMode.all,
        remembered: remembered,
      ),
      topBucketDate,
    );
  });

  // ---- null remembered ----

  test('null remembered: always returns bucket date', () {
    final topBucketDate = DateTime(2026, 6, 1);
    expect(
      resolveGroupingChangeAnchorDate(
        topBucketDate: topBucketDate,
        previousMode: TimelineOverviewMode.months,
        remembered: null,
      ),
      topBucketDate,
    );
  });
}
