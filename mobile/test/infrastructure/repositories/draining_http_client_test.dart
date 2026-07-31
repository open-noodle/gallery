import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:immich_mobile/infrastructure/repositories/draining_http_client.dart';

/// A fake [http.Client] that lets a test hold requests in flight and observe
/// whether the client honored an [http.Abortable] trigger before being closed.
class _FakeInnerClient extends http.BaseClient {
  _FakeInnerClient({this.honorAbort = true});

  /// When false, the client ignores the abort trigger (simulating a request
  /// that refuses to cancel), so [DrainingHttpClient.shutdown] must fall back
  /// to its timeout.
  final bool honorAbort;
  final List<http.BaseRequest> sent = [];
  final List<Completer<http.StreamedResponse>> _pending = [];
  bool closed = false;
  bool hadPendingRequestsAtClose = false;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) {
    sent.add(request);
    final completer = Completer<http.StreamedResponse>();
    _pending.add(completer);
    // Mimic a real client (e.g. CupertinoClient) that fails an in-flight
    // request when its abort trigger fires.
    if (honorAbort) {
      if (request case http.Abortable(:final abortTrigger?)) {
        unawaited(
          abortTrigger.whenComplete(() {
            if (!completer.isCompleted) {
              completer.completeError(http.RequestAbortedException(request.url));
            }
          }),
        );
      }
    }
    return completer.future;
  }

  @override
  void close() {
    hadPendingRequestsAtClose = _pending.any((c) => !c.isCompleted);
    closed = true;
  }
}

/// A fake [http.Client] that returns a streamed response whose body stays open,
/// mimicking `cupertino_http`: aborting the request injects an error into the
/// response stream and closes it.
class _StreamingFakeClient extends http.BaseClient {
  late StreamController<List<int>> body;
  bool closed = false;
  bool hadOpenStreamAtClose = false;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    body = StreamController<List<int>>();
    if (request case http.Abortable(:final abortTrigger?)) {
      unawaited(
        abortTrigger.whenComplete(() {
          if (!body.isClosed) {
            body.addError(http.RequestAbortedException(request.url));
            unawaited(body.close());
          }
        }),
      );
    }
    return http.StreamedResponse(body.stream, 200);
  }

  @override
  void close() {
    hadOpenStreamAtClose = !body.isClosed;
    closed = true;
  }
}

void main() {
  test('keeps a request in flight until its response body stream completes', () async {
    final inner = _StreamingFakeClient();
    final client = DrainingHttpClient(inner);

    // The response headers arrive, but the body is still streaming.
    final response = await client.send(http.Request('GET', Uri.parse('https://example.com/api/sync')));
    expect(inner.body.isClosed, isFalse);

    // Consume the stream the way ApiClient does.
    final drained = expectLater(response.stream.toBytes(), throwsA(isA<http.ClientException>()));

    // Shutdown must abort the still-open stream and wait for it to close before
    // closing the inner client — otherwise the isolate could be destroyed while
    // the body is mid-flight.
    await client.shutdown();

    expect(inner.closed, isTrue);
    expect(
      inner.hadOpenStreamAtClose,
      isFalse,
      reason: 'response stream must be drained before the inner client is closed',
    );

    await drained;
  });

  test('rejects new requests after shutdown', () async {
    final inner = _FakeInnerClient();
    final client = DrainingHttpClient(inner);

    await client.shutdown();

    await expectLater(client.get(Uri.parse('https://example.com/api/sync')), throwsA(isA<http.ClientException>()));
    expect(inner.sent, isEmpty);
  });

  test('rewrites a plain request into an abortable request preserving method, headers and body', () async {
    final inner = _FakeInnerClient();
    final client = DrainingHttpClient(inner);

    final request = http.Request('POST', Uri.parse('https://example.com/api/things'))
      ..headers['x-custom'] = 'value'
      ..body = 'payload';
    final pending = client.send(request);
    await pumpEventQueue();

    final outgoing = inner.sent.single;
    expect(outgoing, isA<http.AbortableRequest>());
    expect(outgoing.method, 'POST');
    expect(outgoing.url, Uri.parse('https://example.com/api/things'));
    expect(outgoing.headers['x-custom'], 'value');
    expect((outgoing as http.Request).body, 'payload');

    final done = expectLater(pending, throwsA(isA<http.ClientException>()));
    await client.shutdown();
    await done;
  });

  test('shutdown returns within the timeout even if a request never settles', () async {
    final inner = _FakeInnerClient(honorAbort: false);
    final client = DrainingHttpClient(inner);

    unawaited(client.get(Uri.parse('https://example.com/api/sync')).catchError((_) => http.Response('', 499)));
    await pumpEventQueue();

    await client.shutdown(timeout: const Duration(milliseconds: 50));

    expect(inner.closed, isTrue);
  });

  test('shutdown aborts in-flight requests and closes the inner client only after they settle', () async {
    final inner = _FakeInnerClient();
    final client = DrainingHttpClient(inner);

    // Start a request the inner client will never complete on its own.
    final pending = client.get(Uri.parse('https://example.com/api/sync'));
    await pumpEventQueue();

    // The request reached the inner client as an abortable request so it can
    // be cancelled during teardown.
    expect(inner.sent, hasLength(1));
    expect(inner.sent.single, isA<http.Abortable>());
    expect((inner.sent.single as http.Abortable).abortTrigger, isNotNull);
    expect(inner.closed, isFalse);

    // Attach the failure expectation before aborting so the in-flight request's
    // error (raised during shutdown) is observed rather than reported as
    // unhandled.
    final aborted = expectLater(pending, throwsA(isA<http.ClientException>()));

    // Graceful shutdown must abort the in-flight request, await its settlement,
    // and only then close the underlying client.
    await client.shutdown();

    expect(inner.closed, isTrue);
    expect(
      inner.hadPendingRequestsAtClose,
      isFalse,
      reason: 'inner client must be closed only after in-flight requests settle',
    );

    await aborted;
  });
}
