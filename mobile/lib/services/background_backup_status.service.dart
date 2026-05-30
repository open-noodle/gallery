import 'dart:convert';

import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/background_backup_status.model.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';

final backgroundBackupStatusServiceProvider = Provider<BackgroundBackupStatusService>(
  (_) => BackgroundBackupStatusService(store: Store),
);

class BackgroundBackupStatusService {
  BackgroundBackupStatusService({required this.store, DateTime Function()? now}) : _now = now ?? DateTime.now;

  final StoreService store;
  final DateTime Function() _now;

  // Background-downloader status callbacks (recordUploadSuccess / recordFailure)
  // fire once per completed task and each does a read-modify-write of one JSON
  // blob. Without serialization two callbacks can both read the old status and
  // the second write clobbers the first (e.g. a late recordFailure dropping a
  // just-written lastUploadSuccessAt). Chain every mutation through a single
  // tail future so reads always observe the previous write.
  Future<void> _writeTail = Future.value();

  // `read()` is intentionally NOT serialized — it is a pure load with no write.
  Future<BackgroundBackupStatus> read() async {
    final raw = store.tryGet(StoreKey.backgroundBackupStatus);
    if (raw == null || raw.isEmpty) {
      return const BackgroundBackupStatus();
    }
    return BackgroundBackupStatus.fromJson(jsonDecode(raw) as Map<String, dynamic>);
  }

  /// Serializes a read-modify-write so concurrent record* calls cannot clobber.
  Future<void> _mutate(BackgroundBackupStatus Function(BackgroundBackupStatus current) update) {
    final next = _writeTail.then((_) async {
      final current = await read();
      await store.put(StoreKey.backgroundBackupStatus, jsonEncode(update(current).toJson()));
    });
    // Keep the tail alive even if one mutation throws.
    _writeTail = next.catchError((_) {});
    return next;
  }

  Future<void> recordWake(BackgroundBackupSchedulerKind schedulerKind) {
    return _mutate(
      (current) => current.copyWith(
        lastBackgroundWakeAt: _now(),
        lastSuccessfulSchedulerKind: schedulerKind,
        lastBackgroundFailureReason: BackgroundBackupFailureReason.none,
      ),
    );
  }

  Future<void> recordCandidateCount(int count) {
    return _mutate((current) => current.copyWith(lastLocalPhotoScanAt: _now(), lastCandidateCount: count));
  }

  Future<void> recordUploadEnqueue({required int candidateCount}) {
    return _mutate(
      (current) => current.copyWith(
        lastUploadEnqueueAt: _now(),
        lastCandidateCount: candidateCount,
        lastBackgroundFailureReason: BackgroundBackupFailureReason.none,
      ),
    );
  }

  Future<void> recordUploadSuccess() {
    return _mutate(
      (current) => current.copyWith(
        lastUploadSuccessAt: _now(),
        lastCandidateCount: 0,
        lastBackgroundFailureReason: BackgroundBackupFailureReason.none,
      ),
    );
  }

  Future<void> recordFailure(BackgroundBackupFailureReason reason) {
    return _mutate((current) => current.copyWith(lastBackgroundFailureReason: reason));
  }

  Future<void> markReminderShown() {
    return _mutate((current) => current.copyWith(lastReminderAt: _now()));
  }
}
