import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  Map<String, dynamic> loadEnglishTranslations() {
    final file = File('../i18n/en.json');
    return jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
  }

  test('map disclosure explains precise current location usage', () {
    final translations = loadEnglishTranslations();
    final content = translations['map_no_location_permission_content'] as String;

    expect(content, contains('precise current location'));
    expect(content, contains('center the map'));
    expect(content, contains('current area'));
    expect(content, contains('not stored or shared'));
  });

  test('automatic endpoint disclosures explain Wi-Fi location permission usage', () {
    final translations = loadEnglishTranslations();
    final foreground = translations['location_permission_content'] as String;
    final background = translations['background_location_permission_content'] as String;

    expect(foreground, contains('precise location'));
    expect(foreground, contains('Wi-Fi network name'));
    expect(foreground, contains('automatic server switching'));
    expect(foreground, contains('not stored or shared'));

    expect(background, contains('background location'));
    expect(background, contains('Wi-Fi network name'));
    expect(background, contains('automatic server switching'));
    expect(background, contains('not stored or shared'));
  });
}
