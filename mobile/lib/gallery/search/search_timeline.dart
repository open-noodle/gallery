import 'dart:async';
import 'dart:math' as math;

import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/events.model.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/models/timeline_temporal_scope.model.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/domain/utils/event_stream.dart';
import 'package:immich_mobile/extensions/asset_extensions.dart';
import 'package:immich_mobile/gallery/search/search.providers.dart';
import 'package:immich_mobile/gallery/search/search.repository.dart';
import 'package:immich_mobile/gallery/search/search_mode.provider.dart';
import 'package:immich_mobile/gallery/search/search_scope.dart';
import 'package:immich_mobile/gallery/search/search_state.model.dart';
import 'package:immich_mobile/gallery/search/search_ui.providers.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_route_scope.dart';
import 'package:immich_mobile/providers/asset_viewer/asset_viewer.provider.dart';
import 'package:immich_mobile/providers/infrastructure/asset.provider.dart';
import 'package:openapi/api.dart' as api;

// The data swap (specs/2026-10-23-mobile-search-redesign-design.md, "Layering"): while search mode has a filter or a
// query, the screen's timeline shows the search results instead of its own data, through the same Timeline widget, so
// grouping, the Years/Months zoom, selection and the asset viewer behave as they do outside search. With no filter the
// screen's own timeline stays, so entering search mode moves nothing.

/// The results the timeline shows: the latest complete answer for the current state, or null while the screen shows
/// its own timeline. A round still in flight keeps the previous answer on screen; an answer for an older state never
/// shows (its months would be loaded with the wrong filters).
class SearchTimelineResultsNotifier extends Notifier<SearchResults?> {
  @override
  SearchResults? build() {
    final active = ref.watch(searchModeProvider);
    final filtering = ref.watch(searchStateProvider.select((s) => !s.isEmpty));
    if (!active || !filtering) {
      return null;
    }
    ref.listen<SearchResults>(searchResultsProvider, (_, next) {
      if (_answersCurrentState(next)) {
        state = next;
      }
    });
    final current = ref.read(searchResultsProvider);
    return _answersCurrentState(current) ? current : null;
  }

  bool _answersCurrentState(SearchResults results) =>
      !results.loading &&
      results.source != null &&
      results.params != null &&
      results.forState == ref.read(searchStateProvider);
}

final searchTimelineResultsProvider = NotifierProvider<SearchTimelineResultsNotifier, SearchResults?>(
  SearchTimelineResultsNotifier.new,
  dependencies: [searchModeProvider, searchStateProvider, searchResultsProvider],
);

/// True while the grid is out of date: search mode has a filter or a query, and the answer for it has not arrived
/// (still debouncing or on its way). The grid meanwhile keeps the previous answer or the screen's own timeline, so the
/// header says it is searching and the frame dims the grid. A failed request is not pending: its error shows instead.
final searchResultsPendingProvider = Provider<bool>((ref) {
  final active = ref.watch(searchModeProvider);
  final state = ref.watch(searchStateProvider);
  if (!active || state.isEmpty) {
    return false;
  }
  final results = ref.watch(searchResultsProvider);
  return results.error == null && (results.loading || results.forState != state);
}, dependencies: [searchModeProvider, searchStateProvider, searchResultsProvider]);

/// One answer the timeline shows. Each new answer gets its own feed, and so its own TimelineService; only the next
/// pages of a paged answer arrive through [pages], and they only ever add assets, so the data under a running timeline
/// never shrinks.
class SearchTimelineFeed {
  final SearchResults initial;
  final GallerySearchRepository repository;
  final Future<void> Function() loadNextPage;
  final _pages = StreamController<SearchResults>.broadcast();
  SearchResults _latest;

  SearchTimelineFeed({required this.initial, required this.repository, required this.loadNextPage}) : _latest = initial;

  SearchResults get latest => _latest;
  Stream<SearchResults> get pages => _pages.stream;

  void addPage(SearchResults results) {
    _latest = results;
    if (!_pages.isClosed) {
      _pages.add(results);
    }
  }

  Future<void> dispose() => _pages.close();
}

