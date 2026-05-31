import 'dart:async';

import 'package:http/http.dart' as http;

/// An [http.Client] wrapper that can gracefully drain in-flight requests.
///
/// This exists to fix an iOS background-worker crash: the background isolate
/// shares a native [URLSession] with the foreground via `cupertino_http`. When
/// the isolate is torn down (`engine.destroyContext()`) while a request is
/// still in flight, the request's per-task delegate later fires
/// `didCompleteWithError` on a background queue and invokes an FFI callback
/// belonging to the now-dead isolate, tripping a Dart VM assertion (SIGABRT).
///
/// To make teardown safe, the background isolate wraps its client in a
/// [DrainingHttpClient] and calls [shutdown] before signalling completion to
/// the native side. [shutdown] aborts every in-flight request — so their
/// delegate callbacks fire *while the isolate is still alive* — awaits their
/// settlement, and only then closes the underlying client.
class DrainingHttpClient extends http.BaseClient {
  DrainingHttpClient(this._inner);

  final http.Client _inner;

  /// Abort triggers for requests this client made abortable. Completing one
  /// cancels the corresponding in-flight request.
  final Set<Completer<void>> _abortTriggers = {};

  /// Futures that complete once an in-flight request has fully settled.
  final Set<Future<void>> _inFlight = {};

  bool _closed = false;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    if (_closed) {
      throw http.ClientException('HTTP request failed. Client is already closed.', request.url);
    }

    final settled = Completer<void>();
    _inFlight.add(settled.future);

    // Make plain requests abortable so [shutdown] can cancel them. Requests
    // that are already abortable manage their own trigger; request types we
    // can't safely re-create (streamed/multipart) are tracked but not
    // forcibly cancelled here.
    Completer<void>? trigger;
    final http.BaseRequest outgoing;
    if (request is http.Request && request is! http.Abortable) {
      trigger = Completer<void>();
      _abortTriggers.add(trigger);
      outgoing = _toAbortableRequest(request, trigger.future);
    } else {
      outgoing = request;
    }

    void settle() {
      if (trigger != null) {
        _abortTriggers.remove(trigger);
      }
      _inFlight.remove(settled.future);
      if (!settled.isCompleted) {
        settled.complete();
      }
    }

    try {
      final response = await _inner.send(outgoing);
      // The request is not fully settled until its body has been delivered:
      // `cupertino_http` fires its completion FFI callback when the response
      // stream closes, so the request must stay tracked (and abortable) until
      // then.
      final tracked = response.stream.transform(
        StreamTransformer<List<int>, List<int>>.fromHandlers(
          handleData: (data, sink) => sink.add(data),
          handleError: (error, stackTrace, sink) {
            sink.addError(error, stackTrace);
            settle();
          },
          handleDone: (sink) {
            settle();
            sink.close();
          },
        ),
      );
      return http.StreamedResponse(
        tracked,
        response.statusCode,
        contentLength: response.contentLength,
        request: response.request,
        headers: response.headers,
        isRedirect: response.isRedirect,
        persistentConnection: response.persistentConnection,
        reasonPhrase: response.reasonPhrase,
      );
    } catch (_) {
      settle();
      rethrow;
    }
  }

  /// Aborts all in-flight requests, awaits their settlement (bounded by
  /// [timeout]), then closes the underlying client.
  ///
  /// After this completes, [send] throws and no in-flight request can call back
  /// into the isolate.
  Future<void> shutdown({Duration timeout = const Duration(seconds: 3)}) async {
    _closed = true;

    for (final trigger in _abortTriggers.toList()) {
      if (!trigger.isCompleted) {
        trigger.complete();
      }
    }

    if (_inFlight.isNotEmpty) {
      await Future.wait(_inFlight.toList()).timeout(timeout, onTimeout: () => const []);
    }

    _inner.close();
  }

  @override
  void close() => _inner.close();

  http.AbortableRequest _toAbortableRequest(http.Request request, Future<void> abortTrigger) {
    return http.AbortableRequest(request.method, request.url, abortTrigger: abortTrigger)
      ..followRedirects = request.followRedirects
      ..maxRedirects = request.maxRedirects
      ..persistentConnection = request.persistentConnection
      ..encoding = request.encoding
      ..headers.addAll(request.headers)
      ..bodyBytes = request.bodyBytes;
  }
}
