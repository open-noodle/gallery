import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/library_view.model.dart';
import 'package:immich_mobile/gallery/library_view.provider.dart';
import 'package:immich_mobile/gallery/search/search.providers.dart';
import 'package:immich_mobile/gallery/search/search.repository.dart';
import 'package:immich_mobile/gallery/search/search_mode.provider.dart';
import 'package:immich_mobile/gallery/search/search_options.model.dart';
import 'package:immich_mobile/gallery/search/search_scope.dart';
import 'package:immich_mobile/gallery/search/search_state.model.dart';
import 'package:openapi/api.dart';

// Slice 2 providers: loading order, stale responses, race-dropping, warm-up and the older / stock server fallbacks.

const gallery = SearchServerCapabilities(isGallery: true, searchOptions: true, localTakenRange: true);
const olderGallery = SearchServerCapabilities(isGallery: true, searchOptions: false, localTakenRange: true);

const availabilityAll = SearchAvailability(
  hasAssets: true,
  hasPeople: true,
  hasTags: true,
  hasPlaces: true,
  hasCameras: true,
  hasRatings: true,
  hasImages: true,
  hasVideos: true,
  hasFavorites: true,
  hasAssetsInAlbum: true,
  hasAssetsNotInAlbum: true,
);
const availabilityNoTags = SearchAvailability(
  hasAssets: true,
  hasPeople: true,
  hasTags: false,
  hasPlaces: true,
  hasCameras: true,
  hasRatings: true,
  hasImages: true,
  hasVideos: true,
  hasFavorites: true,
  hasAssetsInAlbum: true,
  hasAssetsNotInAlbum: true,
);

/// A repository whose every call is logged and answered by a completer the test resolves.
class FakeSearchRepository implements GallerySearchRepository {
  Future<SearchServerCapabilities> Function() onCapabilities;
  final log = <String>[];
  final pending = <String, List<Completer<Object?>>>{};

  FakeSearchRepository(SearchServerCapabilities capabilities) : onCapabilities = (() async => capabilities);

  Future<T> _call<T>(String key) {
    log.add(key);
    final completer = Completer<Object?>();
    pending.putIfAbsent(key, () => []).add(completer);
    return completer.future.then((value) => value as T);
  }

  /// Resolves the oldest pending call named [key].
  void answer(String key, Object? value) => pending[key]!.removeAt(0).complete(value);

  void fail(String key, Object error) => pending[key]!.removeAt(0).completeError(error);

  static String optionsKey(SearchParams p, Set<SearchDimension> dimensions) =>
      'options:${p.city ?? '-'}:${dimensions.isEmpty ? 'availability' : dimensions.single.name}';

  @override
  Future<SearchServerCapabilities> capabilities() => onCapabilities();

  @override
  Future<SearchOptionsPart> options(SearchParams p, {Set<SearchDimension> dimensions = const {}}) {
    optionsParams.add(p);
    return _call(optionsKey(p, dimensions));
  }

  final optionsParams = <SearchParams>[];

  @override
  Future<SearchOptionsPart> fallbackOptions(SearchParams p) => _call('fallback:${p.city ?? '-'}');

  @override
  Future<List<SearchCityOption>> fallbackCities(SearchParams p, String country) => _call('cities:$country');

  @override
  Future<List<TimeBucketsResponseDto>> timeBuckets(
    SearchParams p, {
    required SearchSort sort,
    bool byUploadDate = false,
  }) => _call('buckets:${p.city ?? '-'}');

  @override
  Future<TimeBucketAssetResponseDto?> timeBucket(
    SearchParams p,
    String timeBucket, {
    required SearchSort sort,
    bool byUploadDate = false,
  }) => _call('bucket:$timeBucket');

  @override
  Future<SearchResponseDto?> smart(SearchParams p, {required int page, required SearchSort sort, int size = 100}) =>
      _call('smart:$page');

  @override
  Future<SearchResponseDto?> metadata(SearchParams p, {required int page, required SearchSort sort, int size = 100}) {
    lastMetadataParams = p;
    return _call('metadata:$page');
  }

  SearchParams? lastMetadataParams;

  @override
  Future<int?> statistics(SearchParams p) => _call('statistics');

  @override
  Future<AssetResponseDto?> assetInfo(String id) => _call('asset:$id');
}

Future<void> settle() async {
  for (var i = 0; i < 10; i++) {
    await Future<void>.delayed(Duration.zero);
  }
}

