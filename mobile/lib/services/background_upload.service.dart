import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

import 'package:background_downloader/background_downloader.dart';
import 'package:flutter/foundation.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/constants/constants.dart';
import 'package:immich_mobile/domain/models/asset/asset_metadata.model.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/extensions/platform_extensions.dart';
import 'package:immich_mobile/infrastructure/repositories/backup.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/local_asset.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/settings.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/storage.repository.dart';
import 'package:immich_mobile/providers/infrastructure/asset.provider.dart';
import 'package:immich_mobile/providers/infrastructure/storage.provider.dart';
import 'package:immich_mobile/repositories/asset_media.repository.dart';
import 'package:immich_mobile/repositories/upload.repository.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:immich_mobile/utils/debug_print.dart';
import 'package:logging/logging.dart';
import 'package:openapi/api.dart' as api;
import 'package:path/path.dart' as p;

final backgroundUploadServiceProvider = Provider((ref) {
  final service = BackgroundUploadService(
    ref.watch(uploadRepositoryProvider),
    ref.watch(storageRepositoryProvider),
    ref.watch(localAssetRepository),
    ref.watch(backupRepositoryProvider),
    ref.watch(assetMediaRepositoryProvider),
  );

  ref.onDispose(service.dispose);
  return service;
});

/// Aggregates a single chunk's 0..1 progress into 0..1 progress over the whole file:
/// `(chunkIndex * chunkSize + chunkLoaded) / totalSize`. See
/// specs/2026-09-08-chunked-upload-design.md §7.5.
@visibleForTesting
double aggregateChunkUploadProgress(UploadTaskMetadata metadata, double chunkProgress) {
  if (metadata.totalSize <= 0 || metadata.chunkSize <= 0) {
    return chunkProgress;
  }
  final start = metadata.chunkIndex * metadata.chunkSize;
  final end = math.min(start + metadata.chunkSize, metadata.totalSize);
  final currentChunkSize = end - start;
  final loaded = start + (chunkProgress.clamp(0.0, 1.0) * currentChunkSize);
  return (loaded / metadata.totalSize).clamp(0.0, 1.0);
}

/// Metadata for upload tasks to track live photo handling, and (for a chunked upload) the
/// chunk chain state. `background_downloader` persists this JSON blob in its own database
/// alongside the task, so a chunk chain survives an app restart without a new Drift table.
/// See specs/2026-09-08-chunked-upload-design.md §7.4.
class UploadTaskMetadata {
  final String localAssetId;
  final bool isLivePhotos;
  final String livePhotoVideoId;

  /// Chunked-upload session id. Null when this task is not part of a chunked upload.
  final String? sessionId;

  /// 0-based index of this chunk within the chain. 0 when not chunked.
  final int chunkIndex;

  /// Total number of chunks in the chain. 1 when not chunked.
  final int chunkCount;

  /// Server-advertised chunk size (bytes) used to plan this chain. 0 when not chunked.
  final int chunkSize;

  /// Total file size (bytes) being uploaded. 0 when not chunked.
  final int totalSize;

  const UploadTaskMetadata({
    required this.localAssetId,
    required this.isLivePhotos,
    required this.livePhotoVideoId,
    this.sessionId,
    this.chunkIndex = 0,
    this.chunkCount = 1,
    this.chunkSize = 0,
    this.totalSize = 0,
  });

  bool get isChunked => sessionId != null && chunkCount > 1;
  bool get isFinalChunk => chunkIndex >= chunkCount - 1;

  UploadTaskMetadata copyWith({
    String? localAssetId,
    bool? isLivePhotos,
    String? livePhotoVideoId,
    String? sessionId,
    int? chunkIndex,
    int? chunkCount,
    int? chunkSize,
    int? totalSize,
  }) {
    return UploadTaskMetadata(
      localAssetId: localAssetId ?? this.localAssetId,
      isLivePhotos: isLivePhotos ?? this.isLivePhotos,
      livePhotoVideoId: livePhotoVideoId ?? this.livePhotoVideoId,
      sessionId: sessionId ?? this.sessionId,
      chunkIndex: chunkIndex ?? this.chunkIndex,
      chunkCount: chunkCount ?? this.chunkCount,
      chunkSize: chunkSize ?? this.chunkSize,
      totalSize: totalSize ?? this.totalSize,
    );
  }

