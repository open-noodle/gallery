import 'dart:async';

import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_marks.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_overview_bits.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/widgets/images/remote_image_provider.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:immich_mobile/utils/bytes_units.dart';
import 'package:immich_mobile/utils/image_url_builder.dart';
import 'package:native_video_player/native_video_player.dart';
import 'package:openapi/api.dart';

/// The mark colours, shared by the stamps, the buttons and the finish screen (the web's success, pink and danger).
const libraryCleanupKeepColor = Color(0xFF2FBF71);
const libraryCleanupFavoriteColor = Color(0xFFFF4D8D);
const libraryCleanupTrashColor = Color(0xFFFF5A6A);
const libraryCleanupCardRadius = 22.0;

Color libraryCleanupMarkColor(LibraryCleanupMark mark) => switch (mark) {
  LibraryCleanupMark.keep => libraryCleanupKeepColor,
  LibraryCleanupMark.favorite => libraryCleanupFavoriteColor,
  LibraryCleanupMark.trash => libraryCleanupTrashColor,
};

/// A cleanup photo's preview, the size the deck shows (the thumbnail sits under it until it lands).
ImageProvider libraryCleanupPreview(CleanupAssetDto asset) => RemoteImageProvider(
  url: getThumbnailUrlForRemoteId(asset.id, type: AssetMediaSize.preview, thumbhash: asset.thumbhash),
);

/// What the card's info strip says first: the rewind's "2019 · 7 years ago", or a queue's date; then the city and time.
class LibraryCleanupCardInfo {
  const LibraryCleanupCardInfo({required this.headline, this.detail, this.badge, this.signal, this.whole = false});

  final String headline;
  final String? detail;

  /// A queue's badge in the card's top corner (Blurry's reason).
  final Widget? badge;

  /// A queue's signal in the info strip, above the chips (Blurry's sharpness bar, Space hogs' size).
  final Widget? signal;

  /// The photo is shown whole at its own aspect ratio on a neutral background, never cropped (Screenshots).
  final bool whole;
}

/// The shape a photo is shown whole at: its own, or a phone screen's 9:19.5 when the server has no dimensions (as the
/// web's `QueueSelectGrid`).
double libraryCleanupAspectRatio(CleanupAssetDto asset) {
  final width = asset.width;
  final height = asset.height;
  return width != null && height != null && width > 0 && height > 0 ? width / height : 9 / 19.5;
}

/// The neutral background a whole photo sits on.
const libraryCleanupWholeBackground = Color(0xFF1A1D25);

/// Plays a video inline, muted. A provider so tests, which have no platform video view, can stand in for it.
final libraryCleanupInlineVideoProvider = Provider<Widget Function(CleanupAssetDto asset)>(
  (ref) =>
      (asset) => LibraryCleanupInlineVideo(asset: asset),
);

/// One photo in the deck: the photo, the stamps a drag is showing, and the info strip.
class LibraryCleanupDeckCard extends ConsumerStatefulWidget {
  const LibraryCleanupDeckCard({
    super.key,
    required this.asset,
    required this.info,
    this.stamps = const {},
    this.heroTag,
    this.onDetails,
    this.edgeToEdge = false,
    this.mark,
    this.infoBottomInset = 0,
  });

  final CleanupAssetDto asset;
  final LibraryCleanupCardInfo info;

  /// How far each stamp has faded in (1 at the threshold).
  final Map<LibraryCleanupMark, double> stamps;
  final String? heroTag;
  final VoidCallback? onDetails;

  /// Button mode: no rounded card, the photo fills the body.
  final bool edgeToEdge;

  /// Button mode shows the mark a photo already has.
  final LibraryCleanupMark? mark;

  /// Room left under the info strip (button mode's floating bar).
  final double infoBottomInset;

  @override
  ConsumerState<LibraryCleanupDeckCard> createState() => _LibraryCleanupDeckCardState();
}

