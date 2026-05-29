import 'package:background_downloader/background_downloader.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/utils/background_downloader_recovery.dart';

void main() {
  test('resumes stored updates before rescheduling killed tasks', () async {
    final calls = <String>[];
    final logs = <String>[];

    await recoverBackgroundDownloaderTasks(
      delay: Duration.zero,
      resumeFromBackground: () async {
        calls.add('resume');
      },
      rescheduleKilledTasks: () async {
        calls.add('reschedule');
        return ([UploadTask(taskId: 'ok', url: 'http://test', filename: 'ok.jpg')], <Task>[]);
      },
      logInfo: logs.add,
    );

    expect(calls, ['resume', 'reschedule']);
    expect(logs.single, 'Rescheduled 1 background downloader tasks');
  });

  test('logs failed killed-task reschedules', () async {
    final logs = <String>[];

    await recoverBackgroundDownloaderTasks(
      delay: Duration.zero,
      resumeFromBackground: () async {},
      rescheduleKilledTasks: () async {
        return (<Task>[], [UploadTask(taskId: 'failed', url: 'http://test', filename: 'failed.jpg')]);
      },
      logInfo: logs.add,
    );

    expect(logs.single, 'Failed to reschedule 1 background downloader tasks');
  });
}
