import 'package:flutter/material.dart';
import 'package:immich_mobile/gallery/motion/motion_tokens.dart';

/// Content that opens and closes in place: it grows down from its top edge while fading in, and folds back up while
/// fading out, so what sits below it slides instead of jumping. Closed, [child] is not in the tree at all.
///
/// Reduced motion: a quick fade, and the space opens and closes at once.
class GalleryFold extends StatelessWidget {
  final bool open;
  final Widget child;

  const GalleryFold({super.key, required this.open, required this.child});

  @override
  Widget build(BuildContext context) {
    final reduced = GalleryMotion.reduced(context);
    return AnimatedSwitcher(
      duration: reduced ? GalleryMotion.quick : GalleryMotion.base,
      switchInCurve: GalleryMotion.standard,
      switchOutCurve: GalleryMotion.standard,
      transitionBuilder: (child, animation) => reduced
          ? FadeTransition(opacity: animation, child: child)
          : SizeTransition(
              sizeFactor: animation,
              alignment: Alignment.topCenter,
              child: FadeTransition(opacity: animation, child: child),
            ),
      // Top-aligned, and the parent's width passes through, so a stretched body keeps its width while it folds.
      layoutBuilder: (current, previous) =>
          Stack(alignment: Alignment.topCenter, fit: StackFit.passthrough, children: [...previous, ?current]),
      child: open ? KeyedSubtree(key: const ValueKey(true), child: child) : const SizedBox.shrink(),
    );
  }
}

/// A disclosure arrow that turns half a turn as its content opens: pass the closed-state icon (pointing down).
class GalleryTurn extends StatelessWidget {
  final bool open;
  final Widget child;

  const GalleryTurn({super.key, required this.open, required this.child});

  @override
  Widget build(BuildContext context) => AnimatedRotation(
    turns: open ? 0.5 : 0,
    duration: GalleryMotion.reduced(context) ? Duration.zero : GalleryMotion.base,
    curve: GalleryMotion.standard,
    child: child,
  );
}
