import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';

/// Three adaptive toggles: Favourites, Archived, Not-in-album.
/// Each toggle flips independently and its initial state reflects the provider.
class TogglesSection extends ConsumerWidget {
  const TogglesSection({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final display = ref.watch(photosFilterProvider.select((f) => f.display));
    final notifier = ref.read(photosFilterProvider.notifier);

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(bottom: 4),
            child: Text(
              'filter_sheet_deep_toggles_section'.tr().toUpperCase(),
              style: theme.textTheme.labelSmall?.copyWith(letterSpacing: 2, color: theme.colorScheme.outline),
            ),
          ),
          SwitchListTile.adaptive(
            key: const Key('toggle-favourites'),
            contentPadding: EdgeInsets.zero,
            title: Text('filter_sheet_favourites'.tr()),
            value: display.isFavorite,
            onChanged: (v) {
              HapticFeedback.selectionClick();
              notifier.setFavouritesOnly(v);
            },
          ),
          SwitchListTile.adaptive(
            key: const Key('toggle-archived'),
            contentPadding: EdgeInsets.zero,
            title: Text('filter_sheet_archived'.tr()),
            value: display.isArchive,
            onChanged: (v) {
              HapticFeedback.selectionClick();
              notifier.setArchivedIncluded(v);
            },
          ),
          SwitchListTile.adaptive(
            key: const Key('toggle-not-in-album'),
            contentPadding: EdgeInsets.zero,
            title: Text('filter_sheet_not_in_album'.tr()),
            value: display.isNotInAlbum,
            onChanged: (v) {
              HapticFeedback.selectionClick();
              notifier.setNotInAlbum(v);
            },
          ),
        ],
      ),
    );
  }
}
