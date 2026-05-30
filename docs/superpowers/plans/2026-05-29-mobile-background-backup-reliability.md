# Mobile Background Backup Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing mobile auto-backup pipeline reliable and observable while preserving mobile-only upstream parity and handling OS-blocked states honestly.

**Architecture:** Keep the existing native scheduler -> Flutter background worker -> sync/hash -> upload flow. First port mobile-only upstream background-worker fixes, then add testable seams for the bounded worker loop, Live Photo logical completion, persisted background backup health, and stale/reminder UI. Do not add a parallel scheduler and do not introduce server/API/database dependencies.

**Tech Stack:** Flutter/Dart, Riverpod, Drift-backed `Store`, `background_downloader`, Pigeon, Android WorkManager/Kotlin, iOS BGTaskScheduler/Swift, `flutter_test`, `mocktail`.

---

## File Structure

Create:

- `mobile/lib/domain/services/background_backup_loop.dart`
  - A pure Dart bounded-loop runner used by `BackgroundWorkerBgService`.
  - Contains the timeout/cancellation behavior from upstream commit `8f4b0fce49`.
- `mobile/test/domain/services/background_backup_loop_test.dart`
  - Unit tests for sync/backup order, timeout cancellation, cleanup, and failure handling.
- `mobile/lib/domain/services/background_backup_event_recorder.dart`
  - A pure Dart recorder that maps worker wake/preflight/sync outcomes to persisted backup-health events.
- `mobile/test/domain/services/background_backup_event_recorder_test.dart`
  - Unit tests for worker event mapping without booting a background isolate.
- `mobile/lib/domain/models/background_backup_status.model.dart`
  - JSON-serializable model and enums for persisted background backup health.
- `mobile/lib/services/background_backup_status.service.dart`
  - Store-backed persistence, health derivation, wake/enqueue/success/failure recording, and reminder-rate decisions.
- `mobile/test/domain/models/background_backup_status_model_test.dart`
  - Serialization and health derivation tests.
- `mobile/test/services/background_backup_status.service_test.dart`
  - Store-backed service tests using in-memory Drift.
- `mobile/lib/widgets/backup/background_backup_health_banner.dart`
  - Small in-app status banner for warning, stale, and blocked background backup states.
- `mobile/test/widgets/backup/background_backup_health_banner_test.dart`
  - Widget tests for hidden/visible status messages.
- `mobile/lib/services/background_backup_reminder.service.dart`
  - Optional stale-background-backup reminder notification with a test seam around platform notification delivery.
- `mobile/test/services/background_backup_reminder.service_test.dart`
  - Unit tests for stale-only reminder delivery and rate limiting.
- `mobile/test/platform/background_worker_native_files_test.dart`
  - Static native-boundary regression tests for branded iOS task IDs and Android WorkManager constraints/triggers.

Modify:

- `mobile/pigeon/background_worker_api.dart`
  - Change Android background upload API to `void onAndroidUpload(int? maxMinutes);`.
- Generated Pigeon files:
  - `mobile/lib/platform/background_worker_api.g.dart`
  - `mobile/ios/Runner/Background/BackgroundWorker.g.swift`
  - `mobile/android/app/src/main/kotlin/app/alextran/immich/background/BackgroundWorker.g.kt`
- `mobile/android/app/src/main/kotlin/app/alextran/immich/background/BackgroundWorker.kt`
  - Pass `maxMinutesArg = 20` when invoking Flutter.
- `mobile/lib/domain/services/background_worker.service.dart`
  - Use `BackgroundBackupLoop`, record background backup status, keep downloader recovery, keep branded/iOS behavior.
  - Make `_handleCleanup`'s `_cancellationToken.complete()` idempotent (guard with `isCompleted`) so the bounded-timeout path cannot abort teardown.
- `mobile/lib/domain/models/store.model.dart`
  - Add `backgroundBackupStatus<String>._(1014)`.
- `mobile/lib/services/background_upload.service.dart`
  - Record candidate counts/enqueue/success/failure.
  - Preserve iOS notification and holding queue fixes.
  - Preserve Live Photo metadata correctness.
- `mobile/lib/providers/backup/drift_backup.provider.dart`
  - Treat `kBackupGroup` and `kBackupLivePhotoGroup` as one logical backup surface.
  - Do not count a Live Photo motion upload as a completed backed-up asset until the still component completes.
- `mobile/lib/pages/backup/drift_backup.page.dart`
  - Show `BackgroundBackupHealthBanner` near the backup controls.
- `i18n/en.json`
  - Add explicit strings for delayed, stale, blocked, and reminder backup warnings (sorted alphabetically).
- `mobile/lib/generated/` (codegen translation loader)
  - Regenerated via `make translation` after editing `i18n/en.json`; the mobile app loads strings from this codegen, not the raw JSON.
- Existing tests:
  - `mobile/test/providers/backup/drift_backup_provider_test.dart`
  - `mobile/test/services/background_upload.service_test.dart`
  - `mobile/test/repositories/upload_repository_test.dart`
  - `mobile/test/utils/background_downloader_recovery_test.dart`

---

### Task 1: Upstream Mobile-Only Intake Gate

**Files:**

- Read: `mobile/lib/domain/services/background_worker.service.dart`
- Read: `mobile/android/app/src/main/kotlin/app/alextran/immich/background/BackgroundWorker.kt`
- Read: `mobile/pigeon/background_worker_api.dart`
- Read: `mobile/lib/providers/backup/drift_backup.provider.dart`
- Read: `mobile/lib/services/background_upload.service.dart`
- Read: `mobile/lib/repositories/upload.repository.dart`

- [ ] **Step 1: Confirm candidate commit scopes**

Run:

```bash
git show --stat 8f4b0fce49
git show --name-only --format=fuller 8f4b0fce49
git show --stat 77701dd5a3
git show --name-only --format=fuller 77701dd5a3
```

Expected:

- `8f4b0fce49` touches only mobile background worker/Pigeon files.
- `77701dd5a3` touches only mobile files, but broad backup config state. It is not needed for the first reliability slice unless later compile/test evidence requires it.

- [ ] **Step 2: Reject server/API/database-dependent commits**

Run:

```bash
git show --name-only --format= 8f4b0fce49 | rg -n '^(server|open-api|e2e|machine-learning|docker|web|cli)/' || true
git show --name-only --format= 77701dd5a3 | rg -n '^(server|open-api|e2e|machine-learning|docker|web|cli)/' || true
```

Expected:

- No output for `8f4b0fce49`.
- No output for `77701dd5a3`.

- [ ] **Step 3: Select only the bounded-worker upstream fix for this plan**

Decision:

- Port the behavior from `8f4b0fce49`.
- Do not cherry-pick `77701dd5a3` in this implementation. If a later test proves the background worker reads stale backup config, manually port the smallest mobile-only setting read needed and keep it covered by tests.

- [ ] **Step 4: Commit nothing**

No files should be changed by Task 1.

Run:

```bash
git status --short
```

Expected: no new changes from this task.

---

### Task 2: Add a TDD Seam for the Bounded Background Loop

**Files:**

- Create: `mobile/test/domain/services/background_backup_loop_test.dart`
- Create: `mobile/lib/domain/services/background_backup_loop.dart`
- Modify: `mobile/lib/domain/services/background_worker.service.dart`

- [ ] **Step 1: Write the failing loop tests**

Create `mobile/test/domain/services/background_backup_loop_test.dart`:

```dart
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

    await loop.run(
      hashTimeout: const Duration(minutes: 3),
      backupTimeout: null,
      debugLabel: 'test background upload',
    );

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

    await loop.run(
      hashTimeout: const Duration(minutes: 3),
      backupTimeout: null,
      debugLabel: 'test background upload',
    );

    expect(calls, containsAllInOrder(['sync', 'warning:Remote sync did not complete successfully, skipping backup', 'cleanup']));
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

    await loop.run(
      hashTimeout: const Duration(minutes: 3),
      backupTimeout: null,
      debugLabel: 'iOS background upload',
    );

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
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```bash
cd mobile
flutter test test/domain/services/background_backup_loop_test.dart
```

Expected: FAIL because `package:immich_mobile/domain/services/background_backup_loop.dart` does not exist.

- [ ] **Step 3: Implement the pure loop**

Create `mobile/lib/domain/services/background_backup_loop.dart`:

```dart
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
```

- [ ] **Step 4: Use `BackgroundBackupLoop` from the background worker**

Modify `mobile/lib/domain/services/background_worker.service.dart`:

```dart
import 'package:immich_mobile/domain/services/background_backup_loop.dart';
```

Replace the linear bodies of `onAndroidUpload` and `onIosUpload` (today each is a single `try/finally` sync → backup → cleanup sequence — there are no loops yet; the iOS body currently uses `backupFuture.timeout(onTimeout: () {})` which never touches `_cancellationToken`) with:

```dart
  @override
  Future<void> onAndroidUpload() async {
    final hashTimeout = Duration(minutes: _isBackupEnabled ? 3 : 6);
    return _backgroundLoop(
      hashTimeout: hashTimeout,
      backupTimeout: null,
      debugLabel: 'Android background upload',
    );
  }

  @override
  Future<void> onIosUpload(bool isRefresh, int? maxSeconds) async {
    final hashTimeout = isRefresh ? const Duration(seconds: 5) : Duration(minutes: _isBackupEnabled ? 3 : 6);
    final backupTimeout = maxSeconds != null ? Duration(seconds: maxSeconds - 1) : null;
    return _backgroundLoop(hashTimeout: hashTimeout, backupTimeout: backupTimeout, debugLabel: 'iOS background upload');
  }

  Future<void> _backgroundLoop({
    required Duration hashTimeout,
    required Duration? backupTimeout,
    required String debugLabel,
  }) {
    return BackgroundBackupLoop(
      syncAssets: _syncAssets,
      handleBackup: _handleBackup,
      cleanup: _cleanup,
      cancellationToken: _cancellationToken,
      logInfo: _logger.info,
      logWarning: _logger.warning,
      logSevere: _logger.severe,
    ).run(hashTimeout: hashTimeout, backupTimeout: backupTimeout, debugLabel: debugLabel);
  }
```

Keep this existing line in `init()`:

```dart
      scheduleBackgroundDownloaderRecovery();
```

**Make cleanup token-completion idempotent (required — fixes the shared-token double-complete).**

The new bounded path means the timer in `BackgroundBackupLoop` completes `_cancellationToken` on timeout (the Android path passes this same token to `foregroundUploadService.uploadCandidates(...)` as its cancel signal). The existing `_handleCleanup` _also_ completes the same token, unguarded, at `background_worker.service.dart:187`:

```dart
      _cancellationToken.complete();
