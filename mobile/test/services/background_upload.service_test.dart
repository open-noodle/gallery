import 'dart:async';
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
import 'package:immich_mobile/domain/models/background_backup_status.model.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/settings.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/services/background_upload.service.dart';
import 'package:mocktail/mocktail.dart';

import '../fixtures/asset.stub.dart';
import '../infrastructure/repository.mock.dart';
import '../mocks/asset_entity.mock.dart';
import '../repository.mocks.dart';
import '../service.mocks.dart';

void main() {
  late BackgroundUploadService sut;
  late MockUploadRepository mockUploadRepository;
  late MockStorageRepository mockStorageRepository;
  late MockLocalAssetRepository mockLocalAssetRepository;
  late MockBackupRepository mockBackupRepository;
  late MockAssetMediaRepository mockAssetMediaRepository;
  late MockBackgroundBackupStatusService mockBackgroundBackupStatusService;
  late Drift db;

  setUpAll(() async {
    registerFallbackValue(BackgroundBackupFailureReason.none);

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
  });

  setUp(() {
    mockUploadRepository = MockUploadRepository();
    mockStorageRepository = MockStorageRepository();
    mockLocalAssetRepository = MockLocalAssetRepository();
    mockBackupRepository = MockBackupRepository();
    mockAssetMediaRepository = MockAssetMediaRepository();
    mockBackgroundBackupStatusService = MockBackgroundBackupStatusService();

    when(() => mockBackgroundBackupStatusService.recordCandidateCount(any())).thenAnswer((_) async {});
    when(
      () => mockBackgroundBackupStatusService.recordUploadEnqueue(candidateCount: any(named: 'candidateCount')),
    ).thenAnswer((_) async {});
    when(() => mockBackgroundBackupStatusService.recordUploadSuccess()).thenAnswer((_) async {});
    when(() => mockBackgroundBackupStatusService.recordFailure(any())).thenAnswer((_) async {});

    sut = BackgroundUploadService(
      mockUploadRepository,
      mockStorageRepository,
      mockLocalAssetRepository,
      mockBackupRepository,
      mockAssetMediaRepository,
      mockBackgroundBackupStatusService,
    );

    mockUploadRepository.onUploadStatus = (_) {};
    mockUploadRepository.onTaskProgress = (_) {};
  });

  tearDown(() {
    sut.dispose();
  });

  // Returns the status callback the service registered during construction.
  void Function(TaskStatusUpdate) capturedStatusCallback() {
    return verify(() => mockUploadRepository.onUploadStatus = captureAny()).captured.first
        as void Function(TaskStatusUpdate);
  }

  group('background backup status recording', () {
    test('records candidate count and enqueue count when candidates are queued', () async {
      final asset = LocalAssetStub.image1;
      final mockEntity = MockAssetEntity();
      final mockFile = File('/path/to/file.jpg');

      when(() => mockBackupRepository.getCandidates('user-1')).thenAnswer((_) async => [asset]);
      when(() => mockStorageRepository.clearCache()).thenAnswer((_) async {});
      when(() => mockEntity.isLivePhoto).thenReturn(false);
      when(() => mockStorageRepository.getAssetEntityForAsset(asset)).thenAnswer((_) async => mockEntity);
      when(() => mockStorageRepository.getFileForAsset(asset.id)).thenAnswer((_) async => mockFile);
      when(() => mockAssetMediaRepository.getOriginalFilename(asset.id)).thenAnswer((_) async => 'asset.jpg');
      when(() => mockUploadRepository.enqueueBackgroundAll(any())).thenAnswer((_) async => [true]);

      await sut.uploadBackupCandidates('user-1');

      verify(() => mockBackgroundBackupStatusService.recordCandidateCount(1)).called(1);
      verify(() => mockBackgroundBackupStatusService.recordUploadEnqueue(candidateCount: 1)).called(1);
    });

    test('records zero candidate count when no candidates exist', () async {
      when(() => mockStorageRepository.clearCache()).thenAnswer((_) async {});
      when(() => mockBackupRepository.getCandidates('user-1')).thenAnswer((_) async => []);

      await sut.uploadBackupCandidates('user-1');

      verify(() => mockBackgroundBackupStatusService.recordCandidateCount(0)).called(1);
      verifyNever(
        () => mockBackgroundBackupStatusService.recordUploadEnqueue(candidateCount: any(named: 'candidateCount')),
      );
    });

    test('records upload success and failure from background downloader callbacks', () async {
      final successTask = UploadTask(
        taskId: 'asset-1',
        url: 'http://test-server.com/assets',
        filename: 'asset.jpg',
        baseDirectory: BaseDirectory.temporary,
        group: kBackupGroup,
      );
      final failureTask = UploadTask(
        taskId: 'asset-2',
        url: 'http://test-server.com/assets',
        filename: 'asset-2.jpg',
        baseDirectory: BaseDirectory.temporary,
        group: kBackupGroup,
      );

      final onStatus = capturedStatusCallback();
      onStatus(TaskStatusUpdate(successTask, TaskStatus.complete));
      onStatus(TaskStatusUpdate(failureTask, TaskStatus.failed));
      await pumpEventQueue();

      verify(() => mockBackgroundBackupStatusService.recordUploadSuccess()).called(1);
      verify(
        () => mockBackgroundBackupStatusService.recordFailure(BackgroundBackupFailureReason.uploadFailed),
      ).called(1);
    });

    test('does not record logical upload success for Live Photo motion completion', () async {
      final motionTask = UploadTask(
        taskId: 'asset-live',
        url: 'http://test-server.com/assets',
        filename: 'asset.mov',
        baseDirectory: BaseDirectory.temporary,
        group: kBackupGroup,
        metaData: const UploadTaskMetadata(
          localAssetId: 'asset-live',
          isLivePhotos: true,
          livePhotoVideoId: '',
        ).toJson(),
      );

      capturedStatusCallback()(TaskStatusUpdate(motionTask, TaskStatus.complete));
      await pumpEventQueue();

      verifyNever(() => mockBackgroundBackupStatusService.recordUploadSuccess());
    });
  });

  group('enqueueTasks', () {
    test('posts the configured running notification on iOS after successful enqueue', () async {
      debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
      addTearDown(() => debugDefaultTargetPlatformOverride = null);

      final task = UploadTask(
        taskId: 'asset-1',
        url: 'http://test-server.com/assets',
        filename: 'asset.jpg',
        baseDirectory: BaseDirectory.temporary,
        group: kBackupGroup,
      );
      final tasks = [task];

      when(() => mockUploadRepository.disableHoldingQueue()).thenAnswer((_) async {});
      when(() => mockUploadRepository.enqueueBackgroundAll(tasks)).thenAnswer((_) async => [true]);
      when(() => mockUploadRepository.restoreDefaultHoldingQueue()).thenAnswer((_) async {});
      when(() => mockUploadRepository.updateNotification(task, TaskStatus.enqueued)).thenAnswer((_) async {});

      final result = await sut.enqueueTasks(tasks);

      expect(result, [true]);
      verifyInOrder([
        () => mockUploadRepository.disableHoldingQueue(),
        () => mockUploadRepository.enqueueBackgroundAll(tasks),
        () => mockUploadRepository.restoreDefaultHoldingQueue(),
        () => mockUploadRepository.updateNotification(task, TaskStatus.enqueued),
      ]);
    });

    test('restores the default holding queue when iOS enqueue throws', () async {
      debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
      addTearDown(() => debugDefaultTargetPlatformOverride = null);

      final task = UploadTask(
        taskId: 'asset-1',
        url: 'http://test-server.com/assets',
        filename: 'asset.jpg',
        baseDirectory: BaseDirectory.temporary,
        group: kBackupGroup,
      );
      final tasks = [task];

      when(() => mockUploadRepository.disableHoldingQueue()).thenAnswer((_) async {});
      when(() => mockUploadRepository.enqueueBackgroundAll(tasks)).thenThrow(Exception('enqueue failed'));
      when(() => mockUploadRepository.restoreDefaultHoldingQueue()).thenAnswer((_) async {});

      await expectLater(sut.enqueueTasks(tasks), throwsA(isA<Exception>()));

      verifyInOrder([
        () => mockUploadRepository.disableHoldingQueue(),
        () => mockUploadRepository.enqueueBackgroundAll(tasks),
        () => mockUploadRepository.restoreDefaultHoldingQueue(),
      ]);
      verifyNever(() => mockUploadRepository.updateNotification(task, any()));
    });

    test('uses the existing holding queue configuration on Android', () async {
      debugDefaultTargetPlatformOverride = TargetPlatform.android;
      addTearDown(() => debugDefaultTargetPlatformOverride = null);

      final task = UploadTask(
        taskId: 'asset-1',
        url: 'http://test-server.com/assets',
        filename: 'asset.jpg',
        baseDirectory: BaseDirectory.temporary,
        group: kBackupGroup,
      );
      final tasks = [task];

      when(() => mockUploadRepository.enqueueBackgroundAll(tasks)).thenAnswer((_) async => [true]);

      final result = await sut.enqueueTasks(tasks);

      expect(result, [true]);
      verifyNever(() => mockUploadRepository.disableHoldingQueue());
      verifyNever(() => mockUploadRepository.restoreDefaultHoldingQueue());
      verifyNever(() => mockUploadRepository.updateNotification(task, TaskStatus.enqueued));
    });

    test('posts notifications only for successful iOS enqueue results in a batch', () async {
      debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
      addTearDown(() => debugDefaultTargetPlatformOverride = null);

      final task1 = UploadTask(
        taskId: 'asset-1',
        url: 'http://test-server.com/assets',
        filename: 'asset-1.jpg',
        baseDirectory: BaseDirectory.temporary,
        group: kBackupGroup,
      );
      final task2 = UploadTask(
        taskId: 'asset-2',
        url: 'http://test-server.com/assets',
        filename: 'asset-2.jpg',
        baseDirectory: BaseDirectory.temporary,
        group: kBackupGroup,
      );
      final task3 = UploadTask(
        taskId: 'asset-3',
        url: 'http://test-server.com/assets',
        filename: 'asset-3.jpg',
        baseDirectory: BaseDirectory.temporary,
        group: kBackupGroup,
      );
      final tasks = [task1, task2, task3];

      when(() => mockUploadRepository.disableHoldingQueue()).thenAnswer((_) async {});
      when(() => mockUploadRepository.enqueueBackgroundAll(tasks)).thenAnswer((_) async => [true, false, true]);
      when(() => mockUploadRepository.restoreDefaultHoldingQueue()).thenAnswer((_) async {});
      when(() => mockUploadRepository.updateNotification(task1, TaskStatus.enqueued)).thenAnswer((_) async {});
      when(() => mockUploadRepository.updateNotification(task3, TaskStatus.enqueued)).thenAnswer((_) async {});

      final result = await sut.enqueueTasks(tasks);

      expect(result, [true, false, true]);
      verify(() => mockUploadRepository.updateNotification(task1, TaskStatus.enqueued)).called(1);
      verifyNever(() => mockUploadRepository.updateNotification(task2, TaskStatus.enqueued));
      verify(() => mockUploadRepository.updateNotification(task3, TaskStatus.enqueued)).called(1);
    });

    test('does not post a notification for failed iOS enqueue', () async {
      debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
      addTearDown(() => debugDefaultTargetPlatformOverride = null);

      final task = UploadTask(
        taskId: 'asset-1',
        url: 'http://test-server.com/assets',
        filename: 'asset.jpg',
        baseDirectory: BaseDirectory.temporary,
        group: kBackupGroup,
      );
      final tasks = [task];

      when(() => mockUploadRepository.disableHoldingQueue()).thenAnswer((_) async {});
      when(() => mockUploadRepository.enqueueBackgroundAll(tasks)).thenAnswer((_) async => [false]);
      when(() => mockUploadRepository.restoreDefaultHoldingQueue()).thenAnswer((_) async {});

      final result = await sut.enqueueTasks(tasks);

      expect(result, [false]);
      verifyNever(() => mockUploadRepository.updateNotification(task, TaskStatus.enqueued));
    });

    test('does not post early enqueue notifications on Android', () async {
      debugDefaultTargetPlatformOverride = TargetPlatform.android;
      addTearDown(() => debugDefaultTargetPlatformOverride = null);

      final task = UploadTask(
        taskId: 'asset-1',
        url: 'http://test-server.com/assets',
        filename: 'asset.jpg',
        baseDirectory: BaseDirectory.temporary,
        group: kBackupGroup,
      );
      final tasks = [task];

      when(() => mockUploadRepository.enqueueBackgroundAll(tasks)).thenAnswer((_) async => [true]);

      final result = await sut.enqueueTasks(tasks);

      expect(result, [true]);
      verifyNever(() => mockUploadRepository.updateNotification(task, TaskStatus.enqueued));
    });
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
        mockBackgroundBackupStatusService,
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
        mockBackgroundBackupStatusService,
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
        mockBackgroundBackupStatusService,
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
        mockBackgroundBackupStatusService,
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

  group('cellular upload restrictions', () {
    Future<UploadTask> buildTaskFor(LocalAsset asset) async {
      final mockEntity = MockAssetEntity();
      final mockFile = File('/path/to/${asset.name}');

      when(() => mockEntity.isLivePhoto).thenReturn(false);
      when(() => mockStorageRepository.getAssetEntityForAsset(asset)).thenAnswer((_) async => mockEntity);
      when(() => mockStorageRepository.getFileForAsset(asset.id)).thenAnswer((_) async => mockFile);
      when(() => mockAssetMediaRepository.getOriginalFilename(asset.id)).thenAnswer((_) async => asset.name);

      final task = await sut.getUploadTask(asset);
      expect(task, isNotNull);
      return task!;
    }

    test('sets requiresWiFi true for photos when cellular photo upload is disabled', () async {
      await SettingsRepository.instance.write(SettingsKey.backupUseCellularForPhotos, false);

      final task = await buildTaskFor(LocalAssetStub.image1);

      expect(task.requiresWiFi, isTrue);
    });

    test('sets requiresWiFi false for photos when cellular photo upload is enabled', () async {
      await SettingsRepository.instance.write(SettingsKey.backupUseCellularForPhotos, true);

      final task = await buildTaskFor(LocalAssetStub.image1);

      expect(task.requiresWiFi, isFalse);
    });

    test('sets requiresWiFi true for videos when cellular video upload is disabled', () async {
      final video = LocalAssetStub.image1.copyWith(
        id: 'video-1',
        name: 'video.mov',
        type: AssetType.video,
        playbackStyle: AssetPlaybackStyle.video,
      );
      await SettingsRepository.instance.write(SettingsKey.backupUseCellularForVideos, false);

      final task = await buildTaskFor(video);

      expect(task.requiresWiFi, isTrue);
    });

    test('sets requiresWiFi false for videos when cellular video upload is enabled', () async {
      final video = LocalAssetStub.image1.copyWith(
        id: 'video-1',
        name: 'video.mov',
        type: AssetType.video,
        playbackStyle: AssetPlaybackStyle.video,
      );
      await SettingsRepository.instance.write(SettingsKey.backupUseCellularForVideos, true);

      final task = await buildTaskFor(video);

      expect(task.requiresWiFi, isFalse);
    });
  });

  group('backup batch continuation', () {
    void stubUploadPath(LocalAsset asset) {
      final entity = MockAssetEntity();
      when(() => entity.isLivePhoto).thenReturn(false);
      when(() => mockStorageRepository.getAssetEntityForAsset(asset)).thenAnswer((_) async => entity);
      when(() => mockStorageRepository.getFileForAsset(asset.id)).thenAnswer((_) async => File('/tmp/${asset.id}.jpg'));
      when(() => mockAssetMediaRepository.getOriginalFilename(asset.id)).thenAnswer((_) async => asset.name);
    }

    UploadTask backupTask(String id, {String group = kBackupGroup}) => UploadTask(
      taskId: id,
      url: 'http://test-server.com/assets',
      filename: '$id.jpg',
      baseDirectory: BaseDirectory.temporary,
      group: group,
    );

    setUp(() {
      // Android keeps enqueueTasks to a single enqueueBackgroundAll call.
      debugDefaultTargetPlatformOverride = TargetPlatform.android;
      when(() => mockStorageRepository.clearCache()).thenAnswer((_) async {});
      when(() => mockUploadRepository.enqueueBackgroundAll(any())).thenAnswer((invocation) async {
        final tasks = invocation.positionalArguments.first as List;
        return List<bool>.filled(tasks.length, true);
      });
      when(() => mockUploadRepository.getActiveTasks(kBackupLivePhotoGroup)).thenAnswer((_) async => <Task>[]);
    });

    tearDown(() => debugDefaultTargetPlatformOverride = null);

    test('does not re-enqueue assets already enqueued in the same session', () async {
      final a1 = LocalAssetStub.image1;
      final a2 = LocalAssetStub.image2;
      stubUploadPath(a1);
      stubUploadPath(a2);
      when(() => mockBackupRepository.getCandidates('user-1')).thenAnswer((_) async => [a1, a2]);

      await sut.uploadBackupCandidates('user-1'); // enqueues a1 + a2
      await sut.uploadBackupCandidates('user-1'); // same candidates, already enqueued -> no-op

      verify(() => mockUploadRepository.enqueueBackgroundAll(any())).called(1);
    });

    test('enqueues the next batch once the upload queue drains', () async {
      final a1 = LocalAssetStub.image1;
      final a2 = LocalAssetStub.image2;
      stubUploadPath(a1);
      stubUploadPath(a2);
      sut.backupBatchSize = 1;
      when(() => mockBackupRepository.getCandidates('user-1')).thenAnswer((_) async => [a1, a2]);
      when(() => mockUploadRepository.getActiveTasks(kBackupGroup)).thenAnswer((_) async => <Task>[]);

      await sut.uploadBackupCandidates('user-1'); // enqueues a1 only (batch size 1)

      // a1 finishes and the queue is now empty -> the next batch (a2) is enqueued.
      capturedStatusCallback()(TaskStatusUpdate(backupTask(a1.id), TaskStatus.complete));
      await pumpEventQueue();

      verify(() => mockBackupRepository.getCandidates('user-1')).called(2);
      verify(() => mockUploadRepository.enqueueBackgroundAll(any())).called(2);
    });

    test('resume arms continuation and skips assets already in flight', () async {
      final a1 = LocalAssetStub.image1; // already uploading (resumed)
      final a2 = LocalAssetStub.image2; // the next asset to enqueue
      stubUploadPath(a2);
      sut.backupBatchSize = 1;
      when(() => mockUploadRepository.start()).thenAnswer((_) async {});
      when(() => mockBackupRepository.getCandidates('user-1')).thenAnswer((_) async => [a1, a2]);

      var activeCalls = 0;
      when(() => mockUploadRepository.getActiveTasks(kBackupGroup)).thenAnswer((_) async {
        activeCalls++;
        // First call (resume seeding) sees a1 in flight; later (drain check) empty.
        return activeCalls == 1 ? [backupTask(a1.id)] : <Task>[];
      });

      await sut.resume('user-1'); // seeds {a1}, arms continuation

      // a1 finishes and the queue drains -> next batch enqueues a2 only.
      capturedStatusCallback()(TaskStatusUpdate(backupTask(a1.id), TaskStatus.complete));
      await pumpEventQueue();

      final captured = verify(() => mockUploadRepository.enqueueBackgroundAll(captureAny())).captured;
      expect(captured, hasLength(1));
      expect((captured.single as List).cast<UploadTask>().map((t) => t.taskId), [a2.id]);
    });

    test('rechecks the drain when final callbacks overlap while a drain check is in progress', () async {
      final a1 = LocalAssetStub.image1;
      final a2 = LocalAssetStub.image2;
      final a3 = LocalAssetStub.image1.copyWith(id: 'image3', name: 'image3.jpg');
      stubUploadPath(a1);
      stubUploadPath(a2);
      stubUploadPath(a3);
      sut.backupBatchSize = 2;
      when(() => mockBackupRepository.getCandidates('user-1')).thenAnswer((_) async => [a1, a2, a3]);

      final firstDrainCheck = Completer<List<Task>>();
      var activeCalls = 0;
      when(() => mockUploadRepository.getActiveTasks(kBackupGroup)).thenAnswer((_) {
        activeCalls++;
        if (activeCalls == 1) {
          return firstDrainCheck.future;
        }
        return Future.value(<Task>[]);
      });

      await sut.uploadBackupCandidates('user-1'); // enqueues a1 + a2

      final onStatus = capturedStatusCallback();
      onStatus(TaskStatusUpdate(backupTask(a1.id), TaskStatus.complete));
      onStatus(TaskStatusUpdate(backupTask(a2.id), TaskStatus.complete));
      firstDrainCheck.complete([backupTask(a2.id)]);
      await pumpEventQueue();

      expect(activeCalls, 2);
      verify(() => mockUploadRepository.enqueueBackgroundAll(any())).called(2);
    });

    test('resume arms continuation from live photo still tasks and skips them after they finish', () async {
      final a1 = LocalAssetStub.image1; // already uploading in kBackupLivePhotoGroup
      final a2 = LocalAssetStub.image2; // the next asset to enqueue
      stubUploadPath(a2);
      sut.backupBatchSize = 1;
      when(() => mockUploadRepository.start()).thenAnswer((_) async {});
      when(() => mockBackupRepository.getCandidates('user-1')).thenAnswer((_) async => [a1, a2]);

      when(() => mockUploadRepository.getActiveTasks(kBackupGroup)).thenAnswer((_) async => <Task>[]);
      var livePhotoActiveCalls = 0;
      when(() => mockUploadRepository.getActiveTasks(kBackupLivePhotoGroup)).thenAnswer((_) async {
        livePhotoActiveCalls++;
        return livePhotoActiveCalls == 1 ? [backupTask(a1.id, group: kBackupLivePhotoGroup)] : <Task>[];
      });

      await sut.resume('user-1'); // seeds {a1}, arms continuation from the live-photo still group

      capturedStatusCallback()(TaskStatusUpdate(backupTask(a1.id, group: kBackupLivePhotoGroup), TaskStatus.complete));
      await pumpEventQueue();

      final captured = verify(() => mockUploadRepository.enqueueBackgroundAll(captureAny())).captured;
      expect(captured, hasLength(1));
      expect((captured.single as List).cast<UploadTask>().map((t) => t.taskId), [a2.id]);
    });

    test('does not enqueue the next batch while tasks are still active', () async {
      final a1 = LocalAssetStub.image1;
      final a2 = LocalAssetStub.image2;
      stubUploadPath(a1);
      stubUploadPath(a2);
      sut.backupBatchSize = 1;
      when(() => mockBackupRepository.getCandidates('user-1')).thenAnswer((_) async => [a1, a2]);
      when(
        () => mockUploadRepository.getActiveTasks(kBackupGroup),
      ).thenAnswer((_) async => [backupTask('still-running')]);

      await sut.uploadBackupCandidates('user-1'); // enqueues a1

      capturedStatusCallback()(TaskStatusUpdate(backupTask(a1.id), TaskStatus.complete));
      await pumpEventQueue();

      verify(() => mockUploadRepository.enqueueBackgroundAll(any())).called(1);
    });
  });
}
