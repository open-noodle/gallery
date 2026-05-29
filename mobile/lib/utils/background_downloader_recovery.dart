import 'dart:async';

import 'package:background_downloader/background_downloader.dart';
import 'package:logging/logging.dart';

final Logger _backgroundDownloaderRecoveryLogger = Logger('BackgroundDownloaderRecovery');

Future<void> recoverBackgroundDownloaderTasks({
  Duration delay = const Duration(seconds: 5),
  Future<void> Function()? resumeFromBackground,
  Future<(List<Task>, List<Task>)> Function()? rescheduleKilledTasks,
  void Function(String message)? logInfo,
  void Function(String message, Object error, StackTrace stackTrace)? logWarning,
}) async {
  if (delay > Duration.zero) {
    await Future<void>.delayed(delay);
  }

  final downloader = FileDownloader();
  final resume = resumeFromBackground ?? downloader.resumeFromBackground;
  final reschedule = rescheduleKilledTasks ?? downloader.rescheduleKilledTasks;
  final info = logInfo ?? _backgroundDownloaderRecoveryLogger.info;
  final warning = logWarning ?? _backgroundDownloaderRecoveryLogger.warning;

  try {
    await resume();
    final (rescheduled, failed) = await reschedule();

    if (rescheduled.isNotEmpty) {
      info('Rescheduled ${rescheduled.length} background downloader tasks');
    }
    if (failed.isNotEmpty) {
      info('Failed to reschedule ${failed.length} background downloader tasks');
    }
  } catch (error, stackTrace) {
    warning('Failed to recover background downloader tasks', error, stackTrace);
  }
}

void scheduleBackgroundDownloaderRecovery() {
  unawaited(recoverBackgroundDownloaderTasks());
}
