import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('iOS background worker derives branded task identifiers from permitted identifiers', () {
    final source = File('ios/Runner/Background/BackgroundWorkerApiImpl.swift').readAsStringSync();

    expect(source, contains('BGTaskSchedulerPermittedIdentifiers'));
    expect(source, contains('hasSuffix(".refreshUpload")'));
    expect(source, contains('hasSuffix(".processingUpload")'));
    expect(source, contains('BGAppRefreshTaskRequest(identifier: refreshTaskID)'));
    expect(source, contains('BGProcessingTaskRequest(identifier: processingTaskID)'));
  });

  test('Android background worker preserves media triggers, charging constraint, and periodic worker', () {
    final source = File(
      'android/app/src/main/kotlin/app/alextran/immich/background/BackgroundWorkerApiImpl.kt',
    ).readAsStringSync();

    expect(source, contains('addContentUriTrigger(MediaStore.Images.Media.INTERNAL_CONTENT_URI'));
    expect(source, contains('addContentUriTrigger(MediaStore.Images.Media.EXTERNAL_CONTENT_URI'));
    expect(source, contains('addContentUriTrigger(MediaStore.Video.Media.INTERNAL_CONTENT_URI'));
    expect(source, contains('addContentUriTrigger(MediaStore.Video.Media.EXTERNAL_CONTENT_URI'));
    expect(source, contains('setRequiresCharging(settings.requiresCharging)'));
    expect(source, contains('setRequiresBatteryNotLow(true)'));
    expect(source, contains('PeriodicWorkRequestBuilder<PeriodicWorker>'));
  });
}
