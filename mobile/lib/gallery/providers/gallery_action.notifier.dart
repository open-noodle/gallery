part of 'package:immich_mobile/providers/infrastructure/action.provider.dart';

/// Fork actions of [ActionNotifier]: Space destinations and album removal. A mixin in a part, so it
/// reaches the notifier's private helpers and a subclass (tests) can still override its methods.
mixin _GalleryActionNotifier on Notifier<void> {
  // Only ActionNotifier applies this library-private mixin.
  ActionNotifier get _notifier => this as ActionNotifier;

  /// Guards against a second destination being dispatched while one is in flight —
  /// two taps in a picker would otherwise fire two adds and two sync nudges.
  bool _spaceAddInFlight = false;

  /// Add the selection to a space's own asset pool.
  ///
  /// Reports the REQUEST length: `POST /shared-spaces/{id}/assets` is 204 with no body,
  /// so there is no server-side count to report (web does the same).
  Future<ActionResult> addToSpace(ActionSource source, SharedSpaceResponseDto space) {
    return _addToSpaceTarget(source, (ids) async {
      await ref.read(sharedSpaceApiRepositoryProvider).addAssets(space.id, ids);
      return ids.length;
    });
  }

  /// Add the selection to an album linked to a space.
  ///
  /// Routed through [SpaceAlbumActions] rather than [addToAlbum]: a linked album may be
  /// "absorbed" (no local `remote_album` row) and the album path also writes the local
  /// junction, which would throw on the foreign key. Returns the server's true count,
  /// which already excludes assets the album had.
  Future<ActionResult> addToSpaceAlbum(ActionSource source, String spaceId, SpaceAlbum album) async {
    final result = await _addToSpaceTarget(
      source,
      (ids) => ref.read(spaceAlbumActionsProvider).addAssets(album.id, ids),
    );
    if (result.success) {
      ref.invalidate(spaceAlbumsProvider(spaceId));
    }
    return result;
  }

  /// Shared body for both space destinations.
  ///
  /// Local assets are uploaded first and then added in a SINGLE call — one call per
  /// asset would fire `SpaceAlbumActions`' `syncRemote()` nudge once per photo.
  /// A partial upload still adds what succeeded: stranding uploaded photos the user
  /// asked to file would be worse than a partial-success result.
  Future<ActionResult> _addToSpaceTarget(ActionSource source, Future<int> Function(List<String> remoteIds) add) async {
    if (_spaceAddInFlight) {
      return const ActionResult(count: 0, success: false);
    }
    _spaceAddInFlight = true;
    try {
      final selected = _notifier._getAssets(source).toList(growable: false);
      if (selected.isEmpty) {
        return const ActionResult(count: 0, success: true);
      }

      final candidates = RemoteAlbumService.categorizeCandidates(selected);
      final remoteIds = [...candidates.remoteAssetIds];
      final localAssets = candidates.localAssetsToUpload;

      ActionResult? uploadResult;
      if (localAssets.isNotEmpty) {
        final uploaded = <String>[];
        uploadResult = await _notifier.upload(
          source,
          assets: localAssets,
          onAssetUploaded: (asset, remoteId) => uploaded.add(remoteId),
        );
        remoteIds.addAll(uploaded);
      }

      if (remoteIds.isEmpty) {
        // Every asset was local and none uploaded — nothing to add.
        return ActionResult(count: 0, success: false, error: uploadResult?.error);
      }

      final int added;
      try {
        added = await add(remoteIds);
      } catch (error, stack) {
        _notifier._logger.severe('Failed to add assets to space target', error, stack);
        return ActionResult(count: 0, success: false, error: error.toString());
      }

      // Only a fully successful run clears the selection, so a partial upload leaves
      // the photos selected for retry. This deliberately differs from addToAlbum,
      // which resets before its upload and so clears even when the upload fails.
      final fullSuccess = uploadResult?.success ?? true;
      if (fullSuccess && source == ActionSource.timeline) {
        ref.read(multiSelectProvider.notifier).reset();
      }
      return ActionResult(count: added, success: fullSuccess, error: uploadResult?.error);
    } finally {
      _spaceAddInFlight = false;
    }
  }

  Future<ActionResult> removeFromAlbum(ActionSource source, String albumId) async {
    final ids = _notifier._getRemoteIdsForSource(source);
    try {
      final removedCount = await _notifier._service.removeFromAlbum(ids, albumId);
      if (removedCount > 0) {
        await nudgeSpaceSyncIfLinked(ref, albumId);
      }
      return ActionResult(count: removedCount, success: true);
    } catch (error, stack) {
      _notifier._logger.severe('Failed to remove assets from album', error, stack);
      return ActionResult(count: ids.length, success: false, error: error.toString());
    }
  }

  Future<ActionResult> removeFromSpace(ActionSource source, String spaceId) async {
    // Removing from a Space is NOT owner-scoped: an editor may remove another
    // member's photo. Must stay _getRemoteIdsForSource, never the owned variant.
    final ids = _notifier._getRemoteIdsForSource(source);
    try {
      final removedCount = await _notifier._service.removeFromSpace(ids, spaceId);
      return ActionResult(count: removedCount, success: true);
    } catch (error, stack) {
      _notifier._logger.severe('Failed to remove assets from space', error, stack);
      return ActionResult(count: ids.length, success: false, error: error.toString());
    }
  }
}
