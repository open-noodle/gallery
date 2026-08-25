import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/infrastructure/memory.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';

/// Whether the Photos timeline should render the memories strip above the grid.
///
/// Memories are a browse-mode affordance. Web's photos page mounts the carousel
/// only while nothing is being searched or filtered (`!hasActiveFilters`), so
/// results start at the top of the viewport instead of being pushed down by a
/// strip unrelated to the query — mobile matches that here (#902).
final photosMemoryLaneVisibleProvider = Provider<bool>((ref) {
  final hasMemories = ref.watch(driftMemoryLaneProvider.select((memories) => memories.value?.isNotEmpty ?? false));
  final isFiltering = ref.watch(photosFilterProvider.select((filter) => !filter.isEmpty));
  return hasMemories && !isFiltering;
});
