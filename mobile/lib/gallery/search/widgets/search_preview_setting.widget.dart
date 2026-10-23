import 'dart:async';

import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/search/search_mode.provider.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_ui/immich_ui.dart';

/// Advanced settings → "New search (preview)". Off: the search button opens today's filter sheet. On: it opens search
/// mode on Photos. Temporary: Slice 5 makes search mode the only search and removes this switch.
class SearchPreviewSetting extends ConsumerStatefulWidget {
  const SearchPreviewSetting({super.key});

  @override
  ConsumerState<SearchPreviewSetting> createState() => _SearchPreviewSettingState();
}

class _SearchPreviewSettingState extends ConsumerState<SearchPreviewSetting> {
  late final _value = ValueNotifier<bool>(ref.read(searchPreviewEnabledProvider));

  @override
  void dispose() {
    _value.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    _value.value = ref.watch(searchPreviewEnabledProvider);
    return SettingsSwitchListTile(
      key: const Key('search-preview-setting'),
      valueNotifier: _value,
      title: context.t.search_mode_preview_title,
      subtitle: context.t.search_mode_preview_subtitle,
      onChanged: (value) => unawaited(ref.read(searchPreviewEnabledProvider.notifier).set(value)),
    );
  }
}
