import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/providers/photos_filter/filter_suggestions.provider.dart';
import 'package:immich_mobile/utils/option.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart' hide SearchFilter;

import '../../service.mocks.dart';

FilterSuggestionsResponseDto emptySuggestions() => FilterSuggestionsResponseDto(
  hasUnnamedPeople: false,
  hasFavorites: false,
  hasAssetsInAlbum: false,
  hasAssetsNotInAlbum: false,
);

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
    // A non-owner viewer whose visible photos are all shared-space owns no assets, so an
    // owner-scoped facet query returns nothing. Request shared-space content so the facets
    // populate — mirrors the web filter page (map-filter-config.ts withSharedSpaces: true).
    test('requests shared-space facets so a viewer sees them (withSharedSpaces: true)', () async {
      when(
        () => mockSearchApi.getFilterSuggestions(
          city: any(named: 'city'),
          country: any(named: 'country'),
          isFavorite: any(named: 'isFavorite'),
          isNotInAlbum: any(named: 'isNotInAlbum'),
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
      ).thenAnswer((_) async => emptySuggestions());

      await container.read(photosFilterSuggestionsProvider(SearchFilter.empty()).future);

      verify(
        () => mockSearchApi.getFilterSuggestions(
          city: any(named: 'city'),
          country: any(named: 'country'),
          isFavorite: any(named: 'isFavorite'),
          isNotInAlbum: any(named: 'isNotInAlbum'),
          make: any(named: 'make'),
          mediaType: any(named: 'mediaType'),
          model: any(named: 'model'),
          personIds: any(named: 'personIds'),
          rating: any(named: 'rating'),
          spaceId: any(named: 'spaceId'),
          tagIds: any(named: 'tagIds'),
          takenAfter: any(named: 'takenAfter'),
          takenBefore: any(named: 'takenBefore'),
          withSharedSpaces: true,
        ),
      ).called(1);
    });

    // #910: the albums facet is computed with this filter excluded, but every OTHER facet must
    // still honour it — forwarding it here is what lets a not-in-album toggle narrow the other
    // five facets instead of being silently dropped.
    test('forwards isNotInAlbum so the facets reflect it (#910)', () async {
      when(
        () => mockSearchApi.getFilterSuggestions(
          city: any(named: 'city'),
          country: any(named: 'country'),
          isFavorite: any(named: 'isFavorite'),
          isNotInAlbum: any(named: 'isNotInAlbum'),
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
      ).thenAnswer((_) async => emptySuggestions());

      final filter = SearchFilter.empty().copyWith(display: SearchFilter.empty().display.copyWith(isNotInAlbum: true));
      await container.read(photosFilterSuggestionsProvider(filter).future);

      verify(
        () => mockSearchApi.getFilterSuggestions(
          city: any(named: 'city'),
          country: any(named: 'country'),
          isFavorite: any(named: 'isFavorite'),
          isNotInAlbum: true,
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
      ).called(1);
    });

    test('returns the FilterSuggestionsResponseDto returned by the API', () async {
      final dto = FilterSuggestionsResponseDto(
        hasUnnamedPeople: false,
        hasFavorites: false,
        hasAssetsInAlbum: false,
        hasAssetsNotInAlbum: false,
        countries: ['France'],
      );
      when(
        () => mockSearchApi.getFilterSuggestions(
          city: any(named: 'city'),
          country: any(named: 'country'),
          isFavorite: any(named: 'isFavorite'),
          isNotInAlbum: any(named: 'isNotInAlbum'),
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

    // #910 / spec §4.6: a null API response must surface as AsyncValue.error, not a fabricated
    // all-empty DTO. sectionAvailabilityProvider (Task 3) cannot tell a fabricated empty response
    // from a genuinely empty library, and would hide six filter sections on a transient failure.
    test('errors rather than reporting an empty library when the API returns null (#910)', () async {
      when(
        () => mockSearchApi.getFilterSuggestions(
          city: any(named: 'city'),
          country: any(named: 'country'),
          isFavorite: any(named: 'isFavorite'),
          isNotInAlbum: any(named: 'isNotInAlbum'),
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

      expect(
        () => container.read(photosFilterSuggestionsProvider(SearchFilter.empty()).future),
        throwsA(isA<Exception>()),
      );
    });

    test('forwards filter fields to getFilterSuggestions', () async {
      when(
        () => mockSearchApi.getFilterSuggestions(
          city: any(named: 'city'),
          country: any(named: 'country'),
          isFavorite: any(named: 'isFavorite'),
          isNotInAlbum: any(named: 'isNotInAlbum'),
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
      ).thenAnswer((_) async => emptySuggestions());

      final after = DateTime.utc(2024, 1, 1);
      final before = DateTime.utc(2024, 12, 31);
      final filter = SearchFilter.empty().copyWith(
        location: const SearchLocationFilter(city: 'Paris', country: 'France'),
        camera: const SearchCameraFilter(make: 'Canon', model: 'EOS R5'),
        date: SearchDateFilter(takenAfter: after, takenBefore: before),
        rating: const SearchRatingFilter(rating: Option.some(4)),
        tagIds: ['tag-1', 'tag-2'],
        mediaType: AssetType.image,
      );

      await container.read(photosFilterSuggestionsProvider(filter).future);

      verify(
        () => mockSearchApi.getFilterSuggestions(
          city: 'Paris',
          country: 'France',
          isFavorite: null,
          isNotInAlbum: null,
          make: 'Canon',
          mediaType: AssetTypeEnum.IMAGE,
          model: 'EOS R5',
          personIds: null,
          rating: 4,
          tagIds: ['tag-1', 'tag-2'],
          takenAfter: after,
          takenBefore: before,
          withSharedSpaces: true,
        ),
      ).called(1);
    });

    test('maps AssetType.other to null mediaType (unconstrained)', () async {
      when(
        () => mockSearchApi.getFilterSuggestions(
          city: any(named: 'city'),
          country: any(named: 'country'),
          isFavorite: any(named: 'isFavorite'),
          isNotInAlbum: any(named: 'isNotInAlbum'),
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
      ).thenAnswer((_) async => emptySuggestions());

      await container.read(photosFilterSuggestionsProvider(SearchFilter.empty()).future);

      final captured = verify(
        () => mockSearchApi.getFilterSuggestions(
          city: any(named: 'city'),
          country: any(named: 'country'),
          isFavorite: any(named: 'isFavorite'),
          isNotInAlbum: any(named: 'isNotInAlbum'),
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
          isNotInAlbum: any(named: 'isNotInAlbum'),
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
      ).thenAnswer((_) async => emptySuggestions());

      await container.read(photosFilterSuggestionsProvider(SearchFilter.empty()).future);

      final captured = verify(
        () => mockSearchApi.getFilterSuggestions(
          city: any(named: 'city'),
          country: any(named: 'country'),
          isFavorite: captureAny(named: 'isFavorite'),
          isNotInAlbum: any(named: 'isNotInAlbum'),
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
