import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/camera_cascade_section.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/deep_header.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/media_type_section.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/people_section.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/places_cascade_section.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/rating_stars_section.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/tags_section.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/toggles_section.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/when_accordion_section.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_section_id.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/match_count_footer.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/search_bar.widget.dart';
import 'package:immich_mobile/providers/photos_filter/hidden_sections.provider.dart';
import 'package:immich_mobile/routing/router.dart';

/// The Deep snap body. Owns the scroll view, the sticky Done bar, and the
/// PageStorageKey that retains scroll offset across picker pushes (design §6.5).
class DeepContent extends ConsumerWidget {
  final ScrollController scrollController;
  const DeepContent({super.key, required this.scrollController});

  Widget _sectionFor(FilterSectionId id) {
    switch (id) {
      case FilterSectionId.people:
        return Builder(
          key: const Key('deep-section-people-wrapper'),
          builder: (context) => PeopleSectionDeep(
            key: const Key('deep-section-people'),
            onOpenPicker: () => context.pushRoute(const PersonPickerRoute()),
          ),
        );
      case FilterSectionId.places:
        return Builder(
          key: const Key('deep-section-places-wrapper'),
          builder: (context) => PlacesCascadeSection(
            key: const Key('deep-section-places'),
            onOpenPicker: () => context.pushRoute(const PlacesPickerRoute()),
          ),
        );
      case FilterSectionId.tags:
        return Builder(
          key: const Key('deep-section-tags-wrapper'),
          builder: (context) => TagsSectionDeep(
            key: const Key('deep-section-tags'),
            onOpenPicker: () => context.pushRoute(const TagsPickerRoute()),
          ),
        );
      case FilterSectionId.camera:
        return Builder(
          key: const Key('deep-section-camera-wrapper'),
          builder: (context) => CameraCascadeSection(
            key: const Key('deep-section-camera'),
            onOpenPicker: () => context.pushRoute(const CameraPickerRoute()),
          ),
        );
      case FilterSectionId.when:
        return Builder(
          key: const Key('deep-section-when-wrapper'),
          builder: (context) => WhenAccordionSection(
            key: const Key('deep-section-when'),
            onOpenPicker: () => context.pushRoute(const WhenPickerRoute()),
          ),
        );
      case FilterSectionId.rating:
        return const RatingStarsSection(key: Key('deep-section-rating'));
      case FilterSectionId.media:
        return const MediaTypeSection(key: Key('deep-section-media'));
      case FilterSectionId.toggles:
        return const TogglesSection(key: Key('deep-section-toggles'));
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final hidden = ref.watch(hiddenSectionsProvider);
    return Material(
      color: theme.colorScheme.surface,
      elevation: 3,
      borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
      child: Stack(
        children: [
          ListView(
            key: const PageStorageKey('filter-sheet-deep-scroll'),
            controller: scrollController,
            keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
            padding: const EdgeInsets.only(bottom: 88),
            children: [
              const KeyedSubtree(key: Key('deep-header'), child: DeepHeader()),
              const Padding(
                padding: EdgeInsets.fromLTRB(20, 4, 20, 4),
                child: KeyedSubtree(key: Key('deep-search'), child: FilterSheetSearchBar()),
              ),
              for (final id in FilterSectionId.values)
                if (!hidden.contains(id)) _sectionFor(id),
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
