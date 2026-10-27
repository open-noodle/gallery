import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/scheduler.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/motion/motion_tokens.dart';
import 'package:immich_mobile/gallery/motion/wave_mask.dart';
import 'package:immich_mobile/presentation/widgets/timeline/constants.dart';
import 'package:immich_mobile/providers/gallery_nav/bottom_nav_height.provider.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';

/// The timeline's loading state: placeholder tiles laid out like the real grid (same columns, spacing
/// and header height), with a slow light sweeping across them. Replaces the spinning logo, so the
/// screen already has the shape of what is coming.
///
/// When the photos arrive, the timeline drops this sliver. The skeleton then paints a copy of itself
/// in the overlay that wipes away in a soft diagonal wave from the top-left, so the photos appear
/// to ripple in behind it. The copy ignores touches, so the photos are usable at once. Doing the
/// wave from here keeps the upstream hook to the one line that puts this sliver in place.
///
/// A sliver that fills the remaining viewport. Reads the column count and spacing from the
/// enclosing timeline's [timelineArgsProvider], so it only works inside a timeline.
class GalleryTimelineSkeleton extends ConsumerWidget {
  const GalleryTimelineSkeleton({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final (columns, spacing) = ref.watch(timelineArgsProvider.select((args) => (args.columnCount, args.spacing)));
    return SliverFillRemaining(
      hasScrollBody: false,
      // The floating nav pill sits over the bottom of the grid; the exit wave stays clear of it.
      child: GallerySkeletonGrid(
        columns: columns,
        spacing: spacing,
        exitInsetBottom: ref.watch(bottomNavHeightProvider),
      ),
    );
  }
}

/// A box that paints the skeleton grid with a moving sheen, and wipes away when it leaves. Static
/// when the OS asks for reduced motion, and the wipe becomes a short fade.
class GallerySkeletonGrid extends StatefulWidget {
  final int columns;
  final double spacing;

  /// How much of the bottom edge the exit wave leaves out.
  final double exitInsetBottom;

  const GallerySkeletonGrid({
    super.key,
    this.columns = kTimelineColumnCount,
    this.spacing = kTimelineSpacing,
    this.exitInsetBottom = 0,
  });

  @override
  State<GallerySkeletonGrid> createState() => _GallerySkeletonGridState();
}

class _GallerySkeletonGridState extends State<GallerySkeletonGrid> with SingleTickerProviderStateMixin {
  static const _sweep = Duration(milliseconds: 1600);
  late final AnimationController _sheen = AnimationController(vsync: this, duration: _sweep);
  _ExitWave? _exit;
  OverlayState? _overlay;
  ModalRoute<Object?>? _route;
  Rect? _lastRect;
  _Look? _look;
  bool _reduced = false;

  @override
  void initState() {
    super.initState();
    _prepareExit();
  }

  @override
  void activate() {
    super.activate();
    // Moved rather than removed (a reparent): the old exit entry was discarded, get a fresh one.
    _prepareExit();
  }

  /// Overlay entries cannot be inserted while the tree builds, and the skeleton leaves during a build.
  /// So the exit's (empty) overlay entry goes in after this frame, and leaving only repaints it.
  void _prepareExit() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final overlay = mounted ? Overlay.maybeOf(context) : null;
      if (overlay != null && _exit == null) {
        _exit = _ExitWave(overlay);
      }
    });
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _overlay = Overlay.maybeOf(context);
    _route = ModalRoute.of(context);
    _reduced = GalleryMotion.reduced(context);
    if (_reduced) {
      _sheen.value = 0.5;
      _sheen.stop();
    } else if (!_sheen.isAnimating) {
      unawaited(_sheen.repeat());
    }
  }

  /// Plays the exit wave where the skeleton last painted. Skipped when the skeleton leaves because its
  /// page is going away or is covered. The render object is already detached here, so this works
  /// from the rect recorded at the last paint rather than measuring now.
  @override
  void deactivate() {
    final exit = _exit;
    final rect = _lastRect;
    final look = _look;
    _exit = null;
    if (exit != null) {
      final height = (rect?.height ?? 0) - widget.exitInsetBottom;
      if (rect != null && look != null && height > 0 && (_route?.isCurrent ?? false)) {
        exit.play(rect: rect.topLeft & Size(rect.width, height), look: look, sheen: _sheen.value, reduced: _reduced);
      } else {
        exit.discard();
      }
    }
    super.deactivate();
  }

  @override
  void dispose() {
    _sheen.dispose();
    super.dispose();
  }

  void _recordRect(RenderBox box) {
    final overlay = _overlay;
    final overlayBox = overlay != null && overlay.mounted ? overlay.context.findRenderObject() : null;
    if (overlayBox is RenderBox && overlayBox.attached && box.hasSize) {
      _lastRect = box.localToGlobal(Offset.zero, ancestor: overlayBox) & box.size;
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final base = scheme.surfaceContainer;
    final look = _look = (
      columns: widget.columns,
      spacing: widget.spacing,
      base: base,
      shine: Color.lerp(base, scheme.onSurface, scheme.brightness == Brightness.dark ? 0.07 : 0.05)!,
    );
    return ExcludeSemantics(
      child: RepaintBoundary(
        child: _PaintRecorder(
          onPaint: _recordRect,
          child: CustomPaint(
            key: const Key('gallery-timeline-skeleton'),
            size: Size.infinite,
            painter: _SkeletonPainter(sheen: _sheen, look: look),
          ),
        ),
      ),
    );
  }
}

