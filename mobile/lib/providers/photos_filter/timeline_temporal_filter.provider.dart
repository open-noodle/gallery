import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/timeline_temporal_scope.model.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/providers/photos_filter/filter_debounce.provider.dart';
import 'package:immich_mobile/providers/timeline/temporal_scope.provider.dart';

final photosTimelineEffectiveFilterProvider = Provider<SearchFilter>((ref) {
  final filter = ref.watch(photosTimelineFilterProvider);
  final scope = ref.watch(timelineTemporalScopeProvider);

  return applyTimelineTemporalScope(filter, scope);
}, dependencies: [photosTimelineFilterProvider, timelineTemporalScopeProvider]);

SearchFilter applyTimelineTemporalScope(SearchFilter filter, TimelineTemporalScope scope) {
  final scopeStart = scope.start;
  final scopeEnd = scope.end;
  if (scopeStart == null && scopeEnd == null) {
    return filter;
  }

  final current = filter.date;
  final effectiveStart = _maxDate(current.takenAfter, scopeStart);
  final effectiveEnd = _minDate(current.takenBefore, scopeEnd);

  return filter.copyWith(
    date: SearchDateFilter(takenAfter: effectiveStart, takenBefore: effectiveEnd),
  );
}

DateTime? _maxDate(DateTime? a, DateTime? b) {
  if (a == null) return b;
  if (b == null) return a;
  return a.isAfter(b) ? a : b;
}

DateTime? _minDate(DateTime? a, DateTime? b) {
  if (a == null) return b;
  if (b == null) return a;
  return a.isBefore(b) ? a : b;
}
