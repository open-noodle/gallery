import 'package:immich_mobile/domain/models/background_backup_status.model.dart';
import 'package:immich_mobile/services/background_backup_status.service.dart';

class BackgroundBackupEventRecorder {
  const BackgroundBackupEventRecorder(this._statusService);

  final BackgroundBackupStatusService _statusService;

  Future<void> recordIosWake({required bool isRefresh}) {
    return _statusService.recordWake(
      isRefresh ? BackgroundBackupSchedulerKind.iosRefresh : BackgroundBackupSchedulerKind.iosProcessing,
    );
  }

  Future<void> recordAndroidWake() {
    return _statusService.recordWake(BackgroundBackupSchedulerKind.androidBackground);
  }

  Future<void> recordBackupPreflight({required bool backupEnabled, required bool hasCurrentUser}) {
    if (!backupEnabled) {
      return _statusService.recordFailure(BackgroundBackupFailureReason.backupDisabled);
    }
    if (!hasCurrentUser) {
      return _statusService.recordFailure(BackgroundBackupFailureReason.noCurrentUser);
    }
    return Future.value();
  }

  Future<void> recordRemoteSyncResult(bool success) {
    if (success) {
      return Future.value();
    }
    return _statusService.recordFailure(BackgroundBackupFailureReason.remoteSyncFailed);
  }
}
