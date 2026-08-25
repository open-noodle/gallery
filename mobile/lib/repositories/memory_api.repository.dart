import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/data/server/errors.dart';
import 'package:immich_mobile/domain/models/memory.model.dart';
import 'package:immich_mobile/extensions/asset_extensions.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/repositories/api.repository.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:openapi/api.dart';

final memoryApiRepositoryProvider = Provider((ref) => MemoryApiRepository(ref.watch(apiServiceProvider)));

class MemoryApiRepository extends ApiRepository {
  final ApiService _apiService;

  MemoryApiRepository(this._apiService);

  /// Today's memory lane as the server sees it, including memories built from photos shared
  /// with the viewer through a Space — the same call the web memory lane makes.
  ///
  /// Memories are generated per owner and the `memory` / `memory_asset` sync streams are
  /// owner-scoped, so the local sync DB can never hold another user's memory. This endpoint
  /// widens the set to anything the viewer can see, then filters each memory's assets down to
  /// the ones the viewer may view and drops the memories left empty. See issue #997.
  Future<List<DriftMemory>> getMemoryLane() async {
    final dtos = await _searchMemoriesFor(DateTime.now());

    return dtos
        .map(_toDriftMemory)
        // The lane card renders assets.first. The server already drops asset-less memories,
        // and the local Drift query drops them via an inner join; keep the same guarantee.
        .where((memory) => memory.assets.isNotEmpty)
        .toList(growable: false);
  }

  /// `GET /memories?for=<day>`.
  ///
  /// Hand-rolled rather than calling `MemoriesApi.searchMemories`, because that method types
  /// `for` as a `DateTime` and the generated client serialises every `DateTime` query param as
  /// a full ISO timestamp (`api_helper.dart` `parameterToString`), which the endpoint rejects
  /// with a 400 — it validates `for` as `YYYY-MM-DD` (`isoDateToDate`).
  ///
  /// Omitting `for` is not a workaround: the server applies `showAt` against now either way,
  /// but only applies `hideAt` when `for` is present, so without it every memory still inside
  /// the retention window (365 days by default) comes back with all of its assets attached.
  ///
  /// Same escape hatch as [AuthApiRepository.demoLogin]; both use the generated `ApiClient`
  /// directly, so authentication and the base path are still applied by `invokeAPI`.
  Future<List<MemoryResponseDto>> _searchMemoriesFor(DateTime day) async {
    final response = await _apiService.apiClient.invokeAPI(
      '/memories',
      'GET',
      [QueryParam('for', formatDay(day))],
      null,
      <String, String>{},
      <String, String>{},
      null,
    );

    if (response.statusCode >= 400) {
      throw ApiException(response.statusCode, response.body);
    }

    // Mirrors the generated client's `_decodeBodyBytes` (library-private, so not reusable):
    // decode as UTF-8 rather than trusting the charset `http` infers from the headers, so
    // non-ASCII memory titles and file names survive the round trip.
    final body = response.bodyBytes.isEmpty ? '' : utf8.decode(response.bodyBytes);
    if (body.isEmpty) {
      throw const NoResponseDtoError();
    }

    final decoded = await _apiService.apiClient.deserializeAsync(body, 'List<MemoryResponseDto>');
    return (decoded as List).cast<MemoryResponseDto>();
  }

