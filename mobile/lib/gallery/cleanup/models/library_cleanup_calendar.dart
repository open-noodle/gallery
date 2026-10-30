import 'package:openapi/api.dart';

/// The first date after [from], going forward and wrapping at the year's end, that has photos and is not yet
/// reviewed (the web's `nextUnreviewedDay`). Null when every day is reviewed or empty.
int? libraryCleanupNextUnreviewedDay(List<CleanupCalendarDayDto> days, int from) {
  final candidates =
      days
          .where((day) => day.monthDay != from && day.assetCount > 0 && day.reviewedAt == null)
          .map((day) => day.monthDay)
          .toList()
        ..sort();
  return candidates.where((monthDay) => monthDay > from).firstOrNull ?? candidates.firstOrNull;
}
