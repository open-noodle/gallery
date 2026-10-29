import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_filters.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_marks.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_queue.dart';
import 'package:openapi/api.dart';

enum LibraryCleanupLoadStatus { loading, ready, error }

/// One year of a rewind: the photos still to decide, and how many the year holds in all.
class LibraryCleanupRewindYear {
  const LibraryCleanupRewindYear({required this.year, required this.count, required this.assets});

  final int year;
  final int count;
  final List<CleanupAssetDto> assets;
}

/// How far a commit has got, for the finish screen.
class LibraryCleanupApplyProgress {
  const LibraryCleanupApplyProgress({required this.done, required this.total});

  final int done;
  final int total;
}

/// What a session shows. The rewind and every queue use the same shape, which is what lets them share one screen.
class LibraryCleanupSessionState {
  const LibraryCleanupSessionState({
    required this.queue,
    this.monthDay,
    this.status = LibraryCleanupLoadStatus.loading,
    this.error,
    this.assets = const [],
    this.years = const [],
    this.groups = const [],
    this.alreadyDone = 0,
    this.marks = const {},
    this.canUndo = false,
    this.restoredMarks = false,
    this.hasMore = false,
    this.loadingMore = false,
    this.pagingError,
    this.applying,
    this.filters,
  });

  final LibraryCleanupQueue queue;

  /// The rewind's date as month*100+day.
  final int? monthDay;
  final LibraryCleanupLoadStatus status;
  final Object? error;

  /// The photos to decide, in deck order: the rewind's years newest first, or the queue's pages so far.
  final List<CleanupAssetDto> assets;

  /// Rewind only: [assets] by year.
  final List<LibraryCleanupRewindYear> years;

  /// Bursts only: the series of the pages so far.
  final List<CleanupBurstGroupDto> groups;

  /// Rewind only: photos decided on an earlier visit (`kept`), which the progress counts as done.
  final int alreadyDone;
  final Map<String, LibraryCleanupMark> marks;
  final bool canUndo;

  /// The marks were found saved on the device ("Restored your marks").
  final bool restoredMarks;

  /// Queue only: more pages are on the server.
  final bool hasMore;
  final bool loadingMore;
  final Object? pagingError;
  final LibraryCleanupApplyProgress? applying;

  /// Queue only: the filters the pages were asked with.
  final LibraryCleanupFilters? filters;

  bool get isReady => status == LibraryCleanupLoadStatus.ready;

  /// Marks on photos of this session; the Done badge counts these.
  int get pendingCount => marks.length;

  int count(LibraryCleanupMark mark) => marks.values.where((m) => m == mark).length;

  /// Photos left in the deck: those without a mark yet.
  List<CleanupAssetDto> get undecided => [
    for (final asset in assets)
      if (!marks.containsKey(asset.id)) asset,
  ];

  /// "16 of 42": the position, counting the photos decided on an earlier visit.
  int get decided => alreadyDone + assets.where((asset) => marks.containsKey(asset.id)).length;
  int get total => alreadyDone + assets.length;

  LibraryCleanupSessionState copyWith({
    LibraryCleanupLoadStatus? status,
    Object? error,
    bool clearError = false,
    List<CleanupAssetDto>? assets,
    List<LibraryCleanupRewindYear>? years,
    List<CleanupBurstGroupDto>? groups,
    int? alreadyDone,
    Map<String, LibraryCleanupMark>? marks,
    bool? canUndo,
    bool? restoredMarks,
    bool? hasMore,
    bool? loadingMore,
    Object? pagingError,
    bool clearPagingError = false,
    LibraryCleanupApplyProgress? applying,
    bool clearApplying = false,
    LibraryCleanupFilters? filters,
  }) => LibraryCleanupSessionState(
    queue: queue,
    monthDay: monthDay,
    status: status ?? this.status,
    error: clearError ? null : (error ?? this.error),
    assets: assets ?? this.assets,
    years: years ?? this.years,
    groups: groups ?? this.groups,
    alreadyDone: alreadyDone ?? this.alreadyDone,
    marks: marks ?? this.marks,
    canUndo: canUndo ?? this.canUndo,
    restoredMarks: restoredMarks ?? this.restoredMarks,
    hasMore: hasMore ?? this.hasMore,
    loadingMore: loadingMore ?? this.loadingMore,
    pagingError: clearPagingError ? null : (pagingError ?? this.pagingError),
    applying: clearApplying ? null : (applying ?? this.applying),
    filters: filters ?? this.filters,
  );
}

enum LibraryCleanupApplyStatus {
  /// Everything marked was committed.
  applied,

  /// The user declined a confirmation; nothing was committed.
  cancelled,

  /// The shared-space lookup failed; nothing was committed.
  lookupFailed,

  /// A commit failed part way: the chunks before it are applied, the rest stay pending.
  failed,
}

/// What a trash commit needs the user to confirm first.
class LibraryCleanupTrashCheck {
  const LibraryCleanupTrashCheck({
    required this.trashCount,
    required this.inSpacesCount,
    this.externalCount = 0,
    required this.trashEnabled,
  });

  final int trashCount;

  /// Of the photos to trash, how many are also in a shared space (they vanish for its members too).
  final int inSpacesCount;

  /// Of the photos to trash, how many are from an external library (a read-only one brings the file back at its next
  /// scan, and no space is freed).
  final int externalCount;
  final bool trashEnabled;

  /// With the trash off the delete is permanent, so the user always confirms; otherwise only for photos in a space or
  /// from an external library.
  bool get needsConfirmation => trashCount > 0 && (!trashEnabled || inSpacesCount > 0 || externalCount > 0);
}

class LibraryCleanupApplyResult {
  const LibraryCleanupApplyResult({
    required this.status,
    this.trashed = const [],
    this.favorited = 0,
    this.kept = 0,
    this.skipped = const [],
    this.appliedIds = const {},
    this.chunksApplied = 0,
    this.chunksTotal = 0,
    this.error,
    this.trashUndoAvailable = false,
    this.dayCompleted = false,
  });

  final LibraryCleanupApplyStatus status;

  /// The ids the server trashed (a subset of those sent: skipped ones are not in it).
  final List<String> trashed;
  final int favorited;
  final int kept;

  /// Ids the server skipped, with why.
  final List<CleanupSkippedDto> skipped;

  /// Every id whose chunk was committed, skipped ones included.
  final Set<String> appliedIds;
  final int chunksApplied;
  final int chunksTotal;
  final Object? error;

  /// The trash is on and something went to it: the toast may offer Undo. With the trash off nothing can be restored.
  final bool trashUndoAvailable;

  /// The last chunk, the one that carried `completeMonthDay`, was committed.
  final bool dayCompleted;

  bool get isApplied => status == LibraryCleanupApplyStatus.applied;
}
