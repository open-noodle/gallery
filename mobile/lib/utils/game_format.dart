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

/// The southwest/northeast corners framing two points on a map, along the SHORTER arc between
/// them.
///
/// Latitude is always plain min/max. Longitude is too, whenever the pair doesn't straddle the
/// antimeridian — but when it does (e.g. an answer at 179.5° and a guess at -179.5°, ~110 km apart
/// the short way), plain min/max would span 359° of longitude the LONG way round the globe instead
/// of the ~1° the two points actually span. `LatLngBounds` (maplibre_gl) treats
/// `southwest.longitude > northeast.longitude` as "this box wraps the dateline", so the short-arc
/// case below deliberately flips which side gets the larger value: west takes the larger longitude,
/// east the smaller — producing exactly that wrapped form.
///
/// Both inputs are assumed already wrapped into [-180, 180] (guesses are, via [wrapLongitude],
/// before submission; answers come from the server, which stores them in the same range).
({double southLat, double westLon, double northLat, double eastLon}) revealBounds(
  ({double lat, double lon}) a,
  ({double lat, double lon}) b,
) {
  final southLat = a.lat < b.lat ? a.lat : b.lat;
  final northLat = a.lat > b.lat ? a.lat : b.lat;

  final double westLon;
  final double eastLon;
  if ((a.lon - b.lon).abs() <= 180) {
    westLon = a.lon < b.lon ? a.lon : b.lon;
    eastLon = a.lon > b.lon ? a.lon : b.lon;
  } else {
    // The short arc crosses the dateline: the usual min/max roles swap.
    westLon = a.lon > b.lon ? a.lon : b.lon;
    eastLon = a.lon < b.lon ? a.lon : b.lon;
  }

  return (southLat: southLat, westLon: westLon, northLat: northLat, eastLon: eastLon);
}

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

/// A game's day — a daily's `dailyOn` or a free-play game's `createdAt` — as a readable date.
///
/// Formatted from the UTC instant for the same reason [formatStandingsMonth] is: every day this
/// game keys on is a UTC calendar day, so rendering a row in the viewer's zone would date a daily
/// to a different day than the streak that counted it.
String formatGameDate(DateTime date, {String? locale}) => DateFormat.yMMMd(locale).format(date.toUtc());

/// A score with digit grouping, e.g. `18,420`.
///
/// Grouped BEFORE interpolation, never after: `game_points` substitutes `{score}` verbatim, so
/// handing it a raw number renders "18420 pts".
String formatGameScore(num score, {String? locale}) => NumberFormat.decimalPattern(locale).format(score);

/// The message key for a failed solo create.
///
/// Only a real 400 means "nothing in your library can fill a round of that kind" — the one failure
/// `game_solo_no_photos` describes truthfully, and the one the player can act on. The generated
/// client wraps `SocketException`/`TlsException`/`ClientException` into `ApiException(400, ...)`
/// as well (see `openapi/lib/api_client.dart`), which is why the status alone is not enough: those
/// carry an `innerException`, and blaming a dropped connection on the player's photos would send
/// them off adding GPS data to fix their wifi.
///
/// The fallback is the app-wide generic rather than `game_create_failed`: that one reads "from
/// this space's photos", and a solo player may be in no space at all.
String soloCreateFailureKey(Object error) {
  final isServerRejection = error is ApiException && error.code == 400 && error.innerException == null;
  return isServerRejection ? 'game_solo_no_photos' : 'scaffold_body_error_occurred';
}
