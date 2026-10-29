import 'dart:io';

import 'package:flutter_timezone/flutter_timezone.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_filters.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_queue.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_support.dart';
import 'package:openapi/api.dart';

/// Reads the device's IANA time zone. Every calendar request needs it (a missing or invalid one is a 400).
typedef LibraryCleanupTimeZoneReader = Future<String> Function();

/// The device zone from the `flutter_timezone` plugin, or `UTC` when the plugin fails or answers nothing.
Future<String> readDeviceTimeZone() async {
  try {
    final identifier = (await FlutterTimezone.getLocalTimezone()).identifier;
    return identifier.isEmpty ? 'UTC' : identifier;
  } catch (_) {
    return 'UTC';
  }
}

/// Library Cleanup's server calls, over the generated clients. It sends exactly what the web sends
/// (`web/src/lib/gallery/cleanup/`), which the contract fixtures record.
class LibraryCleanupRepository {
  const LibraryCleanupRepository({
    required CleanupApi cleanupApi,
    required TrashApi trashApi,
    this.timeZone = readDeviceTimeZone,
  }) : _cleanup = cleanupApi,
       _trash = trashApi;

  final CleanupApi _cleanup;
  final TrashApi _trash;
  final LibraryCleanupTimeZoneReader timeZone;

  static T _present<T>(T? value) => value ?? (throw ApiException(500, 'The server sent an empty response'));

  /// The calendar for the device's zone, read again on every call so a trip moves "today" with the user.
  Future<CleanupCalendarResponseDto> calendar() async => _present(await _cleanup.getCleanupCalendar(await timeZone()));

  /// The one request that tells whether this server has Library Cleanup. A 404 (no cleanup) or 403 (no permission)
  /// is a lasting no; anything else (the network, a 5xx, a rejected session) is a no for now, asked again next time.
  Future<LibraryCleanupSupport> probe() async {
    try {
      return LibraryCleanupSupport.supported(await calendar());
    } on ApiException catch (error) {
      return error.code == HttpStatus.notFound || error.code == HttpStatus.forbidden
          ? const LibraryCleanupSupport.unsupported()
          : const LibraryCleanupSupport.unavailable();
    } catch (_) {
      return const LibraryCleanupSupport.unavailable();
    }
  }

  Future<List<CleanupRewindYearDto>> rewindYears(int monthDay) async =>
      _present(await _cleanup.getCleanupRewindYears(monthDay)).years;

  Future<List<CleanupAssetDto>> rewindAssets(int monthDay, int year) async =>
      _present(await _cleanup.getCleanupRewindAssets(monthDay, year)).assets;

  /// One page of a queue. Filters go on the request the way the web sends them: Blurry's strictness, reason and
  /// hide-faces, Space hogs' type and minimum size, and nothing for the other queues.
  Future<CleanupQueuePageDto> queuePage(
    LibraryCleanupQueue queue, {
    String? cursor,
    int limit = libraryCleanupPageSize,
    LibraryCleanupFilters? filters,
  }) async {
    final listQueue = queue.listQueue ?? (throw ArgumentError('${queue.name} is not a paged queue'));
    final applied = filters ?? LibraryCleanupFilters.defaults(queue);
    return _present(
      await _cleanup.getCleanupQueue(
        listQueue,
        cursor: cursor,
        limit: limit,
        strictness: applied.isBlurry ? applied.strictness : null,
        reason: applied.isBlurry ? applied.reason : null,
        hideFaces: applied.isBlurry ? applied.hideFaces : null,
        type: applied.isSpaceHogs ? applied.type : null,
        minSize: applied.isSpaceHogs ? applied.minSize : null,
      ),
    );
  }

  Future<CleanupCountResponseDto> queueCount(LibraryCleanupQueue queue, {LibraryCleanupFilters? filters}) async {
    final countQueue = queue.countQueue ?? (throw ArgumentError('${queue.name} has no count'));
    final applied = filters;
    return _present(
      await _cleanup.getCleanupQueueCount(
        countQueue,
        strictness: applied != null && applied.isBlurry ? applied.strictness : null,
        reason: applied != null && applied.isBlurry ? applied.reason : null,
        hideFaces: applied != null && applied.isBlurry ? applied.hideFaces : null,
        type: applied != null && applied.isSpaceHogs ? applied.type : null,
        minSize: applied != null && applied.isSpaceHogs ? applied.minSize : null,
      ),
    );
  }

  /// A queue's first photo, for its card on the overview: one photo, no filters, as the web hub asks.
  Future<CleanupAssetDto?> queueCover(LibraryCleanupQueue queue) async {
    final listQueue = queue.listQueue ?? (throw ArgumentError('${queue.name} is not a paged queue'));
    return _present(await _cleanup.getCleanupQueue(listQueue, limit: 1)).items.firstOrNull;
  }

  Future<CleanupTrashResponseDto> trash() async => _present(await _cleanup.getCleanupTrash());

  Future<CleanupCommitResponseDto> commit({
    required CleanupQueue queue,
    required List<String> trashIds,
    required List<String> favoriteIds,
    required List<String> keepIds,
    int? completeMonthDay,
  }) async => _present(
    await _cleanup.commitCleanup(
      CleanupCommitDto(
        queue: queue,
        trashIds: Optional.present(trashIds),
        favoriteIds: Optional.present(favoriteIds),
        keepIds: Optional.present(keepIds),
        completeMonthDay: completeMonthDay == null ? const Optional.absent() : Optional.present(completeMonthDay),
      ),
    ),
  );

  /// Which of [assetIds] are in a shared space (the caller's own, in at least one space).
  Future<Set<String>> idsInSpaces(List<String> assetIds) async {
    final found = <String>{};
    for (final chunk in libraryCleanupChunk(assetIds)) {
      found.addAll(_present(await _cleanup.getCleanupAssetsInSpaces(CleanupInSpacesDto(assetIds: chunk))).assetIds);
    }
    return found;
  }

  /// Takes the trashed assets back out of the trash.
  Future<void> restoreAssets(List<String> ids) async {
    await _trash.restoreAssets(BulkIdsDto(ids: ids));
  }
}
