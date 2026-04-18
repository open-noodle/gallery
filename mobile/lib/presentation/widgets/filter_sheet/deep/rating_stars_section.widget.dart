import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';

/// Always renders 5 stars (design spec + memory feedback_no_dynamic_rating_media_hiding).
/// Tapping a star sets that rating; tapping the currently-selected star clears it.
class RatingStarsSection extends ConsumerWidget {
  const RatingStarsSection({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final current = ref.watch(photosFilterProvider.select((f) => f.rating.rating));
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 8),
      child: Row(
        children: [
          Expanded(
            child: Text(
              'filter_sheet_deep_rating_section'.tr().toUpperCase(),
              overflow: TextOverflow.ellipsis,
              style: theme.textTheme.labelSmall?.copyWith(letterSpacing: 2, color: theme.colorScheme.outline),
            ),
          ),
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
    );
  }
}
