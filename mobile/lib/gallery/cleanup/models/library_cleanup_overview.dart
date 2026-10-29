import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_queue.dart';
import 'package:openapi/api.dart';

/// The quick wins in the web hub's order (`CleanupQuickWins.svelte`).
const libraryCleanupQuickWins = [
  LibraryCleanupQueue.spaceHogs,
  LibraryCleanupQueue.bursts,
  LibraryCleanupQueue.screenshots,
  LibraryCleanupQueue.duplicates,
  LibraryCleanupQueue.blurry,
];

/// Queues whose first photo doubles as the card's cover, as on web. Bursts keep their icon (their grouping query is
/// the heaviest) and Duplicates have no cleanup list.
const libraryCleanupCoverQueues = {
  LibraryCleanupQueue.spaceHogs,
  LibraryCleanupQueue.screenshots,
  LibraryCleanupQueue.blurry,
};

/// The pace the overview's "About N minutes" assumes for one photo in rewind (the web's `REWIND_SECONDS_PER_PHOTO`).
const libraryCleanupRewindSecondsPerPhoto = 4;

/// How many photos the today card's collage shows.
const libraryCleanupCollageSize = 3;

/// Whole minutes a date's rewind takes at that pace, or null below one minute (the web's `rewindMinutes`).
int? libraryCleanupRewindMinutes(int photos) {
  final minutes = (photos * libraryCleanupRewindSecondsPerPhoto / 60).round();
  return minutes >= 1 ? minutes : null;
}

/// The year with the most photos on a date; on a tie the most recent one (the web's `busiestYear`).
CleanupRewindYearDto? libraryCleanupBusiestYear(List<CleanupRewindYearDto> years) {
  CleanupRewindYearDto? best;
  for (final year in years) {
    if (best == null || year.count > best.count || (year.count == best.count && year.year > best.year)) {
      best = year;
    }
  }
  return best;
}

/// The most common city among [assets], or null when none has one (the web's `dominantCity`).
String? libraryCleanupDominantCity(List<CleanupAssetDto> assets) {
  final counts = <String, int>{};
  String? best;
  for (final asset in assets) {
    final city = asset.city;
    if (city == null || city.isEmpty) {
      continue;
    }
    final count = counts[city] = (counts[city] ?? 0) + 1;
    if (best == null || count > counts[best]!) {
      best = city;
    }
  }
  return best;
}

/// A date as the server keys it: month*100+day.
int libraryCleanupMonthDayOf(DateTime date) => date.month * 100 + date.day;

/// The "Could still free" figure: every quick win's bytes, once each has reported (null until then). A queue whose
/// count failed or is hidden counts as reported with nothing to free.
int? libraryCleanupCouldFree(Iterable<LibraryCleanupQueueCount> counts) {
  var bytes = 0;
  for (final count in counts) {
    if (count.isLoading) {
      return null;
    }
    bytes += count.value?.bytes.round() ?? 0;
  }
  return bytes;
}

/// One quick-win count as the overview holds it.
class LibraryCleanupQueueCount {
  const LibraryCleanupQueueCount.loading() : isLoading = true, value = null, hidden = false;
  const LibraryCleanupQueueCount.loaded(CleanupCountResponseDto this.value) : isLoading = false, hidden = false;

  /// The count call failed: the card still opens, without a figure.
  const LibraryCleanupQueueCount.failed() : isLoading = false, value = null, hidden = false;

  /// The server refused the count (403): the user may not use this queue, so the card is not shown.
  const LibraryCleanupQueueCount.hidden() : isLoading = false, value = null, hidden = true;

  final bool isLoading;
  final CleanupCountResponseDto? value;
  final bool hidden;

  double? get analysedPercent => value?.analysedPercent.orElse(null);

  /// Quality analysis is still running, so the figure is "so far".
  bool get isAnalysing {
    final percent = analysedPercent;
    return percent != null && percent < 100;
  }

  bool get isClear => value?.count == 0;
}

/// Where a rewind left off, for the today card's "Resume · 16 of 42": the photos decided so far (on earlier visits
/// and in the saved marks) of all the day's photos, the same position the session's top bar shows.
class LibraryCleanupResumePoint {
  const LibraryCleanupResumePoint({required this.decided, required this.total});

  final int decided;
  final int total;
}

/// Hero tags shared by the overview and the sessions (Slices 3, 6, 7): the today card's main collage photo and each
/// quick win's cover fly into the session's first card, which uses the same tag.
///
/// Format: `library-cleanup:rewind:<monthDay>` and `library-cleanup:queue:<queue slug>`.
abstract final class LibraryCleanupHeroTags {
  static String rewind(int monthDay) => 'library-cleanup:rewind:$monthDay';

  static String queue(LibraryCleanupQueue queue) => 'library-cleanup:queue:${queue.slug}';
}

/// The calendar's shades (the web's `shadeScale`): quartiles of the dates that have photos. Shading by rank rather than
/// by share of the busiest date keeps ordinary dates apart when one date holds far more photos.
class LibraryCleanupShadeScale {
  factory LibraryCleanupShadeScale(Iterable<int> counts) {
    final sorted = counts.where((count) => count > 0).toList()..sort();
    int at(double p) => sorted.isEmpty ? 0 : sorted[((p * sorted.length).ceil() - 1).clamp(0, sorted.length - 1)];
    return LibraryCleanupShadeScale._(at(0.25), at(0.5), at(0.75), sorted.isEmpty ? 0 : sorted.last);
  }

  const LibraryCleanupShadeScale._(this.q1, this.q2, this.q3, this.max);

  final int q1;
  final int q2;
  final int q3;
  final int max;

  /// 0 for no photos, then 1–4 by quartile (the web's `shadeLevel`).
  int level(int count) {
    if (count <= 0 || max <= 0) {
      return 0;
    }
    if (count >= max) {
      return 4;
    }
    if (count <= q1) {
      return 1;
    }
    if (count <= q2) {
      return 2;
    }
    return count <= q3 ? 3 : 4;
  }
}
