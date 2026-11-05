import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart' hide Store;
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/extensions/network_capability_extensions.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/providers/infrastructure/platform.provider.dart';
import 'package:immich_mobile/providers/server_info.provider.dart';
import 'package:immich_ui/immich_ui.dart';
import 'package:logging/logging.dart';

// Data Saver video (specs/2026-11-01-data-saver-video-design.md, "Mobile app"). The server can keep a small extra copy
// of each video at /assets/{id}/video/data-saver; on mobile data the viewer streams that copy instead of the normal
// transcode at /assets/{id}/video/playback.

final _log = Logger('DataSaverVideo');

/// `dataSaverVideo` in `GET /server/features`, as the app's server info holds it. False until the features load, on a
/// server that predates the flag, and on stock Immich, so the app never asks a server for a route it lacks.
final dataSaverVideoEnabledProvider = Provider<bool>(
  (ref) => ref.watch(serverInfoProvider.select((info) => info.serverFeatures.dataSaverVideo)),
);

/// The user's "Data Saver on mobile data" switch. On until they turn it off: the copy only exists if the admin chose
/// to make it, and that choice is the opt-in.
final dataSaverVideoOnMobileDataProvider = NotifierProvider<DataSaverVideoPreference, bool>(
  DataSaverVideoPreference.new,
);

class DataSaverVideoPreference extends Notifier<bool> {
  @override
  bool build() => Store.tryGet(StoreKey.dataSaverVideoOnMobileData) ?? true;

  void set(bool value) {
    state = value;
    unawaited(Store.put(StoreKey.dataSaverVideoOnMobileData, value));
  }
}

final remoteVideoRouteProvider = Provider<RemoteVideoRoute>(RemoteVideoRoute.new);

/// Picks the route under `/assets/{id}/` the viewer streams a remote video from when the user has not asked for the
/// original. The network is read once, as the video opens: switching networks mid-video does not swap the stream.
class RemoteVideoRoute {
  static const playback = 'video/playback';
  static const dataSaver = 'video/data-saver';

  final Ref _ref;

  const RemoteVideoRoute(this._ref);

  Future<String> resolve() async {
    if (!_ref.read(dataSaverVideoEnabledProvider) || !_ref.read(dataSaverVideoOnMobileDataProvider)) {
      return playback;
    }
    try {
      final capabilities = await _ref.read(connectivityApiProvider).getCapabilities();
      return capabilities.isUnmetered ? playback : dataSaver;
    } catch (error) {
      // the normal transcode always exists, so a failed check costs data, never playback
      _log.warning('Could not read the network type, playing the normal video: $error');
      return playback;
    }
  }
}

/// The switch in the video viewer settings, shown only when the server offers the copy.
class DataSaverVideoSettingTile extends HookConsumerWidget {
  const DataSaverVideoSettingTile({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final value = useState(ref.read(dataSaverVideoOnMobileDataProvider));

    if (!ref.watch(dataSaverVideoEnabledProvider)) {
      return const SizedBox.shrink();
    }

    return SettingsSwitchListTile(
      valueNotifier: value,
      title: context.t.setting_video_viewer_data_saver_title,
      subtitle: context.t.setting_video_viewer_data_saver_subtitle,
      onChanged: (enabled) => ref.read(dataSaverVideoOnMobileDataProvider.notifier).set(enabled),
    );
  }
}