class _LibraryCleanupDeckCardState extends ConsumerState<LibraryCleanupDeckCard> {
  bool _playing = false;

  @override
  Widget build(BuildContext context) {
    final asset = widget.asset;
    final isVideo = asset.type == AssetTypeEnum.VIDEO;
    final photo = Image(
      image: libraryCleanupPreview(asset),
      fit: BoxFit.cover,
      width: double.infinity,
      height: double.infinity,
      gaplessPlayback: true,
      frameBuilder: (context, child, frame, sync) => frame == null && !sync ? _thumbnail(asset) : child,
      errorBuilder: (_, _, _) => _thumbnail(asset),
    );
    final hero = widget.heroTag;
    final picture = _playing
        ? KeyedSubtree(
            key: Key('cleanup-card-video-${asset.id}'),
            child: ref.watch(libraryCleanupInlineVideoProvider)(asset),
          )
        : hero == null
        ? photo
        : Hero(tag: hero, child: photo);

    final strongest = widget.stamps.entries
        .where((e) => e.value > 0)
        .fold<MapEntry<LibraryCleanupMark, double>?>(
          null,
          (best, e) => best == null || e.value > best.value ? e : best,
        );

    final info = widget.info;
    final body = Stack(
      fit: StackFit.expand,
      children: [
        ColoredBox(color: info.whole ? libraryCleanupWholeBackground : Colors.black),
        if (info.whole)
          // Uncropped at its own shape, clear of the info strip, so a screenshot's text can be read.
          Padding(
            key: Key('cleanup-card-whole-${asset.id}'),
            padding: EdgeInsets.fromLTRB(14, 14, 14, 112 + widget.infoBottomInset),
            child: Center(
              child: AspectRatio(
                aspectRatio: libraryCleanupAspectRatio(asset),
                child: ClipRRect(borderRadius: BorderRadius.circular(12), child: picture),
              ),
            ),
          )
        else
          picture,
        // The departing card tints towards its mark.
        if (strongest != null)
          IgnorePointer(
            child: ColoredBox(color: libraryCleanupMarkColor(strongest.key).withValues(alpha: 0.18 * strongest.value)),
          ),
        for (final MapEntry(key: mark, value: amount) in widget.stamps.entries)
          if (amount > 0.12) _Stamp(mark: mark, opacity: ((amount - 0.12) / 0.88).clamp(0.0, 1.0)),
        if (widget.mark != null || info.badge != null)
          Positioned(
            top: 14,
            left: 14,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (widget.mark != null) _MarkLabel(mark: widget.mark!),
                if (widget.mark != null && info.badge != null) const SizedBox(height: 6),
                ?info.badge,
              ],
            ),
          ),
        Positioned(
          left: 0,
          right: 0,
          bottom: 0,
          child: _InfoStrip(
            asset: asset,
            info: widget.info,
            bottomInset: widget.infoBottomInset,
            onDetails: widget.onDetails,
            onPlay: isVideo && !_playing ? () => setState(() => _playing = true) : null,
          ),
        ),
      ],
    );
    if (widget.edgeToEdge) {
      return body;
    }
    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(libraryCleanupCardRadius),
        boxShadow: const [BoxShadow(color: Color(0x55000000), blurRadius: 24, offset: Offset(0, 10))],
      ),
      child: ClipRRect(borderRadius: BorderRadius.circular(libraryCleanupCardRadius), child: body),
    );
  }

  Widget _thumbnail(CleanupAssetDto asset) => Image(
    image: libraryCleanupThumbnail(asset),
    fit: BoxFit.cover,
    width: double.infinity,
    height: double.infinity,
    gaplessPlayback: true,
    errorBuilder: (_, _, _) => const SizedBox.expand(),
  );
}

/// "KEEP", "TRASH" or "♥", stamped on the card as a drag passes its threshold.
class _Stamp extends StatelessWidget {
  const _Stamp({required this.mark, required this.opacity});

