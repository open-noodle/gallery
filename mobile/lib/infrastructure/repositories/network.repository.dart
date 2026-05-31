import 'dart:ffi';
import 'dart:io';

import 'package:cupertino_http/cupertino_http.dart';
import 'package:http/http.dart' as http;
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
    final clientPointer = Pointer<Void>.fromAddress(await networkApi.getClientPointer());
    if (clientPointer == _clientPointer) {
      return;
    }
    _clientPointer = clientPointer;
    _client?.close();
    _draining = null;

    final http.Client base;
    if (Platform.isIOS) {
      final session = URLSession.fromRawPointer(clientPointer.cast());
      base = CupertinoClient.fromSharedSession(session);
    } else {
      base = OkHttpClient.fromJniGlobalRef(
        clientPointer,
        configuration: const OkHttpClientConfiguration(
          connectTimeout: Duration(seconds: 30),
          readTimeout: Duration(seconds: 60),
          writeTimeout: Duration(seconds: 60),
        ),
      );
    }

    // Only iOS needs draining: the crash is specific to cupertino_http's
    // shared-session FFI delegate. Android's background worker is unaffected.
    if (_trackInFlight && Platform.isIOS) {
      _client = _draining = DrainingHttpClient(base);
    } else {
      _client = base;
    }
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
    if (Platform.isIOS) {
      await init();
    }
  }

  // ignore: avoid-unused-parameters
  static Future<WebSocket> createWebSocket(Uri uri, {Map<String, String>? headers, Iterable<String>? protocols}) {
    if (Platform.isIOS) {
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