final searchTimelineFeedProvider = Provider<SearchTimelineFeed?>((ref) {
  final key = ref.watch(searchTimelineResultsProvider.select((r) => r == null ? null : (r.forState, r.round)));
  final initial = ref.read(searchTimelineResultsProvider);
  if (key == null || initial == null) {
    return null;
  }
  final feed = SearchTimelineFeed(
    initial: initial,
    repository: ref.watch(gallerySearchRepositoryProvider),
    loadNextPage: () => ref.read(searchResultsProvider.notifier).loadNextPage(),
  );
  ref.listen<SearchResults?>(searchTimelineResultsProvider, (_, next) {
    if (next != null && !identical(next, feed.latest) && (next.forState, next.round) == key) {
      feed.addPage(next);
    }
  });
  ref.onDispose(feed.dispose);
  completeSearchResultInViewer(ref, feed.repository);
  return feed;
}, dependencies: [searchTimelineResultsProvider, searchResultsProvider]);

/// A result built from /timeline/bucket columns (searchBucketAssets) has no name, checksum, edit flag or size. The
/// asset viewer replaces the asset it opens with the phone's synced row (AssetViewerStateNotifier watches it by id),
/// which has them all. A result the phone has not synced (a space or partner photo not yet down, a sync still running)
/// stays incomplete: download has no file name, share no extension, the info sheet no file name. So while results are
/// on screen, opening such an asset in the viewer fetches it (`GET /assets/{id}`) and gives the viewer the whole asset.
void completeSearchResultInViewer(Ref ref, GallerySearchRepository repository) {
  var disposed = false;
  ref.onDispose(() => disposed = true);
  final completed = <String, RemoteAsset>{};

  bool incomplete(BaseAsset? asset) => asset is RemoteAsset && isSearchBucketAsset(asset);

  Future<void> complete(RemoteAsset asset) async {
    var full = completed[asset.id];
    if (full == null) {
      if (await ref.read(assetServiceProvider).getRemoteAsset(asset.id) != null) {
        // Synced: the viewer's own watch of the row completes it.
        return;
      }
      try {
        full = (await repository.assetInfo(asset.id))?.toDto();
      } catch (_) {
        full = null;
      }
      if (disposed || full == null) {
        return;
      }
      completed[asset.id] = full;
    }
    final current = ref.read(assetViewerProvider).currentAsset;
    if (current is RemoteAsset && current.id == asset.id && incomplete(current)) {
      ref.read(assetViewerProvider.notifier).setAsset(full);
    }
  }

  ref.listen<BaseAsset?>(assetViewerProvider.select((state) => state.currentAsset), (_, asset) {
    if (incomplete(asset)) {
      unawaited(complete(asset! as RemoteAsset));
    }
  });
}

/// An asset made from /timeline/bucket columns: no checksum and no name (see searchBucketAssets).
bool isSearchBucketAsset(RemoteAsset asset) => asset.checksum == null && asset.name.isEmpty;

/// TimelineRouteScope's `search:` argument: the screen's own builder while not searching, the results otherwise.
TimelineRouteServiceBuilder searchTimelineServiceBuilder(TimelineRouteServiceBuilder screen) =>
    (ref, temporalScope, groupBy) {
      final feed = ref.watch(searchTimelineFeedProvider);
      if (feed == null) {
        return SwappedTimelineService(screen(ref, temporalScope, groupBy));
      }
      final source = SearchTimelineSource(feed, groupBy: groupBy, temporalScope: temporalScope);
      ref.onDispose(source.dispose);
      return SwappedTimelineService(TimelineService(source.query));
    };

/// A TimelineService the search swap puts in place of another. When the swap happens, rows of the layout still on
/// screen (the screen's own timeline scrolled far down, or the results) rebuild against the new service before the
/// timeline lays out the new data, and ask for ranges it does not have. A RangeError inside the service's load queue
/// escapes as an uncaught error, so such a range is answered with nothing before it reaches the queue, and the timeline
/// replaces those rows a frame later. Everything else is the wrapped service.
class SwappedTimelineService extends TimelineService {
  final TimelineService inner;
  final _reloaded = Completer<void>();
  StreamSubscription<TimelineReloadEvent>? _reloads;

  SwappedTimelineService(this.inner)
    : super((bucketSource: () => const Stream.empty(), assetSource: (_, _) async => const [], origin: inner.origin)) {
    _reloads = EventStream.shared.listen<TimelineReloadEvent>((_) {
      if (!_reloaded.isCompleted) {
        _reloaded.complete();
      }
      unawaited(_reloads?.cancel());
    });
  }

