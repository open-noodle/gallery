import 'package:flutter/widgets.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/models/timeline_temporal_scope.model.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/gallery/search/search_scope.dart';
import 'package:immich_mobile/gallery/search/search_timeline.dart';
import 'package:immich_mobile/gallery/search/widgets/search_frame.widget.dart';
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
    this.search,
  }) : assert(search == null || timelineServiceBuilder != null, 'search needs the screen\'s own timeline builder');

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

  /// The screen's search scope: search mode shows its results through this screen's timeline
  /// (lib/gallery/search/search_timeline.dart). Null: the screen has no search.
  final SearchScope? search;

  @override
  Widget build(BuildContext context) {
    final screenBuilder = timelineServiceBuilder;
    final serviceBuilder = search != null && screenBuilder != null
        ? searchTimelineServiceBuilder(screenBuilder)
        : screenBuilder;
    return ProviderScope(
      overrides: [
        timelineTemporalScopeProvider.overrideWith(TimelineTemporalScopeNotifier.new),
        timelineZoomAnchorProvider.overrideWith(TimelineZoomAnchorNotifier.new),
        if (!sharedGrouping) timelineOverviewModeProvider.overrideWith(TimelineOverviewModeNotifier.new),
        timelineOverviewDrilldownProvider.overrideWith((ref) => ref.watch(sharedTimelineOverviewDrilldownProvider)),
        timelineOverviewRepresentativeCacheProvider.overrideWith(TimelineOverviewRepresentativeCacheNotifier.new),
        if (search != null) ...searchTimelineScopeOverrides(search!),
        if (serviceBuilder != null)
          timelineServiceProvider.overrideWith((ref) {
            final temporalScope = ref.watch(timelineTemporalScopeProvider);
            // The bucket granularity, not the zoom level: on "All" the query must group by the
            // persisted "Group by" setting so month-only headers get month buckets.
            final groupBy = ref.watch(timelineGroupingSpecProvider).groupBy;
            final service = serviceBuilder(ref, temporalScope, groupBy);
            ref.onDispose(service.dispose);
            return service;
          }),
        ...overrides,
      ],
      child: search is PhotosSearchScope ? PhotosSearchFrame(child: child) : child,
    );
  }
}
