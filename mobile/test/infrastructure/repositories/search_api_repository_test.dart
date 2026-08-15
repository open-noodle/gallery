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
    // resolve) when the search requests shared spaces. #763: favorites are per-user, and the
    // server composes shared-space visibility with the favorite filter (slice 4), so this is no
    // longer gated on `isFavorite` — inverts the pre-#763 "favourites are owner-only" behavior.
    test('metadata search requests shared spaces when not filtering by favourite', () async {
      when(() => searchApi.searchAssets(any())).thenAnswer((_) async => null);
      await sut.search(SearchFilter.empty(), 1);
      final dto = verify(() => searchApi.searchAssets(captureAny())).captured.single as MetadataSearchDto;
      expect(dto.withSharedSpaces.value, true);
    });

    test('metadata search still requests shared spaces when filtering by favourite', () async {
      when(() => searchApi.searchAssets(any())).thenAnswer((_) async => null);
      final filter = SearchFilter.empty().copyWith(display: SearchFilter.empty().display.copyWith(isFavorite: true));
      await sut.search(filter, 1);
      final dto = verify(() => searchApi.searchAssets(captureAny())).captured.single as MetadataSearchDto;
      expect(dto.withSharedSpaces.value, true);
    });

    test('smart search requests shared spaces when not filtering by favourite', () async {
      when(() => searchApi.searchSmart(any())).thenAnswer((_) async => null);
      final filter = SearchFilter.empty().copyWith(context: 'beach');
      await sut.search(filter, 1);
      final dto = verify(() => searchApi.searchSmart(captureAny())).captured.single as SmartSearchDto;
      expect(dto.withSharedSpaces.value, true);
    });

    // The server compares the range with asset.localDateTime (wall-clock time stored as UTC), so
    // the chosen local days go out as UTC midnight of the first day and of the day after the last,
    // whatever the device's time zone. The month cell stores Jan 1 00:00 .. Jan 31 23:59:59 local.
    final january = SearchFilter.empty().copyWith(
      date: SearchDateFilter(takenAfter: DateTime(2024, 1, 1), takenBefore: DateTime(2024, 1, 31, 23, 59, 59)),
    );

    test('metadata search sends the chosen month as a UTC wall-clock range with an exclusive end', () async {
      sut = SearchApiRepository(apiService, localTakenRange: () => true);
      when(() => searchApi.searchAssets(any())).thenAnswer((_) async => null);
      await sut.search(january, 1);
      final dto = verify(() => searchApi.searchAssets(captureAny())).captured.single as MetadataSearchDto;
      expect(dto.takenAfter.value, DateTime.utc(2024, 1, 1));
      expect(dto.takenBefore.value, DateTime.utc(2024, 2, 1));
    });

    test('smart search sends the chosen month as a UTC wall-clock range with an exclusive end', () async {
      sut = SearchApiRepository(apiService, localTakenRange: () => true);
      when(() => searchApi.searchSmart(any())).thenAnswer((_) async => null);
      await sut.search(january.copyWith(context: 'beach'), 1);
      final dto = verify(() => searchApi.searchSmart(captureAny())).captured.single as SmartSearchDto;
      expect(dto.takenAfter.value, DateTime.utc(2024, 1, 1));
      expect(dto.takenBefore.value, DateTime.utc(2024, 2, 1));
    });

    // An older server compares the UTC instant with an inclusive end, so a wall-clock range would
    // shift its results by the device's offset: it keeps getting the device-local instants.
    test('metadata search keeps device-local instants for a server without localTakenRange', () async {
      when(() => searchApi.searchAssets(any())).thenAnswer((_) async => null);
      await sut.search(january, 1);
      final dto = verify(() => searchApi.searchAssets(captureAny())).captured.single as MetadataSearchDto;
      expect(dto.takenAfter.value, DateTime(2024, 1, 1));
      expect(dto.takenBefore.value, DateTime(2024, 1, 31, 23, 59, 59));
    });

    test('smart search keeps device-local instants for a server without localTakenRange', () async {
      when(() => searchApi.searchSmart(any())).thenAnswer((_) async => null);
      await sut.search(january.copyWith(context: 'beach'), 1);
      final dto = verify(() => searchApi.searchSmart(captureAny())).captured.single as SmartSearchDto;
      expect(dto.takenAfter.value, DateTime(2024, 1, 1));
      expect(dto.takenBefore.value, DateTime(2024, 1, 31, 23, 59, 59));
    });

    test('metadata search forwards locationPresence as the DTO-specific enum', () async {
      when(() => searchApi.searchAssets(any())).thenAnswer((_) async => null);
      final filter = SearchFilter.empty().copyWith(location: SearchLocationFilter(locationPresence: 'noGps'));
      await sut.search(filter, 1);
      final dto = verify(() => searchApi.searchAssets(captureAny())).captured.single as MetadataSearchDto;
      expect(dto.locationPresence.value, MetadataSearchDtoLocationPresenceEnum.noGps);
    });

    test('metadata search omits locationPresence when unset', () async {
      when(() => searchApi.searchAssets(any())).thenAnswer((_) async => null);
      await sut.search(SearchFilter.empty(), 1);
      final dto = verify(() => searchApi.searchAssets(captureAny())).captured.single as MetadataSearchDto;
      expect(dto.locationPresence.isPresent, isFalse);
    });

    test('smart search forwards locationPresence as the DTO-specific enum', () async {
      when(() => searchApi.searchSmart(any())).thenAnswer((_) async => null);
      final filter = SearchFilter.empty().copyWith(
        context: 'beach',
        location: SearchLocationFilter(locationPresence: 'noPlaceName'),
      );
      await sut.search(filter, 1);
      final dto = verify(() => searchApi.searchSmart(captureAny())).captured.single as SmartSearchDto;
      expect(dto.locationPresence.value, SmartSearchDtoLocationPresenceEnum.noPlaceName);
    });

    test('smart search omits locationPresence when unset', () async {
      when(() => searchApi.searchSmart(any())).thenAnswer((_) async => null);
      final filter = SearchFilter.empty().copyWith(context: 'beach');
      await sut.search(filter, 1);
      final dto = verify(() => searchApi.searchSmart(captureAny())).captured.single as SmartSearchDto;
      expect(dto.locationPresence.isPresent, isFalse);
    });

    test('smart search still requests shared spaces when filtering by favourite', () async {
      when(() => searchApi.searchSmart(any())).thenAnswer((_) async => null);
      final filter = SearchFilter.empty().copyWith(
        context: 'beach',
        display: SearchFilter.empty().display.copyWith(isFavorite: true),
      );
      await sut.search(filter, 1);
      final dto = verify(() => searchApi.searchSmart(captureAny())).captured.single as SmartSearchDto;
      expect(dto.withSharedSpaces.value, true);
    });
  });
}