  Map<String, dynamic> toMap() {
    return <String, dynamic>{
      'localAssetId': localAssetId,
      'isLivePhotos': isLivePhotos,
      'livePhotoVideoId': livePhotoVideoId,
      if (sessionId != null) 'sessionId': sessionId,
      'chunkIndex': chunkIndex,
      'chunkCount': chunkCount,
      'chunkSize': chunkSize,
      'totalSize': totalSize,
    };
  }

  factory UploadTaskMetadata.fromMap(Map<String, dynamic> map) {
    return UploadTaskMetadata(
      localAssetId: map['localAssetId'] as String,
      isLivePhotos: map['isLivePhotos'] as bool,
      livePhotoVideoId: map['livePhotoVideoId'] as String,
      sessionId: map['sessionId'] as String?,
      chunkIndex: (map['chunkIndex'] as num?)?.toInt() ?? 0,
      chunkCount: (map['chunkCount'] as num?)?.toInt() ?? 1,
      chunkSize: (map['chunkSize'] as num?)?.toInt() ?? 0,
      totalSize: (map['totalSize'] as num?)?.toInt() ?? 0,
    );
  }

  String toJson() => json.encode(toMap());

  factory UploadTaskMetadata.fromJson(String source) =>
      UploadTaskMetadata.fromMap(json.decode(source) as Map<String, dynamic>);

  @override
  String toString() =>
      'UploadTaskMetadata(localAssetId: $localAssetId, isLivePhotos: $isLivePhotos, livePhotoVideoId: $livePhotoVideoId, sessionId: $sessionId, chunkIndex: $chunkIndex, chunkCount: $chunkCount, chunkSize: $chunkSize, totalSize: $totalSize)';

  @override
  bool operator ==(covariant UploadTaskMetadata other) {
    if (identical(this, other)) {
      return true;
    }

    return other.localAssetId == localAssetId &&
        other.isLivePhotos == isLivePhotos &&
        other.livePhotoVideoId == livePhotoVideoId &&
        other.sessionId == sessionId &&
        other.chunkIndex == chunkIndex &&
        other.chunkCount == chunkCount &&
        other.chunkSize == chunkSize &&
        other.totalSize == totalSize;
  }

  @override
  int get hashCode =>
      localAssetId.hashCode ^
      isLivePhotos.hashCode ^
      livePhotoVideoId.hashCode ^
      sessionId.hashCode ^
      chunkIndex.hashCode ^
      chunkCount.hashCode ^
      chunkSize.hashCode ^
      totalSize.hashCode;
}

/// Service for handling background uploads using iOS URLSession (background_downloader)
///
/// This service handles asynchronous background uploads that can continue
/// even when the app is suspended. Primarily used for iOS background backup.
class BackgroundUploadService {
  BackgroundUploadService(
    this._uploadRepository,
    this._storageRepository,
    this._localAssetRepository,
    this._backupRepository,
    this._assetMediaRepository,
  ) {
    _uploadRepository.onUploadStatus = _onUploadCallback;
    _uploadRepository.onTaskProgress = _onTaskProgressCallback;
  }

  final UploadRepository _uploadRepository;
  final StorageRepository _storageRepository;
  final DriftLocalAssetRepository _localAssetRepository;
  final DriftBackupRepository _backupRepository;
  final AssetMediaRepository _assetMediaRepository;
  final Logger _logger = Logger('BackgroundUploadService');

  final StreamController<TaskStatusUpdate> _taskStatusController = StreamController<TaskStatusUpdate>.broadcast();
  final StreamController<TaskProgressUpdate> _taskProgressController = StreamController<TaskProgressUpdate>.broadcast();

  Stream<TaskStatusUpdate> get taskStatusStream => _taskStatusController.stream;
  Stream<TaskProgressUpdate> get taskProgressStream => _taskProgressController.stream;

  bool shouldAbortQueuingTasks = false;

