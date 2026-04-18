import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/strips/strip_scaffold.widget.dart';
import 'package:immich_mobile/providers/photos_filter/filter_debounce.provider.dart';
import 'package:immich_mobile/providers/photos_filter/filter_suggestions.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:openapi/api.dart';

class TagsStrip extends ConsumerWidget {
  const TagsStrip({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final filter = ref.watch(photosFilterDebouncedProvider);
    final async = ref.watch(photosFilterSuggestionsProvider(filter));
    final items = async.whenData((s) => s.tags);

    final theme = Theme.of(context);
    return StripScaffold(
      titleKey: 'filter_sheet_tags',
      items: items,
      height: 48,
      onRetry: () => ref.invalidate(photosFilterSuggestionsProvider(filter)),
      childBuilder: (data) => ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 20),
        itemCount: data.length,
        separatorBuilder: (_, _) => const SizedBox(width: 8),
        itemBuilder: (ctx, i) {
          final tag = data[i] as FilterSuggestionsTagDto;
          return Consumer(
            builder: (_, ref, _) {
              final selected = ref.watch(photosFilterProvider.select((f) => f.tagIds?.contains(tag.id) == true));
              return FilterChip(
                label: Text(tag.value),
                selected: selected,
                showCheckmark: false,
                backgroundColor: theme.colorScheme.surfaceContainerHigh,
                selectedColor: theme.colorScheme.secondaryContainer,
                side: BorderSide(
                  color: selected ? theme.colorScheme.primary : theme.colorScheme.outlineVariant,
                  width: selected ? 1.5 : 1,
                ),
                labelStyle: theme.textTheme.labelLarge?.copyWith(
                  color: selected ? theme.colorScheme.onSecondaryContainer : theme.colorScheme.onSurface,
                  fontWeight: FontWeight.w500,
                ),
                onSelected: (_) {
                  HapticFeedback.selectionClick();
                  ref.read(photosFilterProvider.notifier).toggleTag(tag.id);
                },
              );
            },
          );
        },
      ),
    );
  }
}
