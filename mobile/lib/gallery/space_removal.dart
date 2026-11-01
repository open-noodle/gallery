import 'dart:async';

import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/repositories/shared_space_api.repository.dart';
import 'package:immich_mobile/services/toast.service.dart';
import 'package:logging/logging.dart';

/// What removing photos from a space did: the IDs the server removed, how many it left, and the linked albums that
/// hold the ones it left (none when a linked library brings them, null when the lookup failed).
typedef SpaceRemoval = ({List<String> removed, int kept, List<String>? albumNames});

final spaceRemovalServiceProvider = Provider<SpaceRemovalService>(
  (ref) => SpaceRemovalService(ref.watch(sharedSpaceApiRepositoryProvider)),
);

/// Removes photos from a space, from inside it or from the timeline, and finds out why some stayed.
class SpaceRemovalService {
  SpaceRemovalService(this._repository);

  final SharedSpaceApiRepository _repository;
  static final _log = Logger('SpaceRemovalService');

  /// Throws when the server refuses. A photo stays when it reaches the space through a linked album or library.
  Future<SpaceRemoval> remove(String spaceId, List<String> assetIds) async {
    final removed = await _repository.removeAssets(spaceId, assetIds);
    final removedIds = removed.toSet();
    final left = [
      for (final id in assetIds)
        if (!removedIds.contains(id)) id,
    ];
    if (left.isEmpty) {
      return (removed: removed, kept: 0, albumNames: const <String>[]);
    }

    List<String>? albumNames;
    try {
      albumNames = await _repository.linkedAlbumNames(spaceId, left);
    } catch (error, stack) {
      // Best effort, as on web: the message falls back to the general explanation.
      _log.warning('Could not look up the linked albums of the photos left in the space', error, stack);
    }
    return (removed: removed, kept: left.length, albumNames: albumNames);
  }
}

/// The message for a removal: how many went, or why the rest stayed.
String spaceRemovalMessage(Translations t, SpaceRemoval removal) {
  if (removal.kept == 0) {
    return t.assets_removed_count(count: removal.removed.length);
  }
  final albumNames = removal.albumNames;
  if (albumNames == null) {
    // The lookup failed: say what usually holds a photo back, as web does.
    return t.no_assets_removed_from_space;
  }
  if (albumNames.isNotEmpty) {
    return t.remove_from_space_album_blocked(count: removal.kept, albums: albumNames.join(', '));
  }
  return t.remove_from_space_library_blocked(count: removal.kept);
}

/// Tells the user what a removal did. Built without a context: the sheet that started it may be gone.
FutureOr<void> showSpaceRemovalToast(ToastService toast, SpaceRemoval removal) {
  final message = spaceRemovalMessage(StaticTranslations.instance, removal);
  if (removal.kept == 0) {
    return toast.success(message);
  }
  // Some photos stayed: the explanation is longer, and it is not a success.
  return toast.error(message, toast: const ToastOption(timeout: Duration(seconds: 6)));
}