  void _onTaskProgressCallback(TaskProgressUpdate update) {
    if (_taskProgressController.isClosed) {
      return;
    }

    final metadata = _tryParseMetadata(update.task.metaData);
    if (metadata != null && metadata.isChunked) {
      // Re-wrap the per-chunk progress (0..1 over just this chunk's bytes) as progress over the
      // whole file, so listeners see one smooth 0..1 arc across the chain rather than it resetting
      // to 0 at the start of every chunk. See specs/2026-09-08-chunked-upload-design.md §7.5.
      final aggregated = aggregateChunkUploadProgress(metadata, update.progress);
      _taskProgressController.add(
        TaskProgressUpdate(update.task, aggregated, update.expectedFileSize, update.networkSpeed, update.timeRemaining),
      );
      return;
    }

    _taskProgressController.add(update);
  }

  void _onUploadCallback(TaskStatusUpdate update) {
    if (!_taskStatusController.isClosed) {
      _taskStatusController.add(update);
    }
    handleTaskStatusUpdate(update);
  }

  void dispose() {
    _taskStatusController.close();
    _taskProgressController.close();
  }

  /// Enqueue tasks to the background upload queue
  Future<List<bool>> enqueueTasks(List<UploadTask> tasks) {
    return _uploadRepository.enqueueBackgroundAll(tasks);
  }

  /// Get a list of tasks that are ENQUEUED or RUNNING
  Future<List<Task>> getActiveTasks(String group) {
    return _uploadRepository.getActiveTasks(group);
  }

  /// Start background upload using iOS URLSession
  ///
  /// Finds backup candidates, builds upload tasks, and enqueues them
  /// for background processing.
  Future<void> uploadBackupCandidates(String userId) async {
    await _storageRepository.clearCache();
    shouldAbortQueuingTasks = false;

    final candidates = await _backupRepository.getCandidates(userId);
    if (candidates.isEmpty) {
      _logger.info("No new backup candidates found, finishing background upload");
      return;
    }

    _logger.info("Found ${candidates.length} backup candidates for background tasks");

    const batchSize = 100;
    final batch = candidates.take(batchSize).toList();
    final entries = <(LocalAsset, UploadTask)>[];

    for (final asset in batch) {
      final task = await getUploadTask(asset);
      if (task != null) {
        entries.add((asset, task));
      }
    }

    if (entries.isEmpty || shouldAbortQueuingTasks) {
      return;
    }

    _logger.info("Enqueuing ${entries.length} background upload tasks");
    final results = await enqueueTasks(entries.map((e) => e.$2).toList());

    // background_downloader documents that a binary upload's Range header can fail enqueue
    // outright on iOS (rather than failing once running, as on Android/Desktop). Chunked
    // uploads are the only tasks that use Range, so on that failure we fall back to a plain
    // single-shot upload for that asset rather than silently dropping it from this backup run.
    for (var i = 0; i < entries.length; i++) {
      if (results.length > i && results[i]) {
        continue;
      }
      final (asset, failedTask) = entries[i];
      if (!_isChunkTask(failedTask)) {
        continue;
      }
      _logger.warning("Enqueue failed for chunked upload task ${failedTask.taskId}; falling back to single-shot");
      final fallbackTask = await getUploadTask(asset, forceSingleShot: true);
      if (fallbackTask != null) {
        await _uploadRepository.enqueueBackground(fallbackTask);
      }
    }
  }

  bool _isChunkTask(UploadTask task) {
    final metadata = _tryParseMetadata(task.metaData);
    return metadata != null && metadata.isChunked;
  }

  UploadTaskMetadata? _tryParseMetadata(String metaData) {
    if (metaData.isEmpty) {
      return null;
    }
    try {
      return UploadTaskMetadata.fromJson(metaData);
    } catch (_) {
      return null;
    }
  }