```

After a timeout this throws `StateError: Future already completed`. The throw is swallowed by the `try/catch` at the bottom of `_handleCleanup`, but it aborts the rest of teardown — `Store.dispose()`, `LogService.I.dispose()`, `workerManagerPatch.dispose()`, `nativeSyncApi.cancelHashing()`, and `backgroundSyncManager.cancel()` (the lines after 187) never run on any timed-out background run. Guard it:

```dart
      if (!_cancellationToken.isCompleted) {
        _cancellationToken.complete();
      }
```

Both the loop (already guarded) and cleanup now complete the token at most once. The new Step 1 test `runs cleanup to completion when the timeout already completed the shared token` reproduces this exact wiring at the loop seam and proves cleanup runs end-to-end without throwing. (A full `BackgroundWorkerBgService` unit test is impractical — the service boots Drift, the logger DB, and a `ProviderContainer` in `init()` — so the loop seam test plus this guard are the regression coverage for the integration. Note `_ref` is a `ProviderContainer?`, not a `Ref?`.)

- [ ] **Step 5: Run the focused test and confirm it passes**

Run:

```bash
cd mobile
flutter test test/domain/services/background_backup_loop_test.dart
dart analyze lib/domain/services/background_worker.service.dart
```

Expected: PASS and no analyzer errors. Task 2 must leave the branch compileable; Android's `maxMinutes` API change happens in Task 3.

- [ ] **Step 6: Commit**

Run:

```bash
git add mobile/lib/domain/services/background_backup_loop.dart mobile/lib/domain/services/background_worker.service.dart mobile/test/domain/services/background_backup_loop_test.dart
git commit -m "fix(mobile): add bounded background backup loop"
```

---

### Task 3: Port the Mobile-Only Android `maxMinutes` Upstream Fix

**Files:**

- Modify: `mobile/pigeon/background_worker_api.dart`
- Modify generated: `mobile/lib/platform/background_worker_api.g.dart`
- Modify generated: `mobile/ios/Runner/Background/BackgroundWorker.g.swift`
- Modify generated: `mobile/android/app/src/main/kotlin/app/alextran/immich/background/BackgroundWorker.g.kt`
- Modify: `mobile/android/app/src/main/kotlin/app/alextran/immich/background/BackgroundWorker.kt`
- Modify: `mobile/lib/domain/services/background_worker.service.dart`

- [ ] **Step 1: Create the failing API-usage check**

First, change only `mobile/lib/domain/services/background_worker.service.dart` so Android receives and applies the upstream runtime bound:

```dart
  @override
  Future<void> onAndroidUpload(int? maxMinutes) async {
    final hashTimeout = Duration(minutes: _isBackupEnabled ? 3 : 6);
    final backupTimeout = maxMinutes != null ? Duration(minutes: maxMinutes - 1) : null;
    return _backgroundLoop(
      hashTimeout: hashTimeout,
      backupTimeout: backupTimeout,
      debugLabel: 'Android background upload',
    );
  }
```

Then run:

```bash
cd mobile
flutter test test/domain/services/background_backup_loop_test.dart
dart analyze lib/domain/services/background_worker.service.dart
```

Expected:

- The test passes from Task 2.
- `dart analyze` FAILS because generated `BackgroundWorkerFlutterApi` still declares `onAndroidUpload()` without `int? maxMinutes`.
- Do not commit this temporary failing state.

- [ ] **Step 2: Update the Pigeon source**

In `mobile/pigeon/background_worker_api.dart`, replace:

```dart
  void onAndroidUpload();
```

with:

```dart
  void onAndroidUpload(int? maxMinutes);
```

- [ ] **Step 3: Regenerate Pigeon files**

Run:

```bash
cd mobile
mise run pigeon:background-worker
```

Expected:

- `mobile/lib/platform/background_worker_api.g.dart` changes.
- `mobile/ios/Runner/Background/BackgroundWorker.g.swift` changes.
- `mobile/android/app/src/main/kotlin/app/alextran/immich/background/BackgroundWorker.g.kt` changes.

- [ ] **Step 4: Update Android native invocation**

In `mobile/android/app/src/main/kotlin/app/alextran/immich/background/BackgroundWorker.kt`, replace:

```kotlin
    flutterApi?.onAndroidUpload { handleHostResult(it) }
```

with:

```kotlin
    flutterApi?.onAndroidUpload(maxMinutesArg = 20L) { handleHostResult(it) }
```

Use the `20L` long literal: Pigeon maps Dart `int?` to a Kotlin `Long?` parameter, and Kotlin does not implicitly widen `Int` to `Long`, so `20` alone fails to compile. Cross-check the exact literal/value against upstream commit `8f4b0fce49` when porting.

- [ ] **Step 5: Verify the mobile-only scope**

Run:

```bash
git diff --name-only | rg -n '^(server|open-api|e2e|machine-learning|docker|web|cli)/' || true
```

Expected: no output.

- [ ] **Step 6: Run focused verification**

Run:

```bash
cd mobile
dart analyze lib/domain/services/background_worker.service.dart
flutter test test/domain/services/background_backup_loop_test.dart
```

Expected: PASS with no analyzer errors for `background_worker.service.dart`.

- [ ] **Step 7: Commit**

Run:

```bash
git add mobile/pigeon/background_worker_api.dart mobile/lib/platform/background_worker_api.g.dart mobile/ios/Runner/Background/BackgroundWorker.g.swift mobile/android/app/src/main/kotlin/app/alextran/immich/background/BackgroundWorker.g.kt mobile/android/app/src/main/kotlin/app/alextran/immich/background/BackgroundWorker.kt mobile/lib/domain/services/background_worker.service.dart
git commit -m "fix(mobile): bound Android background backup runtime"
```

---

### Task 4: Fix Live Photo Background Completion as One Logical Asset

**Files:**

- Modify: `mobile/test/providers/backup/drift_backup_provider_test.dart`
- Modify: `mobile/lib/providers/backup/drift_backup.provider.dart`

- [ ] **Step 1: Add failing tests for both backup groups**

First ensure the test file imports everything these snippets use (several are not currently imported there):

```dart
import 'package:flutter/foundation.dart'; // debugDefaultTargetPlatformOverride, TargetPlatform
import 'package:immich_mobile/constants/constants.dart'; // kBackupGroup, kBackupLivePhotoGroup
import 'package:immich_mobile/services/background_upload.service.dart'; // UploadTaskMetadata
// background_downloader provides UploadTask, BaseDirectory, TaskProgressUpdate, TaskStatusUpdate, TaskStatus
import 'package:background_downloader/background_downloader.dart';
```

`UploadTaskMetadata` is defined in `background_upload.service.dart` (not the provider), with fields `localAssetId`, `isLivePhotos`, `livePhotoVideoId` and `fromJson`/`toJson`.

Append these tests to `mobile/test/providers/backup/drift_backup_provider_test.dart`:

```dart
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
    when(() => backgroundUploadService.getActiveTasks(kBackupLivePhotoGroup)).thenAnswer((_) async => [livePhotoStillTask]);
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
    when(() => foregroundUploadService.getBackupCounts('user-1')).thenAnswer(
      (_) async => (total: 1, remainder: 1, processing: 0),
    );
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
    when(() => foregroundUploadService.getBackupCounts('user-1')).thenAnswer(
      (_) async => (total: 1, remainder: 1, processing: 0),
    );
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
```

- [ ] **Step 2: Run the provider tests and confirm failure**

Run:

```bash
cd mobile
flutter test test/providers/backup/drift_backup_provider_test.dart
```

Expected: FAIL because `startBackupWithURLSession` only checks `kBackupGroup`, the notifier ignores `kBackupLivePhotoGroup`, and motion completion increments counts too early.

- [ ] **Step 3: Accept both backup groups in notifier callbacks**

In `mobile/lib/providers/backup/drift_backup.provider.dart`, add:

```dart
  bool _isBackgroundBackupGroup(String group) {
    return group == kBackupGroup || group == kBackupLivePhotoGroup;
  }

  bool _isLivePhotoMotionTask(Task task) {
    if (task.group != kBackupGroup || task.metaData.isEmpty) {
      return false;
    }

    try {
      return UploadTaskMetadata.fromJson(task.metaData).isLivePhotos;
    } catch (_) {
      return false;
    }
  }
```

Change the progress guard to:

```dart
    if (!mounted || !_isBackgroundBackupGroup(update.task.group)) {
      return;
    }
```

Change the status guard to:

```dart
    if (!mounted || !_isBackgroundBackupGroup(update.task.group)) {
      return;
    }
```

- [ ] **Step 4: Count Live Photo completion only on the still group**

In the `TaskStatus.complete` branch of `_handleBackgroundBackupStatus`, use:

```dart
      case TaskStatus.complete:
        if (!_isLivePhotoMotionTask(update.task)) {
          state = state.copyWith(backupCount: state.backupCount + 1, remainderCount: state.remainderCount - 1);
          Future.delayed(const Duration(milliseconds: 1000), () {
            _removeUploadItem(taskId);
          });
        }
        break;
```

- [ ] **Step 5: Resume active tasks from both groups**

In `startBackupWithURLSession`, replace:

```dart
    final tasks = await _backgroundUploadService.getActiveTasks(kBackupGroup);
```

with:

```dart
    final taskGroups = await Future.wait([
      _backgroundUploadService.getActiveTasks(kBackupGroup),
      _backgroundUploadService.getActiveTasks(kBackupLivePhotoGroup),
    ]);
    final tasks = taskGroups.expand((group) => group).toList(growable: false);
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
cd mobile
flutter test test/providers/backup/drift_backup_provider_test.dart
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add mobile/lib/providers/backup/drift_backup.provider.dart mobile/test/providers/backup/drift_backup_provider_test.dart
git commit -m "fix(mobile): treat live photo background upload as one backup item"
```

---

### Task 5: Add Persisted Background Backup Status Model

**Files:**

- Create: `mobile/lib/domain/models/background_backup_status.model.dart`
- Create: `mobile/test/domain/models/background_backup_status_model_test.dart`
- Modify: `mobile/lib/domain/models/store.model.dart`

- [ ] **Step 1: Write failing model tests**

Create `mobile/test/domain/models/background_backup_status_model_test.dart`:

```dart
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/background_backup_status.model.dart';

