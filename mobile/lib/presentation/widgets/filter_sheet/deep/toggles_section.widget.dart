import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/collapsible_section.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_section_id.dart';
import 'package:immich_mobile/providers/photos_filter/filter_debounce.provider.dart';
import 'package:immich_mobile/providers/photos_filter/filter_suggestions.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:immich_mobile/providers/photos_filter/section_availability.provider.dart';

/// Adaptive toggles: Favourites, Archived, Not-in-album, Untagged.
/// Each toggle flips independently and its initial state reflects the provider.
class TogglesSection extends ConsumerWidget {
  const TogglesSection({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Immediate: the active-filter escape below must react the instant a filter is set or
    // cleared, not 250 ms later (#910 fix-wave finding 1).
    final display = ref.watch(photosFilterProvider.select((f) => f.display));
    final notifier = ref.read(photosFilterProvider.notifier);

    // Debounced: shares its family key with every other deep-sheet facets consumer, so a burst of
    // taps coalesces into one request instead of firing one per tap (#910 fix-wave finding 1).
    final debouncedFilter = ref.watch(photosFilterDebouncedProvider);
    final facets = ref.watch(photosFilterSuggestionsProvider(debouncedFilter));
    // The whole-scope baseline, shared with sectionAvailabilityProvider (#910 fix-wave finding 2):
    // a facet emptied only by a CROSS-SECTION filter must not pop its switch out mid-session — same
    // rule as the gated sections, generalised in `toggleAvailable`.
    final baseline = ref.watch(baselineFacetsProvider);
    final showFavorites = toggleAvailable(
      activeFilter: display.isFavorite,
      currentFacet: facets.valueOrNull?.hasFavorites,
      baselineFacet: baseline.valueOrNull?.hasFavorites,
    );
    final showNotInAlbum = toggleAvailable(
      activeFilter: display.isNotInAlbum,
      currentFacet: facets.valueOrNull?.hasAssetsNotInAlbum,
      baselineFacet: baseline.valueOrNull?.hasAssetsNotInAlbum,
    );

    return CollapsibleSection(
      sectionId: FilterSectionId.toggles,
      titleKey: 'filter_sheet_deep_toggles_section',
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Never remove the control that clears a filter the user has on. #910
            if (showFavorites)
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
            if (showNotInAlbum)
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
