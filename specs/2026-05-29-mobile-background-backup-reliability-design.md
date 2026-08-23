# Mobile Background Backup Reliability Design

## Purpose

Mobile backup already exists and is documented as running when the app opens or resumes, and periodically in the background. This work is not a new backup system. It is a TDD effort to make the existing Immich-style background backup pipeline reliable, observable, and honest about OS limits.

The desired behavior is:

- When backup is enabled, new photos and videos from selected albums should be discovered and uploaded without requiring the backup details page to remain open.
- Background execution should use the existing native schedulers and durable upload mechanisms.
- Upstream mobile-only fixes should be selectively pulled in before inventing fork-specific fixes.
- When the OS prevents background execution, especially iOS user force-quit, the app should detect stale backup state and prompt the user to reopen the app instead of silently appearing healthy.

## Current Context

The current branch already contains these primitives:

- iOS schedules `BGAppRefreshTask` and `BGProcessingTask` in `mobile/ios/Runner/Background/BackgroundWorkerApiImpl.swift`.
- Android schedules MediaStore-triggered work and periodic WorkManager work in `mobile/android/app/src/main/kotlin/app/alextran/immich/background/BackgroundWorkerApiImpl.kt`.
- The background Flutter isolate initializes domain state and calls local sync, remote sync, hashing, and backup in `mobile/lib/domain/services/background_worker.service.dart`.
- iOS backup enqueue uses `background_downloader`/URLSession-style file-backed upload tasks through `mobile/lib/services/background_upload.service.dart`.
- Backup candidates are selected from Drift local assets in `mobile/lib/infrastructure/repositories/backup.repository.dart`.
- The PR branch also contains iOS-specific fixes for branded BGTask identifiers, background downloader recovery, notification posting, and progress state from background downloader updates.

The documentation already promises periodic background backup in `docs/docs/features/mobile-backup.md`. The implementation should therefore be debugged and hardened against that promise, not replaced.

## Platform Constraints

### iOS

iOS can launch apps for scheduled background refresh/processing tasks, but task timing is discretionary. `earliestBeginDate` is only a lower bound, not a guarantee that the task will run then.

Background URLSession transfers can continue while the app is suspended or terminated by the system, but Apple documents a hard limitation: if the user terminates the app from the app switcher, background transfers are canceled and the app is not automatically relaunched until the user explicitly opens it again.

Implication: iOS force-quit cannot be fixed with app code. The product behavior must be best effort plus stale-state detection.

### Android

Android WorkManager is appropriate for recurring and deferrable background work. Periodic work is inexact, subject to OS battery policy, and has a minimum interval, but scheduled jobs can continue in several user-stopped cases.

Android device vendors may still restrict background work. Settings-level force stop and aggressive OEM battery modes should be treated as not guaranteed.

## Chosen Approach

Use approach 1 plus approach 3 from the brainstorm:

1. Repair and harden the existing OS-native background backup pipeline.
2. Add stale-backup detection and user-visible fallback for states where the OS does not run the app.

Do not add a parallel scheduler. Do not introduce server requirements unless a later design explicitly approves a server-side feature.

## Upstream Intake Gate

Before implementing fork-specific behavior, compare this branch with `rebase/upstream-rolling-20260509-active` for mobile background backup files.

Candidate upstream commits are eligible only if they are mobile-contained:

- Allowed: mobile Dart, mobile native Android/iOS, mobile tests, Pigeon-generated mobile APIs, mobile config code.
- Not allowed without a separate design: server code, database migrations, OpenAPI schema changes, auth protocol changes, new server endpoints, changed upload payload contracts that require server support.

For every upstream candidate:

1. Run `git show --stat <commit>`.
2. Inspect the full diff, not only the subject line.
3. Confirm whether it changes server/API/database contracts.
4. Confirm whether it changes generated mobile API code only because of mobile Pigeon changes.
5. If the commit mixes a useful mobile fix with server-dependent behavior, extract only the mobile-contained part manually or skip it.
6. Add or keep tests proving the selected behavior in this branch.

Known candidates to evaluate:

- `8f4b0fce49 fix: limit android background worker duration (#23566)`
  - Likely eligible.
  - Adds a `maxMinutes` argument to Android background upload and refactors background processing into a shared bounded loop.
- `77701dd5a3 refactor: migrate backup config (#28483)`
  - Treat carefully.
  - It touches broader backup config state and should only be pulled if this branch has the matching mobile config model and no server/API requirement.
