import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/gallery/cleanup/repositories/library_cleanup.repository.dart';
import 'package:immich_mobile/gallery/cleanup/repositories/library_cleanup_details.repository.dart';
import 'package:immich_mobile/routing/router.dart';
import 'package:immich_mobile/utils/bytes_units.dart';
import 'package:openapi/api.dart';

import 'cleanup_contract_server.dart';
import 'cleanup_overview_harness.dart';
import 'cleanup_test_utils.dart';
import 'rewind_harness.dart';

// Slices 3 and 4 end to end (specs/2026-10-29-mobile-library-cleanup-design.md, "Slice 3", "Slice 4"): the real rewind
// page, deck, details sheet and finish screen, with the real providers and the generated OpenAPI client, against the
// strict contract server, which
// answers only what the real server was recorded answering (e2e/src/specs/server/api/gallery-cleanup-contract.e2e-spec.ts).
// A request the recording does not have (a completeMonthDay on Apply and stop, a favourite sent as a keep, a second
// lookup) fails the test.
//
// Given the rewind of 15 August (p1, p2 in 2022; q1, q2, q3 in 2020; q1 is in a shared space; q2 has a camera and is
// in the album Summer)
//   When p1 is swiped right and p2 up, then in button mode q1 is skipped
//   When the details of q2 are opened              Then the sheet shows its date, place and album from the recorded
//                                                  asset and albums answers (100, 101), and fully open its camera and file
//   When Trash is chosen on the sheet               Then q2 is marked as the bar would, and the next photo shows
//   When the user applies and stops
//                                    Then one lookup and one commit without completeMonthDay; back home with "Saved"
//   When the toast's Undo is tapped  Then exactly q2 is restored
//   When the day is reopened         Then it resumes at the first untouched photo, q1, at "3 of 5", in button mode
//   When q1 is swiped left and the rest kept, declined once and then confirmed
//                                    Then nothing, then one commit with completeMonthDay, the calendar again, and the
//                                    finished day

final ids = cleanupContractIds();
String idOf(String label) => ids[label] ?? (throw StateError('no fixture names $label'));

const _script = {
  '010-calendar',
  '100-details-asset-q2',
  '101-details-albums-q2',
  '020-rewind-815-years',
  '021-rewind-815-2022',
  '022-rewind-815-2020',
  '030-in-spaces-q2',
  '031-commit-apply-and-stop',
  '032-restore-q2',
  '040-rewind-815-years-resumed',
  '041-rewind-815-2022-resumed',
  '042-rewind-815-2020-resumed',
  '050-in-spaces-q1',
  '051-in-spaces-q1-again',
  '052-commit-finish-day',
  '053-calendar-after-finish',
};

