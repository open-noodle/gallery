import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/utils/geo_uri.dart';

void main() {
  group('buildAndroidGeoUri', () {
    test('is an RFC 5870 geo URI with no authority and a literal comma in q', () {
      final uri = buildAndroidGeoUri(31.2304, 121.4737, zoom: 16);

      expect(uri.toString(), 'geo:31.2304,121.4737?q=31.2304,121.4737&z=16');
    });

    test('keeps negative coordinates intact', () {
      final uri = buildAndroidGeoUri(-33.8568, -151.2153, zoom: 16);

      expect(uri.toString(), 'geo:-33.8568,-151.2153?q=-33.8568,-151.2153&z=16');
    });

    test('parses back into the geo scheme with the coordinates as the path', () {
      final uri = buildAndroidGeoUri(48.8584, 2.2945, zoom: 16);

      expect(uri.scheme, 'geo');
      expect(uri.hasAuthority, isFalse);
      expect(uri.path, '48.8584,2.2945');
      expect(uri.queryParameters, {'q': '48.8584,2.2945', 'z': '16'});
    });
  });
}
