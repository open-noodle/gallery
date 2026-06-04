# iOS Resume Stale-URLSession Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the iOS app from losing all server connectivity (requiring a force-quit) after a background backup runs, by re-establishing the foreground's native HTTP client/URLSession when the app returns to the foreground.

**Architecture:** On iOS the foreground isolate and the background-worker isolate share one process-wide `URLSession` (`URLSessionManager.shared`). `cupertino_http` binds that shared session's completion callbacks to whichever isolate last called `CupertinoClient.fromSharedSession`. When the background-worker isolate runs a backup and is then torn down (`engine.destroyContext()`), the shared session is left with its callback target pointing at a destroyed isolate — every subsequent foreground request hangs/fails. The foreground never re-initialises its client on resume (only cold start / login do), so only a cold restart recovers. Fix: on resume-after-pause (iOS only), recreate the native session and rebuild the foreground isolate's HTTP client so the foreground owns a fresh, live session again. We add a guard-defeating `NetworkRepository.refresh()`, expose a native `recreateSession()` over pigeon, wire `ApiService.refreshConnection()`, and call it from `AppLifeCycleNotifier` on resume.

**Tech Stack:** Flutter/Dart (Riverpod, `http`, `cupertino_http`), pigeon (host API codegen), Swift (`URLSessionManager`), Kotlin (no-op), `mocktail` + `flutter_test`, in-memory Drift for `Store`.

**Root cause evidence (already confirmed):**

- `setOpenApiServiceEndpoint()` returns `null` early when auto endpoint-switching is off (`mobile/lib/services/auth.service.dart:148-156`); the `"Using server URL: null"` log (`mobile/lib/providers/app_life_cycle.provider.dart:77-78`) is **benign** and not the cause — the stored endpoint is never cleared (only `clearLocalData()` deletes it).
- Foreground builds its client once: `main.dart:228`, `bootstrap.dart:57`, login `auth.provider.dart:133`. `_performResume` never re-inits.
- `NetworkRepository.init()` short-circuits when the pointer is unchanged (`mobile/lib/infrastructure/repositories/network.repository.dart:35-37`).
- Shared session swap point: `URLSessionManager.recreateSession()` (`mobile/ios/Runner/Core/NetworkApiImpl.swift:96`), pointer handed to Dart via `passUnretained` (`NetworkApiImpl.swift:62-64`).
- The current branch commit (`ced29838a9`) makes the background worker upload far longer (`_queueMoreBackgroundBackupCandidatesIfNeeded`), which is why this now reproduces routinely. `git diff main...HEAD` shows the resume path, native session code, and teardown are unchanged from main (pre-existing bug, newly surfaced).

---

## File Structure / Change Map

**Modify:**

- `mobile/pigeon/network_api.dart` — add `void recreateSession();` to the `@HostApi()` definition.
- `mobile/lib/platform/network_api.g.dart` — regenerated (adds `recreateSession`).
- `mobile/ios/Runner/Core/Network.g.swift` — regenerated (adds `recreateSession` to protocol + setup).
- `mobile/android/app/src/main/kotlin/app/alextran/immich/core/Network.g.kt` — regenerated.
- `mobile/ios/Runner/Core/NetworkApiImpl.swift` — implement `recreateSession()` (calls existing `URLSessionManager.shared.recreateSession()`).
- `mobile/android/app/src/main/kotlin/app/alextran/immich/core/NetworkApiPlugin.kt` — implement `recreateSession()` as a no-op (iOS-only feature; pigeon requires the method).
- `mobile/lib/infrastructure/repositories/network.repository.dart` — add test seams (`debugClientPointer`, `debugBaseClientFactory`, `debugRecreateSession`, `debugReset`), switch `Platform.isIOS` → `CurrentPlatform.isIOS`, extract `_buildBaseClient`, add `refresh()`.
- `mobile/lib/services/api.service.dart` — add `refreshConnection()`.
- `mobile/lib/providers/app_life_cycle.provider.dart` — add `refreshConnectionAfterResume(bool wasPaused)` and call it from `handleAppResume` before `_performResume`.

