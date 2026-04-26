import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  Map<String, dynamic> loadTranslations(String path) {
    final file = File(path);
    return jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
  }

  Iterable<MapEntry<String, Map<String, dynamic>>> loadAllTranslationFiles() {
    return Directory('../i18n')
        .listSync()
        .whereType<File>()
        .where((file) => file.path.endsWith('.json'))
        .map((file) => MapEntry(file.path, loadTranslations(file.path)));
  }

  void expectMapDisclosure(String source, String content) {
    expect(content, contains('precise current location'), reason: source);
    expect(content, contains('center the map'), reason: source);
    expect(content, contains('current area'), reason: source);
    expect(content, contains('precise device location is not stored or shared'), reason: source);
  }

  void expectAutomaticEndpointDisclosures(String source, Map<String, dynamic> translations) {
    if (translations case {'location_permission_content': final String foreground}) {
      expect(foreground, contains('precise location'), reason: source);
      expect(foreground, contains('Wi-Fi network name'), reason: source);
      expect(foreground, contains('saved on this device for matching'), reason: source);
      expect(foreground, contains('automatic server switching'), reason: source);
      expect(foreground, contains('precise device location is not stored or shared'), reason: source);
    }

    if (translations case {'background_location_permission_content': final String background}) {
      expect(background, contains('background location'), reason: source);
      expect(background, contains('Wi-Fi network name'), reason: source);
      expect(background, contains('saved on this device for matching'), reason: source);
      expect(background, contains('automatic server switching'), reason: source);
      expect(background, contains('precise device location is not stored or shared'), reason: source);
    }
  }

  test('map disclosure explains precise current location usage', () {
    for (final MapEntry(key: source, value: translations) in loadAllTranslationFiles()) {
      if (translations case {'map_no_location_permission_content': final String content}) {
        expectMapDisclosure(source, content);
      }
    }
  });

  test('automatic endpoint disclosures explain Wi-Fi location permission usage', () {
    final translationMaps = [
      ...loadAllTranslationFiles(),
      MapEntry('../branding/i18n/overrides-en.json', loadTranslations('../branding/i18n/overrides-en.json')),
    ];

    for (final MapEntry(key: source, value: translations) in translationMaps) {
      expectAutomaticEndpointDisclosures(source, translations);
    }
  });
}
