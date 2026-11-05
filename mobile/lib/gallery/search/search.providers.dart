import 'dart:async';

import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/library_view.provider.dart';
import 'package:immich_mobile/gallery/search/search.repository.dart';
import 'package:immich_mobile/gallery/search/search_mode.provider.dart';
import 'package:immich_mobile/gallery/search/search_options.model.dart';
import 'package:immich_mobile/gallery/search/search_scope.dart';
import 'package:immich_mobile/gallery/search/search_state.model.dart';
import 'package:immich_mobile/gallery/search/search_state.notifier.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:openapi/api.dart';

// Search mode's providers. Each screen gets its own copy through searchRouteOverrides(scope), which Slice 3+ passes to
// TimelineRouteScope; the defaults below are the Photos screen's.

final gallerySearchRepositoryProvider = Provider<GallerySearchRepository>((ref) {
  final api = ref.watch(apiServiceProvider);
  return GallerySearchRepository(
    searchApi: api.searchApi,
    timelineApi: api.timelineApi,
    serverApi: api.serverInfoApi,
    assetsApi: api.assetsApi,
  );
});

/// Read once per session: which search calls the server answers.
/// Asked again every time search mode opens (SearchModeNotifier.enter): kept for the whole app session, an older
/// server's answer outlived logging in to a newer one (or the server's upgrade), and search waited on dimensions the
/// app thought the server could not answer.
final searchCapabilitiesProvider = FutureProvider<SearchServerCapabilities>(
  (ref) => ref.watch(gallerySearchRepositoryProvider).capabilities(),
);

/// One options request per filter change, after this pause.
final searchOptionsDebounceProvider = Provider<Duration>((ref) => const Duration(milliseconds: 150));

/// How long after a stale options answer (served from the server's cache while it refreshes) the options are first
/// asked again. Each further stale answer doubles the wait, up to [searchOptionsStaleRetryMax].
final searchOptionsStaleRetryProvider = Provider<Duration>((ref) => const Duration(seconds: 2));

/// The longest wait between two requests while the answers stay stale.
const searchOptionsStaleRetryMax = Duration(seconds: 30);

/// Results are debounced separately.
final searchResultsDebounceProvider = Provider<Duration>((ref) => const Duration(milliseconds: 300));

/// "Today" for quick ranges.
final searchClockProvider = Provider<DateTime Function()>((ref) => DateTime.now);

/// The screen's scope. Overridden per route; the default is the Photos tab's, which browses within its library view
/// (#1038).
final searchScopeProvider = Provider<SearchScope>(
  (ref) => PhotosSearchScope(libraryView: ref.watch(activeLibraryViewProvider)),
  dependencies: const [],
);

/// The screen's name (SearchScope.name), apart from the scope: a scope keeps its first instance while its ids are
/// unchanged, so a rename or a name that loads late reaches the placeholder through here.
final searchScopeNameProvider = Provider<String?>((ref) => null, dependencies: const []);

/// A person page's fixed person (SearchScope.fixedPerson), named by the page.
final searchFixedPersonProvider = Provider<SearchPersonRef?>(
  (ref) => ref.watch(searchScopeProvider).fixedPerson(ref.watch(searchScopeNameProvider)),
  dependencies: [searchScopeProvider, searchScopeNameProvider],
);

final searchStateProvider = NotifierProvider<SearchStateNotifier, SearchState>(
  SearchStateNotifier.new,
  dependencies: const [],
);

final searchOptionsProvider = NotifierProvider<SearchOptionsNotifier, SearchOptions>(
  SearchOptionsNotifier.new,
  dependencies: [searchScopeProvider, searchStateProvider, searchModeProvider],
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
  // An owner-only scope is the signed-in user's (SearchScope.forUser).
  if (scope.needsUser)
    searchScopeProvider.overrideWith((ref) => scope.forUser(ref.watch(currentUserProvider.select((user) => user?.id))))
  else
    searchScopeProvider.overrideWithValue(scope),
  searchScopeNameProvider.overrideWithValue(scope.name),
  searchFixedPersonProvider,
  searchStateProvider.overrideWith(SearchStateNotifier.new),
  searchOptionsProvider.overrideWith(SearchOptionsNotifier.new),
  searchResultsProvider.overrideWith(SearchResultsNotifier.new),
  searchTotalProvider.overrideWith(
    (ref) => ref.watch(searchResultsProvider).total ?? ref.watch(searchOptionsProvider.select((o) => o.total)),
  ),
];

