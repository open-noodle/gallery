import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_marks.dart';
import 'package:immich_mobile/gallery/cleanup/repositories/library_cleanup.repository.dart';
import 'package:openapi/api.dart';

import 'cleanup_contract_server.dart';
import 'cleanup_overview_harness.dart';
import 'cleanup_test_utils.dart';

// Slice 2 end to end (specs/2026-10-29-mobile-library-cleanup-design.md, "Slice 2"): the Library button and the real
// overview page, with their real providers and the real generated OpenAPI client, against the strict contract server,
// which answers only what the real server was recorded answering (e2e/src/specs/server/api/
// gallery-cleanup-contract.e2e-spec.ts). Each test serves only the fixtures its day needs, so a request the app should
// not send (a rewind call for an empty day, any call after a 404 probe) fails it.
//
//   An ordinary day (15 August)     Library: the button, then "Today: 5 photos from 2 years"; the overview: the today
//                                   card, every quick win in the recorded words, the trash line; Start opens the rewind,
//                                   which loads the day itself
//   The same day with saved marks   "Resume · 1 of 5", from every year's photos
//   An empty day (1 January)        the empty copy, a disabled button, no rewind request
//   A reviewed day (24 December)    "Reviewed", and the button still opens it
//   A server without cleanup (404)  no button, and nothing but the probe is sent

final ids = cleanupContractIds();
String idOf(String label) => ids[label] ?? (throw StateError('no fixture names $label'));

const _overviewLoads = [
  '012-overview-count-space-hogs',
  '013-overview-count-bursts',
  '014-overview-count-screenshots',
  '015-overview-count-duplicates',
  '016-overview-count-blurry',
  '017-overview-cover-blurry',
  '018-overview-trash',
];

/// Start on the today card: the rewind's own load of the day.
const _rewindFromOverview = [
  '023-rewind-815-years-from-overview',
  '024-rewind-815-2022-from-overview',
  '025-rewind-815-2020-from-overview',
];

