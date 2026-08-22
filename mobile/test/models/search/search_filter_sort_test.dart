import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';

void main() {
  test('defaults to relevance', () {
    expect(SearchFilter.empty().sort, SearchSortOrder.relevance);
  });

  test('copyWith sets and preserves sort', () {
    final f = SearchFilter.empty().copyWith(sort: SearchSortOrder.newest);
    expect(f.sort, SearchSortOrder.newest);
    expect(f.copyWith().sort, SearchSortOrder.newest);
  });

  test('sort participates in equality and hashCode', () {
    final a = SearchFilter.empty().copyWith(context: 'x');
    final b = SearchFilter.empty().copyWith(context: 'x');
    expect(a, b);
    final c = b.copyWith(sort: SearchSortOrder.oldest);
    expect(a == c, isFalse);
    expect(a.hashCode == c.hashCode, isFalse);
  });
}