**Create (tests):**

- `mobile/test/infrastructure/repositories/network_repository_test.dart`
- `mobile/test/services/api_service_refresh_test.dart`
- `mobile/test/providers/app_life_cycle_provider_test.dart`

**Toolchain note:** Use the mise-pinned Flutter (`mobile/mise.toml` pins `flutter = "3.41.7"`), not a PATH Flutter. Run commands from `mobile/`. If `flutter`/`dart` on PATH differ, prefix with `mise exec --` (e.g. `mise exec -- flutter test ...`) or use `~/.local/share/mise/installs/flutter/3.41.7/bin/flutter`. CI's Dart analysis runs `dart analyze --fatal-infos` over **`lib` and `test`**, so always analyze both.

---

### Task 1: Expose native `recreateSession()` over pigeon (codegen + native)

**Files:**

- Modify: `mobile/pigeon/network_api.dart`
- Regenerate: `mobile/lib/platform/network_api.g.dart`, `mobile/ios/Runner/Core/Network.g.swift`, `mobile/android/app/src/main/kotlin/app/alextran/immich/core/Network.g.kt`
- Modify: `mobile/ios/Runner/Core/NetworkApiImpl.swift`
- Modify: `mobile/android/app/src/main/kotlin/app/alextran/immich/core/NetworkApiPlugin.kt`

> **TDD note:** This task is pigeon codegen + native (Swift/Kotlin) glue with no Dart-unit-testable logic of its own (the iOS effect is verified on-device in Task 6, the Dart caller is tested in Task 3). Per the TDD skill, generated/native code is an explicit exception. Do **not** hand-edit the `.g.*` files except via the pigeon generator.

- [ ] **Step 1: Add the method to the pigeon host API**

In `mobile/pigeon/network_api.dart`, add `recreateSession` to the `NetworkApi` class (after `setRequestHeaders`):

```dart
@HostApi()
abstract class NetworkApi {
  @async
  void addCertificate(ClientCertData clientData);

  @async
  void selectCertificate(ClientCertPrompt promptText);

  @async
  void removeCertificate();

  bool hasCertificate();

  int getClientPointer();

  void setRequestHeaders(Map<String, String> headers, List<String> serverUrls, String? token);

  /// Rebuilds the shared native URLSession (iOS). Used on foreground resume to
  /// recover from the background-worker isolate orphaning the shared session.
  void recreateSession();
}
```

- [ ] **Step 2: Regenerate the pigeon bindings**

Run (from `mobile/`):

```bash
dart run pigeon --input pigeon/network_api.dart
dart format lib/platform/network_api.g.dart
```

Expected: `lib/platform/network_api.g.dart`, `ios/Runner/Core/Network.g.swift`, and `android/app/src/main/kotlin/app/alextran/immich/core/Network.g.kt` are updated. Review the diff — the only semantic addition should be a `recreateSession` channel/method in each file. The Dart `NetworkApi` class gains `Future<void> recreateSession()`.

- [ ] **Step 3: Implement `recreateSession()` on iOS**

In `mobile/ios/Runner/Core/NetworkApiImpl.swift`, add to `class NetworkApiImpl: NetworkApi` (after `setRequestHeaders`, before the closing brace of the class at the `}` preceding `private class CertImporter`):

```swift
  func recreateSession() throws {
    URLSessionManager.shared.recreateSession()
  }
```

- [ ] **Step 4: Implement `recreateSession()` as a no-op on Android**

In `mobile/android/app/src/main/kotlin/app/alextran/immich/core/NetworkApiPlugin.kt`, add to `private class NetworkApiImpl : NetworkApi` (after `setRequestHeaders`):

```kotlin
  override fun recreateSession() {
    // iOS-only: the shared-URLSession teardown race does not affect the
    // Android OkHttp client, which is never re-shared across the worker isolate.
  }
```

- [ ] **Step 5: Verify Dart analysis is clean**

Run (from `mobile/`):

