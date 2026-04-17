import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/strips/strip_scaffold.widget.dart';
import 'package:immich_mobile/presentation/widgets/images/remote_image_provider.dart';
import 'package:immich_mobile/providers/photos_filter/filter_debounce.provider.dart';
import 'package:immich_mobile/providers/photos_filter/filter_suggestions.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:immich_mobile/utils/image_url_builder.dart';
import 'package:openapi/api.dart';

class PeopleStrip extends ConsumerWidget {
  const PeopleStrip({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final filter = ref.watch(photosFilterDebouncedProvider);
    final async = ref.watch(photosFilterSuggestionsProvider(filter));
    final items = async.whenData((s) => s.people);

    return StripScaffold(
      titleKey: 'filter_sheet_people',
      items: items,
      height: 80,
      onRetry: () => ref.invalidate(photosFilterSuggestionsProvider(filter)),
      childBuilder: (data) => ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 20),
        itemCount: data.length,
        separatorBuilder: (_, _) => const SizedBox(width: 10),
        itemBuilder: (ctx, i) => _PersonTile(person: data[i] as FilterSuggestionsPersonDto),
      ),
    );
  }
}

class _PersonTile extends ConsumerWidget {
  final FilterSuggestionsPersonDto person;
  const _PersonTile({required this.person});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final isSelected = ref.watch(photosFilterProvider.select((f) => f.people.any((p) => p.id == person.id)));
    return SizedBox(
      width: 58,
      child: InkWell(
        borderRadius: BorderRadius.circular(32),
        onTap: () {
          HapticFeedback.selectionClick();
          final existing = ref.read(photosFilterProvider).people.firstWhereOrNull((p) => p.id == person.id);
          if (existing != null) {
            ref.read(photosFilterProvider.notifier).togglePerson(existing);
          } else {
            final minimal = PersonDto(id: person.id, name: person.name, isHidden: false, thumbnailPath: '');
            ref.read(photosFilterProvider.notifier).togglePerson(minimal);
          }
        },
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            AnimatedContainer(
              duration: const Duration(milliseconds: 180),
              curve: Curves.easeOut,
              width: 52,
              height: 52,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: isSelected ? Border.all(color: theme.colorScheme.primary, width: 2) : null,
                boxShadow: isSelected
                    ? [BoxShadow(color: theme.colorScheme.primary.withValues(alpha: 0.32), blurRadius: 14)]
                    : null,
              ),
              child: CircleAvatar(
                radius: 24,
                backgroundImage: RemoteImageProvider(url: getFaceThumbnailUrl(person.id)),
              ),
            ),
            const SizedBox(height: 6),
            SizedBox(
              width: 58,
              child: Text(
                person.name,
                textAlign: TextAlign.center,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.labelSmall?.copyWith(
                  fontSize: 10.5,
                  color: isSelected ? theme.colorScheme.primary : theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

extension<E> on Iterable<E> {
  E? firstWhereOrNull(bool Function(E) test) {
    for (final e in this) {
      if (test(e)) return e;
    }
    return null;
  }
}
