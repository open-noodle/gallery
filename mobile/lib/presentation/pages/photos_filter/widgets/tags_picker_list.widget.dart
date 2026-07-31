import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/tag.model.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';

/// Windowed flat list of [tags] under a single "MATCHES" bucket header —
/// unlike the People picker (A–Z buckets) tags have no natural alpha
/// grouping worth scrubbing, so this is one ListView.builder over
/// [header, ...rows] rather than a per-letter index. Never a Wrap/Column
/// over the full list — this must stay windowed for tens of thousands of tags.
class TagsPickerList extends StatelessWidget {
  final List<Tag> tags;
  const TagsPickerList({super.key, required this.tags});

  @override
  Widget build(BuildContext context) {
    return ListView.builder(
      key: const Key('tags-picker-list'),
      itemCount: tags.length + 1,
      itemBuilder: (context, i) {
        if (i == 0) {
          return const _MatchesHeader();
        }
        return _TagRow(tag: tags[i - 1]);
      },
    );
  }
}

class _MatchesHeader extends StatelessWidget {
  const _MatchesHeader();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      key: const Key('tags-picker-matches-header'),
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 6),
      child: Text(
        'filter_sheet_picker_tags_matches'.tr().toUpperCase(),
        style: theme.textTheme.labelMedium?.copyWith(color: theme.colorScheme.primary, fontWeight: FontWeight.w600),
      ),
    );
  }
}

class _TagRow extends ConsumerWidget {
  final Tag tag;
  const _TagRow({required this.tag});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isSelected = ref.watch(photosFilterProvider.select((f) => f.tagIds?.contains(tag.id) == true));
    final theme = Theme.of(context);

    final parts = tag.value.split('/');
    final leaf = parts.last;
    final subtitle = parts.length > 1 ? parts.sublist(0, parts.length - 1).join(' / ') : null;

    return InkWell(
      key: Key('tag-row-${tag.id}'),
      onTap: () {
        HapticFeedback.selectionClick();
        ref.read(photosFilterProvider.notifier).toggleTag(tag.id);
      },
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    leaf,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.bodyLarge?.copyWith(
                      color: isSelected ? theme.colorScheme.primary : theme.colorScheme.onSurface,
                      fontWeight: isSelected ? FontWeight.w600 : FontWeight.w400,
                    ),
                  ),
                  if (subtitle != null)
                    Text(
                      subtitle,
                      key: Key('tag-row-subtitle-${tag.id}'),
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline),
                    ),
                ],
              ),
            ),
            if (isSelected)
              Icon(Icons.check_rounded, color: theme.colorScheme.primary, key: Key('tag-row-${tag.id}-check')),
          ],
        ),
      ),
    );
  }
}
