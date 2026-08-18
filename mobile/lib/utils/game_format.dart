import 'package:intl/intl.dart';
import 'package:openapi/api.dart';

/// Points a perfect guess earns. Mirrors MAX_ROUND_SCORE on the server.
const int kMaxRoundScore = 5000;

/// Wraps a longitude into the server-accepted [-180, 180] range.
///
/// maplibre does not wrap the longitude it reports, and panning across the antimeridian on a world
/// guessing map routinely yields values like 200 or -230. The server's longitudeSchema is
/// `min(-180).max(180)` and 400s on anything outside it.
double wrapLongitude(double lng) => ((((lng + 180) % 360) + 360) % 360) - 180;

/// Human-readable distance. Precision shrinks as distance grows: metres are meaningful for a near
/// miss, decimals are noise at continental scale.
String formatDistanceKm(double km) {
  if (km < 1) {
    return '${(km * 1000).round()} m';
  }
  if (km < 10) {
    return '${km.toStringAsFixed(1)} km';
  }
  return '${NumberFormat.decimalPattern().format(km.round())} km';
}

/// Score as a 0-100 bar width, clamped so a bad value cannot overflow the bar.
int scorePercent(num score) => (100 * score / kMaxRoundScore).round().clamp(0, 100);

/// How long until the next daily, as `6h 12m`.
///
/// Counted to the next UTC midnight, matching the server's `dailyOn` key. Counting to the viewer's
/// local midnight would promise tomorrow's challenge at the wrong hour for everyone outside UTC.
String timeUntilNextDaily(DateTime now) {
  final utc = now.toUtc();
  final nextUtcMidnight = DateTime.utc(utc.year, utc.month, utc.day + 1);
  final minutesLeft = nextUtcMidnight.difference(utc).inMinutes.clamp(0, 1 << 30);
  return '${minutesLeft ~/ 60}h ${minutesLeft % 60}m';
}

/// Competition ranks — `1, 2, 2, 4` — for a board already sorted best-first by the server.
///
/// Ties on the displayed total only. Two players on 4,200 points share second place even though the
/// server's ordering put one above the other on a tie-break the board does not show; numbering them
/// 2 and 3 would claim a winner the score does not support.
List<int> competitionRanks(List<num> totals) {
  final ranks = <int>[];
  num? lastTotal;
  var lastRank = 0;
  for (var i = 0; i < totals.length; i++) {
    if (totals[i] != lastTotal) {
      lastTotal = totals[i];
      lastRank = i + 1;
    }
    ranks.add(lastRank);
  }
  return ranks;
}

/// A `YYYY-MM` standings key as a month name, e.g. `August 2026`.
///
/// Built from a UTC DateTime: the server's month is a UTC month, and formatting it in the viewer's
/// zone would show the previous month to anyone west of Greenwich.
String formatStandingsMonth(String month, {String? locale}) {
  final parts = month.split('-');
  final date = DateTime.utc(int.parse(parts[0]), int.parse(parts[1]), 1);
  return DateFormat.yMMMM(locale).format(date);
}

/// Whether the standings section belongs on the page.
///
/// The null branch is not redundant: an un-asked space can already hold daily history from before
/// the opt-in existed, and the prompt asking whether to turn the feature on must not sit above a
/// populated board. Answering the prompt brings it back, because disabling never deletes anything.
bool shouldShowStandings(bool? enabled, List<num> daysPlayed) {
  if (enabled == null) {
    return false;
  }
  return enabled || daysPlayed.any((days) => days > 0);
}

/// The index of the first round this caller has not answered, or null when the challenge is done.
///
/// A round carries a `score` only once guessed, so `score` is the answered marker. It is
/// `Optional<num?>` and `Absent.value` THROWS — this must stay `.orElse(null)`. A score of 0 is a
/// real result and counts as answered.
int? firstUnansweredIndex(List<GameRoundDetailResponseDto> rounds) {
  for (final round in rounds) {
    if (round.score.orElse(null) == null) {
      return round.index.toInt();
    }
  }
  return null;
}
