import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/models/timeline_grouping.model.dart';
import 'package:immich_mobile/presentation/widgets/timeline/overview/overview_card.dart';
import 'package:immich_mobile/presentation/widgets/timeline/overview/overview_segment.model.dart';
import 'package:immich_mobile/presentation/widgets/timeline/segment.model.dart';
import 'package:immich_mobile/presentation/widgets/timeline/segment_builder.dart';

class TimelineOverviewSegmentBuilder extends SegmentBuilder {
  const TimelineOverviewSegmentBuilder({required super.buckets, required this.mode});

  /// The zoom level these cards represent. The inherited [SegmentBuilder.groupBy] is
  /// unused for overview segments and stays at its upstream default.
  final TimelineOverviewMode mode;

  List<Segment> generate() {
    if (mode == TimelineOverviewMode.all) {
      throw ArgumentError.value(mode, 'mode', 'Overview segments support only years and months');
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
          mode: mode,
          header: mode == TimelineOverviewMode.years ? HeaderType.year : HeaderType.month,
        ),
      );

      childIndex += 1;
      assetIndex += bucket.assetCount;
      startOffset = endOffset;
    }

    return segments;
  }
}
