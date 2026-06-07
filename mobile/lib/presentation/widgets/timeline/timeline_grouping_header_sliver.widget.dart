import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_grouping_selector.widget.dart';
import 'package:immich_mobile/providers/timeline/multiselect.provider.dart';

const double kTimelineGroupingHeaderSliverHeight = 56.0;

class TimelineGroupingHeaderSliver extends ConsumerWidget {
  const TimelineGroupingHeaderSliver({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final multiSelectState = ref.watch(multiSelectProvider);
    if (multiSelectState.isEnabled || multiSelectState.forceEnable) {
      return const SliverToBoxAdapter(child: SizedBox.shrink());
    }

    final colors = Theme.of(context).colorScheme;

    return SliverToBoxAdapter(
      key: const Key('timeline-grouping-header-sliver'),
      child: Container(
        height: kTimelineGroupingHeaderSliverHeight,
        color: colors.surface,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
        child: const Row(children: [TimelineGroupingSelector()]),
      ),
    );
  }
}
