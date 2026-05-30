enum BackgroundBackupSchedulerKind { iosRefresh, iosProcessing, androidBackground, foregroundResume, manual }

enum BackgroundBackupFailureReason {
  none,
  backupDisabled,
  noCurrentUser,
  photosPermissionDenied,
  backgroundRefreshUnavailable,
  remoteSyncFailed,
  noNetwork,
  uploadFailed,
  osPrevented,
  unknown,
}

enum BackgroundBackupHealth { neverRun, healthy, pending, warning, stale, blocked }

class BackgroundBackupStatus {
  static const warningThreshold = Duration(hours: 48);
  static const staleThreshold = Duration(days: 7);
  static const pendingThreshold = Duration(hours: 1);
  static const reminderRateLimit = Duration(hours: 24);

  const BackgroundBackupStatus({
    this.lastBackgroundWakeAt,
    this.lastLocalPhotoScanAt,
    this.lastUploadEnqueueAt,
    this.lastUploadSuccessAt,
    this.lastReminderAt,
    this.lastBackgroundFailureReason = BackgroundBackupFailureReason.none,
    this.lastCandidateCount = 0,
    this.lastSuccessfulSchedulerKind,
  });

  final DateTime? lastBackgroundWakeAt;
  final DateTime? lastLocalPhotoScanAt;
  final DateTime? lastUploadEnqueueAt;
  final DateTime? lastUploadSuccessAt;
  final DateTime? lastReminderAt;
  final BackgroundBackupFailureReason lastBackgroundFailureReason;
  final int lastCandidateCount;
  final BackgroundBackupSchedulerKind? lastSuccessfulSchedulerKind;

  BackgroundBackupStatus copyWith({
    DateTime? lastBackgroundWakeAt,
    DateTime? lastLocalPhotoScanAt,
    DateTime? lastUploadEnqueueAt,
    DateTime? lastUploadSuccessAt,
    DateTime? lastReminderAt,
    BackgroundBackupFailureReason? lastBackgroundFailureReason,
    int? lastCandidateCount,
    BackgroundBackupSchedulerKind? lastSuccessfulSchedulerKind,
  }) {
    return BackgroundBackupStatus(
      lastBackgroundWakeAt: lastBackgroundWakeAt ?? this.lastBackgroundWakeAt,
      lastLocalPhotoScanAt: lastLocalPhotoScanAt ?? this.lastLocalPhotoScanAt,
      lastUploadEnqueueAt: lastUploadEnqueueAt ?? this.lastUploadEnqueueAt,
      lastUploadSuccessAt: lastUploadSuccessAt ?? this.lastUploadSuccessAt,
      lastReminderAt: lastReminderAt ?? this.lastReminderAt,
      lastBackgroundFailureReason: lastBackgroundFailureReason ?? this.lastBackgroundFailureReason,
      lastCandidateCount: lastCandidateCount ?? this.lastCandidateCount,
      lastSuccessfulSchedulerKind: lastSuccessfulSchedulerKind ?? this.lastSuccessfulSchedulerKind,
    );
  }

  BackgroundBackupHealth deriveHealth({required DateTime now}) {
    final lastActivityAt = _latestDate([lastUploadSuccessAt, lastUploadEnqueueAt, lastBackgroundWakeAt]);
    if (lastActivityAt == null) {
      return BackgroundBackupHealth.neverRun;
    }

    if (lastCandidateCount > 0 &&
        lastUploadEnqueueAt != null &&
        now.difference(lastUploadEnqueueAt!) <= pendingThreshold) {
      return BackgroundBackupHealth.pending;
    }

    final age = now.difference(lastActivityAt);
    if (age >= staleThreshold) {
      if (lastBackgroundFailureReason == BackgroundBackupFailureReason.osPrevented) {
        return BackgroundBackupHealth.blocked;
      }
      return BackgroundBackupHealth.stale;
    }
    if (age >= warningThreshold) {
      return BackgroundBackupHealth.warning;
    }
    return BackgroundBackupHealth.healthy;
  }

  bool shouldShowReminder({required DateTime now}) {
    if (lastReminderAt == null) {
      return true;
    }
    return now.difference(lastReminderAt!) >= reminderRateLimit;
  }

  Map<String, dynamic> toJson() {
    return {
      'lastBackgroundWakeAt': lastBackgroundWakeAt?.toIso8601String(),
      'lastLocalPhotoScanAt': lastLocalPhotoScanAt?.toIso8601String(),
      'lastUploadEnqueueAt': lastUploadEnqueueAt?.toIso8601String(),
      'lastUploadSuccessAt': lastUploadSuccessAt?.toIso8601String(),
      'lastReminderAt': lastReminderAt?.toIso8601String(),
      'lastBackgroundFailureReason': lastBackgroundFailureReason.name,
      'lastCandidateCount': lastCandidateCount,
      'lastSuccessfulSchedulerKind': lastSuccessfulSchedulerKind?.name,
    };
  }

  factory BackgroundBackupStatus.fromJson(Map<String, dynamic> json) {
    return BackgroundBackupStatus(
      lastBackgroundWakeAt: _date(json['lastBackgroundWakeAt']),
      lastLocalPhotoScanAt: _date(json['lastLocalPhotoScanAt']),
      lastUploadEnqueueAt: _date(json['lastUploadEnqueueAt']),
      lastUploadSuccessAt: _date(json['lastUploadSuccessAt']),
      lastReminderAt: _date(json['lastReminderAt']),
      lastBackgroundFailureReason: BackgroundBackupFailureReason.values.byName(
        json['lastBackgroundFailureReason'] as String? ?? BackgroundBackupFailureReason.none.name,
      ),
      lastCandidateCount: json['lastCandidateCount'] as int? ?? 0,
      lastSuccessfulSchedulerKind: _schedulerKind(json['lastSuccessfulSchedulerKind']),
    );
  }

  static DateTime? _date(Object? value) {
    if (value is! String || value.isEmpty) {
      return null;
    }
    return DateTime.parse(value);
  }

  static BackgroundBackupSchedulerKind? _schedulerKind(Object? value) {
    if (value is! String || value.isEmpty) {
      return null;
    }
    return BackgroundBackupSchedulerKind.values.byName(value);
  }

  static DateTime? _latestDate(List<DateTime?> values) {
    DateTime? latest;
    for (final value in values) {
      if (value == null) {
        continue;
      }
      if (latest == null || value.isAfter(latest)) {
        latest = value;
      }
    }
    return latest;
  }

  @override
  bool operator ==(Object other) {
    return other is BackgroundBackupStatus &&
        other.lastBackgroundWakeAt == lastBackgroundWakeAt &&
        other.lastLocalPhotoScanAt == lastLocalPhotoScanAt &&
        other.lastUploadEnqueueAt == lastUploadEnqueueAt &&
        other.lastUploadSuccessAt == lastUploadSuccessAt &&
        other.lastReminderAt == lastReminderAt &&
        other.lastBackgroundFailureReason == lastBackgroundFailureReason &&
        other.lastCandidateCount == lastCandidateCount &&
        other.lastSuccessfulSchedulerKind == lastSuccessfulSchedulerKind;
  }

  @override
  int get hashCode => Object.hash(
    lastBackgroundWakeAt,
    lastLocalPhotoScanAt,
    lastUploadEnqueueAt,
    lastUploadSuccessAt,
    lastReminderAt,
    lastBackgroundFailureReason,
    lastCandidateCount,
    lastSuccessfulSchedulerKind,
  );
}
