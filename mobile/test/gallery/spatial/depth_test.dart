import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/gallery/spatial/depth.dart';

// Mirrors web/src/lib/gallery/spatial/depth.spec.ts, so the two viewers keep computing the same scene.
void main() {
  group('depthFromRgba', () {
    test('keeps the red channel of each pixel', () {
      expect(depthFromRgba(Uint8List.fromList([10, 0, 0, 255, 200, 1, 2, 255])), Uint8List.fromList([10, 200]));
    });
  });

  group('depthToRgba', () {
    test('repeats the depth in each colour channel, opaque', () {
      expect(depthToRgba(Uint8List.fromList([7, 200])), Uint8List.fromList([7, 7, 7, 255, 200, 200, 200, 255]));
    });
  });

  group('subjectDepth', () {
    test('is the mean depth of the nearer group', () {
      // a near subject (230/250) on a far background (20)
      final depth = Uint8List.fromList([20, 20, 20, 20, 20, 20, 230, 250]);
      expect(subjectDepth(depth), closeTo(240 / 255, 1e-5));
    });

    test('falls back to the overall mean for a flat map', () {
      expect(subjectDepth(Uint8List.fromList([100, 100, 100])), closeTo(100 / 255, 1e-5));
    });
  });

  group('dilate', () {
    test('grows near pixels by the radius in both directions', () {
      final depth = Uint8List(25);
      depth[12] = 255; // the centre of a 5×5 map
      final out = dilate(depth, 5, 5, 1);
      final grown = [
        for (var i = 0; i < out.length; i++)
          if (out[i] == 255) i,
      ];
      expect(grown, [6, 7, 8, 11, 12, 13, 16, 17, 18]);
    });

    test('returns the map untouched for radius 0', () {
      final depth = Uint8List.fromList([1, 2, 3]);
      expect(identical(dilate(depth, 3, 1, 0), depth), isTrue);
    });
  });

  group('Spring', () {
    test('settles on the target', () {
      final spring = Spring();
      for (var i = 0; i < 300; i++) {
        spring.step(1, 1 / 60);
      }
      expect(spring.position, closeTo(1, 1e-3));
    });
  });
}