```bash
dart analyze --fatal-infos lib test
```

Expected: No new errors/infos introduced by the regenerated `network_api.g.dart`.

- [ ] **Step 6: Commit**

```bash
git add mobile/pigeon/network_api.dart mobile/lib/platform/network_api.g.dart \
  mobile/ios/Runner/Core/Network.g.swift mobile/ios/Runner/Core/NetworkApiImpl.swift \
  mobile/android/app/src/main/kotlin/app/alextran/immich/core/Network.g.kt \
  mobile/android/app/src/main/kotlin/app/alextran/immich/core/NetworkApiPlugin.kt
git commit -m "feat(mobile): expose native recreateSession over pigeon"
```

---

### Task 2: Make `NetworkRepository` testable (seams + platform abstraction)

**Files:**

- Modify: `mobile/lib/infrastructure/repositories/network.repository.dart`
- Test: `mobile/test/infrastructure/repositories/network_repository_test.dart`

This task introduces injectable seams so the static `NetworkRepository` (which otherwise builds real FFI clients and reads `dart:io` `Platform`) can be unit-tested, and characterises the existing same-pointer guard. No production behaviour change yet.

- [ ] **Step 1: Write the failing characterisation tests**

Create `mobile/test/infrastructure/repositories/network_repository_test.dart`:

```dart
import 'dart:ffi';

import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:immich_mobile/infrastructure/repositories/network.repository.dart';

/// Minimal fake http client that records whether it was closed.
class _FakeClient extends http.BaseClient {
  bool closed = false;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    return http.StreamedResponse(const Stream<List<int>>.empty(), 200);
  }

  @override
  void close() {
    closed = true;
  }
}

void main() {
  late int pointerAddress;
  late int factoryCalls;
  late List<_FakeClient> built;

  setUp(() {
    NetworkRepository.debugReset();
    pointerAddress = 1;
    factoryCalls = 0;
    built = [];
    NetworkRepository.debugClientPointer = () async => pointerAddress;
    NetworkRepository.debugBaseClientFactory = (Pointer<Void> _) {
      factoryCalls++;
      final client = _FakeClient();
      built.add(client);
      return client;
    };
  });

  tearDown(() {
    NetworkRepository.debugReset();
    debugDefaultTargetPlatformOverride = null;
  });

  test('init builds the client from the native pointer', () async {
    await NetworkRepository.init();

    expect(factoryCalls, 1);
    expect(NetworkRepository.client, same(built.single));
  });

  test('init is a no-op when the native pointer is unchanged', () async {
    await NetworkRepository.init();
    await NetworkRepository.init();

    expect(factoryCalls, 1);
  });

  test('init rebuilds and closes the old client when the pointer changes', () async {
    await NetworkRepository.init();
    pointerAddress = 2;
    await NetworkRepository.init();

    expect(factoryCalls, 2);
    expect(built.first.closed, isTrue);
    expect(NetworkRepository.client, same(built.last));
  });

  test('client getter throws before init', () {
    expect(() => NetworkRepository.client, throwsA(isA<TypeError>()));
  });
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `mobile/`):

```bash
flutter test test/infrastructure/repositories/network_repository_test.dart
```

Expected: FAIL — compile errors (`debugReset`, `debugClientPointer`, `debugBaseClientFactory` are not defined on `NetworkRepository`).

- [ ] **Step 3: Add the seams and platform abstraction**

Replace the contents of `mobile/lib/infrastructure/repositories/network.repository.dart` with:

```dart
import 'dart:ffi';

import 'package:cupertino_http/cupertino_http.dart';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:immich_mobile/extensions/platform_extensions.dart';
import 'package:immich_mobile/infrastructure/repositories/draining_http_client.dart';
import 'package:immich_mobile/providers/infrastructure/platform.provider.dart';
import 'package:ok_http/ok_http.dart';
import 'package:web_socket/web_socket.dart';

class NetworkRepository {
  static http.Client? _client;
  static Pointer<Void>? _clientPointer;