void main() {
  setUpAll(initOverviewStore);

  Future<CleanupContractServer> serve(WidgetTester tester, Set<String> fixtures) async {
    // Real sockets: the test binding's HTTP stand-in would answer every request with a 400.
    HttpOverrides.global = null;
    final server = (await tester.runAsync(() => CleanupContractServer.start(include: fixtures.contains)))!;
    addTearDown(() => tester.runAsync(server.close));
    return server;
  }

  final clients = <ApiClient>[];

  LibraryCleanupRepository repositoryFor(CleanupContractServer server) {
    final client = ApiClient(basePath: server.endpoint);
    clients.add(client);
    return LibraryCleanupRepository(
      cleanupApi: CleanupApi(client),
      trashApi: TrashApi(client),
      timeZone: () async => 'Europe/Lisbon',
    );
  }

  /// Takes the screens down, then lets the HTTP client's idle keep-alive timers, which run on the test's fake clock, run
  /// out.
  Future<void> finish(WidgetTester tester) async {
    await tester.pumpWidget(const SizedBox.shrink());
    for (final client in clients) {
      client.client.close();
    }
    clients.clear();
    await tester.pump(const Duration(seconds: 16));
  }

  Future<void> settle(WidgetTester tester, CleanupContractServer server) =>
      settleCleanup(tester, requests: () => server.requests.length);

  Future<void> openFromLibrary(WidgetTester tester, CleanupContractServer server) async {
    await tester.tap(find.byKey(const Key('library-cleanup-button')));
    await settle(tester, server);
    expect(find.byKey(const Key('cleanup-today-card')), findsOneWidget);
  }

  testWidgets('an ordinary day: Library button, overview, quick wins and trash, then Start', (tester) async {
    final server = await serve(tester, {
      '010-calendar',
      '020-rewind-815-years',
      '022-rewind-815-2020',
      ..._overviewLoads,
      ..._rewindFromOverview,
    });
    final container = overviewContainer(repository: repositoryFor(server), directory: tempDirectory());
    await pumpCleanup(tester, container, settle: false);
    await settle(tester, server);

    expect(textOf(tester, 'library-cleanup-subtitle'), 'Today: 5 photos from 2 years');
    expect(server.served, ['010-calendar', '020-rewind-815-years']);

    await openFromLibrary(tester, server);
    // The calendar and the years are the ones Library fetched: nothing is asked twice.
    expect(server.served.where((name) => name == '010-calendar' || name == '020-rewind-815-years'), hasLength(2));

    expect(textOf(tester, 'cleanup-overview-progress'), '1-day streak · 1 of 366 days reviewed');
    expect(textOf(tester, 'cleanup-today-eyebrow'), 'TODAY · AUGUST 15');
    expect(textOf(tester, 'cleanup-today-counts'), '5 photos from 2 years');
    // The busiest year is 2020, where two of the three photos are in Porto.
    expect(textOf(tester, 'cleanup-today-detail'), '2020 in Porto has the most.');
    expect(find.byKey(const Key('cleanup-today-photo-2')), findsOneWidget);
    expect(find.text("Start today's rewind"), findsOneWidget);

    // The seeded library: only Blurry has photos, and quality analysis has seen 68% of it.
    expect(find.byKey(const Key('cleanup-clear-space_hogs')), findsOneWidget);
    expect(find.byKey(const Key('cleanup-clear-bursts')), findsOneWidget);
    expect(find.byKey(const Key('cleanup-clear-screenshots')), findsOneWidget);
    await tester.drag(find.byKey(const Key('cleanup-quick-win-bursts')), const Offset(-600, 0));
    await settle(tester, server);
    expect(find.byKey(const Key('cleanup-clear-duplicates')), findsOneWidget);
    expect(textOf(tester, 'cleanup-count-blurry'), '13 so far · −12.9 KiB');
    expect(textOf(tester, 'cleanup-analysing-blurry'), 'Analysing… 68% of library');
    expect(find.byKey(const Key('cleanup-cover-blurry')), findsOneWidget);
    expect(textOf(tester, 'cleanup-could-free'), 'Could still free 12.9 KiB');
    expect(textOf(tester, 'cleanup-trash-size'), 'Trash: 0 B');
    expect(tester.widget<TextButton>(find.byKey(const Key('cleanup-empty-trash'))).onPressed, isNull);

    // Start: the rewind loads the day itself, and opens on its first photo.
    await tester.tap(find.byKey(const Key('cleanup-today-start')));
    await settle(tester, server);
    expect(textOf(tester, 'cleanup-session-title'), 'Aug 15 · 1 of 5');
    expect(textOf(tester, 'cleanup-card-headline-${idOf('asset:p1')}'), '2022 · 4 years ago');

    expect(server.unmatched, isEmpty);
    expect(server.served.toSet(), {
      '010-calendar',
      '020-rewind-815-years',
      '022-rewind-815-2020',
      ..._overviewLoads,
      ..._rewindFromOverview,
    });
    await finish(tester);
  });

  testWidgets('the same day with saved marks: "Resume · 1 of 5", from every year\'s photos', (tester) async {
    final server = await serve(tester, {
      '010-calendar',
      '020-rewind-815-years',
      '021-rewind-815-2022',
      '022-rewind-815-2020',
      ..._overviewLoads,
    });
    final directory = tempDirectory();
    await saveDayMarks(tester, directory, 815, {idOf('asset:q2'): LibraryCleanupMark.trash});
    final container = overviewContainer(repository: repositoryFor(server), directory: directory);
    await pumpCleanup(tester, container, openOverview: true, settle: false);
    await settle(tester, server);

    expect(find.text('Resume · 1 of 5'), findsOneWidget);
    expect(server.unmatched, isEmpty);
    expect(server.served, containsAll(['021-rewind-815-2022', '022-rewind-815-2020']));
    await finish(tester);
  });

  testWidgets('an empty day: the empty copy, a disabled button and no rewind request', (tester) async {
    final server = await serve(tester, {'010-calendar', ..._overviewLoads});
    final container = overviewContainer(
      repository: repositoryFor(server),
      directory: tempDirectory(),
      now: () => DateTime(2026, 1, 1, 9),
    );
    await pumpCleanup(tester, container, settle: false);
    await settle(tester, server);

    expect(textOf(tester, 'library-cleanup-subtitle'), 'No photos were taken on this date.');
    await openFromLibrary(tester, server);

    expect(textOf(tester, 'cleanup-today-counts'), 'No photos were taken on this date.');
    expect(tester.widget<FilledButton>(find.byKey(const Key('cleanup-today-start'))).onPressed, isNull);
    expect(server.unmatched, isEmpty);
    expect(server.requests.where((route) => route.contains('/rewind/')), isEmpty);
    await finish(tester);
  });

  testWidgets('a reviewed day: "Reviewed", and the button still opens it', (tester) async {
    final server = await serve(tester, {
      '010-calendar',
      '019a-overview-rewind-1224-years',
      '019b-overview-rewind-1224-2021',
      '019c-rewind-1224-years',
      '019d-rewind-1224-2021',
      ..._overviewLoads,
    });
    final container = overviewContainer(
      repository: repositoryFor(server),
      directory: tempDirectory(),
      now: () => DateTime(2026, 12, 24, 18),
    );
    await pumpCleanup(tester, container, openOverview: true, settle: false);
    await settle(tester, server);

    expect(textOf(tester, 'cleanup-today-counts'), '1 photo from 1 year');
    expect(
      textOf(tester, 'cleanup-today-detail'),
      'Reviewed. You can open it again any time. 2021 in Madrid has the most.',
    );
    await tester.tap(find.byKey(const Key('cleanup-today-start')));
    await settle(tester, server);
    // Its one photo was kept on an earlier visit: the rewind opens on the finish screen.
    expect(find.byKey(const Key('cleanup-finish')), findsOneWidget);
    expect(server.unmatched, isEmpty);
    expect(server.served, containsAll(['019c-rewind-1224-years', '019d-rewind-1224-2021']));
    await finish(tester);
  });

  testWidgets('a server without Library Cleanup: no button, and nothing but the probe is sent', (tester) async {
    final server = await serve(tester, {'011-calendar-no-cleanup'});
    final container = overviewContainer(repository: repositoryFor(server), directory: tempDirectory());
    await pumpCleanup(tester, container, settle: false);
    await settle(tester, server);

    expect(find.text('Favorites'), findsOneWidget);
    expect(find.byKey(const Key('library-cleanup-button')), findsNothing);
    expect(server.served, ['011-calendar-no-cleanup']);
    expect(server.requests, ['GET /api/cleanup/calendar']);
    expect(server.unmatched, isEmpty);
    await finish(tester);
  });
}
