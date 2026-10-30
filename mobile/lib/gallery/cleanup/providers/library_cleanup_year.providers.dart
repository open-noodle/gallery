import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/cleanup/providers/library_cleanup.providers.dart';

/// The months the year screen has already shown complete (every day with photos reviewed), so a month glows once, on
/// the first arrival after it became complete (specs/2026-10-29-mobile-library-cleanup-design.md, "Celebrating a
/// finished day"). Held for the app's run and per user. The first arrival only takes note: months already complete then
/// were finished before and do not glow.
class LibraryCleanupCompletedMonthsNotifier extends Notifier<Set<int>?> {
  @override
  Set<int>? build() {
    ref.watch(libraryCleanupUserIdProvider);
    return null;
  }

  /// The year screen arrived showing [complete]: returns the months that glow now, and remembers them.
  Set<int> arrive(Set<int> complete) {
    final seen = state;
    state = {...complete};
    return seen == null ? const {} : complete.difference(seen);
  }
}

final libraryCleanupCompletedMonthsProvider = NotifierProvider<LibraryCleanupCompletedMonthsNotifier, Set<int>?>(
  LibraryCleanupCompletedMonthsNotifier.new,
);
