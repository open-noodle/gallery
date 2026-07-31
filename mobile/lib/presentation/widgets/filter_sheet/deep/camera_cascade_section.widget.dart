import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/deep_section_scaffold.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_section_id.dart';
import 'package:immich_mobile/providers/photos_filter/camera_model_suggestions.provider.dart';
import 'package:immich_mobile/providers/photos_filter/filter_debounce.provider.dart';
import 'package:immich_mobile/providers/photos_filter/filter_suggestions.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';

/// Preview cap: the deep section's make Wrap shows at most this many chips.
/// The Wrap only renders while no make is selected — selecting one swaps in
/// [_ModelCascade], whose InputChip shows the selection instead.
const int _kPreviewCap = 10;

/// CameraCascadeSection — Deep-snap section for the Camera filter dimension.
///
/// When no make is selected, renders a Wrap of make FilterChips sourced from
/// photosFilterSuggestionsProvider (capped to [_kPreviewCap]). Tapping a make
/// sets filter.camera.make and swaps in a _ModelCascade which shows:
///   - the selected make as an InputChip (× clears it)
///   - a Wrap of model FilterChips from cameraModelSuggestionsProvider(make)
/// A body "Search N cameras →" row below the wrap/cascade delegates to
/// [onOpenPicker] — tapping it opens the full picker.
class CameraCascadeSection extends ConsumerWidget {
  final VoidCallback? onOpenPicker;
  const CameraCascadeSection({super.key, this.onOpenPicker});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final filter = ref.watch(photosFilterDebouncedProvider);
    final async = ref.watch(photosFilterSuggestionsProvider(filter));
    final makesAsync = async.whenData((s) => s.cameraMakes);
    final selectedMake = ref.watch(photosFilterProvider.select((f) => f.camera.make));
    final count = makesAsync.valueOrNull?.length ?? 0;

    return DeepSectionScaffold<String>(
      sectionId: FilterSectionId.camera,
      titleKey: 'filter_sheet_deep_camera_section',
      emptyCaptionKey: 'filter_sheet_deep_empty_camera',
      items: makesAsync,
      onRetry: () => ref.invalidate(photosFilterSuggestionsProvider(filter)),
      childBuilder: (makes) {
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            if (selectedMake == null) _MakeWrap(makes: makes) else _ModelCascade(make: selectedMake),
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
        key: const Key('camera-section-search-more'),
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
              // The translated label already ends in "→" (see filter_sheet_deep_search_n_cameras).
              Expanded(
                child: Text(
                  _searchMoreCamerasLabel(count),
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
/// `EasyLocalization` ancestor. Matches the pattern in `places_cascade_section.widget.dart`.
String _searchMoreCamerasLabel(int count) {
  final variant = count == 1 ? 'one' : 'other';
  return 'filter_sheet_deep_search_n_cameras.$variant'.tr(namedArgs: {'count': '$count'});
}

class _MakeWrap extends ConsumerWidget {
  final List<String> makes;
  const _MakeWrap({required this.makes});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final display = makes.take(_kPreviewCap).toList();
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        for (final make in display)
          FilterChip(
            key: Key('camera-make-$make'),
            label: Text(make),
            selected: false,
            onSelected: (_) {
              HapticFeedback.selectionClick();
              ref.read(photosFilterProvider.notifier).setCamera(SearchCameraFilter(make: make));
            },
          ),
      ],
    );
  }
}

class _ModelCascade extends ConsumerWidget {
  final String make;
  const _ModelCascade({required this.make});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final modelsAsync = ref.watch(cameraModelSuggestionsProvider(make));
    final selectedModel = ref.watch(photosFilterProvider.select((f) => f.camera.model));
    final theme = Theme.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        InputChip(
          key: const Key('camera-make-selected'),
          label: Text(make),
          selected: true,
          selectedColor: theme.colorScheme.primaryContainer,
          onDeleted: () {
            HapticFeedback.selectionClick();
            ref.read(photosFilterProvider.notifier).setCamera(null);
          },
          deleteIcon: const Icon(Icons.close_rounded, key: Key('camera-make-selected-clear')),
        ),
        const SizedBox(height: 8),
        modelsAsync.when(
          data: (models) {
            if (models.isEmpty) return const SizedBox.shrink();
            return Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final model in models)
                  FilterChip(
                    key: Key('camera-model-$model'),
                    label: Text(model),
                    selected: selectedModel == model,
                    onSelected: (_) {
                      HapticFeedback.selectionClick();
                      ref
                          .read(photosFilterProvider.notifier)
                          .setCamera(SearchCameraFilter(make: make, model: selectedModel == model ? null : model));
                    },
                  ),
              ],
            );
          },
          loading: () => const LinearProgressIndicator(),
          error: (_, __) => TextButton.icon(
            onPressed: () => ref.invalidate(cameraModelSuggestionsProvider(make)),
            icon: const Icon(Icons.refresh_rounded),
            label: Text('filter_sheet_load_error_retry'.tr()),
          ),
        ),
      ],
    );
  }
}
