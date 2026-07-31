import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_section_id.dart';

void main() {
  group('FilterSectionId', () {
    test('render order is people, places, tags, camera, when, rating, media, toggles', () {
      expect(FilterSectionId.values.map((e) => e.name).toList(), [
        'people',
        'places',
        'tags',
        'camera',
        'when',
        'rating',
        'media',
        'toggles',
      ]);
    });

    test('storageId is stable and unique', () {
      final ids = FilterSectionId.values.map((e) => e.storageId).toList();
      expect(ids.toSet().length, ids.length);
      expect(FilterSectionId.people.storageId, 'people');
      expect(FilterSectionId.toggles.storageId, 'toggles');
    });

    test('titleKey is non-empty for every section', () {
      for (final s in FilterSectionId.values) {
        expect(s.titleKey, isNotEmpty);
      }
    });

    test('fromStorageId round-trips known ids and returns null for unknown', () {
      for (final s in FilterSectionId.values) {
        expect(FilterSectionId.fromStorageId(s.storageId), s);
      }
      expect(FilterSectionId.fromStorageId('camera'), FilterSectionId.camera); // added in Slice 6
      expect(FilterSectionId.fromStorageId('nonsense'), isNull);
    });
  });
}
