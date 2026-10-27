import 'package:drift/drift.dart' show Value;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/data/db/main/table/remote/asset.drift.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/gallery/search/search.providers.dart';
import 'package:immich_mobile/gallery/search/search_mode.provider.dart';
import 'package:immich_mobile/gallery/search/search_state.model.dart';
import 'package:immich_mobile/gallery/search/search_timeline.dart';
import 'package:immich_mobile/gallery/search/search_ui.providers.dart';
import 'package:immich_mobile/gallery/search/widgets/search_header.widget.dart';
import 'package:immich_mobile/presentation/pages/dev/main_timeline.page.dart';
import 'package:immich_mobile/presentation/widgets/images/remote_image_provider.dart';
import 'package:immich_mobile/presentation/widgets/images/thumbnail.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_empty_state.widget.dart';
import 'package:immich_mobile/providers/asset_viewer/asset_viewer.provider.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';

import 'search_mode_harness.dart';
import 'switch_over_harness.dart';

// Slice 5 behaviours (specs/2026-10-23-mobile-search-redesign-design.md, "Slice 5 — Switch over and remove the old
// filter sheet"), on the real Photos page over the fake library (search_mode_harness.dart). Entry is in
// photos_search_mode_test.dart and gallery_search_action_test.dart, the old settings in
// test/gallery/utils/retired_store_keys_test.dart, the router in old_picker_routes_test.dart.

const _anna = SearchPersonRef(filterId: 'person:anna', name: 'Anna', profileId: 'anna');

