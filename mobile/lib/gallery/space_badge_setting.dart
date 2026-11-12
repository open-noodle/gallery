import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart' hide Store;
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_ui/immich_ui.dart';

/// The user's "Show space icons on photos" switch: whether timeline tiles carry the space badge. On by default.
final showSpaceBadgesProvider = NotifierProvider<ShowSpaceBadgesPreference, bool>(ShowSpaceBadgesPreference.new);

class ShowSpaceBadgesPreference extends Notifier<bool> {
  @override
  bool build() => Store.tryGet(StoreKey.showSpaceBadges) ?? true;

  void set(bool value) {
    state = value;
    unawaited(Store.put(StoreKey.showSpaceBadges, value));
  }
}

/// The switch in the timeline settings.
class SpaceBadgeSettingTile extends HookConsumerWidget {
  const SpaceBadgeSettingTile({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final value = useValueNotifier(ref.read(showSpaceBadgesProvider));

    return SettingsSwitchListTile(
      valueNotifier: value,
      title: context.t.show_space_badges,
      subtitle: context.t.show_space_badges_description,
      onChanged: (enabled) => ref.read(showSpaceBadgesProvider.notifier).set(enabled),
    );
  }
}
