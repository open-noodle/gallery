import 'package:immich_mobile/domain/models/timeline_grouping.model.dart';

/// The date to anchor on when the zoom level changes away from [previousMode].
/// [topBucketDate] is the (granularity-truncated) date of the top-visible bucket.
/// [remembered] is the last position-derived anchor date, if any.
///
/// Keeps the finer remembered date when it still falls inside the top bucket's
/// period (the user didn't scroll); otherwise uses the bucket date.
DateTime resolveGroupingChangeAnchorDate({
  required DateTime topBucketDate,
  required TimelineOverviewMode previousMode,
  DateTime? remembered,
}) {
  if (remembered == null) {
    return topBucketDate;
  }
  final within = switch (previousMode) {
    TimelineOverviewMode.years => remembered.year == topBucketDate.year,
    TimelineOverviewMode.months => remembered.year == topBucketDate.year && remembered.month == topBucketDate.month,
    TimelineOverviewMode.all => false,
  };
  return within ? remembered : topBucketDate;
}
