import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/collapsible_section.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_section_id.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';

/// Adaptive toggles: Favourites, Archived, Not-in-album, Untagged.
/// Each toggle flips independently and its initial state reflects the provider.
class TogglesSection extends ConsumerWidget {
  const TogglesSection({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final display = ref.watch(photosFilterProvider.select((f) => f.display));
    final notifier = ref.read(photosFilterProvider.notifier);

    return CollapsibleSection(
      sectionId: FilterSectionId.toggles,
      titleKey: 'filter_sheet_deep_toggles_section',
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SwitchListTile.adaptive(
              key: const Key('toggle-favourites'),
              contentPadding: EdgeInsets.zero,
              title: Text(context.t.filter_sheet_favourites),
              value: display.isFavorite,
              onChanged: (v) {
                unawaited(HapticFeedback.selectionClick());
                notifier.setFavouritesOnly(v);
              },
            ),
            SwitchListTile.adaptive(
              key: const Key('toggle-archived'),
              contentPadding: EdgeInsets.zero,
              title: Text(context.t.filter_sheet_archived),
              value: display.isArchive,
              onChanged: (v) {
                unawaited(HapticFeedback.selectionClick());
                notifier.setArchivedIncluded(v);
              },
            ),
            SwitchListTile.adaptive(
              key: const Key('toggle-not-in-album'),
              contentPadding: EdgeInsets.zero,
              title: Text(context.t.filter_sheet_not_in_album),
              value: display.isNotInAlbum,
              onChanged: (v) {
                unawaited(HapticFeedback.selectionClick());
                notifier.setNotInAlbum(v);
              },
            ),
            SwitchListTile.adaptive(
              key: const Key('toggle-untagged'),
              contentPadding: EdgeInsets.zero,
              title: Text(context.t.untagged),
              value: display.isUntagged,
              onChanged: (v) {
                unawaited(HapticFeedback.selectionClick());
                notifier.setUntagged(v);
              },
            ),
          ],
        ),
      ),
    );
  }
}
