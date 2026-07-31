import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/providers/photos_filter/camera_model_suggestions.provider.dart';
import 'package:immich_mobile/providers/photos_filter/camera_picker.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';

/// Full-screen make → model accordion for [CameraPickerPage].
///
/// Reads [cameraPickerMakesProvider] (makes matching the current search
/// query) and renders each as an [InkWell] row; tapping a row both selects
/// the make (`setCamera(SearchCameraFilter(make: m))`, replacing any prior
/// selection) and expands it, collapsing any previously-expanded make.
/// Models are fetched lazily — only once a make is expanded — via
/// [cameraModelSuggestionsProvider], never proactively.
///
/// The host passes [expandedMake] + [onExpandMake] so the page can lift
/// single-expand state (mirrors [PlacesPickerCountryAccordion]'s
/// expandedCountry).
class CameraPickerMakeAccordion extends ConsumerWidget {
  final String? expandedMake;
  final ValueChanged<String?> onExpandMake;

  const CameraPickerMakeAccordion({super.key, required this.expandedMake, required this.onExpandMake});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(cameraPickerMakesProvider);
    final selectedMake = ref.watch(photosFilterProvider.select((f) => f.camera.make));
    final selectedModel = ref.watch(photosFilterProvider.select((f) => f.camera.model));
    final query = ref.watch(cameraPickerQueryProvider).trim().toLowerCase();
    final expanded = expandedMake;

    return async.when(
      loading: () => const SizedBox.shrink(),
      error: (e, st) => const SizedBox.shrink(),
      data: (makes) {
        var display = makes;
        // Search filters makes by name, PLUS any expanded make whose
        // already-loaded models match — without triggering a fetch for it
        // (the single-expand accordion means at most one make's models are
        // cached at a time). No proactive fetch for un-expanded makes.
        if (expanded != null && query.isNotEmpty && !display.contains(expanded)) {
          final cachedModels = ref.watch(cameraModelSuggestionsProvider(expanded)).valueOrNull;
          final hasMatch = cachedModels?.any((m) => m.toLowerCase().contains(query)) ?? false;
          if (hasMatch) {
            display = [...display, expanded];
          }
        }
        if (display.isEmpty) return const SizedBox.shrink();
        return Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (final make in display)
              _MakeRow(
                make: make,
                selected: selectedMake == make,
                selectedModel: selectedMake == make ? selectedModel : null,
                expanded: expanded == make,
                onToggle: () {
                  HapticFeedback.selectionClick();
                  ref.read(photosFilterProvider.notifier).setCamera(SearchCameraFilter(make: make));
                  onExpandMake(expanded == make ? null : make);
                },
              ),
          ],
        );
      },
    );
  }
}

class _MakeRow extends StatelessWidget {
  final String make;
  final bool selected;
  final String? selectedModel;
  final bool expanded;
  final VoidCallback onToggle;

  const _MakeRow({
    required this.make,
    required this.selected,
    required this.selectedModel,
    required this.expanded,
    required this.onToggle,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final highlighted = expanded || selected;
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        InkWell(
          key: Key('camera-picker-make-$make'),
          onTap: onToggle,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    make,
                    style: theme.textTheme.titleMedium?.copyWith(
                      fontWeight: highlighted ? FontWeight.w600 : FontWeight.w500,
                      color: highlighted ? theme.colorScheme.primary : theme.colorScheme.onSurface,
                    ),
                  ),
                ),
                if (selected)
                  Icon(
                    Icons.check_circle_rounded,
                    key: Key('camera-picker-make-$make-check'),
                    size: 18,
                    color: theme.colorScheme.primary,
                  ),
                const SizedBox(width: 8),
                Icon(
                  expanded ? Icons.keyboard_arrow_up_rounded : Icons.keyboard_arrow_down_rounded,
                  color: theme.colorScheme.outline,
                ),
              ],
            ),
          ),
        ),
        if (expanded) _ModelList(make: make, selectedModel: selectedModel),
      ],
    );
  }
}

class _ModelList extends ConsumerWidget {
  final String make;
  final String? selectedModel;
  const _ModelList({required this.make, required this.selectedModel});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final modelsAsync = ref.watch(cameraModelSuggestionsProvider(make));
    // "Already-loaded models" search: once a make is expanded (and its
    // models fetched), the current picker query further narrows the model
    // list too — no extra fetch is triggered by typing.
    final query = ref.watch(cameraPickerQueryProvider).trim().toLowerCase();

    return Padding(
      padding: const EdgeInsets.only(left: 16, right: 20, bottom: 8),
      child: modelsAsync.when(
        data: (models) {
          final filtered = query.isEmpty ? models : models.where((m) => m.toLowerCase().contains(query)).toList();
          if (filtered.isEmpty) return const SizedBox.shrink();
          return Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              for (final model in filtered) _ModelRow(make: make, model: model, selected: selectedModel == model),
            ],
          );
        },
        loading: () =>
            const Padding(padding: EdgeInsets.symmetric(vertical: 12, horizontal: 4), child: LinearProgressIndicator()),
        error: (_, _) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: TextButton.icon(
            onPressed: () => ref.invalidate(cameraModelSuggestionsProvider(make)),
            icon: const Icon(Icons.refresh_rounded),
            label: Text('filter_sheet_load_error_retry'.tr()),
          ),
        ),
      ),
    );
  }
}

class _ModelRow extends ConsumerWidget {
  final String make;
  final String model;
  final bool selected;
  const _ModelRow({required this.make, required this.model, required this.selected});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    return InkWell(
      key: Key('camera-picker-model-$model'),
      onTap: () {
        HapticFeedback.selectionClick();
        ref.read(photosFilterProvider.notifier).setCamera(SearchCameraFilter(make: make, model: model));
      },
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 4),
        child: Row(
          children: [
            Expanded(
              child: Text(
                model,
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: selected ? theme.colorScheme.primary : theme.colorScheme.onSurface,
                  fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
                ),
              ),
            ),
            Icon(
              selected ? Icons.radio_button_checked_rounded : Icons.radio_button_unchecked_rounded,
              size: 20,
              color: selected ? theme.colorScheme.primary : theme.colorScheme.outline,
            ),
          ],
        ),
      ),
    );
  }
}
