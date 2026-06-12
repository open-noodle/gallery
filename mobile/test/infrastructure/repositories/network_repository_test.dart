import 'dart:ffi';

import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:immich_mobile/infrastructure/repositories/draining_http_client.dart';
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

  test('init wraps the client in a DrainingHttpClient when tracking is enabled on iOS', () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    NetworkRepository.enableShutdownTracking();

    await NetworkRepository.init();

    expect(NetworkRepository.client, isA<DrainingHttpClient>());
  });

  // Guards the contract the gentle-isolate teardown relies on: when tracking is
  // enabled, shutdown must drain and close the underlying client so no in-flight
  // request can call back into a dead isolate. See [DrainingHttpClient].
  test('shutdown drains and closes the tracked client', () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    NetworkRepository.enableShutdownTracking();
    await NetworkRepository.init();

    await NetworkRepository.shutdown();

    expect(built.single.closed, isTrue);
  });

  // Gentle isolates call shutdown unconditionally at teardown, including on
  // platforms / runs where tracking was never enabled. That must be harmless.
  test('shutdown is a safe no-op when tracking is disabled', () async {
    await NetworkRepository.init();

    await NetworkRepository.shutdown();

    expect(built.single.closed, isFalse);
  });

  // A gentle worker isolate can be reused for another task after it drained and
  // closed its client. The shared native session pointer is unchanged, so init
  // must NOT short-circuit — it has to rebuild a live client, or the reused
  // isolate would keep using a closed one.
  test('init rebuilds after shutdown even when the pointer is unchanged', () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    NetworkRepository.enableShutdownTracking();
    await NetworkRepository.init();

    await NetworkRepository.shutdown();
    await NetworkRepository.init();

    expect(factoryCalls, 2);
    expect(NetworkRepository.client, isA<DrainingHttpClient>());
  });
}