- Existing branch iOS fixes should remain unless tests prove they conflict with upstream.

## TDD Requirement

All implementation must be test-driven.

No production code changes should be made for this work without first adding or updating a failing test that captures the intended behavior. The workflow is:

1. Write the smallest failing test for the current bug or missing edge case.
2. Run the focused test and confirm the expected failure.
3. Implement the minimum production change.
4. Run the focused test and confirm it passes.
5. Run the relevant wider mobile test set.
6. Refactor only with tests green.

If a behavior cannot be covered by an automated unit/widget test because it depends on iOS/Android schedulers, add the narrowest possible seam around the scheduler/worker boundary and unit-test that seam. Manual device checks are supplemental, not substitutes for unit tests.

## Architecture

### Native Scheduling Layer

The native layer remains responsible for waking the app:

- iOS:
  - `BGAppRefreshTask` handles short refresh checks.
  - `BGProcessingTask` handles longer sync/enqueue work.
  - Both tasks reschedule themselves when invoked.
  - Branded builds must derive task IDs from `BGTaskSchedulerPermittedIdentifiers` or otherwise remain compatible with branding.
- Android:
  - MediaStore content URI triggers enqueue one-shot background work when media changes.
  - Periodic WorkManager work catches missed events.
  - Background work should have a bounded runtime so it does not run indefinitely or get killed mid-cleanup.

### Background Worker Layer

The Flutter background worker remains the coordinator:

1. Bootstrap translations, Drift, auth endpoint, worker manager, downloader callbacks, and logging.
2. Recover pending downloader events/tasks before starting new backup work.
3. Check backup enabled and current user.
4. Run local sync.
5. Run remote sync.
6. Hash local assets with a strict timeout.
7. Enqueue backup candidates.
8. Clean up resources without losing pending upload state.

This layer must not depend on the backup page or any foreground UI provider being mounted.

### Upload Layer

iOS should enqueue file-backed background upload tasks so the OS can continue transfers after suspension or normal system termination.

Live Photos remain one logical backup item, even though motion and still components can upload as separate files. The UI and local state should not leave a completed Live Photo in a misleading half-local/half-cloud state.

### Stale Backup Layer

Add a persisted status model for background backup health. It should be local-first and not require server changes.

Persist at minimum:

- `lastBackgroundWakeAt`
- `lastLocalPhotoScanAt`
- `lastUploadEnqueueAt`
- `lastUploadSuccessAt`
- `lastBackgroundFailureReason`
- `lastCandidateCount`
- `lastSuccessfulSchedulerKind` where practical, such as `iosRefresh`, `iosProcessing`, `androidMediaObserver`, or `androidPeriodic`

Use this to derive:

- Healthy: recent wake or upload success.
- Pending: candidates exist and upload is in progress or recently enqueued.
- Stale: backup is enabled, candidates likely exist or last scan is old, and no background wake/upload success happened within the threshold.
- Blocked by OS/user action: inferred when stale state persists and the app only recovers after foreground open.

Thresholds should be conservative and configurable in code:

- Warning threshold: 48 hours without background wake or upload success.
- Severe/stale threshold: 7 days without background wake or upload success.

## User-Visible Behavior

The user should not be told that backup is running if the OS has not allowed the app to run.

In-app backup status should show enough information to debug:

- Last background check time.
- Last successful upload time.
- Number of pending candidates if known.
- Last failure reason if known.
- A message for iOS force-quit/background-disabled cases: open the app to resume background backup.

Optional local notification:

- If backup is enabled and stale threshold is exceeded, show a reminder notification asking the user to open Gallery.
- Do not spam: rate-limit reminders and clear the stale warning after a successful foreground/background backup pass.

## Edge Cases To Cover

The implementation plan must include tests for these cases:

- Backup disabled: scheduler may wake, but no backup enqueue occurs.
- Logged-out/no current user: background worker exits cleanly.
- Missing or revoked Photos permission: stale/failure state records a clear reason.
- Background App Refresh disabled on iOS: stale/failure state records a clear reason where detectable.
- No network: no false success; retry/backoff state remains recoverable.
- Wi-Fi/cellular restrictions: upload obeys backup settings.
- Low battery/charging constraints on Android: WorkManager constraints are preserved.
- Existing active URLSession/background downloader tasks: worker resumes rather than duplicating tasks.
- Killed downloader tasks: recovery reschedules what can be rescheduled and logs failures.
- Live Photo motion upload succeeds but still upload is delayed/fails: logical asset state remains consistent and recoverable.
- Live Photo still upload succeeds after motion upload: final state is one complete backed-up asset.
- App minimized during upload: upload continues where OS allows and UI state reloads from durable downloader/database state on reopen.
- App closed normally during upload: iOS URLSession tasks continue where OS allows.
- iOS app force-quit: no silent guarantee; stale detection/reminder is the expected behavior.
- Android task-manager stop: scheduled jobs are expected to continue where OS allows.
- Android Settings force stop/OEM battery kill: treated as not guaranteed and surfaced as stale if detected later.
- Branding: iOS BGTask identifiers still match branded `Info.plist` permitted identifiers.
- Upstream intake: mobile-only commits do not introduce server/API dependencies.

