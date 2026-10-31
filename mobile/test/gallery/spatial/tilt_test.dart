import 'dart:math' as math;

import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/gallery/spatial/tilt.dart';

const g = 9.81;

/// Gravity as the accelerometer reads it for a phone held upright, then leaned [roll] degrees to the right and its top
/// tipped [pitch] degrees away.
(double, double, double) reading({double roll = 0, double pitch = 0}) {
  final r = roll * math.pi / 180;
  final p = pitch * math.pi / 180;
  return (g * math.sin(r), g * math.cos(r) * math.cos(p), g * math.cos(r) * math.sin(p));
}

({double x, double y}) settle(TiltTracker tracker, (double, double, double) value) {
  var target = (x: 0.0, y: 0.0);
  for (var i = 0; i < 100; i++) {
    target = tracker.update(value.$1, value.$2, value.$3);
  }
  return target;
}

void main() {
  test('reads roll and pitch off the gravity vector', () {
    final (x, y, z) = reading(roll: 10, pitch: 15);
    expect(TiltTracker.rollOf(x, y, z), closeTo(10, 1e-6));
    expect(TiltTracker.pitchOf(y, z), closeTo(15, 1e-6));
  });

  test('starts at rest wherever the phone is held', () {
    final tracker = TiltTracker();
    final (x, y, z) = reading(roll: 5, pitch: 40);
    expect(tracker.update(x, y, z), (x: 0.0, y: 0.0));
  });

  test('reaches the edge of the movement at the tilt range, relative to the rest position', () {
    final tracker = TiltTracker();
    final (x, y, z) = reading(pitch: 30);
    tracker.update(x, y, z);

    final half = settle(tracker, reading(roll: tiltRange / 2, pitch: 30));
    expect(half.x, closeTo(0.5, 1e-3));
    expect(half.y, closeTo(0, 1e-3));

    final away = settle(tracker, reading(pitch: 30 + tiltRange));
    expect(away.x, closeTo(0, 1e-3));
    expect(away.y, closeTo(1, 1e-3));
  });

  test('clamps past the tilt range', () {
    final tracker = TiltTracker();
    final (x, y, z) = reading();
    tracker.update(x, y, z);
    expect(settle(tracker, reading(roll: -3 * tiltRange)).x, closeTo(-1, 1e-9));
  });

  test('takes the next reading as the rest position after a reset', () {
    final tracker = TiltTracker();
    settle(tracker, reading(roll: 15));
    tracker.reset();
    final (x, y, z) = reading(roll: 15);
    expect(tracker.update(x, y, z), (x: 0.0, y: 0.0));
  });
}
