import 'dart:async';
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/gallery/spatial/depth.dart';
import 'package:immich_mobile/gallery/spatial/spatial_scene.providers.dart';
import 'package:immich_mobile/gallery/spatial/tilt.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/widgets/common/immich_loading_indicator.dart';
import 'package:immich_mobile/widgets/common/immich_toast.dart';
import 'package:sensors_plus/sensors_plus.dart';

// Spatial Scene (specs/2026-10-29-spatial-scene-design.md, "Phase 3: mobile"): the preview and its depth map drawn by
// one fragment shader, moved by tilting the phone, as SpatialSceneViewer.svelte does on the web.

/// Largest shift, as a share of the image: small enough that the stretched background stays hard to notice.
const _amplitude = 0.03;

/// Seconds without tilt before the scene starts swaying on its own.
const _idleAfter = 2.5;

/// Tilt smaller than this, as a share of the movement, counts as holding still: a hand never is.
const _stillness = 0.03;

/// Covers the photo with its Spatial Scene while [asset] is the one the Spatial view is on. Ignores touches, so
/// swiping to the next photo, tapping for the controls and dragging up for the details keep working.
class SpatialSceneOverlay extends ConsumerWidget {
  final BaseAsset asset;

  const SpatialSceneOverlay({super.key, required this.asset});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final asset = this.asset;
    final id = asset.remoteId;
    if (id == null || !asset.isImage || ref.watch(spatialSceneAssetProvider) != id) {
      return const SizedBox.shrink();
    }

    final key = (id: id, thumbHash: asset is RemoteAsset ? asset.thumbHash : null);
    ref.listen(spatialSceneTexturesProvider(key), (_, next) {
      if (next.hasError) {
        ImmichToast.show(context: context, msg: context.t.spatial_scene_unavailable, toastType: ToastType.error);
        ref.read(spatialSceneAssetProvider.notifier).state = null;
      }
    });

    return IgnorePointer(
      child: ColoredBox(
        color: Colors.black,
        child: switch (ref.watch(spatialSceneTexturesProvider(key))) {
          AsyncData(:final value) => Semantics(
            label: context.t.spatial_scene,
            image: true,
            child: Center(
              child: AspectRatio(
                aspectRatio: value.image.width / value.image.height,
                child: _SpatialSceneView(textures: value),
              ),
            ),
          ),
          _ => const Center(child: ImmichLoadingIndicator()),
        },
      ),
    );
  }
}

class _SpatialSceneView extends StatefulWidget {
  final SpatialSceneTextures textures;

  const _SpatialSceneView({required this.textures});

  @override
  State<_SpatialSceneView> createState() => _SpatialSceneViewState();
}

class _SpatialSceneViewState extends State<_SpatialSceneView> with SingleTickerProviderStateMixin {
  static final Future<ui.FragmentProgram> _program = ui.FragmentProgram.fromAsset('shaders/spatial_scene.frag');

  late final Ticker _ticker = createTicker(_onTick);
  final _frame = ValueNotifier<int>(0);
  final _tilt = TiltTracker();
  final _x = Spring();
  final _y = Spring();
  StreamSubscription<AccelerometerEvent>? _accelerometer;
  ui.FragmentShader? _shader;

  ({double x, double y}) _target = (x: 0, y: 0);
  ({double x, double y}) _lastTilt = (x: 0, y: 0);
  Duration _lastInput = Duration.zero;
  Duration _previous = Duration.zero;
  Duration _now = Duration.zero;

  @override
  void initState() {
    super.initState();
    unawaited(
      _program.then((program) {
        if (!mounted) {
          return;
        }
        setState(() => _shader = program.fragmentShader());
        _ticker.start();
      }),
    );
    _accelerometer = accelerometerEventStream(samplingPeriod: SensorInterval.gameInterval).listen(
      _onAccelerometer,
      // No accelerometer (or it failed): the idle sway still moves the scene.
      onError: (_) {},
      cancelOnError: true,
    );
  }

  void _onAccelerometer(AccelerometerEvent event) {
    final tilt = _tilt.update(event.x, event.y, event.z);
    if ((tilt.x - _lastTilt.x).abs() > _stillness || (tilt.y - _lastTilt.y).abs() > _stillness) {
      _lastTilt = tilt;
      _lastInput = _now;
    }
    if (_secondsSince(_lastInput) <= _idleAfter) {
      _target = tilt;
    }
  }

  double _secondsSince(Duration time) => (_now - time).inMicroseconds / Duration.microsecondsPerSecond;

  void _onTick(Duration elapsed) {
    _now = elapsed;
    final dt = math.min(0.05, (elapsed - _previous).inMicroseconds / Duration.microsecondsPerSecond);
    _previous = elapsed;
    if (!MediaQuery.disableAnimationsOf(context) && _secondsSince(_lastInput) > _idleAfter) {
      final seconds = elapsed.inMicroseconds / Duration.microsecondsPerSecond;
      _target = (x: math.sin(seconds * 0.55) * 0.75, y: math.sin(seconds * 0.8 + 1.2) * 0.35);
    }
    _x.step(_target.x, dt);
    _y.step(_target.y, dt);
    _frame.value++;
  }

  @override
  void dispose() {
    unawaited(_accelerometer?.cancel());
    _ticker.dispose();
    _frame.dispose();
    _shader?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final shader = _shader;
    if (shader == null) {
      return const SizedBox.expand();
    }
    return CustomPaint(
      painter: _SpatialScenePainter(shader: shader, textures: widget.textures, x: _x, y: _y, repaint: _frame),
      size: Size.infinite,
    );
  }
}

class _SpatialScenePainter extends CustomPainter {
  final ui.FragmentShader shader;
  final SpatialSceneTextures textures;
  final Spring x;
  final Spring y;

  _SpatialScenePainter({
    required this.shader,
    required this.textures,
    required this.x,
    required this.y,
    required Listenable repaint,
  }) : super(repaint: repaint);

  @override
  void paint(Canvas canvas, Size size) {
    if (size.isEmpty) {
      return;
    }
    final focus = textures.focus;
    final aspect = size.width / size.height;
    shader
      ..setFloat(0, size.width)
      ..setFloat(1, size.height)
      ..setFloat(2, x.position * _amplitude)
      ..setFloat(3, y.position * _amplitude * aspect)
      ..setFloat(4, focus)
      // zoom in just enough that the shifted edges never show past the frame
      ..setFloat(5, 1 + 2.2 * _amplitude * math.max(focus, 1 - focus))
      ..setImageSampler(0, textures.image)
      ..setImageSampler(1, textures.depth);
    canvas.drawRect(Offset.zero & size, Paint()..shader = shader);
  }

  @override
  bool shouldRepaint(_SpatialScenePainter oldDelegate) =>
      oldDelegate.shader != shader || oldDelegate.textures != textures;
}
