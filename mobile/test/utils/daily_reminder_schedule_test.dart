import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/utils/daily_reminder_schedule.dart';

import '../test_helpers/wire_dates.dart';

/// 18:00 as minutes since local midnight.
const int _sixPm = 18 * 60;

// `soloDailyEnabled` defaults to false here, not true: most of the tests below exercise general
// scheduling behaviour (gates, the horizon, the already-played skip) through the SPACE scope only,
// and that default keeps every one of them exercising exactly the single-source behaviour they did
// before the solo daily existed. `soloUnavailableOn` defaults to null (never confirmed unavailable)
// for the same reason. Tests of the two-source interaction call dailyReminderOccurrences directly
// instead of through this helper — see "two independent daily sources" below — because the brief's
// exact three cases, plus the availability cases added alongside them, are the specification for
// that behaviour.
List<DateTime> occurrences({
  required DateTime now,
  int minuteOfDay = _sixPm,
  bool enabled = true,
  bool permissionGranted = true,
  bool hasOptedInSpace = true,
  bool soloDailyEnabled = false,
  String? spaceLastPlayed,
  String? soloLastPlayed,
  String? soloUnavailableOn,
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
  soloUnavailableOn: soloUnavailableOn,
  horizonDays: horizonDays,
);

/// The UTC day key of [instant], computed independently of `dailyKeyFor` — matching the
/// already-played skip tests below, so a test comparing against this cannot pass merely because it
/// makes the same mistake `dailyKeyFor` would.
String _utcKeyOf(DateTime instant) {
  final utc = instant.toUtc();
  return '${utc.year}-${utc.month.toString().padLeft(2, '0')}-${utc.day.toString().padLeft(2, '0')}';
}

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
      final key = _utcKeyOf(DateTime(2026, 8, 18, 18));

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
    // now = 09:00 local on 19 Aug 2026 throughout, before the 18:00 reminder time, so the nearest
    // occurrence in every case below is local 18:00 on the 19th. `todayKey` is that occurrence's
    // UTC day, derived the same way the already-played skip tests above derive theirs — not
    // hardcoded as '2026-08-19' — so none of this flips on a runner west of UTC-6, where that
    // offset lands local 18:00 on the FOLLOWING UTC date instead.
    final now = DateTime(2026, 8, 19, 9);
    final todayKey = _utcKeyOf(DateTime(2026, 8, 19, 18));

    // One shared `gameDailyLastPlayed` used to mean finishing EITHER daily silently suppressed the
    // reminder for the OTHER, unplayed one. The streak for each is computed server-side PER SCOPE,
    // so the player lost a streak they were never reminded to defend. These three are the exact
    // cases the fix is specified against.
    test('still reminds when the space daily is played but the solo daily is not', () {
      final result = dailyReminderOccurrences(
        now: now,
        minuteOfDay: 18 * 60,
        enabled: true,
        permissionGranted: true,
        hasOptedInSpace: true,
        soloDailyEnabled: true,
        spaceLastPlayed: todayKey,
        soloLastPlayed: null,
        soloUnavailableOn: null,
      );
      expect(result.first.day, 19);
    });

    test('skips the day only when every enabled source is played', () {
      final result = dailyReminderOccurrences(
        now: now,
        minuteOfDay: 18 * 60,
        enabled: true,
        permissionGranted: true,
        hasOptedInSpace: true,
        soloDailyEnabled: true,
        spaceLastPlayed: todayKey,
        soloLastPlayed: todayKey,
        soloUnavailableOn: null,
      );
      expect(result.first.day, 20);
    });

    test('reminds a user with no spaces at all, when the solo daily is on', () {
      // Today hasOptedInSpace gates everything, so these users can never be reminded.
      final result = dailyReminderOccurrences(
        now: now,
        minuteOfDay: 18 * 60,
        enabled: true,
        permissionGranted: true,
        hasOptedInSpace: false,
        soloDailyEnabled: true,
        spaceLastPlayed: null,
        soloLastPlayed: null,
        soloUnavailableOn: null,
      );
      expect(result, isNotEmpty);
    });

    test('a space-only player (solo not enabled) is unaffected by an unplayed solo daily', () {
      // The mirror image of the first case: with soloDailyEnabled false, a null soloLastPlayed
      // must not hold the space reminder hostage to a source this player was never offered.
      final result = occurrences(
        now: morning,
        hasOptedInSpace: true,
        spaceLastPlayed: _utcKeyOf(DateTime(2026, 8, 18, 18)),
      );

      expect(result.length, kDailyReminderHorizonDays - 1);
    });

    // A day whose solo daily is CONFIRMED unavailable counts the solo side as satisfied for that
    // day, exactly like "played". Without this, a space player who finished today's space daily
    // but whose library cannot fill a solo one would still get reminded tonight about a daily that
    // has already been dealt with in every sense that matters — precisely the "reminded about
    // something already handled" failure the one-shot horizon exists to prevent (see its doc).
    test('a space player who finished today gets no reminder when the solo daily is unavailable', () {
      final result = dailyReminderOccurrences(
        now: now,
        minuteOfDay: 18 * 60,
        enabled: true,
        permissionGranted: true,
        hasOptedInSpace: true,
        soloDailyEnabled: true,
        spaceLastPlayed: todayKey,
        soloLastPlayed: null,
        soloUnavailableOn: todayKey,
      );
      expect(result.first.day, 20);
    });

    // The other cohort the fix names: a spaceless player whose solo daily is ALSO unavailable
    // today must not be reminded about it forever — only the one day it was actually observed
    // unavailable is allowed to drop.
    test('a spaceless player gets no reminder today when the solo daily is unavailable', () {
      final result = dailyReminderOccurrences(
        now: now,
        minuteOfDay: 18 * 60,
        enabled: true,
        permissionGranted: true,
        hasOptedInSpace: false,
        soloDailyEnabled: true,
        spaceLastPlayed: null,
        soloLastPlayed: null,
        soloUnavailableOn: todayKey,
      );
      expect(result.length, kDailyReminderHorizonDays - 1);
      expect(result.first.day, 20);
    });

    // The re-evaluate-per-day requirement: an "unavailable" finding from a PREVIOUS day must not
    // suppress today's occurrence — a library that could not fill a daily yesterday may well fill
    // one today. This is what proves the flag is keyed to the specific day it was observed, not a
    // standing "solo is off" switch.
    test('a stale soloUnavailableOn from a previous day does not suppress today', () {
      final yesterdayKey = _utcKeyOf(DateTime(2026, 8, 18, 18));

      final result = dailyReminderOccurrences(
        now: now,
        minuteOfDay: 18 * 60,
        enabled: true,
        permissionGranted: true,
        hasOptedInSpace: false,
        soloDailyEnabled: true,
        spaceLastPlayed: null,
        soloLastPlayed: null,
        soloUnavailableOn: yesterdayKey,
      );
      expect(result.length, kDailyReminderHorizonDays);
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

    test('dailyKeyForDateOnly keys a date-only wire value by the day it names', () {
      // `challenge.dailyOn` is `YYYY-MM-DD` on the wire and the generated client parses it with
      // `DateTime.tryParse`, which Dart resolves in the DEVICE's zone — so it arrives as LOCAL
      // midnight, not as an instant. `dailyKeyFor` would convert it and name the previous day east
      // of Greenwich. Run this file under `TZ=Europe/Berlin` to see that; under Etc/UTC (what CI
      // runs) the two are indistinguishable, the same limitation the note above records.
      final dailyOn = wireDateOnly('2026-08-19');
      expect(dailyOn.isUtc, isFalse, reason: 'the premise: an offset-less date parses in local time');

      expect(dailyKeyForDateOnly(dailyOn), '2026-08-19');
      expect(dailyKeyForDateOnly(wireDateOnly('2026-03-05')), '2026-03-05', reason: 'still zero-padded');
    });

    // The two halves of the suppression the whole one-shot horizon rests on, checked against each
    // other rather than one at a time: `DailyReminderController.recordDailyCompleted` stores
    // `dailyKeyForDateOnly(challenge.dailyOn)` — computed from a DATE-ONLY value — and the skip
    // below compares it against `dailyKeyFor(<that day's reminder instant>)` — computed from a real
    // INSTANT. Two shapes, two functions, and if they disagree the day is never skipped: the player
    // finishes today's daily and is reminded about it tonight anyway.
    test('a day is skipped when its daily was recorded from the date-only value the server sent', () {
      final tonight = DateTime(2026, 8, 18, 18);
      // What the server names as the daily current at that instant, and what it puts on the wire.
      final recorded = dailyKeyForDateOnly(wireDateOnly(dailyKeyFor(tonight)));

      final result = occurrences(
        now: DateTime(2026, 8, 18, 9),
        hasOptedInSpace: false,
        soloDailyEnabled: true,
        soloLastPlayed: recorded,
      );

      expect(
        result,
        isNot(contains(tonight)),
        reason: 'the daily played this morning must not be advertised again tonight',
      );
      expect(result.length, kDailyReminderHorizonDays - 1, reason: 'exactly one day dropped, not the whole horizon');
    });
  });
}
