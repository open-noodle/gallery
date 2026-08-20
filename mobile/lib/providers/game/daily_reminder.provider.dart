import 'package:easy_localization/easy_localization.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/providers/infrastructure/settings.provider.dart';
import 'package:immich_mobile/providers/shared_space.provider.dart';
import 'package:immich_mobile/utils/daily_reminder_schedule.dart';
import 'package:openapi/api.dart';
import 'package:timezone/timezone.dart' as tz;

/// Identifies a reminder tap so `main.dart` can route it without parsing anything.
const String kDailyReminderPayload = 'game-daily-reminder';

/// Notification ids are fixed and contiguous, so a cancel-then-schedule cycle cannot leave an
/// orphan behind from a longer previous horizon.
const int _kFirstNotificationId = 8100;

/// The plugin boundary, behind an interface so the policy above it is testable without a platform
/// channel.
abstract class DailyReminderScheduler {
  Future<void> cancelAll();
  Future<bool> hasPermission();
  Future<void> scheduleAt(
    int id,
    DateTime instant, {
    required String title,
    required String body,
    required String payload,
  });
}

class _PluginScheduler implements DailyReminderScheduler {
  final FlutterLocalNotificationsPlugin _plugin = FlutterLocalNotificationsPlugin();

  @override
  Future<void> cancelAll() async {
    for (var i = 0; i < kDailyReminderHorizonDays; i++) {
      await _plugin.cancel(_kFirstNotificationId + i);
    }
  }

  @override
  Future<bool> hasPermission() async {
    final android = _plugin.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
    if (android != null) {
      return await android.areNotificationsEnabled() ?? false;
    }
    final ios = _plugin.resolvePlatformSpecificImplementation<IOSFlutterLocalNotificationsPlugin>();
    if (ios != null) {
      return await ios.requestPermissions(alert: true, badge: false, sound: true) ?? false;
    }
    return false;
  }

  @override
  Future<void> scheduleAt(
    int id,
    DateTime instant, {
    required String title,
    required String body,
    required String payload,
  }) {
    return _plugin.zonedSchedule(
      id,
      title,
      body,
      tz.TZDateTime.from(instant, tz.local),
      const NotificationDetails(
        android: AndroidNotificationDetails('game_daily_reminder', 'Daily challenge'),
        iOS: DarwinNotificationDetails(),
      ),
      // Only consulted on iOS versions older than 10, which have no timezone-aware scheduling API;
      // the instant above is already an absolute TZDateTime everywhere else.
      uiLocalNotificationDateInterpretation: UILocalNotificationDateInterpretation.absoluteTime,
      // Inexact on purpose: an exact alarm would need SCHEDULE_EXACT_ALARM on Android 12+, a
      // manifest permission with Play Store policy attached, and a daily nudge does not need it.
      androidScheduleMode: AndroidScheduleMode.inexactAllowWhileIdle,
      payload: payload,
    );
  }
}

final dailyReminderSchedulerProvider = Provider<DailyReminderScheduler>((ref) => _PluginScheduler());

final dailyReminderProvider = Provider<DailyReminderController>(DailyReminderController.new);

class DailyReminderController {
  DailyReminderController(this._ref);

  final Ref _ref;

