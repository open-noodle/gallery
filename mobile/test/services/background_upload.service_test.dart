import 'dart:convert';
import 'dart:io';

import 'package:background_downloader/background_downloader.dart';
import 'package:drift/drift.dart' hide isNotNull, isNull;
import 'package:drift/native.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/constants/constants.dart';
import 'package:immich_mobile/data/db/main/database.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/settings.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/repositories/upload.repository.dart';
import 'package:immich_mobile/services/background_upload.service.dart';
import 'package:mocktail/mocktail.dart';

import '../fixtures/asset.stub.dart';
import '../infrastructure/repository.mock.dart';
import '../mocks/asset_entity.mock.dart';
import '../repository.mocks.dart';

void main() {
  late BackgroundUploadService sut;
  late MockUploadRepository mockUploadRepository;
  late MockStorageRepository mockStorageRepository;
  late MockLocalAssetRepository mockLocalAssetRepository;
  late MockBackupRepository mockBackupRepository;
  late MockAssetMediaRepository mockAssetMediaRepository;
  late Drift db;

  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
      const MethodChannel('plugins.flutter.io/path_provider'),
      (MethodCall methodCall) async => 'test',
    );
    db = Drift(DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: StoreRepository(db));
    await SettingsRepository.ensureInitialized(db);

    await Store.put(StoreKey.serverEndpoint, 'http://test-server.com');
    await Store.put(StoreKey.deviceId, 'test-device-id');

    registerFallbackValue(
      UploadTask(url: 'http://test-server.com/assets', filename: 'fallback', post: 'binary'),
    );
    registerFallbackValue(LocalAssetStub.image1);
  });

  setUp(() {
    mockUploadRepository = MockUploadRepository();
    mockStorageRepository = MockStorageRepository();
    mockLocalAssetRepository = MockLocalAssetRepository();
    mockBackupRepository = MockBackupRepository();
    mockAssetMediaRepository = MockAssetMediaRepository();

    // Defaults to "server doesn't support chunking" so existing (pre-chunking) tests keep
    // exercising the single-shot path unchanged; chunked-path tests override this per-test.
    when(() => mockUploadRepository.uploadChunkSize).thenReturn(0);

    sut = BackgroundUploadService(
      mockUploadRepository,
      mockStorageRepository,
      mockLocalAssetRepository,
      mockBackupRepository,
      mockAssetMediaRepository,
    );

    mockUploadRepository.onUploadStatus = (_) {};
    mockUploadRepository.onTaskProgress = (_) {};
  });

  tearDown(() {
    sut.dispose();
  });

  group('getUploadTask', () {
    test('should call getOriginalFilename from AssetMediaRepository for regular photo', () async {
      final asset = LocalAssetStub.image1;
      final mockEntity = MockAssetEntity();
      final mockFile = File('/path/to/file.jpg');

      when(() => mockEntity.isLivePhoto).thenReturn(false);
      when(() => mockStorageRepository.getAssetEntityForAsset(asset)).thenAnswer((_) async => mockEntity);
      when(() => mockStorageRepository.getFileForAsset(asset.id)).thenAnswer((_) async => mockFile);
      when(() => mockAssetMediaRepository.getOriginalFilename(asset.id)).thenAnswer((_) async => 'OriginalPhoto.jpg');

      final task = await sut.getUploadTask(asset);

      expect(task, isNotNull);
      expect(task!.fields['filename'], equals('OriginalPhoto.jpg'));
      verify(() => mockAssetMediaRepository.getOriginalFilename(asset.id)).called(1);
    });

    test('should call getOriginalFilename when original filename is null', () async {
      final asset = LocalAssetStub.image2;
      final mockEntity = MockAssetEntity();
      final mockFile = File('/path/to/file.jpg');

      when(() => mockEntity.isLivePhoto).thenReturn(false);
      when(() => mockStorageRepository.getAssetEntityForAsset(asset)).thenAnswer((_) async => mockEntity);
      when(() => mockStorageRepository.getFileForAsset(asset.id)).thenAnswer((_) async => mockFile);
      when(() => mockAssetMediaRepository.getOriginalFilename(asset.id)).thenAnswer((_) async => null);

      final task = await sut.getUploadTask(asset);

      expect(task, isNotNull);
      expect(task!.fields['filename'], equals(asset.name));
      verify(() => mockAssetMediaRepository.getOriginalFilename(asset.id)).called(1);
    });

    test('should call getOriginalFilename for live photo', () async {
      final asset = LocalAssetStub.image1;
      final mockEntity = MockAssetEntity();
      final mockFile = File('/path/to/file.mov');

      when(() => mockEntity.isLivePhoto).thenReturn(true);
      when(() => mockStorageRepository.getAssetEntityForAsset(asset)).thenAnswer((_) async => mockEntity);
      when(() => mockStorageRepository.getMotionFileForAsset(asset)).thenAnswer((_) async => mockFile);
      when(
        () => mockAssetMediaRepository.getOriginalFilename(asset.id),
      ).thenAnswer((_) async => 'OriginalLivePhoto.HEIC');

      final task = await sut.getUploadTask(asset);
      expect(task, isNotNull);
      // For live photos, extension should be changed to match the video file
      expect(task!.fields['filename'], equals('OriginalLivePhoto.mov'));
      expect(task.fields['visibility'], equals('hidden'));
      verify(() => mockAssetMediaRepository.getOriginalFilename(asset.id)).called(1);
    });

    test('should not set visibility for a regular photo', () async {
      final asset = LocalAssetStub.image1;
      final mockEntity = MockAssetEntity();
      final mockFile = File('/path/to/file.jpg');

      when(() => mockEntity.isLivePhoto).thenReturn(false);
      when(() => mockStorageRepository.getAssetEntityForAsset(asset)).thenAnswer((_) async => mockEntity);
      when(() => mockStorageRepository.getFileForAsset(asset.id)).thenAnswer((_) async => mockFile);
      when(() => mockAssetMediaRepository.getOriginalFilename(asset.id)).thenAnswer((_) async => 'Regular.jpg');

      final task = await sut.getUploadTask(asset);
      expect(task, isNotNull);
      expect(task!.fields.containsKey('visibility'), isFalse);
    });

    test('corrects the extension when iOS returns a rendered file for a .dng asset', () async {
      final asset = LocalAssetStub.image1;
      final mockEntity = MockAssetEntity();
      final mockFile = File('/path/to/IMG_6499.jpg');

      when(() => mockEntity.isLivePhoto).thenReturn(false);
      when(() => mockStorageRepository.getAssetEntityForAsset(asset)).thenAnswer((_) async => mockEntity);
      when(() => mockStorageRepository.getFileForAsset(asset.id)).thenAnswer((_) async => mockFile);
      when(() => mockAssetMediaRepository.getOriginalFilename(asset.id)).thenAnswer((_) async => 'IMG_6499.dng');

      final task = await sut.getUploadTask(asset);
      expect(task, isNotNull);
      expect(task!.fields['filename'], equals('IMG_6499.jpg'));
    });

    test('keeps the .dng extension for a genuine RAW original', () async {
      final asset = LocalAssetStub.image1;
      final mockEntity = MockAssetEntity();
      final mockFile = File('/path/to/IMG_5210.dng');

      when(() => mockEntity.isLivePhoto).thenReturn(false);
      when(() => mockStorageRepository.getAssetEntityForAsset(asset)).thenAnswer((_) async => mockEntity);
      when(() => mockStorageRepository.getFileForAsset(asset.id)).thenAnswer((_) async => mockFile);
      when(() => mockAssetMediaRepository.getOriginalFilename(asset.id)).thenAnswer((_) async => 'IMG_5210.dng');

      final task = await sut.getUploadTask(asset);
      expect(task, isNotNull);
      expect(task!.fields['filename'], equals('IMG_5210.dng'));
    });

    test('borrows the extension from the asset name for an extensionless name (DJI/Fusion)', () async {
      final asset = LocalAssetStub.image1;
      final mockEntity = MockAssetEntity();
      final mockFile = File('/path/to/DJI_0001');

      when(() => mockEntity.isLivePhoto).thenReturn(false);
      when(() => mockStorageRepository.getAssetEntityForAsset(asset)).thenAnswer((_) async => mockEntity);
      when(() => mockStorageRepository.getFileForAsset(asset.id)).thenAnswer((_) async => mockFile);
      when(() => mockAssetMediaRepository.getOriginalFilename(asset.id)).thenAnswer((_) async => 'DJI_0001');

      final task = await sut.getUploadTask(asset);
      expect(task, isNotNull);
      expect(task!.fields['filename'], equals('DJI_0001.jpg'));
    });
  });

  group('getLivePhotoUploadTask', () {
    test('should call getOriginalFilename for live photo upload task', () async {
      final asset = LocalAssetStub.image1;
      final mockEntity = MockAssetEntity();
      final mockFile = File('/path/to/livephoto.heic');

      when(() => mockEntity.isLivePhoto).thenReturn(true);
      when(() => mockStorageRepository.getAssetEntityForAsset(asset)).thenAnswer((_) async => mockEntity);
      when(() => mockStorageRepository.getFileForAsset(asset.id)).thenAnswer((_) async => mockFile);
      when(
        () => mockAssetMediaRepository.getOriginalFilename(asset.id),
      ).thenAnswer((_) async => 'OriginalLivePhoto.HEIC');

      final task = await sut.getLivePhotoUploadTask(asset, 'video-id-123');

      expect(task, isNotNull);
      expect(task!.fields['filename'], equals('OriginalLivePhoto.HEIC'));
      expect(task.fields['livePhotoVideoId'], equals('video-id-123'));
      expect(task.fields.containsKey('visibility'), isFalse);
      verify(() => mockAssetMediaRepository.getOriginalFilename(asset.id)).called(1);
    });

    test('should call getOriginalFilename when original filename is null', () async {
      final asset = LocalAssetStub.image2;
      final mockEntity = MockAssetEntity();
      final mockFile = File('/path/to/fallback.heic');

      when(() => mockEntity.isLivePhoto).thenReturn(true);
      when(() => mockStorageRepository.getAssetEntityForAsset(asset)).thenAnswer((_) async => mockEntity);
      when(() => mockStorageRepository.getFileForAsset(asset.id)).thenAnswer((_) async => mockFile);
      when(() => mockAssetMediaRepository.getOriginalFilename(asset.id)).thenAnswer((_) async => null);

      final task = await sut.getLivePhotoUploadTask(asset, 'video-id-456');
      expect(task, isNotNull);
      // Should fall back to asset.name when original filename is null
      expect(task!.fields['filename'], equals(asset.name));
      verify(() => mockAssetMediaRepository.getOriginalFilename(asset.id)).called(1);
    });
  });

  group('Server Info - cloudId and eTag metadata', () {
    test('should include cloudId and eTag metadata on iOS when server version is 2.4+', () async {
      debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
      addTearDown(() => debugDefaultTargetPlatformOverride = null);

      final sutWithV24 = BackgroundUploadService(
        mockUploadRepository,
        mockStorageRepository,
        mockLocalAssetRepository,
        mockBackupRepository,
        mockAssetMediaRepository,
      );
      addTearDown(() => sutWithV24.dispose());

      final assetWithCloudId = LocalAsset(
        id: 'test-asset-id',
        name: 'test.jpg',
        type: AssetType.image,
        createdAt: DateTime(2025, 1, 1),
        updatedAt: DateTime(2025, 1, 2),
        cloudId: 'cloud-id-123',
        latitude: 37.7749,
        longitude: -122.4194,
        adjustmentTime: DateTime(2026, 1, 2),
        playbackStyle: AssetPlaybackStyle.image,
        isEdited: false,
      );

      final mockEntity = MockAssetEntity();
      final mockFile = File('/path/to/test.jpg');

      when(() => mockEntity.isLivePhoto).thenReturn(false);
      when(() => mockStorageRepository.getAssetEntityForAsset(assetWithCloudId)).thenAnswer((_) async => mockEntity);
      when(() => mockStorageRepository.getFileForAsset(assetWithCloudId.id)).thenAnswer((_) async => mockFile);
      when(() => mockAssetMediaRepository.getOriginalFilename(assetWithCloudId.id)).thenAnswer((_) async => 'test.jpg');

      final task = await sutWithV24.getUploadTask(assetWithCloudId);

      expect(task, isNotNull);
      expect(task!.fields.containsKey('metadata'), isTrue);

      final metadata = jsonDecode(task.fields['metadata']!) as List;
      expect(metadata, hasLength(1));
      expect(metadata[0]['key'], equals('mobile-app'));
      expect(metadata[0]['value']['iCloudId'], equals('cloud-id-123'));
      expect(metadata[0]['value']['createdAt'], isNotNull);
      expect(metadata[0]['value']['adjustmentTime'], isNotNull);
      expect(metadata[0]['value']['latitude'], isNotNull);
      expect(metadata[0]['value']['longitude'], isNotNull);
    });

    test('should NOT include metadata on Android regardless of server version', () async {
      debugDefaultTargetPlatformOverride = TargetPlatform.android;
      addTearDown(() => debugDefaultTargetPlatformOverride = null);

      final sutAndroid = BackgroundUploadService(
        mockUploadRepository,
        mockStorageRepository,
        mockLocalAssetRepository,
        mockBackupRepository,
        mockAssetMediaRepository,
      );
      addTearDown(() => sutAndroid.dispose());

      final assetWithCloudId = LocalAsset(
        id: 'test-asset-id',
        name: 'test.jpg',
        type: AssetType.image,
        createdAt: DateTime(2025, 1, 1),
        updatedAt: DateTime(2025, 1, 2),
        cloudId: 'cloud-id-123',
        latitude: 37.7749,
        longitude: -122.4194,
        playbackStyle: AssetPlaybackStyle.image,
        isEdited: false,
      );

      final mockEntity = MockAssetEntity();
      final mockFile = File('/path/to/test.jpg');

      when(() => mockEntity.isLivePhoto).thenReturn(false);
      when(() => mockStorageRepository.getAssetEntityForAsset(assetWithCloudId)).thenAnswer((_) async => mockEntity);
      when(() => mockStorageRepository.getFileForAsset(assetWithCloudId.id)).thenAnswer((_) async => mockFile);
      when(() => mockAssetMediaRepository.getOriginalFilename(assetWithCloudId.id)).thenAnswer((_) async => 'test.jpg');

      final task = await sutAndroid.getUploadTask(assetWithCloudId);

      expect(task, isNotNull);
      expect(task!.fields.containsKey('metadata'), isFalse);
    });

    test('should NOT include metadata when cloudId is null even on iOS with server 2.4+', () async {
      debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
      addTearDown(() => debugDefaultTargetPlatformOverride = null);

      final sutWithV24 = BackgroundUploadService(
        mockUploadRepository,
        mockStorageRepository,
        mockLocalAssetRepository,
        mockBackupRepository,
        mockAssetMediaRepository,
      );
      addTearDown(() => sutWithV24.dispose());

      final assetWithoutCloudId = LocalAsset(
        id: 'test-asset-id',
        name: 'test.jpg',
        type: AssetType.image,
        createdAt: DateTime(2025, 1, 1),
        updatedAt: DateTime(2025, 1, 2),
        cloudId: null, // No cloudId
        playbackStyle: AssetPlaybackStyle.image,
        isEdited: false,
      );

      final mockEntity = MockAssetEntity();
      final mockFile = File('/path/to/test.jpg');

      when(() => mockEntity.isLivePhoto).thenReturn(false);
      when(() => mockStorageRepository.getAssetEntityForAsset(assetWithoutCloudId)).thenAnswer((_) async => mockEntity);
      when(() => mockStorageRepository.getFileForAsset(assetWithoutCloudId.id)).thenAnswer((_) async => mockFile);
      when(
        () => mockAssetMediaRepository.getOriginalFilename(assetWithoutCloudId.id),
      ).thenAnswer((_) async => 'test.jpg');

      final task = await sutWithV24.getUploadTask(assetWithoutCloudId);

      expect(task, isNotNull);
      expect(task!.fields.containsKey('metadata'), isFalse);
    });

    test('should include metadata for live photos with cloudId on iOS 2.4+', () async {
      debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
      addTearDown(() => debugDefaultTargetPlatformOverride = null);

      final sutWithV24 = BackgroundUploadService(
        mockUploadRepository,
        mockStorageRepository,
        mockLocalAssetRepository,
        mockBackupRepository,
        mockAssetMediaRepository,
      );
      addTearDown(() => sutWithV24.dispose());

      final assetWithCloudId = LocalAsset(
        id: 'test-livephoto-id',
        name: 'livephoto.heic',
        type: AssetType.image,
        createdAt: DateTime(2025, 1, 1),
        updatedAt: DateTime(2025, 1, 2),
        cloudId: 'cloud-id-livephoto',
        latitude: 37.7749,
        longitude: -122.4194,
        playbackStyle: AssetPlaybackStyle.image,
        isEdited: false,
      );

      final mockEntity = MockAssetEntity();
      final mockFile = File('/path/to/livephoto.heic');

      when(() => mockEntity.isLivePhoto).thenReturn(true);
      when(() => mockStorageRepository.getAssetEntityForAsset(assetWithCloudId)).thenAnswer((_) async => mockEntity);
      when(() => mockStorageRepository.getFileForAsset(assetWithCloudId.id)).thenAnswer((_) async => mockFile);
      when(
        () => mockAssetMediaRepository.getOriginalFilename(assetWithCloudId.id),
      ).thenAnswer((_) async => 'livephoto.heic');

      final task = await sutWithV24.getLivePhotoUploadTask(assetWithCloudId, 'video-123');

      expect(task, isNotNull);
      expect(task!.fields.containsKey('metadata'), isTrue);
      expect(task.fields['livePhotoVideoId'], equals('video-123'));
      expect(task.fields.containsKey('visibility'), isFalse);

      final metadata = jsonDecode(task.fields['metadata']!) as List;
      expect(metadata, hasLength(1));
      expect(metadata[0]['key'], equals('mobile-app'));
      expect(metadata[0]['value']['iCloudId'], equals('cloud-id-livephoto'));
    });
  });

  group('chunked background uploads', () {
    late Directory tempDir;

    setUp(() async {
      tempDir = await Directory.systemTemp.createTemp('background_chunked_upload_test');
      when(() => mockStorageRepository.clearCache()).thenAnswer((_) async {});
    });

    tearDown(() async {
      await tempDir.delete(recursive: true);
    });

    Future<File> writeFile(String name, int size) async {
      final file = File('${tempDir.path}/$name');
      await file.writeAsBytes(List<int>.filled(size, 3));
      return file;
    }

    LocalAsset assetFor(File file) => LocalAsset(
      id: 'chunked-asset-id',
      name: 'chunked.mov',
      type: AssetType.video,
      createdAt: DateTime(2026, 1, 1),
      updatedAt: DateTime(2026, 1, 2),
      playbackStyle: AssetPlaybackStyle.video,
      isEdited: false,
    );

    void stubEntity({required bool isLivePhoto}) {
      final mockEntity = MockAssetEntity();
      when(() => mockEntity.isLivePhoto).thenReturn(isLivePhoto);
      when(() => mockStorageRepository.getAssetEntityForAsset(any())).thenAnswer((_) async => mockEntity);
    }

    group('getUploadTask - chunk task shape', () {
      test('builds a PATCH/binary task with empty fields and correct Range/Upload-Offset for a file above the threshold', () async {
        final file = await writeFile('video.mov', 25);
        final asset = assetFor(file);
        stubEntity(isLivePhoto: false);
        when(() => mockStorageRepository.getFileForAsset(asset.id)).thenAnswer((_) async => file);
        when(() => mockAssetMediaRepository.getOriginalFilename(asset.id)).thenAnswer((_) async => 'video.mov');
        when(() => mockUploadRepository.uploadChunkSize).thenReturn(10);
        when(
          () => mockUploadRepository.createUploadSession(
            filename: any(named: 'filename'),
            size: any(named: 'size'),
            fields: any(named: 'fields'),
          ),
        ).thenAnswer((_) async => const UploadSessionResult(sessionId: 'session-1', offset: 0));

        final task = await sut.getUploadTask(asset);

        expect(task, isNotNull);
        expect(task!.httpRequestMethod, equals('PATCH'));
        expect(task.post, equals('binary'));
        expect(task.fields, isEmpty);
        expect(task.headers['Upload-Offset'], equals('0'));
        expect(task.headers['Range'], equals('bytes=0-9'));
        expect(task.headers['Content-Type'], equals('application/offset+octet-stream'));
      });

      test('taskId is "<deviceAssetId>#<chunkIndex>" for a chunked task', () async {
        final file = await writeFile('video.mov', 25);
        final asset = assetFor(file);
        stubEntity(isLivePhoto: false);
        when(() => mockStorageRepository.getFileForAsset(asset.id)).thenAnswer((_) async => file);
        when(() => mockAssetMediaRepository.getOriginalFilename(asset.id)).thenAnswer((_) async => 'video.mov');
        when(() => mockUploadRepository.uploadChunkSize).thenReturn(10);
        when(
          () => mockUploadRepository.createUploadSession(
            filename: any(named: 'filename'),
            size: any(named: 'size'),
            fields: any(named: 'fields'),
          ),
        ).thenAnswer((_) async => const UploadSessionResult(sessionId: 'session-1', offset: 0));

        final task = await sut.getUploadTask(asset);

        expect(task!.taskId, equals('${asset.id}#0'));
      });

      test('taskId stays bare (no chunk suffix) when the server advertises 0 (case 32)', () async {
        final file = await writeFile('video.mov', 25);
        final asset = assetFor(file);
        stubEntity(isLivePhoto: false);
        when(() => mockStorageRepository.getFileForAsset(asset.id)).thenAnswer((_) async => file);
        when(() => mockAssetMediaRepository.getOriginalFilename(asset.id)).thenAnswer((_) async => 'video.mov');
        when(() => mockUploadRepository.uploadChunkSize).thenReturn(0);

        final task = await sut.getUploadTask(asset);

        expect(task, isNotNull);
        expect(task!.taskId, equals(asset.id));
        expect(task.httpRequestMethod, equals('POST'));
        verifyNever(
          () => mockUploadRepository.createUploadSession(
            filename: any(named: 'filename'),
            size: any(named: 'size'),
            fields: any(named: 'fields'),
          ),
        );
      });

      test('metaData carries the chain state', () async {
        final file = await writeFile('video.mov', 25);
        final asset = assetFor(file);
        stubEntity(isLivePhoto: false);
        when(() => mockStorageRepository.getFileForAsset(asset.id)).thenAnswer((_) async => file);
        when(() => mockAssetMediaRepository.getOriginalFilename(asset.id)).thenAnswer((_) async => 'video.mov');
        when(() => mockUploadRepository.uploadChunkSize).thenReturn(10);
        when(
          () => mockUploadRepository.createUploadSession(
            filename: any(named: 'filename'),
            size: any(named: 'size'),
            fields: any(named: 'fields'),
          ),
        ).thenAnswer((_) async => const UploadSessionResult(sessionId: 'session-1', offset: 0));

        final task = await sut.getUploadTask(asset);
        final metadata = UploadTaskMetadata.fromJson(task!.metaData);

        expect(metadata.sessionId, equals('session-1'));
        expect(metadata.chunkIndex, equals(0));
        expect(metadata.chunkCount, equals(3)); // ceil(25/10)
        expect(metadata.chunkSize, equals(10));
        expect(metadata.totalSize, equals(25));
        expect(metadata.localAssetId, equals(asset.id));
        expect(metadata.isChunked, isTrue);
      });

      test('falls back to single-shot when session creation fails', () async {
        final file = await writeFile('video.mov', 25);
        final asset = assetFor(file);
        stubEntity(isLivePhoto: false);
        when(() => mockStorageRepository.getFileForAsset(asset.id)).thenAnswer((_) async => file);
        when(() => mockAssetMediaRepository.getOriginalFilename(asset.id)).thenAnswer((_) async => 'video.mov');
        when(() => mockUploadRepository.uploadChunkSize).thenReturn(10);
        when(
          () => mockUploadRepository.createUploadSession(
            filename: any(named: 'filename'),
            size: any(named: 'size'),
            fields: any(named: 'fields'),
          ),
        ).thenAnswer((_) async => const UploadSessionResult(errorMessage: 'network error'));

        final task = await sut.getUploadTask(asset);

        expect(task, isNotNull);
        expect(task!.taskId, equals(asset.id));
        expect(task.httpRequestMethod, equals('POST'));
      });
    });

    group('status callback chunk chaining', () {
      test('enqueues chunk k+1 when chunk k completes (mid-chain)', () async {
        final metadata = const UploadTaskMetadata(
          localAssetId: 'chain-asset',
          isLivePhotos: false,
          livePhotoVideoId: '',
          sessionId: 'session-1',
          chunkIndex: 0,
          chunkCount: 3,
          chunkSize: 10,
          totalSize: 25,
        );
        final chunkTask = UploadTask(
          taskId: 'chain-asset#0',
          url: 'http://test-server.com/assets/upload-session/session-1',
          filename: 'video.mov',
          post: 'binary',
          httpRequestMethod: 'PATCH',
          headers: const {'Upload-Offset': '0', 'Range': 'bytes=0-9', 'Content-Type': 'application/offset+octet-stream'},
          metaData: metadata.toJson(),
          group: kBackupGroup,
        );

        UploadTask? captured;
        when(() => mockUploadRepository.enqueueBackground(any())).thenAnswer((invocation) async {
          captured = invocation.positionalArguments[0] as UploadTask;
        });

        sut.handleTaskStatusUpdate(TaskStatusUpdate(chunkTask, TaskStatus.complete));
        await pumpEventQueue();

        expect(captured, isNotNull);
        expect(captured!.taskId, equals('chain-asset#1'));
        expect(captured!.headers['Upload-Offset'], equals('10'));
        expect(captured!.headers['Range'], equals('bytes=10-19'));
        final nextMetadata = UploadTaskMetadata.fromJson(captured!.metaData);
        expect(nextMetadata.chunkIndex, equals(1));
        expect(nextMetadata.sessionId, equals('session-1'));
      });

      test('the final chunk response parses into a remoteAssetId and continues the live-photo chain', () async {
        final localAsset = LocalAsset(
          id: 'live-asset',
          name: 'still.heic',
          type: AssetType.image,
          createdAt: DateTime(2026, 1, 1),
          updatedAt: DateTime(2026, 1, 2),
          playbackStyle: AssetPlaybackStyle.image,
          isEdited: false,
        );
        final stillFile = await writeFile('still.heic', 5);

        final metadata = const UploadTaskMetadata(
          localAssetId: 'live-asset',
          isLivePhotos: true,
          livePhotoVideoId: '',
          sessionId: 'session-1',
          chunkIndex: 2,
          chunkCount: 3,
          chunkSize: 10,
          totalSize: 25,
        );
        final finalChunkTask = UploadTask(
          taskId: 'live-asset#2',
          url: 'http://test-server.com/assets/upload-session/session-1',
          filename: 'video.mov',
          post: 'binary',
          httpRequestMethod: 'PATCH',
          headers: const {'Upload-Offset': '20', 'Content-Type': 'application/offset+octet-stream'},
          metaData: metadata.toJson(),
          group: kBackupGroup,
        );

        when(() => mockLocalAssetRepository.getById('live-asset')).thenAnswer((_) async => localAsset);
        final stillEntity = MockAssetEntity();
        when(() => stillEntity.isLivePhoto).thenReturn(false);
        when(() => mockStorageRepository.getAssetEntityForAsset(localAsset)).thenAnswer((_) async => stillEntity);
        when(() => mockStorageRepository.getFileForAsset(localAsset.id)).thenAnswer((_) async => stillFile);
        when(() => mockAssetMediaRepository.getOriginalFilename(localAsset.id)).thenAnswer((_) async => 'still.heic');
        when(() => mockUploadRepository.uploadChunkSize).thenReturn(10); // still is only 5 bytes: single-shot

        List<UploadTask>? enqueued;
        when(() => mockUploadRepository.enqueueBackgroundAll(any())).thenAnswer((invocation) async {
          enqueued = invocation.positionalArguments[0] as List<UploadTask>;
          return [true];
        });

        sut.handleTaskStatusUpdate(
          TaskStatusUpdate(finalChunkTask, TaskStatus.complete, null, '{"id":"video-remote-id"}'),
        );
        await pumpEventQueue();

        expect(enqueued, isNotNull);
        expect(enqueued, hasLength(1));
        expect(enqueued!.single.fields['livePhotoVideoId'], equals('video-remote-id'));
      });
    });

    group('chunk failure handling', () {
      Future<void> expectDeletesSessionOn(TaskStatus status) async {
        final metadata = const UploadTaskMetadata(
          localAssetId: 'failed-asset',
          isLivePhotos: false,
          livePhotoVideoId: '',
          sessionId: 'session-failed',
          chunkIndex: 1,
          chunkCount: 3,
          chunkSize: 10,
          totalSize: 25,
        );
        final failedTask = UploadTask(
          taskId: 'failed-asset#1',
          url: 'http://test-server.com/assets/upload-session/session-failed',
          filename: 'video.mov',
          post: 'binary',
          httpRequestMethod: 'PATCH',
          headers: const {'Upload-Offset': '10'},
          metaData: metadata.toJson(),
          group: kBackupGroup,
        );

        when(() => mockUploadRepository.deleteUploadSession(any())).thenAnswer((_) async {});

        sut.handleTaskStatusUpdate(TaskStatusUpdate(failedTask, status));
        await pumpEventQueue();

        verify(() => mockUploadRepository.deleteUploadSession('session-failed')).called(1);
      }

      test('a chunk exhausting its retries DELETEs the session (case 41)', () async {
        await expectDeletesSessionOn(TaskStatus.failed);
      });

      test('the source file disappearing mid-chain DELETEs the session, not a half-created asset (case 39)', () async {
        await expectDeletesSessionOn(TaskStatus.notFound);
      });
    });

    group('restart reconciliation (case 40)', () {
      test('re-enqueues the correct next chunk for a chain with no successor', () async {
        final metadata = const UploadTaskMetadata(
          localAssetId: 'restart-asset',
          isLivePhotos: false,
          livePhotoVideoId: '',
          sessionId: 'session-restart',
          chunkIndex: 0,
          chunkCount: 3,
          chunkSize: 10,
          totalSize: 25,
        );
        final completedTask = UploadTask(
          taskId: 'restart-asset#0',
          url: 'http://test-server.com/assets/upload-session/session-restart',
          filename: 'video.mov',
          post: 'binary',
          httpRequestMethod: 'PATCH',
          headers: const {'Upload-Offset': '0'},
          metaData: metadata.toJson(),
          group: kBackupGroup,
        );
        final record = TaskRecord(completedTask, TaskStatus.complete, 1.0, 25);

        when(() => mockUploadRepository.getRecords(kBackupGroup)).thenAnswer((_) async => [record]);
        UploadTask? captured;
        when(() => mockUploadRepository.enqueueBackground(any())).thenAnswer((invocation) async {
          captured = invocation.positionalArguments[0] as UploadTask;
        });

        await sut.reconcileChunkChains();

        expect(captured, isNotNull);
        expect(captured!.taskId, equals('restart-asset#1'));
      });

      test('does nothing when the next chunk already exists (steady state)', () async {
        final metadata = const UploadTaskMetadata(
          localAssetId: 'steady-asset',
          isLivePhotos: false,
          livePhotoVideoId: '',
          sessionId: 'session-steady',
          chunkIndex: 0,
          chunkCount: 2,
          chunkSize: 10,
          totalSize: 20,
        );
        final completedChunk0 = UploadTask(
          taskId: 'steady-asset#0',
          url: 'http://test-server.com/assets/upload-session/session-steady',
          filename: 'video.mov',
          post: 'binary',
          httpRequestMethod: 'PATCH',
          metaData: metadata.toJson(),
          group: kBackupGroup,
        );
        final enqueuedChunk1 = UploadTask(
          taskId: 'steady-asset#1',
          url: 'http://test-server.com/assets/upload-session/session-steady',
          filename: 'video.mov',
          post: 'binary',
          httpRequestMethod: 'PATCH',
          metaData: metadata.copyWith(chunkIndex: 1).toJson(),
          group: kBackupGroup,
        );

        when(() => mockUploadRepository.getRecords(kBackupGroup)).thenAnswer(
          (_) async => [
            TaskRecord(completedChunk0, TaskStatus.complete, 1.0, 20),
            TaskRecord(enqueuedChunk1, TaskStatus.enqueued, 0.0, 20),
          ],
        );

        await sut.reconcileChunkChains();

        verifyNever(() => mockUploadRepository.enqueueBackground(any()));
      });

      test('resume() runs reconciliation after starting the downloader', () async {
        when(() => mockUploadRepository.start()).thenAnswer((_) async {});

        final metadata = const UploadTaskMetadata(
          localAssetId: 'resume-asset',
          isLivePhotos: false,
          livePhotoVideoId: '',
          sessionId: 'session-resume',
          chunkIndex: 0,
          chunkCount: 2,
          chunkSize: 10,
          totalSize: 20,
        );
        final completedTask = UploadTask(
          taskId: 'resume-asset#0',
          url: 'http://test-server.com/assets/upload-session/session-resume',
          filename: 'video.mov',
          post: 'binary',
          httpRequestMethod: 'PATCH',
          metaData: metadata.toJson(),
          group: kBackupGroup,
        );
        when(
          () => mockUploadRepository.getRecords(kBackupGroup),
        ).thenAnswer((_) async => [TaskRecord(completedTask, TaskStatus.complete, 1.0, 20)]);

        UploadTask? captured;
        when(() => mockUploadRepository.enqueueBackground(any())).thenAnswer((invocation) async {
          captured = invocation.positionalArguments[0] as UploadTask;
        });

        await sut.resume();

        verify(() => mockUploadRepository.start()).called(1);
        expect(captured?.taskId, equals('resume-asset#1'));
      });
    });

    group('enqueue-time fallback (case 38)', () {
      test('falls back to a single-shot task when a chunked task fails to enqueue', () async {
        final file = await writeFile('video.mov', 25);
        final asset = assetFor(file);
        stubEntity(isLivePhoto: false);
        when(() => mockStorageRepository.getFileForAsset(asset.id)).thenAnswer((_) async => file);
        when(() => mockAssetMediaRepository.getOriginalFilename(asset.id)).thenAnswer((_) async => 'video.mov');
        when(() => mockUploadRepository.uploadChunkSize).thenReturn(10);
        when(
          () => mockUploadRepository.createUploadSession(
            filename: any(named: 'filename'),
            size: any(named: 'size'),
            fields: any(named: 'fields'),
          ),
        ).thenAnswer((_) async => const UploadSessionResult(sessionId: 'session-1', offset: 0));
        when(() => mockBackupRepository.getCandidates('user-1')).thenAnswer((_) async => [asset]);
        when(() => mockUploadRepository.enqueueBackgroundAll(any())).thenAnswer((_) async => [false]);

        UploadTask? fallbackTask;
        when(() => mockUploadRepository.enqueueBackground(any())).thenAnswer((invocation) async {
          fallbackTask = invocation.positionalArguments[0] as UploadTask;
        });

        await sut.uploadBackupCandidates('user-1');

        expect(fallbackTask, isNotNull);
        expect(fallbackTask!.taskId, equals(asset.id)); // bare id: single-shot, not a chunk task
        expect(fallbackTask!.httpRequestMethod, equals('POST'));
      });
    });

    group('live photo pairing - one leg chunked, the other not (case 49)', () {
      // An implementation that only ever chunks the larger of the pair would pass one of these
      // and fail the other - both directions must hold independently, since getUploadTask
      // (the video leg) and getLivePhotoUploadTask (the still leg) make the decision separately.
      test('the video is chunked, the still image is not', () async {
        final videoFile = await writeFile('video.mov', 25); // above the 10-byte threshold
        final stillFile = await writeFile('still.heic', 5); // below it
        final asset = assetFor(videoFile);
        stubEntity(isLivePhoto: true);
        when(() => mockStorageRepository.getMotionFileForAsset(asset)).thenAnswer((_) async => videoFile);
        when(() => mockStorageRepository.getFileForAsset(asset.id)).thenAnswer((_) async => stillFile);
        when(() => mockAssetMediaRepository.getOriginalFilename(asset.id)).thenAnswer((_) async => 'live.heic');
        when(() => mockUploadRepository.uploadChunkSize).thenReturn(10);
        when(
          () => mockUploadRepository.createUploadSession(
            filename: any(named: 'filename'),
            size: any(named: 'size'),
            fields: any(named: 'fields'),
          ),
        ).thenAnswer((_) async => const UploadSessionResult(sessionId: 'video-session', offset: 0));

        final videoTask = await sut.getUploadTask(asset);
        final stillTask = await sut.getLivePhotoUploadTask(asset, 'video-remote-id');

        expect(videoTask!.taskId, equals('${asset.id}#0'));
        expect(videoTask.httpRequestMethod, equals('PATCH'));
        expect(videoTask.post, equals('binary'));

        expect(stillTask!.taskId, equals(asset.id)); // bare: below threshold, single-shot
        expect(stillTask.httpRequestMethod, equals('POST'));
        expect(stillTask.fields['livePhotoVideoId'], equals('video-remote-id'));
      });

      test('the still image is chunked, the video is not', () async {
        final videoFile = await writeFile('video.mov', 5); // below the 10-byte threshold
        final stillFile = await writeFile('still.heic', 25); // above it
        final asset = assetFor(videoFile);
        stubEntity(isLivePhoto: true);
        when(() => mockStorageRepository.getMotionFileForAsset(asset)).thenAnswer((_) async => videoFile);
        when(() => mockStorageRepository.getFileForAsset(asset.id)).thenAnswer((_) async => stillFile);
        when(() => mockAssetMediaRepository.getOriginalFilename(asset.id)).thenAnswer((_) async => 'live.heic');
        when(() => mockUploadRepository.uploadChunkSize).thenReturn(10);
        when(
          () => mockUploadRepository.createUploadSession(
            filename: any(named: 'filename'),
            size: any(named: 'size'),
            fields: any(named: 'fields'),
          ),
        ).thenAnswer((_) async => const UploadSessionResult(sessionId: 'still-session', offset: 0));

        final videoTask = await sut.getUploadTask(asset);
        final stillTask = await sut.getLivePhotoUploadTask(asset, 'video-remote-id');

        expect(videoTask!.taskId, equals(asset.id)); // bare: below threshold, single-shot
        expect(videoTask.httpRequestMethod, equals('POST'));

        expect(stillTask!.taskId, equals('${asset.id}#0'));
        expect(stillTask.httpRequestMethod, equals('PATCH'));
        expect(stillTask.post, equals('binary'));
        final stillMetadata = UploadTaskMetadata.fromJson(stillTask.metaData);
        expect(stillMetadata.sessionId, equals('still-session'));
        // The still leg must not re-trigger the live-photo chain when its own chunks complete.
        expect(stillMetadata.isLivePhotos, isFalse);
      });
    });

    group('progress aggregation (§7.5)', () {
      test('aggregates a mid-chain chunk`s progress against the whole file', () {
        const metadata = UploadTaskMetadata(
          localAssetId: 'a',
          isLivePhotos: false,
          livePhotoVideoId: '',
          sessionId: 's',
          chunkIndex: 1,
          chunkCount: 3,
          chunkSize: 10,
          totalSize: 25,
        );

        expect(aggregateChunkUploadProgress(metadata, 0.0), closeTo(10 / 25, 0.0001));
        expect(aggregateChunkUploadProgress(metadata, 0.5), closeTo(15 / 25, 0.0001));
        expect(aggregateChunkUploadProgress(metadata, 1.0), closeTo(20 / 25, 0.0001));
      });

      test('the last (smaller) chunk reaching 1.0 aggregates to exactly 1.0', () {
        const metadata = UploadTaskMetadata(
          localAssetId: 'a',
          isLivePhotos: false,
          livePhotoVideoId: '',
          sessionId: 's',
          chunkIndex: 2,
          chunkCount: 3,
          chunkSize: 10,
          totalSize: 25,
        );

        expect(aggregateChunkUploadProgress(metadata, 1.0), equals(1.0));
      });

      test('a non-chunked update is passed through unchanged', () {
        const metadata = UploadTaskMetadata(localAssetId: 'a', isLivePhotos: false, livePhotoVideoId: '');
        expect(aggregateChunkUploadProgress(metadata, 0.42), equals(0.42));
      });
    });
  });
}
