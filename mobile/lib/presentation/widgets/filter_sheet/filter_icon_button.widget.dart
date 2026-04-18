import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/photos_filter/filter_sheet.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';

/// App-bar entry point for the Photos filter sheet.
///
/// Tap always opens the sheet at [FilterSheetSnap.browse] (design §7
/// "Filter icon tap when Peek rail is already visible"). Renders a small
/// accent-coloured dot when the filter is non-empty.
class FilterIconButton extends ConsumerWidget {
  const FilterIconButton({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isEmpty = ref.watch(photosFilterProvider.select((f) => f.isEmpty));
    final colors = Theme.of(context).colorScheme;

    return Semantics(
      button: true,
      label: isEmpty ? 'filter'.tr() : 'filter_button_active'.tr(),
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          IconButton(
            icon: const Icon(Icons.tune_rounded),
            onPressed: () {
              ref.read(photosFilterSheetProvider.notifier).state = FilterSheetSnap.browse;
            },
          ),
          if (!isEmpty)
            Positioned(
              top: 8,
              right: 8,
              child: Container(
                key: const Key('filter-active-dot'),
                width: 8,
                height: 8,
                decoration: BoxDecoration(
                  color: colors.primary,
                  shape: BoxShape.circle,
                  border: Border.all(color: colors.surface, width: 1.5),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
