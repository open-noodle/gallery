import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/presentation/widgets/bottom_sheet/base_bottom_sheet.widget.dart';
import 'package:immich_mobile/presentation/widgets/map/map.state.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_route_scope.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';

class MapBottomSheet extends StatelessWidget {
  const MapBottomSheet({super.key});

  @override
  Widget build(BuildContext context) {
    return BaseBottomSheet(
      initialChildSize: 0.25,
      maxChildSize: 0.75,
      shouldCloseOnMinExtent: false,
      resizeOnScroll: false,
      actions: [],
      backgroundColor: context.themeData.colorScheme.surface,
      slivers: [const SliverFillRemaining(hasScrollBody: false, child: MapBottomSheetTimeline())],
    );
  }
}

class MapBottomSheetTimeline extends StatelessWidget {
  const MapBottomSheetTimeline({super.key});

  @override
  Widget build(BuildContext context) {
    // TODO: watching mapStateProvider rebuilds the service on every map move, flickering
    // the timeline through its loading state. This is both janky and inefficient.
    return TimelineRouteScope(
      timelineServiceBuilder: (ref, scope, groupBy) {
        final user = ref.watch(currentUserProvider);
        if (user == null) {
          throw Exception('User must be logged in to access the map timeline');
        }

        final users = ref.watch(mapStateProvider).withPartners
            ? ref.watch(timelineUsersProvider).valueOrNull ?? [user.id]
            : [user.id];

        return ref
            .watch(timelineFactoryProvider)
            .map(users, user.id, ref.watch(mapStateProvider).toOptions(), groupBy: groupBy, temporalScope: scope);
      },
      child: const Timeline(appBar: null, bottomSheet: null, withScrubber: false, withGroupingPill: true),
    );
  }
}
