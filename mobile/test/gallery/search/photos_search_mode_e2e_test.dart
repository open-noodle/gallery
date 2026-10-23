import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/search/search.providers.dart';
import 'package:immich_mobile/gallery/search/search.repository.dart';
import 'package:immich_mobile/gallery/search/search_mode.provider.dart';
import 'package:immich_mobile/gallery/search/search_timeline.dart';
import 'package:immich_mobile/gallery/search/widgets/search_header.widget.dart';
import 'package:immich_mobile/presentation/widgets/images/thumbnail_tile.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.widget.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:openapi/api.dart';

import 'search_contract_server.dart';
import 'search_mode_harness.dart';
import 'search_test_utils.dart';

// Slice 3 end-to-end (specs/2026-10-23-mobile-search-redesign-design.md, "Slice 3"): the real Photos page, with its
// real timeline, search providers and widgets and the real generated OpenAPI client, against the strict contract server
// (test/fixtures/search_contract, recorded from the real server by e2e/src/specs/server/api/
// gallery-search-contract.e2e-spec.ts). Enter search mode, pick `@a` → Anna, When → 2024, Places → Kyoto; the total
// and the grid must be the recorded ones; ← brings the timeline back where it was. Any request no fixture matches fails.

final ids = contractIds();

void main() {
  final database = SearchModeDatabase();

  setUpAll(database.setUpAll);
  tearDownAll(database.tearDownAll);

  testWidgets('Photos search mode: @a → Anna, When → 2024, Places → Kyoto, then back', (tester) async {
    // Real sockets: the test binding's HTTP stand-in would answer every request with a 400.
    HttpOverrides.global = null;
    final server = (await tester.runAsync(
      () => SearchContractServer.start(include: (name) => !name.startsWith('older-') && !name.startsWith('stock-')),
    ))!;
    addTearDown(() => tester.runAsync(server.close));

    final client = ApiClient(basePath: server.endpoint);
    await database.setUp(timelineAssets: 200);
    final container = searchModeContainer(
      db: database.db,
      repository: GallerySearchRepository(
        searchApi: SearchApi(client),
        timelineApi: TimelineApi(client),
        serverApi: ServerApi(client),
      ),
      realDebounce: true,
    );

    /// Fake time for timers and frames, real time for the sockets, until the server has been quiet for a while.
    Future<void> sync() async {
      var quiet = 0;
      var seen = server.requests.length;
      while (quiet < 6) {
        await tester.pump(const Duration(milliseconds: 100));
        await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 30)));
        if (server.requests.length == seen) {
          quiet++;
        } else {
          quiet = 0;
          seen = server.requests.length;
        }
      }
    }

    Future<void> tap(String key) async {
      await tester.ensureVisible(find.byKey(Key(key)));
      await tester.pump();
      await tester.tap(find.byKey(Key(key)));
      await sync();
    }

    String total() => tester.widget<Text>(find.byKey(const Key('search-mode-total'))).data!;
    int bodyTotal(String fixture) => (contractResponseBody(fixture)! as Map<String, dynamic>)['total'] as int;

    await pumpPhotosPage(tester, container);
    await sync();
    // The preview warms the unfiltered Photos cache when the tab first shows.
    expect(server.served, containsAll(['server-version', 'server-features', 'dimension-photos-availability']));

    final scroll = timelineController(tester)..jumpTo(1500);
    await sync();

    // Enter: whole timeline, its exact total (the unfiltered bucket sum).
    container.read(searchModeProvider.notifier).enter();
    await sync();
    expect(find.byType(SearchHeader), findsOneWidget);
    final unfiltered = (contractResponseBody('timeline-buckets-photos')! as List).fold<int>(
      0,
      (sum, bucket) => sum + ((bucket as Map)['count'] as int),
    );
    expect(total(), '$unfiltered photos and videos');

    // `@a` → Anna.
    await tester.tap(find.byKey(const Key('search-mode-field')));
    await tester.pump();
    await tester.enterText(find.byKey(const Key('search-mode-field')), '@a');
    await sync();
    await tap('search-suggestion-person-person:${ids['person:anna']}');
    expect(total(), '${bodyTotal('mode-photos-anna-total')} matches');

    // When → 2024.
    await tap('search-chip-when');
    await tap('search-when-year-2024');
    await tap('search-sheet-show');
    expect(total(), '${bodyTotal('mode-photos-anna-2024-total')} matches');

    // Places → Kyoto.
    await tap('search-chip-places');
    await tap('search-place-city-Kyoto');
    expect(find.text('Show 2 photos'), findsOneWidget);
    await tap('search-sheet-show');

    final finalTotal = bodyTotal('mode-photos-anna-2024-kyoto-total');
    expect(finalTotal, 2);
    expect(total(), '$finalTotal matches');
    final buckets = contractResponseBody('mode-photos-anna-2024-kyoto-timeline-buckets')! as List;
    expect(buckets.fold<int>(0, (sum, bucket) => sum + ((bucket as Map)['count'] as int)), finalTotal);

    // The grid: exactly the recorded month's assets.
    final timeline = ProviderScope.containerOf(tester.element(find.byType(Timeline)));
    final service = timeline.read(timelineServiceProvider);
    expect(service.totalAssets, finalTotal);
    expect(find.byType(ThumbnailTile), findsNWidgets(finalTotal));
    final month =
        contractResponseBody('mode-photos-anna-2024-kyoto-timeline-bucket-2024-06-01')! as Map<String, dynamic>;
    expect(
      (await tester.runAsync(() => service.loadAssets(0, finalTotal)))!.map((a) => a.remoteId).toSet(),
      (month['id'] as List).toSet(),
    );

    // ← : the timeline comes back where it was, every filter gone.
    await tap('search-mode-back');
    expect(container.read(searchModeProvider), isFalse);
    expect(container.read(searchStateProvider).isEmpty, isTrue);
    expect(find.byType(SearchHeader), findsNothing);
    expect(container.read(searchTimelineFeedProvider), isNull);
    expect(scroll.offset, 1500);

    expect(server.unmatched, isEmpty, reason: 'every request matched a recorded fixture');
    expect(server.served, containsAll(['mode-photos-anna-2024-kyoto-timeline-bucket-2024-06-01']));

    await disposePhotosPage(tester, container);
    // The HTTP client's idle keep-alive timers run on the test's fake clock.
    client.client.close();
    await tester.pump(const Duration(seconds: 16));
  });
}
