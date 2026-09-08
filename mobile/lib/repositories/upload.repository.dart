import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:background_downloader/background_downloader.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/constants/constants.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/network.repository.dart';
import 'package:logging/logging.dart';
import 'package:http/http.dart';
import 'package:http/http.dart' as http;
import 'package:immich_mobile/utils/debug_print.dart';

final uploadRepositoryProvider = Provider((ref) => UploadRepository());

class UploadRepository {
  /// [httpClient] is injectable for testing; production code falls back to the shared,
  /// natively-authenticated client from [NetworkRepository].
  UploadRepository({this.httpClient}) {
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

  final Logger logger = Logger('UploadRepository');
  void Function(TaskStatusUpdate)? onUploadStatus;
  void Function(TaskProgressUpdate)? onTaskProgress;

  final Client? httpClient;
  Client get _client => httpClient ?? NetworkRepository.client;

  /// Server-advertised chunk size (bytes) for the chunked-upload protocol.
  /// 0 (or unset, i.e. an older/unconfigured server) means clients must use the multipart path.
  int get uploadChunkSize => Store.tryGet(StoreKey.uploadChunkSize) ?? 0;

  Future<void> enqueueBackground(UploadTask task) {
    return FileDownloader().enqueue(task);
  }

  Future<List<bool>> enqueueBackgroundAll(List<UploadTask> tasks) {
    return FileDownloader().enqueueAll(tasks);
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

  Future<List<TaskRecord>> getRecords(String group) {
    return FileDownloader().database.allRecords(group: group);
  }

  Future<UploadResult> uploadFile({
    required File file,
    required String originalFileName,
    required Map<String, String> fields,
    required Completer<void>? cancelToken,
    void Function(int bytes, int totalBytes)? onProgress,
    required String logContext,
  }) async {
    final chunkSize = uploadChunkSize;
    final fileSize = file.lengthSync();
    if (chunkSize > 0 && fileSize > chunkSize) {
      return _uploadFileChunked(
        file: file,
        originalFileName: originalFileName,
        fields: fields,
        cancelToken: cancelToken,
        onProgress: onProgress,
        logContext: logContext,
        fileSize: fileSize,
        chunkSize: chunkSize,
      );
    }
    return _uploadFileMultipart(
      file: file,
      originalFileName: originalFileName,
      fields: fields,
      cancelToken: cancelToken,
      onProgress: onProgress,
      logContext: logContext,
    );
  }

  Future<UploadResult> _uploadFileMultipart({
    required File file,
    required String originalFileName,
    required Map<String, String> fields,
    required Completer<void>? cancelToken,
    void Function(int bytes, int totalBytes)? onProgress,
    required String logContext,
  }) async {
    final String savedEndpoint = Store.get(StoreKey.serverEndpoint);
    final baseRequest = ProgressMultipartRequest(
      'POST',
      Uri.parse('$savedEndpoint/assets'),
      abortTrigger: cancelToken?.future,
      onProgress: onProgress,
    );

    try {
      final fileStream = file.openRead();
      final assetRawUploadData = MultipartFile("assetData", fileStream, file.lengthSync(), filename: originalFileName);

      baseRequest.fields.addAll(fields);
      baseRequest.files.add(assetRawUploadData);

      final response = await _client.send(baseRequest);
      final responseBodyString = await response.stream.bytesToString();

      if (![200, 201].contains(response.statusCode)) {
        return _errorResult(response.statusCode, responseBodyString);
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
      logger.warning("Error uploading $logContext: ${error.toString()}: $stackTrace");
      return UploadResult.error(errorMessage: error.toString());
    }
  }

  UploadResult _errorResult(int statusCode, String responseBodyString) {
    String? errorMessage;

    if (statusCode == 413) {
      return UploadResult.error(statusCode: statusCode, errorMessage: 'Error(413) File is too large to upload');
    }

    try {
      final error = jsonDecode(responseBodyString);
      errorMessage = error['message'] ?? error['error'];
    } catch (_) {
      errorMessage = responseBodyString.isNotEmpty ? responseBodyString : 'Upload failed with status $statusCode';
    }

    return UploadResult.error(statusCode: statusCode, errorMessage: errorMessage);
  }

  /// Creates an upload session, then PATCHes the file up in [chunkSize]-sized chunks.
  /// See specs/2026-09-08-chunked-upload-design.md §7.2.
  Future<UploadResult> _uploadFileChunked({
    required File file,
    required String originalFileName,
    required Map<String, String> fields,
    required Completer<void>? cancelToken,
    void Function(int bytes, int totalBytes)? onProgress,
    required String logContext,
    required int fileSize,
    required int chunkSize,
  }) async {
    final String savedEndpoint = Store.get(StoreKey.serverEndpoint);
    String? sessionId;

    try {
      final createBody = _buildSessionCreateBody(fields: fields, filename: originalFileName, size: fileSize);
      final createRequest = http.Request('POST', _sessionsUri(savedEndpoint))
        ..headers['Content-Type'] = 'application/json'
        ..body = jsonEncode(createBody);

      final createResponse = await Response.fromStream(await _client.send(createRequest));

      if (createResponse.statusCode == 200) {
        // Duplicate detected by checksum at create time; no session was opened.
        final body = jsonDecode(createResponse.body) as Map<String, dynamic>;
        return UploadResult.success(remoteAssetId: body['id'] as String);
      }
      if (createResponse.statusCode != 201) {
        return _errorResult(createResponse.statusCode, createResponse.body);
      }

      final session = jsonDecode(createResponse.body) as Map<String, dynamic>;
      sessionId = session['id'] as String;
      var offset = (session['offset'] as num?)?.toInt() ?? 0;

      while (offset < fileSize) {
        if (cancelToken != null && cancelToken.isCompleted) {
          await deleteUploadSession(sessionId);
          return UploadResult.cancelled();
        }

        final end = math.min(offset + chunkSize, fileSize);
        final chunkBytes = await _readChunkBytes(file, offset, end);

        final chunkRequest = ProgressByteRequest(
          'PATCH',
          _sessionUri(savedEndpoint, sessionId),
          abortTrigger: cancelToken?.future,
          onProgress: onProgress,
          progressOffset: offset,
          progressTotal: fileSize,
        )
          ..headers['Content-Type'] = 'application/offset+octet-stream'
          ..headers['Upload-Offset'] = offset.toString()
          ..bodyBytes = chunkBytes;

        final chunkResponse = await Response.fromStream(await _client.send(chunkRequest));

        if (chunkResponse.statusCode == 204) {
          offset = end;
          continue;
        }
        if (chunkResponse.statusCode == 200 || chunkResponse.statusCode == 201) {
          final body = jsonDecode(chunkResponse.body) as Map<String, dynamic>;
          return UploadResult.success(remoteAssetId: body['id'] as String);
        }

        await deleteUploadSession(sessionId);
        return _errorResult(chunkResponse.statusCode, chunkResponse.body);
      }

      // Every chunk offset was consumed without receiving a final (200/201) response.
      await deleteUploadSession(sessionId);
      return UploadResult.error(errorMessage: 'Upload session did not finalize');
    } on RequestAbortedException {
      if (sessionId != null) {
        await deleteUploadSession(sessionId);
      }
      logger.warning("Upload $logContext was cancelled");
      return UploadResult.cancelled();
    } catch (error, stackTrace) {
      if (sessionId != null) {
        await deleteUploadSession(sessionId);
      }
      logger.warning("Error uploading $logContext: ${error.toString()}: $stackTrace");
      return UploadResult.error(errorMessage: error.toString());
    }
  }

  Uri _sessionsUri(String endpoint) => Uri.parse('$endpoint/assets/upload-session');
  Uri _sessionUri(String endpoint, String sessionId) => Uri.parse('$endpoint/assets/upload-session/$sessionId');

  Future<Uint8List> _readChunkBytes(File file, int start, int end) {
    return ByteStream(file.openRead(start, end)).toBytes();
  }

  /// Builds the JSON body for `POST /assets/upload-session` from the existing string-typed
  /// multipart [fields] map, so callers (foreground/background) don't need two field-building
  /// code paths. See specs/2026-09-08-chunked-upload-design.md §4.3.
  Map<String, dynamic> _buildSessionCreateBody({
    required Map<String, String> fields,
    required String filename,
    required int size,
  }) {
    final body = <String, dynamic>{'filename': filename, 'size': size};
    if (fields['fileCreatedAt'] != null) {
      body['fileCreatedAt'] = fields['fileCreatedAt'];
    }
    if (fields['fileModifiedAt'] != null) {
      body['fileModifiedAt'] = fields['fileModifiedAt'];
    }
    if (fields.containsKey('isFavorite')) {
      body['isFavorite'] = fields['isFavorite'] == 'true';
    }
    if (fields.containsKey('duration')) {
      final duration = int.tryParse(fields['duration'] ?? '');
      if (duration != null) {
        body['duration'] = duration;
      }
    }
    if (fields.containsKey('visibility')) {
      body['visibility'] = fields['visibility'];
    }
    if (fields.containsKey('livePhotoVideoId')) {
      body['livePhotoVideoId'] = fields['livePhotoVideoId'];
    }
    if (fields.containsKey('metadata')) {
      try {
        body['metadata'] = jsonDecode(fields['metadata']!);
      } catch (_) {
        // Malformed metadata is dropped rather than failing the whole upload.
      }
    }
    return body;
  }

  /// Opens a chunked-upload session. See specs/2026-09-08-chunked-upload-design.md §4.1.
  Future<UploadSessionResult> createUploadSession({
    required String filename,
    required int size,
    required Map<String, String> fields,
  }) async {
    final String savedEndpoint = Store.get(StoreKey.serverEndpoint);
    try {
      final createBody = _buildSessionCreateBody(fields: fields, filename: filename, size: size);
      final request = http.Request('POST', _sessionsUri(savedEndpoint))
        ..headers['Content-Type'] = 'application/json'
        ..body = jsonEncode(createBody);

      final response = await Response.fromStream(await _client.send(request));

      if (response.statusCode == 200) {
        final body = jsonDecode(response.body) as Map<String, dynamic>;
        return UploadSessionResult(duplicateAssetId: body['id'] as String);
      }
      if (response.statusCode != 201) {
        final errorResult = _errorResult(response.statusCode, response.body);
        return UploadSessionResult(statusCode: response.statusCode, errorMessage: errorResult.errorMessage);
      }

      final body = jsonDecode(response.body) as Map<String, dynamic>;
      return UploadSessionResult(sessionId: body['id'] as String, offset: (body['offset'] as num?)?.toInt() ?? 0);
    } catch (error, stackTrace) {
      logger.warning("Error creating upload session for $filename: ${error.toString()}: $stackTrace");
      return UploadSessionResult(errorMessage: error.toString());
    }
  }

  /// Aborts an in-progress upload session and deletes its partial data. Best-effort: a failure
  /// here just leaves the session to be swept by the server's TTL.
  Future<void> deleteUploadSession(String sessionId) async {
    final String savedEndpoint = Store.get(StoreKey.serverEndpoint);
    try {
      await _client.send(http.Request('DELETE', _sessionUri(savedEndpoint, sessionId)));
    } catch (error, stackTrace) {
      logger.warning("Error deleting upload session $sessionId: ${error.toString()}: $stackTrace");
    }
  }
}

class UploadSessionResult {
  final String? sessionId;
  final int offset;
  final String? duplicateAssetId;
  final String? errorMessage;
  final int? statusCode;

  const UploadSessionResult({
    this.sessionId,
    this.offset = 0,
    this.duplicateAssetId,
    this.errorMessage,
    this.statusCode,
  });

  bool get isSession => sessionId != null;
  bool get isDuplicate => duplicateAssetId != null;
  bool get isError => sessionId == null && duplicateAssetId == null;
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

/// A single-chunk PATCH request that reports progress against the whole file, not just this
/// chunk: [progressOffset] is the number of bytes already committed before this chunk started,
/// and [progressTotal] is the whole file's size — together they keep the chunked path's
/// `onProgress(bytes, totalBytes)` shape identical to the multipart path's.
class ProgressByteRequest extends http.Request with Abortable {
  ProgressByteRequest(
    super.method,
    super.url, {
    this.abortTrigger,
    this.onProgress,
    this.progressOffset = 0,
    required this.progressTotal,
  });

  @override
  final Future<void>? abortTrigger;

  final void Function(int bytes, int totalBytes)? onProgress;
  final int progressOffset;
  final int progressTotal;

  @override
  ByteStream finalize() {
    final byteStream = super.finalize();
    if (onProgress == null) {
      return byteStream;
    }

    final total = progressTotal;
    var bytes = 0;
    final stream = byteStream.transform(
      StreamTransformer.fromHandlers(
        handleData: (List<int> data, EventSink<List<int>> sink) {
          bytes += data.length;
          onProgress!(progressOffset + bytes, total);
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
