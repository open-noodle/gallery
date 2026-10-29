import 'package:openapi/api.dart';

/// The cleanups the app runs. Named `LibraryCleanup…` because upstream's "Free up space" feature is also called
/// cleanup in the app (`providers/cleanup.provider.dart`).
enum LibraryCleanupQueue {
  rewind,
  spaceHogs,
  bursts,
  screenshots,
  blurry,
  duplicates;

  /// Stable name for the files and prefs that remember choices per queue.
  String get slug => switch (this) {
    LibraryCleanupQueue.rewind => 'rewind',
    LibraryCleanupQueue.spaceHogs => 'space_hogs',
    LibraryCleanupQueue.bursts => 'bursts',
    LibraryCleanupQueue.screenshots => 'screenshots',
    LibraryCleanupQueue.blurry => 'blurry',
    LibraryCleanupQueue.duplicates => 'duplicates',
  };

  static LibraryCleanupQueue? fromSlug(String? slug) =>
      LibraryCleanupQueue.values.where((queue) => queue.slug == slug).firstOrNull;

  /// The queue `POST /cleanup/commit` records decisions under. Duplicates have no cleanup queue: they resolve
  /// through upstream's duplicates API.
  CleanupQueue? get commitQueue => switch (this) {
    LibraryCleanupQueue.rewind => CleanupQueue.rewind,
    LibraryCleanupQueue.spaceHogs => CleanupQueue.spaceHogs,
    LibraryCleanupQueue.bursts => CleanupQueue.bursts,
    LibraryCleanupQueue.screenshots => CleanupQueue.screenshots,
    LibraryCleanupQueue.blurry => CleanupQueue.blurry,
    LibraryCleanupQueue.duplicates => null,
  };

  /// The queue `GET /cleanup/queues/{queue}` pages through (null for the rewind and duplicates).
  CleanupListQueue? get listQueue => switch (this) {
    LibraryCleanupQueue.spaceHogs => CleanupListQueue.spaceHogs,
    LibraryCleanupQueue.bursts => CleanupListQueue.bursts,
    LibraryCleanupQueue.screenshots => CleanupListQueue.screenshots,
    LibraryCleanupQueue.blurry => CleanupListQueue.blurry,
    LibraryCleanupQueue.rewind || LibraryCleanupQueue.duplicates => null,
  };

  /// The queue `GET /cleanup/queues/{queue}/count` counts (null for the rewind).
  CleanupCountQueue? get countQueue => switch (this) {
    LibraryCleanupQueue.spaceHogs => CleanupCountQueue.spaceHogs,
    LibraryCleanupQueue.bursts => CleanupCountQueue.bursts,
    LibraryCleanupQueue.screenshots => CleanupCountQueue.screenshots,
    LibraryCleanupQueue.blurry => CleanupCountQueue.blurry,
    LibraryCleanupQueue.duplicates => CleanupCountQueue.duplicates,
    LibraryCleanupQueue.rewind => null,
  };
}

/// The server's `CLEANUP_MAX_IDS`: a commit or in-spaces list may hold at most this many ids.
const libraryCleanupMaxIds = 1000;

/// The page size the web asks the queues for (`CLEANUP_PAGE_SIZE`).
const libraryCleanupPageSize = 100;

/// The deck asks for the next page when this many undecided cards remain.
const libraryCleanupPrefetchRemaining = 10;

/// Must match the server's default minimum for Space hogs: 100 MiB.
const libraryCleanupSpaceHogDefaultMinSize = 104857600;

List<List<T>> libraryCleanupChunk<T>(List<T> items, [int size = libraryCleanupMaxIds]) => [
  for (var i = 0; i < items.length; i += size) items.sublist(i, i + size > items.length ? items.length : i + size),
];
