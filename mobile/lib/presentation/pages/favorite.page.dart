import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/widgets/bottom_sheet/favorite_bottom_sheet.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_route_scope.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:immich_mobile/widgets/common/mesmerizing_sliver_app_bar.dart';

@RoutePage()
class FavoritePage extends StatelessWidget {
  const FavoritePage({super.key});

  static const timelineOverviewControlsEnabled = true;

  @override
  Widget build(BuildContext context) {
    return TimelineRouteScope(
      timelineServiceBuilder: (ref, scope, groupBy) {
        final user = ref.watch(currentUserProvider);
        if (user == null) {
          throw Exception('User must be logged in to access favorite');
        }

        return ref.watch(timelineFactoryProvider).favorite(user.id, groupBy: groupBy, temporalScope: scope);
      },
      child: Timeline(
<<<<<<< origin/main
        withGroupingPill: true,
        appBar: MesmerizingSliverAppBar(title: context.t.favorites, icon: Icons.favorite_outline),
||||||| ca4637adc79
        appBar: MesmerizingSliverAppBar(title: context.t.favorites, icon: Icons.favorite_outline),
=======
        appBar: MesmerizingSliverAppBar(title: context.t.favorites),
>>>>>>> e598e108966814fe8f70f81cd2a47c66dd5e7c71
        bottomSheet: const FavoriteBottomSheet(),
      ),
    );
  }
}
