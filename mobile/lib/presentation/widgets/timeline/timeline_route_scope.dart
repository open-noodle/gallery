import 'package:flutter/widgets.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/timeline_temporal_scope.model.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/providers/infrastructure/settings.provider.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/timeline/overview_drilldown.provider.dart';
import 'package:immich_mobile/providers/timeline/temporal_scope.provider.dart';
import 'package:immich_mobile/providers/timeline/zoom_anchor.provider.dart';

typedef TimelineRouteServiceBuilder = TimelineService Function(Ref ref, TimelineTemporalScope temporalScope);

class TimelineRouteScope extends StatelessWidget {
  const TimelineRouteScope({super.key, required this.child, this.timelineServiceBuilder, this.overrides = const []});

  final Widget child;
  final TimelineRouteServiceBuilder? timelineServiceBuilder;
  final List<Override> overrides;

  @override
  Widget build(BuildContext context) {
    return ProviderScope(
      overrides: [
        timelineTemporalScopeProvider.overrideWith(TimelineTemporalScopeNotifier.new),
        timelineZoomAnchorProvider.overrideWith(TimelineZoomAnchorNotifier.new),
        timelineOverviewDrilldownProvider.overrideWith((ref) => ref.watch(sharedTimelineOverviewDrilldownProvider)),
        if (timelineServiceBuilder != null)
          timelineServiceProvider.overrideWith((ref) {
            final temporalScope = ref.watch(timelineTemporalScopeProvider);
            final _ = ref.watch(appConfigProvider.select((config) => config.timeline.groupAssetsBy));
            final service = timelineServiceBuilder!(ref, temporalScope);
            ref.onDispose(service.dispose);
            return service;
          }),
        ...overrides,
      ],
      child: child,
    );
  }
}
