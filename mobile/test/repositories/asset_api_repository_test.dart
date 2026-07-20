// #763: favorites are per-user, so the write path must route through the dedicated
// PUT /assets/favorites endpoint (AssetFavoriteUpdateDto), not the owner-only bulk-update
// endpoint (AssetBulkUpdateDto) other asset fields (visibility, location, dateTime) still use.
//
// That canonical endpoint doesn't exist on fork servers <= 5.2.0 (mobile and server release
// independently), so the write path is gated the same way the sync stream gates the per-user
// favorites sync type: strictly-after-5.2.0 gets the canonical endpoint, everything else falls
// back to the legacy bulk-update endpoint (see asset_api.repository.dart `updateFavorite` for
// the full rationale).
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/repositories/asset_api.repository.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:immich_mobile/utils/semver.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart' as api;

class MockAssetsApi extends Mock implements api.AssetsApi {}

class MockApiService extends Mock implements ApiService {}

void main() {
  late MockAssetsApi mockApi;
  late MockApiService mockApiService;

  AssetApiRepository buildRepository(SemVer serverVersion) {
    return AssetApiRepository(mockApiService, () => serverVersion);
  }

  setUpAll(() {
    registerFallbackValue(api.AssetFavoriteUpdateDto(ids: const [], isFavorite: false));
    registerFallbackValue(api.AssetBulkUpdateDto(ids: const []));
  });

  setUp(() {
    mockApi = MockAssetsApi();
    mockApiService = MockApiService();
    when(() => mockApiService.assetsApi).thenReturn(mockApi);
  });

  group('updateFavorite — new server (> 5.2.0)', () {
    const newServer = SemVer(major: 5, minor: 3, patch: 0);

    test('calls updateAssetFavorites (PUT /assets/favorites), not the bulk-update endpoint', () async {
      final repository = buildRepository(newServer);
      when(() => mockApi.updateAssetFavorites(any())).thenAnswer((_) async {});

      await repository.updateFavorite(['asset-1', 'asset-2'], true);

      final dto =
          verify(() => mockApi.updateAssetFavorites(captureAny())).captured.single as api.AssetFavoriteUpdateDto;
      expect(dto.ids, ['asset-1', 'asset-2']);
      expect(dto.isFavorite, isTrue);
      verifyNever(() => mockApi.updateAssets(any()));
    });

    test('passes isFavorite: false through for unfavorite', () async {
      final repository = buildRepository(newServer);
      when(() => mockApi.updateAssetFavorites(any())).thenAnswer((_) async {});

      await repository.updateFavorite(['asset-1'], false);

      final dto =
          verify(() => mockApi.updateAssetFavorites(captureAny())).captured.single as api.AssetFavoriteUpdateDto;
      expect(dto.ids, ['asset-1']);
      expect(dto.isFavorite, isFalse);
    });
  });

  group('updateFavorite — old server (<= 5.2.0)', () {
    const oldServer = SemVer(major: 5, minor: 2, patch: 0);

    test('falls back to updateAssets (PUT /assets), not the canonical endpoint', () async {
      final repository = buildRepository(oldServer);
      when(() => mockApi.updateAssets(any())).thenAnswer((_) async {});

      await repository.updateFavorite(['asset-1', 'asset-2'], true);

      final dto = verify(() => mockApi.updateAssets(captureAny())).captured.single as api.AssetBulkUpdateDto;
      expect(dto.ids, ['asset-1', 'asset-2']);
      expect(dto.isFavorite.value, isTrue);
      verifyNever(() => mockApi.updateAssetFavorites(any()));
    });

    test('passes isFavorite: false through for unfavorite', () async {
      final repository = buildRepository(oldServer);
      when(() => mockApi.updateAssets(any())).thenAnswer((_) async {});

      await repository.updateFavorite(['asset-1'], false);

      final dto = verify(() => mockApi.updateAssets(captureAny())).captured.single as api.AssetBulkUpdateDto;
      expect(dto.ids, ['asset-1']);
      expect(dto.isFavorite.value, isFalse);
    });

    test('an older/unknown server (e.g. 5.0.0) also falls back to updateAssets', () async {
      final repository = buildRepository(const SemVer(major: 5, minor: 0, patch: 0));
      when(() => mockApi.updateAssets(any())).thenAnswer((_) async {});

      await repository.updateFavorite(['asset-1'], true);

      verify(() => mockApi.updateAssets(any())).called(1);
      verifyNever(() => mockApi.updateAssetFavorites(any()));
    });
  });
}
