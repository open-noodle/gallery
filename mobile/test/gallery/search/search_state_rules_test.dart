import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/search/search.providers.dart';
import 'package:immich_mobile/gallery/search/search_scope.dart';
import 'package:immich_mobile/gallery/search/search_state.model.dart';
import 'package:immich_mobile/gallery/search/search_state.notifier.dart';

// Slice 2 "Rules carried over" from today's photos_filter.provider.dart, plus the date encoding of
// search_filter.model.dart.
void main() {
  late ProviderContainer container;
  SearchState read() => container.read(searchStateProvider);
  SearchStateNotifier notifier() => container.read(searchStateProvider.notifier);

  setUp(() => container = ProviderContainer());
  tearDown(() => container.dispose());

  group('a new text query switches sort to Relevance', () {
    test('from Newest or Oldest', () {
      notifier().setSort(SearchSort.oldest);
      notifier().submitText('beach');
      expect(read().query, const SearchQuery.text('beach'));
      expect(read().sort, SearchSort.relevance);
    });

    test('a sort picked for the current query stays until the query changes', () {
      notifier().submitText('beach');
      notifier().setSort(SearchSort.newest);
      notifier().submitText('beach');
      expect(read().sort, SearchSort.newest);
      notifier().submitText('sunset');
      expect(read().sort, SearchSort.relevance);
    });

    test('clearing the query leaves Relevance for Newest', () {
      notifier().submitText('beach');
      notifier().clearQuery();
      expect(read().query, const SearchQuery.none());
      expect(read().sort, SearchSort.newest);
    });

    test('Relevance cannot be picked without a query', () {
      notifier().setSort(SearchSort.relevance);
      expect(read().sort, SearchSort.newest);
    });
  });

  group('tags and Untagged exclude each other', () {
    const beach = SearchTagRef(id: 't1', value: 'beach');

    test('choosing a tag clears Untagged', () {
      notifier().setUntagged(true);
      notifier().toggleTag(beach);
      expect(read().filters.untagged, isFalse);
      expect(read().filters.tags, [beach]);
    });

    test('Untagged clears the tags', () {
      notifier().toggleTag(beach);
      notifier().setUntagged(true);
      expect(read().filters.tags, isEmpty);
      expect(read().filters.untagged, isTrue);
    });
  });

  test('a reference photo sets Photos only and Relevance', () {
    notifier().setMediaType(SearchMediaType.video);
    notifier().setReferencePhoto('asset-1');
    expect(read().query, const SearchQuery.similarTo('asset-1'));
    expect(read().filters.mediaType, SearchMediaType.image);
    expect(read().sort, SearchSort.relevance);
  });

  group('query and reference photo replace each other', () {
    test('a text query replaces the reference photo', () {
      notifier().setReferencePhoto('asset-1');
      notifier().submitText('beach');
      expect(read().query, const SearchQuery.text('beach'));
    });

    test('a reference photo replaces the text query', () {
      notifier().submitText('beach');
      notifier().setReferencePhoto('asset-1');
      expect(read().query, const SearchQuery.similarTo('asset-1'));
    });
  });

  test('one period at a time: a custom range replaces a year', () {
    notifier().setDate(const SearchDate.year(2024));
    notifier().setDate(SearchDate.custom(from: DateTime(2023, 1, 5), to: DateTime(2023, 2, 1)));
    expect(read().filters.date, isA<SearchDateCustom>());
  });

  test('Clear all clears every filter and the query', () {
    notifier().submitText('beach');
    notifier().setFavoritesOnly(true);
    notifier().reset();
    expect(read().isEmpty, isTrue);
  });

  group('date encoding', () {
    final now = DateTime(2026, 10, 23, 15);
    final june = const SearchState().copyWith(filters: const SearchFilters(date: SearchDate.month(2024, 6)));

    test('a localTakenRange server gets UTC midnight of the first day and of the day after the last', () {
      final params = buildSearchParams(const PhotosSearchScope(), june, now: now, localTakenRange: true);
      expect(params.takenAfter, DateTime.utc(2024, 6));
      expect(params.takenBefore, DateTime.utc(2024, 7));
    });

    test('an older or stock server gets device-local start and end of day, inclusive', () {
      final params = buildSearchParams(const PhotosSearchScope(), june, now: now, localTakenRange: false);
      expect(params.takenAfter, DateTime(2024, 6));
      expect(params.takenBefore, DateTime(2024, 6, 30, 23, 59, 59, 999));
      expect(params.takenAfter!.isUtc, isFalse);
    });

    test('a custom range with one end set is open-ended on the other (Slice 5 fix)', () {
      SearchState custom({DateTime? from, DateTime? to}) => const SearchState().copyWith(
        filters: SearchFilters(
          date: SearchDate.custom(from: from, to: to),
        ),
      );
      for (final localTakenRange in [true, false]) {
        final since = buildSearchParams(
          const PhotosSearchScope(),
          custom(from: DateTime(2024, 6, 5)),
          now: now,
          localTakenRange: localTakenRange,
        );
        expect(since.takenAfter, localTakenRange ? DateTime.utc(2024, 6, 5) : DateTime(2024, 6, 5));
        expect(since.takenBefore, isNull, reason: 'from only: that date onward');

        final until = buildSearchParams(
          const PhotosSearchScope(),
          custom(to: DateTime(2024, 6, 5)),
          now: now,
          localTakenRange: localTakenRange,
        );
        expect(until.takenAfter, isNull, reason: 'to only: everything up to that date');
        expect(until.takenBefore, localTakenRange ? DateTime.utc(2024, 6, 6) : DateTime(2024, 6, 5, 23, 59, 59, 999));
      }
    });

    test('quick ranges end today', () {
      expect(
        const SearchDate.quickRange(SearchQuickRange.thisWeek).resolve(now),
        SearchDayRange(DateTime(2026, 10, 19), now),
      );
      expect(const SearchDate.quickRange(SearchQuickRange.today).resolve(now), SearchDayRange(now, now));
      expect(const SearchDate.decade(2020).resolve(now), SearchDayRange(DateTime(2020), DateTime(2029, 12, 31)));
    });
  });
}
