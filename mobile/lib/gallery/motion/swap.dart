import 'package:flutter/widgets.dart';
import 'package:immich_mobile/gallery/motion/motion_tokens.dart';
import 'package:immich_mobile/gallery/motion/spring_curve.dart';

/// Shows [child] for [value], and when [value] changes, the new one rises into place while the old one fades out
/// above it: a count rolls, a label cross-fades. With [sized], the width eases to the new content instead of jumping.
///
/// With [popFrom], the new content pops in on the bouncy spring from that scale instead, and the old one shrinks away
/// (a token appearing in a field).
///
/// Reduced motion: a plain cross-fade.
class GallerySwap extends StatelessWidget {
  static final _bouncy = GallerySpringCurve(GalleryMotion.bouncy);

  final Object? value;
  final Widget child;

  /// How far the new content rises (and the old one leaves upwards), in logical pixels. 0: a cross-fade.
  final double rise;
  final bool sized;
  final double? popFrom;
  final AlignmentGeometry alignment;

  const GallerySwap({
    super.key,
    required this.value,
    required this.child,
    this.rise = 6,
    this.sized = false,
    this.popFrom,
    this.alignment = AlignmentDirectional.centerStart,
  });

  @override
  Widget build(BuildContext context) {
    final reduced = GalleryMotion.reduced(context);
    final incoming = ValueKey<Object?>(value);
    final pop = popFrom != null && !reduced;
    final switcher = AnimatedSwitcher(
      duration: pop ? GalleryMotion.slow : GalleryMotion.quick,
      reverseDuration: GalleryMotion.quick,
      switchInCurve: pop ? _bouncy : GalleryMotion.settle,
      switchOutCurve: GalleryMotion.exit,
      transitionBuilder: (child, animation) {
        // Incoming rises from below; outgoing (its animation runs back to 0) leaves upwards.
        final direction = child.key == incoming ? 1.0 : -1.0;
        final moves = !reduced && (pop || rise != 0);
        return AnimatedBuilder(
          animation: animation,
          builder: (context, child) {
            final t = animation.value;
            // The spring overshoots past 1: opacity stops at 1, the scale does not.
            final faded = Opacity(opacity: t.clamp(0.0, 1.0), child: child);
            if (!moves) {
              return faded;
            }
            if (pop) {
              return Transform.scale(scale: popFrom! + (1 - popFrom!) * t, child: faded);
            }
            return Transform.translate(offset: Offset(0, direction * rise * (1 - t)), child: faded);
          },
          child: child,
        );
      },
      layoutBuilder: (current, previous) => Stack(alignment: alignment, children: [...previous, ?current]),
      child: KeyedSubtree(key: incoming, child: child),
    );
    // Reduced motion resizes at once. (An AnimatedSize with a zero duration trips Flutter's own layout assertion.)
    if (!sized || reduced) {
      return switcher;
    }
    return AnimatedSize(
      duration: GalleryMotion.quick,
      curve: GalleryMotion.standard,
      alignment: alignment,
      child: switcher,
    );
  }
}
