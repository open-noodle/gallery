import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
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
            onPressed: () => ref.read(photosFilterSheetProvider.notifier).state = FilterSheetSnap.browse,
          ),
          Expanded(
            child: Text('filter_sheet_title'.tr(), style: theme.textTheme.titleMedium, textAlign: TextAlign.center),
          ),
          // Mirror-width placeholder keeps the title centered when Reset hides.
          // IconButton has a default 48×48 hit area; the placeholder matches.
          if (!isEmpty)
            TextButton(
              key: const Key('deep-header-reset'),
              onPressed: () {
                HapticFeedback.mediumImpact();
                ref.read(photosFilterProvider.notifier).reset();
              },
              child: Text('filter_sheet_reset'.tr()),
            )
          else
            const SizedBox(width: 48, height: 48),
        ],
      ),
    );
  }
}
