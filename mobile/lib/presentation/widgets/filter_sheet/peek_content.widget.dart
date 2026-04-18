import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/active_filter_chip.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/drag_handle.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/match_count_label.widget.dart';
import 'package:immich_mobile/providers/gallery_nav/bottom_nav_height.provider.dart';
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

    // §5.6 stacking: pad above the floating nav pill by its published height
    // plus an 8pt visual gap. When the nav is hidden (value == 0), no padding
    // so the peek rail can sit on the screen bottom.
    final navHeight = ref.watch(bottomNavHeightProvider);
    final bottomPad = navHeight == 0 ? 0.0 : navHeight + 8;

    return Material(
      color: theme.colorScheme.surface,
      elevation: 8,
      borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
      child: Padding(
        key: const Key('peek-content-bottom-pad'),
        padding: EdgeInsets.only(bottom: bottomPad),
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
      ),
    );
  }
}
