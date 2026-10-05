import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/services/camera_bubble.service.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/providers/infrastructure/camera_bubble.provider.dart';
import 'package:immich_ui/immich_ui.dart';

/// Android-only settings block for the Camera Bubble: the on/off switch and its permissions.
class CameraBubbleSettings extends HookConsumerWidget {
  const CameraBubbleSettings({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final service = ref.watch(cameraBubbleServiceProvider);
    final enabled = useState(false);

    // Ask the service rather than a stored flag: a force-stop kills it without telling anyone.
    useEffect(() {
      unawaited(
        service.isRunning.then((running) {
          if (context.mounted) {
            enabled.value = running;
          }
        }),
      );
      return null;
    }, const []);

    Future<void> turnOn() async {
      // Read before any await: the widget may be gone by the time the permission check returns.
      final title = context.t.camera_bubble_title;
      final body = context.t.camera_bubble_subtitle;
      if (!await service.isOverlayPermissionGranted) {
        await service.requestOverlayPermission();
        enabled.value = false;
        return;
      }

      // The bubble only draws the selection; the drawer loads the full list itself.
      await service.start(
        targets: CameraBubbleSessions.currentSelection().map(CameraBubbleSessions.asOverlayTarget).toList(),
        notificationTitle: title,
        notificationBody: body,
      );

      if (!await service.isUsageAccessGranted) {
        await service.requestUsageAccess();
      }
    }

    return SettingsSwitchListTile(
      valueNotifier: enabled,
      title: context.t.camera_bubble_title,
      subtitle: context.t.camera_bubble_subtitle,
      icon: Icons.bubble_chart_outlined,
      onChanged: (value) async {
        if (value) {
          await turnOn();
        } else {
          await service.stop();
        }
      },
    );
  }
}
