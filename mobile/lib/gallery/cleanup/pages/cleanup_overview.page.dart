import 'dart:async';

import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_overview.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_queue.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_support.dart';
import 'package:immich_mobile/gallery/cleanup/providers/library_cleanup.providers.dart';
import 'package:immich_mobile/gallery/cleanup/providers/library_cleanup_overview.providers.dart';
import 'package:immich_mobile/gallery/cleanup/providers/library_cleanup_rewind.providers.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_overview_bits.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_overview_header.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_quick_wins.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_today_card.dart';
import 'package:immich_mobile/gallery/motion/entrance.dart';
import 'package:immich_mobile/gallery/motion/motion_tokens.dart';
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

  /// Days finished in a rewind since this screen was last on top; their teaser cells pop as they turn green.
  final Set<int> _popped = {};

  /// A quick win's queue; its cover, when the card shows one, flies into the first card (Bursts and Duplicates show an
  /// icon, as on web, so nothing flies). The cover is only read if the card already asked for it, so opening never
  /// sends a request of its own.
  void _openQueue(LibraryCleanupQueue queue) {
    final cover = ref.exists(libraryCleanupQueueCoverProvider(queue))
        ? ref.read(libraryCleanupQueueCoverProvider(queue)).valueOrNull
        : null;
    unawaited(
      context.pushRoute(
        LibraryCleanupQueueRoute(queue: queue.slug, heroAssetId: cover?.id, heroThumbhash: cover?.thumbhash),
      ),
    );
  }

  /// Today's rewind; the collage's large photo flies into its first card.
  void _startRewind() {
    final hero = ref.read(libraryCleanupDayPhotosProvider(_today)).valueOrNull?.collage.firstOrNull;
    unawaited(
      context.pushRoute(
        LibraryCleanupRewindRoute(monthDay: _today, heroAssetId: hero?.id, heroThumbhash: hero?.thumbhash),
      ),
    );
  }

  /// A finished day turns green with a pop once this screen is back on top (the rewind may have gone on to other days).
  void _takeFinishedDays() {
    final finished = ref.read(libraryCleanupFinishedDaysProvider);
    if (finished.isEmpty || !(ModalRoute.of(context)?.isCurrent ?? true)) {
      return;
    }
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) {
        return;
      }
      setState(() => _popped.addAll(finished));
      ref.read(libraryCleanupFinishedDaysProvider.notifier).update((days) => days.difference(finished));
    });
  }

  @override
  Widget build(BuildContext context) {
    ref.watch(libraryCleanupFinishedDaysProvider);
    _takeFinishedDays();
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
                    : LibraryCleanupTodayCard(monthDay: _today, day: day, onStart: _startRewind),
              ),
            ),
            const SizedBox(height: 22),
            arrive(1, LibraryCleanupQuickWins(trashEnabled: trashEnabled, onOpen: _openQueue)),
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
                      popDays: _popped,
                      onSeeAll: () => context.pushRoute(const LibraryCleanupYearRoute()),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
