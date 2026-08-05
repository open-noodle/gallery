import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/background_sync.provider.dart';
import 'package:immich_mobile/providers/infrastructure/space_album.provider.dart';
import 'package:logging/logging.dart';

final _logger = Logger('SpaceAlbumSyncNudge');

/// Fork: album views update through the album path's optimistic local write, but
/// space-album surfaces are fed by the sync stream — after mutating a linked album's
/// membership, nudge a sync so they converge now instead of at the next natural cycle.
/// Nothing else triggers one: opening a Space album page does not sync, so without
/// this the removed asset lingers until the app is next resumed.
///
/// Best-effort: a failed nudge never fails the mutation; the stream catches up later.
///
/// Callers decide whether to await it. [SpaceSyncRemoteAlbumService] deliberately
/// does NOT — see the note there.
Future<void> nudgeSpaceSyncIfLinked(Ref ref, String albumId) async {
  try {
    if (await ref.read(spaceAlbumRepositoryProvider).isAlbumLinked(albumId)) {
      await ref.read(backgroundSyncProvider).syncRemote();
    }
  } catch (error, stack) {
    _logger.warning('Failed to nudge sync after a linked-album mutation', error, stack);
  }
}
