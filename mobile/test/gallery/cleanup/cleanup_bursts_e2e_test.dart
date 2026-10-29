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

// Slice 7 end to end for Bursts (specs/2026-10-29-mobile-library-cleanup-design.md, "Slice 7"): the real queue page,
// series deck and finish screen, the real providers and the generated OpenAPI client, against the strict contract
// server, which answers only what the real server was recorded answering (fixtures 300–305,
// e2e/src/specs/server/api/gallery-cleanup-contract.e2e-spec.ts). A request the recording does not have fails the test.
//
// Given three bursts: a (three camera frames, a2 the sharpest), b (three frames found by time and looks, b3 the
//   sharpest) and c (two camera frames, c1 the sharpest)
// When a is swiped right on its suggestion, b1's mark is flipped to keep and b accepted with Keep as set, c is stacked
//   instead, and the marks applied once
// Then the count and one page are asked; nothing else until Apply; then one lookup of the trashed frames, one commit
//   with every frame of a and b kept or trashed by its mark, and one stack of c with its suggested frame first; the
//   emptied queue says "All clear", and the toast's Undo restores exactly the trashed frames and brings a back with
//   its two restored frames.

final ids = cleanupContractIds();
String idOf(String label) => ids[label] ?? (throw StateError('no fixture names $label'));

void main() {
  setUpAll(initOverviewStore);

  testWidgets('accept one series as set, change a mark on another, stack a third, apply once, undo the trash', (
    tester,
  ) async {
    const script = {
      '300-bursts-count',
      '301-bursts-page-1',
      '302-bursts-in-spaces',
      '303-bursts-commit',
      '304-bursts-stack',
      '305-bursts-restore',
    };
    await setQueuePrefs();
    HttpOverrides.global = null;
    final server = (await tester.runAsync(() => CleanupContractServer.start(include: script.contains)))!;
    addTearDown(() => tester.runAsync(server.close));
    final client = ApiClient(basePath: server.endpoint);
    listenToPlatform(tester);
    final container = queueContainer(
      repository: LibraryCleanupRepository(
        cleanupApi: CleanupApi(client),
        trashApi: TrashApi(client),
        duplicatesApi: DuplicatesApi(client),
        stacksApi: StacksApi(client),
        timeZone: () async => 'Europe/Lisbon',
      ),
      directory: tempDirectory(),
    );
    await pumpQueue(tester, container, queue: LibraryCleanupQueue.bursts, requests: () => server.requests.length);
    Future<void> settle() => settleCleanup(tester, requests: () => server.requests.length);
    Future<void> tap(String key) async {
      await tester.tap(find.byKey(Key(key)));
      await settle();
    }

    Finder inCard(String series, String key) =>
        find.descendant(of: find.byKey(Key('cleanup-series-card-${idOf(series)}')), matching: find.byKey(Key(key)));
    String cardText(String series, String key) {
      final widget = tester.widget<Text>(inCard(series, key));
      return widget.data ?? widget.textSpan!.toPlainText();
    }

    expect(server.served.toSet(), {'300-bursts-count', '301-bursts-page-1'});
    expect(textOf(tester, 'cleanup-session-title'), 'Bursts & series · 1 of 3');

    // a: the sharpest frame shown first and kept, the other two marked for trash.
    const a = 'asset:burst-a1';
    expect(topCardId(tester), idOf(a));
    expect(inCard(a, 'cleanup-series-shown-${idOf('asset:burst-a2')}'), findsOneWidget);
    expect(inCard(a, 'cleanup-series-badge'), findsOneWidget);
    expect(cardText(a, 'cleanup-series-chip'), 'Keep 1, trash 2 (${formatBytes(3100 + 3102)})');
    expect(cardText(a, 'cleanup-series-header'), startsWith('3 photos in 2 s · Sep 1, 2023'));
    // Swiped right from the header, outside the big frame: accepted as set.
    await tester.fling(inCard(a, 'cleanup-series-header'), const Offset(300, 0), 1500);
    await settle();

    // b: show b1, then flip it to keep; accept with the button.
    const b = 'asset:burst-b1';
    expect(topCardId(tester), idOf(b));
    await tap('cleanup-series-thumb-${idOf('asset:burst-b1')}');
    expect(inCard(b, 'cleanup-series-shown-${idOf('asset:burst-b1')}'), findsOneWidget);
    await tap('cleanup-series-frame-${idOf(b)}');
    expect(inCard(b, 'cleanup-series-mark-${idOf('asset:burst-b1')}-keep'), findsOneWidget);
    expect(cardText(b, 'cleanup-series-chip'), 'Keep 2, trash 1 (${formatBytes(3201)})');
    await tap('cleanup-series-as-set');

    // c: stacked instead.
    expect(topCardId(tester), idOf('asset:burst-c1'));
    await tap('cleanup-series-stack');
    expect(textOf(tester, 'cleanup-session-badge-count'), '3');
    expect(server.served, hasLength(2), reason: 'deciding sends nothing');

    // Every series decided: the finish screen, then one Apply.
    expect(find.byKey(const Key('cleanup-finish-apply')), findsOneWidget);
    await tap('cleanup-finish-apply');
    expect(server.served.skip(2), ['302-bursts-in-spaces', '303-bursts-commit', '304-bursts-stack']);
    expect(find.byKey(const Key('cleanup-queue-all-clear')), findsOneWidget);
    expect(find.text('Trashed 3 assets'), findsOneWidget);

    await tap('cleanup-toast-undo');
    await settle();
    expect(server.served.last, '305-bursts-restore');
    // a comes back with the two frames that were trashed; a2 stays kept, b2 alone is no series.
    expect(topCardId(tester), idOf(a));
    expect(inCard(a, 'cleanup-series-thumb-${idOf('asset:burst-a1')}'), findsOneWidget);
    expect(inCard(a, 'cleanup-series-thumb-${idOf('asset:burst-a3')}'), findsOneWidget);
    expect(inCard(a, 'cleanup-series-thumb-${idOf('asset:burst-a2')}'), findsNothing);

    expect(server.unmatched, isEmpty);
    expect(server.served.toSet(), script);
    expect(server.served, hasLength(script.length));
    await tester.pumpWidget(const SizedBox.shrink());
    client.client.close();
    await tester.pump(const Duration(seconds: 16));
  });
}
