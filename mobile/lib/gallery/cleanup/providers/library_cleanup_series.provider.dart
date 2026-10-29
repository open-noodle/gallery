import 'dart:async';
import 'dart:io';

import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_queue.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_series.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_session_state.dart';
import 'package:immich_mobile/gallery/cleanup/providers/library_cleanup.providers.dart';
import 'package:immich_mobile/gallery/cleanup/providers/library_cleanup_session.core.dart';
import 'package:immich_mobile/gallery/cleanup/repositories/library_cleanup_marks_store.dart';
import 'package:openapi/api.dart';

/// The series queues: Bursts and Duplicates share the series card (specs/2026-10-29-mobile-library-cleanup-design.md,
/// "Queues: Bursts and Duplicates").
const libraryCleanupSeriesQueues = {LibraryCleanupQueue.bursts, LibraryCleanupQueue.duplicates};

/// The session was refused the duplicates (403): the user has no duplicate permission (an API-key session). The
/// overview then shows no Duplicates card and asks nothing more about duplicates.
final libraryCleanupDuplicatesForbiddenProvider = StateProvider<bool>((ref) {
  ref.watch(libraryCleanupUserIdProvider);
  return false;
});

/// The most groups one resolve request carries ("one `POST /duplicates/resolve` per batch of groups").
const libraryCleanupResolveBatch = 50;

/// The most pages a restore reads looking for the saved marks' series.
const _maxRestorePages = 100;

/// What a series session shows: the series loaded so far, each frame's mark, and the decision on each series.
class LibraryCleanupSeriesState {
  const LibraryCleanupSeriesState({
    required this.queue,
    this.status = LibraryCleanupLoadStatus.loading,
    this.error,
    this.series = const [],
    this.decisions = const {},
    this.frames = const {},
    this.canUndo = false,
    this.restoredMarks = false,
    this.hasMore = false,
    this.loadingMore = false,
    this.applying,
  });

  final LibraryCleanupQueue queue;
  final LibraryCleanupLoadStatus status;
  final Object? error;

  /// Every series loaded, in the server's order, decided or not.
  final List<LibraryCleanupSeries> series;
  final Map<String, LibraryCleanupSeriesDecision> decisions;

  /// Frames whose mark the user changed: kept (true) or trashed (false).
  final Map<String, bool> frames;
  final bool canUndo;
  final bool restoredMarks;
  final bool hasMore;
  final bool loadingMore;
  final LibraryCleanupApplyProgress? applying;

  bool get isReady => status == LibraryCleanupLoadStatus.ready;
  bool get isDuplicates => queue == LibraryCleanupQueue.duplicates;

  bool isKept(LibraryCleanupSeries series, String frameId) => frames[frameId] ?? series.suggested.contains(frameId);

  /// What a frame will be once applied: its series' decision first, else its own mark.
  bool willKeep(LibraryCleanupSeries series, String frameId) => switch (decisions[series.id]) {
    LibraryCleanupSeriesDecision.trashAll => false,
    LibraryCleanupSeriesDecision.keepAll ||
    LibraryCleanupSeriesDecision.stack ||
    LibraryCleanupSeriesDecision.dismiss => true,
    LibraryCleanupSeriesDecision.asSet || null => isKept(series, frameId),
  };

  /// A duplicate group whose marks trash every copy cannot be accepted: that would delete the photo.
  bool canAcceptAsSet(LibraryCleanupSeries series) =>
      !isDuplicates || series.assets.any((asset) => isKept(series, asset.id));

  List<LibraryCleanupSeries> get undecided => [
    for (final item in series)
      if (!decisions.containsKey(item.id)) item,
  ];

  int get decided => series.where((item) => decisions.containsKey(item.id)).length;
  int get pendingCount => decided;

  LibraryCleanupSeriesState copyWith({
    LibraryCleanupLoadStatus? status,
    Object? error,
    bool clearError = false,
    List<LibraryCleanupSeries>? series,
    Map<String, LibraryCleanupSeriesDecision>? decisions,
    Map<String, bool>? frames,
    bool? canUndo,
    bool? restoredMarks,
    bool? hasMore,
    bool? loadingMore,
    LibraryCleanupApplyProgress? applying,
    bool clearApplying = false,
  }) => LibraryCleanupSeriesState(
    queue: queue,
    status: status ?? this.status,
    error: clearError ? null : (error ?? this.error),
    series: series ?? this.series,
    decisions: decisions ?? this.decisions,
    frames: frames ?? this.frames,
    canUndo: canUndo ?? this.canUndo,
    restoredMarks: restoredMarks ?? this.restoredMarks,
    hasMore: hasMore ?? this.hasMore,
    loadingMore: loadingMore ?? this.loadingMore,
    applying: clearApplying ? null : (applying ?? this.applying),
  );
}

