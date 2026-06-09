import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/timeline_zoom_anchor.model.dart';

class TimelineZoomAnchorNotifier extends Notifier<TimelineZoomAnchor> {
  /// The most recent position-derived anchor date set via [setDate].
  /// Survives [clear] (anchor consumption) so that [_onGroupingChanged] can
  /// recover the finer-grained date across a coarse→fine grouping round trip.
  DateTime? lastPositionDate;

  @override
  TimelineZoomAnchor build() => const TimelineZoomAnchor.none();

  void setYear(int year) => state = TimelineZoomAnchor.year(year);

  void setMonth({required int year, required int month}) => state = TimelineZoomAnchor.month(year: year, month: month);

  void setDate(DateTime date) {
    lastPositionDate = date;
    state = TimelineZoomAnchor.date(date);
  }

  void clear() => state = const TimelineZoomAnchor.none();
}

final timelineZoomAnchorProvider = NotifierProvider<TimelineZoomAnchorNotifier, TimelineZoomAnchor>(
  TimelineZoomAnchorNotifier.new,
);