void main() {
  test('serializes and deserializes background backup status', () {
    final status = BackgroundBackupStatus(
      lastBackgroundWakeAt: DateTime.utc(2026, 5, 29, 10),
      lastLocalPhotoScanAt: DateTime.utc(2026, 5, 29, 10, 1),
      lastUploadEnqueueAt: DateTime.utc(2026, 5, 29, 10, 2),
      lastUploadSuccessAt: DateTime.utc(2026, 5, 29, 10, 3),
      lastReminderAt: DateTime.utc(2026, 5, 29, 11),
      lastBackgroundFailureReason: BackgroundBackupFailureReason.remoteSyncFailed,
      lastCandidateCount: 12,
      lastSuccessfulSchedulerKind: BackgroundBackupSchedulerKind.iosProcessing,
    );

    final decoded = BackgroundBackupStatus.fromJson(jsonDecode(jsonEncode(status.toJson())) as Map<String, dynamic>);

    expect(decoded, status);
  });

  test('derives healthy when a wake happened inside the warning threshold', () {
    final now = DateTime.utc(2026, 5, 29, 12);
    final status = BackgroundBackupStatus(lastBackgroundWakeAt: now.subtract(const Duration(hours: 4)));

    expect(status.deriveHealth(now: now), BackgroundBackupHealth.healthy);
  });

  test('derives warning and stale based on elapsed time', () {
    final now = DateTime.utc(2026, 5, 29, 12);

    expect(
      BackgroundBackupStatus(lastBackgroundWakeAt: now.subtract(const Duration(hours: 72))).deriveHealth(now: now),
      BackgroundBackupHealth.warning,
    );
    expect(
      BackgroundBackupStatus(lastBackgroundWakeAt: now.subtract(const Duration(days: 8))).deriveHealth(now: now),
      BackgroundBackupHealth.stale,
    );
  });

  test('derives blocked when OS prevented background execution for a stale interval', () {
    final now = DateTime.utc(2026, 5, 29, 12);
    final status = BackgroundBackupStatus(
      lastBackgroundWakeAt: now.subtract(const Duration(days: 8)),
      lastBackgroundFailureReason: BackgroundBackupFailureReason.osPrevented,
    );

    expect(status.deriveHealth(now: now), BackgroundBackupHealth.blocked);
  });

  test('derives pending when candidates were found recently', () {
    final now = DateTime.utc(2026, 5, 29, 12);
    final status = BackgroundBackupStatus(
      lastCandidateCount: 3,
      lastUploadEnqueueAt: now.subtract(const Duration(minutes: 15)),
    );

    expect(status.deriveHealth(now: now), BackgroundBackupHealth.pending);
  });

  test('rate limits reminders to one per day', () {
    final now = DateTime.utc(2026, 5, 29, 12);

    expect(BackgroundBackupStatus(lastReminderAt: null).shouldShowReminder(now: now), isTrue);
    expect(
      BackgroundBackupStatus(lastReminderAt: now.subtract(const Duration(hours: 12))).shouldShowReminder(now: now),
      isFalse,
    );
    expect(
      BackgroundBackupStatus(lastReminderAt: now.subtract(const Duration(hours: 25))).shouldShowReminder(now: now),
      isTrue,
    );
  });
}
```

- [ ] **Step 2: Run the model tests and confirm failure**

Run:

```bash
cd mobile
flutter test test/domain/models/background_backup_status_model_test.dart
```

Expected: FAIL because `background_backup_status.model.dart` does not exist.

- [ ] **Step 3: Add the model**

Create `mobile/lib/domain/models/background_backup_status.model.dart`:

```dart
enum BackgroundBackupSchedulerKind {
  iosRefresh,
  iosProcessing,
  androidBackground,
  foregroundResume,
  manual,
}

enum BackgroundBackupFailureReason {
  none,
  backupDisabled,
  noCurrentUser,
  photosPermissionDenied,
  backgroundRefreshUnavailable,
  remoteSyncFailed,
  noNetwork,
  uploadFailed,
  osPrevented,
  unknown,
}

enum BackgroundBackupHealth {
  neverRun,
  healthy,
  pending,
  warning,
  stale,
  blocked,
}

class BackgroundBackupStatus {
  static const warningThreshold = Duration(hours: 48);
  static const staleThreshold = Duration(days: 7);
  static const pendingThreshold = Duration(hours: 1);
  static const reminderRateLimit = Duration(hours: 24);

  const BackgroundBackupStatus({
    this.lastBackgroundWakeAt,
    this.lastLocalPhotoScanAt,
    this.lastUploadEnqueueAt,
    this.lastUploadSuccessAt,
    this.lastReminderAt,
    this.lastBackgroundFailureReason = BackgroundBackupFailureReason.none,
    this.lastCandidateCount = 0,
    this.lastSuccessfulSchedulerKind,
  });

  final DateTime? lastBackgroundWakeAt;
  final DateTime? lastLocalPhotoScanAt;
  final DateTime? lastUploadEnqueueAt;
  final DateTime? lastUploadSuccessAt;
  final DateTime? lastReminderAt;
  final BackgroundBackupFailureReason lastBackgroundFailureReason;
  final int lastCandidateCount;
  final BackgroundBackupSchedulerKind? lastSuccessfulSchedulerKind;

  BackgroundBackupStatus copyWith({
    DateTime? lastBackgroundWakeAt,
    DateTime? lastLocalPhotoScanAt,
    DateTime? lastUploadEnqueueAt,
    DateTime? lastUploadSuccessAt,
    DateTime? lastReminderAt,
    BackgroundBackupFailureReason? lastBackgroundFailureReason,
    int? lastCandidateCount,
    BackgroundBackupSchedulerKind? lastSuccessfulSchedulerKind,
  }) {
    return BackgroundBackupStatus(
      lastBackgroundWakeAt: lastBackgroundWakeAt ?? this.lastBackgroundWakeAt,
      lastLocalPhotoScanAt: lastLocalPhotoScanAt ?? this.lastLocalPhotoScanAt,
      lastUploadEnqueueAt: lastUploadEnqueueAt ?? this.lastUploadEnqueueAt,
      lastUploadSuccessAt: lastUploadSuccessAt ?? this.lastUploadSuccessAt,
      lastReminderAt: lastReminderAt ?? this.lastReminderAt,
      lastBackgroundFailureReason: lastBackgroundFailureReason ?? this.lastBackgroundFailureReason,
      lastCandidateCount: lastCandidateCount ?? this.lastCandidateCount,
      lastSuccessfulSchedulerKind: lastSuccessfulSchedulerKind ?? this.lastSuccessfulSchedulerKind,
    );
  }

  BackgroundBackupHealth deriveHealth({required DateTime now}) {
    final lastActivityAt = _latestDate([lastUploadSuccessAt, lastUploadEnqueueAt, lastBackgroundWakeAt]);
    if (lastActivityAt == null) {
      return BackgroundBackupHealth.neverRun;
    }

    if (lastCandidateCount > 0 && lastUploadEnqueueAt != null && now.difference(lastUploadEnqueueAt!) <= pendingThreshold) {
      return BackgroundBackupHealth.pending;
    }

    final age = now.difference(lastActivityAt);
    if (age >= staleThreshold) {
      if (lastBackgroundFailureReason == BackgroundBackupFailureReason.osPrevented) {
        return BackgroundBackupHealth.blocked;
      }
      return BackgroundBackupHealth.stale;
    }
    if (age >= warningThreshold) {
      return BackgroundBackupHealth.warning;
    }
    return BackgroundBackupHealth.healthy;
  }

  bool shouldShowReminder({required DateTime now}) {
    if (lastReminderAt == null) {
      return true;
    }
    return now.difference(lastReminderAt!) >= reminderRateLimit;
  }

  Map<String, dynamic> toJson() {
    return {
      'lastBackgroundWakeAt': lastBackgroundWakeAt?.toIso8601String(),
      'lastLocalPhotoScanAt': lastLocalPhotoScanAt?.toIso8601String(),
      'lastUploadEnqueueAt': lastUploadEnqueueAt?.toIso8601String(),
      'lastUploadSuccessAt': lastUploadSuccessAt?.toIso8601String(),
      'lastReminderAt': lastReminderAt?.toIso8601String(),
      'lastBackgroundFailureReason': lastBackgroundFailureReason.name,
      'lastCandidateCount': lastCandidateCount,
      'lastSuccessfulSchedulerKind': lastSuccessfulSchedulerKind?.name,
    };
  }

  factory BackgroundBackupStatus.fromJson(Map<String, dynamic> json) {
    return BackgroundBackupStatus(
      lastBackgroundWakeAt: _date(json['lastBackgroundWakeAt']),
      lastLocalPhotoScanAt: _date(json['lastLocalPhotoScanAt']),
      lastUploadEnqueueAt: _date(json['lastUploadEnqueueAt']),
      lastUploadSuccessAt: _date(json['lastUploadSuccessAt']),
      lastReminderAt: _date(json['lastReminderAt']),
      lastBackgroundFailureReason: BackgroundBackupFailureReason.values.byName(
        json['lastBackgroundFailureReason'] as String? ?? BackgroundBackupFailureReason.none.name,
      ),
      lastCandidateCount: json['lastCandidateCount'] as int? ?? 0,
      lastSuccessfulSchedulerKind: _schedulerKind(json['lastSuccessfulSchedulerKind']),
    );
  }

  static DateTime? _date(Object? value) {
    if (value is! String || value.isEmpty) {
      return null;
    }
    return DateTime.parse(value);
  }

  static BackgroundBackupSchedulerKind? _schedulerKind(Object? value) {
    if (value is! String || value.isEmpty) {
      return null;
    }
    return BackgroundBackupSchedulerKind.values.byName(value);
  }

  static DateTime? _latestDate(List<DateTime?> values) {
    DateTime? latest;
    for (final value in values) {
      if (value == null) {
        continue;
      }
      if (latest == null || value.isAfter(latest)) {
        latest = value;
      }
    }
    return latest;
  }

  @override
  bool operator ==(Object other) {
    return other is BackgroundBackupStatus &&
        other.lastBackgroundWakeAt == lastBackgroundWakeAt &&
        other.lastLocalPhotoScanAt == lastLocalPhotoScanAt &&
        other.lastUploadEnqueueAt == lastUploadEnqueueAt &&
        other.lastUploadSuccessAt == lastUploadSuccessAt &&
        other.lastReminderAt == lastReminderAt &&
        other.lastBackgroundFailureReason == lastBackgroundFailureReason &&
        other.lastCandidateCount == lastCandidateCount &&
        other.lastSuccessfulSchedulerKind == lastSuccessfulSchedulerKind;
  }

  @override
  int get hashCode => Object.hash(
    lastBackgroundWakeAt,
    lastLocalPhotoScanAt,
    lastUploadEnqueueAt,
    lastUploadSuccessAt,
    lastReminderAt,
    lastBackgroundFailureReason,
    lastCandidateCount,
    lastSuccessfulSchedulerKind,
  );
}
```

> **Health semantics note (intentional):** `deriveHealth` treats a recent background _wake_ as activity, so a device the OS keeps waking reads `healthy` even if uploads are failing, until the wake itself ages past the warning/stale thresholds. This matches the design ("Healthy: recent wake or upload success") and is deliberately conservative — it avoids nagging users whose backup is merely momentarily failing. The cost is that a _persistently_ failing-but-waking device is not flagged until the failure also stops the wakes or the thresholds elapse. If a future slice needs to flag "waking but never succeeding," add a derived `degraded` state keyed on `lastUploadEnqueueAt` without a following `lastUploadSuccessAt` beyond a threshold; it is out of scope here.

- [ ] **Step 4: Add the Store key**

In `mobile/lib/domain/models/store.model.dart`, replace:

```dart
  syncMigrationStatus<String>._(1013);
