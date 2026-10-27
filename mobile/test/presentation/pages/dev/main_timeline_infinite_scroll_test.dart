import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/gallery/search/search.providers.dart';
import 'package:immich_mobile/gallery/search/search_mode.provider.dart';
import 'package:immich_mobile/gallery/search/search_scope.dart';
import 'package:immich_mobile/gallery/search/search_state.model.dart';
import 'package:openapi/api.dart' as api;

import '../../../gallery/search/search_mode_harness.dart';

/// Smart search answered in pages of 100, 100 and 40 assets.
class _PagedRepository extends FakeSearchRepository {
  _PagedRepository() : super(FakeLibrary.standard);

  final pages = <int>[];

  static const _sizes = [100, 100, 40];

  @override
  Future<api.SearchResponseDto?> smart(
    SearchParams p, {
    required int page,
    required SearchSort sort,
    int size = 100,
  }) async {
    calls.add('smart');
    pages.add(page);
    final count = page <= _sizes.length ? _sizes[page - 1] : 0;
    final taken = DateTime.utc(2024, 6, 1);
    return api.SearchResponseDto(
      albums: api.SearchAlbumResponseDto(count: 0, facets: const [], items: const [], total: 0),
      assets: api.SearchAssetResponseDto(
        count: count,
        facets: const [],
        items: [
          for (var i = 0; i < count; i++)
            api.AssetResponseDto(
              id: 'p$page-$i',
              checksum: 'checksum-p$page-$i',
              createdAt: taken,
              duration: 0,
              fileCreatedAt: taken,
              fileModifiedAt: taken,
              hasMetadata: true,
              height: 100,
              isArchived: false,
              isEdited: false,
              isFavorite: false,
              isOffline: false,
              isTrashed: false,
              localDateTime: taken,
              originalFileName: 'p$page-$i.jpg',
              originalPath: '/p$page-$i.jpg',
              ownerId: testUserId,
              thumbhash: null,
              type: api.AssetTypeEnum.IMAGE,
              updatedAt: taken,
              visibility: api.AssetVisibility.timeline,
              width: 100,
            ),
        ],
        nextPage: page < _sizes.length ? '${page + 1}' : null,
        total: count,
      ),
    );
  }
}

// The Photos page pages smart-search results as the grid reaches their end (search mode's results source,
// lib/gallery/search/search_timeline.dart), and searches nothing while search mode is closed.
void main() {
  final database = SearchModeDatabase();

  setUpAll(database.setUpAll);
  tearDownAll(database.tearDownAll);

  testWidgets('scrolling the search results loads the next page', (tester) async {
    await database.setUp();
    final repository = _PagedRepository();
    final container = searchModeContainer(db: database.db, repository: repository);
    await pumpPhotosPage(tester, container);

    container.read(searchModeProvider.notifier).enter();
    container.read(searchStateProvider.notifier).submitText('nature');
    await settleFrames(tester);
    // The grid's first load asks past the end of page 1, so page 2 may come right away; page 3 needs a scroll.
    expect(repository.pages, isNot(contains(3)));

    for (var c = 0; c < 4; c++) {
      await tester.fling(find.byType(CustomScrollView).last, const Offset(0, -3000), 4000);
      await settleFrames(tester, frames: 12);
    }
    expect(repository.pages, [1, 2, 3]);
    expect(container.read(searchResultsProvider).assets, hasLength(240));

    await disposePhotosPage(tester, container);
  });

  testWidgets('with search mode closed, scrolling the library timeline searches nothing', (tester) async {
    await database.setUp(timelineAssets: 200);
    final repository = FakeSearchRepository(FakeLibrary.standard);
    final container = searchModeContainer(db: database.db, repository: repository);
    await pumpPhotosPage(tester, container);

    for (var c = 0; c < 3; c++) {
      await tester.fling(find.byType(CustomScrollView).last, const Offset(0, -3000), 4000);
      await settleFrames(tester, frames: 8);
    }
    // Only the warm-up's options requests: no results request of any kind.
    expect(repository.calls.where((call) => !call.startsWith('options')), isEmpty);
    expect(repository.resultParams, isEmpty);

    await disposePhotosPage(tester, container);
  });
}
