import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/search/search.providers.dart';
import 'package:immich_mobile/gallery/search/search.repository.dart';
import 'package:immich_mobile/gallery/search/search_mode.provider.dart';
import 'package:immich_mobile/gallery/search/widgets/search_header.widget.dart';
import 'package:immich_mobile/presentation/widgets/images/thumbnail_tile.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.widget.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:openapi/api.dart';

import 'scoped_pages_harness.dart';
import 'search_contract_server.dart';
import 'search_mode_harness.dart';
import 'search_test_utils.dart';

// Slice 6 end-to-end (specs/2026-10-23-mobile-search-redesign-design.md, "Slice 6"): each real page (album, space, space
// album, personal person, space person) with its real TimelineRouteScope, timeline, search providers and widgets and
// the real generated OpenAPI client, against the strict contract server (test/fixtures/search_contract, recorded from
// the real server by e2e/src/specs/server/api/gallery-search-contract.e2e-spec.ts). Enter through the grouping pill,
// apply one filter through its sheet; every request must match a recorded fixture, and the total and the grid must be
// the recorded ones. The server's rejections are fixtures too (`options-reject-*`, with their real 400s), so a leaked
// `withSharedSpaces` or `spaceId` either matches nothing or is served a 400; both fail.

final contract = contractIds();

final pageIds = ScopedPageIds(
  albumId: contract['album:trip']!,
  albumName: 'Trip',
  spaceId: contract['space:family']!,
  spaceName: 'Family',
  spaceAlbumId: contract['album:space-trip']!,
  spaceAlbumName: 'Space trip',
  personId: contract['person:anna']!,
  personName: 'Anna',
  spacePersonId: contract['space-person:pia']!,
  spacePersonName: 'Pia',
);

class _Screen {
  final ScopedPage page;
  final String placeholder;

  /// The `scope-<screen>-*` options set search mode opens on.
  final String scope;

  /// The fixture of the unfiltered browse results.
  final String unfilteredBuckets;

  /// The chip and the sheet row of the one filter applied.
  final String chip;
  final String option;

  /// The `screen-*` fixture set of the filtered state, and the month its grid opens.
  final String step;
  final String month;

  const _Screen({
    required this.page,
    required this.placeholder,
    required this.scope,
    required this.unfilteredBuckets,
    required this.chip,
    required this.option,
    required this.step,
    required this.month,
  });
}

final _screens = [
  _Screen(
    page: ScopedPage.album,
    placeholder: 'Search in Trip',
    scope: 'scope-album',
    unfilteredBuckets: 'timeline-buckets-album',
    chip: 'people',
    option: 'search-sheet-person-${contract['person:ben']}',
    step: 'screen-album-ben',
    month: '2024-06-01',
  ),
  _Screen(
    page: ScopedPage.space,
    placeholder: 'Search in Family',
    scope: 'scope-space',
    unfilteredBuckets: 'timeline-buckets-space',
    chip: 'people',
    // A bare space-person id: the filterId the space's options carry.
    option: 'search-sheet-person-${contract['space-person:quinn']}',
    step: 'screen-space-quinn',
    month: '2023-08-01',
  ),
  const _Screen(
    page: ScopedPage.spaceAlbum,
    placeholder: 'Search in Space trip',
    scope: 'scope-space-album',
    unfilteredBuckets: 'screen-space-album-timeline-buckets',
    chip: 'places',
    option: 'search-place-city-Madrid',
    step: 'screen-space-album-madrid',
    month: '2023-07-01',
  ),
  _Screen(
    page: ScopedPage.personalPerson,
    placeholder: "Search Anna's photos",
    scope: 'scope-personal-person',
    unfilteredBuckets: 'screen-personal-person-timeline-buckets',
    chip: 'people',
    option: 'search-sheet-person-${contract['person:ben']}',
    step: 'screen-personal-person-ben',
    month: '2024-06-01',
  ),
  const _Screen(
    page: ScopedPage.spacePerson,
    placeholder: "Search Pia's photos",
    scope: 'scope-space-person',
    unfilteredBuckets: 'screen-space-person-timeline-buckets',
    chip: 'when',
    option: 'search-when-year-2024',
    step: 'screen-space-person-2024',
    month: '2024-06-01',
  ),
];

