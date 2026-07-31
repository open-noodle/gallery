import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/collapsible_section.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_section_id.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';

/// Always renders 5 stars (design spec + memory feedback_no_dynamic_rating_media_hiding).
/// Tapping a star sets that rating; tapping the currently-selected star clears it.
class RatingStarsSection extends ConsumerWidget {
  const RatingStarsSection({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final current = ref.watch(photosFilterProvider.select((f) => f.rating.rating.unwrapOrNull));
    return CollapsibleSection(
      sectionId: FilterSectionId.rating,
      titleKey: 'filter_sheet_deep_rating_section',
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 20),
        child: Row(
          children: [
            for (var i = 1; i <= 5; i++)
              IconButton(
                key: Key('rating-star-$i'),
                icon: Icon(i <= (current ?? 0) ? Icons.star_rounded : Icons.star_outline_rounded),
                color: theme.colorScheme.primary,
                onPressed: () {
                  HapticFeedback.selectionClick();
                  ref.read(photosFilterProvider.notifier).setRating(current == i ? null : i);
                },
              ),
          ],
        ),
      ),
    );
  }
}