ProviderContainer containerFor(FakeSearchRepository repository, {LibraryViewMode view = LibraryViewMode.both}) =>
    ProviderContainer(
      overrides: [
        // The Photos scope reads the library view (#1038), which needs the store; Both is no view.
        activeLibraryViewProvider.overrideWithValue(view),
        gallerySearchRepositoryProvider.overrideWithValue(repository),
        searchOptionsDebounceProvider.overrideWithValue(Duration.zero),
        searchResultsDebounceProvider.overrideWithValue(Duration.zero),
        searchClockProvider.overrideWithValue(() => DateTime(2026, 10, 23)),
      ],
    );

const dimensionNames = ['total', 'time', 'people', 'tags', 'places', 'cameras', 'ratings', 'mediaTypes'];

SearchResponseDto searchPage(List<String> ids, {String? nextPage}) => SearchResponseDto(
  albums: SearchAlbumResponseDto(count: 0, facets: const [], items: const [], total: 0),
  assets: SearchAssetResponseDto(
    count: ids.length,
    facets: const [],
    items: const [],
    nextPage: nextPage,
    total: ids.length,
  ),
);

void main() {
  group('loading order', () {
    test('availability first, then every dimension in parallel; a stale response is shown as is', () async {
      final repository = FakeSearchRepository(gallery);
      final container = containerFor(repository);
      addTearDown(container.dispose);
      container.listen(searchOptionsProvider, (_, _) {});
      await settle();

      expect(repository.log, ['options:-:availability']);
      repository.answer('options:-:availability', const SearchOptionsPart(availability: availabilityAll));
      await settle();

      expect(container.read(searchOptionsProvider).availability, availabilityAll);
      expect(repository.log.skip(1), [for (final d in dimensionNames) 'options:-:$d']);

      repository.answer(
        'options:-:people',
        const SearchOptionsPart(
          stale: true,
          people: [SearchPersonOption(filterId: 'person:a', name: 'Anna', count: 3)],
        ),
      );
      await settle();
      final options = container.read(searchOptionsProvider);
      expect(options.people!.single.name, 'Anna');
      expect(options.stale, isTrue);
      expect(options.tags, isNull, reason: 'still loading: the sheet shows a skeleton');
    });

    test('a failed availability is an error state, not a throw', () async {
      final repository = FakeSearchRepository(gallery);
      final container = containerFor(repository);
      addTearDown(container.dispose);
      container.listen(searchOptionsProvider, (_, _) {});
      await settle();
      repository.fail('options:-:availability', Exception('offline'));
      await settle();
      expect(container.read(searchOptionsProvider).error, isA<Exception>());
    });
  });

  group('race', () {
    test("filter A's options response arriving after filter B's is dropped", () async {
      final repository = FakeSearchRepository(gallery);
      final container = containerFor(repository);
      addTearDown(container.dispose);
      container.listen(searchOptionsProvider, (_, _) {});
      await settle();
      repository.answer('options:-:availability', const SearchOptionsPart(availability: availabilityAll));
      await settle();

      final notifier = container.read(searchStateProvider.notifier);
      notifier.setPlace(const SearchPlace(country: 'Japan', city: 'Kyoto'));
      await settle();
      expect(repository.log.last, 'options:Kyoto:availability');

      notifier.setPlace(const SearchPlace(country: 'Portugal', city: 'Lisbon'));
      await settle();
      expect(repository.log.last, 'options:Lisbon:availability');

      // B answers first, then A.
      repository.answer('options:Lisbon:availability', const SearchOptionsPart(availability: availabilityNoTags));
      await settle();
      repository.answer('options:Kyoto:availability', const SearchOptionsPart(availability: availabilityAll));
      await settle();
      expect(container.read(searchOptionsProvider).availability, availabilityNoTags);
      expect(repository.log.where((call) => call.startsWith('options:Kyoto:')), ['options:Kyoto:availability']);

      repository.answer('options:Lisbon:total', const SearchOptionsPart(total: 2));
      await settle();
      expect(container.read(searchOptionsProvider).total, 2);
    });

    test("filter A's results arriving after filter B's are dropped", () async {
      final repository = FakeSearchRepository(gallery);
      final container = containerFor(repository);
      addTearDown(container.dispose);
      container.listen(searchResultsProvider, (_, _) {});
      await settle();
      repository.answer('buckets:-', [TimeBucketsResponseDto(count: 13, timeBucket: '2024-06-01')]);
      await settle();
      expect(container.read(searchResultsProvider).total, 13);

      final notifier = container.read(searchStateProvider.notifier);
      notifier.setPlace(const SearchPlace(city: 'Kyoto'));
      await settle();
      notifier.setPlace(const SearchPlace(city: 'Lisbon'));
      await settle();
      repository.answer('buckets:Lisbon', [TimeBucketsResponseDto(count: 2, timeBucket: '2024-01-01')]);
      await settle();
      repository.answer('buckets:Kyoto', [TimeBucketsResponseDto(count: 5, timeBucket: '2024-06-01')]);
      await settle();
      expect(container.read(searchResultsProvider).total, 2);
      expect(container.read(searchTotalProvider), 2);
    });
  });

  group('warm-up', () {
    test('requests the unfiltered Photos availability and every dimension once, in the background', () async {
      final repository = FakeSearchRepository(gallery);
      final container = containerFor(repository);
      addTearDown(container.dispose);
      final warmUp = container.read(searchWarmUpProvider.future);
      await settle();
      expect(repository.log, ['options:-:availability']);
      repository.answer('options:-:availability', const SearchOptionsPart(availability: availabilityAll));
      await settle();
      for (final d in dimensionNames) {
        repository.answer('options:-:$d', const SearchOptionsPart());
      }
      await warmUp;
      await container.read(searchWarmUpProvider.future);
      expect(repository.log, ['options:-:availability', for (final d in dimensionNames) 'options:-:$d']);
    });

    test('warms the library view the Photos search will ask for (#1038)', () async {
      final repository = FakeSearchRepository(gallery);
      final container = containerFor(repository, view: LibraryViewMode.personal);
      addTearDown(container.dispose);
      unawaited(container.read(searchWarmUpProvider.future));
      await settle();

      expect(repository.optionsParams.single.libraryView, LibraryViewMode.personal);
      repository.answer('options:-:availability', const SearchOptionsPart(availability: availabilityAll));
      await settle();
      expect(repository.optionsParams.map((p) => p.libraryView).toSet(), {LibraryViewMode.personal});
    });

    test('sends nothing to an older Gallery server or a stock server', () async {
      for (final capabilities in [olderGallery, SearchServerCapabilities.stock]) {
        final repository = FakeSearchRepository(capabilities);
        final container = containerFor(repository);
        await container.read(searchWarmUpProvider.future);
        expect(repository.log, isEmpty);
        container.dispose();
      }
    });

    test('a failed warm-up is silent', () async {
      final repository = FakeSearchRepository(gallery);
      final container = containerFor(repository);
      addTearDown(container.dispose);
      final warmUp = container.read(searchWarmUpProvider.future);
      await settle();
      repository.fail('options:-:availability', Exception('cold cache timeout'));
      await expectLater(warmUp, completes);

      final noServer = FakeSearchRepository(gallery)..onCapabilities = () async => throw Exception('offline');
      final second = containerFor(noServer);
      addTearDown(second.dispose);
      await expectLater(second.read(searchWarmUpProvider.future), completes);
    });
  });

  group('older Gallery server (no searchOptions)', () {
    test('options come from the suggestion lists without counts, then cities per country; nothing throws', () async {
      final repository = FakeSearchRepository(olderGallery);
      final container = containerFor(repository);
      addTearDown(container.dispose);
      container.listen(searchOptionsProvider, (_, _) {});
      await settle();
      expect(repository.log, ['fallback:-']);

      repository.answer(
        'fallback:-',
        const SearchOptionsPart(
          countries: [
            SearchCountryOption(country: 'Japan'),
            SearchCountryOption(country: 'Portugal'),
          ],
          people: [SearchPersonOption(filterId: 'person:a', name: 'Anna')],
        ),
      );
      await settle();
      var options = container.read(searchOptionsProvider);
      expect(options.hasCounts, isFalse);
      expect(options.people!.single.count, isNull);
      expect(options.countries!.map((c) => c.cities), [null, null], reason: 'countries show before their cities');
      expect(options.months, isNull, reason: 'the When sheet waits for the month buckets');
      expect(repository.log.skip(1), ['buckets:-', 'cities:Japan', 'cities:Portugal']);

      // The suggestion lists have no months: they come from /timeline/buckets, with their counts.
      repository.answer('buckets:-', [
        TimeBucketsResponseDto(timeBucket: '2024-06-01', count: 3),
        TimeBucketsResponseDto(timeBucket: '2023-09-01', count: 2),
      ]);
      await settle();
      expect(container.read(searchOptionsProvider).months!.map((m) => (m.year, m.month, m.count)), [
        (2024, 6, 3),
        (2023, 9, 2),
      ]);

      repository.answer('cities:Portugal', const [SearchCityOption(city: 'Lisbon')]);
      repository.fail('cities:Japan', Exception('timeout'));
      await settle();
      options = container.read(searchOptionsProvider);
      expect(options.countries![1].cities!.single.city, 'Lisbon');
      expect(options.countries![0].cities, isNull);
      expect(options.error, isNull);
      expect(repository.log.where((call) => call.startsWith('options:')), isEmpty);
    });
  });

  group('older Gallery server, failed months', () {
    test('a failed month request shows the When error, not an endless placeholder', () async {
      final repository = FakeSearchRepository(olderGallery);
      final container = containerFor(repository);
      addTearDown(container.dispose);
      container.listen(searchOptionsProvider, (_, _) {});
      await settle();
      repository.answer('fallback:-', const SearchOptionsPart(countries: []));
      await settle();
      repository.fail('buckets:-', Exception('timeout'));
      await settle();
      expect(container.read(searchOptionsProvider).hasFailed(SearchDimension.time), isTrue);
    });
  });

  test('opening search mode asks the server for its capabilities again', () async {
    // An older server first (the app was on the demo), then a newer one after logging in there.
    final repository = FakeSearchRepository(olderGallery);
    final container = containerFor(repository);
    addTearDown(container.dispose);
    container.read(searchModeProvider.notifier).enter();
    expect((await container.read(searchCapabilitiesProvider.future)).searchOptions, isFalse);

    repository.onCapabilities = () async =>
        const SearchServerCapabilities(isGallery: true, searchOptions: true, localTakenRange: true);
    container.read(searchModeProvider.notifier).leave();
    expect(
      (await container.read(searchCapabilitiesProvider.future)).searchOptions,
      isFalse,
      reason: 'kept while search is closed',
    );
    container.read(searchModeProvider.notifier).enter();
    expect((await container.read(searchCapabilitiesProvider.future)).searchOptions, isTrue);
  });

  group('stock Immich server', () {
    test('facet options are unavailable and nothing is requested for them', () async {
      final repository = FakeSearchRepository(SearchServerCapabilities.stock);
      final container = containerFor(repository);
      addTearDown(container.dispose);
      container.listen(searchOptionsProvider, (_, _) {});
      await settle();
      expect(container.read(searchOptionsProvider).facetsSupported, isFalse);
      expect(repository.log, isEmpty);
    });

    test(
      'results still work through metadata search, with the device-local date encoding and no fork params',
      () async {
        final repository = FakeSearchRepository(SearchServerCapabilities.stock);
        final container = containerFor(repository);
        addTearDown(container.dispose);
        container.read(searchStateProvider.notifier).setDate(const SearchDate.year(2024));
        container.listen(searchResultsProvider, (_, _) {});
        await settle();
        expect(repository.log, ['metadata:1', 'statistics']);
        repository.answer('metadata:1', searchPage(['a', 'b'], nextPage: '2'));
        repository.answer('statistics', 7);
        await settle();

        final results = container.read(searchResultsProvider);
        expect(results.source, SearchResultsSource.metadata);
        expect(results.total, 7);
        expect(results.nextPage, 2);
        final params = repository.lastMetadataParams!;
        expect(params.takenAfter, DateTime(2024));
        expect(params.takenBefore, DateTime(2024, 12, 31, 23, 59, 59, 999));
        expect(
          (params.withSharedSpaces, params.withPartners, params.visibility),
          (null, null, SearchVisibility.timeline),
        );
      },
    );
  });

  test('query mode results come from smart search', () async {
    final repository = FakeSearchRepository(gallery);
    final container = containerFor(repository);
    addTearDown(container.dispose);
    container.read(searchStateProvider.notifier).setReferencePhoto('asset-1');
    container.listen(searchResultsProvider, (_, _) {});
    await settle();
    expect(repository.log, ['smart:1']);
  });

  test('a route scope gets its own state', () async {
    final repository = FakeSearchRepository(gallery);
    final root = containerFor(repository);
    addTearDown(root.dispose);
    final album = ProviderContainer(parent: root, overrides: searchRouteOverrides(const AlbumSearchScope('album-1')));
    addTearDown(album.dispose);
    album.read(searchStateProvider.notifier).setFavoritesOnly(true);
    expect(root.read(searchStateProvider).filters.favoritesOnly, isFalse);
    expect(album.read(searchScopeProvider), const AlbumSearchScope('album-1'));
  });

  test('the Photos scope browses within the library view (#1038)', () {
    for (final view in LibraryViewMode.values) {
      final container = ProviderContainer(overrides: [activeLibraryViewProvider.overrideWithValue(view)]);
      addTearDown(container.dispose);

      expect(container.read(searchScopeProvider), PhotosSearchScope(libraryView: view));
    }
  });
}
