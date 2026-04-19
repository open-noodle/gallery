import 'package:flutter/material.dart';

/// Crossfade between an outlined `idleIcon` and a filled `activeIcon` over
/// 220 ms. Matches the pill's `Cubic(0.3, 0.6, 0.2, 1)` motion signature on
/// the size curve so the icon reveal is synchronized with the surrounding
/// `AnimatedAlign` width collapse in GalleryNavSegment.
///
/// Uses `AnimatedCrossFade` (no variable-font dependency) — keeps the nav
/// asset footprint flat and the rebase surface uncluttered.
class AnimatedNavIcon extends StatelessWidget {
  final IconData idleIcon;
  final IconData activeIcon;
  final bool active;
  final double size;
  final Color color;

  static const _duration = Duration(milliseconds: 220);
  static const _curve = Cubic(0.3, 0.6, 0.2, 1);

  const AnimatedNavIcon({
    super.key,
    required this.idleIcon,
    required this.activeIcon,
    required this.active,
    this.size = 22,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return AnimatedCrossFade(
      duration: _duration,
      sizeCurve: _curve,
      firstCurve: _curve,
      secondCurve: _curve,
      crossFadeState: active ? CrossFadeState.showSecond : CrossFadeState.showFirst,
      firstChild: Icon(idleIcon, size: size, color: color),
      secondChild: Icon(activeIcon, size: size, color: color),
    );
  }
}