  /// Every memory the viewer can see, including memories built from photos shared with them
  /// through a Space, via the paginated `GET /memories` that immich-28675 added.
  ///
  /// Deliberately does NOT reuse [getMemoryLane]: that call is scoped to a single day
  /// (`for=<today>`), which is what the lane wants and the list does not.
  ///
  /// It also does not send `for` at all. The server only applies `hideAt` when `for` is
  /// present, so an unscoped call is the only way to get the full list -- at the cost of
  /// `showAt` still being applied against now, which omits not-yet-shown memories. The
  /// mobile list has no upcoming section, so that is the right trade here.
  ///
  /// `isUpcoming: false` is sent explicitly and unconditionally: `searchAccessible()` (which
  /// serves this endpoint) passes `hideUnshownByDefault: false`, so omitting `isUpcoming`
  /// entirely would let not-yet-shown memories back in -- unlike [getMemoryLane], which keeps
  /// the hide-unshown default via `for`.
  Future<List<DriftMemory>> getAllMemories({bool onlyFavorites = false}) async {
    const pageSize = 100;
    // Backstop, not a product limit: a server that ignored `page` would otherwise loop here
    // forever. 50 pages is 5000 memories, far past any real library's retention window.
    const maxPages = 50;
    final dtos = <MemoryResponseDto>[];

    for (var page = 1; page <= maxPages; page++) {
      final batch = await _searchMemoriesPage(page: page, size: pageSize, onlyFavorites: onlyFavorites);
      dtos.addAll(batch);
      // A short page means the server has nothing left; this is also the stop condition when
      // the very first page comes back empty.
      if (batch.length < pageSize) {
        break;
      }
    }

    return dtos.map(_toDriftMemory).where((memory) => memory.assets.isNotEmpty).toList(growable: false);
  }

  /// One page of `GET /memories?page=&size=`.
  ///
  /// Hand-rolled for the same reason as [_searchMemoriesFor]: the generated client is used
  /// directly through `invokeAPI` so auth and the base path still apply.
  Future<List<MemoryResponseDto>> _searchMemoriesPage({
    required int page,
    required int size,
    required bool onlyFavorites,
  }) async {
    final response = await _apiService.apiClient.invokeAPI(
      '/memories',
      'GET',
      [
        QueryParam('page', page.toString()),
        QueryParam('size', size.toString()),
        const QueryParam('isUpcoming', 'false'),
        if (onlyFavorites) const QueryParam('isSaved', 'true'),
      ],
      null,
      <String, String>{},
      <String, String>{},
      null,
    );

    if (response.statusCode >= 400) {
      throw ApiException(response.statusCode, response.body);
    }

    final body = response.bodyBytes.isEmpty ? '' : utf8.decode(response.bodyBytes);
    if (body.isEmpty) {
      throw const NoResponseDtoError();
    }

    final decoded = await _apiService.apiClient.deserializeAsync(body, 'List<MemoryResponseDto>');
    return (decoded as List).cast<MemoryResponseDto>();
  }

  /// The local calendar day as `YYYY-MM-DD` — the same value web sends
  /// (`DateTime.now().toFormat('yyyy-MM-dd')`), so both clients ask for the same window.
  ///
  /// Formatted by hand rather than with `DateFormat('yyyy-MM-dd')`: `intl` renders digits in
  /// the ambient locale's numbering system, so a locale with non-Latin digits would produce a
  /// string the endpoint rejects.
  @visibleForTesting
  static String formatDay(DateTime day) =>
      '${day.year.toString().padLeft(4, '0')}-${day.month.toString().padLeft(2, '0')}-${day.day.toString().padLeft(2, '0')}';

  static DriftMemory _toDriftMemory(MemoryResponseDto dto) => DriftMemory(
    id: dto.id,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
    deletedAt: dto.deletedAt.orElse(null),
    ownerId: dto.ownerId,
    type: _toMemoryType(dto.type),
    // `title` / `subtitle` on the DTO are mirrored straight out of `data` by the server
    // (see mapMemory), so the raw map alone carries everything the lane renders.
    data: MemoryData(Map<String, dynamic>.from(dto.data)),
    isSaved: dto.isSaved,
    memoryAt: dto.memoryAt,
    seenAt: dto.seenAt.orElse(null),
    showAt: dto.showAt.orElse(null),
    hideAt: dto.hideAt.orElse(null),
    assets: dto.assets.map((asset) => asset.toDto()).toList(growable: false),
  );

  static MemoryTypeEnum _toMemoryType(MemoryType type) => switch (type) {
    MemoryType.onThisDay => MemoryTypeEnum.onThisDay,
    MemoryType.rule => MemoryTypeEnum.rule,
  };
}
