import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/models/photos_filter/filter_person.model.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';

void main() {
  group('SearchFilter equality', () {
    test('two empty filters are equal', () {
      expect(SearchFilter.empty(), SearchFilter.empty());
      expect(SearchFilter.empty().hashCode, SearchFilter.empty().hashCode);
    });
    test('filters with same single person (different Set instances) are equal', () {
      const alice = FilterPerson(id: 'alice', name: 'Alice');
      final a = SearchFilter.empty().copyWith(people: {alice});
      final b = SearchFilter.empty().copyWith(people: {alice});
      expect(a, b);
      expect(a.hashCode, b.hashCode);
    });
    test('filters with different people are NOT equal', () {
      const alice = FilterPerson(id: 'alice', name: 'Alice');
      const bob = FilterPerson(id: 'bob', name: 'Bob');
      final a = SearchFilter.empty().copyWith(people: {alice});
      final b = SearchFilter.empty().copyWith(people: {bob});
      expect(a, isNot(b));
    });
    test('filters with same single tagId (different List instances) are equal', () {
      final a = SearchFilter.empty().copyWith(tagIds: ['t1']);
      final b = SearchFilter.empty().copyWith(tagIds: ['t1']);
      expect(a, b);
      expect(a.hashCode, b.hashCode);
    });
    test('filters with different tagId order are NOT equal (List preserves order)', () {
      final a = SearchFilter.empty().copyWith(tagIds: ['t1', 't2']);
      final b = SearchFilter.empty().copyWith(tagIds: ['t2', 't1']);
      expect(a, isNot(b));
    });
  });
}
