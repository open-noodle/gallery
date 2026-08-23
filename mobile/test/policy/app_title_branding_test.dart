import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/constants/constants.dart';

void main() {
  test('every MaterialApp title in source is the branded kAppTitle, not the upstream Immich name', () {
    const sources = ['lib/main.dart', 'lib/pages/common/splash_screen.page.dart'];

    for (final path in sources) {
      final content = File(path).readAsStringSync();
      expect(content, isNot(contains("title: 'Immich'")), reason: path);
      expect(content, contains('title: kAppTitle'), reason: path);
    }
  });

  test('kAppTitle carries the fork brand name', () {
    expect(kAppTitle, 'Noodle Gallery');
  });
}
