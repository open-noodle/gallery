import 'package:flutter/widgets.dart';
import 'package:immich_mobile/gallery/motion/motion_tokens.dart';

/// Fades [child] in while it settles from [offset] to its place, once, when it first appears. [delay] staggers
/// several entrances into a cascade. With [enabled] false (or reduced motion asking for no movement) it does not move;
/// disabled, it is simply [child].
class GalleryEntrance extends StatefulWidget {
  final Duration delay;
  final Offset offset;
  final bool enabled;
  final Widget child;

  const GalleryEntrance({
    super.key,
    this.delay = Duration.zero,
    this.offset = const Offset(0, 8),
    this.enabled = true,
    required this.child,
  });

  @override
  State<GalleryEntrance> createState() => _GalleryEntranceState();
}

class _GalleryEntranceState extends State<GalleryEntrance> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: widget.delay + GalleryMotion.base,
    value: widget.enabled ? 0 : 1,
  );
  late final Animation<double> _progress = CurvedAnimation(
    parent: _controller,
    curve: Interval(
      widget.delay.inMicroseconds / (widget.delay + GalleryMotion.base).inMicroseconds,
      1,
      curve: GalleryMotion.settle,
    ),
  );

  @override
  void initState() {
    super.initState();
    if (widget.enabled) {
      _controller.forward();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final reduced = GalleryMotion.reduced(context);
    // The same wrappers before, during and after: changing them would remount [child] (a text field loses focus).
    return AnimatedBuilder(
      animation: _progress,
      builder: (context, child) {
        final t = _progress.value;
        return Transform.translate(
          offset: reduced ? Offset.zero : widget.offset * (1 - t),
          child: Opacity(opacity: t.clamp(0.0, 1.0), child: child),
        );
      },
      child: widget.child,
    );
  }
}
