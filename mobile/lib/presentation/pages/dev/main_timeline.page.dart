import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/photos_view_menu.widget.dart';
import 'package:immich_mobile/gallery/search/photos_search.dart';
import 'package:immich_mobile/gallery/search/search_scope.dart';
import 'package:immich_mobile/presentation/widgets/feature_message/feature_message_dialog.widget.dart';
import 'package:immich_mobile/presentation/widgets/memory/memory_lane.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_empty_state.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_route_scope.dart';
import 'package:immich_mobile/providers/feature_message.provider.dart';
import 'package:immich_mobile/widgets/common/immich_sliver_app_bar.dart';

@RoutePage()
class MainTimelinePage extends ConsumerStatefulWidget {
  const MainTimelinePage({super.key});

  // ignore: unused-code
  static const timelineOverviewControlsEnabled = true;

  @override
  ConsumerState<MainTimelinePage> createState() => _MainTimelinePageState();
}

class _MainTimelinePageState extends ConsumerState<MainTimelinePage> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      if (!mounted) {
        return;
      }
      final service = ref.read(featureMessageServiceProvider);
      if (!service.shouldShow()) {
        return;
      }

      await service.markSeen();
      if (!mounted) {
        return;
      }

      await showFeatureMessageDialog(context);
    });
  }

  @override
  Widget build(BuildContext context) {
    // Memories hide while search mode filters, so results start at the top (#902).
    final showMemories = ref.watch(photosMemoryLaneVisibleProvider);
    return TimelineRouteScope(
      timelineServiceBuilder: buildPhotosTimelineService,
      search: const PhotosSearchScope(),
      // The main Photos timeline is the only route on the app-level grouping, so its
      // Years / Months / All choice survives navigating away and back; detail routes get
      // their own and keep grouping changes route-local. Neither is persisted — the
      // "Photo Grid" -> "Group by" setting is a separate header-granularity choice.
      sharedGrouping: true,
      child: Timeline(
        topSliverWidget: showMemories ? const SliverToBoxAdapter(child: MemoryLane()) : null,
        topSliverWidgetHeight: showMemories ? 200 : 0,
        showStorageIndicator: true,
        appBar: const PhotosTimelineAppBar(),
        emptyWidget: const TimelineEmptyState(),
      ),
    );
  }
}

class PhotosTimelineAppBar extends StatelessWidget {
  const PhotosTimelineAppBar({super.key});

  // Search (and its sort) is reached from the bottom-nav search button (GallerySearchBlob), so the app bar keeps only
  // the display menu (library view, grouping). Every widget here is permanent and 40-50 px wide, which is what keeps
  // the title slot (and therefore the logo) the same width in every state (#1030).
  static const actions = <Widget>[PhotosViewMenuButton()];

  @override
  Widget build(BuildContext context) {
    return const ImmichSliverAppBar(floating: true, pinned: false, snap: false, actions: actions);
  }
}
