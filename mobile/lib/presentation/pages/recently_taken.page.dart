import 'package:auto_route/auto_route.dart';
import 'package:flutter/widgets.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_grouping_header_sliver.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_route_scope.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:immich_mobile/widgets/common/mesmerizing_sliver_app_bar.dart';

@RoutePage()
class RecentlyTakenPage extends StatelessWidget {
  const RecentlyTakenPage({super.key});

  static const timelineOverviewControlsEnabled = true;
  static const timelineOverviewTopSliverHeight = kTimelineGroupingHeaderSliverHeight;

  @override
  Widget build(BuildContext context) {
    return TimelineRouteScope(
      timelineServiceBuilder: (ref, scope) {
        final user = ref.watch(currentUserProvider);
        if (user == null) {
          throw Exception('User must be logged in to access recently taken');
        }

        return ref.watch(timelineFactoryProvider).remoteAssets(user.id, temporalScope: scope);
      },
      child: Timeline(
        topSliverWidget: const TimelineGroupingHeaderSliver(),
        topSliverWidgetHeight: DriftRecentlyTakenPage.timelineOverviewTopSliverHeight,
        appBar: MesmerizingSliverAppBar(title: context.t.recently_taken),
      ),
    );
  }
}
