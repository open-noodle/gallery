import 'dart:async';

import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/extensions/theme_extensions.dart';
import 'package:immich_mobile/gallery/video_faces/video_moments.dart';
import 'package:immich_mobile/gallery/video_faces/video_moments.providers.dart';
import 'package:immich_mobile/gallery/video_faces/video_moments.repository.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/widgets/images/remote_image_provider.dart';
import 'package:immich_mobile/providers/asset_viewer/video_player_provider.dart';

// A person's moments in a video, in the asset viewer's details (specs/2026-10-31-video-face-frames-design.md,
// Phase 3): a film badge on their picture opens a row of their moments under the People row, and a crop pauses the
// video there with the face boxed. View only; correcting moments is on the web.

/// The People row's [avatars], one per person of [people] in the same order, each with its film badge.
List<Widget> withVideoMomentsBadges(BaseAsset asset, List<Person> people, List<Widget> avatars) => [
  for (var i = 0; i < avatars.length; i++) VideoMomentsBadge(asset: asset, person: people[i], child: avatars[i]),
];

/// [child] (a People avatar) with a film badge on its top-left corner, on a video, for a person with a face in it.
/// The badge is its own tap target: tapping the picture still does what it did.
class VideoMomentsBadge extends ConsumerWidget {
  final BaseAsset asset;
  final Person person;
  final Widget child;

  const VideoMomentsBadge({super.key, required this.asset, required this.person, required this.child});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final asset = this.asset;
    if (asset is! RemoteAsset || !asset.isVideo) {
      return child;
    }

    final faces = ref.watch(videoFacesByPersonProvider(asset.id)).valueOrNull;
    if (faces == null || !faces.containsKey(person.id)) {
      return child;
    }

    final selected = ref.watch(
      videoPersonSelectionProvider.select((s) => s?.assetId == asset.id && s?.personId == person.id),
    );
    return Stack(
      clipBehavior: Clip.none,
      children: [
        child,
        Positioned(
          top: -6,
          left: -6,
          child: Semantics(
            button: true,
            selected: selected,
            label: '${context.t.video_person_sightings_show}: ${person.name}',
            child: GestureDetector(
              key: const ValueKey('video-moments-badge'),
              behavior: HitTestBehavior.opaque,
              onTap: () {
                if (selected) {
                  closeVideoMoments(ref);
                } else {
                  ref.read(videoFaceBoxProvider.notifier).state = null;
                  ref.read(videoPersonSelectionProvider.notifier).state = (
                    assetId: asset.id,
                    personId: person.id,
                    name: person.name,
                  );
                }
              },
              // A 40 px target around a 30 px badge.
              child: Padding(
                padding: const EdgeInsets.all(5),
                child: Container(
                  width: 30,
                  height: 30,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: selected ? context.primaryColor : Colors.black.withAlpha(150),
                    border: Border.all(color: Colors.white.withAlpha(200), width: 1.5),
                  ),
                  child: Icon(
                    Icons.movie_outlined,
                    size: 17,
                    color: selected ? context.colorScheme.onPrimary : Colors.white,
                  ),
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

/// The open person's moments, under the People row of the video they were opened on.
class VideoPersonMoments extends ConsumerStatefulWidget {
  final BaseAsset asset;

  const VideoPersonMoments({super.key, required this.asset});

  @override
  ConsumerState<VideoPersonMoments> createState() => _VideoPersonMomentsState();
}

class _VideoPersonMomentsState extends ConsumerState<VideoPersonMoments> {
  String? _activeKey;

  @override
  Widget build(BuildContext context) {
    final selection = ref.watch(videoPersonSelectionProvider);
    if (selection == null || selection.assetId != widget.asset.id) {
      return const SizedBox.shrink();
    }

    final moments = ref.watch(videoMomentsProvider((assetId: selection.assetId, personId: selection.personId)));
    return Padding(
      key: const ValueKey('video-person-moments'),
      padding: const EdgeInsets.only(left: 16, top: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  selection.name,
                  style: context.textTheme.labelLarge,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              IconButton(
                icon: const Icon(Icons.close),
                tooltip: context.t.close,
                onPressed: () => closeVideoMoments(ref),
              ),
            ],
          ),
          moments.when(
            data: (moments) => moments.isEmpty
                ? Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: Text(
                      context.t.video_person_sightings_none,
                      style: context.textTheme.bodyMedium?.copyWith(color: context.colorScheme.onSurfaceSecondary),
                    ),
                  )
                : _MomentsRow(
                    moments: moments,
                    activeKey: _activeKey,
                    onTap: (moment) {
                      setState(() => _activeKey = moment.key);
                      unawaited(showVideoMoment(ref, widget.asset.id, moment));
                    },
                  ),
            loading: () => const SizedBox(height: 112, child: Center(child: CircularProgressIndicator())),
            error: (_, _) => const SizedBox.shrink(),
          ),
        ],
      ),
    );
  }
}

class _MomentsRow extends StatelessWidget {
  final List<VideoMoment> moments;
  final String? activeKey;
  final ValueChanged<VideoMoment> onTap;

  const _MomentsRow({required this.moments, required this.activeKey, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final starred = starredMomentKey(moments);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          context.t.video_face_sightings_count(count: moments.length),
          style: context.textTheme.bodySmall?.copyWith(color: context.colorScheme.onSurfaceSecondary),
        ),
        const SizedBox(height: 8),
        SizedBox(
          height: 92,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.only(right: 16),
            itemCount: moments.length,
            separatorBuilder: (_, _) => const SizedBox(width: 8),
            itemBuilder: (context, index) {
              final moment = moments[index];
              return _MomentTile(
                moment: moment,
                active: moment.key == activeKey,
                starred: moment.key == starred,
                onTap: () => onTap(moment),
              );
            },
          ),
        ),
      ],
    );
  }
}