/// Retry after a failed options request: the options again, and the results too when they failed as well.
void retrySearch(WidgetRef ref) {
  ref.read(searchOptionsProvider.notifier).retry();
  ref.read(searchResultsProvider.notifier).retry();
}

/// Warms the server's unfiltered Photos cache (cold, about 5.8 s at 500k photos) before search opens: availability,
/// then every dimension, once per session. Only on a server with `searchOptions`; a failure is silent.
final searchWarmUpProvider = FutureProvider<void>((ref) async {
  // The view the Photos search will ask for (#1038): each view has its own cache entry on the server. Read once, as the
  // warm-up runs once.
  final scope = PhotosSearchScope(libraryView: ref.read(activeLibraryViewProvider));
  try {
    final capabilities = await ref.watch(searchCapabilitiesProvider.future);
    if (!capabilities.searchOptions) {
      return;
    }
    final repository = ref.read(gallerySearchRepositoryProvider);
    final params = buildSearchParams(
      scope,
      const SearchState(),
      now: ref.read(searchClockProvider)(),
      localTakenRange: capabilities.localTakenRange,
      favoritesAcrossSpaces: capabilities.favoritesAcrossSpaces,
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
  int _staleRetries = 0;

  @override
  SearchOptions build() {
    ref.watch(searchScopeProvider);
    ref.listen<SearchState>(searchStateProvider, (previous, next) {
      if (previous != next) {
        _staleRetries = 0;
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
      favoritesAcrossSpaces: capabilities.favoritesAcrossSpaces,
    );
    final repository = ref.read(gallerySearchRepositoryProvider);
    if (!capabilities.searchOptions) {
      return _loadFallback(generation, repository, params);
    }
    final mode = ref.read(searchModeProvider.notifier);

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
                state = state.withError(error, dimensions: {dimension});
              }
            }),
    ]);
    if (!_current(generation)) {
      return;
    }
    // The whole screen's availability (#910's "hide", searchScopeAvailability) is remembered from the unfiltered
    // answer. If that answer was stale and a filter has been picked since, this round did not refresh it: ask for it.
    if (mode.scopeAvailabilityStale && !ref.read(searchStateProvider).isEmpty) {
      final unfiltered = buildSearchParams(
        ref.read(searchScopeProvider),
        const SearchState(),
        now: ref.read(searchClockProvider)(),
        localTakenRange: capabilities.localTakenRange,
        favoritesAcrossSpaces: capabilities.favoritesAcrossSpaces,
      );
      try {
        final part = await repository.options(unfiltered);
        if (!_current(generation)) {
          return;
        }
        mode
          ..scopeAvailability = part.availability ?? mode.scopeAvailability
          ..scopeAvailabilityStale = part.stale;
        // A new options object, so the chip row and the Filters sheet read the refreshed answer.
        state = state.merge(const SearchOptionsPart());
      } catch (_) {
        // Keep the remembered answer; the next round tries again.
      }
    }
    // The server answered from its cache while it refreshes after a change (a new favourite, an upload): ask again,
    // so the fresh answer replaces it without the user leaving search. For as long as the answers stay stale, each
    // wait twice the last, up to searchOptionsStaleRetryMax; the provider (and its timer) goes when search mode closes.
    if (_current(generation) && (state.stale || mode.scopeAvailabilityStale)) {
      final first = ref.read(searchOptionsStaleRetryProvider);
      final wait = first * (1 << _staleRetries.clamp(0, 10));
      _staleRetries++;
      _schedule(wait > searchOptionsStaleRetryMax ? searchOptionsStaleRetryMax : wait);
    } else {
      _staleRetries = 0;
    }
  }

  /// The sheets' and the field's Retry after a failed request: the same state asked again, at once. A failed
  /// capabilities read is cached by its provider, so it is read again too. A 401 needs nothing here: the auth guard
  /// sends an invalid session to the login page on the next navigation, as for every other server call.
  void retry() {
    if (ref.read(searchCapabilitiesProvider).hasError) {
      ref.invalidate(searchCapabilitiesProvider);
    }
    // Skeletons again while the new round is on its way.
    state = state.restart(facetsSupported: state.facetsSupported, hasCounts: state.hasCounts);
    _schedule(Duration.zero);
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
      // The When sheet's months: the suggestion lists have none, /timeline/buckets has them (with counts).
      repository
          .timeBuckets(params, sort: SearchSort.newest)
          .then((buckets) {
            if (_current(generation)) {
              state = state.merge(SearchOptionsPart(months: buckets.map(searchMonthOf).toList()));
            }
          })
          .catchError((Object error) {
            if (_current(generation)) {
              state = state.withError(error, dimensions: {SearchDimension.time});
            }
          }),
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

  /// The request these results answer: a month of [buckets] must be loaded with exactly these parameters, never with
  /// those of a newer state still in flight.
  final SearchParams? params;
  final SearchSort sort;
  final bool byUploadDate;

  /// The search state these results answer, and the request round that produced them: a next page keeps the round,
  /// any new request starts another.
  final SearchState? forState;
  final int round;

  const SearchResults({
    this.loading = false,
    this.source,
    this.total,
    this.buckets,
    this.assets,
    this.nextPage,
    this.error,
    this.params,
    this.sort = SearchSort.newest,
    this.byUploadDate = false,
    this.forState,
    this.round = 0,
  });
}

/// Results for the current scope and state, debounced and race-dropped like the options.
class SearchResultsNotifier extends Notifier<SearchResults> {
  int _generation = 0;
  Timer? _timer;
  SearchParams? _params;
  SearchSort _sort = SearchSort.newest;
  bool _stock = false;
  bool _paging = false;

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

  /// Asks again after a failed request (SearchOptionsNotifier.retry); nothing to do otherwise.
  void retry() {
    if (state.error != null) {
      _schedule(Duration.zero);
    }
  }

  Future<void> _load(int generation) async {
    state = SearchResults(
      loading: true,
      source: state.source,
      total: state.total,
      buckets: state.buckets,
      assets: state.assets,
      nextPage: state.nextPage,
      params: state.params,
      sort: state.sort,
      byUploadDate: state.byUploadDate,
      forState: state.forState,
      round: state.round,
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
        favoritesAcrossSpaces: capabilities.favoritesAcrossSpaces,
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
          state = _paged(
            SearchResultsSource.smart,
            page,
            total: null,
            previous: const [],
            params: params,
            sort: _sort,
            byUploadDate: _byUploadDate,
            forState: searchState,
            round: generation,
          );
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
            params: params,
            sort: _sort,
            byUploadDate: _byUploadDate,
            forState: searchState,
            round: generation,
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
          params: params,
          sort: _sort,
          byUploadDate: _byUploadDate,
          forState: searchState,
          round: generation,
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
    required SearchParams params,
    required SearchSort sort,
    required bool byUploadDate,
    required SearchState? forState,
    required int round,
  }) => SearchResults(
    source: source,
    total: total,
    assets: [...previous, ...?page?.assets.items],
    nextPage: int.tryParse(page?.assets.nextPage ?? ''),
    params: params,
    sort: sort,
    byUploadDate: byUploadDate,
    forState: forState,
    round: round,
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
    if (_paging) {
      return;
    }
    _paging = true;
    final generation = _generation;
    final repository = ref.read(gallerySearchRepositoryProvider);
    final SearchResponseDto? response;
    try {
      response = source == SearchResultsSource.smart
          ? await repository.smart(params, page: page, sort: _sort)
          : await repository.metadata(params, page: page, sort: _sort);
    } finally {
      _paging = false;
    }
    if (_current(generation)) {
      state = _paged(
        source,
        response,
        total: state.total,
        previous: state.assets ?? const [],
        params: params,
        sort: _sort,
        byUploadDate: _byUploadDate,
        forState: state.forState,
        round: state.round,
      );
    }
  }
}
