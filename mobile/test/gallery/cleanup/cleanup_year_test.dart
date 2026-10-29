import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_marks.dart';
import 'package:immich_mobile/gallery/cleanup/providers/library_cleanup.providers.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_calendar_bits.dart';
import 'package:immich_mobile/gallery/motion/pop.dart';

import 'cleanup_overview_harness.dart';
import 'cleanup_test_utils.dart';
import 'cleanup_year_harness.dart';

// Slice 8's behaviours (specs/2026-10-29-mobile-library-cleanup-design.md, "Your year" and "Slice 8"), on the real
// pages and providers and the real generated client over an in-memory server. Today is 15 August.
//
// Year
//   Given the year screen        Then only the twelve month cards are tap targets, and tapping a card's days opens the
//                                     month, not a day
//   Given a month's days         Then its card shows "reviewed/days" and the web's colours (green reviewed, primary
//                                     shades by quartile, neutral for none); today and the current month are outlined
//   Given any month              Then its days start at the 1st in the first cell, seven a row, never under weekdays;
//                                     February has 29
//   Given a month became complete since the last visit   When the year screen shows again   Then its card glows, once
// Month
//   When a card is tapped        Then its month screen shows large cells, at least 40 px even on a 320 px phone, and
//                                     "1 of 31 days reviewed · 3 to go"
//   When › or ‹ is tapped        Then the next or previous month slides in from that side; December wraps to January
//   When the days are swiped     Then the month changes the same way
// Day sheet
//   When a day is tapped         Then its sheet shows the date, counts, estimate and busiest year, four thumbnails and
//                                     "Rewind this day", which opens that day's rewind
//   When another day is tapped   Then the sheet stays put and its contents swap, sliding from the side of travel
//   Given a day without photos   Then the sheet says so, has no button, and nothing is requested
//   Given a reviewed day         Then "Reviewed", and the button still opens it
//   Given marks saved for a day  Then the button reads "Resume · 1 of 5"
//   Given a day finished in its rewind   When the user comes back   Then its cell is green and pops; the year card counts it
// Labels   each day cell is labelled in the web's words ("August 15: 5 photos", "August 2: 1 photo, reviewed")
// Reduced motion   months change without sliding, the sheet swaps with a plain fade, a finished day does not pop

/// The in-memory server's year. 15 August: p1, p2 (2022, Lisbon) and q1–q3 (2020, two in Porto); 1 August: five
/// photos in 2019; 2 August reviewed; 11 April the only day of April.
class _Year {
  final reviewed = <int>{802};

  late final server = FakeCleanupServer(_respond);

  static const counts = {229: 2, 411: 1, 801: 5, 802: 1, 815: 5, 1224: 9, 1231: 3};

  FakeResponse? _respond(SeenRequest request) => switch (request.route) {
    'GET /cleanup/calendar' => FakeResponse({
      'days': [
        for (var month = 1; month <= 12; month++)
          for (var day = 1; day <= libraryCleanupDaysIn(month); day++)
            dayJson(
              month * 100 + day,
              counts[month * 100 + day] ?? 0,
              reviewedAt: reviewed.contains(month * 100 + day) ? '2026-08-02T10:00:00.000Z' : null,
            ),
      ],
      'daysReviewed': reviewed.length,
      'streak': 1,
    }),
    'GET /cleanup/rewind/815' => const FakeResponse({
      'years': [
        {'year': 2022, 'count': 2},
        {'year': 2020, 'count': 3},
      ],
    }),
    'GET /cleanup/rewind/815/2022' => FakeResponse({
      'assets': [
        for (final id in ['p1', 'p2']) assetJson(id, city: 'Lisbon'),
      ],
    }),
    'GET /cleanup/rewind/815/2020' => FakeResponse({
      'assets': [assetJson('q1', city: 'Porto'), assetJson('q2', city: 'Porto'), assetJson('q3')],
    }),
    'GET /cleanup/rewind/801' => const FakeResponse({
      'years': [
        {'year': 2019, 'count': 5},
      ],
    }),
    'GET /cleanup/rewind/801/2019' => FakeResponse({
      'assets': [for (var i = 1; i <= 5; i++) assetJson('s$i', city: 'Faro')],
    }),
    'GET /cleanup/rewind/802' => const FakeResponse({
      'years': [
        {'year': 2018, 'count': 1},
      ],
    }),
    'GET /cleanup/rewind/802/2018' => FakeResponse({
      'assets': [assetJson('r1')],
    }),
    _ => null,
  };

