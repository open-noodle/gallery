import 'dart:async';

import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_overview.dart';
import 'package:immich_mobile/gallery/cleanup/providers/library_cleanup.providers.dart';
import 'package:immich_mobile/gallery/cleanup/providers/library_cleanup_overview.providers.dart';
import 'package:immich_mobile/gallery/cleanup/providers/library_cleanup_year.providers.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_calendar_bits.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_overview_bits.dart';
import 'package:immich_mobile/gallery/motion/motion_tokens.dart';
import 'package:immich_mobile/gallery/motion/pressable.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/routing/router.dart';
import 'package:openapi/api.dart';

/// Your year (specs/2026-10-29-mobile-library-cleanup-design.md, "Your year"; mockup `4-calendar.html`, screen 1):
/// twelve month cards, three across. A month card is the only tap target; it grows into its month screen.
///
/// A month whose every day with photos is reviewed glows once, on the first arrival after it became complete.
@RoutePage()
class LibraryCleanupYearPage extends ConsumerStatefulWidget {
  const LibraryCleanupYearPage({super.key});

  @override
  ConsumerState<LibraryCleanupYearPage> createState() => _LibraryCleanupYearPageState();
}

class _LibraryCleanupYearPageState extends ConsumerState<LibraryCleanupYearPage> {
  late final int _today = libraryCleanupToday(ref);

  /// Bumped for a month each time it glows.
  final _glows = <int, int>{};
  bool _arrivalPending = false;

  /// Notes the arrival once the frame is drawn, while this screen is the one shown.
  void _arrive(Map<int, CleanupCalendarDayDto> days) {
    if (_arrivalPending) {
      return;
    }
    _arrivalPending = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _arrivalPending = false;
      if (!mounted || !(ModalRoute.of(context)?.isCurrent ?? true)) {
        return;
      }
      final complete = {
        for (var month = 1; month <= 12; month++)
          if (LibraryCleanupMonthProgress.of(month, days).complete) month,
      };
      final glow = ref.read(libraryCleanupCompletedMonthsProvider.notifier).arrive(complete);
      if (glow.isNotEmpty) {
        setState(() {
          for (final month in glow) {
            _glows[month] = (_glows[month] ?? 0) + 1;
          }
        });
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final calendar = ref.watch(libraryCleanupCalendarProvider);
    final theme = Theme.of(context);
    final days = calendar == null ? null : libraryCleanupDaysByMonthDay(calendar.days);
    final isCurrent = ModalRoute.of(context)?.isCurrent ?? true;
    if (days != null && isCurrent) {
      _arrive(days);
    }
    final scale = calendar == null ? null : LibraryCleanupShadeScale(calendar.days.map((day) => day.assetCount));

    return Scaffold(
      appBar: AppBar(title: Text(context.t.cleanup_your_year), scrolledUnderElevation: 0),
      body: ListView(
        key: const Key('cleanup-year-list'),
        padding: EdgeInsets.fromLTRB(16, 0, 16, 24 + MediaQuery.paddingOf(context).bottom),
        children: [
          SizedBox(
            height: 20,
            child: calendar == null
                ? const Align(
                    alignment: AlignmentDirectional.centerStart,
                    child: LibraryCleanupSkeleton(width: 160, height: 10, radius: 4),
                  )
                : Text(
                    context.t.cleanup_days_reviewed(count: calendar.daysReviewed),
                    key: const Key('cleanup-year-progress'),
                    style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                  ),
          ),
          const SizedBox(height: 10),
          GridView.count(
            key: const Key('cleanup-year-months'),
            crossAxisCount: 3,
            mainAxisSpacing: 10,
            crossAxisSpacing: 10,
            childAspectRatio: 0.82,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            children: [
              for (var month = 1; month <= 12; month++)
                days == null
                    ? const LibraryCleanupSkeleton(height: double.infinity)
                    : _MonthCard(
                        month: month,
                        days: days,
                        scale: scale!,
                        today: _today,
                        glow: _glows[month] ?? 0,
                        onOpen: () => context.pushRoute(LibraryCleanupMonthRoute(month: month)),
                      ),
            ],
          ),
          const SizedBox(height: 16),
          const LibraryCleanupCalendarLegend(),
        ],
      ),
    );
  }
}

class _MonthCard extends StatelessWidget {
  const _MonthCard({
    required this.month,
    required this.days,
    required this.scale,
    required this.today,
    required this.glow,
    required this.onOpen,
  });

  final int month;
  final Map<int, CleanupCalendarDayDto> days;
  final LibraryCleanupShadeScale scale;
  final int today;

  /// Changes each time the card glows.
  final int glow;
  final VoidCallback onOpen;

