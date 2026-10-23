import 'package:diacritic/diacritic.dart';
import 'package:immich_mobile/gallery/search/search_options.model.dart';
import 'package:immich_mobile/gallery/search/search_state.model.dart';

// The search field's suggestions (specs/2026-10-23-mobile-search-redesign-design.md, "The search field"). Matching is
// local: it reads the narrowed option lists already loaded for the chips, so with Kyoto active `@a` only offers people
// in Kyoto, and typing sends no request.

sealed class SearchSuggestion {
  const SearchSuggestion();
}

class PersonSuggestion extends SearchSuggestion {
  final SearchPersonOption person;
  const PersonSuggestion(this.person);
}

class TagSuggestion extends SearchSuggestion {
  final SearchTagOption tag;
  const TagSuggestion(this.tag);
}

/// A whole country ([city] null) or a city with its country.
class PlaceSuggestion extends SearchSuggestion {
  final String country;
  final String? city;
  final int? count;
  const PlaceSuggestion({required this.country, this.city, this.count});

  SearchPlace get place => SearchPlace(country: country, city: city);
}

class DateSuggestion extends SearchSuggestion {
  final SearchDate date;
  final int count;
  const DateSuggestion(this.date, this.count);
}

/// "Photos that look like '…'": runs a smart search.
class SmartSearchSuggestion extends SearchSuggestion {
  final String text;
  const SmartSearchSuggestion(this.text);
}

class SearchSuggestions {
  final List<PersonSuggestion> people;
  final List<TagSuggestion> tags;
  final List<PlaceSuggestion> places;
  final List<DateSuggestion> dates;

  /// Plain text only; never for `@` / `#`.
  final SmartSearchSuggestion? smartSearch;

  const SearchSuggestions({
    this.people = const [],
    this.tags = const [],
    this.places = const [],
    this.dates = const [],
    this.smartSearch,
  });

  static const empty = SearchSuggestions();

  bool get isEmpty => people.isEmpty && tags.isEmpty && places.isEmpty && dates.isEmpty && smartSearch == null;
}

const englishMonthNames = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

class SearchSuggestionMatcher {
  /// Matches per group for plain text.
  static const groupLimit = 3;

  /// Matches for `@` / `#`.
  static const prefixLimit = 8;

  /// Twelve month names in the display language (index 0 = January). English names always match too.
  final List<String> monthNames;

  const SearchSuggestionMatcher({this.monthNames = englishMonthNames});

  SearchSuggestions match(String raw, SearchOptions options) {
    final text = raw.trimLeft();
    if (text.startsWith('@')) {
      return SearchSuggestions(people: _people(text.substring(1), options, prefixLimit));
    }
    if (text.startsWith('#')) {
      return SearchSuggestions(tags: _tags(text.substring(1), options, prefixLimit));
    }
    final query = text.trim();
    if (query.isEmpty) {
      return SearchSuggestions.empty;
    }
    return SearchSuggestions(
      people: _people(query, options, groupLimit),
      tags: _tags(query, options, groupLimit),
      places: _places(query, options),
      dates: _dates(query, options),
      smartSearch: SmartSearchSuggestion(query),
    );
  }

  List<PersonSuggestion> _people(String query, SearchOptions options, int limit) => _rank<SearchPersonOption>(
    options.people ?? const [],
    query,
    (p) => [p.name],
    (p) => p.count,
  ).take(limit).map(PersonSuggestion.new).toList();

  List<TagSuggestion> _tags(String query, SearchOptions options, int limit) => _rank<SearchTagOption>(
    options.tags ?? const [],
    query,
    (t) => [t.value],
    (t) => t.count,
  ).take(limit).map(TagSuggestion.new).toList();

