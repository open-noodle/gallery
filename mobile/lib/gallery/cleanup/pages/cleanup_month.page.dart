import 'dart:async';
import 'dart:math' as math;

import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_overview.dart';
import 'package:immich_mobile/gallery/cleanup/navigation.dart';
import 'package:immich_mobile/gallery/cleanup/pages/cleanup_year.page.dart';
import 'package:immich_mobile/gallery/cleanup/providers/library_cleanup.providers.dart';
import 'package:immich_mobile/gallery/cleanup/providers/library_cleanup_overview.providers.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_calendar_bits.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_day_sheet.dart';
import 'package:immich_mobile/gallery/motion/motion_tokens.dart';
import 'package:immich_mobile/gallery/motion/pop.dart';
import 'package:immich_mobile/gallery/motion/swap.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:openapi/api.dart';

/// One month of Your year, large (specs/2026-10-29-mobile-library-cleanup-design.md, "Your year"; mockup
/// `4-calendar.html`, screen 2). The month card grows into this screen and shrinks back into the card of the month
/// shown when leaving. ‹ › and a horizontal swipe change month, wrapping December to January, sliding in the direction
/// of travel. Tapping a day opens its sheet; tapping another swaps it in place.
///
/// A day finished in the meantime (its rewind refreshed the calendar) turns green with a pop when the user comes back.
@RoutePage()
class LibraryCleanupMonthPage extends ConsumerStatefulWidget {
  const LibraryCleanupMonthPage({super.key, required this.month});

  /// 1–12.
  final int month;

  @override
  ConsumerState<LibraryCleanupMonthPage> createState() => _LibraryCleanupMonthPageState();
}

class _LibraryCleanupMonthPageState extends ConsumerState<LibraryCleanupMonthPage> {
  /// The pages run on without end in both directions; page [_origin] is January.
  static const _origin = 1200;

  late final int _today = libraryCleanupToday(ref);
  late final _pages = PageController(initialPage: _origin + widget.month - 1);
  late int _month = widget.month;

  /// The day whose sheet is open, and the last one shown (kept while the sheet slides away).
  int? _selected;
  int? _sheetDay;
  int _travel = 1;

  /// The reviewed days as last shown while this screen was in front; bumped pop triggers for days reviewed since.
  Set<int>? _shownReviewed;
  final _pops = <int, int>{};
  bool _checkPending = false;

  @override
  void dispose() {
    _pages.dispose();
    super.dispose();
  }

  void _shift(int delta) {
    final target = (_pages.page ?? _pages.initialPage.toDouble()).round() + delta;
    if (GalleryMotion.reduced(context)) {
      _pages.jumpToPage(target);
    } else {
      unawaited(_pages.animateToPage(target, duration: GalleryMotion.base, curve: GalleryMotion.settle));
    }
  }

  void _onPage(int page) {
    final month = (page - _origin) % 12 + 1;
    if (month != _month) {
      setState(() {
        _month = month;
        _selected = null;
      });
    }
  }

  void _tapDay(int monthDay) {
    setState(() {
      if (_selected == monthDay) {
        _selected = null;
        return;
      }
      final previous = _selected ?? _sheetDay;
      _travel = previous == null || monthDay >= previous ? 1 : -1;
      _selected = monthDay;
      _sheetDay = monthDay;
    });
  }