  /// When set, the iOS client is wrapped in a [DrainingHttpClient] so in-flight
  /// requests can be aborted and drained at teardown. Enabled only in the
  /// background-worker isolate via [enableShutdownTracking].
  static bool _trackInFlight = false;
  static DrainingHttpClient? _draining;

  /// Test seam: overrides the native client-pointer source.
  @visibleForTesting
  static Future<int> Function()? debugClientPointer;

  /// Test seam: overrides native base-client construction (avoids real FFI).
  @visibleForTesting
  static http.Client Function(Pointer<Void> pointer)? debugBaseClientFactory;

  /// Test seam: overrides the native session recreation.
  @visibleForTesting
  static Future<void> Function()? debugRecreateSession;

  /// Resets all static state and test seams. Test-only.
  @visibleForTesting
  static void debugReset() {
    _client = null;
    _clientPointer = null;
    _draining = null;
    _trackInFlight = false;
    debugClientPointer = null;
    debugBaseClientFactory = null;
    debugRecreateSession = null;
  }

  /// Enables graceful shutdown tracking of in-flight requests for the current
  /// isolate. Must be called before [init].
  ///
  /// The iOS background worker shares a native [URLSession] across isolates; if
  /// the isolate is destroyed while a request is in flight, the request's
  /// `cupertino_http` delegate later calls back into the dead isolate and
  /// crashes the process. Tracking lets [shutdown] cancel and drain those
  /// requests first. See [DrainingHttpClient].
  static void enableShutdownTracking() {
    _trackInFlight = true;
  }

  static Future<void> init() async {
    final address = await (debugClientPointer ?? networkApi.getClientPointer)();
    final clientPointer = Pointer<Void>.fromAddress(address);
    if (clientPointer == _clientPointer) {
      return;
    }
    _clientPointer = clientPointer;
    _client?.close();
    _draining = null;

    final http.Client base = debugBaseClientFactory != null
        ? debugBaseClientFactory!(clientPointer)
        : _buildBaseClient(clientPointer);

    // Only iOS needs draining: the crash is specific to cupertino_http's
    // shared-session FFI delegate. Android's background worker is unaffected.
    if (_trackInFlight && CurrentPlatform.isIOS) {
      _client = _draining = DrainingHttpClient(base);
    } else {
      _client = base;
    }
  }

  static http.Client _buildBaseClient(Pointer<Void> clientPointer) {
    if (CurrentPlatform.isIOS) {
      final session = URLSession.fromRawPointer(clientPointer.cast());
      return CupertinoClient.fromSharedSession(session);
    }
    return OkHttpClient.fromJniGlobalRef(
      clientPointer,
      configuration: const OkHttpClientConfiguration(
        connectTimeout: Duration(seconds: 30),
        readTimeout: Duration(seconds: 60),
        writeTimeout: Duration(seconds: 60),
      ),
    );
  }

  /// Aborts and drains any in-flight requests, then closes the client.
  ///
  /// No-op unless [enableShutdownTracking] was called before [init]. Must run
  /// before the native side destroys the background isolate so that no
  /// in-flight `cupertino_http` request can call back into a dead isolate.
  static Future<void> shutdown({Duration timeout = const Duration(milliseconds: 1500)}) async {
    final draining = _draining;
    _draining = null;
    await draining?.shutdown(timeout: timeout);
  }

  static Future<void> setHeaders(Map<String, String> headers, List<String> serverUrls, {String? token}) async {
    await networkApi.setRequestHeaders(headers, serverUrls, token);
    if (CurrentPlatform.isIOS) {
      await init();
    }
  }

  // ignore: avoid-unused-parameters
  static Future<WebSocket> createWebSocket(Uri uri, {Map<String, String>? headers, Iterable<String>? protocols}) {
    if (CurrentPlatform.isIOS) {
      final session = URLSession.fromRawPointer(_clientPointer!.cast());
      return CupertinoWebSocket.connectWithSession(session, uri, protocols: protocols);
    } else {
      return OkHttpWebSocket.connectFromJniGlobalRef(_clientPointer!, uri, protocols: protocols);
    }
  }

