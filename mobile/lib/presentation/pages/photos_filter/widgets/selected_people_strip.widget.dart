import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';

/// Horizontal strip of currently-selected people chips. Hidden (zero-size)
/// when no selections.
class SelectedPeopleStrip extends ConsumerWidget {
  const SelectedPeopleStrip({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final people = ref.watch(photosFilterProvider.select((f) => f.people));
    if (people.isEmpty) return const SizedBox.shrink();

    final list = people.toList();
    return SizedBox(
      height: 48,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
        itemCount: list.length,
        separatorBuilder: (_, _) => const SizedBox(width: 8),
        itemBuilder: (context, i) {
          final PersonDto p = list[i];
          return ConstrainedBox(
            key: Key('selected-chip-${p.id}'),
            constraints: const BoxConstraints(maxWidth: 160),
            child: InputChip(
              label: Text(p.name, overflow: TextOverflow.ellipsis, maxLines: 1),
              deleteIcon: const Icon(Icons.close_rounded, size: 18),
              deleteButtonTooltipMessage: 'remove_filter'.tr(),
              onDeleted: () => ref.read(photosFilterProvider.notifier).togglePerson(p),
            ),
          );
        },
      ),
    );
  }
}
