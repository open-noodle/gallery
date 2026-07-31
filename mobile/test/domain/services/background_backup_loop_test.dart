import 'dart:async';

import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/services/background_backup_loop.dart';

void main() {
  test('runs sync, backup, and cleanup in order when sync succeeds', () async {
    final calls = <String>[];
    final cancellationToken = Completer<void>();
    final loop = BackgroundBackupLoop(
      syncAssets: ({Duration? hashTimeout}) async {
        calls.add('sync:${hashTimeout!.inMinutes}');
        return true;
      },
      handleBackup: () async {
        calls.add('backup');
      },
      cleanup: () async {
        calls.add('cleanup');
      },
      cancellationToken: cancellationToken,
      logInfo: calls.add,
      logWarning: (message) => calls.add('warning:$message'),
      logSevere: (message, error, stackTrace) => calls.add('severe:$message'),
    );

    await loop.run(hashTimeout: const Duration(minutes: 3), backupTimeout: null, debugLabel: 'test background upload');

    expect(calls, containsAllInOrder(['sync:3', 'backup', 'cleanup']));
    expect(cancellationToken.isCompleted, isFalse);
  });

  test('skips backup and still cleans up when sync fails', () async {
    final calls = <String>[];
    final loop = BackgroundBackupLoop(
      syncAssets: ({Duration? hashTimeout}) async {
        calls.add('sync');
        return false;
      },
      handleBackup: () async {
        calls.add('backup');
      },
      cleanup: () async {
        calls.add('cleanup');
      },
      cancellationToken: Completer<void>(),
      logInfo: calls.add,
      logWarning: (message) => calls.add('warning:$message'),
      logSevere: (message, error, stackTrace) => calls.add('severe:$message'),
    );

    await loop.run(hashTimeout: const Duration(minutes: 3), backupTimeout: null, debugLabel: 'test background upload');

    expect(
      calls,
      containsAllInOrder(['sync', 'warning:Remote sync did not complete successfully, skipping backup', 'cleanup']),
    );
    expect(calls, isNot(contains('backup')));
  });

  test('completes cancellation token when backup timeout expires', () {
    fakeAsync((async) {
      final calls = <String>[];
      final cancellationToken = Completer<void>();
      final backupGate = Completer<void>();
      final loop = BackgroundBackupLoop(
        syncAssets: ({Duration? hashTimeout}) async {
          calls.add('sync');
          return true;
        },
        handleBackup: () async {
          calls.add('backup-start');
          await backupGate.future;
          calls.add('backup-end');
        },
        cleanup: () async {
          calls.add('cleanup');
        },
        cancellationToken: cancellationToken,
        logInfo: calls.add,
        logWarning: (message) => calls.add('warning:$message'),
        logSevere: (message, error, stackTrace) => calls.add('severe:$message'),
      );

      unawaited(
        loop.run(
          hashTimeout: const Duration(minutes: 3),
          backupTimeout: const Duration(minutes: 19),
          debugLabel: 'Android background upload',
        ),
      );

      async.flushMicrotasks();
      expect(calls, containsAllInOrder(['sync', 'backup-start']));
      expect(cancellationToken.isCompleted, isFalse);

      async.elapse(const Duration(minutes: 19));
      async.flushMicrotasks();
      expect(cancellationToken.isCompleted, isTrue);
      expect(calls, contains('warning:Android background upload timed out after 19m, cancelling backup'));

      backupGate.complete();
      async.flushMicrotasks();
      expect(calls, containsAllInOrder(['backup-end', 'cleanup']));
    });
  });

  test('logs severe failures and still cleans up', () async {
    final calls = <String>[];
    final loop = BackgroundBackupLoop(
      syncAssets: ({Duration? hashTimeout}) async {
        throw StateError('sync failed');
      },
      handleBackup: () async {
        calls.add('backup');
      },
      cleanup: () async {
        calls.add('cleanup');
      },
      cancellationToken: Completer<void>(),
      logInfo: calls.add,
      logWarning: (message) => calls.add('warning:$message'),
      logSevere: (message, error, stackTrace) => calls.add('severe:$message:$error'),
    );

    await loop.run(hashTimeout: const Duration(minutes: 3), backupTimeout: null, debugLabel: 'iOS background upload');

    expect(calls.where((call) => call.startsWith('severe:Failed to complete iOS background upload')), hasLength(1));
    expect(calls, contains('cleanup'));
  });

  // Regression for the shared-token hazard: the worker wires the loop with the
  // SAME `_cancellationToken` that `_handleCleanup` also completes. On the
  // bounded Android path the timeout fires (loop completes the token), then the
  // `finally` runs cleanup, which must ALSO be able to "complete" the token
  // without throwing or aborting teardown. This test models that real wiring:
  // the timeout completes the token, and `cleanup` completes it again behind an
  // `isCompleted` guard (mirroring the guarded production cleanup). The loop's
  // own completion must therefore be idempotent and cleanup must still run to
  // the end.
  test('runs cleanup to completion when the timeout already completed the shared token', () {
    fakeAsync((async) {
      final calls = <String>[];
      final cancellationToken = Completer<void>();
      final backupGate = Completer<void>();
      var cleanupFinished = false;
      final loop = BackgroundBackupLoop(
        syncAssets: ({Duration? hashTimeout}) async => true,
        handleBackup: () async {
          calls.add('backup-start');
          await backupGate.future;
          calls.add('backup-end');
        },
        cleanup: () async {
          calls.add('cleanup-start');
          // Mirrors the guarded completion in _handleCleanup; must be a no-op
          // when the timeout already completed the token, and must NOT throw.
          if (!cancellationToken.isCompleted) {
            cancellationToken.complete();
          }
          cleanupFinished = true;
          calls.add('cleanup-end');
        },
        cancellationToken: cancellationToken,
        logInfo: calls.add,
        logWarning: (message) => calls.add('warning:$message'),
        logSevere: (message, error, stackTrace) => calls.add('severe:$message:$error'),
      );

      unawaited(
        loop.run(
          hashTimeout: const Duration(minutes: 3),
          backupTimeout: const Duration(minutes: 19),
          debugLabel: 'Android background upload',
        ),
      );

      async.flushMicrotasks();
      async.elapse(const Duration(minutes: 19));
      async.flushMicrotasks();
      expect(cancellationToken.isCompleted, isTrue);

      // Backup observes cancellation and returns; cleanup must run fully.
      backupGate.complete();
      async.flushMicrotasks();

      expect(cleanupFinished, isTrue);
      expect(calls, containsAllInOrder(['backup-end', 'cleanup-start', 'cleanup-end']));
      // No `severe:` entry means cleanup did not throw on the double-complete.
      expect(calls.where((call) => call.startsWith('severe:')), isEmpty);
    });
  });
}
