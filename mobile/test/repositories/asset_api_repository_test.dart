// #763: favorites are per-user, so the write path must route through the dedicated
// PUT /assets/favorites endpoint (AssetFavoriteUpdateDto), not the owner-only bulk-update
// endpoint (AssetBulkUpdateDto) other asset fields (visibility, location, dateTime) still use.
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/repositories/asset_api.repository.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart' as api;

class MockAssetsApi extends Mock implements api.AssetsApi {}

class MockApiService extends Mock implements ApiService {}

void main() {
  late MockAssetsApi mockApi;
  late MockApiService mockApiService;
  late AssetApiRepository repository;

  setUpAll(() {
    registerFallbackValue(api.AssetFavoriteUpdateDto(ids: const [], isFavorite: false));
    registerFallbackValue(api.AssetBulkUpdateDto(ids: const []));
  });

  setUp(() {
    mockApi = MockAssetsApi();
    mockApiService = MockApiService();
    when(() => mockApiService.assetsApi).thenReturn(mockApi);
    repository = AssetApiRepository(mockApiService);
  });

  group('updateFavorite', () {
    test('calls updateAssetFavorites (PUT /assets/favorites), not the bulk-update endpoint', () async {
      when(() => mockApi.updateAssetFavorites(any())).thenAnswer((_) async {});

      await repository.updateFavorite(['asset-1', 'asset-2'], true);

      final dto =
          verify(() => mockApi.updateAssetFavorites(captureAny())).captured.single as api.AssetFavoriteUpdateDto;
      expect(dto.ids, ['asset-1', 'asset-2']);
      expect(dto.isFavorite, isTrue);
      verifyNever(() => mockApi.updateAssets(any()));
    });

    test('passes isFavorite: false through for unfavorite', () async {
      when(() => mockApi.updateAssetFavorites(any())).thenAnswer((_) async {});

      await repository.updateFavorite(['asset-1'], false);

      final dto =
          verify(() => mockApi.updateAssetFavorites(captureAny())).captured.single as api.AssetFavoriteUpdateDto;
      expect(dto.ids, ['asset-1']);
      expect(dto.isFavorite, isFalse);
    });
  });
}
