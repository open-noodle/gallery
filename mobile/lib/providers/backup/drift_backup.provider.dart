import 'dart:async';

import 'package:background_downloader/background_downloader.dart';
import 'package:flutter/foundation.dart';
import 'package:freezed_annotation/freezed_annotation.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/constants/constants.dart';
import 'package:immich_mobile/domain/models/album/local_album.model.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/extensions/platform_extensions.dart';
import 'package:immich_mobile/providers/infrastructure/db.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:immich_mobile/services/background_upload.service.dart';
import 'package:immich_mobile/services/foreground_upload.service.dart';
import 'package:immich_mobile/utils/upload_speed_calculator.dart';
import 'package:logging/logging.dart';

part 'drift_backup.provider.freezed.dart';

@freezed
abstract class EnqueueStatus with _$EnqueueStatus {
  const factory EnqueueStatus({required int enqueueCount, required int totalCount}) = _EnqueueStatus;
}

@freezed
abstract class DriftUploadStatus with _$DriftUploadStatus {
  const factory DriftUploadStatus({
    required String taskId,
    required String filename,
    required double progress,
    required int fileSize,
    required String networkSpeedAsString,
    bool? isFailed,
    String? error,
  }) = _DriftUploadStatus;
}

enum BackupError { none, syncFailed }

@freezed
abstract class DriftBackupState with _$DriftBackupState {
  const DriftBackupState._();

  const factory DriftBackupState({
    required int totalCount,
    required int backupCount,
    required int remainderCount,
    required int processingCount,
    required bool isSyncing,
    @Default(BackupError.none) BackupError error,
    required Map<String, DriftUploadStatus> uploadItems,
    @Default({}) Map<String, double> iCloudDownloadProgress,
  }) = _DriftBackupState;

  int get errorCount => uploadItems.values.where((item) => item.isFailed == true).length;
}

final driftBackupProvider = StateNotifierProvider<DriftBackupNotifier, DriftBackupState>((ref) {
  return DriftBackupNotifier(
    ref.watch(foregroundUploadServiceProvider),
    ref.watch(backgroundUploadServiceProvider),
    UploadSpeedManager(),
  );
});

class DriftBackupNotifier extends StateNotifier<DriftBackupState> {
  DriftBackupNotifier(this._foregroundUploadService, this._backgroundUploadService, this._uploadSpeedManager)
    : super(
        const DriftBackupState(
          totalCount: 0,
          backupCount: 0,
          remainderCount: 0,
          processingCount: 0,
          isSyncing: false,
          uploadItems: {},
          error: BackupError.none,
        ),
      ) {
    _backgroundProgressSubscription = _backgroundUploadService.taskProgressStream.listen(
      _handleBackgroundBackupProgress,
    );
    _backgroundStatusSubscription = _backgroundUploadService.taskStatusStream.listen(_handleBackgroundBackupStatus);
  }

  final ForegroundUploadService _foregroundUploadService;
  final BackgroundUploadService _backgroundUploadService;
  final UploadSpeedManager _uploadSpeedManager;
  Completer<void>? _cancelToken;
  late final StreamSubscription<TaskProgressUpdate> _backgroundProgressSubscription;
  late final StreamSubscription<TaskStatusUpdate> _backgroundStatusSubscription;

  final _logger = Logger("DriftBackupNotifier");

  @override
  void dispose() {
    unawaited(_backgroundProgressSubscription.cancel());
    unawaited(_backgroundStatusSubscription.cancel());
    super.dispose();
  }

  bool _isBackgroundBackupGroup(String group) {
    return group == kBackupGroup || group == kBackupLivePhotoGroup;
  }

  bool _isLivePhotoMotionTask(Task task) {
    if (task.group != kBackupGroup || task.metaData.isEmpty) {
      return false;
    }

    try {
      return UploadTaskMetadata.fromJson(task.metaData).isLivePhotos;
    } catch (_) {
      return false;
    }
  }

  void _handleBackgroundBackupProgress(TaskProgressUpdate update) {
    if (!mounted || !_isBackgroundBackupGroup(update.task.group)) {
      return;
    }

    final taskId = update.task.taskId;
    final filename = update.task.displayName.isNotEmpty ? update.task.displayName : update.task.filename;
    final progress = update.progress.clamp(0.0, 1.0);
    final fileSize = update.expectedFileSize >= 0 ? update.expectedFileSize : 0;
    final networkSpeedAsString = update.hasNetworkSpeed ? '${update.networkSpeed.toStringAsFixed(2)} MB/s' : '';
    final currentItem = state.uploadItems[taskId];

    state = state.copyWith(
      uploadItems: {
        ...state.uploadItems,
        taskId: DriftUploadStatus(
          taskId: taskId,
          filename: filename,
          progress: progress,
          fileSize: fileSize,
          networkSpeedAsString: networkSpeedAsString,
          isFailed: currentItem?.isFailed,
          error: currentItem?.error,
        ),
      },
    );
  }

