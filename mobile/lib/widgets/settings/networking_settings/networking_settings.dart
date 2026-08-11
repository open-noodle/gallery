import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart' hide Store;
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/models/auth/auxilary_endpoint.model.dart';
import 'package:immich_mobile/providers/infrastructure/settings.provider.dart';
import 'package:immich_mobile/providers/network.provider.dart';
import 'package:immich_mobile/utils/url_helper.dart';
import 'package:immich_mobile/widgets/settings/networking_settings/external_network_preference.dart';
import 'package:immich_mobile/widgets/settings/networking_settings/local_network_preference.dart';
import 'package:immich_mobile/widgets/settings/setting_group_title.dart';
import 'package:immich_mobile/widgets/settings/settings_switch_list_tile.dart';

class NetworkingSettings extends HookConsumerWidget {
  const NetworkingSettings({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final currentEndpoint = getServerUrl();
    final featureEnabled = useState(ref.watch(appConfigProvider).network.autoEndpointSwitching);
    useValueChanged<bool, void>(featureEnabled.value, (_, _) {
      unawaited(ref.read(settingsProvider).write(.networkAutoEndpointSwitching, featureEnabled.value));
    });

    Future<void> checkWifiReadPermission() async {
      final [hasLocationInUse, hasLocationAlways] = await Future.wait([
        ref.read(networkProvider.notifier).getWifiReadPermission(),
        ref.read(networkProvider.notifier).getWifiReadBackgroundPermission(),
      ]);

      if (!context.mounted) {
        return;
      }

      final disclosureAccepted = Store.get(StoreKey.autoEndpointLocationDisclosureAccepted, false);
      var canRequestBackgroundLocation = hasLocationInUse;

      if (!hasLocationInUse || !disclosureAccepted) {
        final isGrantLocationInUsePermission = await showDialog<bool>(
          context: context,
          builder: (dialogContext) {
            return AlertDialog(
              title: Text(context.t.location_permission),
              content: Text(context.t.location_permission_content),
              actions: [
                TextButton(onPressed: () => Navigator.pop(dialogContext), child: Text(context.t.cancel)),
                TextButton(
                  onPressed: () async {
                    final isGrant = hasLocationInUse
                        ? true
                        : await ref.read(networkProvider.notifier).requestWifiReadPermission();

                    if (!dialogContext.mounted) {
                      return;
                    }

                    Navigator.pop(dialogContext, isGrant);
                  },
                  child: Text(context.t.grant_permission),
                ),
              ],
            );
          },
        );

        if (!context.mounted) {
          return;
        }

        canRequestBackgroundLocation = isGrantLocationInUsePermission ?? false;
      }

      if (!canRequestBackgroundLocation) {
        return;
      }

      bool? isGrantLocationAlwaysPermission;

      if (!hasLocationAlways || !disclosureAccepted) {
        isGrantLocationAlwaysPermission = await showDialog<bool>(
          context: context,
          builder: (dialogContext) {
            return AlertDialog(
              title: Text(context.t.background_location_permission),
              content: Text(context.t.background_location_permission_content),
              actions: [
                TextButton(onPressed: () => Navigator.pop(dialogContext), child: Text(context.t.cancel)),
                TextButton(
                  onPressed: () async {
                    final isGrant = hasLocationAlways
                        ? true
                        : await ref.read(networkProvider.notifier).requestWifiReadBackgroundPermission();

                    if (!dialogContext.mounted) {
                      return;
                    }

                    Navigator.pop(dialogContext, isGrant);
                  },
                  child: Text(context.t.grant_permission),
                ),
              ],
            );
          },
        );
      }

      if (!context.mounted) {
        return;
      }

      if (isGrantLocationAlwaysPermission != null && !isGrantLocationAlwaysPermission) {
        await ref.read(networkProvider.notifier).openSettings();
        return;
      }

      if (!disclosureAccepted && isGrantLocationAlwaysPermission == null) {
        return;
      }

      await Store.put(StoreKey.autoEndpointLocationDisclosureAccepted, true);
    }

    useEffect(() {
      if (featureEnabled.value == true) {
        unawaited(checkWifiReadPermission());
      }
      return null;
    }, [featureEnabled.value]);

    return ListView(
      padding: const EdgeInsets.only(bottom: 96),
      children: <Widget>[
        const SizedBox(height: 8),
        SettingGroupTitle(
          title: context.t.current_server_address,
          icon: (currentEndpoint?.startsWith('https') ?? false) ? Icons.https_outlined : Icons.http_outlined,
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8),
          child: Card(
            elevation: 0,
            shape: RoundedRectangleBorder(
              borderRadius: const BorderRadius.all(Radius.circular(16)),
              side: BorderSide(color: context.colorScheme.surfaceContainerHighest, width: 1),
            ),
            child: ListTile(
              leading: currentEndpoint != null
                  ? const Icon(Icons.check_circle_rounded, color: Colors.green)
                  : const Icon(Icons.circle_outlined),
              title: Text(
                currentEndpoint ?? "--",
                style: TextStyle(fontSize: 14, fontFamily: 'GoogleSansCode', color: context.primaryColor),
              ),
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.only(top: 10.0),
          child: Divider(color: context.colorScheme.surfaceContainerHighest),
        ),
        SettingsSwitchListTile(
          enabled: true,
          valueNotifier: featureEnabled,
          title: context.t.automatic_endpoint_switching_title,
          subtitle: context.t.automatic_endpoint_switching_subtitle,
        ),
        const SizedBox(height: 8),
        SettingGroupTitle(title: context.t.local_network, icon: Icons.home_outlined),
        LocalNetworkPreference(enabled: featureEnabled.value),
        const SizedBox(height: 16),
        SettingGroupTitle(title: context.t.external_network, icon: Icons.dns_outlined),
        ExternalNetworkPreference(enabled: featureEnabled.value),
      ],
    );
  }
}

class NetworkStatusIcon extends StatelessWidget {
  const NetworkStatusIcon({super.key, required this.status, this.enabled = true}) : super();

  final AuxCheckStatus status;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return AnimatedSwitcher(duration: const Duration(milliseconds: 200), child: buildIcon(context));
  }

  Widget buildIcon(BuildContext context) => switch (status) {
    AuxCheckStatus.loading => Padding(
      padding: const EdgeInsets.only(left: 4.0),
      child: SizedBox(
        width: 18,
        height: 18,
        child: CircularProgressIndicator(color: context.primaryColor, strokeWidth: 2, key: const ValueKey('loading')),
      ),
    ),
    AuxCheckStatus.valid =>
      enabled
          ? const Icon(Icons.check_circle_rounded, color: Colors.green, key: ValueKey('success'))
          : Icon(
              Icons.check_circle_rounded,
              color: context.colorScheme.onSurface.withAlpha(100),
              key: const ValueKey('success'),
            ),
    AuxCheckStatus.error =>
      enabled
          ? const Icon(Icons.error_rounded, color: Colors.red, key: ValueKey('error'))
          : const Icon(Icons.error_rounded, color: Colors.grey, key: ValueKey('error')),
    _ => const Icon(Icons.circle_outlined, key: ValueKey('unknown')),
  };
}
