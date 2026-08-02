import 'package:collection/collection.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/models/timeline_grouping.model.dart';
import 'package:immich_mobile/domain/models/timeline_zoom_anchor.model.dart';
import 'package:immich_mobile/presentation/widgets/timeline/segment.model.dart';

bool _matchesDate(Segment segment, bool Function(DateTime segmentDate) predicate) {
  if (segment.bucket is! TimeBucket) {
    return false;
  }

  return predicate((segment.bucket as TimeBucket).date);
}

Segment? findTimelineScrollTargetSegment(List<Segment> segments, DateTime date) {
  return segments.firstWhereOrNull(
        (segment) => _matchesDate(
          segment,
          (segmentDate) =>
              segmentDate.year == date.year && segmentDate.month == date.month && segmentDate.day == date.day,
        ),
      ) ??
      segments.firstWhereOrNull(
        (segment) =>
            _matchesDate(segment, (segmentDate) => segmentDate.year == date.year && segmentDate.month == date.month),
      ) ??
      segments.firstWhereOrNull((segment) => _matchesDate(segment, (segmentDate) => segmentDate.year == date.year));
}

Segment? findTimelineZoomAnchorSegment(List<Segment> segments, TimelineZoomAnchor anchor, TimelineOverviewMode mode) {
  return switch (anchor) {
    TimelineZoomAnchorNone() => null,
    TimelineZoomYearAnchor(:final year) when mode == TimelineOverviewMode.months => segments.firstWhereOrNull(
      (segment) => _matchesDate(segment, (segmentDate) => segmentDate.year == year),
    ),
    TimelineZoomMonthAnchor(:final year, :final month) when mode == TimelineOverviewMode.all =>
      segments.firstWhereOrNull(
        (segment) => _matchesDate(segment, (segmentDate) => segmentDate.year == year && segmentDate.month == month),
      ),
    // A date anchor preserves the visible position across mode changes, so it
    // resolves to the closest matching segment (day -> month -> year) in any mode.
    TimelineZoomDateAnchor(:final date) => findTimelineScrollTargetSegment(segments, date),
    _ => null,
  };
}
