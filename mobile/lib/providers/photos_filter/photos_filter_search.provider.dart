import 'dart:async';

import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/services/search.service.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/providers/infrastructure/search.provider.dart';
import 'package:immich_mobile/providers/photos_filter/timeline_temporal_filter.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';

class PhotosFilterSearchState {
  final List<BaseAsset> assets;
  final int? nextPage;
  final bool isLoading;
  const PhotosFilterSearchState({this.assets = const [], this.nextPage = 1, this.isLoading = false});

  PhotosFilterSearchState copyWith({
    List<BaseAsset>? assets,
    int? nextPage,
    bool? isLoading,
    bool clearNextPage = false,
  }) => PhotosFilterSearchState(
    assets: assets ?? this.assets,
    nextPage: clearNextPage ? null : (nextPage ?? this.nextPage),
    isLoading: isLoading ?? this.isLoading,
  );
}

class PhotosFilterSearchNotifier extends StateNotifier<PhotosFilterSearchState> {
  final SearchService _search;
  final SearchFilter _filter;
  final _countController = StreamController<int>.broadcast();
  final _ids = <String>{};
  bool _disposed = false;

  /// Resolves when the page-1 load kicked in the constructor settles.
  late final Future<void> firstLoad;

  PhotosFilterSearchNotifier({required SearchService search, required SearchFilter filter})
    // Keep the public named parameters stable; `this._search` would expose a
    // private parameter name to callers.
    // ignore: prefer_initializing_formals
    : _search = search,
      _filter = filter,
      super(const PhotosFilterSearchState()) {
    if (filter.isEmpty) {
      firstLoad = Future.value();
      state = const PhotosFilterSearchState(nextPage: null);
      return;
    }
    firstLoad = loadMore();
  }

  Stream<int> get count => _countController.stream;
  List<BaseAsset> getAssets() => List.unmodifiable(state.assets);

  // Pagination/loading accessors for tests that drive the notifier directly.
  // UI consumers read these off [PhotosFilterSearchState] via the provider.
  int? get nextPage => state.nextPage;
  bool get isLoading => state.isLoading;

  Future<void> loadMore() async {
    if (state.nextPage == null || state.isLoading || _disposed) {
      return;
    }
    state = state.copyWith(isLoading: true);

    final result = await _search.search(_filter, state.nextPage!);
    if (_disposed) {
      return;
    }

    if (result == null) {
      // Empty results or an error — stop paging (no page-1 retry loop).
      state = state.copyWith(isLoading: false, clearNextPage: true);
      return;
    }

    final fresh = result.assets.where((a) => _ids.add(_assetKey(a))).toList(growable: false);
    final assets = [...state.assets, ...fresh];
    state = PhotosFilterSearchState(assets: assets, nextPage: result.nextPage, isLoading: false);
    if (!_countController.isClosed) {
      _countController.add(assets.length);
    }
  }

  /// Returns a stable unique key for deduplication.
  /// Search results are always RemoteAssets, so remoteId is non-null in practice.
  String _assetKey(BaseAsset a) => a.remoteId ?? a.heroTag;

  @override
  void dispose() {
    _disposed = true;
    unawaited(_countController.close());
    super.dispose();
  }
}

bool isSearchActive(String? userId, SearchFilter filter) => userId != null && !filter.isEmpty;

final photosFilterSearchProvider =
    StateNotifierProvider.autoDispose<PhotosFilterSearchNotifier, PhotosFilterSearchState>((ref) {
      // Source the temporal-scope-composed filter (#625) so a Years/Months zoom on
      // the Photos timeline narrows the live search (#654) to the scoped date range.
      // Depending on the effective filter (which is scoped on timelineTemporalScopeProvider)
      // makes this notifier re-evaluate inside each TimelineRouteScope with that route's scope.
      final filter = ref.watch(photosTimelineEffectiveFilterProvider);
      final userId = ref.watch(currentUserProvider.select((u) => u?.id));
      final search = ref.watch(searchServiceProvider);
      // StateNotifierProvider.autoDispose disposes the notifier itself; an explicit
      // ref.onDispose(n.dispose) would double-dispose (debug-mode StateError).
      return PhotosFilterSearchNotifier(
        search: search,
        filter: isSearchActive(userId, filter) ? filter : SearchFilter.empty(),
      );
    }, dependencies: [photosTimelineEffectiveFilterProvider]);