class _MomentTile extends StatelessWidget {
  final VideoMoment moment;
  final bool active;
  final bool starred;
  final VoidCallback onTap;

  const _MomentTile({required this.moment, required this.active, required this.starred, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final label = formatMomentTime(moment.time);
    return Semantics(
      button: true,
      selected: active,
      label: context.t.video_face_sightings_show_at(time: label),
      child: GestureDetector(
        key: ValueKey('video-moment-${moment.key}'),
        onTap: onTap,
        child: Column(
          children: [
            Container(
              width: 64,
              height: 64,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: active ? context.primaryColor : Colors.transparent, width: 2),
              ),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(8),
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    Image(
                      image: RemoteImageProvider(url: VideoMomentsRepository.thumbnailUrl(moment)),
                      fit: BoxFit.cover,
                      errorBuilder: (_, _, _) => ColoredBox(color: context.colorScheme.surfaceContainerHighest),
                    ),
                    if (starred)
                      const Positioned(
                        top: 3,
                        right: 3,
                        child: DecoratedBox(
                          key: ValueKey('video-moment-best'),
                          decoration: BoxDecoration(color: Colors.black54, shape: BoxShape.circle),
                          child: Padding(
                            padding: EdgeInsets.all(2),
                            child: Icon(Icons.star, size: 12, color: Colors.amber),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 4),
            Text(
              label,
              style: context.textTheme.bodySmall?.copyWith(fontFeatures: const [FontFeature.tabularFigures()]),
            ),
          ],
        ),
      ),
    );
  }
}

/// The face box over a paused video, inside the viewer's stack, which is sized to the video itself, so the box is the
/// moment's frame fractions of it. It goes when the video plays or moves away from the moment, or the row closes.
class VideoFaceBoxOverlay extends ConsumerWidget {
  final String assetId;

  const VideoFaceBoxOverlay({super.key, required this.assetId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    ref.listen(videoPlayerProvider(assetId), (previous, next) {
      final shown = ref.read(videoFaceBoxProvider);
      if (shown == null || shown.assetId != assetId) {
        return;
      }
      final startedPlaying =
          previous?.status != VideoPlaybackStatus.playing && next.status == VideoPlaybackStatus.playing;
      if (startedPlaying || hasLeftMoment(next.position, shown.time)) {
        ref.read(videoFaceBoxProvider.notifier).state = null;
      }
    });

    final shown = ref.watch(videoFaceBoxProvider);
    final open = ref.watch(videoPersonSelectionProvider.select((s) => s?.assetId == assetId));
    final visible = shown != null && shown.assetId == assetId && open;
    return Positioned.fill(
      child: IgnorePointer(
        child: visible
            ? CustomPaint(key: const ValueKey('video-face-box'), painter: VideoFaceBoxPainter(shown.box))
            : const SizedBox.shrink(),
      ),
    );
  }
}

/// A white rounded box around the face and the rest of the picture dimmed, as a photo marks a highlighted face.
class VideoFaceBoxPainter extends CustomPainter {
  final VideoMomentBox box;

  const VideoFaceBoxPainter(this.box);

  /// The face's rectangle in a picture of [size].
  Rect faceRect(Size size) =>
      Rect.fromLTRB(box.x1 * size.width, box.y1 * size.height, box.x2 * size.width, box.y2 * size.height);

  @override
  void paint(Canvas canvas, Size size) {
    final face = RRect.fromRectAndRadius(faceRect(size), const Radius.circular(8));
    final dim = Path()
      ..fillType = PathFillType.evenOdd
      ..addRect(Offset.zero & size)
      ..addRRect(face);
    canvas.drawPath(dim, Paint()..color = Colors.black.withAlpha(102));
    canvas.drawRRect(
      face,
      Paint()
        ..color = Colors.white
        ..style = PaintingStyle.stroke
        ..strokeWidth = 3,
    );
  }

  @override
  bool shouldRepaint(VideoFaceBoxPainter oldDelegate) => oldDelegate.box != box;
}
