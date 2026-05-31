import 'package:auto_route/auto_route.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/feature_message/feature_message_dialog.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_icon_button.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_sheet.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/sort_icon_button.widget.dart';
import 'package:immich_mobile/presentation/widgets/memory/memory_lane.widget.dart';
import 'package:immich_mobile/presentation/widgets/photos_filter/filter_subheader.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.widget.dart';
import 'package:immich_mobile/providers/feature_message.provider.dart';
import 'package:immich_mobile/providers/infrastructure/memory.provider.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter_search.provider.dart';
import 'package:immich_mobile/providers/photos_filter/timeline_query.provider.dart';
import 'package:immich_mobile/widgets/common/immich_sliver_app_bar.dart';

@RoutePage()
class MainTimelinePage extends ConsumerStatefulWidget {
  const MainTimelinePage({super.key});

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
    return ProviderScope(
      overrides: [timelineServiceProvider.overrideWith((ref) => ref.watch(photosTimelineQueryProvider))],
      child: Stack(
        children: [
          NotificationListener<ScrollUpdateNotification>(
            onNotification: (n) {
              final m = n.metrics;
              if (m.axis != Axis.vertical) return false;
              final isSheet = n.context?.findAncestorWidgetOfExactType<DraggableScrollableSheet>() != null;
              if (!isSheet && m.maxScrollExtent - m.pixels < m.viewportDimension) {
                ref.read(photosFilterSearchProvider.notifier).loadMore();
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
              appBar: const ImmichSliverAppBar(
                floating: true,
                pinned: false,
                snap: false,
                actions: [SortIconButton(), FilterIconButton()],
              ),
              bottomSliverWidget: const _SearchLoadMoreFooter(),
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
