import 'package:flutter/material.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_overview.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_calendar_bits.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_overview_bits.dart';
import 'package:immich_mobile/gallery/motion/pop.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/utils/bytes_units.dart';
import 'package:openapi/api.dart';

/// "Cleanup", the streak and days reviewed, and "Could still free" on the right, counting up once every quick win has
/// reported (the web hub's header).
class LibraryCleanupOverviewHeader extends StatelessWidget {
  const LibraryCleanupOverviewHeader({super.key, required this.calendar, required this.couldFree});

  final CleanupCalendarResponseDto? calendar;

  /// Null until every quick win has reported.
  final int? couldFree;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.colorScheme.onSurfaceVariant;
    final calendar = this.calendar;
    final couldFree = this.couldFree;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(context.t.cleanup, style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700)),
                const SizedBox(height: 2),
                SizedBox(
                  height: 18,
                  child: calendar == null
                      ? const Align(
                          alignment: AlignmentDirectional.centerStart,
                          child: LibraryCleanupSkeleton(width: 160, height: 10, radius: 4),
                        )
                      : Text(
                          '${context.t.cleanup_streak(count: calendar.streak)} · '
                          '${context.t.cleanup_days_reviewed(count: calendar.daysReviewed)}',
                          key: const Key('cleanup-overview-progress'),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: theme.textTheme.bodySmall?.copyWith(color: muted),
                        ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 12),
          ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 140, minHeight: 36),
            child: couldFree == null
                ? const Align(
                    alignment: AlignmentDirectional.bottomEnd,
                    widthFactor: 1,
                    child: LibraryCleanupSkeleton(width: 96, height: 14, radius: 7),
                  )
                : LibraryCleanupCountUp(
                    value: couldFree,
                    builder: (context, shown) => Text(
                      libraryCleanupMessage(context, 'cleanup_could_still_free', {'size': formatBytes(shown)}),
                      key: const Key('cleanup-could-free'),
                      textAlign: TextAlign.end,
                      maxLines: 2,
                      style: theme.textTheme.labelMedium?.copyWith(
                        color: muted,
                        fontWeight: FontWeight.w600,
                        fontFeatures: const [FontFeature.tabularFigures()],
                      ),
                    ),
                  ),
          ),
        ],
      ),
    );
  }
}

/// The current month's days as a small strip, with "See all ›" (mockup screen 2). Its cells are the year screen's: the
/// same days (every day of the month, from the 1st) in the same colours (cleanup_calendar_bits.dart), so the teaser
/// and the screen it opens never disagree.
class LibraryCleanupYearTeaser extends StatelessWidget {
  const LibraryCleanupYearTeaser({
    super.key,
    required this.days,
    required this.today,
    required this.onSeeAll,
    this.popDays = const {},
  });

  final List<CleanupCalendarDayDto> days;
  final int today;
  final VoidCallback onSeeAll;

  /// Days just finished in a rewind: their cells pop as they turn green.
  final Set<int> popDays;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final scale = LibraryCleanupShadeScale(days.map((day) => day.assetCount));
    final byMonthDay = libraryCleanupDaysByMonthDay(days);
    final month = today ~/ 100;

    return Padding(
      key: const Key('cleanup-year-teaser'),
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text(context.t.cleanup_your_year, style: theme.textTheme.titleSmall)),
              TextButton(
                key: const Key('cleanup-see-all'),
                onPressed: onSeeAll,
                child: Text('${context.t.cleanup_see_all} ›'),
              ),
            ],
          ),
          ExcludeSemantics(
            child: Wrap(
              spacing: 4,
              runSpacing: 4,
              children: [
                for (var day = 1; day <= libraryCleanupDaysIn(month); day++)
                  _popIf(
                    popDays.contains(month * 100 + day),
                    month * 100 + day,
                    Container(
                      key: Key('cleanup-teaser-day-${month * 100 + day}'),
                      width: 14,
                      height: 14,
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(3),
                        color: libraryCleanupCellColor(scheme, byMonthDay[month * 100 + day], scale),
                        border: month * 100 + day == today ? Border.all(color: scheme.onSurface, width: 1.5) : null,
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

Widget _popIf(bool pop, int monthDay, Widget cell) =>
    pop ? GalleryPop(key: ValueKey('cleanup-teaser-pop-$monthDay'), onMount: true, child: cell) : cell;
