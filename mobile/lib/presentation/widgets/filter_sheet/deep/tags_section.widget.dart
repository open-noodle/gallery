import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/deep_section_scaffold.widget.dart';
import 'package:immich_mobile/providers/photos_filter/filter_debounce.provider.dart';
import 'package:immich_mobile/providers/photos_filter/filter_suggestions.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:openapi/api.dart';

/// TagsSectionDeep — Deep-snap section for the Tags filter dimension.
///
/// Layout: pill-wrap of tag chips (8pt spacing). Data comes from
/// `photosFilterSuggestionsProvider(filter).tags` (top-N bounded server-side
/// per design §8). Wraps in [DeepSectionScaffold] for loading/error/empty.
class TagsSectionDeep extends ConsumerWidget {
  const TagsSectionDeep({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final filter = ref.watch(photosFilterDebouncedProvider);
    final async = ref.watch(photosFilterSuggestionsProvider(filter));
    final tagsAsync = async.whenData((s) => s.tags);

    return DeepSectionScaffold<FilterSuggestionsTagDto>(
      titleKey: 'filter_sheet_deep_tags_section',
      emptyCaptionKey: 'filter_sheet_deep_empty_tags',
      items: tagsAsync,
      onRetry: () => ref.invalidate(photosFilterSuggestionsProvider(filter)),
      childBuilder: (tags) => Wrap(spacing: 8, runSpacing: 8, children: [for (final tag in tags) _TagChip(tag: tag)]),
    );
  }
}

class _TagChip extends ConsumerWidget {
  final FilterSuggestionsTagDto tag;
  const _TagChip({required this.tag});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final selected = ref.watch(photosFilterProvider.select((f) => f.tagIds?.contains(tag.id) == true));
    return FilterChip(
      key: Key('tag-chip-${tag.id}'),
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
  }
}