  final LibraryCleanupMark mark;
  final double opacity;

  @override
  Widget build(BuildContext context) {
    final color = libraryCleanupMarkColor(mark);
    final (alignment, angle, text) = switch (mark) {
      LibraryCleanupMark.keep => (Alignment.topLeft, -0.21, context.t.keep.toUpperCase()),
      LibraryCleanupMark.trash => (Alignment.topRight, 0.21, context.t.trash.toUpperCase()),
      LibraryCleanupMark.favorite => (Alignment.topCenter, 0.0, '♥'),
    };
    return IgnorePointer(
      child: Align(
        alignment: alignment,
        child: Padding(
          padding: const EdgeInsets.all(22),
          child: Opacity(
            opacity: opacity,
            child: Transform.rotate(
              angle: angle,
              child: Container(
                key: Key('cleanup-stamp-${mark.name}'),
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 2),
                decoration: BoxDecoration(
                  border: Border.all(color: color, width: 3),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  text,
                  style: TextStyle(color: color, fontSize: 26, fontWeight: FontWeight.w900, letterSpacing: 1.2),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Button mode: the mark a photo has, in its corner.
class _MarkLabel extends StatelessWidget {
  const _MarkLabel({required this.mark});

  final LibraryCleanupMark mark;

  @override
  Widget build(BuildContext context) {
    final t = context.t;
    final (icon, label) = switch (mark) {
      LibraryCleanupMark.keep => (Icons.check_rounded, t.keep),
      LibraryCleanupMark.favorite => (Icons.favorite_rounded, t.favorite),
      LibraryCleanupMark.trash => (Icons.delete_outline_rounded, t.trash),
    };
    return Container(
      key: Key('cleanup-mark-label-${mark.name}'),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(color: libraryCleanupMarkColor(mark), borderRadius: BorderRadius.circular(999)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: Colors.white),
          const SizedBox(width: 4),
          Text(
            label,
            style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
  }
}

/// How far up (logical pixels), or how fast, a drag on the info strip must go to open the details.
const _detailsDrag = 24.0;
const _detailsFling = 300.0;

/// The card's bottom: the headline, the city and time, and the chips (size, "In an album", details). A video adds
/// ▶ and its duration. Dragging it upwards opens the details, where the rest of the card's upward drag favourites.
class _InfoStrip extends StatefulWidget {
  const _InfoStrip({
    required this.asset,
    required this.info,
    required this.bottomInset,
    required this.onDetails,
    required this.onPlay,
  });

  final CleanupAssetDto asset;
  final LibraryCleanupCardInfo info;
  final double bottomInset;
  final VoidCallback? onDetails;
  final VoidCallback? onPlay;

  @override
  State<_InfoStrip> createState() => _InfoStripState();
}

class _InfoStripState extends State<_InfoStrip> {
  double _dragged = 0;

  void _onDragEnd(DragEndDetails details) {
    final open = _dragged < -_detailsDrag || (details.primaryVelocity ?? 0) < -_detailsFling;
    _dragged = 0;
    if (open) {
      widget.onDetails?.call();
    }
  }

  @override
  Widget build(BuildContext context) {
    final onDetails = widget.onDetails;
    final strip = _strip(context);
    if (onDetails == null) {
      return strip;
    }
    return GestureDetector(
      key: Key('cleanup-card-info-${widget.asset.id}'),
      behavior: HitTestBehavior.opaque,
      onVerticalDragStart: (_) => _dragged = 0,
      onVerticalDragUpdate: (details) => _dragged += details.delta.dy,
      onVerticalDragEnd: _onDragEnd,
      onVerticalDragCancel: () => _dragged = 0,
      child: strip,
    );
  }

  Widget _strip(BuildContext context) {
    final t = context.t;
    final asset = widget.asset;
    final info = widget.info;
    final onPlay = widget.onPlay;
    final onDetails = widget.onDetails;
    final duration = asset.duration;
    return DecoratedBox(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Color(0x00000000), Color(0xD9000000)],
        ),
      ),
      child: Padding(
        padding: EdgeInsets.fromLTRB(16, 40, 16, 14 + widget.bottomInset),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            if (onPlay != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: Material(
                  color: Colors.white.withValues(alpha: 0.2),
                  shape: const StadiumBorder(),
                  child: InkWell(
                    key: Key('cleanup-card-play-${asset.id}'),
                    customBorder: const StadiumBorder(),
                    onTap: onPlay,
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(8, 4, 12, 4),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.play_arrow_rounded, color: Colors.white, semanticLabel: t.play),
                          if (duration != null)
                            Text(_formatDuration(duration), style: const TextStyle(color: Colors.white, fontSize: 13)),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            Text(
              info.headline,
              key: Key('cleanup-card-headline-${asset.id}'),
              style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w700),
            ),
            if (info.detail != null)
              Text(info.detail!, style: TextStyle(color: Colors.white.withValues(alpha: 0.85), fontSize: 13)),
            if (info.signal != null) Padding(padding: const EdgeInsets.only(top: 6), child: info.signal),
            const SizedBox(height: 8),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                _Chip(label: formatBytes(asset.fileSize.round())),
                if (asset.inAlbum) _Chip(key: Key('cleanup-chip-album-${asset.id}'), label: t.cleanup_chip_in_album),
                _Chip(
                  key: Key('cleanup-chip-details-${asset.id}'),
                  label: 'ⓘ ${t.details}',
                  onTap: onDetails,
                  muted: onDetails == null,
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  static String _formatDuration(double seconds) {
    final total = seconds.round();
    final minutes = total ~/ 60;
    final rest = (total % 60).toString().padLeft(2, '0');
    return minutes >= 60 ? '${minutes ~/ 60}:${(minutes % 60).toString().padLeft(2, '0')}:$rest' : '$minutes:$rest';
  }
}

class _Chip extends StatelessWidget {
  const _Chip({super.key, required this.label, this.onTap, this.muted = false});

  final String label;
  final VoidCallback? onTap;
  final bool muted;

  @override
  Widget build(BuildContext context) => Material(
    color: Colors.white.withValues(alpha: muted ? 0.08 : 0.16),
    shape: const StadiumBorder(),
    child: InkWell(
      customBorder: const StadiumBorder(),
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
        child: Text(
          label,
          style: TextStyle(color: Colors.white.withValues(alpha: muted ? 0.6 : 0.95), fontSize: 12),
        ),
      ),
    ),
  );
}

/// A video on its card, playing muted and looping, from the server's playback stream.
class LibraryCleanupInlineVideo extends StatefulWidget {
  const LibraryCleanupInlineVideo({super.key, required this.asset});

  final CleanupAssetDto asset;

  @override
  State<LibraryCleanupInlineVideo> createState() => _LibraryCleanupInlineVideoState();
}

class _LibraryCleanupInlineVideoState extends State<LibraryCleanupInlineVideo> {
  NativeVideoPlayerController? _controller;

  Future<void> _ready(NativeVideoPlayerController controller) async {
    _controller = controller;
    try {
      final source = await VideoSource.init(
        path: '${Store.get(StoreKey.serverEndpoint)}/assets/${widget.asset.id}/video/playback',
        type: VideoSourceType.network,
        headers: ApiService.getRequestHeaders(),
      );
      await controller.loadVideoSource(source);
      await controller.setVolume(0);
      await controller.setLoop(true);
      await controller.play();
    } catch (_) {
      // The poster stays; the card can still be decided.
    }
  }

  @override
  void dispose() {
    final controller = _controller;
    if (controller != null) {
      unawaited(controller.stop().catchError((_) {}));
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => IgnorePointer(child: NativeVideoPlayerView(onViewReady: _ready));
}
