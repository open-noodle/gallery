import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:collection/collection.dart';

/// A strict stand-in for the server: it answers only requests that match a recorded search contract fixture
/// (test/fixtures/search_contract/README.md, "Matching rule"), and records every other request as unmatched. A test
/// asserts [unmatched] is empty at the end, so the stand-in is never more permissive than the real server.
class SearchContractServer {
  SearchContractServer._(this._server, this._fixtures);

  static const fixtureDir = 'test/fixtures/search_contract';

  final HttpServer _server;
  final List<ContractFixture> _fixtures;

  /// Every request received, as `METHOD /path`.
  final requests = <String>[];

  /// Requests no fixture matched, with their query and body.
  final unmatched = <String>[];

  /// Names of the fixtures served, in order.
  final served = <String>[];

  String get endpoint => 'http://${_server.address.host}:${_server.port}/api';

  /// Serves the fixtures whose name [include] accepts (all of them by default).
  static Future<SearchContractServer> start({bool Function(String name)? include}) async {
    final fixtures = loadContractFixtures().where((f) => include?.call(f.name) ?? true).toList();
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final contract = SearchContractServer._(server, fixtures);
    server.listen((request) => unawaited(contract._handle(request).catchError((_) {})));
    return contract;
  }

  Future<void> close() => _server.close(force: true);

  /// Waits until [count] fixtures have been served in total.
  Future<void> waitForServed(int count, {Duration timeout = const Duration(seconds: 10)}) async {
    final deadline = DateTime.now().add(timeout);
    while (served.length < count) {
      if (DateTime.now().isAfter(deadline)) {
        throw TimeoutException('served ${served.length} of $count; unmatched: $unmatched');
      }
      await Future<void>.delayed(const Duration(milliseconds: 5));
    }
    // Let the client decode the last response and the providers merge it.
    await Future<void>.delayed(const Duration(milliseconds: 30));
  }

  Future<void> _handle(HttpRequest request) async {
    final raw = await utf8.decoder.bind(request).join();
    final body = raw.isEmpty ? _absent : jsonDecode(raw);
    final query = request.uri.queryParametersAll;
    requests.add('${request.method} ${request.uri.path}');

    final fixture = _fixtures.firstWhereOrNull((f) => f.matches(request.method, request.uri.path, query, body));
    if (fixture == null) {
      unmatched.add('${request.method} ${request.uri.path} query=$query body=$raw');
      request.response.statusCode = 599;
      await request.response.close();
      return;
    }
    served.add(fixture.name);
    request.response
      ..statusCode = fixture.status
      ..headers.contentType = ContentType.json
      ..write(jsonEncode(fixture.responseBody));
    await request.response.close();
  }
}

const _absent = Object();

class ContractFixture {
  final String name;
  final String method;
  final String path;
  final Map<String, List<String>>? query;
  final Object? body;
  final bool hasBody;
  final int status;
  final Object? responseBody;

  const ContractFixture({
    required this.name,
    required this.method,
    required this.path,
    required this.query,
    required this.body,
    required this.hasBody,
    required this.status,
    required this.responseBody,
  });

  static const _equality = DeepCollectionEquality();

  bool matches(String method, String path, Map<String, List<String>> requestQuery, Object? requestBody) {
    if (method != this.method || path != this.path) {
      return false;
    }
    if (!_equality.equals(requestQuery, query ?? const <String, List<String>>{})) {
      return false;
    }
    if (!hasBody) {
      return identical(requestBody, _absent);
    }
    return !identical(requestBody, _absent) && _equality.equals(requestBody, body);
  }
}

List<ContractFixture> loadContractFixtures() {
  final files =
      Directory(
          SearchContractServer.fixtureDir,
        ).listSync().whereType<File>().where((f) => f.path.endsWith('.json')).toList()
        ..sort((a, b) => a.path.compareTo(b.path));
  return [
    for (final file in files)
      () {
        final json = jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
        final request = json['request'] as Map<String, dynamic>;
        final response = json['response'] as Map<String, dynamic>;
        final query = request['query'] as Map<String, dynamic>?;
        return ContractFixture(
          name: file.uri.pathSegments.last.replaceAll('.json', ''),
          method: request['method'] as String,
          path: request['path'] as String,
          query: query?.map(
            (key, value) => MapEntry(key, value is List ? value.map((v) => '$v').toList() : ['$value']),
          ),
          body: request['body'],
          hasBody: request.containsKey('body'),
          status: response['status'] as int,
          responseBody: response['body'],
        );
      }(),
  ];
}

/// Fixture label → stable id, from every fixture's `ids` legend (`album:trip` → its fake UUID).
Map<String, String> contractIds() {
  final ids = <String, String>{};
  for (final file in Directory(SearchContractServer.fixtureDir).listSync().whereType<File>()) {
    if (!file.path.endsWith('.json')) {
      continue;
    }
    final legend = (jsonDecode(file.readAsStringSync()) as Map<String, dynamic>)['ids'] as Map<String, dynamic>? ?? {};
    legend.forEach((uuid, label) => ids[label as String] = uuid);
  }
  return ids;
}
