import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:immich_mobile/gallery/motion/motion_tokens.dart';
import 'package:immich_mobile/gallery/motion/pressable.dart';
import 'package:immich_mobile/gallery/motion/spring_curve.dart';

/// The look and motion shared by the dock and every bottom control styled like it (the detail pages' grouping pill),
/// so they cannot drift apart.
abstract final class GalleryDockStyle {
  /// Space on each side: a little wider than a plain margin, so the pills follow the screen's rounded corners.
  static const double sideInset = 20;

  /// Distance from the screen's bottom edge. On an iPhone with a home indicator the dock sits down inside that area, as
  /// iOS's own tab bar does. Android keeps it above the safe area (at least 26 up): a swipe up from its bottom edge is
  /// the system's home gesture, so a control inside that zone would fight it.
  static double bottomInset(BuildContext context) {
    final safe = MediaQuery.paddingOf(context).bottom;
    if (Theme.of(context).platform == TargetPlatform.iOS && safe >= 20) {
      return math.max(16, safe - 14);
    }
    return math.max(26, safe);
  }

  /// The prototype's "springy" motion: a small overshoot that settles in about 0.6 s.
  static final GallerySpringCurve spring = GallerySpringCurve(
    const SpringDescription(mass: 1, stiffness: 240, damping: 21),
  );

  static Duration get springDuration => Duration(milliseconds: (spring.settleSeconds * 1000).round());

  /// The spring, or under reduced motion a short ease with no overshoot.
  static (Duration, Curve) motion(BuildContext context) =>
      GalleryMotion.reduced(context) ? (const Duration(milliseconds: 150), Curves.easeOut) : (springDuration, spring);

  /// The tint under the selected tab and the selected grouping.
  static Color highlight(ThemeData theme) =>
      theme.colorScheme.primary.withValues(alpha: theme.brightness == Brightness.dark ? 0.16 : 0.2);

  /// A selected label or icon, and an idle one.
  static Color activeForeground(ThemeData theme) => theme.colorScheme.primary;
  static Color idleForeground(ThemeData theme) => theme.colorScheme.onSurface.withValues(alpha: 0.72);
}

/// The frosted stadium every piece of the dock sits on.
class GalleryGlass extends StatelessWidget {
  final Widget child;

  /// The surface alone fades, so the search slot can sit bare inside the tab bar and grow its own circle when it
  /// detaches.
  final double surfaceOpacity;
  final Duration fade;

  const GalleryGlass({super.key, required this.child, this.surfaceOpacity = 1, this.fade = Duration.zero});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final dark = theme.brightness == Brightness.dark;
    const shape = StadiumBorder();
    return Stack(
      fit: StackFit.expand,
      children: [
        AnimatedOpacity(
          duration: fade,
          opacity: surfaceOpacity,
          child: DecoratedBox(
            decoration: ShapeDecoration(
              shape: shape,
              shadows: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: dark ? 0.45 : 0.18),
                  offset: const Offset(0, 10),
                  blurRadius: 28,
                  spreadRadius: -8,
                ),
              ],
            ),
            child: ClipPath(
              clipper: const ShapeBorderClipper(shape: shape),
              child: BackdropFilter(
                filter: ui.ImageFilter.blur(sigmaX: 28, sigmaY: 28),
                child: DecoratedBox(
                  decoration: ShapeDecoration(
                    color: dark
                        ? theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.62)
                        : theme.colorScheme.surface.withValues(alpha: 0.88),
                    shape: StadiumBorder(
                      side: BorderSide(color: theme.colorScheme.outlineVariant.withValues(alpha: 0.55)),
                    ),
                  ),
                  child: DecoratedBox(
                    decoration: ShapeDecoration(
                      shape: shape,
                      gradient: LinearGradient(
                        begin: Alignment.topCenter,
                        end: Alignment.center,
                        colors: [theme.colorScheme.onSurface.withValues(alpha: 0.05), Colors.transparent],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
        ClipPath(
          clipper: const ShapeBorderClipper(shape: shape),
          child: child,
        ),
      ],
    );
  }
}

/// A round 40 button at the end of a grouping row (display options, search): bare while idle, tinted like the selected
/// grouping while [active].
class GalleryDockRowButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final String? value;
  final bool active;
  final VoidCallback onTap;

  const GalleryDockRowButton({
    super.key,
    required this.icon,
    required this.label,
    required this.onTap,
    this.value,
    this.active = false,
  });

  static const double size = 38;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Semantics(
      button: true,
      label: label,
      value: value,
      excludeSemantics: true,
      child: GalleryPressable(
        pressedScale: 0.88,
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: onTap,
          child: SizedBox.square(
            dimension: size,
            child: DecoratedBox(
              decoration: ShapeDecoration(
                shape: const CircleBorder(),
                color: active ? GalleryDockStyle.highlight(theme) : Colors.transparent,
              ),
              child: Icon(
                icon,
                size: 22,
                color: active
                    ? GalleryDockStyle.activeForeground(theme)
                    : theme.colorScheme.onSurface.withValues(alpha: 0.85),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
