import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/drag_handle.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/match_count_footer.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/search_bar.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/strips/people_strip.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/strips/places_strip.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/strips/tags_strip.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/strips/when_strip.widget.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';

class BrowseContent extends ConsumerWidget {
  final ScrollController scrollController;
  const BrowseContent({super.key, required this.scrollController});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final isEmpty = ref.watch(photosFilterProvider.select((f) => f.isEmpty));

    return Material(
      color: theme.colorScheme.surface,
      elevation: 3,
      borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
      child: Stack(
        children: [
          ListView(
            controller: scrollController,
            children: [
              const DragHandle(),
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 0, 12, 8),
                child: Row(
                  children: [
                    Text('filter_sheet_title'.tr(), style: theme.textTheme.titleMedium),
                    const Spacer(),
                    if (!isEmpty)
                      TextButton(
                        onPressed: () {
                          HapticFeedback.mediumImpact();
                          ref.read(photosFilterProvider.notifier).reset();
                        },
                        child: Text('filter_sheet_reset'.tr()),
                      ),
                  ],
                ),
              ),
              const Padding(padding: EdgeInsets.fromLTRB(20, 6, 20, 0), child: FilterSheetSearchBar()),
              const SizedBox(height: 18),
              const PeopleStrip(),
              const PlacesStrip(),
              const TagsStrip(),
              const WhenStrip(),
              const SizedBox(height: 88),
            ],
          ),
          const Positioned(left: 0, right: 0, bottom: 0, child: MatchCountFooter()),
        ],
      ),
    );
  }
}
