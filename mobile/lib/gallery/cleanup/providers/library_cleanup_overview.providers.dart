import 'dart:io';

import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_marks.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_overview.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_queue.dart';
import 'package:immich_mobile/gallery/cleanup/providers/library_cleanup.providers.dart';
import 'package:immich_mobile/gallery/cleanup/repositories/library_cleanup_marks_store.dart';
import 'package:immich_mobile/providers/infrastructure/action.provider.dart';
import 'package:openapi/api.dart';

// The overview's data (specs/2026-10-29-mobile-library-cleanup-design.md, "Cleanup overview" and "Performance"). The
// today card needs only the calendar (the probe's, shared) and the day's years; everything else here loads after it
// and never holds it back.

/// The device clock, so tests can fix "today".
final libraryCleanupClockProvider = Provider<DateTime Function()>((ref) => DateTime.now);

/// Today as month*100+day in the device's local time. Read when a screen builds, so a new day is picked up.
int libraryCleanupToday(WidgetRef ref) => libraryCleanupMonthDayOf(ref.read(libraryCleanupClockProvider)());

/// The years that have photos on a date, newest first, with their counts. Shared by the Library button's subtitle and
/// the today card, so opening the overview from Library asks nothing twice.
final libraryCleanupDayYearsProvider = FutureProvider.autoDispose.family<List<CleanupRewindYearDto>, int>((
  ref,
  monthDay,
) {
  ref.watch(libraryCleanupUserIdProvider);
  return ref.watch(libraryCleanupRepositoryProvider).rewindYears(monthDay);
});

/// The pending rewind marks saved on the device for a date, or null when there are none.
final libraryCleanupSavedDayMarksProvider = FutureProvider.autoDispose.family<LibraryCleanupMarkBook?, int>((
  ref,
  monthDay,
) async {
  final userId = ref.watch(libraryCleanupUserIdProvider);
  if (userId == null) {
    return null;
  }
  return ref.watch(libraryCleanupMarksStoreProvider).load(LibraryCleanupMarksStore.rewindKey(userId, monthDay));
});

/// What the today card shows after its counts: a few photos, the busiest year's city, and where a saved rewind left
/// off.
class LibraryCleanupDayPhotos {
  const LibraryCleanupDayPhotos({required this.collage, this.city, this.resume});

  final List<CleanupAssetDto> collage;

  /// The busiest year's most common city.
  final String? city;

  /// Set when marks are saved for the date.
  final LibraryCleanupResumePoint? resume;
}

/// The date's photos as the web banner loads them: the busiest year's, for the collage and the city. With marks saved
/// for the date, every year's (as the rewind itself loads them), so "Resume · 16 of 42" is the position the rewind
/// opens at: photos kept on an earlier visit plus the saved marks, of all the date's photos.
final libraryCleanupDayPhotosProvider = FutureProvider.autoDispose.family<LibraryCleanupDayPhotos, int>((
  ref,
  monthDay,
) async {
  final years = await ref.watch(libraryCleanupDayYearsProvider(monthDay).future);
  final saved = await ref.watch(libraryCleanupSavedDayMarksProvider(monthDay).future);
  final repository = ref.watch(libraryCleanupRepositoryProvider);
  final busiest = libraryCleanupBusiestYear(years);
  if (busiest == null) {
    return const LibraryCleanupDayPhotos(collage: []);
  }

  if (saved == null) {
    final assets = await repository.rewindAssets(monthDay, busiest.year);
    return LibraryCleanupDayPhotos(
      collage: assets.take(libraryCleanupCollageSize).toList(),
      city: libraryCleanupDominantCity(assets),
    );
  }

  final lists = await Future.wait([for (final year in years) repository.rewindAssets(monthDay, year.year)]);
  final all = lists.expand((list) => list).toList();
  final busiestAssets = lists[years.indexOf(busiest)];
  final kept = all.where((asset) => asset.kept).length;
  final marked = all.where((asset) => !asset.kept && saved[asset.id] != null).length;
  return LibraryCleanupDayPhotos(
    collage: busiestAssets.take(libraryCleanupCollageSize).toList(),
    city: libraryCleanupDominantCity(busiestAssets),
    // Marks for photos no longer in the day are ignored, as the rewind ignores them when it restores.
    resume: marked == 0 ? null : LibraryCleanupResumePoint(decided: kept + marked, total: all.length),
  );
});

/// One quick win's count, without filters (as the web hub asks). A 403 hides the card: the user may not use that
/// queue (Duplicates for a session without the duplicate permission). Any other failure keeps the card, without a
/// figure.
final libraryCleanupQueueCountProvider = FutureProvider.autoDispose
    .family<LibraryCleanupQueueCount, LibraryCleanupQueue>((ref, queue) async {
      ref.watch(libraryCleanupUserIdProvider);
      try {
        return LibraryCleanupQueueCount.loaded(await ref.watch(libraryCleanupRepositoryProvider).queueCount(queue));
      } on ApiException catch (error) {
        return error.code == HttpStatus.forbidden
            ? const LibraryCleanupQueueCount.hidden()
            : const LibraryCleanupQueueCount.failed();
      } catch (_) {
        return const LibraryCleanupQueueCount.failed();
      }
    });

/// A quick win's cover photo. Decorative: a failure leaves the card's icon.
final libraryCleanupQueueCoverProvider = FutureProvider.autoDispose.family<CleanupAssetDto?, LibraryCleanupQueue>((
  ref,
  queue,
) async {
  ref.watch(libraryCleanupUserIdProvider);
  try {
    return await ref.watch(libraryCleanupRepositoryProvider).queueCover(queue);
  } catch (_) {
    return null;
  }
});

/// The trash total under the quick wins. Only asked when the server's trash is on.
final libraryCleanupTrashTotalsProvider = FutureProvider.autoDispose<CleanupTrashResponseDto>((ref) {
  ref.watch(libraryCleanupUserIdProvider);
  return ref.watch(libraryCleanupRepositoryProvider).trash();
});

/// Empties the trash the way the Trash page does (`ActionNotifier.emptyTrash`, which also clears the local copies).
/// True when it worked.
final libraryCleanupEmptyTrashProvider = Provider<Future<bool> Function()>(
  (ref) => () async {
    final userId = ref.read(libraryCleanupUserIdProvider);
    if (userId == null) {
      return false;
    }
    return (await ref.read(actionProvider.notifier).emptyTrash(userId)).success;
  },
);

/// Reloads every section of the overview (pull to refresh): the calendar, today's years and photos, the saved marks,
/// each count and cover, and the trash. Completes when they have all answered.
Future<void> libraryCleanupRefreshOverview(WidgetRef ref, int monthDay, {required bool trashEnabled}) async {
  ref
    ..invalidate(libraryCleanupDayYearsProvider(monthDay))
    ..invalidate(libraryCleanupSavedDayMarksProvider(monthDay))
    ..invalidate(libraryCleanupDayPhotosProvider(monthDay))
    ..invalidate(libraryCleanupQueueCountProvider)
    ..invalidate(libraryCleanupQueueCoverProvider)
    ..invalidate(libraryCleanupTrashTotalsProvider);
  await Future.wait<Object?>([
    ref.read(libraryCleanupSupportProvider.notifier).refreshCalendar(),
    for (final queue in libraryCleanupQuickWins) ref.read(libraryCleanupQueueCountProvider(queue).future),
    if (trashEnabled)
      ref.read(libraryCleanupTrashTotalsProvider.future).then<Object?>((value) => value, onError: (_) {}),
  ]);
}
