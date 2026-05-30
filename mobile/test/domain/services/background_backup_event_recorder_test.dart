import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/background_backup_status.model.dart';
import 'package:immich_mobile/domain/services/background_backup_event_recorder.dart';
import 'package:immich_mobile/services/background_backup_status.service.dart';
import 'package:mocktail/mocktail.dart';

class MockBackgroundBackupStatusService extends Mock implements BackgroundBackupStatusService {}

void main() {
  late MockBackgroundBackupStatusService statusService;
  late BackgroundBackupEventRecorder sut;

  setUpAll(() {
    registerFallbackValue(BackgroundBackupSchedulerKind.manual);
    registerFallbackValue(BackgroundBackupFailureReason.none);
  });

  setUp(() {
    statusService = MockBackgroundBackupStatusService();
    sut = BackgroundBackupEventRecorder(statusService);
    when(() => statusService.recordWake(any())).thenAnswer((_) async {});
    when(() => statusService.recordFailure(any())).thenAnswer((_) async {});
  });

  test('records iOS refresh and processing wakes distinctly', () async {
    await sut.recordIosWake(isRefresh: true);
    await sut.recordIosWake(isRefresh: false);

    verify(() => statusService.recordWake(BackgroundBackupSchedulerKind.iosRefresh)).called(1);
    verify(() => statusService.recordWake(BackgroundBackupSchedulerKind.iosProcessing)).called(1);
  });

  test('records Android background wake', () async {
    await sut.recordAndroidWake();

    verify(() => statusService.recordWake(BackgroundBackupSchedulerKind.androidBackground)).called(1);
  });

  test('records backup-disabled and no-user skip reasons', () async {
    await sut.recordBackupPreflight(backupEnabled: false, hasCurrentUser: true);
    await sut.recordBackupPreflight(backupEnabled: true, hasCurrentUser: false);

    verify(() => statusService.recordFailure(BackgroundBackupFailureReason.backupDisabled)).called(1);
    verify(() => statusService.recordFailure(BackgroundBackupFailureReason.noCurrentUser)).called(1);
  });

  test('records remote sync failure but not success', () async {
    await sut.recordRemoteSyncResult(false);
    await sut.recordRemoteSyncResult(true);

    verify(() => statusService.recordFailure(BackgroundBackupFailureReason.remoteSyncFailed)).called(1);
  });
}
