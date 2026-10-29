import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_overview.dart';
import 'package:immich_mobile/gallery/cleanup/providers/library_cleanup_overview.providers.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_overview_bits.dart';
import 'package:immich_mobile/gallery/motion/pressable.dart';
import 'package:immich_mobile/gallery/motion/swap.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:openapi/api.dart';

/// Today's rewind, the first thing on the overview (mockup `1-flow.html`, screen 2; the web's `CleanupDayBanner`).
///
/// It renders from the calendar day and the day's years alone. The collage, the busiest year's city and the resume
/// position fill in later, inside a card of fixed height whose text is anchored to its bottom, so nothing moves when
/// they land.
class LibraryCleanupTodayCard extends ConsumerWidget {
  const LibraryCleanupTodayCard({super.key, required this.monthDay, required this.day, required this.onStart});

  static const height = 264.0;

  final int monthDay;

  /// The date's calendar entry (its photo count and whether it is reviewed).
  final CleanupCalendarDayDto? day;
  final VoidCallback onStart;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final photos = day?.assetCount ?? 0;
    if (photos == 0) {
      return _Card(monthDay: monthDay, onStart: null, summary: null);
    }
    final years = ref.watch(libraryCleanupDayYearsProvider(monthDay));
    return years.when(
      skipError: false,
      loading: () => const _CardSkeleton(),
      error: (_, _) => _CardError(onRetry: () => ref.invalidate(libraryCleanupDayYearsProvider(monthDay))),
      data: (years) => _Card(
        monthDay: monthDay,
        onStart: onStart,
        summary: _Summary(
          photos: years.fold(0, (sum, year) => sum + year.count),
          years: years.length,
          busiestYear: libraryCleanupBusiestYear(years)?.year,
          reviewed: day?.reviewedAt != null,
          photosOfDay: ref.watch(libraryCleanupDayPhotosProvider(monthDay)).valueOrNull,
        ),
      ),
    );
  }
}

class _Summary {
  const _Summary({
    required this.photos,
    required this.years,
    required this.busiestYear,
    required this.reviewed,
    required this.photosOfDay,
  });

  final int photos;
  final int years;
  final int? busiestYear;
  final bool reviewed;
  final LibraryCleanupDayPhotos? photosOfDay;
}

const _radius = BorderRadius.all(Radius.circular(22));
const _textOnPhoto = Colors.white;

class _Frame extends StatelessWidget {
  const _Frame({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) => ClipRRect(
    key: const Key('cleanup-today-card'),
    borderRadius: _radius,
    child: SizedBox(height: LibraryCleanupTodayCard.height, width: double.infinity, child: child),
  );
}

class _Card extends StatelessWidget {
  const _Card({required this.monthDay, required this.onStart, required this.summary});

  final int monthDay;
  final VoidCallback? onStart;

  /// Null for a date without photos.
  final _Summary? summary;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final summary = this.summary;
    final date = libraryCleanupMonthDayLabel(context, monthDay);
    final resume = summary?.photosOfDay?.resume;
    final minutes = summary == null ? null : libraryCleanupRewindMinutes(summary.photos);
    final city = summary?.photosOfDay?.city;
    final busiest = summary?.busiestYear;
    final detail = [
      if (summary != null && summary.reviewed)
        context.t.cleanup_banner_reviewed
      else if (minutes != null)
        context.t.cleanup_banner_estimate(minutes: minutes),
      if (busiest != null)
        city != null
            ? libraryCleanupMessage(context, 'cleanup_banner_busiest_city', {'year': '$busiest', 'city': city})
            : libraryCleanupMessage(context, 'cleanup_banner_busiest', {'year': '$busiest'}),
    ].join(' ');

