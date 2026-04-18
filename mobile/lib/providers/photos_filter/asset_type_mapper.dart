import 'package:immich_mobile/entities/asset.entity.dart';
import 'package:openapi/api.dart';

/// Maps the mobile-side `AssetType` enum to the OpenAPI `AssetTypeEnum`.
/// `AssetType.other` and `null` both map to `null` — "no server-side
/// media-type constraint" (match all).
AssetTypeEnum? mapAssetType(AssetType? type) {
  if (type == null) return null;
  switch (type) {
    case AssetType.image:
      return AssetTypeEnum.IMAGE;
    case AssetType.video:
      return AssetTypeEnum.VIDEO;
    case AssetType.audio:
      return AssetTypeEnum.AUDIO;
    case AssetType.other:
      return null;
  }
}
