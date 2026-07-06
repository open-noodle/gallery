import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/utils/background_sync.dart';
import 'package:immich_mobile/providers/background_sync.provider.dart';
import 'package:immich_mobile/repositories/drift_album_api_repository.dart';
import 'package:immich_mobile/repositories/shared_space_api.repository.dart';

/// Centralises the space-album mutation operations:
///   - [link]           — PUT  /shared-spaces/{id}/albums/{albumId} (one or more)
///   - [unlink]         — DELETE /shared-spaces/{id}/albums/{albumId}
///   - [toggleTimeline] — PATCH  /shared-spaces/{id}/albums/{albumId}
///   - [addAssets]      — PUT  /albums/{albumId}/assets (server-only)
///
/// Each operation calls the API repo, fires the sync-nudge
/// (`BackgroundSyncManager.syncRemote()`), then returns.
/// On API failure the exception propagates to the caller (the page is
/// responsible for showing the error toast and catching the exception).
///
/// The nudge is NOT fired when the API call throws — failure on the first
/// album in a batch aborts the whole operation (fail-fast). The caller shows
/// an error toast; the sync will catch up on the next regular cycle.
class SpaceAlbumActions {
  SpaceAlbumActions({required this._repo, required this._albumApiRepo, required this._syncManager});

  final SharedSpaceApiRepository _repo;
  final DriftAlbumApiRepository _albumApiRepo;
  final BackgroundSyncManager _syncManager;

  /// Link one or more albums to a space.
  ///
  /// Calls PUT for each albumId sequentially. On success fires one sync-nudge.
  /// If [albumIds] is empty, does nothing (no API call, no nudge).
  Future<void> link(String spaceId, List<String> albumIds) async {
    if (albumIds.isEmpty) return;
    for (final albumId in albumIds) {
      await _repo.linkAlbum(spaceId, albumId);
    }
    await _syncManager.syncRemote();
  }

  /// Unlink a single album from a space.
  Future<void> unlink(String spaceId, String albumId) async {
    await _repo.unlinkAlbum(spaceId, albumId);
    await _syncManager.syncRemote();
  }

  /// Toggle the `showInTimeline` flag for a space-album link.
  ///
  /// Pass [current] as the album's current `showInTimeline` value; the method
  /// sends the inverse.
  Future<void> toggleTimeline(String spaceId, String albumId, {required bool current}) async {
    await _repo.updateAlbumLink(spaceId, albumId, showInTimeline: !current);
    await _syncManager.syncRemote();
  }

  /// Add assets to a linked album via the **server-only** REST path.
  ///
  /// A linked album may be "absorbed" — present only in `shared_space_album`
  /// with no local `remote_album` row — so the personal-album add path (which
  /// also writes the local `remote_album_asset` junction) would hit a foreign
  /// key violation. This routes through [DriftAlbumApiRepository.addAssets]
  /// (the REST add only) and then nudges sync; the server is the source of
  /// truth and `spaceAlbum()`'s Drift watch surfaces the new assets.
  ///
  /// Returns the number of assets the server actually added. If [assetIds] is
  /// empty, does nothing (no API call, no nudge). On API failure the exception
  /// propagates and the nudge is skipped (fail-fast).
  Future<int> addAssets(String albumId, List<String> assetIds) async {
    if (assetIds.isEmpty) return 0;
    final result = await _albumApiRepo.addAssets(albumId, assetIds);
    await _syncManager.syncRemote();
    return result.added.length;
  }
}

/// Provider for [SpaceAlbumActions].
///
/// Override [sharedSpaceApiRepositoryProvider] and [backgroundSyncProvider] in
/// tests to inject mocks.
final spaceAlbumActionsProvider = Provider<SpaceAlbumActions>((ref) {
  return SpaceAlbumActions(
    repo: ref.watch(sharedSpaceApiRepositoryProvider),
    albumApiRepo: ref.watch(driftAlbumApiRepositoryProvider),
    syncManager: ref.watch(backgroundSyncProvider),
  );
});
