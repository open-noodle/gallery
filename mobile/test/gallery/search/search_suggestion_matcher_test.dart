import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/gallery/search/search_options.model.dart';
import 'package:immich_mobile/gallery/search/search_state.model.dart';
import 'package:immich_mobile/gallery/search/search_suggestion_matcher.dart';

import 'search_test_utils.dart';

// Slice 2 "Matcher": given the options loaded for Kyoto (the recorded dimension-photos-kyoto-* responses, decoded by
// the real client), the field's suggestions come from those lists only.
void main() {
  const matcher = SearchSuggestionMatcher();
  late SearchOptions kyoto;

  setUpAll(() async {
    kyoto = await loadDimensionOptions('photos-kyoto');
  });

  test('@a returns only the matching people from the Kyoto options', () {
    final result = matcher.match('@a', kyoto);
    // Ben has no "a"; Rex is in the Photos options but not in Kyoto's.
    expect(result.people.map((p) => p.person.name), ['Anna']);
    expect(result.people.single.person.filterId, startsWith('person:'));
    expect(result.tags, isEmpty);
    expect(result.places, isEmpty);
    expect(result.dates, isEmpty);
    expect(result.smartSearch, isNull);
  });

  test('@ alone returns the top people, # alone the top tags; neither ends with smart search', () {
    expect(matcher.match('@', kyoto).people.map((p) => p.person.name), ['Anna', 'Ben']);
    final tags = matcher.match('#', kyoto);
    expect(tags.tags.map((t) => t.tag.value), ['beach', 'food']);
    expect(tags.smartSearch, isNull);
    expect(tags.people, isEmpty);
  });

  test('lis returns Lisbon with Portugal (places match cities across every country)', () {
    final places = matcher.match('lis', kyoto).places;
    expect(places.map((p) => (p.city, p.country)), [('Lisbon', 'Portugal')]);
    expect(places.single.place, const SearchPlace(country: 'Portugal', city: 'Lisbon'));
  });

  test('a country name matches the country', () {
    expect(matcher.match('portu', kyoto).places.first.place, const SearchPlace(country: 'Portugal'));
  });

  test('20 returns years starting with 20', () async {
    final photos = await loadDimensionOptions('photos');
    expect(matcher.match('20', photos).dates.map((d) => d.date), const [SearchDate.year(2024), SearchDate.year(2023)]);
    expect(matcher.match('20', kyoto).dates.map((d) => d.date), const [SearchDate.year(2024)]);
    expect(matcher.match('2023', kyoto).dates, isEmpty);
  });

  test('2020s and 20s return the 2020s decade', () {
    for (final text in ['2020s', '20s']) {
      final dates = matcher.match(text, kyoto).dates;
      expect(dates.map((d) => d.date), const [SearchDate.decade(2020)], reason: text);
      expect(dates.single.count, 5);
    }
    expect(matcher.match('1990s', kyoto).dates, isEmpty);
  });

  test('jun returns June in the recent years that have June photos', () {
    expect(matcher.match('jun', kyoto).dates.map((d) => d.date), const [SearchDate.month(2024, 6)]);
    const months = SearchOptions(
      months: [
        SearchMonthCount(year: 2024, month: 6, count: 2),
        SearchMonthCount(year: 2024, month: 7, count: 2),
        SearchMonthCount(year: 2023, month: 6, count: 1),
        SearchMonthCount(year: 2021, month: 6, count: 4),
        SearchMonthCount(year: 2019, month: 6, count: 9),
      ],
    );
    expect(matcher.match('June', months).dates.map((d) => d.date), const [
      SearchDate.month(2024, 6),
      SearchDate.month(2023, 6),
      SearchDate.month(2021, 6),
    ]);
    expect(matcher.match('j', months).dates, isEmpty, reason: 'a month needs two letters');
  });

  test('a localized month name matches', () {
    const german = SearchSuggestionMatcher(
      monthNames: [
        'Januar',
        'Februar',
        'März',
        'April',
        'Mai',
        'Juni',
        'Juli',
        'August',
        'September',
        'Oktober',
        'November',
        'Dezember',
      ],
    );
    const months = SearchOptions(months: [SearchMonthCount(year: 2024, month: 3, count: 1)]);
    expect(german.match('mär', months).dates.map((d) => d.date), const [SearchDate.month(2024, 3)]);
  });

  test('plain text always ends with the smart-search entry; @ and # text never does', () {
    expect(matcher.match('beach', kyoto).smartSearch?.text, 'beach');
    expect(matcher.match('zzz nothing', kyoto).smartSearch?.text, 'zzz nothing');
    expect(matcher.match('@be', kyoto).smartSearch, isNull);
    expect(matcher.match('#be', kyoto).smartSearch, isNull);
    expect(matcher.match('   ', kyoto).isEmpty, isTrue);
  });

  test('plain text groups people, tags, places and dates, three each at most', () {
    final result = matcher.match('be', kyoto);
    expect(result.people.map((p) => p.person.name), ['Ben']);
    expect(result.tags.map((t) => t.tag.value), ['beach']);
    expect(result.places.map((p) => p.city), ['Berlin']);
    expect(result.places.length, lessThanOrEqualTo(SearchSuggestionMatcher.groupLimit));
  });
}
