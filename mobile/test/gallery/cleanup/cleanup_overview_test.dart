import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_marks.dart';
import 'package:immich_mobile/gallery/cleanup/providers/library_cleanup.providers.dart';
import 'package:immich_mobile/gallery/motion/pressable.dart';
import 'package:immich_mobile/routing/router.dart';

import 'cleanup_overview_harness.dart';
import 'cleanup_test_utils.dart';

// Slice 2's behaviours (specs/2026-10-29-mobile-library-cleanup-design.md, "Slice 2"), against the real generated
// client over an in-memory server:
//
// Library entry
//   Given an unsupported server     When Library shows        Then no Cleanup button, and nothing but the probe is sent
//   Given a supported server        When Library shows        Then the button is there at once; its subtitle fills in
//                                                                  when today's counts arrive
// Today card
//   Given today's years have loaded  When the rest is still loading   Then the card shows its counts and button, and the
//                                                                     collage, city, counts and trash land without moving it
//   Given saved marks for today      When the overview opens          Then the button reads "Resume · 3 of 5"
//   Given a date without photos      When the overview opens          Then the empty copy, a disabled button, no rewind call
//   Given a reviewed date            When the overview opens          Then "Reviewed", and the button still opens the rewind
//   Given today's years fail         When the overview opens          Then an inline error; Retry loads the card
// Quick wins
//   When the counts arrive   Then Space hogs, Bursts, Screenshots, Duplicates, Blurry, in that order, in the web's words
//   Given the duplicates count is refused (403)   Then there is no Duplicates card
//   Given the trash is on    Then the trash line shows its size;  Given it is off   Then no line and no trash call
//   "Could still free" shows only once every count has arrived, and is their sum
// Pull to refresh   reloads every section
// Navigation        Start opens the rewind; Bursts opens its series queue; "See all" opens Your year
// Motion            the sections arrive on a stagger; a pressed card squishes; reduced motion shows everything at once

const _mib = 1024 * 1024;

/// The in-memory server's library: 15 August has p1, p2 (2022, Lisbon) and q1–q3 (2020, two in Porto).
class _Library {
  bool supported = true;
  bool reviewed = false;
  int todayPhotos = 5;
  bool duplicatesForbidden = false;
  bool yearsFail = false;
  Set<String> kept = {};

  /// Requests the test holds back, by route; [release] lets them through.
  final held = <String>{};
  final _gates = <Completer<void>>[];

  void release() {
    held.clear();
    for (final gate in _gates) {
      if (!gate.isCompleted) {
        gate.complete();
      }
    }
  }

  late final server = FakeCleanupServer(_respond, gate: _gate);

  Future<void>? _gate(SeenRequest request) {
    if (!held.any((route) => request.route.startsWith(route))) {
      return null;
    }
    final gate = Completer<void>();
    _gates.add(gate);
    return gate.future;
  }

  FakeResponse? _respond(SeenRequest request) {
    final query = request.query;
    return switch (request.route) {
      'GET /cleanup/calendar' when !supported => const FakeResponse({'message': 'Not Found'}, 404),
      'GET /cleanup/calendar' => FakeResponse({
        'days': [
          dayJson(101, 0),
          dayJson(801, 4),
          dayJson(802, 1, reviewedAt: '2026-08-02T10:00:00.000Z'),
          dayJson(815, todayPhotos, reviewedAt: reviewed ? '2026-08-15T09:00:00.000Z' : null),
          dayJson(1224, 9),
        ],
        'daysReviewed': 61,
        'streak': 5,
      }),
      'GET /cleanup/rewind/815' when yearsFail => const FakeResponse({'message': 'boom'}, 500),
      'GET /cleanup/rewind/815' => const FakeResponse({
        'years': [
          {'year': 2022, 'count': 2},
          {'year': 2020, 'count': 3},
        ],
      }),
      'GET /cleanup/rewind/815/2022' => FakeResponse({
        'assets': [
          for (final id in ['p1', 'p2']) assetJson(id, city: 'Lisbon', kept: kept.contains(id)),
        ],
      }),
      'GET /cleanup/rewind/815/2020' => FakeResponse({
        'assets': [
          assetJson('q1', city: 'Porto', kept: kept.contains('q1')),
          assetJson('q2', city: 'Porto', kept: kept.contains('q2')),
          assetJson('q3', kept: kept.contains('q3')),
        ],
      }),
      'GET /cleanup/queues/space_hogs/count' => const FakeResponse({'count': 3, 'bytes': 600 * _mib}),
      'GET /cleanup/queues/bursts/count' => const FakeResponse({'count': 7, 'bytes': 20 * _mib}),
      'GET /cleanup/queues/screenshots/count' => const FakeResponse({'count': 0, 'bytes': 0}),
      'GET /cleanup/queues/duplicates/count' when duplicatesForbidden => const FakeResponse({'message': 'no'}, 403),
      'GET /cleanup/queues/duplicates/count' => const FakeResponse({'count': 2, 'bytes': 4 * _mib}),
      'GET /cleanup/queues/blurry/count' => const FakeResponse({
        'count': 12,
        'bytes': 30 * _mib,
        'analysedPercent': 68,
      }),
      'GET /cleanup/queues/space_hogs' when query['limit']?.single == '1' && query.length == 1 => FakeResponse(
        pageJson(['hog-1']),
      ),
      'GET /cleanup/queues/blurry' when query['limit']?.single == '1' && query.length == 1 => FakeResponse(
        pageJson(['blur-1']),
      ),
      'GET /cleanup/trash' => const FakeResponse({'count': 4, 'bytes': 2048}),
      // The Bursts queue the quick win opens.
      'GET /cleanup/queues/bursts' => FakeResponse({
        'items': const <Object>[],
        'groups': [
          {
            'groupId': 'burst-1',
            'source': 'burstId',
            'suggestedKeepId': 'burst-1',
            'assets': [assetJson('burst-1'), assetJson('burst-2')],
          },
        ],
        'nextCursor': null,
      }),
      _ => null,
    };
  }

