import 'package:flutter/widgets.dart';
import 'package:immich_mobile/gallery/motion/motion_tokens.dart';

/// Timings of the memory viewer (`presentation/pages/memory.page.dart`). Upstream slides every tap for 500 ms with
/// an ease-in-out, which reads as a lag before the next photo arrives; these start at full speed and settle, so the
/// photo is all but in place well before the slide ends.
abstract final class MemoryMotion {
  /// A tap on the left or right half: the previous or next photo of this memory.
  static const assetDuration = Duration(milliseconds: 220);

  /// Moving on to the next or previous memory.
  static const memoryDuration = Duration(milliseconds: 300);

  /// "Start over" from the epilogue: a longer run back through every memory.
  static const startOverDuration = GalleryMotion.slow;

  static const curve = GalleryMotion.settle;
}

/// The memory viewer's swipe physics. Keeps upstream's bounce at the ends (dragging past the epilogue closes the
/// memories) but settles onto the page with a stiffer spring, so a released swipe lands in about half the time.
class MemoryPagePhysics extends BouncingScrollPhysics {
  const MemoryPagePhysics({super.parent});

  @override
  MemoryPagePhysics applyTo(ScrollPhysics? ancestor) => MemoryPagePhysics(parent: buildParent(ancestor));

  @override
  SpringDescription get spring => SpringDescription.withDampingRatio(mass: 0.5, stiffness: 400, ratio: 1.0);
}
