import 'dart:async';

import 'package:flutter/physics.dart';
import 'package:flutter/widgets.dart';
import 'package:immich_mobile/gallery/motion/motion_tokens.dart';

/// A small pop on the bouncy spring: [child] shrinks to [from] and springs back past its size to rest.
///
/// It pops when it first appears (with [onMount]) and every time [trigger] changes, so a badge pops when its count
/// moves and a check pops when it is set. Reduced motion: no pop.
class GalleryPop extends StatefulWidget {
  final Object? trigger;
  final bool onMount;
  final double from;
  final Widget child;

  const GalleryPop({super.key, this.trigger, this.onMount = false, this.from = 0.6, required this.child});

  @override
  State<GalleryPop> createState() => _GalleryPopState();
}

class _GalleryPopState extends State<GalleryPop> with SingleTickerProviderStateMixin {
  static const _rest = Tolerance(distance: 0.002, velocity: 0.02);

  late final AnimationController _scale = AnimationController.unbounded(
    vsync: this,
    value: widget.onMount ? widget.from : 1.0,
  );
  bool _mounted = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!_mounted) {
      _mounted = true;
      if (widget.onMount) {
        _pop(fromStart: false);
      }
    }
  }

  @override
  void didUpdateWidget(GalleryPop oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.trigger != widget.trigger) {
      _pop(fromStart: true);
    }
  }

  void _pop({required bool fromStart}) {
    if (GalleryMotion.reduced(context)) {
      _scale.value = 1.0;
      return;
    }
    final start = fromStart ? widget.from : _scale.value;
    // Done once it is within a fraction of a pixel of rest (the default tolerance keeps a small badge wobbling
    // invisibly for well over a second), then land exactly on 1.
    unawaited(
      _scale.animateWith(SpringSimulation(GalleryMotion.bouncy, start, 1.0, 0, tolerance: _rest)).whenComplete(() {
        if (mounted) {
          _scale.value = 1.0;
        }
      }),
    );
  }

  @override
  void dispose() {
    _scale.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: _scale,
    builder: (context, child) => Transform.scale(scale: _scale.value.clamp(0.0, 2.0), child: child),
    child: widget.child,
  );
}