/// One Bursts or Duplicates session. Like every cleanup it collects marks locally until Done → Apply, keeps them saved
/// on the device, and steps back one series at a time.
///
/// Applying sends what the web sends: Bursts commit every accepted series' keep and trash ids in one
/// `POST /cleanup/commit` (chunked at [libraryCleanupMaxIds]) and stack the "Stack instead" ones with `POST /stacks`;
/// Duplicates resolve the accepted groups with `POST /duplicates/resolve` and dismiss each kept-whole group with
/// `DELETE /duplicates/{id}`. The shared-space lookup and the trash confirmation come first, as for every trash commit.
class LibraryCleanupSeriesNotifier extends AutoDisposeFamilyNotifier<LibraryCleanupSeriesState, LibraryCleanupQueue> {
  late LibraryCleanupSessionCore _core;
  LibraryCleanupSeriesBook _book = LibraryCleanupSeriesBook();
  late String _storeKey;
  bool _disposed = false;
  String? _cursor;
  int _generation = 0;
  Future<void>? _inFlight;

  /// The series just before the last apply, so a restored trash can put bursts back in their place.
  List<LibraryCleanupSeries> _beforeApply = const [];
  Map<String, LibraryCleanupSeriesDecision> _appliedDecisions = const {};

  /// Resolves when the first load (and any restore of saved marks) has finished.
  late Future<void> ready;

  bool get _isDuplicates => arg == LibraryCleanupQueue.duplicates;

  @override
  LibraryCleanupSeriesState build(LibraryCleanupQueue arg) {
    _disposed = false;
    _cursor = null;
    _inFlight = null;
    _book = LibraryCleanupSeriesBook();
    _beforeApply = const [];
    final userId = ref.watch(libraryCleanupUserIdProvider) ?? 'anonymous';
    _storeKey = LibraryCleanupMarksStore.queueKey(userId, arg);
    _core = LibraryCleanupSessionCore(
      repository: ref.read(libraryCleanupRepositoryProvider),
      store: ref.read(libraryCleanupMarksStoreProvider),
      queue: arg,
      storeKey: _storeKey,
      trashEnabled: () => ref.read(libraryCleanupTrashEnabledProvider),
    );
    ref.onDispose(() {
      _disposed = true;
      _generation++;
    });
    ready = Future.microtask(_load);
    return LibraryCleanupSeriesState(queue: arg);
  }

  void _emit(LibraryCleanupSeriesState next) {
    if (!_disposed) {
      state = next;
    }
  }

