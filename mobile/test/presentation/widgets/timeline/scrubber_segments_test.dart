import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/presentation/widgets/timeline/fixed/segment.model.dart';
import 'package:immich_mobile/presentation/widgets/timeline/scrubber_segments.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:intl/intl.dart';

void main() {
  String? previousDefaultLocale;

  setUpAll(() async {
    await initializeDateFormatting('en');
  });

  setUp(() {
    previousDefaultLocale = Intl.defaultLocale;
    Intl.defaultLocale = 'en';
  });

  tearDown(() {
    Intl.defaultLocale = previousDefaultLocale;
  });

  test('year grouping builds year labels and counts unique years', () {
    final segments = [_segment(DateTime(2026, 4), 0, 100), _segment(DateTime(2025, 12), 100, 200)];

    final scrubberSegments = buildScrubberSegments(
      layoutSegments: segments,
      timelineHeight: 300,
      groupBy: GroupAssetsBy.year,
    );

    expect(scrubberSegments.map((segment) => segment.scrollLabel), ['2026', '2025']);
    expect(countScrubberSnapSegments([...segments, _segment(DateTime(2026, 3), 200, 300)], GroupAssetsBy.year), 2);
  });

  test('month grouping builds month labels and counts unique months', () {
    final segments = [
      _segment(DateTime(2026, 4), 0, 100),
      _segment(DateTime(2026, 4, 12), 100, 200),
      _segment(DateTime(2026, 3), 200, 300),
    ];

    final scrubberSegments = buildScrubberSegments(
      layoutSegments: segments,
      timelineHeight: 300,
      groupBy: GroupAssetsBy.month,
    );

    expect(scrubberSegments.map((segment) => segment.scrollLabel), ['Apr 2026', 'Apr 2026', 'Mar 2026']);
    expect(countScrubberSnapSegments(segments, GroupAssetsBy.month), 2);
  });

  test('day grouping builds month labels and counts unique months', () {
    final segments = [
      _segment(DateTime(2026, 4, 12), 0, 100),
      _segment(DateTime(2026, 4, 10), 100, 200),
      _segment(DateTime(2026, 3, 30), 200, 300),
    ];

    final scrubberSegments = buildScrubberSegments(
      layoutSegments: segments,
      timelineHeight: 300,
      groupBy: GroupAssetsBy.day,
    );

    expect(scrubberSegments.map((segment) => segment.scrollLabel), ['Apr 2026', 'Apr 2026', 'Mar 2026']);
    expect(countScrubberSnapSegments(segments, GroupAssetsBy.day), 2);
  });

  // B-3 ("month granularity labels month+year") and B-4 ("day granularity labels month+year, same
  // as month") are not added here: the two tests above already assert the exact scrollLabel
  // strings (['Apr 2026', 'Apr 2026', 'Mar 2026']) for month and day grouping — strictly stronger
  // than a "not a bare year" regex, over the same segments. No mutation can fail B-3/B-4 while
  // those keep passing. Do not re-add them.

  test('empty layout returns empty scrubber segments', () {
    expect(buildScrubberSegments(layoutSegments: [], timelineHeight: 300, groupBy: GroupAssetsBy.year), isEmpty);
  });

  test('layout starting with non-time bucket returns empty scrubber segments', () {
    final segments = [_nonTimeSegment(0, 100), _segment(DateTime(2026, 4), 100, 200)];

    expect(buildScrubberSegments(layoutSegments: segments, timelineHeight: 300, groupBy: GroupAssetsBy.day), isEmpty);
  });

  test('findScrubberLayoutSegmentIndex matches by year for year grouping', () {
    final segments = [_segment(DateTime(2026, 4), 0, 100), _segment(DateTime(2025, 12), 100, 200)];
    final scrubberSegment = ScrubberSegment(date: DateTime(2026, 1), startOffset: 0, scrollLabel: '2026');

    expect(findScrubberLayoutSegmentIndex(segments, scrubberSegment, GroupAssetsBy.year), 0);
  });

  test('findScrubberLayoutSegmentIndex matches by year and month for month and day grouping', () {
    final segments = [_segment(DateTime(2026, 4), 0, 100), _segment(DateTime(2026, 3), 100, 200)];
    final scrubberSegment = ScrubberSegment(date: DateTime(2026, 3, 20), startOffset: 0, scrollLabel: 'Mar 2026');

    expect(findScrubberLayoutSegmentIndex(segments, scrubberSegment, GroupAssetsBy.month), 1);
    expect(findScrubberLayoutSegmentIndex(segments, scrubberSegment, GroupAssetsBy.day), 1);
  });

  test('findScrubberLayoutSegmentIndex returns -1 for non-time and no-match cases', () {
    final scrubberSegment = ScrubberSegment(date: DateTime(2026, 3), startOffset: 0, scrollLabel: 'Mar 2026');

    expect(findScrubberLayoutSegmentIndex([_nonTimeSegment(0, 100)], scrubberSegment, GroupAssetsBy.day), -1);
    expect(
      findScrubberLayoutSegmentIndex([_segment(DateTime(2025, 3), 0, 100)], scrubberSegment, GroupAssetsBy.day),
      -1,
    );
  });

  test('shouldRebuildScrubberSegments returns true when dates change but final end offset is unchanged', () {
    final oldSegments = [_segment(DateTime(2026, 4), 0, 100), _segment(DateTime(2026, 3), 100, 200)];
    final newSegments = [_segment(DateTime(2025, 4), 0, 100), _segment(DateTime(2026, 3), 100, 200)];

    expect(
      shouldRebuildScrubberSegments(
        oldLayoutSegments: oldSegments,
        layoutSegments: newSegments,
        oldGroupBy: GroupAssetsBy.day,
        groupBy: GroupAssetsBy.day,
        oldScrubberHeight: 300,
        scrubberHeight: 300,
      ),
      isTrue,
    );
  });

  test('shouldRebuildScrubberSegments returns true when groupBy changes', () {
    final segments = [_segment(DateTime(2026, 4), 0, 100)];

    expect(
      shouldRebuildScrubberSegments(
        oldLayoutSegments: segments,
        layoutSegments: segments,
        oldGroupBy: GroupAssetsBy.day,
        groupBy: GroupAssetsBy.year,
        oldScrubberHeight: 300,
        scrubberHeight: 300,
      ),
      isTrue,
    );
  });

  test('shouldRebuildScrubberSegments returns false when segment content is unchanged', () {
    final oldSegments = [_segment(DateTime(2026, 4), 0, 100), _segment(DateTime(2026, 3), 100, 200)];
    final newSegments = [_segment(DateTime(2026, 4), 0, 100), _segment(DateTime(2026, 3), 100, 200)];

    expect(
      shouldRebuildScrubberSegments(
        oldLayoutSegments: oldSegments,
        layoutSegments: newSegments,
        oldGroupBy: GroupAssetsBy.day,
        groupBy: GroupAssetsBy.day,
        oldScrubberHeight: 300,
        scrubberHeight: 300,
      ),
      isFalse,
    );
  });

  test('shouldRebuildScrubberSegments returns true when scrubber height changes', () {
    final segments = [_segment(DateTime(2026, 4), 0, 100)];

    expect(
      shouldRebuildScrubberSegments(
        oldLayoutSegments: segments,
        layoutSegments: segments,
        oldGroupBy: GroupAssetsBy.day,
        groupBy: GroupAssetsBy.day,
        oldScrubberHeight: 300,
        scrubberHeight: 280,
      ),
      isTrue,
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
