import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/manage_sections_sheet.widget.dart';
import 'package:immich_mobile/providers/photos_filter/filter_sheet.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';

class DeepHeader extends ConsumerWidget {
  const DeepHeader({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final isEmpty = ref.watch(photosFilterProvider.select((f) => f.isEmpty));

    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 8, 12, 4),
      child: Row(
        children: [
          IconButton(
            key: const Key('deep-header-close'),
            icon: const Icon(Icons.close_rounded),
            tooltip: 'close'.tr(),
            // Close = dismiss the sheet entirely (hidden), matching Done / system-back /
            // drag-to-dismiss. Progressive collapse (deep → browse) is the scrim-tap / drag.
            onPressed: () => ref.read(photosFilterSheetProvider.notifier).state = FilterSheetSnap.hidden,
          ),
          Expanded(
            child: Text('filter_sheet_title'.tr(), style: theme.textTheme.titleMedium, textAlign: TextAlign.center),
          ),
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              IconButton(
                key: const Key('deep-header-manage'),
                icon: const Icon(Icons.settings_rounded),
                tooltip: 'filter_sheet_deep_manage_sections'.tr(),
                onPressed: () {
                  HapticFeedback.selectionClick();
                  showManageSectionsSheet(context);
                },
              ),
              if (!isEmpty)
                TextButton(
                  key: const Key('deep-header-reset'),
                  onPressed: () {
                    HapticFeedback.mediumImpact();
                    ref.read(photosFilterProvider.notifier).reset();
                  },
                  child: Text('filter_sheet_reset'.tr()),
                ),
            ],
          ),
        ],
      ),
    );
  }
}