const _dimensions = ['availability', 'total', 'time', 'people', 'tags', 'places', 'cameras', 'ratings', 'mediaTypes'];

void main() {
  final database = SearchModeDatabase();

  setUpAll(database.setUpAll);
  tearDownAll(database.tearDownAll);

  for (final screen in _screens) {
    testWidgets('${screen.page.name}: the pill enters search mode, one filter, every request a recorded one', (
      tester,
    ) async {
      // Real sockets: the test binding's HTTP stand-in would answer every request with a 400.
      HttpOverrides.global = null;
      final server = (await tester.runAsync(
        () => SearchContractServer.start(include: (name) => !name.startsWith('older-') && !name.startsWith('stock-')),
      ))!;
      addTearDown(() => tester.runAsync(server.close));

      final client = ApiClient(basePath: server.endpoint);
      await database.setUp();
      final container = scopedPagesContainer(
        db: database.db,
        ids: pageIds,
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
        await revealPlaceCity(tester, key);
        await tester.ensureVisible(find.byKey(Key(key)));
        await tester.pump();
        await tester.tap(find.byKey(Key(key)));
        await sync();
      }

      String total() => tester.widget<Text>(find.byKey(const Key('search-mode-total'))).data!;
      int bucketSum(String fixture) => (contractResponseBody(fixture)! as List).fold<int>(
        0,
        (sum, bucket) => sum + ((bucket as Map)['count'] as int),
      );

      await pumpScopedPage(tester, container, scopedPage(screen.page, pageIds));
      await sync();
      expect(server.requests, isEmpty, reason: 'nothing is searched before search mode opens');

      // Enter through the pill: the screen's own scope, its exact total.
      await tap('timeline-pill-search');
      final route = routeContainer(tester);
      expect(route.read(searchModeProvider), isTrue);
      expect(container.read(searchModeProvider), isFalse);
      expect(find.byType(SearchHeader), findsOneWidget);
      expect(find.text(screen.placeholder), findsOneWidget);
      expect(server.served, containsAll([for (final d in _dimensions) '${screen.scope}-$d', screen.unfilteredBuckets]));
      final unfiltered = bucketSum(screen.unfilteredBuckets);
      expect(unfiltered, (contractResponseBody('${screen.scope}-total')! as Map)['total']);
      expect(total(), '$unfiltered ${unfiltered == 1 ? 'photo or video' : 'photos and videos'}');

      // One filter, through its sheet.
      await tap('search-chip-${screen.chip}');
      await tap(screen.option);
      await tap('search-sheet-show');

      final filtered = (contractResponseBody('${screen.step}-total')! as Map)['total'] as int;
      expect(bucketSum('${screen.step}-timeline-buckets'), filtered);
      expect(total(), '$filtered ${filtered == 1 ? 'match' : 'matches'}');
      expect(
        server.served,
        containsAll([
          for (final d in _dimensions) '${screen.step}-$d',
          '${screen.step}-timeline-buckets',
          '${screen.step}-timeline-bucket-${screen.month}',
        ]),
        reason: 'unmatched: ${server.unmatched}',
      );

      // The grid: exactly the recorded month's assets.
      final timeline = ProviderScope.containerOf(tester.element(find.byType(Timeline)));
      final service = timeline.read(timelineServiceProvider);
      expect(service.totalAssets, filtered);
      expect(find.byType(ThumbnailTile), findsNWidgets(filtered));
      final month = contractResponseBody('${screen.step}-timeline-bucket-${screen.month}')! as Map<String, dynamic>;
      expect(
        (await tester.runAsync(() => service.loadAssets(0, filtered)))!.map((a) => a.remoteId).toSet(),
        (month['id'] as List).toSet(),
      );

      // ← : the screen comes back, nothing filtered.
      await tap('search-mode-back');
      expect(route.read(searchModeProvider), isFalse);
      expect(route.read(searchStateProvider).isEmpty, isTrue);
      expect(find.byType(SearchHeader), findsNothing);

      expect(server.unmatched, isEmpty, reason: 'every request matched a recorded fixture');
      expect(server.served.where((name) => name.contains('reject')), isEmpty, reason: 'no rejected combination');

      await disposePhotosPage(tester, container);
      // The HTTP client's idle keep-alive timers run on the test's fake clock.
      client.client.close();
      await tester.pump(const Duration(seconds: 16));
    });
  }
}
