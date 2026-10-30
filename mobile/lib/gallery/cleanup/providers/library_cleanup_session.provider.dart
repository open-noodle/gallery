import 'dart:async';

import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/cleanup/cleanup_prefs.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_filters.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_marks.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_queue.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_session_state.dart';
import 'package:immich_mobile/gallery/cleanup/providers/library_cleanup.providers.dart';
import 'package:immich_mobile/gallery/cleanup/providers/library_cleanup_session.core.dart';
import 'package:immich_mobile/gallery/cleanup/repositories/library_cleanup_marks_store.dart';
import 'package:openapi/api.dart';

/// Which session: the rewind of one date, or one of the queues. It is the provider family's key.
class LibraryCleanupSessionRequest {
  const LibraryCleanupSessionRequest.rewind(int this.monthDay) : queue = LibraryCleanupQueue.rewind;

  const LibraryCleanupSessionRequest.queue(this.queue) : monthDay = null;

  final LibraryCleanupQueue queue;
  final int? monthDay;

  @override
  bool operator ==(Object other) =>
      other is LibraryCleanupSessionRequest && other.queue == queue && other.monthDay == monthDay;

  @override
  int get hashCode => Object.hash(queue, monthDay);
}

/// The most pages a restore reads looking for the saved marks' photos (100 per page).
const _maxRestorePages = 100;