  /// Recompute and re-apply the whole schedule.
  ///
  /// Called on cold start, on resume, and after a daily is finished. Reads no game endpoint: asking
  /// the server whether today's daily is played would GENERATE it for every opted-in space.
  Future<void> refresh({DateTime? now}) async {
    final List<SharedSpaceResponseDto> spaces;
    try {
      spaces = await _ref.read(sharedSpacesProvider.future);
    } catch (_) {
      // Offline, or the request otherwise failed. Leave whatever is pending in place — cancelling
      // would silence a reminder because of a transient network failure, for no gain.
      return;
    }

    final scheduler = _ref.read(dailyReminderSchedulerProvider);
    await scheduler.cancelAll();

    final config = _ref.read(appConfigProvider);
    final enabled = config.read(SettingsKey.gameDailyReminderEnabled);

    // `dailyChallengeEnabled` is Optional<bool?> and `Absent.value` THROWS, so this must stay
    // `.orElse(null)`. Absent and null both mean "not opted in".
    final hasOptedInSpace = spaces.any((space) => space.dailyChallengeEnabled.orElse(null) == true);

    // Unlike a space, the solo daily has no per-space-style opt-in to read: every account has one
    // once the reminder toggle is on. Kept as its own named value, rather than inlined as `true`
    // below, so both call sites read the same as `hasOptedInSpace` and stay easy to widen later if
    // that ever needs to become conditional.
    const soloDailyEnabled = true;

    // On iOS, hasPermission() can raise the system permission dialog. Only ask once the cheap
    // local gates already pass. Widened alongside the scheduling gate below: a solo-only user with
    // no opted-in space now has something to be reminded about too, so `hasOptedInSpace` alone can
    // no longer be the bar for asking.
    final permissionGranted = enabled && (hasOptedInSpace || soloDailyEnabled)
        ? await scheduler.hasPermission()
        : false;

    final occurrences = dailyReminderOccurrences(
      now: now ?? DateTime.now(),
      minuteOfDay: config.read(SettingsKey.gameDailyReminderMinuteOfDay),
      enabled: enabled,
      permissionGranted: permissionGranted,
      hasOptedInSpace: hasOptedInSpace,
      soloDailyEnabled: soloDailyEnabled,
      spaceLastPlayed: config.read(SettingsKey.gameSpaceDailyLastPlayed),
      soloLastPlayed: config.read(SettingsKey.gameSoloDailyLastPlayed),
      soloUnavailableOn: config.read(SettingsKey.gameSoloDailyUnavailableOn),
    );

    for (var i = 0; i < occurrences.length; i++) {
      await scheduler.scheduleAt(
        _kFirstNotificationId + i,
        occurrences[i],
        title: 'game_daily_reminder_notification_title'.tr(),
        body: 'game_daily_reminder_notification_body'.tr(),
        payload: kDailyReminderPayload,
      );
    }
  }

  /// Records that a daily was finished, then reschedules so today's occurrence drops immediately
  /// rather than waiting for the next resume.
  ///
  /// [isSolo] picks which of the two `gameDaily*LastPlayed` keys to write: the space and solo
  /// streaks are independent, computed server-side, so recording completion under the wrong key
  /// would silently suppress the reminder for whichever one was NOT actually finished.
  Future<void> recordDailyCompleted(DateTime dailyOn, {required bool isSolo}) async {
    final key = isSolo ? SettingsKey.gameSoloDailyLastPlayed : SettingsKey.gameSpaceDailyLastPlayed;
    // `dailyKeyForDateOnly`, never `dailyKeyFor`: `dailyOn` is a date-only wire value and arrives
    // as LOCAL midnight, so converting it would record the previous day east of Greenwich — a key
    // `dailyReminderOccurrences` then never matches, leaving tonight's reminder to fire for the
    // daily just finished.
    await _ref.read(settingsProvider).write(key, dailyKeyForDateOnly(dailyOn));
    await refresh();
  }

  /// Records that the solo daily could not be generated today — the player's library has nothing
  /// to fill one with — then reschedules so tonight's occurrence drops immediately if the space
  /// side is also already played, rather than waiting for the next resume.
  ///
  /// Called from wherever the solo daily is actually fetched (the PhotoGuesser page's own read of
  /// it), never from here: reading it ourselves to find this out would be exactly the GENERATING
  /// read `refresh()`'s doc says this whole file avoids. [now] defaults to the real clock and only
  /// exists so callers (and their tests) can pin the day being recorded.
  Future<void> recordSoloDailyUnavailable({DateTime? now}) async {
    await _ref.read(settingsProvider).write(SettingsKey.gameSoloDailyUnavailableOn, dailyKeyFor(now ?? DateTime.now()));
    await refresh(now: now);
  }
}