  @override
  TimelineOrigin get origin => inner.origin;

  @override
  int get totalAssets => inner.totalAssets;

  @override
  Stream<List<Bucket>> Function() get watchBuckets => inner.watchBuckets;

  @override
  Future<List<BaseAsset>> loadAssets(int index, int count) async {
    if (index + count > inner.totalAssets && !_reloaded.isCompleted) {
      // Before the first load the total is still 0: wait for it rather than call a range stale.
      await _reloaded.future.timeout(const Duration(seconds: 5), onTimeout: () {});
    }
    if (index < 0 || index + count > inner.totalAssets) {
      return const [];
    }
    return inner.loadAssets(index, count);
  }

  @override
  bool hasRange(int index, int count) => inner.hasRange(index, count);

  @override
  List<BaseAsset> getAssets(int index, int count) => inner.getAssets(index, count);

  @override
  Future<void> preloadAssets(int index) => inner.preloadAssets(index);

  @override
  BaseAsset getRandomAsset() => inner.getRandomAsset();

  @override
  Future<BaseAsset?> getAssetAsync(int index) => inner.getAssetAsync(index);

  @override
  BaseAsset? getAssetSafe(int index) => inner.getAssetSafe(index);

  @override
  int? getIndex(String heroTag) => inner.getIndex(heroTag);

  @override
  Future<void> dispose() async {
    await _reloads?.cancel();
    await inner.dispose();
    await super.dispose();
  }
}

/// Per-route search providers for TimelineRouteScope. Photos keeps the root ones, which the bottom nav and the memory
/// lane read.
List<Override> searchTimelineScopeOverrides(SearchScope scope) => [
  timelineHasSearchProvider.overrideWithValue(true),
  if (scope is! PhotosSearchScope) ...[
    ...searchRouteOverrides(scope),
    searchModeProvider.overrideWith(SearchModeNotifier.new),
    searchFieldControllerProvider,
    closeSearchModeProvider,
    searchTimelineResultsProvider.overrideWith(SearchTimelineResultsNotifier.new),
    searchTimelineFeedProvider,
    searchResultsPendingProvider,
  ],
];

/// One month of browse results.
class _Month {
  final String timeBucket;
  final DateTime date;
  final int count;

  const _Month(this.timeBucket, this.date, this.count);
}

/// Turns one answer into a [TimelineQuery]. Browse results know every month's count up front (exact total, exact month
/// and year layout); a month's assets load when the grid first needs them, with the request of that answer. Day headers
/// need a month's assets, so an unloaded month shows as one bucket until it loads. Paged results (smart search,
/// untagged) show what is loaded and fetch the next page as the grid reaches the end.
class SearchTimelineSource {
  final SearchTimelineFeed _feed;
  final GroupAssetsBy groupBy;
  final TimelineTemporalScope temporalScope;

  final _buckets = StreamController<List<Bucket>>.broadcast();
  StreamSubscription<SearchResults>? _subscription;

  final List<_Month> _months;
  final Map<String, List<BaseAsset>> _loaded = {};
  final Map<String, Future<List<BaseAsset>>> _loading = {};
  List<BaseAsset> _paged = const [];
  List<Bucket>? _lastEmitted;

  SearchTimelineSource(this._feed, {required this.groupBy, required this.temporalScope})
    : _months = _feed.initial.source == SearchResultsSource.timeline
          ? [
              for (final bucket in _feed.initial.buckets ?? const <api.TimeBucketsResponseDto>[])
                if (_inScope(temporalScope, DateTime.parse(bucket.timeBucket), month: true))
                  _Month(bucket.timeBucket, DateTime.parse(bucket.timeBucket), bucket.count),
            ]
          : const [] {
    _setPaged(_feed.latest);
    _subscription = _feed.pages.listen((results) {
      _setPaged(results);
      _emit();
    });
  }

  SearchResults get _results => _feed.initial;

  TimelineQuery get query => (
    bucketSource: () async* {
      yield _currentBuckets();
      yield* _buckets.stream;
    },
    assetSource: _assets,
    origin: TimelineOrigin.search,
  );

  bool get _browse => _results.source == SearchResultsSource.timeline;

