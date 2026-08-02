import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/models/timeline_grouping.model.dart';
import 'package:immich_mobile/providers/timeline/timeline_grouping.provider.dart';
import 'package:immich_mobile/providers/timeline/zoom_anchor.provider.dart';

typedef TimelineOverviewDrilldownHandler = Future<void> Function(TimeBucket bucket, TimelineOverviewMode mode);

final timelineOverviewDrilldownProvider = Provider<TimelineOverviewDrilldownHandler?>((ref) => null);

final sharedTimelineOverviewDrilldownProvider = Provider<TimelineOverviewDrilldownHandler>((ref) {
  return (bucket, mode) async {
    switch (mode) {
      case TimelineOverviewMode.years:
        ref.read(timelineZoomAnchorProvider.notifier).setYear(bucket.date.year);
        await ref.read(timelineOverviewModeProvider.notifier).set(TimelineOverviewMode.months);
      case TimelineOverviewMode.months:
        ref.read(timelineZoomAnchorProvider.notifier).setMonth(year: bucket.date.year, month: bucket.date.month);
        await ref.read(timelineOverviewModeProvider.notifier).set(TimelineOverviewMode.all);
      case TimelineOverviewMode.all:
        return;
    }
  };
  // timelineOverviewModeProvider must be listed so a drilldown inside a TimelineRouteScope
  // sets the ROUTE-LOCAL mode rather than the root one.
}, dependencies: [timelineZoomAnchorProvider, timelineOverviewModeProvider]);

final photosTimelineOverviewDrilldownProvider = sharedTimelineOverviewDrilldownProvider;
