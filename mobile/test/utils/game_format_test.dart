import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/utils/game_format.dart';
import 'package:openapi/api.dart';

import '../test_helpers/wire_dates.dart';

GameRoundDetailResponseDto _round(int index, {num? score}) => GameRoundDetailResponseDto(
  index: index,
  type: GameRoundType.location,
  score: score == null ? const Optional.absent() : Optional.present(score),
);

GameRoundDetailResponseDto _dateRound(int index, {num? score}) => GameRoundDetailResponseDto(
  index: index,
  type: GameRoundType.date,
  score: score == null ? const Optional.absent() : Optional.present(score),
);

void main() {
  group('wrapLongitude', () {
    test('wraps values maplibre produces past the antimeridian', () {
      // The server's longitudeSchema is min(-180).max(180) and 400s outside it.
      expect(wrapLongitude(200), closeTo(-160, 1e-9));
      expect(wrapLongitude(-230), closeTo(130, 1e-9));
    });

    test('leaves in-range values alone', () {
      expect(wrapLongitude(0), 0);
      // 180 and -180 are the same meridian; the modulo formula normalises the exact boundary to
      // -180 (matches web's game.spec.ts `normalises the antimeridian boundary to -180`).
      expect(wrapLongitude(180), closeTo(-180, 1e-9));
      expect(wrapLongitude(-180), closeTo(-180, 1e-9));
    });

    test('a full extra turn still lands in range', () {
      expect(wrapLongitude(540).abs(), lessThanOrEqualTo(180));
      expect(wrapLongitude(-540).abs(), lessThanOrEqualTo(180));
    });
  });

  group('revealBounds', () {
    test('an ordinary pair uses plain min/max on both axes', () {
      final bounds = revealBounds((lat: 48.85, lon: 2.35), (lat: 51.5, lon: -0.13));

      expect(bounds.southLat, 48.85);
      expect(bounds.northLat, 51.5);
      expect(bounds.westLon, -0.13);
      expect(bounds.eastLon, 2.35);
    });

    test('a pair straddling the antimeridian wraps instead of spanning the long way round', () {
      // ~110 km apart the short way, across the dateline — not the ~359°-wide box naive min/max
      // would produce.
      final bounds = revealBounds((lat: 10, lon: 179.5), (lat: 10, lon: -179.5));

      // LatLngBounds (maplibre_gl) reads southwest.longitude > northeast.longitude as "wraps the
      // dateline", so the west corner must carry the LARGER longitude here.
      expect(bounds.westLon, 179.5);
      expect(bounds.eastLon, -179.5);
      expect(bounds.westLon, greaterThan(bounds.eastLon));

      // The short arc from 179.5° to -179.5° going east (wrapping at 180°) is 1°, not 359°.
      final shortSpan = 180 - bounds.westLon + (bounds.eastLon - -180);
      expect(shortSpan, closeTo(1, 1e-9));
    });

    test('a pair exactly 180 degrees apart uses plain min/max (the boundary case)', () {
      final bounds = revealBounds((lat: 0, lon: 90), (lat: 0, lon: -90));

      expect(bounds.westLon, -90);
      expect(bounds.eastLon, 90);
    });

    test('identical points collapse to a zero-size box, not a NaN or wrapped one', () {
      final bounds = revealBounds((lat: 36.9, lon: -4.5), (lat: 36.9, lon: -4.5));

      expect(bounds.southLat, 36.9);
      expect(bounds.northLat, 36.9);
      expect(bounds.westLon, -4.5);
      expect(bounds.eastLon, -4.5);
    });
  });

  group('formatDistanceKm', () {
    test('uses metres below a kilometre, with no decimals', () {
      expect(formatDistanceKm(0.38), '380 m');
    });

    test('a zero distance is metres, never 0.0 km', () {
      expect(formatDistanceKm(0), '0 m');
    });

    test('one decimal between 1 and 10 km', () {
      expect(formatDistanceKm(4.25), '4.3 km');
    });

    test('rounds above 10 km', () {
      expect(formatDistanceKm(38.4), '38 km');
    });
  });

  group('scorePercent', () {
    test('clamps below zero', () => expect(scorePercent(-10), 0));
    test('clamps above the maximum', () => expect(scorePercent(kMaxRoundScore + 1000), 100));
    test('scales linearly', () => expect(scorePercent(kMaxRoundScore ~/ 2), 50));
  });

  group('competitionRanks', () {
    test('is empty for an empty board', () => expect(competitionRanks(const []), isEmpty));

    test('gives every player rank 1 when all totals tie', () {
      expect(competitionRanks(const [10, 10, 10]), [1, 1, 1]);
    });

    test('numbers a tie 1, 2, 2, 4 rather than inventing a winner', () {
      expect(competitionRanks(const [30, 20, 20, 10]), [1, 2, 2, 4]);
    });
  });

  group('formatStandingsMonth', () {
    test('renders the UTC month, not the local one', () {
      expect(formatStandingsMonth('2026-08', locale: 'en_US'), 'August 2026');
      expect(formatStandingsMonth('2026-01', locale: 'en_US'), 'January 2026');
    });
  });

  group('shouldShowStandings', () {
    test('is hidden while nobody has been asked, even with history', () {
      expect(shouldShowStandings(null, const [3]), isFalse);
    });

    test('is shown when disabled but history exists — disabling deletes nothing', () {
      expect(shouldShowStandings(false, const [3]), isTrue);
    });

    test('is hidden when disabled with no history', () {
      expect(shouldShowStandings(false, const [0, 0]), isFalse);
    });

    test('is shown whenever enabled', () {
      expect(shouldShowStandings(true, const []), isTrue);
    });
  });

  group('timeUntilNextDaily', () {
    test('counts to the next UTC midnight', () {
      expect(timeUntilNextDaily(DateTime.utc(2026, 8, 18, 17, 48)), '6h 12m');
    });

    test('never goes negative at the boundary', () {
      expect(timeUntilNextDaily(DateTime.utc(2026, 8, 18, 23, 59, 59)), '0h 0m');
    });
  });

  group('firstUnansweredIndex', () {
    test('is 0 when nothing is answered', () {
      expect(firstUnansweredIndex([_round(0), _round(1)]), 0);
    });

    test('skips answered rounds', () {
      expect(firstUnansweredIndex([_round(0, score: 10), _round(1, score: 0), _round(2)]), 2);
    });

    test('a zero score counts as answered — it is a real result, not a missing one', () {
      expect(firstUnansweredIndex([_round(0, score: 0)]), isNull);
    });

    test('is null when every round is answered', () {
      expect(firstUnansweredIndex([_round(0, score: 5), _round(1, score: 5)]), isNull);
    });

    test('is null for an empty round list', () {
      expect(firstUnansweredIndex(const []), isNull);
    });
  });

  group('formatGameDate', () {
    test('renders the UTC day, not the local one', () {
      // Both ends of the UTC day, because one alone only bites in half the world: 23:30 UTC is
      // already tomorrow east of Greenwich, 00:30 UTC is still yesterday west of it. The streak
      // counts both of these games against the 19th, so both rows have to say the 19th.
      //
      // Neither can bite in a UTC-pinned environment, where the two code paths produce the same
      // day — the same limitation formatStandingsMonth's own timeZone handling has.
      expect(formatGameDate(DateTime.utc(2026, 8, 19, 23, 30), locale: 'en_US'), 'Aug 19, 2026');
      expect(formatGameDate(DateTime.utc(2026, 8, 19, 0, 30), locale: 'en_US'), 'Aug 19, 2026');
    });
  });

  group('formatDailyDate', () {
    test('renders the day the wire named, not a day derived from the device offset', () {
      // The shape the generated client ACTUALLY produces for `dailyOn`: `mapDateTime` calls
      // `DateTime.tryParse('2026-08-19')`, and Dart parses an offset-less string in the DEVICE's
      // zone — so this is LOCAL midnight, a calendar day rather than an instant.
      //
      // The group above feeds `DateTime.utc(...)`, which is right for `createdAt` and is a shape
      // the wire NEVER produces for `dailyOn`. That is the whole reason a `.toUtc()` on this value
      // survived review: under TZ=UTC the two are indistinguishable, and only away from Greenwich
      // does the conversion move the row to a different day than the streak counted it under.
      // Run this file under `TZ=Europe/Berlin` (or `TZ=America/New_York`) to see it bite.
      final dailyOn = wireDateOnly('2026-08-19');
      expect(dailyOn.isUtc, isFalse, reason: 'the premise: an offset-less date parses in local time');

      expect(formatDailyDate(dailyOn, locale: 'en_US'), 'Aug 19, 2026');
    });

    test('never converts, whichever flag the value happens to carry', () {
      // Both directions of the same claim: the day this renders is the day the value names, so a
      // UTC-flagged fixture and a local one agree. Anything that converts breaks one of them.
      expect(formatDailyDate(DateTime.utc(2026, 8, 19), locale: 'en_US'), 'Aug 19, 2026');
      expect(formatDailyDate(DateTime(2026, 8, 19), locale: 'en_US'), 'Aug 19, 2026');
    });
  });

  group('soloTotal', () {
    test('sums the whole game, not one round', () {
      expect(soloTotal([_round(0, score: 4200), _round(1, score: 14220)]), 18420);
    });

    test('counts an unanswered round as zero rather than skipping it', () {
      // `score` is Optional<num?> and `Absent.value` THROWS, so this also pins the `.orElse(null)`.
      // A game abandoned halfway is not worth more per round than one played out.
      expect(soloTotal([_round(0, score: 4200), _round(1)]), 4200);
    });

    test('a zero-scored round is a real result, and a game of them totals zero', () {
      expect(soloTotal([_round(0, score: 0), _round(1, score: 0)]), 0);
    });
  });

  group('challengeTypeOf', () {
    // Labelled from the rounds the challenge actually CONTAINS, not from what was requested: a
    // mixed request that could only find location photos produced a places game, so "another one
    // like that" is a places game. Mirrors web's `typeOf`.
    test('all location rounds is a location game', () {
      expect(challengeTypeOf([_round(0), _round(1)]), GameChallengeType.location);
    });

    test('all date rounds is a date game', () {
      expect(challengeTypeOf([_dateRound(0), _dateRound(1)]), GameChallengeType.date);
    });

    test('one of each is mixed', () {
      expect(challengeTypeOf([_round(0), _dateRound(1)]), GameChallengeType.mixed);
    });
  });

  group('formatGameScore', () {
    test('groups digits so game_points does not render 18420 pts', () {
      expect(formatGameScore(18420, locale: 'en_US'), '18,420');
      expect(formatGameScore(0, locale: 'en_US'), '0');
    });
  });

  group('soloCreateFailureKey', () {
    test('a server 400 is the one failure the player can act on', () {
      // NOT `game_solo_no_photos`. That copy ends "…or include partner or shared-space photos when
      // you start a game", and mobile's create sheet has no source toggles — deliberately, because
      // this client cannot read the stored preference those would override. Half of the one message
      // a stuck mobile player sees would point at a control that does not exist on their device,
      // which is the same defect already ruled must-fix on the daily card (game_solo_daily_
      // unavailable exists for exactly this reason).
      expect(
        soloCreateFailureKey(ApiException(400, '{"message":"no candidates"}')),
        'game_solo_no_photos_in_library',
      );
    });

    test('an offline 400 does not blame the library', () {
      // The generated client wraps SocketException/TlsException/ClientException into
      // ApiException(400, ...) with an innerException — telling that player to add GPS data would
      // send them off fixing the wrong thing.
      final offline = ApiException.withInner(400, 'connection failed', const SocketException('no route'), null);

      expect(soloCreateFailureKey(offline), 'scaffold_body_error_occurred');
    });

    test('any other failure falls back to the scope-neutral generic', () {
      // NOT game_create_failed: that one reads "from this space's photos", and a solo player may
      // be in no space at all.
      expect(soloCreateFailureKey(ApiException(500, 'boom')), 'scaffold_body_error_occurred');
      expect(soloCreateFailureKey(Exception('boom')), 'scaffold_body_error_occurred');
    });
  });
}
