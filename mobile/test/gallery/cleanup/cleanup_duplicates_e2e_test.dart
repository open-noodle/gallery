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

// Slice 7 end to end for Duplicates (specs/2026-10-29-mobile-library-cleanup-design.md, "Slice 7"): the real queue
// page, series deck and finish screen over upstream's duplicates API in the generated client, against the strict
// contract server (fixtures 310–314, e2e/src/specs/server/api/gallery-cleanup-contract.e2e-spec.ts).
//
// Given three duplicate groups: a (a2 the largest file, a1 the highest resolution), b (b2 the largest, b3 the highest
//   resolution) and c, each with the server's suggested copy to keep
// When a is swiped right on the suggestion; b's suggested copy is flipped to trash, so every copy would go, and the
//   user tries to apply it (the button, a swipe right); then b3's thumbnail is tapped to keep it and b applied; c is
//   switched to "Not duplicates" and swiped right; the marks applied once
// Then the button says "Keep at least one copy" and is disabled, the swipe resists, and nothing is sent; Apply sends one
//   lookup,
//   one resolve with both accepted groups' keep and trash ids, and one dismiss of c; the toast says the copies come back
//   but not the groups, and its Undo restores exactly the trashed copies.

final ids = cleanupContractIds();
String idOf(String label) => ids[label] ?? (throw StateError('no fixture names $label'));

void main() {
  setUpAll(initOverviewStore);

  testWidgets('accept on the suggestion, flip and accept another, dismiss a third, apply; never trash every copy', (
    tester,
  ) async {
    const script = {
      '310-duplicates-list',
      '311-duplicates-in-spaces',
      '312-duplicates-resolve',
      '313-duplicates-dismiss',
      '314-duplicates-restore',
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
    await pumpQueue(tester, container, queue: LibraryCleanupQueue.duplicates, requests: () => server.requests.length);
    Future<void> settle() => settleCleanup(tester, requests: () => server.requests.length);
    Future<void> tap(String key) async {
      await tester.tap(find.byKey(Key(key)));
      await settle();
    }

    Finder inCard(String group, String key) =>
        find.descendant(of: find.byKey(Key('cleanup-series-card-${idOf(group)}')), matching: find.byKey(Key(key)));
    String cardText(String group, String key) {
      final widget = tester.widget<Text>(inCard(group, key));
      return widget.data ?? widget.textSpan!.toPlainText();
    }

    expect(server.served, ['310-duplicates-list'], reason: 'the list only: its total is what loaded');
    expect(textOf(tester, 'cleanup-session-title'), 'Duplicates · 1 of 3');

    // a: the suggested copy (the largest file) kept; each copy shows its resolution and size.
    const a = 'duplicate:a';
    expect(topCardId(tester), idOf(a));
    expect(inCard(a, 'cleanup-series-mark-${idOf('asset:dup-a2')}-keep'), findsOneWidget);
    expect(inCard(a, 'cleanup-series-mark-${idOf('asset:dup-a1')}-trash'), findsOneWidget);
    expect(cardText(a, 'cleanup-series-res-${idOf('asset:dup-a1')}'), '4000×3000');
    expect(cardText(a, 'cleanup-series-size-${idOf('asset:dup-a2')}'), formatBytes(6000));
    expect(inCard(a, 'cleanup-series-sharpest-${idOf('asset:dup-a1')}'), findsOneWidget);
    expect(inCard(a, 'cleanup-series-largest-${idOf('asset:dup-a2')}'), findsOneWidget);
    expect(cardText(a, 'cleanup-series-header'), startsWith('2 copies · Oct 1, 2023'));
    await tester.fling(inCard(a, 'cleanup-series-header'), const Offset(300, 0), 1500);
    await settle();

    // b: flip the suggested copy to trash, so every copy would go.
    const b = 'duplicate:b';
    expect(topCardId(tester), idOf(b));
    expect(inCard(b, 'cleanup-series-shown-${idOf('asset:dup-b2')}'), findsOneWidget);
    await tap('cleanup-series-frame-${idOf(b)}');
    expect(textOf(tester, 'cleanup-series-apply-label'), 'Keep at least one copy');
    final apply = tester.widget<FilledButton>(find.byKey(const Key('cleanup-series-apply')));
    expect(apply.onPressed, isNull, reason: 'the button is disabled while every copy is marked for trash');
    await tester.fling(inCard(b, 'cleanup-series-header'), const Offset(300, 0), 1500);
    await settle();
    expect(topCardId(tester), idOf(b), reason: 'the card resists a swipe right');
    expect(inCard(b, 'cleanup-series-keep-one'), findsOneWidget, reason: 'and says why');
    expect(textOf(tester, 'cleanup-session-badge-count'), '1', reason: 'only a is decided');
    expect(server.served, hasLength(1), reason: 'nothing is sent');

    // Keep b3 instead (its thumbnail shows and flips it), then apply.
    await tap('cleanup-series-thumb-${idOf('asset:dup-b3')}');
    expect(textOf(tester, 'cleanup-series-apply-label'), 'Keep 1 · Trash 2');
    await tap('cleanup-series-apply');

    // c: "Not duplicates", applied with a swipe right.
    const c = 'duplicate:c';
    expect(topCardId(tester), idOf(c));
    await tap('cleanup-series-pick-instead');
    expect(textOf(tester, 'cleanup-series-apply-label'), 'Not duplicates');
    await tester.fling(inCard(c, 'cleanup-series-header'), const Offset(300, 0), 1500);
    await settle();
    expect(textOf(tester, 'cleanup-session-badge-count'), '3');
    expect(server.served, hasLength(1));

    await tap('cleanup-finish-apply');
    expect(server.served.skip(1), ['311-duplicates-in-spaces', '312-duplicates-resolve', '313-duplicates-dismiss']);
    expect(find.byKey(const Key('cleanup-queue-all-clear')), findsOneWidget);
    expect(find.text('3 copies moved to the trash. Undo restores the copies, not the groups.'), findsOneWidget);

    await tap('cleanup-toast-undo');
    await settle();
    expect(server.served.last, '314-duplicates-restore');
    expect(find.byKey(const Key('cleanup-queue-all-clear')), findsOneWidget, reason: 'the groups do not come back');

    expect(server.unmatched, isEmpty);
    expect(server.served.toSet(), script);
    expect(server.served, hasLength(script.length));
    await tester.pumpWidget(const SizedBox.shrink());
    client.client.close();
    await tester.pump(const Duration(seconds: 16));
  });
}
