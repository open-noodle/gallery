import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/gallery/gallery_app_header.dart';
import 'package:package_info_plus/package_info_plus.dart';

void main() {
  test('carries the app version in the x-gallery-app header', () async {
    PackageInfo.setMockInitialValues(
      appName: 'Gallery',
      packageName: 'de.opennoodle.gallery',
      version: '5.4.0',
      buildNumber: '1',
      buildSignature: '',
    );

    expect(await galleryAppHeaders(), {'x-gallery-app': '5.4.0'});
  });
}
