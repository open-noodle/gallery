import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/models/timeline_grouping.model.dart';
import 'package:immich_mobile/domain/models/timeline_zoom_anchor.model.dart';
import 'package:immich_mobile/presentation/widgets/timeline/fixed/segment.model.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_scroll_target.dart';

void main() {
  test('findTimelineScrollTargetSegment prefers exact day match', () {
    final segments = [
      _segment(DateTime(2026, 4, 4), 0, 100),
      _segment(DateTime(2026, 4, 3), 100, 200),
      _segment(DateTime(2026, 3, 1), 200, 300),
    ];

    expect(findTimelineScrollTargetSegment(segments, DateTime(2026, 4, 3)), segments[1]);
  });

  test('findTimelineScrollTargetSegment falls back to same month when exact day is absent', () {
    final segments = [_segment(DateTime(2026, 4, 4), 0, 100), _segment(DateTime(2026, 3, 1), 100, 200)];

    expect(findTimelineScrollTargetSegment(segments, DateTime(2026, 4, 3)), segments[0]);
  });

  test('findTimelineScrollTargetSegment falls back to same year when month is absent', () {
    final segments = [_segment(DateTime(2026, 2, 1), 0, 100), _segment(DateTime(2025, 12, 1), 100, 200)];

    expect(findTimelineScrollTargetSegment(segments, DateTime(2026, 4, 3)), segments[0]);
  });

  test('findTimelineScrollTargetSegment returns null when no time bucket matches', () {
    final segments = [_segment(DateTime(2025, 12, 1), 0, 100), _segment(DateTime(2024, 12, 1), 100, 200)];

    expect(findTimelineScrollTargetSegment(segments, DateTime(2026, 4, 3)), isNull);
  });

  test('findTimelineScrollTargetSegment ignores non-time bucket segments', () {
    final segments = [_nonTimeSegment(0, 100), _segment(DateTime(2026, 4, 3), 100, 200)];

    expect(findTimelineScrollTargetSegment(segments, DateTime(2026, 4, 3)), segments[1]);
    expect(findTimelineScrollTargetSegment([_nonTimeSegment(0, 100)], DateTime(2026, 4, 3)), isNull);
  });

  test('findTimelineZoomAnchorSegment resolves a year anchor in months mode', () {
    final segments = [
      _segment(DateTime(2026, 1), 0, 100),
      _segment(DateTime(2025, 12), 100, 200),
      _segment(DateTime(2025, 3), 200, 300),
    ];

    expect(
      findTimelineZoomAnchorSegment(segments, const TimelineZoomAnchor.year(2025), TimelineOverviewMode.months),
      segments[1],
    );
  });

  test('findTimelineZoomAnchorSegment resolves a month anchor in all mode', () {
    final segments = [
      _segment(DateTime(2025, 4, 1), 0, 100),
      _segment(DateTime(2025, 3, 20), 100, 200),
      _segment(DateTime(2025, 3, 1), 200, 300),
    ];

    expect(
      findTimelineZoomAnchorSegment(segments, TimelineZoomAnchor.month(year: 2025, month: 3), TimelineOverviewMode.all),
      segments[1],
    );
  });

  test('findTimelineZoomAnchorSegment does not fall back to nearby years or months', () {
    final segments = [_segment(DateTime(2026, 1), 0, 100), _segment(DateTime(2024, 12), 100, 200)];

    expect(findTimelineZoomAnchorSegment(segments, const TimelineZoomAnchor.year(2025), TimelineOverviewMode.months), isNull);
    expect(
      findTimelineZoomAnchorSegment(
        [_segment(DateTime(2025, 2), 0, 100), _segment(DateTime(2025, 4), 100, 200)],
        TimelineZoomAnchor.month(year: 2025, month: 3),
        TimelineOverviewMode.all,
      ),
      isNull,
    );
  });

  test('findTimelineZoomAnchorSegment ignores anchors in stale modes', () {
    final segments = [_segment(DateTime(2025, 3), 0, 100)];

    expect(findTimelineZoomAnchorSegment(segments, const TimelineZoomAnchor.year(2025), TimelineOverviewMode.all), isNull);
    expect(
      findTimelineZoomAnchorSegment(segments, TimelineZoomAnchor.month(year: 2025, month: 3), TimelineOverviewMode.months),
      isNull,
    );
  });

  test('findTimelineZoomAnchorSegment resolves a date anchor by month fallback in months mode', () {
    final segments = [
      _segment(DateTime(2026, 1), 0, 100),
      _segment(DateTime(2017, 11), 100, 200),
      _segment(DateTime(2016, 5), 200, 300),
    ];

    expect(
      findTimelineZoomAnchorSegment(segments, TimelineZoomAnchor.date(DateTime(2017, 11, 15)), TimelineOverviewMode.months),
      segments[1],
    );
  });

  test('findTimelineZoomAnchorSegment resolves a date anchor by year fallback in years mode', () {
    final segments = [
      _segment(DateTime(2026), 0, 100),
      _segment(DateTime(2020), 100, 200),
      _segment(DateTime(2018), 200, 300),
    ];

    expect(
      findTimelineZoomAnchorSegment(segments, TimelineZoomAnchor.date(DateTime(2020, 8, 1)), TimelineOverviewMode.years),
      segments[1],
    );
  });

  // Z-6 ("resolves a month anchor in All mode over month-granularity segments") is not added
  // here: it exercises the identical guard as 'resolves a month anchor in all mode' above.
  // findTimelineZoomAnchorSegment never inspects day-of-month, so "month-granularity segments"
  // is not a distinct code path, and findTimelineZoomAnchorSegment's third parameter is a typed
  // TimelineOverviewMode — a spec.mode/spec.groupBy mix-up at the call site is now a compile
  // error, not something this pure-function test could ever catch. Do not re-add it.

  test('findTimelineZoomAnchorSegment ignores non-time bucket segments', () {
    final segments = [_nonTimeSegment(0, 100), _segment(DateTime(2025, 3), 100, 200)];

    expect(
      findTimelineZoomAnchorSegment(segments, TimelineZoomAnchor.month(year: 2025, month: 3), TimelineOverviewMode.all),
      segments[1],
    );
    expect(
      findTimelineZoomAnchorSegment(
        [_nonTimeSegment(0, 100)],
        const TimelineZoomAnchor.year(2025),
        TimelineOverviewMode.months,
      ),
      isNull,
    );
  });
}

FixedSegment _segment(DateTime date, double startOffset, double endOffset) {
  return FixedSegment(
    firstIndex: 0,
    lastIndex: 1,
    startOffset: startOffset,
    endOffset: endOffset,
    firstAssetIndex: 0,
    bucket: TimeBucket(date: date, assetCount: 1),
    tileHeight: 100,
    columnCount: 4,
    headerExtent: 40,
    spacing: 2,
    header: HeaderType.month,
  );
}

FixedSegment _nonTimeSegment(double startOffset, double endOffset) {
  return FixedSegment(
    firstIndex: 0,
    lastIndex: 1,
    startOffset: startOffset,
    endOffset: endOffset,
    firstAssetIndex: 0,
    bucket: const Bucket(assetCount: 1),
    tileHeight: 100,
    columnCount: 4,
    headerExtent: 0,
    spacing: 2,
    header: HeaderType.none,
  );
}
