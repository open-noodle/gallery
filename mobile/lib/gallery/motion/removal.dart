import 'dart:async';
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/scheduler.dart';
import 'package:flutter/widgets.dart';
import 'package:immich_mobile/gallery/motion/gallery_tile.dart';
import 'package:immich_mobile/gallery/motion/motion_host.dart';
import 'package:immich_mobile/gallery/motion/motion_tokens.dart';

/// Animates photos leaving the grid, from copies drawn in the overlay.
///
/// Call it when the action starts, before awaiting the server: the tiles have to still be on screen to
/// be copied. Each copy then rests exactly over its tile, which looks like nothing at all, and only
/// plays once the timeline actually drops that tile, i.e. once the change synced. A request that
/// fails (an error, demo mode) leaves the tiles where they are, and the copies are removed unseen after
/// [armedFor]. The timeline reflows underneath as usual; nothing waits for the animation.
///
/// Photos that are not on screen (scrolled away, or the action came from the photo viewer) are
/// skipped.
abstract final class GalleryRemoval {
  /// At most this many copies fly; the rest of a large selection just leaves with the reflow.
  static const maxCopies = 24;

  /// How long copies wait for their tiles to leave before giving up.
  static const armedFor = Duration(seconds: 6);

  /// Trash, archive, unarchive: each photo lifts, then arcs into the button that was pressed.
  static void send(Iterable<String> remoteIds) => _run(remoteIds, _Kind.send);

  /// Permanent delete: each photo loses its colour, blurs and dissolves where it stood.
  static void dissolve(Iterable<String> remoteIds) => _run(remoteIds, _Kind.dissolve);

  static void _run(Iterable<String> remoteIds, _Kind kind) {
    final overlay = GalleryMotionHost.overlay;
    final overlayBox = GalleryMotionHost.overlayBox;
    if (overlay == null || overlayBox == null) {
      return;
    }

    final copies = <_Copy>[];
    for (final id in remoteIds) {
      for (final tile in GalleryTile.live(id)) {
        final rect = tile.visibleRect(overlayBox);
        if (rect != null) {
          final copy = _Copy(id: id, rect: rect, picture: tile.picture);
          // Listened to now, not when the layer first builds: a fast sync can drop the tile first.
          tile.onLeave(copy.markLeft);
          copies.add(copy);
          break;
        }
      }
    }
    if (copies.isEmpty) {
      return;
    }
    // Reading order, so the stagger runs the way the eye does.
    copies.sort(
      (a, b) => a.rect.top != b.rect.top ? a.rect.top.compareTo(b.rect.top) : a.rect.left.compareTo(b.rect.left),
    );
    final flying = copies.take(maxCopies).toList(growable: false);

    final target = kind == _Kind.send
        ? GalleryMotionHost.lastPointerDown ?? Offset(overlayBox.size.width / 2, overlayBox.size.height - 48)
        : null;

    late final OverlayEntry entry;
    entry = OverlayEntry(
      builder: (_) => _RemovalLayer(
        key: const Key('gallery-removal'),
        kind: kind,
        copies: flying,
        target: target,
        reduced: GalleryMotionHost.reduced,
        onDone: () {
          entry
            ..remove()
            ..dispose();
        },
      ),
    );
    overlay.insert(entry);
  }
}

enum _Kind { send, dissolve }

class _Copy {
  final String id;
  final Rect rect;
  final Widget picture;

  /// The tile has left; [onLeft] is told once it is set.
  bool left = false;
  VoidCallback? onLeft;

  void markLeft() {
    left = true;
    onLeft?.call();
  }

  /// When this copy's animation starts on the layer's clock; null while it rests over its tile.
  Duration? startAt;

  /// Dropped without playing: the tile came back, so nothing was removed.
  bool cancelled = false;

  _Copy({required this.id, required this.rect, required this.picture});
}

class _RemovalLayer extends StatefulWidget {
  final _Kind kind;
  final List<_Copy> copies;
  final Offset? target;
  final bool reduced;
  final VoidCallback onDone;

  const _RemovalLayer({
    super.key,
    required this.kind,
    required this.copies,
    required this.target,
    required this.reduced,
    required this.onDone,
  });

  @override
  State<_RemovalLayer> createState() => _RemovalLayerState();
}

class _RemovalLayerState extends State<_RemovalLayer> with SingleTickerProviderStateMixin {
  /// Anticipation share of a throw, then an accelerating arc.
  static const _lift = 0.18;
  static const _arc = Cubic(0.4, 0, 0.7, 0.55);

  late final Ticker _ticker = createTicker((_) {
    _now = SchedulerBinding.instance.currentFrameTimeStamp;
    _tick();
  });
  Timer? _giveUp;
  bool _finished = false;

  /// Time of the last frame this layer saw, shared by every copy so staggered starts line up. Kept
  /// here rather than read from the binding, which only knows it while a frame runs (the give-up
  /// timer fires between frames).
  Duration _now = Duration.zero;

  Duration get _each => widget.reduced
      ? GalleryMotion.quick
      : widget.kind == _Kind.send
      ? const Duration(milliseconds: 560)
      : GalleryMotion.slow;

  Duration get _stagger => widget.reduced ? Duration.zero : Duration(milliseconds: widget.kind == _Kind.send ? 28 : 18);

  @override
  void initState() {
    super.initState();
    for (final copy in widget.copies) {
      copy.onLeft = () => _left(copy);
      if (copy.left) {
        _left(copy);
      }
    }
    // While copies only wait, nothing redraws; this timer is the only clock.
    _giveUp = Timer(GalleryRemoval.armedFor, () {
      for (final copy in widget.copies) {
        if (copy.startAt == null) {
          copy.cancelled = true;
        }
      }
      _tick();
    });
  }

