import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_grouping_anchor.dart';

void main() {
  // ---- month-granularity cases ----

  test('month: remembered date within same month is kept', () {
    // Day view at 9 Jun → switch to Months → bucket is 1 Jun → should keep 9 Jun
    final remembered = DateTime(2026, 6, 9);
    final topBucketDate = DateTime(2026, 6, 1);
    expect(
      resolveGroupingChangeAnchorDate(
        topBucketDate: topBucketDate,
        previousGroupBy: GroupAssetsBy.month,
        remembered: remembered,
      ),
      remembered,
    );
  });

  test('month: remembered date in a different month is dropped', () {
    // User scrolled to March while in month view → should use March 1st
    final remembered = DateTime(2026, 6, 9);
    final topBucketDate = DateTime(2026, 3, 1);
    expect(
      resolveGroupingChangeAnchorDate(
        topBucketDate: topBucketDate,
        previousGroupBy: GroupAssetsBy.month,
        remembered: remembered,
      ),
      topBucketDate,
    );
  });

  // ---- year-granularity cases ----

  test('year: remembered date within same year is kept', () {
    final remembered = DateTime(2026, 6, 9);
    final topBucketDate = DateTime(2026, 1, 1);
    expect(
      resolveGroupingChangeAnchorDate(
        topBucketDate: topBucketDate,
        previousGroupBy: GroupAssetsBy.year,
        remembered: remembered,
      ),
      remembered,
    );
  });

  test('year: remembered date in a different year is dropped', () {
    final remembered = DateTime(2025, 6, 9);
    final topBucketDate = DateTime(2026, 1, 1);
    expect(
      resolveGroupingChangeAnchorDate(
        topBucketDate: topBucketDate,
        previousGroupBy: GroupAssetsBy.year,
        remembered: remembered,
      ),
      topBucketDate,
    );
  });

  // ---- day/auto/none: always return bucket date (already full precision) ----

  test('day: always returns bucket date even when remembered is present', () {
    final remembered = DateTime(2026, 6, 9);
    final topBucketDate = DateTime(2026, 6, 9);
    expect(
      resolveGroupingChangeAnchorDate(
        topBucketDate: topBucketDate,
        previousGroupBy: GroupAssetsBy.day,
        remembered: remembered,
      ),
      topBucketDate,
    );
  });

  test('auto: always returns bucket date', () {
    final remembered = DateTime(2026, 6, 9);
    final topBucketDate = DateTime(2026, 6, 5);
    expect(
      resolveGroupingChangeAnchorDate(
        topBucketDate: topBucketDate,
        previousGroupBy: GroupAssetsBy.auto,
        remembered: remembered,
      ),
      topBucketDate,
    );
  });

  test('none: always returns bucket date', () {
    final remembered = DateTime(2026, 6, 9);
    final topBucketDate = DateTime(2026, 6, 5);
    expect(
      resolveGroupingChangeAnchorDate(
        topBucketDate: topBucketDate,
        previousGroupBy: GroupAssetsBy.none,
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
        previousGroupBy: GroupAssetsBy.month,
        remembered: null,
      ),
      topBucketDate,
    );
  });
}
