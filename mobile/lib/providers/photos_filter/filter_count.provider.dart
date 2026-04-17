import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/infrastructure/search.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';

final photosFilterCountProvider = FutureProvider.autoDispose<int>((ref) async {
  final filter = ref.watch(photosFilterProvider);
  if (filter.isEmpty) return 0; // placeholder — timeline service will supply total in PR 1.2
  final service = ref.watch(searchServiceProvider);
  final result = await service.search(filter, 1);
  // TODO(phase-1.2): replace with a true total-count endpoint if one exists post-audit.
  return result?.assets.length ?? 0;
});
