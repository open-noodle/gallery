import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/gallery/video_faces/video_moments.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:openapi/api.dart';

// The faces API is built from the shared client every API class holds, so ApiService needs no faces API of its own.
final videoMomentsRepositoryProvider = Provider(
  (ref) => VideoMomentsRepository(FacesApi(ref.watch(apiServiceProvider).peopleApi.apiClient)),
);

/// A video's faces and their moments, read from the server on demand (specs/2026-10-31-video-face-frames-design.md,
/// Phase 3). Nothing here is synced: faces of a video and their sightings are fetched when its details open.
class VideoMomentsRepository {
  final FacesApi _api;

  const VideoMomentsRepository(this._api);

  /// The video's face ids, by the id of the person each belongs to; unassigned faces are left out.
  Future<Map<String, List<String>>> faceIdsByPerson(String assetId) async {
    final faces = await _api.getFaces(assetId) ?? const <AssetFaceResponseDto>[];
    final byPerson = <String, List<String>>{};
    for (final face in faces) {
      final personId = face.person?.id;
      if (personId != null) {
        (byPerson[personId] ??= []).add(face.id);
      }
    }
    return byPerson;
  }

  /// Whether the server lists moments: a face it just listed answers 404 only on a server without the route.
  Future<bool> supportsMoments(String faceId) async {
    try {
      await _api.getAssetFaceSightings(faceId);
      return true;
    } catch (_) {
      return false;
    }
  }

  /// Every moment of the faces, in time order. A face whose moments cannot be read contributes none.
  Future<List<VideoMoment>> moments(List<String> faceIds) async {
    final perFace = await Future.wait(
      faceIds.map((faceId) async {
        try {
          final response = await _api.getAssetFaceSightings(faceId);
          return (response?.sightings ?? const <VideoFaceSightingDto>[])
              .map((dto) => VideoMoment.fromDto(faceId, dto))
              .toList();
        } catch (_) {
          return const <VideoMoment>[];
        }
      }),
    );
    return mergeMoments(perFace);
  }

  /// The crop of one moment; the server finds it by the time it listed it at.
  static String thumbnailUrl(VideoMoment moment) =>
      '${Store.get(StoreKey.serverEndpoint)}/faces/${moment.faceId}/sightings/thumbnail?time=${moment.time}';
}
