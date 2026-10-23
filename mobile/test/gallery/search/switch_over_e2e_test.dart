import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/user.model.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/domain/services/user.service.dart';
import 'package:immich_mobile/gallery/search/search.providers.dart';
import 'package:immich_mobile/gallery/search/search.repository.dart';
import 'package:immich_mobile/gallery/search/search_mode.provider.dart';
import 'package:immich_mobile/gallery/search/search_state.model.dart';
import 'package:immich_mobile/gallery/search/widgets/search_header.widget.dart';
import 'package:immich_mobile/presentation/pages/dev/main_timeline.page.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.widget.dart';
import 'package:immich_mobile/providers/gallery_nav/gallery_search_action.dart';
import 'package:immich_mobile/providers/gallery_nav/gallery_tab_enum.dart';
import 'package:immich_mobile/providers/haptic_feedback.provider.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/infrastructure/user.provider.dart' as infra;
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

import '../../test_helpers/fake_tabs_router.dart';
import '../../test_utils.dart';
import 'search_contract_server.dart';
import 'search_mode_harness.dart';
import 'search_test_utils.dart';
import 'switch_over_harness.dart';

// Slice 5 end-to-end (specs/2026-10-23-mobile-search-redesign-design.md, "Slice 5"): the real Photos page, the real
// asset viewer, the real search providers and the real generated OpenAPI client, against the strict contract server
// (test/fixtures/search_contract, recorded from the real server by e2e/src/specs/server/api/
// gallery-search-contract.e2e-spec.ts). There is no preview switch: the search button opens search mode; Similar photos
// from the viewer opens it on the reference photo with the recorded results; View in timeline from a result leaves it.
// Against a stock Immich server, search mode opens without facet chips and its results load. Any request no fixture
// matches fails.

final ids = contractIds();

class _MockUserService extends Mock implements UserService {}

class _Me extends CurrentUserProvider {
  _Me(super.service, UserDto user) {
    state = user;
  }
}

class _NoHaptic extends HapticNotifier {
  _NoHaptic(super.ref);

  @override
  dynamic selectionClick() => null;
}

