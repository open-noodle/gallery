import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_overview.dart';
import 'package:immich_mobile/gallery/cleanup/providers/library_cleanup_overview.providers.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_calendar_bits.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_overview_bits.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_today_card.dart';
import 'package:immich_mobile/gallery/motion/motion_tokens.dart';
import 'package:immich_mobile/gallery/motion/pressable.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:openapi/api.dart';

/// The day sheet on a month screen (specs/2026-10-29-mobile-library-cleanup-design.md, "Your year"; mockup
/// `4-calendar.html`, screen 2): the date, "N photos from Y years", the estimate and the busiest year, up to four
/// thumbnails, and "Rewind this day" (or "Resume · X of N" when marks are saved for it).
///
/// Tapping another day swaps the contents in place: they cross-fade, and the new ones slide a few pixels in from the
/// side the user moved towards ([direction]: 1 for a later day, -1 for an earlier one). Reduced motion: a plain fade.
class LibraryCleanupDaySheet extends StatelessWidget {
  const LibraryCleanupDaySheet({
    super.key,
    required this.monthDay,
    required this.day,
    required this.direction,
    required this.onRewind,
    required this.onClose,
  });

  /// The sheet's height, the same for every day, so a swap never moves it.
  static const height = 268.0;

  final int monthDay;
  final CleanupCalendarDayDto? day;
  final int direction;
  final VoidCallback onRewind;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final reduced = GalleryMotion.reduced(context);
    return GestureDetector(
      // Dragging the sheet down puts it away.
      onVerticalDragEnd: (details) {
        if ((details.primaryVelocity ?? 0) > 200) {
          onClose();
        }
      },
      child: Material(
        key: const Key('cleanup-day-sheet'),
        color: scheme.surfaceContainer,
        elevation: 6,
        shadowColor: Colors.black54,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(22)),
        child: SizedBox(
          height: height + MediaQuery.paddingOf(context).bottom,
          child: Padding(
            padding: EdgeInsets.fromLTRB(18, 8, 18, 14 + MediaQuery.paddingOf(context).bottom),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Center(
                  child: Container(
                    width: 36,
                    height: 4,
                    decoration: BoxDecoration(
                      color: scheme.onSurfaceVariant.withValues(alpha: 0.4),
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                ),
                const SizedBox(height: 10),
                Expanded(
                  child: AnimatedSwitcher(
                    duration: GalleryMotion.quick,
                    switchInCurve: GalleryMotion.settle,
                    switchOutCurve: GalleryMotion.exit,
                    layoutBuilder: (current, previous) =>
                        Stack(alignment: AlignmentDirectional.topStart, children: [...previous, ?current]),
                    transitionBuilder: (child, animation) {
                      final incoming = child.key == ValueKey(monthDay);
                      return AnimatedBuilder(
                        animation: animation,
                        child: child,
                        builder: (context, child) {
                          final t = animation.value;
                          final faded = Opacity(opacity: t.clamp(0.0, 1.0), child: child);
                          if (reduced) {
                            return faded;
                          }
                          // In from the side of travel; out towards the other.
                          final dx = (incoming ? 1 : -1) * direction * 14 * (1 - t);
                          return Transform.translate(offset: Offset(dx, 0), child: faded);
                        },
                      );
                    },
                    child: KeyedSubtree(
                      key: ValueKey(monthDay),
                      child: _DayContents(monthDay: monthDay, day: day, onRewind: onRewind),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _DayContents extends ConsumerWidget {
  const _DayContents({required this.monthDay, required this.day, required this.onRewind});

  final int monthDay;
  final CleanupCalendarDayDto? day;
  final VoidCallback onRewind;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final muted = scheme.onSurfaceVariant;
    final date = Text(
      libraryCleanupMonthDayLabel(context, monthDay).toUpperCase(),
      key: const Key('cleanup-day-sheet-date'),
      style: TextStyle(color: scheme.primary, fontSize: 11, fontWeight: FontWeight.w600, letterSpacing: 1),
    );

    // A day without photos has nothing to load and nothing to open.
    if ((day?.assetCount ?? 0) == 0) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          date,
          const SizedBox(height: 6),
          Text(
            context.t.cleanup_banner_empty,
            key: const Key('cleanup-day-sheet-empty'),
            style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
          ),
        ],
      );
    }

    final years = ref.watch(libraryCleanupDayYearsProvider(monthDay));
    return years.when(
      skipError: false,
      loading: () => Column(
        key: const Key('cleanup-day-sheet-loading'),
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          date,
          const SizedBox(height: 8),
          const LibraryCleanupSkeleton(width: 190, height: 16, radius: 6),
          const SizedBox(height: 8),
          const LibraryCleanupSkeleton(width: 240, height: 11, radius: 5),
          const SizedBox(height: 14),
          const LibraryCleanupSkeleton(height: 64),
        ],
      ),
      error: (_, _) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          date,
          Expanded(
            child: LibraryCleanupInlineError(onRetry: () => ref.invalidate(libraryCleanupDayYearsProvider(monthDay))),
          ),
        ],
      ),
      data: (years) {
        final photos = years.fold(0, (sum, year) => sum + year.count);
        final busiest = libraryCleanupBusiestYear(years)?.year;
        final ofDay = ref.watch(libraryCleanupDayPhotosProvider(monthDay)).valueOrNull;
        final minutes = libraryCleanupRewindMinutes(photos);
        final city = ofDay?.city;
        final resume = ofDay?.resume;
        // The same words as the today card (the web banner's).
        final detail = [
          if (libraryCleanupIsReviewed(day))
            context.t.cleanup_banner_reviewed
          else if (minutes != null)
            context.t.cleanup_banner_estimate(minutes: minutes),
          if (busiest != null)
            city != null
                ? libraryCleanupMessage(context, 'cleanup_banner_busiest_city', {'year': '$busiest', 'city': city})
                : libraryCleanupMessage(context, 'cleanup_banner_busiest', {'year': '$busiest'}),
        ].join(' ');
        final preview = ofDay?.preview ?? const <CleanupAssetDto>[];

        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            date,
            const SizedBox(height: 4),
            Text(
              context.t.cleanup_banner_photos_years(photos: photos, years: years.length),
              key: const Key('cleanup-day-sheet-counts'),
              style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 2),
            SizedBox(
              height: 34,
              child: Text(
                detail,
                key: const Key('cleanup-day-sheet-detail'),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.bodySmall?.copyWith(color: muted, height: 1.3),
              ),
            ),
            const SizedBox(height: 8),
            SizedBox(
              height: 64,
              child: Row(
                children: [
                  for (var index = 0; index < libraryCleanupPreviewSize; index++) ...[
                    if (index > 0) const SizedBox(width: 6),
                    Expanded(
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(10),
                        child: index < preview.length
                            ? Image(
                                key: Key('cleanup-day-sheet-thumb-$index'),
                                image: libraryCleanupThumbnail(preview[index]),
                                fit: BoxFit.cover,
                                gaplessPlayback: true,
                                errorBuilder: (_, _, _) => ColoredBox(color: scheme.surfaceContainerHighest),
                              )
                            : ColoredBox(color: scheme.surfaceContainerHighest.withValues(alpha: 0.5)),
                      ),
                    ),
                  ],
                ],
              ),
            ),
            const Spacer(),
            GalleryPressable(
              pressedScale: 0.95,
              child: FilledButton.icon(
                key: const Key('cleanup-day-sheet-rewind'),
                onPressed: onRewind,
                icon: const Icon(Icons.play_arrow_rounded),
                style: FilledButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  shape: const StadiumBorder(),
                ),
                label: Text(
                  resume == null
                      ? context.t.cleanup_rewind_this_day
                      : context.t.cleanup_resume_position(decided: resume.decided, total: resume.total),
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}