  const NetworkRepository();

  /// Returns a shared HTTP client that uses native SSL configuration.
  ///
  /// On iOS: Uses SharedURLSessionManager's URLSession.
  /// On Android: Uses SharedHttpClientManager's OkHttpClient.
  ///
  /// Must call [init] before using this method.
  static http.Client get client => _client!;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `mobile/`):

```bash
flutter test test/infrastructure/repositories/network_repository_test.dart
```

Expected: PASS (4 tests).

- [ ] **Step 5: Verify analysis is clean**

Run (from `mobile/`):

```bash
dart analyze --fatal-infos lib test
```

Expected: No errors/infos. (`dart:io` import was removed; confirm nothing else in the file referenced `Platform`.)

- [ ] **Step 6: Commit**

```bash
git add mobile/lib/infrastructure/repositories/network.repository.dart \
  mobile/test/infrastructure/repositories/network_repository_test.dart
git commit -m "refactor(mobile): make NetworkRepository client construction testable"
```

---

### Task 3: Add `NetworkRepository.refresh()`

**Files:**

- Modify: `mobile/lib/infrastructure/repositories/network.repository.dart`
- Test: `mobile/test/infrastructure/repositories/network_repository_test.dart`

`refresh()` is the core fix primitive: it recreates the native session (iOS) and rebuilds this isolate's client **even when the pointer is unchanged** (defeating the `init()` short-circuit), re-registering the foreground isolate as the shared session's callback target.

- [ ] **Step 1: Write the failing tests**

Append these tests inside `main()` in `mobile/test/infrastructure/repositories/network_repository_test.dart` (after the existing tests):

```dart
  test('refresh rebuilds the client even when the pointer is unchanged', () async {
    await NetworkRepository.init();
    await NetworkRepository.refresh();

    expect(factoryCalls, 2);
    expect(built.first.closed, isTrue);
    expect(NetworkRepository.client, same(built.last));
  });

  test('refresh recreates the native session on iOS', () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    var recreateCalls = 0;
    NetworkRepository.debugRecreateSession = () async => recreateCalls++;

    await NetworkRepository.refresh();

    expect(recreateCalls, 1);
  });

  test('refresh does not recreate the session off iOS', () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    var recreateCalls = 0;
    NetworkRepository.debugRecreateSession = () async => recreateCalls++;

    await NetworkRepository.refresh();

    expect(recreateCalls, 0);
    expect(factoryCalls, 1); // still rebuilds the client
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `mobile/`):

```bash
flutter test test/infrastructure/repositories/network_repository_test.dart
```

Expected: FAIL — `refresh` is not defined on `NetworkRepository`.

- [ ] **Step 3: Implement `refresh()`**

In `mobile/lib/infrastructure/repositories/network.repository.dart`, add this method immediately after `_buildBaseClient`:

```dart
  /// Re-establishes this isolate's native HTTP client.
  ///
  /// On iOS the foreground and background-worker isolates share one native
  /// URLSession. When the background-worker isolate is torn down
  /// (`engine.destroyContext()`) it leaves the shared session's
  /// `cupertino_http` callback target pointing at a destroyed isolate, so the
  /// foreground can no longer complete any request until a cold restart.
  ///
  /// On resume we recreate the native session (iOS) and rebuild this isolate's
  /// client — defeating [init]'s same-pointer short-circuit — so the foreground
  /// owns a fresh, live session again.
  static Future<void> refresh() async {
    if (CurrentPlatform.isIOS) {
      await (debugRecreateSession ?? networkApi.recreateSession)();
    }
    _clientPointer = null;
    await init();
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `mobile/`):

```bash
flutter test test/infrastructure/repositories/network_repository_test.dart
```

Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/infrastructure/repositories/network.repository.dart \
  mobile/test/infrastructure/repositories/network_repository_test.dart
