import 'dart:async';

import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/gallery/cleanup/providers/library_cleanup.providers.dart';
import 'package:immich_mobile/gallery/cleanup/providers/library_cleanup_overview.providers.dart';
import 'package:immich_mobile/gallery/motion/pressable.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/routing/router.dart';

/// The Library page's Cleanup entry: a full-width row under Favorites, Archived, Shared links and Trash, with today's
/// count as its subtitle ("Today: 42 photos from 6 years"). Shown only when the support probe found Library Cleanup on
/// the server; the subtitle fills in after the button, into a line that is already there.
class LibraryCleanupButton extends ConsumerStatefulWidget {
  const LibraryCleanupButton({super.key});

  @override
  ConsumerState<LibraryCleanupButton> createState() => _LibraryCleanupButtonState();
}

class _LibraryCleanupButtonState extends ConsumerState<LibraryCleanupButton> {
  @override
  void initState() {
    super.initState();
    // Library opening: a probe that failed on the network or a 5xx is asked again.
    unawaited(
      Future.microtask(() {
        if (mounted) {
          ref.read(libraryCleanupSupportProvider.notifier).refreshIfFailed();
        }
      }),
    );
  }

  @override
  Widget build(BuildContext context) {
    final calendar = ref.watch(libraryCleanupCalendarProvider);
    if (calendar == null) {
      return const SizedBox.shrink();
    }
    final today = libraryCleanupToday(ref);
    final photos = calendar.days.where((day) => day.monthDay == today).firstOrNull?.assetCount ?? 0;
    final String? subtitle;
    if (photos == 0) {
      subtitle = context.t.cleanup_banner_empty;
    } else {
      final years = ref.watch(libraryCleanupDayYearsProvider(today)).valueOrNull;
      subtitle = years == null
          ? null
          : context.t.cleanup_library_today(
              summary: context.t.cleanup_banner_photos_years(
                photos: years.fold(0, (sum, year) => sum + year.count),
                years: years.length,
              ),
            );
    }

    final scheme = context.colorScheme;
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: GalleryPressable(
        pressedScale: 0.96,
        child: Material(
          color: scheme.surfaceContainerLow,
          shape: RoundedRectangleBorder(
            borderRadius: const BorderRadius.all(Radius.circular(25)),
            side: BorderSide(color: scheme.onSurface.withAlpha(10), width: 1),
          ),
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            key: const Key('library-cleanup-button'),
            onTap: () => context.pushRoute(const LibraryCleanupOverviewRoute()),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
              child: Row(
                children: [
                  Icon(Icons.auto_awesome_outlined, color: context.primaryColor),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(context.t.cleanup, style: TextStyle(color: scheme.onSurface, fontSize: 15)),
                        // The line is there before the count, so Library does not shift when it lands.
                        Text(
                          subtitle ?? '',
                          key: const Key('library-cleanup-subtitle'),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 12),
                        ),
                      ],
                    ),
                  ),
                  Icon(Icons.chevron_right_rounded, color: scheme.onSurfaceVariant),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
