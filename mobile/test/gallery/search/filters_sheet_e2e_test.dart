import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/search/search.providers.dart';
import 'package:immich_mobile/gallery/search/search.repository.dart';
import 'package:immich_mobile/gallery/search/search_mode.provider.dart';
import 'package:immich_mobile/gallery/search/search_state.model.dart';
import 'package:immich_mobile/presentation/widgets/images/thumbnail_tile.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.widget.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:openapi/api.dart';

import 'search_contract_server.dart';
import 'search_mode_harness.dart';
import 'search_test_utils.dart';

// Slice 4 end-to-end (specs/2026-10-23-mobile-search-redesign-design.md, "Slice 4"): the real Photos page with the
// preview on, its real timeline, search providers and widgets and the real generated OpenAPI client, against the strict
// contract server (test/fixtures/search_contract, recorded from the real server by e2e/src/specs/server/api/
// gallery-search-contract.e2e-spec.ts, `mode-filters-*`). Open ⚙ Filters; turn on Favorites, set rating 3, pick a
// camera model, enter in-photo text. Every request must match a recorded fixture and every total the recorded one.
// With the options reporting a single rating and only photos, all five stars and all three media options still show.

void main() {
  final database = SearchModeDatabase();

  setUpAll(database.setUpAll);
  tearDownAll(database.tearDownAll);

  testWidgets('Photos Filters sheet: Favorites, rating 3, a camera model, in-photo text', (tester) async {
    // Real sockets: the test binding's HTTP stand-in would answer every request with a 400.
    HttpOverrides.global = null;
    final server = (await tester.runAsync(
      () => SearchContractServer.start(include: (name) => !name.startsWith('older-') && !name.startsWith('stock-')),
    ))!;
    addTearDown(() => tester.runAsync(server.close));

    final client = ApiClient(basePath: server.endpoint);
    await database.setUp(timelineAssets: 20);
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
    int bodyTotal(String step) =>
        (contractResponseBody('mode-filters-$step-total')! as Map<String, dynamic>)['total'] as int;
    String matches(int count) => count == 1 ? '1 match' : '$count matches';
    String show(int count) => count == 1 ? 'Show 1 photo' : 'Show $count photos';

    await pumpPhotosPage(tester, container);
    await sync();
    container.read(searchModeProvider.notifier).enter();
    await sync();

    // ⚙ Filters, then Favorites only.
    await tap('search-chip-filters');
    expect(find.byKey(const Key('search-filter-section-favorites')), findsOneWidget);
    await tap('search-filter-favorites');
    expect(find.text(show(bodyTotal('favorites'))), findsOneWidget);
    expect(total(), matches(bodyTotal('favorites')));

    // Rating: at least 3.
    await tap('search-filter-star-3');
    final ratingStep = bodyTotal('favorites-rating');
    expect(find.text(show(ratingStep)), findsOneWidget);

    // The options now report one rating and photos only; still all five stars and all three media options, none
    // greyed.
    final ratings = (contractResponseBody('mode-filters-favorites-rating-ratings')! as Map)['ratings'] as List;
    final mediaTypes = (contractResponseBody('mode-filters-favorites-rating-mediaTypes')! as Map)['mediaTypes'] as List;
    expect(ratings, hasLength(1));
    expect(mediaTypes.map((m) => (m as Map)['type']), ['IMAGE']);
    expect(container.read(searchOptionsProvider).ratings!.map((r) => r.rating), [(ratings.single as Map)['rating']]);
    for (var star = 1; star <= 5; star++) {
      expect(find.byKey(Key('search-filter-star-$star')), findsOneWidget, reason: 'star $star');
    }
    for (final option in ['all', 'image', 'video']) {
      expect(find.byKey(Key('search-filter-media-$option')), findsOneWidget, reason: option);
    }
    final mediaSection = find.byKey(const Key('search-filter-section-mediaType'));
    expect(
      tester.widget<Opacity>(find.descendant(of: mediaSection, matching: find.byType(Opacity)).first).opacity,
      1,
      reason: 'Videos is not greyed',
    );

    // Camera: Apple opens its models at once; pick the iPhone 15.
    final before = server.requests.length;
    await tap('search-filter-make-Apple');
    expect(server.requests.length, before, reason: 'the models come from options already loaded');
    await tap('search-filter-model-Apple-iPhone 15');
    expect(container.read(searchStateProvider).filters.camera, const SearchCamera(make: 'Apple', model: 'iPhone 15'));
    expect(find.text(show(bodyTotal('favorites-rating-camera'))), findsOneWidget);

    // Text: in the photo.
    await tester.ensureVisible(find.byKey(const Key('search-filter-text-ocr')));
    await tester.pump();
    await tester.tap(find.byKey(const Key('search-filter-text-ocr')));
    await tester.pump();
    await tester.enterText(find.byKey(const Key('search-filter-text-ocr')), 'receipt');
    await sync();
    final finalTotal = bodyTotal('favorites-rating-camera-text');
    expect(find.text(show(finalTotal)), findsOneWidget);
    await tap('search-sheet-show');

    expect(total(), matches(finalTotal));
    expect(
      find.descendant(of: find.byKey(const Key('search-chip-filters-badge')), matching: find.text('4')),
      findsOneWidget,
    );
    for (final extra in ['favorites', 'rating', 'camera', 'text']) {
      expect(find.byKey(Key('search-extra-chip-$extra')), findsOneWidget, reason: extra);
    }

    // The grid: exactly the recorded month's assets.
    final buckets = contractResponseBody('mode-filters-favorites-rating-camera-text-timeline-buckets')! as List;
    expect(buckets.fold<int>(0, (sum, bucket) => sum + ((bucket as Map)['count'] as int)), finalTotal);
    final timeline = ProviderScope.containerOf(tester.element(find.byType(Timeline)));
    final service = timeline.read(timelineServiceProvider);
    expect(service.totalAssets, finalTotal);
    expect(find.byType(ThumbnailTile), findsNWidgets(finalTotal));
    final month =
        contractResponseBody('mode-filters-favorites-rating-camera-text-timeline-bucket-2023-09-01')!
            as Map<String, dynamic>;
    expect(
      (await tester.runAsync(() => service.loadAssets(0, finalTotal)))!.map((a) => a.remoteId).toSet(),
      (month['id'] as List).toSet(),
    );

    expect(server.unmatched, isEmpty, reason: 'every request matched a recorded fixture');
    expect(
      server.served,
      containsAll([
        'mode-filters-favorites-total',
        'mode-filters-favorites-rating-ratings',
        'mode-filters-favorites-rating-camera-timeline-buckets',
        'mode-filters-favorites-rating-camera-text-timeline-bucket-2023-09-01',
      ]),
    );

    await tap('search-mode-back');
    await disposePhotosPage(tester, container);
    // The HTTP client's idle keep-alive timers run on the test's fake clock.
    client.client.close();
    await tester.pump(const Duration(seconds: 16));
  });
}
