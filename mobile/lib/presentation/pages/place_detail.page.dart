import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_route_scope.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:immich_mobile/widgets/common/mesmerizing_sliver_app_bar.dart';

@RoutePage()
class PlaceDetailPage extends StatelessWidget {
  final String place;

  const PlaceDetailPage({super.key, required this.place});

  static const timelineOverviewControlsEnabled = true;

  @override
  Widget build(BuildContext context) {
<<<<<<< origin/main
    return TimelineRouteScope(
      timelineServiceBuilder: (ref, scope, groupBy) {
        final user = ref.watch(currentUserProvider);
        if (user == null) {
          throw Exception('User must be logged in to access place');
        }
        final users = ref.watch(timelineUsersProvider).valueOrNull ?? [user.id];
        return ref.watch(timelineFactoryProvider).place(place, users, user.id, groupBy: groupBy, temporalScope: scope);
      },
      child: Timeline(
        withGroupingPill: true,
        appBar: MesmerizingSliverAppBar(title: place, icon: Icons.location_on),
      ),
||||||| ca4637adc79
    return ProviderScope(
      overrides: [
        timelineServiceProvider.overrideWith((ref) {
          final timelineService = ref.watch(timelineFactoryProvider).place(place);
          ref.onDispose(timelineService.dispose);
          return timelineService;
        }),
      ],
      child: Timeline(
        appBar: MesmerizingSliverAppBar(title: place, icon: Icons.location_on),
      ),
=======
    return ProviderScope(
      overrides: [
        timelineServiceProvider.overrideWith((ref) {
          final timelineService = ref.watch(timelineFactoryProvider).place(place);
          ref.onDispose(timelineService.dispose);
          return timelineService;
        }),
      ],
      child: Timeline(appBar: MesmerizingSliverAppBar(title: place)),
>>>>>>> e598e108966814fe8f70f81cd2a47c66dd5e7c71
    );
  }
}
