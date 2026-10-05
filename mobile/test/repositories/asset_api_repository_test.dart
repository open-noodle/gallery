// #763: favorites are per-user, so the write path must route through the dedicated
// PUT /assets/favorites endpoint (AssetFavoriteUpdateDto), not the owner-only bulk-update
// endpoint (AssetBulkUpdateDto) other asset fields (visibility, location, dateTime) still use.
//
// No released fork server has that canonical endpoint (mobile and server release independently),
// so the write path is gated on the server's capability declaration (`GET /server/features` →
// `syncRequestTypes`): the endpoint ships together with the `AssetFavoritesV1` sync request type,
// so a declaration containing it gets the canonical endpoint, and everything else — not declared,
// or no declaration at all (pre-5.7.0 server, features not loaded) — falls back to the legacy
// bulk-update endpoint (see asset_api.repository.dart `updateFavorite` for the full rationale).
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

  AssetApiRepository buildRepository(Set<String>? supportedSyncTypes) {
    return AssetApiRepository(mockApiService, () => supportedSyncTypes);
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

  group('updateFavorite — server declares AssetFavoritesV1', () {
    final newServer = {'AssetsV1', 'SharedSpaceAlbumFoldersV1', api.SyncRequestType.assetFavoritesV1.toJson()};

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

  group('updateFavorite — server declares capabilities but not AssetFavoritesV1 (released 5.7.x)', () {
    const oldServer = {'AssetsV1', 'SharedSpaceAlbumFoldersV1'};

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

    test('an empty declaration also falls back to updateAssets', () async {
      final repository = buildRepository(const {});
      when(() => mockApi.updateAssets(any())).thenAnswer((_) async {});

      await repository.updateFavorite(['asset-1'], true);

      verify(() => mockApi.updateAssets(any())).called(1);
      verifyNever(() => mockApi.updateAssetFavorites(any()));
    });
  });

  group('updateFavorite — no declaration (pre-5.7.0 server, or features not loaded yet)', () {
    test('null declaration falls back to updateAssets (PUT /assets), not the canonical endpoint', () async {
      final repository = buildRepository(null);
      when(() => mockApi.updateAssets(any())).thenAnswer((_) async {});

      await repository.updateFavorite(['asset-1', 'asset-2'], true);

      final dto = verify(() => mockApi.updateAssets(captureAny())).captured.single as api.AssetBulkUpdateDto;
      expect(dto.ids, ['asset-1', 'asset-2']);
      expect(dto.isFavorite.value, isTrue);
      verifyNever(() => mockApi.updateAssetFavorites(any()));
    });
  });
}
