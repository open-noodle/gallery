import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/providers/infrastructure/tag.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';

/// Horizontal strip of currently-selected tag chips (full-path label).
/// Hidden (zero-size) when no selections. Resolves each selected tag id to
/// its full-path value via [tagProvider]; if a selected id isn't resolvable
/// (e.g. offline / not yet loaded), falls back to `filter_sheet_tag_fallback`
/// so the chip stays visible and removable.
class SelectedTagsStrip extends ConsumerWidget {
  const SelectedTagsStrip({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tagIds = ref.watch(photosFilterProvider.select((f) => f.tagIds ?? const <String>[]));
    if (tagIds.isEmpty) return const SizedBox.shrink();

    final tagsById = {for (final t in ref.watch(tagProvider).valueOrNull ?? const {}) t.id: t.value};

    return SizedBox(
      height: 48,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
        itemCount: tagIds.length,
        separatorBuilder: (_, _) => const SizedBox(width: 8),
        itemBuilder: (context, i) {
          final id = tagIds[i];
          final label = tagsById[id] ?? context.t.filter_sheet_tag_fallback;
          return ConstrainedBox(
            key: Key('selected-tag-chip-$id'),
            constraints: const BoxConstraints(maxWidth: 220),
            child: InputChip(
              label: Text(label, overflow: TextOverflow.ellipsis, maxLines: 1),
              deleteIcon: const Icon(Icons.close_rounded, size: 18),
              deleteButtonTooltipMessage: context.t.remove_filter,
              onDeleted: () => ref.read(photosFilterProvider.notifier).toggleTag(id),
            ),
          );
        },
      ),
    );
  }
}