    return _Frame(
      child: Stack(
        fit: StackFit.expand,
        children: [
          ColoredBox(color: Color.alphaBlend(scheme.primary.withValues(alpha: 0.28), scheme.surfaceContainerHighest)),
          if (summary != null) _Collage(monthDay: monthDay, photos: summary.photosOfDay?.collage),
          const DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                stops: [0.25, 1],
                colors: [Color(0x00000000), Color(0xEB05060A)],
              ),
            ),
          ),
          Positioned(
            left: 16,
            right: 16,
            bottom: 16,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  context.t.cleanup_banner_today(date: date).toUpperCase(),
                  key: const Key('cleanup-today-eyebrow'),
                  style: TextStyle(
                    color: Color.lerp(scheme.primary, Colors.white, 0.6),
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    letterSpacing: 1,
                  ),
                ),
                const SizedBox(height: 4),
                if (summary == null)
                  Text(
                    context.t.cleanup_banner_empty,
                    key: const Key('cleanup-today-counts'),
                    style: const TextStyle(color: _textOnPhoto, fontSize: 19, fontWeight: FontWeight.w700),
                  )
                else ...[
                  LibraryCleanupCountUp(
                    value: summary.photos,
                    builder: (context, shown) => Text(
                      context.t.cleanup_banner_photos_years(
                        photos: shown,
                        years: summary.photos == 0 ? 0 : (summary.years * shown / summary.photos).round(),
                      ),
                      key: const Key('cleanup-today-counts'),
                      style: const TextStyle(
                        color: _textOnPhoto,
                        fontSize: 21,
                        fontWeight: FontWeight.w700,
                        fontFeatures: [FontFeature.tabularFigures()],
                      ),
                    ),
                  ),
                  const SizedBox(height: 2),
                  // Two lines, always: the city arriving after the counts must not push the text up.
                  SizedBox(
                    height: 34,
                    child: GallerySwap(
                      value: detail,
                      rise: 0,
                      alignment: AlignmentDirectional.topStart,
                      child: Text(
                        detail,
                        key: const Key('cleanup-today-detail'),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(color: _textOnPhoto.withValues(alpha: 0.78), fontSize: 12.5, height: 1.3),
                      ),
                    ),
                  ),
                ],
                const SizedBox(height: 10),
                GalleryPressable(
                  enabled: onStart != null,
                  pressedScale: 0.95,
                  child: SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      key: const Key('cleanup-today-start'),
                      onPressed: onStart,
                      icon: const Icon(Icons.play_arrow_rounded),
                      style: FilledButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 12),
                        shape: const StadiumBorder(),
                        disabledBackgroundColor: Colors.white.withValues(alpha: 0.16),
                        disabledForegroundColor: Colors.white.withValues(alpha: 0.55),
                      ),
                      label: GallerySwap(
                        value: resume == null ? null : '${resume.decided}/${resume.total}',
                        alignment: Alignment.center,
                        child: Text(
                          resume == null
                              ? context.t.cleanup_start_todays_rewind
                              : context.t.cleanup_resume_position(decided: resume.decided, total: resume.total),
                          style: const TextStyle(fontWeight: FontWeight.w600),
                        ),
                      ),
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

/// Up to three of the date's photos: one large on the left, two stacked on the right (mockup screen 2). Before they
/// arrive the tiles are plain, in the same places.
class _Collage extends StatelessWidget {
  const _Collage({required this.monthDay, required this.photos});

  final int monthDay;
  final List<CleanupAssetDto>? photos;

  @override
  Widget build(BuildContext context) {
    final photos = this.photos ?? const [];
    Widget tile(int index) {
      if (index >= photos.length) {
        return const SizedBox.expand();
      }
      final image = Image(
        key: Key('cleanup-today-photo-$index'),
        image: libraryCleanupThumbnail(photos[index]),
        fit: BoxFit.cover,
        width: double.infinity,
        height: double.infinity,
        gaplessPlayback: true,
        errorBuilder: (_, _, _) => const SizedBox.expand(),
      );
      // The large photo flies into the rewind's first card (Slice 3).
      return index == 0 ? Hero(tag: LibraryCleanupHeroTags.rewind(monthDay), child: image) : image;
    }

    if (photos.length <= 1) {
      return tile(0);
    }
    return Row(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Expanded(flex: 2, child: tile(0)),
        const SizedBox(width: 3),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(child: tile(1)),
              if (photos.length > 2) ...[const SizedBox(height: 3), Expanded(child: tile(2))],
            ],
          ),
        ),
      ],
    );
  }
}

class _CardSkeleton extends StatelessWidget {
  const _CardSkeleton();

  @override
  Widget build(BuildContext context) => const LibraryCleanupSkeleton(
    key: Key('cleanup-today-skeleton'),
    height: LibraryCleanupTodayCard.height,
    radius: 22,
  );
}

class _CardError extends StatelessWidget {
  const _CardError({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return _Frame(
      child: ColoredBox(
        color: scheme.surfaceContainerLow,
        child: LibraryCleanupInlineError(onRetry: onRetry),
      ),
    );
  }
}

/// "Could not load Cleanup." with Retry, in place of what failed.
class LibraryCleanupInlineError extends StatelessWidget {
  const LibraryCleanupInlineError({super.key, required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Center(
      key: const Key('cleanup-overview-error'),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.cloud_off_rounded, color: scheme.onSurfaceVariant),
            const SizedBox(height: 8),
            Text(
              context.t.cleanup_overview_load_failed,
              textAlign: TextAlign.center,
              style: TextStyle(color: scheme.onSurfaceVariant),
            ),
            const SizedBox(height: 8),
            TextButton(key: const Key('cleanup-overview-retry'), onPressed: onRetry, child: Text(context.t.retry)),
          ],
        ),
      ),
    );
  }
}
