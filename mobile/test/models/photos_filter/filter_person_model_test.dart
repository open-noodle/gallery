import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/models/photos_filter/filter_person.model.dart';

void main() {
  test('value equality dedupes the same token across surfaces (spec 9.2-A set semantics)', () {
    // The picker and the suggestion strips construct FilterPerson independently; the
    // SearchFilter people set must treat the same token as one selection. Deliberately
    // non-const: const canonicalization would make these `identical()`, which would let
    // the test pass on identity alone instead of exercising the generated `==`/`hashCode`.
    // ignore: prefer_const_constructors
    final fromPicker = FilterPerson(id: 'space-person:sp1', name: 'Zoe', spaceId: 'space-1');
    // ignore: prefer_const_constructors
    final fromStrip = FilterPerson(id: 'space-person:sp1', name: 'Zoe', spaceId: 'space-1');
    expect({fromPicker, fromStrip}, hasLength(1));
  });

  test('numberOfAssets and updatedAt are optional (offline/local sources leave them null)', () {
    const p = FilterPerson(id: 'person:p1', name: 'Alice');
    expect(p.numberOfAssets, isNull);
    expect(p.updatedAt, isNull);
    expect(p.spaceId, isNull);
  });

  test('numberOfAssets carries through when present (ports person_dto_number_of_assets_test)', () {
    const p = FilterPerson(id: 'person:p1', name: 'Alice', numberOfAssets: 42);
    expect(p.numberOfAssets, 42);
  });
}
