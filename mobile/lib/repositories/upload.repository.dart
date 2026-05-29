import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:background_downloader/background_downloader.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:http/http.dart';
import 'package:immich_mobile/constants/constants.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/extensions/translate_extensions.dart';
import 'package:immich_mobile/infrastructure/repositories/network.repository.dart';
import 'package:immich_mobile/utils/debug_print.dart';
import 'package:logging/logging.dart';

final uploadRepositoryProvider = Provider((ref) => UploadRepository());

typedef BackgroundDownloaderMethodInvoker = Future<void> Function(String method, Object? arguments);
typedef BackgroundDownloaderConfigurator = Future<void> Function(List<(String, dynamic)> globalConfig);

class UploadRepository {
  final Logger logger = Logger('UploadRepository');
  static const _backgroundDownloaderChannel = MethodChannel('com.bbflight.background_downloader');
  final BackgroundDownloaderMethodInvoker _backgroundDownloaderMethodInvoker;
  final BackgroundDownloaderConfigurator _backgroundDownloaderConfigurator;
  void Function(TaskStatusUpdate)? onUploadStatus;
  void Function(TaskProgressUpdate)? onTaskProgress;

  UploadRepository()
    : _backgroundDownloaderMethodInvoker = ((method, arguments) =>
          _backgroundDownloaderChannel.invokeMethod<void>(method, arguments)),
      _backgroundDownloaderConfigurator = ((globalConfig) => FileDownloader().configure(globalConfig: globalConfig)) {
    _registerCallbacks();
  }

  @visibleForTesting
  UploadRepository.forTesting({
    required BackgroundDownloaderMethodInvoker backgroundDownloaderMethodInvoker,
    BackgroundDownloaderConfigurator? backgroundDownloaderConfigurator,
  }) : _backgroundDownloaderMethodInvoker = backgroundDownloaderMethodInvoker,
       _backgroundDownloaderConfigurator =
           backgroundDownloaderConfigurator ??
           ((globalConfig) => FileDownloader().configure(globalConfig: globalConfig));

  void _registerCallbacks() {
    FileDownloader().registerCallbacks(
      group: kBackupGroup,
      taskStatusCallback: (update) => onUploadStatus?.call(update),
      taskProgressCallback: (update) => onTaskProgress?.call(update),
    );
    FileDownloader().registerCallbacks(
      group: kBackupLivePhotoGroup,
      taskStatusCallback: (update) => onUploadStatus?.call(update),
      taskProgressCallback: (update) => onTaskProgress?.call(update),
    );
    FileDownloader().registerCallbacks(
      group: kManualUploadGroup,
      taskStatusCallback: (update) => onUploadStatus?.call(update),
      taskProgressCallback: (update) => onTaskProgress?.call(update),
    );
  }

  Future<void> enqueueBackground(UploadTask task) {
    return FileDownloader().enqueue(task);
  }

  Future<List<bool>> enqueueBackgroundAll(List<UploadTask> tasks) {
    return FileDownloader().enqueueAll(tasks);
  }

  Future<void> disableHoldingQueue() {
    return _backgroundDownloaderConfigurator([(Config.holdingQueue, Config.never)]);
  }

  Future<void> restoreDefaultHoldingQueue() {
    return _backgroundDownloaderConfigurator([(Config.holdingQueue, (6, 6, 3))]);
  }

  Future<void> updateNotification(Task task, TaskStatus? status) {
    // background_downloader's iOS enqueueAll holding-queue path can report a
    // successful enqueue without registering the group notification. Post the
    // existing backup group notification immediately so the background task is
    // visible before URLSession starts sending data.
    final notificationConfig = TaskNotificationConfig(
      taskOrGroup: task.group,
      running: TaskNotification('uploading_media'.t(), 'backup_background_service_in_progress_notification'.t()),
      complete: TaskNotification('upload_finished'.t(), 'backup_background_service_complete_notification'.t()),
      error: TaskNotification(
        'backup_background_service_error_title'.t(),
        'backup_background_service_backup_failed_message'.t(),
      ),
      groupNotificationId: kBackupGroup,
    );

    // The iOS plugin handler performs the native update but does not reply on
    // the method channel in background_downloader 9.5.x, so do not await the
    // platform response from the background enqueue path.
    try {
      unawaited(
        _backgroundDownloaderMethodInvoker('updateNotification', [
          jsonEncode(task.toJson()),
          jsonEncode(notificationConfig.toJson()),
          status?.index,
        ]).catchError((Object error, StackTrace stackTrace) {
          logger.warning('Failed to update upload notification', error, stackTrace);
        }),
      );
    } catch (error, stackTrace) {
      logger.warning('Failed to update upload notification', error, stackTrace);
    }
    return Future.value();
  }

  Future<void> deleteDatabaseRecords(String group) {
    return FileDownloader().database.deleteAllRecords(group: group);
  }

  Future<bool> cancelAll(String group) {
    return FileDownloader().cancelAll(group: group);
  }

  Future<int> reset(String group) {
    return FileDownloader().reset(group: group);
  }