void main() {
  setUpAll(initOverviewStore);

  testWidgets('swipe a day, apply midway, reopen at the first untouched photo, finish', (tester) async {
    await setPrefs();
    // Real sockets: the test binding's HTTP stand-in would answer every request with a 400.
    HttpOverrides.global = null;
    final server = (await tester.runAsync(() => CleanupContractServer.start(include: _script.contains)))!;
    addTearDown(() => tester.runAsync(server.close));
    final client = ApiClient(basePath: server.endpoint);
    final container = rewindContainer(
      repository: LibraryCleanupRepository(
        cleanupApi: CleanupApi(client),
        trashApi: TrashApi(client),
        timeZone: () async => 'Europe/Lisbon',
      ),
      details: LibraryCleanupDetailsRepository(assetsApi: AssetsApi(client), albumsApi: AlbumsApi(client)),
      directory: tempDirectory(),
    );
    Future<void> settle() => settleCleanup(tester, requests: () => server.requests.length);
    Future<void> tap(String key) async {
      await tester.tap(find.byKey(Key(key)));
      await settle();
    }

    final top = find.byKey(const Key('cleanup-deck-top'));
    final pages = find.byKey(const Key('cleanup-deck-pages'));
    String card() => topCardId(tester)!;
    bool showing(String label) {
      final page = find.byKey(Key('cleanup-page-${idOf('asset:$label')}'));
      return page.evaluate().isNotEmpty && tester.getRect(page).left.abs() < 1;
    }

    final router = await pumpRewind(tester, container, requests: () => server.requests.length);
    expect(server.served.take(4).toSet(), {
      '010-calendar',
      '020-rewind-815-years',
      '021-rewind-815-2022',
      '022-rewind-815-2020',
    });
    expect(textOf(tester, 'cleanup-session-title'), 'Aug 15 · 1 of 5');
    expect(card(), idOf('asset:p1'));

    // p1 right (keep), p2 up (favourite).
    await tester.fling(top, const Offset(160, 0), 1500);
    await settle();
    await tester.fling(top, const Offset(0, -160), 1500);
    await settle();
    expect(card(), idOf('asset:q1'));

    // Button mode: skip q1 with a sideways swipe.
    await tap('cleanup-session-menu');
    await tap('cleanup-menu-mode-button');
    expect(showing('q1'), isTrue);
    await tester.fling(pages, const Offset(-300, 0), 1200);
    await settle();
    expect(showing('q2'), isTrue);

    // q2's details: the card's date at once, then the recorded asset and albums.
    await tap('cleanup-chip-details-${idOf('asset:q2')}');
    expect(server.served.skip(4).toSet(), {'100-details-asset-q2', '101-details-albums-q2'});
    expect(textOf(tester, 'cleanup-details-date'), 'Saturday, August 15, 2020 11:00');
    expect(textOf(tester, 'cleanup-details-subtitle'), '6 years ago · Photo 4 of 5');
    expect(textOf(tester, 'cleanup-details-place-title'), 'Porto');
    expect(textOf(tester, 'cleanup-details-albums-title'), 'Summer');
    expect(find.byKey(const Key('cleanup-details-people')), findsNothing, reason: 'no one is recognised in q2');
    await tester.fling(find.byKey(const Key('cleanup-details-handle')), const Offset(0, -400), 1500);
    await settle();
    expect(textOf(tester, 'cleanup-details-camera-title'), 'Fujifilm X-T3 · XF23mmF2 R WR');
    expect(textOf(tester, 'cleanup-details-camera-detail'), 'ƒ/2.8 · 1/250 s · ISO 400 · 23 mm');
    expect(textOf(tester, 'cleanup-details-file-title'), 'q2.png');
    expect(textOf(tester, 'cleanup-details-file-detail'), '6240 × 4160 · 26 MP · ${formatBytes(1004)}');

    // Trash from the sheet: marked as the bar would, and the next photo shows.
    await tap('cleanup-details-trash');
    expect(find.byKey(const Key('cleanup-details-sheet')), findsNothing);
    expect(showing('q3'), isTrue);
    expect(server.served, hasLength(6), reason: 'marking sends nothing');

    // Done → Apply and stop: the lookup, then one commit without completeMonthDay.
    await tap('cleanup-session-done');
    expect(textOf(tester, 'cleanup-finish-gone-through'), '3 of 5 gone through');
    await tap('cleanup-finish-apply-and-stop');
    expect(server.served.skip(6), ['030-in-spaces-q2', '031-commit-apply-and-stop']);
    expect(find.byKey(const Key('test-home')), findsOneWidget);
    expect(find.text('Saved · 1 moved to trash · pick up at photo 4 any time'), findsOneWidget);

    // The toast's Undo puts q2 back.
    await tap('cleanup-toast-undo');
    await settle();
    expect(server.served.last, '032-restore-q2');

    // Reopen: p1 and p2 were kept, so the day resumes at q1, still in button mode.
    unawaited(router.push(LibraryCleanupRewindRoute(monthDay: 815)));
    await settle();
    expect(server.served.skip(9).toSet(), {
      '040-rewind-815-years-resumed',
      '041-rewind-815-2022-resumed',
      '042-rewind-815-2020-resumed',
    });
    expect(textOf(tester, 'cleanup-session-title'), 'Aug 15 · 3 of 5');
    expect(find.byKey(const Key('cleanup-button-bar')), findsOneWidget, reason: 'the mode is remembered');
    expect(showing('q1'), isTrue);

    // Back to swiping: q1 left (trash), then keep the rest and finish.
    await tap('cleanup-session-menu');
    await tap('cleanup-menu-mode-swipe');
    expect(card(), idOf('asset:q1'));
    await tester.fling(top, const Offset(-160, 0), 1500);
    await settle();
    await tap('cleanup-session-done');
    await tap('cleanup-finish-keep-rest');
    // q1 is in a shared space: declining commits nothing and keeps the finish screen.
    expect(find.text('1 photo is also in a shared space. Trashing removes it for space members too.'), findsOneWidget);
    await tap('cleanup-trash-confirm-cancel');
    expect(server.served.last, '050-in-spaces-q1');
    expect(find.byKey(const Key('cleanup-finish')), findsOneWidget);

    await tap('cleanup-finish-keep-rest');
    await tap('cleanup-trash-confirm-ok');
    await settle();
    expect(server.served.skip(13), ['051-in-spaces-q1-again', '052-commit-finish-day', '053-calendar-after-finish']);
    expect(textOf(tester, 'cleanup-day-done-title'), 'August 15 cleaned up');
    expect(textOf(tester, 'cleanup-day-done-trashed'), '1');
    expect(textOf(tester, 'cleanup-day-done-kept'), '2');
    expect(find.text('Next day: April 11'), findsOneWidget);

    await tap('cleanup-day-done-hub');
    expect(find.byKey(const Key('test-home')), findsOneWidget);

    expect(server.unmatched, isEmpty);
    expect(server.served.toSet(), _script);
    expect(server.served, hasLength(_script.length));

    // Take the screens down, then let the HTTP client's idle timers and the toasts run out.
    await tester.pumpWidget(const SizedBox.shrink());
    client.client.close();
    await tester.pump(const Duration(seconds: 16));
  });
}
