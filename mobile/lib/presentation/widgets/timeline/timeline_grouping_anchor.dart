import 'package:immich_mobile/domain/models/timeline.model.dart';

/// The date to anchor on when the grouping changes away from [previousGroupBy].
/// [topBucketDate] is the (granularity-truncated) date of the top-visible bucket.
/// [remembered] is the last position-derived anchor date, if any.
///
/// Keeps the finer remembered date when it still falls inside the top bucket's
/// period (the user didn't scroll); otherwise uses the bucket date.
DateTime resolveGroupingChangeAnchorDate({
  required DateTime topBucketDate,
  required GroupAssetsBy previousGroupBy,
  DateTime? remembered,
}) {
  if (remembered == null) {
    return topBucketDate;
  }
  final within = switch (previousGroupBy) {
    GroupAssetsBy.year => remembered.year == topBucketDate.year,
    GroupAssetsBy.month => remembered.year == topBucketDate.year && remembered.month == topBucketDate.month,
    GroupAssetsBy.day || GroupAssetsBy.auto || GroupAssetsBy.none => false,
  };
  return within ? remembered : topBucketDate;
}
