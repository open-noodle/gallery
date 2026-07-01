import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:openapi/api.dart';

String getOriginalUrlForRemoteId(final String id, {bool edited = true}) {
  return '${Store.get(StoreKey.serverEndpoint)}/assets/$id/original?edited=$edited';
}

String getThumbnailUrlForRemoteId(
  final String id, {
  AssetMediaSize type = AssetMediaSize.thumbnail,
  bool edited = true,
  String? thumbhash,
}) {
  final url = '${Store.get(StoreKey.serverEndpoint)}/assets/$id/thumbnail?size=$type&edited=$edited';
  return thumbhash != null ? '$url&c=${Uri.encodeComponent(thumbhash)}' : url;
}

String getPlaybackUrlForRemoteId(final String id) {
  return '${Store.get(StoreKey.serverEndpoint)}/assets/$id/video/playback?';
}

String getFaceThumbnailUrl(final String personId, {DateTime? updatedAt}) {
  final url = '${Store.get(StoreKey.serverEndpoint)}/people/$personId/thumbnail';
  return updatedAt != null ? '$url?c=${updatedAt.millisecondsSinceEpoch}' : url;
}

/// Thumbnail for a Space-scoped person. Its [personId] is a `shared_space_person` id with no
/// row in the owner-only `person` table, so `getFaceThumbnailUrl` (GET /people/{id}/thumbnail)
/// 404s for it. This routes to the membership-gated space endpoint instead, mirroring the web
/// People page (`getGlobalPersonThumbnailUrl`).
String getSpacePersonThumbnailUrl(final String spaceId, final String personId, {DateTime? updatedAt}) {
  final url = '${Store.get(StoreKey.serverEndpoint)}/shared-spaces/$spaceId/people/$personId/thumbnail';
  return updatedAt != null ? '$url?c=${updatedAt.millisecondsSinceEpoch}' : url;
}

/// Selects the correct thumbnail URL for a person by profile scope: a Space-scoped person
/// (non-null [spaceId]) routes to the space endpoint, a personal/owned person to the owner
/// endpoint. Mirrors the web `getGlobalPersonThumbnailUrl`.
String getPersonThumbnailUrl(final String personId, {final String? spaceId, final DateTime? updatedAt}) {
  return spaceId == null
      ? getFaceThumbnailUrl(personId, updatedAt: updatedAt)
      : getSpacePersonThumbnailUrl(spaceId, personId, updatedAt: updatedAt);
}
