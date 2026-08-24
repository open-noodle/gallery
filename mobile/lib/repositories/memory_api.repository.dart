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
