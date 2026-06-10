import 'package:auto_route/auto_route.dart';
import 'package:flutter/widgets.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_route_scope.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:immich_mobile/widgets/common/mesmerizing_sliver_app_bar.dart';

@RoutePage()
class VideoPage extends StatelessWidget {
  const VideoPage({super.key});

  static const timelineOverviewControlsEnabled = true;

  @override
  Widget build(BuildContext context) {
    return TimelineRouteScope(
      timelineServiceBuilder: (ref, scope, groupBy) {
        final user = ref.watch(currentUserProvider);
        if (user == null) {
          throw Exception('User must be logged in to video');
        }
        final users = ref.watch(timelineUsersProvider).valueOrNull ?? [user.id];

        return ref.watch(timelineFactoryProvider).video(users, user.id, groupBy: groupBy, temporalScope: scope);
      },
      child: Timeline(withGroupingPill: true, appBar: MesmerizingSliverAppBar(title: context.t.videos)),
    );
  }
}
