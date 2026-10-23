import 'dart:async';

import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/search/search.repository.dart';
import 'package:immich_mobile/gallery/search/search_options.model.dart';
import 'package:immich_mobile/gallery/search/search_scope.dart';
import 'package:immich_mobile/gallery/search/search_state.model.dart';
import 'package:immich_mobile/gallery/search/search_state.notifier.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:openapi/api.dart';

// Search mode's providers. Each screen gets its own copy through searchRouteOverrides(scope), which Slice 3+ passes to
// TimelineRouteScope; the defaults below are the Photos screen's.

final gallerySearchRepositoryProvider = Provider<GallerySearchRepository>((ref) {
  final api = ref.watch(apiServiceProvider);
  return GallerySearchRepository(searchApi: api.searchApi, timelineApi: api.timelineApi, serverApi: api.serverInfoApi);
});

/// Read once per session: which search calls the server answers.
final searchCapabilitiesProvider = FutureProvider<SearchServerCapabilities>(
  (ref) => ref.watch(gallerySearchRepositoryProvider).capabilities(),
);

/// One options request per filter change, after this pause.
final searchOptionsDebounceProvider = Provider<Duration>((ref) => const Duration(milliseconds: 150));

/// Results are debounced separately.
final searchResultsDebounceProvider = Provider<Duration>((ref) => const Duration(milliseconds: 300));

/// "Today" for quick ranges.
final searchClockProvider = Provider<DateTime Function()>((ref) => DateTime.now);

/// The screen's scope. Overridden per route.
final searchScopeProvider = Provider<SearchScope>((ref) => const PhotosSearchScope(), dependencies: const []);

final searchStateProvider = NotifierProvider<SearchStateNotifier, SearchState>(
  SearchStateNotifier.new,
  dependencies: const [],
);

final searchOptionsProvider = NotifierProvider<SearchOptionsNotifier, SearchOptions>(
  SearchOptionsNotifier.new,
  dependencies: [searchScopeProvider, searchStateProvider],
);

final searchResultsProvider = NotifierProvider<SearchResultsNotifier, SearchResults>(
  SearchResultsNotifier.new,
  dependencies: [searchScopeProvider, searchStateProvider],
);

/// The exact total beside the results: the bucket sum in browse mode, the options' total otherwise.
final searchTotalProvider = Provider<int?>(
  (ref) => ref.watch(searchResultsProvider).total ?? ref.watch(searchOptionsProvider.select((o) => o.total)),
  dependencies: [searchResultsProvider, searchOptionsProvider],
);

/// A screen's own search: its scope, and a fresh state, options and results.
List<Override> searchRouteOverrides(SearchScope scope) => [
  searchScopeProvider.overrideWithValue(scope),
  searchStateProvider.overrideWith(SearchStateNotifier.new),
  searchOptionsProvider.overrideWith(SearchOptionsNotifier.new),
  searchResultsProvider.overrideWith(SearchResultsNotifier.new),
  searchTotalProvider.overrideWith(
    (ref) => ref.watch(searchResultsProvider).total ?? ref.watch(searchOptionsProvider.select((o) => o.total)),
  ),
];

/// Warms the server's unfiltered Photos cache (cold, about 5.8 s at 500k photos) before search opens: availability,
/// then every dimension, once per session. Only on a server with `searchOptions`; a failure is silent.
final searchWarmUpProvider = FutureProvider<void>((ref) async {
  try {
    final capabilities = await ref.watch(searchCapabilitiesProvider.future);
    if (!capabilities.searchOptions) {
      return;
    }
    final repository = ref.read(gallerySearchRepositoryProvider);
    final params = buildSearchParams(
      const PhotosSearchScope(),
      const SearchState(),
      now: ref.read(searchClockProvider)(),
      localTakenRange: capabilities.localTakenRange,
    );
    await repository.options(params);
    await Future.wait([
      for (final dimension in SearchDimension.values) repository.options(params, dimensions: {dimension}),
    ]);
  } catch (_) {
    // Only a cache warm-up: search opens normally without it.
  }
});

/// Options for the current scope and state. Loading order: availability first (the chip row renders from it), then
/// every dimension in parallel. A response for an older state is dropped, so a newer answer is never overwritten.
class SearchOptionsNotifier extends Notifier<SearchOptions> {
  int _generation = 0;
  Timer? _timer;

