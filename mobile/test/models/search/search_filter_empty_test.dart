import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';

void main() {
  group('SearchFilter.empty', () {
    test('returns a canonical empty filter', () {
      final f = SearchFilter.empty();
      expect(f.isEmpty, true);
      expect(f.people, isEmpty);
      expect(f.tagIds, anyOf(isNull, isEmpty));
      expect(f.context, anyOf(isNull, isEmpty));
    });
    test('two empty filters compare empty-equivalent', () {
      expect(SearchFilter.empty().isEmpty, SearchFilter.empty().isEmpty);
    });
  });
}
