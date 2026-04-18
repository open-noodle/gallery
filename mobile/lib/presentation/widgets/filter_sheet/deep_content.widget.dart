import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/deep_header.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/people_section.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/places_cascade_section.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/tags_section.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/match_count_footer.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/search_bar.widget.dart';

/// The Deep snap body. Owns the scroll view, the sticky Done bar, and the
/// PageStorageKey that retains scroll offset across picker pushes (design §6.5).
class DeepContent extends ConsumerWidget {
  final ScrollController scrollController;
  const DeepContent({super.key, required this.scrollController});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    return Material(
      color: theme.colorScheme.surface,
      elevation: 3,
      borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
      child: Stack(
        children: [
          ListView(
            key: const PageStorageKey('filter-sheet-deep-scroll'),
            controller: scrollController,
            padding: const EdgeInsets.only(bottom: 88),
            children: const [
              KeyedSubtree(key: Key('deep-header'), child: DeepHeader()),
              Padding(
                padding: EdgeInsets.fromLTRB(20, 4, 20, 4),
                child: KeyedSubtree(key: Key('deep-search'), child: FilterSheetSearchBar()),
              ),
              PeopleSectionDeep(key: Key('deep-section-people')),
              PlacesCascadeSection(key: Key('deep-section-places')),
              TagsSectionDeep(key: Key('deep-section-tags')),
              SizedBox(height: 8, key: Key('deep-section-when')),
              SizedBox(height: 8, key: Key('deep-section-rating')),
              SizedBox(height: 8, key: Key('deep-section-media')),
              SizedBox(height: 8, key: Key('deep-section-toggles')),
            ],
          ),
          const Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: KeyedSubtree(key: Key('deep-done-bar'), child: MatchCountFooter()),
          ),
        ],
      ),
    );
  }
}
