import 'dart:async';

typedef BackgroundBackupSync = Future<bool> Function({Duration? hashTimeout});
typedef BackgroundBackupAction = Future<void> Function();
typedef BackgroundBackupInfoLog = void Function(String message);
typedef BackgroundBackupWarningLog = void Function(String message);
typedef BackgroundBackupSevereLog = void Function(String message, Object error, StackTrace stackTrace);

class BackgroundBackupLoop {
  const BackgroundBackupLoop({
    required this.syncAssets,
    required this.handleBackup,
    required this.cleanup,
    required this.cancellationToken,
    required this.logInfo,
    required this.logWarning,
    required this.logSevere,
  });

  final BackgroundBackupSync syncAssets;
  final BackgroundBackupAction handleBackup;
  final BackgroundBackupAction cleanup;
  final Completer<void> cancellationToken;
  final BackgroundBackupInfoLog logInfo;
  final BackgroundBackupWarningLog logWarning;
  final BackgroundBackupSevereLog logSevere;

  Future<void> run({
    required Duration hashTimeout,
    required Duration? backupTimeout,
    required String debugLabel,
  }) async {
    logInfo(
      '$debugLabel started hashTimeout: ${hashTimeout.inSeconds}s, backupTimeout: ${backupTimeout?.inMinutes ?? '~'}m',
    );
    final sw = Stopwatch()..start();
    try {
      if (!await syncAssets(hashTimeout: hashTimeout)) {
        logWarning('Remote sync did not complete successfully, skipping backup');
        return;
      }

      final backupFuture = handleBackup();
      Timer? cancelTimer;
      if (backupTimeout != null) {
        cancelTimer = Timer(backupTimeout, () {
          if (!cancellationToken.isCompleted) {
            logWarning('$debugLabel timed out after ${backupTimeout.inMinutes}m, cancelling backup');
            cancellationToken.complete();
          }
        });
      }

      try {
        await backupFuture;
      } finally {
        cancelTimer?.cancel();
      }
    } catch (error, stackTrace) {
      logSevere('Failed to complete $debugLabel', error, stackTrace);
    } finally {
      sw.stop();
      logInfo('$debugLabel completed in ${sw.elapsed.inSeconds}s');
      await cleanup();
    }
  }
}
