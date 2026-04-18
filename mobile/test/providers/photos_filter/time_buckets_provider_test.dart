import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/entities/asset.entity.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/providers/photos_filter/time_buckets.provider.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

import '../../service.mocks.dart';

void main() {
  late MockApiService mockApiService;
  late MockTimelineApi mockTimelineApi;
  late ProviderContainer container;

  setUpAll(() {
    registerFallbackValue(AssetTypeEnum.IMAGE);
  });

  setUp(() {
    mockApiService = MockApiService();
    mockTimelineApi = MockTimelineApi();
    when(() => mockApiService.timelineApi).thenReturn(mockTimelineApi);

    container = ProviderContainer(overrides: [apiServiceProvider.overrideWithValue(mockApiService)]);
    addTearDown(container.dispose);
  });

  test('forwards filter fields to getTimeBuckets', () async {
    final filter = SearchFilter.empty().copyWith()
      ..location = SearchLocationFilter(country: 'France', city: 'Paris')
      ..mediaType = AssetType.image
      ..tagIds = const ['t1'];

    when(
      () => mockTimelineApi.getTimeBuckets(
        country: any(named: 'country'),
        city: any(named: 'city'),
        isFavorite: any(named: 'isFavorite'),
        personIds: any(named: 'personIds'),
        rating: any(named: 'rating'),
        tagIds: any(named: 'tagIds'),
        type: any(named: 'type'),
      ),
    ).thenAnswer((_) async => [TimeBucketsResponseDto(count: 5, timeBucket: '2024-06-01')]);

    final result = await container.read(timeBucketsProvider(filter).future);
    expect(result.length, 1);
    expect(result.first.timeBucket, '2024-06-01');
    expect(result.first.count, 5);

    verify(
      () => mockTimelineApi.getTimeBuckets(
        country: 'France',
        city: 'Paris',
        isFavorite: null,
        personIds: null,
        rating: null,
        tagIds: ['t1'],
        type: AssetTypeEnum.IMAGE,
      ),
    ).called(1);
  });

  test('null API response → empty list', () async {
    when(
      () => mockTimelineApi.getTimeBuckets(
        country: any(named: 'country'),
        city: any(named: 'city'),
        isFavorite: any(named: 'isFavorite'),
        personIds: any(named: 'personIds'),
        rating: any(named: 'rating'),
        tagIds: any(named: 'tagIds'),
        type: any(named: 'type'),
      ),
    ).thenAnswer((_) async => null);

    final result = await container.read(timeBucketsProvider(SearchFilter.empty()).future);
    expect(result, isEmpty);
  });

  test('empty people set sends personIds: null (not empty list)', () async {
    when(
      () => mockTimelineApi.getTimeBuckets(
        country: any(named: 'country'),
        city: any(named: 'city'),
        isFavorite: any(named: 'isFavorite'),
        personIds: any(named: 'personIds'),
        rating: any(named: 'rating'),
        tagIds: any(named: 'tagIds'),
        type: any(named: 'type'),
      ),
    ).thenAnswer((_) async => []);

    await container.read(timeBucketsProvider(SearchFilter.empty()).future);

    verify(
      () => mockTimelineApi.getTimeBuckets(
        country: null,
        city: null,
        isFavorite: null,
        personIds: null,
        rating: null,
        tagIds: null,
        type: null,
      ),
    ).called(1);
  });
}
