import 'dart:math' as math;
import 'dart:typed_data';

// Spatial Scene (specs/2026-10-29-spatial-scene-design.md): the depth-map maths the web viewer runs in
// web/src/lib/gallery/spatial/depth.ts, ported one to one so both apps draw the same scene.

/// The red channel of an RGBA image of the depth map: the map is greyscale, 255 = nearest.
Uint8List depthFromRgba(Uint8List rgba) {
  final depth = Uint8List(rgba.length ~/ 4);
  for (var i = 0; i < depth.length; i++) {
    depth[i] = rgba[i * 4];
  }
  return depth;
}

/// The still plane: the mean depth of the foreground, split from the background with Otsu's threshold, as the server
/// computes it. Keeping the subject still and moving the background behind it is the Apple look, and it moves the
/// stretching at the subject's edges into the background, where it is least visible. 0..1.
double subjectDepth(Uint8List depth) {
  final histogram = Float64List(256);
  for (final value in depth) {
    histogram[value]++;
  }
  final total = depth.length;
  var sum = 0.0;
  for (var i = 0; i < 256; i++) {
    sum += i * histogram[i];
  }

  var best = 0.0;
  var threshold = 127;
  var backgroundCount = 0.0;
  var backgroundSum = 0.0;
  for (var i = 0; i < 256; i++) {
    backgroundCount += histogram[i];
    backgroundSum += i * histogram[i];
    final foregroundCount = total - backgroundCount;
    if (backgroundCount == 0 || foregroundCount == 0) {
      continue;
    }
    final gap = backgroundSum / backgroundCount - (sum - backgroundSum) / foregroundCount;
    final between = backgroundCount * foregroundCount * gap * gap;
    if (between <= best) {
      continue;
    }
    best = between;
    threshold = i;
  }

  var count = 0.0;
  var foreground = 0.0;
  for (var i = threshold + 1; i < 256; i++) {
    count += histogram[i];
    foreground += i * histogram[i];
  }
  return count > 0 ? foreground / count / 255 : sum / total / 255;
}

/// Separable max filter: near (bright) edges grow outwards by [radius] pixels, so the shader never samples a sliver of
/// the subject at a background depth and smears it across the background.
Uint8List dilate(Uint8List depth, int width, int height, int radius) {
  if (radius <= 0) {
    return depth;
  }
  final rows = Uint8List(depth.length);
  final out = Uint8List(depth.length);
  for (var y = 0; y < height; y++) {
    final row = y * width;
    for (var x = 0; x < width; x++) {
      var max = 0;
      for (var k = math.max(0, x - radius); k <= math.min(width - 1, x + radius); k++) {
        max = math.max(max, depth[row + k]);
      }
      rows[row + x] = max;
    }
  }
  for (var y = 0; y < height; y++) {
    for (var x = 0; x < width; x++) {
      var max = 0;
      for (var k = math.max(0, y - radius); k <= math.min(height - 1, y + radius); k++) {
        max = math.max(max, rows[k * width + x]);
      }
      out[y * width + x] = max;
    }
  }
  return out;
}

/// A greyscale depth map as opaque RGBA pixels, the layout `decodeImageFromPixels` takes for the shader's sampler.
Uint8List depthToRgba(Uint8List depth) {
  final rgba = Uint8List(depth.length * 4);
  for (var i = 0; i < depth.length; i++) {
    rgba[i * 4] = depth[i];
    rgba[i * 4 + 1] = depth[i];
    rgba[i * 4 + 2] = depth[i];
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

/// A damped spring, stepped by `dt` seconds, so the scene eases after the tilt instead of jumping to it. Slightly
/// underdamped, which reads as a physical object.
class Spring {
  double position = 0;
  double velocity = 0;

  void step(double target, double dt, {double stiffness = 60, double dampingRatio = 0.9}) {
    final damping = 2 * math.sqrt(stiffness) * dampingRatio;
    velocity += ((target - position) * stiffness - velocity * damping) * dt;
    position += velocity * dt;
  }
}