typedef _Look = ({int columns, double spacing, Color base, Color shine});

/// Reports its render box every time it paints (each sheen frame, since it sits inside the
/// skeleton's repaint boundary).
class _PaintRecorder extends SingleChildRenderObjectWidget {
  final void Function(RenderBox box) onPaint;

  const _PaintRecorder({required this.onPaint, required super.child});

  @override
  _RenderPaintRecorder createRenderObject(BuildContext context) => _RenderPaintRecorder(onPaint);

  @override
  void updateRenderObject(BuildContext context, _RenderPaintRecorder renderObject) => renderObject.onPaint = onPaint;
}

class _RenderPaintRecorder extends RenderProxyBox {
  _RenderPaintRecorder(this.onPaint);

  void Function(RenderBox box) onPaint;

  @override
  void paint(PaintingContext context, Offset offset) {
    onPaint(this);
    super.paint(context, offset);
  }
}

/// The skeleton's departing copy. Lives in an overlay entry that paints nothing until [play], which
/// only marks it for repaint (allowed mid-build), so the copy shows in the same frame the photos
/// replace the skeleton.
class _ExitWave extends ChangeNotifier {
  static const _duration = Duration(milliseconds: 520);

  final OverlayState overlay;
  late final OverlayEntry _entry;
  Ticker? _ticker;
  Duration _length = _duration;

  Rect? rect;
  _Look? look;
  double sheen = 0;
  double progress = 0;
  bool reduced = false;

  _ExitWave(this.overlay) {
    _entry = OverlayEntry(
      builder: (_) => _ExitHost(
        onMount: () => _hostMounted = true,
        onDispose: () {
          _hostMounted = false;
          _stop();
        },
        child: IgnorePointer(
          child: ExcludeSemantics(
            child: CustomPaint(
              key: const Key('gallery-timeline-skeleton-exit'),
              size: Size.infinite,
              painter: _ExitPainter(this),
            ),
          ),
        ),
      ),
    );
    overlay.insert(_entry);
  }

  bool get isPlaying => _ticker != null;

  /// Whether the overlay currently shows the entry. When the whole tree is torn down the overlay can
  /// drop it before the skeleton leaves; then there is nothing to play on.
  bool _hostMounted = false;

  void play({required Rect rect, required _Look look, required double sheen, required bool reduced}) {
    if (!_hostMounted) {
      discard();
      return;
    }
    this.rect = rect;
    this.look = look;
    this.sheen = sheen;
    this.reduced = reduced;
    _length = reduced ? GalleryMotion.quick : _duration;
    final ticker = _ticker = Ticker(_tick, debugLabel: 'gallery-timeline-skeleton-exit');
    unawaited(ticker.start());
    notifyListeners();
  }

  void _tick(Duration elapsed) {
    progress = (elapsed.inMicroseconds / _length.inMicroseconds).clamp(0.0, 1.0);
    notifyListeners();
    if (progress >= 1) {
      _finish();
    }
  }

  /// Removes the entry without playing. Deferred, since this runs during a build.
  void discard() => WidgetsBinding.instance.addPostFrameCallback((_) => _finish());

