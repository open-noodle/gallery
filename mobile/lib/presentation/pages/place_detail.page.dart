import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_grouping_header_sliver.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_route_scope.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:immich_mobile/widgets/common/mesmerizing_sliver_app_bar.dart';

@RoutePage()
class PlaceDetailPage extends StatelessWidget {
  final String place;

  const PlaceDetailPage({super.key, required this.place});

  static const timelineOverviewControlsEnabled = true;
  static const timelineOverviewTopSliverHeight = kTimelineGroupingHeaderSliverHeight;

  @override
  Widget build(BuildContext context) {
    return TimelineRouteScope(
      timelineServiceBuilder: (ref, scope) {
        final user = ref.watch(currentUserProvider);
        if (user == null) {
          throw Exception('User must be logged in to access place');
        }
        final users = ref.watch(timelineUsersProvider).valueOrNull ?? [user.id];
        return ref.watch(timelineFactoryProvider).place(place, users, user.id, temporalScope: scope);
      },
      child: Timeline(
        topSliverWidget: const TimelineGroupingHeaderSliver(),
        topSliverWidgetHeight: DriftPlaceDetailPage.timelineOverviewTopSliverHeight,
        appBar: MesmerizingSliverAppBar(title: place, icon: Icons.location_on),
      ),
    );
  }
}
