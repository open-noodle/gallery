import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Regression guard for the iOS background-worker teardown crash (EXC_CRASH /
/// SIGABRT in `cupertino_http`'s `_StreamingTaskDelegate` after the headless
/// engine is destroyed). The background isolate must drain in-flight HTTP
/// requests before the native side calls `engine.destroyContext()`.
///
/// `BackgroundWorker.swift` is upstream Immich code that gets rebased; this
/// fork-only Dart wiring is easy to drop on a rebase, so assert it stays put.
void main() {
  final source = File('lib/domain/services/background_worker.service.dart').readAsStringSync();

  test('background isolate enables in-flight HTTP tracking before init', () {
    expect(source, contains('NetworkRepository.enableShutdownTracking()'));

    final enableAt = source.indexOf('NetworkRepository.enableShutdownTracking()');
    final initDomainAt = source.indexOf('Bootstrap.initDomain(');
    expect(enableAt, greaterThanOrEqualTo(0));
    expect(initDomainAt, greaterThan(enableAt), reason: 'tracking must be enabled before Bootstrap.initDomain');
  });

  test('cleanup drains in-flight HTTP requests before tearing down the isolate', () {
    expect(source, contains('await NetworkRepository.shutdown()'));

    final shutdownAt = source.indexOf('await NetworkRepository.shutdown()');
    final driftCloseAt = source.indexOf('await _drift.close()');
    expect(shutdownAt, greaterThanOrEqualTo(0));
    expect(driftCloseAt, greaterThan(shutdownAt), reason: 'HTTP must be drained before the rest of cleanup runs');
  });
}
