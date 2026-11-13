import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/video_faces/video_moments.dart';
import 'package:immich_mobile/gallery/video_faces/video_moments.repository.dart';
import 'package:immich_mobile/providers/asset_viewer/video_player_provider.dart';

/// A video's face ids by person, or none on a server that does not list moments, which hides every badge (rule 6).
final videoFacesByPersonProvider = FutureProvider.autoDispose.family<Map<String, List<String>>, String>((
  ref,
  assetId,
) async {
  final repository = ref.watch(videoMomentsRepositoryProvider);
  final faces = await repository.faceIdsByPerson(assetId);
  if (faces.isEmpty) {
    return const {};
  }
  return await repository.supportsMoments(faces.values.first.first) ? faces : const {};
});

typedef VideoPersonSelection = ({String assetId, String personId, String name});

/// The person whose moments are open under the People row, with the video they were opened on.
final videoPersonSelectionProvider = StateProvider<VideoPersonSelection?>((ref) => null);

/// Every moment of one person in one video, across all their faces there.
final videoMomentsProvider = FutureProvider.autoDispose.family<List<VideoMoment>, ({String assetId, String personId})>((
  ref,
  key,
) async {
  final faces = await ref.watch(videoFacesByPersonProvider(key.assetId).future);
  return ref.watch(videoMomentsRepositoryProvider).moments(faces[key.personId] ?? const []);
});

typedef VideoFaceBoxState = ({String assetId, VideoMomentBox box, double time});

/// The face box drawn over a paused video at the moment a crop jumped to.
final videoFaceBoxProvider = StateProvider<VideoFaceBoxState?>((ref) => null);

/// Pauses the video at the moment, with the face boxed. The seek goes first: pausing flushes it at once.
Future<void> showVideoMoment(WidgetRef ref, String assetId, VideoMoment moment) async {
  final player = ref.read(videoPlayerProvider(assetId).notifier);
  player.seekTo(moment.position);
  await player.pause();
  ref.read(videoFaceBoxProvider.notifier).state = (assetId: assetId, box: moment.box, time: moment.time);
}

/// Closes the moments row, and the face box that belongs to it.
void closeVideoMoments(WidgetRef ref) {
  ref.read(videoPersonSelectionProvider.notifier).state = null;
  ref.read(videoFaceBoxProvider.notifier).state = null;
}
