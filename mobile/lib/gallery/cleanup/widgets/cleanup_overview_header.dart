import 'package:flutter/material.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_overview.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_overview_bits.dart';
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

/// The current month's days as a small strip, in the web calendar's colours, with "See all ›" (mockup screen 2).
class LibraryCleanupYearTeaser extends StatelessWidget {
  const LibraryCleanupYearTeaser({super.key, required this.days, required this.today, required this.onSeeAll});

  final List<CleanupCalendarDayDto> days;
  final int today;
  final VoidCallback onSeeAll;

  /// The web calendar's reviewed green.
  static const reviewedColor = Color(0xFF2FBF71);

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final scale = LibraryCleanupShadeScale(days.map((day) => day.assetCount));
    final month = [
      for (final day in days)
        if (day.monthDay ~/ 100 == today ~/ 100) day,
    ]..sort((a, b) => a.monthDay.compareTo(b.monthDay));
    const alphas = [0.0, 0.3, 0.5, 0.72, 1.0];

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
                for (final day in month)
                  Container(
                    key: Key('cleanup-teaser-day-${day.monthDay}'),
                    width: 14,
                    height: 14,
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(3),
                      color: day.reviewedAt != null && day.assetCount > 0
                          ? reviewedColor
                          : scale.level(day.assetCount) == 0
                          ? scheme.surfaceContainerHighest
                          : scheme.primary.withValues(alpha: alphas[scale.level(day.assetCount)]),
                      border: day.monthDay == today ? Border.all(color: scheme.onSurface, width: 1.5) : null,
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
