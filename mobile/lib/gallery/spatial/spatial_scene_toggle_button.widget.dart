import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/gallery/spatial/spatial_scene.providers.dart';
import 'package:immich_mobile/generated/translations.g.dart';

/// The viewer's Spatial toggle, shaped like the OCR one beside it. Shown only on a photo the server offers Spatial
/// Scene for, so nothing changes against a server without the feature.
class SpatialSceneToggleButton extends ConsumerWidget {
  final BaseAsset asset;

  const SpatialSceneToggleButton({super.key, required this.asset});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final id = asset.remoteId;
    final offered = id != null && asset.isImage && ref.watch(spatialSceneOfferedProvider(id)).valueOrNull == true;
    final showing = offered && ref.watch(spatialSceneAssetProvider) == id;

    return AnimatedSwitcher(
      duration: Durations.short4,
      child: !offered
          ? const SizedBox.shrink()
          : Align(
              alignment: Alignment.centerRight,
              child: Padding(
                padding: const EdgeInsets.only(right: 32, bottom: 8),
                child: Tooltip(
                  message: showing ? context.t.spatial_scene_hide : context.t.spatial_scene_show,
                  child: Material(
                    color: showing ? context.primaryColor : Colors.black.withValues(alpha: 0.4),
                    shape: const CircleBorder(),
                    clipBehavior: Clip.antiAlias,
                    child: InkWell(
                      onTap: () => ref.read(spatialSceneAssetProvider.notifier).state = showing ? null : id,
                      child: Padding(
                        padding: const EdgeInsets.all(10.0),
                        child: Icon(
                          showing ? Icons.view_in_ar_rounded : Icons.view_in_ar_outlined,
                          size: 22,
                          color: Colors.white,
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
    );
  }
}
