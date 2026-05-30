import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/background_backup_status.model.dart';

void main() {
  test('serializes and deserializes background backup status', () {
    final status = BackgroundBackupStatus(
      lastBackgroundWakeAt: DateTime.utc(2026, 5, 29, 10),
      lastLocalPhotoScanAt: DateTime.utc(2026, 5, 29, 10, 1),
      lastUploadEnqueueAt: DateTime.utc(2026, 5, 29, 10, 2),
      lastUploadSuccessAt: DateTime.utc(2026, 5, 29, 10, 3),
      lastReminderAt: DateTime.utc(2026, 5, 29, 11),
      lastBackgroundFailureReason: BackgroundBackupFailureReason.remoteSyncFailed,
      lastCandidateCount: 12,
      lastSuccessfulSchedulerKind: BackgroundBackupSchedulerKind.iosProcessing,
    );

    final decoded = BackgroundBackupStatus.fromJson(jsonDecode(jsonEncode(status.toJson())) as Map<String, dynamic>);

    expect(decoded, status);
  });

  test('derives healthy when a wake happened inside the warning threshold', () {
    final now = DateTime.utc(2026, 5, 29, 12);
    final status = BackgroundBackupStatus(lastBackgroundWakeAt: now.subtract(const Duration(hours: 4)));

    expect(status.deriveHealth(now: now), BackgroundBackupHealth.healthy);
  });

  test('derives warning and stale based on elapsed time', () {
    final now = DateTime.utc(2026, 5, 29, 12);

    expect(
      BackgroundBackupStatus(lastBackgroundWakeAt: now.subtract(const Duration(hours: 72))).deriveHealth(now: now),
      BackgroundBackupHealth.warning,
    );
    expect(
      BackgroundBackupStatus(lastBackgroundWakeAt: now.subtract(const Duration(days: 8))).deriveHealth(now: now),
      BackgroundBackupHealth.stale,
    );
  });

  test('derives blocked when OS prevented background execution for a stale interval', () {
    final now = DateTime.utc(2026, 5, 29, 12);
    final status = BackgroundBackupStatus(
      lastBackgroundWakeAt: now.subtract(const Duration(days: 8)),
      lastBackgroundFailureReason: BackgroundBackupFailureReason.osPrevented,
    );

    expect(status.deriveHealth(now: now), BackgroundBackupHealth.blocked);
  });

  test('derives pending when candidates were found recently', () {
    final now = DateTime.utc(2026, 5, 29, 12);
    final status = BackgroundBackupStatus(
      lastCandidateCount: 3,
      lastUploadEnqueueAt: now.subtract(const Duration(minutes: 15)),
    );

    expect(status.deriveHealth(now: now), BackgroundBackupHealth.pending);
  });

  test('rate limits reminders to one per day', () {
    final now = DateTime.utc(2026, 5, 29, 12);

    expect(const BackgroundBackupStatus(lastReminderAt: null).shouldShowReminder(now: now), isTrue);
    expect(
      BackgroundBackupStatus(lastReminderAt: now.subtract(const Duration(hours: 12))).shouldShowReminder(now: now),
      isFalse,
    );
    expect(
      BackgroundBackupStatus(lastReminderAt: now.subtract(const Duration(hours: 25))).shouldShowReminder(now: now),
      isTrue,
    );
  });

  test('serializes failure reasons used for required edge cases', () {
    for (final reason in [
      BackgroundBackupFailureReason.photosPermissionDenied,
      BackgroundBackupFailureReason.backgroundRefreshUnavailable,
      BackgroundBackupFailureReason.noNetwork,
      BackgroundBackupFailureReason.osPrevented,
    ]) {
      final status = BackgroundBackupStatus(lastBackgroundFailureReason: reason);
      final decoded = BackgroundBackupStatus.fromJson(status.toJson());

      expect(decoded.lastBackgroundFailureReason, reason);
    }
  });

  test('keeps recoverable no-network state stale instead of falsely healthy', () {
    final now = DateTime.utc(2026, 5, 29, 12);
    final status = BackgroundBackupStatus(
      lastBackgroundWakeAt: now.subtract(const Duration(days: 8)),
      lastBackgroundFailureReason: BackgroundBackupFailureReason.noNetwork,
    );

    expect(status.deriveHealth(now: now), BackgroundBackupHealth.stale);
  });
}
