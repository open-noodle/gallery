import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/search_result.model.dart';
import 'package:immich_mobile/domain/services/search.service.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter_search.provider.dart';
import 'package:mocktail/mocktail.dart';

import '../../test_utils.dart';

class _MockSearch extends Mock implements SearchService {}

class _FakeFilter extends Fake implements SearchFilter {}

List<BaseAsset> _assets(int n, String tag) =>
    List<BaseAsset>.generate(n, (i) => TestUtils.createRemoteAsset(id: '$tag-$i'));

void main() {
  setUpAll(() => registerFallbackValue(_FakeFilter()));

  PhotosFilterSearchNotifier make(SearchService s) => PhotosFilterSearchNotifier(
    search: s,
    filter: SearchFilter.empty().copyWith(context: 'nature'),
  );

  test('accumulates pages until nextPage is null', () async {
    final s = _MockSearch();
    when(() => s.search(any(), 1)).thenAnswer((_) async => SearchResult(assets: _assets(100, 'p1'), nextPage: 2));
    when(() => s.search(any(), 2)).thenAnswer((_) async => SearchResult(assets: _assets(100, 'p2'), nextPage: 3));
    when(() => s.search(any(), 3)).thenAnswer((_) async => SearchResult(assets: _assets(26, 'p3'), nextPage: null));

    final n = make(s);
    addTearDown(n.dispose);
    await n.firstLoad;
    expect(n.getAssets().length, 100);
    await n.loadMore();
    expect(n.getAssets().length, 200);
    await n.loadMore();
    expect(n.getAssets().length, 226);
    expect(n.nextPage, isNull);
    await n.loadMore();
    verify(() => s.search(any(), 1)).called(1);
    verify(() => s.search(any(), 2)).called(1);
    verify(() => s.search(any(), 3)).called(1);
  });

  test('empty/error first page stops paging (no retry loop)', () async {
    final s = _MockSearch();
    when(() => s.search(any(), any())).thenAnswer((_) async => null);
    final n = make(s);
    addTearDown(n.dispose);
    await n.firstLoad;
    expect(n.getAssets(), isEmpty);
    expect(n.nextPage, isNull);
    expect(n.isLoading, isFalse);
    await n.loadMore();
    verify(() => s.search(any(), 1)).called(1);
  });

  test('dedups repeated ids across pages', () async {
    final s = _MockSearch();
    when(() => s.search(any(), 1)).thenAnswer((_) async => SearchResult(assets: _assets(100, 'p1'), nextPage: 2));
    when(() => s.search(any(), 2)).thenAnswer(
      (_) async => SearchResult(
        assets: [
          TestUtils.createRemoteAsset(id: 'p1-0'),
          ..._assets(99, 'p2'),
        ],
        nextPage: null,
      ),
    );
    final n = make(s);
    addTearDown(n.dispose);
    await n.firstLoad;
    await n.loadMore();
    expect(n.getAssets().length, 199);
  });

  test('dispose mid-flight => no append, no throw', () async {
    final s = _MockSearch();
    when(() => s.search(any(), 1)).thenAnswer((_) async => SearchResult(assets: _assets(100, 'p1'), nextPage: 2));
    when(() => s.search(any(), 2)).thenAnswer((_) async {
      await Future<void>.delayed(const Duration(milliseconds: 30));
      return SearchResult(assets: _assets(100, 'p2'), nextPage: 3);
    });
    final n = make(s);
    await n.firstLoad;
    final inflight = n.loadMore();
    n.dispose();
    await expectLater(inflight, completes);
  });

  test('concurrent loadMore while loading is a no-op', () async {
    final s = _MockSearch();
    var calls = 0;
    when(() => s.search(any(), any())).thenAnswer((_) async {
      calls++;
      await Future<void>.delayed(const Duration(milliseconds: 20));
      return SearchResult(assets: _assets(100, 'c$calls'), nextPage: 2);
    });
    final n = make(s);
    addTearDown(n.dispose);
    await n.firstLoad;
    final a = n.loadMore();
    final b = n.loadMore();
    await Future.wait([a, b]);
    expect(calls, 2);
  });

  test('count stream emits buffer length per page', () async {
    final s = _MockSearch();
    when(() => s.search(any(), 1)).thenAnswer((_) async => SearchResult(assets: _assets(100, 'p1'), nextPage: 2));
    when(() => s.search(any(), 2)).thenAnswer((_) async => SearchResult(assets: _assets(40, 'p2'), nextPage: null));
    final n = make(s);
    addTearDown(n.dispose);
    final seen = <int>[];
    final sub = n.count.listen(seen.add);
    await n.firstLoad;
    await n.loadMore();
    await Future<void>.delayed(Duration.zero);
    await sub.cancel();
    expect(seen, containsAllInOrder([100, 140]));
  });

  group('search activation', () {
    test('isSearchActive gate', () {
      expect(isSearchActive(null, SearchFilter.empty().copyWith(context: 'x')), isFalse);
      expect(isSearchActive('u', SearchFilter.empty()), isFalse);
      expect(isSearchActive('u', SearchFilter.empty().copyWith(context: 'x')), isTrue);
    });

    test('empty-filter notifier is terminal and never calls the API', () async {
      final s = _MockSearch();
      final n = PhotosFilterSearchNotifier(search: s, filter: SearchFilter.empty());
      addTearDown(n.dispose);
      await n.firstLoad;
      await n.loadMore();
      expect(n.nextPage, isNull);
      verifyNever(() => s.search(any(), any()));
    });
  });
}
