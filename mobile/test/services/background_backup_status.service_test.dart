import 'package:drift/drift.dart' hide isNotNull;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/background_backup_status.model.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/services/background_backup_status.service.dart';

void main() {
  late Drift db;
  late DateTime now;
  late BackgroundBackupStatusService sut;

  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    db = Drift(DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: DriftStoreRepository(db));
  });

  tearDownAll(() async {
    await Store.clear();
    await db.close();
  });

  setUp(() async {
    await Store.clear();
    now = DateTime.utc(2026, 5, 29, 12);
    sut = BackgroundBackupStatusService(store: Store, now: () => now);
  });

  tearDown(() async {
    await Store.clear();
  });

  test('recordWake stores wake time and scheduler kind', () async {
    await sut.recordWake(BackgroundBackupSchedulerKind.iosProcessing);

    final status = await sut.read();
    expect(status.lastBackgroundWakeAt, now);
    expect(status.lastSuccessfulSchedulerKind, BackgroundBackupSchedulerKind.iosProcessing);
    expect(Store.tryGet(StoreKey.backgroundBackupStatus), isNotNull);
  });

  test('recordCandidateCount stores scan time and count', () async {
    await sut.recordCandidateCount(7);

    final status = await sut.read();
    expect(status.lastLocalPhotoScanAt, now);
    expect(status.lastCandidateCount, 7);
  });

  test('recordUploadEnqueue and recordUploadSuccess clear failure reason', () async {
    await sut.recordFailure(BackgroundBackupFailureReason.remoteSyncFailed);
    await sut.recordUploadEnqueue(candidateCount: 2);
    await sut.recordUploadSuccess();

    final status = await sut.read();
    expect(status.lastUploadEnqueueAt, now);
    expect(status.lastUploadSuccessAt, now);
    expect(status.lastCandidateCount, 0);
    expect(status.lastBackgroundFailureReason, BackgroundBackupFailureReason.none);
  });

  test('markReminderShown rate limits future reminders', () async {
    await sut.markReminderShown();

    expect((await sut.read()).lastReminderAt, now);
    expect((await sut.read()).shouldShowReminder(now: now), isFalse);
  });

  test('serializes concurrent record calls without clobbering fields', () async {
    await sut.recordUploadEnqueue(candidateCount: 5);

    // Fire success and an unrelated failure "at the same time" (no await between
    // them). With serialization the success timestamp must survive and the
    // candidate count reset must hold even though a failure is recorded after.
    await Future.wait([sut.recordUploadSuccess(), sut.recordFailure(BackgroundBackupFailureReason.uploadFailed)]);

    final status = await sut.read();
    expect(status.lastUploadSuccessAt, now, reason: 'success write must not be lost to an interleaved failure write');
    expect(status.lastCandidateCount, 0);
    // Last-writer-wins on the reason is acceptable; assert it is one of the two
    // legitimate terminal values, never a stale leftover from before.
    expect(
      status.lastBackgroundFailureReason,
      anyOf(BackgroundBackupFailureReason.none, BackgroundBackupFailureReason.uploadFailed),
    );
  });

  test('recordFailure persists explicit edge-case reasons', () async {
    for (final reason in [
      BackgroundBackupFailureReason.photosPermissionDenied,
      BackgroundBackupFailureReason.backgroundRefreshUnavailable,
      BackgroundBackupFailureReason.noNetwork,
      BackgroundBackupFailureReason.osPrevented,
    ]) {
      await sut.recordFailure(reason);

      expect((await sut.read()).lastBackgroundFailureReason, reason);
    }
  });
}
