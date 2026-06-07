import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/presentation/widgets/timeline/overview/overview_card.dart';
import 'package:immich_mobile/presentation/widgets/timeline/overview/overview_segment.model.dart';
import 'package:immich_mobile/presentation/widgets/timeline/segment.model.dart';
import 'package:immich_mobile/presentation/widgets/timeline/segment_builder.dart';

class TimelineOverviewSegmentBuilder extends SegmentBuilder {
  const TimelineOverviewSegmentBuilder({required super.buckets, required super.groupBy});

  List<Segment> generate() {
    if (groupBy != GroupAssetsBy.year && groupBy != GroupAssetsBy.month) {
      throw ArgumentError.value(groupBy, 'groupBy', 'Overview segments support only year and month grouping');
    }

    final segments = <Segment>[];
    var childIndex = 0;
    var assetIndex = 0;
    var startOffset = 0.0;

    for (final bucket in buckets) {
      final endOffset = startOffset + kTimelineOverviewSegmentExtent;
      segments.add(
        TimelineOverviewSegment(
          firstIndex: childIndex,
          lastIndex: childIndex,
          startOffset: startOffset,
          endOffset: endOffset,
          firstAssetIndex: assetIndex,
          bucket: bucket,
          groupBy: groupBy,
          header: groupBy == GroupAssetsBy.year ? HeaderType.year : HeaderType.month,
        ),
      );

      childIndex += 1;
      assetIndex += bucket.assetCount;
      startOffset = endOffset;
    }

    return segments;
  }
}
