import 'dart:async';
import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/strips/strip_scaffold.widget.dart';
import 'package:immich_mobile/providers/photos_filter/filter_debounce.provider.dart';
import 'package:immich_mobile/providers/photos_filter/filter_suggestions.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:immich_mobile/routing/router.dart';
import 'package:openapi/api.dart';

/// Strip cap: at most this many tag chips render before a trailing "+N" tile
/// takes over, opening the full-screen picker instead of an unbounded ListView.
const int _kStripCap = 10;

class TagsStrip extends ConsumerWidget {
  const TagsStrip({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final filter = ref.watch(photosFilterDebouncedProvider);
    final async = ref.watch(photosFilterSuggestionsProvider(filter));
    final items = async.whenData((s) => s.tags);

    return StripScaffold(
      titleKey: 'filter_sheet_tags',
      items: items,
      height: 48,
      onRetry: () => ref.invalidate(photosFilterSuggestionsProvider(filter)),
      childBuilder: (data) {
        final tags = data.cast<FilterSuggestionsTagDto>();
        final shown = tags.take(_kStripCap).toList();
        final overflow = tags.length - shown.length;
        return ListView.separated(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 20),
          itemCount: shown.length + (overflow > 0 ? 1 : 0),
          separatorBuilder: (_, _) => const SizedBox(width: 8),
          itemBuilder: (ctx, i) => i < shown.length ? _TagChip(tag: shown[i]) : _MoreTagChip(count: overflow),
        );
      },
    );
  }
}

class _MoreTagChip extends StatelessWidget {
  final int count;
  const _MoreTagChip({required this.count});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ActionChip(
      key: const Key('tags-strip-more'),
      label: Text('+$count'),
      backgroundColor: theme.colorScheme.surfaceContainerHigh,
      side: BorderSide(color: theme.colorScheme.outlineVariant),
      labelStyle: theme.textTheme.labelLarge?.copyWith(
        color: theme.colorScheme.onSurfaceVariant,
        fontWeight: FontWeight.w600,
      ),
      onPressed: () {
        unawaited(HapticFeedback.selectionClick());
        unawaited(context.pushRoute(const TagsPickerRoute()));
      },
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
