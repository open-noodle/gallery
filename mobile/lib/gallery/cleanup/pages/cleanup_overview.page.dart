import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_overview.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_support.dart';
import 'package:immich_mobile/gallery/cleanup/providers/library_cleanup.providers.dart';
import 'package:immich_mobile/gallery/cleanup/providers/library_cleanup_overview.providers.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_overview_bits.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_overview_header.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_quick_wins.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_today_card.dart';
import 'package:immich_mobile/gallery/motion/entrance.dart';
import 'package:immich_mobile/gallery/motion/motion_tokens.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/routing/router.dart';

/// The Cleanup overview (specs/2026-10-29-mobile-library-cleanup-design.md, "Cleanup overview"; mockup `1-flow.html`,
/// screen 2): today's rewind first, the quick wins under it, the current month's teaser last.
///
/// The today card needs only the probe's calendar and the day's years; the counts, covers and the trash total load
/// after it into places that are already laid out, so it never moves. Pull to refresh reloads every section.
@RoutePage()
class LibraryCleanupOverviewPage extends ConsumerStatefulWidget {
  const LibraryCleanupOverviewPage({super.key});

  @override
  ConsumerState<LibraryCleanupOverviewPage> createState() => _LibraryCleanupOverviewPageState();
}

class _LibraryCleanupOverviewPageState extends ConsumerState<LibraryCleanupOverviewPage> {
  /// Read once when the page opens, and again on refresh, so a date change is picked up without a jump mid-view.
  late int _today = libraryCleanupToday(ref);

  /// The arrival cascade: today card, quick wins, then the year teaser.
  static const _stagger = Duration(milliseconds: 70);

  Future<void> _refresh() {
    setState(() => _today = libraryCleanupToday(ref));
    return libraryCleanupRefreshOverview(ref, _today, trashEnabled: ref.read(libraryCleanupTrashEnabledProvider));
  }

  // Start, the quick wins and "See all" open placeholders until their slices land: the rewind in Slice 3, the queues
  // in Slices 6 and 7, Your year in Slice 8.
  void _open(String title) => context.pushRoute(LibraryCleanupPlaceholderRoute(title: title));

  @override
  Widget build(BuildContext context) {
    final support = ref.watch(libraryCleanupSupportProvider);
    final calendar = support.valueOrNull?.calendar;
    final trashEnabled = ref.watch(libraryCleanupTrashEnabledProvider);
    final reduced = GalleryMotion.reduced(context);
    final couldFree = libraryCleanupCouldFree([
      for (final queue in libraryCleanupQuickWins)
        ref.watch(libraryCleanupQueueCountProvider(queue)).valueOrNull ?? const LibraryCleanupQueueCount.loading(),
    ]);
    final failed =
        calendar == null && !support.isLoading && support.valueOrNull?.status != LibraryCleanupSupportStatus.unknown;
    final day = calendar?.days.where((day) => day.monthDay == _today).firstOrNull;

    Widget arrive(int step, Widget child) =>
        GalleryEntrance(delay: _stagger * step, offset: const Offset(0, 14), enabled: !reduced, child: child);

    return Scaffold(
      appBar: AppBar(scrolledUnderElevation: 0),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: ListView(
          key: const Key('cleanup-overview-list'),
          physics: const AlwaysScrollableScrollPhysics(),
          padding: EdgeInsets.only(bottom: 24 + MediaQuery.paddingOf(context).bottom),
          children: [
            LibraryCleanupOverviewHeader(calendar: calendar, couldFree: couldFree),
            const SizedBox(height: 14),
            arrive(
              0,
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: failed
                    ? SizedBox(
                        height: LibraryCleanupTodayCard.height,
                        child: LibraryCleanupInlineError(onRetry: () => ref.invalidate(libraryCleanupSupportProvider)),
                      )
                    : calendar == null
                    ? const LibraryCleanupSkeleton(height: LibraryCleanupTodayCard.height, radius: 22)
                    : LibraryCleanupTodayCard(
                        monthDay: _today,
                        day: day,
                        onStart: () => _open(libraryCleanupMonthDayLabel(context, _today)),
                      ),
              ),
            ),
            const SizedBox(height: 22),
            arrive(
              1,
              LibraryCleanupQuickWins(
                trashEnabled: trashEnabled,
                onOpen: (queue) => _open(libraryCleanupQueueName(context, queue)),
              ),
            ),
            const SizedBox(height: 18),
            arrive(
              2,
              calendar == null
                  ? const Padding(
                      padding: EdgeInsets.symmetric(horizontal: 16),
                      child: LibraryCleanupSkeleton(height: 64),
                    )
                  : LibraryCleanupYearTeaser(
                      days: calendar.days,
                      today: _today,
                      onSeeAll: () => _open(context.t.cleanup_your_year),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Stands in for a Cleanup screen whose slice has not landed yet (the rewind, a queue, Your year), so the overview's
/// navigation can be used and tested now. Removed once the last of them lands.
@RoutePage()
class LibraryCleanupPlaceholderPage extends StatelessWidget {
  const LibraryCleanupPlaceholderPage({super.key, required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(title, key: const Key('cleanup-placeholder-title'))),
      body: Center(
        key: const Key('cleanup-placeholder'),
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            context.t.cleanup_coming_soon,
            textAlign: TextAlign.center,
            style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant),
          ),
        ),
      ),
    );
  }
}
