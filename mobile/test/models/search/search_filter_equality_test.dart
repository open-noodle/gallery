import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';

void main() {
  group('SearchFilter equality', () {
    test('two empty filters are equal', () {
      expect(SearchFilter.empty(), SearchFilter.empty());
      expect(SearchFilter.empty().hashCode, SearchFilter.empty().hashCode);
    });
    test('filters with same single person (different Set instances) are equal', () {
      const alice = PersonDto(id: 'alice', name: 'Alice', isHidden: false, thumbnailPath: '');
      final a = SearchFilter.empty().copyWith(people: {alice});
      final b = SearchFilter.empty().copyWith(people: {alice});
      expect(a, b);
      expect(a.hashCode, b.hashCode);
    });
    test('filters with different people are NOT equal', () {
      const alice = PersonDto(id: 'alice', name: 'Alice', isHidden: false, thumbnailPath: '');
      const bob = PersonDto(id: 'bob', name: 'Bob', isHidden: false, thumbnailPath: '');
      final a = SearchFilter.empty().copyWith(people: {alice});
      final b = SearchFilter.empty().copyWith(people: {bob});
      expect(a, isNot(b));
    });
    test('filters with same single tagId (different List instances) are equal', () {
      final a = SearchFilter.empty().copyWith()..tagIds = ['t1'];
      final b = SearchFilter.empty().copyWith()..tagIds = ['t1'];
      expect(a, b);
      expect(a.hashCode, b.hashCode);
    });
    test('filters with different tagId order are NOT equal (List preserves order)', () {
      final a = SearchFilter.empty().copyWith()..tagIds = ['t1', 't2'];
      final b = SearchFilter.empty().copyWith()..tagIds = ['t2', 't1'];
      expect(a, isNot(b));
    });
  });
}