/// One cleanup session, the same for the rewind and every queue: it loads the photos, builds the pending marks
/// locally (nothing is sent), keeps them saved on the device, and applies them when asked.
///
/// The rewind loads its date's years and each year's photos, newest year first, and skips the ones decided on an
/// earlier visit. A queue pages through the server with a cursor, asking for the next page when ten undecided cards
/// remain. Marks for photos no longer in the day or queue are ignored when a saved session is restored.
class LibraryCleanupSessionNotifier
    extends AutoDisposeFamilyNotifier<LibraryCleanupSessionState, LibraryCleanupSessionRequest> {
  late LibraryCleanupSessionCore _core;
  late String _userId;
  bool _disposed = false;

  /// Resolves when the first load (and any restore of saved marks) has finished.
  late Future<void> ready;

  // Rewind: which year each photo belongs to, and every year's size.
  final Map<String, int> _yearOf = {};
  List<CleanupRewindYearDto> _yearList = const [];

  // Queue paging.
  String? _cursor;
  int _generation = 0;
  Future<void>? _inFlight;

  // The photos in deck order just before the last apply, so a restored trash can put photos back in their place.
  List<CleanupAssetDto> _beforeApply = const [];

  LibraryCleanupQueue get _queue => arg.queue;

  @override
  LibraryCleanupSessionState build(LibraryCleanupSessionRequest arg) {
    // The notifier instance outlives a rebuild (a new user, an invalidate), so every field starts clean.
    _disposed = false;
    _yearOf.clear();
    _yearList = const [];
    _cursor = null;
    _inFlight = null;
    _beforeApply = const [];
    _userId = ref.watch(libraryCleanupUserIdProvider) ?? 'anonymous';
    final key = arg.monthDay != null
        ? LibraryCleanupMarksStore.rewindKey(_userId, arg.monthDay!)
        : LibraryCleanupMarksStore.queueKey(_userId, arg.queue);
    _core = LibraryCleanupSessionCore(
      repository: ref.read(libraryCleanupRepositoryProvider),
      store: ref.read(libraryCleanupMarksStoreProvider),
      queue: arg.queue,
      storeKey: key,
      trashEnabled: () => ref.read(libraryCleanupTrashEnabledProvider),
    );
    ref.onDispose(() {
      _disposed = true;
      _generation++;
    });
    final filters = arg.queue.listQueue == null ? null : ref.read(libraryCleanupPrefsProvider).filtersFor(arg.queue);
    ready = Future.microtask(_load);
    return LibraryCleanupSessionState(queue: arg.queue, monthDay: arg.monthDay, filters: filters);
  }

  void _emit(LibraryCleanupSessionState next) {
    if (!_disposed) {
      state = next;
    }
  }

  /// Marks, undo and the saved copy changed.
  void _syncMarks({bool restored = false}) {
    _emit(state.copyWith(marks: _core.book.marks, canUndo: _core.book.canUndo, restoredMarks: restored ? true : null));
    unawaited(_core.persist());
    _maybeLoadMore();
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------------------------------------------------------

  /// Loads again after an error.
  Future<void> retry() {
    _emit(state.copyWith(status: LibraryCleanupLoadStatus.loading, clearError: true));
    return ready = Future.microtask(_load);
  }

  Future<void> _load() async {
    try {
      if (_queue == LibraryCleanupQueue.rewind) {
        await _loadRewind();
      } else {
        await _loadQueue();
      }
    } catch (error) {
      _emit(state.copyWith(status: LibraryCleanupLoadStatus.error, error: error));
    }
  }

  Future<void> _loadRewind() async {
    final monthDay = arg.monthDay!;
    final repository = ref.read(libraryCleanupRepositoryProvider);
    final years = await repository.rewindYears(monthDay);
    final lists = await Future.wait([for (final year in years) repository.rewindAssets(monthDay, year.year)]);
    _yearList = years;
    _yearOf.clear();
    var alreadyDone = 0;
    final assets = <CleanupAssetDto>[];
    for (var i = 0; i < years.length; i++) {
      for (final asset in lists[i]) {
        if (asset.kept) {
          alreadyDone++;
        } else {
          _yearOf[asset.id] = years[i].year;
          assets.add(asset);
        }
      }
    }
    final restored = await _restoreMarks(assets.map((a) => a.id).toSet());
    if (_disposed) {
      return;
    }
    _emit(
      state.copyWith(
        status: LibraryCleanupLoadStatus.ready,
        clearError: true,
        assets: assets,
        years: _buildYears(assets),
        alreadyDone: alreadyDone,
        marks: _core.book.marks,
        canUndo: _core.book.canUndo,
        restoredMarks: restored,
      ),
    );
  }

  List<LibraryCleanupRewindYear> _buildYears(List<CleanupAssetDto> assets) => [
    for (final year in _yearList)
      LibraryCleanupRewindYear(
        year: year.year,
        count: year.count,
        assets: [
          for (final asset in assets)
            if (_yearOf[asset.id] == year.year) asset,
        ],
      ),
  ];

  /// Reads the saved marks and keeps those whose photo is among [present]. True when any were restored.
  Future<bool> _restoreMarks(Set<String> present) async {
    final saved = await _core.store.load(_core.storeKey);
    if (saved == null) {
      return false;
    }
    saved.retainWhere(present.contains);
    _core.book = saved;
    if (saved.isEmpty) {
      unawaited(_core.persist());
      return false;
    }
    return true;
  }

  Future<void> _loadQueue() async {
    _generation++;
    _cursor = null;
    _inFlight = null;
    _emit(
      state.copyWith(assets: const [], groups: const [], hasMore: true, loadingMore: false, clearPagingError: true),
    );
    await _fetchPage(firstPage: true);
    if (_disposed || state.status == LibraryCleanupLoadStatus.error) {
      return;
    }
    // Saved marks belong to photos that may sit deeper than the first page: read on until they are all found.
    final saved = await _core.store.load(_core.storeKey);
    if (saved != null) {
      for (var page = 1; page < _maxRestorePages && state.hasMore; page++) {
        final loaded = state.assets.map((a) => a.id).toSet();
        if (saved.marks.keys.every(loaded.contains)) {
          break;
        }
        await _fetchPage();
        if (_disposed || state.pagingError != null) {
          break;
        }
      }
      final loaded = state.assets.map((a) => a.id).toSet();
      saved.retainWhere(loaded.contains);
      _core.book = saved;
      unawaited(_core.persist());
    }
    _emit(
      state.copyWith(
        status: LibraryCleanupLoadStatus.ready,
        marks: _core.book.marks,
        canUndo: _core.book.canUndo,
        restoredMarks: !_core.book.isEmpty,
      ),
    );
    _maybeLoadMore();
  }

  /// Fetches the next page and appends it. A failure of the first page is the session's error; a later one is
  /// [LibraryCleanupSessionState.pagingError], and the cards already loaded stay.
  Future<void> _fetchPage({bool firstPage = false}) async {
    final generation = _generation;
    _emit(state.copyWith(loadingMore: true, clearPagingError: true));
    final CleanupQueuePageDto page;
    try {
      page = await ref
          .read(libraryCleanupRepositoryProvider)
          .queuePage(_queue, cursor: _cursor, limit: ref.read(libraryCleanupPageSizeProvider), filters: state.filters);
    } catch (error) {
      if (generation == _generation) {
        _emit(
          firstPage
              ? state.copyWith(status: LibraryCleanupLoadStatus.error, error: error, loadingMore: false)
              : state.copyWith(loadingMore: false, pagingError: error),
        );
      }
      return;
    }
    if (generation != _generation) {
      return;
    }
    final have = state.assets.map((a) => a.id).toSet();
    final haveGroups = state.groups.map((g) => g.groupId).toSet();
    _cursor = page.nextCursor;
    _emit(
      state.copyWith(
        assets: [...state.assets, ...page.items.where((a) => !have.contains(a.id))],
        groups: [...state.groups, ...page.groups.where((g) => !haveGroups.contains(g.groupId))],
        hasMore: page.nextCursor != null,
        loadingMore: false,
      ),
    );
  }

  /// Loads the next page of a queue; a call while a page is loading waits for it. It never throws: a failure is
  /// [LibraryCleanupSessionState.pagingError].
  Future<void> loadMore() {
    final running = _inFlight;
    if (running != null) {
      return running;
    }
    if (_queue == LibraryCleanupQueue.rewind || !state.hasMore) {
      return Future.value();
    }
    late final Future<void> request;
    request = _fetchPage().whenComplete(() {
      if (identical(_inFlight, request)) {
        _inFlight = null;
      }
      // A short page can still leave ten or fewer cards in the deck: keep going until enough are loaded.
      if (!_disposed) {
        _maybeLoadMore();
      }
    });
    return _inFlight = request;
  }

  /// The deck asks for more as ten undecided cards remain.
  void _maybeLoadMore() {
    if (_queue != LibraryCleanupQueue.rewind &&
        state.isReady &&
        state.hasMore &&
        !state.loadingMore &&
        state.pagingError == null &&
        state.undecided.length <= libraryCleanupPrefetchRemaining) {
      unawaited(loadMore());
    }
  }

  /// Completes once the session has loaded and no page is in flight.
  Future<void> settled() async {
    await ready;
    while (_inFlight != null) {
      await _inFlight;
    }
  }

  /// A queue's filters changed: pages again from the start. The marks stay.
  Future<void> setFilters(LibraryCleanupFilters filters) async {
    ref.read(libraryCleanupPrefsProvider.notifier).setFilters(filters);
    _emit(state.copyWith(filters: filters, status: LibraryCleanupLoadStatus.loading));
    _generation++;
    _cursor = null;
    _inFlight = null;
    _emit(
      state.copyWith(assets: const [], groups: const [], hasMore: true, loadingMore: false, clearPagingError: true),
    );
    await _fetchPage(firstPage: true);
    if (!_disposed && state.status != LibraryCleanupLoadStatus.error) {
      _emit(state.copyWith(status: LibraryCleanupLoadStatus.ready));
      _maybeLoadMore();
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Marks
  // ---------------------------------------------------------------------------------------------------------------

  void mark(String id, LibraryCleanupMark mark) {
    _core.book.mark(id, mark);
    _syncMarks();
  }

  void keep(String id) => mark(id, LibraryCleanupMark.keep);

  void favorite(String id) => mark(id, LibraryCleanupMark.favorite);

  void trash(String id) => mark(id, LibraryCleanupMark.trash);

  /// Marks every id in one step, which one undo takes back.
  void markMany(Iterable<String> ids, LibraryCleanupMark mark) {
    _core.book.markMany(ids, mark);
    _syncMarks();
  }

  /// The grid's tap: none, keep, favourite, trash, none.
  void cycle(String id) {
    _core.book.cycle(id);
    _syncMarks();
  }

  /// Photos with no mark yet, optionally only those of one rewind [year].
  List<String> untouchedIds({int? year}) => [
    for (final asset in state.assets)
      if (!state.marks.containsKey(asset.id) && (year == null || _yearOf[asset.id] == year)) asset.id,
  ];

  /// "Keep the rest" of a rewind year (or of the whole session): marks every untouched photo as keep.
  void keepTheRest({int? year}) => markMany(untouchedIds(year: year), LibraryCleanupMark.keep);

  /// Steps back one decision. With nothing to undo it does nothing.
  void undo() {
    if (_core.book.undo()) {
      _syncMarks();
    }
  }

  /// Throws every pending mark away, here and on the device.
  void discard() {
    _core.book.clear();
    _emit(state.copyWith(marks: const {}, canUndo: false, restoredMarks: false));
    unawaited(_core.persist());
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Applying
  // ---------------------------------------------------------------------------------------------------------------

  /// Commits the marks and stops: the rewind's day stays open (no `completeMonthDay`) and resumes at the first
  /// untouched photo. Queues apply the same way. Keeps and favourites are sent too, so any device skips them next
  /// time. See [LibraryCleanupConfirm] for the trash confirmation.
  Future<LibraryCleanupApplyResult> applyAndStop({LibraryCleanupConfirm? confirm}) =>
      _apply(completeDay: false, keepTheRest: false, confirm: confirm);

  /// Rewind only: commits the marks and marks the day reviewed (`completeMonthDay` on the last request only). With
  /// [keepTheRest] every untouched photo is kept too.
  Future<LibraryCleanupApplyResult> finishDay({bool keepTheRest = false, LibraryCleanupConfirm? confirm}) {
    if (_queue != LibraryCleanupQueue.rewind) {
      throw StateError('Only a rewind has a day to finish');
    }
    return _apply(completeDay: true, keepTheRest: keepTheRest, confirm: confirm);
  }

  Future<LibraryCleanupApplyResult> _apply({
    required bool completeDay,
    required bool keepTheRest,
    LibraryCleanupConfirm? confirm,
  }) async {
    if (state.applying != null) {
      throw StateError('A commit is already running');
    }
    final extraKeep = keepTheRest ? untouchedIds() : const <String>[];
    final before = Map.of(_core.book.marks);
    final order = state.assets;
    _emit(state.copyWith(applying: const LibraryCleanupApplyProgress(done: 0, total: 0)));
    final result = await _core.apply(
      extraKeepIds: extraKeep,
      completeMonthDay: completeDay ? arg.monthDay : null,
      confirm: confirm,
      onProgress: (progress) => _emit(state.copyWith(applying: progress)),
    );

    final applied = result.appliedIds;
    final skippedIds = {for (final skipped in result.skipped) skipped.id};
    var keptNow = 0;
    for (final id in applied) {
      final mark = before[id] ?? LibraryCleanupMark.keep;
      if (mark != LibraryCleanupMark.trash && !skippedIds.contains(id)) {
        keptNow++;
      }
    }
    _beforeApply = order;
    final remaining = [
      for (final asset in order)
        if (!applied.contains(asset.id)) asset,
    ];
    _emit(
      state.copyWith(
        assets: remaining,
        years: _queue == LibraryCleanupQueue.rewind ? _buildYears(remaining) : null,
        groups: [
          for (final group in state.groups)
            if (!group.assets.every((a) => applied.contains(a.id))) group,
        ],
        alreadyDone: _queue == LibraryCleanupQueue.rewind ? state.alreadyDone + keptNow : null,
        marks: _core.book.marks,
        canUndo: _core.book.canUndo,
        clearApplying: true,
      ),
    );
    if (result.dayCompleted) {
      // The day turns green on the overview and the streak grows.
      unawaited(ref.read(libraryCleanupSupportProvider.notifier).refreshCalendar());
    }
    _maybeLoadMore();
    return result;
  }

  /// Takes the trashed photos of an applied commit back out of the trash (exactly the ids the server trashed) and
  /// puts them back into the session. With the trash off nothing can be restored and this does nothing.
  Future<List<String>> restoreTrashed(LibraryCleanupApplyResult result) async {
    final restored = await _core.restoreTrashed(result);
    if (restored.isEmpty || _disposed) {
      return restored;
    }
    final back = restored.toSet();
    final present = state.assets.map((a) => a.id).toSet();
    final before = _beforeApply.map((a) => a.id).toSet();
    final assets = [
      for (final asset in _beforeApply)
        if (present.contains(asset.id) || back.contains(asset.id)) asset,
      // Pages that arrived since stay after them.
      for (final asset in state.assets)
        if (!before.contains(asset.id)) asset,
    ];
    _emit(state.copyWith(assets: assets, years: _queue == LibraryCleanupQueue.rewind ? _buildYears(assets) : null));
    return restored;
  }
}

final libraryCleanupSessionProvider = NotifierProvider.autoDispose
    .family<LibraryCleanupSessionNotifier, LibraryCleanupSessionState, LibraryCleanupSessionRequest>(
      LibraryCleanupSessionNotifier.new,
    );
