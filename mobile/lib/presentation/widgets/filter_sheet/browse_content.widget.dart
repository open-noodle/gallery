import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/drag_handle.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_section_id.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/match_count_footer.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/search_bar.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/strips/camera_strip.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/strips/people_strip.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/strips/places_strip.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/strips/tags_strip.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/strips/when_strip.widget.dart';
import 'package:immich_mobile/providers/photos_filter/filter_sheet.provider.dart';
import 'package:immich_mobile/providers/photos_filter/hidden_sections.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';

class BrowseContent extends ConsumerWidget {
  final ScrollController scrollController;
  const BrowseContent({super.key, required this.scrollController});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final isEmpty = ref.watch(photosFilterProvider.select((f) => f.isEmpty));
    final hidden = ref.watch(hiddenSectionsProvider);

    return Material(
      color: theme.colorScheme.surface,
      elevation: 3,
      borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
      child: Stack(
        children: [
          ListView(
            controller: scrollController,
            keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
            children: [
              const DragHandle(),
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 0, 12, 8),
                child: Row(
                  children: [
                    Text(context.t.filter_sheet_title, style: theme.textTheme.titleMedium),
                    const Spacer(),
                    if (!isEmpty)
                      TextButton(
                        onPressed: () {
                          unawaited(HapticFeedback.mediumImpact());
                          ref.read(photosFilterProvider.notifier).reset();
                        },
                        child: Text(context.t.filter_sheet_reset),
                      ),
                  ],
                ),
              ),
              const Padding(padding: EdgeInsets.fromLTRB(20, 6, 20, 0), child: FilterSheetSearchBar()),
              const SizedBox(height: 18),
              // Mirrors the Deep view's "Manage sections" visibility (#1002) — a
              // section hidden there must stay hidden here too, not just reappear
              // whenever the sheet collapses from deep to browse.
              if (!hidden.contains(FilterSectionId.people)) const PeopleStrip(),
              if (!hidden.contains(FilterSectionId.places)) const PlacesStrip(),
              if (!hidden.contains(FilterSectionId.tags)) const TagsStrip(),
              if (!hidden.contains(FilterSectionId.camera)) const CameraStrip(),
              if (!hidden.contains(FilterSectionId.when)) const WhenStrip(),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 4),
                child: Align(
                  alignment: Alignment.centerRight,
                  child: TextButton.icon(
                    key: const Key('browse-see-all'),
                    onPressed: () => ref.read(photosFilterSheetProvider.notifier).state = FilterSheetSnap.deep,
                    icon: const Icon(Icons.expand_less_rounded),
                    label: Text(context.t.filter_sheet_browse_see_all),
                  ),
                ),
              ),
              // Clears the MatchCountFooter stacked on top of this list — it grows
              // by the system nav bar inset on Android, and the last row has to
              // clear all of it.
              SizedBox(height: MatchCountFooter.reservedHeightFor(context)),
            ],
          ),
          const Positioned(left: 0, right: 0, bottom: 0, child: MatchCountFooter()),
        ],
      ),
    );
  }
}
