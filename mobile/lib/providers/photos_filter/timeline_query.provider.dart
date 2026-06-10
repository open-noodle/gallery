// photosTimelineQueryProvider — overrides `timelineServiceProvider` inside
// `MainTimelinePage`. Empty filter / pre-login → main library service.
// Non-empty + logged-in → search-backed service driven by the paginating
// `photosFilterSearchProvider` notifier, with `groupBy`/`descending` derived from the
// active filter's sort + smart-search state (relevance smart search stays flat). The
// effective provider composes temporal scope through the 800 ms debounced Photos filter
// before consumers watch the result here.

import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/models/timeline_temporal_scope.model.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/photos_filter/filter_debounce.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter_search.provider.dart';
import 'package:immich_mobile/providers/photos_filter/timeline_temporal_filter.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';

final photosTimelineQueryProvider = Provider<TimelineService>((ref) {
  final filter = ref.watch(photosTimelineEffectiveFilterProvider);
  return buildPhotosTimelineQuery(ref, filter);
});

TimelineService buildPhotosTimelineRouteService(Ref ref, TimelineTemporalScope temporalScope, GroupAssetsBy groupBy) {
  final filter = ref.watch(photosTimelineFilterProvider);
  final userId = ref.watch(currentUserProvider.select((u) => u?.id));
  final timelineUsers = ref.watch(timelineUsersProvider).valueOrNull ?? const <String>[];
  final factory = ref.watch(timelineFactoryProvider);

  if (filter.isEmpty) {
    final svc = factory.main(timelineUsers, userId ?? '', groupBy: groupBy, temporalScope: temporalScope);
    ref.onDispose(svc.dispose);
    return svc;
  }

  return buildPhotosTimelineQuery(ref, applyTimelineTemporalScope(filter, temporalScope), groupBy: groupBy);
}

TimelineService buildPhotosTimelineQuery(Ref ref, SearchFilter filter, {GroupAssetsBy? groupBy}) {
  final userId = ref.watch(currentUserProvider.select((u) => u?.id));
  final timelineUsers = ref.watch(timelineUsersProvider).valueOrNull ?? const <String>[];
  final factory = ref.watch(timelineFactoryProvider);

  if (userId == null || filter.isEmpty) {
    final svc = factory.main(timelineUsers, userId ?? '');
    ref.onDispose(svc.dispose);
    return svc;
  }

  final notifier = ref.watch(photosFilterSearchProvider.notifier);
  final isSmart = filter.context != null && filter.context!.isNotEmpty;
  final isRelevance = isSmart && filter.sort == SearchSortOrder.relevance;
  final effectiveGroupBy = isRelevance ? GroupAssetsBy.none : (groupBy ?? factory.groupBy);
  final descending = filter.sort != SearchSortOrder.oldest;
  final svc = factory.fromAssetStream(
    notifier.getAssets,
    notifier.count,
    TimelineOrigin.search,
    groupBy: effectiveGroupBy,
    descending: descending,
  );
  ref.onDispose(svc.dispose);
  return svc;
}
