sealed class TimelineZoomAnchor {
  const TimelineZoomAnchor();

  const factory TimelineZoomAnchor.none() = TimelineZoomAnchorNone;

  const factory TimelineZoomAnchor.year(int year) = TimelineZoomYearAnchor;

  factory TimelineZoomAnchor.month({required int year, required int month}) {
    RangeError.checkValueInInterval(month, 1, 12, 'month');
    return TimelineZoomMonthAnchor._(year: year, month: month);
  }

  const factory TimelineZoomAnchor.date(DateTime date) = TimelineZoomDateAnchor;

  bool get isEmpty => this is TimelineZoomAnchorNone;
}

final class TimelineZoomAnchorNone extends TimelineZoomAnchor {
  const TimelineZoomAnchorNone();

  @override
  bool operator ==(Object other) => other is TimelineZoomAnchorNone;

  @override
  int get hashCode => Object.hashAll([TimelineZoomAnchorNone]);

  @override
  String toString() => 'TimelineZoomAnchor.none()';
}

final class TimelineZoomYearAnchor extends TimelineZoomAnchor {
  const TimelineZoomYearAnchor(this.year);

  final int year;

  @override
  bool operator ==(Object other) => other is TimelineZoomYearAnchor && other.year == year;

  @override
  int get hashCode => Object.hash(TimelineZoomYearAnchor, year);

  @override
  String toString() => 'TimelineZoomAnchor.year($year)';
}

final class TimelineZoomMonthAnchor extends TimelineZoomAnchor {
  const TimelineZoomMonthAnchor._({required this.year, required this.month});

  final int year;
  final int month;

  @override
  bool operator ==(Object other) => other is TimelineZoomMonthAnchor && other.year == year && other.month == month;

  @override
  int get hashCode => Object.hash(TimelineZoomMonthAnchor, year, month);

  @override
  String toString() => 'TimelineZoomAnchor.month(year: $year, month: $month)';
}

/// Anchors the timeline to a specific date and resolves to the closest matching
/// segment in whatever grouping is active (day, then month, then year). Used to
/// preserve the visible position when the grouping granularity changes.
final class TimelineZoomDateAnchor extends TimelineZoomAnchor {
  const TimelineZoomDateAnchor(this.date);

  final DateTime date;

  @override
  bool operator ==(Object other) => other is TimelineZoomDateAnchor && other.date == date;

  @override
  int get hashCode => Object.hash(TimelineZoomDateAnchor, date);

  @override
  String toString() => 'TimelineZoomAnchor.date($date)';
}
