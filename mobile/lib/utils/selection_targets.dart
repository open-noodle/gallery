import 'package:immich_mobile/constants/collection.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';

/// Whether the selection contains an asset the current user does not own.
///
/// `POST /shared-spaces/{id}/assets` requires `AssetShare` on **every** id and rejects
/// the whole request otherwise, so a single non-owned asset makes every space target
/// unusable. Local-only assets are not "non-owned": they upload as the current user's.
///
/// Fails **closed** when [currentUserId] is null — an unknown user gets no space targets
/// rather than a request certain to 400.
bool selectionHasNonOwned(Iterable<BaseAsset> assets, String? currentUserId) {
  if (currentUserId == null) {
    return assets.isNotEmpty;
  }
  return assets.any((asset) => asset is RemoteAsset && asset.ownerId != currentUserId);
}

/// Whether the selection contains a locked-folder asset.
///
/// Defensive: the locked folder is its own surface with its own bottom sheet, so such an
/// asset should not reach the picker today. If one ever did, pushing it into a shared
/// space would expose exactly what the user hid.
bool selectionHasLocked(Iterable<BaseAsset> assets) =>
    assets.any((asset) => asset is RemoteAsset && asset.visibility == AssetVisibility.locked);

/// Whether the selection is larger than one space-add request allows.
///
/// The cap is inclusive, so exactly [kMaxSpaceAssetsPerRequest] is fine.
bool selectionExceedsSpaceCap(Iterable<BaseAsset> assets) => assets.length > kMaxSpaceAssetsPerRequest;
