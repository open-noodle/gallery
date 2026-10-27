import 'dart:async';

import 'package:flutter/gestures.dart';
import 'package:flutter/physics.dart';
import 'package:flutter/widgets.dart';
import 'package:immich_mobile/gallery/motion/motion_tokens.dart';

/// Squishes [child] while a finger is down and springs it back on release.
///
/// Listens to raw pointer events, so it never competes with the child's own gesture detectors: taps,
/// long presses and drags reach the child unchanged. A quick tap waits for the dip to land before
/// springing back, so the press is visible even when the finger lifts at once. A finger that moves
/// past the touch slop is scrolling, not pressing: the press is let go at once.
class GalleryPressable extends StatefulWidget {
  final Widget child;

  /// Scale while pressed. Web uses 0.86–0.95; small controls take the deeper end, photos and cards
  /// the shallow one.
  final double pressedScale;

  /// How long a finger must rest before the dip starts. Inside scrolling content (the photo grid,
  /// card lists) this keeps a fling from flashing every item it starts on; a tap shorter than the
  /// delay still dips and springs back.
  final Duration pressDelay;

  final bool enabled;

  /// The [pressDelay] for items inside scrolling content.
  static const scrollingDelay = Duration(milliseconds: 70);

  const GalleryPressable({
    super.key,
    required this.child,
    this.pressedScale = 0.92,
    this.pressDelay = Duration.zero,
    this.enabled = true,
  });

  @override
  State<GalleryPressable> createState() => _GalleryPressableState();
}

class _GalleryPressableState extends State<GalleryPressable> with SingleTickerProviderStateMixin {
  late final AnimationController _scale = AnimationController.unbounded(vsync: this, value: 1.0);
  final Map<int, Offset> _downs = {};
  TickerFuture? _dip;
  Timer? _delay;

  @override
  void dispose() {
    _delay?.cancel();
    _scale.dispose();
    super.dispose();
  }

  void _down(PointerDownEvent event) {
    _downs[event.pointer] = event.position;
    if (_downs.length > 1 || !widget.enabled || GalleryMotion.reduced(context)) {
      return;
    }
    if (widget.pressDelay == Duration.zero) {
      _startDip();
    } else {
      _delay?.cancel();
      _delay = Timer(widget.pressDelay, _startDip);
    }
  }

  void _startDip() {
    _delay = null;
    if (!mounted) {
      return;
    }
    _dip = _scale.animateTo(widget.pressedScale, duration: GalleryMotion.instant, curve: GalleryMotion.standard);
  }

  void _move(PointerMoveEvent event) {
    final start = _downs[event.pointer];
    if (start != null && (event.position - start).distance > kTouchSlop) {
      _letGo(event.pointer);
    }
  }

  /// A scroll or a cancelled gesture: no tap feedback, spring straight back.
  void _letGo(int pointer) {
    if (_downs.remove(pointer) == null || _downs.isNotEmpty) {
      return;
    }
    _delay?.cancel();
    _delay = null;
    _release();
  }

  void _up(PointerUpEvent event) {
    if (_downs.remove(event.pointer) == null || _downs.isNotEmpty) {
      return;
    }
    if (_delay != null) {
      // Lifted before the delay ran out: still show the tap.
      _delay!.cancel();
      _startDip();
    }
    final dip = _dip;
    if (dip != null && _scale.isAnimating) {
      // A stopped ticker never completes this future, so a newer press simply drops this release.
      unawaited(dip.whenComplete(_release));
    } else {
      _release();
    }
  }

  void _release() {
    if (!mounted || _downs.isNotEmpty) {
      return;
    }
    _dip = null;
    if (_scale.value == 1.0 && !_scale.isAnimating) {
      return;
    }
    _scale.animateWith(SpringSimulation(GalleryMotion.bouncy, _scale.value, 1.0, _scale.velocity));
  }

  @override
  Widget build(BuildContext context) {
    return Listener(
      onPointerDown: _down,
      onPointerMove: _move,
      onPointerUp: _up,
      onPointerCancel: (event) => _letGo(event.pointer),
      child: AnimatedBuilder(
        animation: _scale,
        builder: (context, child) => Transform.scale(scale: _scale.value, child: child),
        child: widget.child,
      ),
    );
  }
}
