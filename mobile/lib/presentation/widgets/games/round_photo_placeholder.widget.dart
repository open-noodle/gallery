import 'package:flutter/material.dart';

/// What a round photo falls back to when it cannot be loaded.
///
/// The usual cause is an asset deleted server-side after the challenge was built, which makes the
/// round image 404. A round is still playable and a card still readable without its photo — the
/// score, the map, the wheel, the pips and the HUD all stand on their own — so this is a neutral
/// surface rather than an error message, and without it the failure throws into the framework and
/// paints a blank or error area instead.
///
/// Every `Image` built from `getGameRoundImageUrl` should pass this as its `errorBuilder`.
class RoundPhotoPlaceholder extends StatelessWidget {
  const RoundPhotoPlaceholder({super.key});

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return ColoredBox(
      color: colors.surfaceContainerHighest,
      child: Center(child: Icon(Icons.image_not_supported_outlined, size: 32, color: colors.onSurfaceVariant)),
    );
  }
}
