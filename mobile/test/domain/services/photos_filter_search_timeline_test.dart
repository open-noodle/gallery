import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/search_result.model.dart';
import 'package:immich_mobile/domain/services/photos_filter_search_timeline.dart';
import 'package:immich_mobile/domain/services/search.service.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:mocktail/mocktail.dart';

import '../../test_utils.dart';

class _MockSearch extends Mock implements SearchService {}

class _MockFactory extends Mock implements TimelineFactory {}

class _FakeFilter extends Fake implements SearchFilter {}

class _FakeTimelineService extends Fake implements TimelineService {
  bool disposed = false;
  @override
  Future<void> dispose() async {
    disposed = true;
  }
}

SearchFilter _filterWithText(String t) => SearchFilter.empty()..context = t;

void main() {
  setUpAll(() {
    registerFallbackValue(_FakeFilter());
    registerFallbackValue(TimelineOrigin.search);
    registerFallbackValue(() => const <BaseAsset>[]);
    registerFallbackValue(const Stream<int>.empty());
  });

  group('buildPhotosFilterSearchTimeline', () {
    test('calls SearchService.search(filter, 1)', () async {
      final search = _MockSearch();
      final factory = _MockFactory();
      when(() => search.search(any(), any())).thenAnswer((_) async => const SearchResult(assets: []));
      when(() => factory.fromAssetStream(any(), any(), any())).thenReturn(_FakeTimelineService());

      final filter = _filterWithText('paris');
      final svc = buildPhotosFilterSearchTimeline(factory: factory, search: search, filter: filter);
      await Future<void>.delayed(const Duration(milliseconds: 5));
      await svc.dispose();

      verify(() => search.search(filter, 1)).called(1);
    });

    test('feeds the returned assets into fromAssetStream via the getter', () async {
      final search = _MockSearch();
      final factory = _MockFactory();
      final fakeAssets = <BaseAsset>[TestUtils.createRemoteAsset(id: 'a'), TestUtils.createRemoteAsset(id: 'b')];
      when(() => search.search(any(), any())).thenAnswer((_) async => SearchResult(assets: fakeAssets));

      List<BaseAsset> Function()? capturedGetter;
      when(() => factory.fromAssetStream(any(), any(), any())).thenAnswer((inv) {
        capturedGetter = inv.positionalArguments[0] as List<BaseAsset> Function();
        return _FakeTimelineService();
      });

      final svc = buildPhotosFilterSearchTimeline(factory: factory, search: search, filter: _filterWithText('paris'));
      await Future<void>.delayed(const Duration(milliseconds: 5));

      expect(capturedGetter, isNotNull);
      expect(capturedGetter!().map((a) => a.remoteId).toList(), ['a', 'b']);
      await svc.dispose();
    });

    test('uses TimelineOrigin.search', () async {
      final search = _MockSearch();
      final factory = _MockFactory();
      when(() => search.search(any(), any())).thenAnswer((_) async => const SearchResult(assets: []));
      TimelineOrigin? captured;
      when(() => factory.fromAssetStream(any(), any(), any())).thenAnswer((inv) {
        captured = inv.positionalArguments[2] as TimelineOrigin;
        return _FakeTimelineService();
      });

      buildPhotosFilterSearchTimeline(factory: factory, search: search, filter: _filterWithText('x'));
      await Future<void>.delayed(const Duration(milliseconds: 5));
      expect(captured, TimelineOrigin.search);
    });

    test('search returning null leaves buffer empty and emits 0', () async {
      final search = _MockSearch();
      final factory = _MockFactory();
      when(() => search.search(any(), any())).thenAnswer((_) async => null);

      List<BaseAsset> Function()? capturedGetter;
      Stream<int>? capturedStream;
      when(() => factory.fromAssetStream(any(), any(), any())).thenAnswer((inv) {
        capturedGetter = inv.positionalArguments[0] as List<BaseAsset> Function();
        capturedStream = inv.positionalArguments[1] as Stream<int>;
        return _FakeTimelineService();
      });

      final svc = buildPhotosFilterSearchTimeline(factory: factory, search: search, filter: _filterWithText('empty'));
      final events = <int>[];
      final sub = capturedStream!.listen(events.add);
      await Future<void>.delayed(const Duration(milliseconds: 5));
      await sub.cancel();

      expect(capturedGetter!(), isEmpty);
      expect(events, contains(0));
      await svc.dispose();
    });
  });
}
