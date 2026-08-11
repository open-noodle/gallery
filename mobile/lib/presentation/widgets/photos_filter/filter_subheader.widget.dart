import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/active_filter_chip.widget.dart';
import 'package:immich_mobile/providers/photos_filter/active_chips.dart';
import 'package:immich_mobile/providers/photos_filter/filter_debounce.provider.dart';
import 'package:immich_mobile/providers/photos_filter/filter_suggestions.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';

/// Top-of-timeline active-filters summary. Returns a sliver that collapses to
/// zero height when no filters are active, otherwise renders a single-line
/// strip: a pinned leading Clear-all chip followed by horizontally scrollable
/// active-filter chips that take the full remaining width. Taps on each chip's
/// × remove that chip; Clear all wipes the entire filter. Sort lives in the
/// app bar ([SortIconButton]) and the live match count in the filter-sheet
/// footer — neither competes for room here. The filter sheet snap state is
/// untouched — the user can interact with this bar with the sheet open or closed.
class PhotosFilterSubheader extends ConsumerWidget {
  const PhotosFilterSubheader({super.key});

  static const _stripHeight = 44.0;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isFilterEmpty = ref.watch(photosFilterProvider.select((f) => f.isEmpty));
    if (isFilterEmpty) return const SliverToBoxAdapter(child: SizedBox.shrink());

    final filter = ref.watch(photosFilterProvider);
    final debounced = ref.watch(photosFilterDebouncedProvider);
    final suggestions = ref.watch(photosFilterSuggestionsProvider(debounced)).valueOrNull;
    final chips = activeChipsFromFilter(filter, suggestions: suggestions);
    final theme = Theme.of(context);

    return SliverToBoxAdapter(
      child: Container(
        key: const Key('photos-filter-subheader'),
        height: _stripHeight,
        color: theme.colorScheme.surface,
        child: Row(
          children: [
            const SizedBox(width: 16),
            _ClearAllChip(
              onTap: () {
                unawaited(HapticFeedback.selectionClick());
                ref.read(photosFilterProvider.notifier).reset();
              },
            ),
            const SizedBox(width: 10),
            Expanded(
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                itemCount: chips.length,
                padding: const EdgeInsets.symmetric(vertical: 6),
                separatorBuilder: (_, _) => const SizedBox(width: 8),
                itemBuilder: (_, i) {
                  final chip = chips[i];
                  return Center(child: ActiveFilterChip(spec: chip));
                },
              ),
            ),
            const SizedBox(width: 16),
          ],
        ),
      ),
    );
  }
}

class _ClearAllChip extends StatelessWidget {
  final VoidCallback onTap;
  const _ClearAllChip({required this.onTap});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Semantics(
      button: true,
      label: context.t.clear_all,
      child: Material(
        key: const Key('photos-filter-subheader-clear-all'),
        color: theme.colorScheme.primary.withValues(alpha: theme.brightness == Brightness.dark ? 0.16 : 0.22),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
        child: InkWell(
          onTap: onTap,
          customBorder: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.close_rounded, size: 16, color: theme.colorScheme.primary),
                const SizedBox(width: 4),
                Text(
                  context.t.clear_all,
                  style: theme.textTheme.labelLarge?.copyWith(color: theme.colorScheme.primary),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
