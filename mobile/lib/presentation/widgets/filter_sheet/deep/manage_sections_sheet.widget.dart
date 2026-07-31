import 'dart:async';
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_section_id.dart';
import 'package:immich_mobile/providers/photos_filter/hidden_sections.provider.dart';

Future<void> showManageSectionsSheet(BuildContext context) => showModalBottomSheet<void>(
  context: context,
  showDragHandle: true,
  isScrollControlled: true,
  builder: (_) => const ManageSectionsSheet(),
);

class ManageSectionsSheet extends ConsumerWidget {
  const ManageSectionsSheet({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final hidden = ref.watch(hiddenSectionsProvider);
    return SafeArea(
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 8),
              child: Text('filter_sheet_deep_manage_sections'.tr(), style: theme.textTheme.titleMedium),
            ),
            for (final section in FilterSectionId.values)
              SwitchListTile.adaptive(
                key: Key('manage-section-${section.storageId}'),
                title: Text(section.titleKey.tr()),
                value: !hidden.contains(section),
                onChanged: (visible) {
                  unawaited(HapticFeedback.selectionClick());
                  ref.read(hiddenSectionsProvider.notifier).setVisible(section, visible);
                },
              ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }
}