void main() {
  final database = SearchModeDatabase();

  setUpAll(database.setUpAll);
  tearDownAll(database.tearDownAll);

  late FakeSearchRepository repository;
  late ProviderContainer container;

  Future<void> pump(WidgetTester tester, {int timelineAssets = 20}) async {
    await database.setUp(timelineAssets: timelineAssets);
    repository = FakeSearchRepository(FakeLibrary.standard);
    container = searchModeContainer(db: database.db, repository: repository);
    await pumpPhotosPage(tester, container);
  }

  TimelineService photosTimeline(WidgetTester tester) =>
      ProviderScope.containerOf(tester.element(find.byType(Timeline))).read(timelineServiceProvider);

  group('Similar photos', () {
    testWidgets('opens search mode with the "Similar to this photo" token and its thumbnail, Photos only and '
        'Relevance', (tester) async {
      await pump(tester);

      openSimilarPhotosSearch(container.read, 'kyoto-1');
      await settleFrames(tester);

      expect(find.byType(SearchHeader), findsOneWidget);
      final token = find.byKey(const Key('search-mode-similar-token'));
      expect(token, findsOneWidget);
      expect(find.descendant(of: token, matching: find.text('Similar to this photo')), findsOneWidget);
      final thumbnail = tester.widget<Thumbnail>(find.descendant(of: token, matching: find.byType(Thumbnail)));
      expect((thumbnail.imageProvider! as RemoteImageProvider).url, contains('/assets/kyoto-1/thumbnail'));
      final state = container.read(searchStateProvider);
      expect(state.filters.mediaType, SearchMediaType.image);
      expect(state.sort, SearchSort.relevance);
      // The reference photo goes out as queryAssetId, photos only.
      final params = repository.resultParams.last;
      expect(params.queryAssetId, 'kyoto-1');
      expect(params.type, SearchMediaType.image);
      expect(repository.calls, contains('smart'));

      await disposePhotosPage(tester, container);
    });

    testWidgets('removing the token returns to unfiltered search mode', (tester) async {
      await pump(tester);
      openSimilarPhotosSearch(container.read, 'kyoto-1');
      await settleFrames(tester);

      await tester.tap(find.byKey(const Key('search-mode-similar-token')));
      await settleFrames(tester);

      expect(container.read(searchModeProvider), isTrue);
      expect(container.read(searchStateProvider), const SearchState(), reason: 'no query, no Photos only, Newest');
      expect(find.byKey(const Key('search-mode-similar-token')), findsNothing);
      expect(container.read(searchTimelineFeedProvider), isNull, reason: 'the screen\'s own timeline is back');

      await disposePhotosPage(tester, container);
    });

    testWidgets('from the asset viewer: View similar photos opens Photos search mode on the reference photo', (
      tester,
    ) async {
      await database.setUp(timelineAssets: 20);
      repository = FakeSearchRepository(FakeLibrary.standard);
      container = searchModeContainer(db: database.db, repository: repository);
      final router = SwitchOverRouter();
      await pumpPhotosWithRouter(tester, container, router);
      final asset = (await tester.runAsync(() => photosTimeline(tester).loadAssets(0, 1)))!.single;

      await openViewer(tester, container, router, asset, photosTimeline(tester));
      expect(find.byType(MainTimelinePage), findsNothing, reason: 'precondition: the viewer covers Photos');
      await tapViewerMenu(tester, 'View similar photos');

      expect(find.byType(MainTimelinePage), findsOneWidget);
      expect(container.read(searchModeProvider), isTrue);
      expect(container.read(searchStateProvider).query, SearchQuery.similarTo((asset as RemoteAsset).id));
      expect(find.byKey(const Key('search-mode-similar-token')), findsOneWidget);

      await disposePhotosPage(tester, container);
    });
  });

  testWidgets('View in timeline from a search result leaves search mode and shows the photo in the normal Photos '
      'timeline', (tester) async {
    await database.setUp(timelineAssets: 20);
    repository = FakeSearchRepository(FakeLibrary.standard);
    container = searchModeContainer(db: database.db, repository: repository);
    final router = SwitchOverRouter();
    await pumpPhotosWithRouter(tester, container, router);
    container.read(searchModeProvider.notifier).enter();
    container.read(searchStateProvider.notifier).togglePerson(_anna);
    await settleFrames(tester);
    final results = photosTimeline(tester);
    expect(results.origin, TimelineOrigin.search, reason: 'precondition: the grid shows the results');
    final result = (await tester.runAsync(() => results.loadAssets(0, 1)))!.single;

    await openViewer(tester, container, router, result, results);
    await tapViewerMenu(tester, 'View in timeline');

    expect(container.read(searchModeProvider), isFalse);
    expect(container.read(searchStateProvider).isEmpty, isTrue);
    expect(find.byType(SearchHeader), findsNothing);
    expect(find.byType(PhotosTimelineAppBar), findsOneWidget);
    expect(photosTimeline(tester).origin, isNot(TimelineOrigin.search), reason: 'the normal Photos timeline');

    await disposePhotosPage(tester, container);
  });

  testWidgets('with no matches the filtered empty state shows, and its action clears the filters', (tester) async {
    await pump(tester);
    container.read(searchModeProvider.notifier).enter();
    // Anna in Berlin: nothing in the library.
    container.read(searchStateProvider.notifier)
      ..togglePerson(_anna)
      ..setPlace(const SearchPlace(country: 'Germany', city: 'Berlin'));
    await settleFrames(tester);

    expect(find.byType(TimelineEmptyState), findsOneWidget);
    expect(find.text('No matching photos'), findsOneWidget);

    await tester.tap(find.byKey(const Key('timeline-empty-clear-filters')));
    await settleFrames(tester);

    expect(container.read(searchStateProvider).isEmpty, isTrue);
    expect(container.read(searchModeProvider), isTrue, reason: 'search mode stays open, as with Clear all');
    expect(find.byType(TimelineEmptyState), findsNothing, reason: 'the whole timeline is back');

    await disposePhotosPage(tester, container);
  });

  group('a result built from /timeline/bucket columns, opened in the asset viewer', () {
    Future<RemoteAsset> openResult(WidgetTester tester) async {
      container.read(searchModeProvider.notifier).enter();
      container.read(searchStateProvider.notifier).togglePerson(_anna);
      await settleFrames(tester);
      final results = photosTimeline(tester);
      final assets = (await tester.runAsync(() => results.loadAssets(0, 3)))!.cast<RemoteAsset>();
      final tile = assets.firstWhere((a) => a.id == 'kyoto-1');
      expect(isSearchBucketAsset(tile), isTrue, reason: 'precondition: no name, no checksum');
      // What a tile tap does (AssetViewer.setAsset).
      container.read(assetViewerProvider.notifier)
        ..reset()
        ..setAsset(tile);
      await settleFrames(tester);
      return tile;
    }

    testWidgets('not synced to the phone: the viewer gets the whole asset from the server, so share, download, '
        'favorite and info have its file name, checksum and size', (tester) async {
      await pump(tester);
      await openResult(tester);

      expect(repository.calls, contains('asset kyoto-1'));
      final current = container.read(assetViewerProvider).currentAsset! as RemoteAsset;
      expect(current.id, 'kyoto-1');
      expect(current.name, 'kyoto-1.jpg', reason: 'download and share name the file after it; info shows it');
      expect(current.checksum, 'checksum-kyoto-1');
      expect(current.width, 100);
      expect(current.height, 100);

      await disposePhotosPage(tester, container);
    });

    testWidgets('synced to the phone: the viewer takes the synced row and the server is not asked', (tester) async {
      await pump(tester);
      final taken = DateTime.utc(2024, 6, 3, 10);
      await database.db
          .into(database.db.remoteAssetEntity)
          .insert(
            RemoteAssetEntityCompanion.insert(
              id: 'kyoto-1',
              name: 'IMG_0001.jpg',
              type: AssetType.image,
              checksum: 'synced-checksum',
              ownerId: testUserId,
              visibility: AssetVisibility.timeline,
              createdAt: Value(taken),
              updatedAt: Value(taken),
              localDateTime: Value(taken),
              width: const Value(4000),
              height: const Value(3000),
              durationMs: const Value(0),
              isFavorite: const Value(true),
              isEdited: const Value(false),
            ),
          );
      await openResult(tester);

      expect(repository.calls, isNot(contains('asset kyoto-1')));
      final current = container.read(assetViewerProvider).currentAsset! as RemoteAsset;
      expect(current.name, 'IMG_0001.jpg');
      expect(current.checksum, 'synced-checksum');

      await disposePhotosPage(tester, container);
    });
  });
}
