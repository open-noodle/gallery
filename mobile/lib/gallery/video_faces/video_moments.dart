import 'package:openapi/api.dart';

/// Where a face was in the frame at one moment, as fractions of the frame (specs/2026-10-31-video-face-frames-design.md).
class VideoMomentBox {
  final double x1;
  final double y1;
  final double x2;
  final double y2;

  const VideoMomentBox({required this.x1, required this.y1, required this.x2, required this.y2});

  @override
  bool operator ==(Object other) =>
      other is VideoMomentBox && other.x1 == x1 && other.y1 == y1 && other.x2 == x2 && other.y2 == y2;

  @override
  int get hashCode => Object.hash(x1, y1, x2, y2);
}

/// One moment a video face was seen: [time] in seconds on the player's timeline, as the server listed it.
class VideoMoment {
  final String faceId;
  final double time;
  final double score;
  final bool isBest;
  final VideoMomentBox box;

  const VideoMoment({
    required this.faceId,
    required this.time,
    required this.score,
    required this.isBest,
    required this.box,
  });

  factory VideoMoment.fromDto(String faceId, VideoFaceSightingDto dto) => VideoMoment(
    faceId: faceId,
    time: dto.time,
    score: dto.score,
    isBest: dto.isBest,
    box: VideoMomentBox(x1: dto.box.x1, y1: dto.box.y1, x2: dto.box.x2, y2: dto.box.y2),
  );

  /// Unique across faces: two faces of one person can be seen at the same time.
  String get key => '$faceId:$time';

  Duration get position => Duration(milliseconds: (time * 1000).round());
}

/// The moments of several faces of one person, in time order.
List<VideoMoment> mergeMoments(Iterable<List<VideoMoment>> perFace) =>
    perFace.expand((moments) => moments).toList()..sort((a, b) => a.time.compareTo(b.time));

/// The one moment a row stars: each face has a best view, and the row stars the one the detector was surest of.
String? starredMomentKey(List<VideoMoment> moments) {
  VideoMoment? top;
  for (final moment in moments) {
    if (moment.isBest && (top == null || moment.score > top.score)) {
      top = moment;
    }
  }
  return top?.key;
}

/// `0:42`, or `1:02:05` past an hour: how the player shows a time.
String formatMomentTime(double seconds) {
  final whole = seconds.floor();
  final hours = whole ~/ 3600;
  final minutes = (whole % 3600) ~/ 60;
  final secs = (whole % 60).toString().padLeft(2, '0');
  return hours > 0 ? '$hours:${minutes.toString().padLeft(2, '0')}:$secs' : '$minutes:$secs';
}

/// Whether the player has moved away from the moment a face box marks: a scrub, not the seek that placed it.
bool hasLeftMoment(Duration position, double momentTime) => (position.inMilliseconds / 1000 - momentTime).abs() > 2;
