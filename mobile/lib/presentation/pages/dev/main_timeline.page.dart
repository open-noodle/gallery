import 'package:auto_route/auto_route.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/feature_message/feature_message_dialog.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_sheet.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/sort_icon_button.widget.dart';
import 'package:immich_mobile/presentation/widgets/memory/memory_lane.widget.dart';
import 'package:immich_mobile/presentation/widgets/photos_filter/filter_subheader.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_empty_state.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_grouping_selector.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_route_scope.dart';
import 'package:immich_mobile/providers/feature_message.provider.dart';
import 'package:immich_mobile/providers/infrastructure/memory.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter_search.provider.dart';
import 'package:immich_mobile/providers/photos_filter/timeline_query.provider.dart';
import 'package:immich_mobile/widgets/common/immich_sliver_app_bar.dart';

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
    final hasMemories = ref.watch(memoryLaneProvider.select((state) => state.value?.isNotEmpty ?? false));
    return TimelineRouteScope(
      timelineServiceBuilder: buildPhotosTimelineRouteService,
      // The main Photos timeline is the only route whose grouping follows and writes
      // the persisted Setting.groupAssetsBy; detail routes open at "All" and keep
      // grouping changes route-local.
      persistGrouping: true,
      child: Stack(
        children: [
          // Read photosFilterSearchProvider from inside the TimelineRouteScope so the
          // paginating notifier driving load-more is the same scoped instance the
          // timeline renders (the page's own ref lives outside the route scope).
          Consumer(
            builder: (context, scopedRef, _) => NotificationListener<ScrollUpdateNotification>(
              onNotification: (n) {
                final m = n.metrics;
                if (m.axis != Axis.vertical) return false;
                final isSheet = n.context?.findAncestorWidgetOfExactType<DraggableScrollableSheet>() != null;
                if (!isSheet && m.maxScrollExtent - m.pixels < m.viewportDimension) {
                  scopedRef.read(photosFilterSearchProvider.notifier).loadMore();
                }
                return false;
              },
              child: Timeline(
                topSliverWidget: const SliverMainAxisGroup(
                  slivers: [
                    PhotosFilterSubheader(),
                    SliverToBoxAdapter(child: MemoryLane()),
                  ],
                ),
                topSliverWidgetHeight: hasMemories ? 200 : 0,
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
    if (!isActive) return const SliverToBoxAdapter(child: SizedBox.shrink());
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
    if (!done) return const SliverToBoxAdapter(child: SizedBox.shrink());
    return SliverToBoxAdapter(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 24),
        child: Center(child: Text('search_no_more_result'.tr())),
      ),
    );
  }
}

class PhotosTimelineAppBar extends StatelessWidget {
  const PhotosTimelineAppBar({super.key});

  // Filter/search is reached from the bottom-nav search button (GallerySearchBlob), so the app bar
  // keeps only the grouping chip and the sort control (the latter shows itself once a search is active).
  static const actions = <Widget>[TimelineGroupingSelector.compact(), SortIconButton()];

  @override
  Widget build(BuildContext context) {
    return const ImmichSliverAppBar(floating: true, pinned: false, snap: false, actions: actions);
  }
}