  /// Reconciles chunk chains after an app restart. background_downloader persists each chunk
  /// task's [UploadTaskMetadata] in its own database, so a chain whose last-completed chunk has
  /// no enqueued successor (e.g. the app was killed between chunks) is detectable and can be
  /// resumed here, without a dedicated Drift table. See specs/2026-09-08-chunked-upload-design.md
  /// §7.4. Not optional: without this, chunking would be a reliability regression relative to
  /// today's single persisted UploadTask, which survives an app kill natively.
  Future<void> reconcileChunkChains({String group = kBackupGroup}) async {
    final records = await _uploadRepository.getRecords(group);
    final taskIds = records.map((r) => r.taskId).toSet();

    for (final record in records) {
      if (record.status != TaskStatus.complete) {
        continue;
      }
      final task = record.task;
      if (task is! UploadTask) {
        continue;
      }
      final metadata = _tryParseMetadata(task.metaData);
      if (metadata == null || !metadata.isChunked || metadata.isFinalChunk) {
        continue;
      }

      final nextChunkIndex = metadata.chunkIndex + 1;
      final nextTaskId = '${metadata.localAssetId}#$nextChunkIndex';
      if (taskIds.contains(nextTaskId)) {
        // A successor already exists (enqueued/running/complete/failed) - the chain is healthy.
        continue;
      }

      _logger.info("Reconciling chunk chain for ${metadata.localAssetId}: re-enqueueing chunk $nextChunkIndex");
      final nextTask = _buildNextChunkTask(task, metadata, nextChunkIndex);
      await _uploadRepository.enqueueBackground(nextTask);
    }
  }

  /// Cancel all ongoing background uploads and reset the upload queue
  ///
  /// Returns the number of tasks left in the queue
  Future<int> cancel() async {
    shouldAbortQueuingTasks = true;

    await _storageRepository.clearCache();
    await _uploadRepository.reset(kBackupGroup);
    await _uploadRepository.deleteDatabaseRecords(kBackupGroup);

    final activeTasks = await _uploadRepository.getActiveTasks(kBackupGroup);
    return activeTasks.length;
  }

  /// Resume background backup processing
  Future<void> resume() async {
    await _uploadRepository.start();
    await reconcileChunkChains();
  }

  @visibleForTesting
  void handleTaskStatusUpdate(TaskStatusUpdate update) async {
    final metadata = _tryParseMetadata(update.task.metaData);
    final isMidChainChunk = metadata != null && metadata.isChunked && !metadata.isFinalChunk;

    switch (update.status) {
      case TaskStatus.complete:
        if (isMidChainChunk) {
          unawaited(_enqueueNextChunk(update.task, metadata));
        } else {
          unawaited(_handleLivePhoto(update));
        }

        // Only remove the local (iOS temp) file once the whole chain is done - an intermediate
        // chunk still needs it for the next PATCH.
        if (CurrentPlatform.isIOS && !isMidChainChunk) {
          try {
            final path = await update.task.filePath();
            await File(path).delete();
          } catch (e) {
            _logger.severe('Error deleting file path for iOS: $e');
          }
        }

        break;

      case TaskStatus.failed:
      case TaskStatus.notFound:
        if (metadata != null && metadata.isChunked) {
          unawaited(_handleChunkFailure(metadata));
        }
        break;

      default:
        break;
    }
  }

  /// Enqueues the next chunk of a chain after chunk [metadata.chunkIndex] completes.
  Future<void> _enqueueNextChunk(Task completedTask, UploadTaskMetadata metadata) async {
    if (completedTask is! UploadTask) {
      return;
    }
    final nextTask = _buildNextChunkTask(completedTask, metadata, metadata.chunkIndex + 1);
    await _uploadRepository.enqueueBackground(nextTask);
  }

  /// A chunk exhausted its retries (case 41) or its source file disappeared mid-chain (case 39) -
  /// both surface identically as a terminal failed/notFound status here. Aborts the session so
  /// the server doesn't keep a half-uploaded file around; the asset stays un-backed-up and is
  /// picked up again on a later backup run.
  Future<void> _handleChunkFailure(UploadTaskMetadata metadata) async {
    final sessionId = metadata.sessionId;
    if (sessionId == null) {
      return;
    }
    _logger.warning("Chunked upload failed for ${metadata.localAssetId}; deleting session $sessionId");
    await _uploadRepository.deleteUploadSession(sessionId);
  }

