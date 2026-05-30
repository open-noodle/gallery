import 'dart:async';

import 'package:background_downloader/background_downloader.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/constants/constants.dart';
import 'package:immich_mobile/providers/backup/backup.provider.dart';
import 'package:immich_mobile/services/background_upload.service.dart';
import 'package:immich_mobile/services/foreground_upload.service.dart';
import 'package:immich_mobile/utils/upload_speed_calculator.dart';
import 'package:mocktail/mocktail.dart';

class MockForegroundUploadService extends Mock implements ForegroundUploadService {}

class MockBackgroundUploadService extends Mock implements BackgroundUploadService {}

void main() {
  late MockForegroundUploadService foregroundUploadService;
  late MockBackgroundUploadService backgroundUploadService;
  late StreamController<TaskStatusUpdate> statusController;
  late StreamController<TaskProgressUpdate> progressController;
  late BackupNotifier sut;

  setUpAll(() {
    registerFallbackValue(Completer<void>());
  });

  setUp(() {
    foregroundUploadService = MockForegroundUploadService();
    backgroundUploadService = MockBackgroundUploadService();
    statusController = StreamController<TaskStatusUpdate>.broadcast();
    progressController = StreamController<TaskProgressUpdate>.broadcast();

    when(() => backgroundUploadService.taskStatusStream).thenAnswer((_) => statusController.stream);
    when(() => backgroundUploadService.taskProgressStream).thenAnswer((_) => progressController.stream);

    sut = BackupNotifier(foregroundUploadService, backgroundUploadService, UploadSpeedManager());
  });

  tearDown(() async {
    sut.dispose();
    await statusController.close();
    await progressController.close();
  });

  test('tracks iOS URLSession backup progress in upload state', () async {
    final task = UploadTask(
      taskId: 'asset-1',
      url: 'http://test-server.com/assets',
      filename: 'asset.jpg',
      displayName: 'asset.jpg',
      baseDirectory: BaseDirectory.temporary,
      group: kBackupGroup,
    );

    progressController.add(TaskProgressUpdate(task, 0.5, 1000, 0.25));
    await pumpEventQueue();

    expect(
      sut.state.uploadItems['asset-1'],
      isA<UploadStatus>()
          .having((status) => status.filename, 'filename', 'asset.jpg')
          .having((status) => status.progress, 'progress', 0.5)
          .having((status) => status.fileSize, 'fileSize', 1000),
    );
  });

  test('starts URLSession backup on iOS instead of foreground upload', () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    addTearDown(() => debugDefaultTargetPlatformOverride = null);

    when(() => backgroundUploadService.getActiveTasks(kBackupGroup)).thenAnswer((_) async => []);
    when(() => backgroundUploadService.getActiveTasks(kBackupLivePhotoGroup)).thenAnswer((_) async => []);
    when(() => backgroundUploadService.uploadBackupCandidates('user-1')).thenAnswer((_) async {});

    await sut.startBackup('user-1');

    verify(() => backgroundUploadService.uploadBackupCandidates('user-1')).called(1);
    verifyNever(() => foregroundUploadService.uploadCandidates(any(), any()));
  });

  test('stops URLSession backup on iOS when backup is disabled', () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    addTearDown(() => debugDefaultTargetPlatformOverride = null);

    when(() => backgroundUploadService.cancel()).thenAnswer((_) async => 0);

    await sut.stopBackup(reason: 'backup disabled');

    verify(() => backgroundUploadService.cancel()).called(1);
  });

  test('resumes active Live Photo still tasks instead of starting duplicate candidates', () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    addTearDown(() => debugDefaultTargetPlatformOverride = null);

    final livePhotoStillTask = UploadTask(
      taskId: 'asset-live',
      url: 'http://test-server.com/assets',
      filename: 'asset.heic',
      displayName: 'asset.heic',
      baseDirectory: BaseDirectory.temporary,
      group: kBackupLivePhotoGroup,
    );

    when(() => backgroundUploadService.getActiveTasks(kBackupGroup)).thenAnswer((_) async => []);
    when(
      () => backgroundUploadService.getActiveTasks(kBackupLivePhotoGroup),
    ).thenAnswer((_) async => [livePhotoStillTask]);
    when(() => backgroundUploadService.resume()).thenAnswer((_) async {});

    await sut.startBackup('user-1');

    verify(() => backgroundUploadService.resume()).called(1);
    verifyNever(() => backgroundUploadService.uploadBackupCandidates('user-1'));
  });

  test('tracks Live Photo still progress from the live photo group', () async {
    final task = UploadTask(
      taskId: 'asset-live',
      url: 'http://test-server.com/assets',
      filename: 'asset.heic',
      displayName: 'asset.heic',
      baseDirectory: BaseDirectory.temporary,
      group: kBackupLivePhotoGroup,
    );

    progressController.add(TaskProgressUpdate(task, 0.75, 2000, 0.5));
    await pumpEventQueue();

    expect(
      sut.state.uploadItems['asset-live'],
      isA<DriftUploadStatus>()
          .having((status) => status.filename, 'filename', 'asset.heic')
          .having((status) => status.progress, 'progress', 0.75)
          .having((status) => status.fileSize, 'fileSize', 2000),
    );
  });

  test('does not count Live Photo motion completion as final backup completion', () async {
    when(
      () => foregroundUploadService.getBackupCounts('user-1'),
    ).thenAnswer((_) async => (total: 1, remainder: 1, processing: 0));
    await sut.getBackupStatus('user-1');

    final motionMetadata = const UploadTaskMetadata(
      localAssetId: 'asset-live',
      isLivePhotos: true,
      livePhotoVideoId: '',
    ).toJson();
    final motionTask = UploadTask(
      taskId: 'asset-live',
      url: 'http://test-server.com/assets',
      filename: 'asset.mov',
      displayName: 'asset.mov',
      baseDirectory: BaseDirectory.temporary,
      group: kBackupGroup,
      metaData: motionMetadata,
    );

    statusController.add(TaskStatusUpdate(motionTask, TaskStatus.complete));
    await pumpEventQueue();

    expect(sut.state.backupCount, 0);
    expect(sut.state.remainderCount, 1);
  });

  test('counts Live Photo still completion as final backup completion', () async {
    when(
      () => foregroundUploadService.getBackupCounts('user-1'),
    ).thenAnswer((_) async => (total: 1, remainder: 1, processing: 0));
    await sut.getBackupStatus('user-1');

    final stillTask = UploadTask(
      taskId: 'asset-live',
      url: 'http://test-server.com/assets',
      filename: 'asset.heic',
      displayName: 'asset.heic',
      baseDirectory: BaseDirectory.temporary,
      group: kBackupLivePhotoGroup,
    );

    statusController.add(TaskStatusUpdate(stillTask, TaskStatus.complete));
    await pumpEventQueue();

    expect(sut.state.backupCount, 1);
    expect(sut.state.remainderCount, 0);
  });
}