```

with:

```dart
  syncMigrationStatus<String>._(1013),
  backgroundBackupStatus<String>._(1014);
```

- [ ] **Step 5: Run the model tests**

Run:

```bash
cd mobile
dart format lib/domain/models/background_backup_status.model.dart test/domain/models/background_backup_status_model_test.dart lib/domain/models/store.model.dart
flutter test test/domain/models/background_backup_status_model_test.dart
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add mobile/lib/domain/models/background_backup_status.model.dart mobile/lib/domain/models/store.model.dart mobile/test/domain/models/background_backup_status_model_test.dart
git commit -m "feat(mobile): add background backup status model"
```

---

### Task 6: Add Store-Backed Background Backup Status Service

**Files:**

- Create: `mobile/lib/services/background_backup_status.service.dart`
- Create: `mobile/test/services/background_backup_status.service_test.dart`
- Modify: `mobile/test/domain/service.mock.dart`

- [ ] **Step 1: Write failing service tests**

Create `mobile/test/services/background_backup_status.service_test.dart`:

```dart
import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/background_backup_status.model.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/services/background_backup_status.service.dart';

void main() {
  late Drift db;
  late DateTime now;
  late BackgroundBackupStatusService sut;

  setUp(() async {
    db = Drift(DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: DriftStoreRepository(db));
    now = DateTime.utc(2026, 5, 29, 12);
    sut = BackgroundBackupStatusService(store: Store, now: () => now);
  });

  tearDown(() async {
    await Store.dispose();
    await db.close();
  });

  test('recordWake stores wake time and scheduler kind', () async {
    await sut.recordWake(BackgroundBackupSchedulerKind.iosProcessing);

    final status = await sut.read();
    expect(status.lastBackgroundWakeAt, now);
    expect(status.lastSuccessfulSchedulerKind, BackgroundBackupSchedulerKind.iosProcessing);
    expect(Store.tryGet(StoreKey.backgroundBackupStatus), isNotNull);
  });

  test('recordCandidateCount stores scan time and count', () async {
    await sut.recordCandidateCount(7);

    final status = await sut.read();
    expect(status.lastLocalPhotoScanAt, now);
    expect(status.lastCandidateCount, 7);
  });

  test('recordUploadEnqueue and recordUploadSuccess clear failure reason', () async {
    await sut.recordFailure(BackgroundBackupFailureReason.remoteSyncFailed);
    await sut.recordUploadEnqueue(candidateCount: 2);
    await sut.recordUploadSuccess();

    final status = await sut.read();
    expect(status.lastUploadEnqueueAt, now);
    expect(status.lastUploadSuccessAt, now);
    expect(status.lastCandidateCount, 0);
    expect(status.lastBackgroundFailureReason, BackgroundBackupFailureReason.none);
  });

  test('markReminderShown rate limits future reminders', () async {
    await sut.markReminderShown();

    expect((await sut.read()).lastReminderAt, now);
    expect((await sut.read()).shouldShowReminder(now: now), isFalse);
  });

  test('serializes concurrent record calls without clobbering fields', () async {
    await sut.recordUploadEnqueue(candidateCount: 5);

    // Fire success and an unrelated failure "at the same time" (no await between
    // them). With serialization the success timestamp must survive and the
    // candidate count reset must hold even though a failure is recorded after.
    await Future.wait([sut.recordUploadSuccess(), sut.recordFailure(BackgroundBackupFailureReason.uploadFailed)]);

    final status = await sut.read();
    expect(status.lastUploadSuccessAt, now, reason: 'success write must not be lost to an interleaved failure write');
    expect(status.lastCandidateCount, 0);
    // Last-writer-wins on the reason is acceptable; assert it is one of the two
    // legitimate terminal values, never a stale leftover from before.
    expect(
      status.lastBackgroundFailureReason,
      anyOf(BackgroundBackupFailureReason.none, BackgroundBackupFailureReason.uploadFailed),
    );
  });
}
```

- [ ] **Step 2: Run the service test and confirm failure**

Run:

```bash
cd mobile
flutter test test/services/background_backup_status.service_test.dart
```

Expected: FAIL because `background_backup_status.service.dart` does not exist.

- [ ] **Step 3: Implement the service**

Create `mobile/lib/services/background_backup_status.service.dart`:

```dart
import 'dart:convert';

import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/background_backup_status.model.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';

final backgroundBackupStatusServiceProvider = Provider<BackgroundBackupStatusService>(
  (_) => BackgroundBackupStatusService(store: Store),
);

class BackgroundBackupStatusService {
  BackgroundBackupStatusService({required this.store, DateTime Function()? now}) : _now = now ?? DateTime.now;

  final StoreService store;
  final DateTime Function() _now;

  // Background-downloader status callbacks (recordUploadSuccess / recordFailure)
  // fire once per completed task and each does a read-modify-write of one JSON
  // blob. Without serialization two callbacks can both read the old status and
  // the second write clobbers the first (e.g. a late recordFailure dropping a
  // just-written lastUploadSuccessAt). Chain every mutation through a single
  // tail future so reads always observe the previous write.
  Future<void> _writeTail = Future.value();

  // `read()` is intentionally NOT serialized — it is a pure load with no write.
  Future<BackgroundBackupStatus> read() async {
    final raw = store.tryGet(StoreKey.backgroundBackupStatus);
    if (raw == null || raw.isEmpty) {
      return const BackgroundBackupStatus();
    }
    return BackgroundBackupStatus.fromJson(jsonDecode(raw) as Map<String, dynamic>);
  }

  /// Serializes a read-modify-write so concurrent record* calls cannot clobber.
  Future<void> _mutate(BackgroundBackupStatus Function(BackgroundBackupStatus current) update) {
    final next = _writeTail.then((_) async {
      final current = await read();
      await store.put(StoreKey.backgroundBackupStatus, jsonEncode(update(current).toJson()));
    });
    // Keep the tail alive even if one mutation throws.
    _writeTail = next.catchError((_) {});
    return next;
  }

  Future<void> recordWake(BackgroundBackupSchedulerKind schedulerKind) {
    return _mutate(
      (current) => current.copyWith(
        lastBackgroundWakeAt: _now(),
        lastSuccessfulSchedulerKind: schedulerKind,
        lastBackgroundFailureReason: BackgroundBackupFailureReason.none,
      ),
    );
  }

  Future<void> recordCandidateCount(int count) {
    return _mutate((current) => current.copyWith(lastLocalPhotoScanAt: _now(), lastCandidateCount: count));
  }

  Future<void> recordUploadEnqueue({required int candidateCount}) {
    return _mutate(
      (current) => current.copyWith(
        lastUploadEnqueueAt: _now(),
        lastCandidateCount: candidateCount,
        lastBackgroundFailureReason: BackgroundBackupFailureReason.none,
      ),
    );
  }

  Future<void> recordUploadSuccess() {
    return _mutate(
      (current) => current.copyWith(
        lastUploadSuccessAt: _now(),
        lastCandidateCount: 0,
        lastBackgroundFailureReason: BackgroundBackupFailureReason.none,
      ),
    );
  }

  Future<void> recordFailure(BackgroundBackupFailureReason reason) {
    return _mutate((current) => current.copyWith(lastBackgroundFailureReason: reason));
  }

  Future<void> markReminderShown() {
    return _mutate((current) => current.copyWith(lastReminderAt: _now()));
  }
}
```

> Note: the `copyWith` in the model uses `??` fallbacks, so it can never _clear_ a field back to `null`. That is intentional here — every recorded field is monotonic (latest-wins timestamps, latest reason). `recordUploadSuccess` resets `lastCandidateCount` to `0` and the reason to `none` via explicit non-null values, which `copyWith` accepts.

- [ ] **Step 4: Add mock for future provider tests**

In `mobile/test/domain/service.mock.dart`, add imports:

```dart
import 'package:immich_mobile/services/background_backup_status.service.dart';
```

Add:

```dart
class MockBackgroundBackupStatusService extends Mock implements BackgroundBackupStatusService {}
```

- [ ] **Step 5: Run the service tests**

Run:

```bash
cd mobile
dart format lib/services/background_backup_status.service.dart test/services/background_backup_status.service_test.dart test/domain/service.mock.dart
flutter test test/services/background_backup_status.service_test.dart
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add mobile/lib/services/background_backup_status.service.dart mobile/test/services/background_backup_status.service_test.dart mobile/test/domain/service.mock.dart
git commit -m "feat(mobile): persist background backup health"
```

---

### Task 7: Record Background Backup Health from Worker and Upload Flow

**Files:**

- Create: `mobile/lib/domain/services/background_backup_event_recorder.dart`
- Create: `mobile/test/domain/services/background_backup_event_recorder_test.dart`
- Modify: `mobile/lib/domain/services/background_worker.service.dart`
- Modify: `mobile/lib/services/background_upload.service.dart`
- Modify: `mobile/test/services/background_upload.service_test.dart`

- [ ] **Step 1: Add failing worker event-recorder tests**

Create `mobile/test/domain/services/background_backup_event_recorder_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/background_backup_status.model.dart';
import 'package:immich_mobile/domain/services/background_backup_event_recorder.dart';
import 'package:immich_mobile/services/background_backup_status.service.dart';
import 'package:mocktail/mocktail.dart';

class MockBackgroundBackupStatusService extends Mock implements BackgroundBackupStatusService {}

