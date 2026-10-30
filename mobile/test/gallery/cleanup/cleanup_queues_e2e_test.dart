import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_queue.dart';
import 'package:immich_mobile/gallery/cleanup/repositories/library_cleanup.repository.dart';
import 'package:immich_mobile/utils/bytes_units.dart';
import 'package:openapi/api.dart';

import 'cleanup_contract_server.dart';
import 'cleanup_overview_harness.dart';
import 'cleanup_queue_harness.dart';
import 'cleanup_test_utils.dart';
import 'rewind_harness.dart';

// Slice 6 end to end (specs/2026-10-29-mobile-library-cleanup-design.md, "Slice 6"): the real queue page, deck, grid,
// filters sheet and finish screen, with the real providers and the generated OpenAPI client, against the strict
// contract server, which answers only what the real server was recorded answering (fixtures 200–233,
// e2e/src/specs/server/api/gallery-cleanup-contract.e2e-spec.ts). A request the recording does not have (a filter sent
// differently, a lost cursor, a favourite sent as a keep, a completeMonthDay) fails the test.
//
// Blurry       Given the default filters   When blurry-15 is kept, the filter changed to blurry only, blurry-14
//              favourited, blurry-13 swiped to trash, blurry-12 trashed with the button and that undone, and the marks
//              applied   Then the count and pages with each filter set, paging on with the cursor, one lookup, one commit
//              with the keep made before the change; back home, and the toast's Undo restores blurry-13
// Screenshots  When three screenshots are selected in the grid (a tap, then a drag across two) and trashed, and
//              applied   Then one lookup and one commit of the three
// Space hogs   When the filter is set to every type from 50 MiB   Then the count and page ask exactly that

final ids = cleanupContractIds();
String idOf(String label) => ids[label] ?? (throw StateError('no fixture names $label'));