## Test Plan

### Unit Tests

Add or update Dart tests for:

- Background worker routes iOS refresh/processing and Android upload through a shared bounded backup loop.
- Backup disabled short-circuits before upload enqueue.
- Backup enabled calls local sync, remote sync, hash, then enqueue in order.
- Hash timeout still allows backup enqueue with already-hashed candidates.
- Background worker cleanup completes cancellation token safely and closes Drift/logger after async cleanup.
- Downloader recovery runs before new upload enqueue.
- `startBackup` uses iOS URLSession path on iOS and foreground upload path on Android.
- iOS URLSession path resumes active tasks instead of duplicating candidate uploads.
- Stale status derivation for healthy, pending, stale, and blocked states.
- Reminder notification rate limiting.

### Native Boundary Tests

Add or update tests around generated/native APIs where feasible:

- Android `onInitialized` passes the bounded `maxMinutes` value after adopting the upstream mobile-only fix.
- Android WorkManager enqueue methods preserve unique work names and constraints.
- iOS task IDs remain compatible with branded permitted identifiers.

If native unit tests are not practical in this repo, isolate testable logic behind Dart/Kotlin/Swift helpers and test those helpers.

### Live Photo Tests

Add tests for:

- Motion component task metadata does not include still-photo cloud metadata that can associate with the wrong asset.
- Still component is enqueued after motion response includes the live photo video ID.
- Failure of one component leaves recoverable state and does not falsely mark the logical asset as cloud-only.
- UI/repository state hides linked motion assets while preserving logical completion of the still asset.

### Regression Tests

Keep or add focused regression tests for this PR's existing fixes:

- Dynamic branded iOS background task identifiers.
- iOS notification update does not await a native method-channel reply that may never arrive.
- Background downloader recovery calls `resumeFromBackground` and `rescheduleKilledTasks`.
- Background upload progress/state survives notifier lifecycle where possible.

### Manual Device Checks

Manual checks are required after tests pass:

- iOS physical device: enable backup, take new photos, background the app, wait for upload progress/logs.
- iOS physical device: simulate BGProcessing launch from Xcode where possible.
- iOS physical device: force-quit and confirm the app does not claim guaranteed backup; stale status appears after threshold or with test-shortened threshold.
- Android device/emulator: take new media, verify MediaStore-triggered background worker.
- Android: verify periodic fallback can enqueue backup when content trigger is missed.

Manual checks must not be the only verification for core logic.

## Acceptance Criteria

- The implementation is TDD: every production behavior change has a failing test first.
- Mobile tests cover the scheduler-to-worker-to-upload flow and the stale fallback.
- Relevant upstream mobile-only fixes are evaluated and either pulled, manually extracted, or explicitly skipped with rationale.
- No server/API/database changes are required by the selected upstream fixes.
- iOS normal backgrounding can enqueue/resume file-backed uploads without the backup page mounted.
- UI state does not reset misleadingly after minimize/reopen; durable state is rehydrated where available.
- Live Photo uploads do not leave the asset appearing cloud-only/local-missing after partial background upload.
- iOS force-quit is documented and handled as a stale/reminder state, not as a guaranteed silent upload state.
- Android keeps MediaStore-triggered and periodic WorkManager backup behavior.
- Branded iOS builds keep working with branded BGTask identifiers.

## Sources

- Apple `earliestBeginDate`: https://developer.apple.com/documentation/backgroundtasks/bgtaskrequest/earliestbegindate
- Apple background URLSession behavior: https://developer.apple.com/documentation/foundation/urlsessionconfiguration/background%28withidentifier%3A%29
- Android WorkManager periodic work: https://developer.android.com/reference/androidx/work/PeriodicWorkRequest
- Android user-initiated foreground-service stop behavior: https://developer.android.com/about/versions/13/changes/fgs-manager