void main() {
  late MockBackgroundBackupStatusService statusService;
  late BackgroundBackupEventRecorder sut;

  setUp(() {
    statusService = MockBackgroundBackupStatusService();
    sut = BackgroundBackupEventRecorder(statusService);
    when(() => statusService.recordWake(any())).thenAnswer((_) async {});
    when(() => statusService.recordFailure(any())).thenAnswer((_) async {});
  });

  test('records iOS refresh and processing wakes distinctly', () async {
    await sut.recordIosWake(isRefresh: true);
    await sut.recordIosWake(isRefresh: false);

    verify(() => statusService.recordWake(BackgroundBackupSchedulerKind.iosRefresh)).called(1);
    verify(() => statusService.recordWake(BackgroundBackupSchedulerKind.iosProcessing)).called(1);
  });

  test('records Android background wake', () async {
    await sut.recordAndroidWake();

    verify(() => statusService.recordWake(BackgroundBackupSchedulerKind.androidBackground)).called(1);
  });

  test('records backup-disabled and no-user skip reasons', () async {
    await sut.recordBackupPreflight(backupEnabled: false, hasCurrentUser: true);
    await sut.recordBackupPreflight(backupEnabled: true, hasCurrentUser: false);

    verify(() => statusService.recordFailure(BackgroundBackupFailureReason.backupDisabled)).called(1);
    verify(() => statusService.recordFailure(BackgroundBackupFailureReason.noCurrentUser)).called(1);
  });

  test('records remote sync failure but not success', () async {
    await sut.recordRemoteSyncResult(false);
    await sut.recordRemoteSyncResult(true);

    verify(() => statusService.recordFailure(BackgroundBackupFailureReason.remoteSyncFailed)).called(1);
  });
}
```

- [ ] **Step 2: Run the event-recorder tests and confirm failure**

Run:

```bash
cd mobile
flutter test test/domain/services/background_backup_event_recorder_test.dart
```

Expected: FAIL because `background_backup_event_recorder.dart` does not exist.

- [ ] **Step 3: Implement the event recorder**

Create `mobile/lib/domain/services/background_backup_event_recorder.dart`:

```dart
import 'package:immich_mobile/domain/models/background_backup_status.model.dart';
import 'package:immich_mobile/services/background_backup_status.service.dart';

class BackgroundBackupEventRecorder {
  const BackgroundBackupEventRecorder(this._statusService);

  final BackgroundBackupStatusService _statusService;

  Future<void> recordIosWake({required bool isRefresh}) {
    return _statusService.recordWake(
      isRefresh ? BackgroundBackupSchedulerKind.iosRefresh : BackgroundBackupSchedulerKind.iosProcessing,
    );
  }

  Future<void> recordAndroidWake() {
    return _statusService.recordWake(BackgroundBackupSchedulerKind.androidBackground);
  }

  Future<void> recordBackupPreflight({required bool backupEnabled, required bool hasCurrentUser}) {
    if (!backupEnabled) {
      return _statusService.recordFailure(BackgroundBackupFailureReason.backupDisabled);
    }
    if (!hasCurrentUser) {
      return _statusService.recordFailure(BackgroundBackupFailureReason.noCurrentUser);
    }
    return Future.value();
  }

  Future<void> recordRemoteSyncResult(bool success) {
    if (success) {
      return Future.value();
    }
    return _statusService.recordFailure(BackgroundBackupFailureReason.remoteSyncFailed);
  }
}
```

- [ ] **Step 4: Add failing upload status tests**

In `mobile/test/services/background_upload.service_test.dart`, import:

```dart
import 'package:immich_mobile/domain/models/background_backup_status.model.dart';
```

(`background_backup_status.service.dart` does not need importing here for the mock — see next note.)

Do **not** declare a local `MockBackgroundBackupStatusService` in this file. It already imports `../domain/service.mock.dart` (for `MockAppSettingsService`), and Task 6 adds `MockBackgroundBackupStatusService` there. Declaring a second one in this file is a duplicate definition and will not compile. Use the shared mock from `service.mock.dart`.

Add a field:

```dart
  late MockBackgroundBackupStatusService mockBackgroundBackupStatusService;
```

In `setUp()`, initialize and stub it:

```dart
    mockBackgroundBackupStatusService = MockBackgroundBackupStatusService();
    when(() => mockBackgroundBackupStatusService.recordCandidateCount(any())).thenAnswer((_) async {});
    when(() => mockBackgroundBackupStatusService.recordUploadEnqueue(candidateCount: any(named: 'candidateCount'))).thenAnswer((_) async {});
    when(() => mockBackgroundBackupStatusService.recordUploadSuccess()).thenAnswer((_) async {});
    when(() => mockBackgroundBackupStatusService.recordFailure(any())).thenAnswer((_) async {});
```

Pass it to `BackgroundUploadService` in `setUp()`:

```dart
      mockBackgroundBackupStatusService,
```

Append tests. Note the callback-capture pattern: `BackgroundUploadService` registers its status handler by **assigning** `_uploadRepository.onUploadStatus = _onUploadCallback` in its constructor (`background_upload.service.dart:109`), and `_onUploadCallback` calls the `_handleTaskStatusUpdate` we are editing. A `mocktail` mock does **not** echo a value written to a field, so `mockUploadRepository.onUploadStatus` reads back as `null` and `onUploadStatus!(...)` would throw a null-check error. Instead, capture the function the service assigned and invoke that. (The existing `setUp` also assigns a no-op to `onUploadStatus` _after_ construction, so capture `.first` — the constructor's real callback.)

```dart
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
      verifyNever(() => mockBackgroundBackupStatusService.recordUploadEnqueue(candidateCount: any(named: 'candidateCount')));
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
      verify(() => mockBackgroundBackupStatusService.recordFailure(BackgroundBackupFailureReason.uploadFailed)).called(1);
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
```

- [ ] **Step 5: Run the upload service tests and confirm failure**

Run:

```bash
cd mobile
flutter test test/services/background_upload.service_test.dart
```

Expected: FAIL because `BackgroundUploadService` does not accept or call `BackgroundBackupStatusService`.

- [ ] **Step 6: Inject status service into background upload service**

In `mobile/lib/services/background_upload.service.dart`, add imports:

```dart
import 'package:immich_mobile/domain/models/background_backup_status.model.dart';
import 'package:immich_mobile/services/background_backup_status.service.dart';
```

In `backgroundUploadServiceProvider`, add the dependency:

```dart
    ref.watch(backgroundBackupStatusServiceProvider),
