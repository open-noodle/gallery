import 'package:flutter/widgets.dart';

/// Gallery's motion tokens, mirrored from web (`web/src/lib/gallery/motion/tokens.ts`, #1235) so both apps move
/// alike. Design: `specs/2026-10-23-mobile-motion-language-design.md`.
abstract final class GalleryMotion {
  /// Press-in, hover tints.
  static const instant = Duration(milliseconds: 90);

  /// Menus, chips, quick fades.
  static const quick = Duration(milliseconds: 160);

  /// Overlays, tab and page entrances.
  static const base = Duration(milliseconds: 240);

  /// Large surfaces. Nothing the user waits on runs longer.
  static const slow = Duration(milliseconds: 400);

  /// Default easing.
  static const standard = Cubic(0.2, 0, 0, 1);

  /// Arrive and rest.
  static const settle = Cubic(0.22, 1, 0.36, 1);

  /// Leaving.
  static const exit = Cubic(0.3, 0, 0.8, 0.15);

  /// Releases, entrances, selection. ~7.6% overshoot.
  static const gentle = SpringDescription(mass: 1, stiffness: 300, damping: 22);

  /// Toggles. ~4.8% overshoot.
  static const snappy = SpringDescription(mass: 1, stiffness: 600, damping: 34);

  /// Small pops only (a press release, a check, a heart). ~24% overshoot.
  static const bouncy = SpringDescription(mass: 1, stiffness: 380, damping: 16);

  /// True when the OS asks for reduced motion: keep fades, drop movement.
  static bool reduced(BuildContext context) => MediaQuery.maybeDisableAnimationsOf(context) ?? false;
}
