// Debounced views of photosFilterProvider.
//
// `photosFilterDebouncedProvider` — 250 ms; feeds the suggestions provider and
// the filter-sheet strips (design §8 "Debounce filter-change → suggestions call").
//
// `photosTimelineFilterProvider` — 500 ms; feeds `photosTimelineQueryProvider`
// (design §6.4.1 / §8 "timeline refetch debounce").

import 'dart:async';

import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';

final photosFilterDebouncedProvider = Provider<SearchFilter>(
  (ref) => _debouncedFilter(ref, const Duration(milliseconds: 250)),
  dependencies: const [],
);

final photosTimelineFilterProvider = Provider<SearchFilter>(
  (ref) => _debouncedFilter(ref, const Duration(milliseconds: 500)),
  dependencies: const [],
);

/// Returns the current filter synchronously and schedules a timer on every
/// change; when the timer fires we `ref.invalidateSelf()` so the next read
/// re-evaluates and picks up the latest source value.
SearchFilter _debouncedFilter(Ref ref, Duration delay) {
  final current = ref.read(photosFilterProvider);
  Timer? timer;

  ref.listen<SearchFilter>(photosFilterProvider, (prev, next) {
    if (prev == next) return;
    timer?.cancel();
    timer = Timer(delay, () {
      if (timer == null) return;
      ref.invalidateSelf();
    });
  });

  ref.onDispose(() {
    timer?.cancel();
    timer = null;
  });

  return current;
}