  /// Stops the clock. Also runs when the overlay drops the entry for any other reason (the app's root
  /// is torn down mid-wave), so no ticker outlives the tree.
  void _stop() {
    _ticker?.dispose();
    _ticker = null;
  }

  void _finish() {
    _stop();
    if (_finished) {
      return;
    }
    _finished = true;
    _entry
      ..remove()
      ..dispose();
    // The entry's painter still listens to this notifier until the overlay drops it next frame.
    WidgetsBinding.instance.addPostFrameCallback((_) => dispose());
  }

  bool _finished = false;
}

class _ExitHost extends StatefulWidget {
  final VoidCallback onMount;
  final VoidCallback onDispose;
  final Widget child;

  const _ExitHost({required this.onMount, required this.onDispose, required this.child});

  @override
  State<_ExitHost> createState() => _ExitHostState();
}

class _ExitHostState extends State<_ExitHost> {
  @override
  void initState() {
    super.initState();
    widget.onMount();
  }

  @override
  void dispose() {
    widget.onDispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}

class _ExitPainter extends CustomPainter {
  final _ExitWave wave;

  _ExitPainter(this.wave) : super(repaint: wave);

  @override
  void paint(Canvas canvas, Size size) {
    final rect = wave.rect;
    final look = wave.look;
    if (!wave.isPlaying || rect == null || look == null) {
      return;
    }
    final local = Offset.zero & rect.size;
    canvas
      ..save()
      ..translate(rect.left, rect.top)
      ..clipRect(local)
      ..saveLayer(local, Paint());
    _paintGrid(canvas, rect.size, look, wave.sheen);
    canvas
      ..drawRect(
        local,
        Paint()
          ..blendMode = BlendMode.dstIn
          ..shader = galleryWaveShader(
            local,
            GalleryMotion.settle.transform(wave.progress),
            reveal: false,
            fadeOnly: wave.reduced,
          ),
      )
      ..restore()
      ..restore();
  }

  @override
  bool shouldRepaint(_ExitPainter old) => old.wave != wave;
}

class _SkeletonPainter extends CustomPainter {
  final Animation<double> sheen;
  final _Look look;

  _SkeletonPainter({required this.sheen, required this.look}) : super(repaint: sheen);

  @override
  void paint(Canvas canvas, Size size) => _paintGrid(canvas, size, look, sheen.value);

  @override
  bool shouldRepaint(_SkeletonPainter old) => old.look != look;
}

/// Rows per month, cycled, and how many tiles the month's last row holds (0 = full). Fixed rather
/// than random so the skeleton never flickers between rebuilds.
const _monthRows = [3, 2, 4, 2];
const _lastRowTiles = [2, 0, 1, 2];

void _paintGrid(Canvas canvas, Size size, _Look look, double sheen) {
  final columns = look.columns;
  final spacing = look.spacing;
  if (size.isEmpty || columns <= 0) {
    return;
  }
  final tile = math.max(0.0, size.width - spacing * (columns - 1)) / columns;
  if (tile <= 0) {
    return;
  }

  // One diagonal band across the whole canvas, so the sheen runs continuously over tile gaps.
  final span = size.width + size.height;
  final x = -span + sheen * span * 2;
  final paint = Paint()
    ..shader = LinearGradient(
      begin: Alignment.topLeft,
      end: Alignment.bottomRight,
      colors: [look.base, look.shine, look.base],
      stops: const [0.35, 0.5, 0.65],
    ).createShader(Rect.fromLTWH(x, 0, span, span));

  double y = 0;
  for (var month = 0; y < size.height; month++) {
    // Month header: a short title bar where the real header puts its date.
    canvas.drawRRect(
      RRect.fromRectAndRadius(
        Rect.fromLTWH(12, y + kTimelineHeaderExtent * 0.42, math.min(132, size.width * 0.4), 16),
        const Radius.circular(8),
      ),
      paint,
    );
    y += kTimelineHeaderExtent;

    final rows = _monthRows[month % _monthRows.length];
    final lastRow = _lastRowTiles[month % _lastRowTiles.length];
    for (var row = 0; row < rows && y < size.height; row++) {
      final tiles = row == rows - 1 && lastRow > 0 ? math.min(columns, lastRow) : columns;
      for (var col = 0; col < tiles; col++) {
        canvas.drawRect(Rect.fromLTWH(col * (tile + spacing), y, tile, tile), paint);
      }
      y += tile + spacing;
    }
  }
}