  @override
  SearchOptions build() {
    ref.watch(searchScopeProvider);
    ref.listen<SearchState>(searchStateProvider, (previous, next) {
      if (previous != next) {
        _schedule(ref.read(searchOptionsDebounceProvider));
      }
    });
    ref.onDispose(() {
      _timer?.cancel();
      _generation++;
    });
    // Search mode just opened: no pause before the first round.
    _schedule(Duration.zero);
    return const SearchOptions();
  }

  void _schedule(Duration delay) {
    _timer?.cancel();
    final generation = ++_generation;
    _timer = Timer(delay, () => unawaited(_load(generation)));
  }

  bool _current(int generation) => generation == _generation;

  Future<void> _load(int generation) async {
    final SearchServerCapabilities capabilities;
    try {
      capabilities = await ref.read(searchCapabilitiesProvider.future);
    } catch (error) {
      if (_current(generation)) {
        state = state.withError(error);
      }
      return;
    }
    if (!_current(generation)) {
      return;
    }
    if (!capabilities.isGallery) {
      // Stock Immich: no facet options (serverSupportsSpacesProvider's rule).
      state = SearchOptions.unsupported;
      return;
    }
    final params = buildSearchParams(
      ref.read(searchScopeProvider),
      ref.read(searchStateProvider),
      now: ref.read(searchClockProvider)(),
      localTakenRange: capabilities.localTakenRange,
    );
    final repository = ref.read(gallerySearchRepositoryProvider);
    if (!capabilities.searchOptions) {
      return _loadFallback(generation, repository, params);
    }

    state = state.restart(facetsSupported: true, hasCounts: true);
    try {
      final availability = await repository.options(params);
      if (!_current(generation)) {
        return;
      }
      state = state.merge(availability);
    } catch (error) {
      if (_current(generation)) {
        state = state.withError(error);
      }
      return;
    }
    await Future.wait([
      for (final dimension in SearchDimension.values)
        repository
            .options(params, dimensions: {dimension})
            .then((part) {
              if (_current(generation)) {
                state = state.merge(part);
              }
            })
            .catchError((Object error) {
              if (_current(generation)) {
                state = state.withError(error);
              }
            }),
    ]);
  }

  /// An older Gallery server: the suggestion lists without counts, then each country's cities without blocking.
  Future<void> _loadFallback(int generation, GallerySearchRepository repository, SearchParams params) async {
    state = state.restart(facetsSupported: true, hasCounts: false);
    final SearchOptionsPart part;
    try {
      part = await repository.fallbackOptions(params);
    } catch (error) {
      if (_current(generation)) {
        state = state.withError(error);
      }
      return;
    }
    if (!_current(generation)) {
      return;
    }
    state = const SearchOptions(hasCounts: false).merge(part);
    await Future.wait([
      for (final country in part.countries ?? const <SearchCountryOption>[])
        repository
            .fallbackCities(params, country.country)
            .then((cities) {
              if (_current(generation)) {
                state = state.withCities(country.country, cities);
              }
            })
            .catchError((Object _) {}),
    ]);
  }
}

enum SearchResultsSource {
  /// /timeline/buckets + /timeline/bucket.
  timeline,

  /// /search/smart pages.
  smart,

  /// /search/metadata pages: untagged browse, and every browse on a stock server.
  metadata,
}

class SearchResults {
  final bool loading;
  final SearchResultsSource? source;

  /// The exact total when this source knows it (timeline bucket sum, stock statistics); see searchTotalProvider.
  final int? total;

  /// [SearchResultsSource.timeline]: the month buckets, newest first unless sorted Oldest.
  final List<TimeBucketsResponseDto>? buckets;

  /// Paged sources: the assets loaded so far.
  final List<AssetResponseDto>? assets;
  final int? nextPage;
  final Object? error;

  const SearchResults({
    this.loading = false,
    this.source,
    this.total,
    this.buckets,
    this.assets,
    this.nextPage,
    this.error,
  });
}

