import 'package:flutter/material.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';

/// Theme-aware polaroid illustration sitting on a soft accent glow, so an empty
/// screen reads as intentional negative space rather than a black void.
///
/// Shared by the main Photos timeline's first-run state and the space album
/// empty state, so the two read as the same family rather than two unrelated
/// designs. Keep it presentational — callers own the copy and the call to action.
class PolaroidHero extends StatelessWidget {
  const PolaroidHero({super.key, this.size = 180, this.imageWidth = 150});

  /// Overall square the illustration occupies.
  final double size;

  /// Width of the polaroid itself inside that square.
  final double imageWidth;

  @override
  Widget build(BuildContext context) {
    final asset = context.isDarkTheme ? 'assets/polaroid-dark.png' : 'assets/polaroid-light.png';
    return SizedBox(
      width: size,
      height: size,
      child: Stack(
        alignment: Alignment.center,
        children: [
          DecoratedBox(
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(color: context.primaryColor.withValues(alpha: 0.14), blurRadius: 80, spreadRadius: 12),
              ],
            ),
            child: const SizedBox(width: 110, height: 110),
          ),
          Image.asset(asset, width: imageWidth, filterQuality: FilterQuality.high, isAntiAlias: true),
        ],
      ),
    );
  }
}
