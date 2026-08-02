import 'package:flutter/widgets.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/models/timeline_temporal_scope.model.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/timeline/overview_drilldown.provider.dart';
import 'package:immich_mobile/providers/timeline/overview_representative_cache.provider.dart';
import 'package:immich_mobile/providers/timeline/temporal_scope.provider.dart';
import 'package:immich_mobile/providers/timeline/timeline_grouping.provider.dart';
import 'package:immich_mobile/providers/timeline/zoom_anchor.provider.dart';

typedef TimelineRouteServiceBuilder =
    TimelineService Function(Ref ref, TimelineTemporalScope temporalScope, GroupAssetsBy groupBy);

class TimelineRouteScope extends StatelessWidget {
  const TimelineRouteScope({
    super.key,
    required this.child,
    this.timelineServiceBuilder,
    this.sharedGrouping = false,
    this.overrides = const [],
  });

  final Widget child;
  final TimelineRouteServiceBuilder? timelineServiceBuilder;

  /// Whether this route shares the app-level grouping. The main Photos timeline passes
  /// true so its Years / Months / All choice survives navigating away and back; detail
  /// routes (albums, spaces, favorites, ...) leave this false so they get their own
  /// grouping and changes stay local to the route. Either way grouping starts at "All"
  /// and is never persisted — the "Group by" setting is a separate, header-granularity
  /// choice.
  final bool sharedGrouping;
  final List<Override> overrides;

  @override
  Widget build(BuildContext context) {
    return ProviderScope(
      overrides: [
        timelineTemporalScopeProvider.overrideWith(TimelineTemporalScopeNotifier.new),
        timelineZoomAnchorProvider.overrideWith(TimelineZoomAnchorNotifier.new),
        if (!sharedGrouping) timelineOverviewModeProvider.overrideWith(TimelineOverviewModeNotifier.new),
        timelineOverviewDrilldownProvider.overrideWith((ref) => ref.watch(sharedTimelineOverviewDrilldownProvider)),
        timelineOverviewRepresentativeCacheProvider.overrideWith(TimelineOverviewRepresentativeCacheNotifier.new),
        if (timelineServiceBuilder != null)
          timelineServiceProvider.overrideWith((ref) {
            final temporalScope = ref.watch(timelineTemporalScopeProvider);
            // The bucket granularity, not the zoom level: on "All" the query must group by the
            // persisted "Group by" setting so month-only headers get month buckets.
            final groupBy = ref.watch(timelineGroupingSpecProvider).groupBy;
            final service = timelineServiceBuilder!(ref, temporalScope, groupBy);
            ref.onDispose(service.dispose);
            return service;
          }),
        ...overrides,
      ],
      child: child,
    );
  }
}