  /// Builds the [nextChunkIndex]th chunk's task by cloning the fields that don't change across a
  /// chain (url - which embeds the session id -, group, requiresWiFi, retries, file location) from
  /// [completedTask], and only advancing the offset/Range headers, taskId and metaData.
  UploadTask _buildNextChunkTask(UploadTask completedTask, UploadTaskMetadata metadata, int nextChunkIndex) {
    final start = nextChunkIndex * metadata.chunkSize;
    final end = math.min(start + metadata.chunkSize, metadata.totalSize) - 1;

    final headers = Map<String, String>.from(completedTask.headers)
      ..['Upload-Offset'] = start.toString()
      ..['Range'] = 'bytes=$start-$end';

    return UploadTask(
      taskId: '${metadata.localAssetId}#$nextChunkIndex',
      displayName: completedTask.displayName,
      httpRequestMethod: completedTask.httpRequestMethod,
      url: completedTask.url,
      headers: headers,
      filename: completedTask.filename,
      post: 'binary',
      baseDirectory: completedTask.baseDirectory,
      directory: completedTask.directory,
      metaData: metadata.copyWith(chunkIndex: nextChunkIndex).toJson(),
      group: completedTask.group,
      requiresWiFi: completedTask.requiresWiFi,
      priority: completedTask.priority,
      updates: completedTask.updates,
      retries: completedTask.retries,
    );
  }

  Future<void> _handleLivePhoto(TaskStatusUpdate update) async {
    try {
      if (update.task.metaData.isEmpty || update.task.metaData == '') {
        return;
      }

      final metadata = UploadTaskMetadata.fromJson(update.task.metaData);
      if (!metadata.isLivePhotos) {
        return;
      }

      if (update.responseBody == null || update.responseBody!.isEmpty) {
        return;
      }
      final response = jsonDecode(update.responseBody!);

      final localAsset = await _localAssetRepository.getById(metadata.localAssetId);
      if (localAsset == null) {
        return;
      }

      final uploadTask = await getLivePhotoUploadTask(localAsset, response['id'] as String);

      if (uploadTask == null) {
        return;
      }

      await enqueueTasks([uploadTask]);
    } catch (error, stackTrace) {
      dPrint(() => "Error handling live photo upload task: $error $stackTrace");
    }
  }

  @visibleForTesting
  Future<UploadTask?> getUploadTask(
    LocalAsset asset, {
    String group = kBackupGroup,
    int? priority,
    bool forceSingleShot = false,
  }) async {
    final entity = await _storageRepository.getAssetEntityForAsset(asset);
    if (entity == null) {
      _logger.warning("Asset entity not found for ${asset.id} - ${asset.name}");
      return null;
    }

    File? file;

    /// iOS LivePhoto has two files: a photo and a video.
    /// They are uploaded separately, with video file being upload first, then returned with the assetId
    /// The assetId is then used as a metadata for the photo file upload task.
    ///
    /// We implement two separate upload groups for this, the normal one for the video file
    /// and the higher priority group for the photo file because the video file is already uploaded.
    ///
    /// The cancel operation will only cancel the video group (normal group), the photo group will not
    /// be touched, as the video file is already uploaded.

    if (entity.isLivePhoto) {
      file = await _storageRepository.getMotionFileForAsset(asset);
    } else {
      file = await _storageRepository.getFileForAsset(asset.id);
    }

    if (file == null) {
      _logger.warning("Failed to get file for asset ${asset.id} - ${asset.name}");
      return null;
    }

    final fileName = await _assetMediaRepository.getOriginalFilename(asset.id) ?? asset.name;
    // Some apps (e.g. DJI/Fusion) return names without an extension; fall back to the asset name for those.
    final extension = p.extension(file.path).isNotEmpty ? p.extension(file.path) : p.extension(asset.name);
    final originalFileName = p.setExtension(fileName, extension);

    final requiresWiFi = _shouldRequireWiFi(asset);

    return _buildUploadTaskForFile(
      file,
      asset: asset,
      originalFileName: originalFileName,
      group: group,
      priority: priority,
      requiresWiFi: requiresWiFi,
      isLivePhotoLeader: entity.isLivePhoto,
      forceSingleShot: forceSingleShot,
      // Visibility hidden on upload to prevent the server from running regular jobs on the live photo asset
      fields: entity.isLivePhoto ? {'visibility': api.AssetVisibility.hidden.toString()} : null,
      cloudId: entity.isLivePhoto ? null : asset.cloudId,
      adjustmentTime: entity.isLivePhoto ? null : asset.adjustmentTime?.toIso8601String(),
      latitude: entity.isLivePhoto ? null : asset.latitude?.toString(),
      longitude: entity.isLivePhoto ? null : asset.longitude?.toString(),
    );
  }

