import 'package:flutter/material.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_filters.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/utils/bytes_units.dart';
import 'package:openapi/api.dart';

/// The minimum sizes Space hogs offers, as on web (`CLEANUP_SPACE_HOG_MIN_SIZES`).
const libraryCleanupSpaceHogMinSizes = [52428800, 104857600, 524288000, 1073741824];

/// The ⋯ menu's filters for a queue (the web's per-queue toolbar): Blurry's reason, strictness and hide faces, Space
/// hogs' type and minimum size. Changes are collected while the sheet is open and resolve when it closes, however it
/// closes, so one change of mind is one reload. Resolves to the filters as left (the same ones when nothing changed).
Future<LibraryCleanupFilters> showLibraryCleanupFiltersSheet(
  BuildContext context,
  LibraryCleanupFilters filters,
) async {
  final draft = ValueNotifier(filters);
  await showModalBottomSheet<void>(
    context: context,
    showDragHandle: true,
    isScrollControlled: true,
    builder: (context) => _FiltersSheet(draft: draft),
  );
  final chosen = draft.value;
  draft.dispose();
  return chosen;
}

class _FiltersSheet extends StatelessWidget {
  const _FiltersSheet({required this.draft});

  final ValueNotifier<LibraryCleanupFilters> draft;

  @override
  Widget build(BuildContext context) {
    final t = context.t;
    final theme = Theme.of(context);
    Widget heading(String text) => Padding(
      padding: const EdgeInsets.only(top: 14, bottom: 8),
      child: Text(text, style: theme.textTheme.labelLarge),
    );
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
        child: ValueListenableBuilder(
          valueListenable: draft,
          builder: (context, filters, _) {
            void set(LibraryCleanupFilters next) => draft.value = next;
            return Column(
              key: const Key('cleanup-filters-sheet'),
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(t.filters, style: theme.textTheme.titleMedium),
                if (filters.isBlurry) ...[
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final (reason, label) in [
                        (CleanupBlurReason.all, t.all),
                        (CleanupBlurReason.blurry, t.cleanup_reason_blurry),
                        (CleanupBlurReason.dark, t.cleanup_reason_dark),
                        (CleanupBlurReason.bright, t.cleanup_reason_bright),
                      ])
                        ChoiceChip(
                          key: Key('cleanup-filter-reason-${reason.toJson()}'),
                          label: Text(label),
                          selected: filters.reason == reason,
                          onSelected: (_) => set(filters.copyWith(reason: reason)),
                        ),
                    ],
                  ),
                  heading(t.cleanup_strictness),
                  SegmentedButton<CleanupStrictness>(
                    showSelectedIcon: false,
                    segments: [
                      for (final (strictness, label) in [
                        (CleanupStrictness.lenient, t.cleanup_strictness_lenient),
                        (CleanupStrictness.balanced, t.cleanup_strictness_balanced),
                        (CleanupStrictness.strict, t.cleanup_strictness_strict),
                      ])
                        ButtonSegment(
                          value: strictness,
                          label: Text(label, key: Key('cleanup-filter-strictness-${strictness.toJson()}')),
                        ),
                    ],
                    selected: {filters.strictness},
                    onSelectionChanged: (selected) => set(filters.copyWith(strictness: selected.single)),
                  ),
                  const SizedBox(height: 8),
                  SwitchListTile(
                    key: const Key('cleanup-filter-hide-faces'),
                    contentPadding: EdgeInsets.zero,
                    title: Text(t.cleanup_hide_faces),
                    value: filters.hideFaces,
                    onChanged: (value) => set(filters.copyWith(hideFaces: value)),
                  ),
                ],
                if (filters.isSpaceHogs) ...[
                  heading(t.type),
                  SegmentedButton<CleanupAssetTypeFilter>(
                    showSelectedIcon: false,
                    segments: [
                      for (final (type, label) in [
                        (CleanupAssetTypeFilter.video, t.videos),
                        (CleanupAssetTypeFilter.image, t.photos),
                        (CleanupAssetTypeFilter.all, t.all),
                      ])
                        ButtonSegment(
                          value: type,
                          label: Text(label, key: Key('cleanup-filter-type-${type.toJson()}')),
                        ),
                    ],
                    selected: {filters.type},
                    onSelectionChanged: (selected) => set(filters.copyWith(type: selected.single)),
                  ),
                  heading(t.cleanup_min_size),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final size in libraryCleanupSpaceHogMinSizes)
                        ChoiceChip(
                          key: Key('cleanup-filter-min-size-$size'),
                          label: Text(formatBytes(size)),
                          selected: filters.minSize == size,
                          onSelected: (_) => set(filters.copyWith(minSize: size)),
                        ),
                    ],
                  ),
                ],
                const SizedBox(height: 18),
                FilledButton(
                  key: const Key('cleanup-filters-done'),
                  onPressed: () => Navigator.of(context).pop(),
                  child: Text(t.done),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}
