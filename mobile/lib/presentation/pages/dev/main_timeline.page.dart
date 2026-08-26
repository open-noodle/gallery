import 'dart:async';
import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/widgets/feature_message/feature_message_dialog.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_sheet.widget.dart';
import 'package:immich_mobile/presentation/widgets/memory/memory_lane.widget.dart';
import 'package:immich_mobile/presentation/widgets/photos_filter/filter_subheader.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_empty_state.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_grouping_selector.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_route_scope.dart';
import 'package:immich_mobile/providers/feature_message.provider.dart';
import 'package:immich_mobile/providers/photos_filter/memory_lane.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter_search.provider.dart';
import 'package:immich_mobile/providers/photos_filter/timeline_query.provider.dart';
import 'package:immich_mobile/widgets/common/immich_sliver_app_bar.dart';

/// Scroll offset the memories strip occupies at the top of the timeline —
/// matches [DriftMemoryLane]'s own max height so the scrubber lines up.
const double _memoryLaneHeight = 200;

@RoutePage()
class MainTimelinePage extends ConsumerStatefulWidget {
  const MainTimelinePage({super.key});

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
    // The memories strip is browse-only: an active search or filter takes the
    // space back so results start at the top of the viewport (#902, web parity).
    final showMemories = ref.watch(photosMemoryLaneVisibleProvider);
    return TimelineRouteScope(
      timelineServiceBuilder: buildPhotosTimelineRouteService,
      // The main Photos timeline is the only route on the app-level grouping, so its
      // Years / Months / All choice survives navigating away and back; detail routes get
      // their own and keep grouping changes route-local. Neither is persisted — the
      // "Photo Grid" -> "Group by" setting is a separate header-granularity choice.
      sharedGrouping: true,
      child: Stack(
        children: [
          // Read photosFilterSearchProvider from inside the TimelineRouteScope so the
          // paginating notifier driving load-more is the same scoped instance the
          // timeline renders (the page's own ref lives outside the route scope).
          Consumer(
            builder: (context, scopedRef, _) => NotificationListener<ScrollUpdateNotification>(
              onNotification: (n) {
                final m = n.metrics;
                if (m.axis != Axis.vertical) {
                  return false;
                }
                final isSheet = n.context?.findAncestorWidgetOfExactType<DraggableScrollableSheet>() != null;
                if (!isSheet && m.maxScrollExtent - m.pixels < m.viewportDimension) {
                  unawaited(scopedRef.read(photosFilterSearchProvider.notifier).loadMore());
                }
                return false;
              },
              child: Timeline(
                topSliverWidget: SliverMainAxisGroup(
                  slivers: [
                    const PhotosFilterSubheader(),
                    if (showMemories) const SliverToBoxAdapter(child: MemoryLane()),
                  ],
                ),
                topSliverWidgetHeight: showMemories ? _memoryLaneHeight : 0,
                showStorageIndicator: true,
                appBar: const PhotosTimelineAppBar(),
                bottomSliverWidget: const _SearchLoadMoreFooter(),
                emptyWidget: const TimelineEmptyState(),
              ),
            ),
          ),
          const FilterSheet(),
        ],
      ),
    );
  }
}

class _SearchLoadMoreFooter extends ConsumerWidget {
  const _SearchLoadMoreFooter();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isActive = ref.watch(photosFilterProvider.select((f) => !f.isEmpty));
    if (!isActive) {
      return const SliverToBoxAdapter(child: SizedBox.shrink());
    }
    final isLoading = ref.watch(photosFilterSearchProvider.select((s) => s.isLoading));
    if (isLoading) {
      return const SliverToBoxAdapter(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Center(child: CircularProgressIndicator()),
        ),
      );
    }
    final done = ref.watch(photosFilterSearchProvider.select((s) => s.nextPage == null));
    if (!done) {
      return const SliverToBoxAdapter(child: SizedBox.shrink());
    }
    return SliverToBoxAdapter(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 24),
        child: Center(child: Text(context.t.search_no_more_result)),
      ),
    );
  }
}

class PhotosTimelineAppBar extends StatelessWidget {
  const PhotosTimelineAppBar({super.key});

  // Filter/search is reached from the bottom-nav search button (GallerySearchBlob), and sort now
  // rides the filter subheader alongside the chips it orders — so the app bar keeps only the
  // grouping chip. Every widget here is permanent and 40-50 px wide, which is what keeps the title
  // slot (and therefore the logo) the same width in every state (#1030).
  static const actions = <Widget>[TimelineGroupingSelector.compact()];

  @override
  Widget build(BuildContext context) {
    return const ImmichSliverAppBar(floating: true, pinned: false, snap: false, actions: actions);
  }
}
