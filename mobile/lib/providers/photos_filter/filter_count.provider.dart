import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/infrastructure/search.provider.dart';
import 'package:immich_mobile/providers/photos_filter/filter_debounce.provider.dart';

final photosFilterCountProvider = FutureProvider.autoDispose<int>((ref) async {
  // Read the 250 ms-debounced filter so chip taps don't fan out into one count
  // request per tap. Design §8.
  final filter = ref.watch(photosFilterDebouncedProvider);
  if (filter.isEmpty) return 0; // placeholder — timeline service will supply total in PR 1.2
  final service = ref.watch(searchServiceProvider);
  final result = await service.search(filter, 1);
  // TODO(phase-1.2): replace with a true total-count endpoint if one exists post-audit.
  return result?.assets.length ?? 0;
});
