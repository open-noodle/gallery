import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/infrastructure/repositories/shared_space.repository.dart';
import 'package:immich_mobile/providers/asset_viewer/view_in_timeline_action.dart';
import 'package:immich_mobile/providers/gallery_nav/gallery_search_action.dart';
import 'package:immich_mobile/providers/infrastructure/shared_space.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';

/// The space whose timeline a "view in timeline" jump for [asset] should land on, or
/// null when the personal timeline is the right destination.
///
/// #1047: a memory can hold a photo the viewer only reaches through a Space. The
/// personal timeline carries such a photo only while that Space is shown in the
/// timeline, so the jump scrolled to the right date and showed nothing. A photo the
/// viewer owns is always in their own timeline, so it keeps going there — the same gate
/// the server applies before it resolves `resolvedSpaceId` for the web viewer.
Future<String?> viewInTimelineSpaceId({
  required BaseAsset asset,
  required String currentUserId,
  required SharedSpaceRepository repository,
}) async {
  if (asset is! RemoteAsset || asset.ownerId == currentUserId) {
    return null;
  }
  return repository.findSpaceIdForAsset(assetId: asset.id, userId: currentUserId);
}

/// Jumps from a memory to [asset]'s place in whichever timeline holds it: the Space's
/// own when the viewer only reaches the photo through a Space, the personal timeline
/// otherwise (#1047).
///
/// [goToMainTimeline] and [goToSpace] are injected so the routing can be tested without
/// a router. The space is resolved before anything is popped: it is a local read, and a
/// failure to resolve must not leave the viewer half-closed.
Future<void> viewMemoryAssetInTimeline({
  required BaseAsset asset,
  required ProviderReader read,
  required Future<void> Function() popViewer,
  required Future<void> Function() goToMainTimeline,
  required Future<void> Function(String spaceId) goToSpace,
}) async {
  final currentUserId = read(currentUserProvider)?.id;
  final spaceId = currentUserId == null
      ? null
      : await viewInTimelineSpaceId(
          asset: asset,
          currentUserId: currentUserId,
          repository: read(sharedSpaceRepositoryProvider),
        );

  await viewAssetInTimeline(
    asset: asset,
    read: read,
    popViewer: popViewer,
    goToTimeline: spaceId == null ? goToMainTimeline : () => goToSpace(spaceId),
    spaceId: spaceId,
  );
}
