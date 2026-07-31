import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/person.model.dart';

// Slice 3 (people picker + cap): PersonDto grows a nullable numberOfAssets so the
// full-screen picker can render a per-row photo count with no extra network call.
void main() {
  const base = PersonDto(id: 'a', name: 'Alice', isHidden: false, thumbnailPath: '', numberOfAssets: 5);

  group('PersonDto.numberOfAssets', () {
    test('copyWith preserves the field when not overridden', () {
      final copy = base.copyWith(name: 'Alicia');
      expect(copy.numberOfAssets, 5);
      expect(copy.name, 'Alicia');
    });

    test('copyWith overrides the field when provided', () {
      final copy = base.copyWith(numberOfAssets: 9);
      expect(copy.numberOfAssets, 9);
    });

    test('== and hashCode include numberOfAssets', () {
      const same = PersonDto(id: 'a', name: 'Alice', isHidden: false, thumbnailPath: '', numberOfAssets: 5);
      const different = PersonDto(id: 'a', name: 'Alice', isHidden: false, thumbnailPath: '', numberOfAssets: 6);

      expect(base, same);
      expect(base.hashCode, same.hashCode);
      expect(base, isNot(equals(different)));
    });

    test('fromMap(toMap()) round-trips a non-null value', () {
      final roundTripped = PersonDto.fromMap(base.toMap());
      expect(roundTripped.numberOfAssets, 5);
      expect(roundTripped, base);
    });

    test('fromMap(toMap()) round-trips a null value', () {
      const nullCount = PersonDto(id: 'b', name: 'Bob', isHidden: false, thumbnailPath: '');
      final roundTripped = PersonDto.fromMap(nullCount.toMap());
      expect(roundTripped.numberOfAssets, isNull);
      expect(roundTripped, nullCount);
    });
  });
}