  List<String> get routes => server.routes;
}

void main() {
  setUpAll(initOverviewStore);

  late _Library library;
  setUp(() => library = _Library());

  Future<void> settle(WidgetTester tester) => settleCleanup(tester, requests: () => library.routes.length);

  Future<void> openOverview(WidgetTester tester, {bool trashEnabled = true, DateTime Function()? now}) async {
    final container = overviewContainer(
      server: library.server,
      directory: tempDirectory(),
      trashEnabled: trashEnabled,
      now: now ?? august15,
    );
    await pumpCleanup(tester, container, openOverview: true, settle: false);
    await settle(tester);
  }

  group('Library entry', () {
    // The real Library page embeds a map, so it is not pumped here; this keeps the one line that places the button.
    test('the Library page places the button once, in its action grid', () {
      final source = File('lib/presentation/pages/library.page.dart').readAsStringSync();
      final grid = source.substring(
        source.indexOf('class _ActionButtonGrid'),
        source.indexOf('class _ActionButton extends'),
      );
      expect('const LibraryCleanupButton(),'.allMatches(grid), hasLength(1));
      expect('LibraryCleanupButton('.allMatches(source), hasLength(1));
    });

    testWidgets('an unsupported server: no Cleanup button, and nothing but the probe is sent', (tester) async {
      library.supported = false;
      final container = overviewContainer(server: library.server, directory: tempDirectory());
      await pumpCleanup(tester, container, settle: false);
      await settle(tester);

      expect(find.text('Favorites'), findsOneWidget);
      expect(find.byKey(const Key('library-cleanup-button')), findsNothing);
      expect(library.routes, ['GET /cleanup/calendar']);
    });

    testWidgets('a stock Immich server: no Cleanup button and no request at all', (tester) async {
      final container = overviewContainer(
        server: library.server,
        directory: tempDirectory(),
        kind: LibraryCleanupServerKind.stock,
      );
      await pumpCleanup(tester, container, settle: false);
      await settle(tester);

      expect(find.byKey(const Key('library-cleanup-button')), findsNothing);
      expect(library.routes, isEmpty);
    });

    testWidgets('a supported server: the button shows at once, and its subtitle fills in with today\'s counts', (
      tester,
    ) async {
      library.held.add('GET /cleanup/rewind/815');
      final container = overviewContainer(server: library.server, directory: tempDirectory());
      await pumpCleanup(tester, container, settle: false);
      await settle(tester);

      expect(find.byKey(const Key('library-cleanup-button')), findsOneWidget);
      expect(find.text('Cleanup'), findsOneWidget);
      expect(textOf(tester, 'library-cleanup-subtitle'), '');
      final before = tester.getRect(find.byKey(const Key('library-cleanup-button')));

      library.release();
      await settle(tester);
      expect(textOf(tester, 'library-cleanup-subtitle'), 'Today: 5 photos from 2 years');
      expect(tester.getRect(find.byKey(const Key('library-cleanup-button'))), before);
    });

    testWidgets('tapping the button opens the overview', (tester) async {
      final container = overviewContainer(server: library.server, directory: tempDirectory());
      await pumpCleanup(tester, container, settle: false);
      await settle(tester);

      await tester.tap(find.byKey(const Key('library-cleanup-button')));
      await settle(tester);
      expect(find.byKey(const Key('cleanup-today-card')), findsOneWidget);
    });
  });

  group('Today card', () {
    testWidgets('renders from the calendar and the years alone; the rest lands without moving it', (tester) async {
      library.held.addAll(['GET /cleanup/rewind/815/', 'GET /cleanup/queues/', 'GET /cleanup/trash']);
      await openOverview(tester);

      expect(textOf(tester, 'cleanup-today-eyebrow'), 'TODAY · AUGUST 15');
      expect(textOf(tester, 'cleanup-today-counts'), '5 photos from 2 years');
      expect(textOf(tester, 'cleanup-today-detail'), '2020 has the most.');
      expect(tester.widget<FilledButton>(find.byKey(const Key('cleanup-today-start'))).onPressed, isNotNull);
      expect(find.text("Start today's rewind"), findsOneWidget);
      expect(find.byKey(const Key('cleanup-today-photo-0')), findsNothing);
      expect(find.byKey(const Key('cleanup-could-free')), findsNothing);
      expect(find.byKey(const Key('cleanup-trash-size')), findsNothing);

      Rect rect(String key) => tester.getRect(find.byKey(Key(key)));
      final card = rect('cleanup-today-card');
      final start = rect('cleanup-today-start');
      final counts = rect('cleanup-today-counts');

      library.release();
      await settle(tester);

      expect(textOf(tester, 'cleanup-today-detail'), '2020 in Porto has the most.');
      expect(find.byKey(const Key('cleanup-today-photo-0')), findsOneWidget);
      expect(find.byKey(const Key('cleanup-today-photo-2')), findsOneWidget);
      expect(find.byKey(const Key('cleanup-could-free')), findsOneWidget);
      expect(find.byKey(const Key('cleanup-trash-size')), findsOneWidget);
      expect(rect('cleanup-today-card'), card);
      expect(rect('cleanup-today-start'), start);
      expect(rect('cleanup-today-counts'), counts);
    });

    testWidgets('with saved marks for today, the button reads "Resume · 3 of 5"', (tester) async {
      // p1 and p2 were kept on an earlier visit; q1 is marked, plus a mark for a photo no longer in the day.
      library.kept = {'p1', 'p2'};
      final directory = tempDirectory();
      await saveDayMarks(tester, directory, 815, {'q1': LibraryCleanupMark.trash, 'gone': LibraryCleanupMark.keep});
      final container = overviewContainer(server: library.server, directory: directory);
      await pumpCleanup(tester, container, openOverview: true, settle: false);
      await settle(tester);

      expect(find.text('Resume · 3 of 5'), findsOneWidget);
      expect(find.text("Start today's rewind"), findsNothing);
      // The position needs every year's photos, as the rewind loads them.
      expect(library.routes, containsAll(['GET /cleanup/rewind/815/2022', 'GET /cleanup/rewind/815/2020']));
    });

    testWidgets('without saved marks, only the busiest year is loaded and the button starts', (tester) async {
      await openOverview(tester);

      expect(find.text("Start today's rewind"), findsOneWidget);
      expect(library.routes, contains('GET /cleanup/rewind/815/2020'));
      expect(library.routes, isNot(contains('GET /cleanup/rewind/815/2022')));
    });

    testWidgets('a date without photos: the empty copy, a disabled button, and no rewind request', (tester) async {
      await openOverview(tester, now: () => DateTime(2026, 1, 1, 9));

      expect(textOf(tester, 'cleanup-today-eyebrow'), 'TODAY · JANUARY 1');
      expect(textOf(tester, 'cleanup-today-counts'), 'No photos were taken on this date.');
      expect(tester.widget<FilledButton>(find.byKey(const Key('cleanup-today-start'))).onPressed, isNull);
      expect(library.routes.where((route) => route.contains('/rewind/')), isEmpty);
    });

    testWidgets('a reviewed date says so, and the button still opens it', (tester) async {
      library.reviewed = true;
      await openOverview(tester);

      expect(
        textOf(tester, 'cleanup-today-detail'),
        'Reviewed. You can open it again any time. 2020 in Porto has the most.',
      );
      await tester.tap(find.byKey(const Key('cleanup-today-start')));
      await settle(tester);
      expect(find.byKey(const Key('cleanup-session')), findsOneWidget);
      expect(textOf(tester, 'cleanup-session-title'), 'Aug 15 · 1 of 5');
    });

    testWidgets('a failed years request shows an inline error, and Retry loads the card', (tester) async {
      library.yearsFail = true;
      await openOverview(tester);

      expect(find.byKey(const Key('cleanup-overview-error')), findsOneWidget);
      expect(find.text('Could not load Cleanup.'), findsOneWidget);
      expect(find.byKey(const Key('cleanup-quick-wins')), findsOneWidget);

      library.yearsFail = false;
      await tester.tap(find.byKey(const Key('cleanup-overview-retry')));
      await settle(tester);
      expect(find.byKey(const Key('cleanup-overview-error')), findsNothing);
      expect(textOf(tester, 'cleanup-today-counts'), '5 photos from 2 years');
    });
  });

  group('Quick wins', () {
    testWidgets('in the web order and words, with covers where the web loads them', (tester) async {
      await openOverview(tester);

      const order = ['space_hogs', 'bursts', 'screenshots', 'duplicates', 'blurry'];
      final lefts = [for (final slug in order) tester.getTopLeft(find.byKey(Key('cleanup-quick-win-$slug'))).dx];
      expect(lefts, [...lefts]..sort());
      expect(lefts.toSet(), hasLength(order.length));

      // Scroll the last cards into view to read them.
      await tester.drag(find.byKey(const Key('cleanup-quick-win-bursts')), const Offset(-600, 0));
      await settle(tester);

      expect(textOf(tester, 'cleanup-count-space_hogs'), '3 files · −600.0 MiB');
      expect(textOf(tester, 'cleanup-count-bursts'), 'up to 7 · −20.0 MiB');
      expect(find.byKey(const Key('cleanup-clear-screenshots')), findsOneWidget);
      expect(
        find.descendant(of: find.byKey(const Key('cleanup-clear-screenshots')), matching: find.text('All clear')),
        findsOneWidget,
      );
      expect(textOf(tester, 'cleanup-count-duplicates'), '2 groups · −4.0 MiB');
      expect(textOf(tester, 'cleanup-count-blurry'), '12 so far · −30.0 MiB');
      expect(textOf(tester, 'cleanup-analysing-blurry'), 'Analysing… 68% of library');

      expect(find.byKey(const Key('cleanup-cover-space_hogs')), findsOneWidget);
      expect(find.byKey(const Key('cleanup-cover-blurry')), findsOneWidget);
      expect(find.byKey(const Key('cleanup-icon-bursts')), findsOneWidget);
      expect(find.byKey(const Key('cleanup-icon-duplicates')), findsOneWidget);
      // An empty queue gets no cover request.
      expect(find.byKey(const Key('cleanup-icon-screenshots')), findsOneWidget);
      expect(library.routes, isNot(contains('GET /cleanup/queues/screenshots')));
      expect(library.routes, isNot(contains('GET /cleanup/queues/bursts')));
    });

    testWidgets('a refused duplicates count hides the Duplicates card', (tester) async {
      library.duplicatesForbidden = true;
      await openOverview(tester);

      expect(find.byKey(const Key('cleanup-quick-win-duplicates')), findsNothing);
      expect(find.byKey(const Key('cleanup-quick-win-screenshots')), findsOneWidget);
      // Could still free: 600 + 20 + 0 + 30 MiB, without the hidden queue.
      expect(textOf(tester, 'cleanup-could-free'), 'Could still free 650.0 MiB');
    });

    testWidgets('"Could still free" waits for every count, then shows their sum', (tester) async {
      library.held.add('GET /cleanup/queues/blurry/count');
      await openOverview(tester);
      expect(find.byKey(const Key('cleanup-could-free')), findsNothing);

      library.release();
      await settle(tester);
      expect(textOf(tester, 'cleanup-could-free'), 'Could still free 654.0 MiB');
    });

    testWidgets('with the trash on, the trash line shows its size', (tester) async {
      await openOverview(tester);

      expect(textOf(tester, 'cleanup-trash-size'), 'Trash: 2.0 KiB');
      expect(tester.widget<TextButton>(find.byKey(const Key('cleanup-empty-trash'))).onPressed, isNotNull);
    });

    testWidgets('with the trash off, no trash line and no trash request', (tester) async {
      await openOverview(tester, trashEnabled: false);

      expect(find.byKey(const Key('cleanup-trash-line')), findsNothing);
      expect(library.routes, isNot(contains('GET /cleanup/trash')));
    });
  });

  testWidgets('pull to refresh reloads every section', (tester) async {
    await openOverview(tester);
    final before = [...library.routes];
    expect(before.toSet(), {
      'GET /cleanup/calendar',
      'GET /cleanup/rewind/815',
      'GET /cleanup/rewind/815/2020',
      'GET /cleanup/queues/space_hogs/count',
      'GET /cleanup/queues/bursts/count',
      'GET /cleanup/queues/screenshots/count',
      'GET /cleanup/queues/duplicates/count',
      'GET /cleanup/queues/blurry/count',
      'GET /cleanup/queues/space_hogs',
      'GET /cleanup/queues/blurry',
      'GET /cleanup/trash',
    });

    await tester.fling(find.byKey(const Key('cleanup-overview-list')), const Offset(0, 500), 1500);
    await settle(tester);

    final again = library.routes.skip(before.length).toList();
    expect(again.toSet(), before.toSet());
    expect(again, hasLength(before.length));
  });

  group('Navigation', () {
    testWidgets('Start opens the rewind, Bursts its queue, "See all" Your year, and back returns', (tester) async {
      await openOverview(tester);

      await tester.tap(find.byKey(const Key('cleanup-today-start')));
      await settle(tester);
      expect(find.byKey(const Key('cleanup-session')), findsOneWidget);
      expect(textOf(tester, 'cleanup-session-title'), 'Aug 15 · 1 of 5');
      await tester.tap(find.byKey(const Key('cleanup-session-back')));
      await settle(tester);
      expect(find.byKey(const Key('cleanup-session')), findsNothing);
      expect(find.byKey(const Key('cleanup-today-card')), findsOneWidget);

      // Bursts opens its series queue (cleanup_series_queue_test.dart has the rest).
      await tester.ensureVisible(find.byKey(const Key('cleanup-quick-win-bursts')));
      await settle(tester);
      await tester.tap(find.byKey(const Key('cleanup-quick-win-bursts')));
      await settle(tester);
      expect(textOf(tester, 'cleanup-session-title'), 'Bursts & series · 1 of 7');
      expect(find.byKey(const Key('cleanup-series-card-burst-1')), findsOneWidget);
      await tester.tap(find.byKey(const Key('cleanup-session-back')));
      await settle(tester);
      expect(find.byKey(const Key('cleanup-session')), findsNothing);

      await tester.ensureVisible(find.byKey(const Key('cleanup-see-all')));
      await settle(tester);
      await tester.tap(find.byKey(const Key('cleanup-see-all')));
      await settle(tester);
      expect(find.byKey(const Key('cleanup-year-months')), findsOneWidget);
      await tester.pageBack();
      await settle(tester);
      expect(find.byKey(const Key('cleanup-year-months')), findsNothing);
    });
  });

  group('Motion', () {
    testWidgets('the today card, quick wins and year teaser arrive on a stagger', (tester) async {
      final container = overviewContainer(server: library.server, directory: tempDirectory());
      final router = await pumpCleanup(tester, container, settle: false);
      await settle(tester);
      unawaited(router.push(const LibraryCleanupOverviewRoute()));
      // The push resolves its guards asynchronously; real time lets it through, fake time stays put.
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 20)));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 120));

      final early = entranceOpacities(tester);
      expect(early, hasLength(3));
      expect(early[0], greaterThan(early[1]));
      expect(early[1], greaterThan(early[2]));

      await settle(tester);
      expect(entranceOpacities(tester), [1.0, 1.0, 1.0]);
    });

    testWidgets('reduced motion shows everything at once', (tester) async {
      final container = overviewContainer(server: library.server, directory: tempDirectory());
      final router = await pumpCleanup(tester, container, settle: false, reduceMotion: true);
      await settle(tester);
      unawaited(router.push(const LibraryCleanupOverviewRoute()));
      // The push resolves its guards asynchronously; real time lets it through, fake time stays put.
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 20)));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 16));

      expect(entranceOpacities(tester), [1.0, 1.0, 1.0]);
    });

    testWidgets('a quick-win card squishes while pressed and springs back', (tester) async {
      await openOverview(tester);

      double scale() => tester
          .widget<Transform>(
            find
                .descendant(
                  of: find.ancestor(
                    of: find.byKey(const Key('cleanup-quick-win-bursts')),
                    matching: find.byType(GalleryPressable),
                  ),
                  matching: find.byType(Transform),
                )
                .first,
          )
          .transform
          .entry(0, 0);

      expect(scale(), 1.0);
      final gesture = await tester.startGesture(tester.getCenter(find.byKey(const Key('cleanup-quick-win-bursts'))));
      await tester.pump();
      // The dip waits out the scrolling delay, then runs on the frames after it.
      await tester.pump(const Duration(milliseconds: 100));
      await tester.pump(const Duration(milliseconds: 100));
      expect(scale(), lessThan(1.0));
      await gesture.cancel();
      await settle(tester);
      expect(scale(), closeTo(1.0, 0.001));
    });
  });
}
