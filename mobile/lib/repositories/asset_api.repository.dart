import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/asset_edit.model.dart' hide AssetEditAction;
import 'package:immich_mobile/domain/models/stack.model.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/providers/server_info.provider.dart';
import 'package:immich_mobile/repositories/api.repository.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:immich_mobile/utils/option.dart';
import 'package:maplibre_gl/maplibre_gl.dart';
import 'package:openapi/api.dart' as api show AssetVisibility;
import 'package:openapi/api.dart' hide AssetVisibility;

final assetApiRepositoryProvider = Provider(
  (ref) => AssetApiRepository(
    ref.watch(apiServiceProvider),
    () => ref.read(serverInfoProvider).serverFeatures.syncRequestTypes,
  ),
);

class AssetApiRepository extends ApiRepository {
  final ApiService _apiService;
  // The sync request types the server declares (`GET /server/features`), or null when it
  // declares none / they are not known yet. See [updateFavorite].
  final Set<String>? Function() _getSupportedSyncTypes;

  AssetApiRepository(this._apiService, this._getSupportedSyncTypes);

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

  Future<StackResponse> stack(List<String> ids) async {
    final responseDto = await checkNull(_stacksApi.createStack(StackCreateDto(assetIds: ids)));

    return responseDto.toStack();
  }

  Future<void> unStack(List<String> ids) async {
    await _stacksApi.deleteStacks(BulkIdsDto(ids: ids));
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

  Future<String> getChecksum(String id) async {
    return (await checkNull(_api.getAssetInfo(id))).checksum;
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

  // #763: DO NOT pass `isFavorite` here. This posts an AssetBulkUpdateDto to the OWNER-ONLY
  // `PUT /assets`, but favorites are now a per-user overlay (`asset_favorite`) that a read-only
  // space Viewer may set on another member's asset — use `updateFavorite` below, which routes to
  // `PUT /assets/favorites` (and falls back for servers without that endpoint). The parameter survives
  // only because it is the upstream Immich shape; nothing passes it, and
  // test/policy/favorite_overlay_policy_test.dart fails if anything starts to.
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

  // #763: favorites are per-user (not owner-gated), so they route through the dedicated
  // /assets/favorites endpoint rather than the owner-only bulk-update endpoint — but no RELEASED
  // fork server has that endpoint (mobile and server release independently, so a newer app can
  // talk to an older server). There, the request falls through to `PUT /assets/:id` (id =
  // "favorites") and 400s on UUID validation, breaking favoriting entirely, owned assets
  // included. The reported version cannot gate this (PR RC images stamp the bare upstream base
  // version), so gate on the server's own capability declaration instead: the endpoint and the
  // `AssetFavoritesV1` sync request type ship together, and `GET /server/features` →
  // `syncRequestTypes` declares every request type the server accepts. Declared → the canonical
  // per-user endpoint. Anything else — not declared, a server that predates capability
  // signalling (null), or features not loaded yet / failed to load (null) — falls back to the
  // legacy bulk-update endpoint below, which every server honours via a deprecated `isFavorite`
  // alias that writes the per-user favorite for assets the caller owns (server asset.service.ts
  // update/updateAll). A viewer favoriting someone else's asset on such a server gets a 403 (that
  // alias requires Permission.AssetUpdate, stricter than the canonical endpoint's AssetRead): an
  // accepted degraded mode, since per-user favorites don't exist on that server anyway. The
  // declaration is read from the cached server features (serverInfoProvider), not fetched per tap.
  //
  // Upstream's action migration deleted the `updateLocation`/`updateDateTime`/`updateFavorite`
  // trio in favour of the consolidated `update` above; only this one is kept, because `update`
  // posts an AssetBulkUpdateDto to the OWNER-ONLY `PUT /assets`.
  Future<void> updateFavorite(List<String> ids, bool isFavorite) async {
    final supportedSyncTypes = _getSupportedSyncTypes();
    if (supportedSyncTypes != null && supportedSyncTypes.contains(SyncRequestType.assetFavoritesV1.toJson())) {
      await _api.updateAssetFavorites(AssetFavoriteUpdateDto(ids: ids, isFavorite: isFavorite));
      return;
    }

    await _api.updateAssets(AssetBulkUpdateDto(ids: ids, isFavorite: Optional.present(isFavorite)));
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