  @override
  void dispose() {
    _giveUp?.cancel();
    _ticker.dispose();
    super.dispose();
  }

  /// The tile went away, possibly mid-build: decide after this frame whether it was really removed.
  void _left(_Copy copy) {
    SchedulerBinding.instance.addPostFrameCallback((timeStamp) {
      _now = timeStamp;
      if (!mounted || _finished || copy.startAt != null || copy.cancelled) {
        return;
      }
      final box = GalleryMotionHost.overlayBox;
      final back = box != null && GalleryTile.live(copy.id).any((tile) => tile.visibleRect(box) != null);
      if (back) {
        copy.cancelled = true;
        _tick();
        return;
      }
      // Copies whose tiles leave together keep the reading-order stagger.
      final now = _now;
      final queued = widget.copies.where((c) => c.startAt != null && c.startAt! >= now).length;
      copy.startAt = now + _stagger * queued;
      if (!_ticker.isActive) {
        _ticker.start().ignore();
      }
    });
  }

  void _tick() {
    if (!mounted || _finished) {
      return;
    }
    final now = _now;
    final waiting = widget.copies.any((c) => c.startAt == null && !c.cancelled);
    final playing = widget.copies.any((c) => c.startAt != null && now < c.startAt! + _each);
    if (!playing && !waiting) {
      _finished = true;
      _giveUp?.cancel();
      _ticker.stop();
      widget.onDone();
      return;
    }
    if (!playing && _ticker.isActive) {
      _ticker.stop();
    }
    setState(() {});
  }

  /// This copy's progress, 0..1; 0 while it rests over its tile.
  double _progress(_Copy copy) {
    final start = copy.startAt;
    final now = _now;
    if (start == null || now < start) {
      return 0;
    }
    return ((now - start).inMicroseconds / _each.inMicroseconds).clamp(0.0, 1.0);
  }

  @override
  Widget build(BuildContext context) {
    final copies = widget.copies;
    return IgnorePointer(
      child: Stack(
        children: [
          for (var i = 0; i < copies.length; i++)
            if (!copies[i].cancelled && _progress(copies[i]) < 1) _copy(i, copies[i], _progress(copies[i])),
        ],
      ),
    );
  }

  Widget _copy(int index, _Copy copy, double t) {
    // At rest the copy must match its tile exactly, so the corner radius only grows once it moves.
    final picture = ClipRRect(borderRadius: BorderRadius.circular(12 * t), child: copy.picture);
    if (widget.reduced) {
      return Positioned.fromRect(
        rect: copy.rect,
        child: Opacity(opacity: 1 - t, child: picture),
      );
    }
    return switch (widget.kind) {
      _Kind.send => _sent(index, copy, t, picture),
      _Kind.dissolve => _dissolved(copy, t, picture),
    };
  }

  Widget _sent(int index, _Copy copy, double t, Widget picture) {
    final from = copy.rect.center;
    final to = widget.target ?? from;
    double scale;
    Offset position;
    if (t < _lift) {
      // Lift: grow a little and rise, as if picked up.
      final k = GalleryMotion.settle.transform(t / _lift);
      scale = 1 + 0.06 * k;
      position = from.translate(0, -6 * k);
    } else {
      final k = _arc.transform((t - _lift) / (1 - _lift));
      final start = from.translate(0, -6);
      // Quadratic Bezier, bowed upward so the photo is tossed rather than slid.
      final control = Offset((start.dx + to.dx) / 2, math.min(start.dy, to.dy) - 0.25 * (to - start).distance);
      position = _bezier(start, control, to, k);
      scale = 1.06 + (0.14 - 1.06) * k;
    }
    final turn = (index.isEven ? 1 : -1) * 0.14 * math.max(0, t - _lift);
    final opacity = t < 0.8 ? 1.0 : (1 - (t - 0.8) / 0.2);
    final size = copy.rect.size;
    return Positioned(
      left: position.dx - size.width / 2,
      top: position.dy - size.height / 2,
      width: size.width,
      height: size.height,
      child: Opacity(
        opacity: opacity.clamp(0.0, 1.0),
        child: Transform.rotate(
          angle: turn,
          child: Transform.scale(scale: scale, child: picture),
        ),
      ),
    );
  }

  Widget _dissolved(_Copy copy, double t, Widget picture) {
    final k = GalleryMotion.standard.transform(t);
    final blur = 8 * k;
    return Positioned.fromRect(
      rect: copy.rect,
      child: Opacity(
        opacity: 1 - GalleryMotion.exit.transform(t),
        child: Transform.scale(
          scale: 1 - 0.08 * k,
          child: ImageFiltered(
            imageFilter: ui.ImageFilter.blur(sigmaX: blur, sigmaY: blur),
            child: ColorFiltered(colorFilter: ColorFilter.matrix(_saturation(1 - k)), child: picture),
          ),
        ),
      ),
    );
  }

  static Offset _bezier(Offset a, Offset b, Offset c, double t) {
    final u = 1 - t;
    return a * (u * u) + b * (2 * u * t) + c * (t * t);
  }

  /// A colour matrix that scales saturation (1 = unchanged, 0 = grey).
  static List<double> _saturation(double s) {
    const r = 0.2126;
    const g = 0.7152;
    const b = 0.0722;
    return [
      r * (1 - s) + s, g * (1 - s), b * (1 - s), 0, 0, //
      r * (1 - s), g * (1 - s) + s, b * (1 - s), 0, 0, //
      r * (1 - s), g * (1 - s), b * (1 - s) + s, 0, 0, //
      0, 0, 0, 1, 0, //
    ];
  }
}
