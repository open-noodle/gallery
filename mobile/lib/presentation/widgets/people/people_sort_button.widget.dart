import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/providers/infrastructure/settings.provider.dart';

class PeopleSortButton extends ConsumerWidget {
  const PeopleSortButton({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final selected = ref.watch(appConfigProvider.select((config) => config.people.sortBy));

    return MenuAnchor(
      style: MenuStyle(
        elevation: const WidgetStatePropertyAll(1),
        shape: WidgetStateProperty.all(
          const RoundedRectangleBorder(borderRadius: BorderRadius.all(Radius.circular(24))),
        ),
        padding: const WidgetStatePropertyAll(EdgeInsets.all(4)),
      ),
      consumeOutsideTap: true,
      menuChildren: PeopleSortBy.values.map((mode) => _menuItem(context, ref, mode, selected)).toList(),
      builder: (context, controller, child) {
        return IconButton(
          key: const Key('people-sort-button'),
          icon: const Icon(Icons.swap_vert),
          tooltip: context.t.sort_people_by,
          onPressed: () {
            if (controller.isOpen) {
              controller.close();
            } else {
              controller.open();
            }
          },
        );
      },
    );
  }

  Widget _menuItem(BuildContext context, WidgetRef ref, PeopleSortBy mode, PeopleSortBy selected) {
    final isSelected = mode == selected;
    final label = switch (mode) {
      PeopleSortBy.photoCount => context.t.sort_people_most_photos,
      PeopleSortBy.name => context.t.name,
    };

    return MenuItemButton(
      key: Key('people-sort-${mode.name}'),
      leadingIcon: Icon(Icons.check_rounded, color: isSelected ? context.colorScheme.onPrimary : Colors.transparent),
      onPressed: () async {
        await ref.read(settingsProvider).write(SettingsKey.peopleSortBy, mode);
      },
      style: ButtonStyle(
        padding: WidgetStateProperty.all(const EdgeInsets.fromLTRB(12, 12, 24, 12)),
        backgroundColor: WidgetStateProperty.all(isSelected ? context.colorScheme.primary : Colors.transparent),
        shape: WidgetStateProperty.all(
          const RoundedRectangleBorder(borderRadius: BorderRadius.all(Radius.circular(12))),
        ),
      ),
      child: Text(
        label,
        style: context.textTheme.labelLarge?.copyWith(
          color: isSelected ? context.colorScheme.onPrimary : context.colorScheme.onSurface.withAlpha(185),
        ),
      ),
    );
  }
}
