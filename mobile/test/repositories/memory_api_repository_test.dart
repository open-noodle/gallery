import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:immich_mobile/data/server/errors.dart';
import 'package:immich_mobile/domain/models/memory.model.dart';
import 'package:immich_mobile/repositories/memory_api.repository.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart' as api;

class MockApiService extends Mock implements ApiService {}

/// Drives the real generated [api.ApiClient] so the request it builds (path, query string) and
/// its real deserialisation are both exercised — only the transport is stubbed.
class _StubClient extends http.BaseClient {
  _StubClient(this.handler);

  final Future<http.StreamedResponse> Function(http.BaseRequest request) handler;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) => handler(request);
}

void main() {
  late api.ApiClient apiClient;
  late MemoryApiRepository sut;
  late List<Uri> requestedUris;

  http.StreamedResponse jsonResponse(String body, {int status = 200, String contentType = 'application/json'}) {
    final bytes = utf8.encode(body);
    return http.StreamedResponse(
      Stream.value(bytes),
      status,
      contentLength: bytes.length,
      headers: {'content-type': contentType},
    );
  }

  /// Replies to the next request with [response].
  void stubResponse(http.StreamedResponse Function() response) {
    apiClient.client = _StubClient((request) async {
      requestedUris.add(request.url);
      return response();
    });
  }

  void stubMemories(List<api.MemoryResponseDto> memories, {String contentType = 'application/json'}) {
    // Serialise through the generated encoder so the body matches the real wire shape.
    stubResponse(
      () => jsonResponse(jsonEncode(memories.map((memory) => memory.toJson()).toList()), contentType: contentType),
    );
  }

  api.AssetResponseDto assetDto(String id, {String ownerId = 'other-user', String? fileName}) => api.AssetResponseDto(
    id: id,
    ownerId: ownerId,
    checksum: 'checksum-$id',
    createdAt: DateTime.utc(2020, 5, 1),
    fileCreatedAt: DateTime.utc(2019, 8, 17),
    fileModifiedAt: DateTime.utc(2019, 8, 17),
    localDateTime: DateTime.utc(2019, 8, 17),
    updatedAt: DateTime.utc(2020, 5, 1),
    duration: null,
    hasMetadata: true,
    height: 1080,
    width: 1920,
    isArchived: false,
    isEdited: false,
    isFavorite: false,
    isOffline: false,
    isTrashed: false,
    originalFileName: fileName ?? '$id.jpg',
    originalPath: '/upload/$id.jpg',
    thumbhash: 'hash-$id',
    type: api.AssetTypeEnum.IMAGE,
    visibility: api.AssetVisibility.timeline,
  );

  api.MemoryResponseDto memoryDto(
    String id, {
    String ownerId = 'other-user',
    List<api.AssetResponseDto> assets = const [],
    api.MemoryType type = api.MemoryType.onThisDay,
    Map<String, Object> data = const {'year': 2019},
    DateTime? memoryAt,
  }) => api.MemoryResponseDto(
    id: id,
    ownerId: ownerId,
    assets: assets,
    createdAt: DateTime.utc(2026),
    updatedAt: DateTime.utc(2026),
    memoryAt: memoryAt ?? DateTime.utc(2019, 8, 17),
    isSaved: false,
    type: type,
    data: data,
  );

  setUp(() {
    requestedUris = [];
    apiClient = api.ApiClient(basePath: 'http://gallery.test/api');
    final apiService = MockApiService();
    when(() => apiService.apiClient).thenReturn(apiClient);
    sut = MemoryApiRepository(apiService);
  });

  group('formatDay', () {
    // The endpoint validates `for` as YYYY-MM-DD and 400s on anything else, so a missing
    // zero-pad would break the lane every January and every single-digit day — a bug that
    // would not show up in a test that only formatted "today".
    test('zero-pads a single-digit month and day', () {
      expect(MemoryApiRepository.formatDay(DateTime(2026, 1, 5)), '2026-01-05');
    });

    test('formats a two-digit month and day unchanged', () {
      expect(MemoryApiRepository.formatDay(DateTime(2026, 12, 31)), '2026-12-31');
    });

    test('uses the local calendar day, not UTC', () {
      // 00:30 local on the 18th is still the 18th, whatever the offset to UTC is.
      expect(MemoryApiRepository.formatDay(DateTime(2026, 8, 18, 0, 30)), '2026-08-18');
    });
  });

  group('getMemoryLane', () {
    // The lane must ask for a single day. Without `for` the server applies `showAt` but not
    // `hideAt`, so it returns every memory inside the retention window (365 days by default)
    // with all of its assets — megabytes, on every tab switch.
    test('requests a single day from the memories endpoint', () async {
      stubMemories([]);

      await sut.getMemoryLane();

      final uri = requestedUris.single;
      expect(uri.path, '/api/memories');
      expect(uri.queryParameters['for'], MemoryApiRepository.formatDay(DateTime.now()));
    });

    // Regression test for issue #997: the web memory lane showed memories built from
    // Space-shared photos but the mobile one did not, because mobile read the owner-scoped
    // local sync DB. This endpoint is RBAC-projected and returns memories owned by other
    // users when their assets are shared with the viewer.
    test('keeps a memory owned by another user', () async {
      stubMemories([
        memoryDto('shared-memory', ownerId: 'space-owner', assets: [assetDto('shared-asset')]),
      ]);

      final result = await sut.getMemoryLane();

      expect(result.map((memory) => memory.id), ['shared-memory']);
      expect(result.single.ownerId, 'space-owner');
      expect(result.single.assets.map((asset) => asset.id), ['shared-asset']);
    });

    test('maps the memory fields the lane renders', () async {
      stubMemories([
        memoryDto(
          'rule-memory',
          type: api.MemoryType.rule,
          data: const {'ruleId': 'pets', 'title': 'Your pets'},
          assets: [assetDto('a')],
        ),
      ]);

      final result = await sut.getMemoryLane();

      expect(result.single.type, MemoryTypeEnum.rule);
      expect(result.single.data.title, 'Your pets');
      expect(result.single.data.ruleId, 'pets');
      expect(result.single.memoryAt, DateTime.utc(2019, 8, 17));
      expect(result.single.isSaved, false);
    });

    // The server orders by memoryAt desc; the lane renders the list as-is, so any reordering
    // in the mapping would silently shuffle the carousel.
    test('preserves the order the server returned', () async {
      stubMemories([
        memoryDto('newest', memoryAt: DateTime.utc(2024, 8, 17), assets: [assetDto('a')]),
        memoryDto('middle', memoryAt: DateTime.utc(2021, 8, 17), assets: [assetDto('b')]),
        memoryDto('oldest', memoryAt: DateTime.utc(2015, 8, 17), assets: [assetDto('c')]),
      ]);

      final result = await sut.getMemoryLane();

      expect(result.map((memory) => memory.id), ['newest', 'middle', 'oldest']);
    });

    // The lane card renders assets.first, so a memory with no assets would crash it.
    test('excludes a memory with no assets', () async {
      stubMemories([
        memoryDto('empty'),
        memoryDto('full', assets: [assetDto('a')]),
      ]);

      final result = await sut.getMemoryLane();

      expect(result.map((memory) => memory.id), ['full']);
    });

    test('returns no memories when the server returns an empty list', () async {
      stubMemories([]);

      expect(await sut.getMemoryLane(), isEmpty);
    });

    // The body is decoded as UTF-8 rather than through `Response.body`, which honours the
    // charset in the headers. Gallery always emits UTF-8 JSON, so a proxy (or a server) that
    // declares a different charset would otherwise turn these into mojibake. The declared
    // charset here is what makes the two implementations diverge — `http` already defaults a
    // bare `application/json` to UTF-8, so that case cannot tell them apart.
    test('decodes non-ASCII titles and file names as UTF-8 despite a non-UTF-8 charset', () async {
      stubMemories([
        memoryDto(
          'umlauts',
          type: api.MemoryType.rule,
          data: const {'ruleId': 'pets', 'title': 'Draußen mit Bär – 日本'},
          assets: [assetDto('a', fileName: 'Grüße.jpg')],
        ),
      ], contentType: 'application/json; charset=iso-8859-1');

      final result = await sut.getMemoryLane();

      expect(result.single.data.title, 'Draußen mit Bär – 日本');
      expect(result.single.assets.single.name, 'Grüße.jpg');
    });

    // The service turns any throw into the local-DB fallback, so failures must surface.
    test('throws when the server rejects the request', () async {
      stubResponse(() => jsonResponse('{"message":"Validation failed"}', status: 400));

      await expectLater(sut.getMemoryLane(), throwsA(isA<api.ApiException>()));
    });

    test('throws when the server returns an empty body', () async {
      stubResponse(() => jsonResponse(''));

      await expectLater(sut.getMemoryLane(), throwsA(isA<NoResponseDtoError>()));
    });
  });

  group('getAllMemories', () {
    // stubMemories replies with one fixed body, so pagination needs stubResponse: the stub runs
    // per request and requestedUris is appended before it is called, so the closure can read the
    // request it is answering.

    /// Serves `/memories/statistics` with [total] (404 when it is null) and `/memories` with
    /// whatever [page] yields for the requested page number.
    void stubPagedMemories({required int? total, required List<api.MemoryResponseDto> Function(int page) page}) {
      stubResponse(() {
        final uri = requestedUris.last;
        if (uri.path.endsWith('/memories/statistics')) {
          return total == null
              ? jsonResponse('{"message":"not found"}', status: 404)
              : jsonResponse(jsonEncode({'total': total}));
        }
        final pageNumber = int.parse(uri.queryParameters['page']!);
        return jsonResponse(jsonEncode(page(pageNumber).map((memory) => memory.toJson()).toList()));
      });
    }

    /// The `page` values of the `/memories` requests only — statistics has no `page`.
    List<String> requestedPages() => requestedUris
        .where((uri) => !uri.path.endsWith('/memories/statistics'))
        .map((uri) => uri.queryParameters['page']!)
        .toList();

    // The regression this group exists for. The server LIMITs in SQL and only THEN drops
    // memories of a type the viewer disabled (`memory.service.ts` search), so page 1 arrives
    // short with 147 rows still behind it. Stopping on `batch.length < pageSize` swallowed all
    // of them; the statistics total is the signal that survives the filtering.
    test('keeps paging past a page the server filtered short', () async {
      stubPagedMemories(
        total: 150,
        page: (page) => switch (page) {
          1 => List.generate(3, (i) => memoryDto('page1-$i', assets: [assetDto('a$i')])),
          2 => List.generate(50, (i) => memoryDto('page2-$i', assets: [assetDto('b$i')])),
          _ => const [],
        },
      );

      final result = await sut.getAllMemories();

      expect(result, hasLength(53));
      expect(requestedPages(), ['1', '2']);
    });

    test('pages until the statistics total is covered and returns every memory', () async {
      stubPagedMemories(
        total: 101,
        page: (page) => page == 1
            ? List.generate(100, (i) => memoryDto('page1-$i', assets: [assetDto('a$i')]))
            : [
                memoryDto('page2-0', assets: [assetDto('b0')]),
              ],
      );

      final result = await sut.getAllMemories();

      expect(result, hasLength(101));
      expect(requestedPages(), ['1', '2']);
    });

    test('stops as soon as the total is covered, without a probing extra page', () async {
      stubPagedMemories(
        total: 100,
        page: (page) => List.generate(100, (i) => memoryDto('page$page-$i', assets: [assetDto('a$page-$i')])),
      );

      await sut.getAllMemories();

      expect(requestedPages(), ['1']);
    });

    test('falls back to an empty page when statistics are unavailable', () async {
      // No total (old server / transient failure) must still not resurrect the short-page stop:
      // page 1 is short for the same filtering reason and page 2 still has rows.
      stubPagedMemories(
        total: null,
        page: (page) => switch (page) {
          1 => List.generate(3, (i) => memoryDto('page1-$i', assets: [assetDto('a$i')])),
          2 => List.generate(50, (i) => memoryDto('page2-$i', assets: [assetDto('b$i')])),
          _ => const [],
        },
      );

      final result = await sut.getAllMemories();

      expect(result, hasLength(53));
      expect(requestedPages(), ['1', '2', '3']);
    });

    test('sends isSaved only when onlyFavorites is set, on both the count and the pages', () async {
      stubPagedMemories(total: 0, page: (_) => const []);
      await sut.getAllMemories(onlyFavorites: true);
      for (final uri in requestedUris) {
        expect(uri.queryParameters, containsPair('isSaved', 'true'), reason: '$uri');
      }

      requestedUris.clear();
      stubPagedMemories(total: 0, page: (_) => const []);
      await sut.getAllMemories();
      for (final uri in requestedUris) {
        expect(uri.queryParameters.containsKey('isSaved'), isFalse, reason: '$uri');
      }
    });

    test('omits `for` but pins isUpcoming=false, so the list is neither day-scoped nor upcoming', () async {
      stubPagedMemories(total: 0, page: (_) => const []);
      await sut.getAllMemories();

      expect(requestedUris, isNotEmpty);
      for (final uri in requestedUris) {
        expect(uri.queryParameters.containsKey('for'), isFalse, reason: '$uri');
        // Task 2 moved the fork's #486 hide-unshown default off this endpoint, so omitting the
        // flag would now pull in not-yet-shown memories. The mobile list has no upcoming section.
        expect(uri.queryParameters['isUpcoming'], 'false', reason: '$uri');
      }
    });

    test('drops memories the viewer can see no assets in', () async {
      // The list renders assets[0], exactly as the lane card does, so it needs the same
      // guarantee: memoryDto defaults assets to const [].
      stubPagedMemories(total: 1, page: (_) => [memoryDto('assetless')]);

      expect(await sut.getAllMemories(), isEmpty);
    });

    test('stops at the page cap when the server ignores `page`', () async {
      // A server that returns a full page forever would otherwise spin here indefinitely.
      stubPagedMemories(
        total: 1000000,
        page: (page) => List.generate(100, (i) => memoryDto('m$page-$i', assets: [assetDto('a$page-$i')])),
      );

      await sut.getAllMemories();

      expect(requestedPages(), hasLength(50));
    });
  });
}
