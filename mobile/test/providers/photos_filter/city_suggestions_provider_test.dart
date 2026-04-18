import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/providers/photos_filter/city_suggestions.provider.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

import '../../service.mocks.dart';

void main() {
  late MockApiService mockApiService;
  late MockSearchApi mockSearchApi;
  late ProviderContainer container;

  setUpAll(() {
    registerFallbackValue(SearchSuggestionType.city);
  });

  setUp(() {
    mockApiService = MockApiService();
    mockSearchApi = MockSearchApi();
    when(() => mockApiService.searchApi).thenReturn(mockSearchApi);

    container = ProviderContainer(overrides: [apiServiceProvider.overrideWithValue(mockApiService)]);
    addTearDown(container.dispose);
  });

  group('citySuggestionsProvider', () {
    test('returns [] when country is null', () async {
      final result = await container.read(citySuggestionsProvider(null).future);
      expect(result, isEmpty);
    });

    test('returns [] when country is empty string', () async {
      final result = await container.read(citySuggestionsProvider('').future);
      expect(result, isEmpty);
    });

    test('calls getSearchSuggestions(type=city, country) when country set', () async {
      when(
        () => mockSearchApi.getSearchSuggestions(SearchSuggestionType.city, country: 'France', withSharedSpaces: false),
      ).thenAnswer((_) async => ['Paris', 'Lyon']);

      final result = await container.read(citySuggestionsProvider('France').future);
      expect(result, ['Paris', 'Lyon']);
      verify(
        () => mockSearchApi.getSearchSuggestions(SearchSuggestionType.city, country: 'France', withSharedSpaces: false),
      ).called(1);
    });

    test('null response from server → empty list', () async {
      when(
        () => mockSearchApi.getSearchSuggestions(
          any(),
          country: any(named: 'country'),
          withSharedSpaces: any(named: 'withSharedSpaces'),
        ),
      ).thenAnswer((_) async => null);

      expect(await container.read(citySuggestionsProvider('France').future), isEmpty);
    });
  });
}