git commit -m "feat(mobile): add NetworkRepository.refresh to rebuild the foreground client"
```

---

### Task 4: Add `ApiService.refreshConnection()`

**Files:**

- Modify: `mobile/lib/services/api.service.dart`
- Test: `mobile/test/services/api_service_refresh_test.dart`

`ApiService` copies `NetworkRepository.client` into `_apiClient.client` at `setEndpoint` time, so after `NetworkRepository.refresh()` rebuilds the client we must re-point the API client. `refreshConnection()` does both.

- [ ] **Step 1: Write the failing test**

Create `mobile/test/services/api_service_refresh_test.dart`:

```dart
import 'dart:ffi';

import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/network.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/services/api.service.dart';

class _FakeClient extends http.BaseClient {
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    return http.StreamedResponse(const Stream<List<int>>.empty(), 200);
  }
}

void main() {
  late Drift db;

  setUpAll(() async {
    db = Drift(DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: DriftStoreRepository(db));
  });

  setUp(() async {
    await Store.clear();
    await Store.put(StoreKey.serverEndpoint, 'https://demo.opennoodle.de/api');
    NetworkRepository.debugReset();
    NetworkRepository.debugClientPointer = () async => 1;
  });

  tearDown(() => NetworkRepository.debugReset());

  tearDownAll(() async => db.close());

  test('refreshConnection rebuilds the client and re-points the API client', () async {
    var built = 0;
    final clients = <_FakeClient>[];
    NetworkRepository.debugBaseClientFactory = (Pointer<Void> _) {
      built++;
      final client = _FakeClient();
      clients.add(client);
      return client;
    };
    await NetworkRepository.init();

    final api = ApiService();
    expect(api.usersApi.apiClient.client, same(clients.first));

    await api.refreshConnection();

    expect(built, 2);
    expect(NetworkRepository.client, same(clients.last));
    expect(api.usersApi.apiClient.client, same(clients.last));
  });
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `mobile/`):

```bash
flutter test test/services/api_service_refresh_test.dart
```

Expected: FAIL — `refreshConnection` is not defined on `ApiService`.

- [ ] **Step 3: Implement `refreshConnection()`**

In `mobile/lib/services/api.service.dart`, add this method immediately after `updateHeaders()` (which ends at the line `_apiClient.client = NetworkRepository.client;` `}`):

```dart
  /// Re-establishes the native HTTP client after a background-worker teardown
  /// orphaned the shared iOS URLSession, then re-points the API client at it.
  /// Call on foreground resume (see [AppLifeCycleNotifier]).
  Future<void> refreshConnection() async {
    await NetworkRepository.refresh();
    _apiClient.client = NetworkRepository.client;
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `mobile/`):

```bash
flutter test test/services/api_service_refresh_test.dart
```

Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/services/api.service.dart mobile/test/services/api_service_refresh_test.dart
git commit -m "feat(mobile): add ApiService.refreshConnection"
```

---

### Task 5: Refresh the connection on foreground resume

**Files:**

- Modify: `mobile/lib/providers/app_life_cycle.provider.dart`
- Test: `mobile/test/providers/app_life_cycle_provider_test.dart`

Add a gated, testable `refreshConnectionAfterResume(bool wasPaused)` to `AppLifeCycleNotifier` and call it from `handleAppResume` **before** `_performResume` (which resets `_wasPaused` and then issues `getServerVersion()` / websocket `connect()`). Gating on `wasPaused` avoids firing on orientation-change `inactive`/`hidden` transitions; gating on iOS scopes it to the affected platform.

- [ ] **Step 1: Write the failing tests**

Create `mobile/test/providers/app_life_cycle_provider_test.dart`:

