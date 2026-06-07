import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/presentation/widgets/timeline/segment.model.dart';
import 'package:intl/intl.dart';

class ScrubberSegment {
  final DateTime date;
  final double startOffset;
  final String scrollLabel;
  final bool showSegment;

  const ScrubberSegment({
    required this.date,
    required this.startOffset,
    required this.scrollLabel,
    this.showSegment = false,
  });

  ScrubberSegment copyWith({DateTime? date, double? startOffset, String? scrollLabel, bool? showSegment}) {
    return ScrubberSegment(
      date: date ?? this.date,
      startOffset: startOffset ?? this.startOffset,
      scrollLabel: scrollLabel ?? this.scrollLabel,
      showSegment: showSegment ?? this.showSegment,
    );
  }

  @override
  String toString() {
    return 'ScrubberSegment(date: $date, startOffset: $startOffset, scrollLabel: $scrollLabel, showSegment: $showSegment)';
  }
}

List<ScrubberSegment> buildScrubberSegments({
  required List<Segment> layoutSegments,
  required double timelineHeight,
  required GroupAssetsBy groupBy,
}) {
  const double offsetThreshold = 40.0;

  final segments = <ScrubberSegment>[];
  if (layoutSegments.isEmpty || layoutSegments.first.bucket is! TimeBucket) {
    return [];
  }

  final formatter = groupBy == GroupAssetsBy.year ? DateFormat.y() : DateFormat.yMMM();
  DateTime? lastDate;
  double lastOffset = -offsetThreshold;
  for (final layoutSegment in layoutSegments) {
    if (layoutSegment.bucket is! TimeBucket) {
      continue;
    }

    final scrollPercentage = layoutSegment.startOffset / layoutSegments.last.endOffset;
    final startOffset = scrollPercentage * timelineHeight;

    final date = (layoutSegment.bucket as TimeBucket).date;
    final label = formatter.format(date);

    final showSegment = lastOffset + offsetThreshold <= startOffset && (lastDate == null || date.year != lastDate.year);

    segments.add(ScrubberSegment(date: date, startOffset: startOffset, scrollLabel: label, showSegment: showSegment));
    lastDate = date;
    if (showSegment) {
      lastOffset = startOffset;
    }
  }

  return segments;
}

int countScrubberSnapSegments(List<Segment> layoutSegments, GroupAssetsBy groupBy) {
  return layoutSegments
      .where((segment) => segment.bucket is TimeBucket)
      .map((segment) {
        final date = (segment.bucket as TimeBucket).date;
        return groupBy == GroupAssetsBy.year ? date.year.toString() : '${date.month}_${date.year}';
      })
      .toSet()
      .length;
}

int findScrubberLayoutSegmentIndex(List<Segment> layoutSegments, ScrubberSegment segment, GroupAssetsBy groupBy) {
  return layoutSegments.indexWhere((layoutSegment) {
    if (layoutSegment.bucket is! TimeBucket) {
      return false;
    }

    final bucket = layoutSegment.bucket as TimeBucket;
    if (groupBy == GroupAssetsBy.year) {
      return bucket.date.year == segment.date.year;
    }

    return bucket.date.year == segment.date.year && bucket.date.month == segment.date.month;
  });
}

bool shouldRebuildScrubberSegments({
  required List<Segment> oldLayoutSegments,
  required List<Segment> layoutSegments,
  required GroupAssetsBy oldGroupBy,
  required GroupAssetsBy groupBy,
  required double oldScrubberHeight,
  required double scrubberHeight,
}) {
  if (oldGroupBy != groupBy || oldScrubberHeight != scrubberHeight) {
    return true;
  }

  if (oldLayoutSegments.length != layoutSegments.length) {
    return true;
  }

  for (var i = 0; i < layoutSegments.length; i++) {
    final oldSegment = oldLayoutSegments[i];
    final segment = layoutSegments[i];

    if (oldSegment.startOffset != segment.startOffset || oldSegment.endOffset != segment.endOffset) {
      return true;
    }

    if (oldSegment.bucket is TimeBucket || segment.bucket is TimeBucket) {
      if (oldSegment.bucket is! TimeBucket || segment.bucket is! TimeBucket) {
        return true;
      }

      if ((oldSegment.bucket as TimeBucket).date != (segment.bucket as TimeBucket).date) {
        return true;
      }
    }
  }

  return false;
}
