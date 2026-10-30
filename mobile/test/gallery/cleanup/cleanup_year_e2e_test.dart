import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/cleanup/providers/library_cleanup.providers.dart';
import 'package:immich_mobile/gallery/cleanup/repositories/library_cleanup.repository.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_calendar_bits.dart';
import 'package:openapi/api.dart';

import 'cleanup_contract_server.dart';
import 'cleanup_overview_harness.dart';
import 'cleanup_test_utils.dart';
import 'cleanup_year_harness.dart';

// Slice 8 end to end (specs/2026-10-29-mobile-library-cleanup-design.md, "Slice 8"): the real overview, year and month
// pages and the day sheet, with their real providers and the real generated OpenAPI client, against the strict contract
// server (test/fixtures/cleanup_contract/README.md). Only the fixtures the walk needs are served, so a request the
// screens should not send fails it.
//
// Today is 29 October, a date without photos, so the overview asks nothing about any day and every rewind request comes
// from the day sheet.
//
//   Given the recorded calendar (010)   When "See all" opens Your year and August is opened
//                                       Then August shows "0 of 31 days reviewed · 1 to go"
//   When 15 August is tapped            Then its sheet shows the recorded counts and city (020, 022)
//   When "Rewind this day" is tapped    Then that day's rewind is opened (15 August)
//   Given the rewind finished the day and the calendar is read again (053)
//   When the user comes back            Then 15 August is green, the sheet says "Reviewed", the year card reads 1/31 and
//                                            August, now complete, glows

const _overviewLoads = [
  '012-overview-count-space-hogs',
  '013-overview-count-bursts',
  '014-overview-count-screenshots',
  '015-overview-count-duplicates',
  '016-overview-count-blurry',
  '017-overview-cover-blurry',
  '018-overview-trash',
];

void main() {
  setUpAll(initOverviewStore);

  testWidgets('See all, a month, a day, its rewind, and the day reviewed on return', (tester) async {
    // Real sockets: the test binding's HTTP stand-in would answer every request with a 400.
    HttpOverrides.global = null;
    final fixtures = {
      '010-calendar',
      '020-rewind-815-years',
      '022-rewind-815-2020',
      '053-calendar-after-finish',
      ..._overviewLoads,
    };
    final server = (await tester.runAsync(() => CleanupContractServer.start(include: fixtures.contains)))!;
    addTearDown(() => tester.runAsync(server.close));
    final client = ApiClient(basePath: server.endpoint);
    final repository = LibraryCleanupRepository(
      cleanupApi: CleanupApi(client),
      trashApi: TrashApi(client),
      timeZone: () async => 'Europe/Lisbon',
    );
    final rewinds = RewindSpy();
    final container = overviewContainer(
      repository: repository,
      directory: tempDirectory(),
      now: () => DateTime(2026, 10, 29, 9),
    );
    final scoped = ProviderContainer(parent: container, overrides: [rewinds.override]);
    addTearDown(scoped.dispose);

    Future<void> settle() => settleCleanup(tester, requests: () => server.requests.length);

    await pumpYear(tester, scoped, startAtOverview: true, settle: false);
    await settle();
    expect(find.byKey(const Key('cleanup-today-card')), findsOneWidget);

    // The overview's "See all" opens the year.
    await tester.ensureVisible(find.byKey(const Key('cleanup-see-all')));
    await settle();
    await tester.tap(find.byKey(const Key('cleanup-see-all')));
    await settle();
    expect(textOf(tester, 'cleanup-month-count-8'), '0/31');
    expect(textOf(tester, 'cleanup-month-count-12'), '1/31');

    await openMonth(tester, 8, settle: settle);
    expect(textOf(tester, 'cleanup-month-progress'), '0 of 31 days reviewed · 1 to go');

    // The sheet shows the day's recorded counts: two photos in 2022 and three in 2020, two of them in Porto.
    await tapDay(tester, 815, settle: settle);
    expect(textOf(tester, 'cleanup-day-sheet-date'), 'AUGUST 15');
    expect(textOf(tester, 'cleanup-day-sheet-counts'), '5 photos from 2 years');
    expect(textOf(tester, 'cleanup-day-sheet-detail'), '2020 in Porto has the most.');
    expect(find.byKey(const Key('cleanup-day-sheet-thumb-2')), findsOneWidget);
    expect(server.served, containsAllInOrder(['010-calendar', '020-rewind-815-years', '022-rewind-815-2020']));

    await tester.tap(find.byKey(const Key('cleanup-day-sheet-rewind')));
    await settle();
    expect(rewinds.opened, [815]);

    // The rewind finishes the day and reads the calendar again, as the session does after a finish.
    unawaited(scoped.read(libraryCleanupSupportProvider.notifier).refreshCalendar());
    await settle();
    expect(server.served.last, '053-calendar-after-finish');
    await tester.pageBack();
    await settle();

    expect(tester.widget<Material>(find.byKey(const Key('cleanup-day-815'))).color, libraryCleanupReviewedGreen);
    expect(textOf(tester, 'cleanup-month-progress'), '1 of 31 days reviewed · 0 to go');
    expect(textOf(tester, 'cleanup-day-sheet-detail'), startsWith('Reviewed.'));

    await tester.tap(find.byKey(const Key('cleanup-month-back')));
    await pumpFrames(tester, const Duration(milliseconds: 1000));
    expect(textOf(tester, 'cleanup-month-count-8'), '1/31');
    expect(find.byKey(const Key('cleanup-month-glow-8')), findsOneWidget);
    await settle();

    expect(server.unmatched, isEmpty);
    expect(server.served.toSet(), fixtures);

    await tester.pumpWidget(const SizedBox.shrink());
    client.client.close();
    await tester.pump(const Duration(seconds: 16));
  });
}
