import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:drift/drift.dart' hide isNull, isNotNull;
import 'package:drift/native.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/settings.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/repositories/upload.repository.dart';
import 'package:immich_mobile/services/foreground_upload.service.dart';
import 'package:mocktail/mocktail.dart';

import '../api.mocks.dart';
import '../fixtures/asset.stub.dart';
import '../infrastructure/repository.mock.dart';
import '../mocks/asset_entity.mock.dart';
import '../repository.mocks.dart';

class MockHttpClient extends Mock implements http.Client {}

void main() {
  late ForegroundUploadService sut;
  late MockUploadRepository mockUploadRepository;
  late MockStorageRepository mockStorageRepository;
  late MockDriftBackupRepository mockBackupRepository;
  late MockConnectivityApi mockConnectivityApi;
  late MockAssetMediaRepository mockAssetMediaRepository;
  late Drift db;

  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
      const MethodChannel('plugins.flutter.io/path_provider'),
      (MethodCall methodCall) async => 'test',
    );
    db = Drift(DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: DriftStoreRepository(db));
    await SettingsRepository.ensureInitialized(db);

    await Store.put(StoreKey.serverEndpoint, 'http://demo.immich.app');
    await Store.put(StoreKey.deviceId, 'device-id');

    registerFallbackValue(File('file'));
    registerFallbackValue(<String, String>{});
    registerFallbackValue(http.Request('GET', Uri.parse('http://demo.immich.app')));
  });

  setUp(() {
    mockUploadRepository = MockUploadRepository();
    mockStorageRepository = MockStorageRepository();
    mockBackupRepository = MockDriftBackupRepository();
    mockConnectivityApi = MockConnectivityApi();
    mockAssetMediaRepository = MockAssetMediaRepository();

    sut = ForegroundUploadService(
      mockUploadRepository,
      mockStorageRepository,
      mockBackupRepository,
      mockConnectivityApi,
      mockAssetMediaRepository,
    );
  });

  List<Map<String, String>> captureFields() {
    final captured = <Map<String, String>>[];
    when(
      () => mockUploadRepository.uploadFile(
        file: any(named: 'file'),
        originalFileName: any(named: 'originalFileName'),
        fields: any(named: 'fields'),
        cancelToken: any(named: 'cancelToken'),
        onProgress: any(named: 'onProgress'),
        logContext: any(named: 'logContext'),
      ),
    ).thenAnswer((invocation) async {
      final fields = invocation.namedArguments[#fields] as Map<String, String>;
      captured.add(Map.of(fields));
      return UploadResult.success(remoteAssetId: 'remote-${captured.length}');
    });
    return captured;
  }

  List<String> captureOriginalFileNames() {
    final captured = <String>[];
    when(
      () => mockUploadRepository.uploadFile(
        file: any(named: 'file'),
        originalFileName: any(named: 'originalFileName'),
        fields: any(named: 'fields'),
        cancelToken: any(named: 'cancelToken'),
        onProgress: any(named: 'onProgress'),
        logContext: any(named: 'logContext'),
      ),
    ).thenAnswer((invocation) async {
      captured.add(invocation.namedArguments[#originalFileName] as String);
      return UploadResult.success(remoteAssetId: 'remote-${captured.length}');
    });
    return captured;
  }

  group('uploadSingleAsset', () {
    test('should upload the motion part hidden and keep the still image visible', () async {
      final asset = LocalAssetStub.image1;
      final mockEntity = MockAssetEntity();
      final stillFile = File('/path/to/still.heic');
      final videoFile = File('/path/to/motion.mov');

      when(() => mockEntity.isLivePhoto).thenReturn(true);
      when(() => mockStorageRepository.getAssetEntityForAsset(asset)).thenAnswer((_) async => mockEntity);
      when(() => mockStorageRepository.isAssetAvailableLocally(asset.id)).thenAnswer((_) async => true);
      when(() => mockStorageRepository.getFileForAsset(asset.id)).thenAnswer((_) async => stillFile);
      when(() => mockStorageRepository.getMotionFileForAsset(asset)).thenAnswer((_) async => videoFile);
      when(() => mockAssetMediaRepository.getOriginalFilename(asset.id)).thenAnswer((_) async => 'live.heic');

      final captured = captureFields();

      await sut.uploadSingleAsset(asset, null, callbacks: const UploadCallbacks());

      expect(captured, hasLength(2));
      expect(captured[0]['visibility'], equals('hidden'));
      expect(captured[0].containsKey('livePhotoVideoId'), isFalse);
      expect(captured[1].containsKey('visibility'), isFalse);
      expect(captured[1]['livePhotoVideoId'], equals('remote-1'));
    });

    test('should not set visibility for a regular photo', () async {
      final asset = LocalAssetStub.image1;
      final mockEntity = MockAssetEntity();
      final stillFile = File('/path/to/photo.jpg');

      when(() => mockEntity.isLivePhoto).thenReturn(false);
      when(() => mockStorageRepository.getAssetEntityForAsset(asset)).thenAnswer((_) async => mockEntity);
      when(() => mockStorageRepository.isAssetAvailableLocally(asset.id)).thenAnswer((_) async => true);
      when(() => mockStorageRepository.getFileForAsset(asset.id)).thenAnswer((_) async => stillFile);
      when(() => mockAssetMediaRepository.getOriginalFilename(asset.id)).thenAnswer((_) async => 'photo.jpg');

      final captured = captureFields();

      await sut.uploadSingleAsset(asset, null, callbacks: const UploadCallbacks());

      expect(captured, hasLength(1));
      expect(captured[0].containsKey('visibility'), isFalse);
    });

    test('corrects the extension when iOS returns a rendered file for a .dng asset', () async {
      final asset = LocalAssetStub.image1;
      final mockEntity = MockAssetEntity();
      final stillFile = File('/path/to/IMG_6499.jpg');

      when(() => mockEntity.isLivePhoto).thenReturn(false);
      when(() => mockStorageRepository.getAssetEntityForAsset(asset)).thenAnswer((_) async => mockEntity);
      when(() => mockStorageRepository.isAssetAvailableLocally(asset.id)).thenAnswer((_) async => true);
      when(() => mockStorageRepository.getFileForAsset(asset.id)).thenAnswer((_) async => stillFile);
      when(() => mockAssetMediaRepository.getOriginalFilename(asset.id)).thenAnswer((_) async => 'IMG_6499.dng');

      final names = captureOriginalFileNames();

      await sut.uploadSingleAsset(asset, null, callbacks: const UploadCallbacks());

      expect(names, equals(['IMG_6499.jpg']));
    });

    test('keeps the .dng extension for a genuine RAW original', () async {
      final asset = LocalAssetStub.image1;
      final mockEntity = MockAssetEntity();
      final stillFile = File('/path/to/IMG_5210.dng');

      when(() => mockEntity.isLivePhoto).thenReturn(false);
      when(() => mockStorageRepository.getAssetEntityForAsset(asset)).thenAnswer((_) async => mockEntity);
      when(() => mockStorageRepository.isAssetAvailableLocally(asset.id)).thenAnswer((_) async => true);
      when(() => mockStorageRepository.getFileForAsset(asset.id)).thenAnswer((_) async => stillFile);
      when(() => mockAssetMediaRepository.getOriginalFilename(asset.id)).thenAnswer((_) async => 'IMG_5210.dng');

      final names = captureOriginalFileNames();

      await sut.uploadSingleAsset(asset, null, callbacks: const UploadCallbacks());

      expect(names, equals(['IMG_5210.dng']));
    });

    test('borrows the extension from the asset name for an extensionless name (DJI/Fusion)', () async {
      final asset = LocalAssetStub.image1;
      final mockEntity = MockAssetEntity();
      final stillFile = File('/path/to/DJI_0001');

      when(() => mockEntity.isLivePhoto).thenReturn(false);
      when(() => mockStorageRepository.getAssetEntityForAsset(asset)).thenAnswer((_) async => mockEntity);
      when(() => mockStorageRepository.isAssetAvailableLocally(asset.id)).thenAnswer((_) async => true);
      when(() => mockStorageRepository.getFileForAsset(asset.id)).thenAnswer((_) async => stillFile);
      when(() => mockAssetMediaRepository.getOriginalFilename(asset.id)).thenAnswer((_) async => 'DJI_0001');

      final names = captureOriginalFileNames();

      await sut.uploadSingleAsset(asset, null, callbacks: const UploadCallbacks());

      expect(names, equals(['DJI_0001.jpg']));
    });
  });

  group('UploadRepository.uploadFile - chunked uploads', () {
    late MockHttpClient mockClient;
    late UploadRepository uploadRepo;
    late Directory tempDir;

    setUp(() async {
      mockClient = MockHttpClient();
      uploadRepo = UploadRepository(httpClient: mockClient);
      tempDir = await Directory.systemTemp.createTemp('chunked_upload_test');
      await Store.delete(StoreKey.uploadChunkSize);
    });

    tearDown(() async {
      await tempDir.delete(recursive: true);
    });

    Future<File> writeFile(int size) async {
      final file = File('${tempDir.path}/asset.bin');
      await file.writeAsBytes(List<int>.filled(size, 7));
      return file;
    }

    Map<String, String> baseFields() => {
      'fileCreatedAt': DateTime(2026, 1, 1).toUtc().toIso8601String(),
      'fileModifiedAt': DateTime(2026, 1, 1).toUtc().toIso8601String(),
      'isFavorite': 'false',
      'duration': '0',
    };

    http.StreamedResponse jsonResponse(int status, Map<String, dynamic> body, {Map<String, String> headers = const {}}) {
      return http.StreamedResponse(Stream.value(utf8.encode(jsonEncode(body))), status, headers: headers);
    }

    http.StreamedResponse emptyResponse(int status, {Map<String, String> headers = const {}}) {
      return http.StreamedResponse(Stream.value(const <int>[]), status, headers: headers);
    }

    /// Stubs a happy-path 3-chunk sequence (chunkSize 10, fileSize 25 -> 10/10/5) that finalizes
    /// with [remoteAssetId] on the last chunk.
    List<http.BaseRequest> stubHappyPathChunks({required String remoteAssetId}) {
      final calls = <http.BaseRequest>[];
      when(() => mockClient.send(any())).thenAnswer((invocation) async {
        final request = invocation.positionalArguments[0] as http.BaseRequest;
        calls.add(request);
        if (request.method == 'POST' && request.url.path == '/assets/upload-session') {
          return jsonResponse(201, {'id': 'session-1', 'offset': 0, 'expiresAt': '2026-01-01T00:00:00.000Z'});
        }
        if (request.method == 'PATCH') {
          // A real Client.send() implementation calls finalize() to obtain and transmit the
          // body stream; draining it here exercises ProgressByteRequest's progress transform,
          // same as production.
          await request.finalize().toBytes();
          final offset = int.parse(request.headers['Upload-Offset']!);
          final next = offset + 10;
          if (next >= 25) {
            return jsonResponse(201, {'id': remoteAssetId});
          }
          return emptyResponse(204, headers: {'Upload-Offset': '$next'});
        }
        if (request.method == 'DELETE') {
          return emptyResponse(204);
        }
        throw StateError('Unexpected request: ${request.method} ${request.url}');
      });
      return calls;
    }

    test('a file above the threshold creates a session and sends N chunks', () async {
      await Store.put(StoreKey.uploadChunkSize, 10);
      final file = await writeFile(25);
      final calls = stubHappyPathChunks(remoteAssetId: 'remote-asset-1');

      final result = await uploadRepo.uploadFile(
        file: file,
        originalFileName: 'asset.bin',
        fields: baseFields(),
        cancelToken: null,
        logContext: 'test',
      );

      expect(result.isSuccess, isTrue);
      expect(result.remoteAssetId, equals('remote-asset-1'));

      final creates = calls.where((r) => r.method == 'POST' && r.url.path == '/assets/upload-session').toList();
      expect(creates, hasLength(1));

      final patches = calls.where((r) => r.method == 'PATCH').toList();
      expect(patches, hasLength(3));
      expect(patches[0].headers['Upload-Offset'], equals('0'));
      expect(patches[1].headers['Upload-Offset'], equals('10'));
      expect(patches[2].headers['Upload-Offset'], equals('20'));
      expect(patches.every((r) => r.headers['Content-Type'] == 'application/offset+octet-stream'), isTrue);
    });

    test('a file below the threshold uses the existing multipart path', () async {
      await Store.put(StoreKey.uploadChunkSize, 1000);
      final file = await writeFile(10);
      final calls = <http.BaseRequest>[];
      when(() => mockClient.send(any())).thenAnswer((invocation) async {
        final request = invocation.positionalArguments[0] as http.BaseRequest;
        calls.add(request);
        return jsonResponse(201, {'id': 'multipart-asset'});
      });

      final result = await uploadRepo.uploadFile(
        file: file,
        originalFileName: 'asset.bin',
        fields: baseFields(),
        cancelToken: null,
        logContext: 'test',
      );

      expect(result.isSuccess, isTrue);
      expect(result.remoteAssetId, equals('multipart-asset'));
      expect(calls, hasLength(1));
      expect(calls.single, isA<http.MultipartRequest>());
      expect(calls.single.url.path, equals('/assets'));
    });

    test('server advertising 0 forces multipart even for a large file', () async {
      await Store.put(StoreKey.uploadChunkSize, 0);
      final file = await writeFile(10000);
      final calls = <http.BaseRequest>[];
      when(() => mockClient.send(any())).thenAnswer((invocation) async {
        final request = invocation.positionalArguments[0] as http.BaseRequest;
        calls.add(request);
        return jsonResponse(201, {'id': 'multipart-asset'});
      });

      final result = await uploadRepo.uploadFile(
        file: file,
        originalFileName: 'asset.bin',
        fields: baseFields(),
        cancelToken: null,
        logContext: 'test',
      );

      expect(result.isSuccess, isTrue);
      expect(calls, hasLength(1));
      expect(calls.single, isA<http.MultipartRequest>());
    });

    test('cancel aborts the in-flight chunk and DELETEs the session', () async {
      await Store.put(StoreKey.uploadChunkSize, 10);
      final file = await writeFile(25);
      final cancelToken = Completer<void>();
      final calls = <http.BaseRequest>[];

      when(() => mockClient.send(any())).thenAnswer((invocation) async {
        final request = invocation.positionalArguments[0] as http.BaseRequest;
        calls.add(request);
        if (request.method == 'POST') {
          return jsonResponse(201, {'id': 'session-1', 'offset': 0, 'expiresAt': '2026-01-01T00:00:00.000Z'});
        }
        if (request.method == 'PATCH') {
          cancelToken.complete();
          throw http.RequestAbortedException(request.url);
        }
        if (request.method == 'DELETE') {
          return emptyResponse(204);
        }
        throw StateError('Unexpected request: ${request.method} ${request.url}');
      });

      final result = await uploadRepo.uploadFile(
        file: file,
        originalFileName: 'asset.bin',
        fields: baseFields(),
        cancelToken: cancelToken,
        logContext: 'test',
      );

      expect(result.isCancelled, isTrue);
      final deletes = calls.where((r) => r.method == 'DELETE').toList();
      expect(deletes, hasLength(1));
      expect(deletes.single.url.path, equals('/assets/upload-session/session-1'));
    });

    test('progress callback totals equal the file size', () async {
      await Store.put(StoreKey.uploadChunkSize, 10);
      final file = await writeFile(25);
      stubHappyPathChunks(remoteAssetId: 'remote-asset-1');

      final progressCalls = <List<int>>[];
      await uploadRepo.uploadFile(
        file: file,
        originalFileName: 'asset.bin',
        fields: baseFields(),
        cancelToken: null,
        onProgress: (bytes, totalBytes) => progressCalls.add([bytes, totalBytes]),
        logContext: 'test',
      );

      expect(progressCalls, isNotEmpty);
      expect(progressCalls.every((c) => c[1] == 25), isTrue);
      expect(progressCalls.last[0], equals(25));
      // Monotonically non-decreasing across the whole upload.
      for (var i = 1; i < progressCalls.length; i++) {
        expect(progressCalls[i][0], greaterThanOrEqualTo(progressCalls[i - 1][0]));
      }
    });
  });
}
