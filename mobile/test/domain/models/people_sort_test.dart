import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/config/app_config.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';

void main() {
  group('SettingsKey.peopleSortBy', () {
    test('round-trips every mode through the enum codec', () {
      for (final mode in PeopleSortBy.values) {
        expect(SettingsKey.peopleSortBy.decode(SettingsKey.peopleSortBy.encode(mode)), mode, reason: 'mode: $mode');
      }
    });

    test('defaults to photoCount', () {
      expect(defaultConfig.read(SettingsKey.peopleSortBy), PeopleSortBy.photoCount);
      expect(const AppConfig().people.sortBy, PeopleSortBy.photoCount);
    });
  });
}
