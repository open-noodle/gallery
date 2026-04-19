import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_icon_button.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_sheet.widget.dart';
import 'package:immich_mobile/presentation/widgets/memory/memory_lane.widget.dart';
import 'package:immich_mobile/presentation/widgets/photos_filter/filter_subheader.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.widget.dart';
import 'package:immich_mobile/providers/infrastructure/memory.provider.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
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
  Widget build(BuildContext context) {
    final hasMemories = ref.watch(driftMemoryFutureProvider.select((state) => state.value?.isNotEmpty ?? false));
    return ProviderScope(
      overrides: [timelineServiceProvider.overrideWith((ref) => ref.watch(photosTimelineQueryProvider))],
      child: Stack(
        children: [
          Timeline(
            topSliverWidget: const SliverMainAxisGroup(
              slivers: [
                PhotosFilterSubheader(),
                SliverToBoxAdapter(child: DriftMemoryLane()),
              ],
            ),
            topSliverWidgetHeight: hasMemories ? 200 : 0,
            showStorageIndicator: true,
            appBar: const ImmichSliverAppBar(floating: true, pinned: false, snap: false, actions: [FilterIconButton()]),
          ),
          const FilterSheet(),
        ],
      ),
    );
  }
}
