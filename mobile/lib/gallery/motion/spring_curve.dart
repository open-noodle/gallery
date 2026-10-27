import 'package:flutter/animation.dart';
import 'package:flutter/physics.dart';

/// A damped spring's step response from 0 to 1 as a [Curve], so a spring can drive a fixed-length
/// animation (a route's hero flight) the way web's `linear()` spring easings do. The curve overshoots
/// past 1 before settling, by the spring's own amount.
class GallerySpringCurve extends Curve {
  final SpringDescription spring;
  final SpringSimulation _simulation;

  /// Seconds the spring takes to settle within 0.2% of rest; t = 1 maps here.
  final double settleSeconds;

  GallerySpringCurve(this.spring) : _simulation = SpringSimulation(spring, 0, 1, 0), settleSeconds = _settle(spring);

  static double _settle(SpringDescription spring) {
    final probe = SpringSimulation(spring, 0, 1, 0, tolerance: const Tolerance(distance: 0.002, velocity: 0.02));
    var t = 0.0;
    while (!probe.isDone(t) && t < 5) {
      t += 0.001;
    }
    return t;
  }

  @override
  double transformInternal(double t) => _simulation.x(t * settleSeconds);
}
