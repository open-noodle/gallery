import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:http/http.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/asset_edit.model.dart' hide AssetEditAction;
import 'package:immich_mobile/domain/models/stack.model.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/providers/server_info.provider.dart';
import 'package:immich_mobile/repositories/api.repository.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:immich_mobile/utils/option.dart';
import 'package:immich_mobile/utils/semver.dart';
import 'package:maplibre_gl/maplibre_gl.dart';
import 'package:openapi/api.dart' as api show AssetVisibility;
import 'package:openapi/api.dart' hide AssetVisibility;

final assetApiRepositoryProvider = Provider(
  (ref) => AssetApiRepository(ref.watch(apiServiceProvider), () => ref.read(serverInfoProvider).serverVersion),
);

class AssetApiRepository extends ApiRepository {
  final ApiService _apiService;
  final SemVer Function() _getServerVersion;

  AssetApiRepository(this._apiService, this._getServerVersion);

  AssetsApi get _api => _apiService.assetsApi;
  StacksApi get _stacksApi => _apiService.stacksApi;
  TrashApi get _trashApi => _apiService.trashApi;

  Future<void> delete(List<String> ids, bool force) async {
    await _api.deleteAssets(AssetBulkDeleteDto(ids: ids, force: Optional.present(force)));
  }

  Future<void> restoreTrash(List<String> ids) async {
    await _trashApi.restoreAssets(BulkIdsDto(ids: ids));
  }

  Future<int> emptyTrash() async {
    final response = await _trashApi.emptyTrash();
    return response?.count ?? 0;
  }

  Future<int> restoreAllTrash() async {
    final response = await _trashApi.restoreTrash();
    return response?.count ?? 0;
  }

  // TODO(shenlong): remove after action migration
  Future<void> updateVisibility(List<String> ids, AssetVisibility visibility) async {
    await _api.updateAssets(AssetBulkUpdateDto(ids: ids, visibility: Optional.present(_mapVisibility(visibility))));
  }

  Future<StackResponse> stack(List<String> ids) async {
    final responseDto = await checkNull(_stacksApi.createStack(StackCreateDto(assetIds: ids)));

    return responseDto.toStack();
  }

  Future<void> unStack(List<String> ids) async {
    await _stacksApi.deleteStacks(BulkIdsDto(ids: ids));
  }

  Future<Response> downloadAsset(String id, {required bool edited}) {
    return _api.downloadAssetWithHttpInfo(id, edited: edited);
  }

  api.AssetVisibility _mapVisibility(AssetVisibility visibility) => switch (visibility) {
    AssetVisibility.timeline => api.AssetVisibility.timeline,
    AssetVisibility.hidden => api.AssetVisibility.hidden,
    AssetVisibility.locked => api.AssetVisibility.locked,
    AssetVisibility.archive => api.AssetVisibility.archive,
  };

  Future<String?> getAssetMIMEType(String assetId) async {
    final response = await checkNull(_api.getAssetInfo(assetId));

    // we need to get the MIME of the thumbnail once that gets added to the API
    return response.originalMimeType.orElse(null);
  }

  Future<void> updateDescription(String assetId, String description) {
    return _api.updateAsset(assetId, UpdateAssetDto(description: Optional.present(description)));
  }

  Future<void> updateRating(String assetId, int? rating) {
    return _api.updateAsset(assetId, UpdateAssetDto(rating: Optional.present(rating)));
  }

  Future<AssetEditsResponseDto?> editAsset(String assetId, List<AssetEdit> edits) {
    return _api.editAsset(assetId, AssetEditsCreateDto(edits: edits.map((e) => e.toApi()).toList()));
  }

  Future<void> removeEdits(String assetId) async {
    await _api.removeAssetEdits(assetId);
  }

  Future<void> update(
    List<String> remoteIds, {
    Option<bool> isFavorite = const .none(),
    Option<AssetVisibility> visibility = const .none(),
    Option<String> dateTimeOriginal = const .none(),
    Option<LatLng> location = const .none(),
  }) {
    return _api.updateAssets(
      AssetBulkUpdateDto(
        ids: remoteIds,
        isFavorite: isFavorite.toOptional(),
        visibility: visibility.map(_mapVisibility).toOptional(),
        dateTimeOriginal: dateTimeOriginal.toOptional(),
        latitude: location.map((loc) => loc.latitude).toOptional(),
        longitude: location.map((loc) => loc.longitude).toOptional(),
      ),
    );
  }

  // TODO(shenlong): remove after action migration
  // #763: favorites are per-user (not owner-gated), so they route through the dedicated
  // /assets/favorites endpoint rather than the owner-only bulk-update endpoint — but that
  // endpoint doesn't exist on fork servers <= 5.2.0 (mobile and server release independently, so
  // a newer app can talk to an older server). There, the request falls through to `PUT
  // /assets/:id` (id = "favorites") and 400s on UUID validation, breaking favoriting entirely,
  // owned assets included. Gate on the SAME boundary the sync stream uses for the equivalent
  // problem (sync_api.repository.dart): a fork server > 5.2.0 gets the canonical per-user
  // endpoint; anything <= 5.2.0 falls back to the legacy bulk-update endpoint below, which the
  // server still honours via a deprecated `isFavorite` alias that internally calls the same
  // per-user write path for assets the caller owns (server asset.service.ts
  // update/updateAll) — restoring pre-#763 owned-asset favoriting. A viewer favoriting someone
  // else's asset on an old server gets the old 403 (that alias requires Permission.AssetUpdate,
  // stricter than the canonical endpoint's AssetRead): an accepted degraded mode, since per-user
  // favorites didn't exist on that server anyway. Remove this fallback once the minimum
  // supported fork server version is > 5.2.0.
  Future<void> updateFavorite(List<String> ids, bool isFavorite) async {
    if (_getServerVersion() > const SemVer(major: 5, minor: 2, patch: 0)) {
      await _api.updateAssetFavorites(AssetFavoriteUpdateDto(ids: ids, isFavorite: isFavorite));
      return;
    }

    await _api.updateAssets(AssetBulkUpdateDto(ids: ids, isFavorite: Optional.present(isFavorite)));
  }

  Future<void> updateLocation(List<String> ids, LatLng location) async {
    return _api.updateAssets(
      AssetBulkUpdateDto(
        ids: ids,
        latitude: Optional.present(location.latitude),
        longitude: Optional.present(location.longitude),
      ),
    );
  }

  Future<void> updateDateTime(List<String> ids, String dateTime) async {
    return _api.updateAssets(AssetBulkUpdateDto(ids: ids, dateTimeOriginal: Optional.present(dateTime)));
  }
}

extension on StackResponseDto {
  StackResponse toStack() {
    return StackResponse(id: id, primaryAssetId: primaryAssetId, assetIds: assets.map((asset) => asset.id).toList());
  }
}

extension on AssetEdit {
  AssetEditActionItemDto toApi() {
    return switch (this) {
      CropEdit(:final parameters) => AssetEditActionItemDto(
        action: AssetEditAction.crop,
        parameters: parameters.toJson(),
      ),
      RotateEdit(:final parameters) => AssetEditActionItemDto(
        action: AssetEditAction.rotate,
        parameters: parameters.toJson(),
      ),
      MirrorEdit(:final parameters) => AssetEditActionItemDto(
        action: AssetEditAction.mirror,
        parameters: parameters.toJson(),
      ),
    };
  }
}
