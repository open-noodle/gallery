import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/domain/models/setting.model.dart';

void main() {
  group('peopleSortByFromSettingIndex', () {
    test('maps valid indices to modes', () {
      expect(peopleSortByFromSettingIndex(PeopleSortBy.photoCount.index), PeopleSortBy.photoCount);
      expect(peopleSortByFromSettingIndex(PeopleSortBy.name.index), PeopleSortBy.name);
    });

    test('clamps out-of-range indices to the photoCount default', () {
      expect(peopleSortByFromSettingIndex(-1), PeopleSortBy.photoCount);
      expect(peopleSortByFromSettingIndex(99), PeopleSortBy.photoCount);
    });
  });

  test('Setting.peopleSortBy defaults to photoCount', () {
    expect(Setting.peopleSortBy.defaultValue, PeopleSortBy.photoCount.index);
  });
}
