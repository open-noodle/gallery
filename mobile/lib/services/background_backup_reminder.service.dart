import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/background_backup_status.model.dart';
import 'package:immich_mobile/extensions/translate_extensions.dart';
import 'package:immich_mobile/services/background_backup_status.service.dart';

typedef BackgroundBackupNotificationSender =
    Future<void> Function({required int id, required String title, required String body});

final backgroundBackupReminderServiceProvider = Provider<BackgroundBackupReminderService>((ref) {
  final plugin = FlutterLocalNotificationsPlugin();
  var notificationsInitialized = false;

  Future<void> ensureNotificationsInitialized() async {
    if (notificationsInitialized) {
      return;
    }

    final initialized = await plugin.initialize(
      const InitializationSettings(
        android: AndroidInitializationSettings('@mipmap/ic_launcher'),
        iOS: DarwinInitializationSettings(),
      ),
    );
    notificationsInitialized = initialized ?? true;
  }

  return BackgroundBackupReminderService(
    statusService: ref.watch(backgroundBackupStatusServiceProvider),
    showNotification: ({required int id, required String title, required String body}) async {
      await ensureNotificationsInitialized();
      if (!notificationsInitialized) {
        return;
      }
      return plugin.show(
        id,
        title,
        body,
        const NotificationDetails(
          android: AndroidNotificationDetails(
            'background_backup_health',
            'Background backup health',
            channelDescription: 'Warnings when mobile background backup has not run recently',
            importance: Importance.defaultImportance,
            priority: Priority.defaultPriority,
          ),
          iOS: DarwinNotificationDetails(),
        ),
      );
    },
  );
});

class BackgroundBackupReminderService {
  static const notificationId = 240529;

  const BackgroundBackupReminderService({required this.statusService, required this.showNotification});

  final BackgroundBackupStatusService statusService;
  final BackgroundBackupNotificationSender showNotification;

  Future<void> maybeShowReminder({DateTime? now}) async {
    final currentTime = now ?? DateTime.now();
    final status = await statusService.read();
    var health = status.deriveHealth(now: currentTime);

    // Infer OS-prevented background execution. If backup went stale (no
    // background wake/upload within the stale threshold) and there is no more
    // specific recorded cause, conclude the OS stopped running us in the
    // background and only the foreground open recovered. This is the ONE place
    // `blocked` becomes reachable in production. It self-clears: once a backup
    // pass refreshes the activity timestamps below the stale threshold, derive
    // returns healthy/pending again regardless of the stored reason.
    if (health == BackgroundBackupHealth.stale &&
        status.lastBackgroundFailureReason == BackgroundBackupFailureReason.none) {
      await statusService.recordFailure(BackgroundBackupFailureReason.osPrevented);
      health = BackgroundBackupHealth.blocked;
    }

    if ((health != BackgroundBackupHealth.stale && health != BackgroundBackupHealth.blocked) ||
        !status.shouldShowReminder(now: currentTime)) {
      return;
    }

    await showNotification(
      id: notificationId,
      title: 'backup_background_reminder_title'.t(),
      body: 'backup_background_reminder_body'.t(),
    );
    await statusService.markReminderShown();
  }
}
