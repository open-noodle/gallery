import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  Map<String, dynamic> loadTranslations(String path) {
    final file = File(path);
    return jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
  }

  test('map disclosure explains precise current location usage', () {
    final translations = loadTranslations('../i18n/en.json');
    final content = translations['map_no_location_permission_content'] as String;

    expect(content, contains('precise current location'));
    expect(content, contains('center the map'));
    expect(content, contains('current area'));
    expect(content, contains('precise device location is not stored or shared'));
  });

  test('automatic endpoint disclosures explain Wi-Fi location permission usage', () {
    final translationMaps = [
      loadTranslations('../i18n/en.json'),
      loadTranslations('../branding/i18n/overrides-en.json'),
    ];

    for (final translations in translationMaps) {
      final foreground = translations['location_permission_content'] as String;
      final background = translations['background_location_permission_content'] as String;

      expect(foreground, contains('precise location'));
      expect(foreground, contains('Wi-Fi network name'));
      expect(foreground, contains('saved on this device for matching'));
      expect(foreground, contains('automatic server switching'));
      expect(foreground, contains('precise device location is not stored or shared'));

      expect(background, contains('background location'));
      expect(background, contains('Wi-Fi network name'));
      expect(background, contains('saved on this device for matching'));
      expect(background, contains('automatic server switching'));
      expect(background, contains('precise device location is not stored or shared'));
    }
  });
}