  /// City or country, across every country ("lis" → Lisbon, Portugal).
  List<PlaceSuggestion> _places(String query, SearchOptions options) {
    final candidates = <PlaceSuggestion>[
      for (final country in options.countries ?? const <SearchCountryOption>[]) ...[
        PlaceSuggestion(country: country.country, count: country.count),
        for (final city in country.cities ?? const <SearchCityOption>[])
          PlaceSuggestion(country: country.country, city: city.city, count: city.count),
      ],
    ];
    return _rank(candidates, query, (p) => [p.city ?? p.country], (p) => p.count).take(groupLimit).toList();
  }

  List<DateSuggestion> _dates(String query, SearchOptions options) {
    final months = options.months ?? const <SearchMonthCount>[];
    final years = <int, int>{};
    for (final month in months) {
      years[month.year] = (years[month.year] ?? 0) + month.count;
    }
    final newestFirst = years.keys.toList()..sort((a, b) => b.compareTo(a));
    final lower = query.toLowerCase();

    final decade = _decade(lower);
    if (decade != null) {
      final count = years.entries
          .where((e) => e.key >= decade && e.key < decade + 10)
          .fold(0, (sum, e) => sum + e.value);
      return count == 0 ? const [] : [DateSuggestion(SearchDate.decade(decade), count)];
    }

    if (RegExp(r'^\d{1,4}$').hasMatch(lower)) {
      return [
        for (final year in newestFirst)
          if (year.toString().startsWith(lower)) DateSuggestion(SearchDate.year(year), years[year]!),
      ].take(groupLimit).toList();
    }

    final month = _month(lower);
    if (month != null) {
      final matching = months.where((m) => m.month == month && m.count > 0).toList()
        ..sort((a, b) => b.year.compareTo(a.year));
      return [for (final m in matching.take(groupLimit)) DateSuggestion(SearchDate.month(m.year, m.month), m.count)];
    }
    return const [];
  }

  /// `2020s` → 2020, `20s` → 2020 (today's When picker rule: two digits are 20xx).
  static int? _decade(String query) {
    final four = RegExp(r'^(\d{3}0)s$').firstMatch(query);
    if (four != null) {
      return int.parse(four.group(1)!);
    }
    final two = RegExp(r'^(\d)0s$').firstMatch(query);
    if (two != null) {
      return 2000 + int.parse(two.group(1)!) * 10;
    }
    return null;
  }

  /// A month name prefix of two letters or more, in the display language or English.
  int? _month(String query) {
    if (query.length < 2 || !RegExp(r'^\p{L}+$', unicode: true).hasMatch(query)) {
      return null;
    }
    final folded = _fold(query);
    for (final names in [monthNames, englishMonthNames]) {
      for (var i = 0; i < 12 && i < names.length; i++) {
        if (_fold(names[i]).startsWith(folded)) {
          return i + 1;
        }
      }
    }
    return null;
  }

  /// Name starts with the query first, then a word starts with it, then contains it; then most photos.
  static List<T> _rank<T>(List<T> items, String query, List<String> Function(T) names, int? Function(T) count) {
    final q = _fold(query.trim());
    final scored = <(T, int, int)>[];
    for (final (index, item) in items.indexed) {
      var best = -1;
      for (final name in names(item)) {
        final folded = _fold(name);
        final score = q.isEmpty
            ? 0
            : folded.startsWith(q)
            ? 0
            : folded.split(RegExp(r'[\s\-_/]+')).any((word) => word.startsWith(q))
            ? 1
            : folded.contains(q)
            ? 2
            : -1;
        if (score >= 0 && (best < 0 || score < best)) {
          best = score;
        }
      }
      if (best >= 0) {
        scored.add((item, best, index));
      }
    }
    scored.sort((a, b) {
      final byScore = a.$2.compareTo(b.$2);
      if (byScore != 0) {
        return byScore;
      }
      final byCount = (count(b.$1) ?? 0).compareTo(count(a.$1) ?? 0);
      return byCount != 0 ? byCount : a.$3.compareTo(b.$3);
    });
    return scored.map((s) => s.$1).toList();
  }

  static String _fold(String value) => removeDiacritics(value).toLowerCase();
}