  List<String> get routes => server.routes;
}

/// A test that takes the screens down at the end, so the images' and sheets' last timers run out.
void yearTest(String description, Future<void> Function(WidgetTester tester) body) =>
    testWidgets(description, (tester) async {
      await body(tester);
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump(const Duration(seconds: 2));
    });

void main() {
  setUpAll(initOverviewStore);

  late _Year year;
  late RewindSpy rewinds;
  setUp(() {
    year = _Year();
    rewinds = RewindSpy();
  });

  Future<void> settle(WidgetTester tester) => settleCleanup(tester, requests: () => year.routes.length);

  Future<ProviderContainer> open(WidgetTester tester, {bool reduceMotion = false, double width = 392.7}) async {
    final container = overviewContainer(server: year.server, directory: tempDirectory());
    final scoped = ProviderContainer(parent: container, overrides: [rewinds.override]);
    addTearDown(scoped.dispose);
    await pumpYear(tester, scoped, reduceMotion: reduceMotion, width: width, settle: false);
    await settle(tester);
    return scoped;
  }

  /// The furthest a cell's pop takes it from its size over the next 40 frames.
  Future<double> popDeviation(WidgetTester tester, Finder target) async {
    var deviation = 0.0;
    for (var frame = 0; frame < 40; frame++) {
      await tester.pump(const Duration(milliseconds: 16));
      final pop = find.ancestor(of: target, matching: find.byType(GalleryPop));
      final scale = tester.widget<Transform>(find.descendant(of: pop, matching: find.byType(Transform)).first);
      deviation = math.max(deviation, (scale.transform.getMaxScaleOnAxis() - 1).abs());
    }
    return deviation;
  }

  Finder month(int month) => find.byKey(Key('cleanup-month-card-$month'));
  Finder cell(int monthDay) => find.byKey(Key('cleanup-day-$monthDay'));
  Finder miniCell(int monthDay) => find.byKey(Key('cleanup-year-day-$monthDay'));
  Color colorOf(WidgetTester tester, Finder finder) =>
      (tester.widget<Container>(finder).decoration! as BoxDecoration).color!;
  ColorScheme schemeOf(WidgetTester tester) =>
      Theme.of(tester.element(find.byKey(const Key('cleanup-year-list')))).colorScheme;

  group('Year', () {
    yearTest('only the twelve month cards are tap targets; tapping a card\'s days opens the month', (tester) async {
      await open(tester);

      final targets = find.descendant(
        of: find.byKey(const Key('cleanup-year-months')),
        matching: find.byWidgetPredicate((widget) => widget is InkWell && widget.onTap != null),
      );
      expect(targets, findsNWidgets(12));
      // Every tap handler on the screen belongs to a month card's ink.
      final taps = find.descendant(
        of: find.byKey(const Key('cleanup-year-months')),
        matching: find.byWidgetPredicate((widget) => widget is GestureDetector && widget.onTap != null),
      );
      for (final element in taps.evaluate()) {
        expect(find.ancestor(of: find.byWidget(element.widget), matching: targets), findsOneWidget);
      }

      // A finger on 15 August's little cell opens August, not that day.
      await tester.tap(miniCell(815));
      await settle(tester);
      expect(find.byKey(const Key('cleanup-month-grid-8')), findsOneWidget);
      expect(find.byKey(const Key('cleanup-day-sheet')), findsNothing);
      expect(year.routes, ['GET /cleanup/calendar']);
    });

    yearTest('each card shows "reviewed/days" in the web\'s colours; today and this month are outlined', (
      tester,
    ) async {
      await open(tester);
      final scheme = schemeOf(tester);

      expect(textOf(tester, 'cleanup-month-count-8'), '1/31');
      expect(textOf(tester, 'cleanup-month-count-2'), '0/29');
      expect(textOf(tester, 'cleanup-month-count-4'), '0/30');
      expect(textOf(tester, 'cleanup-year-progress'), '1 of 366 days reviewed');

      // Counts 1, 1, 2, 3, 5, 5, 9: quartiles 1, 3, 5; 9 is the busiest.
      expect(colorOf(tester, miniCell(803)), scheme.surfaceContainerHighest);
      expect(colorOf(tester, miniCell(1224)), scheme.primary);
      expect(colorOf(tester, miniCell(815)), scheme.primary.withValues(alpha: 0.75));
      expect(colorOf(tester, miniCell(229)), scheme.primary.withValues(alpha: 0.55));
      expect(colorOf(tester, miniCell(411)), scheme.primary.withValues(alpha: 0.35));
      // Reviewed with few photos: the lighter green.
      expect(colorOf(tester, miniCell(802)), libraryCleanupReviewedGreen.withValues(alpha: 0.55));

      final todayBorder = (tester.widget<Container>(miniCell(815)).decoration! as BoxDecoration).border;
      expect(todayBorder, isNotNull);
      expect((tester.widget<Container>(miniCell(814)).decoration! as BoxDecoration).border, isNull);

      ShapeBorder shapeOf(int m) =>
          tester.widget<Material>(find.ancestor(of: month(m), matching: find.byType(Material)).first).shape!;
      expect((shapeOf(8) as RoundedRectangleBorder).side.color, scheme.primary);
      expect((shapeOf(7) as RoundedRectangleBorder).side, BorderSide.none);
    });

    yearTest('days start at the 1st in the first cell, seven a row, never under weekdays; February has 29', (
      tester,
    ) async {
      await open(tester);

      for (var m = 1; m <= 12; m++) {
        final first = tester.getTopLeft(miniCell(m * 100 + 1));
        final grid = tester.getTopLeft(find.ancestor(of: miniCell(m * 100 + 1), matching: find.byType(Wrap)).first);
        expect(first, grid, reason: 'month $m starts at its first cell');
        // The 8th sits right under the 1st, the 7th ends the first row.
        expect(tester.getTopLeft(miniCell(m * 100 + 8)).dx, first.dx, reason: 'month $m');
        expect(tester.getTopLeft(miniCell(m * 100 + 7)).dy, first.dy, reason: 'month $m');
        expect(tester.getTopLeft(miniCell(m * 100 + 8)).dy, greaterThan(first.dy), reason: 'month $m');
      }
      expect(miniCell(229), findsOneWidget);
      expect(miniCell(230), findsNothing);
      expect(miniCell(431), findsNothing);
      expect(miniCell(1231), findsOneWidget);
    });

    yearTest('a month that became complete since the last visit glows once on the way back', (tester) async {
      final container = await open(tester);
      await openMonth(tester, 4, settle: () => settle(tester));
      expect(find.byKey(const Key('cleanup-month-glow-4')), findsNothing);

      // 11 April, April's only day, is finished in its rewind.
      year.reviewed.add(411);
      unawaited(container.read(libraryCleanupSupportProvider.notifier).refreshCalendar());
      await settle(tester);
      await tester.tap(find.byKey(const Key('cleanup-month-back')));
      await pumpFrames(tester, const Duration(milliseconds: 900));
      expect(find.byKey(const Key('cleanup-month-glow-4')), findsOneWidget);
      expect(find.byKey(const Key('cleanup-month-glow-8')), findsNothing);
      expect(textOf(tester, 'cleanup-month-count-4'), '1/30');
      await pumpFrames(tester, const Duration(milliseconds: 1500));
      expect(find.byKey(const Key('cleanup-month-glow-4')), findsNothing);

      // Once: the next arrival does not glow again.
      await openMonth(tester, 8, settle: () => settle(tester));
      await tester.tap(find.byKey(const Key('cleanup-month-back')));
      await pumpFrames(tester, const Duration(milliseconds: 900));
      expect(find.byKey(const Key('cleanup-month-glow-4')), findsNothing);
    });

    yearTest('a month already complete on the first visit does not glow', (tester) async {
      year.reviewed.add(411);
      await open(tester);
      await pumpFrames(tester, const Duration(milliseconds: 900));
      expect(find.byKey(const Key('cleanup-month-glow-4')), findsNothing);
    });
  });

  group('Month', () {
    yearTest('a card opens its month: large cells from the 1st and the month\'s progress', (tester) async {
      await open(tester);
      await openMonth(tester, 8, settle: () => settle(tester));

      expect(textOf(tester, 'cleanup-month-title'), 'August');
      expect(textOf(tester, 'cleanup-month-progress'), '1 of 31 days reviewed · 2 to go');
      final first = tester.getRect(cell(801));
      expect(tester.getRect(cell(808)).left, first.left);
      expect(tester.getRect(cell(807)).top, first.top);
      expect(cell(831), findsOneWidget);
      for (var day = 1; day <= 31; day++) {
        final size = tester.getSize(cell(800 + day));
        expect(size.width, greaterThanOrEqualTo(40), reason: 'day $day');
        expect(size.height, greaterThanOrEqualTo(40), reason: 'day $day');
      }
      expect(find.descendant(of: cell(815), matching: find.text('15')), findsOneWidget);
    });

    yearTest('on a 320 px phone the cells are still at least 40 px and February has 29', (tester) async {
      await open(tester, width: 320);
      await openMonth(tester, 2, settle: () => settle(tester));

      expect(cell(229), findsOneWidget);
      expect(cell(230), findsNothing);
      for (var day = 1; day <= 29; day++) {
        final rect = tester.getRect(cell(200 + day));
        expect(rect.width, greaterThanOrEqualTo(40), reason: 'day $day');
        expect(rect.height, greaterThanOrEqualTo(40), reason: 'day $day');
        expect(rect.right, lessThanOrEqualTo(320), reason: 'day $day');
      }
      expect(tester.takeException(), isNull);
    });

    yearTest('› and ‹ change month, sliding in from that side, and wrap at the year\'s ends', (tester) async {
      await open(tester);
      await openMonth(tester, 12, settle: () => settle(tester));

      await tester.tap(find.byKey(const Key('cleanup-month-next')));
      await pumpFrames(tester, const Duration(milliseconds: 60));
      // January comes in from the right while December leaves to the left.
      expect(tester.getTopLeft(find.byKey(const Key('cleanup-month-grid-1'))).dx, greaterThan(40));
      expect(tester.getTopLeft(find.byKey(const Key('cleanup-month-grid-12'))).dx, lessThan(0));
      await settle(tester);
      expect(textOf(tester, 'cleanup-month-title'), 'January');
      expect(textOf(tester, 'cleanup-month-progress'), '0 of 31 days reviewed · 0 to go');

      await tester.tap(find.byKey(const Key('cleanup-month-previous')));
      await pumpFrames(tester, const Duration(milliseconds: 60));
      expect(tester.getTopLeft(find.byKey(const Key('cleanup-month-grid-12'))).dx, lessThan(-40));
      await settle(tester);
      expect(textOf(tester, 'cleanup-month-title'), 'December');

      await tester.tap(find.byKey(const Key('cleanup-month-previous')));
      await settle(tester);
      expect(textOf(tester, 'cleanup-month-title'), 'November');
    });

    yearTest('swiping the days changes month the same way', (tester) async {
      await open(tester);
      await openMonth(tester, 1, settle: () => settle(tester));

      await tester.fling(find.byKey(const Key('cleanup-month-grid-1')), const Offset(300, 0), 1200);
      await settle(tester);
      expect(textOf(tester, 'cleanup-month-title'), 'December');

      await tester.fling(find.byKey(const Key('cleanup-month-grid-12')), const Offset(-300, 0), 1200);
      await settle(tester);
      expect(textOf(tester, 'cleanup-month-title'), 'January');
    });

    yearTest('the month card grows into the month screen and shrinks back into it', (tester) async {
      await open(tester);
      final card = tester.getRect(month(8));

      await tester.tap(month(8));
      await pumpFrames(tester, const Duration(milliseconds: 100));
      final growing = tester.getRect(find.byKey(const Key('cleanup-month-flight')));
      expect(growing.width, greaterThan(card.width));
      expect(growing.height, greaterThan(card.height));
      await settle(tester);
      expect(find.byKey(const Key('cleanup-month-flight')), findsNothing);
      final screen = tester.getRect(find.byKey(const Key('cleanup-month-pages')));

      await tester.tap(find.byKey(const Key('cleanup-month-back')));
      await pumpFrames(tester, const Duration(milliseconds: 100));
      final shrinking = tester.getRect(find.byKey(const Key('cleanup-month-flight')));
      expect(shrinking.width, lessThan(screen.width));
      expect(shrinking.height, greaterThan(card.height));
      await settle(tester);
      expect(find.byKey(const Key('cleanup-month-grid-8')), findsNothing);
      expect(tester.getRect(month(8)), rectMoreOrLessEquals(card, epsilon: 0.01));
    });
  });

  group('Day sheet', () {
    yearTest('a day opens its sheet, and "Rewind this day" opens that day\'s rewind', (tester) async {
      await open(tester);
      await openMonth(tester, 8, settle: () => settle(tester));
      expect(find.byKey(const Key('cleanup-day-sheet')), findsNothing);

      await tapDay(tester, 815, settle: () => settle(tester));
      expect(textOf(tester, 'cleanup-day-sheet-date'), 'AUGUST 15');
      expect(textOf(tester, 'cleanup-day-sheet-counts'), '5 photos from 2 years');
      expect(textOf(tester, 'cleanup-day-sheet-detail'), '2020 in Porto has the most.');
      expect(find.byKey(const Key('cleanup-day-sheet-thumb-2')), findsOneWidget);
      expect(find.byKey(const Key('cleanup-day-sheet-thumb-3')), findsNothing);
      expect(find.text('Rewind this day'), findsOneWidget);

      await tester.tap(find.byKey(const Key('cleanup-day-sheet-rewind')));
      await settle(tester);
      expect(rewinds.opened, [815]);
      expect(find.byKey(const Key('cleanup-placeholder')), findsOneWidget);
    });

    yearTest('another day swaps the contents in place, sliding from the side of travel', (tester) async {
      await open(tester);
      await openMonth(tester, 8, settle: () => settle(tester));
      await tapDay(tester, 801, settle: () => settle(tester));
      final sheet = tester.getRect(find.byKey(const Key('cleanup-day-sheet')));
      // Four of the day's five photos, and the estimate.
      expect(find.byKey(const Key('cleanup-day-sheet-thumb-3')), findsOneWidget);
      // Five photos take under a minute, so there is no estimate.
      expect(textOf(tester, 'cleanup-day-sheet-detail'), '2019 in Faro has the most.');

      await tester.tap(cell(815));
      await pumpFrames(tester, const Duration(milliseconds: 48));
      // Mid-swap: one sheet, both days' contents, the later day coming in from the right.
      expect(find.byKey(const Key('cleanup-day-sheet')), findsOneWidget);
      expect(find.byKey(const Key('cleanup-day-sheet-date')), findsNWidgets(2));
      final incoming = tester.getTopLeft(find.text('AUGUST 15'));
      final outgoing = tester.getTopLeft(find.text('AUGUST 1'));
      expect(incoming.dx, greaterThan(outgoing.dx));
      await settle(tester);

      expect(tester.getRect(find.byKey(const Key('cleanup-day-sheet'))), sheet);
      expect(textOf(tester, 'cleanup-day-sheet-counts'), '5 photos from 2 years');

      // Back to an earlier day: it comes in from the left.
      await tester.tap(cell(802));
      await pumpFrames(tester, const Duration(milliseconds: 48));
      expect(tester.getTopLeft(find.text('AUGUST 2')).dx, lessThan(tester.getTopLeft(find.text('AUGUST 15')).dx));
      await settle(tester);
    });

    yearTest('a day without photos says so, has no button, and asks for nothing', (tester) async {
      await open(tester);
      await openMonth(tester, 8, settle: () => settle(tester));
      await tapDay(tester, 803, settle: () => settle(tester));

      expect(textOf(tester, 'cleanup-day-sheet-empty'), 'No photos were taken on this date.');
      expect(find.byKey(const Key('cleanup-day-sheet-rewind')), findsNothing);
      expect(year.routes, ['GET /cleanup/calendar']);
    });

    yearTest('a reviewed day says "Reviewed", and the button still opens it', (tester) async {
      await open(tester);
      await openMonth(tester, 8, settle: () => settle(tester));
      await tapDay(tester, 802, settle: () => settle(tester));

      expect(textOf(tester, 'cleanup-day-sheet-detail'), startsWith('Reviewed.'));
      await tester.tap(find.byKey(const Key('cleanup-day-sheet-rewind')));
      await settle(tester);
      expect(rewinds.opened, [802]);
    });

    yearTest('with marks saved for a day, the button reads "Resume · 1 of 5"', (tester) async {
      final directory = tempDirectory();
      await saveDayMarks(tester, directory, 815, {'q2': LibraryCleanupMark.trash});
      final container = overviewContainer(server: year.server, directory: directory);
      final scoped = ProviderContainer(parent: container, overrides: [rewinds.override]);
      addTearDown(scoped.dispose);
      await pumpYear(tester, scoped, settle: false);
      await settle(tester);
      await openMonth(tester, 8, settle: () => settle(tester));
      await tapDay(tester, 815, settle: () => settle(tester));

      expect(find.text('Resume · 1 of 5'), findsOneWidget);
    });

    yearTest('a day finished in its rewind is green and pops on the way back; the year counts it', (tester) async {
      final container = await open(tester);
      await openMonth(tester, 8, settle: () => settle(tester));
      await tapDay(tester, 815, settle: () => settle(tester));
      await tester.tap(find.byKey(const Key('cleanup-day-sheet-rewind')));
      await settle(tester);

      // The rewind finishes the day, which refreshes the calendar.
      year.reviewed.add(815);
      unawaited(container.read(libraryCleanupSupportProvider.notifier).refreshCalendar());
      await settle(tester);
      await tester.pageBack();
      expect(await popDeviation(tester, cell(815)), greaterThan(0.05));
      await settle(tester);

      final scheme = Theme.of(tester.element(cell(815))).colorScheme;
      expect(tester.widget<Material>(cell(815)).color, libraryCleanupReviewedGreen);
      expect(tester.widget<Material>(cell(814)).color, scheme.surfaceContainerHighest);
      expect(textOf(tester, 'cleanup-month-progress'), '2 of 31 days reviewed · 1 to go');
      expect(textOf(tester, 'cleanup-day-sheet-detail'), startsWith('Reviewed.'));

      await tester.tap(find.byKey(const Key('cleanup-month-back')));
      await settle(tester);
      expect(textOf(tester, 'cleanup-month-count-8'), '2/31');
    });
  });

  yearTest('each day cell is labelled in the web\'s words', (tester) async {
    final semantics = tester.ensureSemantics();
    await open(tester);
    await openMonth(tester, 8, settle: () => settle(tester));

    expect(find.bySemanticsLabel('August 15: 5 photos'), findsOneWidget);
    expect(find.bySemanticsLabel('August 2: 1 photo, reviewed'), findsOneWidget);
    expect(find.bySemanticsLabel('August 3: 0 photos'), findsOneWidget);
    semantics.dispose();
  });

  yearTest('the year\'s cards are labelled with the month and its count, without their days', (tester) async {
    final semantics = tester.ensureSemantics();
    await open(tester);

    expect(find.bySemanticsLabel('August, 1/31'), findsOneWidget);
    expect(find.bySemanticsLabel(RegExp('August 15')), findsNothing);
    semantics.dispose();
  });

  group('Reduced motion', () {
    yearTest('months change without sliding', (tester) async {
      await open(tester, reduceMotion: true);
      await openMonth(tester, 8, settle: () => settle(tester));

      await tester.tap(find.byKey(const Key('cleanup-month-next')));
      await tester.pump();
      expect(find.byKey(const Key('cleanup-month-grid-8')), findsNothing);
      expect(tester.getTopLeft(find.byKey(const Key('cleanup-month-grid-9'))).dx, 0);
    });

    yearTest('the sheet swaps with a plain fade', (tester) async {
      await open(tester, reduceMotion: true);
      await openMonth(tester, 8, settle: () => settle(tester));
      await tapDay(tester, 801, settle: () => settle(tester));
      final at = tester.getTopLeft(find.text('AUGUST 1'));

      await tester.tap(cell(815));
      await pumpFrames(tester, const Duration(milliseconds: 48));
      expect(find.byKey(const Key('cleanup-day-sheet-date')), findsNWidgets(2));
      expect(tester.getTopLeft(find.text('AUGUST 15')).dx, at.dx);
      await settle(tester);
    });

    yearTest('a finished day turns green without a pop', (tester) async {
      final container = await open(tester, reduceMotion: true);
      await openMonth(tester, 8, settle: () => settle(tester));
      await tapDay(tester, 815, settle: () => settle(tester));
      await tester.tap(find.byKey(const Key('cleanup-day-sheet-rewind')));
      await settle(tester);

      year.reviewed.add(815);
      unawaited(container.read(libraryCleanupSupportProvider.notifier).refreshCalendar());
      await settle(tester);
      await tester.pageBack();
      expect(await popDeviation(tester, cell(815)), lessThan(0.001));
      await settle(tester);
      expect(tester.widget<Material>(cell(815)).color, libraryCleanupReviewedGreen);
    });
  });
}
