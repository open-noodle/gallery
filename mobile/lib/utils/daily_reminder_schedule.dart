/// How many days ahead the reminder schedules.
///
/// One-shots over a horizon rather than a repeating schedule: a repeating notification cannot skip a
/// single occurrence, so it would remind a player about a daily they had already played — the usual
/// reason notifications get switched off for good. The cost is that reminders lapse if the app is
/// not opened for a week, which is accepted; a player who has been away that long is better left
/// alone. It also keeps well clear of iOS's 64-pending-notification cap.
const int kDailyReminderHorizonDays = 7;

/// The `YYYY-MM-DD` UTC key for an instant — the same shape `SettingsKey.gameSpaceDailyLastPlayed`
/// and `SettingsKey.gameSoloDailyLastPlayed` hold, and the same day boundary the server's
/// `dailyOn` uses.
String dailyKeyFor(DateTime instant) {
  final utc = instant.toUtc();
  return '${utc.year.toString().padLeft(4, '0')}-'
      '${utc.month.toString().padLeft(2, '0')}-'
      '${utc.day.toString().padLeft(2, '0')}';
}

/// Which local instants the daily reminder should fire at.
///
/// Pure and total: every input is a local value and nothing here performs I/O. In particular this
/// never asks the server whether a daily has been played, because `GET .../games/daily` GENERATES
/// the daily as a side effect of the read.
///
/// [minuteOfDay] is minutes since local midnight. It is a local time on purpose: the daily resets at
/// UTC midnight, which is 1-2 am across Europe. Any local time maps to some UTC instant, and
/// whatever daily is current then is the one waiting — so there is no timezone trap, provided the
/// copy never names a date.
///
/// There are two independent daily sources, a space's and the player's own solo one, each with its
/// own streak computed server-side. [hasOptedInSpace] / [spaceLastPlayed] and [soloDailyEnabled] /
/// [soloLastPlayed] carry one source each rather than collapsing back into a single flag and a
/// single date: a single `gameDailyLastPlayed` used to mean finishing EITHER daily silently
/// suppressed the reminder for the OTHER, unplayed one, costing the player a streak they were
/// never reminded to defend. Still not a per-space map on the space side, though — see
/// [hasOptedInSpace]'s doc.
///
/// [hasOptedInSpace] is whether ANY of the player's spaces has switched its daily on, not which —
/// reading a specific space's daily GENERATES it as a side effect, so resolving one would create a
/// daily nobody asked for just to decide whether to remind. [soloDailyEnabled] has no comparable
/// per-space opt-in to check: every account has a personal daily once the reminder is on, so the
/// caller passes it in mainly so this stays a pure function of its arguments rather than a global
/// assumption baked in here.
///
/// [soloUnavailableOn], separately, is NOT about opt-in — it is about whether the solo daily could
/// even be generated. `soloDailyEnabled == true` asserts the feature exists for this player, not
/// that today's instance does: the player's library can genuinely be too small to fill one (see
/// `GameSoloDailyUnavailable` on the solo page), and on that day [soloLastPlayed] can never equal
/// the day's key either, because there is nothing to have played. Without this, a player whose
/// solo daily is unavailable today would either (a) if they also have an opted-in space, still get
/// reminded tonight about a space daily they already finished — the exact "reminded about a daily I
/// already played" failure the one-shot horizon exists to prevent — or (b) if they have no space at
/// all, get reminded forever about a daily that will never exist. A day whose key matches
/// [soloUnavailableOn] counts the solo side as satisfied for that day ONLY — it is keyed to the one
/// day it was actually observed, not a standing "solo is off" flag, so a library that fills again
/// tomorrow is not locked out by yesterday's finding, and it never widens to affect any other day in
/// the horizon.
List<DateTime> dailyReminderOccurrences({
  required DateTime now,
  required int minuteOfDay,
  required bool enabled,
  required bool permissionGranted,
  required bool hasOptedInSpace,
  required bool soloDailyEnabled,
  required String? spaceLastPlayed,
  required String? soloLastPlayed,
  required String? soloUnavailableOn,
  int horizonDays = kDailyReminderHorizonDays,
}) {
  // Permission is checked here, not only where the toggle is set: it can be revoked in OS settings
  // long after the toggle was switched on. The scope gate is OR, not AND: before the solo daily, a
  // player with no opted-in space could never be reminded at all, even once they had one.
  if (!enabled || !permissionGranted || !(hasOptedInSpace || soloDailyEnabled) || horizonDays <= 0) {
    return const [];
  }

  final firstToday = DateTime(now.year, now.month, now.day).add(Duration(minutes: minuteOfDay));
  final start = firstToday.isAfter(now) ? firstToday : firstToday.add(const Duration(days: 1));

  final occurrences = <DateTime>[];
  for (var day = 0; day < horizonDays; day++) {
    final instant = start.add(Duration(days: day));
    // The skip compares against the UTC day of THIS instant, not the local calendar day, so it is
    // correct for a player whose evening falls on the following UTC date.
    final key = dailyKeyFor(instant);
    // A day is skipped only when EVERY source the player actually has is played for it. A source
    // that is not enabled for them counts as vacuously played rather than as unplayed — otherwise
    // a spaceless player's permanently-null spaceLastPlayed would never equal any key and no day
    // would ever be skippable, and symmetrically a space-only player would be reminded forever
    // about a solo daily they never opted into. A day CONFIRMED unavailable also counts the solo
    // side as satisfied — see [soloUnavailableOn]'s doc above for why that is not the same claim
    // as "played".
    final spacePlayed = !hasOptedInSpace || spaceLastPlayed == key;
    final soloPlayed = !soloDailyEnabled || soloLastPlayed == key || soloUnavailableOn == key;
    if (spacePlayed && soloPlayed) {
      continue;
    }
    occurrences.add(instant);
  }
  return occurrences;
}
