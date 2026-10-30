import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:immich_mobile/gallery/motion/hero_scope.dart';
import 'package:immich_mobile/gallery/motion/motion_host.dart';
import 'package:immich_mobile/gallery/motion/motion_tokens.dart';

/// A shared-element flight within one screen, where a Hero cannot fly because no route changes: a copy of [child]
/// travels from [from] to [to] (global rects) on the gentle spring, above everything, while the screen swaps what is
/// under it. The caller hides the landing spot until [onLand], so the copy lands in its place. Used by the cleanup
/// deck ↔ grid switch (specs/2026-10-29-mobile-library-cleanup-design.md, "Motion" → "Swipe ↔ Grid").
///
/// Without the motion host (or under reduced motion, which the caller checks) nothing flies and [onLand] runs at once.
abstract final class GalleryFlight {
  static void fly({
    required Rect from,
    required Rect to,
    required Widget child,
    double fromRadius = 0,
    double toRadius = 0,
    Duration duration = GalleryMotion.slow,
    VoidCallback? onLand,
  }) {
    final overlay = GalleryMotionHost.overlay;
    final box = GalleryMotionHost.overlayBox;
    if (overlay == null || box == null) {
      onLand?.call();
      return;
    }
    final origin = box.localToGlobal(Offset.zero);
    late final OverlayEntry entry;
    entry = OverlayEntry(
      builder: (_) => _FlightLayer(
        from: from.shift(-origin),
        to: to.shift(-origin),
        fromRadius: fromRadius,
        toRadius: toRadius,
        duration: duration,
        onDone: () {
          entry.remove();
          onLand?.call();
        },
        child: child,
      ),
    );
    overlay.insert(entry);
  }
}

class _FlightLayer extends StatefulWidget {
  const _FlightLayer({
    required this.from,
    required this.to,
    required this.fromRadius,
    required this.toRadius,
    required this.duration,
    required this.onDone,
    required this.child,
  });

  final Rect from;
  final Rect to;
  final double fromRadius;
  final double toRadius;
  final Duration duration;
  final VoidCallback onDone;
  final Widget child;

  @override
  State<_FlightLayer> createState() => _FlightLayerState();
}

class _FlightLayerState extends State<_FlightLayer> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(vsync: this, duration: widget.duration);
  late final RectTween _rect = SpringRectTween(begin: widget.from, end: widget.to);

  @override
  void initState() {
    super.initState();
    unawaited(
      _controller.forward().whenComplete(() {
        if (mounted) {
          widget.onDone();
        }
      }),
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: _controller,
    builder: (context, child) {
      final t = _controller.value;
      return Stack(
        children: [
          Positioned.fromRect(
            rect: _rect.lerp(t)!,
            child: ClipRRect(
              borderRadius: BorderRadius.circular(widget.fromRadius + (widget.toRadius - widget.fromRadius) * t),
              child: child,
            ),
          ),
        ],
      );
    },
    child: IgnorePointer(
      child: KeyedSubtree(key: const Key('gallery-flight'), child: widget.child),
    ),
  );
}