  void _sync({bool? restored}) {
    _emit(
      state.copyWith(decisions: _book.decisions, frames: _book.frames, canUndo: _book.canUndo, restoredMarks: restored),
    );
    unawaited(ref.read(libraryCleanupMarksStoreProvider).saveSeries(_storeKey, _book));
    _maybeLoadMore();
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------------------------------------------------------

  Future<void> retry() {
    _emit(state.copyWith(status: LibraryCleanupLoadStatus.loading, clearError: true));
    return ready = Future.microtask(_load);
  }

  Future<void> _load() async {
    try {
      _generation++;
      _cursor = null;
      _inFlight = null;
      if (_isDuplicates) {
        final groups = await ref.read(libraryCleanupRepositoryProvider).duplicates();
        _emit(state.copyWith(series: [for (final group in groups) LibraryCleanupSeries.fromDuplicate(group)]));
      } else {
        _emit(state.copyWith(series: const [], hasMore: true));
        await _fetchPage(rethrowError: true);
      }
    } on ApiException catch (error) {
      if (error.code == HttpStatus.forbidden && _isDuplicates) {
        ref.read(libraryCleanupDuplicatesForbiddenProvider.notifier).state = true;
      }
      _emit(state.copyWith(status: LibraryCleanupLoadStatus.error, error: error));
      return;
    } catch (error) {
      _emit(state.copyWith(status: LibraryCleanupLoadStatus.error, error: error));
      return;
    }
    if (_disposed) {
      return;
    }
    // Saved marks may belong to series deeper than the first page: read on until they are all found.
    final saved = await ref.read(libraryCleanupMarksStoreProvider).loadSeries(_storeKey);
    if (saved != null) {
      bool found() {
        final loaded = state.series.map((item) => item.id).toSet();
        return saved.decisions.keys.every(loaded.contains);
      }

      for (var page = 1; page < _maxRestorePages && state.hasMore && !found(); page++) {
        if (!await _fetchPage()) {
          break;
        }
      }
      final seriesIds = state.series.map((item) => item.id).toSet();
      final frameIds = {
        for (final item in state.series)
          for (final asset in item.assets) asset.id,
      };
      saved.retainWhere(present: seriesIds.contains, frame: frameIds.contains);
      _book = saved;
    }
    _emit(state.copyWith(status: LibraryCleanupLoadStatus.ready, clearError: true));
    _sync(restored: !_book.isEmpty);
  }

  /// Appends the next page of bursts. True when it arrived.
  Future<bool> _fetchPage({bool rethrowError = false}) async {
    final generation = _generation;
    _emit(state.copyWith(loadingMore: true));
    final CleanupQueuePageDto page;
    try {
      page = await ref
          .read(libraryCleanupRepositoryProvider)
          .queuePage(arg, cursor: _cursor, limit: ref.read(libraryCleanupPageSizeProvider));
    } catch (error) {
      _emit(state.copyWith(loadingMore: false));
      if (rethrowError) {
        rethrow;
      }
      return false;
    }
    if (generation != _generation) {
      return false;
    }
    final have = state.series.map((item) => item.id).toSet();
    _cursor = page.nextCursor;
    _emit(
      state.copyWith(
        series: [
          ...state.series,
          for (final group in page.groups)
            if (!have.contains(group.groupId)) LibraryCleanupSeries.fromBurst(group),
        ],
        hasMore: page.nextCursor != null,
        loadingMore: false,
      ),
    );
    return true;
  }

  /// The next page of bursts; a call while one is loading waits for it.
  Future<void> loadMore() {
    final running = _inFlight;
    if (running != null) {
      return running;
    }
    if (_isDuplicates || !state.hasMore) {
      return Future.value();
    }
    late final Future<void> request;
    request = _fetchPage().whenComplete(() {
      if (identical(_inFlight, request)) {
        _inFlight = null;
      }
    });
    return _inFlight = request;
  }

  void _maybeLoadMore() {
    if (!_isDuplicates &&
        state.isReady &&
        state.hasMore &&
        !state.loadingMore &&
        state.undecided.length <= libraryCleanupPrefetchRemaining) {
      unawaited(loadMore());
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Marks
  // ---------------------------------------------------------------------------------------------------------------

  LibraryCleanupSeries? _find(String seriesId) => state.series.where((item) => item.id == seriesId).firstOrNull;

  /// Tapping the big frame: flips the frame shown between keep and trash.
  void flip(String seriesId, String frameId) {
    final series = _find(seriesId);
    if (series == null) {
      return;
    }
    _book.flip(series, frameId);
    _sync();
  }

  /// The details sheet's Keep or Trash on one frame.
  void setFrame(String frameId, {required bool keep}) {
    _book.setFrame(frameId, keep: keep);
    _sync();
  }

  /// Decides a series. Accepting a duplicate group that would trash every copy is refused: returns false and marks
  /// nothing.
  bool decide(String seriesId, LibraryCleanupSeriesDecision decision) {
    final series = _find(seriesId);
    if (series == null) {
      return false;
    }
    if (decision == LibraryCleanupSeriesDecision.asSet && !state.canAcceptAsSet(series)) {
      return false;
    }
    if (_isDuplicates && decision == LibraryCleanupSeriesDecision.trashAll) {
      return false;
    }
    _book.decide(seriesId, decision);
    _sync();
    return true;
  }

  /// "Keep the suggestion for all": every undecided loaded series accepted on its suggested frames, as one undo step.
  void keepSuggestionForAll() {
    final open = state.undecided;
    _book.decideMany(
      [for (final series in open) series.id],
      LibraryCleanupSeriesDecision.asSet,
      resetFrames: {for (final series in open) series.id: series.assets.map((asset) => asset.id).toList()},
    );
    _sync();
  }

  /// Steps back one series.
  void undo() {
    if (_book.undo().isNotEmpty) {
      _sync();
    }
  }

  void discard() {
    _book.clear();
    _sync(restored: false);
  }

  /// "Review the N first" on the finish screen: a tap takes a frame off the trash pile.
  void rescue(String frameId) {
    final series = state.series.where((item) => item.assets.any((asset) => asset.id == frameId)).firstOrNull;
    if (series == null) {
      return;
    }
    if (state.decisions[series.id] == LibraryCleanupSeriesDecision.trashAll) {
      // The series is no longer trashed whole: every other frame stays marked for trash.
      for (final asset in series.assets) {
        _book.setFrame(asset.id, keep: asset.id == frameId);
      }
      _book.decide(series.id, LibraryCleanupSeriesDecision.asSet);
    } else {
      _book.setFrame(frameId, keep: true);
    }
    _sync();
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Applying
  // ---------------------------------------------------------------------------------------------------------------

  /// Commits every decided series. See the class comment for the requests; [confirm] is asked once when a trashed
  /// frame is in a shared space or an external library, or the trash is off.
  Future<LibraryCleanupApplyResult> apply({LibraryCleanupConfirm? confirm}) async {
    if (state.applying != null) {
      throw StateError('A commit is already running');
    }
    final decided = [
      for (final series in state.series)
        if (state.decisions.containsKey(series.id)) series,
    ];
    final keep = <String>[];
    final trash = <String>[];
    final stacks = <LibraryCleanupSeries>[];
    final resolve = <(LibraryCleanupSeries, DuplicateResolveGroupDto)>[];
    final dismiss = <LibraryCleanupSeries>[];
    for (final series in decided) {
      final kept = [
        for (final asset in series.assets)
          if (state.willKeep(series, asset.id)) asset.id,
      ];
      final trashed = [
        for (final asset in series.assets)
          if (!state.willKeep(series, asset.id)) asset.id,
      ];
      switch (state.decisions[series.id]!) {
        case LibraryCleanupSeriesDecision.stack:
          stacks.add(series);
        case LibraryCleanupSeriesDecision.dismiss:
          dismiss.add(series);
        case LibraryCleanupSeriesDecision.asSet ||
            LibraryCleanupSeriesDecision.trashAll ||
            LibraryCleanupSeriesDecision.keepAll:
          trash.addAll(trashed);
          if (_isDuplicates) {
            resolve.add((
              series,
              DuplicateResolveGroupDto(duplicateId: series.id, keepAssetIds: kept, trashAssetIds: trashed),
            ));
          } else {
            keep.addAll(kept);
          }
      }
    }

    if (trash.isNotEmpty) {
      final LibraryCleanupTrashCheck check;
      try {
        check = await _core.checkTrash(trash);
      } catch (error) {
        return LibraryCleanupApplyResult(status: LibraryCleanupApplyStatus.lookupFailed, error: error);
      }
      if (check.needsConfirmation && (confirm == null || !await confirm(check))) {
        return const LibraryCleanupApplyResult(status: LibraryCleanupApplyStatus.cancelled);
      }
    }

    final repository = ref.read(libraryCleanupRepositoryProvider);
    final keepChunks = libraryCleanupChunk(keep);
    final trashChunks = libraryCleanupChunk(trash);
    final commits = _isDuplicates ? 0 : (keepChunks.length > trashChunks.length ? keepChunks : trashChunks).length;
    final batches = libraryCleanupChunk(resolve, libraryCleanupResolveBatch);
    final total = commits + stacks.length + batches.length + dismiss.length;
    final appliedIds = <String>{};
    final appliedSeries = <String>{};
    final trashed = <String>[];
    final skipped = <CleanupSkippedDto>[];
    var done = 0;
    var kept = 0;
    Object? failure;
    _emit(state.copyWith(applying: LibraryCleanupApplyProgress(done: 0, total: total)));
    void step() => _emit(
      state.copyWith(
        applying: LibraryCleanupApplyProgress(done: ++done, total: total),
      ),
    );
    try {
      for (var i = 0; i < commits; i++) {
        final keepChunk = i < keepChunks.length ? keepChunks[i] : const <String>[];
        final trashChunk = i < trashChunks.length ? trashChunks[i] : const <String>[];
        final response = await repository.commit(
          queue: CleanupQueue.bursts,
          trashIds: trashChunk,
          favoriteIds: const [],
          keepIds: keepChunk,
        );
        trashed.addAll(response.trashed);
        skipped.addAll(response.skipped);
        kept += response.kept;
        appliedIds.addAll([...keepChunk, ...trashChunk]);
        step();
      }
      for (final series in decided) {
        if (!_isDuplicates && series.assets.every((asset) => appliedIds.contains(asset.id))) {
          appliedSeries.add(series.id);
        }
      }
      for (final series in stacks) {
        // The suggested frame goes first, so it becomes the stack's primary (as the web's `onStack`).
        await repository.stack([
          ...series.assets.where((asset) => series.suggested.contains(asset.id)).map((asset) => asset.id),
          ...series.assets.where((asset) => !series.suggested.contains(asset.id)).map((asset) => asset.id),
        ]);
        appliedSeries.add(series.id);
        appliedIds.addAll(series.assets.map((asset) => asset.id));
        kept += series.assets.length;
        step();
      }
      for (final batch in batches) {
        final results = await repository.resolveDuplicates([for (final (_, group) in batch) group]);
        final succeeded = {
          for (final result in results)
            if (result.success) result.id,
        };
        for (final (series, group) in batch) {
          if (succeeded.contains(series.id)) {
            appliedSeries.add(series.id);
            appliedIds.addAll(series.assets.map((asset) => asset.id));
            trashed.addAll(group.trashAssetIds);
            kept += group.keepAssetIds.length;
          }
        }
        step();
        if (succeeded.length < batch.length) {
          throw ApiException(HttpStatus.badRequest, 'Some duplicate groups were not resolved');
        }
      }
      for (final series in dismiss) {
        await repository.dismissDuplicate(series.id);
        appliedSeries.add(series.id);
        appliedIds.addAll(series.assets.map((asset) => asset.id));
        kept += series.assets.length;
        step();
      }
    } catch (error) {
      failure = error;
    }

    final settled = [
      for (final series in decided)
        if (appliedSeries.contains(series.id)) series,
    ];
    _beforeApply = state.series;
    _appliedDecisions = {for (final series in settled) series.id: state.decisions[series.id]!};
    _book.settle(settled);
    _emit(
      state.copyWith(
        series: [
          for (final series in state.series)
            if (!appliedSeries.contains(series.id)) series,
        ],
        clearApplying: true,
      ),
    );
    _sync();
    final trashOn = ref.read(libraryCleanupTrashEnabledProvider);
    return LibraryCleanupApplyResult(
      status: failure == null ? LibraryCleanupApplyStatus.applied : LibraryCleanupApplyStatus.failed,
      trashed: trashed,
      kept: kept,
      skipped: skipped,
      appliedIds: appliedIds,
      chunksApplied: done,
      chunksTotal: total,
      error: failure,
      trashUndoAvailable: trashOn && trashed.isNotEmpty,
    );
  }

  /// The toast's Undo: restores exactly the ids the server trashed. A burst comes back with only its restored frames
  /// (the kept ones stay kept, so the server leaves them out from now on), and only while it still has two, as the
  /// web's `restoreGroups`. Duplicate groups do not come back until the server detects them again.
  Future<List<String>> restoreTrashed(LibraryCleanupApplyResult result) async {
    final restored = await _core.restoreTrashed(result);
    if (restored.isEmpty || _disposed || _isDuplicates) {
      return restored;
    }
    final back = restored.toSet();
    final present = state.series.map((item) => item.id).toSet();
    final before = _beforeApply.map((item) => item.id).toSet();
    final series = [
      for (final item in _beforeApply)
        if (present.contains(item.id))
          state.series.firstWhere((candidate) => candidate.id == item.id)
        else if (_appliedDecisions.containsKey(item.id))
          ?item.onlyFrames(back),
      for (final item in state.series)
        if (!before.contains(item.id)) item,
    ];
    _emit(state.copyWith(series: series));
    return restored;
  }
}

final libraryCleanupSeriesProvider = NotifierProvider.autoDispose
    .family<LibraryCleanupSeriesNotifier, LibraryCleanupSeriesState, LibraryCleanupQueue>(
      LibraryCleanupSeriesNotifier.new,
    );