  void _setPaged(SearchResults results) {
    if (_browse) {
      return;
    }
    final assets = [for (final asset in results.assets ?? const <api.AssetResponseDto>[]) asset.toDto()];
    _paged = [
      for (final asset in _sorted(assets, results.sort, _dateOf))
        if (_inScope(temporalScope, asset.createdAt.toLocal())) asset,
    ];
  }

  /// The date the results are ordered and grouped by: the upload date on Recently added (SearchResults.byUploadDate),
  /// the taken date everywhere else, each as the screen's own timeline groups it.
  DateTime _dateOf(BaseAsset asset) => switch (asset) {
    RemoteAsset(:final uploadedAt?) when _results.byUploadDate => uploadedAt.toLocal(),
    _ => asset.createdAt.toLocal(),
  };

  static List<BaseAsset> _sorted(List<BaseAsset> assets, SearchSort sort, DateTime Function(BaseAsset) dateOf) =>
      switch (sort) {
        // Relevance keeps the server's order; pages append, so loaded assets never move.
        SearchSort.relevance => assets,
        SearchSort.newest => [...assets]..sort((a, b) => dateOf(b).compareTo(dateOf(a))),
        SearchSort.oldest => [...assets]..sort((a, b) => dateOf(a).compareTo(dateOf(b))),
      };

  static bool _inScope(TimelineTemporalScope scope, DateTime date, {bool month = false}) {
    final start = scope.start;
    final end = scope.end;
    if (start == null || end == null) {
      return true;
    }
    final from = month ? DateTime(start.year, start.month) : start;
    return !date.isBefore(from) && !date.isAfter(end);
  }

  void _emit() {
    final previous = _lastEmitted;
    final buckets = _currentBuckets();
    if (previous != null && _sameBuckets(previous, buckets)) {
      return;
    }
    if (!_buckets.isClosed) {
      _buckets.add(buckets);
    }
  }

  static bool _sameBuckets(List<Bucket> a, List<Bucket> b) {
    if (a.length != b.length) {
      return false;
    }
    for (var i = 0; i < a.length; i++) {
      if (a[i] != b[i]) {
        return false;
      }
    }
    return true;
  }

  List<Bucket> _currentBuckets() {
    final buckets = _browse ? _browseBuckets() : _pagedBuckets();
    _lastEmitted = buckets;
    return buckets;
  }

  List<Bucket> _browseBuckets() {
    switch (groupBy) {
      case GroupAssetsBy.year:
        final years = <int, int>{};
        final order = <int>[];
        for (final month in _months) {
          if (!years.containsKey(month.date.year)) {
            order.add(month.date.year);
          }
          years[month.date.year] = (years[month.date.year] ?? 0) + month.count;
        }
        return [for (final year in order) TimeBucket(date: DateTime(year), assetCount: years[year]!)];
      case GroupAssetsBy.month:
        return [for (final month in _months) TimeBucket(date: month.date, assetCount: month.count)];
      case GroupAssetsBy.none:
        final total = _months.fold<int>(0, (sum, month) => sum + month.count);
        return total == 0 ? const [] : [Bucket(assetCount: total)];
      case GroupAssetsBy.day:
      case GroupAssetsBy.auto:
        return [
          for (final month in _months)
            if (_loaded[month.timeBucket] case final assets? when assets.length == month.count)
              ..._dayBuckets(assets)
            else
              TimeBucket(date: month.date, assetCount: month.count),
        ];
    }
  }

  List<Bucket> _dayBuckets(List<BaseAsset> assets) {
    final buckets = <TimeBucket>[];
    for (final asset in assets) {
      // Taken: wall-clock time as taken (searchBucketAssets), as the timeline's own day headers read it.
      final local = _results.byUploadDate ? _dateOf(asset) : asset.createdAt;
      final day = DateTime(local.year, local.month, local.day);
      if (buckets.isNotEmpty && buckets.last.date == day) {
        final last = buckets.removeLast();
        buckets.add(TimeBucket(date: day, assetCount: last.assetCount + 1));
      } else {
        buckets.add(TimeBucket(date: day, assetCount: 1));
      }
    }
    return buckets;
  }