void main() {
  setUpAll(initOverviewStore);

  Future<(CleanupContractServer, ApiClient, QueueTestRouter)> start(
    WidgetTester tester,
    Set<String> script,
    LibraryCleanupQueue queue,
  ) async {
    await setQueuePrefs();
    // Real sockets: the test binding's HTTP stand-in would answer every request with a 400.
    HttpOverrides.global = null;
    final server = (await tester.runAsync(() => CleanupContractServer.start(include: script.contains)))!;
    addTearDown(() => tester.runAsync(server.close));
    final client = ApiClient(basePath: server.endpoint);
    listenToPlatform(tester);
    final container = queueContainer(
      repository: LibraryCleanupRepository(
        cleanupApi: CleanupApi(client),
        trashApi: TrashApi(client),
        timeZone: () async => 'Europe/Lisbon',
      ),
      directory: tempDirectory(),
    );
    final router = await pumpQueue(tester, container, queue: queue, requests: () => server.requests.length);
    await settleCleanup(tester, requests: () => server.requests.length);
    return (server, client, router);
  }

  Future<void> finish(WidgetTester tester, CleanupContractServer server, ApiClient client, Set<String> script) async {
    expect(server.unmatched, isEmpty);
    expect(server.served.toSet(), script);
    expect(server.served, hasLength(script.length));
    // Take the screens down, then let the HTTP client's idle timers and the toasts run out.
    await tester.pumpWidget(const SizedBox.shrink());
    client.client.close();
    await tester.pump(const Duration(seconds: 16));
  }

  testWidgets('Blurry: filter, page on, mark three ways, undo one, apply, then undo the trash', (tester) async {
    const script = {
      '200-queues-blurry-count',
      '201-queues-blurry-page-1',
      '202-queues-blurry-page-2',
      '203-queues-blurry-page-3',
      '204-queues-blurry-reason-count',
      '205-queues-blurry-reason-page-1',
      '206-queues-blurry-reason-page-2',
      '207-queues-blurry-reason-page-3',
      '208-queues-blurry-reason-page-4',
      '209-queues-in-spaces-blurry',
      '210-queues-commit-blurry',
      '211-queues-restore-blurry',
    };
    final (server, client, _) = await start(tester, script, LibraryCleanupQueue.blurry);
    Future<void> settle() => settleCleanup(tester, requests: () => server.requests.length);
    Future<void> tap(String key) async {
      await tester.tap(find.byKey(Key(key)));
      await settle();
    }

    final top = find.byKey(const Key('cleanup-deck-top'));
    Future<void> fling(Offset offset) async {
      await tester.fling(top, offset, 1500);
      await settle();
    }

    // The count and three pages: 12 cards, more than ten.
    expect(server.served.toSet(), {
      '200-queues-blurry-count',
      '201-queues-blurry-page-1',
      '202-queues-blurry-page-2',
      '203-queues-blurry-page-3',
    });
    expect(textOf(tester, 'cleanup-session-title'), 'Blurry & botched · 1 of 16');
    expect(topCardId(tester), idOf('asset:blurry-15'));
    expect(find.byKey(Key('cleanup-card-reason-${idOf('asset:blurry-15')}')), findsOneWidget);

    await fling(const Offset(160, 0));
    expect(topCardId(tester), idOf('asset:blurry-14'));

    // Blurry only: counted and paged again from the start, the keep still pending.
    await tap('cleanup-session-menu');
    await tap('cleanup-menu-filters');
    await tap('cleanup-filter-reason-blurry');
    await tap('cleanup-filters-done');
    expect(server.served.skip(4).toSet(), {
      '204-queues-blurry-reason-count',
      '205-queues-blurry-reason-page-1',
      '206-queues-blurry-reason-page-2',
      '207-queues-blurry-reason-page-3',
    });
    expect(textOf(tester, 'cleanup-session-badge-count'), '1');
    expect(textOf(tester, 'cleanup-session-title'), 'Blurry & botched · 2 of 13');
    expect(topCardId(tester), idOf('asset:blurry-14'));

    // Up favourites; ten cards remain, so the last page comes.
    await fling(const Offset(0, -160));
    expect(server.served.last, '208-queues-blurry-reason-page-4');
    await fling(const Offset(-160, 0));
    await tap('cleanup-deck-trash');
    expect(topCardId(tester), idOf('asset:blurry-01'), reason: 'the older blurry photos follow, newest first');
    await tap('cleanup-deck-undo');
    expect(topCardId(tester), idOf('asset:blurry-12'));
    expect(textOf(tester, 'cleanup-session-badge-count'), '3');
    expect(server.served, hasLength(9), reason: 'marking sends nothing');

    await tap('cleanup-session-done');
    await tap('cleanup-finish-apply');
    expect(server.served.skip(9), ['209-queues-in-spaces-blurry', '210-queues-commit-blurry']);
    expect(find.byKey(const Key('test-home')), findsOneWidget);
    expect(find.text('Trashed 1 asset'), findsOneWidget);

    await tap('cleanup-toast-undo');
    await settle();
    expect(server.served.last, '211-queues-restore-blurry');

    await finish(tester, server, client, script);
  });

  testWidgets('Screenshots: select three in the grid, mark them for trash, apply', (tester) async {
    const script = {
      '220-queues-screenshots-count',
      '221-queues-screenshots-page-1',
      '222-queues-in-spaces-screenshots',
      '223-queues-commit-screenshots',
    };
    final (server, client, _) = await start(tester, script, LibraryCleanupQueue.screenshots);
    Future<void> settle() => settleCleanup(tester, requests: () => server.requests.length);
    Future<void> tap(String key) async {
      await tester.tap(find.byKey(Key(key)));
      await settle();
    }

    Finder tile(String label) => find.byKey(Key('cleanup-grid-tile-${idOf('asset:$label')}'));

    expect(textOf(tester, 'cleanup-session-title'), 'Screenshots · 1 of 4');
    await tap('cleanup-view-grid');
    await tester.tap(tile('shot-1'));
    await settle();
    final from = tester.getCenter(tile('shot-2'));
    await tester.dragFrom(from, tester.getCenter(tile('shot-3')) - from);
    await settle();
    expect(textOf(tester, 'cleanup-grid-selected-count'), '3 selected');
    expect(textOf(tester, 'cleanup-grid-selected-size'), formatBytes(6000));

    await tap('cleanup-grid-trash');
    expect(textOf(tester, 'cleanup-session-badge-count'), '3');
    expect(server.served, hasLength(2), reason: 'marking sends nothing');

    await tap('cleanup-session-done');
    await tap('cleanup-finish-apply');
    expect(server.served.skip(2), ['222-queues-in-spaces-screenshots', '223-queues-commit-screenshots']);
    expect(find.byKey(const Key('test-home')), findsOneWidget, reason: 'shot-4 is left, so back where it was opened');

    await finish(tester, server, client, script);
  });

  testWidgets('Space hogs: the size on the card, and the type and minimum size filters', (tester) async {
    const script = {
      '230-queues-space-hogs-count',
      '231-queues-space-hogs-page-1',
      '232-queues-space-hogs-all-count',
      '233-queues-space-hogs-all-page-1',
    };
    final (server, client, _) = await start(tester, script, LibraryCleanupQueue.spaceHogs);
    Future<void> settle() => settleCleanup(tester, requests: () => server.requests.length);
    Future<void> tap(String key) async {
      await tester.tap(find.byKey(Key(key)));
      await settle();
    }

    expect(textOf(tester, 'cleanup-session-title'), 'Space hogs · 1 of 2');
    final hog = idOf('asset:hog-1');
    expect(topCardId(tester), hog);
    expect(textOf(tester, 'cleanup-card-size-$hog'), formatBytes(314572800));

    await tap('cleanup-session-menu');
    await tap('cleanup-menu-filters');
    await tap('cleanup-filter-type-all');
    await tap('cleanup-filter-min-size-52428800');
    await tap('cleanup-filters-done');
    expect(textOf(tester, 'cleanup-session-title'), 'Space hogs · 1 of 3');

    await tap('cleanup-session-back');
    expect(find.byKey(const Key('test-home')), findsOneWidget);
    await finish(tester, server, client, script);
  });
}
