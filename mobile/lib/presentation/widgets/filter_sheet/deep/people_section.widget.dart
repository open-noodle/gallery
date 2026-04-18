import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/deep_section_scaffold.widget.dart';
import 'package:immich_mobile/presentation/widgets/images/remote_image_provider.dart';
import 'package:immich_mobile/providers/photos_filter/filter_debounce.provider.dart';
import 'package:immich_mobile/providers/photos_filter/filter_suggestions.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:immich_mobile/utils/image_url_builder.dart';
import 'package:openapi/api.dart';

/// PeopleSectionDeep — Deep-snap section for the People filter dimension.
///
/// Layout: circular-avatar wrap grid (52pt avatars, 62pt tile), 14pt gap.
/// Trailing header shows a "Search N people →" affordance that delegates to
/// [onOpenPicker] — tapping the header opens a full picker (wired later).
class PeopleSectionDeep extends ConsumerWidget {
  final VoidCallback? onOpenPicker;
  const PeopleSectionDeep({super.key, this.onOpenPicker});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final filter = ref.watch(photosFilterDebouncedProvider);
    final async = ref.watch(photosFilterSuggestionsProvider(filter));
    final peopleAsync = async.whenData((s) => s.people);

    final count = peopleAsync.valueOrNull?.length ?? 0;
    final showTrailing = count > 0;

    return DeepSectionScaffold<FilterSuggestionsPersonDto>(
      titleKey: 'filter_sheet_deep_people_section',
      emptyCaptionKey: 'filter_sheet_deep_empty_people',
      items: peopleAsync,
      onRetry: () => ref.invalidate(photosFilterSuggestionsProvider(filter)),
      trailingHeader: showTrailing
          ? TextButton(
              key: const Key('people-section-search-more'),
              onPressed: () {
                HapticFeedback.selectionClick();
                onOpenPicker?.call();
              },
              child: Text(_searchMoreLabel(count)),
            )
          : null,
      childBuilder: (people) =>
          Wrap(spacing: 14, runSpacing: 14, children: [for (final p in people) _PeopleGridTile(person: p)]),
    );
  }
}

/// Plural helper — nested-leaf lookup avoids `.plural()`, which reads a
/// late-initialized locale field and throws in widget tests without an
/// `EasyLocalization` ancestor. Matches the pattern in
/// `match_count_label.widget.dart`.
String _searchMoreLabel(int count) {
  final variant = count == 1 ? 'one' : 'other';
  return 'filter_sheet_deep_search_n_people.$variant'.tr(namedArgs: {'count': '$count'});
}

class _PeopleGridTile extends ConsumerWidget {
  final FilterSuggestionsPersonDto person;
  const _PeopleGridTile({required this.person});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final isSelected = ref.watch(photosFilterProvider.select((f) => f.people.any((p) => p.id == person.id)));
    return SizedBox(
      key: Key('people-tile-${person.id}'),
      width: 62,
      child: InkWell(
        borderRadius: BorderRadius.circular(32),
        onTap: () {
          HapticFeedback.selectionClick();
          final notifier = ref.read(photosFilterProvider.notifier);
          final existing = ref.read(photosFilterProvider).people.firstWhereOrNull((p) => p.id == person.id);
          if (existing != null) {
            notifier.togglePerson(existing);
          } else {
            notifier.togglePerson(PersonDto(id: person.id, name: person.name, isHidden: false, thumbnailPath: ''));
          }
        },
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            AnimatedContainer(
              key: Key('people-tile-ring-${person.id}'),
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
              width: 62,
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
