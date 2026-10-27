import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:immich_mobile/gallery/motion/motion_host.dart';
import 'package:immich_mobile/gallery/motion/motion_tokens.dart';
import 'package:immich_mobile/gallery/motion/spring_curve.dart';

/// Small particle bursts for rare, positive, user-initiated moments. Same shape as web's
/// `celebrate.ts`: a ring and a handful of pieces flung out from where the user tapped.
abstract final class GalleryCelebrate {
  static const _heartColor = Color(0xFFFF4D6D);

  /// A ring and seven small hearts burst from the last press (the heart button that was tapped).
  /// Only for favouriting ([when] false is an unfavourite), and nothing with reduced motion.
  static void favorite({bool when = true}) {
    if (when) {
      _burst(color: _heartColor, icon: Icons.favorite_rounded, pieces: 7);
    }
  }

  static void _burst({required Color color, required IconData icon, required int pieces}) {
    final overlay = GalleryMotionHost.overlay;
    final box = GalleryMotionHost.overlayBox;
    if (overlay == null || box == null || GalleryMotionHost.reduced) {
      return;
    }
    final origin = GalleryMotionHost.lastPointerDown ?? box.size.center(Offset.zero);
    late final OverlayEntry entry;
    entry = OverlayEntry(
      builder: (_) => _Burst(
        key: const Key('gallery-celebrate'),
        origin: origin,
        color: color,
        icon: icon,
        pieces: pieces,
        onDone: () {
          entry
            ..remove()
            ..dispose();
        },
      ),
    );
    overlay.insert(entry);
  }
}

class _Burst extends StatefulWidget {
  final Offset origin;
  final Color color;
  final IconData icon;
  final int pieces;
  final VoidCallback onDone;

  const _Burst({
    super.key,
    required this.origin,
    required this.color,
    required this.icon,
    required this.pieces,
    required this.onDone,
  });

  @override
  State<_Burst> createState() => _BurstState();
}

class _BurstState extends State<_Burst> with SingleTickerProviderStateMixin {
  static const _duration = Duration(milliseconds: 780);
  static final _pop = GallerySpringCurve(GalleryMotion.bouncy);
  late final AnimationController _clock = AnimationController(vsync: this, duration: _duration);

  @override
  void initState() {
    super.initState();
    _clock.forward().whenComplete(widget.onDone).ignore();
  }

  @override
  void dispose() {
    _clock.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: CustomPaint(
        size: Size.infinite,
        painter: _BurstPainter(
          clock: _clock,
          origin: widget.origin,
          color: widget.color,
          icon: widget.icon,
          pieces: widget.pieces,
          pop: _pop,
        ),
      ),
    );
  }
}

class _BurstPainter extends CustomPainter {
  final Animation<double> clock;
  final Offset origin;
  final Color color;
  final IconData icon;
  final int pieces;
  final Curve pop;

  _BurstPainter({
    required this.clock,
    required this.origin,
    required this.color,
    required this.icon,
    required this.pieces,
    required this.pop,
  }) : super(repaint: clock);

  @override
  void paint(Canvas canvas, Size size) {
    final t = clock.value;

    // The ring: expands fast and thins out within the first half.
    final ringT = (t / 0.5).clamp(0.0, 1.0);
    if (ringT < 1) {
      final ring = GalleryMotion.settle.transform(ringT);
      canvas.drawCircle(
        origin,
        8 + 30 * ring,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 3 * (1 - ring) + 0.5
          ..color = color.withValues(alpha: 0.8 * (1 - ring)),
      );
    }

    // The pieces: flung outward on the bouncy spring, drifting down a little, fading at the end.
    final travel = pop.transform(t);
    final fade = t < 0.55 ? 1.0 : 1 - (t - 0.55) / 0.45;
    for (var i = 0; i < pieces; i++) {
      final angle = -math.pi / 2 + i * 2 * math.pi / pieces + (i.isEven ? 0.12 : -0.08);
      final distance = (34 + (i % 3) * 7) * travel;
      final position = origin + Offset(math.cos(angle), math.sin(angle)) * distance + Offset(0, 10 * t * t);
      final scale = (0.4 + 0.6 * travel).clamp(0.0, 1.3);
      _paintIcon(canvas, position, 13 * scale, color.withValues(alpha: fade.clamp(0.0, 1.0)));
    }
  }

  void _paintIcon(Canvas canvas, Offset center, double size, Color color) {
    final painter = TextPainter(
      text: TextSpan(
        text: String.fromCharCode(icon.codePoint),
        style: TextStyle(fontSize: size, fontFamily: icon.fontFamily, package: icon.fontPackage, color: color),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    painter.paint(canvas, center - Offset(painter.width / 2, painter.height / 2));
    painter.dispose();
  }

  @override
  bool shouldRepaint(_BurstPainter old) => old.origin != origin || old.color != color;
}
