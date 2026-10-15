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

/// A game round's photo, keyed by challenge + round index only — NEVER by asset id, so the client
/// never learns which asset a round shows until the player has guessed it.
///
/// Kept in one place because that shape is the security property: every caller must go through this
/// rather than build the URL, or a future one will reach for `/assets/:id` and quietly undo it.
/// `game_round_image_url_test.dart` enforces that there is exactly one construction site.
///
/// The generated `GamesApi.getRoundImage` is deliberately not used: it returns a `MultipartFile`,
/// which cannot feed an ImageProvider without buffering the whole body in Dart and bypassing the
/// native image cache. Auth is attached natively by HttpClientManager for any URL on the configured
/// server, so a plain URL through RemoteImageProvider authenticates.
String getGameRoundImageUrl(final String challengeId, final int index) {
  return '${Store.get(StoreKey.serverEndpoint)}/games/$challengeId/rounds/$index/image';
}
