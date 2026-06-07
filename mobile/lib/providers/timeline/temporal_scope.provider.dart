import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/timeline_temporal_scope.model.dart';

class TimelineTemporalScopeNotifier extends Notifier<TimelineTemporalScope> {
  @override
  TimelineTemporalScope build() => const TimelineTemporalScope.none();

  void setYear(int year) => state = TimelineTemporalScope.year(year);

  void setMonth({required int year, required int month}) =>
      state = TimelineTemporalScope.month(year: year, month: month);

  void clear() => state = const TimelineTemporalScope.none();
}

final timelineTemporalScopeProvider = NotifierProvider<TimelineTemporalScopeNotifier, TimelineTemporalScope>(
  TimelineTemporalScopeNotifier.new,
);
