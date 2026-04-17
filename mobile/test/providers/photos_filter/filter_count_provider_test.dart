import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/search_result.model.dart';
import 'package:immich_mobile/domain/services/search.service.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/providers/infrastructure/search.provider.dart';
import 'package:immich_mobile/providers/photos_filter/filter_count.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:mocktail/mocktail.dart';

import '../../test_utils.dart';

class _MockSearchService extends Mock implements SearchService {}

class _FakeSearchFilter extends Fake implements SearchFilter {}

void main() {
  late _MockSearchService mockService;
  late ProviderContainer container;

  setUpAll(() {
    registerFallbackValue(_FakeSearchFilter());
  });

  setUp(() {
    mockService = _MockSearchService();
    container = ProviderContainer(overrides: [searchServiceProvider.overrideWithValue(mockService)]);
    addTearDown(container.dispose);
  });

  test('returns 0 for empty filter without calling the service', () async {
    final count = await container.read(photosFilterCountProvider.future);
    expect(count, 0);
    verifyNever(() => mockService.search(any(), any()));
  });

  test('returns assets.length for a non-empty filter', () async {
    container.read(photosFilterProvider.notifier).setText('paris');

    final assets = List.generate(42, (i) => TestUtils.createRemoteAsset(id: 'asset-$i'));
    when(() => mockService.search(any(), 1)).thenAnswer((_) async => SearchResult(assets: assets));

    final count = await container.read(photosFilterCountProvider.future);
    expect(count, 42);
    verify(() => mockService.search(any(), 1)).called(1);
  });

  test('returns 0 when service returns null', () async {
    container.read(photosFilterProvider.notifier).setText('nothing');
    when(() => mockService.search(any(), 1)).thenAnswer((_) async => null);

    final count = await container.read(photosFilterCountProvider.future);
    expect(count, 0);
  });
}
