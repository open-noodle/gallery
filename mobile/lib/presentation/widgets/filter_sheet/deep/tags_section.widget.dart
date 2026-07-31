import 'dart:async';
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/deep_section_scaffold.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_section_id.dart';
import 'package:immich_mobile/providers/photos_filter/filter_debounce.provider.dart';
import 'package:immich_mobile/providers/photos_filter/filter_suggestions.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:openapi/api.dart';

/// Preview cap: the deep section shows at most this many chips by default,
/// plus any selected suggestion beyond the cap (pinned so it stays visible).
const int _kPreviewCap = 10;

/// TagsSectionDeep — Deep-snap section for the Tags filter dimension.
///
/// Layout: pill-wrap of tag chips (8pt spacing), capped to [_kPreviewCap]
/// (selected suggestions beyond the cap are pinned). Data comes from
/// `photosFilterSuggestionsProvider(filter).tags` (top-N bounded server-side
/// per design §8). A body "Search N tags →" row below the wrap delegates to
/// [onOpenPicker] — tapping it opens the full picker. Wraps in
/// [DeepSectionScaffold] for loading/error/empty.
class TagsSectionDeep extends ConsumerWidget {
  final VoidCallback? onOpenPicker;
  const TagsSectionDeep({super.key, this.onOpenPicker});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final filter = ref.watch(photosFilterDebouncedProvider);
    final async = ref.watch(photosFilterSuggestionsProvider(filter));
    final tagsAsync = async.whenData((s) => s.tags);
    final selectedIds = ref.watch(photosFilterProvider.select((f) => f.tagIds?.toSet() ?? const <String>{}));

    final count = tagsAsync.valueOrNull?.length ?? 0;

    return DeepSectionScaffold<FilterSuggestionsTagDto>(
      sectionId: FilterSectionId.tags,
      titleKey: 'filter_sheet_deep_tags_section',
      emptyCaptionKey: 'filter_sheet_deep_empty_tags',
      items: tagsAsync,
      onRetry: () => ref.invalidate(photosFilterSuggestionsProvider(filter)),
      childBuilder: (tags) {
        final firstTen = tags.take(_kPreviewCap).toList();
        final overflowSelected = tags.skip(_kPreviewCap).where((t) => selectedIds.contains(t.id)).toList();
        final display = [...firstTen, ...overflowSelected];

        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Wrap(spacing: 8, runSpacing: 8, children: [for (final tag in display) _TagChip(tag: tag)]),
            if (count > 0) _SearchMoreRow(count: count, onOpenPicker: onOpenPicker),
          ],
        );
      },
    );
  }
}

class _SearchMoreRow extends StatelessWidget {
  final int count;
  final VoidCallback? onOpenPicker;
  const _SearchMoreRow({required this.count, this.onOpenPicker});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: InkWell(
        key: const Key('tags-section-search-more'),
        borderRadius: BorderRadius.circular(12),
        onTap: () {
          unawaited(HapticFeedback.selectionClick());
          onOpenPicker?.call();
        },
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Row(
            children: [
              Icon(Icons.search_rounded, size: 18, color: theme.colorScheme.primary),
              const SizedBox(width: 10),
              // The translated label already ends in "→" (see filter_sheet_deep_search_n_tags).
              Expanded(
                child: Text(
                  _searchMoreTagsLabel(count),
                  style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.primary),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Plural helper — nested-leaf lookup avoids `.plural()`, which reads a
/// late-initialized locale field and throws in widget tests without an
/// `EasyLocalization` ancestor. Matches the pattern in `when_accordion_section.widget.dart`.
String _searchMoreTagsLabel(int count) {
  final variant = count == 1 ? 'one' : 'other';
  return 'filter_sheet_deep_search_n_tags.$variant'.tr(namedArgs: {'count': '$count'});
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
        unawaited(HapticFeedback.selectionClick());
        ref.read(photosFilterProvider.notifier).toggleTag(tag.id);
      },
    );
  }
}
