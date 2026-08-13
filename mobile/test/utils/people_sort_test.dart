import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/utils/people_sort.dart';

DriftPerson _p(String id, {String name = '', bool isFavorite = false, int? numberOfAssets}) => DriftPerson(
  id: id,
  createdAt: DateTime(2024, 1, 1),
  updatedAt: DateTime(2024, 1, 1),
  ownerId: '',
  name: name,
  isFavorite: isFavorite,
  isHidden: false,
  color: null,
  numberOfAssets: numberOfAssets,
);

List<DriftPerson> _sorted(List<DriftPerson> people, PeopleSortBy sortBy) =>
    [...people]..sort((a, b) => comparePeople(a, b, sortBy));

void main() {
  group('comparePeople', () {
    test('sorts by photo count: favorites first, then named, then most assets', () {
      final result = _sorted([
        _p('zoe', name: 'Zoe', numberOfAssets: 5),
        _p('unnamed', numberOfAssets: 99),
        _p('fav', name: 'Fav', numberOfAssets: 1, isFavorite: true),
        _p('alice', name: 'Alice', numberOfAssets: 10),
      ], PeopleSortBy.photoCount);

      expect(result.map((p) => p.id), ['fav', 'alice', 'zoe', 'unnamed']);
    });

    test('sorts by name: favorites first, then alphabetical, unnamed last', () {
      final result = _sorted([
        _p('zoe', name: 'Zoe', numberOfAssets: 10),
        _p('unnamed', numberOfAssets: 99),
        _p('alice', name: 'alice', numberOfAssets: 1),
        _p('fav', name: 'Zzz', numberOfAssets: 1, isFavorite: true),
      ], PeopleSortBy.name);

      expect(result.map((p) => p.id), ['fav', 'alice', 'zoe', 'unnamed']);
    });

    test('breaks ties on id so the order is total and stable', () {
      final result = _sorted([
        _p('b', name: 'Same', numberOfAssets: 3),
        _p('a', name: 'Same', numberOfAssets: 3),
      ], PeopleSortBy.name);

      expect(result.map((p) => p.id), ['a', 'b']);
    });

    test('treats a null numberOfAssets as zero rather than throwing', () {
      final result = _sorted([
        _p('null-count', name: 'A'),
        _p('has-count', name: 'B', numberOfAssets: 4),
      ], PeopleSortBy.photoCount);

      expect(result.map((p) => p.id), ['has-count', 'null-count']);
    });

    test('in name mode, ties on name break by asset count descending', () {
      final result = _sorted([
        _p('fewer', name: 'Same', numberOfAssets: 1),
        _p('more', name: 'Same', numberOfAssets: 9),
      ], PeopleSortBy.name);

      expect(result.map((p) => p.id), ['more', 'fewer']);
    });

    test('in photoCount mode, ties on asset count break alphabetically by name', () {
      final result = _sorted([
        _p('zoe', name: 'Zoe', numberOfAssets: 5),
        _p('alice', name: 'Alice', numberOfAssets: 5),
      ], PeopleSortBy.photoCount);

      expect(result.map((p) => p.id), ['alice', 'zoe']);
    });
  });
}