  /// Get a list of tasks that are ENQUEUED or RUNNING
  Future<List<Task>> getActiveTasks(String group) {
    return FileDownloader().allTasks(group: group);
  }

  Future<void> start() {
    return FileDownloader().start();
  }

  Future<void> getUploadInfo() async {
    final [enqueuedTasks, runningTasks, canceledTasks, waitingTasks, pausedTasks] = await Future.wait([
      FileDownloader().database.allRecordsWithStatus(TaskStatus.enqueued, group: kBackupGroup),
      FileDownloader().database.allRecordsWithStatus(TaskStatus.running, group: kBackupGroup),
      FileDownloader().database.allRecordsWithStatus(TaskStatus.canceled, group: kBackupGroup),
      FileDownloader().database.allRecordsWithStatus(TaskStatus.waitingToRetry, group: kBackupGroup),
      FileDownloader().database.allRecordsWithStatus(TaskStatus.paused, group: kBackupGroup),
    ]);

    dPrint(
      () =>
          """
      Upload Info:
      Enqueued: ${enqueuedTasks.length}
      Running: ${runningTasks.length}
      Canceled: ${canceledTasks.length}
      Waiting: ${waitingTasks.length}
      Paused: ${pausedTasks.length}
    """,
    );
  }

  Future<UploadResult> uploadFile({
    required File file,
    required String originalFileName,
    required Map<String, String> fields,
    required Completer<void>? cancelToken,
    void Function(int bytes, int totalBytes)? onProgress,
    required String logContext,
    Client? httpClient,
  }) async {
    final String savedEndpoint = Store.get(StoreKey.serverEndpoint);

    ProgressMultipartRequest buildRequest() {
      final request = ProgressMultipartRequest(
        'POST',
        Uri.parse('$savedEndpoint/assets'),
        abortTrigger: cancelToken?.future,
        onProgress: onProgress,
      );
      request.fields.addAll(fields);
      request.files.add(MultipartFile("assetData", file.openRead(), file.lengthSync(), filename: originalFileName));
      return request;
    }

    try {
      final client = httpClient ?? NetworkRepository.client;
      StreamedResponse response;
      try {
        response = await client.send(buildRequest());
      } on RequestAbortedException {
        rethrow;
      } on ClientException catch (error) {
        logger.warning("Upload $logContext failed before a response, resending once: $error");
        response = await client.send(buildRequest());
      }

      final responseBodyString = await response.stream.bytesToString();

      if (![200, 201].contains(response.statusCode)) {
        String? errorMessage;

        if (response.statusCode == 413) {
          errorMessage = 'Error(413) File is too large to upload';
          return UploadResult.error(statusCode: response.statusCode, errorMessage: errorMessage);
        }

        try {
          final error = jsonDecode(responseBodyString);
          errorMessage = error['message'] ?? error['error'];
        } catch (_) {
          errorMessage = responseBodyString.isNotEmpty
              ? responseBodyString
              : 'Upload failed with status ${response.statusCode}';
        }

        return UploadResult.error(statusCode: response.statusCode, errorMessage: errorMessage);
      }

      try {
        final responseBody = jsonDecode(responseBodyString);
        return UploadResult.success(remoteAssetId: responseBody['id'] as String);
      } catch (e) {
        return UploadResult.error(errorMessage: 'Failed to parse server response');
      }
    } on RequestAbortedException {
      logger.warning("Upload $logContext was cancelled");
      return UploadResult.cancelled();
    } catch (error, stackTrace) {
      logger.warning("Error uploading $logContext: $error: $stackTrace");
      return UploadResult.error(errorMessage: error.toString());
    }
  }
}

class ProgressMultipartRequest extends MultipartRequest with Abortable {
  ProgressMultipartRequest(super.method, super.url, {this.abortTrigger, this.onProgress});

  @override
  final Future<void>? abortTrigger;

  final void Function(int bytes, int totalBytes)? onProgress;

  @override
  ByteStream finalize() {
    final byteStream = super.finalize();
    if (onProgress == null) {
      return byteStream;
    }

    final total = contentLength;
    var bytes = 0;
    final stream = byteStream.transform(
      StreamTransformer.fromHandlers(
        handleData: (List<int> data, EventSink<List<int>> sink) {
          bytes += data.length;
          onProgress!(bytes, total);
          sink.add(data);
        },
      ),
    );
    return ByteStream(stream);
  }
}

class UploadResult {
  final bool isSuccess;
  final bool isCancelled;
  final String? remoteAssetId;
  final String? errorMessage;
  final int? statusCode;

  const UploadResult({
    required this.isSuccess,
    required this.isCancelled,
    this.remoteAssetId,
    this.errorMessage,
    this.statusCode,
  });

  factory UploadResult.success({required String remoteAssetId}) {
    return UploadResult(isSuccess: true, isCancelled: false, remoteAssetId: remoteAssetId);
  }

  factory UploadResult.error({String? errorMessage, int? statusCode}) {
    return UploadResult(isSuccess: false, isCancelled: false, errorMessage: errorMessage, statusCode: statusCode);
  }

  factory UploadResult.cancelled() {
    return const UploadResult(isSuccess: false, isCancelled: true);
  }
}
