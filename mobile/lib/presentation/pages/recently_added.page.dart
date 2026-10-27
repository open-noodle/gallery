import 'package:auto_route/auto_route.dart';
import 'package:flutter/widgets.dart';
import 'package:immich_mobile/gallery/search/search_scope.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_route_scope.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:immich_mobile/widgets/common/mesmerizing_sliver_app_bar.dart';

@RoutePage()
class RecentlyAddedPage extends StatelessWidget {
  const RecentlyAddedPage({super.key});

  @override
  Widget build(BuildContext context) {
    // Gallery: the grouping pill and search mode (specs/2026-10-23-mobile-search-redesign-design.md, "Layering").
    return TimelineRouteScope(
      timelineServiceBuilder: (ref, scope, groupBy) {
        final user = ref.watch(currentUserProvider);
        if (user == null) {
          throw Exception('User must be logged in to access recently taken');
        }

        return ref.watch(timelineFactoryProvider).recentlyAdded(user.id, groupBy: groupBy);
      },
      search: const RecentlyAddedSearchScope(),
      child: Timeline(withGroupingPill: true, appBar: MesmerizingSliverAppBar(title: context.t.recently_added)),
    );
  }
}
