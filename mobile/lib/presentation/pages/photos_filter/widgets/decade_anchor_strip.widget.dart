import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:immich_mobile/providers/photos_filter/temporal_utils.dart';
import 'package:immich_mobile/providers/photos_filter/time_buckets.provider.dart';

/// Horizontal strip of chips — one per decade with at least one photo.
/// Used inside WhenPickerPage as a fast-scroll anchor row above the full
/// year accordion. Populated via `peekDecadesForYears(aggregateYears(buckets))`.
class DecadeAnchorStrip extends ConsumerWidget {
  final ValueChanged<int> onDecade;
  const DecadeAnchorStrip({super.key, required this.onDecade});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final filter = ref.watch(photosFilterProvider);
    final bucketsAsync = ref.watch(timeBucketsProvider(filter));
    final theme = Theme.of(context);

    final decades = bucketsAsync.maybeWhen(
      data: (buckets) => peekDecadesForYears(aggregateYears(buckets)),
      orElse: () => const <DecadeBucket>[],
    );

    if (decades.isEmpty) return const SizedBox.shrink();

    return SizedBox(
      height: 44,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        itemCount: decades.length,
        separatorBuilder: (_, _) => const SizedBox(width: 8),
        itemBuilder: (context, i) {
          final d = decades[i];
          return Material(
            key: Key('when-decade-${d.decadeStart}'),
            color: theme.colorScheme.surfaceContainer,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(14),
              side: BorderSide(color: theme.colorScheme.outlineVariant),
            ),
            child: InkWell(
              borderRadius: BorderRadius.circular(14),
              onTap: () {
                HapticFeedback.selectionClick();
                onDecade(d.decadeStart);
              },
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                child: Text('${d.decadeStart}s', style: theme.textTheme.labelLarge),
              ),
            ),
          );
        },
      ),
    );
  }
}