  /// Pops the days reviewed since this screen was last in front, once it is in front again.
  void _checkReviewed(Map<int, CleanupCalendarDayDto> days) {
    if (_checkPending) {
      return;
    }
    _checkPending = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _checkPending = false;
      if (!mounted || !(ModalRoute.of(context)?.isCurrent ?? true)) {
        return;
      }
      final reviewed = {
        for (final day in days.values)
          if (libraryCleanupIsReviewed(day)) day.monthDay,
      };
      final shown = _shownReviewed;
      _shownReviewed = reviewed;
      final fresh = shown == null ? const <int>{} : reviewed.difference(shown);
      if (fresh.isNotEmpty) {
        setState(() {
          for (final monthDay in fresh) {
            _pops[monthDay] = (_pops[monthDay] ?? 0) + 1;
          }
        });
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final calendar = ref.watch(libraryCleanupCalendarProvider);
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final days = calendar == null ? const <int, CleanupCalendarDayDto>{} : libraryCleanupDaysByMonthDay(calendar.days);
    final scale = LibraryCleanupShadeScale(days.values.map((day) => day.assetCount));
    if (calendar != null && (ModalRoute.of(context)?.isCurrent ?? true)) {
      _checkReviewed(days);
    }
    final progress = LibraryCleanupMonthProgress.of(_month, days);
    final sheetDay = _sheetDay;
    final bottom = MediaQuery.paddingOf(context).bottom;

    return Scaffold(
      appBar: AppBar(
        scrolledUnderElevation: 0,
        leadingWidth: 96,
        leading: TextButton.icon(
          key: const Key('cleanup-month-back'),
          onPressed: () => Navigator.of(context).maybePop(),
          icon: const Icon(Icons.chevron_left_rounded),
          label: Text(context.t.year, maxLines: 1, overflow: TextOverflow.ellipsis),
        ),
        centerTitle: true,
        title: GallerySwap(
          value: _month,
          rise: 0,
          alignment: Alignment.center,
          child: Text(libraryCleanupMonthName(context, _month, long: true), key: const Key('cleanup-month-title')),
        ),
        actions: [
          IconButton(
            key: const Key('cleanup-month-previous'),
            tooltip: context.t.previous,
            onPressed: () => _shift(-1),
            icon: const Icon(Icons.chevron_left_rounded),
          ),
          IconButton(
            key: const Key('cleanup-month-next'),
            tooltip: context.t.next,
            onPressed: () => _shift(1),
            icon: const Icon(Icons.chevron_right_rounded),
          ),
          const SizedBox(width: 4),
        ],
      ),
      body: Hero(
        tag: LibraryCleanupYearHeroTags.month(_month),
        flightShuttleBuilder: libraryCleanupMonthShuttle,
        child: Material(
          color: scheme.surface,
          child: Stack(
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
                    child: GallerySwap(
                      value: '${progress.reviewed}/${progress.toGo}/$_month',
                      rise: 0,
                      child: Text(
                        context.t.cleanup_month_progress(
                          reviewed: progress.reviewed,
                          total: progress.days,
                          left: progress.toGo,
                        ),
                        key: const Key('cleanup-month-progress'),
                        style: theme.textTheme.bodyMedium?.copyWith(color: scheme.onSurfaceVariant),
                      ),
                    ),
                  ),
                  Expanded(
                    child: PageView.builder(
                      key: const Key('cleanup-month-pages'),
                      controller: _pages,
                      onPageChanged: _onPage,
                      itemBuilder: (context, page) {
                        final month = (page - _origin) % 12 + 1;
                        return SingleChildScrollView(
                          padding: EdgeInsets.only(
                            bottom: 16 + (_selected == null ? bottom : LibraryCleanupDaySheet.height + bottom),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              _MonthGrid(
                                key: Key('cleanup-month-grid-$month'),
                                month: month,
                                days: days,
                                scale: scale,
                                today: _today,
                                selected: _selected,
                                pops: _pops,
                                onTap: _tapDay,
                              ),
                              const Padding(
                                padding: EdgeInsets.fromLTRB(16, 16, 16, 0),
                                child: LibraryCleanupCalendarLegend(),
                              ),
                            ],
                          ),
                        );
                      },
                    ),
                  ),
                ],
              ),
              if (sheetDay != null)
                Positioned(
                  left: 0,
                  right: 0,
                  bottom: 0,
                  // Sheets slide under reduced motion too (platform behaviour).
                  child: AnimatedSlide(
                    offset: _selected == null ? const Offset(0, 1.1) : Offset.zero,
                    duration: GalleryMotion.base,
                    curve: _selected == null ? GalleryMotion.exit : GalleryMotion.settle,
                    onEnd: () {
                      if (_selected == null && mounted) {
                        setState(() => _sheetDay = null);
                      }
                    },
                    child: LibraryCleanupDaySheet(
                      monthDay: sheetDay,
                      day: days[sheetDay],
                      direction: _travel,
                      onRewind: () => openLibraryCleanupRewind(context, sheetDay),
                      onClose: () => setState(() => _selected = null),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// A month's days as large numbered cells, seven across from the 1st, never under weekdays. Each cell is at least
/// 40 px wide and tall.
class _MonthGrid extends StatelessWidget {
  const _MonthGrid({
    super.key,
    required this.month,
    required this.days,
    required this.scale,
    required this.today,
    required this.selected,
    required this.pops,
    required this.onTap,
  });

  /// The smallest a cell gets, either way.
  static const minCell = 40.0;
  static const _maxCell = 56.0;
  static const _gap = 6.0;

  final int month;
  final Map<int, CleanupCalendarDayDto> days;
  final LibraryCleanupShadeScale scale;
  final int today;
  final int? selected;
  final Map<int, int> pops;
  final ValueChanged<int> onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final count = libraryCleanupDaysIn(month);
    return LayoutBuilder(
      builder: (context, constraints) {
        // The side margins give way before the cells shrink below their minimum.
        final margin = ((constraints.maxWidth - 7 * minCell - 6 * _gap) / 2).clamp(0.0, 16.0);
        // Rounded down to a tenth of a pixel, so seven always fit on a row.
        final width = math.max(minCell, ((constraints.maxWidth - 2 * margin - 6 * _gap) / 7 * 10).floorToDouble() / 10);
        final height = width.clamp(minCell, _maxCell);
        Widget cell(int number) => _DayCell(
          monthDay: month * 100 + number,
          day: days[month * 100 + number],
          width: width,
          height: height,
          scheme: scheme,
          scale: scale,
          today: month * 100 + number == today,
          selected: month * 100 + number == selected,
          pop: pops[month * 100 + number] ?? 0,
          onTap: onTap,
        );
        return Padding(
          padding: EdgeInsets.symmetric(horizontal: margin),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              for (var first = 1; first <= count; first += 7) ...[
                if (first > 1) const SizedBox(height: _gap),
                Row(
                  children: [
                    for (var number = first; number < first + 7 && number <= count; number++) ...[
                      if (number > first) const SizedBox(width: _gap),
                      cell(number),
                    ],
                  ],
                ),
              ],
            ],
          ),
        );
      },
    );
  }
}

class _DayCell extends StatelessWidget {
  const _DayCell({
    required this.monthDay,
    required this.day,
    required this.width,
    required this.height,
    required this.scheme,
    required this.scale,
    required this.today,
    required this.selected,
    required this.pop,
    required this.onTap,
  });

  final int monthDay;
  final CleanupCalendarDayDto? day;
  final double width;
  final double height;
  final ColorScheme scheme;
  final LibraryCleanupShadeScale scale;
  final bool today;
  final bool selected;
  final int pop;
  final ValueChanged<int> onTap;

  @override
  Widget build(BuildContext context) {
    final border = selected
        ? BorderSide(color: scheme.primary, width: 3)
        : today
        ? BorderSide(color: scheme.onSurface, width: 2)
        : BorderSide.none;
    return Semantics(
      button: true,
      selected: selected,
      label: libraryCleanupDayLabel(context, monthDay, day),
      excludeSemantics: true,
      child: GalleryPop(
        trigger: pop,
        child: Material(
          key: Key('cleanup-day-$monthDay'),
          color: libraryCleanupCellColor(scheme, day, scale),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10), side: border),
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: () => onTap(monthDay),
            child: SizedBox(
              width: width,
              height: height,
              child: Center(
                child: Text(
                  '${monthDay % 100}',
                  style: TextStyle(
                    color: libraryCleanupCellNumberColor(scheme, day, scale),
                    fontWeight: FontWeight.w600,
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