  void _handleBackgroundBackupStatus(TaskStatusUpdate update) {
    if (!mounted || !_isBackgroundBackupGroup(update.task.group)) {
      return;
    }

    final taskId = update.task.taskId;
    switch (update.status) {
      case TaskStatus.complete:
        if (!_isLivePhotoMotionTask(update.task)) {
          state = state.copyWith(backupCount: state.backupCount + 1, remainderCount: state.remainderCount - 1);
          Future.delayed(const Duration(milliseconds: 1000), () {
            _removeUploadItem(taskId);
          });
        }
      case TaskStatus.failed:
      case TaskStatus.notFound:
      case TaskStatus.canceled:
        final filename = update.task.displayName.isNotEmpty ? update.task.displayName : update.task.filename;
        state = state.copyWith(
          uploadItems: {
            ...state.uploadItems,
            taskId: DriftUploadStatus(
              taskId: taskId,
              filename: filename,
              progress: 0,
              fileSize: 0,
              networkSpeedAsString: '',
              isFailed: true,
              error: update.exception?.description ?? update.status.name,
            ),
          },
        );
      default:
        break;
    }
  }

  /// Remove upload item from state
  void _removeUploadItem(String taskId) {
    if (!mounted) {
      _logger.warning("Skip _removeUploadItem: notifier disposed");
      return;
    }
    if (state.uploadItems.containsKey(taskId)) {
      final updatedItems = Map<String, DriftUploadStatus>.from(state.uploadItems);
      updatedItems.remove(taskId);
      state = state.copyWith(uploadItems: updatedItems);
    }
  }

  Future<void> getBackupStatus(String userId) async {
    if (!mounted) {
      _logger.warning("Skip getBackupStatus (pre-call): notifier disposed");
      return;
    }
    final counts = await _foregroundUploadService.getBackupCounts(userId);
    if (!mounted) {
      _logger.warning("Skip getBackupStatus (post-call): notifier disposed");
      return;
    }

    state = state.copyWith(
      totalCount: counts.total,
      backupCount: counts.total - counts.remainder,
      remainderCount: counts.remainder,
      processingCount: counts.processing,
    );
  }

  void updateError(BackupError error) {
    if (!mounted) {
      _logger.warning("Skip updateError: notifier disposed");
      return;
    }
    state = state.copyWith(error: error);
  }

  void updateSyncing(bool isSyncing) {
    state = state.copyWith(isSyncing: isSyncing);
  }

  Future<void> startForegroundBackup(String userId) async {
    // Cancel any existing backup before starting a new one
    if (_cancelToken != null) {
      stopForegroundBackup(reason: "restarting the backup");
    }

    state = state.copyWith(error: BackupError.none);

    // A pause during the recount below nulls _cancelToken, so the run keeps its own reference.
    final cancelToken = Completer<void>();
    _cancelToken = cancelToken;

    // Re-baseline the counters against the same DB read that feeds this run's candidate list,
    // otherwise a resume counts duplicate successes against the old baseline (#26215).
    await getBackupStatus(userId);

    return _foregroundUploadService.uploadCandidates(
      userId,
      cancelToken,
      callbacks: UploadCallbacks(
        onProgress: _handleForegroundBackupProgress,
        onSuccess: _handleForegroundBackupSuccess,
        onError: _handleForegroundBackupError,
        onICloudProgress: _handleICloudProgress,
      ),
    );
  }

  Future<void> startBackup(String userId) {
    if (CurrentPlatform.isIOS) {
      return startBackupWithURLSession(userId);
    }

    return startForegroundBackup(userId);
  }

  Future<void> stopBackup({required String reason}) async {
    if (CurrentPlatform.isIOS) {
      await _backgroundUploadService.cancel();
      _uploadSpeedManager.clear();
      state = state.copyWith(uploadItems: {}, iCloudDownloadProgress: {});
      return;
    }

    stopForegroundBackup(reason: reason);
  }

  void stopForegroundBackup({required String reason}) {
    if (_cancelToken != null) {
      _logger.info("Foreground backup cancelled: $reason");
    }
    _cancelToken?.complete();
    _cancelToken = null;
    _uploadSpeedManager.clear();
    state = state.copyWith(uploadItems: {}, iCloudDownloadProgress: {});
  }