```dart
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/providers/app_life_cycle.provider.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:mocktail/mocktail.dart';

class MockApiService extends Mock implements ApiService {}

void main() {
  late MockApiService apiService;
  late ProviderContainer container;
  late AppLifeCycleNotifier sut;

  setUp(() {
    apiService = MockApiService();
    when(() => apiService.refreshConnection()).thenAnswer((_) async {});
    container = ProviderContainer(overrides: [apiServiceProvider.overrideWithValue(apiService)]);
    sut = container.read(appStateProvider.notifier);
  });

  tearDown(() {
    container.dispose();
    debugDefaultTargetPlatformOverride = null;
  });

  test('refreshes the connection on iOS resume after a pause', () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;

    await sut.refreshConnectionAfterResume(true);

    verify(() => apiService.refreshConnection()).called(1);
  });

  test('does not refresh when the app was not paused', () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;

    await sut.refreshConnectionAfterResume(false);

    verifyNever(() => apiService.refreshConnection());
  });

  test('does not refresh on Android', () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;

    await sut.refreshConnectionAfterResume(true);

    verifyNever(() => apiService.refreshConnection());
  });

  test('swallows refresh errors so resume can continue', () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    when(() => apiService.refreshConnection()).thenThrow(Exception('boom'));

    await expectLater(sut.refreshConnectionAfterResume(true), completes);
    verify(() => apiService.refreshConnection()).called(1);
  });
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `mobile/`):

```bash
flutter test test/providers/app_life_cycle_provider_test.dart
```

Expected: FAIL — `refreshConnectionAfterResume` is not defined on `AppLifeCycleNotifier`.

- [ ] **Step 3: Add the import for `@visibleForTesting`**

In `mobile/lib/providers/app_life_cycle.provider.dart`, add this import (keep imports alphabetically grouped; place with the other package imports near the top):

```dart
import 'package:flutter/foundation.dart';
```

- [ ] **Step 4: Add the gated refresh method**

In `mobile/lib/providers/app_life_cycle.provider.dart`, add this method to `AppLifeCycleNotifier` immediately after `_performResume()` (before `_safeRun`):

```dart
  /// On iOS, re-establishes the native HTTP client when returning to the
  /// foreground after a pause. The background-worker isolate shares (and on
  /// teardown orphans) the native URLSession, leaving the foreground unable to
  /// reach the server until a cold restart. Re-establishing the client here —
  /// before [_performResume] issues any request — recovers connectivity.
  @visibleForTesting
  Future<void> refreshConnectionAfterResume(bool wasPaused) async {
    if (!CurrentPlatform.isIOS || !wasPaused) {
      return;
    }
    try {
      await _ref.read(apiServiceProvider).refreshConnection();
    } catch (e, stackTrace) {
      _log.warning("Failed to refresh connection on resume", e, stackTrace);
    }
  }
```

- [ ] **Step 5: Wire it into `handleAppResume`**

In `mobile/lib/providers/app_life_cycle.provider.dart`, in `handleAppResume`, change the `try` block so the refresh runs before `_performResume` (capturing `_wasPaused` before `_performResume` clears it):

```dart
    _resumeOperation = Completer<void>();

    try {
      await refreshConnectionAfterResume(_wasPaused);
      await _performResume();
    } catch (e, stackTrace) {
      _log.severe("Error during app resume", e, stackTrace);
    } finally {
      if (!_resumeOperation!.isCompleted) {
        _resumeOperation!.complete();
      }
      _resumeOperation = null;
    }
```

- [ ] **Step 6: Add the import for `apiServiceProvider`**

Confirm `mobile/lib/providers/app_life_cycle.provider.dart` imports `apiServiceProvider`. If not present, add:

```dart
import 'package:immich_mobile/providers/api.provider.dart';
```

- [ ] **Step 7: Run the tests to verify they pass**

Run (from `mobile/`):

```bash
flutter test test/providers/app_life_cycle_provider_test.dart
```

Expected: PASS (4 tests).

- [ ] **Step 8: Verify analysis is clean**

Run (from `mobile/`):

```bash
dart analyze --fatal-infos lib test
```

Expected: No errors/infos.

- [ ] **Step 9: Commit**

```bash
git add mobile/lib/providers/app_life_cycle.provider.dart \
  mobile/test/providers/app_life_cycle_provider_test.dart
