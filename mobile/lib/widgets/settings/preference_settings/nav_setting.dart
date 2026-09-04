import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/providers/infrastructure/settings.provider.dart';
import 'package:immich_mobile/widgets/settings/setting_group_title.dart';
import 'package:immich_mobile/widgets/settings/settings_switch_list_tile.dart';

/// Switches the middle bottom-nav slot between Spaces (default) and Albums.
///
/// Reads and writes through `settingsProvider` / `appConfigProvider` rather than
/// the older `AppSettingsEnum` that [HapticSetting] uses — the former is the
/// backend nearly every settings widget already reads, and the latter is a
/// four-entry holdover.
class NavSetting extends HookConsumerWidget {
  const NavSetting({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final showSpaces = ref.watch(appConfigProvider.select((config) => config.nav.showSpaces));
    final valueNotifier = useValueNotifier(showSpaces);

    // Keep the notifier in step when the value changes anywhere else — the
    // notifier is created once, on first build, from the value at that moment.
    useEffect(() {
      valueNotifier.value = showSpaces;
      return null;
    }, [showSpaces]);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SettingGroupTitle(
          title: context.t.setting_nav_title,
          icon: Icons.navigation_outlined,
        ),
        SettingsSwitchListTile(
          key: const Key('nav-show-spaces-switch'),
          valueNotifier: valueNotifier,
          title: context.t.setting_nav_show_spaces,
          subtitle: context.t.setting_nav_show_spaces_subtitle,
          onChanged: (value) => unawaited(ref.read(settingsProvider).write(SettingsKey.navShowSpaces, value)),
        ),
      ],
    );
  }
}
