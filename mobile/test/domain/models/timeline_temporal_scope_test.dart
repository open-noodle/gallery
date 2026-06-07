import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/timeline_temporal_scope.model.dart';

void main() {
  group('TimelineTemporalScope', () {
    test('none has no range and is empty', () {
      const scope = TimelineTemporalScope.none();

      expect(scope.kind, TimelineTemporalScopeKind.none);
      expect(scope.isEmpty, isTrue);
      expect(scope.start, isNull);
      expect(scope.end, isNull);
    });

    test('year scope covers the full year', () {
      const scope = TimelineTemporalScope.year(2025);

      expect(scope.kind, TimelineTemporalScopeKind.year);
      expect(scope.isEmpty, isFalse);
      expect(scope.year, 2025);
      expect(scope.month, isNull);
      expect(scope.start, DateTime(2025));
      expect(scope.end, DateTime(2025, 12, 31, 23, 59, 59));
    });

    test('month scope covers the full month including leap February', () {
      final scope = TimelineTemporalScope.month(year: 2024, month: 2);

      expect(scope.kind, TimelineTemporalScopeKind.month);
      expect(scope.year, 2024);
      expect(scope.month, 2);
      expect(scope.start, DateTime(2024, 2));
      expect(scope.end, DateTime(2024, 2, 29, 23, 59, 59));
    });

    test('december month scope ends inside the same calendar year', () {
      final scope = TimelineTemporalScope.month(year: 2025, month: 12);

      expect(scope.start, DateTime(2025, 12));
      expect(scope.end, DateTime(2025, 12, 31, 23, 59, 59));
    });

    test('month scope rejects months outside 1 through 12', () {
      expect(() => TimelineTemporalScope.month(year: 2025, month: 0), throwsRangeError);
      expect(() => TimelineTemporalScope.month(year: 2025, month: 13), throwsRangeError);
    });

    test('value equality includes kind, year, and month', () {
      expect(const TimelineTemporalScope.year(2025), const TimelineTemporalScope.year(2025));
      expect(const TimelineTemporalScope.year(2025), isNot(const TimelineTemporalScope.year(2024)));
      expect(TimelineTemporalScope.month(year: 2025, month: 3), TimelineTemporalScope.month(year: 2025, month: 3));
      expect(
        TimelineTemporalScope.month(year: 2025, month: 3),
        isNot(TimelineTemporalScope.month(year: 2025, month: 4)),
      );
    });
  });
}
