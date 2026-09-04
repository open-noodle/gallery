import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/deep_section_scaffold.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_section_id.dart';
import 'package:immich_mobile/presentation/widgets/images/remote_image_provider.dart';
import 'package:immich_mobile/providers/photos_filter/filter_debounce.provider.dart';
import 'package:immich_mobile/providers/photos_filter/filter_suggestions.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:immich_mobile/utils/image_url_builder.dart';
import 'package:openapi/api.dart';

/// Preview cap: the deep section shows at most this many avatars by default,
/// plus any selected suggestion beyond the cap (pinned so it stays visible).
const int _kPreviewCap = 6;

/// PeopleSectionDeep — Deep section for the People filter dimension.
///
/// Layout: circular-avatar wrap grid (52pt avatars, 62pt tile), 14pt gap,
/// capped to [_kPreviewCap] avatars (selected suggestions beyond the cap are
/// pinned). A body "Search N people →" row below the grid delegates to
/// [onOpenPicker] — tapping it opens the full picker.
class PeopleSectionDeep extends ConsumerWidget {
  final VoidCallback? onOpenPicker;
  const PeopleSectionDeep({super.key, this.onOpenPicker});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final filter = ref.watch(photosFilterDebouncedProvider);
    final async = ref.watch(photosFilterSuggestionsProvider(filter));
    final peopleAsync = async.whenData((s) => s.people);
    final selectedIds = ref.watch(photosFilterProvider.select((f) => f.people.map((p) => p.id).toSet()));

    final count = peopleAsync.valueOrNull?.length ?? 0;

    return DeepSectionScaffold<FilterSuggestionsPersonDto>(
      sectionId: FilterSectionId.people,
      titleKey: 'filter_sheet_deep_people_section',
      emptyCaptionKey: 'filter_sheet_deep_empty_people',
      items: peopleAsync,
      onRetry: () => ref.invalidate(photosFilterSuggestionsProvider(filter)),
      childBuilder: (people) {
        final firstSix = people.take(_kPreviewCap).toList();
        final overflowSelected = people.skip(_kPreviewCap).where((p) => selectedIds.contains(p.id)).toList();
        final display = [...firstSix, ...overflowSelected];

        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Wrap(spacing: 14, runSpacing: 14, children: [for (final p in display) _PeopleGridTile(person: p)]),
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
        key: const Key('people-section-search-more'),
        borderRadius: BorderRadius.circular(12),
        onTap: () {
          HapticFeedback.selectionClick();
          onOpenPicker?.call();
        },
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Row(
            children: [
              Icon(Icons.search_rounded, size: 18, color: theme.colorScheme.primary),
              const SizedBox(width: 10),
              // The translated label already ends in "→" (see filter_sheet_deep_search_n_people).
              Expanded(
                child: Text(
                  _searchMoreLabel(count),
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
                backgroundImage: RemoteImageProvider(url: photosFilterPersonThumbnailUrl(person)),
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
