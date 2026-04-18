import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/active_filter_chip.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/drag_handle.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/match_count_label.widget.dart';
import 'package:immich_mobile/providers/photos_filter/active_chips.dart';
import 'package:immich_mobile/providers/photos_filter/filter_debounce.provider.dart';
import 'package:immich_mobile/providers/photos_filter/filter_sheet.provider.dart';
import 'package:immich_mobile/providers/photos_filter/filter_suggestions.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';

class PeekContent extends ConsumerWidget {
  final ScrollController scrollController;
  const PeekContent({super.key, required this.scrollController});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final filter = ref.watch(photosFilterProvider);
    final debounced = ref.watch(photosFilterDebouncedProvider);
    final suggestions = ref.watch(photosFilterSuggestionsProvider(debounced)).valueOrNull;
    final chips = activeChipsFromFilter(filter, suggestions: suggestions);

    return Material(
      color: theme.colorScheme.surface,
      elevation: 8,
      borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
      child: ListView(
        controller: scrollController,
        children: [
          DragHandle(
            onTap: () {
              ref.read(photosFilterSheetProvider.notifier).state = FilterSheetSnap.browse;
            },
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 4, 20, 18),
            child: Row(
              children: [
                Expanded(
                  child: ShaderMask(
                    shaderCallback: (r) => const LinearGradient(
                      colors: [Colors.transparent, Colors.black, Colors.black, Colors.transparent],
                      stops: [0, 0.05, 0.95, 1],
                    ).createShader(r),
                    blendMode: BlendMode.dstIn,
                    child: SizedBox(
                      height: 32,
                      child: ListView.separated(
                        scrollDirection: Axis.horizontal,
                        itemCount: chips.length,
                        padding: EdgeInsets.zero,
                        separatorBuilder: (_, _) => const SizedBox(width: 8),
                        itemBuilder: (_, i) => ActiveFilterChip(spec: chips[i]),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                const MatchCountLabel(),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