  @visibleForTesting
  Future<UploadTask?> getLivePhotoUploadTask(LocalAsset asset, String livePhotoVideoId) async {
    final entity = await _storageRepository.getAssetEntityForAsset(asset);
    if (entity == null) {
      return null;
    }

    final file = await _storageRepository.getFileForAsset(asset.id);
    if (file == null) {
      return null;
    }

    final fields = {'livePhotoVideoId': livePhotoVideoId};

    final requiresWiFi = _shouldRequireWiFi(asset);
    final originalFileName = await _assetMediaRepository.getOriginalFilename(asset.id) ?? asset.name;

    return _buildUploadTaskForFile(
      file,
      asset: asset,
      originalFileName: originalFileName,
      group: kBackupLivePhotoGroup,
      priority: 0, // Highest priority to get upload immediately
      requiresWiFi: requiresWiFi,
      isLivePhotoLeader: false, // this IS the live photo's still image; no further leg to chain
      fields: fields,
      cloudId: asset.cloudId,
      adjustmentTime: asset.adjustmentTime?.toIso8601String(),
      latitude: asset.latitude?.toString(),
      longitude: asset.longitude?.toString(),
    );
  }

  /// Chooses between the chunked and single-shot (multipart) upload paths for [file] and builds
  /// the resulting task, so both [getUploadTask] and [getLivePhotoUploadTask] - either leg of a
  /// live photo pair can independently be chunked or not, see case 49 - share one decision point.
  Future<UploadTask?> _buildUploadTaskForFile(
    File file, {
    required LocalAsset asset,
    required String originalFileName,
    required String group,
    int? priority,
    required bool requiresWiFi,
    required bool isLivePhotoLeader,
    bool forceSingleShot = false,
    Map<String, String>? fields,
    String? cloudId,
    String? adjustmentTime,
    String? latitude,
    String? longitude,
  }) async {
    final chunkSize = _uploadRepository.uploadChunkSize;
    final fileSize = !forceSingleShot && chunkSize > 0 ? await file.length() : null;

    if (fileSize != null && fileSize > chunkSize) {
      final chunkedTask = await _buildFirstChunkTask(
        file,
        asset: asset,
        originalFileName: originalFileName,
        fileSize: fileSize,
        chunkSize: chunkSize,
        group: group,
        priority: priority,
        requiresWiFi: requiresWiFi,
        isLivePhotoLeader: isLivePhotoLeader,
        fields: fields,
      );
      if (chunkedTask != null) {
        return chunkedTask;
      }
      _logger.warning("Falling back to single-shot upload for ${asset.id} after chunk session creation failed");
    }

    final metadata = UploadTaskMetadata(
      localAssetId: asset.id,
      isLivePhotos: isLivePhotoLeader,
      livePhotoVideoId: '',
    ).toJson();

    return buildUploadTask(
      file,
      createdAt: asset.createdAt,
      modifiedAt: asset.updatedAt,
      originalFileName: originalFileName,
      deviceAssetId: asset.id,
      metadata: metadata,
      group: group,
      priority: priority,
      isFavorite: asset.isFavorite,
      requiresWiFi: requiresWiFi,
      fields: fields,
      cloudId: cloudId,
      adjustmentTime: adjustmentTime,
      latitude: latitude,
      longitude: longitude,
    );
  }

