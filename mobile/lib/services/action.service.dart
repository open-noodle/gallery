import 'dart:async';

import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/infrastructure/repositories/remote_asset.repository.dart';
import 'package:immich_mobile/providers/infrastructure/db.provider.dart';
import 'package:immich_mobile/repositories/asset_api.repository.dart';
import 'package:immich_mobile/repositories/shared_space_api.repository.dart';

final actionServiceProvider = Provider<ActionService>(
  (ref) => ActionService(
    ref.watch(assetApiRepositoryProvider),
    ref.watch(driftProvider).remoteAssetRepository,
    ref.watch(sharedSpaceApiRepositoryProvider),
  ),
);

class ActionService {
  final AssetApiRepository _assetApiRepository;
  final RemoteAssetRepository _remoteAssetRepository;
  final SharedSpaceApiRepository _sharedSpaceApiRepository;

  const ActionService(this._assetApiRepository, this._remoteAssetRepository, this._sharedSpaceApiRepository);

  /// Fork-only: removing an asset from a Space is NOT owner-scoped — an editor
  /// may remove another member's photo. Callers must resolve ids via
  /// `_getRemoteIdsForSource`, never `_getOwnedRemoteIdsForSource`.
  Future<int> removeFromSpace(List<String> remoteIds, String spaceId) async {
    await _sharedSpaceApiRepository.removeAssets(spaceId, remoteIds);
    return remoteIds.length;
  }

  Future<int> emptyTrash(String userId) async {
    final count = await _assetApiRepository.emptyTrash();
    await _remoteAssetRepository.emptyTrash(userId);
    return count;
  }

  Future<int> restoreAllTrash(String userId) async {
    final count = await _assetApiRepository.restoreAllTrash();
    await _remoteAssetRepository.restoreAllTrash(userId);
    return count;
  }

  Future<bool> updateDescription(String assetId, String description) async {
    // update remote first, then local to ensure consistency
    await _assetApiRepository.updateDescription(assetId, description);
    await _remoteAssetRepository.updateDescription(assetId, description);

    return true;
  }

  Future<bool> updateRating(String assetId, int? rating) async {
    // update remote first, then local to ensure consistency
    await _assetApiRepository.updateRating(assetId, rating);
    await _remoteAssetRepository.updateRating(assetId, rating);

    return true;
  }
}