void main() {
  final database = SearchModeDatabase();

  setUpAll(database.setUpAll);
  tearDownAll(database.tearDownAll);

  /// The seeded `me`, so the results' owner is the viewer's user (View in timeline is offered for your own photos).
  List<Override> asMe() {
    final me = UserDto(id: ids['user:me']!, email: 'me@example.com', name: 'Me', profileChangedAt: DateTime(2024));
    final users = _MockUserService();
    when(() => users.tryGetMyUser()).thenReturn(me);
    when(() => users.watchMyUser()).thenAnswer((_) => const Stream.empty());
    return [
      infra.userServiceProvider.overrideWithValue(users),
      currentUserProvider.overrideWith((ref) => _Me(users, me)),
      hapticFeedbackProvider.overrideWith((ref) => _NoHaptic(ref)),
    ];
  }

  Future<(SearchContractServer, ApiClient)> start(WidgetTester tester, bool Function(String name) include) async {
    // Real sockets: the test binding's HTTP stand-in would answer every request with a 400.
    HttpOverrides.global = null;
    final server = (await tester.runAsync(() => SearchContractServer.start(include: include)))!;
    addTearDown(() => tester.runAsync(server.close));
    return (server, ApiClient(basePath: server.endpoint));
  }

  GallerySearchRepository repositoryFor(ApiClient client) => GallerySearchRepository(
    searchApi: SearchApi(client),
    timelineApi: TimelineApi(client),
    serverApi: ServerApi(client),
    assetsApi: AssetsApi(client),
  );

  /// Fake time for timers and frames, real time for the sockets, until the server has been quiet for a while.
  Future<void> sync(WidgetTester tester, SearchContractServer server) async {
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

  TimelineService photosTimeline(WidgetTester tester) =>
      ProviderScope.containerOf(tester.element(find.byType(Timeline))).read(timelineServiceProvider);

  String total(WidgetTester tester) => tester.widget<Text>(find.byKey(const Key('search-mode-total'))).data!;

  Future<void> close(WidgetTester tester, ProviderContainer container, ApiClient client) async {
    await disposePhotosPage(tester, container);
    // The HTTP client's idle keep-alive timers run on the test's fake clock.
    client.client.close();
    await tester.pump(const Duration(seconds: 16));
  }

  testWidgets('no preview switch: the search button opens search mode; Similar photos from the viewer opens it on the '
      'reference photo with the recorded results; View in timeline from a result leaves it', (tester) async {
    final (server, client) = await start(tester, (name) => !name.startsWith('older-') && !name.startsWith('stock-'));
    await database.setUp(timelineAssets: 30);
    final container = searchModeContainer(
      db: database.db,
      repository: repositoryFor(client),
      realDebounce: true,
      extra: asMe(),
    );
    final router = SwitchOverRouter();
    await pumpPhotosWithRouter(tester, container, router);
    await sync(tester, server);

    // The search button (GallerySearchBlob → openGallerySearch), already on Photos.
    await openGallerySearch(FakeTabsRouter(initialIndex: kGalleryPhotosIndex), container.read);
    await sync(tester, server);
    expect(find.byType(SearchHeader), findsOneWidget);
    final unfiltered = (contractResponseBody('timeline-buckets-photos')! as List).fold<int>(
      0,
      (sum, bucket) => sum + ((bucket as Map)['count'] as int),
    );
    expect(total(tester), '$unfiltered photos and videos');
    await tester.tap(find.byKey(const Key('search-mode-back')));
    await sync(tester, server);
    expect(container.read(searchModeProvider), isFalse);

    // Similar photos from the asset viewer, opened on kyoto-1.
    final reference = TestUtils.createRemoteAsset(id: ids['asset:kyoto-1']!, ownerId: ids['user:me']);
    await openViewer(tester, container, router, reference, photosTimeline(tester));
    await tapViewerMenu(tester, 'View similar photos');
    await sync(tester, server);

    expect(find.byType(MainTimelinePage), findsOneWidget);
    expect(container.read(searchModeProvider), isTrue);
    expect(container.read(searchStateProvider).query, SearchQuery.similarTo(reference.id));
    expect(find.byKey(const Key('search-mode-similar-token')), findsOneWidget);
    final recorded = [
      for (final item in ((contractResponseBody('scope-similar-smart')! as Map)['assets'] as Map)['items'] as List)
        (item as Map)['id'] as String,
    ];
    final results = photosTimeline(tester);
    expect(results.origin, TimelineOrigin.search);
    expect(results.totalAssets, recorded.length);
    expect((await tester.runAsync(() => results.loadAssets(0, recorded.length)))!.map((a) => a.remoteId).toList(), [
      ...recorded,
    ]);

    // View in timeline from one of the results.
    final result = (await tester.runAsync(() => results.loadAssets(1, 1)))!.single as RemoteAsset;
    await openViewer(tester, container, router, result, results);
    await tapViewerMenu(tester, 'View in timeline');
    await sync(tester, server);

    expect(container.read(searchModeProvider), isFalse);
    expect(container.read(searchStateProvider).isEmpty, isTrue);
    expect(find.byType(SearchHeader), findsNothing);
    expect(photosTimeline(tester).origin, isNot(TimelineOrigin.search));

    expect(server.unmatched, isEmpty, reason: 'every request matched a recorded fixture');
    expect(server.served, contains('scope-similar-smart'));
    await close(tester, container, client);
  });

  testWidgets('a stock Immich server: search mode opens with no facet chips, and results load', (tester) async {
    final (server, client) = await start(tester, (name) => name.startsWith('stock-'));
    await database.setUp(timelineAssets: 30);
    final container = searchModeContainer(
      db: database.db,
      repository: repositoryFor(client),
      realDebounce: true,
      extra: asMe(),
    );
    stubRemoteImages(tester);
    await pumpPhotosPage(tester, container);
    await sync(tester, server);

    await openGallerySearch(FakeTabsRouter(initialIndex: kGalleryPhotosIndex), container.read);
    await sync(tester, server);
    expect(find.byType(SearchHeader), findsOneWidget);
    for (final chip in ['people', 'when', 'places', 'tags']) {
      expect(find.byKey(Key('search-chip-$chip')), findsNothing, reason: '$chip: no facet options on stock Immich');
    }

    // The Filters the stock server can honour: photos only, favorites only.
    container.read(searchStateProvider.notifier)
      ..setMediaType(SearchMediaType.image)
      ..setFavoritesOnly(true);
    await sync(tester, server);

    final recorded = [
      for (final item
          in ((contractResponseBody('stock-search-metadata-photos')! as Map)['assets'] as Map)['items'] as List)
        (item as Map)['id'] as String,
    ];
    final results = photosTimeline(tester);
    expect(results.origin, TimelineOrigin.search);
    expect((await tester.runAsync(() => results.loadAssets(0, recorded.length)))!.map((a) => a.remoteId).toSet(), {
      ...recorded,
    });
    expect(server.requests.where((r) => r.contains('/search/options') || r.contains('/timeline/')), isEmpty);
    expect(server.unmatched, isEmpty, reason: 'every request matched a recorded fixture');
    await close(tester, container, client);
  });
}