  /// Opens a chunked-upload session and builds the chain's first chunk task. Returns null (to
  /// fall back to single-shot) if the session couldn't be created - e.g. case 32 (server
  /// advertises 0, handled by the caller's threshold check) or a network error at enqueue time.
  Future<UploadTask?> _buildFirstChunkTask(
    File file, {
    required LocalAsset asset,
    required String originalFileName,
    required int fileSize,
    required int chunkSize,
    required String group,
    int? priority,
    required bool requiresWiFi,
    required bool isLivePhotoLeader,
    Map<String, String>? fields,
  }) async {
    final sessionFields = <String, String>{
      'fileCreatedAt': asset.createdAt.toUtc().toIso8601String(),
      'fileModifiedAt': asset.updatedAt.toUtc().toIso8601String(),
      'isFavorite': asset.isFavorite.toString(),
      if (fields != null) ...fields,
    };

    final session = await _uploadRepository.createUploadSession(
      filename: originalFileName,
      size: fileSize,
      fields: sessionFields,
    );

    if (!session.isSession) {
      if (session.isDuplicate) {
        // Background uploads don't send a checksum today, so this shouldn't occur; fall back
        // rather than silently dropping the asset.
        _logger.warning("Unexpected duplicate response opening a session for ${asset.id}");
      }
      return null;
    }

    final serverEndpoint = Store.get(StoreKey.serverEndpoint);
    final headers = ApiService.getRequestHeaders();
    final (baseDirectory, directory, filename) = await Task.split(filePath: file.path);

    final metadata = UploadTaskMetadata(
      localAssetId: asset.id,
      isLivePhotos: isLivePhotoLeader,
      livePhotoVideoId: '',
      sessionId: session.sessionId,
      chunkIndex: 0,
      chunkCount: (fileSize / chunkSize).ceil(),
      chunkSize: chunkSize,
      totalSize: fileSize,
    );

    final end = math.min(chunkSize, fileSize) - 1;

    return UploadTask(
      taskId: '${asset.id}#0',
      displayName: originalFileName,
      httpRequestMethod: 'PATCH',
      url: '$serverEndpoint/assets/upload-session/${session.sessionId}',
      headers: {...headers, 'Upload-Offset': '0', 'Content-Type': 'application/offset+octet-stream', 'Range': 'bytes=0-$end'},
      filename: filename,
      post: 'binary',
      baseDirectory: baseDirectory,
      directory: directory,
      metaData: metadata.toJson(),
      group: group,
      requiresWiFi: requiresWiFi,
      priority: priority ?? 5,
      updates: Updates.statusAndProgress,
      retries: 3,
    );
  }

  bool _shouldRequireWiFi(LocalAsset asset) {
    final backup = SettingsRepository.instance.appConfig.backup;
    if (asset.isVideo && backup.useCellularForVideos) {
      return false;
    }
    if (!asset.isVideo && backup.useCellularForPhotos) {
      return false;
    }
    return true;
  }

  Future<UploadTask> buildUploadTask(
    File file, {
    required String group,
    required DateTime createdAt,
    required DateTime modifiedAt,
    Map<String, String>? fields,
    String? originalFileName,
    String? deviceAssetId,
    String? metadata,
    int? priority,
    bool? isFavorite,
    bool requiresWiFi = true,
    String? cloudId,
    String? adjustmentTime,
    String? latitude,
    String? longitude,
  }) async {
    final serverEndpoint = Store.get(StoreKey.serverEndpoint);
    final url = Uri.parse('$serverEndpoint/assets').toString();
    final headers = ApiService.getRequestHeaders();
    final deviceId = Store.get(StoreKey.deviceId);
    final (baseDirectory, directory, filename) = await Task.split(filePath: file.path);
    final fieldsMap = {
      'filename': originalFileName ?? filename,
      // deviceAssetId/deviceId required by server v2.7.5 and below (drop in v4.0 per #27818).
      'deviceAssetId': deviceAssetId ?? '',
      'deviceId': deviceId,
      'fileCreatedAt': createdAt.toUtc().toIso8601String(),
      'fileModifiedAt': modifiedAt.toUtc().toIso8601String(),
      'isFavorite': isFavorite?.toString() ?? 'false',
      'duration': '0',
      if (fields != null) ...fields,
      if (CurrentPlatform.isIOS && cloudId != null)
        'metadata': jsonEncode([
          RemoteAssetMetadataItem(
            key: RemoteAssetMetadataKey.mobileApp,
            value: RemoteAssetMobileAppMetadata(
              cloudId: cloudId,
              createdAt: createdAt.toIso8601String(),
              adjustmentTime: adjustmentTime,
              latitude: latitude,
              longitude: longitude,
            ),
          ),
        ]),
    };

    return UploadTask(
      taskId: deviceAssetId,
      displayName: originalFileName ?? filename,
      httpRequestMethod: 'POST',
      url: url,
      headers: headers,
      filename: filename,
      fields: fieldsMap,
      baseDirectory: baseDirectory,
      directory: directory,
      fileField: 'assetData',
      metaData: metadata ?? '',
      group: group,
      requiresWiFi: requiresWiFi,
      priority: priority ?? 5,
      updates: Updates.statusAndProgress,
      retries: 3,
    );
  }
}
