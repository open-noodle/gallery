import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_overview.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_overview_bits.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:openapi/api.dart';

// What Your year's two screens share (specs/2026-10-29-mobile-library-cleanup-design.md, "Your year"): the web
// calendar's colours (`CleanupCalendar.svelte`), each month's days, and the day labels.

/// The days a month shows. A cell is a date across every year, so February has its 29th (2000 is a leap year).
int libraryCleanupDaysIn(int month) => DateTime(2000, month + 1, 0).day;

/// The month after [month] moved by [delta], wrapping December to January.
int libraryCleanupShiftMonth(int month, int delta) => (month - 1 + delta) % 12 + 1;

/// A day without photos has nothing to review, so it never shows as reviewed (as on web).
bool libraryCleanupIsReviewed(CleanupCalendarDayDto? day) =>
    day != null && day.reviewedAt != null && day.assetCount > 0;

/// The month's name, short ("Oct") on the year's cards and long ("October") on the month screen.
String libraryCleanupMonthName(BuildContext context, int month, {bool long = false}) {
  final locale = Localizations.maybeLocaleOf(context)?.toLanguageTag() ?? 'en';
  final date = DateTime(2000, month);
  try {
    return (long ? DateFormat.MMMM(locale) : DateFormat.MMM(locale)).format(date);
  } catch (_) {
    return (long ? DateFormat.MMMM('en') : DateFormat.MMM('en')).format(date);
  }
}

/// The calendar's days by month-day.
Map<int, CleanupCalendarDayDto> libraryCleanupDaysByMonthDay(List<CleanupCalendarDayDto> days) => {
  for (final day in days) day.monthDay: day,
};

/// A month's progress: days reviewed of its days, and the days with photos still to review.
class LibraryCleanupMonthProgress {
  factory LibraryCleanupMonthProgress.of(int month, Map<int, CleanupCalendarDayDto> days) {
    var reviewed = 0;
    var toGo = 0;
    final total = libraryCleanupDaysIn(month);
    for (var day = 1; day <= total; day++) {
      final entry = days[month * 100 + day];
      if (libraryCleanupIsReviewed(entry)) {
        reviewed++;
      } else if ((entry?.assetCount ?? 0) > 0) {
        toGo++;
      }
    }
    return LibraryCleanupMonthProgress._(reviewed, total, toGo);
  }

  const LibraryCleanupMonthProgress._(this.reviewed, this.days, this.toGo);

  final int reviewed;
  final int days;
  final int toGo;

  /// Every day with photos is reviewed (and there is at least one).
  bool get complete => reviewed > 0 && toGo == 0;
}

/// The web calendar's reviewed green (Tailwind `green-500`).
const libraryCleanupReviewedGreen = Color(0xFF22C55E);

/// The web's shades of the primary colour for photos to review, by quartile level 1–4.
const _levelAlphas = [0.0, 0.35, 0.55, 0.75, 1.0];

/// A day cell's fill: neutral without photos, the primary colour by quartile to review, green once reviewed (lighter for
/// a day with few photos, as on web).
Color libraryCleanupCellColor(ColorScheme scheme, CleanupCalendarDayDto? day, LibraryCleanupShadeScale scale) {
  final level = scale.level(day?.assetCount ?? 0);
  if (level == 0) {
    return scheme.surfaceContainerHighest;
  }
  if (libraryCleanupIsReviewed(day)) {
    return level <= 2 ? libraryCleanupReviewedGreen.withValues(alpha: 0.55) : libraryCleanupReviewedGreen;
  }
  return scheme.primary.withValues(alpha: _levelAlphas[level]);
}

/// A day number's colour on its cell: light on the darker shades and green, as on web.
Color libraryCleanupCellNumberColor(ColorScheme scheme, CleanupCalendarDayDto? day, LibraryCleanupShadeScale scale) {
  final level = scale.level(day?.assetCount ?? 0);
  final strong = level >= 3 || (level > 0 && libraryCleanupIsReviewed(day));
  if (!strong) {
    return scheme.onSurface;
  }
  return scheme.brightness == Brightness.dark ? Colors.black : Colors.white;
}

/// A day cell's accessible label, in the web's words ("August 15: 5 photos", "…, reviewed").
String libraryCleanupDayLabel(BuildContext context, int monthDay, CleanupCalendarDayDto? day) {
  final date = libraryCleanupMonthDayLabel(context, monthDay);
  final count = day?.assetCount ?? 0;
  return libraryCleanupIsReviewed(day)
      ? context.t.cleanup_calendar_day_label_reviewed(date: date, count: count)
      : context.t.cleanup_calendar_day_label(date: date, count: count);
}

/// Hero tags of Your year: a month card grows into its month screen and shrinks back into it.
abstract final class LibraryCleanupYearHeroTags {
  static String month(int month) => 'library-cleanup:month:$month';
}

/// The legend under the year's months, in the web's words.
class LibraryCleanupCalendarLegend extends StatelessWidget {
  const LibraryCleanupCalendarLegend({super.key});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final style = Theme.of(context).textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant);
    Widget swatch(Color color, {bool outlined = false}) => Container(
      width: 12,
      height: 12,
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(3),
        border: outlined ? Border.all(color: scheme.onSurface, width: 1.5) : null,
      ),
    );
    Widget item(List<Widget> swatches, String label) => Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        ...swatches.expand((swatch) => [swatch, const SizedBox(width: 2)]),
        const SizedBox(width: 4),
        Text(label, style: style),
      ],
    );
    return Wrap(
      key: const Key('cleanup-calendar-legend'),
      spacing: 14,
      runSpacing: 8,
      children: [
        item([swatch(scheme.surfaceContainerHighest)], context.t.cleanup_legend_no_photos),
        item([
          for (final alpha in _levelAlphas.skip(1)) swatch(scheme.primary.withValues(alpha: alpha)),
        ], context.t.cleanup_legend_to_review),
        item([swatch(libraryCleanupReviewedGreen)], context.t.cleanup_legend_reviewed),
        item([swatch(scheme.surfaceContainerHighest, outlined: true)], context.t.cleanup_legend_today),
      ],
    );
  }
}
