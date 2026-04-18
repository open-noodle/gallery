import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/presentation/widgets/images/remote_image_provider.dart';
import 'package:immich_mobile/providers/photos_filter/people_picker.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:immich_mobile/utils/image_url_builder.dart';

/// Horizontal strip of the 7 most-recently-updated people. Tapping an avatar
/// toggles that person in `photosFilterProvider.people` (matches Deep People
/// tile behavior).
class RecentPeopleStrip extends ConsumerWidget {
  const RecentPeopleStrip({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(recentPeopleProvider);
    final recent = async.valueOrNull ?? const <PersonDto>[];
    if (recent.isEmpty) return const SizedBox.shrink();

    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(left: 4, bottom: 6),
            child: Text(
              'filter_sheet_picker_recent'.tr(),
              style: theme.textTheme.labelMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
          ),
          SizedBox(
            height: 76,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: recent.length,
              separatorBuilder: (_, _) => const SizedBox(width: 12),
              itemBuilder: (context, i) => _RecentTile(person: recent[i]),
            ),
          ),
        ],
      ),
    );
  }
}

class _RecentTile extends ConsumerWidget {
  final PersonDto person;
  const _RecentTile({required this.person});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final isSelected = ref.watch(photosFilterProvider.select((f) => f.people.any((p) => p.id == person.id)));
    return SizedBox(
      key: Key('recent-person-${person.id}'),
      width: 56,
      child: InkWell(
        borderRadius: BorderRadius.circular(28),
        onTap: () {
          HapticFeedback.selectionClick();
          final notifier = ref.read(photosFilterProvider.notifier);
          final existing = ref.read(photosFilterProvider).people.where((p) => p.id == person.id).firstOrNull;
          if (existing != null) {
            notifier.togglePerson(existing);
          } else {
            notifier.togglePerson(person);
          }
        },
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            AnimatedContainer(
              duration: const Duration(milliseconds: 180),
              width: 48,
              height: 48,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: isSelected ? Border.all(color: theme.colorScheme.primary, width: 2) : null,
              ),
              child: CircleAvatar(
                radius: 22,
                backgroundImage: RemoteImageProvider(url: getFaceThumbnailUrl(person.id)),
              ),
            ),
            const SizedBox(height: 4),
            Text(
              person.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: theme.textTheme.labelSmall?.copyWith(
                color: isSelected ? theme.colorScheme.primary : theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