```

Update constructor:

```dart
  BackgroundUploadService(
    this._uploadRepository,
    this._storageRepository,
    this._localAssetRepository,
    this._backupRepository,
    this._appSettingsService,
    this._assetMediaRepository,
    this._backgroundBackupStatusService,
  ) {
```

Add field:

```dart
  final BackgroundBackupStatusService _backgroundBackupStatusService;
```

Update all test-only constructor calls in `mobile/test/services/background_upload.service_test.dart` to pass `mockBackgroundBackupStatusService`.

- [ ] **Step 7: Record candidate and enqueue status**

In `uploadBackupCandidates`, after candidates are loaded:

```dart
    final candidates = await _backupRepository.getCandidates(userId);
    await _backgroundBackupStatusService.recordCandidateCount(candidates.length);
```

After successful enqueue call:

```dart
      await enqueueTasks(tasks);
      await _backgroundBackupStatusService.recordUploadEnqueue(candidateCount: tasks.length);
```

- [ ] **Step 8: Record success and failure from status updates**

Before `_handleTaskStatusUpdate`, add a local guard so Live Photo motion uploads do not falsely mark the logical asset as successfully backed up:

```dart
  bool _isLivePhotoMotionTask(Task task) {
    if (task.group != kBackupGroup || task.metaData.isEmpty) {
      return false;
    }

    try {
      return UploadTaskMetadata.fromJson(task.metaData).isLivePhotos;
    } catch (_) {
      return false;
    }
  }
```

In `_handleTaskStatusUpdate`, add cases:

```dart
      case TaskStatus.complete:
        if (!_isLivePhotoMotionTask(update.task)) {
          unawaited(_backgroundBackupStatusService.recordUploadSuccess());
        }
        unawaited(_handleLivePhoto(update));

        if (CurrentPlatform.isIOS) {
          try {
            final path = await update.task.filePath();
            await File(path).delete();
          } catch (e) {
            _logger.severe('Error deleting file path for iOS: $e');
          }
        }

        break;

      case TaskStatus.failed:
      case TaskStatus.notFound:
      case TaskStatus.canceled:
        unawaited(_backgroundBackupStatusService.recordFailure(BackgroundBackupFailureReason.uploadFailed));
        break;
```

- [ ] **Step 9: Record worker wake and early exits through the event recorder**

In `mobile/lib/domain/services/background_worker.service.dart`, import:

```dart
import 'package:immich_mobile/domain/services/background_backup_event_recorder.dart';
import 'package:immich_mobile/services/background_backup_status.service.dart';
```

Add a helper getter:

```dart
  BackgroundBackupEventRecorder? get _backupEventRecorder {
    final statusService = _ref?.read(backgroundBackupStatusServiceProvider);
    return statusService == null ? null : BackgroundBackupEventRecorder(statusService);
  }
```

In `onAndroidUpload`, before `_backgroundLoop`, add:

```dart
    await _backupEventRecorder?.recordAndroidWake();
```

In `onIosUpload`, before `_backgroundLoop`, add:

```dart
    await _backupEventRecorder?.recordIosWake(isRefresh: isRefresh);
```

Integrate the preflight recorder into `_handleBackup` **without dropping the existing `if (_isCleanedUp) return;` guard, the `runZonedGuarded` wrapper, or the `Platform.isIOS` dispatch**. The body lives inside the existing closure; only the enabled/user checks change. The closure becomes:

```dart
  Future<void> _handleBackup() async {
    await runZonedGuarded(
      () async {
        if (_isCleanedUp) {
          return;
        }

        final backupEnabled = _isBackupEnabled;
        final currentUser = _ref?.read(currentUserProvider);
        await _backupEventRecorder?.recordBackupPreflight(
          backupEnabled: backupEnabled,
          hasCurrentUser: currentUser != null,
        );

        if (!backupEnabled) {
          _logger.info("Backup is disabled. Skipping backup routine");
          return;
        }

        if (currentUser == null) {
          _logger.warning("No current user found. Skipping backup from background");
          return;
        }

        if (Platform.isIOS) {
          return _ref?.read(driftBackupProvider.notifier).startBackupWithURLSession(currentUser.id);
        }

        return _ref
            ?.read(foregroundUploadServiceProvider)
            .uploadCandidates(currentUser.id, _cancellationToken, useSequentialUpload: true);
      },
      (error, stack) {
        dPrint(() => "Error in backup zone $error, $stack");
      },
    );
  }
```

In `_syncAssets`, record remote-sync failure right after `isSuccess` is computed (`background_worker.service.dart:247`), before the `_isCleanedUp` early-return at line 248, so the reason is captured even when cleanup races in:

```dart
    final isSuccess = await _ref?.read(backgroundSyncProvider).syncRemote() ?? false;
    if (!isSuccess) {
      await _backupEventRecorder?.recordRemoteSyncResult(false);
    }
    if (_isCleanedUp) {
      return isSuccess;
    }
```

- [ ] **Step 10: Run focused tests**

Run:

```bash
cd mobile
dart format lib/domain/services/background_worker.service.dart lib/services/background_upload.service.dart test/services/background_upload.service_test.dart
dart format lib/domain/services/background_backup_event_recorder.dart test/domain/services/background_backup_event_recorder_test.dart
flutter test test/services/background_upload.service_test.dart
flutter test test/domain/services/background_backup_loop_test.dart
flutter test test/domain/services/background_backup_event_recorder_test.dart
```

Expected: PASS.

- [ ] **Step 11: Commit**

Run:

```bash
git add mobile/lib/domain/services/background_backup_event_recorder.dart mobile/test/domain/services/background_backup_event_recorder_test.dart mobile/lib/domain/services/background_worker.service.dart mobile/lib/services/background_upload.service.dart mobile/test/services/background_upload.service_test.dart
git commit -m "feat(mobile): record background backup health events"
```

---

### Task 8: Add Stale and Blocked Backup Banner

**Files:**

- Create: `mobile/lib/widgets/backup/background_backup_health_banner.dart`
- Create: `mobile/test/widgets/backup/background_backup_health_banner_test.dart`
- Modify: `mobile/lib/pages/backup/drift_backup.page.dart`
- Modify: `i18n/en.json`

- [ ] **Step 1: Write failing widget tests**

Create `mobile/test/widgets/backup/background_backup_health_banner_test.dart`:

```dart
import 'dart:convert';

import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/background_backup_status.model.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/widgets/backup/background_backup_health_banner.dart';

void main() {
  late Drift db;

  setUp(() async {
    db = Drift(DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: DriftStoreRepository(db));
  });

  tearDown(() async {
    await Store.dispose();
    await db.close();
  });

  testWidgets('hides the banner for healthy status', (tester) async {
    await Store.put(
      StoreKey.backgroundBackupStatus,
      jsonEncode(
        BackgroundBackupStatus(
          lastBackgroundWakeAt: DateTime.now().subtract(const Duration(hours: 1)),
        ).toJson(),
      ),
    );

    await tester.pumpWidget(const ProviderScope(child: MaterialApp(home: Scaffold(body: BackgroundBackupHealthBanner()))));

    expect(find.byType(BackgroundBackupHealthBanner), findsOneWidget);
    expect(find.textContaining('backup_background_'), findsNothing);
  });

  testWidgets('shows stale status', (tester) async {
    await Store.put(
      StoreKey.backgroundBackupStatus,
      jsonEncode(
        BackgroundBackupStatus(
          lastBackgroundWakeAt: DateTime.now().subtract(const Duration(days: 8)),
          lastUploadSuccessAt: DateTime.now().subtract(const Duration(days: 9)),
          lastCandidateCount: 4,
        ).toJson(),
      ),
    );

    await tester.pumpWidget(const ProviderScope(child: MaterialApp(home: Scaffold(body: BackgroundBackupHealthBanner()))));

    expect(find.text('backup_background_stale_title'), findsOneWidget);
    expect(find.text('backup_background_stale_body'), findsOneWidget);
  });

  testWidgets('shows blocked status when the OS prevented background execution', (tester) async {
    await Store.put(
      StoreKey.backgroundBackupStatus,
      jsonEncode(
        BackgroundBackupStatus(
          lastBackgroundWakeAt: DateTime.now().subtract(const Duration(days: 8)),
          lastBackgroundFailureReason: BackgroundBackupFailureReason.osPrevented,
        ).toJson(),
      ),
    );

    await tester.pumpWidget(const ProviderScope(child: MaterialApp(home: Scaffold(body: BackgroundBackupHealthBanner()))));

    expect(find.text('backup_background_blocked_title'), findsOneWidget);
    expect(find.text('backup_background_blocked_body'), findsOneWidget);
  });
}
```

- [ ] **Step 2: Run widget tests and confirm failure**

Run:

```bash
cd mobile
flutter test test/widgets/backup/background_backup_health_banner_test.dart
```

Expected: FAIL because `background_backup_health_banner.dart` does not exist.

- [ ] **Step 3: Add i18n strings**

Add these keys to `i18n/en.json` (repo root, NOT `mobile/`). The file is sorted alphabetically and `prettier-plugin-sort-json` is enforced, so insert each key in its correct alphabetical position among the existing flat `backup_*` keys (they begin around `backup_album_selection_page_*`). The `backup_background_reminder_*` keys are used by the Task 9 reminder notification; adding them here keeps the reminder localized and consistent with the banner.

```json
  "backup_background_blocked_body": "Open Gallery to resume backup. iOS and Android can stop scheduled work after force-quit or battery restrictions.",
  "backup_background_blocked_title": "Background backup needs attention",
  "backup_background_reminder_body": "Open Gallery to resume backup.",
  "backup_background_reminder_title": "Background backup has not run recently",
  "backup_background_stale_body": "Open Gallery to resume backup. iOS may stop background work after the app is force-quit.",
  "backup_background_stale_title": "Background backup has not run recently",
  "backup_background_warning_body": "Gallery has not checked for new photos in the background recently.",
  "backup_background_warning_title": "Background backup is delayed",
```

> Run `cd i18n && pnpm run format:fix` (or `make translation` below) to confirm the keys land in sorted order; an unsorted `en.json` fails CI.

- [ ] **Step 4: Create the banner widget**

Create `mobile/lib/widgets/backup/background_backup_health_banner.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/background_backup_status.model.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/extensions/translate_extensions.dart';
import 'package:immich_mobile/services/background_backup_status.service.dart';

class BackgroundBackupHealthBanner extends ConsumerWidget {
  const BackgroundBackupHealthBanner({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return FutureBuilder(
      future: ref.read(backgroundBackupStatusServiceProvider).read(),
      builder: (context, snapshot) {
        final status = snapshot.data;
        if (status == null) {
          return const SizedBox.shrink();
        }

        final health = status.deriveHealth(now: DateTime.now());
        if (health != BackgroundBackupHealth.warning &&
            health != BackgroundBackupHealth.stale &&
            health != BackgroundBackupHealth.blocked) {
          return const SizedBox.shrink();
        }

        final (title, body) = switch (health) {
          BackgroundBackupHealth.blocked => ('backup_background_blocked_title'.t(), 'backup_background_blocked_body'.t()),
          BackgroundBackupHealth.stale => ('backup_background_stale_title'.t(), 'backup_background_stale_body'.t()),
          _ => ('backup_background_warning_title'.t(), 'backup_background_warning_body'.t()),
        };

        return Padding(
          padding: const EdgeInsets.only(top: 12),
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: context.colorScheme.errorContainer,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(Icons.warning_rounded, color: context.colorScheme.onErrorContainer),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          title,
                          style: context.textTheme.bodyMedium?.copyWith(
                            color: context.colorScheme.onErrorContainer,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          body,
                          style: context.textTheme.bodySmall?.copyWith(color: context.colorScheme.onErrorContainer),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}
```

- [ ] **Step 5: Add banner to backup page**

In `mobile/lib/pages/backup/drift_backup.page.dart`, import:

```dart
import 'package:immich_mobile/widgets/backup/background_backup_health_banner.dart';
```

In the body where selected albums are shown, place the banner after `BackupToggleButton`:

```dart
                  const BackgroundBackupHealthBanner(),
```

- [ ] **Step 6: Regenerate mobile translation codegen (required for the real app)**

The mobile app loads translations through `CodegenLoader` (`mobile/lib/generated/codegen_loader.g.dart`), generated from root `i18n/en.json` — it does **not** read `en.json` at runtime. Without regeneration, `.t()` returns the raw key (the banner would display `backup_background_stale_title` literally). Regenerate:

```bash
cd mobile
make translation
```

This runs `pnpm --prefix ../i18n run format:fix` (sorts `en.json`) then `dart run easy_localization:generate -S ../i18n` (rewrites the codegen loader). Commit the regenerated `mobile/lib/generated/*.g.dart` alongside `en.json`.

> The widget test in Step 1 asserts on the raw key strings (e.g. `find.text('backup_background_stale_title')`) because EasyLocalization is uninitialized under `flutter_test`, so `.t()` returns the key. That means the test passes with or without regeneration — it verifies which message _slot_ shows, not the translated copy. Regeneration is still required for the shipped app, so do not skip this step.

- [ ] **Step 7: Run widget tests**

Run:

```bash
cd mobile
dart format lib/widgets/backup/background_backup_health_banner.dart test/widgets/backup/background_backup_health_banner_test.dart lib/pages/backup/drift_backup.page.dart
flutter test test/widgets/backup/background_backup_health_banner_test.dart
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add i18n/en.json mobile/lib/generated mobile/lib/widgets/backup/background_backup_health_banner.dart mobile/lib/pages/backup/drift_backup.page.dart mobile/test/widgets/backup/background_backup_health_banner_test.dart
git commit -m "feat(mobile): show stale background backup status"
```

---

### Task 9: Add Reminder Rate Limiting Without Server Changes

**Files:**

- Create: `mobile/lib/services/background_backup_reminder.service.dart`
- Create: `mobile/test/services/background_backup_reminder.service_test.dart`
- Modify: `mobile/lib/providers/app_life_cycle.provider.dart`

- [ ] **Step 1: Write failing reminder service tests**

Create `mobile/test/services/background_backup_reminder.service_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/background_backup_status.model.dart';
import 'package:immich_mobile/services/background_backup_reminder.service.dart';
import 'package:immich_mobile/services/background_backup_status.service.dart';
import 'package:mocktail/mocktail.dart';

class MockBackgroundBackupStatusService extends Mock implements BackgroundBackupStatusService {}

void main() {
  late MockBackgroundBackupStatusService statusService;
  late List<({int id, String title, String body})> notifications;
  late BackgroundBackupReminderService sut;

  setUp(() {
    statusService = MockBackgroundBackupStatusService();
    notifications = [];
    sut = BackgroundBackupReminderService(
      statusService: statusService,
      showNotification: ({required int id, required String title, required String body}) async {
        notifications.add((id: id, title: title, body: body));
      },
    );
    when(() => statusService.markReminderShown()).thenAnswer((_) async {});
    when(() => statusService.recordFailure(any())).thenAnswer((_) async {});
  });

  // `.t()` returns the raw key when EasyLocalization is uninitialized (see
  // _translateHelper's try/catch), so assert on keys, not translated copy.
  test('infers blocked, records osPrevented, and reminds for a stale status', () async {
    final status = BackgroundBackupStatus(lastBackgroundWakeAt: DateTime.now().subtract(const Duration(days: 8)));
    when(() => statusService.read()).thenAnswer((_) async => status);

    await sut.maybeShowReminder();

    expect(notifications.single.title, 'backup_background_reminder_title');
    expect(notifications.single.body, 'backup_background_reminder_body');
    verify(() => statusService.recordFailure(BackgroundBackupFailureReason.osPrevented)).called(1);
    verify(() => statusService.markReminderShown()).called(1);
  });

  test('reminds for an already-blocked status without re-inferring osPrevented', () async {
    final status = BackgroundBackupStatus(
      lastBackgroundWakeAt: DateTime.now().subtract(const Duration(days: 8)),
      lastBackgroundFailureReason: BackgroundBackupFailureReason.osPrevented,
    );
    when(() => statusService.read()).thenAnswer((_) async => status);

    await sut.maybeShowReminder();

    expect(notifications.single.title, 'backup_background_reminder_title');
    verifyNever(() => statusService.recordFailure(any()));
    verify(() => statusService.markReminderShown()).called(1);
  });

  test('does not show reminder for healthy status', () async {
    final status = BackgroundBackupStatus(lastBackgroundWakeAt: DateTime.now());
    when(() => statusService.read()).thenAnswer((_) async => status);

    await sut.maybeShowReminder();

    expect(notifications, isEmpty);
    verifyNever(() => statusService.recordFailure(any()));
    verifyNever(() => statusService.markReminderShown());
  });

  test('does not show reminder when rate limited', () async {
    final now = DateTime.now();
    final status = BackgroundBackupStatus(
      lastBackgroundWakeAt: now.subtract(const Duration(days: 8)),
      lastReminderAt: now.subtract(const Duration(hours: 2)),
    );
    when(() => statusService.read()).thenAnswer((_) async => status);

    await sut.maybeShowReminder(now: now);

    expect(notifications, isEmpty);
    verifyNever(() => statusService.markReminderShown());
  });
}
```

- [ ] **Step 2: Run reminder tests and confirm failure**

Run:

```bash
cd mobile
flutter test test/services/background_backup_reminder.service_test.dart
```

Expected: FAIL because `background_backup_reminder.service.dart` does not exist.

- [ ] **Step 3: Implement the reminder service with a notification seam**

Create `mobile/lib/services/background_backup_reminder.service.dart`:

```dart
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/background_backup_status.model.dart';
import 'package:immich_mobile/extensions/translate_extensions.dart';
import 'package:immich_mobile/services/background_backup_status.service.dart';

typedef BackgroundBackupNotificationSender = Future<void> Function({
  required int id,
  required String title,
  required String body,
});

final backgroundBackupReminderServiceProvider = Provider<BackgroundBackupReminderService>((ref) {
  final plugin = FlutterLocalNotificationsPlugin();
  var notificationsInitialized = false;

  Future<void> ensureNotificationsInitialized() async {
    if (notificationsInitialized) {
      return;
    }

    final initialized = await plugin.initialize(
      const InitializationSettings(
        android: AndroidInitializationSettings('@mipmap/ic_launcher'),
        iOS: DarwinInitializationSettings(),
      ),
    );
    notificationsInitialized = initialized ?? true;
  }

  return BackgroundBackupReminderService(
    statusService: ref.watch(backgroundBackupStatusServiceProvider),
    showNotification: ({required int id, required String title, required String body}) async {
      await ensureNotificationsInitialized();
      if (!notificationsInitialized) {
        return;
      }
      return plugin.show(
        id,
        title,
        body,
        const NotificationDetails(
          android: AndroidNotificationDetails(
            'background_backup_health',
            'Background backup health',
            channelDescription: 'Warnings when mobile background backup has not run recently',
            importance: Importance.defaultImportance,
            priority: Priority.defaultPriority,
          ),
          iOS: DarwinNotificationDetails(),
        ),
      );
    },
  );
});

class BackgroundBackupReminderService {
  static const notificationId = 240529;

  const BackgroundBackupReminderService({required this.statusService, required this.showNotification});

  final BackgroundBackupStatusService statusService;
  final BackgroundBackupNotificationSender showNotification;

  Future<void> maybeShowReminder({DateTime? now}) async {
    final currentTime = now ?? DateTime.now();
    final status = await statusService.read();
    var health = status.deriveHealth(now: currentTime);

    // Infer OS-prevented background execution. If backup went stale (no
    // background wake/upload within the stale threshold) and there is no more
    // specific recorded cause, conclude the OS stopped running us in the
    // background and only the foreground open recovered. This is the ONE place
    // `blocked` becomes reachable in production. It self-clears: once a backup
    // pass refreshes the activity timestamps below the stale threshold, derive
    // returns healthy/pending again regardless of the stored reason.
    if (health == BackgroundBackupHealth.stale &&
        status.lastBackgroundFailureReason == BackgroundBackupFailureReason.none) {
      await statusService.recordFailure(BackgroundBackupFailureReason.osPrevented);
      health = BackgroundBackupHealth.blocked;
    }

    if ((health != BackgroundBackupHealth.stale && health != BackgroundBackupHealth.blocked) ||
        !status.shouldShowReminder(now: currentTime)) {
      return;
    }

    await showNotification(
      id: notificationId,
      title: 'backup_background_reminder_title'.t(),
      body: 'backup_background_reminder_body'.t(),
    );
    await statusService.markReminderShown();
  }
}
```

- [ ] **Step 4: Trigger reminder check on resume**

In `mobile/lib/providers/app_life_cycle.provider.dart`, import:

```dart
import 'package:immich_mobile/services/background_backup_reminder.service.dart';
```

In `_resumeBackup()`, check the reminder **before** `startBackup`, and `await` it. Ordering matters: `startBackup` (via `uploadBackupCandidates`) records `lastUploadEnqueueAt`, which makes `deriveHealth` return `pending`/`healthy`; if the reminder ran after, it could never observe the stale/blocked state that the foreground open just recovered from. Awaiting (rather than `unawaited`) also keeps the reminder's status read ahead of `startBackup`'s writes. The block becomes:

```dart
      if (currentUser != null) {
        await _safeRun(
          _ref.read(backgroundBackupReminderServiceProvider).maybeShowReminder(),
          "backgroundBackupReminder",
        );
        await _safeRun(_ref.read(driftBackupProvider.notifier).startBackup(currentUser.id), "handleBackupResume");
      }
```

`_safeRun` already swallows/logs errors, so a notification-permission failure cannot block the resume backup.

- [ ] **Step 5: Run reminder tests**

Run:

```bash
cd mobile
dart format lib/services/background_backup_reminder.service.dart test/services/background_backup_reminder.service_test.dart lib/providers/app_life_cycle.provider.dart
flutter test test/services/background_backup_reminder.service_test.dart
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add mobile/lib/services/background_backup_reminder.service.dart mobile/lib/providers/app_life_cycle.provider.dart mobile/test/services/background_backup_reminder.service_test.dart
git commit -m "feat(mobile): remind when background backup is stale"
```

#### Failure-reason detection scope (read before implementing)

`BackgroundBackupFailureReason` defines more reasons than this slice actively detects. Be honest about which are wired so the health states are not dead code:

| Reason                            | Recorded by                            | Health effect                                    |
| --------------------------------- | -------------------------------------- | ------------------------------------------------ |
| `backupDisabled`, `noCurrentUser` | worker preflight (Task 7)              | informational; recent wake still derives healthy |
| `remoteSyncFailed`                | `_syncAssets` on sync failure (Task 7) | keeps state non-healthy; ages into `stale`       |
| `uploadFailed`                    | upload status callback (Task 7)        | keeps state non-healthy; ages into `stale`       |
| `osPrevented`                     | foreground-resume inference (Task 9)   | **the path that makes `blocked` reachable**      |
| `none`                            | cleared on wake/enqueue/success        | —                                                |

**Explicitly out of scope for this slice (modeled, not detected):** `photosPermissionDenied`, `backgroundRefreshUnavailable`, `noNetwork`. They require seams this plan does not build:

- `photosPermissionDenied` — would need a permission read in the worker preflight (no verified seam wired here).
- `backgroundRefreshUnavailable` — iOS-only; needs a native `UIApplication.backgroundRefreshStatus` getter over a method channel.
- `noNetwork` — needs connectivity classification of a sync/upload failure rather than the generic `remoteSyncFailed`/`uploadFailed`.

These reasons stay in the model (with serialization + derivation coverage in Task 11) so a later slice can wire detection without a migration. Critically, **omitting their detection is not a false-healthy bug**: the underlying failures still surface — they prevent upload success, so the activity timestamps age out and `deriveHealth` returns `stale` (then `blocked` via the resume inference). Task 11's `keeps recoverable no-network state stale instead of falsely healthy` test pins this guarantee. Do not claim these reasons are surfaced with specific messaging; they are not in this slice.

---

### Task 10: Preserve Existing iOS URLSession and Notification Regressions

**Files:**

- Modify: `mobile/test/repositories/upload_repository_test.dart`
- Modify: `mobile/test/utils/background_downloader_recovery_test.dart`
- Modify: `mobile/test/services/background_upload.service_test.dart`

- [ ] **Step 1: Extend downloader recovery edge coverage**

Append to `mobile/test/utils/background_downloader_recovery_test.dart`:

```dart
  test('logs warning when recovery throws', () async {
    final warnings = <String>[];

    await recoverBackgroundDownloaderTasks(
      delay: Duration.zero,
      resumeFromBackground: () async {
        throw StateError('resume failed');
      },
      rescheduleKilledTasks: () async {
        return (<Task>[], <Task>[]);
      },
      logWarning: (message, error, stackTrace) {
        warnings.add('$message:$error');
      },
    );

    expect(warnings.single, contains('Failed to recover background downloader tasks'));
    expect(warnings.single, contains('resume failed'));
  });
```

- [ ] **Step 2: Extend notification edge coverage**

Append to `mobile/test/repositories/upload_repository_test.dart`:

```dart
    test('updateNotification consumes synchronous native failures', () async {
      final repository = UploadRepository.forTesting(
        backgroundDownloaderMethodInvoker: (_, _) {
          throw StateError('channel unavailable');
        },
      );
      final task = UploadTask(
        taskId: 'asset-sync-fail',
        url: 'http://test-server.com/assets',
        filename: 'asset.jpg',
        baseDirectory: BaseDirectory.temporary,
        group: kBackupGroup,
      );

      await repository.updateNotification(task, TaskStatus.enqueued);
    });
```

- [ ] **Step 3: Run regression tests before production edits**

Run:

```bash
cd mobile
flutter test test/repositories/upload_repository_test.dart test/utils/background_downloader_recovery_test.dart test/services/background_upload.service_test.dart
```

Expected:

- Existing behavior should already pass or fail only because constructor signatures changed in earlier tasks.
- If constructor failures occur, update tests to pass `MockBackgroundBackupStatusService` as described in Task 7.

- [ ] **Step 4: Keep production code unchanged unless a regression test fails**

If tests fail for notification/recovery behavior, fix only the failing behavior in:

- `mobile/lib/repositories/upload.repository.dart`
- `mobile/lib/utils/background_downloader_recovery.dart`
- `mobile/lib/services/background_upload.service.dart`

Do not remove:

```dart
await _uploadRepository.disableHoldingQueue();
```

Do not remove:

```dart
scheduleBackgroundDownloaderRecovery();
```

Do not await the `updateNotification` platform-channel response in the iOS enqueue path.

- [ ] **Step 5: Run regression tests**

Run:

```bash
cd mobile
dart format test/repositories/upload_repository_test.dart test/utils/background_downloader_recovery_test.dart
flutter test test/repositories/upload_repository_test.dart test/utils/background_downloader_recovery_test.dart test/services/background_upload.service_test.dart
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add mobile/test/repositories/upload_repository_test.dart mobile/test/utils/background_downloader_recovery_test.dart mobile/test/services/background_upload.service_test.dart mobile/lib/repositories/upload.repository.dart mobile/lib/utils/background_downloader_recovery.dart mobile/lib/services/background_upload.service.dart
git commit -m "test(mobile): cover background downloader recovery edges"
```

---

### Task 11: Add Required Edge-Case Coverage

**Files:**

- Create: `mobile/test/platform/background_worker_native_files_test.dart`
- Modify: `mobile/test/domain/models/background_backup_status_model_test.dart`
- Modify: `mobile/test/services/background_backup_status.service_test.dart`
- Modify: `mobile/test/services/background_upload.service_test.dart`

- [ ] **Step 1: Add native boundary regression tests**

Create `mobile/test/platform/background_worker_native_files_test.dart`:

```dart
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
```

- [ ] **Step 2: Run native boundary tests**

Run:

```bash
cd mobile
flutter test test/platform/background_worker_native_files_test.dart
```

Expected: PASS. These are characterization tests for existing native behavior; if one fails, fix only the affected mobile native file and keep the fix mobile-only.

- [ ] **Step 3: Add explicit failure-reason persistence coverage**

Append to `mobile/test/services/background_backup_status.service_test.dart`:

```dart
  test('recordFailure persists explicit edge-case reasons', () async {
    for (final reason in [
      BackgroundBackupFailureReason.photosPermissionDenied,
      BackgroundBackupFailureReason.backgroundRefreshUnavailable,
      BackgroundBackupFailureReason.noNetwork,
      BackgroundBackupFailureReason.osPrevented,
    ]) {
      await sut.recordFailure(reason);

      expect((await sut.read()).lastBackgroundFailureReason, reason);
    }
  });
```

Append to `mobile/test/domain/models/background_backup_status_model_test.dart`:

```dart
  test('serializes failure reasons used for required edge cases', () {
    for (final reason in [
      BackgroundBackupFailureReason.photosPermissionDenied,
      BackgroundBackupFailureReason.backgroundRefreshUnavailable,
      BackgroundBackupFailureReason.noNetwork,
      BackgroundBackupFailureReason.osPrevented,
    ]) {
      final status = BackgroundBackupStatus(lastBackgroundFailureReason: reason);
      final decoded = BackgroundBackupStatus.fromJson(status.toJson());

      expect(decoded.lastBackgroundFailureReason, reason);
    }
  });

  test('keeps recoverable no-network state stale instead of falsely healthy', () {
    final now = DateTime.utc(2026, 5, 29, 12);
    final status = BackgroundBackupStatus(
      lastBackgroundWakeAt: now.subtract(const Duration(days: 8)),
      lastBackgroundFailureReason: BackgroundBackupFailureReason.noNetwork,
    );

    expect(status.deriveHealth(now: now), BackgroundBackupHealth.stale);
  });
```

- [ ] **Step 4: Run failure-reason tests**

Run:

```bash
cd mobile
flutter test test/domain/models/background_backup_status_model_test.dart test/services/background_backup_status.service_test.dart
```

Expected: PASS. If this fails, fix only `BackgroundBackupStatus` serialization or `BackgroundBackupStatusService.recordFailure`.

- [ ] **Step 5: Add Wi-Fi/cellular restriction tests**

Append to `mobile/test/services/background_upload.service_test.dart`:

```dart
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
      when(() => mockAppSettingsService.getSetting(AppSettingsEnum.useCellularForUploadPhotos)).thenReturn(false);

      final task = await buildTaskFor(LocalAssetStub.image1);

      expect(task.requiresWiFi, isTrue);
    });

    test('sets requiresWiFi false for photos when cellular photo upload is enabled', () async {
      when(() => mockAppSettingsService.getSetting(AppSettingsEnum.useCellularForUploadPhotos)).thenReturn(true);

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
      when(() => mockAppSettingsService.getSetting(AppSettingsEnum.useCellularForUploadVideos)).thenReturn(false);

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
      when(() => mockAppSettingsService.getSetting(AppSettingsEnum.useCellularForUploadVideos)).thenReturn(true);

      final task = await buildTaskFor(video);

      expect(task.requiresWiFi, isFalse);
    });
  });
```

- [ ] **Step 6: Run required edge-case tests**

Run:

```bash
cd mobile
dart format test/platform/background_worker_native_files_test.dart test/domain/models/background_backup_status_model_test.dart test/services/background_backup_status.service_test.dart test/services/background_upload.service_test.dart
flutter test test/platform/background_worker_native_files_test.dart test/domain/models/background_backup_status_model_test.dart test/services/background_backup_status.service_test.dart test/services/background_upload.service_test.dart
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add mobile/test/platform/background_worker_native_files_test.dart mobile/test/domain/models/background_backup_status_model_test.dart mobile/test/services/background_backup_status.service_test.dart mobile/test/services/background_upload.service_test.dart
git commit -m "test(mobile): cover background backup edge cases"
```

---

### Task 12: Focused and Wide Verification

**Files:**

- Read: all changed files
- Modify only if a verification failure exposes a bug covered by the existing tests

- [ ] **Step 1: Run focused mobile tests**

Run:

```bash
cd mobile
flutter test \
  test/domain/services/background_backup_loop_test.dart \
  test/domain/services/background_backup_event_recorder_test.dart \
  test/domain/models/background_backup_status_model_test.dart \
  test/services/background_backup_status.service_test.dart \
  test/services/background_backup_reminder.service_test.dart \
  test/providers/backup/drift_backup_provider_test.dart \
  test/services/background_upload.service_test.dart \
  test/repositories/upload_repository_test.dart \
  test/platform/background_worker_native_files_test.dart \
  test/utils/background_downloader_recovery_test.dart \
  test/widgets/backup/background_backup_health_banner_test.dart
```

Expected: PASS.

- [ ] **Step 2: Run analyzer on touched mobile files**

Run:

```bash
cd mobile
dart analyze \
  lib/domain/services/background_backup_loop.dart \
  lib/domain/services/background_backup_event_recorder.dart \
  lib/domain/services/background_worker.service.dart \
  lib/domain/models/background_backup_status.model.dart \
  lib/services/background_backup_status.service.dart \
  lib/services/background_backup_reminder.service.dart \
  lib/services/background_upload.service.dart \
  lib/providers/backup/drift_backup.provider.dart \
  lib/widgets/backup/background_backup_health_banner.dart
```

Expected: no issues.

- [ ] **Step 3: Verify generated Pigeon files are clean**

Run:

```bash
cd mobile
mise run pigeon:background-worker
cd ..
git diff --exit-code -- mobile/lib/platform/background_worker_api.g.dart mobile/ios/Runner/Background/BackgroundWorker.g.swift mobile/android/app/src/main/kotlin/app/alextran/immich/background/BackgroundWorker.g.kt
```

Expected: no diff after regeneration.

- [ ] **Step 4: Verify no server/API/database scope leaked in**

Run:

```bash
git diff --name-only origin/main...HEAD | rg -n '^(server|open-api|e2e|machine-learning|docker|web|cli)/' || true
```

Expected: no output caused by this implementation. If older PR changes touch non-mobile files, confirm they predate this plan and are already intentional for the branch.

- [ ] **Step 5: Run the broader mobile test suite**

Run:

```bash
cd mobile
flutter test
```

Expected: PASS. If unrelated tests fail, capture failing test names and logs before changing code.

- [ ] **Step 6: Commit verification-only fixes if needed**

If verification required fixes, commit them:

```bash
git add mobile
git commit -m "fix(mobile): resolve background backup verification failures"
```

If no fixes were needed, do not create a commit.

---

### Task 13: Manual Device Checks

**Files:**

- Modify only if manual checks expose a bug already covered by an added failing test

- [ ] **Step 1: Build/install iOS debug build using saved local procedure**

Use the saved memory file for the local debug build procedure:

```bash
cat /Users/pierre/dev/claude-skills/memory/Users-pierre-dev-gallery-.worktrees-fix-mobile-search-backup-rerun/ios-debug-build.md
```

Expected: the file contains the branch-specific iOS debug build/install process.

- [ ] **Step 2: Verify normal iOS background upload**

Manual steps:

1. Install the debug app on a physical iPhone.
2. Enable backup.
3. Select an album that receives new camera photos.
4. Take a new photo and a new Live Photo.
5. Open Gallery long enough for backup settings and auth to initialize.
6. Background the app without force-quitting.
7. Watch device logs for:

```text
iOS background upload started
Start background backup sequence
Found <n> backup candidates for background tasks
Enqueuing <n> background upload tasks
```

Expected:

- Uploads continue where iOS allows.
- Reopening the app does not reset the upload detail page into a misleading empty state.
- Live Photo still and motion components finish as one logical asset.

- [ ] **Step 3: Verify iOS force-quit fallback**

Manual steps:

1. Enable backup.
2. Take a new photo.
3. Force-quit the app from the app switcher.
4. Do not expect silent upload.
5. Reopen the app after a test-shortened stale threshold or by seeding `StoreKey.backgroundBackupStatus` in a debug build.

Expected:

- The app does not claim force-quit background upload is guaranteed.
- The stale backup banner/reminder appears when the status is stale.

- [ ] **Step 4: Verify Android background trigger**

Manual steps:

1. Install debug Android app or use emulator with media insertion.
2. Enable backup.
3. Add/take a new media item in a selected album.
4. Background the app.
5. Watch logs for:

```text
MediaObserver
PeriodicWorker
Starting background upload worker
Android background upload started
```

Expected:

- MediaStore trigger enqueues background worker.
- Periodic worker remains scheduled.
- Runtime is bounded by the `maxMinutesArg = 20` path.

- [ ] **Step 5: Capture manual results in the PR body**

Update the PR body with:

- Upstream mobile-only commits evaluated.
- Commits/changes actually ported.
- Focused tests run.
- Wide tests run.
- iOS manual result.
- Android manual result.
- Explicit iOS force-quit limitation.

Command:

```bash
gh pr edit 627 --body-file /tmp/pr-627-body.md
```

Expected: PR body reflects the final implementation and verification.
