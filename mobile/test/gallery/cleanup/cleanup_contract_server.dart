import 'dart:async';
import 'dart:convert';
import 'dart:io';

import '../search/search_contract_server.dart';

/// A strict stand-in for the server: it answers only requests that match a recorded cleanup contract fixture
/// (test/fixtures/cleanup_contract/README.md), and records every other request as unmatched. A test asserts
/// [unmatched] is empty at the end, so the stand-in is never more permissive than the real server.
///
/// Cleanup requests change the server, so the same request can have several fixtures with different responses. They are
/// served in file order, each once: the third identical request needs a third fixture, or it is unmatched.
class CleanupContractServer {
  CleanupContractServer._(this._server, this._fixtures);

  static const fixtureDir = 'test/fixtures/cleanup_contract';

  final HttpServer _server;
  final List<ContractFixture> _fixtures;
  final _used = <ContractFixture>{};

  /// Every request received, as `METHOD /path`.
  final requests = <String>[];

  /// Requests no unserved fixture matched, with their query and body.
  final unmatched = <String>[];

  /// Names of the fixtures served, in order.
  final served = <String>[];

  String get endpoint => 'http://${_server.address.host}:${_server.port}/api';

  /// Serves the fixtures whose name [include] accepts (all of them by default).
  static Future<CleanupContractServer> start({bool Function(String name)? include}) async {
    final fixtures = loadContractFixtures(fixtureDir).where((f) => include?.call(f.name) ?? true).toList();
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final contract = CleanupContractServer._(server, fixtures);
    server.listen((request) => unawaited(contract._handle(request).catchError((_) {})));
    return contract;
  }

  Future<void> close() => _server.close(force: true);

  /// Waits until [count] fixtures have been served in total, then lets the client decode the last response.
  Future<void> waitForServed(int count, {Duration timeout = const Duration(seconds: 10)}) async {
    final deadline = DateTime.now().add(timeout);
    while (served.length < count) {
      if (DateTime.now().isAfter(deadline)) {
        throw TimeoutException('served ${served.length} of $count; unmatched: $unmatched');
      }
      await Future<void>.delayed(const Duration(milliseconds: 5));
    }
    await Future<void>.delayed(const Duration(milliseconds: 30));
  }

  Future<void> _handle(HttpRequest request) async {
    final raw = await utf8.decoder.bind(request).join();
    final body = raw.isEmpty ? contractNoBody : jsonDecode(raw);
    final query = request.uri.queryParametersAll;
    requests.add('${request.method} ${request.uri.path}');

    ContractFixture? fixture;
    for (final candidate in _fixtures) {
      if (!_used.contains(candidate) && candidate.matches(request.method, request.uri.path, query, body)) {
        fixture = candidate;
        break;
      }
    }
    if (fixture == null) {
      unmatched.add('${request.method} ${request.uri.path} query=$query body=$raw');
      request.response.statusCode = 599;
      await request.response.close();
      return;
    }
    _used.add(fixture);
    served.add(fixture.name);
    request.response
      ..statusCode = fixture.status
      ..headers.contentType = ContentType.json
      ..write(jsonEncode(fixture.responseBody));
    await request.response.close();
  }
}

/// Fixture label → stable id, from every fixture's `ids` legend (`asset:q1` → its fake UUID).
Map<String, String> cleanupContractIds() {
  final ids = <String, String>{};
  for (final file in Directory(CleanupContractServer.fixtureDir).listSync().whereType<File>()) {
    if (!file.path.endsWith('.json')) {
      continue;
    }
    final legend = (jsonDecode(file.readAsStringSync()) as Map<String, dynamic>)['ids'] as Map<String, dynamic>? ?? {};
    legend.forEach((uuid, label) => ids[label as String] = uuid);
  }
  return ids;
}