  void _handleICloudProgress(String localAssetId, double progress) {
    state = state.copyWith(iCloudDownloadProgress: {...state.iCloudDownloadProgress, localAssetId: progress});

    if (progress >= 1.0) {
      Future.delayed(const Duration(milliseconds: 250), () {
        final updatedProgress = Map<String, double>.from(state.iCloudDownloadProgress);
        updatedProgress.remove(localAssetId);
        state = state.copyWith(iCloudDownloadProgress: updatedProgress);
      });
    }
  }

  void _handleForegroundBackupProgress(String localAssetId, String filename, int bytes, int totalBytes) {
    if (_cancelToken == null) {
      return;
    }

    final progress = totalBytes > 0 ? bytes / totalBytes : 0.0;
    final networkSpeedAsString = _uploadSpeedManager.updateProgress(localAssetId, bytes, totalBytes);
    final currentItem = state.uploadItems[localAssetId];
    if (currentItem != null) {
      state = state.copyWith(
        uploadItems: {
          ...state.uploadItems,
          localAssetId: currentItem.copyWith(
            filename: filename,
            progress: progress,
            fileSize: totalBytes,
            networkSpeedAsString: networkSpeedAsString,
          ),
        },
      );
    } else {
      state = state.copyWith(
        uploadItems: {
          ...state.uploadItems,
          localAssetId: DriftUploadStatus(
            taskId: localAssetId,
            filename: filename,
            progress: progress,
            fileSize: totalBytes,
            networkSpeedAsString: networkSpeedAsString,
          ),
        },
      );
    }
  }

  void _handleForegroundBackupSuccess(String localAssetId, String remoteAssetId) {
    if (!mounted) {
      _logger.warning("Skip _handleForegroundBackupSuccess: notifier disposed");
      return;
    }
    state = state.copyWith(backupCount: state.backupCount + 1, remainderCount: state.remainderCount - 1);
    _uploadSpeedManager.removeTask(localAssetId);

    Future.delayed(const Duration(milliseconds: 1000), () {
      _removeUploadItem(localAssetId);
    });
  }

  void _handleForegroundBackupError(String localAssetId, String errorMessage) {
    _logger.severe("Upload failed for $localAssetId: $errorMessage");

    final currentItem = state.uploadItems[localAssetId];
    if (currentItem != null) {
      state = state.copyWith(
        uploadItems: {
          ...state.uploadItems,
          localAssetId: currentItem.copyWith(isFailed: true, error: errorMessage),
        },
      );
    } else {
      state = state.copyWith(
        uploadItems: {
          ...state.uploadItems,
          localAssetId: DriftUploadStatus(
            taskId: localAssetId,
            filename: 'Unknown',
            progress: 0,
            fileSize: 0,
            networkSpeedAsString: '',
            isFailed: true,
            error: errorMessage,
          ),
        },
      );
    }

    _uploadSpeedManager.removeTask(localAssetId);
  }

  Future<void> startBackupWithURLSession(String userId) async {
    if (!mounted) {
      _logger.warning("Skip handleBackupResume (pre-call): notifier disposed");
      return;
    }
    _logger.info("Start background backup sequence");
    state = state.copyWith(error: BackupError.none);
    final taskGroups = await Future.wait([
      _backgroundUploadService.getActiveTasks(kBackupGroup),
      _backgroundUploadService.getActiveTasks(kBackupLivePhotoGroup),
    ]);
    final tasks = taskGroups.expand((group) => group).toList(growable: false);
    if (!mounted) {
      _logger.warning("Skip handleBackupResume (post-call): notifier disposed");
      return;
    }
    _logger.info("Found ${tasks.length} pending tasks");

    if (tasks.isEmpty) {
      _logger.info("No pending tasks, starting new upload");
      return _backgroundUploadService.uploadBackupCandidates(userId);
    }

    _logger.info("Resuming upload ${tasks.length} assets");
    return _backgroundUploadService.resume(userId);
  }
}

final driftBackupCandidateProvider = FutureProvider.autoDispose<List<LocalAsset>>((ref) {
  final user = ref.watch(currentUserProvider);
  if (user == null) {
    return [];
  }

  return ref.read(foregroundUploadServiceProvider).getBackupCandidates(user.id, onlyHashed: false);
});

final driftCandidateBackupAlbumInfoProvider = FutureProvider.autoDispose.family<List<LocalAlbum>, String>((
  ref,
  assetId,
) {
  return ref
      .read(driftProvider)
      .localAssetRepository
      .getSourceAlbums(assetId, backupSelection: BackupSelection.selected);
});
