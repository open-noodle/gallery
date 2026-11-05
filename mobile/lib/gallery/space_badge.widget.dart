import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/gallery/space_badge.provider.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/widgets/spaces/space_collage.dart';
import 'package:openapi/api.dart' show UserAvatarColor;

/// The top-left mark of a thumbnail whose asset is in one of the user's spaces: the Spaces icon in the space's
/// colour, or white with a count when the asset is in several. Drawn like the tile's other marks (a small icon with
/// a soft shadow), so it hints rather than covers. A child of the tile's indicator stack.
class SpaceBadge extends ConsumerWidget {
  const SpaceBadge(this.asset, {super.key, this.hidden = false});

  final BaseAsset asset;

  /// While the selection check has the corner, or the photo flies to or from the viewer.
  final bool hidden;

  /// A space's own timelines would mark every tile; trash and the locked folder are out of the spaces.
  static const _hiddenOn = {TimelineOrigin.remoteSpace, TimelineOrigin.trash, TimelineOrigin.lockedFolder};

  /// Below this width the count would run into a video's duration: several spaces show the icon alone.
  static const _compactBelow = 90.0;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final assetId = asset.remoteId;
    if (assetId == null || _hiddenOn.contains(ref.watch(timelineServiceProvider.select((service) => service.origin)))) {
      return const SizedBox.shrink();
    }
    final spaces = ref.watch(assetSpacesProvider(assetId)).valueOrNull ?? noAssetSpaces;
    if (spaces.count == 0) {
      return const SizedBox.shrink();
    }

    return Positioned.fill(
      child: IgnorePointer(
        // A hint like the tile's other marks, which screen readers skip too.
        child: ExcludeSemantics(
          child: AnimatedOpacity(
            opacity: hidden ? 0 : 1,
            duration: Durations.short4,
            child: LayoutBuilder(
              builder: (context, constraints) => Align(
                alignment: Alignment.topLeft,
                child: Padding(
                  padding: const EdgeInsets.only(left: 10, top: 6),
                  child: _Badge(spaces, compact: constraints.maxWidth < _compactBelow),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// The light end of the space card's gradient, which reads on a photo with the shadow; a lighter indigo for the
/// default colour, whose light end is still dark.
Color spaceBadgeColor(UserAvatarColor? color) => switch (color) {
  null || UserAvatarColor.primary => const Color(0xFF818CF8),
  _ => spaceGradientColors(color).first,
};

class _Badge extends StatelessWidget {
  const _Badge(this.spaces, {required this.compact});

  final AssetSpaces spaces;
  final bool compact;

  // As the tile's other marks, slightly see-through.
  static const _shadows = [Shadow(blurRadius: 5, color: Color.fromRGBO(0, 0, 0, 0.6))];
  static const _alpha = 0.9;

  @override
  Widget build(BuildContext context) {
    // Several spaces have several colours: white, as the tile's other marks.
    final color = (spaces.count == 1 ? spaceBadgeColor(spaces.color) : Colors.white).withValues(alpha: _alpha);
    final icon = Icon(Icons.workspaces, size: 16, color: color, shadows: _shadows);
    return KeyedSubtree(
      key: const Key('space-badge'),
      child: spaces.count == 1 || compact
          ? icon
          : Row(
              mainAxisSize: MainAxisSize.min,
              spacing: 3,
              children: [
                icon,
                Text(
                  '${spaces.count}',
                  style: TextStyle(
                    color: color,
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    height: 1,
                    shadows: _shadows,
                  ),
                ),
              ],
            ),
    );
  }
}
