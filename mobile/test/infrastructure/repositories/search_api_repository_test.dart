import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/infrastructure/repositories/search_api.repository.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart' hide SearchFilter;

class _MockApiService extends Mock implements ApiService {}

class _MockSearchApi extends Mock implements SearchApi {}

void main() {
  late _MockApiService apiService;
  late _MockSearchApi searchApi;
  late SearchApiRepository sut;

  setUpAll(() {
    registerFallbackValue(MetadataSearchDto());
    registerFallbackValue(SmartSearchDto());
  });

  setUp(() {
    apiService = _MockApiService();
    searchApi = _MockSearchApi();
    when(() => apiService.searchApi).thenReturn(searchApi);
    sut = SearchApiRepository(apiService);
  });

  group('search', () {
    test('empty metadata search serializes tagIds as an empty list, not untagged null', () async {
      when(() => searchApi.searchAssets(any())).thenAnswer((_) async => null);

      await sut.search(SearchFilter.empty(), 1);

      final dto = verify(() => searchApi.searchAssets(captureAny())).captured.single as MetadataSearchDto;
      final json = dto.toJson();
      expect(dto.tagIds.value, isEmpty);
      expect(json, contains('tagIds'));
      expect(json['tagIds'], isEmpty);
    });

    test('untagged metadata search serializes explicit tagIds null', () async {
      when(() => searchApi.searchAssets(any())).thenAnswer((_) async => null);
      final filter = SearchFilter.empty().copyWith(display: SearchFilter.empty().display.copyWith(isUntagged: true));

      await sut.search(filter, 1);

      final dto = verify(() => searchApi.searchAssets(captureAny())).captured.single as MetadataSearchDto;
      final json = dto.toJson();
      expect(dto.tagIds.value, isEmpty);
      expect(json, contains('tagIds'));
      expect(json['tagIds'], isNull);
    });

    test('untagged smart search serializes explicit tagIds null', () async {
      when(() => searchApi.searchSmart(any())).thenAnswer((_) async => null);
      final filter = SearchFilter.empty().copyWith(
        context: 'beach',
        display: SearchFilter.empty().display.copyWith(isUntagged: true),
      );

      await sut.search(filter, 1);

      final dto = verify(() => searchApi.searchSmart(captureAny())).captured.single as SmartSearchDto;
      final json = dto.toJson();
      expect(dto.tagIds.value, isEmpty);
      expect(json, contains('tagIds'));
      expect(json['tagIds'], isNull);
    });

    test('smart search maps newest -> AssetOrder.desc', () async {
      when(() => searchApi.searchSmart(any())).thenAnswer((_) async => null);
      final filter = SearchFilter.empty().copyWith(context: 'beach', sort: SearchSortOrder.newest);
      await sut.search(filter, 1);
      final dto = verify(() => searchApi.searchSmart(captureAny())).captured.single as SmartSearchDto;
      expect(dto.order.value, AssetOrder.desc);
    });

    test('smart search relevance omits order', () async {
      when(() => searchApi.searchSmart(any())).thenAnswer((_) async => null);
      final filter = SearchFilter.empty().copyWith(context: 'beach', sort: SearchSortOrder.relevance);
      await sut.search(filter, 1);
      final dto = verify(() => searchApi.searchSmart(captureAny())).captured.single as SmartSearchDto;
      expect(dto.order.isPresent, isFalse);
    });

    test('metadata search maps oldest -> AssetOrder.asc', () async {
      when(() => searchApi.searchAssets(any())).thenAnswer((_) async => null);
      final filter = SearchFilter.empty().copyWith(sort: SearchSortOrder.oldest);
      await sut.search(filter, 1);
      final dto = verify(() => searchApi.searchAssets(captureAny())).captured.single as MetadataSearchDto;
      expect(dto.order.value, AssetOrder.asc);
    });

    // A viewer's selected facet only returns shared-space assets (and space-person tokens only
    // resolve) when the search requests shared spaces — mirror web buildPhotosTimelineOptions,
    // which gates shared content on `isFavorite === undefined` (favourites are owner-only).
    test('metadata search requests shared spaces when not filtering by favourite', () async {
      when(() => searchApi.searchAssets(any())).thenAnswer((_) async => null);
      await sut.search(SearchFilter.empty(), 1);
      final dto = verify(() => searchApi.searchAssets(captureAny())).captured.single as MetadataSearchDto;
      expect(dto.withSharedSpaces.value, true);
    });

    test('metadata search omits shared spaces when filtering by favourite', () async {
      when(() => searchApi.searchAssets(any())).thenAnswer((_) async => null);
      final filter = SearchFilter.empty().copyWith(display: SearchFilter.empty().display.copyWith(isFavorite: true));
      await sut.search(filter, 1);
      final dto = verify(() => searchApi.searchAssets(captureAny())).captured.single as MetadataSearchDto;
      expect(dto.withSharedSpaces.isPresent, isFalse);
    });

    test('smart search requests shared spaces when not filtering by favourite', () async {
      when(() => searchApi.searchSmart(any())).thenAnswer((_) async => null);
      final filter = SearchFilter.empty().copyWith(context: 'beach');
      await sut.search(filter, 1);
      final dto = verify(() => searchApi.searchSmart(captureAny())).captured.single as SmartSearchDto;
      expect(dto.withSharedSpaces.value, true);
    });

    test('smart search omits shared spaces when filtering by favourite', () async {
      when(() => searchApi.searchSmart(any())).thenAnswer((_) async => null);
      final filter = SearchFilter.empty().copyWith(
        context: 'beach',
        display: SearchFilter.empty().display.copyWith(isFavorite: true),
      );
      await sut.search(filter, 1);
      final dto = verify(() => searchApi.searchSmart(captureAny())).captured.single as SmartSearchDto;
      expect(dto.withSharedSpaces.isPresent, isFalse);
    });
  });
}
