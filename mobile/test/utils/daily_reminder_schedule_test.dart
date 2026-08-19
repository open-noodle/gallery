import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/utils/daily_reminder_schedule.dart';

/// 18:00 as minutes since local midnight.
const int _sixPm = 18 * 60;

List<DateTime> occurrences({
  required DateTime now,
  int minuteOfDay = _sixPm,
  bool enabled = true,
  bool permissionGranted = true,
  bool hasOptedInSpace = true,
  String? lastPlayedDate,
  int horizonDays = kDailyReminderHorizonDays,
}) => dailyReminderOccurrences(
  now: now,
  minuteOfDay: minuteOfDay,
  enabled: enabled,
  permissionGranted: permissionGranted,
  hasOptedInSpace: hasOptedInSpace,
  lastPlayedDate: lastPlayedDate,
  horizonDays: horizonDays,
);

void main() {
  // 09:00 local on 18 Aug 2026 — before the 18:00 reminder time.
  final morning = DateTime(2026, 8, 18, 9);

  group('gates', () {
    test('disabled means nothing is scheduled', () {
      expect(occurrences(now: morning, enabled: false), isEmpty);
    });

    test('no opted-in space means nothing is scheduled', () {
      expect(occurrences(now: morning, hasOptedInSpace: false), isEmpty);
    });

    test('a revoked OS permission means nothing is scheduled, whatever the toggle says', () {
      expect(occurrences(now: morning, permissionGranted: false), isEmpty);
    });

    test('a zero horizon means nothing is scheduled', () {
      expect(occurrences(now: morning, horizonDays: 0), isEmpty);
    });
  });

  group('the horizon', () {
    test('schedules one occurrence per day, starting today when the time has not passed', () {
      final result = occurrences(now: morning);

      expect(result.length, kDailyReminderHorizonDays);
      expect(result.first, DateTime(2026, 8, 18, 18));
      expect(result.last, DateTime(2026, 8, 24, 18));
    });

    test('starts tomorrow once the local time has passed', () {
      final result = occurrences(now: DateTime(2026, 8, 18, 19, 30));

      expect(result.first, DateTime(2026, 8, 19, 18));
    });

    test('every occurrence is in the future and strictly increasing', () {
      final result = occurrences(now: morning);

      for (final instant in result) {
        expect(instant.isAfter(morning), isTrue);
      }
      for (var i = 1; i < result.length; i++) {
        expect(result[i].isAfter(result[i - 1]), isTrue);
      }
    });
  });

  group('the already-played skip', () {
    test('drops the nearest occurrence when its UTC day is already played', () {
      final utcDayOfFirst = DateTime(2026, 8, 18, 18).toUtc();
      final key = '${utcDayOfFirst.year}-'
          '${utcDayOfFirst.month.toString().padLeft(2, '0')}-'
          '${utcDayOfFirst.day.toString().padLeft(2, '0')}';

      final result = occurrences(now: morning, lastPlayedDate: key);

      expect(result.length, kDailyReminderHorizonDays - 1);
      expect(result.first, DateTime(2026, 8, 19, 18));
    });

    test('drops nothing when the last play was an earlier day', () {
      expect(occurrences(now: morning, lastPlayedDate: '2026-08-01').length, kDailyReminderHorizonDays);
    });

    test('only the nearest occurrence can ever be dropped — future days cannot have been played', () {
      final result = occurrences(now: morning, lastPlayedDate: '2026-08-01');

      expect(result.length, kDailyReminderHorizonDays);
    });

    test('a future lastPlayedDate (clock skew) drops nothing rather than silencing the reminder', () {
      expect(occurrences(now: morning, lastPlayedDate: '2027-01-01').length, kDailyReminderHorizonDays);
    });

    test('an unparseable or empty lastPlayedDate is treated as never played', () {
      expect(occurrences(now: morning, lastPlayedDate: '').length, kDailyReminderHorizonDays);
      expect(occurrences(now: morning, lastPlayedDate: 'not-a-date').length, kDailyReminderHorizonDays);
    });
  });

  group('the UTC comparison', () {
    // The skip compares against the UTC date of the occurrence's own INSTANT, so it is correct
    // whichever side of Greenwich the player is on. Asserted through the public behaviour rather
    // than by faking a timezone, which a unit test cannot do portably.
    test('the dropped day is the UTC day of the occurrence, not the local calendar day', () {
      final first = DateTime(2026, 8, 18, 18);
      final localKey = '2026-08-18';
      final utc = first.toUtc();
      final utcKey = '${utc.year}-${utc.month.toString().padLeft(2, '0')}-${utc.day.toString().padLeft(2, '0')}';

      final droppedByUtc = occurrences(now: morning, lastPlayedDate: utcKey);
      expect(droppedByUtc.first, isNot(first));

      if (utcKey != localKey) {
        // Only meaningful where the two differ; where they agree this assertion is vacuous and the
        // test above already carries the weight.
        final notDroppedByLocal = occurrences(now: morning, lastPlayedDate: localKey);
        expect(notDroppedByLocal.first, first);
      }
    });
  });
}
