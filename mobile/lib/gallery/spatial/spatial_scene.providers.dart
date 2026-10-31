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
import 'package:immich_mobile/utils/image_url_builder.dart';
import 'package:openapi/api.dart';

// Spatial Scene (specs/2026-10-29-spatial-scene-design.md, "Phase 3: mobile"). The local database carries no
// spatialScene flag, so the viewer asks the server for it, and only when the server says the feature is on.

/// How long an answer from the server stands before the viewer asks again, so turning the feature on or off in the
/// admin settings reaches an open app without a request on every swipe.
const spatialSceneRecheck = Duration(minutes: 5);

/// How soon the viewer asks again after the request itself failed (offline, timed out, or held back while iOS waits
/// for the Local Network permission), so one failure does not hide the button for minutes.
const spatialSceneRetry = Duration(seconds: 30);

/// `spatialScene` in `GET /server/features`. False on a server that predates it, and on stock Immich, whose features
/// do not decode into the Gallery DTO.
final spatialSceneEnabledProvider = FutureProvider.autoDispose<bool>((ref) async {
  var enabled = false;
  var askAgainIn = spatialSceneRecheck;
  try {
    final features = await ref.watch(apiServiceProvider).serverInfoApi.getServerFeatures();
    enabled = features?.spatialScene.orElse(null) == true;
  } on Exception {
    // The request failed. A response that does not decode throws an Error instead, and stands as an answer.
    askAgainIn = spatialSceneRetry;
  } catch (_) {
    // A stock Immich server: its features lack keys the Gallery DTO requires.
  }
  // Re-run on a timer rather than only expire: the open viewer keeps listening, so an expiring cache alone would hold
  // the first answer for as long as the viewer stays open.
  final link = ref.keepAlive();
  final timer = Timer(askAgainIn, () {
    link.close();
    ref.invalidateSelf();
  });
  ref.onDispose(timer.cancel);
  return enabled;
});

/// Whether the viewer offers Spatial Scene for the remote asset [assetId]: `spatialScene` on `GET /assets/{id}`,
/// which the server sets only for a photo with a depth map that the admin's offer setting allows.
final spatialSceneOfferedProvider = FutureProvider.autoDispose.family<bool, String>((ref, assetId) async {
  if (!await ref.watch(spatialSceneEnabledProvider.future)) {
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
