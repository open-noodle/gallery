import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:http/http.dart' as http;
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/providers/photos_filter/camera_model_suggestions.provider.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

import '../../service.mocks.dart';

void main() {
  late MockApiService mockApiService;
  late MockSearchApi mockSearchApi;
  late ProviderContainer container;

  setUpAll(() {
    registerFallbackValue(SearchSuggestionType.cameraModel);
  });

  setUp(() {
    mockApiService = MockApiService();
    mockSearchApi = MockSearchApi();
    when(() => mockApiService.searchApi).thenReturn(mockSearchApi);

    container = ProviderContainer(overrides: [apiServiceProvider.overrideWithValue(mockApiService)]);
    addTearDown(container.dispose);
  });

  group('cameraModelSuggestionsProvider', () {
    test('returns [] when make is null', () async {
      final result = await container.read(cameraModelSuggestionsProvider(null).future);
      expect(result, isEmpty);
    });

    test('returns [] when make is empty string', () async {
      final result = await container.read(cameraModelSuggestionsProvider('').future);
      expect(result, isEmpty);
    });

    test('calls getSearchSuggestions(type=cameraModel, make) with withSharedSpaces: true when make set', () async {
      when(
        () => mockSearchApi.getSearchSuggestionsWithHttpInfo(
          SearchSuggestionType.cameraModel,
          make: 'Canon',
          withSharedSpaces: true,
        ),
      ).thenAnswer((_) async => http.Response(jsonEncode(['EOS R5', 'EOS R6']), 200));

      final result = await container.read(cameraModelSuggestionsProvider('Canon').future);
      expect(result, ['EOS R5', 'EOS R6']);
      verify(
        () => mockSearchApi.getSearchSuggestionsWithHttpInfo(
          SearchSuggestionType.cameraModel,
          make: 'Canon',
          withSharedSpaces: true,
        ),
      ).called(1);
    });

    test('null response from server → empty list', () async {
      when(
        () => mockSearchApi.getSearchSuggestionsWithHttpInfo(
          any(),
          make: any(named: 'make'),
          withSharedSpaces: any(named: 'withSharedSpaces'),
        ),
      ).thenAnswer((_) async => http.Response('', 204));

      expect(await container.read(cameraModelSuggestionsProvider('Canon').future), isEmpty);
    });
  });
}
