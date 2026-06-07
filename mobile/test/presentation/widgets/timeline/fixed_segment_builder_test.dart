import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/presentation/widgets/timeline/constants.dart';
import 'package:immich_mobile/presentation/widgets/timeline/fixed/segment_builder.dart';
import 'package:immich_mobile/presentation/widgets/timeline/segment_builder.dart';

void main() {
  List<HeaderType> headersFor(GroupAssetsBy groupBy, List<Bucket> buckets) {
    return FixedSegmentBuilder(
      buckets: buckets,
      tileHeight: 100,
      columnCount: 4,
      groupBy: groupBy,
    ).generate().map((segment) => segment.header).toList();
  }

  test('year grouping maps to year headers with default timeline header extent', () {
    final headers = headersFor(GroupAssetsBy.year, [TimeBucket(date: DateTime(2026), assetCount: 2)]);

    expect(headers, [HeaderType.year]);
    expect(SegmentBuilder.headerExtent(HeaderType.year), kTimelineHeaderExtent);
  });

  test('month grouping still maps to month headers', () {
    final headers = headersFor(GroupAssetsBy.month, [TimeBucket(date: DateTime(2026, 4), assetCount: 2)]);

    expect(headers, [HeaderType.month]);
  });

  test('day grouping still uses monthAndDay at month boundaries', () {
    final headers = headersFor(GroupAssetsBy.day, [
      TimeBucket(date: DateTime(2026, 5, 1), assetCount: 1),
      TimeBucket(date: DateTime(2026, 5, 2), assetCount: 1),
      TimeBucket(date: DateTime(2026, 4, 30), assetCount: 1),
    ]);

    expect(headers, [HeaderType.monthAndDay, HeaderType.day, HeaderType.monthAndDay]);
  });

  test('none grouping still maps to none headers with zero extent', () {
    final headers = headersFor(GroupAssetsBy.none, [const Bucket(assetCount: 3)]);

    expect(headers, [HeaderType.none]);
    expect(SegmentBuilder.headerExtent(HeaderType.none), 0);
  });
}
