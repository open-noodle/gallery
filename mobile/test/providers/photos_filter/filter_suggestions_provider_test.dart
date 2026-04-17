import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/entities/asset.entity.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/providers/photos_filter/filter_suggestions.provider.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

import '../../service.mocks.dart';

void main() {
  late MockApiService mockApiService;
  late MockSearchApi mockSearchApi;
  late ProviderContainer container;

  setUpAll(() {
    registerFallbackValue(AssetTypeEnum.IMAGE);
  });

  setUp(() {
    mockApiService = MockApiService();
    mockSearchApi = MockSearchApi();
    when(() => mockApiService.searchApi).thenReturn(mockSearchApi);

    container = ProviderContainer(overrides: [apiServiceProvider.overrideWithValue(mockApiService)]);
    addTearDown(container.dispose);
  });

  group('photosFilterSuggestionsProvider', () {
    test('returns the FilterSuggestionsResponseDto returned by the API', () async {
      final dto = FilterSuggestionsResponseDto(hasUnnamedPeople: false, countries: ['France']);
      when(
        () => mockSearchApi.getFilterSuggestions(
          city: any(named: 'city'),
          country: any(named: 'country'),
          isFavorite: any(named: 'isFavorite'),
          make: any(named: 'make'),
          mediaType: any(named: 'mediaType'),
          model: any(named: 'model'),
          personIds: any(named: 'personIds'),
          rating: any(named: 'rating'),
          spaceId: any(named: 'spaceId'),
          tagIds: any(named: 'tagIds'),
          takenAfter: any(named: 'takenAfter'),
          takenBefore: any(named: 'takenBefore'),
          withSharedSpaces: any(named: 'withSharedSpaces'),
        ),
      ).thenAnswer((_) async => dto);

      final result = await container.read(photosFilterSuggestionsProvider(SearchFilter.empty()).future);

      expect(result, dto);
    });

    test('returns a fallback empty DTO when api returns null', () async {
      when(
        () => mockSearchApi.getFilterSuggestions(
          city: any(named: 'city'),
          country: any(named: 'country'),
          isFavorite: any(named: 'isFavorite'),
          make: any(named: 'make'),
          mediaType: any(named: 'mediaType'),
          model: any(named: 'model'),
          personIds: any(named: 'personIds'),
          rating: any(named: 'rating'),
          spaceId: any(named: 'spaceId'),
          tagIds: any(named: 'tagIds'),
          takenAfter: any(named: 'takenAfter'),
          takenBefore: any(named: 'takenBefore'),
          withSharedSpaces: any(named: 'withSharedSpaces'),
        ),
      ).thenAnswer((_) async => null);

      final result = await container.read(photosFilterSuggestionsProvider(SearchFilter.empty()).future);

      expect(result.hasUnnamedPeople, false);
    });

    test('forwards filter fields to getFilterSuggestions', () async {
      when(
        () => mockSearchApi.getFilterSuggestions(
          city: any(named: 'city'),
          country: any(named: 'country'),
          isFavorite: any(named: 'isFavorite'),
          make: any(named: 'make'),
          mediaType: any(named: 'mediaType'),
          model: any(named: 'model'),
          personIds: any(named: 'personIds'),
          rating: any(named: 'rating'),
          spaceId: any(named: 'spaceId'),
          tagIds: any(named: 'tagIds'),
          takenAfter: any(named: 'takenAfter'),
          takenBefore: any(named: 'takenBefore'),
          withSharedSpaces: any(named: 'withSharedSpaces'),
        ),
      ).thenAnswer((_) async => FilterSuggestionsResponseDto(hasUnnamedPeople: false));

      final after = DateTime.utc(2024, 1, 1);
      final before = DateTime.utc(2024, 12, 31);
      final filter = SearchFilter.empty().copyWith(
        location: SearchLocationFilter(city: 'Paris', country: 'France'),
        camera: SearchCameraFilter(make: 'Canon', model: 'EOS R5'),
        date: SearchDateFilter(takenAfter: after, takenBefore: before),
        rating: SearchRatingFilter(rating: 4),
        tagIds: ['tag-1', 'tag-2'],
        mediaType: AssetType.image,
      );

      await container.read(photosFilterSuggestionsProvider(filter).future);

      verify(
        () => mockSearchApi.getFilterSuggestions(
          city: 'Paris',
          country: 'France',
          isFavorite: null,
          make: 'Canon',
          mediaType: AssetTypeEnum.IMAGE,
          model: 'EOS R5',
          personIds: null,
          rating: 4,
          tagIds: ['tag-1', 'tag-2'],
          takenAfter: after,
          takenBefore: before,
        ),
      ).called(1);
    });

    test('maps AssetType.other to null mediaType (unconstrained)', () async {
      when(
        () => mockSearchApi.getFilterSuggestions(
          city: any(named: 'city'),
          country: any(named: 'country'),
          isFavorite: any(named: 'isFavorite'),
          make: any(named: 'make'),
          mediaType: any(named: 'mediaType'),
          model: any(named: 'model'),
          personIds: any(named: 'personIds'),
          rating: any(named: 'rating'),
          spaceId: any(named: 'spaceId'),
          tagIds: any(named: 'tagIds'),
          takenAfter: any(named: 'takenAfter'),
          takenBefore: any(named: 'takenBefore'),
          withSharedSpaces: any(named: 'withSharedSpaces'),
        ),
      ).thenAnswer((_) async => FilterSuggestionsResponseDto(hasUnnamedPeople: false));

      await container.read(photosFilterSuggestionsProvider(SearchFilter.empty()).future);

      final captured = verify(
        () => mockSearchApi.getFilterSuggestions(
          city: any(named: 'city'),
          country: any(named: 'country'),
          isFavorite: any(named: 'isFavorite'),
          make: any(named: 'make'),
          mediaType: captureAny(named: 'mediaType'),
          model: any(named: 'model'),
          personIds: any(named: 'personIds'),
          rating: any(named: 'rating'),
          spaceId: any(named: 'spaceId'),
          tagIds: any(named: 'tagIds'),
          takenAfter: any(named: 'takenAfter'),
          takenBefore: any(named: 'takenBefore'),
          withSharedSpaces: any(named: 'withSharedSpaces'),
        ),
      ).captured;
      expect(captured.single, isNull);
    });

    test('isFavorite=false in filter becomes null on the wire', () async {
      when(
        () => mockSearchApi.getFilterSuggestions(
          city: any(named: 'city'),
          country: any(named: 'country'),
          isFavorite: any(named: 'isFavorite'),
          make: any(named: 'make'),
          mediaType: any(named: 'mediaType'),
          model: any(named: 'model'),
          personIds: any(named: 'personIds'),
          rating: any(named: 'rating'),
          spaceId: any(named: 'spaceId'),
          tagIds: any(named: 'tagIds'),
          takenAfter: any(named: 'takenAfter'),
          takenBefore: any(named: 'takenBefore'),
          withSharedSpaces: any(named: 'withSharedSpaces'),
        ),
      ).thenAnswer((_) async => FilterSuggestionsResponseDto(hasUnnamedPeople: false));

      await container.read(photosFilterSuggestionsProvider(SearchFilter.empty()).future);

      final captured = verify(
        () => mockSearchApi.getFilterSuggestions(
          city: any(named: 'city'),
          country: any(named: 'country'),
          isFavorite: captureAny(named: 'isFavorite'),
          make: any(named: 'make'),
          mediaType: any(named: 'mediaType'),
          model: any(named: 'model'),
          personIds: any(named: 'personIds'),
          rating: any(named: 'rating'),
          spaceId: any(named: 'spaceId'),
          tagIds: any(named: 'tagIds'),
          takenAfter: any(named: 'takenAfter'),
          takenBefore: any(named: 'takenBefore'),
          withSharedSpaces: any(named: 'withSharedSpaces'),
        ),
      ).captured;
      expect(captured.single, isNull);
    });
  });
}
