enum TimelineTemporalScopeKind { none, year, month }

class TimelineTemporalScope {
  const TimelineTemporalScope._({required this.kind, this.year, this.month});

  const TimelineTemporalScope.none() : this._(kind: TimelineTemporalScopeKind.none);

  const TimelineTemporalScope.year(int year) : this._(kind: TimelineTemporalScopeKind.year, year: year);

  factory TimelineTemporalScope.month({required int year, required int month}) {
    RangeError.checkValueInInterval(month, 1, 12, 'month');
    return TimelineTemporalScope._(kind: TimelineTemporalScopeKind.month, year: year, month: month);
  }

  final TimelineTemporalScopeKind kind;
  final int? year;
  final int? month;

  bool get isEmpty => kind == TimelineTemporalScopeKind.none;

  DateTime? get start {
    return switch (kind) {
      TimelineTemporalScopeKind.none => null,
      TimelineTemporalScopeKind.year => DateTime(year!),
      TimelineTemporalScopeKind.month => DateTime(year!, month!),
    };
  }

  DateTime? get end {
    return switch (kind) {
      TimelineTemporalScopeKind.none => null,
      TimelineTemporalScopeKind.year => DateTime(year!, 12, 31, 23, 59, 59),
      TimelineTemporalScopeKind.month => DateTime(year!, month! + 1, 0, 23, 59, 59),
    };
  }

  @override
  bool operator ==(Object other) {
    return other is TimelineTemporalScope && other.kind == kind && other.year == year && other.month == month;
  }

  @override
  int get hashCode => Object.hash(kind, year, month);

  @override
  String toString() => 'TimelineTemporalScope(kind: $kind, year: $year, month: $month)';
}
