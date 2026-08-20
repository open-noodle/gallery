import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/utils/daily_reminder_schedule.dart';

/// 18:00 as minutes since local midnight.
const int _sixPm = 18 * 60;

// `soloDailyEnabled` defaults to false here, not true: most of the tests below exercise general
// scheduling behaviour (gates, the horizon, the already-played skip) through the SPACE scope only,
// and that default keeps every one of them exercising exactly the single-source behaviour they did
// before the solo daily existed. Tests of the two-source interaction call
// dailyReminderOccurrences directly instead of through this helper — see "two independent daily
// sources" below — because the brief's exact three cases are the specification for that behaviour.
List<DateTime> occurrences({
  required DateTime now,
  int minuteOfDay = _sixPm,
  bool enabled = true,
  bool permissionGranted = true,
  bool hasOptedInSpace = true,
  bool soloDailyEnabled = false,
  String? spaceLastPlayed,
  String? soloLastPlayed,
  int horizonDays = kDailyReminderHorizonDays,
}) => dailyReminderOccurrences(
  now: now,
  minuteOfDay: minuteOfDay,
  enabled: enabled,
  permissionGranted: permissionGranted,
  hasOptedInSpace: hasOptedInSpace,
  soloDailyEnabled: soloDailyEnabled,
  spaceLastPlayed: spaceLastPlayed,
  soloLastPlayed: soloLastPlayed,
  horizonDays: horizonDays,
);

void main() {
  // 09:00 local on 18 Aug 2026 — before the 18:00 reminder time.
  final morning = DateTime(2026, 8, 18, 9);

  group('gates', () {
    test('disabled means nothing is scheduled', () {
      expect(occurrences(now: morning, enabled: false), isEmpty);
    });

    test('no opted-in space and no solo daily means nothing is scheduled', () {
      // Before the solo daily, hasOptedInSpace was the ONLY gate, so a spaceless player could
      // never be reminded at all. The gate is now `hasOptedInSpace || soloDailyEnabled` — this
      // case stays empty only because soloDailyEnabled is ALSO false here.
      expect(occurrences(now: morning, hasOptedInSpace: false, soloDailyEnabled: false), isEmpty);
    });

    test('a solo daily alone is enough, even with no opted-in space', () {
      expect(occurrences(now: morning, hasOptedInSpace: false, soloDailyEnabled: true), isNotEmpty);
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
      final key =
          '${utcDayOfFirst.year}-'
          '${utcDayOfFirst.month.toString().padLeft(2, '0')}-'
          '${utcDayOfFirst.day.toString().padLeft(2, '0')}';

      final result = occurrences(now: morning, spaceLastPlayed: key);

      expect(result.length, kDailyReminderHorizonDays - 1);
      expect(result.first, DateTime(2026, 8, 19, 18));
    });

    test('drops nothing when the last play was an earlier day', () {
      expect(occurrences(now: morning, spaceLastPlayed: '2026-08-01').length, kDailyReminderHorizonDays);
    });

    test('only the nearest occurrence can ever be dropped — future days cannot have been played', () {
      final result = occurrences(now: morning, spaceLastPlayed: '2026-08-01');

      expect(result.length, kDailyReminderHorizonDays);
    });

    test('a future spaceLastPlayed (clock skew) drops nothing rather than silencing the reminder', () {
      expect(occurrences(now: morning, spaceLastPlayed: '2027-01-01').length, kDailyReminderHorizonDays);
    });

    test('an unparseable or empty spaceLastPlayed is treated as never played', () {
      expect(occurrences(now: morning, spaceLastPlayed: '').length, kDailyReminderHorizonDays);
      expect(occurrences(now: morning, spaceLastPlayed: 'not-a-date').length, kDailyReminderHorizonDays);
    });
  });

  group('two independent daily sources', () {
    // One shared `gameDailyLastPlayed` used to mean finishing EITHER daily silently suppressed the
    // reminder for the OTHER, unplayed one. The streak for each is computed server-side PER SCOPE,
    // so the player lost a streak they were never reminded to defend. These three are the exact
    // cases the fix is specified against.
    test('still reminds when the space daily is played but the solo daily is not', () {
      final occurrences = dailyReminderOccurrences(
        now: DateTime(2026, 8, 19, 9),
        minuteOfDay: 18 * 60,
        enabled: true,
        permissionGranted: true,
        hasOptedInSpace: true,
        soloDailyEnabled: true,
        spaceLastPlayed: '2026-08-19',
        soloLastPlayed: null,
      );
      expect(occurrences.first.day, 19);
    });

    test('skips the day only when every enabled source is played', () {
      final occurrences = dailyReminderOccurrences(
        now: DateTime(2026, 8, 19, 9),
        minuteOfDay: 18 * 60,
        enabled: true,
        permissionGranted: true,
        hasOptedInSpace: true,
        soloDailyEnabled: true,
        spaceLastPlayed: '2026-08-19',
        soloLastPlayed: '2026-08-19',
      );
      expect(occurrences.first.day, 20);
    });

    test('reminds a user with no spaces at all, when the solo daily is on', () {
      // Today hasOptedInSpace gates everything, so these users can never be reminded.
      final occurrences = dailyReminderOccurrences(
        now: DateTime(2026, 8, 19, 9),
        minuteOfDay: 18 * 60,
        enabled: true,
        permissionGranted: true,
        hasOptedInSpace: false,
        soloDailyEnabled: true,
        spaceLastPlayed: null,
        soloLastPlayed: null,
      );
      expect(occurrences, isNotEmpty);
    });

    test('a space-only player (solo not enabled) is unaffected by an unplayed solo daily', () {
      // The mirror image of the first case: with soloDailyEnabled false, a null soloLastPlayed
      // must not hold the space reminder hostage to a source this player was never offered.
      final result = occurrences(now: morning, hasOptedInSpace: true, spaceLastPlayed: '2026-08-18');

      expect(result.length, kDailyReminderHorizonDays - 1);
    });
  });

  group('the UTC comparison', () {
    // dailyKeyFor is exercised directly here, rather than only indirectly through
    // dailyReminderOccurrences: CI (mobile-unit-tests, ubuntu-latest) runs as Etc/UTC, where local
    // time and UTC time are the same instant, so a test that only compares "dropped by UTC key" vs
    // "not dropped by local key" degenerates into a tautology on that runner and would not catch a
    // regression that swapped instant.toUtc() for the instant's own local calendar fields. Fully
    // distinguishing UTC-keyed from local-keyed behaviour end-to-end requires running under a
    // non-UTC TZ, which this suite does not attempt.
    test('dailyKeyFor uses the UTC calendar day of the instant', () {
      expect(dailyKeyFor(DateTime.utc(2026, 8, 19, 23, 59)), '2026-08-19');
      expect(dailyKeyFor(DateTime.utc(2026, 8, 20, 0, 1)), '2026-08-20');
    });

    test('dailyKeyFor zero-pads single-digit months and days', () {
      expect(dailyKeyFor(DateTime.utc(2026, 3, 5, 12, 0)), '2026-03-05');
    });

    test('dailyKeyFor keys the same instant identically whether given in UTC or local time', () {
      final instant = DateTime.utc(2026, 8, 18, 23, 30);

      // A tautology on a UTC runner (toLocal() is a no-op there), but on any non-UTC developer
      // machine this fails immediately if the implementation ever reads local calendar fields
      // instead of the instant itself — free insurance where most of us actually work.
      expect(dailyKeyFor(instant), dailyKeyFor(instant.toLocal()));
    });
  });
}
