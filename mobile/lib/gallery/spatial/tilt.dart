import 'dart:math' as math;

/// Degrees of device tilt that reach the edge of the movement (the web viewer's `TILT_RANGE`).
const double tiltRange = 20;

/// How much of each new reading the filter takes: the accelerometer jitters while the phone is held, and the gyroscope
/// would drift instead.
const double _smoothing = 0.2;

/// Turns accelerometer readings (m/s², gravity included) into the scene's target, -1..1 on each axis, relative to how
/// the phone was held when the scene opened. Gravity alone gives the tilt without drift and needs no motion permission,
/// which the gyroscope-integrated orientation the web viewer gets from the browser would.
class TiltTracker {
  double? _baseRoll;
  double? _basePitch;
  double _roll = 0;
  double _pitch = 0;

  /// Left/right lean: positive when the phone's right edge dips.
  static double rollOf(double x, double y, double z) => math.atan2(x, math.sqrt(y * y + z * z)) * 180 / math.pi;

  /// Forward/back lean: positive when the top of the phone tips away.
  static double pitchOf(double y, double z) => math.atan2(z, y) * 180 / math.pi;

  /// Feeds one reading and returns the target. The first reading becomes the rest position.
  ({double x, double y}) update(double ax, double ay, double az) {
    final roll = rollOf(ax, ay, az);
    final pitch = pitchOf(ay, az);
    if (_baseRoll == null || _basePitch == null) {
      _baseRoll = _roll = roll;
      _basePitch = _pitch = pitch;
    }
    _roll += (roll - _roll) * _smoothing;
    _pitch += (pitch - _pitch) * _smoothing;
    return (
      x: ((_roll - _baseRoll!) / tiltRange).clamp(-1.0, 1.0),
      y: ((_pitch - _basePitch!) / tiltRange).clamp(-1.0, 1.0),
    );
  }

  /// Makes the next reading the rest position again.
  void reset() {
    _baseRoll = null;
    _basePitch = null;
  }
}