/// Results for the current scope and state, debounced and race-dropped like the options.
class SearchResultsNotifier extends Notifier<SearchResults> {
  int _generation = 0;
  Timer? _timer;
  SearchParams? _params;
  SearchSort _sort = SearchSort.newest;
  bool _stock = false;

  @override
  SearchResults build() {
    ref.watch(searchScopeProvider);
    ref.listen<SearchState>(searchStateProvider, (previous, next) {
      if (previous != next) {
        _schedule(ref.read(searchResultsDebounceProvider));
      }
    });
    ref.onDispose(() {
      _timer?.cancel();
      _generation++;
    });
    _schedule(Duration.zero);
    return const SearchResults(loading: true);
  }

  void _schedule(Duration delay) {
    _timer?.cancel();
    final generation = ++_generation;
    _timer = Timer(delay, () => unawaited(_load(generation)));
  }

  bool _current(int generation) => generation == _generation;

  bool get _byUploadDate => ref.read(searchScopeProvider) is RecentlyAddedSearchScope;

  Future<void> _load(int generation) async {
    state = SearchResults(
      loading: true,
      source: state.source,
      total: state.total,
      buckets: state.buckets,
      assets: state.assets,
    );
    try {
      final capabilities = await ref.read(searchCapabilitiesProvider.future);
      if (!_current(generation)) {
        return;
      }
      final searchState = ref.read(searchStateProvider);
      var params = buildSearchParams(
        ref.read(searchScopeProvider),
        searchState,
        now: ref.read(searchClockProvider)(),
        localTakenRange: capabilities.localTakenRange,
      );
      _stock = !capabilities.isGallery;
      if (_stock) {
        params = upstreamOnlyParams(params);
      }
      _params = params;
      _sort = searchState.sort;
      final repository = ref.read(gallerySearchRepositoryProvider);

      if (searchState.isQueryMode) {
        final page = await repository.smart(params, page: 1, sort: _sort);
        if (_current(generation)) {
          state = _paged(SearchResultsSource.smart, page, total: null, previous: const []);
        }
        return;
      }
      if (_stock || params.untagged) {
        final results = await Future.wait([
          repository.metadata(params, page: 1, sort: _sort),
          if (_stock) repository.statistics(params),
        ]);
        if (_current(generation)) {
          final page = results[0] as SearchResponseDto?;
          state = _paged(
            SearchResultsSource.metadata,
            page,
            total: _stock ? results[1] as int? : null,
            previous: const [],
          );
        }
        return;
      }
      final buckets = await repository.timeBuckets(params, sort: _sort, byUploadDate: _byUploadDate);
      if (_current(generation)) {
        state = SearchResults(
          source: SearchResultsSource.timeline,
          buckets: buckets,
          total: buckets.fold<int>(0, (sum, bucket) => sum + bucket.count),
        );
      }
    } catch (error) {
      if (_current(generation)) {
        state = SearchResults(error: error, source: state.source);
      }
    }
  }

  static SearchResults _paged(
    SearchResultsSource source,
    SearchResponseDto? page, {
    required int? total,
    required List<AssetResponseDto> previous,
  }) => SearchResults(
    source: source,
    total: total,
    assets: [...previous, ...?page?.assets.items],
    nextPage: int.tryParse(page?.assets.nextPage ?? ''),
  );

  /// One month of a browse result (SearchResultsSource.timeline).
  Future<TimeBucketAssetResponseDto?> loadBucket(String timeBucket) async {
    final params = _params;
    if (params == null) {
      return null;
    }
    return ref
        .read(gallerySearchRepositoryProvider)
        .timeBucket(params, timeBucket, sort: _sort, byUploadDate: _byUploadDate);
  }

  /// The next page of a paged result.
  Future<void> loadNextPage() async {
    final params = _params;
    final page = state.nextPage;
    final source = state.source;
    if (params == null || page == null || source == null || source == SearchResultsSource.timeline) {
      return;
    }
    final generation = _generation;
    final repository = ref.read(gallerySearchRepositoryProvider);
    final response = source == SearchResultsSource.smart
        ? await repository.smart(params, page: page, sort: _sort)
        : await repository.metadata(params, page: page, sort: _sort);
    if (_current(generation)) {
      state = _paged(source, response, total: state.total, previous: state.assets ?? const []);
    }
  }
}
