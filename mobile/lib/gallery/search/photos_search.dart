import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/models/timeline_temporal_scope.model.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/gallery/library_view.provider.dart';
import 'package:immich_mobile/gallery/search/search_mode.provider.dart';
import 'package:immich_mobile/providers/infrastructure/memory.provider.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';

// What the Photos page (main_timeline.page.dart) takes from search mode beyond TimelineRouteScope's `search:`.

/// The Photos screen's own timeline: the main library at the route's temporal scope and grouping, within the library
/// view (#1038). Search mode swaps it for the results while a filter or query is active (searchTimelineServiceBuilder).
TimelineService buildPhotosTimelineService(Ref ref, TimelineTemporalScope temporalScope, GroupAssetsBy groupBy) {
  final userId = ref.watch(currentUserProvider.select((u) => u?.id));
  final timelineUsers = ref.watch(timelineUsersProvider).valueOrNull ?? const <String>[];
  return ref
      .watch(timelineFactoryProvider)
      .main(
        timelineUsers,
        userId ?? '',
        groupBy: groupBy,
        temporalScope: temporalScope,
        libraryView: ref.watch(activeLibraryViewProvider),
      );
}

/// Whether the Photos timeline shows the memories strip above the grid. Memories are a browse affordance: web mounts
/// its carousel only while nothing is searched or filtered (#902). On mobile the strip goes as soon as search mode
/// opens, so the grid starts right under the search header.
final photosMemoryLaneVisibleProvider = Provider<bool>((ref) {
  final hasMemories = ref.watch(memoryLaneProvider.select((memories) => memories.value?.isNotEmpty ?? false));
  return hasMemories && !ref.watch(searchModeProvider);
});