  static const radius = BorderRadius.all(Radius.circular(14));

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final current = month == today ~/ 100;
    final progress = LibraryCleanupMonthProgress.of(month, days);
    final name = libraryCleanupMonthName(context, month);
    final count = '${progress.reviewed}/${progress.days}';
    final card = Hero(
      tag: LibraryCleanupYearHeroTags.month(month),
      flightShuttleBuilder: libraryCleanupMonthShuttle,
      child: Material(
        color: scheme.surfaceContainerLow,
        shape: RoundedRectangleBorder(
          borderRadius: radius,
          side: current ? BorderSide(color: scheme.primary, width: 1.5) : BorderSide.none,
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          key: Key('cleanup-month-card-$month'),
          onTap: onOpen,
          child: Padding(
            padding: const EdgeInsets.all(8),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.labelMedium?.copyWith(
                          fontWeight: current ? FontWeight.w700 : FontWeight.w500,
                          color: current ? scheme.onSurface : scheme.onSurfaceVariant,
                        ),
                      ),
                    ),
                    Text(
                      count,
                      key: Key('cleanup-month-count-$month'),
                      style: theme.textTheme.labelSmall?.copyWith(
                        color: scheme.onSurfaceVariant,
                        fontFeatures: const [FontFeature.tabularFigures()],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                // Only a picture: the whole card is the tap target, the day is picked on the month screen.
                ExcludeSemantics(
                  child: _MiniDays(month: month, days: days, scale: scale, today: today),
                ),
              ],
            ),
          ),
        ),
      ),
    );
    return Semantics(
      button: true,
      label: '${libraryCleanupMonthName(context, month, long: true)}, $count',
      excludeSemantics: true,
      child: GalleryPressable(
        pressedScale: 0.96,
        child: _Glow(trigger: glow, month: month, child: card),
      ),
    );
  }
}

/// The flight between a month card and its month screen: the card's surface growing or shrinking, without its
/// contents, which would be squeezed mid-flight.
Widget libraryCleanupMonthShuttle(
  BuildContext flightContext,
  Animation<double> animation,
  HeroFlightDirection direction,
  BuildContext fromContext,
  BuildContext toContext,
) {
  final scheme = Theme.of(toContext).colorScheme;
  return AnimatedBuilder(
    animation: animation,
    builder: (context, _) => Material(
      key: const Key('cleanup-month-flight'),
      color: Color.lerp(scheme.surfaceContainerLow, scheme.surface, animation.value.clamp(0.0, 1.0)),
      borderRadius: BorderRadius.circular(14 * (1 - animation.value.clamp(0.0, 1.0))),
    ),
  );
}

/// A month's days as a small grid, seven across from the 1st, never under weekdays.
class _MiniDays extends StatelessWidget {
  const _MiniDays({required this.month, required this.days, required this.scale, required this.today});

  final int month;
  final Map<int, CleanupCalendarDayDto> days;
  final LibraryCleanupShadeScale scale;
  final int today;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final count = libraryCleanupDaysIn(month);
    return LayoutBuilder(
      builder: (context, constraints) {
        const gap = 2.0;
        final size = ((constraints.maxWidth - gap * 6) / 7).floorToDouble().clamp(2.0, 40.0);
        return Wrap(
          spacing: gap,
          runSpacing: gap,
          children: [
            for (var day = 1; day <= count; day++)
              Container(
                key: Key('cleanup-year-day-${month * 100 + day}'),
                width: size,
                height: size,
                decoration: BoxDecoration(
                  color: libraryCleanupCellColor(scheme, days[month * 100 + day], scale),
                  borderRadius: BorderRadius.circular(2),
                  border: month * 100 + day == today ? Border.all(color: scheme.onSurface, width: 1.2) : null,
                ),
              ),
          ],
        );
      },
    );
  }
}

/// A soft green glow around a month card that fades in and out once each time [trigger] changes, after the screen
/// has settled. It is a fade of light, not movement, so it plays under reduced motion too.
class _Glow extends StatefulWidget {
  const _Glow({required this.trigger, required this.month, required this.child});

  final int trigger;
  final int month;
  final Widget child;

  @override
  State<_Glow> createState() => _GlowState();
}

class _GlowState extends State<_Glow> with SingleTickerProviderStateMixin {
  static const _duration = Duration(milliseconds: 1400);
  late final AnimationController _controller = AnimationController(vsync: this, duration: _duration);
  Timer? _wait;

  @override
  void initState() {
    super.initState();
    if (widget.trigger > 0) {
      _play();
    }
  }

  @override
  void didUpdateWidget(_Glow oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.trigger != widget.trigger) {
      _play();
    }
  }

  /// Waits for the month screen's flight back to land, then glows.
  void _play() {
    _wait?.cancel();
    _wait = Timer(GalleryMotion.slow, () {
      if (mounted) {
        unawaited(_controller.forward(from: 0));
      }
    });
  }

  @override
  void dispose() {
    _wait?.cancel();
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      child: widget.child,
      builder: (context, child) {
        final t = _controller.value;
        final glowing = _controller.isAnimating && t > 0;
        // Rises quickly, fades slowly.
        final strength = !glowing
            ? 0.0
            : t < 0.3
            ? Curves.easeOut.transform(t / 0.3)
            : 1 - Curves.easeIn.transform((t - 0.3) / 0.7);
        // The card stays the first child throughout, so glowing never rebuilds it.
        return Stack(
          clipBehavior: Clip.none,
          children: [
            child!,
            if (glowing)
              Positioned.fill(
                child: IgnorePointer(
                  child: DecoratedBox(
                    key: Key('cleanup-month-glow-${widget.month}'),
                    decoration: BoxDecoration(
                      borderRadius: _MonthCard.radius,
                      border: Border.all(color: libraryCleanupReviewedGreen.withValues(alpha: strength), width: 2),
                      boxShadow: [
                        BoxShadow(
                          color: libraryCleanupReviewedGreen.withValues(alpha: 0.55 * strength),
                          blurRadius: 18 * strength,
                          spreadRadius: 2 * strength,
                        ),
                      ],
                    ),
                  ),
                ),
              ),
          ],
        );
      },
    );
  }
}