git commit -m "fix(mobile): refresh HTTP connection on iOS foreground resume"
```

---

### Task 6: Full verification + on-device validation

**Files:** none (verification only)

- [ ] **Step 1: Run the full mobile unit suite**

Run (from `mobile/`):

```bash
flutter test
```

Expected: PASS. Confirm the three new test files run and that `draining_http_client_test.dart`, `drift_backup_provider_test.dart`, and `background_upload.service_test.dart` still pass (no regression from the `NetworkRepository` refactor).

- [ ] **Step 2: Run analysis over lib and test (matches CI)**

Run (from `mobile/`):

```bash
dart analyze --fatal-infos lib test
```

Expected: No errors/warnings/infos.

- [ ] **Step 3: Format check**

Run (from `mobile/`):

```bash
dart format --output=none --set-exit-if-changed lib test
```

Expected: No changes needed. (If it reports changes, run `dart format lib test` and amend.)

- [ ] **Step 4: On-device TestFlight/dev validation (the native half)**

The Swift `recreateSession` and the cupertino_http re-registration cannot be exercised by the Dart unit suite. Validate on a physical iOS device:

1. Build and install the branch (TestFlight build or `flutter run --release` on device).
2. Sign in to a server (single server URL, auto endpoint-switching off — the reported configuration).
3. Enable backup and add enough new photos that the background worker keeps uploading.
4. Background the app and leave it long enough for a background backup cycle to run and finish (watch for the background upload to drain).
5. Reopen the app.
6. **Expected:** the timeline/server calls succeed immediately — no force-quit needed. Previously this hung with `"Using server URL: null"` followed by failed server calls.

- [ ] **Step 5: (Optional) Confirm the mechanism via log**

If the device build still misbehaves, temporarily add a diagnostic in `refreshConnectionAfterResume` (`_log.info("Resume: refreshing connection (wasPaused=$wasPaused)")`) and in `NetworkRepository.refresh` log the pointer address before/after, to confirm the session pointer changes on resume. Remove before merge.

- [ ] **Step 6: Final commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "chore(mobile): verification fixes for iOS resume connection refresh"
```

---

## Self-Review

**Spec coverage:**

- Dart resume re-init → Tasks 2–5 (NetworkRepository.refresh, ApiService.refreshConnection, AppLifeCycleNotifier wiring). ✓
- Native `recreateSession` → Task 1 (pigeon + Swift + Kotlin), called from `refresh()` in Task 3, device-verified in Task 6. ✓
- Edge cases: same-pointer guard (Task 2), refresh defeats guard (Task 3), iOS-only session recreate (Task 3), client-getter-before-init (Task 2), not-paused / Android / error-swallow gates (Task 5), API-client re-pointing (Task 4). ✓
- Benign `"Using server URL: null"` log: documented as not-the-cause; intentionally not changed (it is correct behaviour when endpoint-switching is off). A separate cleanup could downgrade that log, but it is out of scope for the connectivity fix.

**Type/name consistency:** `refresh()`, `refreshConnection()`, `refreshConnectionAfterResume(bool)`, `debugReset()`, `debugClientPointer`, `debugBaseClientFactory`, `debugRecreateSession` are used identically across tasks. `networkApi.recreateSession()` is defined in Task 1 before first use in Task 3. `NetworkRepository.client` getter type (`http.Client`) and `apiClient.client` field used consistently.

**Placeholder scan:** No TBD/TODO/"handle errors"/"similar to" — every code step contains full code and exact commands.

**Risk notes:**

- The `NetworkRepository` rewrite (Task 2) is a superset of the current file; the only behavioural changes are `Platform.isIOS` → `CurrentPlatform.isIOS` (equal on device; enables tests) and extraction of `_buildBaseClient`. `createWebSocket` keeps using `_clientPointer`, which `refresh()` updates — so the websocket reconnect in `_performResume` (after the refresh) also picks up the fresh session.
- Pigeon regen (Task 1) may reformat the generated files; review the diff to ensure only `recreateSession` is added semantically.
- The existing `recreateSession()` Swift implementation is unchanged (a known pre-existing non-invalidation of the old session; out of scope).
