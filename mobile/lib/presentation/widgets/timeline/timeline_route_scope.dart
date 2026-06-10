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
    this.persistGrouping = false,
    this.overrides = const [],
  });

  final Widget child;
  final TimelineRouteServiceBuilder? timelineServiceBuilder;

  /// Whether grouping inside this route follows and writes the persisted
  /// `Setting.groupAssetsBy`. The main Photos timeline passes true so its grouping
  /// keeps surviving restarts; detail routes (albums, spaces, favorites, ...) leave
  /// this false so they open grouped at "All" and keep grouping changes local to
  /// the route.
  final bool persistGrouping;
  final List<Override> overrides;

  @override
  Widget build(BuildContext context) {
    return ProviderScope(
      overrides: [
        timelineTemporalScopeProvider.overrideWith(TimelineTemporalScopeNotifier.new),
        timelineZoomAnchorProvider.overrideWith(TimelineZoomAnchorNotifier.new),
        if (!persistGrouping) timelineGroupingProvider.overrideWith(RouteTimelineGroupingNotifier.new),
        timelineOverviewDrilldownProvider.overrideWith((ref) => ref.watch(sharedTimelineOverviewDrilldownProvider)),
        timelineOverviewRepresentativeCacheProvider.overrideWith(TimelineOverviewRepresentativeCacheNotifier.new),
        if (timelineServiceBuilder != null)
          timelineServiceProvider.overrideWith((ref) {
            final temporalScope = ref.watch(timelineTemporalScopeProvider);
            final groupBy = ref.watch(timelineGroupingProvider);
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
