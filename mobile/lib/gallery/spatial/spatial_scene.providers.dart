import 'dart:async';
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter/painting.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/gallery/spatial/depth.dart';
import 'package:immich_mobile/presentation/widgets/images/remote_image_provider.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/providers/server_info.provider.dart';
import 'package:immich_mobile/utils/image_url_builder.dart';
import 'package:openapi/api.dart';

// Spatial Scene (specs/2026-10-29-spatial-scene-design.md, "Phase 3: mobile"). The local database carries no
// spatialScene flag, so the viewer asks the server for it per photo, and only when the server's features say it is on.

/// `spatialScene` in `GET /server/features`, as the app's server info holds it: loaded at sign-in and reloaded when the
/// socket connects or the server announces a config change, so the admin turning the feature on or off reaches an open
/// app. False until the features load, on a server that predates the flag, and on stock Immich.
final spatialSceneEnabledProvider = Provider<bool>(
  (ref) => ref.watch(serverInfoProvider.select((info) => info.serverFeatures.spatialScene)),
);

/// Whether the viewer offers Spatial Scene for the remote asset [assetId]: `spatialScene` on `GET /assets/{id}`,
/// which the server sets only for a photo with a depth map that the admin's offer setting allows.
final spatialSceneOfferedProvider = FutureProvider.autoDispose.family<bool, String>((ref, assetId) async {
  if (!ref.watch(spatialSceneEnabledProvider)) {
    return false;
  }
  try {
    final asset = await ref.watch(apiServiceProvider).assetsApi.getAssetInfo(assetId);
    return asset?.spatialScene.orElse(null) == true;
  } catch (_) {
    return false;
  }
});

/// The remote asset id the Spatial view is on, or null. Keyed by id rather than a plain flag, so swiping to another
/// photo leaves it without anything having to reset it (the web viewer's `spatialSceneState`).
final spatialSceneAssetProvider = StateProvider.autoDispose<String?>((ref) => null);

/// What the shader draws: the preview, its depth map and the plane that stays still.
class SpatialSceneTextures {
  final ui.Image image;
  final ui.Image depth;

  /// The subject's depth, 0..1 (see [subjectDepth]).
  final double focus;

  const SpatialSceneTextures({required this.image, required this.depth, required this.focus});

  void dispose() {
    image.dispose();
    depth.dispose();
  }
}

/// Pixels the near edges grow by before upload (see [dilate]).
const _dilateRadius = 3;

final spatialSceneTexturesProvider = FutureProvider.autoDispose
    .family<SpatialSceneTextures, ({String id, String? thumbHash})>((ref, asset) async {
      final cacheKey = asset.thumbHash == null ? '' : '?c=${Uri.encodeComponent(asset.thumbHash!)}';
      final ui.Image image;
      final ui.Image depthImage;
      try {
        (image, depthImage) = await (
          _resolve(
            RemoteImageProvider(
              url: getThumbnailUrlForRemoteId(asset.id, type: AssetMediaSize.preview, thumbhash: asset.thumbHash),
            ),
          ),
          _resolve(RemoteImageProvider(url: '${Store.get(StoreKey.serverEndpoint)}/assets/${asset.id}/depth$cacheKey')),
        ).wait;
      } on ParallelWaitError<(ui.Image?, ui.Image?), (AsyncError?, AsyncError?)> catch (error) {
        error.values.$1?.dispose();
        error.values.$2?.dispose();
        final failure = error.errors.$1 ?? error.errors.$2!;
        Error.throwWithStackTrace(failure.error, failure.stackTrace);
      }

      try {
        final rgba = await depthImage.toByteData(format: ui.ImageByteFormat.rawRgba);
        if (rgba == null) {
          throw StateError('depth map has no pixels');
        }
        final (focus, pixels) = await compute(_prepareDepth, (
          rgba: rgba.buffer.asUint8List(),
          width: depthImage.width,
          height: depthImage.height,
        ));
        final depth = await _fromPixels(pixels, depthImage.width, depthImage.height);
        final textures = SpatialSceneTextures(image: image, depth: depth, focus: focus);
        ref.onDispose(textures.dispose);
        return textures;
      } catch (_) {
        image.dispose();
        rethrow;
      } finally {
        depthImage.dispose();
      }
    });

(double, Uint8List) _prepareDepth(({Uint8List rgba, int width, int height}) map) {
  final raw = depthFromRgba(map.rgba);
  return (subjectDepth(raw), depthToRgba(dilate(raw, map.width, map.height, _dilateRadius)));
}

Future<ui.Image> _fromPixels(Uint8List pixels, int width, int height) {
  final completer = Completer<ui.Image>();
  ui.decodeImageFromPixels(pixels, width, height, ui.PixelFormat.rgba8888, completer.complete);
  return completer.future;
}

/// The first frame of [provider], loaded through the app's image pipeline (its auth headers and HTTP client).
Future<ui.Image> _resolve(ImageProvider provider) {
  final completer = Completer<ui.Image>();
  final stream = provider.resolve(ImageConfiguration.empty);
  late final ImageStreamListener listener;
  listener = ImageStreamListener(
    (info, _) {
      if (!completer.isCompleted) {
        completer.complete(info.image.clone());
      }
      info.dispose();
      stream.removeListener(listener);
    },
    onError: (error, stackTrace) {
      if (!completer.isCompleted) {
        completer.completeError(error, stackTrace);
      }
      stream.removeListener(listener);
    },
  );
  stream.addListener(listener);
  return completer.future;
}
