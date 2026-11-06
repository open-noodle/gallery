import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/app_lock.provider.dart';
import 'package:immich_mobile/services/app_settings.service.dart';
import 'package:immich_mobile/services/local_auth.service.dart';
import 'package:immich_mobile/utils/hooks/app_settings_update_hook.dart';
import 'package:immich_ui/immich_ui.dart';

class AppLockSetting extends HookConsumerWidget {
  const AppLockSetting({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appLockEnabledSetting = useAppSettingsState(AppSettingsEnum.appLockEnabled);
    final appLockTimeoutSetting = useAppSettingsState(AppSettingsEnum.appLockTimeout);

    final isEnabled = useValueNotifier(appLockEnabledSetting.value);
    final selectedTimeout = useState(appLockTimeoutSetting.value);

    Future<void> onAppLockChange(bool enable) async {
      if (enable) {
        // Authenticate before allowing App Lock to be enabled
        final localAuth = ref.read(localAuthServiceProvider);
        final bool authSuccess = await localAuth.authenticate('Authenticate to enable App Lock');
        if (!authSuccess) {
          isEnabled.value = false;
          return;
        }
      }
      appLockEnabledSetting.value = enable;
      isEnabled.value = enable;
      if (!enable) {
        ref.read(appLockProvider.notifier).unlock();
      }
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SettingGroupTitle(
          title: 'App Lock',
          icon: Icons.lock_outline_rounded,
        ),
        SettingsSwitchListTile(
          valueNotifier: isEnabled,
          title: 'Require Authentication',
          subtitle: 'Protect Noodle Gallery with fingerprint, face, or device PIN',
          onChanged: (val) => unawaited(onAppLockChange(val)),
        ),
        if (isEnabled.value)
          ListTile(
            title: const Text('Auto-lock timeout'),
            trailing: DropdownButton<int>(
              value: selectedTimeout.value,
              underline: const SizedBox(),
              items: const [
                DropdownMenuItem(value: 0, child: Text('Immediately')),
                DropdownMenuItem(value: 30, child: Text('30 seconds')),
                DropdownMenuItem(value: 60, child: Text('1 minute')),
                DropdownMenuItem(value: 300, child: Text('5 minutes')),
                DropdownMenuItem(value: 900, child: Text('15 minutes')),
              ],
              onChanged: (val) {
                if (val != null) {
                  selectedTimeout.value = val;
                  appLockTimeoutSetting.value = val;
                }
              },
            ),
          ),
      ],
    );
  }
}
