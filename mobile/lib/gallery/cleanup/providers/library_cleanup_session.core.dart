import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_marks.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_queue.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_session_state.dart';
import 'package:immich_mobile/gallery/cleanup/repositories/library_cleanup.repository.dart';
import 'package:immich_mobile/gallery/cleanup/repositories/library_cleanup_marks_store.dart';
import 'package:openapi/api.dart';

/// Asked once a commit has trash in it and the user must confirm (a photo in a shared space or an external library, or
/// the trash is off and the delete is permanent). Resolves to true to go ahead.
typedef LibraryCleanupConfirm = Future<bool> Function(LibraryCleanupTrashCheck check);

/// The part of a session that does not depend on Riverpod: the marks, their saved copy, and committing them. The
/// rewind and every queue use it, so they mark, undo, save and apply the same way.
class LibraryCleanupSessionCore {
  LibraryCleanupSessionCore({
    required this.repository,
    required this.store,
    required this.queue,
    required this.storeKey,
    required this.trashEnabled,
  });

  final LibraryCleanupRepository repository;
  final LibraryCleanupMarksStore store;
  final LibraryCleanupQueue queue;
  final String storeKey;

  /// Whether the server's trash is on, read when committing (with it off a trash deletes permanently).
  final bool Function() trashEnabled;

  LibraryCleanupMarkBook book = LibraryCleanupMarkBook();

  /// Saves the marks as they stand (a write per change; the store keeps them in order).
  Future<void> persist() => store.save(storeKey, book);

  /// Asks the server which of [trashIds] are in a shared space or an external library. Throws when the lookup fails.
  Future<LibraryCleanupTrashCheck> checkTrash(List<String> trashIds) async {
    final found = trashIds.isEmpty
        ? (inSpaces: const <String>{}, external: const <String>{})
        : await repository.trashLookup(trashIds);
    return LibraryCleanupTrashCheck(
      trashCount: trashIds.length,
      inSpacesCount: found.inSpaces.length,
      externalCount: found.external.length,
      trashEnabled: trashEnabled(),
    );
  }

  /// Commits the marks, plus [extraKeepIds] (photos with no mark that are kept anyway, "keep the rest").
  ///
  /// Mirrors the web's `RewindSession.#send`: chunks of at most [libraryCleanupMaxIds] ids per list, one request per
  /// chunk index, and `completeMonthDay` ([completeMonthDay], only for a finished day) on the last request only. A
  /// request that fails stops the run: the chunks before it stay applied and settled, the rest stay pending.
  Future<LibraryCleanupApplyResult> apply({
    List<String> extraKeepIds = const [],
    int? completeMonthDay,
    LibraryCleanupConfirm? confirm,
    void Function(LibraryCleanupApplyProgress progress)? onProgress,
  }) async {
    final commitQueue = queue.commitQueue ?? (throw StateError('${queue.name} does not commit through cleanup'));
    final trash = book.ids(LibraryCleanupMark.trash);
    final favorite = book.ids(LibraryCleanupMark.favorite);
    final keep = [...book.ids(LibraryCleanupMark.keep), ...extraKeepIds];

    // The shared-space lookup comes first and a commit never happens without it: if it fails, nothing is trashed.
    if (trash.isNotEmpty) {
      final LibraryCleanupTrashCheck check;
      try {
        check = await checkTrash(trash);
      } catch (error) {
        return LibraryCleanupApplyResult(status: LibraryCleanupApplyStatus.lookupFailed, error: error);
      }
      if (check.needsConfirmation && (confirm == null || !await confirm(check))) {
        return const LibraryCleanupApplyResult(status: LibraryCleanupApplyStatus.cancelled);
      }
    }

    final trashChunks = libraryCleanupChunk(trash);
    final favoriteChunks = libraryCleanupChunk(favorite);
    final keepChunks = libraryCleanupChunk(keep);
    var calls = [trashChunks.length, favoriteChunks.length, keepChunks.length].reduce((a, b) => a > b ? a : b);
    if (completeMonthDay != null && calls == 0) {
      calls = 1;
    }

    final trashed = <String>[];
    final skipped = <CleanupSkippedDto>[];
    final applied = <String>{};
    var favorited = 0;
    var kept = 0;
    var done = 0;
    var dayCompleted = false;
    Object? failure;
    onProgress?.call(LibraryCleanupApplyProgress(done: 0, total: calls));
    try {
      for (var i = 0; i < calls; i++) {
        final trashChunk = i < trashChunks.length ? trashChunks[i] : const <String>[];
        final favoriteChunk = i < favoriteChunks.length ? favoriteChunks[i] : const <String>[];
        final keepChunk = i < keepChunks.length ? keepChunks[i] : const <String>[];
        final isLast = i == calls - 1;
        final response = await repository.commit(
          queue: commitQueue,
          trashIds: trashChunk,
          favoriteIds: favoriteChunk,
          keepIds: keepChunk,
          // The day is only complete once every mark has landed, so only the last request says so.
          completeMonthDay: isLast ? completeMonthDay : null,
        );
        trashed.addAll(response.trashed);
        skipped.addAll(response.skipped);
        favorited += response.favorited;
        kept += response.kept;
        applied.addAll([...trashChunk, ...favoriteChunk, ...keepChunk]);
        dayCompleted = isLast && completeMonthDay != null;
        done = i + 1;
        // This chunk is on the server now; a retry after a later failure must not send it again.
        book.settle([...trashChunk, ...favoriteChunk, ...keepChunk]);
        onProgress?.call(LibraryCleanupApplyProgress(done: done, total: calls));
      }
    } catch (error) {
      failure = error;
    }
    await persist();
    return LibraryCleanupApplyResult(
      status: failure == null ? LibraryCleanupApplyStatus.applied : LibraryCleanupApplyStatus.failed,
      trashed: trashed,
      favorited: favorited,
      kept: kept,
      skipped: skipped,
      appliedIds: applied,
      chunksApplied: done,
      chunksTotal: calls,
      error: failure,
      trashUndoAvailable: trashEnabled() && trashed.isNotEmpty,
      dayCompleted: dayCompleted,
    );
  }

  /// Undoes the trash of an applied commit by restoring exactly the ids the server trashed. With the trash off there
  /// is nothing to restore and it does nothing. Resolves to the ids restored.
  Future<List<String>> restoreTrashed(LibraryCleanupApplyResult result) async {
    if (!result.trashUndoAvailable) {
      return const [];
    }
    await repository.restoreAssets(result.trashed);
    return result.trashed;
  }
}
