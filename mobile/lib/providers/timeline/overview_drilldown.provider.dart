import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/providers/timeline/timeline_grouping.provider.dart';
import 'package:immich_mobile/providers/timeline/zoom_anchor.provider.dart';

typedef TimelineOverviewDrilldownHandler = Future<void> Function(TimeBucket bucket, GroupAssetsBy groupBy);

final timelineOverviewDrilldownProvider = Provider<TimelineOverviewDrilldownHandler?>((ref) => null);

final sharedTimelineOverviewDrilldownProvider = Provider<TimelineOverviewDrilldownHandler>((ref) {
  return (bucket, groupBy) async {
    switch (groupBy) {
      case GroupAssetsBy.year:
        ref.read(timelineZoomAnchorProvider.notifier).setYear(bucket.date.year);
        await ref.read(timelineGroupingProvider.notifier).set(GroupAssetsBy.month);
      case GroupAssetsBy.month:
        ref.read(timelineZoomAnchorProvider.notifier).setMonth(year: bucket.date.year, month: bucket.date.month);
        await ref.read(timelineGroupingProvider.notifier).set(GroupAssetsBy.day);
      case GroupAssetsBy.day:
      case GroupAssetsBy.auto:
      case GroupAssetsBy.none:
        return;
    }
  };
  // timelineGroupingProvider must be listed so a drilldown inside a TimelineRouteScope
  // sets the ROUTE-LOCAL grouping; on the main Photos timeline (where grouping is not
  // overridden) it resolves the root provider and persists, same as before.
}, dependencies: [timelineZoomAnchorProvider, timelineGroupingProvider]);

final photosTimelineOverviewDrilldownProvider = sharedTimelineOverviewDrilldownProvider;
