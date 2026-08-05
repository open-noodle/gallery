import 'dart:async';

import 'package:immich_mobile/domain/services/remote_album.service.dart';

/// Fork-only: [RemoteAlbumService] with the Space-albums sync nudge attached.
///
/// An album linked to a Space is rendered from the Drift sync stream, not from the
/// album path's optimistic local write, so removing an asset leaves those surfaces
/// stale until the next sync. Upstream's `RemoveFromAlbumAction` has no completion
/// hook, and there are three separate remove-from-album surfaces — so the nudge sits
/// HERE, below the action layer, rather than at the call sites. A future rebase that
/// re-points a surface at some other action still gets the nudge; the regression this
/// fixes happened precisely because two call sites were re-pointed silently.
class SpaceSyncRemoteAlbumService extends RemoteAlbumService {
  SpaceSyncRemoteAlbumService(
    super.repository,
    super.albumApiRepository,
    super.uploadService, {
    required this.onAlbumMutated,
  });

  final Future<void> Function(String albumId) onAlbumMutated;

  /// Only [removeAssets] is overridden. `addAssets` already gets its nudge from
  /// `ActionNotifier.addToAlbum`; nudging here too would fire two syncs per add.
  @override
  Future<int> removeAssets({required String albumId, required List<String> assetIds}) async {
    final count = await super.removeAssets(albumId: albumId, assetIds: assetIds);
    if (count > 0) {
      // Deliberately NOT awaited. `syncRemote()` completes only when a full sync
      // round finishes, and upstream's action does `if (!context.mounted) return;`
      // immediately after this call — so awaiting would let a dismissed sheet skip
      // both the success toast and `clearSelection()`, stranding the user in
      // selection mode. The ordering that matters is already guaranteed: `super`
      // has awaited the server delete and the local Drift write before we fire.
      unawaited(onAlbumMutated(albumId));
    }
    return count;
  }
}
