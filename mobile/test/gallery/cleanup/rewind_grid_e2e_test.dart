import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/gallery/cleanup/repositories/library_cleanup.repository.dart';
import 'package:immich_mobile/gallery/cleanup/repositories/library_cleanup_details.repository.dart';
import 'package:immich_mobile/routing/router.dart';
import 'package:openapi/api.dart';

import 'cleanup_contract_server.dart';
import 'cleanup_overview_harness.dart';
import 'cleanup_test_utils.dart';
import 'rewind_harness.dart';

// Slice 5 end to end (specs/2026-10-29-mobile-library-cleanup-design.md, "Slice 5"): the real rewind page in Grid mode,
// the deck and the finish screen, with the real providers and the generated OpenAPI client, against the strict contract
// server (test/fixtures/cleanup_contract/README.md). Marks made in the grid and in the deck go out in one commit, which
// must be exactly the recorded one (114), or no fixture matches.
//
// Given the rewind of 21 June (r1, r2 in 2024 in Faro; s1, s2 in 2019, s1 in Braga), opened in the deck
//   When the grid opens                     Then 2024 and 2019 are its sections, with the recorded counts and cities
//   When r1 is tapped three times and "Keep all remaining" is tapped on 2024
//                                           Then r1 is marked for trash and r2 kept, and nothing is sent
//   When the deck comes back                Then it is on s1; s1 is swiped up and s2 right
//   When the day is finished                Then one lookup for r1 (113), one commit with r1 trashed, s1 favourited,
//                                           r2 and s2 kept and completeMonthDay (114), the calendar again (115)

final ids = cleanupContractIds();
String idOf(String label) => ids[label] ?? (throw StateError('no fixture names $label'));

const _script = {
  '010-calendar',
  '110-rewind-621-years',
  '111-rewind-621-2024',
  '112-rewind-621-2019',
  '113-in-spaces-r1',
  '114-commit-finish-621',
  '115-calendar-after-621',
};

void main() {
  setUpAll(initOverviewStore);

  testWidgets('mark in the grid, switch to the deck, finish: one commit, the recorded one', (tester) async {
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

    Finder tile(String label) => find.byKey(Key('cleanup-grid-tile-${idOf('asset:$label')}'));
    bool marked(String label, String mark) =>
        find.byKey(Key('cleanup-grid-mark-${idOf('asset:$label')}-$mark')).evaluate().isNotEmpty;
    final top = find.byKey(const Key('cleanup-deck-top'));

    await pumpRewind(
      tester,
      container,
      first: LibraryCleanupRewindRoute(monthDay: 621),
      requests: () => server.requests.length,
    );
    expect(server.served.toSet(), {
      '010-calendar',
      '110-rewind-621-years',
      '111-rewind-621-2024',
      '112-rewind-621-2019',
    });
    expect(textOf(tester, 'cleanup-session-title'), 'Jun 21 · 1 of 4');
    expect(topCardId(tester), idOf('asset:r1'));

    // The grid: the recorded years, counts and cities.
    await tap('cleanup-session-menu');
    await tap('cleanup-menu-grid');
    expect(textOf(tester, 'cleanup-grid-year-meta-2024'), '2 years ago · Faro · 2 photos');
    expect(textOf(tester, 'cleanup-grid-year-meta-2019'), '7 years ago · Braga · 2 photos');

    // r1: keep, favourite, trash. Then the rest of 2024 kept.
    for (var i = 0; i < 3; i++) {
      await tester.tap(tile('r1'));
    }
    await settle();
    expect(marked('r1', 'trash'), isTrue);
    await tap('cleanup-grid-keep-rest-2024');
    expect(marked('r2', 'keep'), isTrue);
    expect(find.byKey(const Key('cleanup-grid-year-reviewed-2024')), findsOneWidget);
    expect(server.served, hasLength(4), reason: 'marking sends nothing');

    // Back to the deck, on the first undecided photo: s1 up (favourite), s2 right (keep).
    await tap('cleanup-session-menu');
    await tap('cleanup-menu-swipe');
    expect(topCardId(tester), idOf('asset:s1'));
    expect(textOf(tester, 'cleanup-session-title'), 'Jun 21 · 3 of 4');
    await tester.fling(top, const Offset(0, -160), 1500);
    await settle();
    expect(topCardId(tester), idOf('asset:s2'));
    await tester.fling(top, const Offset(160, 0), 1500);
    await settle();

    // Every photo decided: the finish screen, then one commit with every mark from both views.
    expect(find.byKey(const Key('cleanup-finish')), findsOneWidget);
    expect(textOf(tester, 'cleanup-finish-kept'), '2');
    expect(textOf(tester, 'cleanup-finish-favorites'), '1');
    expect(textOf(tester, 'cleanup-finish-trash'), '1');
    await tap('cleanup-finish-day');
    await settle();
    expect(server.served.skip(4), ['113-in-spaces-r1', '114-commit-finish-621', '115-calendar-after-621']);
    expect(textOf(tester, 'cleanup-day-done-title'), 'June 21 cleaned up');

    expect(server.unmatched, isEmpty);
    expect(server.served.toSet(), _script);
    expect(server.served, hasLength(_script.length));

    // Take the screens down, then let the HTTP client's idle timers and the toasts run out.
    await tester.pumpWidget(const SizedBox.shrink());
    client.client.close();
    await tester.pump(const Duration(seconds: 16));
  });
}