  List<Bucket> _pagedBuckets() {
    if (_paged.isEmpty) {
      return const [];
    }
    if (_results.sort == SearchSort.relevance || groupBy == GroupAssetsBy.none) {
      // Relevance has no dates to group by: the flat grid.
      return [Bucket(assetCount: _paged.length)];
    }
    final buckets = <TimeBucket>[];
    for (final asset in _paged) {
      final local = _dateOf(asset);
      final date = switch (groupBy) {
        GroupAssetsBy.year => DateTime(local.year),
        GroupAssetsBy.month => DateTime(local.year, local.month),
        _ => DateTime(local.year, local.month, local.day),
      };
      if (buckets.isNotEmpty && buckets.last.date == date) {
        final last = buckets.removeLast();
        buckets.add(TimeBucket(date: date, assetCount: last.assetCount + 1));
      } else {
        buckets.add(TimeBucket(date: date, assetCount: 1));
      }
    }
    return buckets;
  }

  Future<List<BaseAsset>> _assets(int offset, int count) async {
    if (!_browse) {
      final end = math.min(offset + count, _paged.length);
      if (end >= _paged.length - 1 && _feed.latest.nextPage != null) {
        unawaited(_feed.loadNextPage());
      }
      return offset >= end ? const [] : _paged.sublist(offset, end);
    }
    final assets = <BaseAsset>[];
    var start = 0;
    var refined = false;
    for (final month in _months) {
      final monthEnd = start + month.count;
      if (monthEnd > offset && start < offset + count) {
        final wasLoaded = _loaded.containsKey(month.timeBucket);
        final monthAssets = await _month(month);
        refined |= !wasLoaded;
        final from = math.max(0, offset - start);
        final to = math.min(monthAssets.length, offset + count - start);
        if (from < to) {
          assets.addAll(monthAssets.sublist(from, to));
        }
      }
      start = monthEnd;
      if (start >= offset + count) {
        break;
      }
    }
    if (refined && (groupBy == GroupAssetsBy.day || groupBy == GroupAssetsBy.auto)) {
      // Day headers are known now: re-emit (outside the timeline's load mutex).
      scheduleMicrotask(_emit);
    }
    return assets;
  }

  Future<List<BaseAsset>> _month(_Month month) {
    final loaded = _loaded[month.timeBucket];
    if (loaded != null) {
      return Future.value(loaded);
    }
    return _loading.putIfAbsent(month.timeBucket, () async {
      final dto = await _feed.repository.timeBucket(
        _results.params!,
        month.timeBucket,
        sort: _results.sort,
        byUploadDate: _results.byUploadDate,
      );
      final assets = dto == null ? const <BaseAsset>[] : searchBucketAssets(dto);
      _loaded[month.timeBucket] = assets;
      return assets;
    });
  }

  Future<void> dispose() async {
    await _subscription?.cancel();
    await _buckets.close();
  }
}

/// The columns of one /timeline/bucket response as assets. The columns carry no checksum, name or size; the grid and
/// the viewer address a remote asset by its id, and the viewer completes it (completeSearchResultInViewer).
List<BaseAsset> searchBucketAssets(api.TimeBucketAssetResponseDto dto) => [
  for (var i = 0; i < dto.id.length; i++)
    RemoteAsset(
      id: dto.id[i],
      name: '',
      ownerId: dto.ownerId[i],
      checksum: null,
      type: dto.isImage[i] ? AssetType.image : AssetType.video,
      // Wall-clock time as taken, the same reading the timeline's own day headers use.
      createdAt: DateTime.parse(dto.fileCreatedAt[i].replaceFirst(RegExp(r'(Z|[+-]\d\d:\d\d)$'), '')),
      updatedAt: DateTime.parse(dto.createdAt[i]),
      uploadedAt: DateTime.parse(dto.createdAt[i]),
      durationMs: dto.duration[i],
      isFavorite: dto.isFavorite[i],
      thumbHash: dto.thumbhash[i],
      visibility: switch (dto.visibility[i]) {
        api.AssetVisibility.archive => AssetVisibility.archive,
        api.AssetVisibility.hidden => AssetVisibility.hidden,
        api.AssetVisibility.locked => AssetVisibility.locked,
        _ => AssetVisibility.timeline,
      },
      livePhotoVideoId: dto.livePhotoVideoId[i],
      stackId: switch (dto.stack.orElse(null)) {
        final stacks? when i < stacks.length => stacks[i]?.firstOrNull,
        _ => null,
      },
      isEdited: false,
    ),
];
