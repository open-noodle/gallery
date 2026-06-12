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

  /// Test seam: overrides the native session recreation performed by [refresh].
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
    if (draining == null) {
      return;
    }
    await draining.shutdown(timeout: timeout);
    // The client is now closed. A pooled worker isolate may be reused for
    // another task, where [init] would otherwise short-circuit on the unchanged
    // native session pointer and hand back this dead client. Clear both so the
    // next [init] rebuilds a live client.
    _client = null;
    _clientPointer = null;
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
