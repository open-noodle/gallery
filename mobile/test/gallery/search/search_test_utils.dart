import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:immich_mobile/gallery/search/search.repository.dart';
import 'package:immich_mobile/gallery/search/search_options.model.dart';
import 'package:immich_mobile/gallery/search/search_scope.dart';
import 'package:openapi/api.dart';

/// One request as it left the generated client.
class CapturedRequest {
  final String method;
  final String path;
  final Map<String, List<String>> query;
  final Object? body;

  const CapturedRequest(this.method, this.path, this.query, this.body);

  @override
  String toString() => '$method $path $query ${jsonEncode(body)}';
}

const emptySearchResponse = {
  'albums': {'count': 0, 'facets': <Object>[], 'items': <Object>[], 'total': 0},
  'assets': {'count': 0, 'facets': <Object>[], 'items': <Object>[], 'total': 0, 'nextPage': null},
};

/// Answers with a plausible empty body per endpoint, so the generated client decodes it.
Object? defaultResponse(String method, String path) => switch (path) {
  '/api/search/options' => <String, Object>{},
  '/api/timeline/buckets' => <Object>[],
  '/api/search/smart' || '/api/search/metadata' => emptySearchResponse,
  '/api/search/statistics' => {'total': 0},
  '/api/search/suggestions/filters' => {
    'cameraMakes': <Object>[],
    'countries': <Object>[],
    'hasAssetsInAlbum': false,
    'hasAssetsNotInAlbum': false,
    'hasFavorites': false,
    'hasNoGpsAssets': false,
    'hasNoPlaceNameAssets': false,
    'hasUnnamedPeople': false,
    'mediaTypes': <Object>[],
    'people': <Object>[],
    'ratings': <Object>[],
    'tags': <Object>[],
  },
  '/api/search/suggestions' => <Object>[],
  _ => throw StateError('no default response for $method $path'),
};

/// The real generated client over an in-memory HTTP client that records every request.
class RecordingApi {
  final requests = <CapturedRequest>[];
  final Object? Function(String method, String path) respond;
  late final ApiClient client;

  RecordingApi({this.respond = defaultResponse}) {
    client = ApiClient(basePath: 'http://search.test/api')..client = MockClient(_handle);
  }

  Future<http.Response> _handle(http.Request request) async {
    final uri = request.url;
    requests.add(
      CapturedRequest(
        request.method,
        uri.path,
        uri.queryParametersAll,
        request.body.isEmpty ? null : jsonDecode(request.body),
      ),
    );
    return http.Response(
      jsonEncode(respond(request.method, uri.path)),
      200,
      headers: {'content-type': 'application/json; charset=utf-8'},
    );
  }

  GallerySearchRepository get repository => GallerySearchRepository(
    searchApi: SearchApi(client),
    timelineApi: TimelineApi(client),
    serverApi: ServerApi(client),
  );
}

/// A recorded contract fixture (test/fixtures/search_contract/README.md).
Map<String, Object?> loadContractFixture(String name) =>
    jsonDecode(File('test/fixtures/search_contract/$name.json').readAsStringSync()) as Map<String, Object?>;

/// The recorded response body of a fixture.
Object? contractResponseBody(String name) => (loadContractFixture(name)['response']! as Map<String, Object?>)['body'];

/// The options of a recorded per-dimension set (`dimension-<prefix>-*`), decoded by the real client and repository.
Future<SearchOptions> loadDimensionOptions(String prefix) async {
  var options = const SearchOptions();
  for (final dimension in [
    'availability',
    'total',
    'time',
    'people',
    'tags',
    'places',
    'cameras',
    'ratings',
    'mediaTypes',
  ]) {
    final api = RecordingApi(respond: (_, _) => contractResponseBody('dimension-$prefix-$dimension'));
    options = options.merge(await api.repository.options(const SearchParams()));
  }
  return options;
}

/// The Places sheet folds every country: a city row shows only under an open one. When [key] is a city row not on
/// screen, opens the folded countries first, as a user would before picking a city.
Future<void> revealPlaceCity(WidgetTester tester, String key) async {
  if (!key.startsWith('search-place-city-') || find.byKey(Key(key)).evaluate().isNotEmpty) {
    return;
  }
  final carets = find.byWidgetPredicate(
    (w) => w.key is ValueKey<String> && (w.key! as ValueKey<String>).value.startsWith('search-place-cities-'),
  );
  for (final caret in carets.evaluate().map((e) => e.widget.key! as ValueKey<String>).toList()) {
    // A folded country's fold holds no city rows.
    final country = caret.value.substring('search-place-cities-'.length);
    final cities = find.descendant(
      of: find.byKey(Key('search-place-fold-$country')),
      matching: find.byWidgetPredicate(
        (w) => w.key is ValueKey<String> && (w.key! as ValueKey<String>).value.startsWith('search-place-city-'),
      ),
    );
    if (cities.evaluate().isNotEmpty) {
      continue;
    }
    await tester.ensureVisible(find.byKey(caret));
    await tester.pump();
    await tester.tap(find.byKey(caret));
    // Let the cities finish folding open before anything taps them.
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    if (find.byKey(Key(key)).evaluate().isNotEmpty) {
      return;
    }
  }
}
