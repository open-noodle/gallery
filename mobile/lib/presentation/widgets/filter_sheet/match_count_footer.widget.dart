import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/match_count_label.widget.dart';
import 'package:immich_mobile/providers/photos_filter/filter_sheet.provider.dart';

class MatchCountFooter extends ConsumerWidget {
  const MatchCountFooter({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    return Material(
      color: theme.colorScheme.surface,
      elevation: 6,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 12, 12, 20),
        child: Row(
          children: [
            const Expanded(child: MatchCountLabel()),
            FilledButton.tonal(
              onPressed: () => ref.read(photosFilterSheetProvider.notifier).state = FilterSheetSnap.hidden,
              child: Text('filter_sheet_done'.tr()),
            ),
          ],
        ),
      ),
    );
  }
}
